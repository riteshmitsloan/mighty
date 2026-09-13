import {useEffect, useRef, useState} from 'react';
import {migrateLegacyGoalWorkspace, type Goal, type GoalWorkspace} from './goals';
import {readGoalWorkspace, loadAccountGoals, saveAccountGoal, readGoalSyncState, resolveGoalConflict, GoalConflictError, type GoalConflict} from './goal-store';
import {saveLocalGoal, selectLocalGoal, addLocalGoal, LocalGoalChangedError} from './goal-local-update';

const empty: GoalWorkspace = {goals: [], activeGoalId: null};
const message = (error: unknown) => error instanceof Error ? error.message : 'Your goals could not be saved.';
export const goalHookDependencies = {readGoalWorkspace, loadAccountGoals, saveAccountGoal, readGoalSyncState, resolveGoalConflict, saveLocalGoal, selectLocalGoal, addLocalGoal};
export type GoalHookDependencies = typeof goalHookDependencies;

/** Account-keyed state; explicit edits merge one goal atomically and never replace another view's goals. */
export function useGoals(key: string, uid: string | null, enabled: boolean, legacyStrategy: string, dependencies: GoalHookDependencies = goalHookDependencies) {
  const [state, setState] = useState<{key: string; workspace: GoalWorkspace}>({key, workspace: empty});
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [conflicts, setConflicts] = useState<readonly GoalConflict[]>([]);
  const generation = useRef(0), currentKey = useRef(key), working = useRef(empty), lock = useRef(false), initialized = useRef('');
  const currentUid = useRef(uid), currentEnabled = useRef(enabled); currentUid.current = uid; currentEnabled.current = enabled;
  currentKey.current = key;
  const renderGeneration = generation.current;
  const workspace = state.key === key ? state.workspace : empty;
  useEffect(() => {
    const request = ++generation.current; working.current = empty; initialized.current = ''; lock.current = false;
    setState({key, workspace: empty}); setNotice(''); setConflicts([]); setBusy(false);
    return () => {if (generation.current === request) generation.current++;};
  }, [key, uid]);
  useEffect(() => {if (!enabled) {generation.current++; lock.current = false; setBusy(false);}}, [enabled]);
  useEffect(() => {
    if (!enabled || initialized.current === key) return;
    const request = generation.current; let active = true;
    const current = () => active && currentKey.current === key && generation.current === request;
    setBusy(true);
    void (async () => {
      let local = await dependencies.readGoalWorkspace(key); if (!current()) return;
      if (uid) {
        try {const cloud = await dependencies.loadAccountGoals(uid); if (cloud.goals.length || local !== null) local = cloud;}
        catch (error) {if (error instanceof GoalConflictError) {local = error.workspace; if (current()) setConflicts(error.conflicts);}
          else if (current()) setNotice(`Your local goals are available. ${message(error)}`);}
      }
      if (!current()) return;
      let restored = migrateLegacyGoalWorkspace(local, legacyStrategy);
      if (local === null && restored.goals.length) restored = await dependencies.addLocalGoal(key, restored.goals[0]);
      if (!current()) return; initialized.current = key; working.current = restored; setState({key, workspace: restored});
    })().catch(error => {if (current()) setNotice(message(error));}).finally(() => {if (current()) setBusy(false);});
    return () => {active = false;};
  }, [key, uid, enabled, dependencies]);

  function begin() {
    if (currentKey.current !== key || currentUid.current !== uid || generation.current !== renderGeneration || initialized.current !== key || !currentEnabled.current) throw new Error('Wait for this account’s goals to finish loading.');
    if (lock.current || busy) throw new Error('Please wait for your goals to finish loading or saving.');
    const request = generation.current; lock.current = true; setBusy(true); setNotice('');
    return () => currentKey.current === key && generation.current === request;
  }
  function finish(current: () => boolean) {if (current()) {lock.current = false; setBusy(false);}}
  function adopt(next: GoalWorkspace) {working.current = next; setState({key, workspace: next});}
  async function save(goal: Goal) {
    const current = begin(); let locallySaved = false;
    try {
      const next = await dependencies.saveLocalGoal(key, goal, working.current.goals.find(g => g.id === goal.id) ?? null); locallySaved = true;
      if (!current()) return; adopt(next);
      if (uid) {
        const sync = await dependencies.readGoalSyncState(key); if (!current()) return;
        await dependencies.saveAccountGoal(uid, goal, sync.versions[goal.id] ?? 0); if (!current()) return;
        const latest = await dependencies.readGoalWorkspace(key); if (!current()) return; if (latest) adopt(latest);
      }
      if (current()) setNotice(uid ? 'Goal saved to your account.' : 'Goal saved on this device.');
    } catch (error) {
      if (current()) {
        if (error instanceof GoalConflictError) {setConflicts(error.conflicts); adopt(error.workspace);}
        if (error instanceof LocalGoalChangedError) adopt(error.workspace);
        setNotice(`${locallySaved ? 'Your edit is kept on this device.' : 'Your unfinished edit is preserved.'} ${message(error)}`);
      }
      throw error;
    } finally {finish(current);}
  }
  async function select(id: string) {
    let current: (() => boolean) | undefined;
    try {current = begin(); const next = await dependencies.selectLocalGoal(key, id); if (current()) adopt(next);}
    catch (error) {if (currentKey.current === key && (!current || current())) setNotice(message(error));}
    finally {if (current) finish(current);}
  }
  async function resolve(id: string, choice: 'local' | 'remote') {
    let current: (() => boolean) | undefined;
    try {
      current = begin(); await dependencies.resolveGoalConflict(key, id, choice); if (!current()) return;
      const [restored, sync] = await Promise.all([dependencies.readGoalWorkspace(key), dependencies.readGoalSyncState(key)]); if (!current()) return;
      adopt(restored ?? empty); setConflicts(sync.conflicts); setNotice(choice === 'local' ? 'Your version is ready to save to the account.' : 'Loaded the account version.');
    } catch (error) {if (currentKey.current === key && (!current || current())) setNotice(message(error));}
    finally {if (current) finish(current);}
  }
  async function importStrategy(value: string) {
    if (!value.trim()) return; const current = begin();
    try {const imported = migrateLegacyGoalWorkspace(null, value).goals[0]; const next = await dependencies.addLocalGoal(key, imported); if (current()) adopt(next);}
    finally {finish(current);}
  }
  async function adoptCopiedWorkspace() {
    const current = begin();
    try {const next = await dependencies.readGoalWorkspace(key); if (current()) {adopt(next ?? empty); setNotice('Device goals copied locally. Save each goal to sync it to your account.');}}
    finally {finish(current);}
  }
  return {workspace, activeGoal: workspace.goals.find(g => g.id === workspace.activeGoalId) ?? null,
    busy, notice: state.key === key ? notice : '', conflicts: state.key === key ? conflicts : [], save, select, resolve, importStrategy, adoptCopiedWorkspace};
}
