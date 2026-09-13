import {assessProfileGoals} from './goal-assessment.js';
import {mightyAppLink} from './app-link.js';
import type {AccountGoalContext} from './goal-context.js';
import {initialSelection, toggleSelection} from './selection.js';
import type {AnchorKind, PageSnapshot, Profile, SaveInput} from './types.js';

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
const sectionLabels: Record<AnchorKind, string> = {
  headline: 'Headline', location: 'Location', about: 'About', experience: 'Experience',
  education: 'Education', skills: 'Skills', languages: 'Languages', certifications: 'Licenses & certifications',
  activity: 'Activity', timing: 'Timing',
};

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

function anchorText(text: string) {
  // Only generated display labels change. Stored evidence and dates remain intact.
  return text.replace(/^Rendered activity timestamp:/, 'Activity date:')
    .replace(/^Recent rendered activity:/, 'Recent activity:');
}

function renderGoalAssessments() {
  const section = el('section', undefined, 'account-goals');
  section.append(el('h2', 'Account goals'));
  if (!connected || !userId || !goalContext) {
    section.append(el('p', 'Reconnect from Mighty to load your saved goals. No previous account context is used.', 'hint'));
    body.append(section); return;
  }
  try {
    const result = assessProfileGoals(userId, goalContext, state);
    if (result.state !== 'ready') {section.append(el('p', result.message, 'hint')); body.append(section); return;}
    section.append(el('p', 'Profile evidence only. Self evidence and shared-employer routes aren’t included.', 'hint'));
    for (const [index, {goal, assessment}] of result.assessments.entries()) {
      const card = el('details', undefined, 'goal-fit');
      card.open = index === 0;
      card.dataset.goalId = goal.id;
      card.dataset.goalVersion = String(goal.version);
      card.append(el('summary', goal.title));
      card.append(el('p', `Saved version ${goal.version}`, 'hint goal-version'));
      for (const reason of assessment.reasons) card.append(el('p', reason, 'reason'));
      if (!assessment.reasons.length) card.append(el('p', 'The visible evidence does not yet establish this goal’s criteria.', 'reason'));
      const label = el('span', assessment.label, 'fit-label');
      label.dataset.fit = assessment.status === 'unknown' ? 'insufficient' : assessment.status === 'contradicted' || assessment.status === 'conflicting' ? 'none' : 'overlap';
      card.append(label);
      if (assessment.unknowns.length) {
        card.append(el('h3', 'Still unknown'));
        const unknowns = el('ul', undefined, 'goal-unknowns');
        for (const unknown of assessment.unknowns) unknowns.append(el('li', unknown));
        card.append(unknowns);
      }
      const evidenceIds = new Set(assessment.reasonDetails.flatMap(reason => reason.claimIds));
      const evidence = result.candidate.claims.filter(claim => evidenceIds.has(claim.id));
      if (evidence.length) {
        const sources = el('details', undefined, 'assessment-sources');
        sources.append(el('summary', 'Supporting source text'));
        for (const claim of evidence) {
          const fact = el('div');
          fact.append(el('p', claim.text));
          const source = el('a', claim.sourceLabel);
          source.href = claim.sourceRef!; source.target = '_blank'; source.rel = 'noopener noreferrer';
          fact.append(source, el('p', `Observed ${claim.observedAt}`, 'hint'));
          sources.append(fact);
        }
        card.append(sources);
      }
      section.append(card);
    }
  } catch {section.replaceChildren(el('p', 'Saved goals could not be verified. Reconnect from Mighty to refresh them.', 'warning'));}
  body.append(section);
}

function renderProfile(profile: Profile) {
  body.append(el('h1', profile.name));
  const headline = profile.anchors.find(anchor => anchor.kind === 'headline');
  if (headline) body.append(el('p', headline.text, 'profile-headline'));

  renderGoalAssessments();

  if (profile.truncated) body.append(el('p', 'This read exceeds the save limit. Its full context cannot be saved.', 'warning'));
  const timing = profile.anchors.filter(anchor => anchor.kind === 'timing');
  const timingCard = el('section', undefined, 'evidence-section');
  timingCard.append(el('h2', 'Timing'));
  if (timing.length) for (const anchor of timing) timingCard.append(el('p', anchorText(anchor.text)));
  else timingCard.append(el('p', 'No visible activity dates or role timing.', 'hint'));
  body.append(timingCard);

  const groups = new Map<AnchorKind, string[]>();
  for (const anchor of profile.anchors) {
    if (anchor.kind === 'timing' || anchor === headline) continue;
    const texts = groups.get(anchor.kind) || [];
    texts.push(anchor.text);
    groups.set(anchor.kind, texts);
  }
  for (const [kind, texts] of groups) {
    const section = el('section', undefined, 'evidence-section');
    section.append(el('h2', sectionLabels[kind]));
    for (const text of texts) section.append(el('p', text));
    body.append(section);
  }
  if (profile.missingSections?.length) {
    const missing = el('details', undefined, 'missing-sections');
    missing.append(el('summary', 'Not visible in this read'), el('p', profile.missingSections.map(kind => sectionLabels[kind]).join(', ') + '.'));
    body.append(missing);
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
    if (userId !== status.userId) {accountEpoch++; operations.clear(); selected.clear();}
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
