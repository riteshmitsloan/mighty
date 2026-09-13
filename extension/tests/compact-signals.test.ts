import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {compactProfile, type CompactProfileOptions} from '../src/compact-profile.js';
import {createProfilePanel} from '../src/profile-panel.js';
import {accountGoalContext} from '../src/goal-context.js';
import {buildExtensionSelfContext, SELF_CONTEXT_LIMITS} from '../../src/lib/extension-self-context';
import {createEvidenceClaim} from '../../src/lib/evidence';
import {createGoal} from '../../src/lib/goals';
import type {Profile, PageSnapshot} from '../src/types.js';

const {parseHTML} = createRequire(import.meta.url)('linkedom');
const uid = '11111111-1111-4111-a111-111111111111', otherUid = '22222222-2222-4222-a222-222222222222';
const goalId = '33333333-3333-4333-a333-333333333333', at = '2026-09-13T12:00:00.000Z';
const url = 'https://www.linkedin.com/in/synthetic-signals-person/';
const school = 'Example University';
const goal = createGoal({kind: 'career', title: 'Find professional peers', outcome: 'Discuss relevant professional experience', criteria: [
  {id: 'role', field: 'role', label: 'Contact role', terms: ['Engineering Director'], importance: 'preferred', appliesTo: 'contact', origin: 'user'},
]}, {id: goalId, now: at});
const context = (owner = uid) => accountGoalContext(owner, [{id: goal.id, user_id: owner, version: goal.version, document: goal}], at);
const selfContext = (owner = uid, text = school, now = Date.now()) => buildExtensionSelfContext(owner, [
  createEvidenceClaim({subject: 'self', field: 'education', text, sourceKind: 'manual', sourceLabel: 'Your confirmed school', confidence: 'user_confirmed', appliesTo: 'contact'}),
], now);
const profile = (education = school): Profile => ({profileUrl: url, name: 'Synthetic Person', profileReadAt: at, truncated: false, truncationReasons: [], anchors: [
  {kind: 'education', text: education + ' Master of Science', sourceUrl: url + '#education', observedAt: at},
  {kind: 'activity', text: 'A visible professional update about #Engineering.', sourceUrl: url + '#content_collections', observedAt: at},
  {kind: 'timing', text: 'Rendered activity timestamp: 2d', sourceUrl: url + '#content_collections', observedAt: at},
  {kind: 'timing', text: 'Recent rendered activity: 2d', sourceUrl: url + '#content_collections', observedAt: at},
]});
const page = (value = profile()): PageSnapshot => ({kind: 'profile', state: 'ready', profile: value, message: ''});
function render(overrides: Partial<CompactProfileOptions> = {}) {
  const {document} = parseHTML('<html><body></body></html>');
  return compactProfile(document, {page: page(), connected: true, userId: uid, goalContext: context(), selfContext: selfContext(), selectedGoalId: goal.id, onSelect() {}, ...overrides});
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('verified same-owner education overlap appears as a sourced conversation topic beside the assessment', () => {
  const card = render();
  assert.equal(card.querySelector('.topic-label')?.textContent, 'Talk about');
  assert.equal(card.querySelector('.shared-topic p')?.textContent, 'Shared education: “Example University”.');
  assert.ok(card.querySelector('.goal-fit'));
  assert.doesNotMatch(card.querySelector('.shared-topic')!.textContent || '', /likely to reply|\d+%|same class/);
});

test('absent, foreign, expired and altered self context never displays another account’s shared topic', () => {
  const valid = selfContext();
  for (const value of [undefined, null, selfContext(otherUid), selfContext(uid, school, Date.now() - SELF_CONTEXT_LIMITS.lifetimeMs - 1000), {...valid, key: 'altered'}]) {
    const card = render({selfContext: value});
    assert.equal(card.querySelector('.shared-topic'), null);
    assert.ok(card.querySelector('.goal-fit'), 'Invalid optional self context does not erase the verified account’s assessment.');
    assert.doesNotMatch(card.textContent || '', /Reconnect from Mighty/);
  }
  assert.equal(render({connected: false}).querySelector('.shared-topic'), null);
});

test('observed activity uses its literal label and a dated title without a reply prediction', () => {
  const signal = render().querySelector('.activity-signal') as HTMLElement;
  assert.equal(signal.textContent, 'Recent activity observed');
  assert.match(signal.title, /1 distinct activity item was visible at the 2026-09-13 profile read/);
  assert.match(signal.title, /does not establish posting frequency or predict replies/);
});

test('missing activity, foreign timestamps and partial reads never present inactivity as a fact', () => {
  const noActivity = {...profile(), anchors: profile().anchors.filter(anchor => anchor.kind === 'education')};
  const absent = render({page: page(noActivity)});
  assert.equal(absent.querySelector('.activity-signal'), null);
  assert.doesNotMatch(absent.textContent || '', /inactive|no activity|rarely posts|less likely/);
  const foreign = {...profile(), anchors: profile().anchors.map(anchor => anchor.kind === 'timing' ? {...anchor, sourceUrl: 'https://www.linkedin.com/in/another-person/#content_collections'} : anchor)};
  assert.equal(render({page: page(foreign)}).querySelector('.activity-signal')?.textContent, 'Activity observed');
  const partial = {...profile(), profileReadAt: null};
  assert.equal(render({page: {kind: 'profile', state: 'unknown', profile: partial, message: ''}}).querySelector('.activity-signal'), null);
});

test('HTML-looking names, goal titles and shared facts render as text rather than executable elements', () => {
  const hostile = 'Example <img src=x onerror=alert(1)> University', title = '<svg onload=alert(2)> Goal';
  const hostileProfile = {...profile(hostile), name: '<img src=x onerror=alert(3)> Person'};
  const hostileGoal = {...goal, title};
  const hostileContext = accountGoalContext(uid, [{id: goal.id, user_id: uid, version: goal.version, document: hostileGoal}], at);
  const card = render({page: page(hostileProfile), goalContext: hostileContext, selfContext: selfContext(uid, hostile)});
  assert.equal(card.querySelector('img,svg,script,iframe'), null);
  assert.equal(card.querySelector('h1')?.textContent, hostileProfile.name);
  assert.equal(card.querySelector('.goal-pill')?.textContent, title);
  assert.ok(card.querySelector('.shared-topic p')?.textContent?.includes(hostile));
  assert.ok(card.innerHTML.includes('&lt;img'));
});

test('the actual panel retains verified status self context and clears the topic immediately during account replacement', async () => {
  const {document} = parseHTML('<html><body></body></html>');
  const state = {owner: uid, self: selfContext(), connected: true};
  const messages: ((value: unknown) => void)[] = [];
  const runtime = {id: 'a'.repeat(32), getURL: (path: string) => 'chrome-extension://' + 'a'.repeat(32) + '/' + path,
    connect() {return {onMessage: {addListener(fn: (value: unknown) => void) {messages.push(fn);}}, onDisconnect: {addListener() {}}, disconnect() {}};},
    async sendMessage(message: {type: string}) {
      return message.type === 'mighty:status' ? {ok: true, connected: state.connected, userId: state.connected ? state.owner : null,
        goalContext: state.connected ? context(state.owner) : null, selfContext: state.self, appOrigin: 'https://app.example.org/'} : {ok: true};
    }};
  const panel = createProfilePanel({document, runtime: runtime as any, url: () => url, read: () => page()});
  try {
    await tick();
    assert.ok(panel.shadow.querySelector('.shared-topic'), 'The status response must survive the panel’s Account projection.');
    state.owner = otherUid;
    for (const receive of messages) receive({type: 'mighty:account_changed'});
    assert.equal(panel.shadow.querySelector('.shared-topic'), null, 'The previous owner’s topic disappears before replacement status resolves.');
    await tick();
    assert.equal(panel.shadow.querySelector('.shared-topic'), null, 'Even a worker response with old optional context cannot leak it to the new owner.');
    assert.equal(panel.shadow.querySelector('.account-state')?.textContent, 'Account connected');
    state.self = selfContext(otherUid); await panel.refreshAccount();
    assert.ok(panel.shadow.querySelector('.shared-topic'));
    state.connected = false; await panel.refreshAccount();
    assert.equal(panel.shadow.querySelector('.shared-topic'), null);
    assert.equal(panel.shadow.querySelector('.account-state')?.textContent, 'Account not connected');
  } finally {panel.dispose();}
});
