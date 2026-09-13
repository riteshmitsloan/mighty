import {goalContentKey, normalizeGoal, normalizeGoalWorkspace, type Goal, type GoalWorkspace} from './goals';

export interface GoalConflict {goalId: string; local: Goal; remote: Goal}
export class GoalConflictError extends Error {
  constructor(public readonly conflicts: readonly GoalConflict[], public readonly workspace: GoalWorkspace) {
    super('A goal changed in another session. Your local changes are preserved; choose which version to use.');
    this.name = 'GoalConflictError';
  }
}
interface Baseline {version: number; content: string}
export interface GoalRecord {workspace: GoalWorkspace; baselines: Record<string, Baseline>; conflicts: Record<string, Goal>}
export interface GoalStorage {
  transact(key: string, update: (record: GoalRecord | undefined) => GoalRecord | undefined): Promise<GoalRecord | undefined>;
}
export interface GoalCloudAdapter {
  assertAccount(uid: string): Promise<unknown>;
  list(uid: string): Promise<readonly Goal[]>;
  save(uid: string, goal: Goal, expectedVersion: number): Promise<Goal>;
}
export interface GoalSyncState {versions: Record<string, number>; conflicts: readonly GoalConflict[]}
const empty = (): GoalWorkspace => ({goals: [], activeGoalId: null});
const fresh = (workspace = empty()): GoalRecord => ({workspace, baselines: {}, conflicts: {}});
function keyBound(key: string) {if (typeof key !== 'string' || !key.trim() || key.length > 200) throw new TypeError('A bounded account workspace key is required.');}
const conflictsFor = (r: GoalRecord): GoalConflict[] => Object.entries(r.conflicts).flatMap(([goalId, remote]) => {
  const local = r.workspace.goals.find(g => g.id === goalId); return local ? [{goalId, local, remote}] : [];
});
function selectActive(goals: readonly Goal[], previous: string | null): string | null {
  return goals.some(g => g.id === previous && g.status === 'active') ? previous : goals.find(g => g.status === 'active')?.id ?? null;
}

/** An array key cannot collide with the existing string source or goal keys. */
export function indexedGoalStorage(databaseName = 'mighty-local-sources', factory?: IDBFactory): GoalStorage {
  return {async transact(key, update) {
    const api = factory ?? globalThis.indexedDB;
    if (!api) throw new Error('Local goal storage is unavailable.');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = api.open(databaseName, 1);
      request.onupgradeneeded = () => {if (!request.result.objectStoreNames.contains('sources')) request.result.createObjectStore('sources');};
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Goal storage could not open.'));
      request.onblocked = () => reject(new Error('Goal storage is blocked by another tab.'));
    });
    try {
      return await new Promise<GoalRecord | undefined>((resolve, reject) => {
        const tx = database.transaction('sources', 'readwrite'); const store = tx.objectStore('sources');
        const request = store.get(['mighty:goals:v1', key]); let result: GoalRecord | undefined; let failure: unknown;
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => {failure ??= tx.error;};
        tx.onabort = () => reject(failure ?? tx.error ?? new Error('Goal storage was interrupted.'));
        request.onsuccess = () => {
          try {
            const current = request.result as GoalRecord | undefined;
            result = update(current);
            if (result !== undefined && result !== current) store.put(result, ['mighty:goals:v1', key]);
          } catch (error) {failure = error; tx.abort();}
        };
      });
    } finally {database.close();}
  }};
}

async function defaultCloud(): Promise<GoalCloudAdapter> {
  const platform = await import('./platform');
  return {
    assertAccount: uid => platform.accountId(uid),
    async list(uid) {
      if (!platform.db) throw new Error('Account storage is unavailable.');
      const goals: Goal[] = []; let after: string | undefined;
      for (;;) {
        let query = platform.db.from('goals').select('id,document').eq('user_id', uid).order('id').limit(100);
        if (after) query = query.gt('id', after);
        const {data, error} = await query; if (error) throw new Error(error.message);
        if (!data?.length) return goals;
        goals.push(...data.map(row => normalizeGoal(row.document)));
        const next = data[data.length - 1].id as string;
        if (after && next <= after) throw new Error('Account goals could not be paged safely.');
        after = next;
      }
    },
    async save(uid, goal, expectedVersion) {
      if (!platform.db) throw new Error('Account storage is unavailable.');
      const {data, error} = await platform.db.rpc('save_goal', {p_user_id: uid, p_goal: goal, p_expected_version: expectedVersion});
      if (error) {const failure = new Error(error.message) as Error & {code?: string}; failure.code = error.code; throw failure;}
      if (!data) throw new Error('The goal was not saved. Your local draft is preserved.');
      return normalizeGoal(data);
    },
  };
}

export function createGoalStore(options: {storage?: GoalStorage; cloud?: GoalCloudAdapter} = {}) {
  const storage = options.storage ?? indexedGoalStorage();
  let writes: Promise<unknown> = Promise.resolve(); let cloudWrites: Promise<unknown> = Promise.resolve();
  const transaction = (key: string, mutate: (record: GoalRecord | undefined) => GoalRecord | undefined) => {
    keyBound(key);
    const job = writes.catch(() => {}).then(() => storage.transact(key, mutate)); writes = job; return job;
  };
  const adapter = () => options.cloud ? Promise.resolve(options.cloud) : defaultCloud();
  async function readGoalWorkspace(key: string): Promise<GoalWorkspace | null> {
    const stored = await transaction(key, r => r);
    return stored ? normalizeGoalWorkspace(stored.workspace) : null;
  }
  async function saveGoalWorkspace(key: string, workspace: GoalWorkspace): Promise<void> {
    const snapshot = normalizeGoalWorkspace(workspace);
    await transaction(key, r => ({...(r ?? fresh()), workspace: snapshot}));
  }
  async function readGoalSyncState(key: string): Promise<GoalSyncState> {
    const stored = await transaction(key, r => r);
    return stored ? {versions: Object.fromEntries(Object.entries(stored.baselines).map(([id, b]) => [id, b.version])), conflicts: structuredClone(conflictsFor(stored))} : {versions: {}, conflicts: []};
  }
  async function loadAccountGoals(uid: string): Promise<GoalWorkspace> {
    keyBound(uid); const api = await adapter(); await api.assertAccount(uid);
    const remote = (await api.list(uid)).map(normalizeGoal); await api.assertAccount(uid);
    const result = await transaction(uid, stored => {
      if (!stored && !remote.length) return undefined;
      const next = structuredClone(stored ?? fresh()); const byId = new Map(next.workspace.goals.map(g => [g.id, g]));
      for (const cloud of remote) {
        const local = byId.get(cloud.id); const baseline = next.baselines[cloud.id];
        if (cloud.version < Math.max(baseline?.version ?? 0, next.conflicts[cloud.id]?.version ?? 0)) continue;
        const remoteKey = goalContentKey(cloud); const localKey = local ? goalContentKey(local) : undefined;
        if (baseline && cloud.version === baseline.version && remoteKey !== baseline.content) {
          next.conflicts[cloud.id] = cloud;
        } else if (!local || localKey === remoteKey || (baseline && localKey === baseline.content)) {
          byId.set(cloud.id, cloud); next.baselines[cloud.id] = {version: cloud.version, content: remoteKey}; delete next.conflicts[cloud.id];
        } else if (baseline && remoteKey === baseline.content) {
          // Server content is unchanged; an offline local revision stays pending.
          next.baselines[cloud.id] = {version: cloud.version, content: remoteKey}; delete next.conflicts[cloud.id];
        } else {
          next.conflicts[cloud.id] = cloud;
        }
      }
      const goals = [...byId.values()]; next.workspace = normalizeGoalWorkspace({goals, activeGoalId: selectActive(goals, next.workspace.activeGoalId)});
      return next;
    });
    await api.assertAccount(uid);
    const workspace = result?.workspace ?? empty(); const conflicts = result ? conflictsFor(result) : [];
    if (conflicts.length) throw new GoalConflictError(structuredClone(conflicts), normalizeGoalWorkspace(workspace));
    return normalizeGoalWorkspace(workspace);
  }
  function saveAccountGoal(uid: string, goal: Goal, expectedVersion: number): Promise<Goal> {
    keyBound(uid); const snapshot = normalizeGoal(goal);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new TypeError('The expected cloud version is invalid.');
    const job = cloudWrites.catch(() => {}).then(async () => {
      const api = await adapter(); await api.assertAccount(uid);
      const state = await readGoalSyncState(uid);
      if (state.conflicts.some(c => c.goalId === snapshot.id)) throw new GoalConflictError(state.conflicts, (await readGoalWorkspace(uid))!);
      let saved: Goal;
      try {saved = normalizeGoal(await api.save(uid, snapshot, expectedVersion));}
      catch (error) {
        if ((error as {code?: string})?.code === '40001') await loadAccountGoals(uid);
        throw error;
      }
      await api.assertAccount(uid);
      if (saved.id !== snapshot.id || goalContentKey(saved) !== goalContentKey(snapshot)) throw new Error('The account returned a different goal. Your local draft is preserved.');
      await transaction(uid, stored => {
        const next = structuredClone(stored ?? fresh());
        const local = next.workspace.goals.find(g => g.id === saved.id);
        // Do not erase typing or offline edits made while the cloud save ran.
        const replace = !local || goalContentKey(local) === goalContentKey(snapshot);
        const goals = local ? next.workspace.goals.map(g => g.id === saved.id && replace ? saved : g) : [...next.workspace.goals, saved];
        next.workspace = normalizeGoalWorkspace({goals, activeGoalId: selectActive(goals, next.workspace.activeGoalId)});
        next.baselines[saved.id] = {version: saved.version, content: goalContentKey(saved)}; delete next.conflicts[saved.id]; return next;
      });
      await api.assertAccount(uid); return saved;
    });
    cloudWrites = job; return job;
  }
  async function resolveGoalConflict(key: string, goalId: string, choice: 'local' | 'remote'): Promise<GoalWorkspace> {
    if (!['local','remote'].includes(choice)) throw new TypeError('Choose the local or account goal.');
    const result = await transaction(key, stored => {
      if (!stored?.conflicts[goalId]) throw new Error('This goal conflict is no longer available. Reload the account goals.');
      const next = structuredClone(stored); const remote = next.conflicts[goalId];
      const goals = next.workspace.goals.map(g => g.id === goalId && choice === 'remote' ? remote : g);
      next.workspace = normalizeGoalWorkspace({goals, activeGoalId: selectActive(goals, next.workspace.activeGoalId)});
      next.baselines[goalId] = {version: remote.version, content: goalContentKey(remote)}; delete next.conflicts[goalId]; return next;
    });
    return normalizeGoalWorkspace(result!.workspace);
  }
  return {readGoalWorkspace, saveGoalWorkspace, readGoalSyncState, loadAccountGoals, saveAccountGoal, resolveGoalConflict};
}
const defaultStore = createGoalStore();
export const {readGoalWorkspace, saveGoalWorkspace, readGoalSyncState, loadAccountGoals, saveAccountGoal, resolveGoalConflict} = defaultStore;
