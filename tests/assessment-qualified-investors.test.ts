import test from 'node:test';
import assert from 'node:assert/strict';
import {assessCandidate, rankGoalNetwork} from '../src/lib/assessment';
import {buildCandidateEvidence, type CandidateInput} from '../src/lib/evidence';
import {createGoal} from '../src/lib/goals';
import {buildSavedPersonEvidence} from '../src/lib/person-evidence';
import {renderedCandidate} from '../extension/src/goal-assessment';
import type {Profile} from '../extension/src/types';
const url='https://www.linkedin.com/in/synthetic-investor-title/';
const at='2026-09-13T12:00:00.000Z';
const goal=createGoal({kind:'fundraising',title:'Find funding conversations',outcome:'Discuss suitable professional investment opportunities',criteria:[
 {id:'role',field:'role',label:'Contact role',terms:['Investor'],importance:'preferred',appliesTo:'contact',origin:'user'},
 {id:'stage',field:'stage',label:'Stage',terms:['Seed'],importance:'preferred',appliesTo:'opportunity',origin:'user'},
 {id:'industry',field:'industry',label:'Sector',terms:['Technology'],importance:'preferred',appliesTo:'opportunity',origin:'user'},
 {id:'check',field:'check_size',label:'Check size',terms:['$100k'],importance:'preferred',appliesTo:'opportunity',origin:'user'},
]});
const headline=(text:string):CandidateInput=>({name:'Synthetic Person',url,anchors:[{kind:'headline',text,sourceUrl:url+'#profile',observedAt:at}]});
const positive=[
 'Early-Stage Investor','Early Stage Investor','Early–Stage Investor','Early‑Stage Investor','Earlystage Investor',
 'Pre-seed Investor','Preseed Investor','Seed Investor','Seed-stage Investor','Pre-seed-stage Investor','Growth-stage Investor','Growth Equity Investor','Late-stage Investor','Series A Investor',
 'Technology Investor','Tech Investor','Deep Tech Investor','Climate-tech Investor','Healthcare Investor','Life Sciences Investor','Fintech Investor',
 'Enterprise Software Investor','B2B SaaS Investor','Consumer Investor','Industrial Investor','Impact Investor','Private Equity Investor',
 'Early-stage Technology Investor','Seed / Early-Stage Investor','Early-stage Angel Investor','Seed Venture Capitalist','Technology VC',
 'Early-stage Investment Partner','Growth Venture Partner','Founder | Early-Stage Investor','Climate Tech Investor at Example Capital',
];
test('common qualified investor headlines yield only provisional sourced contact routes',()=>{
 for(const text of positive){
  const input=headline(text),before=JSON.stringify(input),candidate=buildCandidateEvidence(input),result=assessCandidate(goal,candidate);
  assert.equal(result.status,'possible_route',text);assert.equal(result.contactRoutes.length,1,text);
  const route=result.contactRoutes[0];assert.equal(route.kind,'investor',text);assert.equal(route.provisional,true,text);
  assert.ok(route.reason.includes(`“${text}”`),text);assert.ok(result.criteria.every(row=>row.status==='unknown'),text);
  assert.ok(!candidate.claims.some(row=>['role','industry','stage','check_size'].includes(row.field)),text);
  assert.ok(route.claimIds.every(id=>candidate.claims.some(row=>row.id===id&&row.field==='context'&&row.sourceLabel==='Rendered profile · headline')),text);
  assert.equal(JSON.stringify(input),before);
 }
});
test('the same qualified titles in explicit role facts support the investor route without inventing modifier metadata',()=>{
 for(const text of positive){
  const candidate=buildCandidateEvidence({name:'Synthetic Person',role:text}),result=assessCandidate(goal,candidate);
  assert.equal(result.contactRoutes[0]?.kind,'investor',text);assert.equal(result.contactRoutes[0]?.provisional,undefined,text);
  assert.ok(result.criteria.slice(1).every(row=>row.status==='unknown'),text);
  assert.ok(!candidate.claims.some(row=>['industry','stage','check_size'].includes(row.field)),text);
  assert.ok(result.contactRoutes[0].claimIds.every(id=>candidate.claims.some(row=>row.id===id&&row.field==='role')),text);
 }
});
test('validated current Experience supports the same qualified route in the saved app and extension adapters',()=>{
 for(const text of ['Early-Stage Investor','Pre-seed Investor','Technology Investor']){
  const dateRange='Jan 2023 – Present',entryText=`${text} Example Capital ${dateRange}`;
  const raw={kind:'experience' as const,text:entryText,sourceUrl:url+'#experience',observedAt:at};
  const role={...raw,text,field:'role' as const,currentExperience:{dateRange,entryText}};
  const profile:Profile={profileUrl:url,name:'Synthetic Person',profileReadAt:at,truncated:false,truncationReasons:[],anchors:[raw,{...raw,kind:'timing',text:dateRange},role]};
  const saved={id:'11111111-1111-4111-a111-111111111111',person:profile.name,profile_url:url,stage:'saved',context:{},created_at:'2026-09-12T12:00:00Z',profile:{...profile,source:'rendered_profile'}};
  for(const candidate of [renderedCandidate(profile),buildSavedPersonEvidence(saved)]){
   const result=assessCandidate(goal,candidate);assert.equal(result.contactRoutes[0]?.kind,'investor',text);assert.equal(result.contactRoutes[0]?.provisional,undefined,text);
   assert.equal(result.criteria[0].status,'supported');assert.ok(result.criteria.slice(1).every(row=>row.status==='unknown'));
  }
  const unsupported={...profile,anchors:profile.anchors.filter(row=>row.kind!=='timing')};
  assert.equal(assessCandidate(goal,renderedCandidate(unsupported)).contactRoutes.length,0,'Missing timing cannot promote current-role metadata.');
 }
});
test('qualifiers never bypass former, aspirational, negative, advisory or investor-support exclusions',()=>{
 const negative=['Former Early-Stage Investor','Previously a Seed Investor','Ex-Technology Investor','Retired Climate Investor',
  'Aspiring Early-stage Investor','Exploring Seed Investor roles','Looking to become an Early-stage Investor','Not an Early-stage Investor',
  'Advisor to Early-stage Investors','Early-stage Investor Advisor','Assistant to a Technology Investor','Chief of Staff to a Seed Investor',
  'Early-stage Investor Relations','Technology Investor Communications','Climate Investor Network','Seed Investor Community','Angel Investor Services',
  'Investor in People','Technology Investor Analyst','Early-stage Investor Research','Seed Investor Newsletter','Investor Conference Organizer',
  'Technology Investor Tools','Early-stage VC Analyst','Seed Venture Partner Associate','Supporting Early-stage Investors',
  'A guide to early-stage investor relations','Founder of an investor community','Software for early-stage investors'];
 for(const text of negative){
  for(const input of [headline(text),{role:text}]){
   const result=assessCandidate(goal,input);assert.equal(result.contactRoutes.length,0,text);assert.equal(result.isMatch,false,text);
   assert.notEqual(result.criteria[0].status,'supported',text);
  }
 }
});
test('qualified phrases in free prose, snippets or uncaptured headlines remain outside title matching',()=>{
 const raw=headline('Early-Stage Investor');
 const inputs:CandidateInput[]=[{manualContext:'Early-Stage Investor'},{sourceKind:'web',role:'Early-Stage Investor'},
  {...raw,anchors:[{...raw.anchors![0],kind:'about'}]}, {...raw,anchors:[{...raw.anchors![0],observedAt:undefined}]},
  {...raw,anchors:[{...raw.anchors![0],polarity:'negative'}]}, {...raw,anchors:[{...raw.anchors![0],sourceUrl:'https://example.test/search'}]}];
 for(const input of inputs)assert.equal(assessCandidate(goal,input).isMatch,false);
});
test('recruiting and other support suffixes are excluded consistently for every investor title alias',()=>{
 for(const alias of ['Investor','Angel Investor','VC','Venture Capitalist','Venture Partner','Investment Partner']){
  for(const suffix of ['recruiter','recruitment','recruiting','relations','services','communications','analyst','operations','research','conference organizer','newsletter','tools']){
   const text=`Early-stage ${alias} ${suffix}`;
   for(const input of [headline(text),{role:text}]){
    const result=assessCandidate(goal,input);assert.equal(result.contactRoutes.length,0,text);assert.equal(result.isMatch,false,text);
   }
  }
 }
});
test('qualified investor ranking matches individual assessments and excludes adjacent non-investor work',()=>{
 const inputs:CandidateInput[]=[{id:'qualified',role:'Early-stage Investor'}, {...headline('Technology Investor'),id:'headline'},
  {id:'relations',role:'Early-stage Investor Relations'},{id:'founder',role:'Founder'}];
 const results=rankGoalNetwork(goal,inputs,[],{limit:10});assert.deepEqual(new Set(results.map(row=>row.person.id)),new Set(['qualified','headline']));
 for(const row of results){const individual=assessCandidate(goal,row.person);assert.deepEqual(row.contactRoutes,individual.contactRoutes);assert.equal(row.rank,individual.rank);}
});
