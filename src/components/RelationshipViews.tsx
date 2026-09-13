import {useEffect, useMemo, useRef, useState} from 'react';
import type {Goal} from '../lib/goals';
import {completedCommitmentIds, goalEventLabel, isCommitment, isCompletion} from '../lib/relationship-events';
import {ArrowRight, Check, ChevronRight, Clock3, Plus, Search} from 'lucide-react';
import type {Capture, Person} from '../lib/workspace';
import {Avatar, EmptyState, formatDate, StagePill, stageLabels, Tabs} from './DesignPrimitives';

export const relationshipViews = ['List', 'Board', 'Timeline'] as const;
export type RelationshipView = typeof relationshipViews[number];
const stages = Object.keys(stageLabels);
const eventLabels: Record<string, string> = {note: 'Note captured', contacted: 'Reached out', replied: 'Reply recorded', coffee_chat: 'Conversation captured', promise_made: 'Promise made', promise_kept: 'Promise kept', next_step: 'Next step recorded', next_step_completed: 'Next step completed', saved: 'Person saved'};
export function personHeadline(person: Person) {
  return [person.context.position, person.context.company].filter(value => typeof value === 'string' && value).join(' · ') || (typeof person.context.searchHeadline === 'string' ? person.context.searchHeadline : '');
}

type Props = {
  people: Person[]; events: Capture[]; strategy: string; view: RelationshipView; busy: boolean;
  onView: (view: RelationshipView) => void; onOpen: (person: Person) => void; onAdd: () => void; onExplore: () => void;
  onStage: (personId: string, stage: string) => Promise<void>;
  goals?: readonly Goal[]; onComplete?: (event: Capture) => Promise<unknown>;
};

export default function RelationshipViews({people, events, strategy, view, busy, onView, onOpen, onAdd, onExplore, onStage, goals, onComplete}: Props) {
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState('all');
  const shown = useMemo(() => people.filter(person => (stage === 'all' || person.stage === stage) && [person.person, personHeadline(person), String(person.context.saveReason || '')].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase().trim())), [people, query, stage]);
  const shownIds = useMemo(() => new Set(shown.map(person => person.id)), [shown]);
  return <>
    <header className="page-heading with-actions"><div><h1>Relationships</h1></div><div className="heading-actions"><Tabs label="Relationship view" items={relationshipViews} value={view} onChange={onView}/><button className="button secondary" onClick={onAdd}><Plus size={15}/>Save a person</button></div></header>
    <p className="page-meta"><span>{people.length} {people.length === 1 ? 'person' : 'people'} saved</span><span aria-hidden="true">·</span><span>{events.length} {events.length === 1 ? 'update' : 'updates'} recorded</span></p>
    {people.length > 0 && <div className="relationship-tools"><label className="search-field"><Search size={17}/><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find someone you saved" aria-label="Search saved people"/></label><label className="sr-only" htmlFor="relationship-stage-filter">Filter by stage</label><select id="relationship-stage-filter" value={stage} onChange={event => setStage(event.target.value)}><option value="all">All stages</option>{stages.map(value => <option key={value} value={value}>{stageLabels[value]}</option>)}</select></div>}
    {!people.length ? <section className="panel relationship-empty"><EmptyState title="No people saved yet." action={<button className="button primary" onClick={onExplore}>Explore people<ArrowRight size={15}/></button>}>Save someone from Explore or add a person directly.</EmptyState></section> : !shown.length ? <section className="panel"><EmptyState title="No people match these filters." action={<button className="button secondary" onClick={() => {setQuery(''); setStage('all');}}>Clear filters</button>}>Try another name, company, or relationship stage.</EmptyState></section> : view === 'List' ? <section className="panel relationship-list" aria-label="Saved people">
      {shown.map((person, index) => <div className="relationship-row" key={person.id}><button className="person-open" onClick={() => onOpen(person)}><Avatar name={person.person} tone={index}/><span className="person-text"><strong>{person.person}</strong><span>{personHeadline(person) || String(person.context.saveReason || 'Saved by you')}</span></span></button><StagePill stage={person.stage}/><span className="row-date">{formatDate(person.created_at)}</span><button className="icon-button" aria-label={`Open ${person.person}`} onClick={() => onOpen(person)}><ChevronRight size={18}/></button></div>)}
    </section> : view === 'Board' ? <div className="board" aria-label="People by relationship stage">{stages.map(value => {
      const rows = shown.filter(person => person.stage === value);
      return <section className="board-column" key={value}><h2><span className={`board-dot stage-${value}`}/>{stageLabels[value]}<span>{rows.length}</span></h2><div className="board-cards">{rows.length ? rows.map((person, index) => <article className="panel board-card" key={person.id}><button className="person-open" onClick={() => onOpen(person)}><Avatar name={person.person} tone={index}/><span className="person-text"><strong>{person.person}</strong><span>{personHeadline(person) || 'Saved by you'}</span></span></button>{Boolean(person.context.saveReason) && <p className="board-reason">{String(person.context.saveReason)}</p>}<label className="sr-only" htmlFor={`stage-${person.id}`}>Stage for {person.person}</label><select id={`stage-${person.id}`} value={person.stage} disabled={busy} onChange={event => void onStage(person.id, event.target.value)}>{stages.map(option => <option key={option} value={option}>{stageLabels[option]}</option>)}</select></article>) : <p className="board-empty">No people yet.</p>}</div></section>;
    })}</div> : <Timeline people={shown} events={events.filter(event => shownIds.has(event.relationship_id))} onOpen={onOpen} goals={goals} onComplete={onComplete} busy={busy}/>}
  </>;
}

type TimelineProps = {
  people: Person[]; events: Capture[]; goals?: readonly Goal[]; onOpen?: (person: Person) => void;
  onKeep?: (event: Capture) => Promise<unknown>; onComplete?: (event: Capture) => Promise<unknown>; busy?: boolean;
};
export function Timeline(props: TimelineProps) {
  return <TimelineContents key={JSON.stringify(props.people.map(person => person.id).sort())} {...props}/>;
}
function TimelineContents({people, events, goals = [], onOpen, onKeep, onComplete, busy = false}: TimelineProps) {
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set()), [error, setError] = useState('');
  const locks = useRef(new Set<string>()), mounted = useRef(true);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  const byId = new Map(people.map(person => [person.id, person]));
  const visibleEvents = events.filter(event => byId.has(event.relationship_id));
  const rows: Capture[] = [...people.map(person => ({id: `saved-${person.id}`, relationship_id: person.id, kind: 'saved', created_at: person.created_at, body: String(person.context.saveReason || ''), related_event_id: null})), ...visibleEvents].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const kept = completedCommitmentIds(visibleEvents);
  async function finish(row: Capture) {
    const action = onComplete ?? (row.kind === 'promise_made' ? onKeep : undefined);
    if (!action || busy || kept.has(row.id) || locks.current.has(row.id)) return;
    locks.current.add(row.id); setPending(new Set(locks.current)); setError('');
    try {await action(row);}
    catch (cause) {if (mounted.current) setError(cause instanceof Error ? cause.message : 'This reminder could not be completed. Try again.');}
    finally {locks.current.delete(row.id); if (mounted.current) setPending(new Set(locks.current));}
  }
  return <section className="panel timeline-panel" aria-label="Relationship history">{rows.length ? <ol className="timeline-list">{rows.map(row => {
    const person = byId.get(row.relationship_id), attribution = goalEventLabel(row, goals), complete = isCompletion(row);
    const action = onComplete ?? (row.kind === 'promise_made' ? onKeep : undefined);
    return <li key={row.id}><span className={`timeline-symbol ${complete ? 'complete' : ''}`} aria-hidden="true">{complete ? <Check size={15}/> : <Clock3 size={15}/>}</span><div className="timeline-content"><div className="timeline-top"><strong>{eventLabels[row.kind] || row.kind.replaceAll('_', ' ')}</strong><time dateTime={row.created_at}>{formatDate(row.created_at)}</time></div>{person && onOpen && <button className="text-button" onClick={() => onOpen(person)}>{person.person}</button>}{attribution && <p className="small muted timeline-goal">{attribution}</p>}{row.body && <p>{row.body}</p>}{row.due_at && isCommitment(row) && <p className="small muted">Due <time dateTime={row.due_at}>{formatDate(row.due_at)}</time></p>}{action && isCommitment(row) && !kept.has(row.id) && <button type="button" className="button secondary small" disabled={busy || pending.has(row.id)} onClick={() => void finish(row)}><Check size={14}/>{pending.has(row.id) ? 'Saving…' : row.kind === 'next_step' ? 'Mark next step complete' : 'Mark promise kept'}</button>}</div></li>;
  })}</ol> : <EmptyState title="No activity yet.">Notes, conversations, promises and next steps appear here.</EmptyState>}{error && <p className="form-error" role="alert">{error}</p>}</section>;
}
