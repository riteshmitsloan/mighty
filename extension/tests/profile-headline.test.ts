import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readProfile, snapshot} from '../src/profile.js';
import {assessProfileGoals} from '../src/goal-assessment.js';
import {compactFit} from '../src/compact-profile.js';
import {accountGoalContext} from '../src/goal-context.js';
import {createGoal} from '../../src/lib/goals';

const {parseHTML}=createRequire(import.meta.url)('linkedom');
const url='https://www.linkedin.com/in/synthetic-headline/',other='https://www.linkedin.com/in/another-synthetic/';
const at='2026-09-13T12:00:00.000Z',uid='11111111-1111-4111-a111-111111111111';
const funding=createGoal({kind:'fundraising',title:'Find potential investors',outcome:'Discuss venture funding',criteria:[
 {id:'investor',field:'role',label:'Investor contact',terms:['Investor'],importance:'preferred',appliesTo:'contact',origin:'user'},
 {id:'stage',field:'stage',label:'Investment stage',terms:['Seed'],importance:'preferred',appliesTo:'opportunity',origin:'user'},
 {id:'check',field:'check_size',label:'Check size',terms:['$100000'],importance:'preferred',appliesTo:'opportunity',origin:'user'},
]},{id:'22222222-2222-4222-a222-222222222222',now:at});
const career=createGoal({kind:'career',title:'Find leadership opportunities',outcome:'Discuss relevant roles',criteria:[
 {id:'role',field:'role',label:'Opportunity role',terms:['Chief AI Officer'],importance:'preferred',appliesTo:'opportunity',origin:'user'},
 {id:'industry',field:'industry',label:'Opportunity industry',terms:['FMCG'],importance:'preferred',appliesTo:'opportunity',origin:'user'},
 {id:'location',field:'location',label:'Opportunity locations',terms:['New York','Chicago','San Francisco','Boston'],importance:'preferred',appliesTo:'opportunity',origin:'user'},
]},{id:'33333333-3333-4333-a333-333333333333',now:at});
const context=accountGoalContext(uid,[funding,career].map(goal=>({id:goal.id,user_id:uid,version:goal.version,document:goal})),at);
const toolbar=(headline:string,target=url,name='Synthetic Person')=>`<div role="toolbar" aria-hidden="true" inert><div><a href="${target}"><div aria-label="${name}"><div><p>${name}</p><div><p><span>${headline}</span></p></div></div></div></a></div></div>`;
function documentOf({headline='Investor at Example Organization',marked=false,summary=toolbar(headline),extra='',about=true}: {headline?:string;marked?:boolean;summary?:string;extra?:string;about?:boolean}={}) {
 const name=marked?'<a componentkey="ProfileVerificationTriggerRef-synthetic-headline"><div componentkey="ProfileVerificationTriggerRef-synthetic-headline"><h2>Synthetic Person</h2></div></a>':'<div><h2>Synthetic Person</h2></div>';
 return parseHTML(`<html><body>${summary}<main><section aria-label="Primary content"><div componentkey="com.linkedin.sdui.profile.card.refSyntheticTopcard"><section id="subject"><div><div>${name}<p>${headline}</p><p>Example City</p><p><a href="${url}overlay/contact-info/">Contact info</a></p>${extra}</div></div></section></div>${about?'<section><h2>About</h2><p>A professional introduction.</p></section>':''}</section></main></body></html>`).document as Document;
}
function assess(document:Document) {
 const profile=readProfile(document,url,at)!;
 assert.ok(profile);
 const result=assessProfileGoals(uid,context,{kind:'profile',state:profile.profileReadAt?'ready':'unknown',profile,message:''});
 assert.equal(result.state,'ready');if(result.state!=='ready')throw Error('Expected a complete profile');
 return {profile,result,funding:result.assessments.find(row=>row.goal.id===funding.id)!,career:result.assessments.find(row=>row.goal.id===career.id)!};
}

for(const marked of [false,true])test(`${marked?'verified':'markerless'} SDUI investor headline reaches the full assessment as a provisional funding connection`,()=>{
 const value=assess(documentOf({marked}));
 const headline=value.profile.anchors.find(anchor=>anchor.kind==='headline')!;
 assert.equal(headline.text,'Investor at Example Organization');assert.equal(headline.field,undefined);
 assert.equal(headline.sourceUrl,url+'#profile');assert.equal(headline.observedAt,at);
 const claim=value.result.candidate.claims.find(row=>row.sourceLabel==='Rendered profile · headline')!;
 assert.equal(claim.field,'context');assert.equal(claim.appliesTo,'contact');
 assert.ok(!value.result.candidate.claims.some(row=>['role','company','industry','location','stage','check_size'].includes(row.field)));
 const assessment=value.funding.assessment;
 assert.equal(assessment.contactRoutes[0]?.kind,'investor');assert.equal(assessment.contactRoutes[0]?.provisional,true);
 assert.equal(assessment.evidenceCoverage.supported,0);assert.ok(assessment.criteria.every(row=>row.status==='unknown'));
 assert.match(assessment.contactRoutes[0]!.reason,/mandate, stage and check size are unconfirmed/);
 assert.deepEqual(compactFit(assessment,funding),{label:'Possible fit',tone:'possible',reason:'Their headline describes an investor role. Explore whether your venture fits their investment focus.'});
 assert.equal(compactFit(value.career.assessment,career).label,'No clear connection yet');
 assert.notEqual(compactFit(value.career.assessment,career).reason,compactFit(assessment,funding).reason);
});

test('headline evidence alone does not unlock complete assessment or saving',()=>{
 const document=documentOf({about:false}),profile=readProfile(document,url,at)!;
 assert.equal(profile.anchors[0]?.kind,'headline');assert.equal(profile.profileReadAt,null);
 assert.equal(assessProfileGoals(uid,context,snapshot(document,url)).state,'unread');
});

test('unlabelled location, company and sidebar prose never substitute for the verified headline',()=>{
 for(const summary of ['',toolbar('Investor at Elsewhere'),toolbar('Investor at Example Organization',other),toolbar('Investor at Example Organization',url,'Other Person'),
  '<aside>'+toolbar('Investor at Example Organization')+'</aside>',toolbar('Investor at Example Organization')+toolbar('Investor at Example Organization')]){
  const value=assess(documentOf({marked:true,summary,extra:'<aside><p>Investor at Elsewhere</p></aside>'}));
  assert.ok(!value.profile.anchors.some(row=>row.kind==='headline'||row.kind==='location'));
  assert.equal(compactFit(value.funding.assessment,funding).label,'No clear connection yet');
 }
});

test('stale toolbar headlines cannot follow a URL change or replace unmatched top-card text',()=>{
 const document=documentOf({marked:true,headline:'Engineering leader',summary:toolbar('Investor at Example Organization')});
 assert.ok(!readProfile(document,url,at)?.anchors.some(row=>row.kind==='headline'));
 assert.equal(readProfile(document,other,at),null);
 for(const extra of ['<section><p>Investor at Example Organization</p></section>','<aside><p>Investor at Example Organization</p></aside>',
  '<p hidden>Investor at Example Organization</p>','<a href="'+other+'"><p>Investor at Example Organization</p></a>'])
  assert.ok(!readProfile(documentOf({marked:true,headline:'Engineering leader',summary:toolbar('Investor at Example Organization'),extra}),url,at)?.anchors.some(row=>row.kind==='headline'));
});

test('aspirational, negative and adjacent investor headlines remain context without an investor route',()=>{
 for(const headline of ['Exploring investor roles','Former investor at Example Organization','Investor relations at Example Organization','Advisor to investors','Not an investor']){
  const value=assess(documentOf({headline}));
  assert.equal(value.profile.anchors.find(row=>row.kind==='headline')?.text,headline);
  assert.equal(value.funding.assessment.contactRoutes.length,0);
  assert.equal(compactFit(value.funding.assessment,funding).label,'No clear connection yet');
 }
});

test('a changed corroborated headline changes the supported goal route without changing role criteria',()=>{
 const value=assess(documentOf({headline:'Head of Research at Example Organization'}));
 assert.equal(compactFit(value.funding.assessment,funding).label,'No clear connection yet');
 assert.equal(compactFit(value.career.assessment,career).label,'Possible fit');
 assert.match(compactFit(value.career.assessment,career).reason,/headline describes a senior leadership role/);
 assert.ok(value.career.assessment.criteria.every(row=>row.status==='unknown'));
});
