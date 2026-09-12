import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {requireDeps} from '../scripts/dependencies.mjs';
const {build} = requireDeps('esbuild');
const {parseHTML} = requireDeps('linkedom');
const {outputFiles} = await build({entryPoints: [fileURLToPath(new URL('../src/popup.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node'});
const script = Buffer.from(outputFiles[0].text).toString('base64');
const html = await readFile(new URL('../public/popup.html', import.meta.url), 'utf8');
const owner = '11111111-1111-4111-a111-111111111111';
const base = 'https://www.linkedin.com/in/';
let serial = 0;
const tick = () => new Promise(resolve => setImmediate(resolve));
const search = () => ({kind: 'search', state: 'ready', message: '', pageUrl: 'https://www.linkedin.com/search/results/people/?keywords=healthcare', results: Array.from({length: 7}, (_, index) => ({profileUrl: `${base}person-${index}/`, name: `Person ${index}`, subtitle: 'Healthcare', profileReadAt: null, truncated: false}))});
const profile = () => ({profileUrl: `${base}profile/`, name: 'A Person', profileReadAt: '2026-09-12T12:00:00Z', truncated: false, truncationReasons: [], missingSections: ['languages'], anchors: [
  {kind: 'headline', text: 'Founder', sourceUrl: `${base}profile/#profile`, observedAt: '2026-09-12T12:00:00Z'},
  {kind: 'about', text: 'Healthcare ' + 'full evidence '.repeat(30) + 'END_SENTINEL', sourceUrl: `${base}profile/#about`, observedAt: '2026-09-12T12:00:00Z'},
  {kind: 'experience', text: 'Role one: full factual text.', sourceUrl: `${base}profile/#experience`, observedAt: '2026-09-12T12:00:00Z'},
  {kind: 'experience', text: 'Role two: full factual text.', sourceUrl: `${base}profile/#experience`, observedAt: '2026-09-12T12:00:00Z'},
  {kind: 'timing', text: 'Rendered activity timestamp: Sep 10, 2026', sourceUrl: `${base}profile/#activity`, observedAt: '2026-09-12T12:00:00Z'},
]});
async function open(snapshot, options = {}) {
  const {window} = parseHTML(html);
  globalThis.document = window.document;
  globalThis.window = window;
  globalThis.addEventListener = window.addEventListener.bind(window);
  const messages = [], callbacks = [], saves = [];
  let closed = false;
  window.close = () => {closed = true;};
  const handle = {snapshot, fail: options.fail || null, connected: options.connected ?? true, saves, document: window.document, window, closed: () => closed};
  globalThis.chrome = {runtime: {
    async sendMessage(message) {
      messages.push(message);
      if (message.type === 'mighty:status') return {ok: true, connected: handle.connected, userId: owner, strategy: 'Healthcare leaders', appOrigin: 'http://127.0.0.1:5173'};
      if (message.type === 'mighty:read_active') return {ok: true, snapshot: handle.snapshot};
      if (message.type === 'mighty:save') {
        saves.push(structuredClone(message.save));
        return handle.fail?.(message.save) ? {ok: false, message: 'The save is still pending.'} : {ok: true};
      }
      throw Error('Unexpected message');
    },
    connect() {return {onMessage: {addListener(callback) {callbacks.push(callback);}}, onDisconnect: {addListener() {}}};},
  }};
  await import(`data:text/javascript;base64,${script}#${++serial}`);
  await tick();
  handle.refresh = async () => {for (const callback of callbacks) callback({type: 'mighty:page_changed'}); await tick();};
  handle.clickSave = async () => {window.document.querySelector('#save').click(); await tick();};
  return handle;
}
await test('all seven search rows stay visible; first five remain selected and sixth is refused', async () => {
  const h = await open(search());
  const boxes = [...h.document.querySelectorAll('.result input')];
  assert.equal(boxes.length, 7);
  assert.deepEqual(boxes.map(box => box.checked), [true, true, true, true, true, false, false]);
  boxes[5].checked = true;
  boxes[5].dispatchEvent(new h.window.Event('change'));
  assert.equal(boxes[5].checked, false);
  assert.match(h.document.querySelector('#notice').textContent, /up to five/);
  assert.equal(h.document.querySelector('#selection-summary').textContent, '5 selected · 7 visible');
});
await test('refresh preserves a deselection on the same search', async () => {
  const h = await open(search());
  const box = h.document.querySelector('.result input');
  box.checked = false; box.dispatchEvent(new h.window.Event('change'));
  await h.refresh();
  assert.equal(h.document.querySelector('.result input').checked, false);
  assert.match(h.document.querySelector('#selection-summary').textContent, /^4 selected/);
});
await test('partial saves report the saved count; retry keeps the failed operation id', async () => {
  let reject = true;
  const h = await open(search(), {fail: save => reject && save.profile.profileUrl === `${base}person-2/`});
  await h.clickSave();
  assert.equal(h.saves.length, 5);
  assert.ok(h.saves.every(save => save.userId === owner && save.source === 'search_result' && save.profile.profileReadAt === null && save.profile.anchors.length === 0));
  assert.match(h.document.querySelector('#notice').textContent, /^4 saved\./);
  const first = h.saves.find(save => save.profile.profileUrl === `${base}person-2/`);
  reject = false;
  await h.clickSave();
  assert.equal(h.saves.length, 6);
  assert.equal(h.saves[5].operationId, first.operationId);
  assert.match(h.document.querySelector('#notice').textContent, /^Saved\./);
});
await test('profile groups preserve every fact, explanation precedes fit, save payload stays intact', async () => {
  const p = profile();
  const h = await open({kind: 'profile', state: 'ready', profile: p, message: ''});
  assert.equal([...h.document.querySelectorAll('h2')].filter(node => node.textContent === 'Experience').length, 1);
  assert.match(h.document.body.textContent, /Role one: full factual text\./);
  assert.match(h.document.body.textContent, /Role two: full factual text\./);
  assert.match(h.document.body.textContent, /END_SENTINEL/);
  const fit = h.document.querySelector('.goal-fit');
  assert.equal(fit.children[0].className, 'reason');
  assert.equal(fit.children[1].className, 'fit-label');
  assert.match(fit.children[0].textContent, /…”$/);
  assert.match(h.document.body.textContent, /Activity date: Sep 10, 2026/);
  await h.clickSave();
  assert.deepEqual(h.saves[0].profile, p);
  assert.equal(h.saves[0].source, 'rendered_profile');
});
await test('blocked search stays distinct from empty results and cannot save', async () => {
  const h = await open({kind: 'search', state: 'blocked', message: '', pageUrl: 'https://www.linkedin.com/search/results/people/', results: []});
  assert.match(h.document.body.textContent, /LinkedIn is limiting/);
  assert.doesNotMatch(h.document.body.textContent, /found no people/);
  assert.equal(h.document.querySelector('#save').disabled, true);
});
await test('disconnected account cannot save and Skip only closes the popup', async () => {
  const h = await open({kind: 'profile', state: 'ready', profile: profile(), message: ''}, {connected: false});
  assert.equal(h.document.querySelector('#save').disabled, true);
  assert.equal(h.document.querySelector('.account a').textContent, 'Open Mighty');
  h.document.querySelector('#skip').click();
  assert.equal(h.closed(), true);
  assert.equal(h.saves.length, 0);
});
