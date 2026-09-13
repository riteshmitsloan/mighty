import {canonicalProfilePhotoUrl} from './profile-photo';

export type PartialProfileSnapshot = {
  profileUrl: string;
  name: string;
  photoUrl?: string;
  anchors: {kind: 'headline'; text: string; sourceUrl: string; observedAt: string}[];
  profileReadAt: null;
  truncated: false;
  truncationReasons: string[];
};

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function canonicalProfile(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/in\/([^/]+)\/$/);
    if (!match || url.origin !== 'https://www.linkedin.com' || url.username || url.password || url.search || url.hash) return false;
    const slug = decodeURIComponent(match[1]).normalize('NFC').toLowerCase();
    return /^[\p{L}\p{N}_-]{1,200}$/u.test(slug) && value === `https://www.linkedin.com/in/${encodeURIComponent(slug)}/`;
  } catch { return false; }
}

/** Validate a trusted parser snapshot's header, not arbitrary DOM identity.
 * The content caller must separately verify the currently rendered subject.
 * Lower sections are deliberately excluded and the original remains untouched. */
export function partialProfileProjection(value: unknown): PartialProfileSnapshot | null {
  if (!record(value) || !canonicalProfile(value.profileUrl) || typeof value.name !== 'string'
    || !value.name.trim() || value.name.length > 200 || value.profileReadAt !== null || value.truncated !== false
    || !Array.isArray(value.truncationReasons) || value.truncationReasons.length
    || !Array.isArray(value.anchors) || !value.anchors.every(record)
    || (value.source !== undefined && value.source !== 'rendered_profile')) return null;
  const headlines = value.anchors.filter(anchor => anchor.kind === 'headline');
  if (headlines.length !== 1) return null;
  const headline = headlines[0];
  if (typeof headline.text !== 'string' || !headline.text.trim()
    || headline.sourceUrl !== `${value.profileUrl}#profile`
    || typeof headline.observedAt !== 'string' || !Number.isFinite(Date.parse(headline.observedAt))
    || ['field', 'currentExperience', 'appliesTo', 'polarity', 'exclusive'].some(key => headline[key] !== undefined)) return null;
  const photo = value.photoUrl === undefined ? null : canonicalProfilePhotoUrl(value.photoUrl);
  if (value.photoUrl !== undefined && photo !== value.photoUrl) return null;
  try { if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 49_152) return null; }
  catch { return null; }
  return {profileUrl: value.profileUrl, name: value.name, ...(photo ? {photoUrl: photo} : {}),
    anchors: [{kind: 'headline', text: headline.text, sourceUrl: headline.sourceUrl, observedAt: headline.observedAt}],
    profileReadAt: null, truncated: false, truncationReasons: []};
}

/** Account readers additionally bind the saved source to the relationship URL. */
export function savedPartialProfile(value: unknown, profileUrl: string | null | undefined): (PartialProfileSnapshot & {source: 'rendered_profile'}) | null {
  if (!record(value) || value.source !== 'rendered_profile' || value.profileUrl !== profileUrl) return null;
  const partial = partialProfileProjection(value);
  return partial ? {...partial, source: 'rendered_profile'} : null;
}
