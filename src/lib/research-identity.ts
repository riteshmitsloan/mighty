import {deepFreeze} from './text';

export type ProfessionalIdentityField = 'company' | 'role' | 'education' | 'industry' | 'skill';
export interface ProfessionalIdentityFact {
  readonly id: string;
  readonly field: ProfessionalIdentityField;
  readonly value: string;
  readonly sourceRef: string;
  /** Original temporal context, never interpreted as a current-role assertion. */
  readonly period?: string;
}
export interface ResearchIdentityAnchor {
  readonly linkedinUrl: string;
  readonly name: string;
  readonly facts: readonly ProfessionalIdentityFact[];
}
export interface ObservedProfessionalFact {
  readonly id: string;
  readonly field: ProfessionalIdentityField;
  readonly value: string;
  /** Exact quotation within the observed subject text. */
  readonly quote: string;
  /** Supplied by the source adapter from explicit fields, never inferred from a headline. */
  readonly basis: 'structured' | 'labelled';
  readonly polarity: 'positive' | 'negative' | 'uncertain';
  readonly period?: string;
}
export interface ObservedIdentityLink {
  readonly href: string;
  /** A subject-scoped profile link or structured sameAs, not any link on the page. */
  readonly relation: 'subject_profile' | 'other';
}
export interface ObservedResearchSubject {
  readonly id: string;
  readonly name: string;
  /** An exact, independently observed subject section within source.text. */
  readonly text: string;
  readonly links: readonly ObservedIdentityLink[];
  readonly facts: readonly ObservedProfessionalFact[];
}
export interface ObservedResearchSource {
  readonly id: string;
  /** Final observed page URL. Query text and a search result destination are not source evidence. */
  readonly url: string;
  readonly observedAt: string;
  readonly attribution: string;
  readonly contentKind: 'source_page' | 'search_result' | 'copied_result';
  readonly text: string;
  readonly subjects: readonly ObservedResearchSubject[];
}
export type ResearchIdentityStatus = 'matched' | 'ambiguous' | 'unverified' | 'invalid';
export type IdentityReasonCode = 'direct_profile_url' | 'subject_profile_link' | 'exact_name'
  | 'professional_field_match' | 'no_source_linkage' | 'name_not_supported' | 'no_field_match'
  | 'conflicting_profile_links' | 'conflicting_subjects' | 'search_result_only' | 'copied_result'
  | 'duplicate_content' | 'duplicate_source' | 'invalid_source' | 'different_profile_url';
export interface IdentityMatchReason {
  readonly code: IdentityReasonCode;
  readonly text: string;
  readonly subjectId?: string;
  readonly anchorFactId?: string;
  readonly sourceFactId?: string;
}
export interface AcceptedResearchFact extends ObservedProfessionalFact {
  readonly sourceId: string;
  readonly subjectId: string;
  readonly sourceUrl: string;
  readonly observedAt: string;
  readonly attribution: string;
  readonly corroboration: 'anchor_match' | 'source_only';
}
export interface ResearchSourceMatch {
  readonly sourceId: string;
  readonly sourceUrl: string;
  readonly observedAt: string;
  readonly attribution: string;
  readonly status: ResearchIdentityStatus;
  readonly reasons: readonly IdentityMatchReason[];
  readonly unknowns: readonly string[];
  /** Empty on every abstention. Raw, supported observations only, not verified current facts. */
  readonly facts: readonly AcceptedResearchFact[];
}
export interface ResearchIdentityAssessment {
  readonly anchor: ResearchIdentityAnchor;
  readonly sources: readonly ResearchSourceMatch[];
  readonly matchedSourceIds: readonly string[];
}

export const RESEARCH_IDENTITY_LIMITS = Object.freeze({sources: 20, text: 200_000, subjects: 100, facts: 100, links: 100});
const fields = new Set<string>(['company', 'role', 'education', 'industry', 'skill']);
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value)) ? value as Record<string, unknown> : null;
const text = (value: unknown, max = 2_000): value is string => typeof value === 'string' && Boolean(value.trim()) && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value);
const normalized = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
const ownKeys = (value: object, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key));

/** Aligned with the extension's strict HTTPS LinkedIn /in/ canonicalization. */
export function canonicalResearchLinkedInUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['linkedin.com', 'www.linkedin.com'].includes(url.hostname.toLowerCase()) || url.port || url.username || url.password) return null;
    const path = url.pathname.match(/^\/in\/([^/]+)\/?$/);
    if (!path) return null;
    const slug = decodeURIComponent(path[1]).normalize('NFC').toLowerCase();
    return /^[\p{L}\p{N}_-]{1,200}$/u.test(slug) ? `https://www.linkedin.com/in/${encodeURIComponent(slug)}/` : null;
  } catch { return null; }
}
function sourceUrl(value: unknown): string | null {
  if (!text(value, 4_000)) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}
function validDate(value: unknown): value is string {
  if (!text(value, 40) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 19) === value.slice(0, 19);
}
function supportedWithin(container: string, value: string): boolean {
  const haystack = normalized(container), needle = normalized(value);
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    const before = haystack.slice(0, index).match(/[\p{L}\p{N}]$/u);
    const after = /^[\p{L}\p{N}]/u.test(haystack.slice(index + needle.length));
    if (!before && !after) return true;
    index = haystack.indexOf(needle, index + 1);
  }
  return false;
}
const distinctIds = (items: readonly {id: string}[]) => new Set(items.map(item => item.id)).size === items.length;

/** Invalid anchors fail rather than falling back to a name-only search identity. */
export function createResearchIdentityAnchor(input: ResearchIdentityAnchor): ResearchIdentityAnchor {
  const value = record(input);
  const url = value && typeof value.linkedinUrl === 'string' ? canonicalResearchLinkedInUrl(value.linkedinUrl) : null;
  if (!value || !ownKeys(value, ['linkedinUrl', 'name', 'facts']) || !url || !text(value.name, 200) || !Array.isArray(value.facts) || value.facts.length > RESEARCH_IDENTITY_LIMITS.facts) throw new TypeError('A LinkedIn profile, name and explicit professional facts are required for research identity.');
  const facts = value.facts as ProfessionalIdentityFact[];
  for (const fact of facts) {
    const item = record(fact);
    if (!item || !ownKeys(item, ['id', 'field', 'value', 'sourceRef', 'period']) || !text(item.id, 200) || !fields.has(String(item.field)) || !text(item.value) || !text(item.sourceRef, 4_000) || (item.period !== undefined && !text(item.period))) throw new TypeError('Research identity accepts sourced professional facts only.');
  }
  if (!distinctIds(facts)) throw new TypeError('Research identity fact identifiers must be unique.');
  return deepFreeze(structuredClone({linkedinUrl: url, name: value.name as string, facts}));
}

function validSource(input: unknown): input is ObservedResearchSource {
  const value = record(input);
  if (!value || !ownKeys(value, ['id', 'url', 'observedAt', 'attribution', 'contentKind', 'text', 'subjects']) || !text(value.id, 200) || !sourceUrl(value.url) || !validDate(value.observedAt) || !text(value.attribution, 500)
    || !['source_page', 'search_result', 'copied_result'].includes(String(value.contentKind)) || !text(value.text, RESEARCH_IDENTITY_LIMITS.text) || !Array.isArray(value.subjects) || value.subjects.length > RESEARCH_IDENTITY_LIMITS.subjects) return false;
  for (const raw of value.subjects) {
    const subject = record(raw);
    if (!subject || !ownKeys(subject, ['id', 'name', 'text', 'links', 'facts']) || !text(subject.id, 200) || !text(subject.name, 200) || !text(subject.text, RESEARCH_IDENTITY_LIMITS.text) || !(value.text as string).includes(subject.text)
      || !Array.isArray(subject.links) || subject.links.length > RESEARCH_IDENTITY_LIMITS.links || !Array.isArray(subject.facts) || subject.facts.length > RESEARCH_IDENTITY_LIMITS.facts) return false;
    for (const rawLink of subject.links) {
      const link = record(rawLink);
      if (!link || !ownKeys(link, ['href', 'relation']) || !sourceUrl(link.href) || !['subject_profile', 'other'].includes(String(link.relation))) return false;
    }
    for (const rawFact of subject.facts) {
      const fact = record(rawFact);
      if (!fact || !ownKeys(fact, ['id', 'field', 'value', 'quote', 'basis', 'polarity', 'period']) || !text(fact.id, 200) || !fields.has(String(fact.field)) || !text(fact.value) || !text(fact.quote, 10_000)
        || !['structured', 'labelled'].includes(String(fact.basis)) || !['positive', 'negative', 'uncertain'].includes(String(fact.polarity)) || (fact.period !== undefined && !text(fact.period))) return false;
    }
    if (!distinctIds(subject.facts as ObservedProfessionalFact[])) return false;
  }
  return distinctIds(value.subjects as ObservedResearchSubject[]);
}

function assessSource(anchor: ResearchIdentityAnchor, raw: ObservedResearchSource): ResearchSourceMatch {
  const value = record(raw);
  const base = {sourceId: typeof value?.id === 'string' ? value.id : '', sourceUrl: typeof value?.url === 'string' ? value.url : '', observedAt: typeof value?.observedAt === 'string' ? value.observedAt : '', attribution: typeof value?.attribution === 'string' ? value.attribution : ''};
  const stop = (status: ResearchIdentityStatus, code: IdentityReasonCode, message: string): ResearchSourceMatch => ({...base, status, reasons: [{code, text: message}], unknowns: [], facts: []});
  if (!validSource(raw)) return stop('invalid', 'invalid_source', 'The source lacks valid, bounded observation provenance or subject sections.');
  if (raw.contentKind === 'search_result') return stop('unverified', 'search_result_only', 'A search result does not independently establish the identity of its destination page.');
  if (raw.contentKind === 'copied_result') return stop('unverified', 'copied_result', 'Copied results cannot corroborate the target identity.');
  const direct = canonicalResearchLinkedInUrl(raw.url);
  if (direct && direct !== anchor.linkedinUrl) return stop('ambiguous', 'different_profile_url', 'The observed page is a different LinkedIn profile.');
  const profiles = (subject: ObservedResearchSubject) => [...new Set(subject.links.filter(link => link.relation === 'subject_profile').map(link => canonicalResearchLinkedInUrl(link.href)).filter((url): url is string => Boolean(url)))];
  const subjects = raw.subjects.filter(subject => direct === anchor.linkedinUrl || profiles(subject).includes(anchor.linkedinUrl));
  if (!subjects.length) return stop('unverified', 'no_source_linkage', 'No direct page or person-scoped link connects this source to the target LinkedIn profile.');
  if (subjects.some(subject => profiles(subject).some(url => url !== anchor.linkedinUrl))) return stop('ambiguous', 'conflicting_profile_links', 'A target subject section links to more than one LinkedIn identity.');
  if (subjects.some(subject => normalized(subject.name) !== normalized(anchor.name))) return stop('ambiguous', 'conflicting_subjects', 'The linked subject names do not consistently match the identity anchor.');
  const reasons: IdentityMatchReason[] = [], unknowns: string[] = [], facts: AcceptedResearchFact[] = [];
  for (const subject of subjects) {
    reasons.push({code: direct ? 'direct_profile_url' : 'subject_profile_link', text: direct ? 'The observed LinkedIn page has the target canonical profile URL.' : 'This subject section explicitly links to the target canonical LinkedIn profile.', subjectId: subject.id});
    if (!supportedWithin(subject.text, subject.name)) {
      reasons.push({code: 'name_not_supported', text: 'The supplied name is not supported by the observed subject section.', subjectId: subject.id});
      unknowns.push(`Subject ${subject.id}: the supplied name is not present as a complete name in its observed section.`);
      continue;
    }
    reasons.push({code: 'exact_name', text: 'The complete observed name matches the identity anchor.', subjectId: subject.id});
    const supported = subject.facts.filter(fact => {
      const valid = fact.polarity === 'positive' && subject.text.includes(fact.quote) && supportedWithin(fact.quote, fact.value) && (fact.period === undefined || fact.quote.includes(fact.period));
      if (!valid) unknowns.push(`Fact ${fact.id}: no positive explicit field with a complete quotation supports this observation.`);
      return valid;
    });
    const matched = supported.flatMap(fact => anchor.facts.filter(known => known.field === fact.field && normalized(known.value) === normalized(fact.value)).map(known => ({fact, known})));
    if (!matched.length) {
      unknowns.push(`Subject ${subject.id}: no supported professional field exactly matches an anchor fact. Different employment or education details alone do not prove a different identity.`);
      continue;
    }
    for (const {fact, known} of matched) reasons.push({code: 'professional_field_match', text: `The observed ${fact.field} value exactly matches an anchor fact.`, subjectId: subject.id, anchorFactId: known.id, sourceFactId: fact.id});
    for (const fact of supported) {
      const corroborated = matched.some(item => item.fact.id === fact.id);
      facts.push({...structuredClone(fact), sourceId: raw.id, subjectId: subject.id, sourceUrl: raw.url, observedAt: raw.observedAt, attribution: raw.attribution, corroboration: corroborated ? 'anchor_match' : 'source_only'});
      if (!corroborated) unknowns.push(`Fact ${fact.id}: observed on the matched source but not independently corroborated by the identity anchor. Its temporal meaning remains as stated in the source.`);
    }
  }
  if (!facts.length) return {...base, status: 'unverified', reasons: [...reasons, {code: 'no_field_match', text: 'Identity linkage alone is insufficient without a supported name and professional field match.'}], unknowns, facts: []};
  return {...base, status: 'matched', reasons, unknowns, facts};
}

/**
 * Corroborates independently observed, subject-scoped source records. This does not fetch,
 * authenticate a publisher, resolve redirects, establish content rights or verify factual truth.
 * Adapters must not fill source fields from the target, query, generated text or copied snippets.
 * Exact copied content is withheld; no number of weak sources upgrades an unmatched identity.
 */
export function matchResearchSources(target: ResearchIdentityAnchor, sources: readonly ObservedResearchSource[]): ResearchIdentityAssessment {
  const anchor = createResearchIdentityAnchor(target);
  if (!Array.isArray(sources) || sources.length > RESEARCH_IDENTITY_LIMITS.sources) throw new TypeError(`Provide at most ${RESEARCH_IDENTITY_LIMITS.sources} observed sources without truncating them.`);
  const decisions = sources.map(source => assessSource(anchor, source));
  const candidates = sources.map((source, index) => ({source, index})).filter((item): item is {source: ObservedResearchSource; index: number} => validSource(item.source) && item.source.contentKind === 'source_page');
  const sections = (source: ObservedResearchSource) => source.subjects.filter(subject => canonicalResearchLinkedInUrl(source.url) === anchor.linkedinUrl
    || subject.links.some(link => link.relation === 'subject_profile' && canonicalResearchLinkedInUrl(link.href) === anchor.linkedinUrl)).map(subject => normalized(subject.text));
  for (const {source, index} of candidates) {
    const repeatedId = candidates.some(other => other.index !== index && other.source.id === source.id);
    const targetSections = sections(source);
    const duplicate = candidates.some(other => other.index !== index && (sourceUrl(other.source.url) === sourceUrl(source.url) || normalized(other.source.text) === normalized(source.text)
      || sections(other.source).some(section => targetSections.includes(section))));
    if (repeatedId || duplicate) {
      const code = repeatedId ? 'duplicate_source' : 'duplicate_content';
      decisions[index] = {...decisions[index], status: 'ambiguous', reasons: [...decisions[index].reasons, {code, text: 'Repeated source identity or copied page content cannot provide independent corroboration. Supply one original observation.'}], facts: []};
    }
  }
  return deepFreeze({anchor, sources: structuredClone(decisions), matchedSourceIds: decisions.filter(source => source.status === 'matched').map(source => source.sourceId)});
}
