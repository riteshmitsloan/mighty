import type {CandidateAssessment} from '../../src/lib/assessment';
import {canonicalProfilePhotoUrl} from '../../src/lib/profile-photo';
import type {AccountGoalContext} from './goal-context.js';
import {assessProfileGoals} from './goal-assessment.js';
import type {PageSnapshot, Profile} from './types.js';

export function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, text = '', className = '') {
  const node = doc.createElement(tag); node.textContent = text; node.className = className; return node;
}
export type CompactFit = {label: 'Strong potential' | 'Possible fit' | 'Low fit' | 'Not enough information'; tone: 'strong' | 'possible' | 'low' | 'unknown'; reason: string};
export function compactFit(assessment: CandidateAssessment): CompactFit {
  const reason = assessment.reasons[0] || 'This profile does not yet establish relevance to this goal.';
  if (assessment.status === 'conflicting') return {label: 'Not enough information', tone: 'unknown', reason: 'The available facts conflict. Review this person in Mighty.'};
  if (assessment.status === 'contradicted') return {label: 'Low fit', tone: 'low', reason: assessment.criteria.find(row => row.status === 'contradicted' && row.importance === 'required' && row.origin === 'user')?.reason || reason};
  if (assessment.status === 'unknown') return {label: 'Not enough information', tone: 'unknown', reason};
  const userCriteria = assessment.criteria.filter(row => row.origin === 'user');
  const strong = assessment.status === 'supported' && userCriteria.length >= 2
    && userCriteria.every(row => row.status === 'supported')
    && userCriteria.some(row => ['role', 'industry', 'stage', 'check_size'].includes(row.field))
    && assessment.criteria.every(row => row.status === 'supported');
  return {label: strong ? 'Strong potential' : 'Possible fit', tone: strong ? 'strong' : 'possible', reason};
}
function concise(value: string) {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length <= 230 ? clean : clean.slice(0, 220).replace(/\s+\S*$/, '') + '…';
}
export function profileIdentity(doc: Document, profile: Profile) {
  const row = element(doc, 'div', '', 'profile-identity');
  const initials = profile.name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  const avatar = element(doc, 'span', initials, 'profile-avatar'); avatar.setAttribute('aria-hidden', 'true');
  const photo = canonicalProfilePhotoUrl(profile.photoUrl);
  if (photo) {
    const image = doc.createElement('img'); image.src = photo; image.alt = ''; image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => avatar.replaceChildren(doc.createTextNode(initials)), {once: true});
    avatar.replaceChildren(image);
  }
  row.append(avatar, element(doc, 'h1', profile.name)); return row;
}
export interface CompactProfileOptions {
  page: PageSnapshot | null; connected: boolean; userId: string | null; goalContext: AccountGoalContext | null;
  selectedGoalId: string | null; onSelect: (id: string) => void;
}
export function compactProfile(doc: Document, options: CompactProfileOptions): HTMLElement {
  const section = element(doc, 'section', '', 'compact-profile');
  const profile = options.page?.kind === 'profile' ? options.page.profile : null;
  if (profile) section.append(profileIdentity(doc, profile));
  if (!options.connected) {section.append(element(doc, 'p', 'Connect Mighty to use your saved goals.', 'hint')); return section;}
  if (!options.userId || !options.goalContext) {section.append(element(doc, 'p', 'Your saved goals are unavailable. Try again.', 'hint')); return section;}
  try {
    const result = assessProfileGoals(options.userId, options.goalContext, options.page);
    const goals = options.goalContext.goals.filter(goal => goal.status === 'active');
    if (!goals.length) {
      section.append(element(doc, 'p', options.goalContext.goals.length ? 'Activate a saved goal in Mighty.' : 'Save a goal to your account in Mighty.', 'hint')); return section;
    }
    const selected = goals.find(goal => goal.id === options.selectedGoalId) ?? goals[0];
    const pills = element(doc, 'div', '', 'goal-pills'); pills.setAttribute('role', 'group'); pills.setAttribute('aria-label', 'Choose a goal');
    for (const goal of goals) {
      const button = element(doc, 'button', goal.title, 'goal-pill'); button.type = 'button'; button.title = goal.title;
      button.setAttribute('aria-label', goal.title); button.setAttribute('aria-pressed', String(goal.id === selected.id));
      button.addEventListener('click', () => options.onSelect(goal.id)); pills.append(button);
    }
    section.append(pills);
    const assessment = result.state === 'ready' ? result.assessments.find(row => row.goal.id === selected.id)?.assessment : null;
    const fit = assessment ? compactFit(assessment) : {label: 'Not enough information', tone: 'unknown', reason: 'The visible profile does not yet contain enough information for this goal.'};
    const card = element(doc, 'div', '', 'goal-fit'); card.dataset.goalId = selected.id; card.dataset.goalVersion = String(selected.version);
    const label = element(doc, 'p', fit.label, 'fit-label'); label.dataset.fit = fit.tone;
    card.append(label, element(doc, 'p', concise(fit.reason), 'reason')); section.append(card);
  } catch {section.append(element(doc, 'p', 'Saved goals could not be verified. Reconnect from Mighty.', 'hint'));}
  return section;
}

/** Shared by the popup and isolated on-page panel. Evidence remains in the saved snapshot. */
export const COMPACT_PROFILE_CSS = `
.compact-profile{color:#1D1B26}.profile-identity{display:flex;align-items:center;gap:13px;margin:5px 0 18px}
.profile-identity h1{font-size:21px;line-height:1.25;font-weight:750;letter-spacing:-.5px;margin:0;overflow-wrap:anywhere}
.profile-avatar{width:53px;height:53px;flex:none;display:grid;place-items:center;border-radius:50%;overflow:hidden;background:#EFEDFD;color:#4A3FD1;font-size:18px;font-weight:650}
.profile-avatar img{width:100%;height:100%;object-fit:cover}.goal-pills{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;max-height:152px;overflow:auto}
.goal-pill{width:100%;min-width:0;min-height:43px;border:1px solid #E5DFEA;border-radius:24px;padding:10px 9px;background:white;color:#6C6575;font-size:12px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.goal-pill[aria-pressed=true]{background:#EFEDFD;border-color:#CCC3F8;color:#4A3FD1;box-shadow:0 0 0 2px #4A3FD10A}
.compact-profile .goal-fit{padding:0;margin:23px 0 0;border:0;border-radius:0;background:none}
.compact-profile .fit-label{display:block;margin:0;padding:0;background:none;color:#4A3FD1;font-size:23px;line-height:1.25;font-weight:750;letter-spacing:-.5px}
.compact-profile .fit-label[data-fit=unknown]{background:none;color:#6C6575;font-weight:550}.compact-profile .fit-label[data-fit=low]{background:none;color:#836341}
.compact-profile .reason{font-size:14px;line-height:1.65;color:#403B49;margin:10px 0 0}.compact-profile .hint{font-size:13px;line-height:1.6;color:#6C6575;margin:12px 0 0}
`;
