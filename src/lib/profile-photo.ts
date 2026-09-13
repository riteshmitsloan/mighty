/** LinkedIn's public profile-photo CDN only. Keep its signed query intact. */
export function canonicalProfilePhotoUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4_000 || /[\s\\\u0000-\u001f\u007f]/u.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash
      || !['media.licdn.com', 'media-exp1.licdn.com', 'media-exp2.licdn.com'].includes(url.hostname)) return null;
    if (!/^\/dms\/image\/(?:v2\/)?[A-Za-z0-9_-]+\/profile-displayphoto-(?:shrink|scale|crop)_\d{1,4}_\d{1,4}\/[A-Za-z0-9_./-]+$/.test(url.pathname)) return null;
    const keys = [...url.searchParams.keys()];
    if (new Set(keys).size !== keys.length || keys.some(key => !['e', 'v', 't'].includes(key))) return null;
    if (url.searchParams.has('e') && !/^\d{1,20}$/.test(url.searchParams.get('e')!)) return null;
    if (url.searchParams.has('v') && !/^[A-Za-z0-9_-]{1,32}$/.test(url.searchParams.get('v')!)) return null;
    if (url.searchParams.has('t') && !/^[A-Za-z0-9_+\/=.-]{1,2000}$/.test(url.searchParams.get('t')!)) return null;
    return url.href;
  } catch { return null; }
}

export function snapshotPhotoUrl(snapshot: unknown, profileUrl: string | null | undefined): string | null {
  if (!profileUrl || !snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const value = snapshot as Record<string, unknown>;
  return value.profileUrl === profileUrl && ['rendered_profile', 'search_result'].includes(String(value.source))
    ? canonicalProfilePhotoUrl(value.photoUrl) : null;
}

/** A derived photo may come from an earlier valid read when the latest has none. */
export function personPhotoUrl(person: {photoUrl?: unknown; profile_url?: string | null; profile?: unknown; context?: Record<string, unknown>}): string | null {
  return canonicalProfilePhotoUrl(person.photoUrl) || snapshotPhotoUrl(person.profile, person.profile_url)
    || snapshotPhotoUrl(person.context?.profile, person.profile_url) || canonicalProfilePhotoUrl(person.context?.photoUrl);
}
