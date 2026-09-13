import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {requireDeps} from '../scripts/dependencies.mjs';
const {build} = requireDeps('esbuild');
const {parseHTML} = requireDeps('linkedom');
const {outputFiles} = await build({entryPoints: [fileURLToPath(new URL('../src/popup.ts', import.meta.url))], bundle: true, write: false, format: 'iife', platform: 'browser'});
const script = outputFiles[0].text;
const html = await readFile(new URL('../public/popup.html', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve};};
async function open(options = {}) {
  const {window} = parseHTML(html), calls = [], ports = [], timers = new Map();
  const state = {connected: true, goalContext: {goals: [{title: 'Private goal never shown'}]}, appOrigin: 'https://riteshmitsloan.github.io/mighty/', message: '', wait: null, failure: false, ...options};
  let sequence = 0;
  const runtime = {id: 'a'.repeat(32), sendMessage(message) {
    calls.push(message); if (state.failure === 'sync') throw Error('Connection check failed.');
    const reply = {ok: !state.failure, connected: state.connected, goalContext: state.goalContext, appOrigin: state.appOrigin, message: state.message};
    return state.wait ? state.wait.then(() => reply) : Promise.resolve(reply);
  }, connect() {
    const listeners = [], disconnects = [];
    const port = {onMessage: {addListener: fn => listeners.push(fn)}, onDisconnect: {addListener: fn => disconnects.push(fn)},
      emit: event => listeners.forEach(fn => fn(event)), disconnect: () => disconnects.forEach(fn => fn())};
    ports.push(port); return port;
  }};
  runInNewContext(script, {document: window.document, chrome: {runtime}, URL, Error,
    addEventListener: window.addEventListener.bind(window), setTimeout: (fn, ms) => {timers.set(++sequence, {fn, ms}); return sequence;}, clearTimeout: id => timers.delete(id)});
  await tick();
  return {state, calls, ports, timers, window, document: window.document,
    refresh: async () => {window.dispatchEvent(new window.Event('focus')); await tick();},
    emit: async event => {ports.at(-1).emit(event); await tick();}};
}
await test('toolbar is status-only and never reads, assesses or saves the active profile', async () => {
  const h = await open();
  assert.equal(h.document.querySelector('.account-state').textContent, 'Account connected');
  assert.equal(h.document.querySelector('.account a').textContent, 'Open Mighty');
  assert.equal(h.document.querySelector('.account a').getAttribute('href'), 'https://riteshmitsloan.github.io/mighty/');
  assert.equal(h.document.querySelectorAll('.goal-pill,.goal-fit,.profile-identity,.result,#save,#skip,input').length, 0);
  assert.doesNotMatch(h.document.body.textContent, /Private goal|profile|Save|Skip/);
  assert.deepEqual(h.calls.map(row => row.type), ['mighty:status']);
  assert.equal(h.document.querySelector('#retry').hidden, true);
});
await test('disconnected pairing preserves hosted paths and passes only the extension ID', async () => {
  const h = await open({connected: false}); const link = h.document.querySelector('.account a'), url = new URL(link.getAttribute('href'));
  assert.equal(h.document.querySelector('.account-state').textContent, 'Account not connected');
  assert.equal(link.textContent, 'Connect to Mighty'); assert.equal(url.pathname, '/mighty/'); assert.equal(url.hash, '#connect-extension');
  assert.deepEqual([...url.searchParams.entries()], [['mighty_extension', 'a'.repeat(32)]]);
  assert.equal(link.target, '_blank'); assert.equal(link.rel, 'noopener noreferrer');
  assert.equal(h.calls.some(row => row.type === 'mighty:connect'), false);
});
await test('localhost pairing stays on the configured development origin; invalid origins produce no link', async () => {
  const h = await open({connected: false, appOrigin: 'http://127.0.0.1:5173'});
  assert.equal(new URL(h.document.querySelector('.account a').getAttribute('href')).origin, 'http://127.0.0.1:5173');
  const invalid = await open({appOrigin: 'javascript:alert(1)'}); assert.equal(invalid.document.querySelector('a'), null);
});
await test('missing goals keep a verified account connected and Retry goals coalesces duplicate clicks', async () => {
  const h = await open({goalContext: null});
  assert.equal(h.document.querySelector('.account-state').textContent, 'Account connected');
  assert.match(h.document.querySelector('#notice').textContent, /goals could not load/);
  const pending = deferred(); h.state.wait = pending.promise;
  const retry = h.document.querySelector('#retry'); assert.equal(retry.textContent, 'Retry goals');
  retry.click(); retry.click(); await tick(); assert.equal(h.calls.length, 2); assert.equal(h.calls[1].refreshGoals, true);
  pending.resolve(); await tick(); assert.equal(retry.disabled, false);
});
await test('account changes invalidate an older response before updating connection status', async () => {
  const h = await open(), pending = deferred(); h.state.wait = pending.promise;
  void h.refresh(); await tick();
  h.state.wait = null; h.state.connected = false; h.state.goalContext = null;
  await h.emit({type: 'mighty:account_changed'});
  assert.equal(h.document.querySelector('.account-state').textContent, 'Account not connected');
  pending.resolve(); await tick(); assert.equal(h.document.querySelector('.account-state').textContent, 'Account not connected');
});
await test('page changes do not trigger profile work or extra account checks', async () => {
  const h = await open(); await h.emit({type: 'mighty:page_changed'});
  assert.equal(h.calls.length, 1); assert.equal(h.document.querySelector('.account-state').textContent, 'Account connected');
});
await test('synchronous failures and safe worker errors restore Retry without rendering HTML', async () => {
  const h = await open({failure: 'sync'}); assert.equal(h.document.querySelector('#retry').disabled, false);
  assert.match(h.document.querySelector('#notice').textContent, /Connection check failed/);
  h.state.failure = true; h.state.message = '<img src=x onerror=alert(1)> (panel_route_changed)';
  await h.refresh(); assert.equal(h.document.querySelector('#notice img'), null); assert.match(h.document.querySelector('#notice').textContent, /panel_route_changed/);
});
await test('disconnect clears connection immediately and closing cancels recovery', async () => {
  const h = await open(); h.ports[0].disconnect();
  assert.equal(h.document.querySelector('.account-state').textContent, 'Account not connected'); assert.equal(h.timers.size, 1);
  assert.equal([...h.timers.values()][0].ms, 100);
  h.window.dispatchEvent(new h.window.Event('unload')); assert.equal(h.timers.size, 0);
});
