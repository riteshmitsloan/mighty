import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountSession} from '../src/account-session';
import {accountGoalContext} from '../src/goal-context';
import {assessProfileGoals} from '../src/goal-assessment';
import {buildExtensionSelfContext, SELF_CONTEXT_LIMITS} from '../../src/lib/extension-self-context';
import {createEvidenceClaim} from '../../src/lib/evidence';
import {createGoal} from '../../src/lib/goals';
import type {Session, PageSnapshot} from '../src/types';
const uid='11111111-1111-4111-a111-111111111111', other='22222222-2222-4222-a222-222222222222';
const skill=createEvidenceClaim({subject:'self',field:'skill',text:'Machine learning',sourceKind:'profile',sourceLabel:'Your profile',confidence:'observed',appliesTo:'contact'});
const goal=createGoal({kind:'career',title:'Career',outcome:'Find a research role',criteria:[{id:'role',field:'role',label:'Role',terms:['Scientist'],importance:'preferred',appliesTo:'opportunity',origin:'user'}]});
const goals=(owner=uid)=>accountGoalContext(owner,[{id:goal.id,user_id:owner,version:goal.version,document:goal}],new Date().toISOString());
const owner=(id=uid,now=Date.now()):Session=>({userId:id,accessToken:'fixture-'+id,expiresAt:now+3600000,strategy:'',goalContext:goals(id),selfContext:buildExtensionSelfContext(id,[skill],now)});
const memory=(value:Session|null)=>({value,async read(){return this.value;},async write(next:Session|null){this.value=next;}});
function deferred<T>(){let resolve!:(value:T)=>void;return {promise:new Promise<T>(done=>{resolve=done;}),resolve};}

test('goal refresh preserves the verified owner facts and ignores a loader-provided replacement',async()=>{
  const initial=owner(),storage=memory(initial),state=createAccountSession(storage);
  await state.refresh(async previous=>({...previous,goalContext:goals(),selfContext:owner(other).selfContext}));
  assert.equal((await state.current())?.selfContext?.userId,uid);
  assert.equal((await state.current())?.selfContext?.key,initial.selfContext?.key);
});
test('expired or corrupted self context is removed from storage without losing authentication or goals',async()=>{
  let clock=Date.now();const initial=owner(uid,clock),storage=memory(initial),state=createAccountSession(storage,()=>{},()=>clock);
  clock+=SELF_CONTEXT_LIMITS.lifetimeMs+1;
  const result=await state.current();assert.equal(result?.userId,uid);assert.equal(result?.goalContext?.goals[0].id,goal.id);assert.equal(result?.selfContext,undefined);assert.equal(storage.value?.selfContext,undefined);
  storage.value={...owner(uid,clock),selfContext:owner(other,clock).selfContext};
  assert.equal((await state.current())?.selfContext,undefined);assert.equal(storage.value?.userId,uid);
});
test('renewal with missing or empty profile data clears previous facts, and sign-out removes the account',async()=>{
  const storage=memory(owner()),state=createAccountSession(storage);
  const legacy={...owner(),selfContext:undefined};await state.connect(async()=>legacy);assert.equal((await state.current())?.selfContext,undefined);
  await state.connect(async()=>owner());await state.connect(async()=>({...owner(),selfContext:buildExtensionSelfContext(uid,[])}));
  assert.equal((await state.current())?.selfContext?.claims.length,0);
  await state.disconnect();assert.equal(storage.value,null);
});
test('slow old refresh cannot restore self facts after replacement or failed verification',async()=>{
  const storage=memory(owner()),state=createAccountSession(storage),pending=deferred<Session>();
  const old=state.refresh(()=>pending.promise);await new Promise(resolve=>setImmediate(resolve));await state.connect(async()=>owner(other));pending.resolve(owner());await old;
  assert.equal((await state.current())?.selfContext?.userId,other);
  await assert.rejects(state.connect(async()=>{throw Error('verification failed');}));assert.equal(storage.value,null);
});
test('profile adapter uses same-account supported overlap, but never foreign, missing or expired facts',()=>{
  const now=Date.now(),url='https://www.linkedin.com/in/fixture/',observedAt=new Date(now).toISOString();
  const page:PageSnapshot={kind:'profile',state:'ready',message:'',profile:{name:'Fixture',profileUrl:url,profileReadAt:observedAt,truncated:false,truncationReasons:[],anchors:[{kind:'skills',text:'Machine learning',sourceUrl:url+'#skills',observedAt}]}};
  const result=assessProfileGoals(uid,goals(),page,buildExtensionSelfContext(uid,[skill],now));
  assert.equal(result.state,'ready');if(result.state!=='ready')return;
  assert.ok(result.assessments[0].assessment.sharedContext?.some(value=>value.kind==='skill'&&value.claimIds.includes(skill.id)));
  assert.ok(result.assessments[0].assessment.criteria.every(value=>value.status==='unknown'));
  for(const context of [undefined,owner(other).selfContext,buildExtensionSelfContext(uid,[skill],now-SELF_CONTEXT_LIMITS.lifetimeMs-10)]){
    const rejected=assessProfileGoals(uid,goals(),page,context);assert.equal(rejected.state,'ready');if(rejected.state==='ready')assert.equal(rejected.assessments[0].assessment.sharedContext?.length??0,0);
  }
});
