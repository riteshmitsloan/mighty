import {goalContentKey, normalizeGoal, normalizeGoalWorkspace, upsertWorkspaceGoal, type Goal, type GoalWorkspace} from './goals';
import {indexedGoalStorage, type GoalStorage} from './goal-store';

export class LocalGoalChangedError extends Error {
  constructor(readonly workspace: GoalWorkspace) {super('This goal changed in another view. Your unfinished edit is preserved; review the saved version before replacing it.');}
}
const same = (a: Goal | undefined | null, b: Goal | undefined | null) => (!a && !b) || Boolean(a && b && a.version === b.version && goalContentKey(a) === goalContentKey(b));
const empty = (): GoalWorkspace => ({goals: [], activeGoalId: null});
export function createGoalLocalUpdater(storage: GoalStorage = indexedGoalStorage()) {
  function validKey(key: string) {if (typeof key !== 'string' || !key.trim() || key.length > 200) throw new TypeError('A bounded account workspace key is required.');}
  async function saveLocalGoal(key: string, goal: Goal, expected: Goal | null): Promise<GoalWorkspace> {
    validKey(key); const snapshot = normalizeGoal(goal), before = expected ? normalizeGoal(expected) : null;
    const stored = await storage.transact(key, record => {
      const workspace = record ? normalizeGoalWorkspace(record.workspace) : empty(); const current = workspace.goals.find(g => g.id === snapshot.id);
      if (!same(current, before) && !same(current, snapshot)) throw new LocalGoalChangedError(workspace);
      return {...(record ?? {baselines: {}, conflicts: {}}), workspace: upsertWorkspaceGoal(workspace, snapshot)};
    });
    return normalizeGoalWorkspace(stored!.workspace);
  }
  async function selectLocalGoal(key: string, goalId: string): Promise<GoalWorkspace> {
    validKey(key);
    const stored = await storage.transact(key, record => {
      const workspace = record ? normalizeGoalWorkspace(record.workspace) : empty();
      if (!workspace.goals.some(g => g.id === goalId && g.status === 'active')) throw new Error('Choose an active saved goal.');
      return {...record!, workspace: {...workspace, activeGoalId: goalId}};
    });
    return normalizeGoalWorkspace(stored!.workspace);
  }
  async function addLocalGoal(key: string, goal: Goal): Promise<GoalWorkspace> {
    validKey(key); const snapshot = normalizeGoal(goal);
    const stored = await storage.transact(key, record => {
      const workspace = record ? normalizeGoalWorkspace(record.workspace) : empty();
      if (workspace.goals.some(g => g.outcome === snapshot.outcome)) return record;
      if (workspace.goals.some(g => g.id === snapshot.id)) throw new LocalGoalChangedError(workspace);
      return {...(record ?? {baselines: {}, conflicts: {}}), workspace: upsertWorkspaceGoal(workspace, snapshot)};
    });
    return normalizeGoalWorkspace(stored!.workspace);
  }
  return {saveLocalGoal, selectLocalGoal, addLocalGoal};
}
export const {saveLocalGoal, selectLocalGoal, addLocalGoal} = createGoalLocalUpdater();
