import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readProfile, snapshot} from '../src/profile.js';
import {assessProfileGoals} from '../src/goal-assessment.js';
import {compactFit, compactProfile} from '../src/compact-profile.js';
import {canRequestBrief} from '../src/scoring.js';
import {inboxPayload} from '../src/messaging.js';
import {partialProfileProjection} from '../../src/lib/partial-profile';
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

for(const marked of [false,true])test(`${marked?'verified':'markerless'} headline can suggest a funding conversation before lower sections exist`,()=>{
 const document=documentOf({marked,headline:'Founder | Investor',about:false}),page=snapshot(document,url);
 assert.equal(page.kind,'profile');if(page.kind!=='profile')throw Error('Expected a profile');
 const profile=page.profile!;assert.equal(profile.anchors[0]?.kind,'headline');assert.equal(profile.profileReadAt,null);
 const before=structuredClone(profile),result=assessProfileGoals(uid,context,page);
 assert.equal(result.state,'ready');if(result.state!=='ready')throw Error('Expected provisional assessment');
 assert.equal(result.basis,'headline');assert.equal(result.candidate.completeProfile,false);assert.equal(result.candidate.profileReadAt,null);
 assert.ok(result.candidate.claims.filter(claim=>!['name','url'].includes(claim.field)).every(claim=>claim.field==='context'&&claim.sourceLabel==='Rendered profile · headline'));
 for(const row of result.assessments){assert.equal(row.assessment.evidenceCoverage.supported,0);assert.ok(row.assessment.criteria.every(criterion=>criterion.status==='unknown'));assert.ok(row.assessment.contactRoutes.every(route=>route.provisional));}
 const fundingResult=result.assessments.find(row=>row.goal.id===funding.id)!;
 assert.equal(compactFit(fundingResult.assessment,funding).label,'Possible fit');
 const card=compactProfile(document,{page,connected:true,userId:uid,goalContext:context,selectedGoalId:null,onSelect(){}});
 assert.equal(card.querySelector('.goal-fit')?.getAttribute('data-goal-id'),funding.id);assert.equal(card.querySelector('.fit-label')?.textContent,'Possible fit');
 assert.equal(canRequestBrief(profile),false);
 const minimal=partialProfileProjection(profile)!;assert.ok(minimal);
 const payload=inboxPayload({operationId:'44444444-4444-4444-a444-444444444444',userId:uid,profile:minimal,source:'rendered_profile'});
 assert.equal(payload.profile_read_at,null);assert.equal(payload.snapshot.profileReadAt,null);assert.equal(payload.snapshot.anchors.length,1);
 assert.deepEqual(profile,before,'Provisional assessment never rewrites the source as a complete profile.');
});

test('unmatched, aspirational and adjacent incomplete headlines remain uncertain rather than a negative fit',()=>{
 for(const headline of ['Exploring investor roles','Former investor','Investor relations','Not an investor','Engineering interests']){
  const document=documentOf({headline,about:false}),page=snapshot(document,url);
  const card=compactProfile(document,{page,connected:true,userId:uid,goalContext:context,selectedGoalId:funding.id,onSelect(){}});
  assert.equal(card.querySelector('.fit-label')?.textContent,'Not enough information');
  assert.match(card.querySelector('.reason')?.textContent||'',/Only their headline is available/);
 }
});

test('the partial path refuses blocked, stale, ambiguous, typed and oversize headline metadata',()=>{
 const original=snapshot(documentOf({about:false}),url);assert.equal(original.kind,'profile');if(original.kind!=='profile')throw Error();
 const profile=original.profile!,headline=profile.anchors[0];
 const invalid=[{...original,state:'blocked' as const},{...original,state:'auth_required' as const},
  {...original,profile:{...profile,truncated:true}}, {...original,profile:{...profile,truncationReasons:['subject_changed']}},
  {...original,profile:{...profile,anchors:[]}}, {...original,profile:{...profile,anchors:[headline,headline]}},
  {...original,profile:{...profile,anchors:[{...headline,sourceUrl:other+'#profile'}]}},
  {...original,profile:{...profile,anchors:[{...headline,observedAt:'invalid'}]}},
  {...original,profile:{...profile,anchors:[{...headline,field:'role' as const}]}},
  {...original,profile:{...profile,anchors:[{...headline,text:'Investor '.repeat(10000)}]}},
  snapshot(documentOf({about:false,summary:toolbar('Investor at Example Organization',other)}),url),
  snapshot(documentOf({about:false}),other)];
 for(const page of invalid)assert.equal(assessProfileGoals(uid,context,page).state,'unread');
 for(const profile of [{...original.profile,anchors:[null]}, {...original.profile,truncationReasons:undefined},
  {...original.profile,name:42}, {...original.profile,anchors:[{...headline,text:{}}]}]){
  assert.equal(assessProfileGoals(uid,context,{...original,profile} as never).state,'unread','Malformed metadata is a read problem, not an account-goal error.');
 }
 assert.throws(()=>assessProfileGoals('99999999-9999-4999-a999-999999999999',context,original),/verified/);
});

test('partially hydrated lower sections cannot supply current roles or other typed criterion facts',()=>{
 const document=documentOf({marked:true,about:false});
 document.querySelector('[aria-label="Primary content"]')!.insertAdjacentHTML('beforeend','<section><h2>Experience</h2><div componentkey="Profile_Top_Level_ExperienceSectionanother-synthetic">CEO at Elsewhere</div></section>');
 const page=snapshot(document,url),result=assessProfileGoals(uid,context,page);
 assert.equal(result.state,'ready');if(result.state!=='ready')throw Error();
 assert.equal(result.basis,'headline');assert.equal(result.candidate.completeProfile,false);
 assert.ok(!result.candidate.claims.some(claim=>claim.text.includes('Elsewhere')||['role','company','industry','location'].includes(claim.field)));
 const hydrated=assessProfileGoals(uid,context,snapshot(documentOf({about:true}),url));
 assert.equal(hydrated.state,'ready');if(hydrated.state==='ready'){assert.equal(hydrated.basis,'profile');assert.equal(hydrated.candidate.completeProfile,true);}
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
