import type {CompanyOverlap} from './company-evidence';
import type {LocalSources} from './workspace';
import {cleanText, contentFingerprint, deepFreeze, stableStringify, stripQuotedRepliesAndSignature} from './text';

export type EvidenceField = 'name' | 'company' | 'role' | 'industry' | 'location' | 'stage' | 'check_size' | 'education' | 'skill' | 'email' | 'url' | 'context' | 'custom' | 'writing' | 'proof_point';
export type EvidenceSourceKind = 'archive' | 'record' | 'profile' | 'manual' | 'resume' | 'knowledge' | 'writing' | 'web';
export interface EvidenceClaim {
  readonly id: string;
  readonly subject: 'self' | 'candidate';
  readonly subjectKey?: string;
  readonly field: EvidenceField;
  readonly text: string;
  readonly sourceLabel: string;
  readonly sourceRef?: string;
  readonly sourceKind: EvidenceSourceKind;
  readonly observedAt?: string;
  readonly confidence: 'observed' | 'user_confirmed';
  readonly appliesTo: 'contact' | 'opportunity';
  readonly polarity?: 'positive' | 'negative';
  /** Only explicit mutually exclusive, current assertions should set this. */
  readonly exclusive?: boolean;
  readonly derivedFrom?: readonly string[];
  /** Offsets refer to the cleaned, LF-normalized source text, not PDF bytes. */
  readonly span?: Readonly<{start: number; end: number}>;
}
export interface EvidenceAnchor {
  readonly kind: string;
  readonly text: string;
  readonly sourceUrl?: string;
  readonly observedAt?: string;
  readonly field?: EvidenceField;
  readonly appliesTo?: 'contact' | 'opportunity';
  readonly polarity?: 'positive' | 'negative';
}
export interface CandidateInput {
  readonly key?: string;
  readonly id?: string;
  readonly name?: string;
  readonly person?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly url?: string;
  readonly profile_url?: string | null;
  readonly email?: string;
  readonly company?: string;
  readonly position?: string;
  readonly role?: string;
  readonly location?: string;
  readonly industry?: string;
  readonly stage?: string;
  readonly check_size?: string;
  readonly sourceLabel?: string;
  readonly sourceKind?: EvidenceSourceKind;
  readonly observedAt?: string;
  readonly profileReadAt?: string | null;
  readonly completeProfile?: boolean;
  readonly anchors?: readonly EvidenceAnchor[];
  readonly claims?: readonly EvidenceClaim[];
  readonly manualContext?: string | readonly string[];
  readonly companyOverlap?: CompanyOverlap | null;
}
export interface CandidateEvidence {
  readonly key: string;
  readonly name: string;
  readonly company: string;
  readonly claims: readonly EvidenceClaim[];
  readonly profileReadAt: string | null;
  readonly completeProfile: boolean;
  readonly companyOverlap: CompanyOverlap | null;
}
export interface EvidenceSnapshot {
  readonly schemaVersion: 1;
  readonly claims: readonly EvidenceClaim[];
  readonly fingerprint: string;
}

const text = (value: unknown) => typeof value === 'string' ? cleanText(value).trim() : '';
const normalizedKey = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
/** Deterministic local lookup key, never an authentication or integrity primitive. */
export function evidenceKey(value: unknown): string {
  const input = stableStringify(value);
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    a = Math.imul(a ^ input.charCodeAt(i), 0x01000193);
    b = Math.imul(b ^ input.charCodeAt(i), 0x85ebca6b);
  }
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
}
export function candidateKey(input: CandidateInput): string {
  if (text(input.key || input.id)) return text(input.key || input.id);
  const raw = text(input.profile_url || input.url);
  if (raw) {
    try {
      const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        const host = url.hostname.toLowerCase().replace(/^www\./, '');
        return `url:${host}${url.pathname.replace(/\/+$/, '')}`;
      }
    } catch { /* A malformed URL is not a verified identifier. */ }
  }
  if (text(input.email)) return `email:${text(input.email).toLowerCase()}`;
  return `record:${evidenceKey([input.name || input.person || `${input.firstName || ''} ${input.lastName || ''}`,
    input.company || '', input.position || input.role || '', input.sourceLabel || ''])}`;
}

function claim(input: Omit<EvidenceClaim, 'id'>, discriminator: unknown = ''): EvidenceClaim {
  return deepFreeze({...structuredClone(input), id: `claim:${evidenceKey([input, discriminator])}`});
}
export const createEvidenceClaim = claim;
const fieldFor = (key: string, group = ''): EvidenceField => {
  const k = normalizedKey(key);
  if (['company', 'companyname', 'employer', 'organization'].includes(k)) return 'company';
  if (['title', 'position', 'role', 'jobtitle', 'headline'].includes(k)) return 'role';
  if (['industry', 'sector'].includes(k)) return 'industry';
  if (['location', 'geolocation', 'country', 'city', 'region'].includes(k)) return 'location';
  if (['stage', 'investmentstage'].includes(k)) return 'stage';
  if (['checksize', 'chequesize', 'investmentamount'].includes(k)) return 'check_size';
  if (group === 'education') return 'education';
  if (group === 'skills') return 'skill';
  return 'context';
};

/** Imports are never edited; each claim points back to one explicit source cell. */
export function buildSelfEvidence(sources: LocalSources): readonly EvidenceClaim[] {
  const result: EvidenceClaim[] = [];
  const referenceMap = new Map<string, string[]>();
  const archive = sources.archive ?? sources.accountFacts?.archive;
  const resume = sources.resume ?? sources.accountFacts?.resume;
  const mailbox = sources.mailbox ?? sources.accountFacts?.mailbox;
  const layer = archive?.layer1;
  for (const group of ['profile', 'positions', 'education', 'skills'] as const) {
    layer?.[group].forEach((row, index) => {
      const ids: string[] = [];
      for (const [key, value] of Object.entries(row)) {
        if (!text(value)) continue;
        const item = claim({subject: 'self', field: fieldFor(key, group), text: text(value),
          sourceLabel: `LinkedIn archive · ${group} · ${key}`, sourceKind: 'archive',
          sourceRef: `archive:${layer.fingerprint}/${group}/${index}/${encodeURIComponent(key)}`,
          observedAt: layer.importedAt, confidence: 'observed', appliesTo: 'contact'});
        result.push(item); ids.push(item.id);
      }
      referenceMap.set(`${group}:${index}`, ids);
    });
  }
  if (resume?.text) {
    const cleaned = cleanText(resume.text).replace(/\r\n?/g, '\n');
    const ids: string[] = [];
    for (const match of cleaned.matchAll(/[^\n]+/g)) {
      const trimmed = match[0].trim(); if (!trimmed) continue;
      const start = match.index! + match[0].indexOf(trimmed);
      const item = claim({subject: 'self', field: 'context', text: trimmed, sourceLabel: 'Résumé', sourceKind: 'resume',
        sourceRef: `resume:${resume.fingerprint}`, span: {start, end: start + trimmed.length},
        confidence: 'observed', appliesTo: 'contact'});
      result.push(item); ids.push(item.id);
    }
    referenceMap.set('resume:0', ids);
  }
  for (const [index, point] of (sources.knowledge?.knowledge.proofPoints ?? []).entries()) {
    const ids = point.evidenceIds.flatMap(id => referenceMap.get(id) ?? []);
    // Synthesis is labeled as such and excluded from factual criterion evaluation.
    if (!point.evidenceIds.length || point.evidenceIds.some(id => !referenceMap.get(id)?.length)) continue;
    result.push(claim({subject: 'self', field: 'proof_point', text: point.text, sourceLabel: 'Career synthesis · proof point',
      sourceKind: 'knowledge', sourceRef: `knowledge:${sources.knowledge!.fingerprint}/proofPoints/${index}`,
      derivedFrom: [...new Set(ids)], observedAt: sources.knowledge!.createdAt, confidence: 'observed', appliesTo: 'contact'}));
  }
  const samples = [...(archive?.writingSamples ?? []), ...(mailbox?.samples ?? [])].slice(0, 40);
  samples.forEach((sample, index) => {
    const own = stripQuotedRepliesAndSignature(sample).replace(/[\uD800-\uDBFF]$/, '');
    if (own) result.push(claim({subject: 'self', field: 'writing', text: own, sourceLabel: 'Own writing sample',
      sourceKind: 'writing', sourceRef: `own-writing:${evidenceKey(sample)}`, confidence: 'observed', appliesTo: 'contact'}, index));
  });
  return deepFreeze(result);
}

/** Company names never manufacture sector, location, hiring authority or vacancies. */
export function buildCandidateEvidence(input: CandidateInput): CandidateEvidence {
  const key = candidateKey(input);
  const sourceKind = input.sourceKind ?? (input.firstName !== undefined ? 'archive' : 'record');
  const sourceLabel = input.sourceLabel ?? (sourceKind === 'archive' ? 'Connection archive' : 'Saved contact record');
  const sourceRef = text(input.profile_url || input.url) || `candidate:${key}`;
  const claims: EvidenceClaim[] = [];
  const headlineClaimIds = new Set<string>();
  const add = (field: EvidenceField, value: unknown, details: Partial<EvidenceClaim> = {}, discriminator: unknown = '') => {
    if (!text(value)) return;
    const item = claim({subject: 'candidate', subjectKey: key, field, text: text(value), sourceKind,
      sourceLabel, sourceRef, ...(input.observedAt ? {observedAt: input.observedAt} : {}),
      confidence: sourceKind === 'manual' ? 'user_confirmed' : 'observed', appliesTo: 'contact', ...details}, discriminator);
    claims.push(item);
    return item;
  };
  const name = text(input.name || input.person || `${input.firstName || ''} ${input.lastName || ''}`);
  add('name', name); add('company', input.company); add('role', input.position || input.role);
  add('email', input.email); add('url', input.profile_url || input.url);
  for (const field of ['location', 'industry', 'stage', 'check_size'] as const) add(field, input[field]);
  for (const [index, anchor] of (input.anchors ?? []).entries()) {
    // A headline may describe an aspiration or topic, not a role the person holds.
    const field = anchor.field ?? ({headline: 'context', experience: 'context', about: 'context', education: 'education',
      skills: 'skill', skill: 'skill', location: 'location', industry: 'industry'} as Record<string, EvidenceField>)[anchor.kind] ?? 'context';
    const added = add(field, anchor.text, {sourceKind: 'profile', sourceLabel: `Rendered profile · ${anchor.kind}`,
      sourceRef: anchor.sourceUrl || sourceRef, ...(anchor.observedAt ? {observedAt: anchor.observedAt} : {}),
      appliesTo: anchor.appliesTo ?? 'contact', ...(anchor.polarity ? {polarity: anchor.polarity} : {})}, index);
    if (anchor.kind === 'headline' && added) headlineClaimIds.add(added.id);
  }
  const manual = typeof input.manualContext === 'string' ? [input.manualContext] : input.manualContext ?? [];
  manual.forEach((value, index) => add('context', value, {sourceKind: 'manual', sourceLabel: 'User-provided context', confidence: 'user_confirmed'}, index));
  for (const item of input.claims ?? []) {
    if (item.subject !== 'candidate' || (item.subjectKey && item.subjectKey !== key) || !text(item.text)) continue;
    claims.push(deepFreeze(structuredClone({...item, subjectKey: key})));
  }
  const unique = distinctEvidenceClaims(claims);
  const substantive = unique.some(item => item.sourceKind === 'profile' && !headlineClaimIds.has(item.id)
    && !['name', 'url', 'email', 'role'].includes(item.field));
  return deepFreeze({key, name, company: text(input.company), claims: unique,
    profileReadAt: input.profileReadAt ?? null,
    completeProfile: Boolean(input.completeProfile && input.profileReadAt && substantive),
    companyOverlap: input.companyOverlap ? structuredClone(input.companyOverlap) : null});
}

/** Reusing an ID for different evidence is invalid; never silently discard a conflict. */
export function distinctEvidenceClaims(claims: readonly EvidenceClaim[]): readonly EvidenceClaim[] {
  const result = new Map<string, EvidenceClaim>();
  for (const item of claims) {
    const previous = result.get(item.id);
    if (previous && stableStringify(previous) !== stableStringify(item)) throw new TypeError('An evidence identifier refers to different claims.');
    if (!previous) result.set(item.id, item);
  }
  return [...result.values()];
}

export function sortedEvidence(claims: readonly EvidenceClaim[]): readonly EvidenceClaim[] {
  return [...claims].sort((a, b) => a.id.localeCompare(b.id) || stableStringify(a).localeCompare(stableStringify(b)));
}
/** SHA-256 includes provenance and content; reorder alone does not invalidate it. */
export async function evidenceFingerprint(claims: readonly EvidenceClaim[]): Promise<string> {
  return contentFingerprint({schemaVersion: 1, claims: sortedEvidence(claims)});
}
export async function createEvidenceSnapshot(claims: readonly EvidenceClaim[]): Promise<EvidenceSnapshot> {
  const copy = structuredClone(sortedEvidence(claims));
  return deepFreeze({schemaVersion: 1 as const, claims: copy, fingerprint: await evidenceFingerprint(copy)});
}
