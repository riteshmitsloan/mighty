import {test} from 'node:test';
import assert from 'node:assert/strict';
import {completedCommitmentIds, openGoalCommitments, goalEventLabel, createCommitmentCompleter} from '../src/lib/relationship-events';
import {createGoal} from '../src/lib/goals';
import type {Capture} from '../src/lib/workspace';
import type {GoalInteractionInput, InteractionRecord} from '../src/lib/relationship-context';
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const goalA = createGoal({kind:'career',title:'Career fixture',outcome:'A synthetic professional goal'}, {id:id(1)});
const goalB = createGoal({kind:'fundraising',title:'Funding fixture',outcome:'A separate synthetic goal'}, {id:id(2)});
const event = (n:number, patch:Partial<Capture>={}):Capture => ({id:id(n),relationship_id:id(10),kind:'next_step',body:'A recorded next action',related_event_id:null,created_at:'2026-09-12T12:00:00Z',goal_id:goalA.id,goal_version:1,...patch});
const response = (p:GoalInteractionInput):InteractionRecord => ({id:id(99),requestId:p.requestId,relationshipId:p.relationshipId,goalId:p.goalId??null,goalVersion:p.goalVersion??null,kind:p.kind,body:p.body??'',relatedEventId:p.relatedEventId??null,dueAt:null,createdAt:'2026-09-13T12:00:00Z'});

test('Today includes only open selected-goal commitments and optional unscoped legacy promises',()=>{
 const original=event(20), completed=event(21,{kind:'next_step_completed',related_event_id:original.id});
 const rows=[event(22),event(23,{goal_id:goalB.id}),event(24,{kind:'promise_made',goal_id:null,goal_version:null}),original,completed,event(25,{relationship_id:id(11)})];
 assert.deepEqual(new Set(openGoalCommitments(rows,{activeGoalId:goalA.id,relationshipIds:new Set([id(10)])}).map(row=>row.id)),new Set([id(22),id(24)]));
 assert.deepEqual(openGoalCommitments(rows,{activeGoalId:null}).map(row=>row.id),[id(24)]);
 assert.deepEqual(openGoalCommitments(rows,{activeGoalId:null,includeLegacy:false}),[]);
});
test('unrelated notes, other people, other goals, and wrong completion kinds cannot close a next step',()=>{
 const original=event(20);
 const invalid=[event(21,{kind:'note',related_event_id:original.id}),event(22,{kind:'next_step_completed',relationship_id:id(11),related_event_id:original.id}),event(23,{kind:'next_step_completed',goal_id:goalB.id,related_event_id:original.id}),event(24,{kind:'promise_kept',related_event_id:original.id})];
 assert.equal(completedCommitmentIds([original,...invalid]).size,0);
 assert.deepEqual(openGoalCommitments([original,...invalid],{activeGoalId:goalA.id}).map(row=>row.id),[original.id]);
 assert.equal(completedCommitmentIds([original,...invalid,event(25,{kind:'next_step_completed',related_event_id:original.id})]).has(original.id),true);
});
test('reminders use due dates and stable creation order without mutating source history',()=>{
 const rows=[event(20,{due_at:null}),event(21,{due_at:'2026-09-15T12:00:00Z'}),event(22,{due_at:'2026-09-14T12:00:00Z'})],before=JSON.stringify(rows);
 assert.deepEqual(openGoalCommitments(rows,{activeGoalId:goalA.id}).map(row=>row.id),[id(22),id(21),id(20)]);assert.equal(JSON.stringify(rows),before);
 assert.equal(goalEventLabel(event(20),[{...goalA,version:2},goalB]),'Goal: Career fixture · earlier goal version');
 assert.equal(goalEventLabel(event(20),[goalB]),'Linked goal unavailable');
 assert.equal(goalEventLabel(event(20,{goal_id:null}),[goalA]),null);
});
test('double completion coalesces one write and pins original person, goal, version and action kind',async()=>{
 let release!:(value:InteractionRecord)=>void,started!:()=>void;const dispatched=new Promise<void>(resolve=>{started=resolve;});const calls:GoalInteractionInput[]=[];
 const complete=createCommitmentCompleter(async(uid,input)=>{assert.equal(uid,id(70));calls.push(input);started();return new Promise(resolve=>{release=resolve;});});
 const original=event(20),one=complete(id(70),original),two=complete(id(70),original);assert.equal(one,two);
 original.relationship_id=id(11);original.goal_id=goalB.id;
 await dispatched;assert.equal(calls.length,1);assert.equal(calls[0].relationshipId,id(10));assert.equal(calls[0].goalId,goalA.id);assert.equal(calls[0].goalVersion,1);assert.equal(calls[0].kind,'next_step_completed');assert.equal(calls[0].body,'');
 release(response(calls[0]));await one;
});
test('retry IDs survive helper recreation and remain account-scoped; failure never falls back locally',async()=>{
 const calls:{uid:string|null;input:GoalInteractionInput}[]=[];
 const record=async(uid:string|null,input:GoalInteractionInput)=>{calls.push({uid,input});if(calls.length===1)throw Error('Session expired');return response(input);};
 await assert.rejects(createCommitmentCompleter(record)(id(70),event(20)),/Session expired/);
 await createCommitmentCompleter(record)(id(70),event(20));await createCommitmentCompleter(record)(id(71),event(20));
 assert.equal(calls[0].input.requestId,calls[1].input.requestId);assert.notEqual(calls[1].input.requestId,calls[2].input.requestId);assert.ok(calls.every(call=>call.uid!==null));
});
test('explicit device completion supports legacy promises, but invalid or wrong-owner events are refused',async()=>{
 const calls:GoalInteractionInput[]=[];const complete=createCommitmentCompleter(async(uid,input)=>{assert.equal(uid,null);calls.push(input);return response(input);});
 await complete(null,event(20,{kind:'promise_made',goal_id:null,goal_version:null}));assert.equal(calls[0].kind,'promise_kept');assert.equal(calls[0].goalId,null);
 await assert.rejects(complete(null,event(21,{user_id:id(70)})),/another account/);
 await assert.rejects(complete(null,event(21,{kind:'contacted'})),/promise or next step/);
 await assert.rejects(complete(null,event(21,{goal_version:null})),/goal version/);
 assert.equal(calls.length,1);
});
