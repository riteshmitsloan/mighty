import test from 'node:test';
import assert from 'node:assert/strict';
import {createGoal, reviseGoal, normalizeGoal, normalizeGoalWorkspace, migrateLegacyGoalWorkspace, upsertWorkspaceGoal, type Goal, type GoalWorkspace} from '../src/lib/goals';
import {createGoalStore, GoalConflictError, type GoalStorage, type GoalRecord, type GoalCloudAdapter} from '../src/lib/goal-store';
const A='11111111-1111-4111-8111-111111111111', B='22222222-2222-4222-8222-222222222222';
const make = () => createGoal({kind:'other',title:'Test objective',outcome:'A synthetic outcome'}, {now:'2026-01-01T00:00:00.000Z'});
const ws = (goal:Goal):GoalWorkspace => ({goals:[goal],activeGoalId:goal.status==='active'?goal.id:null});
function fixture() {
  const records=new Map<string,GoalRecord>(); const remote=new Map<string,Map<string,Goal>>(); let current=A;
  const storage:GoalStorage={async transact(key,change){const previous=records.get(key);const next=change(previous?structuredClone(previous):undefined);if(next)records.set(key,structuredClone(next));return next?structuredClone(next):undefined;}};
  const cloud:GoalCloudAdapter={async assertAccount(uid){if(uid!==current)throw Error('Account changed');},async list(uid){return [...(remote.get(uid)?.values()??[])];},async save(uid,goal,expected){const rows=remote.get(uid)??new Map();const old=rows.get(goal.id);if(old&&old.version!==expected)throw Object.assign(Error('Conflict'),{code:'40001'});const saved={...goal,version:(old?.version??0)+1};rows.set(goal.id,saved);remote.set(uid,rows);return saved;}};
  return {records,remote,cloud,storage,store:createGoalStore({storage,cloud}),switchAccount:(uid:string)=>{current=uid;}};
}
function deferred<T>() {let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}

test('legacy migration preserves exact words and honors an intentionally empty workspace',()=>{
  const original='  A synthetic first line\n\tand a second line.  ';
  const migrated=migrateLegacyGoalWorkspace(null,original);
  assert.equal(migrated.goals[0].outcome,original);assert.equal(migrated.goals[0].kind,'other');
  assert.deepEqual(migrateLegacyGoalWorkspace({goals:[],activeGoalId:null},original),{goals:[],activeGoalId:null});
  assert.deepEqual(migrateLegacyGoalWorkspace(migrated,'Changed legacy text'),migrated);
  assert.equal(migrateLegacyGoalWorkspace(null,'').goals.length,0);
});
test('revision retains identity and facts, increments only for changes, and never mutates its input',()=>{
  const original=make();const revised=reviseGoal(original,{title:'Updated test objective'},{now:'2026-01-02T00:00:00.000Z'});
  assert.equal(original.title,'Test objective');assert.equal(revised.id,original.id);assert.equal(revised.createdAt,original.createdAt);assert.equal(revised.version,2);
  assert.deepEqual(reviseGoal(revised,{title:revised.title}),revised);
  const paused=reviseGoal(revised,{status:'paused'});assert.equal(upsertWorkspaceGoal(ws(revised),paused).activeGoalId,null);
});
test('validation refuses malformed criteria, invalid active references, unsafe text and unbounded values',()=>{
  const goal=make();const criterion={id:'sector',field:'industry',label:'Industry',terms:['Test sector'],importance:'preferred',appliesTo:'opportunity',origin:'user'};
  for(const patch of [{outcome:'\u0000bad'},{title:' '},{version:0},{kind:null},{outcome:'x'.repeat(16001)},{criteria:[criterion,criterion]},{criteria:[{...criterion,importance:null}]}])assert.throws(()=>normalizeGoal({...goal,...patch}));
  assert.throws(()=>normalizeGoalWorkspace({goals:[goal],activeGoalId:crypto.randomUUID()}));
  assert.throws(()=>normalizeGoalWorkspace({goals:[goal,goal],activeGoalId:goal.id}));
});
test('local workspaces remain small account-bound records, including explicit emptiness',async()=>{
  const f=fixture();assert.equal(await f.store.readGoalWorkspace(A),null);
  const a=make(),b=make();await Promise.all([f.store.saveGoalWorkspace(A,ws(a)),f.store.saveGoalWorkspace(B,ws(b))]);
  assert.equal((await f.store.readGoalWorkspace(A))!.goals[0].id,a.id);assert.equal((await f.store.readGoalWorkspace(B))!.goals[0].id,b.id);
  await f.store.saveGoalWorkspace(A,{goals:[],activeGoalId:null});assert.deepEqual(await f.store.readGoalWorkspace(A),{goals:[],activeGoalId:null});
  assert.equal((await f.store.readGoalWorkspace(B))!.goals[0].id,b.id);
});
test('failed local writes do not poison later saves or expose a success state',async()=>{
  let fail=true;const f=fixture();const base=f.storage.transact;
  f.storage.transact=async(...args)=>{if(fail){fail=false;throw Error('Storage full');}return base(...args);};
  await assert.rejects(f.store.saveGoalWorkspace(A,ws(make())),/Storage full/);
  const goal=make();await f.store.saveGoalWorkspace(A,ws(goal));assert.equal((await f.store.readGoalWorkspace(A))!.goals[0].id,goal.id);
});
test('cloud restore preserves absence until data exists and advances only clean local goals',async()=>{
  const f=fixture();assert.deepEqual(await f.store.loadAccountGoals(A),{goals:[],activeGoalId:null});assert.equal(await f.store.readGoalWorkspace(A),null);
  const goal=make();f.remote.set(A,new Map([[goal.id,goal]]));await f.store.loadAccountGoals(A);
  const updated=reviseGoal(goal,{outcome:'Remote test update'});f.remote.get(A)!.set(goal.id,updated);
  assert.equal((await f.store.loadAccountGoals(A)).goals[0].outcome,updated.outcome);assert.equal((await f.store.readGoalSyncState(A)).versions[goal.id],2);
});
test('offline revisions retain an independent cloud baseline and competing edits require a choice',async()=>{
  const f=fixture(),goal=make();f.remote.set(A,new Map([[goal.id,goal]]));await f.store.loadAccountGoals(A);
  const local=reviseGoal(reviseGoal(goal,{outcome:'Local test revision'}),{title:'Local title'});await f.store.saveGoalWorkspace(A,ws(local));
  assert.equal((await f.store.loadAccountGoals(A)).goals[0].version,3);assert.equal((await f.store.readGoalSyncState(A)).versions[goal.id],1);
  const remote=reviseGoal(goal,{outcome:'Independent cloud change'});f.remote.get(A)!.set(goal.id,remote);
  await assert.rejects(f.store.loadAccountGoals(A),(e:unknown)=>e instanceof GoalConflictError&&e.workspace.goals[0].outcome===local.outcome&&e.conflicts[0].remote.outcome===remote.outcome);
  await assert.rejects(f.store.saveAccountGoal(A,local,1),GoalConflictError);
  await f.store.resolveGoalConflict(A,goal.id,'local');assert.equal((await f.store.readGoalSyncState(A)).versions[goal.id],2);
  const saved=await f.store.saveAccountGoal(A,local,2);assert.equal(saved.version,3);assert.equal(saved.outcome,local.outcome);
});
test('explicit remote conflict choice replaces only that goal and keeps unrelated local work',async()=>{
  const f=fixture(),goal=make();f.remote.set(A,new Map([[goal.id,goal]]));await f.store.loadAccountGoals(A);
  const other=make(),local=reviseGoal(goal,{outcome:'Local edit'});await f.store.saveGoalWorkspace(A,{goals:[local,other],activeGoalId:other.id});
  const remote=reviseGoal(goal,{outcome:'Remote edit'});f.remote.get(A)!.set(goal.id,remote);await assert.rejects(f.store.loadAccountGoals(A),GoalConflictError);
  const merged=await f.store.resolveGoalConflict(A,goal.id,'remote');assert.equal(merged.goals.find(g=>g.id===goal.id)!.outcome,remote.outcome);assert.equal(merged.activeGoalId,other.id);assert.ok(merged.goals.some(g=>g.id===other.id));
});
test('a committed cloud save never erases a newer local edit',async()=>{
  const f=fixture(),goal=make();f.remote.set(A,new Map([[goal.id,goal]]));await f.store.loadAccountGoals(A);
  const started=deferred<void>(),release=deferred<void>(),save=f.cloud.save;f.cloud.save=async(...args)=>{started.resolve();await release.promise;return save(...args);};
  const selected=reviseGoal(goal,{outcome:'Selected revision'});await f.store.saveGoalWorkspace(A,ws(selected));const pending=f.store.saveAccountGoal(A,selected,1);await started.promise;
  const newer=reviseGoal(selected,{outcome:'Newer unsaved typing'});await f.store.saveGoalWorkspace(A,ws(newer));release.resolve();await pending;
  assert.equal((await f.store.readGoalWorkspace(A))!.goals[0].outcome,newer.outcome);assert.equal((await f.store.readGoalSyncState(A)).versions[goal.id],2);
});
test('an old refresh cannot undo a newer confirmed cloud save',async()=>{
  const f=fixture(),goal=make();f.remote.set(A,new Map([[goal.id,goal]]));await f.store.loadAccountGoals(A);
  const started=deferred<void>(),release=deferred<readonly Goal[]>();f.cloud.list=async()=>{started.resolve();return release.promise;};
  const pending=f.store.loadAccountGoals(A);await started.promise;
  const changed=reviseGoal(goal,{outcome:'New confirmed content'});await f.store.saveGoalWorkspace(A,ws(changed));await f.store.saveAccountGoal(A,changed,1);
  release.resolve([goal]);await pending;assert.equal((await f.store.readGoalWorkspace(A))!.goals[0].outcome,changed.outcome);
});
test('account changes during reads or saves cannot retarget another local workspace',async()=>{
  const f=fixture(),goal=make(),other=make();await f.store.saveGoalWorkspace(B,ws(other));
  const started=deferred<void>(),release=deferred<readonly Goal[]>();f.cloud.list=async()=>{started.resolve();return release.promise;};
  const pending=f.store.loadAccountGoals(A);await started.promise;f.switchAccount(B);release.resolve([goal]);await assert.rejects(pending,/Account changed/);
  assert.equal(await f.store.readGoalWorkspace(A),null);assert.equal((await f.store.readGoalWorkspace(B))!.goals[0].id,other.id);
  await assert.rejects(f.store.saveAccountGoal(A,goal,0),/Account changed/);assert.equal(f.remote.size,0);
});
