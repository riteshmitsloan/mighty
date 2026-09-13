import test from 'node:test';
import assert from 'node:assert/strict';
import {partialProfileProjection, savedPartialProfile} from '../src/lib/partial-profile';
import {inboxPayload, validateSave} from '../extension/src/messaging';
import {buildSavedPersonEvidence, savedPersonHeadline} from '../src/lib/person-evidence';
import {readRelationshipData} from '../src/lib/data-access';
import {MemoryServer} from './fake-client';
import {assessCandidate} from '../src/lib/assessment';
import {createGoal} from '../src/lib/goals';
import type {Profile, Session} from '../extension/src/types';

const uid = '11111111-1111-4111-a111-111111111111', other = '22222222-2222-4222-a222-222222222222';
const url = 'https://www.linkedin.com/in/partial-fixture/', at = '2026-09-13T12:00:00.000Z';
const photoUrl = 'https://media.licdn.com/dms/image/v2/SYNTHETIC/profile-displayphoto-shrink_100_100/0/1?e=1800000000&v=beta&t=fixture';
const profile = (): Profile => ({profileUrl: url, name: 'A Fixture Person', photoUrl, profileReadAt: null,
  truncated: false, truncationReasons: [], anchors: [{kind: 'headline', text: 'Founder | Investor', sourceUrl: url + '#profile', observedAt: at}]});
const session: Session = {userId: uid, accessToken: 'test-only', expiresAt: Date.parse(at) + 3_600_000, strategy: ''};
const input = (value: unknown = profile()) => ({operationId: '33333333-3333-4333-a333-333333333333', userId: uid, source: 'rendered_profile', profile: value});

test('partial projection preserves exact header provenance while excluding every lower section and typed fact', () => {
  const raw = {...profile(), anchors: [...profile().anchors,
    {kind: 'experience', field: 'role', text: 'CEO at Old Subject', sourceUrl: url + '#experience', observedAt: at},
    {kind: 'location', text: 'An unverified location', sourceUrl: url + '#profile', observedAt: at}], extra: 'never transferred'};
  const before = structuredClone(raw), result = partialProfileProjection(raw)!;
  assert.deepEqual(result, profile()); assert.deepEqual(raw, before);
  assert.notEqual(result, raw); assert.notEqual(result.anchors[0], raw.anchors[0]);
  assert.equal(result.profileReadAt, null); assert.equal(result.truncated, false);
});

test('malformed, ambiguous, foreign and semantically typed partial headlines fail closed without throwing', () => {
  const original = profile(), headline = original.anchors[0];
  const bad: unknown[] = [null, [], {}, {...original, name: 1}, {...original, name: ' '}, {...original, anchors: [null]},
    {...original, truncationReasons: undefined}, {...original, truncationReasons: ['subject_changed']}, {...original, truncated: true},
    {...original, profileReadAt: at}, {...original, source: 'search_result'}, {...original, anchors: []},
    {...original, anchors: [headline, headline]}, {...original, photoUrl: 'https://evil.example/photo.png'},
    {...original, anchors: [{...headline, text: null}]}, {...original, anchors: [{...headline, observedAt: 'invalid'}]},
    {...original, anchors: [{...headline, observedAt: 1}]}, {...original, anchors: [{...headline, sourceUrl: 'https://www.linkedin.com/in/other/#profile'}]},
    ...['field', 'currentExperience', 'appliesTo', 'polarity', 'exclusive'].map(key => ({...original, anchors: [{...headline, [key]: 'untrusted'}]}))];
  for (const value of bad) assert.equal(partialProfileProjection(value), null);
  const circular = {...original, cycle: null as unknown}; circular.cycle = circular;
  assert.equal(partialProfileProjection(circular), null);
});

test('canonical identity and UTF-8 size limits remain exact', () => {
  for (const profileUrl of ['http://www.linkedin.com/in/partial-fixture/', 'https://www.linkedin.com.evil.example/in/partial-fixture/',
    url + '?trk=x', url + '#profile', 'https://www.linkedin.com/in/Partial-Fixture/', 'https://www.linkedin.com/in/a%2Fb/',
    'https://user@www.linkedin.com/in/partial-fixture/']) {
    assert.equal(partialProfileProjection({...profile(), profileUrl, anchors: [{...profile().anchors[0], sourceUrl: profileUrl + '#profile'}]}), null);
  }
  assert.equal(partialProfileProjection({...profile(), anchors: [{...profile().anchors[0], text: '医'.repeat(18000)}]}), null);
});

test('minimal rendered Save keeps null read timestamps and the same account and operation identity', () => {
  const raw = profile(), save = validateSave(input(raw), session), payload = inboxPayload(save);
  assert.deepEqual(save.profile, raw); assert.notEqual(save.profile, raw);
  assert.equal(payload.profile_read_at, null); assert.equal(payload.snapshot.profileReadAt, null);
  assert.equal(payload.snapshot.source, 'rendered_profile'); assert.equal(payload.user_id, uid);
  assert.equal(payload.operation_id, input().operationId);
  assert.throws(() => validateSave({...input(), userId: other}, session), /different account/);
  assert.throws(() => validateSave({...input(), source: 'search_result'}, session), /Search snippets/);
});

test('Save requires a projected header and rejects extra partial or typed anchors', () => {
  const raw = {...profile(), anchors: [...profile().anchors, {kind: 'experience', field: 'role', text: 'CEO', sourceUrl: url + '#experience', observedAt: at}]};
  assert.throws(() => validateSave(input(raw), session), /actual profile/);
  assert.doesNotThrow(() => validateSave(input(partialProfileProjection(raw)), session));
  for (const patch of [{field: 'role'}, {currentExperience: {}}, {sourceUrl: 'https://www.linkedin.com/in/other/#profile'}]) {
    assert.throws(() => validateSave(input({...profile(), anchors: [{...profile().anchors[0], ...patch}]}), session));
  }
  assert.throws(() => validateSave(input({...profile(), profileReadAt: at}), session), /actual profile/,
    'the header cannot acquire a false completed-read timestamp');
});

function personRow(context: Record<string, unknown>) {
  return {id: 'relationship', user_id: uid, person: 'A Fixture Person', profile_url: url, stage: 'saved', created_at: at, context};
}
test('first saved partial inbox context is visible with name, photo and exact headline, while scoring remains incomplete', async () => {
  const payload = inboxPayload(validateSave(input(), session));
  const row = personRow({source: 'extension', profileComplete: false, profile: payload.snapshot});
  const server = new MemoryServer({outreach_log: [row]}); server.actor = uid;
  const person = (await readRelationshipData(server.client, uid)).people[0];
  assert.equal(person.person, profile().name); assert.equal(person.photoUrl, photoUrl);
  assert.deepEqual(person.profile, payload.snapshot); assert.equal(savedPersonHeadline(person), 'Founder | Investor');
  const candidate = buildSavedPersonEvidence(person);
  assert.equal(candidate.completeProfile, false); assert.equal(candidate.profileReadAt, null);
  assert.ok(candidate.claims.filter(claim => claim.sourceKind === 'profile').every(claim => claim.field === 'context'));
  const goal = createGoal({kind: 'fundraising', title: 'Meet investors', outcome: 'Discuss funding', criteria: [
    {id: 'investor', field: 'role', label: 'Investor', terms: ['Investor'], importance: 'preferred', appliesTo: 'contact', origin: 'user'},
  ]}, {id: other, now: at});
  const assessment = assessCandidate(goal, candidate);
  assert.equal(assessment.criteria[0].status, 'unknown'); assert.equal(assessment.evidenceCoverage.supported, 0);
  assert.equal(assessment.label, 'Possible contact route'); assert.ok(assessment.contactRoutes.every(route => route.provisional));
  assert.deepEqual(row.context.profile, payload.snapshot, 'reader does not alter raw inbox history');
});

test('a complete saved read takes precedence over partial context and a partial headline never replaces saved role display', async () => {
  const context = {source: 'extension', profileComplete: false, profile: {...profile(), source: 'rendered_profile'}};
  const full = {...profile(), profileReadAt: at, source: 'rendered_profile', anchors: [
    {...profile().anchors[0], text: 'Full recorded headline'}, {kind: 'about', text: 'About the complete profile.', sourceUrl: url + '#about', observedAt: at},
  ]};
  const server = new MemoryServer({outreach_log: [personRow(context)], profile_reads: [
    {id: 'read', user_id: uid, relationship_id: 'relationship', snapshot: full, observed_at: at, created_at: at},
  ]}); server.actor = uid;
  const person = (await readRelationshipData(server.client, uid)).people[0];
  assert.deepEqual(person.profile, full); assert.equal(buildSavedPersonEvidence(person).completeProfile, true);
  assert.equal(savedPersonHeadline(person), 'Full recorded headline');
  assert.equal(savedPersonHeadline({...person, profile: context.profile, context: {...context, position: 'Recorded CEO', company: 'Saved company'}}), 'Recorded CEO · Saved company');
});

test('saved partial display rejects a different profile and search snippets without changing original context', async () => {
  for (const snapshot of [{...profile(), source: 'search_result'}, {...profile(), source: 'rendered_profile', profileUrl: 'https://www.linkedin.com/in/other/'},
    {...profile(), source: 'rendered_profile', anchors: [{...profile().anchors[0], field: 'role'}]}]) {
    assert.equal(savedPartialProfile(snapshot, url), null);
    const row = personRow({source: 'extension', profileComplete: false, profile: snapshot});
    const server = new MemoryServer({outreach_log: [row]}); server.actor = uid;
    const person = (await readRelationshipData(server.client, uid)).people[0];
    assert.equal(person.profile, undefined); assert.equal(savedPersonHeadline(person), '');
    assert.deepEqual(person.context, row.context);
  }
});
