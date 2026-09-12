import {useMemo, useState} from 'react';
import {ArrowRight, Check, ChevronRight, Clock3, Plus, Search} from 'lucide-react';
import type {Capture, Person} from '../lib/workspace';
import {Avatar, EmptyState, formatDate, StagePill, stageLabels, Tabs} from './DesignPrimitives';

export const relationshipViews = ['List', 'Board', 'Timeline'] as const;
export type RelationshipView = typeof relationshipViews[number];
const stages = Object.keys(stageLabels);
const eventLabels: Record<string, string> = {note: 'Note captured', contacted: 'Reached out', replied: 'Reply recorded', coffee_chat: 'Conversation captured', promise_made: 'Promise made', promise_kept: 'Promise kept', saved: 'Person saved'};
export function personHeadline(person: Person) {
  return [person.context.position, person.context.company].filter(value => typeof value === 'string' && value).join(' · ') || (typeof person.context.searchHeadline === 'string' ? person.context.searchHeadline : '');
}

type Props = {
  people: Person[]; events: Capture[]; strategy: string; view: RelationshipView; busy: boolean;
  onView: (view: RelationshipView) => void; onOpen: (person: Person) => void; onAdd: () => void; onExplore: () => void;
  onStage: (personId: string, stage: string) => Promise<void>;
};

export default function RelationshipViews({people, events, strategy, view, busy, onView, onOpen, onAdd, onExplore, onStage}: Props) {
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
    })}</div> : <Timeline people={shown} events={events.filter(event => shownIds.has(event.relationship_id))} onOpen={onOpen}/>}
  </>;
}

export function Timeline({people, events, onOpen, onKeep, busy = false}: {people: Person[]; events: Capture[]; onOpen?: (person: Person) => void; onKeep?: (event: Capture) => Promise<void>; busy?: boolean}) {
  const byId = new Map(people.map(person => [person.id, person]));
  const rows = [...people.map(person => ({id: `saved-${person.id}`, relationship_id: person.id, kind: 'saved', created_at: person.created_at, body: String(person.context.saveReason || ''), related_event_id: null})), ...events].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const kept = new Set(events.filter(event => event.kind === 'promise_kept').map(event => event.related_event_id));
  return <section className="panel timeline-panel" aria-label="Relationship history">{rows.length ? <ol className="timeline-list">{rows.map(row => {
    const person = byId.get(row.relationship_id);
    return <li key={row.id}><span className={`timeline-symbol ${row.kind === 'promise_kept' ? 'complete' : ''}`} aria-hidden="true">{row.kind === 'promise_kept' ? <Check size={15}/> : <Clock3 size={15}/>}</span><div className="timeline-content"><div className="timeline-top"><strong>{eventLabels[row.kind] || row.kind.replaceAll('_', ' ')}</strong><time dateTime={row.created_at}>{formatDate(row.created_at)}</time></div>{person && onOpen && <button className="text-button" onClick={() => onOpen(person)}>{person.person}</button>}{row.body && <p>{row.body}</p>}{onKeep && row.kind === 'promise_made' && !kept.has(row.id) && <button className="button secondary small" disabled={busy} onClick={() => void onKeep(row as Capture)}><Check size={14}/>Mark promise kept</button>}</div></li>;
  })}</ol> : <EmptyState title="No activity yet.">Notes, conversations, and promises appear here.</EmptyState>}</section>;
}
