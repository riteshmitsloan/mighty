import type {Person} from './data-access';
import {buildCandidateEvidence, type EvidenceAnchor} from './evidence';

/** Preserve the extension's source timestamp and every anchor when opening a saved person. */
export function buildSavedPersonEvidence(person: Person) {
  const profile = person.profile;
  const anchors = Array.isArray(profile?.anchors) ? profile.anchors.filter((value): value is EvidenceAnchor =>
    Boolean(value && typeof value === 'object' && typeof value.text === 'string' && typeof value.kind === 'string')) : [];
  // An explicit null means no complete read; legacy dates are only a fallback for older records.
  const date = profile && Object.hasOwn(profile, 'profileReadAt') ? profile.profileReadAt
    : profile?.observedAt ?? person.context.profile_read_at;
  const profileReadAt = typeof date === 'string' && Number.isFinite(Date.parse(date)) ? date : null;
  return buildCandidateEvidence({id: person.id, person: person.person, profile_url: person.profile_url,
    company: typeof person.context.company === 'string' ? person.context.company : '',
    position: typeof person.context.position === 'string' ? person.context.position : '',
    sourceLabel: 'Saved person record', sourceKind: person.context.source === 'web_search' ? 'web' : 'record',
    anchors, completeProfile: Boolean(profile && profile.truncated !== true), profileReadAt});
}
