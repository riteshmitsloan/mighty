export type GoalKind = 'career' | 'fundraising' | 'advisory' | 'partnership' | 'other';
export type GoalStatus = 'active' | 'paused' | 'completed';
export interface GoalCriterion {
  readonly id: string;
  readonly field: 'role' | 'industry' | 'location' | 'stage' | 'check_size' | 'custom';
  readonly label: string;
  readonly terms: readonly string[];
  readonly importance: 'required' | 'preferred';
  readonly appliesTo: 'opportunity' | 'contact';
  readonly origin: 'user' | 'suggested';
}
export interface Goal {
  readonly id: string;
  readonly kind: GoalKind;
  readonly title: string;
  readonly outcome: string;
  readonly criteria: readonly GoalCriterion[];
  readonly openQuestions: readonly string[];
  readonly version: number;
  readonly status: GoalStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface GoalWorkspace {
  readonly goals: readonly Goal[];
  readonly activeGoalId: string | null;
}
export type GoalInput = Pick<Goal, 'kind' | 'title' | 'outcome'> & Partial<Pick<Goal, 'criteria' | 'openQuestions' | 'status'>>;
export type GoalChanges = Partial<GoalInput>;

const kinds = ['career', 'fundraising', 'advisory', 'partnership', 'other'] as const;
const statuses = ['active', 'paused', 'completed'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const controls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || controls.test(value)) throw new TypeError(`${label} must contain readable text under ${max + 1} characters.`);
  return value;
}
function choice<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (!allowed.includes(value as T)) throw new TypeError(`${label} is not recognized.`);
  return value as T;
}
function date(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value))) throw new TypeError(`${label} is invalid.`);
  return new Date(value).toISOString();
}
function list(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new TypeError(`${label} must be an array with at most ${max} entries.`);
  return value;
}
export function normalizeGoalCriterion(value: unknown): GoalCriterion {
  const row = object(value, 'Goal criterion');
  const id = text(row.id, 'Criterion identifier', 100);
  if (!/^[\w-]+$/.test(id)) throw new TypeError('Criterion identifier must contain letters, digits, underscores, or hyphens.');
  const terms = list(row.terms, 'Criterion terms', 20).map(term => text(term, 'Criterion term', 200).trim());
  return {id, field: choice(row.field, ['role','industry','location','stage','check_size','custom'], 'Criterion field'), label: text(row.label, 'Criterion label', 200), terms: [...new Set(terms)], importance: choice(row.importance, ['required','preferred'], 'Criterion importance'), appliesTo: choice(row.appliesTo, ['opportunity','contact'], 'Criterion subject'), origin: choice(row.origin, ['user','suggested'], 'Criterion origin')};
}
export function normalizeGoal(value: unknown): Goal {
  const row = object(value, 'Goal');
  if (typeof row.id !== 'string' || !UUID.test(row.id)) throw new TypeError('Goal identifier must be a UUID.');
  if (!Number.isSafeInteger(row.version) || Number(row.version) < 1 || Number(row.version) > 2_147_483_647) throw new TypeError('Goal version must be a positive integer.');
  const criteria = list(row.criteria, 'Goal criteria', 30).map(normalizeGoalCriterion);
  if (new Set(criteria.map(c => c.id)).size !== criteria.length) throw new TypeError('Criterion identifiers must be distinct.');
  const goal: Goal = {id: row.id.toLowerCase(), kind: choice(row.kind, kinds, 'Goal kind'), title: text(row.title, 'Goal title', 200), outcome: text(row.outcome, 'Goal outcome', 16_000), criteria, openQuestions: list(row.openQuestions, 'Open questions', 30).map(q => text(q, 'Open question', 1_000)), version: Number(row.version), status: choice(row.status, statuses, 'Goal status'), createdAt: date(row.createdAt, 'Goal creation date'), updatedAt: date(row.updatedAt, 'Goal update date')};
  if (Date.parse(goal.updatedAt) < Date.parse(goal.createdAt)) throw new TypeError('Goal update cannot precede its creation.');
  if (new TextEncoder().encode(JSON.stringify(goal)).byteLength > 65_536) throw new TypeError('The goal is too large to save.');
  return goal;
}
export const validateGoal = normalizeGoal;
export function createGoal(input: GoalInput, options: {id?: string; now?: string} = {}): Goal {
  const now = options.now ?? new Date().toISOString();
  return normalizeGoal({...input, criteria: input.criteria ?? [], openQuestions: input.openQuestions ?? [], status: input.status ?? 'active', id: options.id ?? crypto.randomUUID(), version: 1, createdAt: now, updatedAt: now});
}
/** Version-independent content used for retries and local/cloud conflict detection. */
export function goalContentKey(goal: Goal): string {
  const {id, kind, title, outcome, criteria, openQuestions, status} = normalizeGoal(goal);
  return JSON.stringify({id, kind, title, outcome, criteria, openQuestions, status});
}
export function reviseGoal(goal: Goal, changes: GoalChanges, options: {now?: string} = {}): Goal {
  const previous = normalizeGoal(goal);
  const candidate = normalizeGoal({...previous, ...changes, id: previous.id, createdAt: previous.createdAt});
  if (goalContentKey(previous) === goalContentKey(candidate)) return previous;
  const now = options.now ?? new Date().toISOString();
  return normalizeGoal({...candidate, version: previous.version + 1, updatedAt: new Date(Math.max(Date.parse(now), Date.parse(previous.updatedAt))).toISOString()});
}
export function normalizeGoalWorkspace(value: unknown): GoalWorkspace {
  const row = object(value, 'Goal workspace');
  const goals = list(row.goals, 'Goals', 100).map(normalizeGoal);
  if (new Set(goals.map(g => g.id)).size !== goals.length) throw new TypeError('Goal identifiers must be distinct.');
  if (row.activeGoalId !== null && (typeof row.activeGoalId !== 'string' || !goals.some(g => g.id === row.activeGoalId && g.status === 'active'))) throw new TypeError('Choose an active goal from this workspace.');
  return {goals, activeGoalId: row.activeGoalId as string | null};
}
export const validateGoalWorkspace = normalizeGoalWorkspace;
/** An existing empty workspace is intentional and must never re-import old text. */
export function migrateLegacyGoalWorkspace(existing: GoalWorkspace | null | undefined, legacyStrategy: unknown, options: {id?: string; now?: string} = {}): GoalWorkspace {
  if (existing !== null && existing !== undefined) return normalizeGoalWorkspace(existing);
  if (typeof legacyStrategy !== 'string' || !legacyStrategy.trim()) return {goals: [], activeGoalId: null};
  const goal = createGoal({kind: 'other', title: 'Imported goal', outcome: legacyStrategy}, options);
  return {goals: [goal], activeGoalId: goal.id};
}
export function upsertWorkspaceGoal(workspace: GoalWorkspace, goal: Goal): GoalWorkspace {
  const current = normalizeGoalWorkspace(workspace); const next = normalizeGoal(goal);
  const goals = current.goals.some(g => g.id === next.id) ? current.goals.map(g => g.id === next.id ? next : g) : [...current.goals, next];
  const activeGoalId = goals.some(g => g.id === current.activeGoalId && g.status === 'active') ? current.activeGoalId : goals.find(g => g.status === 'active')?.id ?? null;
  return normalizeGoalWorkspace({goals, activeGoalId});
}
