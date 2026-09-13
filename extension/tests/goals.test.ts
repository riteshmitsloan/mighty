import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountSession} from '../src/account-session.js';
import {AccountConnectionError} from '../src/account-errors.js';
import {accountGoalContext, loadAccountGoals, validateGoalContext} from '../src/goal-context.js';
import {assessProfileGoals, renderedCandidate} from '../src/goal-assessment.js';
import {assessCandidate} from '../../src/lib/assessment';
import type {Goal, GoalCriterion} from '../../src/lib/goals';
import type {PageSnapshot, Profile, Session} from '../src/types.js';
const uid = '12345678-1234-4234-9234-123456789abc', other = '22345678-1234-4234-9234-123456789abc';
const now = '2026-09-12T12:00:00.000Z', url = 'https://www.linkedin.com/in/person/';
const criterion = (id: string, field: GoalCriterion['field'], terms: string[], appliesTo: GoalCriterion['appliesTo'] = 'contact'): GoalCriterion => ({id,field,terms,appliesTo,label: id,importance:'required',origin:'user'});
const career: Goal = {id:'32345678-1234-4234-9234-123456789abc',kind:'career',title:'Career goal',outcome:'Find a leadership opportunity',criteria:[criterion('place','location',['London']),criterion('role','role',['CEO'],'opportunity')],openQuestions:[],version:1,status:'active',createdAt:now,updatedAt:now};
const fundraising: Goal = {...career,id:'42345678-1234-4234-9234-123456789abc',kind:'fundraising',title:'Fundraising goal',outcome:'Find a seed investor',criteria:[criterion('stage','stage',['seed'],'opportunity'),criterion('investor','role',['investor'])]};
const profile = (): Profile => ({profileUrl:url,name:'A Person',profileReadAt:now,truncated:false,truncationReasons:[],anchors:[
  {kind:'headline',text:'Exploring CEO roles',sourceUrl:url+'#profile',observedAt:now},
  {kind:'location',text:'London, United Kingdom',sourceUrl:url+'#profile',observedAt:now},
  {kind:'about',text:'Worked at Unilever. Interested in seed investing. '+ 'Full evidence. '.repeat(120)+'END_SENTINEL',sourceUrl:url+'#about',observedAt:now},
  {kind:'experience',text:'VP of engineering at Example · 2020–2022',sourceUrl:url+'#experience',observedAt:now},
  {kind:'skills',text:'Strategy',sourceUrl:url+'#skills',observedAt:now},
]});
const page = (p = profile()): PageSnapshot => ({kind:'profile',state:'ready',profile:p,message:''});
const rows = (goals: readonly Goal[], owner = uid) => goals.map(goal => ({id:goal.id,user_id:owner,version:goal.version,document:goal}));
const context = (goals: readonly Goal[] = [career,fundraising], owner = uid) => accountGoalContext(owner, rows(goals,owner), now);
const session = (owner = uid, goals: readonly Goal[] = [career]): Session => ({userId:owner,accessToken:'synthetic-token',expiresAt:Date.parse(now)+1800000,strategy:'old strategy',goalContext:context(goals,owner)});
function deferred<T>() {let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;const promise = new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function memory(value: Session | null = null) {return {value, async read(){return this.value;},async write(next:Session|null){this.value=next;}};}

test('one rendered profile gets independent career and fundraising results from the exact shared algorithm', () => {
  const result = assessProfileGoals(uid, context(), page()); assert.equal(result.state,'ready'); if(result.state!=='ready')return;
  assert.deepEqual(result.assessments.map(row=>row.assessment.goalId),[career.id,fundraising.id]);
  assert.equal(result.assessments[0].assessment.status,'supported'); assert.equal(result.assessments[1].assessment.status,'unknown');
  for(const row of result.assessments)assert.deepEqual(row.assessment,assessCandidate(row.goal,result.candidate,[]));
  assert.equal(result.assessments[0].assessment.contactRoutes.length,0);
});
test('contact location never fills opportunity location, industry, stage or a current role from free prose', () => {
  const goal = {...career,criteria:[criterion('city','location',['London'],'opportunity'),criterion('sector','industry',['FMCG']),criterion('stage','stage',['seed']),criterion('role','role',['CEO'])]};
  const result = assessProfileGoals(uid,context([goal]),page());assert.equal(result.state,'ready');if(result.state!=='ready')return;
  assert.ok(result.assessments[0].assessment.criteria.every(row=>row.status==='unknown'));
  assert.equal(result.assessments[0].assessment.contactRoutes.length,0);assert.equal(result.candidate.company,'');
  assert.ok(!result.candidate.claims.some(claim=>['company','role','industry','stage'].includes(claim.field)));
});
test('all source anchors survive with exact full text, URL and observation time', () => {
  const p = profile(), before=structuredClone(p), result=renderedCandidate(p);
  for(const anchor of p.anchors)assert.ok(result.claims.some(claim=>claim.text===anchor.text&&claim.sourceRef===anchor.sourceUrl&&claim.observedAt===anchor.observedAt&&claim.sourceKind==='profile'));
  assert.deepEqual(p,before);assert.ok(result.claims.some(claim=>claim.text.endsWith('END_SENTINEL')));
});
test('changed goal version or content changes the context and assessment identity immediately', () => {
  const first=assessProfileGoals(uid,context([career]),page());const revised={...career,version:2,criteria:[criterion('city','location',['Tokyo'])]};
  const next=assessProfileGoals(uid,context([revised]),page());assert.equal(first.state,'ready');assert.equal(next.state,'ready');if(first.state!=='ready'||next.state!=='ready')return;
  assert.notEqual(first.contextKey,next.contextKey);assert.notEqual(first.assessments[0].assessment.evidenceKey,next.assessments[0].assessment.evidenceKey);
  assert.equal(next.assessments[0].assessment.goalVersion,2);assert.equal(next.assessments[0].assessment.status,'unknown');
  const version=assessProfileGoals(uid,context([{...career,version:2}]),page());assert.equal(version.state,'ready');if(version.state==='ready')assert.notEqual(first.assessments[0].assessment.evidenceKey,version.assessments[0].assessment.evidenceKey);
});
test('no search snippet, fake ready snippet, truncated profile, or headline-only read is assessed', () => {
  const search:PageSnapshot={kind:'search',state:'ready',message:'',results:[{name:'Investor',subtitle:'Seed London CEO',profileUrl:url,profileReadAt:null,truncated:false}]};
  for(const snapshot of [search,page({...profile(),anchors:[]}),page({...profile(),truncated:true}),page({...profile(),anchors:profile().anchors.slice(0,1)}),page({...profile(),profileReadAt:null})])assert.equal(assessProfileGoals(uid,context(),snapshot).state,'unread');
});
test('empty and inactive account workspaces never fall back to old strategy', () => {
  assert.equal(assessProfileGoals(uid,context([]),page()).state,'no_goals');
  assert.equal(assessProfileGoals(uid,context([{...career,status:'paused'}]),page()).state,'no_active_goals');
});
test('cross-account or modified cached goal context is refused, and account is in context identity', () => {
  assert.throws(()=>assessProfileGoals(other,context(),page()),/verified/);
  assert.throws(()=>validateGoalContext({...context(),goals:[{...career,title:'Changed'}]},uid),/verified/);
  assert.notEqual(context([career],uid).key,context([career],other).key);
});
test('malformed, version-mismatched, foreign, duplicated and future-format goal rows fail as a whole', () => {
  for(const invalid of [null,{},[{...rows([career])[0],version:2}],rows([career],other),rows([career,career]),rows([{...career,criteria:[{...career.criteria[0],appliesTo:'company' as never}]}]),rows([{...career,schemaVersion:99} as Goal])])assert.throws(()=>accountGoalContext(uid,invalid),/incompatible/);
  const goals=Array.from({length:101},(_,i)=>({...career,id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`}));assert.throws(()=>context(goals),/incompatible/);
});
test('goals load with the verified bearer and explicit owner filter, not from handoff payload', async () => {
  const cfg={supabaseUrl:'https://project.supabase.co',publishableKey:'sb_publishable_test',appOrigins:[]};let calls=0;
  const result=await loadAccountGoals(session(),cfg,async (input,init)=>{
    calls++;const target=new URL(String(input));assert.equal(target.pathname,'/rest/v1/goals');assert.equal(target.searchParams.get('user_id'),'eq.'+uid);assert.equal(target.searchParams.get('limit'),'101');assert.equal(target.searchParams.get('select'),'id,user_id,version,document');
    assert.deepEqual(init?.headers,{apikey:cfg.publishableKey,Authorization:'Bearer synthetic-token',Prefer:'count=exact'});return new Response(JSON.stringify(rows([career])),{headers:{'Content-Range':'0-0/1'}});
  });assert.equal(calls,1);assert.equal(result.goals[0].id,career.id);
});
test('HTTP errors and incompatible responses never become a successful empty goals list', async () => {
  const cfg={supabaseUrl:'https://project.supabase.co',publishableKey:'public',appOrigins:[]};
  await assert.rejects(loadAccountGoals(session(),cfg,async()=>new Response('private error text',{status:403})),/could not be loaded/);
  await assert.rejects(loadAccountGoals(session(),cfg,async()=>new Response('not json')),/unreadable/);
  await assert.rejects(loadAccountGoals(session(),cfg,async()=>new Response('{}')),/incompatible/);
});
test('failed replacement handoff clears the previous account before failure', async () => {
  const storage=memory(session()),state=createAccountSession(storage,()=>{},()=>Date.parse(now)),pending=deferred<Session>();
  const job=state.connect(()=>pending.promise);await new Promise(resolve=>setImmediate(resolve));assert.equal(storage.value,null);
  pending.reject(new AccountConnectionError('goals_failed'));await assert.rejects(job,/could not be loaded/);
  assert.equal(await state.current(),null);assert.match(state.message(),/could not be loaded/);
});
test('unknown connection exceptions never become saved status diagnostics',async()=>{
  const state=createAccountSession(memory(session()),()=>{},()=>Date.parse(now));
  await assert.rejects(state.connect(async()=>{throw Error('PRIVATE_SENTINEL arbitrary failure');}));
  assert.equal(await state.current(),null);assert.doesNotMatch(state.message(),/PRIVATE_SENTINEL/);
  assert.match(state.message(),/connection could not be completed/);
});
test('slow account A cannot restore A after B handoff or disconnect', async () => {
  const storage=memory(),state=createAccountSession(storage,()=>{},()=>Date.parse(now)),pending=deferred<Session>();
  const a=state.connect(()=>pending.promise);await new Promise(resolve=>setImmediate(resolve));await state.connect(async()=>session(other));pending.resolve(session());await assert.rejects(a,/newer/);
  assert.equal((await state.current())?.userId,other);assert.equal((await state.current())?.goalContext?.userId,other);
  const later=deferred<Session>(),job=state.connect(()=>later.promise);await state.disconnect();later.resolve(session());await assert.rejects(job,/newer/);assert.equal(await state.current(),null);
});
test('expired and pre-upgrade sessions remove all cached strategy and goals', async () => {
  for(const value of [{...session(),expiresAt:Date.parse(now)},{...session(),goalContext:undefined},{...session(),goalContext:context([career],other)}]) {
    const storage=memory(value),state=createAccountSession(storage,()=>{},()=>Date.parse(now));assert.equal(await state.current(),null);assert.equal(storage.value,null);assert.ok(state.message());
  }
});
test('refresh replaces goal version and clears old context while loading', async () => {
  const storage=memory(session()),state=createAccountSession(storage,()=>{},()=>Date.parse(now)),pending=deferred<Session>();
  const job=state.refresh(()=>pending.promise);await new Promise(resolve=>setImmediate(resolve));assert.equal(await state.current(),null);
  pending.resolve(session(uid,[{...career,version:2}]));await job;assert.equal((await state.current())?.goalContext?.goals[0].version,2);assert.equal((await state.current())?.strategy,'');
});
test('server row caps and missing exact counts cannot silently shorten the account workspace', async () => {
  const cfg={supabaseUrl:'https://project.supabase.co',publishableKey:'public',appOrigins:[]};
  for(const range of ['0-0/2','0-0/*','1-1/1','*/*','']) {
    await assert.rejects(loadAccountGoals(session(),cfg,async()=>new Response(JSON.stringify(rows([career])),{headers:{'Content-Range':range}})),/completely/);
  }
  const empty=await loadAccountGoals(session(),cfg,async()=>new Response('[]',{headers:{'Content-Range':'*/0'}}));assert.equal(empty.goals.length,0);
  await assert.rejects(loadAccountGoals(session(),cfg,async()=>new Response('[]',{headers:{'Content-Range':'*/2'}})),/completely/);
});
test('an already-started read cannot return account A while account B clear is delayed', async () => {
  const clear=deferred<void>();let value:Session|null=session();
  const state=createAccountSession({async read(){return value;},async write(next){if(next===null)await clear.promise;value=next;}},()=>{},()=>Date.parse(now));
  let returned=false;
  const read=state.current().then(result=>{returned=true;return result;});
  const handoff=state.connect(async()=>session(other));
  await new Promise(resolve=>setImmediate(resolve));assert.equal(returned,false);
  clear.resolve();const result=await read;await handoff;
  assert.notEqual(result?.userId,uid);assert.notEqual(result?.goalContext?.userId,uid);
  assert.equal((await state.current())?.userId,other);
});
