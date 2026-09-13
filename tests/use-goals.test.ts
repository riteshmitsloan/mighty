import {test, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {useGoals, type GoalHookDependencies} from '../src/lib/use-goals';
import {createGoalLocalUpdater} from '../src/lib/goal-local-update';
import {createGoalStore, type GoalRecord, type GoalStorage} from '../src/lib/goal-store';
import {createGoal, reviseGoal, type Goal} from '../src/lib/goals';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function deferred<T>() {let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};}
const goal = (title: string) => createGoal({kind: 'career', title, outcome: `Explore ${title}`});
const record = (...goals: Goal[]): GoalRecord => ({workspace: {goals, activeGoalId: goals[0]?.id ?? null}, baselines: {}, conflicts: {}});
let root: Root, result: ReturnType<typeof useGoals>, key: string, uid: string | null, enabled: boolean, dependencies: GoalHookDependencies;
let stored: Map<string, GoalRecord>, cloudSaves: string[];
function Harness() {result = useGoals(key, uid, enabled, '', dependencies); return React.createElement('div', null, result.activeGoal?.title ?? 'No goal');}
async function render() {await act(async () => {root.render(React.createElement(Harness)); await tick();});}
beforeEach(() => {
  const {window} = parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis, {window, document: window.document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true});
  root = createRoot(document.getElementById('root')!); key = 'owner-a'; uid = key; enabled = true; stored = new Map(); cloudSaves = [];
  const storage: GoalStorage = {async transact(account, update) {const next = update(stored.get(account)); if (next) stored.set(account, next); return next;}};
  const store = createGoalStore({storage, cloud: {assertAccount: async account => {assert.equal(account, uid);}, list: async () => [],
    save: async (account, item) => {cloudSaves.push(account); return item;}}});
  dependencies = {...store, ...createGoalLocalUpdater(storage)};
});
afterEach(async () => {await act(async () => root.unmount());});

test('canceling a goal load then enabling again can complete; a late canceled result cannot replace it', async () => {
  const old = deferred<GoalRecord['workspace'] | null>(); const current = goal('Current goal'); let reads = 0;
  dependencies.readGoalWorkspace = async () => ++reads === 1 ? old.promise : record(current).workspace;
  dependencies.loadAccountGoals = async () => record(current).workspace;
  await render(); assert.equal(result.busy, true); enabled = false; await render(); enabled = true; await render();
  assert.equal(result.activeGoal?.id, current.id); assert.equal(result.busy, false);
  await act(async () => {old.resolve(record(goal('Private stale goal')).workspace); await tick();});
  assert.equal(result.activeGoal?.id, current.id); assert.equal(result.busy, false);
});
test('stale callbacks are rejected across account changes including an A to B to A sequence', async () => {
  const first = goal('A goal'); stored.set('owner-a', record(first)); stored.set('owner-b', record(goal('B goal')));
  await render(); const staleSave = result.save;
  key = 'owner-b'; uid = key; await render(); assert.match(document.body.textContent!, /B goal/);
  key = 'owner-a'; uid = key; await render();
  await assert.rejects(staleSave(reviseGoal(first, {outcome: 'Stale overwrite'})), /finish loading/);
  assert.equal(stored.get('owner-a')!.workspace.goals[0].outcome, first.outcome); assert.deepEqual(cloudSaves, []);
});
test('account switching before a local read finishes cannot start a cloud request for the old account', async () => {
  const first = deferred<GoalRecord['workspace'] | null>(); const clouds: string[] = []; let reads = 0;
  dependencies.readGoalWorkspace = async () => ++reads === 1 ? first.promise : null;
  dependencies.loadAccountGoals = async account => {clouds.push(account); return {goals: [], activeGoalId: null};};
  await render(); key = 'owner-b'; uid = key; await render();
  await act(async () => {first.resolve(record(goal('Old private goal')).workspace); await tick();});
  assert.deepEqual(clouds, ['owner-b']); assert.equal(result.workspace.goals.length, 0);
});
test('a cloud failure keeps the actual local edit and leaves the same goal retryable', async () => {
  const first = goal('Career'); stored.set(key, record(first)); await render();
  const changed = reviseGoal(first, {outcome: 'An offline edit'}); const realSave = dependencies.saveAccountGoal;
  dependencies.saveAccountGoal = async () => {throw Error('Synthetic cloud failure');};
  await act(async () => {await assert.rejects(result.save(changed), /Synthetic/); await tick();});
  assert.equal(result.activeGoal?.outcome, 'An offline edit'); assert.match(result.notice, /kept on this device/); assert.equal(result.busy, false);
  dependencies.saveAccountGoal = realSave;
  await act(async () => {await result.save(changed); await tick();}); assert.equal(result.workspace.goals.length, 1); assert.match(result.notice, /saved to your account/);
});
test('a same-goal local conflict preserves the competing version and reports the unfinished edit accurately', async () => {
  const first = goal('Career'); stored.set(key, record(first)); await render(); const edited = reviseGoal(first, {outcome: 'My unfinished edit'});
  const other = reviseGoal(first, {outcome: 'Other tab edit'}); stored.set(key, record(other));
  await act(async () => {await assert.rejects(result.save(edited), /changed in another view/); await tick();});
  assert.equal(result.activeGoal?.outcome, other.outcome); assert.match(result.notice, /unfinished edit is preserved/); assert.deepEqual(cloudSaves, []);
});
test('adopting a device copy reads the latest local workspace without triggering a cloud save', async () => {
  const first = goal('Account goal'); stored.set(key, record(first)); await render(); const copied = goal('Copied device goal'); stored.set(key, record(first, copied));
  await act(async () => {await result.adoptCopiedWorkspace(); await tick();});
  assert.deepEqual(result.workspace.goals.map(g => g.id), [first.id, copied.id]); assert.deepEqual(cloudSaves, []);
  assert.match(result.notice, /copied locally/);
});
test('selection uses the latest transaction and does not discard a concurrently copied goal', async () => {
  const first = goal('Account goal'); stored.set(key, record(first)); await render(); const copied = goal('Copied device goal'); stored.set(key, record(first, copied));
  await act(async () => {await result.select(first.id); await tick();}); assert.equal(result.workspace.goals.length, 2);
});
