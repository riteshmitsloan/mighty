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
  readonly kind: 'executive_hiring' | 'senior_contact' | 'recruiter' | 'peer' | 'introducer' | 'investor' | 'hiring_signal';
  readonly label: string;
  readonly reason: string;
  readonly claimIds: readonly string[];
  /** A literal self-description, never typed current-role or opportunity evidence. */
  readonly provisional?: boolean;
}
export interface SharedContext {readonly kind: 'employer' | 'education' | 'skill' | 'work'; readonly text: string; readonly claimIds: readonly string[]}
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
  readonly sharedContext?: readonly SharedContext[];
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

/** Preserve reviewed dotted titles before tokenization or sentence splitting.
 * The original claim and its source text remain unchanged. */
function roleAbbreviations(value: string): string {
  return value.replace(/\b(?:S\.V\.P\.?|E\.V\.P\.?|V\.P\.?|C\.A\.I\.O\.?)(?=$|[\s,;:!?/()&-])/gi, title => title.replace(/\./g, ''));
}
export function phraseTokens(value: string): string[] {
  return roleAbbreviations(value.normalize('NFKC')).toLocaleLowerCase('en-US').replace(/&amp;/g, '&').replace(/&/g, ' and ')
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}
const normalized = (value: string) => phraseTokens(value).join(' ');
const ALIASES: readonly (readonly string[])[] = [
  ['ceo', 'chief executive officer'], ['cfo', 'chief financial officer'], ['coo', 'chief operating officer'],
  ['cto', 'chief technology officer'], ['cmo', 'chief marketing officer'], ['chro', 'chief human resources officer'],
  ['caio', 'chief ai officer', 'chief artificial intelligence officer'],
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
// This exact label is assigned from anchor.kind by buildCandidateEvidence.
// Ordinary context, snippets and user prose cannot opt in by mentioning a title.
const headlineOrigin = (claim: EvidenceClaim) => claim.sourceKind === 'profile' && claim.sourceLabel === 'Rendered profile · headline';
const executiveTerms = ['ceo', 'cfo', 'coo', 'cto', 'cmo', 'chro', 'caio', 'vp', 'svp', 'evp', 'president', 'founder', 'managing director', 'general manager'];
const investorTerms = ['investor', 'angel investor', 'venture capitalist', 'vc', 'venture partner', 'investment partner'];
const recruiterTerms = ['recruiter', 'recruiting', 'executive search', 'talent acquisition', 'headhunter'];
const unsafeRoleContext = /\b(?:aspir(?:ing|ational|e)|seeking|seek|looking|exploring|former|formerly|previous|previously|retired|ex|wannabe|want|wants|become|becoming|not|never|without|no|assistant|assistants|advisors?|advisers?|coaching|coach|helping|supporting|reporting|reports|candidate|candidates|student|students|intern|internship)\b|\b(?:open to|in search|chief of staff|office of|working with)\b/;
const uncurrentRole = (value: string) => /\b(?:aspir(?:ing|ational|e)|seeking|looking|exploring|former|formerly|previous|previously|retired|ex|wannabe|become|becoming)\b|\b(?:open to|in search)\b/.test(cachedTokens(value).join(' '));
function titleSegments(value: string): string[] {
  return roleAbbreviations(value).split(/[|•·;,\n]|\s[&/–—]\s|\s+and\s+/i).map(part => cachedTokens(part).join(' ')).filter(Boolean);
}
function titleStarts(segment: string, term: string): boolean {
  return alternatives(term).some(alias => segment === alias || segment.startsWith(alias + ' '));
}
function investorAuxiliary(value: string): boolean {
  return /\binvestor (?:relations|services|communications|network|community|education|support|in people)\b|\b(?:vc|venture capitalist|venture partner|investment partner) (?:analyst|associate|intern|assistant|operations|services|research|relations|community|network)\b/.test(cachedTokens(value).join(' '));
}
function explicitInvestorRole(value: string): boolean {
  const whole = cachedTokens(value).join(' ');
  return !unsafeRoleContext.test(whole) && !investorAuxiliary(value)
    && titleSegments(value).some(segment => investorTerms.some(term => titleStarts(segment, term)));
}
function explicitSeniorRole(value: string, provisional = false): boolean {
  return !unsafeRoleContext.test(cachedTokens(value).join(' ')) && titleSegments(value).some(segment =>
    /^(?:(?:senior|executive|global|regional|group|managing) )?director(?: |$)/.test(segment)
    || (!provisional && /\bdirector\b/.test(segment))
    || /^(?:(?:senior|global|regional) )?(?:engineering|research|finance|marketing|sales|product|operations|technology|people|hr|design|creative|strategy) director(?: |$)/.test(segment)
    || /^head of [a-z]/.test(segment) || /^chief (?:[a-z]+ ){1,5}officer(?: |$)/.test(segment));
}
function eligibleHeadline(claim: EvidenceClaim): boolean {
  if (!headlineOrigin(claim) || claim.field !== 'context' || claim.appliesTo !== 'contact' || claim.polarity === 'negative' || !sourceIsFactual(claim)
    || !claim.observedAt || !Number.isFinite(Date.parse(claim.observedAt)) || unsafeRoleContext.test(cachedTokens(claim.text).join(' '))) return false;
  try {
    const url = new URL(claim.sourceRef ?? '');
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && ['www.linkedin.com', 'linkedin.com'].includes(url.hostname)
      && /^\/in\/[^/?#]+\/?$/.test(url.pathname);
  } catch {return false;}
}
function headlineTitle(claim: EvidenceClaim, terms: readonly string[]): boolean {
  return titleSegments(claim.text).some(segment => terms.some(term => titleStarts(segment, term))
    && !/\b(?:search|jobs?|roles?|opportunities|tips|advice|solutions|tools?|relations|network|community)\b/.test(segment));
}
function hiringHeadline(claim: EvidenceClaim): boolean {
  return titleSegments(claim.text).some(segment => /^(?:(?:we are|we re|i am|i m|currently|actively) )?hiring(?: |$)/.test(segment)
    && !/\bhiring (?:managers?|process|advice|tips|news|solutions|strategy|trends|expert|tools?|consultant|services)\b/.test(segment));
}
const executiveAliases = new Set(executiveTerms.flatMap(alternatives));
const isExecutiveTerm = (term: string) => executiveAliases.has(alternatives(term)[0]);
function auxiliaryExecutiveRole(value: string, term: string): boolean {
  if (!isExecutiveTerm(term)) return false;
  const whole = cachedTokens(value).join(' ');
  return /(?:^| )(?:assistants?|advisors?|advisers?|chief of staff|office|reporting|reports)(?: directly)?(?: (?:to|of|for))? (?:the )?(?:(?:senior|executive) )?(?:ceo|cfo|coo|cto|cmo|chro|caio|vp|svp|evp|vice president|chief|president|founder|managing director|general manager)(?: |$)/.test(whole)
    || alternatives(term).some(alias => ['assistant', 'advisor', 'adviser', 'coach', 'recruiter', 'recruitment', 'search', 'office'].some(suffix => ` ${whole} `.includes(` ${alias} ${suffix} `) || ` ${whole} `.includes(` ${alias} s ${suffix} `)));
}
function auxiliaryRole(value: string, term: string): boolean {
  if (auxiliaryExecutiveRole(value, term)) return true;
  const context = cachedTokens(value).join(' '), wanted = normalized(term);
  if (investorTerms.includes(wanted)) return investorAuxiliary(value) || /\b(?:assistant|advisors?|advisers?|chief of staff)\b/.test(context);
  return /^(?:director|head of)(?: |$)/.test(wanted) && /\b(?:assistant|advisors?|advisers?|chief of staff)\b/.test(context);
}
function evaluateCriterion(criterion: GoalCriterion, claims: readonly EvidenceClaim[]): CriterionAssessment {
  const supported = new Set<string>(), contradicted = new Set<string>(), matched = new Set<string>();
  const usable = claims.filter(item => item.subject === 'candidate' && sourceIsFactual(item) && !headlineOrigin(item) && !(item.field === 'role' && uncurrentRole(item.text)) && item.appliesTo === criterion.appliesTo
    && (item.field === criterion.field || (criterion.field === 'custom' && ['context', 'custom', 'skill', 'education'].includes(item.field))));
  const terms = criterion.terms.filter(term => normalized(term));
  for (const item of usable) {
    let hadPositive = false;
    for (const term of terms) {
      if (criterion.field === 'role' && auxiliaryRole(item.text, term)) continue;
      for (const alias of alternatives(term)) {
        for (const clause of roleAbbreviations(item.text).split(/[.!?;\n]/u)) {
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
  readonly sharedFacts: ReadonlyMap<EvidenceField, ReadonlyMap<string, EvidenceClaim>>;
}
/** Conversation topics need substantive positive facts, not matching empty cells
 * or dates. This gate is deliberately conservative for mixed/negated prose. */
function usableSharedTopic(claim: EvidenceClaim): boolean {
  const tokens = cachedTokens(claim.text), value = tokens.join(' ');
  if (!/[\p{L}]/u.test(value) || /^(?:none|unknown|unspecified|undisclosed|unavailable|n a|na|nil|null|tbd|not applicable|not provided|not available)(?: listed| provided| recorded| available)?$/.test(value)) return false;
  if (tokens.some((token, index) => ['not', 'no', 'never', 'without'].includes(token) && tokens[index + 1] !== 'only')) return false;
  if (claim.field === 'education' && /(?:date|year|month|start|end)/i.test(claim.sourceLabel.split('·').at(-1) ?? '')) return false;
  const dateTokens = /^(?:\d{1,4}|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|spring|summer|fall|autumn|winter|to|through|until|since|present|current|now)$/;
  return !(tokens.some(token => /^\d{1,4}$/.test(token)) && tokens.every(token => dateTokens.test(token)));
}
function prepare(goal: Goal, selfEvidence: readonly EvidenceClaim[]): PreparedAssessment {
  const sharedFacts = new Map<EvidenceField, Map<string, EvidenceClaim>>();
  for (const item of selfEvidence) {
    if (item.subject !== 'self' || !['education', 'skill', 'role'].includes(item.field) || item.appliesTo !== 'contact' || item.polarity === 'negative'
      || !sourceIsFactual(item) || headlineOrigin(item) || item.text.length > 200 || !usableSharedTopic(item)) continue;
    if (item.field === 'role' && unsafeRoleContext.test(cachedTokens(item.text).join(' '))) continue;
    const values = sharedFacts.get(item.field) ?? new Map<string, EvidenceClaim>();
    values.set(normalized(item.text), item); sharedFacts.set(item.field, values);
  }
  return {goalKey: evidenceKey(goal), selfKey: evidenceKey(sortedEvidence(selfEvidence)),
    sharedFacts,
    selfCompanies: new Map(selfEvidence.filter(item => item.subject === 'self' && item.field === 'company' && item.appliesTo === 'contact'
      && sourceIsFactual(item) && !headlineOrigin(item) && item.polarity !== 'negative').map(item => [companyKey(item.text), item]))};
}
function sharedTopics(claims: readonly EvidenceClaim[], prepared: PreparedAssessment, shared?: {contact: EvidenceClaim; own: EvidenceClaim}): SharedContext[] {
  const result: SharedContext[] = shared && usableSharedTopic(shared.contact) && usableSharedTopic(shared.own) ? [{kind: 'employer', text: `Employer in common: “${shared.contact.text}”.`, claimIds: [shared.contact.id, shared.own.id]}] : [];
  for (const field of ['education', 'skill', 'role'] as const) {
    const own = prepared.sharedFacts.get(field); if (!own?.size) continue;
    for (const candidate of claims) {
      if (candidate.field !== field || candidate.appliesTo !== 'contact' || candidate.polarity === 'negative' || !sourceIsFactual(candidate) || headlineOrigin(candidate) || !usableSharedTopic(candidate)) continue;
      const value = normalized(candidate.text);
      let match = own.get(value);
      if (!match && field === 'role') match = alternatives(candidate.text).map(alias => own.get(alias)).find(Boolean);
      // Rendered education/skills are often a whole section. Only a literal,
      // whole-phrase self fact can supply an overlap, never general context prose.
      if (!match && field !== 'role' && candidate.sourceKind === 'profile') match = [...own.values()].find(item => findPhrase(candidate.text, item.text).some(found => !found.negative));
      if (!match) continue;
      const kind = field === 'role' ? 'work' : field;
      const topic = field === 'role' ? `Work in common: “${match.text}”.`
        : field === 'skill' ? `Shared skill: “${match.text}”.` : `Shared education: “${match.text}”.`;
      result.push({kind, text: topic, claimIds: [match.id, candidate.id]}); break;
    }
  }
  return result;
}
function assess(goal: Goal, candidate: CandidateEvidence, options: AssessmentOptions, prepared: PreparedAssessment, snapshot = true): CandidateAssessment {
  const candidateClaims = candidate.claims.filter(item => item.subject === 'candidate' && (!item.subjectKey || item.subjectKey === candidate.key));
  const criteria = goal.criteria.map(criterion => evaluateCriterion(criterion, candidateClaims));
  const roles = candidateClaims.filter(item => item.field === 'role' && item.appliesTo === 'contact' && sourceIsFactual(item) && !headlineOrigin(item) && !uncurrentRole(item.text) && item.polarity !== 'negative');
  const headlines = candidateClaims.filter(eligibleHeadline);
  const companyClaims = candidateClaims.filter(item => item.field === 'company' && item.appliesTo === 'contact' && sourceIsFactual(item) && !headlineOrigin(item) && item.polarity !== 'negative');
  const sharedContact = companyClaims.find(item => prepared.selfCompanies.has(companyKey(item.text)));
  const shared = sharedContact ? {contact: sharedContact, own: prepared.selfCompanies.get(companyKey(sharedContact.text))!} : undefined;
  const routes: ContactRoute[] = [];
  const provisionalRoute = (kind: ContactRoute['kind'], label: string, matching: readonly EvidenceClaim[], caveat: string) => {
    if (!matching.length || routes.some(route => route.kind === kind)) return;
    routes.push({kind, label, provisional: true, reason: `${caveat} Headline: “${matching[0].text}”.`, claimIds: matching.map(item => item.id)});
  };
  if (goal.kind === 'career') {
    const executives = roles.filter(item => executiveTerms.some(term => !auxiliaryExecutiveRole(item.text, term)
      && alternatives(term).some(alias => findPhrase(item.text, alias).some(match => !match.negative))));
    if (executives.length) routes.push({kind: 'executive_hiring', label: 'Executive contact route',
      reason: 'A recorded executive role offers a possible career contact route; hiring authority and openings remain unconfirmed.', claimIds: executives.map(item => item.id)});
    const seniors = roles.filter(item => !executives.includes(item) && explicitSeniorRole(item.text));
    if (seniors.length) routes.push({kind: 'senior_contact', label: 'Senior contact route',
      reason: 'A recorded senior role offers a possible career conversation or introduction route; their access and willingness to help are unconfirmed.', claimIds: seniors.map(item => item.id)});
    const recruiters = roles.filter(item => recruiterTerms
      .some(term => findPhrase(item.text, term).some(match => !match.negative)));
    if (recruiters.length) routes.push({kind: 'recruiter', label: 'Recruiter route',
      reason: 'A recorded recruiting role offers a possible career contact route; current mandates are unknown.', claimIds: recruiters.map(item => item.id)});
    const roleCriteria = goal.criteria.filter(item => item.field === 'role');
    const opportunityRoles = roleCriteria.filter(item => item.appliesTo === 'opportunity');
    const targetRoles = (opportunityRoles.length ? opportunityRoles : roleCriteria).flatMap(item => item.terms);
    const peers = roles.filter(item => targetRoles.some(term => !auxiliaryRole(item.text, term)
      && alternatives(term).some(alias => findPhrase(item.text, alias).some(match => !match.negative))));
    if (peers.length) routes.push({kind: 'peer', label: 'Peer route', reason: 'Their recorded role overlaps the target role; this is peer context, not evidence of a vacancy.', claimIds: peers.map(item => item.id)});
    if (shared) routes.push({kind: 'introducer', label: 'Shared-employer route', reason: `Both records name ${shared.contact.text}; an introduction may be worth discussing, but target access is unknown.`, claimIds: [shared.contact.id, shared.own.id]});
    const titledHeadlines = headlines.filter(item => headlineTitle(item, [...executiveTerms, ...recruiterTerms]) || explicitSeniorRole(item.text, true)
      || titleSegments(item.text).some(segment => /^(?:(?:senior|principal|staff|lead) )?(?:software engineer|data scientist|product manager|engineer|scientist|designer|architect|professor|hiring manager)(?: |$)/.test(segment)));
    provisionalRoute('peer', 'Self-described peer route', titledHeadlines.filter(item => headlineTitle(item, targetRoles)), 'A self-described role may be useful peer context; the current role and openings are unconfirmed.');
    provisionalRoute('recruiter', 'Self-described recruiter route', headlines.filter(item => headlineTitle(item, recruiterTerms)), 'A self-described recruiting role may offer a career contact; current mandates are unconfirmed.');
    provisionalRoute('executive_hiring', 'Self-described executive route', headlines.filter(item => headlineTitle(item, executiveTerms)), 'A self-described executive role may offer a career contact; hiring authority and introductions are unconfirmed.');
    provisionalRoute('senior_contact', 'Self-described senior route', headlines.filter(item => explicitSeniorRole(item.text, true) && !headlineTitle(item, executiveTerms)), 'A self-described senior role may offer a career conversation; access and willingness to introduce are unconfirmed.');
    provisionalRoute('hiring_signal', 'Self-described hiring signal', headlines.filter(hiringHeadline), 'The headline signals hiring interest; a current vacancy and its fit are unconfirmed.');
  }
  if (goal.kind === 'fundraising') {
    const investors = roles.filter(item => explicitInvestorRole(item.text));
    if (investors.length) routes.push({kind: 'investor', label: 'Investor contact route',
      reason: 'A recorded investor role offers a possible fundraising contact; current investment mandate, stage, check size and willingness are unconfirmed.', claimIds: investors.map(item => item.id)});
    provisionalRoute('investor', 'Self-described investor route', headlines.filter(item => explicitInvestorRole(item.text)), 'A self-described investor role may offer a funding conversation; mandate, stage and check size are unconfirmed.');
  }
  const routePriority = {peer: 0, investor: 0, hiring_signal: 1, recruiter: 2, executive_hiring: 3, senior_contact: 4, introducer: 5};
  routes.sort((a, b) => routePriority[a.kind] - routePriority[b.kind]);
  const supported = criteria.filter(item => item.status === 'supported'), conflicting = criteria.filter(item => item.status === 'conflicting');
  const contradicted = criteria.filter(item => item.status === 'contradicted');
  const requiredContradiction = contradicted.some(item => item.importance === 'required' && item.origin === 'user');
  const status = conflicting.length ? 'conflicting' : requiredContradiction ? 'contradicted' : supported.length ? 'supported' : routes.length ? 'possible_route' : 'unknown';
  const label = {conflicting: 'Conflicting evidence', contradicted: 'Evidence contradicts criteria', supported: 'Evidence supports some criteria', possible_route: 'Possible contact route', unknown: 'More evidence needed'}[status];
  const details = [...conflicting, ...supported, ...contradicted].map(item => ({text: item.reason, claimIds: item.claimIds}));
  details.push(...routes.map(route => ({text: route.reason, claimIds: route.claimIds})));
  if (shared && !routes.some(route => route.kind === 'introducer')) details.push({text: `Employer in common: “${shared.contact.text}”.`, claimIds: [shared.contact.id, shared.own.id]});
  const overlap = validOverlap(candidate, options);
  if (overlap) details.push({text: `${overlap.statement}.`, claimIds: companyClaims.filter(item => companyKey(item.text) === companyKey(overlap.company)).map(item => item.id)});
  const unknowns = criteria.filter(item => item.status === 'unknown').map(item => item.reason);
  if (routes.length) unknowns.push('Contact relevance does not establish an available opportunity or willingness to help.');
  if (routes.some(route => route.provisional)) unknowns.push('Headline signals are self-descriptions only; they do not confirm current roles or satisfy goal criteria.');
  if (!candidate.completeProfile) unknowns.push('A complete profile has not been established; these records may be partial or outdated.');
  if (!criteria.length) unknowns.push('Confirm at least one goal criterion to assess evidence against it.');
  const rank = supported.reduce((sum, item) => sum + (item.origin === 'suggested' ? 2 : item.importance === 'required' ? 10 : 6), 0)
    + routes.reduce((sum, route) => sum + (route.provisional ? 1 : {peer: 8, investor: 4, hiring_signal: 1, executive_hiring: 3, senior_contact: 3, recruiter: 4, introducer: 2}[route.kind]), 0)
    + (shared ? 1 : 0) - contradicted.length * 8 - conflicting.length * 4;
  const result: CandidateAssessment = {goalId: goal.id, goalVersion: goal.version, candidateKey: candidate.key, label, status,
    reasons: details.map(item => item.text), reasonDetails: details, unknowns, criteria, contactRoutes: routes, sharedContext: sharedTopics(candidateClaims, prepared, shared),
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
