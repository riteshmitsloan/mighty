import {assessCandidate, type CandidateAssessment} from '../../src/lib/assessment';
import {buildCandidateEvidence, type CandidateEvidence} from '../../src/lib/evidence';
import type {Goal} from '../../src/lib/goals';
import {validCurrentExperienceAnchor} from '../../src/lib/current-experience';
import {validateGoalContext, type AccountGoalContext} from './goal-context.js';
import {canRequestBrief} from './scoring.js';
import type {PageSnapshot, Profile} from './types.js';

/** Titles and outcomes are user context, not implicit, confirmed scoring criteria. */
export function hasGoalCriteria(goal: Goal): boolean {
  return goal.criteria.some(criterion => criterion.terms.some(term => /[\p{L}\p{N}]/u.test(term)));
}
function unreadReason(snapshot: PageSnapshot | null): string {
  if (snapshot?.kind === 'search') return 'Open the person’s profile. A search result does not contain enough profile evidence.';
  if (!snapshot || snapshot.kind !== 'profile') return 'Open a LinkedIn profile to read its visible sections.';
  if (snapshot.state === 'auth_required') return 'Sign in to LinkedIn in this tab so the profile can be read.';
  if (snapshot.state === 'blocked') return 'LinkedIn is limiting this profile read. Complete any verification in this tab.';
  if (snapshot.profile?.truncated) return 'The rendered profile exceeds the save limit. A shortened read is not used to judge fit.';
  if (snapshot.profile) return 'The name is available, but a complete section read is not. Scroll to About or Experience and let the visible sections load.';
  return 'The profile identity could not be verified in this layout. Let the page finish loading, then try again.';
}

/** Preserve every anchor as evidence. Free prose is never promoted to company/industry/opportunity fields. */
export function renderedCandidate(profile: Profile): CandidateEvidence {
  return buildCandidateEvidence({name: profile.name, url: profile.profileUrl, sourceKind: 'profile', sourceLabel: 'Rendered LinkedIn profile',
    profileReadAt: profile.profileReadAt, completeProfile: canRequestBrief(profile), observedAt: profile.profileReadAt ?? undefined,
    anchors: profile.anchors.map(anchor => ({...anchor,
      // Preserve raw text but refuse unsupported typed metadata before the shared engine sees it.
      field: anchor.field === undefined ? undefined : validCurrentExperienceAnchor(anchor, profile.anchors, profile.profileUrl, profile.profileReadAt) ? anchor.field : 'context',
      appliesTo: 'contact' as const}))});
}
export type ProfileGoalAssessment = {goal: Goal; assessment: CandidateAssessment};
export type GoalAssessmentResult = {state: 'ready'; candidate: CandidateEvidence; assessments: readonly ProfileGoalAssessment[]; contextKey: string}
  | {state: 'no_goals' | 'no_active_goals' | 'unread'; message: string};
/** No result cache: each account/goal version/profile change receives a fresh shared-core assessment. */
export function assessProfileGoals(userId: string, context: AccountGoalContext, snapshot: PageSnapshot | null): GoalAssessmentResult {
  const trusted = validateGoalContext(context, userId);
  if (!snapshot || snapshot.kind !== 'profile' || snapshot.state !== 'ready' || !canRequestBrief(snapshot.profile)) {
    return {state: 'unread', message: unreadReason(snapshot)};
  }
  if (!trusted.goals.length) return {state: 'no_goals', message: 'No goals are saved to this account. In Mighty, use Save goal to account to include a device draft here.'};
  const goals = trusted.goals.filter(goal => goal.status === 'active');
  if (!goals.length) return {state: 'no_active_goals', message: 'This account has no active saved goals. Activate and save a goal in Mighty.'};
  const candidate = renderedCandidate(snapshot.profile!);
  // This bounded extension does not copy private self sources; shared-employer routes therefore remain unavailable.
  return {state: 'ready', candidate, contextKey: trusted.key, assessments: goals.map(goal => ({goal, assessment: assessCandidate(goal, candidate, [])}))};
}
