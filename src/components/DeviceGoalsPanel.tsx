import {useEffect, useRef, useState} from 'react';
import type {GoalWorkspace, Goal} from '../lib/goals';
import {deviceGoalHandoff, type DeviceGoalHandoff, type DeviceGoalPreview} from '../lib/device-goals';

export interface DeviceGoalsPanelProps {
  uid: string;
  busy?: boolean;
  onCopied: (workspace: GoalWorkspace) => void | Promise<void>;
  handoff?: DeviceGoalHandoff;
}
export default function DeviceGoalsPanel({uid, busy = false, onCopied, handoff = deviceGoalHandoff}: DeviceGoalsPanelProps) {
  const [available, setAvailable] = useState<readonly Goal[] | null>(null), [selected, setSelected] = useState<readonly string[]>([]);
  const [preview, setPreview] = useState<DeviceGoalPreview | null>(null), [pending, setPending] = useState(false), [notice, setNotice] = useState('');
  const identity = useRef(uid), generation = useRef(0), lock = useRef(false); identity.current = uid;
  useEffect(() => {generation.current++; lock.current = false; setAvailable(null); setSelected([]); setPreview(null); setPending(false); setNotice('');
    return () => {generation.current++;};}, [uid, handoff]);
  async function run(action: (current: () => boolean) => Promise<void>) {
    if (!uid || busy || lock.current) return;
    const account = uid, version = generation.current; const current = () => identity.current === account && generation.current === version;
    lock.current = true; setPending(true); setNotice('');
    try {await action(current);} catch (error) {if (current()) {setPreview(null); setNotice(error instanceof Error ? error.message : 'These goals could not be copied. Review them again.');}}
    finally {if (current()) {lock.current = false; setPending(false);}}
  }
  const review = () => run(async current => {
    setPreview(null); const result = await handoff.prepare(uid, !available?.length ? undefined : selected);
    if (!current()) return;
    if (!available?.length) {setAvailable(result.goals); setSelected(result.goals.map(goal => goal.id));}
    setPreview(result);
    if (!result.goals.length) setNotice(available === null ? 'No saved goals from before sign-in are available in this browser.' : 'Choose at least one goal.');
  });
  const copy = () => run(async current => {
    if (!preview || preview.destinationUid !== uid || !preview.goals.length || preview.conflicts.length) return;
    const workspace = await handoff.copy(preview); if (!current()) return;
    try {await onCopied(workspace);} catch {if (current()) {setPreview(null); setNotice('Goals were copied locally, but this view could not refresh. Reopen your goals to see them.');} return;}
    if (!current()) return;
    setPreview(null); setNotice('Selected goals are available for this account on this device. Save a goal to sync it to your account.');
  });
  const disabled = pending || busy;
  return <section className="panel content-panel device-goals-panel">
    <h2>Goals from before sign-in</h2>
    <p>Review saved device goals and choose which to copy into this account’s local workspace. Your originals remain on this device.</p>
    {available && available.length > 0 && <fieldset disabled={disabled}><legend>Choose device goals</legend>{available.map(goal => <div key={goal.id}><label>
      <input type="checkbox" checked={selected.includes(goal.id)} onChange={() => {if (busy || lock.current) return; setSelected(ids => ids.includes(goal.id) ? ids.filter(id => id !== goal.id) : [...ids, goal.id]); setPreview(null); setNotice('');}}/>
      <span><strong>{goal.title}</strong> · {goal.kind}<br/>{goal.outcome}</span>
    </label><details><summary>Review criteria and open questions</summary><p>{goal.status} · version {goal.version}</p>
      {goal.criteria.length ? <ul>{goal.criteria.map(item => <li key={item.id}>{item.label}: {item.terms.join(', ') || 'Unanswered'} · {item.importance} · {item.appliesTo} · {item.origin === 'user' ? 'your choice' : 'suggested'}</li>)}</ul> : <p>No criteria have been confirmed.</p>}
      {goal.openQuestions.length > 0 && <ul>{goal.openQuestions.map((question, index) => <li key={index}>{question}</li>)}</ul>}
    </details></div>)}</fieldset>}
    {Boolean(preview?.conflicts.length) && <div role="status"><p>These versions differ. Deselect them to keep both originals.</p><ul>{preview!.conflicts.map(conflict => <li key={`${conflict.goalId}:${conflict.location}`}>{conflict.title}: a different version exists {conflict.location === 'local-account' ? 'in this account’s local workspace' : 'in your account'}.</li>)}</ul></div>}
    {preview && preview.goals.length > 0 && !preview.conflicts.length && <p>{preview.goals.length} {preview.goals.length === 1 ? 'goal is' : 'goals are'} ready to copy. This action does not save them to the cloud.</p>}
    <div className="row-actions"><button type="button" className="button secondary" disabled={disabled || Boolean(available?.length && !selected.length)} onClick={() => void review()}>{pending ? 'Working…' : available === null || !available.length ? 'Review device goals' : 'Review selected goals'}</button>
      {preview && preview.goals.length > 0 && <button type="button" className="button primary" disabled={disabled || Boolean(preview.conflicts.length)} onClick={() => void copy()}>Copy selected goals</button>}</div>
    {notice && <p role="status">{notice}</p>}
  </section>;
}
