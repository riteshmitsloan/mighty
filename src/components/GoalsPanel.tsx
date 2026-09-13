import {useEffect, useId, useRef, useState} from 'react';
import {Plus, X} from 'lucide-react';
import {createGoal, goalContentKey, normalizeGoal, reviseGoal, type Goal, type GoalCriterion, type GoalKind} from '../lib/goals';
import type {GoalSwitcherProps} from './GoalSwitcher';
import GoalCoach, {goalCoachContextKey, type GoalCoachCall} from './GoalCoach';
import type {GoalCoachContext} from '../lib/goal-coach';
import './GoalsPanel.css';

export type GoalsPanelProps = GoalSwitcherProps & {
  onSave: (goal: Goal) => Promise<void>;
  notice?: string;
  draftKey?: string;
  coach?: GoalCoachCall;
};
type CriterionDraft = Omit<GoalCriterion, 'terms'> & {text: string; preservedTerms?: readonly string[]};
type Draft = {id: string; createdAt: string; base: Goal | null; kind: GoalKind; title: string; outcome: string; status: Goal['status']; questions: string; criteria: CriterionDraft[]; dirty: boolean; awaitingCommit?: boolean};
const NEW = '__new_goal_draft__';
const kinds: Record<GoalKind, string> = {career: 'Career', fundraising: 'Fundraising', advisory: 'Advisory', partnership: 'Partnership', other: 'Something else'};
const fields: Record<GoalCriterion['field'], string> = {role: 'Role', industry: 'Industry', location: 'Location', stage: 'Stage', check_size: 'Investor check size', custom: 'Other condition'};
const terms = (text: string) => [...new Set(text.split(',').map(term => term.trim()).filter(Boolean))];
const blankCriterion = (field: GoalCriterion['field']): CriterionDraft => ({id: crypto.randomUUID(), field, label: fields[field], text: '', importance: 'preferred', appliesTo: 'opportunity', origin: 'user'});
const defaults = (kind: GoalKind): GoalCriterion['field'][] => kind === 'career' ? ['role', 'industry', 'location'] : kind === 'fundraising' ? ['stage', 'check_size'] : [];
const fresh = (): Draft => ({id: crypto.randomUUID(), createdAt: new Date().toISOString(), base: null, kind: 'career', title: '', outcome: '', status: 'active', questions: '', criteria: defaults('career').map(blankCriterion), dirty: false});
const fromGoal = (goal: Goal): Draft => ({id: goal.id, createdAt: goal.createdAt, base: goal, kind: goal.kind, title: goal.title, outcome: goal.outcome, status: goal.status, questions: goal.openQuestions.join('\n'), criteria: [...goal.criteria.map(({terms: values, ...criterion}) => ({...criterion, text: values.join(', '), preservedTerms: values})), ...defaults(goal.kind).filter(field => !goal.criteria.some(criterion => criterion.field === field)).slice(0,Math.max(0,30-goal.criteria.length)).map(blankCriterion)], dirty: false});

const storageKey = (key?: string) => key && key.length <= 200 ? `mighty:goal-drafts:v1:${encodeURIComponent(key)}` : null;
const MAX_DRAFT_BYTES = 131_072;
const ACTIVE_ACCOUNT_REQUIRED = 'An active account is required to save goals.';
const INACTIVE_WORKSPACE_MESSAGE = 'You’re signed in, but this workspace isn’t active for account saves. Ask the person who set up your account to activate it, then try Save goal again. Your edits are still here.';
const inactiveWorkspaceNotices = new Set([ACTIVE_ACCOUNT_REQUIRED, `Your edit is kept on this device. ${ACTIVE_ACCOUNT_REQUIRED}`, `Your unfinished edit is preserved. ${ACTIVE_ACCOUNT_REQUIRED}`]);
const goalSaveError = (cause: unknown) => cause instanceof Error && cause.message === ACTIVE_ACCOUNT_REQUIRED
  ? INACTIVE_WORKSPACE_MESSAGE : 'Couldn’t save this goal. Your edits are still here. Try again.';
const draftInput = (draft: Draft) => ({kind: draft.kind, title: draft.base && draft.title === draft.base.title ? draft.base.title : draft.title.trim(), outcome: draft.outcome, status: draft.status, openQuestions: draft.base && draft.questions === draft.base.openQuestions.join('\n') ? draft.base.openQuestions : draft.questions.split('\n').map(line => line.trim()).filter(Boolean), criteria: draft.criteria.filter(criterion => criterion.text.trim() || criterion.preservedTerms !== undefined).map(({text, preservedTerms, ...criterion}) => ({...criterion, terms: preservedTerms ?? terms(text)}))});
const coachContext = (draft: Draft): GoalCoachContext => {const {status: _status, ...context} = draftInput(draft); return context;};
const sameContent = (first: Goal, second: Goal) => goalContentKey(first) === goalContentKey(second);
function matchesDraft(draft: Draft, goal: Goal) {
  try {return sameContent(createGoal(draftInput(draft), {id: draft.id, now: draft.createdAt}), goal);} catch {return false;}
}
function restoreDrafts(key?: string): {drafts: Record<string, Draft>; editing?: string; notice: string} {
  const empty = {drafts: {}, notice: ''};
  const name = storageKey(key);
  if (!name) return empty;
  try {
    const raw = window.localStorage.getItem(name);
    if (!raw) return empty;
    if (new TextEncoder().encode(raw).byteLength > MAX_DRAFT_BYTES) throw Error();
    const saved = JSON.parse(raw);
    if (saved?.version !== 1 || !Array.isArray(saved.drafts) || saved.drafts.length > 100) throw Error();
    const result: Record<string, Draft> = {};
    const validText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;
    for (const entry of saved.drafts) {
      if (!Array.isArray(entry) || entry.length !== 2) throw Error();
      const [entryKey, value] = entry;
      if (typeof entryKey !== 'string' || Object.hasOwn(result,entryKey)) throw Error();
      if (!value || typeof value !== 'object' || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value.id) || (entryKey !== NEW && entryKey !== value.id)) throw Error();
      if (!Object.hasOwn(kinds, value.kind) || !['active','paused','completed'].includes(value.status) || !validText(value.title,200) || !validText(value.outcome,16000) || !validText(value.questions,31000) || !Array.isArray(value.criteria) || value.criteria.length > 30 || !validText(value.createdAt,40) || !/^\d{4}-\d\d-\d\dT/.test(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt))) throw Error();
      const base = value.base === null ? null : normalizeGoal(value.base);
      if ((base && base.id !== value.id) || (!base && entryKey !== NEW)) throw Error();
      const criteria: CriterionDraft[] = value.criteria.map((criterion: CriterionDraft) => {
        if (!criterion || !validText(criterion.id,100) || !/^[\w-]+$/.test(criterion.id) || !Object.hasOwn(fields,criterion.field) || !validText(criterion.label,200) || !validText(criterion.text,16000) || !['required','preferred'].includes(criterion.importance) || !['opportunity','contact'].includes(criterion.appliesTo) || !['user','suggested'].includes(criterion.origin)) throw Error();
        const original = base?.criteria.find(item => item.id === criterion.id);
        const preserved = criterion.preservedTerms;
        if (preserved !== undefined && (!Array.isArray(preserved) || preserved.length > 20 || preserved.some(term => !validText(term,200) || !term.trim()) || preserved.join(', ') !== criterion.text)) throw Error();
        return {id:criterion.id,field:criterion.field,label:criterion.label,text:criterion.text,importance:criterion.importance,appliesTo:criterion.appliesTo,origin:criterion.origin,...(preserved !== undefined ? {preservedTerms:preserved} : original && original.terms.join(', ') === criterion.text ? {preservedTerms:original.terms} : {})};
      });
      if (new Set(criteria.map(criterion => criterion.id)).size !== criteria.length) throw Error();
      result[entryKey] = {id:value.id,createdAt:value.createdAt,base,kind:value.kind,title:value.title,outcome:value.outcome,status:value.status,questions:value.questions,criteria,dirty:true};
    }
    return {drafts:result,editing:Object.hasOwn(result,saved.editing) ? saved.editing : undefined,notice:Object.keys(result).length ? 'Your unfinished edits are restored in this browser.' : ''};
  } catch {return {drafts:{},notice:'An unfinished draft could not be restored. Your saved goals are unchanged.'};}
}

/** draftKey is the current workspace identity. The parent must bind onSave to the same account. */
export default function GoalsPanel(props: GoalsPanelProps) {
  return <GoalEditor key={props.draftKey ?? 'memory-only'} {...props}/>;
}
function GoalEditor({goals, activeGoalId, onSelect, onSave, busy = false, notice, draftKey, coach}: GoalsPanelProps) {
  const id = useId();
  const [restored] = useState(() => restoreDrafts(draftKey));
  const [editing, setEditing] = useState(restored.editing || activeGoalId || goals[0]?.id || NEW);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => ({...Object.fromEntries(goals.map(goal => [goal.id,fromGoal(goal)])), [NEW]:fresh(), ...restored.drafts}));
  const [storageNotice, setStorageNotice] = useState(restored.notice);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  const mounted = useRef(true);
  const draftState = useRef(drafts);
  const currentProps = useRef({goals, busy});
  currentProps.current = {goals, busy};
  const priorActive = useRef(activeGoalId);
  const updateDrafts = (update: (previous: Record<string,Draft>) => Record<string,Draft>, nextEditing = editing) => {
    const next = update(draftState.current);
    draftState.current = next; setDrafts(next);
    const name = storageKey(draftKey);
    if (!name) return;
    try {
      const unfinished = Object.entries(next).filter(([,draft]) => draft.dirty);
      if (!unfinished.length) {window.localStorage.removeItem(name); setStorageNotice(''); return;}
      const value = JSON.stringify({version:1,editing:nextEditing,drafts:unfinished});
      if (new TextEncoder().encode(value).byteLength > MAX_DRAFT_BYTES) throw Error();
      window.localStorage.setItem(name,value); setStorageNotice('');
    } catch {setStorageNotice('Edits stay here, but this browser couldn’t keep the latest draft between visits. Save before leaving.');}
  };
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  useEffect(() => {
    if (priorActive.current !== activeGoalId) {
      priorActive.current = activeGoalId;
      // Hydration must not take the user away from a form they already started.
      if (activeGoalId && !lock.current && !draftState.current[editing]?.dirty) {setEditing(activeGoalId); setError(''); setMessage('');}
    }
  }, [activeGoalId, editing]);
  useEffect(() => {
    let next: Record<string,Draft> | undefined;
    for (const goal of goals) {
      const existing = draftState.current[goal.id];
      if (!existing) {next ??= {...draftState.current}; next[goal.id] = fromGoal(goal); continue;}
      const sameBase = existing.base && sameContent(existing.base,goal);
      if (existing.dirty) {
        if (existing.base && (sameBase || matchesDraft(existing,goal)) && (existing.base.version !== goal.version || !sameBase)) {
          next ??= {...draftState.current}; next[goal.id] = {...existing,base:goal};
        }
      } else if (!existing.awaitingCommit || sameBase || (existing.base && goal.version > existing.base.version)) {
        if (!sameBase || existing.base?.version !== goal.version || existing.awaitingCommit) {next ??= {...draftState.current}; next[goal.id] = fromGoal(goal);}
      }
    }
    if (next) updateDrafts(() => next!);
  }, [goals,drafts]);
  const selected = goals.find(goal => goal.id === editing);
  const cached = drafts[editing];
  const draft = cached || (selected ? fromGoal(selected) : null);
  const stale = Boolean(draft?.dirty && draft.base && (!selected || (!sameContent(selected,draft.base) && !matchesDraft(draft,selected))));
  const disabled = busy || saving;
  const change = (patch: Partial<Draft>) => {
    if (lock.current || currentProps.current.busy || !draft) return;
    updateDrafts(previous => ({...previous, [editing]: {...(previous[editing] || draft), ...patch, dirty: true}}));
    setError(''); setMessage('');
  };
  const chooseEditor = (goalId: string) => {
    if (lock.current || currentProps.current.busy) return;
    setEditing(goalId); setError(''); setMessage('');
    if (goalId === NEW) updateDrafts(previous => previous[NEW] ? previous : {...previous, [NEW]: fresh()},goalId);
  };
  const editCriterion = (index: number, patch: Partial<CriterionDraft>) => {
    if (draft) change({criteria: draft.criteria.map((criterion, at) => at === index ? {...criterion, ...patch, ...(Object.hasOwn(patch, 'text') ? {preservedTerms: undefined} : {}), origin: 'user'} : criterion)});
  };
  const save = async () => {
    if (lock.current || currentProps.current.busy || !draft) return;
    const latest = currentProps.current.goals.find(goal => goal.id === draft.id);
    if (draft.base && (!latest || (!sameContent(latest,draft.base) && !matchesDraft(draft,latest)))) {setError('This goal changed elsewhere. Your edits are still here; review the saved version before saving.'); return;}
    if (!draft.title.trim() || !draft.outcome.trim()) {setError('Add a name and the outcome you want.'); return;}
    let goal: Goal;
    try {
      const input = draftInput(draft);
      goal = draft.base && latest ? reviseGoal(latest, input) : createGoal(input, {id: draft.id, now: draft.createdAt});
      if (!draft.base && latest) {
        if (!sameContent(latest,goal)) {setError('A saved goal now uses this draft’s identity. Review that goal before changing it.'); return;}
        goal = latest;
      }
    } catch (cause) {setError(cause instanceof Error ? cause.message : 'Check the goal details and try again.'); return;}
    lock.current = true; setSaving(true); setError(''); setMessage('');
    try {
      await onSave(goal);
      if (!mounted.current) return;
      updateDrafts(previous => {const next = {...previous, [goal.id]: {...fromGoal(goal),awaitingCommit:true}}; if (editing === NEW) delete next[NEW]; return next;},goal.id);
      setEditing(goal.id); setMessage('Goal saved.');
    } catch (cause) {
      if (mounted.current) setError(goalSaveError(cause));
    } finally {
      lock.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  const applyCoach = (proposal: GoalCoachContext, expected: GoalCoachContext): boolean => {
    if (lock.current || currentProps.current.busy || !draft || stale) return false;
    const latest = draftState.current[editing] || draft;
    if (goalCoachContextKey(coachContext(latest)) !== goalCoachContextKey(expected)) return false;
    const existingCriteria = draftInput(latest).criteria;
    const criteria = proposal.criteria.map(criterion => {
      const existing = existingCriteria.find(item => item.id === criterion.id);
      const same = existing && existing.field === criterion.field && existing.label === criterion.label && existing.importance === criterion.importance && existing.appliesTo === criterion.appliesTo && JSON.stringify(existing.terms) === JSON.stringify(criterion.terms);
      const confirmed = same ? existing : {...criterion,origin:'user' as const};
      const {terms: values, ...metadata} = confirmed;
      return {...metadata,text:values.join(', '),preservedTerms:values};
    });
    change({kind:proposal.kind,title:proposal.title,outcome:proposal.outcome,questions:proposal.openQuestions.join('\n'),criteria});
    return true;
  };
  const missingFundraising = draft?.kind === 'fundraising' ? (['stage', 'check_size'] as const).filter(field => !draft.criteria.some(criterion => criterion.field === field && criterion.text.trim())) : [];
  const inactiveWorkspace = inactiveWorkspaceNotices.has(notice ?? '');
  const visibleNotice = inactiveWorkspace ? INACTIVE_WORKSPACE_MESSAGE : notice;
  const visibleError = inactiveWorkspace && error === INACTIVE_WORKSPACE_MESSAGE ? '' : error;

  return <section className="goals-panel" aria-labelledby={`${id}-heading`}>
    <div className="section-heading"><div><h2 id={`${id}-heading`}>Your goals</h2><p className="muted small">A clear outcome makes the next conversation easier to choose.</p></div><button type="button" className="button secondary small" disabled={disabled} onClick={() => chooseEditor(NEW)}><Plus size={15}/>Add goal</button></div>
    {visibleNotice && <p className="notice" role={inactiveWorkspace ? 'alert' : 'status'}>{visibleNotice}</p>}
    {goals.length > 0 && <div className="goal-cards">{goals.map(goal => <article key={goal.id} className={`panel goal-card ${goal.id === editing ? 'is-editing' : ''}`}>
      <div className="goal-card-meta"><span>{kinds[goal.kind]}</span><span className={`pill ${goal.id === activeGoalId ? '' : 'neutral'}`}>{goal.status === 'active' ? goal.id === activeGoalId ? 'Current goal' : 'Active' : goal.status === 'paused' ? 'Paused' : 'Completed'}</span></div>
      <h3>{goal.title}</h3><p>{goal.outcome}</p>
      <div className="row-actions"><button type="button" className="text-button" disabled={disabled} aria-label={`Edit ${goal.title}`} onClick={() => chooseEditor(goal.id)}>Edit goal{drafts[goal.id]?.dirty ? ' · Unsaved' : ''}</button>{goal.status === 'active' && goal.id !== activeGoalId && <button type="button" className="text-button" disabled={disabled} onClick={() => {if (!lock.current && !currentProps.current.busy) {chooseEditor(goal.id); onSelect(goal.id);}}}>Use this goal</button>}</div>
    </article>)}</div>}
    {draft && <GoalCoach key={draft.id} context={coachContext(draft)} storageScope={draftKey ? JSON.stringify([draftKey,draft.id]) : undefined} coach={coach} disabled={disabled || stale} onApply={applyCoach} onInteract={() => {if (editing === NEW && !draftState.current[editing]?.dirty) change({});}}/>}
    {draft ? <form className="panel content-panel goal-detail-form" aria-label={draft.base ? 'Edit goal' : 'Add goal'} onSubmit={event => {event.preventDefault(); void save();}}>
      <div className="section-heading"><h3>{draft.base ? 'Goal details' : 'What are you working toward?'}</h3>{draft.dirty && <span className="muted small">Unsaved edits</span>}</div>
      {stale && <div className="goal-conflict" role="alert"><p>This goal changed elsewhere. Your edits are still here.</p>{selected && <button type="button" className="text-button" disabled={disabled} onClick={() => {if (!lock.current && !currentProps.current.busy) {updateDrafts(previous => ({...previous, [editing]: fromGoal(selected)})); setError(''); setMessage('Loaded the saved version.');}}}>Replace these edits with the saved version</button>}</div>}
      <fieldset disabled={disabled}>
        <div className="form-columns"><label>Goal type<select value={draft.kind} onChange={event => {
          const kind = event.target.value as GoalKind;
          const criteria = draft.criteria.filter(criterion => criterion.text.trim() || criterion.preservedTerms !== undefined);
          change({kind, criteria: [...criteria, ...defaults(kind).filter(field => !criteria.some(criterion => criterion.field === field)).slice(0,Math.max(0,30-criteria.length)).map(blankCriterion)]});
        }}>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Goal name<input value={draft.title} maxLength={200} placeholder="A name you’ll recognize" onChange={event => change({title: event.target.value})}/></label></div>
        <label>Outcome you want<textarea value={draft.outcome} rows={3} maxLength={16000} placeholder="What would useful progress look like?" onChange={event => change({outcome: event.target.value})}/></label>
        <div className="goal-criteria-heading"><h3>What matters</h3><p className="muted small">Separate the opportunity you want from the person who could help. Use commas for alternatives.</p></div>
        <div className="goal-criteria">{draft.criteria.map((criterion, index) => <div className="goal-criterion" key={criterion.id}>
          <div className="goal-criterion-top"><label className="goal-criterion-value">{criterion.field === 'location' && criterion.appliesTo === 'opportunity' ? 'Opportunity locations' : criterion.label}<input value={criterion.text} maxLength={16000} placeholder={criterion.field === 'location' ? 'Cities, regions, or remote' : 'Add what you know'} onChange={event => editCriterion(index, {text: event.target.value})}/></label><button type="button" className="icon-button" aria-label={`Remove ${criterion.label} condition`} onClick={() => change({criteria: draft.criteria.filter((_, at) => at !== index)})}><X size={16}/></button></div>
          <details className="goal-condition-options"><summary>{criterion.importance === 'required' ? 'Required' : 'Preferred'} · {criterion.appliesTo === 'opportunity' ? 'Opportunity' : 'Person'}{criterion.origin === 'suggested' ? ' · Suggested' : ''}</summary><div className="goal-condition-grid">
            <label>Condition type<select value={criterion.field} onChange={event => {const field = event.target.value as GoalCriterion['field']; editCriterion(index, {field, label: fields[field]});}}>{Object.entries(fields).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label>Label<input value={criterion.label} maxLength={200} onChange={event => editCriterion(index, {label: event.target.value})}/></label>
            <label>Importance<select value={criterion.importance} onChange={event => editCriterion(index, {importance: event.target.value as GoalCriterion['importance']})}><option value="preferred">Preferred</option><option value="required">Required</option></select></label>
            <label>Applies to<select value={criterion.appliesTo} onChange={event => editCriterion(index, {appliesTo: event.target.value as GoalCriterion['appliesTo']})}><option value="opportunity">Opportunity</option><option value="contact">Person who could help</option></select></label>
          </div></details>
        </div>)}</div>
        <button type="button" className="text-button" disabled={draft.criteria.length >= 30} onClick={() => {if (draft.criteria.length < 30) change({criteria: [...draft.criteria, blankCriterion('custom')]});}}><Plus size={14}/>Add a condition</button>
        {missingFundraising.length > 0 && <p className="goal-unanswered">{missingFundraising.map(field => field === 'stage' ? 'Stage' : 'Investor check size').join(' and ')}: unanswered. Add these when known.</p>}
        <details className="goal-extra"><summary>Open questions and goal status</summary><label>Questions to resolve<textarea value={draft.questions} rows={3} maxLength={31000} placeholder="One question per line" onChange={event => change({questions: event.target.value})}/></label><label>Status<select value={draft.status} onChange={event => change({status: event.target.value as Goal['status']})}><option value="active">Active</option><option value="paused">Paused</option><option value="completed">Completed</option></select></label><p className="muted small">Paused and completed goals stay saved and leave the active goal switcher.</p></details>
      </fieldset>
      {visibleError && <p className="form-error" role="alert">{visibleError}</p>}
      {message && <p className="goal-save-notice" role="status">{message}</p>}
      {storageNotice && <p className="goal-save-notice" role="status">{storageNotice}</p>}
      <div className="row-actions goal-save-actions"><button className="button primary" disabled={disabled || stale}>{saving ? 'Saving…' : 'Save goal'}</button><span className="muted small">{draftKey ? 'Unfinished edits stay in this browser for this workspace. Save to update the goal.' : 'Unsaved edits stay here while you switch goals. Save before leaving this page.'}</span></div>
    </form> : <p className="muted">Choose a goal to edit, or add a new one.</p>}
  </section>;
}
