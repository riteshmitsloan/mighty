import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {requireDeps} from '../scripts/dependencies.mjs';
const {build} = requireDeps('esbuild');
const {parseHTML} = requireDeps('linkedom');
const {outputFiles} = await build({entryPoints: [fileURLToPath(new URL('../src/popup.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node'});
const script = Buffer.from(outputFiles[0].text).toString('base64');
const {outputFiles: contextFiles} = await build({entryPoints: [fileURLToPath(new URL('../src/goal-context.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node'});
const {accountGoalContext} = await import('data:text/javascript;base64,' + Buffer.from(contextFiles[0].text).toString('base64'));
const html = await readFile(new URL('../public/popup.html', import.meta.url), 'utf8');
const owner = '11111111-1111-4111-a111-111111111111';
const base = 'https://www.linkedin.com/in/';
const other = '22222222-2222-4222-a222-222222222222';
const goal = (id, kind, title, criteria) => ({id, kind, title, outcome: title, criteria, openQuestions: [], status: 'active', version: 1, createdAt: '2026-09-12T12:00:00Z', updatedAt: '2026-09-12T12:00:00Z'});
const career = goal('33333333-3333-4333-a333-333333333333', 'career', 'Healthcare career', [{id: 'health',field: 'custom',label:'Healthcare experience',terms:['healthcare'],importance:'required',appliesTo:'contact',origin:'user'}]);
const fundraising = goal('44444444-4444-4444-a444-444444444444', 'fundraising', 'Seed fundraising', [{id: 'stage',field:'stage',label:'Seed funding',terms:['seed'],importance:'required',appliesTo:'opportunity',origin:'user'}]);
const context = (goals = [career, fundraising], uid = owner) => accountGoalContext(uid, goals.map(document => ({id:document.id,user_id:uid,version:document.version,document})));
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
  const handle = {snapshot, messages, userId: owner, goalContext: options.goalContext ?? context(), saveWait: null, statusWait: null, statusFailure: false, readWait: null, readFailure: options.readFailure ?? false, fail: options.fail || null, connected: options.connected ?? true, saves, document: window.document, window, closed: () => closed};
  globalThis.chrome = {runtime: {
    id: 'a'.repeat(32),
    async sendMessage(message) {
      messages.push(message);
      if (message.type === 'mighty:status') {
        const response = {ok: true, connected: handle.connected, userId: handle.connected ? handle.userId : null, goalContext: handle.connected ? handle.goalContext : null, appOrigin: options.appOrigin ?? 'http://127.0.0.1:5173'};
        const failure = handle.statusFailure; if (handle.statusWait) await handle.statusWait;
        if (failure) throw Error('Old refresh failed.'); return response;
      }
      if (message.type === 'mighty:read_active') {
        const snapshot=handle.snapshot, failure=handle.readFailure;if(handle.readWait)await handle.readWait;
        if(failure)throw Error('Profile read was refused.');return {ok:true,snapshot};
      }
      if (message.type === 'mighty:save') {
        saves.push(structuredClone(message.save));
        if (handle.saveWait) await handle.saveWait;
        return handle.fail?.(message.save) ? {ok: false, message: 'The save is still pending.'} : {ok: true};
      }
      throw Error('Unexpected message');
    },
    connect() {return {onMessage: {addListener(callback) {callbacks.push(callback);}}, onDisconnect: {addListener() {}}};},
  }};
  await import(`data:text/javascript;base64,${script}#${++serial}`);
  await tick();
  handle.refresh = async (type = 'mighty:page_changed') => {for (const callback of callbacks) callback({type}); await tick();};
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
await test('compact profile shows one selected assessment while saving every original source fact', async () => {
  const p = profile(); const h = await open({kind: 'profile', state: 'ready', profile: p, message: ''});
  assert.equal(h.document.querySelectorAll('.goal-pill').length, 2);
  assert.equal(h.document.querySelectorAll('.goal-fit').length, 1);
  assert.equal(h.document.querySelector('.goal-pill[aria-pressed="true"]').textContent, career.title);
  assert.equal(h.document.querySelector('.fit-label').textContent, 'Possible fit');
  assert.match(h.document.querySelector('.reason').textContent, /Healthcare experience/);
  assert.equal(h.document.querySelectorAll('.evidence-section,.assessment-sources,.goal-unknowns,.missing-sections').length, 0);
  assert.doesNotMatch(h.document.querySelector('#content').textContent, /END_SENTINEL|Activity date|Why this matters|probability|percentile|\d+%/i);
  h.document.querySelectorAll('.goal-pill')[1].click();
  assert.equal(h.document.querySelector('.goal-pill[aria-pressed="true"]').textContent, fundraising.title);
  assert.equal(h.document.querySelector('.fit-label').textContent, 'Not enough information');
  await h.clickSave(); assert.deepEqual(h.saves[0].profile, p); assert.equal(h.saves[0].source, 'rendered_profile');
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
  assert.equal(h.document.querySelector('.account a').textContent, 'Connect to Mighty');
  assert.equal(h.document.querySelector('.account a').getAttribute('href'), `http://127.0.0.1:5173/?mighty_extension=${'a'.repeat(32)}#connect-extension`);
  h.document.querySelector('#skip').click();
  assert.equal(h.closed(), true);
  assert.equal(h.saves.length, 0);
});
await test('hosted pairing preserves the app directory and passes only the installed extension ID', async () => {
  const h = await open(search(), {connected: false, appOrigin: 'https://riteshmitsloan.github.io/mighty/'});
  const link = h.document.querySelector('.account a'); const url = new URL(link.getAttribute('href'));
  assert.equal(link.textContent, 'Connect to Mighty');
  assert.equal(url.pathname, '/mighty/'); assert.equal(url.hash, '#connect-extension');
  assert.deepEqual([...url.searchParams.entries()], [['mighty_extension', 'a'.repeat(32)]]);
  assert.equal(link.target, '_blank'); assert.equal(link.rel, 'noopener noreferrer');
  assert.equal(h.messages.some(message => message.type === 'mighty:connect'), false);
});
await test('an already connected popup opens the ordinary app without a pairing request', async () => {
  const h = await open(search(), {appOrigin: 'https://riteshmitsloan.github.io/mighty/'});
  const link = h.document.querySelector('.account a');
  assert.equal(link.textContent, 'Open Mighty');
  assert.equal(link.getAttribute('href'), 'https://riteshmitsloan.github.io/mighty/');
});
await test('goal version refresh changes the selected compact assessment', async () => {
  const h = await open({kind:'profile',state:'ready',profile:profile(),message:''});
  assert.equal(h.document.querySelector('.goal-fit .fit-label').textContent, 'Possible fit');
  h.goalContext = context([{...career,version:2,criteria:[{...career.criteria[0],terms:['aerospace']}]}]);
  await h.refresh('mighty:account_changed');
  assert.equal(h.document.querySelector('.goal-fit').dataset.goalVersion,'2');
  assert.match(h.document.querySelector('.goal-fit .fit-label').textContent,/Not enough information/);
  assert.equal(h.document.querySelector('.assessment-sources'),null);
});
await test('empty saved goals show the account-save instruction and never score search snippets', async () => {
  const h = await open({kind:'profile',state:'ready',profile:profile(),message:''},{goalContext:context([])});
  assert.equal(h.document.querySelector('.goal-fit'),null);
  assert.match(h.document.body.textContent,/Save a goal to your account/);
  h.snapshot = search(); await h.refresh();
  assert.equal(h.document.querySelector('.goal-fit'),null);
  assert.equal(h.document.querySelectorAll('.result').length,7);
});
await test('account change during an in-flight save clears old goals immediately and refreshes after completion', async () => {
  const h = await open({kind:'profile',state:'ready',profile:profile(),message:''});
  let release;h.saveWait = new Promise(resolve=>{release=resolve;});
  h.document.querySelector('#save').click();await tick();assert.equal(h.saves[0].userId,owner);
  h.userId=other;h.goalContext=context([{...fundraising,title:'Second account only'}],other);
  await h.refresh('mighty:account_changed');
  assert.equal(h.document.querySelector('.goal-fit'),null);
  assert.doesNotMatch(h.document.body.textContent,/Healthcare career/);
  release();await tick();await tick();
  assert.equal(h.saves[0].userId,owner);
  assert.match(h.document.querySelector('.goal-pill[aria-pressed="true"]').textContent,/Second account only/);
  assert.doesNotMatch(h.document.querySelector('#notice').textContent,/Saved|Saving/);
  assert.doesNotMatch(h.document.body.textContent,/Healthcare career/);
});
await test('an old failed refresh cannot erase a newly connected account view', async () => {
  const h = await open({kind:'profile',state:'ready',profile:profile(),message:''});
  let release;h.statusWait=new Promise(resolve=>{release=resolve;});h.statusFailure=true;
  await h.refresh();
  h.statusWait=null;h.statusFailure=false;h.userId=other;h.goalContext=context([{...fundraising,title:'New owner goal'}],other);
  await h.refresh('mighty:account_changed');
  assert.match(h.document.querySelector('.goal-pill[aria-pressed="true"]').textContent,/New owner goal/);
  release();await tick();
  assert.match(h.document.querySelector('.goal-pill[aria-pressed="true"]').textContent,/New owner goal/);
  assert.doesNotMatch(h.document.querySelector('#notice').textContent,/Old refresh failed/);
});
await test('focus while saving performs its deferred account-goal refresh after save', async () => {
  const h = await open({kind:'profile',state:'ready',profile:profile(),message:''});
  let release;h.saveWait=new Promise(resolve=>{release=resolve;});h.document.querySelector('#save').click();await tick();
  const before=h.messages.filter(message=>message.type==='mighty:status'&&message.refreshGoals).length;
  h.window.dispatchEvent(new h.window.Event('focus'));await tick();
  assert.equal(h.messages.filter(message=>message.type==='mighty:status'&&message.refreshGoals).length,before);
  release();await tick();await tick();
  assert.equal(h.messages.filter(message=>message.type==='mighty:status'&&message.refreshGoals).length,before+1);
});
await test('successful reconnection clears the previous refresh failure notice', async () => {
  const h = await open({kind:'profile',state:'ready',profile:profile(),message:''});
  h.statusFailure=true;await h.refresh();
  assert.match(h.document.querySelector('#notice').textContent,/Old refresh failed/);
  assert.equal(h.document.querySelector('.goal-fit'),null);
  h.statusFailure=false;await h.refresh();
  assert.ok(h.document.querySelector('.goal-fit'));
  assert.doesNotMatch(h.document.querySelector('#notice').textContent,/Old refresh failed/);
});
await test('a failed page read preserves verified connection but clears the old profile and disables saving',async()=>{
  const h=await open({kind:'profile',state:'ready',profile:profile(),message:''});
  assert.equal(h.document.querySelector('#save').disabled,false);
  let release;h.readWait=new Promise(resolve=>{release=resolve;});h.readFailure=true;await h.refresh();
  assert.equal(h.document.querySelector('#save').disabled,true);assert.equal(h.document.querySelector('.goal-fit'),null);
  h.document.querySelector('#save').click();await tick();assert.equal(h.saves.length,0);
  release();await tick();assert.match(h.document.querySelector('.account-state').textContent,/Account connected/);
  assert.equal(h.document.querySelector('.account a').textContent,'Open Mighty');
  assert.match(h.document.querySelector('#notice').textContent,/page could not be read/);assert.equal(h.document.querySelector('#save').disabled,true);
  h.readWait=null;h.readFailure=false;await h.refresh();assert.equal(h.document.querySelector('#save').disabled,false);
  assert.doesNotMatch(h.document.querySelector('#notice').textContent,/page could not be read/);
});
await test('an initial failed page read still shows a successfully verified account',async()=>{
  const h=await open(search(),{readFailure:true});assert.equal(h.document.querySelector('.account a').textContent,'Open Mighty');
  assert.equal(h.document.querySelector('.account-state').textContent,'Account connected');assert.equal(h.document.querySelector('#save').disabled,true);
  assert.equal(h.document.querySelectorAll('.result').length,0);assert.match(h.document.querySelector('#notice').textContent,/page could not be read/);
});
await test('a late failed page read cannot overwrite a newer successful page and account view',async()=>{
  const h=await open(search());let release;h.readWait=new Promise(resolve=>{release=resolve;});h.readFailure=true;await h.refresh();
  h.readWait=null;h.readFailure=false;h.snapshot={kind:'profile',state:'ready',profile:profile(),message:''};await h.refresh();
  assert.ok(h.document.querySelector('.goal-fit'));release();await tick();assert.ok(h.document.querySelector('.goal-fit'));
  assert.equal(h.document.querySelector('#save').disabled,false);assert.doesNotMatch(h.document.querySelector('#notice').textContent,/page could not be read/);
});
