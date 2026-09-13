/** Raw visible provenance, not a declaration that every current role was captured. */
export type CurrentExperience = Readonly<{dateRange: string; entryText: string}>;
export const CURRENT_EXPERIENCE_LIMITS = Object.freeze({field: 200, range: 80, entry: 8_000});
const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const month = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const date = '(?:(?:19|20)\\d{2}-\\d{2}-\\d{2}|(?:'+month+'\\s+)?(?:19|20)\\d{2})';
const separator = '\\s*(?:[-–—]|to)\\s*';
export function currentExperienceDateRanges(text: string): string[] {
  return [...text.matchAll(new RegExp('(?<![\\w-])'+date+separator+'(?:'+date+'|Present|Current)(?![\\w-])','gi'))].map(match => match[0].trim());
}

/** An explicitly current range proves current context only; year precision never becomes a recent-start claim. */
export function validCurrentExperienceDate(range: string, observedAt: string): boolean {
  if (typeof range !== 'string' || range.length > CURRENT_EXPERIENCE_LIMITS.range || typeof observedAt !== 'string') return false;
  const observed = Date.parse(observedAt);
  if (!Number.isFinite(observed)) return false;
  const match = range.match(new RegExp('^('+date+')'+separator+'(?:Present|Current)$','i'));
  if (!match) return false;
  const start = match[1], exact = start.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  let instant: number;
  if (exact) {
    instant = Date.UTC(Number(exact[1]), Number(exact[2])-1, Number(exact[3]));
    const check = new Date(instant);
    if (check.getUTCFullYear() !== Number(exact[1]) || check.getUTCMonth() !== Number(exact[2])-1 || check.getUTCDate() !== Number(exact[3])) return false;
  } else {
    const named = start.match(new RegExp('^('+month+')\\s+((?:19|20)\\d{2})$','i'));
    instant = named ? Date.UTC(Number(named[2]), months.indexOf(named[1].slice(0,3).toLowerCase()), 1) : Date.UTC(Number(start), 0, 1);
  }
  return Number.isFinite(instant) && instant <= observed;
}

const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
/** Shared save/read boundary. Matching raw and timing anchors are required; metadata alone cannot promote a role. */
export function validCurrentExperienceAnchor(anchor: unknown, anchors: readonly unknown[], profileUrl: string, profileReadAt: string | null): boolean {
  const value = record(anchor);
  if (!value || value.kind !== 'experience' || !['role','company'].includes(String(value.field)) || typeof value.text !== 'string' || !value.text.trim() || value.text.length > CURRENT_EXPERIENCE_LIMITS.field) return false;
  if (!profileReadAt || !Number.isFinite(Date.parse(profileReadAt)) || value.observedAt !== profileReadAt || value.sourceUrl !== profileUrl+'#experience') return false;
  if (value.appliesTo !== undefined && value.appliesTo !== 'contact' || value.polarity !== undefined && value.polarity !== 'positive') return false;
  const current = record(value.currentExperience);
  if (!current || Object.keys(current).some(key => !['dateRange','entryText'].includes(key)) || typeof current.dateRange !== 'string' || typeof current.entryText !== 'string') return false;
  if (!current.entryText.trim() || current.entryText.length > CURRENT_EXPERIENCE_LIMITS.entry || !validCurrentExperienceDate(current.dateRange, profileReadAt) || !current.entryText.includes(value.text) || !current.entryText.includes(current.dateRange)) return false;
  const ranges = [...new Set(currentExperienceDateRanges(current.entryText))];
  if (ranges.length !== 1 || ranges[0] !== current.dateRange) return false;
  const sameSource = (other: Record<string,unknown> | null) => other && other.sourceUrl === value.sourceUrl && other.observedAt === profileReadAt && other.field === undefined && other.currentExperience === undefined;
  return anchors.some(other => {const raw=record(other); return sameSource(raw) && raw!.kind==='experience' && raw!.text===current.entryText;})
    && anchors.some(other => {const timing=record(other); return sameSource(timing) && timing!.kind==='timing' && timing!.text===current.dateRange;});
}
