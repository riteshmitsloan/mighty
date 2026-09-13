import test from 'node:test';
import assert from 'node:assert/strict';
import {createGoal} from '../src/lib/goals';
import type {LocalRelationshipState} from '../src/lib/local-relationships';
import {createRelationshipContextStore,normalizeMessageDraft,normalizeCandidateObservation,normalizeGoalInteraction,observationsToClaims,type MessageDraftInput,type CandidateObservationInput} from '../src/lib/relationship-context';
const uid='11111111-1111-4111-8111-111111111111';
function setup() {
 const personId=crypto.randomUUID(),otherPerson=crypto.randomUUID();const goal=createGoal({kind:'other',title:'Synthetic goal',outcome:'Synthetic outcome'});
 let state:LocalRelationshipState={people:[personId,otherPerson].map(id=>({id,person:'Test record',profile_url:null,stage:'saved',context:{},created_at:'2026-01-01T00:00:00.000Z'})),events:[],observations:[],drafts:[]};
 const local={async read(){return structuredClone(state);},async update<T>(change:(next:LocalRelationshipState)=>T){const next=structuredClone(state);const result=change(next);state=next;return result;},async goals(){return {goals:[goal],activeGoalId:goal.id};}};
 const store=createRelationshipContextStore({local});
 const draft:MessageDraftInput={requestId:crypto.randomUUID(),relationshipId:personId,goalId:goal.id,goalVersion:1,evidenceFingerprint:'a'.repeat(64),evidenceIds:['claim:test'],channel:'email',purpose:'Synthetic request',body:'An editable test draft'};
 const observation:CandidateObservationInput={requestId:crypto.randomUUID(),relationshipId:personId,field:'industry',text:'Test sector',sourceKind:'manual',sourceLabel:'Confirmed test context',appliesTo:'contact',confirmed:true};
 return {store,local,personId,otherPerson,goal,draft,observation,state:()=>state};
}
test('local draft retry is idempotent and editing uses revisions without recording sent',async()=>{
 const f=setup();const one=await f.store.saveMessageDraft(null,f.draft);assert.equal(one.revision,1);assert.equal((await f.store.saveMessageDraft(null,f.draft)).id,one.id);
 const changed={...f.draft,body:''};const two=await f.store.saveMessageDraft(null,changed,1);assert.equal(two.revision,2);assert.equal(two.body,'');
 await assert.rejects(f.store.saveMessageDraft(null,{...f.draft,body:'Stale body'},1),(e:any)=>e.code==='40001');
 await f.store.saveMessageDraft(null,{...changed,status:'copied'},2);assert.equal(f.state().drafts.length,1);assert.equal(f.state().events.length,0);
});
test('draft context cannot move to a different person, goal or evidence snapshot',async()=>{
 const f=setup();await f.store.saveMessageDraft(null,f.draft);
 await assert.rejects(f.store.saveMessageDraft(null,{...f.draft,relationshipId:f.otherPerson},1),/Changed context/);
 await assert.rejects(f.store.saveMessageDraft(null,{...f.draft,evidenceFingerprint:'b'.repeat(64)},1),/Changed context/);
 await assert.rejects(f.store.saveMessageDraft(null,{...f.draft,goalId:crypto.randomUUID()},1),/goal is unavailable/);
 assert.equal((await f.store.listRelationshipContext(null,f.personId)).drafts.length,1);
});
test('confirmed observations append corrections, preserve old facts and filter goal scope',async()=>{
 const f=setup();const first=await f.store.saveCandidateObservation(null,f.observation);assert.equal((await f.store.saveCandidateObservation(null,f.observation)).id,first.id);
 const second=await f.store.saveCandidateObservation(null,{...f.observation,requestId:crypto.randomUUID(),text:'Corrected test sector',supersedesId:first.id});
 const scoped=await f.store.saveCandidateObservation(null,{...f.observation,requestId:crypto.randomUUID(),goalId:f.goal.id,text:'Scoped test evidence'});
 const all=(await f.store.listRelationshipContext(null,f.personId)).observations;assert.equal(all.length,3);assert.equal(all[0].text,'Test sector');
 assert.deepEqual(observationsToClaims(all,f.personId).map(c=>c.id),['observation:'+second.id]);
 assert.equal(observationsToClaims(all,f.personId,f.goal.id).length,2);assert.equal(scoped.goalId,f.goal.id);
 await assert.rejects(f.store.saveCandidateObservation(null,{...f.observation,requestId:crypto.randomUUID(),relationshipId:f.otherPerson,supersedesId:first.id}),(e:any)=>e.code==='42501');
});
test('explicit sent, next step and completion retry without duplicate history or cross-goal completion',async()=>{
 const f=setup();const sent={requestId:crypto.randomUUID(),relationshipId:f.personId,goalId:f.goal.id,kind:'contacted' as const};
 const first=await f.store.recordGoalInteraction(null,sent);assert.equal((await f.store.recordGoalInteraction(null,sent)).id,first.id);
 await assert.rejects(f.store.recordGoalInteraction(null,{...sent,body:'Different action'}),(e:any)=>e.code==='23505');
 const step=await f.store.recordGoalInteraction(null,{requestId:crypto.randomUUID(),relationshipId:f.personId,goalId:f.goal.id,kind:'next_step',body:'Synthetic next step',dueAt:'2026-02-01T12:00:00.000Z'});
 const completed=await f.store.recordGoalInteraction(null,{requestId:crypto.randomUUID(),relationshipId:f.personId,kind:'next_step_completed',relatedEventId:step.id});
 assert.equal(completed.goalId,f.goal.id);assert.equal(completed.goalVersion,1);
 assert.equal((await f.store.recordGoalInteraction(null,{requestId:crypto.randomUUID(),relationshipId:f.personId,kind:'next_step_completed',relatedEventId:step.id})).id,completed.id);
 await assert.rejects(f.store.recordGoalInteraction(null,{requestId:crypto.randomUUID(),relationshipId:f.otherPerson,kind:'next_step_completed',relatedEventId:step.id}),/matching commitment/);
 assert.equal(f.state().events.length,3);
});
test('input validation refuses unconfirmed facts, unsafe text, missing context and invalid fingerprints',()=>{
 const f=setup();assert.throws(()=>normalizeCandidateObservation({...f.observation,confirmed:false as any}));
 assert.throws(()=>normalizeCandidateObservation({...f.observation,sourceKind:'public_source',sourceRef:'javascript:alert(1)'}));
 assert.throws(()=>normalizeMessageDraft({...f.draft,goalVersion:undefined as any}));assert.throws(()=>normalizeMessageDraft({...f.draft,evidenceFingerprint:'short'}));
 assert.throws(()=>normalizeGoalInteraction({requestId:crypto.randomUUID(),relationshipId:f.personId,kind:'next_step',body:' '}));
 assert.throws(()=>normalizeGoalInteraction({requestId:crypto.randomUUID(),relationshipId:f.personId,kind:'note',body:'bad\u0000text'}));
});
test('non-null failed account requests never fall back to the local workspace',async()=>{
 const f=setup();let called=false;const store=createRelationshipContextStore({local:f.local,cloud:{client:{rpc:async()=>{called=true;return {data:null,error:null};}} as any,assertAccount:async()=>{throw Error('Session expired');}}});
 await assert.rejects(store.saveMessageDraft(uid,f.draft),/Session expired/);assert.equal(called,false);assert.equal(f.state().drafts.length,0);
});
test('cloud zero writes and account switches surface errors instead of claiming success',async()=>{
 const f=setup();let checks=0;const store=createRelationshipContextStore({local:f.local,cloud:{client:{rpc:async()=>({data:null,error:null})} as any,assertAccount:async()=>{checks++;}}});
 await assert.rejects(store.saveMessageDraft(uid,f.draft),/not saved/);assert.equal(checks,1);
 const switched=createRelationshipContextStore({local:f.local,cloud:{client:{rpc:async()=>({data:{id:crypto.randomUUID()},error:null})} as any,assertAccount:async()=>{if(++checks>2)throw Error('Account changed');}}});
 await assert.rejects(switched.saveMessageDraft(uid,f.draft),/Account changed/);assert.equal(f.state().drafts.length,0);
});
