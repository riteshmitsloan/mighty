import type {Person} from './data-access';
import {buildCandidateEvidence, createEvidenceClaim, type EvidenceAnchor} from './evidence';
import {validCurrentExperienceAnchor} from './current-experience';
import {deepFreeze} from './text';
import {savedPartialProfile} from './partial-profile';

function verifiedProfileRead(person: Person, readAt: string | null): boolean {
  const profile = person.profile;
  return Boolean(profile && profile.source === 'rendered_profile' && profile.truncated === false
    && Object.hasOwn(profile, 'profileReadAt') && readAt
    && person.profile_url && profile.profileUrl === person.profile_url);
}
function newerProfileRead(person: Person, readAt: string | null): boolean {
  const savedAt = Date.parse(person.created_at);
  return verifiedProfileRead(person, readAt) && Number.isFinite(savedAt) && Date.parse(readAt!) > savedAt;
}

/** Preserve the extension's source timestamp and every anchor when opening a saved person. */
export function buildSavedPersonEvidence(person: Person) {
  const profile: Record<string, unknown> | undefined = savedPartialProfile(person.profile, person.profile_url) ?? person.profile;
  const anchors = Array.isArray(profile?.anchors) ? profile.anchors.filter((value): value is EvidenceAnchor =>
    Boolean(value && typeof value === 'object' && typeof value.text === 'string' && typeof value.kind === 'string')) : [];
  // An explicit null means no complete read; legacy dates are only a fallback for older records.
  const date = profile && Object.hasOwn(profile, 'profileReadAt') ? profile.profileReadAt
    : profile?.observedAt ?? person.context.profile_read_at;
  const profileReadAt = typeof date === 'string' && Number.isFinite(Date.parse(date)) ? date : null;
  const currentRead = verifiedProfileRead(person, profileReadAt);
  const current = currentRead ? anchors.filter(anchor => validCurrentExperienceAnchor(anchor, anchors, person.profile_url!, profileReadAt)) : [];
  const verified = new Set(current);
  // This is a rendered-profile boundary, like the extension adapter. Explicit
  // manual observations enter separately; arbitrary typed profile metadata is context.
  const safeAnchors = anchors.map(anchor => ({...anchor,
    field: anchor.field === undefined ? undefined : verified.has(anchor) ? anchor.field : 'context' as const,
    appliesTo: 'contact' as const}));
  const candidate = buildCandidateEvidence({id: person.id, person: person.person, profile_url: person.profile_url,
    company: typeof person.context.company === 'string' ? person.context.company : '',
    position: typeof person.context.position === 'string' ? person.context.position : '',
    sourceLabel: 'Saved person record', sourceKind: person.context.source === 'web_search' ? 'web' : 'record',
    anchors: safeAnchors, completeProfile: Boolean(profile && profile.truncated !== true), profileReadAt});

  // A partial, older or unidentified read cannot retire a saved fact. Legacy timestamp
  // fallbacks remain useful context, but do not establish this replacement boundary.
  if (!candidate.completeProfile) return candidate;

  const mayRetire = newerProfileRead(person, profileReadAt);
  const replaced = new Set(mayRetire ? current.map(anchor => anchor.field) : []);

  const claims = candidate.claims.map(item => {
    if (item.sourceLabel !== 'Saved person record' || !replaced.has(item.field)
      || !['role', 'company'].includes(item.field)) return item;
    const {id: _id, ...previous} = item;
    return createEvidenceClaim({...previous, field: 'context', observedAt: person.created_at,
      sourceLabel: `Previously saved ${item.field}`});
  });
  // Every current company remains a separate claim. A single display field must
  // never choose an arbitrary primary employer from multiple current entries.
  const companies = [...new Set(current.filter(anchor => anchor.field === 'company').map(anchor => anchor.text))];
  const company = companies.length && (mayRetire || !candidate.company)
    ? companies.length === 1 ? companies[0] : '' : candidate.company;
  if (!replaced.size && company === candidate.company) return candidate;
  return deepFreeze({...candidate, claims,
    company});
}

/** A display headline never creates a role claim or combines unrelated current jobs. */
export function savedPersonHeadline(person: Person): string {
  const fallback = [person.context.position, person.context.company]
    .filter(value => typeof value === 'string' && value).join(' · ')
    || (typeof person.context.searchHeadline === 'string' ? person.context.searchHeadline : '');
  const partial = savedPartialProfile(person.profile, person.profile_url);
  if (partial) return fallback || partial.anchors[0].text;
  const candidate = buildSavedPersonEvidence(person);
  // First-time extension saves are inserted after the profile was read. With no
  // older display value to replace, validated source details can fill the blank.
  if (!candidate.completeProfile || !verifiedProfileRead(person, candidate.profileReadAt)
    || (fallback && !newerProfileRead(person, candidate.profileReadAt))) return fallback;
  const headlines = [...new Set(candidate.claims.filter(item => item.sourceKind === 'profile'
    && item.sourceLabel === 'Rendered profile · headline' && item.sourceRef === `${person.profile_url}#profile`
    && item.observedAt === candidate.profileReadAt && item.polarity !== 'negative').map(item => item.text))];
  if (headlines.length === 1) return headlines[0];

  const anchors = person.profile!.anchors as readonly EvidenceAnchor[];
  const current = anchors.filter(anchor => validCurrentExperienceAnchor(anchor, anchors, person.profile_url!, candidate.profileReadAt));
  const entries = new Set(current.map(anchor => anchor.currentExperience!.entryText));
  if (entries.size > 1) return 'Current profile details available';
  const roles = [...new Set(current.filter(anchor => anchor.field === 'role').map(anchor => anchor.text))];
  const companies = [...new Set(current.filter(anchor => anchor.field === 'company').map(anchor => anchor.text))];
  if (roles.length > 1 || companies.length > 1) return 'Current profile details available';
  return [...roles, ...companies].join(' · ') || fallback;
}
