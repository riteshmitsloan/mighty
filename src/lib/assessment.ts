import type {Goal, GoalCriterion} from './goals';
import {companyKey, companyOverlapFor, type CompanyOverlap} from './company-evidence';
import {buildCandidateEvidence, candidateKey, distinctEvidenceClaims, evidenceKey, sortedEvidence, type CandidateInput, type CandidateEvidence, type EvidenceClaim, type EvidenceField} from './evidence';
import {cleanText, deepFreeze} from './text';

export type CriterionStatus = 'supported' | 'contradicted' | 'unknown' | 'conflicting';
export interface CriterionAssessment {
  readonly criterionId: string;
  readonly field: GoalCriterion['field'];
  readonly label: string;
  readonly appliesTo: GoalCriterion['appliesTo'];
  readonly importance: GoalCriterion['importance'];
  readonly origin: GoalCriterion['origin'];
  readonly status: CriterionStatus;
  readonly claimIds: readonly string[];
  readonly supportingClaimIds: readonly string[];
  readonly contradictingClaimIds: readonly string[];
  readonly matchedTerms: readonly string[];
  readonly reason: string;
}
export interface ContactRoute {
  readonly kind: 'executive_hiring' | 'recruiter' | 'peer' | 'introducer';
  readonly label: string;
  readonly reason: string;
  readonly claimIds: readonly string[];
}
export interface AssessmentOptions {
  readonly limit?: number;
  readonly companyIndex?: Readonly<Record<string, CompanyOverlap>>;
  readonly includeContradicted?: boolean;
}
export interface CandidateAssessment {
  readonly goalId: string;
  readonly goalVersion: number;
  readonly candidateKey: string;
  readonly label: string;
  readonly status: 'supported' | 'possible_route' | 'unknown' | 'contradicted' | 'conflicting';
  readonly reasons: readonly string[];
  readonly reasonDetails: readonly {text: string; claimIds: readonly string[]}[];
  readonly unknowns: readonly string[];
  readonly criteria: readonly CriterionAssessment[];
  readonly contactRoutes: readonly ContactRoute[];
  readonly evidenceCoverage: Readonly<{total: number; supported: number; contradicted: number; conflicting: number; unknown: number; observedClaims: number; completeProfile: boolean}>;
  /** Internal deterministic ordering weight, not a probability or person score. */
  readonly rank: number;
  readonly isMatch: boolean;
  readonly sharedEmployer: string | null;
  readonly companyOverlap: CompanyOverlap | null;
  readonly evidenceKey: string;
}
export interface RankedGoalCandidate extends CandidateAssessment {
  readonly candidate: CandidateEvidence;
  readonly person: CandidateInput;
}

export function phraseTokens(value: string): string[] {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/&amp;/g, '&').replace(/&/g, ' and ')
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}
const normalized = (value: string) => phraseTokens(value).join(' ');
const ALIASES: readonly (readonly string[])[] = [
  ['ceo', 'chief executive officer'], ['cfo', 'chief financial officer'], ['coo', 'chief operating officer'],
  ['cto', 'chief technology officer'], ['cmo', 'chief marketing officer'], ['chro', 'chief human resources officer'],
  ['vp', 'vice president'], ['svp', 'senior vice president'], ['evp', 'executive vice president'],
  ['fmcg', 'fast moving consumer goods'], ['cpg', 'consumer packaged goods'],
  ['uk', 'united kingdom'], ['usa', 'united states', 'united states of america'], ['nyc', 'new york city'],
  ['saas', 'software as a service'], ['pre seed', 'preseed'],
];
const alternativeCache = new Map<string, string[]>();
function alternatives(term: string): string[] {
  const cached = alternativeCache.get(term); if (cached) return cached;
  const normalizedTerm = normalized(term);
  const alias = ALIASES.find(group => group.includes(normalizedTerm));
  const result = [...new Set([normalizedTerm, ...(alias ?? [])])].filter(Boolean);
  if (alternativeCache.size >= 256) alternativeCache.clear(); alternativeCache.set(term, result);
  return result;
}
/** Match whole token sequences. A substring such as AI in retail never matches. */
export function matchesPhrase(value: string, term: string): boolean {
  try { return Boolean(findPhrase(value, term).length); } finally { tokenCache.clear(); alternativeCache.clear(); }
}
const tokenCache = new Map<string, string[]>();
function cachedTokens(value: string): string[] {
  const cached = tokenCache.get(value); if (cached) return cached;
  const tokens = phraseTokens(value); if (tokenCache.size >= 512) tokenCache.clear(); tokenCache.set(value, tokens); return tokens;
}
function findPhrase(value: string, term: string): {negative: boolean}[] {
  const tokens = cachedTokens(value), wanted = cachedTokens(term);
  if (!wanted.length) return [];
  const result: {negative: boolean}[] = [];
  for (let i = 0; i <= tokens.length - wanted.length; i++) {
    if (!wanted.every((token, j) => token === tokens[i + j])) continue;
    if ((wanted.join(' ') === 'seed' && tokens[i - 1] === 'pre') || (wanted.join(' ') === 'president' && tokens[i - 1] === 'vice')) continue;
    const before = tokens.slice(Math.max(0, i - 5), i);
    const negative = before.some((token, j) => ['not', 'no', 'never', 'without'].includes(token) && before[j + 1] !== 'only');
    result.push({negative});
  }
  return result;
}
const sourceIsFactual = (claim: EvidenceClaim) => !['knowledge', 'writing', 'web'].includes(claim.sourceKind) && !claim.derivedFrom?.length;
const executiveTerms = ['ceo', 'cfo', 'coo', 'cto', 'cmo', 'chro', 'president', 'founder', 'managing director', 'general manager'];
const executiveAliases = new Set(executiveTerms.flatMap(alternatives));
const isExecutiveTerm = (term: string) => executiveAliases.has(alternatives(term)[0]);
function auxiliaryExecutiveRole(value: string, term: string): boolean {
  if (!isExecutiveTerm(term)) return false;
  return /(?:assistant|advisor|adviser|chief of staff|office|reporting|reports) (?:to|of|for) (?:the )?(?:ceo|cfo|coo|cto|cmo|chro|chief |president|founder)/.test(cachedTokens(value).join(' '));
}
function evaluateCriterion(criterion: GoalCriterion, claims: readonly EvidenceClaim[]): CriterionAssessment {
  const supported = new Set<string>(), contradicted = new Set<string>(), matched = new Set<string>();
  const usable = claims.filter(item => item.subject === 'candidate' && sourceIsFactual(item) && item.appliesTo === criterion.appliesTo
    && (item.field === criterion.field || (criterion.field === 'custom' && ['context', 'custom', 'skill', 'education'].includes(item.field))));
  const terms = criterion.terms.filter(term => normalized(term));
  for (const item of usable) {
    let hadPositive = false;
    for (const term of terms) {
      if (criterion.field === 'role' && auxiliaryExecutiveRole(item.text, term)) continue;
      for (const alias of alternatives(term)) {
        for (const clause of item.text.split(/[.!?;\n]/u)) {
          const occurrences = findPhrase(clause, alias);
          if (!occurrences.length) continue;
          matched.add(term);
          for (const occurrence of occurrences) {
            if (item.polarity === 'negative' || occurrence.negative) contradicted.add(item.id);
            else { supported.add(item.id); hadPositive = true; }
          }
        }
      }
    }
    if (!hadPositive && item.exclusive && item.polarity !== 'negative' && terms.length) contradicted.add(item.id);
  }
  const status: CriterionStatus = supported.size && contradicted.size ? 'conflicting' : supported.size ? 'supported' : contradicted.size ? 'contradicted' : 'unknown';
  const scope = criterion.appliesTo === 'opportunity' ? 'opportunity' : 'contact';
  const reason = status === 'supported' ? `${criterion.label}: explicit ${scope} evidence mentions ${[...matched].join(', ')}.`
    : status === 'contradicted' ? `${criterion.label}: explicit ${scope} evidence contradicts this criterion.`
    : status === 'conflicting' ? `${criterion.label}: the cited ${scope} evidence conflicts; review the sources.`
    : `${criterion.label}: ${scope} ${criterion.field.replace('_', ' ')} is not established by the available evidence.`;
  return {criterionId: criterion.id, field: criterion.field, label: criterion.label, appliesTo: criterion.appliesTo,
    importance: criterion.importance, origin: criterion.origin, status,
    claimIds: [...new Set([...supported, ...contradicted])], supportingClaimIds: [...supported], contradictingClaimIds: [...contradicted],
    matchedTerms: [...matched], reason};
}
function validOverlap(candidate: CandidateEvidence, options: AssessmentOptions): CompanyOverlap | null {
  const value = options.companyIndex ? companyOverlapFor(options.companyIndex, candidate.company) : candidate.companyOverlap;
  return value && candidate.company && companyKey(value.company) === companyKey(candidate.company) && Number.isSafeInteger(value.count)
    && value.count >= 2 && value.statement === `You already know ${value.count} people at ${value.company}` ? value : null;
}
function candidateEvidence(candidate: CandidateInput | CandidateEvidence): CandidateEvidence {
  return 'completeProfile' in candidate && 'claims' in candidate && 'key' in candidate && Array.isArray(candidate.claims)
    && typeof candidate.name === 'string' && typeof candidate.company === 'string' && 'profileReadAt' in candidate
    ? candidate as CandidateEvidence : buildCandidateEvidence(candidate);
}
interface PreparedAssessment {
  readonly goalKey: string;
  readonly selfKey: string;
  readonly selfCompanies: ReadonlyMap<string, EvidenceClaim>;
}
function prepare(goal: Goal, selfEvidence: readonly EvidenceClaim[]): PreparedAssessment {
  return {goalKey: evidenceKey(goal), selfKey: evidenceKey(sortedEvidence(selfEvidence)),
    selfCompanies: new Map(selfEvidence.filter(item => item.subject === 'self' && item.field === 'company' && item.appliesTo === 'contact'
      && sourceIsFactual(item) && item.polarity !== 'negative').map(item => [companyKey(item.text), item]))};
}
function assess(goal: Goal, candidate: CandidateEvidence, options: AssessmentOptions, prepared: PreparedAssessment, snapshot = true): CandidateAssessment {
  const candidateClaims = candidate.claims.filter(item => item.subject === 'candidate' && (!item.subjectKey || item.subjectKey === candidate.key));
  const criteria = goal.criteria.map(criterion => evaluateCriterion(criterion, candidateClaims));
  const roles = candidateClaims.filter(item => item.field === 'role' && item.appliesTo === 'contact' && sourceIsFactual(item) && item.polarity !== 'negative');
  const companyClaims = candidateClaims.filter(item => item.field === 'company' && item.appliesTo === 'contact' && sourceIsFactual(item) && item.polarity !== 'negative');
  const sharedContact = companyClaims.find(item => prepared.selfCompanies.has(companyKey(item.text)));
  const shared = sharedContact ? {contact: sharedContact, own: prepared.selfCompanies.get(companyKey(sharedContact.text))!} : undefined;
  const routes: ContactRoute[] = [];
  if (goal.kind === 'career') {
    const executives = roles.filter(item => executiveTerms.some(term => !auxiliaryExecutiveRole(item.text, term)
      && alternatives(term).some(alias => findPhrase(item.text, alias).some(match => !match.negative))));
    if (executives.length) routes.push({kind: 'executive_hiring', label: 'Executive contact route',
      reason: 'A recorded executive role offers a possible hiring contact route; hiring authority and openings remain unconfirmed.', claimIds: executives.map(item => item.id)});
    const recruiters = roles.filter(item => ['recruiter', 'recruiting', 'executive search', 'talent acquisition', 'headhunter']
      .some(term => findPhrase(item.text, term).some(match => !match.negative)));
    if (recruiters.length) routes.push({kind: 'recruiter', label: 'Recruiter route',
      reason: 'A recorded recruiting role offers a possible career contact route; current mandates are unknown.', claimIds: recruiters.map(item => item.id)});
    const targetRoles = goal.criteria.filter(item => item.field === 'role').flatMap(item => item.terms);
    const peers = roles.filter(item => targetRoles.some(term => !auxiliaryExecutiveRole(item.text, term)
      && alternatives(term).some(alias => findPhrase(item.text, alias).some(match => !match.negative))));
    if (peers.length) routes.push({kind: 'peer', label: 'Peer route', reason: 'Their recorded role overlaps the target role; this is peer context, not evidence of a vacancy.', claimIds: peers.map(item => item.id)});
    if (shared) routes.push({kind: 'introducer', label: 'Shared-employer route', reason: `Both records name ${shared.contact.text}; an introduction may be worth discussing, but target access is unknown.`, claimIds: [shared.contact.id, shared.own.id]});
  }
  const routePriority = {peer: 0, recruiter: 1, executive_hiring: 2, introducer: 3};
  routes.sort((a, b) => routePriority[a.kind] - routePriority[b.kind]);
  const supported = criteria.filter(item => item.status === 'supported'), conflicting = criteria.filter(item => item.status === 'conflicting');
  const contradicted = criteria.filter(item => item.status === 'contradicted');
  const requiredContradiction = contradicted.some(item => item.importance === 'required' && item.origin === 'user');
  const status = conflicting.length ? 'conflicting' : requiredContradiction ? 'contradicted' : supported.length ? 'supported' : routes.length ? 'possible_route' : 'unknown';
  const label = {conflicting: 'Conflicting evidence', contradicted: 'Evidence contradicts criteria', supported: 'Evidence supports some criteria', possible_route: 'Possible contact route', unknown: 'More evidence needed'}[status];
  const details = [...conflicting, ...supported, ...contradicted].map(item => ({text: item.reason, claimIds: item.claimIds}));
  details.push(...routes.map(route => ({text: route.reason, claimIds: route.claimIds})));
  if (shared && !routes.some(route => route.kind === 'introducer')) details.push({text: `Both records name ${shared.contact.text}.`, claimIds: [shared.contact.id, shared.own.id]});
  const overlap = validOverlap(candidate, options);
  if (overlap) details.push({text: `${overlap.statement}.`, claimIds: companyClaims.filter(item => companyKey(item.text) === companyKey(overlap.company)).map(item => item.id)});
  const unknowns = criteria.filter(item => item.status === 'unknown').map(item => item.reason);
  if (routes.length) unknowns.push('Contact relevance does not establish an available opportunity or willingness to help.');
  if (!candidate.completeProfile) unknowns.push('A complete profile has not been established; these records may be partial or outdated.');
  if (!criteria.length) unknowns.push('Confirm at least one goal criterion to assess evidence against it.');
  const rank = supported.reduce((sum, item) => sum + (item.origin === 'suggested' ? 2 : item.importance === 'required' ? 10 : 6), 0)
    + routes.reduce((sum, route) => sum + ({peer: 8, executive_hiring: 3, recruiter: 4, introducer: 2}[route.kind]), 0)
    + (shared ? 1 : 0) - contradicted.length * 8 - conflicting.length * 4;
  const result: CandidateAssessment = {goalId: goal.id, goalVersion: goal.version, candidateKey: candidate.key, label, status,
    reasons: details.map(item => item.text), reasonDetails: details, unknowns, criteria, contactRoutes: routes,
    evidenceCoverage: {total: criteria.length, supported: supported.length, contradicted: contradicted.length, conflicting: conflicting.length,
      unknown: criteria.filter(item => item.status === 'unknown').length, observedClaims: candidateClaims.filter(sourceIsFactual).length, completeProfile: candidate.completeProfile},
    rank, isMatch: Boolean(supported.length || routes.length) && (!requiredContradiction || Boolean(options.includeContradicted)),
    sharedEmployer: shared?.contact.text ?? null, companyOverlap: overlap ? structuredClone(overlap) : null,
    evidenceKey: snapshot ? evidenceKey([prepared.goalKey, sortedEvidence(candidateClaims), prepared.selfKey, candidate.completeProfile, overlap]) : ''};
  return snapshot ? deepFreeze(result) : result;
}

/** Temporary typed fields are used only for ordering plain records. Their IDs never leave this module. */
function plainRecordScore(goal: Goal, input: CandidateInput, prepared: PreparedAssessment, options: AssessmentOptions, cache: Map<string, Pick<CandidateAssessment, 'rank' | 'isMatch'>>): Pick<CandidateAssessment, 'rank' | 'isMatch'> | null {
  if (input.claims?.length || input.anchors?.length || (typeof input.manualContext === 'string' ? input.manualContext.trim() : input.manualContext?.length)) return null;
  const clean = (value: string | undefined) => cleanText(value ?? '').trim();
  const sourceKind = input.sourceKind ?? (input.firstName !== undefined ? 'archive' : 'record');
  const values: [EvidenceField, string][] = [['company', clean(input.company)], ['role', clean(input.position || input.role)],
    ['industry', clean(input.industry)], ['location', clean(input.location)], ['stage', clean(input.stage)], ['check_size', clean(input.check_size)]];
  // Company spelling changes the returned explanation, but ordering only depends on exact shared-employer membership.
  const key = JSON.stringify([sourceKind, prepared.selfCompanies.has(companyKey(values[0][1])), ...values.slice(1).map(([, value]) => value)]);
  const previous = cache.get(key); if (previous) return previous;
  const claims: EvidenceClaim[] = values.filter(([, value]) => value).map(([field, text]) => ({id: `temporary:${field}`, subject: 'candidate', field, text,
    sourceKind, sourceLabel: '', confidence: 'observed', appliesTo: 'contact'}));
  const result = assess(goal, {key: '', name: '', company: values[0][1], claims, profileReadAt: null, completeProfile: false, companyOverlap: null}, options, prepared, false);
  const score = {rank: result.rank, isMatch: result.isMatch}; cache.set(key, score); return score;
}

export function assessCandidate(goal: Goal, candidate: CandidateInput | CandidateEvidence, selfEvidence: readonly EvidenceClaim[] = [], options: AssessmentOptions = {}): CandidateAssessment {
  try { return assess(goal, candidateEvidence(candidate), options, prepare(goal, selfEvidence)); }
  finally { tokenCache.clear(); alternativeCache.clear(); }
}
/** Returns actual evidence/route matches only. Nothing is padded to the requested limit. */
export function rankGoalNetwork(goal: Goal, connections: readonly CandidateInput[], selfEvidence: readonly EvidenceClaim[] = [], options: AssessmentOptions = {}): readonly RankedGoalCandidate[] {
  try { return rankNetwork(goal, connections, selfEvidence, options); }
  finally { tokenCache.clear(); alternativeCache.clear(); }
}
function rankNetwork(goal: Goal, connections: readonly CandidateInput[], selfEvidence: readonly EvidenceClaim[], options: AssessmentOptions): readonly RankedGoalCandidate[] {
  const limit = options.limit === undefined ? 50 : Math.max(0, Math.floor(options.limit));
  if (!Number.isFinite(limit)) throw new TypeError('The result limit must be finite.');
  if (!limit) return Object.freeze([]);
  const prepared = prepare(goal, selfEvidence);
  const pool = new Map<string, CandidateInput[]>();
  for (const person of connections) {
    const key = candidateKey(person); const previous = pool.get(key);
    if (previous) previous.push(person); else pool.set(key, [person]);
  }
  const scores = new Map<string, Pick<CandidateAssessment, 'rank' | 'isMatch'>>();
  const matches: {key: string; name: string; rank: number; person: CandidateInput; candidate?: CandidateEvidence}[] = [];
  for (const [key, people] of pool) {
    const person = people[0];
    let candidate: CandidateEvidence | undefined;
    let score = people.length === 1 ? plainRecordScore(goal, person, prepared, options, scores) : null;
    if (!score) {
      candidate = buildCandidateEvidence(person);
      for (const duplicate of people.slice(1)) {
        const added = buildCandidateEvidence(duplicate);
        candidate = {...candidate, claims: distinctEvidenceClaims([...candidate.claims, ...added.claims]),
          completeProfile: candidate.completeProfile || added.completeProfile, profileReadAt: candidate.profileReadAt ?? added.profileReadAt};
      }
      score = assess(goal, candidate, options, prepared, false);
    }
    if (score.isMatch) matches.push({key, name: cleanText(person.name || person.person || `${person.firstName || ''} ${person.lastName || ''}`).trim(), rank: score.rank, person, candidate});
  }
  return deepFreeze(matches.sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name) || a.key.localeCompare(b.key)).slice(0, limit)
    .map(({person, candidate: preparedCandidate}) => {
      const candidate = preparedCandidate ?? buildCandidateEvidence(person);
      return {...assess(goal, candidate, options, prepared), candidate, person: structuredClone(person)};
    }));
}
