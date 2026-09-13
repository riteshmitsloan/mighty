import test from 'node:test';
import assert from 'node:assert/strict';
import {assessCandidate, matchesPhrase, rankGoalNetwork} from '../src/lib/assessment';
import {buildCandidateEvidence, createEvidenceClaim, type CandidateInput, type EvidenceClaim} from '../src/lib/evidence';
import type {Goal, GoalCriterion} from '../src/lib/goals';

const criterion = (changes: Partial<GoalCriterion> = {}): GoalCriterion => ({id: 'role', field: 'role', label: 'Finance leader', terms: ['CFO'], importance: 'required', appliesTo: 'contact', origin: 'user', ...changes});
const goal = (criteria: readonly GoalCriterion[] = [criterion()], changes: Partial<Goal> = {}): Goal => ({id: 'career-one', kind: 'career', title: 'A finance leadership role', outcome: 'Find a CFO opportunity', criteria, openQuestions: [], version: 1, status: 'active', createdAt: '2026-09-12T00:00:00Z', updatedAt: '2026-09-12T00:00:00Z', ...changes});
const claim = (changes: Partial<EvidenceClaim> = {}) => createEvidenceClaim({subject: 'candidate', field: 'industry', text: 'FMCG', sourceLabel: 'Confirmed conversation', sourceKind: 'manual', confidence: 'user_confirmed', appliesTo: 'contact', ...changes});
const industryGoal = () => goal([criterion({id: 'industry', field: 'industry', terms: ['FMCG'], label: 'FMCG sector'})], {kind: 'partnership'});

test('phrase boundaries avoid accidental substrings and different fundraising stages', () => {
  assert.equal(matchesPhrase('retail operations', 'AI'), false); assert.equal(matchesPhrase('AI operations', 'AI'), true);
  assert.equal(matchesPhrase('pre-seed', 'seed'), false); assert.equal(matchesPhrase('seed', 'seed'), true);
  assert.equal(matchesPhrase('vice president', 'president'), false);
});
test('role aliases match explicit evidence, while CEO assistants and vice presidents are not CEOs', () => {
  const g = goal([criterion({terms: ['CEO']})]);
  assert.equal(assessCandidate(g, {name: 'Sam', role: 'Chief Executive Officer'}).criteria[0].status, 'supported');
  for (const role of ['Executive Assistant to the CEO', 'Chief of Staff to the CEO', 'Not a CEO']) {
    const result = assessCandidate(g, {name: 'Sam', role});
    assert.equal(result.criteria[0].status === 'supported', false); assert.equal(result.contactRoutes.some(c => c.kind === 'executive_hiring'), false);
  }
  const vp = assessCandidate(g, {name: 'Sam', role: 'Vice President of Finance'});
  assert.equal(vp.criteria[0].status, 'unknown'); assert.deepEqual(vp.contactRoutes.map(route => route.kind), ['executive_hiring']);
});
test('VP leadership titles offer career contact routes without establishing a job or fundraising relevance', () => {
  const career = goal([criterion({terms: ['Chief AI Officer'], appliesTo: 'opportunity'})]);
  for (const role of ['Vice President of Research', 'VP R&D', 'V.P. R&D', 'SVP Engineering', 'S.V.P. Engineering', 'Senior Vice President', 'EVP Operations', 'E.V.P. Operations', 'Executive Vice President']) {
    const candidate = buildCandidateEvidence({name: 'Synthetic leader', role});
    const result = assessCandidate(career, candidate);
    assert.equal(result.status, 'possible_route', role); assert.equal(result.criteria[0].status, 'unknown', role);
    assert.deepEqual(result.contactRoutes.map(route => route.kind), ['executive_hiring'], role);
    assert.match(result.contactRoutes[0].reason, /hiring authority and openings remain unconfirmed/);
    assert.equal(candidate.claims.find(claim => claim.field === 'role')?.text, role);
    const fundraising = assessCandidate({...career, kind: 'fundraising'}, candidate);
    assert.equal(fundraising.status, 'unknown', role); assert.deepEqual(fundraising.contactRoutes, [], role);
  }
});
test('dotted leadership titles support only matching contact criteria and preserve negation', () => {
  for (const [term, role] of [['Vice President', 'V.P. R&D'], ['V.P.', 'Vice President'], ['Senior Vice President', 'S.V.P.'], ['EVP', 'E.V.P.']]) {
    const g = goal([criterion({terms: [term]})]);
    assert.equal(assessCandidate(g, {role}).criteria[0].status, 'supported', role);
    const negative = assessCandidate(g, {role: 'Not a ' + role});
    assert.equal(negative.criteria[0].status, 'contradicted', role); assert.deepEqual(negative.contactRoutes, [], role);
  }
});
test('assistants, advisors and people reporting to VP or CAIO do not inherit the executive or peer role', () => {
  const g = goal([criterion({terms: ['VP', 'SVP', 'EVP', 'CAIO']})]);
  for (const role of ['Assistant to the VP', 'Executive Assistant to V.P.', 'Advisor to the Vice President', 'Adviser for the SVP', 'Reports directly to the EVP', 'Reporting to Senior Vice President', 'Assistant Vice President', 'Chief of Staff to the Chief AI Officer', 'Advisor to CAIO', 'Not a Vice President', 'Never an EVP', 'No longer a V.P.']) {
    const result = assessCandidate(g, {role});
    assert.notEqual(result.criteria[0].status, 'supported', role); assert.deepEqual(result.contactRoutes, [], role);
  }
  const denied = claim({field: 'role', text: 'VP', polarity: 'negative'});
  assert.deepEqual(assessCandidate(g, {claims: [denied]}).contactRoutes, []);
});
test('CAIO and Chief AI Officer identify the same peer context while keeping opportunity evidence separate', () => {
  for (const [term, role] of [['Chief AI Officer', 'CAIO'], ['CAIO', 'Chief AI Officer'], ['Chief Artificial Intelligence Officer', 'C.A.I.O.']]) {
    const contactGoal = goal([criterion({terms: [term]})]);
    const result = assessCandidate(contactGoal, {role});
    assert.equal(result.criteria[0].status, 'supported', role);
    assert.deepEqual(result.contactRoutes.map(route => route.kind), ['peer', 'executive_hiring']);
    const opportunity = assessCandidate(goal([criterion({terms: [term], appliesTo: 'opportunity'})]), {role});
    assert.equal(opportunity.criteria[0].status, 'unknown');
    assert.match(opportunity.contactRoutes[0].reason, /not evidence of a vacancy/);
  }
  const headline = assessCandidate(goal([criterion({terms: ['CAIO']})]), {anchors: [{kind: 'headline', text: 'CAIO | V.P. Innovation'}]});
  assert.deepEqual(headline.contactRoutes, []); assert.equal(headline.criteria[0].status, 'unknown');
});
test('aspirational headlines do not create executive or peer routes, while an explicit rendered role does', () => {
  const g = goal([criterion({terms: ['CEO']})]);
  const sourceUrl = 'https://linkedin.com/in/synthetic-person#experience';
  const aspirant = {name: 'Synthetic aspirant', anchors: [{kind: 'headline', text: 'Exploring CEO roles', sourceUrl}]};
  const result = assessCandidate(g, aspirant);
  assert.equal(result.criteria[0].status, 'unknown'); assert.deepEqual(result.contactRoutes, []);
  assert.equal(result.isMatch, false); assert.deepEqual(rankGoalNetwork(g, [aspirant]), []);
  const explicit = buildCandidateEvidence({name: 'Synthetic executive', anchors: [
    {kind: 'headline', text: 'Exploring new projects'},
    {kind: 'experience', field: 'role', text: 'Chief Executive Officer', sourceUrl},
  ]});
  const supported = assessCandidate(g, explicit);
  const role = explicit.claims.find(item => item.field === 'role')!;
  assert.equal(supported.criteria[0].status, 'supported');
  assert.deepEqual(supported.contactRoutes.map(route => route.kind), ['peer', 'executive_hiring']);
  assert.ok(supported.contactRoutes.every(route => route.claimIds.includes(role.id)));
  assert.equal(role.sourceRef, sourceUrl);
});
test('typed profile roles remain contact evidence and residence does not establish an opportunity location', () => {
  const g = goal([criterion({terms: ['CEO'], appliesTo: 'opportunity'}),
    criterion({id: 'geo', field: 'location', label: 'Boston opportunity', terms: ['Boston'], appliesTo: 'opportunity'})]);
  const result = assessCandidate(g, {name: 'Synthetic executive', anchors: [
    {kind: 'experience', field: 'role', text: 'CEO'},
    {kind: 'location', text: 'Boston'},
  ]});
  assert.ok(result.criteria.every(item => item.status === 'unknown'));
  assert.ok(result.contactRoutes.some(route => route.kind === 'executive_hiring'));
  const observedOpportunity = assessCandidate(g, {name: 'Synthetic executive', anchors: [
    {kind: 'experience', field: 'role', text: 'CEO'},
    {kind: 'location', text: 'Chicago'},
    {kind: 'opportunity', field: 'location', appliesTo: 'opportunity', text: 'Boston'},
  ]});
  assert.equal(observedOpportunity.criteria[0].status, 'unknown');
  assert.equal(observedOpportunity.criteria[1].status, 'supported');
});
test('company names never manufacture FMCG evidence; an explicit sector alias does', () => {
  assert.equal(assessCandidate(industryGoal(), {name: 'Sam', company: 'Unilever'}).criteria[0].status, 'unknown');
  const explicit = assessCandidate(industryGoal(), {name: 'Sam', industry: 'Fast-moving consumer goods'});
  assert.equal(explicit.criteria[0].status, 'supported'); assert.ok(explicit.criteria[0].claimIds.length);
});
test('criterion states distinguish explicit support, denial, absence and conflicting source observations', () => {
  const positive = claim(); const negative = claim({polarity: 'negative', sourceLabel: 'Later confirmation'});
  assert.equal(assessCandidate(industryGoal(), {claims: [positive]}).criteria[0].status, 'supported');
  assert.equal(assessCandidate(industryGoal(), {claims: [negative]}).criteria[0].status, 'contradicted');
  assert.equal(assessCandidate(industryGoal(), {}).criteria[0].status, 'unknown');
  const conflict = assessCandidate(industryGoal(), {claims: [positive, negative]});
  assert.equal(conflict.criteria[0].status, 'conflicting'); assert.deepEqual(new Set(conflict.criteria[0].claimIds), new Set([positive.id, negative.id]));
});
test('a different company, role or sector does not imply contradiction without an explicit exclusive assertion', () => {
  assert.equal(assessCandidate(industryGoal(), {industry: 'Software'}).criteria[0].status, 'unknown');
  const explicit = claim({text: 'Software only', exclusive: true});
  assert.equal(assessCandidate(industryGoal(), {claims: [explicit]}).criteria[0].status, 'contradicted');
});
test('negation applies within a clause and not-only wording does not become denial', () => {
  assert.equal(assessCandidate(industryGoal(), {industry: 'We do not work in FMCG'}).criteria[0].status, 'contradicted');
  assert.equal(assessCandidate(industryGoal(), {industry: 'Not banking. FMCG'}).criteria[0].status, 'supported');
  assert.equal(assessCandidate(industryGoal(), {industry: 'Not only FMCG'}).criteria[0].status, 'supported');
});
test('contact residence cannot exclude an opportunity in another country', () => {
  const g = goal([criterion({appliesTo: 'opportunity'}), criterion({id: 'geo', field: 'location', label: 'India opportunity', terms: ['India'], appliesTo: 'opportunity'})]);
  const result = assessCandidate(g, {name: 'Sam', role: 'CEO', location: 'United States'});
  assert.equal(result.criteria[1].status, 'unknown'); assert.equal(result.isMatch, true); assert.equal(result.status, 'possible_route');
  assert.ok(result.unknowns.some(text => text.includes('opportunity location')));
});
test('an observed opportunity has separate role and location claims from its contact', () => {
  const g = goal([criterion({appliesTo: 'opportunity'}), criterion({id: 'geo', field: 'location', label: 'India opportunity', terms: ['India'], appliesTo: 'opportunity'})]);
  const result = assessCandidate(g, {role: 'Recruiter', location: 'UK', claims: [claim({field: 'role', text: 'CFO', appliesTo: 'opportunity'}), claim({field: 'location', text: 'India', appliesTo: 'opportunity'})]});
  assert.ok(result.criteria.every(c => c.status === 'supported')); assert.ok(result.contactRoutes.some(c => c.kind === 'recruiter'));
});
test('career routes keep executive, recruiter, peer and shared-employer introduction evidence distinct from openings', () => {
  const own = claim({subject: 'self', field: 'company', text: 'Acme'});
  const g = goal([criterion({appliesTo: 'opportunity'})]);
  const executive = assessCandidate(g, {name: 'Alex', role: 'CEO'}, [own]);
  const recruiter = assessCandidate(g, {name: 'Blair', role: 'Talent Acquisition Partner'}, [own]);
  const peer = assessCandidate(g, {name: 'Casey', role: 'CFO'}, [own]);
  const introducer = assessCandidate(g, {name: 'Drew', company: 'Acme', role: 'Designer'}, [own]);
  assert.deepEqual(executive.contactRoutes.map(r => r.kind), ['executive_hiring']);
  assert.deepEqual(recruiter.contactRoutes.map(r => r.kind), ['recruiter']);
  assert.ok(peer.contactRoutes.some(r => r.kind === 'peer')); assert.deepEqual(introducer.contactRoutes.map(r => r.kind), ['introducer']);
  for (const result of [executive, recruiter, peer, introducer]) assert.equal(result.criteria[0].status, 'unknown');
});
test('self evidence, writing, synthesis and unverified web snippets cannot satisfy candidate criteria', () => {
  const own = claim({subject: 'self'}); const derived = claim({sourceKind: 'knowledge', derivedFrom: ['raw-one']});
  const written = claim({sourceKind: 'writing'}); const web = claim({sourceKind: 'web'});
  const result = assessCandidate(industryGoal(), {claims: [own, derived, written, web]}, [own]);
  assert.equal(result.criteria[0].status, 'unknown'); assert.equal(result.isMatch, false);
});
test('only user-required contradictions exclude matches; suggested criteria remain reviewable', () => {
  const sector = criterion({id: 'sector', field: 'industry', terms: ['FMCG'], label: 'Sector'});
  const person = {role: 'CFO', claims: [claim({polarity: 'negative'})]};
  assert.equal(assessCandidate(goal([criterion(), sector]), person).isMatch, false);
  assert.equal(assessCandidate(goal([criterion(), {...sector, origin: 'suggested'}]), person).isMatch, true);
  assert.equal(assessCandidate(goal([criterion(), {...sector, importance: 'preferred'}]), person).isMatch, true);
  assert.equal(assessCandidate(goal([criterion(), sector]), person, [], {includeContradicted: true}).isMatch, true);
});
test('shared employer and validated overlap facts survive ranking without altering source spelling', () => {
  const own = claim({subject: 'self', field: 'company', text: 'Acme &amp; Sons'});
  const overlap = {company: 'Acme & Sons', count: 7, statement: 'You already know 7 people at Acme & Sons'};
  const result = rankGoalNetwork(goal(), [{name: 'Sam', company: 'Acme & Sons', role: 'CFO', companyOverlap: overlap}], [own])[0];
  assert.equal(result.sharedEmployer, 'Acme & Sons'); assert.deepEqual(result.companyOverlap, overlap);
  assert.ok(result.reasons.includes(`${overlap.statement}.`)); assert.ok(result.reasonDetails.some(r => r.claimIds.includes(own.id)));
  assert.equal(Object.isFrozen(overlap), false);
  assert.equal(assessCandidate(goal(), {role: 'CFO', company: 'Other', companyOverlap: overlap}).companyOverlap, null);
  assert.equal(assessCandidate(goal(), {role: 'CFO', company: 'Acme & Sons', companyOverlap: {...overlap, statement: 'Many powerful contacts'}}).companyOverlap, null);
});
test('rankings use each goal separately and never pad missing matches to a requested count', () => {
  const pool = [{name: 'A', industry: 'FMCG'}, {name: 'B', industry: 'Software'}, {name: 'C', company: 'Unilever'}];
  assert.deepEqual(rankGoalNetwork(industryGoal(), pool, [], {limit: 10}).map(r => r.candidate.name), ['A']);
  const software = goal([criterion({field: 'industry', terms: ['Software']})], {id: 'software', kind: 'partnership'});
  assert.deepEqual(rankGoalNetwork(software, pool).map(r => r.candidate.name), ['B']);
  assert.deepEqual(rankGoalNetwork(industryGoal(), [pool[2]]), []); assert.deepEqual(rankGoalNetwork(industryGoal(), pool, [], {limit: 0}), []);
  assert.throws(() => rankGoalNetwork(industryGoal(), pool, [], {limit: Infinity}), /finite/);
});
test('duplicate candidate identities combine evidence instead of discarding a conflicting source', () => {
  const positive = claim(); const negative = claim({polarity: 'negative', sourceLabel: 'Second source'});
  const result = rankGoalNetwork(industryGoal(), [{key: 'sam', name: 'Sam', claims: [positive]}, {key: 'sam', name: 'Sam', claims: [negative], role: 'CFO'}]);
  // A conflict alone is not a positive match; it must not disappear into a false supported result.
  assert.deepEqual(result, []);
  const withSupport = rankGoalNetwork(goal(), [{key: 'sam', name: 'Sam', role: 'CFO', claims: [positive]}, {key: 'sam', name: 'Sam', claims: [negative]}]);
  assert.equal(withSupport.length, 1); assert.ok(withSupport[0].candidate.claims.some(c => c.id === negative.id));
});
test('all criterion citations resolve to candidate claims and route citations resolve to candidate or self evidence', () => {
  const own = claim({subject: 'self', field: 'company', text: 'Acme'}); const person = buildCandidateEvidence({name: 'Sam', company: 'Acme', role: 'CFO', industry: 'FMCG'});
  const result = assessCandidate(goal([criterion(), criterion({id: 'sector', field: 'industry', terms: ['FMCG']})]), person, [own]);
  const candidateIds = new Set(person.claims.map(c => c.id)); const allIds = new Set([...candidateIds, own.id]);
  assert.ok(result.criteria.every(c => c.claimIds.every(id => candidateIds.has(id))));
  assert.ok(result.reasonDetails.every(r => r.claimIds.every(id => allIds.has(id))));
});
test('assessment keys change with goal version, source content, provenance or self-evidence deletion', () => {
  const g = goal(); const person = {name: 'Sam', role: 'CFO'}; const own = claim({subject: 'self', field: 'company', text: 'Acme'});
  const first = assessCandidate(g, person, [own]);
  assert.notEqual(first.evidenceKey, assessCandidate({...g, version: 2}, person, [own]).evidenceKey);
  assert.notEqual(first.evidenceKey, assessCandidate(g, {...person, role: 'CEO'}, [own]).evidenceKey);
  assert.notEqual(first.evidenceKey, assessCandidate(g, {...person, sourceLabel: 'Different source'}, [own]).evidenceKey);
  assert.notEqual(first.evidenceKey, assessCandidate(g, person, []).evidenceKey);
  assert.equal(first.evidenceKey, rankGoalNetwork(g, [person], [own])[0].evidenceKey);
});
test('ranking freezes its own result but does not freeze or mutate caller inputs', () => {
  const person = {name: 'Sam', role: 'CFO', manualContext: ['Met at an event']}; const g = goal(); const before = JSON.stringify([g, person]);
  const result = rankGoalNetwork(g, [person]); assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result[0].person));
  assert.equal(Object.isFrozen(person), false); assert.equal(Object.isFrozen(person.manualContext), false); assert.equal(Object.isFrozen(g.criteria), false);
  assert.equal(JSON.stringify([g, person]), before); assert.equal('probability' in result[0], false);
});
test('an exact target-role peer ranks above a generic executive without pretending an opening exists', () => {
  const rows = rankGoalNetwork(goal([criterion({appliesTo: 'opportunity'})]), [{name: 'CEO first alphabetically', role: 'CEO'}, {name: 'Target peer', role: 'CFO'}]);
  assert.equal(rows[0].candidate.name, 'Target peer'); assert.ok(rows[0].rank > rows[1].rank);
  assert.equal(rows[0].contactRoutes[0].kind, 'peer'); assert.match(rows[0].reasons[0], /overlaps the target role/);
  assert.ok(rows.every(row => row.criteria[0].status === 'unknown'));
});
test('deferred snapshot ordering agrees with fully evaluated evidence across fields and source kinds', () => {
  const g = goal([criterion(), criterion({id: 'sector', field: 'industry', terms: ['FMCG'], importance: 'preferred'})]);
  const own = claim({subject: 'self', field: 'company', text: 'Company 7'});
  const pool: CandidateInput[] = Array.from({length: 300}, (_, i) => ({id: `row-${i}`, name: `Person ${String(i).padStart(3, '0')}`,
    role: ['CFO', 'CEO', 'Assistant to the CFO', 'Recruiter', 'Engineer'][i % 5], company: `Company ${i % 19}`,
    industry: ['FMCG', 'No FMCG', 'Software'][i % 3], sourceKind: i % 23 === 0 ? 'web' : 'archive'}));
  const expected = pool.map(person => ({person, result: assessCandidate(g, person, [own])})).filter(({result}) => result.isMatch)
    .sort((a, b) => b.result.rank - a.result.rank || a.person.name!.localeCompare(b.person.name!)).slice(0, 70);
  const actual = rankGoalNetwork(g, pool, [own], {limit: 70});
  assert.deepEqual(actual.map(row => [row.candidateKey, row.rank, row.evidenceKey]), expected.map(({result}) => [result.candidateKey, result.rank, result.evidenceKey]));
  assert.ok(actual.every(row => row.candidate.claims.every(c => !c.id.startsWith('temporary:'))));
});
