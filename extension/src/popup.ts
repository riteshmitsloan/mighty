import {compactProfile, COMPACT_PROFILE_CSS} from './compact-profile.js';
import {mightyAppLink} from './app-link.js';
import type {AccountGoalContext} from './goal-context.js';
import {initialSelection, toggleSelection} from './selection.js';
import type {PageSnapshot, Profile, SaveInput} from './types.js';

const body = document.querySelector('#content')!;
const account = document.querySelector('#account')!;
const notice = document.querySelector('#notice')! as HTMLElement;
const saveButton = document.querySelector('#save')! as HTMLButtonElement;
const selectionSummary = document.querySelector('#selection-summary')!;
let state: PageSnapshot | null = null;
let userId: string | null = null;
let goalContext: AccountGoalContext | null = null;
let refreshPending = false, goalRefreshPending = false, lastRefreshError = '';
let accountEpoch = 0;
let connected = false, selected = new Set<string>(), saving = false, readGeneration = 0;
const operations = new Map<string, SaveInput>();
let selectedGoalId: string | null = null;
const profileStyle = document.createElement('style'); profileStyle.textContent = COMPACT_PROFILE_CSS; document.head.append(profileStyle);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}

function readableError(message: string) {
  if (/snapshot size limit/i.test(message)) return 'This profile is too large to save. Its full context has not been saved.';
  if (/profile snapshot is invalid|evidence anchor is invalid/i.test(message)) return 'This profile could not be saved. Reopen it and try again.';
  if (/different account|account that owns this pending save/i.test(message)) return 'Reconnect the account you used for this save.';
  if (/prototype.*Supabase/i.test(message)) return 'This extension build is not connected to Mighty. Download a new copy from the app.';
  if (/save identifier already belongs/i.test(message)) return 'This save could not be retried. Reopen the profile and try again.';
  if (/handoff|bridge|protocol|origin is not allowed/i.test(message)) return 'Reconnect the extension from Mighty.';
  return message;
}

async function send(message: unknown) {
  try {
    const reply = await chrome.runtime.sendMessage(message);
    if (!reply?.ok) throw Error(reply?.message || 'Mighty did not respond. Reopen the extension.');
    return reply;
  } catch (error) {
    throw Error(readableError(error instanceof Error ? error.message : 'Mighty was reloaded. Close and reopen the extension.'));
  }
}

function report(message: string) {notice.textContent = message;}
function invalidateAccountView() {
  connected = false; goalContext = null;
  const label = account.querySelector('.account-state');
  if (label) {label.textContent = 'Account not connected'; label.classList.remove('connected');}
}

function updateSave() {
  saveButton.disabled = saving || !connected || !state || (state.kind === 'profile'
    ? !(state.profile?.profileReadAt || (state.profile?.truncated && state.profile.anchors.length))
    : state.kind === 'search' ? !selected.size : true);
  selectionSummary.textContent = state?.kind === 'search' && state.results.length
    ? `${selected.size} selected · ${state.results.length} visible` : '';
}

function pageNotice(snapshot: PageSnapshot) {
  if (snapshot.kind === 'unsupported') return 'Open a LinkedIn profile or people search.';
  if (snapshot.state === 'auth_required') return 'Sign in to LinkedIn in this tab, then reopen Mighty.';
  if (snapshot.state === 'blocked') return 'LinkedIn is limiting this page. Check for a verification or search limit before trying again.';
  if (snapshot.kind === 'search') {
    if (snapshot.state === 'ready') return '';
    if (snapshot.state === 'empty') return 'LinkedIn found no people for this search.';
    return 'No readable results yet. The page may still be loading or its layout may have changed.';
  }
  return snapshot.profile?.profileReadAt || snapshot.profile?.truncated ? '' : 'Wait for the profile sections to load, then reopen Mighty.';
}

function renderProfile(_profile: Profile) {
  body.append(compactProfile(document, {page: state, connected, userId, goalContext, selectedGoalId,
    onSelect: id => {selectedGoalId = id; render(); body.querySelector<HTMLButtonElement>('.goal-pill[aria-pressed="true"]')?.focus();}}));
  if (connected && !goalContext) {
    const retry = el('button', 'Try again', 'retry-goals'); retry.type = 'button';
    retry.addEventListener('click', () => void refresh(true)); body.append(retry);
  }
}

function renderSearch(snapshot: Extract<PageSnapshot, {kind: 'search'}>) {
  if (!snapshot.results.length) return;
  const intro = el('div', undefined, 'search-intro');
  intro.append(el('h1', 'People on this page'), el('p', 'Choose up to five people.', 'hint'));
  body.append(intro);
  const list = el('div', undefined, 'search-results');
  for (const result of snapshot.results) {
    const row = el('label', undefined, 'result');
    const check = el('input');
    check.type = 'checkbox';
    check.checked = selected.has(result.profileUrl);
    check.setAttribute('aria-label', 'Select ' + result.name);
    check.addEventListener('change', () => {
      const next = toggleSelection(selected, result.profileUrl, check.checked);
      selected = next.selected;
      check.checked = selected.has(result.profileUrl);
      report(next.message);
      updateSave();
    });
    const copy = el('div');
    const link = el('a', result.name);
    link.href = result.profileUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    copy.append(link);
    if (result.subtitle) copy.append(el('p', result.subtitle));
    if (result.truncated) copy.append(el('p', 'Search text is incomplete. Open the profile to read it.', 'warning'));
    row.append(check, copy);
    list.append(row);
  }
  body.append(list);
  const brief = el('details', undefined, 'brief-help');
  brief.append(el('summary', 'Why no brief yet?'), el('p', 'Search snippets are not profile reads. Open each profile with Mighty before requesting a brief.'));
  body.append(brief);
}

function render() {
  body.replaceChildren();
  body.setAttribute('aria-busy', String(!state));
  if (!state) {
    body.append(el('p', 'Reading this page…', 'hint'));
    updateSave();
    return;
  }
  const message = pageNotice(state);
  if (message) body.append(el('p', message, 'hint page-notice'));
  if (state.kind === 'profile' && state.profile) renderProfile(state.profile);
  if (state.kind === 'search') renderSearch(state);
  updateSave();
}

async function refresh(refreshGoals = false) {
  const generation = ++readGeneration;
  const previous = state;
  // A new page read must finish before the previous profile or selections can be saved.
  state = null;
  render();
  try {
    const [accountResult, pageResult] = await Promise.allSettled([send({type: 'mighty:status', refreshGoals}), send({type: 'mighty:read_active'})]);
    if (generation !== readGeneration) return;
    if (accountResult.status === 'rejected') throw accountResult.reason;
    const status = accountResult.value;
    if (userId !== status.userId) {accountEpoch++; operations.clear(); selected.clear(); selectedGoalId = null;}
    userId = status.userId;
    goalContext = status.connected ? status.goalContext ?? null : null;
    connected = status.connected;
    const readProblem = pageResult.status === 'rejected' ? 'This page could not be read. Refresh LinkedIn, then reopen Mighty.' : '';
    if (status.message || readProblem) {lastRefreshError = status.message || readProblem; report(lastRefreshError);}
    else {if (notice.textContent === lastRefreshError) report(''); lastRefreshError = '';}
    account.replaceChildren(el('span', connected ? 'Account connected' : 'Account not connected', `account-state ${connected ? 'connected' : ''}`));
    const link = el('a', connected ? 'Open Mighty' : 'Connect to Mighty');
    link.href = mightyAppLink(status.appOrigin, chrome.runtime.id, connected);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    account.append(link);
    if (pageResult.status === 'rejected') {
      state = {kind: 'unsupported', state: 'unknown', message: readProblem};
      selected.clear();
    } else state = pageResult.value.snapshot;
    if (state?.kind === 'search') {
      const changed = previous?.kind !== 'search' || previous.pageUrl !== state.pageUrl;
      if (changed) selected = initialSelection(state.results);
      else {
        const visible = new Set(state.results.map(result => result.profileUrl));
        selected = new Set([...selected].filter(url => visible.has(url)));
      }
    }
    render();
  } catch (error) {
    if (generation !== readGeneration) return;
    invalidateAccountView();
    state = null; selected.clear();
    render();
    body.setAttribute('aria-busy', 'false');
    lastRefreshError = (error as Error).message; report(lastRefreshError);
    updateSave();
  }
}

saveButton.addEventListener('click', async () => {
  if (!state || !connected || !userId) return;
  saving = true;
  updateSave();
  report('Saving…');
  const profiles: Profile[] = state.kind === 'profile' && state.profile ? [state.profile]
    : state.kind === 'search' ? state.results.filter(result => selected.has(result.profileUrl)).map(result => ({
      profileUrl: result.profileUrl, name: result.name, anchors: [], profileReadAt: null,
      truncated: result.truncated, truncationReasons: result.truncated ? ['search_text_limit'] : [],
    })) : [];
  const source = state.kind === 'profile' ? 'rendered_profile' : 'search_result';
  const owner = userId, saveEpoch = accountEpoch;
  const results = await Promise.allSettled(profiles.map(async profile => {
    const key = owner + '|' + profile.profileUrl + '|' + source;
    let request = operations.get(key);
    if (!request) {
      request = {operationId: crypto.randomUUID(), userId: owner, profile, source};
      operations.set(key, request);
    }
    await send({type: 'mighty:save', save: request});
    operations.delete(key);
    return profile.profileUrl;
  }));
  const saved = results.filter(result => result.status === 'fulfilled').length;
  for (const result of results) if (result.status === 'fulfilled') selected.delete(result.value);
  const failure = results.find(result => result.status === 'rejected') as PromiseRejectedResult | undefined;
  if (saveEpoch !== accountEpoch) report('');
  else report(failure ? (saved ? `${saved} saved. ` : '') + String(failure.reason?.message || 'A save is still pending.')
    : saved === 1 ? 'Saved. Open Mighty to view.' : `${saved} people saved. Open Mighty to view.`);
  saving = false;
  render();
  if (refreshPending) {refreshPending = false; const refreshGoals = goalRefreshPending; goalRefreshPending = false; void refresh(refreshGoals);}
});

document.querySelector('#skip')!.addEventListener('click', () => window.close());
let reconnect: ReturnType<typeof setTimeout> | undefined;
function connect() {
  try {
    const port = chrome.runtime.connect({name: 'mighty:popup'});
    port.onMessage.addListener(message => {
      if (message?.type === 'mighty:account_changed') {accountEpoch++; readGeneration++; invalidateAccountView(); render();}
      if (saving) refreshPending = true; else void refresh();
    });
    port.onDisconnect.addListener(() => {
      accountEpoch++; invalidateAccountView(); readGeneration++;
      render();
      clearTimeout(reconnect);
      reconnect = setTimeout(() => {connect(); void refresh();}, 100);
    });
  } catch {report('Mighty was reloaded. Reopen the extension.');}
}
addEventListener('focus', () => {if (saving) {refreshPending = true; goalRefreshPending = true;} else void refresh(true);});
connect();
void refresh(true);
