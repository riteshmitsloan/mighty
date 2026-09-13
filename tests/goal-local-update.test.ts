import test from 'node:test';
import assert from 'node:assert/strict';
import {createGoalLocalUpdater, LocalGoalChangedError} from '../src/lib/goal-local-update';
import {createGoal, reviseGoal, type Goal} from '../src/lib/goals';
import type {GoalRecord, GoalStorage} from '../src/lib/goal-store';
const goal = (title: string) => createGoal({kind: 'career', title, outcome: title});
const record = (...goals: Goal[]): GoalRecord => ({workspace: {goals, activeGoalId: goals[0]?.id ?? null}, baselines: {}, conflicts: {}});
function fixture(initial: GoalRecord) {
  const state = new Map([['owner', initial]]);
  const storage: GoalStorage = {async transact(key, update) {const next = update(state.get(key)); if (next) state.set(key, next); return next;}};
  return {state, updater: createGoalLocalUpdater(storage)};
}
test('atomic one-goal save preserves a concurrent new goal and cloud sync metadata', async () => {
  const first = goal('First'), added = goal('Added in another tab'); const initial = record(first, added); initial.baselines[first.id] = {version: 2, content: 'baseline'};
  const {state, updater} = fixture(initial); const changed = reviseGoal(first, {outcome: 'Changed'});
  const next = await updater.saveLocalGoal('owner', changed, first); assert.deepEqual(next.goals.map(g => g.id), [first.id, added.id]);
  assert.equal(state.get('owner')!.baselines[first.id].content, 'baseline'); assert.equal(next.goals[0].outcome, 'Changed');
});
test('stale same-goal edits refuse replacement and an identical local retry remains idempotent', async () => {
  const first = goal('First'), changedElsewhere = reviseGoal(first, {outcome: 'Different edit'}), myEdit = reviseGoal(first, {outcome: 'My edit'});
  const {state, updater} = fixture(record(changedElsewhere)); await assert.rejects(updater.saveLocalGoal('owner', myEdit, first), LocalGoalChangedError);
  assert.equal(state.get('owner')!.workspace.goals[0].outcome, 'Different edit');
  await updater.saveLocalGoal('owner', changedElsewhere, first); assert.equal(state.get('owner')!.workspace.goals.length, 1);
});
test('selection reads the latest workspace, preserves newly copied goals, and refuses paused or missing targets', async () => {
  const first = goal('First'), second = goal('Copied'); const {updater} = fixture(record(first, second));
  const next = await updater.selectLocalGoal('owner', second.id); assert.equal(next.activeGoalId, second.id); assert.equal(next.goals.length, 2);
  await assert.rejects(updater.selectLocalGoal('owner', 'missing'), /active saved goal/);
});
test('legacy import appends without erasing saved goals and repeated content does not create duplicates', async () => {
  const first = goal('First'); const {updater} = fixture(record(first)); const legacy = goal('Imported goal');
  await updater.addLocalGoal('owner', legacy); const repeated = await updater.addLocalGoal('owner', goal('Imported goal'));
  assert.equal(repeated.goals.length, 2); assert.equal(repeated.activeGoalId, first.id);
});
