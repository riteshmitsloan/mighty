import {evidenceKey, type EvidenceClaim} from './evidence';
import {deepFreeze} from './text';

/** A small, expiring profile projection, never a source-file or message transfer. */
export type SelfEvidenceContext = Readonly<{
  schemaVersion: 1; userId: string; capturedAt: number;
  claims: readonly EvidenceClaim[]; omittedCount: number; key: string;
}>;
export const SELF_CONTEXT_LIMITS = Object.freeze({maxClaims: 40, maxText: 200, maxBytes: 20000, lifetimeMs: 15 * 60 * 1000});
const budgets = {company: 16, skill: 12, education: 8, role: 4} as const;
const labels = {archive: 'Your LinkedIn archive', profile: 'Your profile', resume: 'Your résumé', manual: 'Your confirmed profile'} as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const plain = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const words = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const fieldKey = (value: EvidenceClaim) => value.field + ':' + words(value.text);
const safeText = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= SELF_CONTEXT_LIMITS.maxText && value === value.trim()
  && !/[\r\n\u0000-\u001f\u007f]|https?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(value) && /[\p{L}]/u.test(value);
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

function projectedClaim(value: EvidenceClaim): EvidenceClaim | null {
  if (value.subject !== 'self' || value.appliesTo !== 'contact' || value.polarity === 'negative' || value.derivedFrom?.length
    || !own(budgets, value.field) || !own(labels, value.sourceKind) || !safeText(value.text)
    || !/^[a-zA-Z0-9:_-]{1,100}$/.test(value.id) || /\bheadline\b/i.test(value.sourceLabel)) return null;
  if (value.sourceKind === 'manual' && value.confidence !== 'user_confirmed') return null;
  // Archive education contains dates and descriptions too. Send only named fields.
  if (value.sourceKind === 'archive' && value.field === 'education') {
    const column = words(value.sourceLabel.split(' · ').at(-1) || '').replace(/ /g, '');
    if (!['school', 'schoolname', 'university', 'institution', 'degree', 'degreename', 'fieldofstudy', 'major'].includes(column)) return null;
  }
  return {id: value.id, subject: 'self', field: value.field, text: value.text,
    sourceKind: value.sourceKind, sourceLabel: labels[value.sourceKind as keyof typeof labels],
    ...(value.observedAt && Number.isFinite(Date.parse(value.observedAt)) ? {observedAt: new Date(value.observedAt).toISOString()} : {}),
    confidence: value.sourceKind === 'manual' ? 'user_confirmed' : 'observed', appliesTo: 'contact', polarity: 'positive'};
}

export function buildExtensionSelfContext(userId: string, evidence: readonly EvidenceClaim[], now = Date.now()): SelfEvidenceContext {
  if (!uuid.test(userId) || !Number.isSafeInteger(now) || now < 0) throw new TypeError('A current account is required for profile context.');
  const unique = new Map<string, EvidenceClaim>();
  for (const item of evidence) {const value = projectedClaim(item); if (value && !unique.has(fieldKey(value))) unique.set(fieldKey(value), value);}
  const claims: EvidenceClaim[] = [];
  for (const [field, limit] of Object.entries(budgets)) claims.push(...[...unique.values()].filter(value => value.field === field).slice(0, limit));
  while (new TextEncoder().encode(JSON.stringify(claims)).length > SELF_CONTEXT_LIMITS.maxBytes - 500) claims.pop();
  const body = {schemaVersion: 1 as const, userId, capturedAt: now, claims, omittedCount: unique.size - claims.length};
  return deepFreeze({...body, key: evidenceKey(body)});
}

/** Unknown, expired or foreign profile context adds no overlap; it never disconnects an account. */
export function validateExtensionSelfContext(value: unknown, userId: string, now = Date.now()): SelfEvidenceContext | null {
  try {
    if (!plain(value) || Object.keys(value).some(key => !['schemaVersion','userId','capturedAt','claims','omittedCount','key'].includes(key))
      || value.schemaVersion !== 1 || value.userId !== userId || !uuid.test(userId)
      || !Number.isSafeInteger(value.capturedAt) || Number(value.capturedAt) > now + 5000 || Number(value.capturedAt) < now - SELF_CONTEXT_LIMITS.lifetimeMs
      || !Array.isArray(value.claims) || value.claims.length > SELF_CONTEXT_LIMITS.maxClaims
      || !Number.isSafeInteger(value.omittedCount) || Number(value.omittedCount) < 0 || Number(value.omittedCount) > 100000
      || new TextEncoder().encode(JSON.stringify(value)).length > SELF_CONTEXT_LIMITS.maxBytes) return null;
    const counts: Record<string, number> = {}, ids = new Set<string>(), facts = new Set<string>();
    for (const item of value.claims) {
      if (!plain(item) || Object.keys(item).some(key => !['id','subject','field','text','sourceKind','sourceLabel','observedAt','confidence','appliesTo','polarity'].includes(key))
        || typeof item.id !== 'string' || !/^[a-zA-Z0-9:_-]{1,100}$/.test(item.id) || ids.has(item.id)
        || item.subject !== 'self' || item.appliesTo !== 'contact' || item.polarity !== 'positive'
        || typeof item.field !== 'string' || !own(budgets, item.field) || !safeText(item.text)
        || typeof item.sourceKind !== 'string' || !own(labels, item.sourceKind) || item.sourceLabel !== labels[item.sourceKind as keyof typeof labels]
        || item.confidence !== (item.sourceKind === 'manual' ? 'user_confirmed' : 'observed')
        || (item.observedAt !== undefined && (typeof item.observedAt !== 'string' || item.observedAt.length > 30 || !Number.isFinite(Date.parse(item.observedAt))))) return null;
      const key = fieldKey(item as unknown as EvidenceClaim);
      if (facts.has(key) || (counts[item.field] = (counts[item.field] || 0) + 1) > budgets[item.field as keyof typeof budgets]) return null;
      ids.add(item.id); facts.add(key);
    }
    const {key, ...body} = value;
    if (key !== evidenceKey(body)) return null;
    return deepFreeze(structuredClone(value)) as SelfEvidenceContext;
  } catch {return null;}
}
