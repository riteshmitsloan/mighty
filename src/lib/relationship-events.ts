import type {Capture} from './workspace';
import type {Goal} from './goals';
import {normalizeGoalInteraction, recordGoalInteraction, type GoalInteractionInput, type InteractionRecord} from './relationship-context';
import {contentFingerprint} from './text';

export const isCommitment = (event: Pick<Capture, 'kind'>) => event.kind === 'promise_made' || event.kind === 'next_step';
export const isCompletion = (event: Pick<Capture, 'kind'>) => event.kind === 'promise_kept' || event.kind === 'next_step_completed';
const completionKind = (event: Pick<Capture, 'kind'>) => event.kind === 'next_step' ? 'next_step_completed' : 'promise_kept';

/** A reference alone cannot close another person's or goal's commitment. */
export function completedCommitmentIds(events: readonly Capture[]): Set<string> {
  const originals = new Map(events.filter(isCommitment).map(event => [event.id, event]));
  const complete = new Set<string>();
  for (const event of events) {
    if (!isCompletion(event) || !event.related_event_id) continue;
    const original = originals.get(event.related_event_id);
    if (original && original.relationship_id === event.relationship_id && event.kind === completionKind(original)
      && (original.goal_id ?? null) === (event.goal_id ?? null)) complete.add(original.id);
  }
  return complete;
}

/** Today shows the selected goal and optional legacy reminders, never another goal's next steps. */
export function openGoalCommitments(events: readonly Capture[], options: {
  activeGoalId: string | null; relationshipIds?: ReadonlySet<string>; includeLegacy?: boolean;
}): Capture[] {
  const complete = completedCommitmentIds(events);
  const due = (event: Capture) => event.due_at && Number.isFinite(Date.parse(event.due_at)) ? Date.parse(event.due_at) : Infinity;
  const created = (event: Capture) => Number.isFinite(Date.parse(event.created_at)) ? Date.parse(event.created_at) : Infinity;
  return events.filter(event => isCommitment(event) && !complete.has(event.id)
    && (!options.relationshipIds || options.relationshipIds.has(event.relationship_id))
    && (event.goal_id ? event.goal_id === options.activeGoalId : options.includeLegacy !== false))
    .sort((a, b) => (due(a) - due(b) || created(a) - created(b) || a.id.localeCompare(b.id)));
}

export function goalEventLabel(event: Pick<Capture, 'goal_id' | 'goal_version'>, goals: readonly Goal[]): string | null {
  if (!event.goal_id) return null;
  const goal = goals.find(item => item.id === event.goal_id);
  if (!goal) return 'Linked goal unavailable';
  return `Goal: ${goal.title}${event.goal_version && event.goal_version < goal.version ? ' · earlier goal version' : ''}`;
}

type RecordInteraction = (uid: string | null, input: GoalInteractionInput) => Promise<InteractionRecord>;
/** User action only. Stable request IDs survive refresh/retry; no sent activity is fabricated. */
export function createCommitmentCompleter(record: RecordInteraction = recordGoalInteraction) {
  const pending = new Map<string, Promise<InteractionRecord>>();
  return function complete(uid: string | null, event: Capture): Promise<InteractionRecord> {
    if (uid !== null && (typeof uid !== 'string' || !uid)) return Promise.reject(new TypeError('A workspace is required.'));
    if (event.user_id && event.user_id !== uid) return Promise.reject(new Error('This reminder belongs to another account.'));
    if (!isCommitment(event)) return Promise.reject(new TypeError('Choose an open promise or next step.'));
    if (event.goal_id && (!Number.isSafeInteger(event.goal_version) || Number(event.goal_version) < 1)) {
      return Promise.reject(new TypeError('Reload this reminder before completing it; its goal version is missing.'));
    }
    const context = [uid, event.relationship_id, event.id, event.kind, event.goal_id ?? null, event.goal_version ?? null];
    const key = JSON.stringify(context);
    const previous = pending.get(key); if (previous) return previous;
    const snapshot = structuredClone(event);
    const task = (async () => {
      const hash = await contentFingerprint(['mighty-commitment-completion-v1', ...context]);
      const requestId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
      const input = normalizeGoalInteraction({requestId, relationshipId: snapshot.relationship_id,
        goalId: snapshot.goal_id ?? null, goalVersion: snapshot.goal_version ?? null,
        kind: completionKind(snapshot), body: '', relatedEventId: snapshot.id});
      return record(uid, input);
    })();
    pending.set(key, task);
    void task.finally(() => {if (pending.get(key) === task) pending.delete(key);}).catch(() => {});
    return task;
  };
}
export const completeRelationshipCommitment = createCommitmentCompleter();
