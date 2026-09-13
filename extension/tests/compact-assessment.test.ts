import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {compactFit, compactProfile} from '../src/compact-profile.js';
import {assessProfileGoals, hasGoalCriteria} from '../src/goal-assessment.js';
import {accountGoalContext} from '../src/goal-context.js';
import {assessCandidate} from '../../src/lib/assessment';
import {createEvidenceClaim} from '../../src/lib/evidence';
import {createGoal, type Goal, type GoalCriterion} from '../../src/lib/goals';
import type {PageSnapshot, Profile} from '../src/types.js';

const {parseHTML} = createRequire(import.meta.url)('linkedom');
const uid = '11111111-1111-4111-a111-111111111111', at = '2026-09-13T12:00:00.000Z';
const url = 'https://www.linkedin.com/in/synthetic-person/';
const makeGoal = (kind: Goal['kind'], criteria: GoalCriterion[] = []) => createGoal({kind,
  title: kind === 'career' ? 'Find a CEO role' : 'Raise a seed round',
  outcome: kind === 'career' ? 'A leadership role in healthcare in London.' : 'Find investors for a seed round.', criteria},
  {id: '22222222-2222-4222-a222-222222222222', now: at});
const criterion = (field: GoalCriterion['field'], terms: string[], appliesTo: GoalCriterion['appliesTo'] = 'contact'): GoalCriterion =>
  ({id: field, field, terms, appliesTo, label: field === 'location' ? 'Target location' : 'Target role', importance: 'required', origin: 'user'});
const profile: Profile = {profileUrl: url, name: 'Synthetic Person', profileReadAt: at, truncated: false, truncationReasons: [], anchors: [
  {kind: 'headline', text: 'Exploring CEO roles and seed investing', sourceUrl: url + '#profile', observedAt: at},
  {kind: 'location', text: 'London', sourceUrl: url + '#profile', observedAt: at},
  {kind: 'about', text: 'Healthcare experience and professional interests.', sourceUrl: url + '#about', observedAt: at},
]};
const page: PageSnapshot = {kind: 'profile', state: 'ready', profile, message: ''};
const context = (goal: Goal) => accountGoalContext(uid, [{id: goal.id, user_id: uid, version: goal.version, document: goal}], at);
function rendered(goal: Goal, snapshot: PageSnapshot = page, owner = uid) {
  const {document} = parseHTML('<html><body></body></html>');
  return compactProfile(document, {page: snapshot, connected: true, userId: owner, goalContext: context(goal), selectedGoalId: goal.id, onSelect() {}});
}

test('title-only career and fundraising goals request details instead of blaming each read profile', () => {
  for (const kind of ['career', 'fundraising'] as const) {
    const goal = makeGoal(kind), before = structuredClone({goal, profile});
    const result = assessProfileGoals(uid, context(goal), page);
    assert.equal(result.state, 'ready'); if (result.state !== 'ready') continue;
    assert.equal(result.assessments[0].assessment.status, 'unknown');
    assert.equal(result.assessments[0].assessment.rank, 0);
    const card = rendered(goal);
    assert.equal(card.querySelector('.fit-label')?.textContent, 'Add goal details');
    assert.match(card.querySelector('.reason')?.textContent || '', /who you want to meet.*save your goal/);
    assert.deepEqual({goal, profile}, before, 'No inferred criteria or profile fields are persisted or synthesized.');
  }
});

test('empty and punctuation-only term rows do not count as usable goal details', () => {
  for (const terms of [[], ['---']]) {
    const goal = makeGoal('career', [criterion('role', terms)]);
    assert.equal(hasGoalCriteria(goal), false);
    assert.equal(rendered(goal).querySelector('.fit-label')?.textContent, 'Add goal details');
  }
  assert.equal(hasGoalCriteria(makeGoal('career', [criterion('role', ['CEO'])])), true);
});

test('missing opportunity geography does not turn a conversation assessment into a vacancy check', () => {
  const goal = makeGoal('career', [criterion('location', ['London'], 'opportunity')]);
  const card = rendered(goal);
  assert.equal(card.querySelector('.fit-label')?.textContent, 'No clear connection yet');
  assert.match(card.querySelector('.reason')?.textContent || '', /hiring, leadership or peer connection/);
  assert.doesNotMatch(card.querySelector('.reason')?.textContent || '', /job opening|opportunity location/);
  const result = assessProfileGoals(uid, context(goal), page);
  assert.equal(result.state, 'ready'); if (result.state === 'ready') {assert.equal(result.assessments[0].assessment.isMatch, false); assert.match(result.assessments[0].assessment.unknowns.join(' '), /opportunity location is not established/);}
});

test('headline aspirations stay unknown while a confirmed current role still supports a contact route', () => {
  const goal = makeGoal('career', [criterion('role', ['CEO'], 'opportunity')]);
  assert.equal(rendered(goal).querySelector('.fit-label')?.textContent, 'No clear connection yet');
  const fit = compactFit(assessCandidate(goal, {name: 'Synthetic Person', position: 'CEO'}), goal);
  assert.equal(fit.label, 'Possible fit');
  assert.match(fit.reason, /experience in your target role.*may offer advice/);
});

test('a preserved rendered current executive role remains a possible route even before goal criteria are filled', () => {
  const goal = makeGoal('career'), entryText = 'CEO Example Company Jan 2024 – Present', dateRange = 'Jan 2024 – Present';
  const current: Profile = {...profile, anchors: [...profile.anchors,
    {kind: 'experience', text: entryText, sourceUrl: url + '#experience', observedAt: at},
    {kind: 'timing', text: dateRange, sourceUrl: url + '#experience', observedAt: at},
    {kind: 'experience', field: 'role', text: 'CEO', sourceUrl: url + '#experience', observedAt: at, currentExperience: {dateRange, entryText}},
  ]};
  const snapshot: PageSnapshot = {...page, profile: current};
  const result = assessProfileGoals(uid, context(goal), snapshot);
  assert.equal(result.state, 'ready'); if (result.state !== 'ready') return;
  assert.equal(result.assessments[0].assessment.status, 'possible_route');
  const card = rendered(goal, snapshot);
  assert.equal(card.querySelector('.fit-label')?.textContent, 'Possible fit');
  assert.match(card.querySelector('.reason')?.textContent || '', /senior leadership role.*may offer a useful introduction/);
  assert.doesNotMatch(card.querySelector('.reason')?.textContent || '', /Add goal criteria/);
  assert.equal(goal.criteria.length, 0);
});

test('supported criteria, explicit required contradictions and unknown facts have different labels', () => {
  const goal = makeGoal('career', [criterion('role', ['CEO']), criterion('custom', ['healthcare'])]);
  const role = createEvidenceClaim({subject: 'candidate', field: 'role', text: 'CEO', sourceKind: 'manual', sourceLabel: 'Confirmed role', confidence: 'user_confirmed', appliesTo: 'contact'});
  const contextClaim = createEvidenceClaim({subject: 'candidate', field: 'context', text: 'Healthcare experience', sourceKind: 'manual', sourceLabel: 'Confirmed experience', confidence: 'user_confirmed', appliesTo: 'contact'});
  assert.equal(compactFit(assessCandidate(goal, {name: 'Synthetic Person', claims: [role, contextClaim]}), goal).label, 'Strong potential');
  const low = compactFit(assessCandidate(goal, {name: 'Synthetic Person', claims: [{...role, polarity: 'negative'}, contextClaim]}), goal);
  assert.equal(low.label, 'Low fit'); assert.match(low.reason, /explicit contact evidence contradicts/);
  assert.equal(compactFit(assessCandidate(goal, {name: 'Synthetic Person'}), goal).label, 'No clear connection yet');
});

test('a newly saved criterion changes the result immediately without retrofitting the old version', () => {
  const old = makeGoal('career'), revised = {...old, version: 2, criteria: [criterion('location', ['London'])]};
  assert.equal(rendered(old).querySelector('.fit-label')?.textContent, 'Add goal details');
  const next = rendered(revised);
  assert.equal(next.querySelector('.fit-label')?.textContent, 'Possible fit');
  assert.equal((next.querySelector('.goal-fit') as HTMLElement).dataset.goalVersion, '2');
  assert.match(next.querySelector('.reason')?.textContent || '', /explicit contact evidence mentions London/);
  assert.equal(old.criteria.length, 0);
});

test('an incomplete read and a too-large read give distinct recovery instructions', () => {
  const goal = makeGoal('career', [criterion('role', ['CEO'])]);
  const incomplete: PageSnapshot = {...page, state: 'unknown', profile: {...profile, anchors: profile.anchors.slice(0, 1), profileReadAt: null}};
  assert.match(rendered(goal, incomplete).querySelector('.reason')?.textContent || '', /complete section read is not.*About or Experience/);
  const large: PageSnapshot = {...page, state: 'unknown', profile: {...profile, truncated: true, profileReadAt: null}};
  assert.match(rendered(goal, large).querySelector('.reason')?.textContent || '', /exceeds the save limit/);
  assert.doesNotMatch(rendered(goal, large).textContent || '', /Add goal details/);
});

test('cross-account goal data remains refused before any comparison or detail prompt', () => {
  const card = rendered(makeGoal('career'), page, '33333333-3333-4333-a333-333333333333');
  assert.equal(card.querySelector('.goal-fit'), null);
  assert.match(card.textContent || '', /could not be verified/);
});

const preferred = (id: string, field: GoalCriterion['field'], values: string[], appliesTo: GoalCriterion['appliesTo']): GoalCriterion =>
  ({id,field,label:id,terms:values,appliesTo,importance:'preferred',origin:'user'});
const careerShape = () => makeGoal('career', [preferred('target-role','role',['CAIO'],'opportunity'),preferred('sector','industry',['FMCG'],'opportunity'),
  preferred('cities','location',['Boston','New York','Chicago','San Francisco'],'opportunity'),preferred('contacts','role',['CAIO','CEO','CTO','VP','Director','Recruiter'],'contact')]);
const fundingShape = () => makeGoal('fundraising', [preferred('investors','role',['Investor','Angel Investor','VC'],'contact')]);
function currentRolePage(role: string | null, headline = ''): PageSnapshot {
  const dateRange='Jan 2024 - Present',entryText=`${role} Example Company ${dateRange}`,source={sourceUrl:url+'#experience',observedAt:at};
  return {...page,profile:{...profile,anchors:[{kind:'about',text:'Professional background and work experience.',sourceUrl:url+'#about',observedAt:at},
    {kind:'location',text:'Boston',sourceUrl:url+'#profile',observedAt:at},
    ...(headline?[{kind:'headline',text:headline,sourceUrl:url+'#profile',observedAt:at}]:[]),
    ...(role?[{kind:'experience',text:entryText,...source},{kind:'timing',text:dateRange,...source},
      {kind:'experience',field:'role' as const,text:role,...source,currentExperience:{dateRange,entryText}}]:[])]}};
}
function resultFor(goal: Goal, snapshot: PageSnapshot) {
  const result=assessProfileGoals(uid,context(goal),snapshot);assert.equal(result.state,'ready');if(result.state!=='ready')throw Error('Expected fixture profile');
  return result.assessments[0].assessment;
}

test('current contact role can be strong for career while all three opportunity preferences remain unknown', () => {
  const goal=careerShape(),before=structuredClone(goal);
  for(const role of ['Chief AI Officer','V.P. R&D','Executive Recruiter']){
    const assessment=resultFor(goal,currentRolePage(role));
    assert.equal(compactFit(assessment,goal).label,'Strong potential');
    assert.equal(assessment.evidenceCoverage.supported,1);assert.equal(assessment.evidenceCoverage.unknown,3);
    assert.ok(assessment.criteria.filter(row=>row.appliesTo==='opportunity').every(row=>row.status==='unknown'));
    assert.match(compactFit(assessment,goal).reason,/opening is not confirmed/);
  }
  assert.deepEqual(goal,before,'The compact contact tier never changes the goal or its scopes.');
});
test('one explicit investor-role preference suffices and the same profiles have independent goal labels', () => {
  const career=careerShape(),funding=fundingShape();
  for(const [role,careerLabel,fundingLabel] of [
    ['Chief AI Officer','Strong potential','No clear connection yet'],
    ['Angel Investor','No clear connection yet','Strong potential'],
    ['Software Engineer','No clear connection yet','No clear connection yet'],
  ]){
    const snapshot=currentRolePage(role);
    assert.equal(compactFit(resultFor(career,snapshot),career).label,careerLabel);
    assert.equal(compactFit(resultFor(funding,snapshot),funding).label,fundingLabel);
  }
  assert.match(compactFit(resultFor(funding,currentRolePage('Angel Investor')),funding).reason,/whether your venture fits their investment focus/);
});
test('blank funding placeholders do not penalize the contact while unanswered mandate facts remain unknown', () => {
  const goal={...fundingShape(),criteria:[...fundingShape().criteria,preferred('stage','stage',[],'opportunity'),preferred('check','check_size',[],'opportunity')]};
  const assessment=resultFor(goal,currentRolePage('Investor'));
  assert.equal(compactFit(assessment,goal).label,'Strong potential');assert.equal(assessment.evidenceCoverage.unknown,2);
  assert.ok(goal.criteria.filter(row=>row.field==='stage'||row.field==='check_size').every(row=>row.terms.length===0));
});
test('headline-only, generic career routes and partial preferred contact support remain possible', () => {
  const career=careerShape();
  const headline=resultFor(career,currentRolePage(null,'Chief AI Officer'));
  assert.equal(compactFit(headline,career).label,'Possible fit');assert.equal(headline.evidenceCoverage.supported,0);
  const generic=resultFor(career,currentRolePage('General Manager'));
  assert.equal(compactFit(generic,career).label,'Possible fit');assert.equal(generic.evidenceCoverage.supported,0);
  for(const importance of ['preferred','required'] as const){
    const scoped={...career,criteria:[...career.criteria,{...preferred('contact-city','location',['Chicago'],'contact'),importance}]};
    const partial=resultFor(scoped,currentRolePage('Chief AI Officer'));
    assert.equal(compactFit(partial,scoped).label,'Possible fit');assert.equal(partial.criteria.find(row=>row.criterionId==='contact-city')?.status,'unknown');
  }
});
test('location support alone cannot become strong and explicit contradictions or conflicts still surface', () => {
  const location=makeGoal('career',[preferred('city','location',['Boston'],'contact')]);
  assert.equal(compactFit(resultFor(location,currentRolePage(null)),location).label,'Possible fit');
  const goal={...careerShape(),criteria:careerShape().criteria.map(row=>row.id==='sector'?{...row,importance:'required' as const}:row)};
  const industry=createEvidenceClaim({subject:'candidate',field:'industry',text:'FMCG',sourceKind:'manual',sourceLabel:'Confirmed opening',confidence:'user_confirmed',appliesTo:'opportunity',polarity:'negative'});
  const contradiction=assessCandidate(goal,{name:'Fixture',position:'CAIO',claims:[industry]});
  assert.equal(compactFit(contradiction,goal).label,'Low fit');assert.match(compactFit(contradiction,goal).reason,/opportunity evidence contradicts/);
  const positive=createEvidenceClaim({...industry,polarity:'positive'});
  const conflict=assessCandidate(goal,{name:'Fixture',position:'CAIO',claims:[industry,positive]});
  assert.equal(compactFit(conflict,goal).label,'Not enough information');
});
