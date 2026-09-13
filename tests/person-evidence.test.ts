import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSavedPersonEvidence, savedPersonHeadline} from '../src/lib/person-evidence';
import {assessCandidate} from '../src/lib/assessment';
import {createEvidenceClaim, type EvidenceAnchor} from '../src/lib/evidence';
import type {Goal} from '../src/lib/goals';
import type {Person} from '../src/lib/data-access';
const at='2026-09-12T12:00:00Z';
const person:Person={id:'person',person:'Fixture Person',profile_url:'https://www.linkedin.com/in/fixture-person/',stage:'saved',context:{source:'extension'},created_at:at};
const anchors=[{kind:'headline',text:'Exploring product leadership',sourceUrl:person.profile_url!,observedAt:at},
 {kind:'about',text:'A recorded account of product delivery.',sourceUrl:person.profile_url!,observedAt:at},
 {kind:'education',text:'Fixture University',sourceUrl:person.profile_url!,observedAt:at},
 {kind:'timing',text:'Recent rendered activity: September 2026',sourceUrl:person.profile_url!,observedAt:at}];
test('saved extension profile keeps its timestamp, completeness and every sourced anchor',()=>{
 const snapshot={name:person.person,profileUrl:person.profile_url,profileReadAt:at,truncated:false,anchors};
 const result=buildSavedPersonEvidence({...person,profile:snapshot});
 assert.equal(result.profileReadAt,at);assert.equal(result.completeProfile,true);
 assert.deepEqual(result.claims.filter(c=>c.sourceKind==='profile').map(c=>[c.text,c.sourceRef,c.observedAt]),anchors.map(a=>[a.text,a.sourceUrl,a.observedAt]));
 assert.deepEqual(snapshot.anchors,anchors);
});
test('an explicit missing read never borrows an old timestamp or turns search context into a profile',()=>{
 const result=buildSavedPersonEvidence({...person,context:{source:'web_search',profile_read_at:at,searchHeadline:'Chief AI Officer'},profile:{anchors,profileReadAt:null,observedAt:at}});
 assert.equal(result.profileReadAt,null);assert.equal(result.completeProfile,false);
 assert.ok(!result.claims.some(c=>c.text==='Chief AI Officer'));
});
test('truncated and invalid-date snapshots remain incomplete',()=>{
 assert.equal(buildSavedPersonEvidence({...person,profile:{anchors,profileReadAt:at,truncated:true}}).completeProfile,false);
 assert.equal(buildSavedPersonEvidence({...person,profile:{anchors,profileReadAt:'not a date',observedAt:at}}).completeProfile,false);
});
test('legacy observed timestamps work only when the current timestamp field is absent',()=>{
 assert.equal(buildSavedPersonEvidence({...person,profile:{anchors,observedAt:at}}).profileReadAt,at);
 assert.equal(buildSavedPersonEvidence({...person,profile:{anchors,profileReadAt:'',observedAt:at}}).profileReadAt,null);
});

const freshAt = '2026-09-13T12:00:00Z';
const saved: Person = {...person, context: {source: 'discovery', position: 'CEO', company: 'Earlier Company'}};
function currentEntry(role = 'Software Engineer', company = 'Current Company', dateRange = 'Sep 2025 - Present'): EvidenceAnchor[] {
 const entryText = `${role} ${company} ${dateRange}`;
 const source = {sourceUrl: `${person.profile_url}#experience`, observedAt: freshAt};
 return [
  {kind: 'experience', text: entryText, ...source},
  {kind: 'timing', text: dateRange, ...source},
  ...(['role', 'company'] as const).map(field => ({kind: 'experience', field,
   text: field === 'role' ? role : company, ...source, currentExperience: {dateRange, entryText}})),
 ];
}
function readSnapshot(readAnchors: readonly EvidenceAnchor[] = currentEntry()): Record<string, unknown> {
 return {source: 'rendered_profile', profileUrl: person.profile_url, name: person.person,
  profileReadAt: freshAt, truncated: false, anchors: readAnchors};
}
function careerGoal(role: string): Goal {
 return {id: 'career', kind: 'career', title: 'A professional goal', outcome: 'Find a relevant contact',
  criteria: [{id: 'role', field: 'role', label: role, terms: [role], importance: 'required',
   appliesTo: 'contact', origin: 'user'}], openQuestions: [], version: 1, status: 'active', createdAt: at, updatedAt: at};
}
const ownCompany = (text: string) => createEvidenceClaim({subject: 'self', field: 'company', text,
 sourceLabel: 'Own archive', sourceKind: 'archive', confidence: 'observed', appliesTo: 'contact'});

test('a newer verified current role retires the saved CEO route without claiming the person is not a CEO', () => {
 const original = {...saved, profile: readSnapshot()};
 const before = structuredClone(original);
 const result = buildSavedPersonEvidence(original);
 const earlier = result.claims.find(item => item.sourceLabel === 'Previously saved role')!;
 assert.equal(earlier.text, 'CEO'); assert.equal(earlier.field, 'context');
 assert.equal(earlier.sourceKind, 'record'); assert.equal(earlier.observedAt, at);
 assert.equal(earlier.sourceRef, person.profile_url);
 assert.ok(!result.claims.some(item => item.field === 'role' && item.text === 'CEO'));
 const ceo = assessCandidate(careerGoal('CEO'), result);
 assert.equal(ceo.criteria[0].status, 'unknown');
 assert.ok(!ceo.contactRoutes.some(route => route.kind === 'peer' || route.kind === 'executive_hiring'));
 const engineer = assessCandidate(careerGoal('Software Engineer'), result);
 assert.equal(engineer.criteria[0].status, 'supported');
 assert.ok(engineer.contactRoutes.some(route => route.kind === 'peer'));
 assert.deepEqual(original, before, 'stored record and every raw anchor remain unchanged');
 assert.equal(result.claims.filter(item => item.sourceKind === 'profile').length, currentEntry().length);
 assert.ok(Object.isFrozen(result) && Object.isFrozen(result.claims));
});

test('a newer current company replaces the old shared-employer route while preserving its original fact', () => {
 const result = buildSavedPersonEvidence({...saved, profile: readSnapshot()});
 const previous = result.claims.find(item => item.sourceLabel === 'Previously saved company')!;
 assert.equal(previous.text, 'Earlier Company'); assert.equal(previous.field, 'context');
 assert.equal(previous.observedAt, at); assert.equal(previous.sourceKind, 'record');
 assert.equal(result.company, 'Current Company');
 assert.ok(!assessCandidate(careerGoal('CEO'), result, [ownCompany('Earlier Company')])
  .contactRoutes.some(route => route.kind === 'introducer'));
 assert.ok(assessCandidate(careerGoal('CEO'), result, [ownCompany('Current Company')])
  .contactRoutes.some(route => route.kind === 'introducer'));
});

test('multiple explicit current roles and companies all remain active without a primary or exclusive inference', () => {
 const readAnchors = [...currentEntry('Software Engineer', 'First Current Company'),
  ...currentEntry('Product Designer', 'Second Current Company')];
 const result = buildSavedPersonEvidence({...saved, profile: readSnapshot(readAnchors)});
 assert.deepEqual(result.claims.filter(item => item.field === 'role').map(item => item.text), ['Software Engineer', 'Product Designer']);
 assert.deepEqual(result.claims.filter(item => item.field === 'company').map(item => item.text), ['First Current Company', 'Second Current Company']);
 assert.equal(result.company, '', 'the singular display field does not choose a primary employer');
 assert.ok(result.claims.every(item => item.exclusive !== true));
 for (const role of ['Software Engineer', 'Product Designer']) {
  assert.equal(assessCandidate(careerGoal(role), result).criteria[0].status, 'supported');
 }
 for (const company of ['First Current Company', 'Second Current Company']) {
  assert.ok(assessCandidate(careerGoal('CEO'), result, [ownCompany(company)]).contactRoutes.some(route => route.kind === 'introducer'));
 }
 assert.equal(assessCandidate(careerGoal('CEO'), result).criteria[0].status, 'unknown');
});

test('an explicit role alone does not retire a separately saved company, or vice versa', () => {
 for (const field of ['role', 'company'] as const) {
  const result = buildSavedPersonEvidence({...saved, profile: readSnapshot(currentEntry().filter(anchor => !anchor.field || anchor.field === field))});
  const other = field === 'role' ? 'company' : 'role';
  assert.ok(result.claims.some(item => item.sourceLabel === `Previously saved ${field}`));
  assert.ok(result.claims.some(item => item.field === other && item.sourceLabel === 'Saved person record'));
 }
});

const unverified: Array<[string, () => Record<string, unknown>]> = [
 ['partial read', () => ({...readSnapshot(), truncated: true})],
 ['missing explicit read', () => ({...readSnapshot(), profileReadAt: null, observedAt: freshAt})],
 ['legacy timestamp only', () => {const result = readSnapshot(); delete result.profileReadAt; return {...result, observedAt: freshAt};}],
 ['search result', () => ({...readSnapshot(), source: 'search_result'})],
 ['unidentified source', () => {const result = readSnapshot(); delete result.source; return result;}],
 ['different profile', () => ({...readSnapshot(), profileUrl: 'https://www.linkedin.com/in/another-person/'})],
 ['missing current provenance', () => readSnapshot(currentEntry().map(({currentExperience: _current, ...anchor}) => anchor))],
 ['past experience', () => readSnapshot(currentEntry('Software Engineer', 'Current Company', 'Sep 2021 - Aug 2025'))],
 ['undated experience', () => readSnapshot(currentEntry('Software Engineer', 'Current Company', ''))],
 ['missing raw companion', () => readSnapshot(currentEntry().filter(anchor => anchor.field || anchor.kind !== 'experience'))],
 ['missing timing companion', () => readSnapshot(currentEntry().filter(anchor => anchor.kind !== 'timing'))],
 ['mismatched source time', () => readSnapshot(currentEntry().map(anchor => anchor.field ? {...anchor, observedAt: at} : anchor))],
 ['opportunity scope', () => readSnapshot(currentEntry().map(anchor => anchor.field ? {...anchor, appliesTo: 'opportunity'} : anchor))],
 ['negative assertion', () => readSnapshot(currentEntry().map(anchor => anchor.field ? {...anchor, polarity: 'negative'} : anchor))],
];
for (const [name, snapshot] of unverified) {
 test(`${name} cannot supersede a saved role or company`, () => {
  const result = buildSavedPersonEvidence({...saved, profile: snapshot()});
  assert.ok(result.claims.some(item => item.field === 'role' && item.text === 'CEO' && item.sourceLabel === 'Saved person record'));
  assert.ok(result.claims.some(item => item.field === 'company' && item.text === 'Earlier Company' && item.sourceLabel === 'Saved person record'));
  assert.ok(!result.claims.some(item => item.sourceLabel.startsWith('Previously saved')));
  assert.equal(result.company, 'Earlier Company');
  assert.ok(!result.claims.some(item => item.sourceKind === 'profile' && ['role', 'company'].includes(item.field)),
   'unverified typed metadata cannot add a second active role or employer');
  assert.ok(result.claims.some(item => item.sourceKind === 'profile' && item.text === 'Software Engineer' && item.field === 'context'));
 });
}

test('a read cannot retire a fact saved at the same time, after the read, or with an unknown timestamp', () => {
 for (const created_at of [freshAt, '2026-09-14T00:00:00Z', 'invalid']) {
  const result = buildSavedPersonEvidence({...saved, created_at, profile: readSnapshot()});
  assert.ok(result.claims.some(item => item.field === 'role' && item.text === 'CEO'));
  assert.ok(!result.claims.some(item => item.sourceLabel.startsWith('Previously saved')));
 }
});

test('a legacy saved record still provides its own explicit role, while typed profile prose stays context', () => {
 const result = buildSavedPersonEvidence({...saved, context: {...saved.context, source: 'manual'}, profile: {
  anchors: [{kind: 'headline', field: 'role', text: 'Chief Technology Officer', sourceUrl: person.profile_url!, observedAt: at}],
  observedAt: at,
 }});
 assert.ok(result.claims.some(item => item.sourceKind === 'record' && item.field === 'role' && item.text === 'CEO'));
 assert.ok(result.claims.some(item => item.sourceKind === 'profile' && item.field === 'context' && item.text === 'Chief Technology Officer'));
 assert.equal(assessCandidate(careerGoal('Chief Technology Officer'), result).criteria[0].status, 'unknown');
});

test('a fresh coherent profile headline is displayed exactly, without turning it into a role fact', () => {
 const headline: EvidenceAnchor = {kind: 'headline', text: 'Building products | Exploring CEO roles',
  sourceUrl: `${person.profile_url}#profile`, observedAt: freshAt};
 const input = {...saved, profile: readSnapshot([...currentEntry(), headline])};
 assert.equal(savedPersonHeadline(input), headline.text);
 assert.equal(assessCandidate(careerGoal('CEO'), buildSavedPersonEvidence(input)).criteria[0].status, 'unknown');
});

test('a unique current entry replaces the old header without mixing current and previously saved fields', () => {
 assert.equal(savedPersonHeadline({...saved, profile: readSnapshot()}), 'Software Engineer · Current Company');
 for (const field of ['role', 'company'] as const) {
  const input = {...saved, profile: readSnapshot(currentEntry().filter(anchor => !anchor.field || anchor.field === field))};
  assert.equal(savedPersonHeadline(input), field === 'role' ? 'Software Engineer' : 'Current Company');
 }
});

test('multiple current entries cannot be combined into an invented role and employer pair in the header', () => {
 const complete = [...currentEntry('Software Engineer', 'First Company'), ...currentEntry('Advisor', 'Second Company')];
 assert.equal(savedPersonHeadline({...saved, profile: readSnapshot(complete)}), 'Current profile details available');
 const separate = [...currentEntry('Software Engineer', 'First Company').filter(anchor => anchor.field !== 'company'),
  ...currentEntry('Advisor', 'Second Company').filter(anchor => anchor.field !== 'role')];
 assert.equal(savedPersonHeadline({...saved, profile: readSnapshot(separate)}), 'Current profile details available');
});

test('a fresh header does not trust a different source time or profile URL', () => {
 const headline: EvidenceAnchor = {kind: 'headline', text: 'Unverified CEO heading',
  sourceUrl: `${person.profile_url}#profile`, observedAt: freshAt};
 for (const patch of [{observedAt: at}, {sourceUrl: 'https://www.linkedin.com/in/another-person/#profile'}]) {
  assert.equal(savedPersonHeadline({...saved, profile: readSnapshot([...currentEntry(), {...headline, ...patch}])}),
   'Software Engineer · Current Company');
 }
});

test('partial, search, older and unverified reads keep the prior header and search fallback', () => {
 for (const [, snapshot] of unverified) {
  assert.equal(savedPersonHeadline({...saved, profile: snapshot()}), 'CEO · Earlier Company');
 }
 assert.equal(savedPersonHeadline({...saved, created_at: freshAt, profile: readSnapshot()}), 'CEO · Earlier Company');
 assert.equal(savedPersonHeadline({...person, context: {searchHeadline: 'Search result heading'}}), 'Search result heading');
});

test('rendered contact text cannot satisfy a custom opportunity criterion through fabricated scope metadata', () => {
 const fake: EvidenceAnchor = {kind: 'experience', field: 'custom', appliesTo: 'opportunity', text: 'Boston opening',
  sourceUrl: `${person.profile_url}#experience`, observedAt: freshAt};
 const goal: Goal = {...careerGoal('CEO'), criteria: [{id: 'custom', field: 'custom', label: 'Boston opening',
  terms: ['Boston opening'], importance: 'required', origin: 'user', appliesTo: 'opportunity'}]};
 const candidate = buildSavedPersonEvidence({...person, profile: readSnapshot([fake, ...currentEntry()])});
 assert.equal(assessCandidate(goal, candidate).criteria[0].status, 'unknown');
 assert.ok(candidate.claims.filter(item => item.sourceKind === 'profile').every(item => item.appliesTo === 'contact'));
});

test('first-time extension saves can fill empty company and headline fields after the source was read', () => {
 const input = {...person, created_at: '2026-09-13T12:00:03Z', profile: readSnapshot()};
 const candidate = buildSavedPersonEvidence(input);
 assert.equal(candidate.company, 'Current Company');
 assert.equal(savedPersonHeadline(input), 'Software Engineer · Current Company');
 assert.ok(!candidate.claims.some(item => item.sourceLabel.startsWith('Previously saved')));
 const multiple = {...input, profile: readSnapshot([...currentEntry(), ...currentEntry('Advisor', 'Other Company')])};
 assert.equal(buildSavedPersonEvidence(multiple).company, '');
 assert.equal(savedPersonHeadline(multiple), 'Current profile details available');
});

test('filling a blank display never retires a nonempty newer saved employer', () => {
 const input = {...person, created_at: '2026-09-13T12:00:03Z', context: {company: 'Saved after the read'}, profile: readSnapshot()};
 assert.equal(buildSavedPersonEvidence(input).company, 'Saved after the read');
 assert.equal(savedPersonHeadline(input), 'Saved after the read');
});
