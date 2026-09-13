import {assessCandidate, phraseTokens, type CandidateAssessment} from '../../src/lib/assessment';
import type {CandidateEvidence} from '../../src/lib/evidence';
import type {Goal} from '../../src/lib/goals';
import {canonicalProfilePhotoUrl} from '../../src/lib/profile-photo';
import type {SelfEvidenceContext} from '../../src/lib/extension-self-context';
import {summarizeProfileActivity} from '../../src/lib/profile-activity';
import type {AccountGoalContext} from './goal-context.js';
import {assessProfileGoals, hasGoalCriteria} from './goal-assessment.js';
import type {PageSnapshot, Profile} from './types.js';

export function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, text = '', className = '') {
  const node = doc.createElement(tag); node.textContent = text; node.className = className; return node;
}
export type CompactFit = {label: 'Strong potential' | 'Possible fit' | 'Low fit' | 'No clear connection yet' | 'Not enough information' | 'Add goal details'; tone: 'strong' | 'possible' | 'low' | 'unknown'; reason: string};
// A broad list of people who might help can produce a "peer" route for Founder.
// That is less specific than matching the actual target role. This affects only
// the initial goal display, never a criterion, route, label or ordering score.
const broadHelperRoles = new Set(['founder', 'cofounder', 'co founder', 'ceo', 'chief executive officer', 'vp', 'vice president', 'svp', 'evp', 'senior vice president', 'executive vice president', 'director', 'executive', 'senior leader']);
function specificPeer(goal: Goal, assessment: CandidateAssessment, candidate: CandidateEvidence) {
  if (!assessment.contactRoutes.some(route => route.kind === 'peer')) return false;
  const opportunity = goal.criteria.filter(row => row.field === 'role' && row.appliesTo === 'opportunity' && row.terms.some(term => term.trim()));
  const contact = goal.criteria.filter(row => row.field === 'role' && row.appliesTo === 'contact');
  const terms = contact.flatMap(row => row.terms);
  const criteria = opportunity.length ? opportunity : contact.map(row => ({...row, terms: row.terms.filter(term => terms.length === 1 || !broadHelperRoles.has(phraseTokens(term).join(' ')))})).filter(row => row.terms.length);
  // Reuse the same reviewed aliases, exclusions and negation rules, with only
  // the specific role criteria. This result is not persisted or shown as a score.
  return criteria.length > 0 && assessCandidate({...goal, criteria}, candidate).contactRoutes.some(route => route.kind === 'peer');
}
function contactReason(assessment: CandidateAssessment): string | undefined {
  const route = assessment.contactRoutes[0];
  if (!route) return undefined;
  const source = route.provisional ? 'Their headline describes' : 'Their profile shows';
  switch (route.kind) {
    case 'investor': return `${source} an investor role. Explore whether your venture fits their investment focus.`;
    case 'hiring_signal': return 'Their headline mentions hiring. Ask whether they know of opportunities aligned with your goal.';
    case 'recruiter': return `${source} a recruiting role. They may know relevant openings or people to approach.`;
    case 'executive_hiring': case 'senior_contact': return `${source} a senior leadership role. They may offer a useful introduction or perspective on hiring.`;
    case 'peer': return `${source} experience in your target role. They may offer advice or introduce you to relevant people.`;
    case 'introducer': return 'You have an employer in common. That gives you a starting point for a conversation or introduction.';
  }
}
function missingGoalDetails(): CompactFit {
  return {label: 'Add goal details', tone: 'unknown', reason: 'Tell Mighty who you want to meet, then save your goal. Your profile preferences will help narrow the fit.'};
}
export function compactFit(assessment: CandidateAssessment, goal?: Goal): CompactFit {
  if (goal ? !hasGoalCriteria(goal) : !assessment.criteria.length) {
    const route = assessment.contactRoutes[0];
    return route ? {label: 'Possible fit', tone: 'possible', reason: contactReason(assessment) || route.reason} : missingGoalDetails();
  }
  const reason = assessment.reasons[0] || 'This profile does not yet establish relevance to this goal.';
  if (assessment.status === 'conflicting') return {label: 'Not enough information', tone: 'unknown', reason: 'The available facts conflict. Review this person in Mighty.'};
  if (assessment.status === 'contradicted') return {label: 'Low fit', tone: 'low', reason: assessment.criteria.find(row => row.status === 'contradicted' && row.importance === 'required' && row.origin === 'user')?.reason || reason};
  if (assessment.status === 'unknown') {
    // A person's profile is assessed for a useful conversation, not proof of an
    // available job or investment mandate. Missing facts remain in the full assessment.
    const focus = goal?.kind === 'career' ? 'a relevant hiring, leadership or peer connection'
      : goal?.kind === 'fundraising' ? 'an investor connection' : 'a clear connection';
    return {label: 'No clear connection yet', tone: 'unknown',
      reason: `Mighty hasn't found ${focus} to this goal in the available profile. Save if you know more about them.`};
  }
  // A contact's relevance and proof of an available opportunity are separate.
  // Blank saved placeholders are unanswered questions, not unmet preferences.
  const defined = goal ? new Set(goal.criteria.filter(row => row.terms.some(term => /[\p{L}\p{N}]/u.test(term))).map(row => row.id)) : null;
  const criteria = assessment.criteria.filter(row => !defined || defined.has(row.criterionId));
  const contact = criteria.filter(row => row.appliesTo === 'contact');
  const userContact = contact.filter(row => row.origin === 'user');
  // Supporting role evidence comes from the shared field/scope validator. A
  // provisional headline route never supports a role criterion by itself.
  const strong = userContact.some(row => row.field === 'role' && row.status === 'supported' && row.supportingClaimIds.length > 0)
    && userContact.every(row => row.status === 'supported')
    && contact.filter(row => row.importance === 'required').every(row => row.status === 'supported')
    && !criteria.some(row => row.status === 'contradicted' || row.status === 'conflicting');
  const explanation = contactReason(assessment) || reason;
  const opportunityUnknown = criteria.some(row => row.appliesTo === 'opportunity' && row.status === 'unknown');
  const caveat = strong && opportunityUnknown && goal?.kind === 'career' ? ' A matching opening is not confirmed.' : '';
  return {label: strong ? 'Strong potential' : 'Possible fit', tone: strong ? 'strong' : 'possible', reason: explanation + caveat};
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
  selfContext?: SelfEvidenceContext | null;
  selectedGoalId: string | null; onSelect: (id: string) => void;
}
export function compactProfile(doc: Document, options: CompactProfileOptions): HTMLElement {
  const section = element(doc, 'section', '', 'compact-profile');
  const profile = options.page?.kind === 'profile' ? options.page.profile : null;
  if (profile) section.append(profileIdentity(doc, profile));
  if (!options.connected) {section.append(element(doc, 'p', 'Connect Mighty to use your saved goals.', 'hint')); return section;}
  if (!options.userId || !options.goalContext) {section.append(element(doc, 'p', 'Your saved goals are unavailable. Try again.', 'hint')); return section;}
  try {
    const result = assessProfileGoals(options.userId, options.goalContext, options.page, options.selfContext);
    const goals = options.goalContext.goals.filter(goal => goal.status === 'active');
    if (!goals.length) {
      section.append(element(doc, 'p', options.goalContext.goals.length ? 'Activate a saved goal in Mighty.' : 'Save a goal to your account in Mighty.', 'hint')); return section;
    }
    const fits = new Map(result.state === 'ready' ? result.assessments.map(row => {
      const fit: CompactFit = result.basis === 'headline' && hasGoalCriteria(row.goal) && !row.assessment.contactRoutes.length
        ? {label: 'Not enough information', tone: 'unknown', reason: 'Only their headline is available so far. More profile context may show a connection to this goal.'}
        : compactFit(row.assessment, row.goal);
      return [row.goal.id, fit] as const;
    }) : []);
    // Compare the displayed tier, then supported contact criteria, then whether
    // the route directly addresses this goal. Never compare raw ranks across goals.
    const priority = (goal: Goal) => {
      const assessment = result.state === 'ready' ? result.assessments.find(row => row.goal.id === goal.id)?.assessment : undefined;
      const tone = fits.get(goal.id)?.tone;
      return [tone === 'strong' ? 2 : tone === 'possible' ? 1 : 0,
        assessment?.criteria.filter(row => row.appliesTo === 'contact' && row.status === 'supported').length ?? 0,
        assessment && (assessment.contactRoutes.some(route => ['investor', 'recruiter', 'hiring_signal'].includes(route.kind))
          || (result.state === 'ready' && specificPeer(goal, assessment, result.candidate))) ? 2
          : assessment?.contactRoutes.some(route => ['peer', 'executive_hiring', 'senior_contact'].includes(route.kind)) ? 1 : 0];
    };
    const better = (goal: Goal, best: Goal) => {
      const next = priority(goal), current = priority(best);
      const difference = next.findIndex((value, index) => value !== current[index]);
      return difference >= 0 && next[difference] > current[difference];
    };
    // A deliberate selection stays in place while this profile finishes loading.
    const selected = goals.find(goal => goal.id === options.selectedGoalId)
      ?? goals.reduce((best, goal) => better(goal, best) ? goal : best, goals[0]);
    const pills = element(doc, 'div', '', 'goal-pills'); pills.setAttribute('role', 'group'); pills.setAttribute('aria-label', 'Choose a goal');
    for (const goal of goals) {
      const button = element(doc, 'button', goal.title, 'goal-pill'); button.type = 'button'; button.title = goal.title;
      button.setAttribute('aria-label', goal.title); button.setAttribute('aria-pressed', String(goal.id === selected.id));
      button.addEventListener('click', () => options.onSelect(goal.id)); pills.append(button);
    }
    section.append(pills);
    const assessment = result.state === 'ready' ? result.assessments.find(row => row.goal.id === selected.id)?.assessment : null;
    const fit: CompactFit = fits.get(selected.id) ?? (!hasGoalCriteria(selected) ? missingGoalDetails()
      : {label: 'Not enough information', tone: 'unknown', reason: result.state === 'unread' ? result.message : 'The saved goal could not be assessed. Try loading it again.'});
    const card = element(doc, 'div', '', 'goal-fit'); card.dataset.goalId = selected.id; card.dataset.goalVersion = String(selected.version);
    const label = element(doc, 'p', fit.label, 'fit-label'); label.dataset.fit = fit.tone;
    card.append(label, element(doc, 'p', concise(fit.reason), 'reason')); section.append(card);
    const topic = assessment?.sharedContext?.[0];
    if (topic) {
      const common = element(doc, 'div', '', 'shared-topic');
      common.append(element(doc, 'span', 'Talk about', 'topic-label'), element(doc, 'p', concise(topic.text)));
      section.append(common);
    }
    const activity = summarizeProfileActivity(profile);
    if (activity.state === 'observed') {
      const signal = element(doc, 'span', activity.label, 'activity-signal');
      signal.title = activity.detail; section.append(signal);
    }
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
.shared-topic{border-left:2px solid #E87A56;padding:0 0 0 11px;margin-top:17px;font-size:12px;line-height:1.5;color:#403B49}.topic-label{display:block;color:#8A563F;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;margin-bottom:3px}.shared-topic p{margin:0}.activity-signal{display:inline-flex;margin-top:15px;gap:6px;align-items:center;font-size:10px;color:#5B6860}.activity-signal:before{content:'';width:5px;height:5px;border-radius:50%;background:#6C927A}
`;
