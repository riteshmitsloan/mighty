import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readProfile, readSearchResults} from '../src/profile.js';
import {renderedCandidate, assessProfileGoals} from '../src/goal-assessment.js';
import {accountGoalContext} from '../src/goal-context.js';
import {inboxPayload, validateSave} from '../src/messaging.js';
import {currentExperienceFields} from '../src/experience-fields.js';
import {validCurrentExperienceAnchor} from '../../src/lib/current-experience';
import type {Goal, GoalCriterion} from '../../src/lib/goals';
import type {Profile, Session} from '../src/types.js';

const deps=process.env.MIGHTY_DEPS_ROOT||fileURLToPath(new URL('../../',import.meta.url));
const {parseHTML}=createRequire(resolve(deps,'package.json'))('linkedom');
const documentOf=(html:string)=>parseHTML(html).document as Document;
const url='https://www.linkedin.com/in/jordan-rivers/', now='2026-09-13T12:00:00.000Z';
const uid='12345678-1234-4234-9234-123456789abc', operationId='32345678-1234-4234-9234-123456789abc';
const session:Session={userId:uid,accessToken:'synthetic-only',expiresAt:Date.parse(now)+100000,strategy:''};
const fixture=()=>readProfile(documentOf(readFileSync(new URL('./fixtures/profile-structured-current.html',import.meta.url),'utf8')),url,now)!;
const read=(body:string)=>readProfile(documentOf('<main><section><h1>A Person</h1></section><section><h2>Experience</h2><ul>'+body+'</ul></section></main>'),url,now)!;
const entry=(fields='<span itemprop="jobTitle">Engineering Director</span><span itemprop="worksFor">Harbor Health</span>',date='<p>Jan 2023 – Present</p>',extra='')=>'<li>'+fields+date+extra+'</li>';
const typed=(p:Profile)=>p.anchors.filter(anchor=>anchor.field!==undefined);
const save=(p:Profile)=>validateSave({operationId,userId:uid,source:'rendered_profile',profile:p},session);
const criterion=(id:string,field:GoalCriterion['field'],terms:string[],appliesTo:GoalCriterion['appliesTo']='contact'):GoalCriterion=>({id,field,terms,appliesTo,label:id,importance:'required',origin:'user'});
const career:Goal={id:operationId,kind:'career',title:'Career',outcome:'Explore engineering leadership opportunities',criteria:[criterion('role','role',['Engineering Director'],'opportunity'),criterion('sector','industry',['FMCG'],'opportunity')],openQuestions:[],version:1,status:'active',createdAt:now,updatedAt:now};

test('synthetic current microdata preserves raw source, separate date and exact role/company through save',()=>{
  const p=fixture(), fields=typed(p);
  assert.deepEqual(fields.map(a=>[a.field,a.text]),[['role','Engineering Director'],['company','Harbor Health']]);
  for(const a of fields){assert.equal(a.kind,'experience');assert.equal(a.observedAt,now);assert.equal(a.sourceUrl,url+'#experience');assert.equal(a.currentExperience?.dateRange,'Jan 2023 – Present');assert.ok(a.currentExperience?.entryText.endsWith('Leads patient data infrastructure.'));assert.equal(validCurrentExperienceAnchor(a,p.anchors,url,now),true);}
  assert.ok(p.anchors.some(a=>a.field===undefined&&a.text.includes('Previous Systems')));
  assert.ok(p.anchors.some(a=>a.field===undefined&&a.text.includes('Unnamed Ventures')));
  assert.deepEqual(inboxPayload(save(p)).snapshot.anchors,p.anchors);
});
test('exact visible definition labels support aliases and normalized case without generic bold/div guessing',()=>{
  for(const role of ['Job title','Role','POSITION'])for(const company of ['Company','  Employer  ']){
    const p=read(entry('<dl><dt>'+role+'</dt><dd>Engineering Director</dd><dt>'+company+'</dt><dd>Harbor Health</dd></dl>'));
    assert.deepEqual(typed(p).map(a=>a.text),['Engineering Director','Harbor Health']);
  }
  for(const role of ['Desired role','Previous role','Title at school','Role description'])assert.equal(typed(read(entry('<dl><dt>'+role+'</dt><dd>CEO</dd></dl>'))).length,0);
});
test('legacy rich fixture remains untyped with every original source anchor preserved',()=>{
  const p=readProfile(documentOf(readFileSync(new URL('./fixtures/profile-rich.html',import.meta.url),'utf8')),url,now)!;
  assert.equal(p.anchors.length,14);assert.equal(typed(p).length,0);
  assert.ok(!renderedCandidate(p).claims.some(claim=>['role','company','industry'].includes(claim.field)));
});
test('past, missing, future and invalid calendar dates never promote current fields',()=>{
  for(const date of ['', '<p>Jan 2020 – Dec 2022</p>','<p>Oct 2026 – Present</p>','<p>2026-02-30 – Present</p>','<p>2027 – Current</p>','<p>Present</p>']){
    const p=read(entry(undefined,date));assert.equal(typed(p).length,0,date);assert.ok(p.anchors.some(a=>a.text.includes('Engineering Director')));
  }
});
test('a date embedded in prose or supplied only through an attribute does not verify current employment',()=>{
  for(const date of ['<p>Discussed Jan 2023 – Present with a colleague.</p>','<time datetime="2023-01-01">Three years</time>','<meta itemprop="endDate" content="Present">'])assert.equal(typed(read(entry(undefined,date))).length,0,date);
});
test('conflicting semantic titles, employer names or date ranges fail the entire entry',()=>{
  for(const extra of ['<span itemprop="jobTitle">CEO</span>','<span itemprop="worksFor">Other Company</span>','<p>2020 – 2022</p>','<p>2024 – Present</p>','<span itemprop="endDate">2025</span>','<dl><dt>End date</dt><dd>2025</dd></dl>'])assert.equal(typed(read(entry(undefined,undefined,extra))).length,0,extra);
});
test('nested/grouped entries and another scoped person cannot confer their title on the entry',()=>{
  for(const extra of ['<ul><li>Another position</li></ul>','<span itemscope itemtype="https://schema.org/Person"><span itemprop="jobTitle">CEO</span></span>'])assert.equal(typed(read(entry(undefined,undefined,extra))).length,0);
  assert.equal(typed(read(entry('<span itemprop="worksFor"><span itemprop="name">Harbor Health</span><span itemprop="jobTitle">CEO</span></span>'))).length,0);
  assert.equal(typed(read(entry('<span itemprop="worksFor"><span itemprop="name">Harbor Health</span><dl><dt>Role</dt><dd>CEO</dd></dl></span>'))).length,0);
});
test('hidden titles, companies, labels and dates do not contribute or leak into saved facts',()=>{
  for(const hiding of ['hidden','style="display:none"','style="visibility:hidden"','class="visually-hidden"']){
    const p=read(entry('<span itemprop="jobTitle" '+hiding+'>PRIVATE CEO</span><span itemprop="worksFor">Harbor Health</span>'));
    assert.equal(typed(p).filter(a=>a.field==='role').length,0);assert.ok(!JSON.stringify(p).includes('PRIVATE'));
    assert.equal(typed(read(entry(undefined,'<p '+hiding+'>Jan 2023 – Present</p>'))).length,0);
  }
  const p=read(entry('<dl><dt hidden>Role</dt><dd>PRIVATE LABEL CEO</dd><dt>Company</dt><dd hidden>PRIVATE COMPANY</dd></dl>'));
  assert.equal(typed(p).length,0);assert.ok(!JSON.stringify(p).includes('PRIVATE COMPANY'));
});
test('ambiguous or empty employer structures and malformed definition lists stay untyped',()=>{
  for(const fields of ['<span itemprop="worksFor"><b>Company</b><small>Address</small></span>','<span itemprop="worksFor"><span itemprop="name">One</span><span itemprop="name">Two</span></span>','<span itemprop="jobTitle"></span>','<dl><dt>Role</dt><dd>CEO</dd><dd>Investor</dd></dl>','<dl><dt>Role</dt><p>CEO</p></dl>'])assert.equal(typed(read(entry(fields))).length,0,fields);
});
test('a role or company can stand alone without fabricating its missing counterpart',()=>{
  assert.deepEqual(typed(read(entry('<span itemprop="jobTitle">Engineering Director</span>'))).map(a=>a.field),['role']);
  assert.deepEqual(typed(read(entry('<span itemprop="worksFor">Harbor Health</span>'))).map(a=>a.field),['company']);
});
test('multiple separate current roles retain each provenance without asserting an exclusive or primary employer',()=>{
  const p=read(entry()+entry('<dl><dt>Role</dt><dd>Board member</dd><dt>Company</dt><dd>Community Foundation</dd></dl>','<p>2024 – Current</p>'));
  assert.equal(typed(p).length,4);assert.ok(typed(p).every(a=>validCurrentExperienceAnchor(a,p.anchors,url,now)));
  const candidate=renderedCandidate(p);assert.equal(candidate.company,'');assert.equal(candidate.claims.filter(a=>a.field==='role').length,2);assert.ok(candidate.claims.every(a=>a.exclusive!==true));
});
test('field and entry limits refuse promotion without silently trimming raw evidence',()=>{
  const long='X'.repeat(201)+'FIELD_END';const p=read(entry('<span itemprop="jobTitle">'+long+'</span>'));
  assert.equal(typed(p).length,0);assert.ok(p.anchors.some(a=>a.text.includes(long)));
  const body='Long body '.repeat(801)+'ENTRY_END', larger=read(entry(undefined,undefined,'<p>'+body+'</p>'));
  assert.equal(typed(larger).length,0);assert.ok(larger.anchors.some(a=>a.text.endsWith('ENTRY_END')));assert.doesNotThrow(()=>save(larger));
  const huge=read(entry(undefined,undefined,'<p>'+body.repeat(8)+'HUGE_END</p>'));
  assert.equal(typed(huge).length,0);assert.ok(huge.anchors.some(a=>a.text.endsWith('HUGE_END')));assert.throws(()=>save(huge),/snapshot size limit/);
});
test('shared engine gains the explicit career contact route while opportunities and unrelated fundraising stay unknown',()=>{
  const p=fixture(), fundraising:Goal={...career,id:'42345678-1234-4234-9234-123456789abc',kind:'fundraising',criteria:[criterion('investor','role',['investor']),criterion('stage','stage',['seed'],'opportunity')]};
  const goals=[career,fundraising], context=accountGoalContext(uid,goals.map(goal=>({id:goal.id,user_id:uid,version:goal.version,document:goal})),now);
  const result=assessProfileGoals(uid,context,{kind:'profile',state:'ready',profile:p,message:''});assert.equal(result.state,'ready');if(result.state!=='ready')return;
  assert.ok(result.assessments[0].assessment.contactRoutes.some(route=>route.kind==='peer'));
  assert.ok(result.assessments[0].assessment.criteria.every(row=>row.status==='unknown'));
  assert.equal(result.assessments[1].assessment.status,'unknown');assert.equal(result.assessments[1].assessment.contactRoutes.length,0);
  assert.ok(!result.candidate.claims.some(claim=>claim.field==='role'&&['CEO','Professor','Investor'].includes(claim.text)));
  assert.ok(!result.candidate.claims.some(claim=>claim.field==='industry'));
  for(const a of p.anchors)assert.ok(result.candidate.claims.some(claim=>claim.text===a.text&&claim.sourceRef===a.sourceUrl&&claim.observedAt===a.observedAt));
});
test('save boundary rejects unknown fields, wrong kinds, missing provenance and altered source associations',()=>{
  for(const change of [
    {field:'industry'},{field:'stage'},{field:'context'},{field:null},{kind:'headline'},
    {currentExperience:undefined},{currentExperience:{dateRange:'2020 – 2022',entryText:'Engineering Director 2020 – 2022'}},
    {sourceUrl:url+'#about'},{observedAt:'2026-09-12T12:00:00.000Z'},
    {appliesTo:'opportunity'},{polarity:'negative'},
  ]){
    const p=fixture(), at=p.anchors.findIndex(a=>a.field==='role');p.anchors[at]={...p.anchors[at],...change} as never;
    assert.throws(()=>save(p),/current experience field/);
  }
  for(const kind of ['experience','timing']){
    const p=fixture(), role=typed(p)[0];p.anchors=p.anchors.filter(a=>!(a.kind===kind&&a.field===undefined&&a.text===(kind==='experience'?role.currentExperience?.entryText:role.currentExperience?.dateRange)));
    assert.throws(()=>save(p),/current experience field/);
  }
});
test('assessment refuses unsupported typed metadata while preserving its raw text as context',()=>{
  const p=fixture(), role=typed(p)[0];role.currentExperience={dateRange:'2020 – 2022',entryText:'Engineering Director 2020 – 2022'};
  const candidate=renderedCandidate(p);assert.ok(candidate.claims.some(a=>a.field==='context'&&a.text==='Engineering Director'));assert.ok(!candidate.claims.some(a=>a.field==='role'));
});
test('search snippets cannot acquire typed evidence even when cards include semantic fields',()=>{
  const searchUrl='https://www.linkedin.com/search/results/people/?keywords=engineering',doc=documentOf('<main><li><h3><a href="'+url+'">Jordan Rivers</a></h3><span itemprop="jobTitle">Engineering Director</span><p>2023 – Present</p></li></main>');
  const rows=readSearchResults(doc,searchUrl);assert.equal(rows.length,1);assert.equal(rows[0].profileReadAt,null);assert.ok(!('anchors' in rows[0]));
  const context=accountGoalContext(uid,[{id:career.id,user_id:uid,version:career.version,document:career}],now);
  assert.equal(assessProfileGoals(uid,context,{kind:'search',state:'ready',results:rows,message:''}).state,'unread');
});
test('non-list semantic content is kept as context and cannot imply a verified entry boundary',()=>{
  const doc=documentOf('<main><h1>Person</h1><section><h2>Experience</h2><span itemprop="jobTitle">CEO</span><p>2023 – Present</p></section></main>');
  const p=readProfile(doc,url,now)!;assert.equal(typed(p).length,0);assert.ok(p.anchors.some(a=>a.text.includes('CEO')));
  assert.deepEqual(currentExperienceFields(doc.querySelector('section')!,now),[]);
});
