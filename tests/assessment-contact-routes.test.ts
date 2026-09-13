import test from 'node:test';
import assert from 'node:assert/strict';
import {assessCandidate, rankGoalNetwork} from '../src/lib/assessment';
import {buildCandidateEvidence, createEvidenceClaim, type EvidenceClaim, type CandidateInput} from '../src/lib/evidence';
import {createGoal, type GoalCriterion} from '../src/lib/goals';

const url = 'https://www.linkedin.com/in/route-fixture/';
const observedAt = '2026-09-13T15:00:00.000Z';
const criterion = (patch: Partial<GoalCriterion> = {}): GoalCriterion => ({id: 'target', field: 'role', label: 'Target role', terms: ['Chief AI Officer'], importance: 'preferred', appliesTo: 'opportunity', origin: 'user', ...patch});
const career = (criteria: GoalCriterion[] = [criterion()]) => createGoal({kind: 'career', title: 'Next role', outcome: 'Find useful career conversations', criteria});
const funding = () => createGoal({kind: 'fundraising', title: 'Funding', outcome: 'Speak with investors', criteria: [criterion({terms: ['Investor', 'Angel Investor', 'Venture Capitalist', 'VC', 'Venture Partner', 'Investment Partner'], appliesTo: 'contact'}), criterion({id: 'stage', field: 'stage', label: 'Stage', terms: ['Seed'], appliesTo: 'opportunity'}), criterion({id: 'check', field: 'check_size', label: 'Check size', terms: ['$100k'], appliesTo: 'opportunity'})]});
const headline = (text: string): CandidateInput => ({name: 'Synthetic person', url, anchors: [{kind: 'headline', text, sourceUrl: url + '#profile', observedAt}]});
const own = (field: EvidenceClaim['field'], text: string, patch: Partial<EvidenceClaim> = {}) => createEvidenceClaim({subject: 'self', field, text, sourceKind: 'archive', sourceLabel: 'Own structured source', confidence: 'observed', appliesTo: 'contact', ...patch});

test('explicit factual investor titles offer funding routes while leaving stage and check size unknown', () => {
  for (const role of ['Investor', 'Angel investor', 'Venture Capitalist', 'VC', 'Venture Partner', 'Investment Partner', 'Founder & Angel Investor']) {
    const person = buildCandidateEvidence({name: 'Investor fixture', role});
    const result = assessCandidate(funding(), person);
    assert.deepEqual(result.contactRoutes.map(route => route.kind), ['investor'], role);
    assert.equal(result.contactRoutes[0].provisional, undefined, role);
    assert.ok(result.criteria.slice(1).every(item => item.status === 'unknown'), role);
    assert.match(result.contactRoutes[0].reason, /mandate, stage, check size and willingness are unconfirmed/);
    assert.ok(result.contactRoutes[0].claimIds.every(id => person.claims.some(claim => claim.id === id && claim.field === 'role')));
  }
});

test('founders, generic partners, investor relations and auxiliary or former investor roles are not investor fit', () => {
  for (const role of ['Founder', 'CEO', 'Partner', 'Senior Vice President', 'Director', 'Investor Relations', 'Head of Investor Relations', 'VC Analyst', 'VC Associate', 'Angel Investor Network', 'Assistant to the Investor', 'Investment Partner assistant', 'Former Investor', 'Ex-VC', 'Seeking VC roles']) {
    const result = assessCandidate(funding(), {role});
    assert.deepEqual(result.contactRoutes, [], role);
    assert.notEqual(result.criteria[0].status, 'supported', role);
    assert.equal(result.isMatch, false, role);
  }
});

test('directors and department heads offer senior contact routes without job or investor claims', () => {
  for (const role of ['Director of Engineering', 'Engineering Director', 'Senior Director, Research', 'Head of Finance', 'Head of People', 'Chief Information Officer']) {
    const result = assessCandidate(career(), {role});
    assert.ok(result.contactRoutes.some(route => route.kind === 'senior_contact'), role);
    assert.equal(result.criteria[0].status, 'unknown');
    assert.match(result.contactRoutes.find(route => route.kind === 'senior_contact')!.reason, /access and willingness to help are unconfirmed/);
    assert.equal(assessCandidate(funding(), {role}).isMatch, false, role);
  }
});

test('auxiliary senior titles cannot satisfy a generic senior contact condition or inherit its route', () => {
  const g = career([criterion({terms: ['Director', 'Head of', 'CEO', 'Vice President'], appliesTo: 'contact'})]);
  for (const role of ['Assistant Director', 'Assistant to the Head of Finance', 'Advisor to the Director', "CEO's assistant", 'Vice President coach', 'Former Director', 'Aspiring Head of Finance']) {
    const result = assessCandidate(g, {role});
    assert.equal(result.criteria[0].status, 'unknown', role);
    assert.deepEqual(result.contactRoutes, [], role);
  }
});

test('observed headline titles are provisional quoted routes and never satisfy role, custom or opportunity criteria', () => {
  const g = career([criterion(), criterion({id: 'person', appliesTo: 'contact'}), criterion({id: 'custom', field: 'custom', appliesTo: 'contact', terms: ['AI']})]);
  const input = headline('Chief AI Officer | VP Innovation');
  const before = JSON.stringify(input), person = buildCandidateEvidence(input), result = assessCandidate(g, person);
  assert.ok(result.contactRoutes.length); assert.ok(result.contactRoutes.every(route => route.provisional === true));
  assert.equal(result.status, 'possible_route'); assert.ok(result.criteria.every(item => item.status === 'unknown'));
  const source = person.claims.find(item => item.sourceLabel === 'Rendered profile · headline')!;
  assert.equal(source.field, 'context'); assert.equal(source.text, input.anchors![0].text);
  assert.ok(result.contactRoutes.every(route => route.claimIds.includes(source.id)));
  assert.ok(result.contactRoutes.every(route => route.reason.includes(`“${source.text}”`)));
  assert.equal(JSON.stringify(input), before); assert.equal(Object.isFrozen(input), false);
});

test('the same observed profile has independent provisional investor and career routes for separate goals', () => {
  const input = headline('Angel Investor | Founder');
  const forFunding = assessCandidate(funding(), input), forCareer = assessCandidate(career(), input);
  assert.deepEqual(forFunding.contactRoutes.map(route => route.kind), ['investor']);
  assert.equal(forFunding.contactRoutes[0].provisional, true); assert.equal(forFunding.criteria[0].status, 'unknown');
  assert.ok(forCareer.contactRoutes.some(route => route.kind === 'executive_hiring'));
  assert.ok(forCareer.contactRoutes.every(route => route.kind !== 'investor'));
  assert.equal(assessCandidate(funding(), headline('Founder | Chief Executive Officer')).isMatch, false);
});

test('explicit headline hiring signals offer contact relevance without inventing vacancies or role fit', () => {
  for (const value of ['Hiring', 'We are hiring', "We're hiring engineers", 'Currently hiring Chief AI Officers in Boston', 'CEO | Actively hiring']) {
    const result = assessCandidate(career(), headline(value));
    const route = result.contactRoutes.find(item => item.kind === 'hiring_signal');
    assert.ok(route, value); assert.equal(route.provisional, true);
    assert.match(route.reason, /current vacancy and its fit are unconfirmed/);
    assert.ok(result.criteria.every(item => item.status === 'unknown'));
    assert.equal(assessCandidate(funding(), headline(value)).isMatch, false);
  }
});

test('aspirations, former titles, auxiliaries and ambiguous hiring prose produce no provisional routes', () => {
  for (const value of ['Aspiring CEO', 'Exploring Chief AI Officer roles', 'Former Director', 'Ex-VP Innovation', 'Looking to be hired', 'Looking for hiring managers', 'Hiring managers', 'Hiring advice', 'Hiring solutions', 'Not an investor', 'Advisor to founders and investor', 'Assistant to the CEO | Director', 'Investor Relations', 'VC Analyst', 'CEO coach', 'Chief of Staff to the CTO']) {
    assert.deepEqual(assessCandidate(career(), headline(value)).contactRoutes, [], value);
    assert.deepEqual(assessCandidate(funding(), headline(value)).contactRoutes, [], value);
  }
});

test('ordinary prose, snippets, missing capture provenance and negative headlines cannot create headline routes', () => {
  const raw = headline('Chief AI Officer');
  const cases: CandidateInput[] = [
    {name: 'About prose', url, anchors: [{...raw.anchors![0], kind: 'about'}]},
    {manualContext: 'Chief AI Officer'},
    {claims: [createEvidenceClaim({subject: 'candidate', field: 'context', text: 'Chief AI Officer', sourceLabel: 'Rendered profile · headline', sourceKind: 'web', confidence: 'observed', appliesTo: 'contact', sourceRef: url, observedAt})]},
    {...raw, anchors: [{...raw.anchors![0], observedAt: undefined}]},
    {...raw, anchors: [{...raw.anchors![0], sourceUrl: 'https://example.test/search'}]},
    {...raw, anchors: [{...raw.anchors![0], polarity: 'negative'}]},
    {...raw, anchors: [{...raw.anchors![0], field: 'role'}]},
  ];
  for (const input of cases) assert.deepEqual(assessCandidate(career(), input).contactRoutes, []);
});

test('headline hints never override a user-required contradiction or mutate the goal', () => {
  const g = career([criterion({id: 'industry', field: 'industry', label: 'Sector', terms: ['FMCG'], appliesTo: 'contact', importance: 'required'})]);
  const before = JSON.stringify(g);
  const result = assessCandidate(g, {...headline('CEO'), claims: [createEvidenceClaim({subject: 'candidate', field: 'industry', text: 'FMCG', sourceLabel: 'Confirmed answer', sourceKind: 'manual', confidence: 'user_confirmed', appliesTo: 'contact', polarity: 'negative'})]});
  assert.ok(result.contactRoutes.some(route => route.provisional)); assert.equal(result.status, 'contradicted'); assert.equal(result.isMatch, false);
  assert.equal(JSON.stringify(g), before);
});

test('typed role evidence takes precedence over a provisional route of the same kind', () => {
  const person = buildCandidateEvidence({...headline('CEO'), role: 'Chief Executive Officer'});
  const result = assessCandidate(career(), person);
  assert.deepEqual(result.contactRoutes.map(route => route.kind), ['executive_hiring']);
  assert.equal(result.contactRoutes[0].provisional, undefined);
  assert.ok(result.contactRoutes[0].claimIds.every(id => person.claims.find(item => item.id === id)?.field === 'role'));
});

test('generic helpful contact roles do not become target-job peers when an opportunity role is specified', () => {
  const g = career([criterion(), criterion({id: 'contacts', appliesTo: 'contact', terms: ['CEO', 'Director', 'Head of', 'Recruiter']})]);
  const result = assessCandidate(g, {role: 'CEO'});
  assert.deepEqual(result.contactRoutes.map(route => route.kind), ['executive_hiring']);
  assert.equal(result.criteria[0].status, 'unknown'); assert.equal(result.criteria[1].status, 'supported');
});

test('shared conversation context cites actual company, education, skill and role evidence on both sides', () => {
  const self = [own('company', 'Acme'), own('education', 'MIT'), own('skill', 'Machine learning'), own('role', 'CFO')];
  const person = buildCandidateEvidence({name: 'Other person', company: 'Acme', role: 'Chief Financial Officer', url, anchors: [
    {kind: 'education', text: 'MIT, MBA program', sourceUrl: url + '#education', observedAt},
    {kind: 'skill', text: 'Strategy, Machine learning, Finance', sourceUrl: url + '#skills', observedAt},
  ]});
  const before = JSON.stringify([self, person]);
  const result = assessCandidate(funding(), person, self);
  assert.deepEqual(result.sharedContext?.map(item => item.kind), ['employer', 'education', 'skill', 'work']);
  const allIds = new Set([...self, ...person.claims].map(item => item.id));
  assert.ok(result.sharedContext?.every(item => item.claimIds.length === 2 && item.claimIds.every(id => allIds.has(id))));
  assert.ok(result.sharedContext?.some(item => item.text.includes('MIT')));
  assert.equal(result.isMatch, false, 'Conversation context alone must not make this CFO an investor.');
  assert.equal(JSON.stringify([self, person]), before);
  assert.deepEqual(assessCandidate(funding(), person).sharedContext, []);
  assert.notEqual(result.evidenceKey, assessCandidate(funding(), person).evidenceKey);
});

test('shared skills and education add no rank or criterion support and never use prose, date cells or derived content', () => {
  const g = funding(), person = buildCandidateEvidence({anchors: [{kind: 'education', text: 'MIT'}, {kind: 'skill', text: 'Machine learning'}]});
  const self = [own('education', 'MIT'), own('skill', 'Machine learning')];
  const before = assessCandidate(g, person), after = assessCandidate(g, person, self);
  assert.equal(after.sharedContext?.length, 2); assert.equal(after.rank, before.rank); assert.deepEqual(after.criteria, before.criteria);
  for (const bad of [own('education', 'MIT', {sourceKind: 'knowledge', derivedFrom: ['source']}), own('education', 'MIT', {polarity: 'negative'}), own('skill', 'Machine learning', {sourceKind: 'writing'}), own('education', '2016', {sourceLabel: 'LinkedIn archive · education · Start Date'})]) {
    assert.deepEqual(assessCandidate(g, person, [bad]).sharedContext, []);
  }
  assert.deepEqual(assessCandidate(g, {manualContext: 'MIT Machine learning'}, self).sharedContext, []);
  assert.deepEqual(assessCandidate(g, headline('MIT | Machine learning'), self).sharedContext, []);
  assert.deepEqual(assessCandidate(g, {anchors: [{kind: 'education', text: 'Not MIT'}, {kind: 'skill', text: 'No Machine learning'}]}, self).sharedContext, []);
});

test('matching placeholder cells and standalone calendar values never become conversation topics', () => {
  for (const field of ['company', 'education', 'skill', 'role'] as const) {
    for (const text of ['None', 'unknown', 'Not provided', 'N/A', 'Not applicable', 'May 2016', 'Sept. 2016 to June 2020', 'Fall 2015', '2018 to Present']) {
      const self = own(field, text), candidate = createEvidenceClaim({...self, id: `candidate-${self.id}`, subject: 'candidate'});
      assert.deepEqual(assessCandidate(funding(), {claims: [candidate]}, [self]).sharedContext, [], `${field}: ${text}`);
    }
  }
  const self = own('education', 'May Institute');
  const candidate = createEvidenceClaim({...self, id: 'candidate-institute', subject: 'candidate'});
  assert.equal(assessCandidate(funding(), {claims: [candidate]}, [self]).sharedContext?.[0].kind, 'education', 'A school name containing a month is substantive.');
});

test('negative exact or section text cannot establish shared education or skills on either side', () => {
  for (const [field, text, positive] of [['education', 'No MIT affiliation', 'MIT'], ['skill', 'Not machine learning', 'Machine learning'], ['education', 'Without MIT affiliation', 'MIT']] as const) {
    const negativeSelf = own(field, text), positiveSelf = own(field, positive);
    const negativeCandidate = createEvidenceClaim({...negativeSelf, id: `negative-${negativeSelf.id}`, subject: 'candidate', sourceKind: 'profile'});
    const positiveCandidate = createEvidenceClaim({...positiveSelf, id: `positive-${positiveSelf.id}`, subject: 'candidate', sourceKind: 'profile'});
    assert.deepEqual(assessCandidate(funding(), {claims: [negativeCandidate]}, [negativeSelf]).sharedContext, [], `Exact negative: ${text}`);
    assert.deepEqual(assessCandidate(funding(), {claims: [negativeCandidate]}, [positiveSelf]).sharedContext, [], `Candidate denial: ${text}`);
    assert.deepEqual(assessCandidate(funding(), {claims: [positiveCandidate]}, [negativeSelf]).sharedContext, [], `Self denial: ${text}`);
  }
});

test('dated historical self roles remain factual work topics without asserting current employment', () => {
  const self = own('role', 'VP', {sourceLabel: 'LinkedIn archive · positions · Title', observedAt: '2016-01-01T00:00:00.000Z'});
  const result = assessCandidate(funding(), {role: 'Vice President'}, [self]);
  assert.deepEqual(result.sharedContext?.map(item => item.kind), ['work']);
  assert.equal(result.sharedContext?.[0].text, 'Work in common: “VP”.');
  assert.equal(result.isMatch, false);
});

test('ranking agrees with individual assessments for the new routes and never pads investor results', () => {
  const g = funding();
  const pool = [{id: 'a', name: 'A', role: 'CEO'}, {id: 'b', name: 'B', role: 'VC'}, {...headline('Angel Investor'), id: 'c', name: 'C'}, {id: 'd', name: 'D', role: 'Investor Relations'}];
  const expected = pool.map(person => ({person, result: assessCandidate(g, person)})).filter(item => item.result.isMatch).sort((a, b) => b.result.rank - a.result.rank);
  const actual = rankGoalNetwork(g, pool, [], {limit: 10});
  assert.equal(actual.length, 2); assert.deepEqual(actual.map(row => [row.candidateKey, row.rank, row.evidenceKey]), expected.map(({result}) => [result.candidateKey, result.rank, result.evidenceKey]));
});
