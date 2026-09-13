import {compactProfile, COMPACT_PROFILE_CSS, element} from './compact-profile.js';
import {mightyAppLink} from './app-link.js';
import {snapshot} from './profile.js';
import {canonicalProfileURL} from './urls.js';
import {initialSelection, toggleSelection} from './selection.js';
import type {AccountGoalContext} from './goal-context.js';
import type {PageSnapshot, Profile, SaveInput} from './types.js';

type PanelRuntime = Pick<typeof chrome.runtime, 'id' | 'getURL' | 'sendMessage' | 'connect' | 'lastError'>;
type Account = {connected: boolean; userId: string | null; goalContext: AccountGoalContext | null; appOrigin: string; message?: string};
export interface ProfilePanelOptions {
  document: Document; runtime: PanelRuntime; url: () => string;
  read?: (document: Document, url: string) => PageSnapshot;
}
export function supportedPanelURL(url: string) {return Boolean(canonicalProfileURL(url));}
/** Own renders must never trigger another LinkedIn read. Shadow-tree mutations do not cross this boundary. */
export function relevantPageMutation(records: readonly MutationRecord[], host: HTMLElement) {
  return records.some(record => {
    if (record.target === host || host.contains(record.target)) return false;
    if (record.type !== 'childList') return true;
    return [...record.addedNodes, ...record.removedNodes].some(node => node !== host && !host.contains(node));
  });
}
function contentKey(page: PageSnapshot) {
  return JSON.stringify(page, (key, value) => ['observedAt', 'profileReadAt'].includes(key) ? undefined : value);
}
function profileSaveable(profile: Profile | null) {
  return Boolean(profile && !profile.truncationReasons.includes('snapshot_size_limit')
    && (profile.profileReadAt || (profile.truncated && profile.anchors.length)));
}
export function createProfilePanel(options: ProfilePanelOptions) {
  const {document: doc, runtime} = options;
  const host = doc.createElement('aside'); host.id = 'mighty-profile-panel';
  const shadow = host.attachShadow({mode: 'closed'});
  const style = doc.createElement('style'); style.textContent = panelStyles(runtime.getURL('assets/mighty-ui.woff2')) + COMPACT_PROFILE_CSS;
  const surface = element(doc, 'section', '', 'surface'); surface.setAttribute('aria-label', 'Mighty networking assistant');
  shadow.append(style, surface); doc.documentElement.append(host);
  let disposed = false, page: PageSnapshot | null = null, pageKey = '', route = '', selectedGoalId: string | null = null;
  let account: Account = {connected: false, userId: null, goalContext: null, appOrigin: ''};
  let checking = true, accountGeneration = 0, accountEpoch = 0, saving = false, notice = '';
  let minimized = false, skippedRoute = '', selected = new Set<string>();
  let port: chrome.runtime.Port | undefined, reconnect: ReturnType<typeof setTimeout> | undefined, reconnectAttempts = 0;
  const operations = new Map<string, SaveInput>(), savedKeys = new Set<string>();
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '') => element(doc, tag, text, cls);
  const profile = () => page?.kind === 'profile' ? page.profile : null;
  const pageSaved = () => page?.kind === 'profile' && savedKeys.has(account.userId + '|' + page.profile?.profileUrl + '|' + pageKey);
  function brand() {
    const box = el('span', '', 'brand'); const mark = el('span', '', 'brand-mark'); mark.setAttribute('aria-hidden', 'true');
    mark.append(el('span'), el('span')); box.append(mark, el('strong', 'Mighty')); return box;
  }
  function appLink(text: string, connect = !account.connected) {
    if (!account.appOrigin) return null;
    try {const link = el('a', text, 'app-link'); link.href = mightyAppLink(account.appOrigin, runtime.id, !connect); link.target = '_blank'; link.rel = 'noopener noreferrer'; return link;} catch {return null;}
  }
  function render() {
    if (disposed) return;
    host.hidden = !supportedPanelURL(options.url()); if (host.hidden) return;
    const active = shadow.activeElement as HTMLElement | null;
    const focusKey = active?.dataset.focus;
    surface.replaceChildren();
    if (minimized || skippedRoute === route) {
      surface.className = 'surface collapsed';
      const reopen = el('button', '', 'reopen'); reopen.type = 'button'; reopen.setAttribute('aria-label', 'Open Mighty panel');
      reopen.append(brand(), el('span', 'Open', 'reopen-label'));
      reopen.addEventListener('click', () => {minimized = false; skippedRoute = ''; render(); (surface.querySelector('.minimize') as HTMLButtonElement)?.focus();});
      surface.append(reopen); return;
    }
    surface.className = 'surface';
    const header = el('header'); const minimize = el('button', '−', 'minimize'); minimize.type = 'button';
    minimize.dataset.focus = 'minimize'; minimize.title = 'Minimize Mighty'; minimize.setAttribute('aria-label', 'Minimize Mighty');
    minimize.addEventListener('click', () => {minimized = true; render(); (surface.querySelector('.reopen') as HTMLButtonElement)?.focus();});
    header.append(brand(), minimize); surface.append(header);
    const status = el('div', '', 'account');
    status.append(el('span', checking ? 'Checking account…' : account.connected ? 'Account connected' : 'Account not connected', 'account-state' + (account.connected ? ' connected' : '')));
    const link = appLink(account.connected ? 'Open Mighty' : 'Connect to Mighty'); if (link) status.append(link);
    surface.append(status);
    const main = el('div', '', 'content'); main.setAttribute('aria-busy', String(!page));
    if (page?.kind === 'search') renderSearch(main, page);
    else main.append(compactProfile(doc, {page, connected: account.connected, userId: account.userId, goalContext: account.goalContext, selectedGoalId,
      onSelect: id => {selectedGoalId = id; render(); (surface.querySelector('.goal-pill[aria-pressed="true"]') as HTMLButtonElement)?.focus();}}));
    if (!page) main.append(el('p', 'Reading this profile…', 'hint'));
    if (page && page.state === 'blocked') main.append(el('p', 'LinkedIn is limiting this page. Check for a verification request.', 'hint'));
    if (page && page.state === 'auth_required') main.append(el('p', 'Sign in to LinkedIn to read this profile.', 'hint'));
    if (account.connected && !account.goalContext && !checking) {
      const retry = el('button', 'Try again', 'retry'); retry.type = 'button'; retry.dataset.focus = 'retry';
      retry.addEventListener('click', () => void refreshAccount(true)); main.append(retry);
    }
    if (account.message || notice) {const message = el('p', notice || account.message || '', 'notice'); message.setAttribute('role', 'status'); main.append(message);}
    if (pageSaved()) {const view = appLink('View in Mighty', false); if (view) main.append(view);}
    surface.append(main);
    const footer = el('footer'); const skip = el('button', 'Skip', 'skip'); skip.type = 'button'; skip.dataset.focus = 'skip';
    skip.addEventListener('click', () => {skippedRoute = route; render(); (surface.querySelector('.reopen') as HTMLButtonElement)?.focus();});
    const save = el('button', saving ? 'Saving…' : pageSaved() ? 'Saved to Mighty' : 'Save to Mighty', 'save'); save.type = 'button'; save.dataset.focus = 'save';
    save.disabled = saving || checking || !account.connected || !account.userId || !page
      || (page.kind === 'profile' ? !profileSaveable(page.profile) || Boolean(pageSaved()) : page.kind === 'search' ? !selected.size : true);
    save.addEventListener('click', () => void saveSelected()); footer.append(skip, save); surface.append(footer);
    if (focusKey) (surface.querySelector(`[data-focus="${focusKey}"]`) as HTMLElement)?.focus();
  }
  function renderSearch(main: HTMLElement, current: Extract<PageSnapshot, {kind: 'search'}>) {
    main.append(el('h1', 'People on this page'), el('p', 'Choose up to five. Open a profile to assess it against your goals.', 'hint'));
    const rows = el('div', '', 'search-results');
    for (const person of current.results) {
      const row = el('label', '', 'result'); const box = doc.createElement('input'); box.type = 'checkbox'; box.checked = selected.has(person.profileUrl); box.disabled = saving;
      box.setAttribute('aria-label', 'Select ' + person.name);
      box.addEventListener('change', () => {const result = toggleSelection(selected, person.profileUrl, box.checked); selected = result.selected; notice = result.message; render();});
      const copy = el('span'); const name = el('a', person.name); name.href = person.profileUrl; name.target = '_blank'; name.rel = 'noopener noreferrer';
      copy.append(name); if (person.subtitle) copy.append(el('p', person.subtitle)); row.append(box, copy); rows.append(row);
    }
    main.append(rows);
    if (current.state === 'empty') main.append(el('p', 'LinkedIn found no people for this search.', 'hint'));
    else if (current.state === 'unknown') main.append(el('p', 'No readable results yet.', 'hint'));
  }
  async function send(message: unknown) {
    const reply = await runtime.sendMessage(message); if (!reply?.ok) throw Error(reply?.message || 'Mighty could not complete this request. Try again.'); return reply;
  }
  async function refreshAccount(refreshGoals = false) {
    const ticket = ++accountGeneration; checking = true; render();
    try {
      const result: Account = await send({type: 'mighty:status', refreshGoals});
      if (disposed || ticket !== accountGeneration) return;
      if (account.userId !== result.userId) {accountEpoch++; selectedGoalId = null; operations.clear(); savedKeys.clear();}
      account = {connected: result.connected === true, userId: result.userId || null, goalContext: result.connected ? result.goalContext || null : null, appOrigin: result.appOrigin, message: result.message};
    } catch (error) {
      if (disposed || ticket !== accountGeneration) return;
      accountEpoch++; account = {...account, connected: false, userId: null, goalContext: null, message: error instanceof Error ? error.message : 'Reconnect from Mighty.'}; selectedGoalId = null;
    } finally {if (!disposed && ticket === accountGeneration) {checking = false; render();}}
  }
  async function saveSelected() {
    if (saving || checking || !account.connected || !account.userId || !page) return;
    if (page.kind === 'profile' && (!profileSaveable(page.profile) || pageSaved())) return;
    const source = page.kind === 'profile' ? 'rendered_profile' : 'search_result';
    const profiles: Profile[] = page.kind === 'profile' && page.profile ? [page.profile] : page.kind === 'search' ? page.results.filter(row => selected.has(row.profileUrl)).map(row => ({profileUrl: row.profileUrl, name: row.name, photoUrl: row.photoUrl, anchors: [], profileReadAt: null, truncated: row.truncated, truncationReasons: row.truncated ? ['search_text_limit'] : []})) : [];
    if (!profiles.length) return;
    const owner = account.userId, epoch = accountEpoch, savedRoute = route, snapshotKey = pageKey;
    saving = true; notice = ''; render();
    const results = await Promise.allSettled(profiles.map(async item => {
      const key = owner + '|' + item.profileUrl + '|' + source + '|' + contentKey({kind: 'profile', state: 'ready', profile: item, message: ''});
      let request = operations.get(key);
      if (!request) {request = {operationId: crypto.randomUUID(), userId: owner, source, profile: structuredClone(item)}; operations.set(key, request);}
      await send({type: 'mighty:save', save: request}); operations.delete(key); return item.profileUrl;
    }));
    saving = false;
    if (disposed || epoch !== accountEpoch || savedRoute !== route) {if (!disposed) render(); return;}
    const count = results.filter(row => row.status === 'fulfilled').length;
    for (const row of results) if (row.status === 'fulfilled') {selected.delete(row.value); savedKeys.add(owner + '|' + row.value + '|' + snapshotKey);}
    const failure = results.find(row => row.status === 'rejected');
    notice = failure?.status === 'rejected' ? (count ? `${count} saved. ` : '') + (failure.reason instanceof Error ? failure.reason.message : 'That save did not finish. Try again.') : count === 1 ? 'Saved to Relationships.' : `${count} people saved to Relationships.`;
    render();
  }
  function readPage() {
    if (disposed) return;
    const current = options.url();
    if (!supportedPanelURL(current)) {host.hidden = true; page = null; pageKey = ''; accountGeneration++; port?.disconnect(); port = undefined; return;}
    const nextRoute = canonicalProfileURL(current) || current;
    const changed = route !== nextRoute;
    if (changed) {route = nextRoute; page = null; pageKey = ''; notice = ''; selected.clear();}
    try {
      const next = (options.read || snapshot)(doc, current); const key = contentKey(next);
      if (key !== pageKey) {
        const previous = page; page = next; pageKey = key;
        if (next.kind === 'search') {
          if (changed || previous?.kind !== 'search') selected = initialSelection(next.results);
          else {const urls = new Set(next.results.map(row => row.profileUrl)); selected = new Set([...selected].filter(url => urls.has(url)));}
        }
        render();
        void runtime.sendMessage({type: 'mighty:page_changed'}).catch(() => {});
      } else if (host.hidden) render();
    } catch {page = null; pageKey = ''; notice = 'This profile could not be read. Refresh LinkedIn and try again.'; render();}
    if (changed) {connect(); void refreshAccount(true);}
  }
  function connect() {
    if (disposed || port || !supportedPanelURL(options.url())) return;
    try {
      port = runtime.connect({name: 'mighty:panel'});
      port.onMessage.addListener(message => {
        if (message?.type === 'mighty:ready' && message.protocol === 1) {reconnectAttempts = 0; return;}
        if (message?.type !== 'mighty:account_changed') return;
        accountGeneration++; accountEpoch++; account = {...account, connected: false, goalContext: null}; selectedGoalId = null;
        render(); void refreshAccount();
      });
      port.onDisconnect.addListener(() => {
        void runtime.lastError; port = undefined; if (disposed || !supportedPanelURL(options.url())) return;
        accountGeneration++; accountEpoch++; account = {...account, connected: false, userId: null, goalContext: null}; render();
        clearTimeout(reconnect);
        if (++reconnectAttempts > 8) {notice = 'Mighty could not reconnect. Refresh this page to try again.'; render(); return;}
        reconnect = setTimeout(() => {connect(); void refreshAccount(true);}, Math.min(1000, reconnectAttempts * 100));
      });
    } catch {account = {...account, connected: false, goalContext: null}; notice = 'Mighty was reloaded. Refresh this page to reconnect.'; render();}
  }
  readPage();
  return {host, shadow, readPage, refreshAccount, dispose() {disposed = true; accountGeneration++; accountEpoch++; clearTimeout(reconnect); port?.disconnect(); host.remove();}};
}

function panelStyles(font: string) {return `
@font-face{font-family:'Schibsted Grotesk';src:url('${font}') format('woff2');font-weight:100 900;font-display:swap}
:host{all:initial;position:fixed;z-index:2147483646;right:22px;bottom:24px;width:min(370px,calc(100vw - 24px));font:14px 'Schibsted Grotesk',system-ui,sans-serif;color:#1D1B26;color-scheme:light}:host([hidden]){display:none!important}
*{box-sizing:border-box}button,input{font:inherit}button,a,input{-webkit-tap-highlight-color:transparent}:focus-visible{outline:2px solid #4A3FD1;outline-offset:3px}button{cursor:pointer}button:disabled{opacity:.42;cursor:not-allowed}a{color:#4A3FD1;text-decoration:none}a:hover{text-decoration:underline}p{margin:0;overflow-wrap:anywhere}h1{font-size:21px;line-height:1.3;margin:0 0 12px}
.surface{background:#FBFAF8;border:1px solid #DED8E9;border-radius:22px;box-shadow:0 12px 38px #30204B24;overflow:hidden;max-height:min(650px,calc(100vh - 48px));display:flex;flex-direction:column}
header{padding:18px 20px 12px;display:flex;align-items:center;justify-content:space-between;flex:none}.brand{display:flex;align-items:center;gap:10px}.brand strong{font-size:19px;font-weight:800;letter-spacing:-.3px}.brand-mark{position:relative;width:31px;height:22px;display:block;isolation:isolate}.brand-mark>span{position:absolute;width:22px;height:22px;border-radius:50%;background:#4A3FD1;left:0;top:0}.brand-mark>span+span{left:9px;background:#E87A56;mix-blend-mode:multiply}
.minimize{border:0;background:transparent;font-size:22px;color:#6C6575;width:36px;height:36px;border-radius:50%;padding:0}.minimize:hover{background:#EFEDFD}.account{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 20px 16px;font-size:11px;flex:none}.account-state{color:#6C6575;display:flex;align-items:center;gap:6px}.account-state:before{content:'';width:6px;height:6px;border-radius:50%;background:#AAA4B1}.account-state.connected:before{background:#4A3FD1}.app-link{font-size:12px;font-weight:650}.content{padding:0 20px 20px;overflow:auto;min-height:0;scrollbar-width:thin}.hint,.notice{font-size:12px;line-height:1.6;color:#6C6575;margin-top:12px}.notice{margin-top:15px}.retry{border:0;background:transparent;color:#4A3FD1;padding:8px 0;font-weight:650}.content>.app-link{display:inline-block;margin-top:10px}
footer{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:18px 20px;border-top:1px solid #E8E2EB;background:white;flex:none}footer button{border:1px solid #DDD6E3;border-radius:28px;min-height:49px;font-size:13px;font-weight:650;background:white;color:#423B50;padding:10px 8px}.save{background:#4A3FD1;border-color:#4A3FD1;color:white}footer button:hover:not(:disabled){filter:brightness(.97)}.collapsed{border-radius:28px;width:180px;margin-left:auto}.reopen{display:flex;align-items:center;justify-content:space-between;width:100%;gap:15px;border:0;background:#FBFAF8;padding:13px 17px}.reopen-label{color:#6C6575;font-size:11px}.reopen .brand strong{font-size:15px}.reopen .brand-mark{transform:scale(.8);margin-right:-4px}
.search-results{margin-top:13px}.result{display:flex;gap:10px;padding:12px 0;border-bottom:1px solid #E8E2EB}.result input{width:17px;height:17px;accent-color:#4A3FD1;flex:none;margin:2px 0}.result a{font-size:13px;font-weight:650}.result p{font-size:12px;line-height:1.5;color:#6C6575;margin-top:4px}
@media(max-width:600px){:host{right:12px;bottom:12px}.surface{max-height:65vh}}@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;}
