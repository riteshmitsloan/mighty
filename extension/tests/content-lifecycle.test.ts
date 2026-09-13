import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {build} from 'esbuild';

const {parseHTML} = createRequire(import.meta.url)('linkedom');
const code = build({entryPoints: [new URL('../src/content.ts', import.meta.url).pathname], bundle: true, write: false, platform: 'browser', format: 'iife', target: 'chrome120'})
  .then(result => result.outputFiles[0].text);
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const url = (slug: string) => 'https://www.linkedin.com/in/' + slug + '/';
const topcard = (slug: string, action = '<button>Message</button>') => `<section aria-label="Primary content">
  <div componentkey="com.linkedin.sdui.profile.card.ref.fixtureTopcard"><section><div componentkey="ProfileVerificationTriggerRef-${slug}"><h2>Synthetic Person</h2></div>${action}</section></div>
  <section><h2>About</h2><p>Synthetic professional evidence.</p></section></section>`;

async function harness(initial = 'first-person', action?: string) {
  const document = parseHTML('<html><body><main>' + topcard(initial, action) + '</main></body></html>').document as Document;
  const location = {href: url(initial)}, listeners = new Map<string, Function>(), timers = new Map<number, {fn: Function; ms: number}>(), intervals = new Map<number, Function>();
  const observers: Observer[] = []; let next = 0;
  class Observer {
    target: Node | null = null; options: MutationObserverInit = {}; active = false;
    constructor(readonly callback: (records: MutationRecord[]) => void) {observers.push(this);}
    observe(target: Node, options: MutationObserverInit) {this.target = target; this.options = options; this.active = true;}
    disconnect() {this.active = false;}
  }
  const runtime = {id: 'a'.repeat(32), getURL: (path: string) => 'chrome-extension://' + 'a'.repeat(32) + '/' + path,
    onMessage: {addListener() {}, removeListener() {}}, connect() {return {onMessage: {addListener() {}}, onDisconnect: {addListener() {}}, disconnect() {}};},
    async sendMessage(message: {type: string}) {return message.type === 'mighty:status'
      ? {ok: true, connected: false, userId: null, goalContext: null, appOrigin: 'https://app.example.org/'} : {ok: true};}};
  const globals: Record<string, any> = {document, location, chrome: {runtime}, MutationObserver: Observer, URL, TextEncoder, structuredClone, crypto: globalThis.crypto,
    addEventListener: (name: string, fn: Function) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name),
    setTimeout: (fn: Function, ms: number) => {timers.set(++next, {fn, ms}); return next;}, clearTimeout: (id: number) => timers.delete(id),
    setInterval: (fn: Function) => {intervals.set(++next, fn); return next;}, clearInterval: (id: number) => intervals.delete(id)};
  const bundle = await code;
  const inject = async () => {runInNewContext(bundle, globals); await tick();};
  const emit = (record: MutationRecord) => {
    for (const observer of observers.filter(item => item.active)) {
      const {options, target} = observer;
      if (!target || (record.target !== target && !(options.subtree && target.contains(record.target)))) continue;
      if (record.type === 'attributes' && (!options.attributes || (options.attributeFilter && !options.attributeFilter.includes(record.attributeName!)))) continue;
      if (record.type === 'childList' && !options.childList || record.type === 'characterData' && !options.characterData) continue;
      observer.callback([record]);
    }
  };
  const attr = (target: Element, name: string, value: string) => {target.setAttribute(name, value); emit({type: 'attributes', target, attributeName: name, addedNodes: [], removedNodes: []} as unknown as MutationRecord);};
  const text = (target: Element, value: string) => {target.textContent = value; emit({type: 'childList', target, addedNodes: [...target.childNodes], removedNodes: []} as unknown as MutationRecord);};
  const flush = async () => {for (const [id, pending] of [...timers]) if (timers.has(id)) {timers.delete(id); pending.fn();} await tick();};
  const poll = () => {for (const fn of [...intervals.values()]) fn();};
  const count = () => document.querySelectorAll('#mighty-profile-panel').length;
  const subject = () => document.querySelector('[componentkey^="ProfileVerificationTriggerRef-"]')!;
  await inject();
  return {document, location, listeners, observers, intervals, inject, attr, text, flush, poll, count, subject,
    dispose() {globals.__mightyResearch?.dispose();}};
}

test('SPA navigation waits for the new subject marker and mounts after delayed attribute-only hydration', async () => {
  const h = await harness(); try {
    assert.equal(h.count(), 1);
    h.location.href = url('second-person'); h.poll(); assert.equal(h.count(), 0, 'The old subject must disappear as soon as the URL changes.');
    h.text(h.subject().querySelector('h2')!, 'Second Synthetic Person'); await h.flush();
    assert.equal(h.count(), 0, 'A changed name cannot substitute for the new subject marker.');
    h.attr(h.subject(), 'componentkey', 'ProfileVerificationTriggerRef-second-person'); await h.flush();
    assert.equal(h.count(), 1, 'A late identity-attribute update must retry the current profile without focus or reload.');
    h.poll(); await h.flush(); assert.equal(h.count(), 1);
  } finally {h.dispose();}
});

test('popstate back navigation and repeated worker reinjection never leave duplicate or stale panels', async () => {
  const h = await harness(); try {
    h.location.href = url('second-person'); h.listeners.get('popstate')!(); assert.equal(h.count(), 0);
    await h.inject(); assert.equal(h.count(), 0);
    h.attr(h.subject(), 'componentkey', 'ProfileVerificationTriggerRef-second-person'); await h.flush(); assert.equal(h.count(), 1);
    await h.inject(); assert.equal(h.count(), 1);
    h.location.href = url('first-person'); h.listeners.get('popstate')!(); assert.equal(h.count(), 0);
    h.attr(h.subject(), 'componentkey', 'ProfileVerificationTriggerRef-first-person'); await h.flush(); assert.equal(h.count(), 1);
    assert.equal(h.observers.filter(observer => observer.active).length, 1);
  } finally {h.dispose();}
});

test('a late subject top-card id and ownership href update trigger eligibility again', async () => {
  const h = await harness('first-person', '<a href="/messaging/compose/?screenContext=SELF_PROFILE_VIEW">Send</a>'); try {
    assert.equal(h.count(), 0);
    const card = h.document.querySelector('[componentkey="com.linkedin.sdui.profile.card.ref.fixtureTopcard"]')!;
    card.removeAttribute('componentkey');
    h.attr(card, 'id', 'pending-layout');
    const action = card.querySelector('a')!;
    h.attr(action, 'href', '/messaging/compose/?screenContext=NON_SELF_PROFILE_VIEW'); await h.flush(); assert.equal(h.count(), 0);
    h.attr(card, 'id', 'com.linkedin.sdui.profile.card.ref.fixtureTopcard'); await h.flush(); assert.equal(h.count(), 1);
    h.attr(action, 'href', url('first-person') + 'edit/intro/'); await h.flush(); assert.equal(h.count(), 0, 'A self-edit control must immediately remove automatic UI.');
  } finally {h.dispose();}
});

test('leaving a permitted route tears down reads; a later permitted-route injection starts afresh', async () => {
  const h = await harness(); try {
    h.location.href = 'https://www.linkedin.com/feed/'; h.poll();
    assert.equal(h.count(), 0); assert.equal(h.intervals.size, 0); assert.equal(h.observers.some(observer => observer.active), false);
    h.document.querySelector('main')!.innerHTML = '<article>Feed content</article>';
    await h.inject(); assert.equal(h.count(), 0); assert.equal(h.observers.some(observer => observer.active), false);
    h.location.href = url('second-person'); h.document.querySelector('main')!.innerHTML = topcard('second-person');
    await h.inject(); assert.equal(h.count(), 1); assert.equal(h.observers.filter(observer => observer.active).length, 1);
  } finally {h.dispose();}
});
