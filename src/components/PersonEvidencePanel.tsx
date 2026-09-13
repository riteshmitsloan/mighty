import {useEffect, useMemo, useRef, useState} from 'react';
import type {Goal} from '../lib/goals';
import type {Person} from '../lib/workspace';
import type {GatewayCall} from '../lib/platform';
import type {EvidenceClaim} from '../lib/evidence';
import {buildSavedPersonEvidence} from '../lib/person-evidence';
import {assessCandidate} from '../lib/assessment';
import {listRelationshipContext, saveCandidateObservation, normalizeCandidateObservation, observationsToClaims, type CandidateObservationInput, type MessageDraft} from '../lib/relationship-context';
import ConversationPanel from './ConversationPanel';
import './PersonEvidencePanel.css';

type Context = Awaited<ReturnType<typeof listRelationshipContext>>;
type Observation = Context['observations'][number];
interface ContextStore {read: typeof listRelationshipContext; save: typeof saveCandidateObservation;}
const defaultContextStore: ContextStore = {read: listRelationshipContext, save: saveCandidateObservation};
export interface PersonEvidencePanelProps {
  uid: string | null; person: Person; goals: readonly Goal[]; activeGoal: Goal | null;
  selfEvidence: readonly EvidenceClaim[]; call: GatewayCall; onRemaining: (remaining: number) => void;
  onRecorded: () => Promise<void>; contextStore?: ContextStore;
}
const fields: CandidateObservationInput['field'][] = ['role', 'company', 'industry', 'location', 'stage', 'check_size', 'education', 'skill', 'context', 'custom', 'name', 'email', 'url'];
const fieldName = (value: string) => ({check_size: 'Check size', url: 'URL'}[value] ?? value.charAt(0).toUpperCase() + value.slice(1));
const goalLabel = (id: string | null, goals: readonly Goal[]) => id ? `Goal: ${goals.find(goal => goal.id === id)?.title ?? 'Unavailable goal'}` : 'All goals';

/** A changed account or person gets a new editor; pending reads/writes cannot retarget its state. */
export default function PersonEvidencePanel(props: PersonEvidencePanelProps) {
  return <PersonEvidenceEditor key={JSON.stringify([props.uid, props.person.id])} {...props}/>;
}
function PersonEvidenceEditor({uid, person, goals, activeGoal, selfEvidence, call, onRemaining, onRecorded, contextStore = defaultContextStore}: PersonEvidencePanelProps) {
  const [observations, setObservations] = useState<Observation[]>([]), [error, setError] = useState(''), [saving, setSaving] = useState(false), [editing, setEditing] = useState(false);
  const [savedDrafts,setSavedDrafts]=useState<MessageDraft[]>([]);
  const [field, setField] = useState<CandidateObservationInput['field']>('role'), [body, setBody] = useState('');
  const [scope, setScope] = useState<'contact' | 'opportunity'>('contact'), [observationGoal, setObservationGoal] = useState<string | null>(null);
  const [polarity, setPolarity] = useState<'positive' | 'negative'>('positive');
  const [sourceKind, setSourceKind] = useState<CandidateObservationInput['sourceKind']>('manual'), [sourceRef, setSourceRef] = useState(''), [sourceLabel, setSourceLabel] = useState('');
  const [supersedesId, setSupersedesId] = useState<string | undefined>(), [retryLocked, setRetryLocked] = useState(false);
  const requestId = useRef(crypto.randomUUID()), attempt = useRef<CandidateObservationInput | null>(null), lock = useRef(false), mounted = useRef(false), loadGeneration = useRef(0);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false; loadGeneration.current++;};}, []);
  async function reload() {
    const generation = ++loadGeneration.current;
    try {
      const result = await contextStore.read(uid, person.id);
      if (mounted.current && loadGeneration.current === generation) {
        // Observations are append-only; a refresh must retain a just-committed item.
        setObservations(previous=>[...previous,...result.observations.filter(item=>item.relationshipId===person.id&&!previous.some(known=>known.id===item.id))]);
        setSavedDrafts(previous=>{const merged=new Map(previous.map(item=>[item.requestId,item]));for(const item of result.drafts){if(item.relationshipId!==person.id)continue;const known=merged.get(item.requestId);if(!known||item.revision>known.revision)merged.set(item.requestId,item);}return [...merged.values()];});
      }
    } catch (cause) {if (mounted.current && loadGeneration.current === generation) setError(cause instanceof Error ? cause.message : 'The saved context could not be read.');}
  }
  useEffect(() => {void reload(); return () => {loadGeneration.current++;};}, [contextStore, uid, person.id]);
  const currentObservations = useMemo(() => {
    const replaced = new Set(observations.map(item => item.supersedesId).filter(Boolean));
    return observations.filter(item => !replaced.has(item.id));
  }, [observations]);
  const baseCandidate = useMemo(() => buildSavedPersonEvidence(person), [person]);
  const candidateForGoal = (goalId: string | null) => ({...baseCandidate, claims: [...baseCandidate.claims, ...observationsToClaims(observations, person.id, goalId)]});
  const candidate = useMemo(() => candidateForGoal(activeGoal?.id ?? null), [baseCandidate, observations, person.id, activeGoal?.id]);
  const assessments = useMemo(() => goals.filter(goal => goal.status === 'active').map(goal => {
    const evidence = candidateForGoal(goal.id);
    return {goal, evidence, result: assessCandidate(goal, evidence, selfEvidence)};
  }), [goals, baseCandidate, selfEvidence, observations, person.id]);
  function begin(observation?: Observation) {
    if (lock.current || editing) return;
    requestId.current = crypto.randomUUID(); attempt.current = null; setRetryLocked(false);
    setSupersedesId(observation?.id); setField(observation?.field ?? 'role'); setBody(observation?.text ?? '');
    setScope(observation?.appliesTo ?? 'contact'); setObservationGoal(observation ? observation.goalId : activeGoal?.id ?? null);
    setPolarity(observation?.polarity ?? 'positive'); setSourceKind(observation?.sourceKind ?? 'manual'); setSourceRef(observation?.sourceRef ?? ''); setSourceLabel(observation?.sourceLabel ?? ''); setError(''); setEditing(true);
  }
  async function save() {
    if (lock.current) return;
    lock.current = true; setSaving(true); setError('');
    try {
      // A failed/uncertain write retries the same payload and original goal, even if the active goal changes.
      const input = attempt.current ?? normalizeCandidateObservation({requestId: requestId.current, relationshipId: person.id, goalId: observationGoal,
        field, text: body, sourceKind, sourceLabel: sourceLabel.trim() || (sourceKind === 'manual' ? 'Confirmed by you' : sourceKind === 'authorized_export' ? 'Your authorized export' : 'Public source you supplied'),
        sourceRef: sourceRef.trim() || undefined, appliesTo: scope, polarity, confirmed: true, supersedesId});
      attempt.current = structuredClone(input);
      const observation = await contextStore.save(uid, structuredClone(input));
      if (!mounted.current) return;
      if (observation.relationshipId !== person.id || observation.goalId !== input.goalId) throw Error('The saved fact returned a different context. Reload it before trying again.');
      // Invalidate an older in-flight read so it cannot erase the just-committed observation.
      loadGeneration.current++; setObservations(previous => previous.some(item => item.id === observation.id) ? previous : [...previous, observation]);
      setEditing(false); setBody(''); setRetryLocked(false); attempt.current = null; requestId.current = crypto.randomUUID();
      void reload();
    } catch (cause) {
      if (mounted.current) {setRetryLocked(Boolean(attempt.current)); setError(cause instanceof Error ? cause.message : 'The fact was not saved.');}
    } finally {lock.current = false; if (mounted.current) setSaving(false);}
  }
  function cancel() {
    if (lock.current) return;
    const shouldReload = Boolean(attempt.current); attempt.current = null; setRetryLocked(false); setEditing(false); setError('');
    if (shouldReload) void reload();
  }
  return <div className="person-intelligence">
    <section className="panel content-panel"><div className="section-heading"><div><p className="eyebrow">Potential by goal</p><h2>A different reason for each conversation</h2></div></div>
      {!assessments.length ? <p>Add a goal in Me to explore their relevance.</p> : <div className="person-goal-assessments">{assessments.map(({goal, evidence, result}) => <article key={goal.id} className={goal.id === activeGoal?.id ? 'is-current' : ''}><h3>{goal.title}</h3><span className="pill neutral">{result.label}</span><p>{result.reasons[0] || 'The available records don’t establish a relevant route yet.'}</p><details><summary>Evidence and unknowns</summary>{result.criteria.map(criterion => <div key={criterion.criterionId}><p><strong>{criterion.status === 'supported' ? 'Supported' : criterion.status === 'unknown' ? 'Unknown' : criterion.status === 'contradicted' ? 'Contradicted' : 'Conflicting'} · </strong>{criterion.reason}</p>{criterion.claimIds.map(id => {const claim = evidence.claims.find(item => item.id === id); return claim ? <blockquote key={id}>{claim.text}<cite>{claim.sourceLabel}</cite></blockquote> : null;})}</div>)}{result.reasonDetails.filter(detail => !result.criteria.some(criterion => criterion.reason === detail.text)).map((detail, index) => <div key={index}><p>{detail.text}</p>{detail.claimIds.map(id => {
        const claim = [...evidence.claims, ...selfEvidence].find(item => item.id === id);
        return claim ? <blockquote key={id}>{claim.text}<cite>{claim.sourceLabel}</cite></blockquote> : null;
      })}</div>)}{result.unknowns.map(unknown => <p className="muted small" key={unknown}>{unknown}</p>)}</details></article>)}</div>}
    </section>
    <section className="panel content-panel"><div className="section-heading"><div><p className="eyebrow">Person context</p><h2>What you know</h2></div><button type="button" className="button secondary" onClick={() => begin()} disabled={saving || editing}>Add a fact</button></div><p className="muted small">Use a detail you know, an authorized export, or a source you can cite. Corrections preserve the original record.</p>
      {currentObservations.map(observation => <article className="confirmed-fact" key={observation.id}><div><span className="eyebrow muted">{observation.appliesTo === 'opportunity' ? 'Opportunity' : 'Person'} · {fieldName(observation.field)}</span><p>{observation.text}</p><small>{goalLabel(observation.goalId, goals)}{observation.polarity === 'negative' ? ' · Explicitly ruled out' : ''}<br/>{observation.sourceLabel}</small></div><button type="button" className="text-button" onClick={() => begin(observation)} disabled={saving || editing}>Correct</button></article>)}
      {!currentObservations.length && <p>No additional facts recorded yet.</p>}
      {editing && <form className="fact-editor" onSubmit={event => {event.preventDefault(); void save();}}>
        <fieldset disabled={saving || retryLocked}><legend>{supersedesId ? 'Correct this fact' : 'Add a confirmed fact'}</legend>
          <label>Use for<select value={observationGoal ?? ''} onChange={event => setObservationGoal(event.target.value || null)} disabled={Boolean(supersedesId)}><option value="">All goals</option>{goals.map(goal => <option key={goal.id} value={goal.id}>{goal.title}{goal.status !== 'active' ? ` (${goal.status})` : ''}</option>)}{observationGoal && !goals.some(goal => goal.id === observationGoal) && <option value={observationGoal}>Original goal (unavailable)</option>}</select></label>
          {supersedesId && <p className="small muted">This correction stays with the original goal.</p>}
          <div className="form-columns"><label>What kind of fact?<select value={field} onChange={event => setField(event.target.value as CandidateObservationInput['field'])}>{fields.map(value => <option value={value} key={value}>{fieldName(value)}</option>)}</select></label><label>This fact describes<select value={scope} onChange={event => setScope(event.target.value as typeof scope)}><option value="contact">The person</option><option value="opportunity">A specific opportunity</option></select></label></div>
          <label>The fact<textarea value={body} onChange={event => setBody(event.target.value)} maxLength={8000} rows={3} required/></label>
          <label>How should this evidence be read?<select value={polarity} onChange={event => setPolarity(event.target.value as typeof polarity)}><option value="positive">Affirms this detail</option><option value="negative">Explicitly rules this detail out</option></select></label>
          <div className="form-columns"><label>How do you know?<select value={sourceKind} onChange={event => setSourceKind(event.target.value as typeof sourceKind)}><option value="manual">I can confirm this</option><option value="authorized_export">An authorized export</option><option value="public_source">A public source</option></select></label><label>Source name<input value={sourceLabel} onChange={event => setSourceLabel(event.target.value)} maxLength={200} placeholder="Optional, e.g. our conversation"/></label></div>
          <label>Source link<input value={sourceRef} onChange={event => setSourceRef(event.target.value)} maxLength={2000} required={sourceKind === 'public_source'} placeholder={sourceKind === 'public_source' ? 'https://…' : 'Optional'}/></label>
        </fieldset>
        {retryLocked && <p className="small muted" role="status">Retry saves the same fact and original goal. Cancel to reload the saved facts before making a different change.</p>}
        <div className="row-actions"><button className="button primary" disabled={saving}>{saving ? 'Saving…' : retryLocked ? 'Retry save' : supersedesId ? 'Save correction' : 'Confirm fact'}</button><button type="button" className="button secondary" onClick={cancel} disabled={saving}>Cancel</button></div>
      </form>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
    <ConversationPanel key={`${uid ?? 'device'}:${person.id}:${activeGoal?.id ?? 'no-goal'}`} uid={uid} person={person} goal={activeGoal} candidate={candidate} selfEvidence={selfEvidence} call={call} onRemaining={onRemaining} onRecorded={onRecorded} savedDrafts={savedDrafts} onDraftSaved={draft=>{if(!mounted.current||draft.relationshipId!==person.id)return;loadGeneration.current++;setSavedDrafts(previous=>[draft,...previous.filter(item=>item.requestId!==draft.requestId)]);void reload();}}/>
  </div>;
}
