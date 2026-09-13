import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeviceGoalHandoff, mergeDeviceGoalCopy, deviceGoalDestinationId, copyDeviceGoalsLocally} from '../src/lib/device-goals';
import {createGoal, reviseGoal, type Goal, type GoalWorkspace} from '../src/lib/goals';
import type {GoalRecord} from '../src/lib/goal-store';
import {createGoalStore} from '../src/lib/goal-store';

const goal = (title: string) => createGoal({kind: 'career', title, outcome: `Explore ${title}`});
const workspace = (...goals: Goal[]): GoalWorkspace => ({goals, activeGoalId: goals.find(g => g.status === 'active')?.id ?? null});
const copyOf = async (goal: Goal, uid = 'owner-a'): Promise<Goal> => ({...goal, id: await deviceGoalDestinationId(uid, goal.id), version: 1});
function fixture() {
  const first = goal('Device career'), second = goal('Device advisory');
  const state = {uid: 'owner-a', device: workspace(first, second), account: undefined as GoalRecord | undefined, remote: [] as Goal[], reads: [] as string[], writes: 0, guards: 0};
  const handoff = createDeviceGoalHandoff({verifyAccount: async uid => {state.guards++; assert.equal(uid, state.uid, 'Active account changed');},
    readLocal: async key => {state.reads.push(key); return key === 'device-draft' ? state.device : state.account?.workspace ?? null;},
    readRemote: async uid => {state.reads.push(`remote:${uid}`); return state.remote;},
    copyLocal: async request => {state.account = mergeDeviceGoalCopy(request, state.device, state.account); state.writes++; return state.account.workspace;}});
  return {state, handoff, first, second};
}
test('constructing the helper never reads, copies or writes account goals; review is explicit and immutable', async () => {
  const {state, handoff, first} = fixture(); assert.deepEqual(state.reads, []); assert.equal(state.writes, 0);
  const preview = await handoff.prepare('owner-a'); assert.equal(preview.goals.length, 2); assert.equal(preview.goals[0].id, first.id);
  assert.equal(state.writes, 0); assert.match(preview.fingerprint, /^[a-f0-9]{64}$/); assert.ok(Object.isFrozen(preview.goals));
  assert.equal(Object.isFrozen(state.device), false);
});
test('copy appends only reviewed goals to the named local account and preserves device originals and cloud metadata', async () => {
  const {state, handoff, first, second} = fixture(); const existing = goal('Account career');
  state.account = {workspace: workspace(existing), baselines: {[existing.id]: {version: 3, content: 'baseline'}}, conflicts: {}};
  const before = JSON.stringify(state.device); const preview = await handoff.prepare('owner-a', [second.id]); const result = await handoff.copy(preview);
  assert.deepEqual(result.goals.map(g => g.id), [existing.id, await deviceGoalDestinationId('owner-a', second.id)]); assert.equal(result.activeGoalId, existing.id);
  assert.equal(result.goals.some(g => g.id === first.id), false); assert.equal(JSON.stringify(state.device), before);
  assert.equal(state.account.baselines[existing.id].version, 3); assert.equal(state.writes, 1);
  await assert.rejects(handoff.copy(preview), /Review/);
});
test('different local or cloud same-ID goals block copying and can be deselected', async () => {
  const {state, handoff, first, second} = fixture(); const different = reviseGoal(await copyOf(first), {outcome: 'An account edit'});
  state.account = {workspace: workspace(different), baselines: {}, conflicts: {}}; state.remote = [different];
  const preview = await handoff.prepare('owner-a'); assert.deepEqual(preview.conflicts.map(c => c.location), ['local-account', 'account']);
  await assert.rejects(handoff.copy(preview), /without conflicts/); assert.equal(state.writes, 0);
  await handoff.copy(await handoff.prepare('owner-a', [second.id])); assert.equal(state.account.workspace.goals[0].outcome, different.outcome);
});
test('identical account content is retained with its server version instead of duplicating or overwriting it', async () => {
  const {state, handoff, first} = fixture(); const accountVersion = {...await copyOf(first), version: 8};
  state.account = {workspace: workspace(accountVersion), baselines: {[accountVersion.id]: {version: 8, content: 'saved'}}, conflicts: {}};
  const result = await handoff.copy(await handoff.prepare('owner-a', [first.id])); assert.equal(result.goals.length, 1); assert.equal(result.goals[0].version, 8);
});
test('device mutation after review and new remote conflict before copy both require another review', async () => {
  const {state, handoff, first} = fixture(); const preview = await handoff.prepare('owner-a', [first.id]);
  state.device = workspace(reviseGoal(first, {outcome: 'Changed after review'}));
  await assert.rejects(handoff.copy(preview), /device goals changed/); assert.equal(state.writes, 0);
  state.device = workspace(first); state.remote = [reviseGoal(await copyOf(first), {outcome: 'Remote change'})];
  await assert.rejects(handoff.copy(preview), /account goal changed/); assert.equal(state.writes, 0);
});
test('transaction merge closes a late conflict race and preserves unrelated additions after review', async () => {
  const {state, first} = fixture(); const mapped = await copyOf(first); const request = {destinationUid: 'owner-a', goals: [first], expectedDevice: state.device, destinationGoalIds: {[first.id]: mapped.id}};
  const unrelated = goal('New in another tab'); const record = {workspace: workspace(unrelated), baselines: {}, conflicts: {}};
  const merged = mergeDeviceGoalCopy(request, state.device, record); assert.deepEqual(merged.workspace.goals.map(g => g.id), [unrelated.id, mapped.id]);
  assert.throws(() => mergeDeviceGoalCopy(request, state.device, {...record, workspace: workspace(reviseGoal(mapped, {outcome: 'Concurrent edit'}))}), /conflicts/);
  assert.deepEqual(record.workspace.goals.map(g => g.id), [unrelated.id]);
});
test('account change after review, forged previews and duplicate simultaneous copies never write', async () => {
  const {state, handoff} = fixture(); const preview = await handoff.prepare('owner-a');
  await assert.rejects(handoff.copy({...preview}), /Review/); state.uid = 'owner-b';
  await assert.rejects(handoff.copy(preview), /Active account changed/); assert.equal(state.writes, 0); state.uid = 'owner-a';
  const results = await Promise.allSettled([handoff.copy(preview), handoff.copy(preview)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(state.writes, 1);
});
test('empty source, invalid destination and stale selections cannot perform a copy', async () => {
  const {state, handoff} = fixture(); state.device = workspace(); const preview = await handoff.prepare('owner-a'); assert.deepEqual(preview.goals, []);
  await assert.rejects(handoff.copy(preview), /Choose goals/); await assert.rejects(handoff.prepare('device-draft'), /destination/);
  await assert.rejects(handoff.prepare('owner-a', ['missing']), /no longer available/); assert.equal(state.writes, 0);
});
test('the same retained device goal gets stable distinct destination identities and separate cloud ownership', async () => {
  const {state, handoff, first} = fixture();
  const a = await handoff.copy(await handoff.prepare('owner-a', [first.id]));
  state.uid = 'owner-b'; state.account = undefined;
  const b = await handoff.copy(await handoff.prepare('owner-b', [first.id]));
  assert.notEqual(a.goals[0].id, b.goals[0].id); assert.notEqual(a.goals[0].id, first.id); assert.notEqual(b.goals[0].id, first.id);
  assert.equal(a.activeGoalId, a.goals[0].id); assert.equal(b.activeGoalId, b.goals[0].id);
  assert.equal(state.device.goals[0].id, first.id);
  // Model the globally unique goal key used by save_goal, including an older original-ID owner.
  const cloud = new Map<string, {uid: string; goal: Goal}>([[first.id, {uid: 'legacy-account', goal: first}]]);
  const records = new Map<string, GoalRecord>();
  const store = createGoalStore({storage: {async transact(uid, update) {const result = update(records.get(uid)); if (result) records.set(uid, result); return result;}},
    cloud: {async assertAccount() {}, async list(uid) {return [...cloud.values()].filter(row => row.uid === uid).map(row => row.goal);},
      async save(uid, goal, expectedVersion) {assert.equal(expectedVersion, 0); assert.ok(!cloud.has(goal.id), 'A globally unique goal ID must not belong to another account');
        const saved = {...goal, version: 1}; cloud.set(goal.id, {uid, goal: saved}); return saved;}}});
  await store.saveAccountGoal('owner-a', a.goals[0], 0); await store.saveAccountGoal('owner-b', b.goals[0], 0);
  assert.equal(cloud.size, 3); assert.equal(cloud.get(first.id)?.uid, 'legacy-account');
  assert.equal((await store.readGoalSyncState('owner-a')).versions[a.goals[0].id], 1);
  assert.equal((await store.readGoalSyncState('owner-b')).versions[b.goals[0].id], 1);
});
test('repeated explicit copies use the same identity across handoffs and keep later account edits', async () => {
  const {state, handoff, first} = fixture(); const firstCopy = await handoff.copy(await handoff.prepare('owner-a', [first.id]));
  const repeated = await handoff.copy(await handoff.prepare('owner-a', [first.id]));
  assert.deepEqual(repeated, firstCopy); assert.equal(repeated.goals.length, 1);
  assert.equal(await deviceGoalDestinationId('owner-a', first.id), firstCopy.goals[0].id);
  assert.equal(await deviceGoalDestinationId('owner-a', first.id.toUpperCase()), firstCopy.goals[0].id);
  const edited = reviseGoal(firstCopy.goals[0], {outcome: 'A later account-only edit'});
  state.account = {workspace: workspace(edited), baselines: {[edited.id]: {version: 1, content: 'saved baseline'}}, conflicts: {}};
  const before = structuredClone(state.account);
  await assert.rejects(handoff.copy(await handoff.prepare('owner-a', [first.id])), /without conflicts/);
  assert.deepEqual(state.account, before);
});
test('fresh copies start their own version history and never reuse or erase a legacy original-ID row', async () => {
  const {state, handoff, first} = fixture(); const revised = {...first, version: 9}; state.device = workspace(revised);
  const legacy = reviseGoal(first, {outcome: 'Existing account-owned context'});
  state.account = {workspace: workspace(legacy), baselines: {[legacy.id]: {version: 2, content: 'legacy baseline'}}, conflicts: {}};
  state.remote = [legacy];
  const result = await handoff.copy(await handoff.prepare('owner-a'));
  const copied = result.goals.find(goal => goal.id !== legacy.id)!;
  assert.equal(copied.version, 1); assert.equal(copied.outcome, revised.outcome); assert.equal(copied.createdAt, revised.createdAt);
  assert.equal(state.device.goals[0].version, 9); assert.equal(result.goals[0].outcome, legacy.outcome);
  assert.equal(state.account.baselines[legacy.id].version, 2); assert.equal(state.account.baselines[copied.id], undefined);
});
test('a mapped destination collision or unresolved saved conflict is blocked without choosing another ID', async () => {
  const {state, handoff, first} = fixture(); const mapped = await copyOf(first);
  state.remote = [reviseGoal(mapped, {outcome: 'Unrelated existing remote content'})];
  const preview = await handoff.prepare('owner-a', [first.id]);
  assert.deepEqual(preview.conflicts.map(row => row.goalId), [first.id]);
  await assert.rejects(handoff.copy(preview), /without conflicts/); assert.equal(state.writes, 0);
  const request = {destinationUid: 'owner-a', goals: [first], expectedDevice: state.device, destinationGoalIds: {[first.id]: mapped.id}};
  const record = {workspace: workspace(), baselines: {}, conflicts: {[mapped.id]: state.remote[0]}};
  assert.throws(() => mergeDeviceGoalCopy(request, state.device, record), /conflicts/);
  assert.deepEqual(record.workspace.goals, []);
  let opened = 0;
  const factory = {open() {opened++; throw new Error('No transaction should open for another destination mapping.');}} as unknown as IDBFactory;
  await assert.rejects(copyDeviceGoalsLocally({...request, destinationUid: 'owner-b'}, factory), /destination goal identity changed/);
  assert.equal(opened, 0);
});
