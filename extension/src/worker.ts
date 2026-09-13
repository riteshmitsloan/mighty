import {config, configured} from './config.js';
import {AccountConnectionError, accountFailure} from './account-errors.js';
import {createAccountSession} from './account-session.js';
import {loadAccountGoals} from './goal-context.js';
import {inboxPayload, isExternalSender, matchingPending, parseExternalMessage, pendingKey, sessionFromVerifiedToken, validSession, validateSave} from './messaging.js';
import {canonicalProfileURL, isSearchURL} from './urls.js';
import {startToolbar} from './toolbar.js';
import type {PageSnapshot, PendingSave, SaveInput, Session} from './types.js';

const setup = Promise.all([chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}), chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'})]);
const ports = new Set<chrome.runtime.Port>(), inFlight = new Map<string, Promise<void>>();
let toolbar: ReturnType<typeof startToolbar> | undefined;
const accounts = createAccountSession({
  async read() {await setup; return (await chrome.storage.session.get('account')).account || null;},
  async write(value) {await setup; if (value) await chrome.storage.session.set({account:value}); else await chrome.storage.session.remove('account');},
}, broadcast);
const session = accounts.current;
toolbar = startToolbar(session);
const headers = (s: Session) => ({apikey:config.publishableKey, Authorization:'Bearer ' + s.accessToken, 'Content-Type':'application/json'});
class WorkerRequestError extends Error {}
function checkedSave(value: unknown, owner: Session): SaveInput {
  try {return validateSave(value, owner);} catch {throw new WorkerRequestError('The captured profile is incomplete or invalid. Read the current profile and try again.');}
}
const refreshGoals = (previous: Session) => loadAccountGoals(previous, config).then(goalContext => ({...previous, goalContext}));
function status(s: Session | null, includeGoals = false) {
  const current = validSession(s) ? s : null;
  return {connected:Boolean(current), userId:current?.userId || null, goalCount:current?.goalContext?.goals.length ?? 0,
    ...(includeGoals ? {goalContext:current?.goalContext ?? null} : {}),
    message:accounts.message() || (current && !current.goalContext ? 'Your account is connected. Goals are unavailable; retry goals to load your saved account goals.' : ''),
    ...(accounts.code() ? {code:accounts.code()} : {}), configured:configured(), appOrigin:config.appOrigins[0]};
}
function broadcast() {
  void toolbar?.refresh();
  for (const port of ports) {try {port.postMessage({type:'mighty:account_changed'});} catch {ports.delete(port);}}
}
/** These capabilities belong to the trusted popup or an isolated top-frame content script only. */
function popupSender(sender: chrome.runtime.MessageSender) {
  return sender.id === chrome.runtime.id && !sender.tab && sender.url === chrome.runtime.getURL('popup.html');
}
function pageScope(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['www.linkedin.com','linkedin.com'].includes(url.hostname) || url.port || url.username || url.password) return null;
    const profile = canonicalProfileURL(value); if (profile) return 'profile:' + profile;
    if (!isSearchURL(value)) return null;
    url.hash = ''; return 'search:' + url.href;
  } catch {return null;}
}
function panelSender(sender: chrome.runtime.MessageSender): boolean {
  const scope = pageScope(sender.url);
  return sender.id === chrome.runtime.id && sender.frameId === 0 && Number.isInteger(sender.tab?.id) && sender.tab!.id! >= 0 &&
    Boolean(scope && scope === pageScope(sender.tab?.url)) &&
    (!sender.origin || sender.origin === new URL(sender.url!).origin) &&
    (!sender.documentLifecycle || sender.documentLifecycle === 'active');
}
async function currentPanel(sender: chrome.runtime.MessageSender) {
  if (!panelSender(sender)) throw new WorkerRequestError('Open a supported LinkedIn profile or people search before using Mighty.');
  let tab: chrome.tabs.Tab;
  try {tab = await chrome.tabs.get(sender.tab!.id!);} catch {throw new WorkerRequestError('This LinkedIn tab is no longer available.');}
  if (pageScope(tab.url) !== pageScope(sender.url)) throw new WorkerRequestError('The page changed. Read the current profile before saving.');
}
function bindSaveToPage(save: SaveInput, sender: chrome.runtime.MessageSender) {
  const scope = pageScope(sender.url);
  if (save.source === 'rendered_profile' ? scope !== 'profile:' + save.profile.profileUrl : !scope?.startsWith('search:')) {
    throw new WorkerRequestError('This snapshot does not belong to the current LinkedIn page. Read the current page before saving.');
  }
}
async function verifiedHandoff(accessToken: string): Promise<Session> {
  if (!configured()) throw new AccountConnectionError('not_configured');
  let response: Response;
  try {response = await fetch(config.supabaseUrl + '/auth/v1/user', {headers:{apikey:config.publishableKey, Authorization:'Bearer ' + accessToken}, signal:AbortSignal.timeout(10000)});}
  catch {throw new AccountConnectionError('verification_unavailable');}
  if (!response.ok) throw new AccountConnectionError([401,403].includes(response.status) ? 'verification_rejected' : 'verification_failed');
  let user: unknown; try {user = await response.json();} catch {throw new AccountConnectionError('verification_unreadable');}
  if (!user || typeof user !== 'object' || Array.isArray(user) || !('id' in user) || typeof user.id !== 'string' || !(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(user.id))) throw new AccountConnectionError('verification_invalid');
  // Commit verification independently. A later goal failure cannot undo valid authentication.
  return sessionFromVerifiedToken(accessToken, user.id, config.supabaseUrl);
}
async function deliver(save: PendingSave, previous: Session) {
  const current = await session();
  if (!validSession(current) || current.userId !== previous.userId || save.userId !== previous.userId) throw new WorkerRequestError('Reconnect the account that owns this pending save.');
  const s = current; checkedSave(save, s);
  const key = pendingKey(save), existing = inFlight.get(key); if (existing) return existing;
  const job = (async () => {
    const response = await fetch(config.supabaseUrl + '/rest/v1/outreach_inbox?on_conflict=user_id,operation_id', {method:'POST', headers:{...headers(s), Prefer:'resolution=ignore-duplicates,return=representation'}, body:JSON.stringify(inboxPayload(save)), signal:AbortSignal.timeout(15000)});
    if (!response.ok) {
      if (response.status === 401) await accounts.invalidate(s);
      throw new WorkerRequestError(response.status === 401 ? 'Your session expired. Reconnect in the app.' : response.status === 403 ? 'This account cannot save right now.' : 'The save is still pending. Try again when the app connection is available.');
    }
    // A duplicate operation acknowledges the same immutable, account-pinned save.
    await chrome.storage.local.remove(key);
  })();
  inFlight.set(key, job); try {await job;} finally {inFlight.delete(key);}
}
async function flush(s: Session) {
  const all = await chrome.storage.local.get(null);
  const pending = matchingPending(Object.entries(all).filter(([key]) => key.startsWith('pending:')).map(([,value]) => value as PendingSave), s);
  for (let offset = 0; offset < pending.length; offset += 4) await Promise.allSettled(pending.slice(offset, offset + 4).map(row => deliver(row, s)));
}
async function readActive(): Promise<PageSnapshot> {
  const [tab] = await chrome.tabs.query({active:true, currentWindow:true});
  if (tab?.id === undefined || !pageScope(tab.url)) return {kind:'unsupported', state:'unknown', message:'Open a LinkedIn profile or people search in the active tab.'};
  try {return await chrome.tabs.sendMessage(tab.id, {type:'mighty:read'});} catch {
    const current = await chrome.tabs.get(tab.id);
    if (pageScope(current.url) !== pageScope(tab.url)) return {kind:'unsupported', state:'unknown', message:'The active page changed. Reopen Mighty on the current profile.'};
    await chrome.scripting.executeScript({target:{tabId:tab.id}, files:['content.js']});
    return await chrome.tabs.sendMessage(tab.id, {type:'mighty:read'});
  }
}
chrome.runtime.onMessageExternal.addListener((message, sender, respond) => {
  if (!isExternalSender(sender, config.appOrigins)) {respond({ok:false, message:'This origin is not allowed.'}); return;}
  void (async () => {
    await setup; const parsed = parseExternalMessage(message);
    if (parsed.type === 'status') return {ok:true, ...status(await session())};
    if (parsed.type === 'disconnect') {await accounts.disconnect(); return {ok:true};}
    const s = await accounts.connect(() => verifiedHandoff(parsed.accessToken), refreshGoals);
    if (s) void flush(s);
    return {ok:Boolean(s), ...status(s)};
  })().then(respond).catch(error => respond({ok:false, ...accountFailure(error)})); return true;
});
chrome.runtime.onConnect.addListener(port => {
  const sender = port.sender || {};
  const popup = port.name === 'mighty:popup' && popupSender(sender);
  const panel = port.name === 'mighty:panel' && panelSender(sender);
  if (!popup && !panel) {port.disconnect(); return;}
  let closed = false;
  port.onDisconnect.addListener(() => {closed = true; ports.delete(port);});
  if (popup) ports.add(port);
  else void currentPanel(sender).then(() => {if (!closed) {ports.add(port); port.postMessage({type:'mighty:ready', protocol:1});}}).catch(() => port.disconnect());
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const popup = popupSender(sender), panel = panelSender(sender);
  if (!popup && !panel) return;
  if (message?.type === 'mighty:page_changed') {
    if (panel) void currentPanel(sender).then(() => {for (const port of ports) {try {port.postMessage({type:'mighty:page_changed', tabId:sender.tab!.id});} catch {ports.delete(port);}}}).catch(() => {});
    return;
  }
  if (panel && !['mighty:status','mighty:save'].includes(message?.type)) return;
  void (async () => {
    await setup; if (panel) await currentPanel(sender);
    if (message?.type === 'mighty:status') {
      const s = message.refreshGoals === true ? await accounts.refresh(refreshGoals) : await session();
      // A goal refresh may outlast a route change. Do not disclose goals to the departed route.
      if (panel) await currentPanel(sender);
      return {ok:true, ...status(s, true)};
    }
    if (message?.type === 'mighty:read_active') return {ok:true, snapshot:await readActive()};
    if (message?.type === 'mighty:save') {
      const s = await session(); if (!validSession(s)) throw new WorkerRequestError('Connect your account in the app before saving.');
      const save = checkedSave(message.save, s); if (panel) bindSaveToPage(save, sender);
      const key = pendingKey(save), old = (await chrome.storage.local.get(key))[key] as PendingSave | undefined;
      if (old && JSON.stringify(inboxPayload(old)) !== JSON.stringify(inboxPayload(save))) throw new WorkerRequestError('This save identifier already belongs to a different snapshot.');
      if (panel) await currentPanel(sender);
      const queued: PendingSave = old || {...save, queuedAt:new Date().toISOString()};
      await chrome.storage.local.set({[key]:queued}); await deliver(queued, s);
      return {ok:true, operationId:save.operationId};
    }
    throw new WorkerRequestError('Unsupported extension request.');
  })().then(respond).catch((error: unknown) => respond(error instanceof WorkerRequestError ? {ok:false, message:error.message} : message?.type === 'mighty:status' ? {ok:false, ...accountFailure(error)} : {ok:false, message:'The save could not be completed. Try again when the app connection is available.'})); return true;
});
// LinkedIn can navigate from its feed into an already permitted route without a document reload.
// Inject only on the existing profile/search scope; never execute in feed, inbox, or other pages.
chrome.tabs.onUpdated?.addListener((tabId, change) => {
  const target = pageScope(change.url); if (!target) return;
  void chrome.tabs.get(tabId).then(tab => {
    if (pageScope(tab.url) === target) return chrome.scripting.executeScript({target:{tabId}, files:['content.js']});
  }).catch(() => {});
});
chrome.runtime.onConnectExternal.addListener(port => {
  if (port.name !== 'mighty:bridge' || !isExternalSender(port.sender || {}, config.appOrigins)) {port.disconnect(); return;}
  port.postMessage({type:'mighty:ready', protocol:1});
});
