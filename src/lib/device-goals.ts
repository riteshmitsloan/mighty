import {goalContentKey, normalizeGoal, normalizeGoalWorkspace, type Goal, type GoalWorkspace} from './goals';
import {indexedGoalStorage, type GoalRecord} from './goal-store';
import {contentFingerprint, deepFreeze, stableStringify} from './text';

export interface DeviceGoalConflict {readonly goalId: string; readonly title: string; readonly location: 'device' | 'local-account' | 'account';}
export interface DeviceGoalPreview {
  readonly destinationUid: string;
  readonly goals: readonly Goal[];
  readonly conflicts: readonly DeviceGoalConflict[];
  readonly fingerprint: string;
}
export interface DeviceGoalCopy {
  readonly destinationUid: string;
  readonly goals: readonly Goal[];
  readonly expectedDevice: GoalWorkspace;
  readonly destinationGoalIds: Readonly<Record<string, string>>;
}
export interface DeviceGoalDependencies {
  verifyAccount(uid: string): Promise<unknown>;
  readLocal(key: string): Promise<GoalWorkspace | null>;
  readRemote(uid: string): Promise<readonly Goal[]>;
  copyLocal(request: DeviceGoalCopy): Promise<GoalWorkspace>;
}
export interface DeviceGoalHandoff {
  prepare(uid: string, selectedIds?: readonly string[]): Promise<DeviceGoalPreview>;
  copy(preview: DeviceGoalPreview): Promise<GoalWorkspace>;
}
const empty = (): GoalWorkspace => ({goals: [], activeGoalId: null});
function destination(uid: string) {
  if (typeof uid !== 'string' || !uid.trim() || uid === 'device-draft' || uid.length > 200) throw new TypeError('Choose the signed-in account as the destination.');
}
/** Account-specific identity is stable across retries and cannot reuse another account's device-copy ID. */
export async function deviceGoalDestinationId(uid: string, sourceId: string): Promise<string> {
  destination(uid);
  if (typeof sourceId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(sourceId)) throw new TypeError('The device goal identifier is invalid.');
  const hex = (await contentFingerprint(['mighty:device-goal-copy:v1', uid.toLowerCase(), sourceId.toLowerCase()])).slice(0, 32).split('');
  // UUID version8 carries the namespaced hash; the variant bits keep standard UUID syntax.
  hex[12] = '8'; hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  const id = hex.join(''); return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}
function mappedGoals(request: DeviceGoalCopy): Goal[] {
  const ids = request.destinationGoalIds;
  if (!ids || Object.keys(ids).length !== request.goals.length) throw new Error('Review the destination goal identities before copying.');
  const copies = request.goals.map(goal => {
    const source = normalizeGoal(goal), id = ids[source.id];
    if (id === source.id) throw new Error('A device copy needs its own account goal identity.');
    // A new identity has no account history. Device content and dates remain exactly as reviewed.
    return normalizeGoal({...source, id, version: 1});
  });
  if (new Set(copies.map(goal => goal.id)).size !== copies.length) throw new Error('The destination goal identities conflict. Review again.');
  return copies;
}
function same(a: Goal, b: Goal) { return goalContentKey(a) === goalContentKey(b); }
function conflicts(goals: readonly Goal[], account: GoalWorkspace | null, remote: readonly Goal[]): DeviceGoalConflict[] {
  return goals.flatMap(goal => {
    const result: DeviceGoalConflict[] = []; const local = account?.goals.find(g => g.id === goal.id); const cloud = remote.find(g => g.id === goal.id);
    if (local && !same(local, goal)) result.push({goalId: goal.id, title: goal.title, location: 'local-account'});
    if (cloud && !same(cloud, goal)) result.push({goalId: goal.id, title: goal.title, location: 'account'});
    return result;
  });
}
/** Pure transaction update: append selected new goals; never replace account edits or remove device originals. */
export function mergeDeviceGoalCopy(request: DeviceGoalCopy, currentDevice: GoalWorkspace | null, currentAccount: GoalRecord | undefined): GoalRecord {
  destination(request.destinationUid);
  const selected = request.goals.map(normalizeGoal); const device = currentDevice ? normalizeGoalWorkspace(currentDevice) : empty();
  for (const goal of selected) {
    const expected = request.expectedDevice.goals.find(g => g.id === goal.id); const current = device.goals.find(g => g.id === goal.id);
    if (!expected || !current || stableStringify(current) !== stableStringify(expected) || stableStringify(goal) !== stableStringify(expected)) {
      throw new Error('The device goals changed. Review them again before copying.');
    }
  }
  const copies = mappedGoals(request);
  const account = currentAccount ? normalizeGoalWorkspace(currentAccount.workspace) : empty();
  const unresolved = Object.values(currentAccount?.conflicts ?? {});
  if (conflicts(copies, account, unresolved).length) throw new Error('A selected goal conflicts with an account version. Keep both originals and review the conflict.');
  const goals = [...account.goals, ...copies.filter(goal => !account.goals.some(g => g.id === goal.id))];
  const copiedActive = request.expectedDevice.activeGoalId ? request.destinationGoalIds[request.expectedDevice.activeGoalId] : undefined;
  const activeGoalId = account.activeGoalId ?? (goals.some(g => g.id === copiedActive && g.status === 'active')
    ? copiedActive! : goals.find(g => g.status === 'active')?.id ?? null);
  return {...structuredClone(currentAccount ?? {baselines: {}, conflicts: {}}), workspace: normalizeGoalWorkspace({goals, activeGoalId})};
}

/** No reads occur until an explicit prepare/copy action. There are no cloud writes. */
export function createDeviceGoalHandoff(dependencies: DeviceGoalDependencies): DeviceGoalHandoff {
  const plans = new WeakMap<DeviceGoalPreview, {device: GoalWorkspace; destinationGoalIds: Readonly<Record<string, string>>}>(); const copying = new WeakSet<DeviceGoalPreview>();
  return {
    async prepare(uid, selectedIds) {
      destination(uid); await dependencies.verifyAccount(uid);
      const [found, local, remote] = await Promise.all([dependencies.readLocal('device-draft'), dependencies.readLocal(uid), dependencies.readRemote(uid)]);
      await dependencies.verifyAccount(uid);
      const device = found ? normalizeGoalWorkspace(found) : empty();
      const ids = selectedIds ?? device.goals.map(g => g.id);
      if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.length > 100) throw new TypeError('Choose distinct device goals.');
      const selected = ids.map(id => device.goals.find(g => g.id === id));
      if (selected.some(g => !g)) throw new Error('A selected device goal is no longer available. Review again.');
      const goals = selected as Goal[];
      const destinationGoalIds = Object.fromEntries(await Promise.all(goals.map(async goal => [goal.id, await deviceGoalDestinationId(uid, goal.id)])));
      const copies = mappedGoals({destinationUid: uid, goals, expectedDevice: device, destinationGoalIds});
      const fingerprint = await contentFingerprint({uid, goals, destinationGoalIds}); await dependencies.verifyAccount(uid);
      const clashes = conflicts(copies, local, remote.map(normalizeGoal)).map(conflict => ({...conflict, goalId: goals[copies.findIndex(goal => goal.id === conflict.goalId)].id}));
      const preview = deepFreeze({destinationUid: uid, goals: structuredClone(goals), conflicts: clashes, fingerprint});
      plans.set(preview, deepFreeze({device: structuredClone(device), destinationGoalIds})); return preview;
    },
    async copy(preview) {
      const plan = plans.get(preview);
      if (!plan) throw new Error('Review the device goals before copying.');
      if (copying.has(preview)) throw new Error('These goals are already being copied.');
      if (!preview.goals.length || preview.conflicts.length) throw new Error('Choose goals without conflicts before copying.');
      copying.add(preview);
      try {
        const uid = preview.destinationUid; await dependencies.verifyAccount(uid);
        const [device, local, remote] = await Promise.all([dependencies.readLocal('device-draft'), dependencies.readLocal(uid), dependencies.readRemote(uid)]);
        await dependencies.verifyAccount(uid);
        const request = {destinationUid: uid, goals: preview.goals, expectedDevice: plan.device, destinationGoalIds: plan.destinationGoalIds};
        if (conflicts(mappedGoals(request), local, remote.map(normalizeGoal)).length) throw new Error('An account goal changed. Review the goals again before copying.');
        // Recheck now for a clear error; copyLocal must repeat this inside its native transaction.
        mergeDeviceGoalCopy(request, device, local ? {workspace: local, baselines: {}, conflicts: {}} : undefined);
        await dependencies.verifyAccount(uid);
        const workspace = await dependencies.copyLocal(request); await dependencies.verifyAccount(uid);
        plans.delete(preview); return normalizeGoalWorkspace(workspace);
      } finally { copying.delete(preview); }
    },
  };
}

/** Both account and device keys are verified in the same transaction before writing the account key. */
export async function copyDeviceGoalsLocally(request: DeviceGoalCopy, factory: IDBFactory = globalThis.indexedDB, databaseName = 'mighty-local-sources'): Promise<GoalWorkspace> {
  if (!factory) throw new Error('Local goal storage is unavailable.');
  // Hash before opening the transaction: awaiting crypto inside IndexedDB would allow auto-commit.
  mappedGoals(request);
  for (const goal of request.goals) if (request.destinationGoalIds[goal.id] !== await deviceGoalDestinationId(request.destinationUid, goal.id)) throw new Error('The reviewed destination goal identity changed. Review again.');
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const opening = factory.open(databaseName, 1);
    opening.onupgradeneeded = () => {if (!opening.result.objectStoreNames.contains('sources')) opening.result.createObjectStore('sources');};
    opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error ?? new Error('Goal storage could not open.'));
    opening.onblocked = () => reject(new Error('Goal storage is blocked by another tab.'));
  });
  try {
    return await new Promise<GoalWorkspace>((resolve, reject) => {
      const tx = database.transaction('sources', 'readwrite'); const store = tx.objectStore('sources'); let result: GoalWorkspace; let failure: unknown;
      const device = store.get(['mighty:goals:v1', 'device-draft']); const account = store.get(['mighty:goals:v1', request.destinationUid]); let read = 0;
      const complete = () => {
        if (++read !== 2) return;
        try {
          const updated = mergeDeviceGoalCopy(request, (device.result as GoalRecord | undefined)?.workspace ?? null, account.result as GoalRecord | undefined);
          result = updated.workspace; store.put(updated, ['mighty:goals:v1', request.destinationUid]);
        } catch (error) {failure = error; tx.abort();}
      };
      device.onsuccess = complete; account.onsuccess = complete;
      tx.oncomplete = () => resolve(result); tx.onerror = () => {failure ??= tx.error;};
      tx.onabort = () => reject(failure ?? tx.error ?? new Error('The goal copy was interrupted.'));
    });
  } finally {database.close();}
}
const storage = indexedGoalStorage();
export const deviceGoalHandoff = createDeviceGoalHandoff({
  async verifyAccount(uid) { return (await import('./platform')).accountId(uid); },
  async readLocal(key) { const record = await storage.transact(key, row => row); return record ? normalizeGoalWorkspace(record.workspace) : null; },
  async readRemote(uid) {
    const {db} = await import('./platform'); if (!db) throw new Error('Account goal storage is unavailable.');
    const {data, error} = await db.from('goals').select('document').eq('user_id', uid).limit(101);
    if (error) throw new Error(error.message); if ((data?.length ?? 0) > 100) throw new Error('Review account goals before copying additional device goals.');
    return (data ?? []).map(row => normalizeGoal(row.document));
  },
  copyLocal: copyDeviceGoalsLocally,
});
