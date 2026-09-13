import {normalizeGoal, normalizeGoalWorkspace, type Goal} from '../../src/lib/goals';
import {evidenceKey} from '../../src/lib/evidence';
import {deepFreeze} from '../../src/lib/text';
import type {PublicConfig, Session} from './types.js';

export interface AccountGoalContext {
  readonly schemaVersion: 1;
  readonly userId: string;
  readonly goals: readonly Goal[];
  readonly loadedAt: string;
  /** Account-scoped local change key, never an authentication proof. */
  readonly key: string;
}
const goalKeys = ['id','kind','title','outcome','criteria','openQuestions','version','status','createdAt','updatedAt'];
const criterionKeys = ['id','field','label','terms','importance','appliesTo','origin'];
function exactKeys(value: unknown, allowed: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) {
    throw Error('Account goals use an unsupported format. Update Mighty and reconnect.');
  }
}
function strictGoal(document: unknown): Goal {
  exactKeys(document, goalKeys);
  const row = document as Record<string, unknown>;
  if (Array.isArray(row.criteria)) row.criteria.forEach(item => exactKeys(item, criterionKeys));
  return normalizeGoal(document);
}
function contextKey(userId: string, goals: readonly Goal[]) {return evidenceKey(['extension-account-goals-v1', userId, goals]);}
export function accountGoalContext(userId: string, rows: unknown, loadedAt = new Date().toISOString()): AccountGoalContext {
  try {
    if (!Array.isArray(rows) || rows.length > 100 || !Number.isFinite(Date.parse(loadedAt))) throw Error();
    const goals = rows.map(value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
      const row = value as Record<string, unknown>;
      const goal = strictGoal(row.document);
      if (row.user_id !== userId || row.id !== goal.id || row.version !== goal.version) throw Error();
      return goal;
    });
    const checked = normalizeGoalWorkspace({goals, activeGoalId: null}).goals;
    return deepFreeze({schemaVersion: 1, userId, goals: checked, loadedAt, key: contextKey(userId, checked)});
  } catch {throw Error('Account goals are incompatible or incomplete. Update Mighty and reconnect; no previous goals are being used.');}
}
/** Only called in trusted extension contexts; never accepts page-provided goals. */
export function validateGoalContext(value: unknown, userId: string): AccountGoalContext {
  try {
    if (!value || typeof value !== 'object') throw Error();
    const context = value as AccountGoalContext;
    if (context.schemaVersion !== 1 || context.userId !== userId || !Array.isArray(context.goals)) throw Error();
    const checked = accountGoalContext(userId, context.goals.map(goal => ({id: goal.id, user_id: userId, version: goal.version, document: goal})), context.loadedAt);
    if (context.key !== checked.key) throw Error();
    return checked;
  } catch {throw Error('Saved account goals could not be verified. Reconnect from Mighty.');}
}
export async function loadAccountGoals(session: Session, config: PublicConfig, request: typeof fetch = fetch): Promise<AccountGoalContext> {
  const endpoint = new URL(config.supabaseUrl + '/rest/v1/goals');
  endpoint.searchParams.set('user_id', 'eq.' + session.userId);
  endpoint.searchParams.set('select', 'id,user_id,version,document');
  endpoint.searchParams.set('order', 'id.asc');
  // The app's workspace accepts at most 100; a 101st row fails explicitly, never silently clips goals.
  endpoint.searchParams.set('limit', '101');
  let response: Response;
  try {response = await request(endpoint, {headers: {apikey: config.publishableKey, Authorization: 'Bearer ' + session.accessToken, Prefer: 'count=exact'}, signal: AbortSignal.timeout(10_000)});}
  catch {throw Error('Account goals could not be refreshed. Reconnect from Mighty when the connection is available.');}
  if (!response.ok) throw Error('Account goals could not be loaded. Reconnect from Mighty; no previous goals are being used.');
  let rows: unknown;
  try {rows = await response.json();} catch {throw Error('Account goals returned an unreadable response. Reconnect from Mighty.');}
  const context = accountGoalContext(session.userId, rows);
  const range = response.headers.get('Content-Range');
  const full = range?.match(/^0-(\d+)\/(\d+)$/);
  const complete = context.goals.length === 0 ? range === '*/0' : Boolean(full && Number(full[1]) + 1 === context.goals.length && Number(full[2]) === context.goals.length);
  // A project row cap can return fewer than requested101; exact count must establish the complete account snapshot.
  if (!complete) throw Error('Account goals could not be loaded completely. Reconnect from Mighty; no previous goals are being used.');
  return context;
}
