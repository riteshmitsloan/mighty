import {Search} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  askMighty,
  classifyAsk,
  ownNetwork,
  webPeople,
  type Connection,
  type WebPerson,
} from '../lib/discover';
import type { GatewayCall } from '../lib/platform';
import './DiscoverPanel.css';
import GoalShortlist from './GoalShortlist';
import type {Goal} from '../lib/goals';
import type {EvidenceClaim} from '../lib/evidence';

export type DiscoverPanelProps = {
  focusRequest?: number;
  mode?: 'explore' | 'ask';
  goal?: Goal|null;
  selfEvidence?: readonly EvidenceClaim[];
  all: Connection[];
  strategy: string;
  employers: string[];
  savedUrls: Set<string>;
  call: GatewayCall;
  onSave: (person: Connection, reason: string) => Promise<void>;
  onRemaining: (remaining: number) => void;
};

type Busy = 'route' | 'web' | null;
type WebBatch = { query: string; start: number; people: WebPerson[] };
type Answer = { query: string; text: string; matchedCount: number };
class StaleRequest extends Error {}

function profileURL(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !['linkedin.com', 'www.linkedin.com'].includes(url.hostname)) return null;
    const match = url.pathname.match(/^\/in\/([^/]+)\/?$/);
    if (!match) return null;
    const slug = decodeURIComponent(match[1]).normalize('NFC').toLowerCase();
    if (!/^[\p{L}\p{N}_-]{1,200}$/u.test(slug)) return null;
    return 'https://www.linkedin.com/in/' + encodeURIComponent(slug) + '/';
  } catch {
    return null;
  }
}

function connectionKey(person: Connection): string {
  const url = profileURL(person.profile_url);
  return url ? 'url:' + url : person.id ? 'id:' + person.id :
    'record:' + JSON.stringify([person.person, person.company, person.position || person.role, person.connectedOn]);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'This request could not be completed. Please try again.';
}

export default function DiscoverPanel({
  all, strategy, employers, savedUrls, call, onSave, onRemaining, focusRequest = 0, mode = 'explore',goal=null,selfEvidence=[],
}: DiscoverPanelProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {if (focusRequest) inputRef.current?.focus();}, [focusRequest]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [routeMessage, setRouteMessage] = useState('');
  const [requestError, setRequestError] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [web, setWeb] = useState<WebBatch | null>(null);
  const [webPage, setWebPage] = useState(0);
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [savedHere, setSavedHere] = useState<Set<string>>(new Set());
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const [saveNotice, setSaveNotice] = useState('');
  const generation = useRef(0);
  const busyRef = useRef<Busy>(null);
  const savingRef = useRef(new Set<string>());
  const savedRef = useRef(new Set<string>());
  const mounted = useRef(true);
  const onRemainingRef = useRef(onRemaining);
  onRemainingRef.current = onRemaining;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);

  const matches = useMemo(
    () => ownNetwork(query, all, strategy, employers),
    [query, all, strategy, employers],
  );
  const normalizedSavedUrls = useMemo(
    () => new Set([...savedUrls].map(profileURL).filter((url): url is string => Boolean(url))),
    [savedUrls],
  );
  const hasQuery = Boolean(query.trim());
  const goalConnections=useMemo(()=>hasQuery?matches.map(match=>match.person):all,[hasQuery,matches,all]);
  const hasStructuredGoal=Boolean(goal);

  function isSaved(person: Connection): boolean {
    const url = profileURL(person.profile_url);
    return savedRef.current.has(connectionKey(person)) || savedHere.has(connectionKey(person)) ||
      Boolean(person.profile_url && savedUrls.has(person.profile_url)) ||
      Boolean(url && normalizedSavedUrls.has(url));
  }

  function updateQuery(value: string) {
    // The gateway contract has no AbortSignal. Ignore superseded replies and
    // prevent a stale classification/keyword reply from starting another call.
    generation.current += 1;
    busyRef.current = null;
    setBusy(null);
    setQuery(value);
    setAnswer(null);
    setWeb(null);
    setWebPage(0);
    setRouteMessage('');
    setRequestError('');
  }

  function startRequest(kind: Exclude<Busy, null>): number | null {
    if (!query.trim() || busyRef.current) return null;
    const current = ++generation.current;
    busyRef.current = kind;
    setBusy(kind);
    setRequestError('');
    return current;
  }

  function isCurrent(current: number): boolean {
    return mounted.current && generation.current === current;
  }

  function guardedCall(current: number): GatewayCall {
    return async request => {
      if (!isCurrent(current)) throw new StaleRequest();
      const result = await call(request);
      if (!isCurrent(current)) throw new StaleRequest();
      onRemainingRef.current(result.remaining);
      return result;
    };
  }

  function finishRequest(current: number) {
    if (isCurrent(current)) {
      busyRef.current = null;
      setBusy(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = startRequest('route');
    if (current === null) return;
    const submittedQuery = query.trim();
    setAnswer(null);
    setRouteMessage('');
    try {
      const meteredCall = guardedCall(current);
      const route = await classifyAsk(submittedQuery, meteredCall);
      if (!isCurrent(current)) return;
      if (route === 'ask') {
        const result = await askMighty(submittedQuery, all, strategy, employers, meteredCall);
        if (isCurrent(current)) setAnswer({ query: submittedQuery, ...result });
      } else if (route === 'rooms') {
        setRouteMessage('Event search is not available yet. Try a role, company, or relationship question.');
      } else {
        setRouteMessage('');
      }
    } catch (error) {
      if (!(error instanceof StaleRequest) && isCurrent(current)) setRequestError(messageOf(error));
    } finally {
      finishRequest(current);
    }
  }

  async function searchWeb(start = 1) {
    if (start < 1 || start > 91 || (start - 1) % 10 !== 0) return;
    const current = startRequest('web');
    if (current === null) return;
    const submittedQuery = query.trim();
    try {
      const people = await webPeople(submittedQuery, guardedCall(current), start);
      if (!isCurrent(current)) return;
      const seen = new Set<string>();
      // Invalid profile URLs cannot become saved relationships. Duplicate links
      // from one search batch are presented once.
      const valid = people.slice(0, 10).flatMap(person => {
        const url = profileURL(person.url);
        if (!url || seen.has(url)) return [];
        seen.add(url);
        return [{ ...person, url }];
      });
      setWeb({ query: submittedQuery, start, people: valid });
      setWebPage(0);
    } catch (error) {
      if (!(error instanceof StaleRequest) && isCurrent(current)) setRequestError(messageOf(error));
    } finally {
      finishRequest(current);
    }
  }

  async function save(person: Connection, reason: string) {
    const key = connectionKey(person);
    if (isSaved(person) || savingRef.current.has(key)) return;
    savingRef.current.add(key);
    setSaving(new Set(savingRef.current));
    setSaveErrors(previous => {
      const next = { ...previous };
      delete next[key];
      return next;
    });
    setSaveNotice('');
    try {
      await onSave(person, reason);
      if (mounted.current) {
        savedRef.current.add(key);
        setSavedHere(previous => new Set(previous).add(key));
        setSaveNotice('Saved ' + person.person + '.');
      }
    } catch (error) {
      if (mounted.current) setSaveErrors(previous => ({ ...previous, [key]: messageOf(error) }));
    } finally {
      savingRef.current.delete(key);
      if (mounted.current) setSaving(new Set(savingRef.current));
    }
  }

  function saveAction(person: Connection, reason: string, valid = true) {
    const key = connectionKey(person);
    const saved = isSaved(person);
    const inFlight = saving.has(key);
    return <div className="discover-save">
      <button
        type="button"
        className="button secondary"
        disabled={!valid || saved || inFlight}
        onClick={() => void save(person, reason)}
        aria-label={saved ? person.person + ' is already saved' : 'Save ' + person.person}
      >
        {saved ? 'Saved' : inFlight ? 'Saving…' : 'Save'}
      </button>
      {saveErrors[key] && <p className="discover-error" role="alert">{saveErrors[key]}</p>}
    </div>;
  }

  const visibleWeb = web?.people.slice(webPage * 5, webPage * 5 + 5) || [];
  const nextPageCount = web ? Math.min(5, Math.max(0, web.people.length - (webPage + 1) * 5)) : 0;

  return <section className={`discover-panel ${web ? 'has-web' : ''}`} aria-label={mode === 'ask' ? 'Ask Mighty' : 'Find people'}>
    <div className="panel discover-search">
      <form onSubmit={event => void submit(event)} aria-busy={busy === 'route'}>
        <label className="sr-only" htmlFor={id + '-query'}>A role, company, or professional question</label>
        <div className="discover-input-row"><Search size={18} aria-hidden="true"/>
          <input
            ref={inputRef}
            id={id + '-query'}
            type="search"
            value={query}
            onChange={event => updateQuery(event.target.value)}
            placeholder={mode === 'ask' ? 'Ask about your professional relationships' : 'Describe who you are looking for'}
            aria-describedby={id + '-help'}
            maxLength={2000}
            autoComplete="off"
            required
          />
          <button type="submit" className="button primary" disabled={!hasQuery || busy !== null}>
            {busy === 'route' ? 'Working…' : mode === 'ask' ? 'Ask' : 'Search'}
          </button>
        </div>
        <p id={id + '-help'} className="discover-muted discover-small">Searches your imported connections as you type.</p>
      </form>
      <div className="discover-web-action">
        <div>
          <strong>Beyond your network</strong>
          <p className="discover-muted discover-small">Web search has a daily limit.</p>
        </div>
        <button type="button" className="button secondary" onClick={() => void searchWeb(1)} disabled={!hasQuery || busy !== null}>
          {busy === 'web' ? 'Searching…' : 'Search the web'}
        </button>
      </div>
      {routeMessage && <p className="discover-info" role="status">{routeMessage}</p>}
      {requestError && <p className="discover-error" role="alert">{requestError}</p>}
      {busy && <p className="discover-muted discover-small" role="status">{busy === 'web' ? 'Looking for public search results…' : 'Working through your request…'}</p>}
    </div>

    {answer && <section className="panel discover-answer" aria-labelledby={id + '-answer'}>
      <h2 id={id + '-answer'}>Mighty</h2>
      <div className="discover-answer-text">{answer.text}</div>
    </section>}

    {hasStructuredGoal&&goal?<GoalShortlist key={goal.id} goal={goal} all={goalConnections} selfEvidence={selfEvidence} savedUrls={savedUrls} onSave={onSave} query={query}/>:<section className="panel discover-results" aria-labelledby={id + '-local'}>
      <div className="discover-section-heading">
        <div><h2 id={id + '-local'}>Your network</h2></div>
        {hasQuery && <span className="pill">{matches.length} {matches.length === 1 ? 'match' : 'matches'}</span>}
      </div>
      {!hasQuery ? <p className="discover-empty">Search by company or role.</p> :
        !all.length ? <p className="discover-empty">Import your LinkedIn archive in Me to search your network.</p> :
          !matches.length ? <p className="discover-empty">No company or role matches. Try different words.</p> :
            <ul className="discover-list">
              {matches.slice(0,100).map(match => {
                const person = match.person;
                const url = profileURL(person.profile_url);
                const headline = [person.position || person.role, person.company].filter(Boolean).join(' · ');
                return <li key={connectionKey(person)} className="discover-person">
                  <div className="discover-person-main">
                    <h3>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{person.person}</a> : person.person}</h3>
                    {headline && <p className="discover-muted">{headline}</p>}
                    <p className="discover-reason">{match.reason}</p>

                  </div>
                  {saveAction(person, match.reason)}
                </li>;
              })}
            </ul>}
      {matches.length>100 && <p className="discover-muted">Showing the first 100 matches. Refine your words to narrow the full pool.</p>}
    </section>}

    {web && <section className="panel discover-results" aria-labelledby={id + '-web'} aria-busy={busy === 'web'}>
      <div className="discover-section-heading">
        <div><h2 id={id + '-web'}>Public search results</h2><p className="discover-muted discover-small">Read a profile with the extension to see its fit.</p></div>
        <span className="pill neutral">No score yet</span>
      </div>
      {!web.people.length ? <p className="discover-empty">No LinkedIn profiles found. Try different words.</p> :
        <>
          <ul className="discover-list">
            {visibleWeb.map(person => {
              const connection: Connection = {
                person: person.name,
                profile_url: person.url,
                context: { source: 'web_search', searchHeadline: person.headline, searchSnippet: person.snippet, profile_read_at: null },
              };
              const reason = 'Saved from your web search for “' + web.query + '”. Profile not yet read.';
              return <li key={person.url} className="discover-person discover-web-person">
                <div className="discover-person-main">
                  <h3><a href={person.url} target="_blank" rel="noopener noreferrer">{person.name.trim() || 'Name unavailable in this search result'}</a></h3>
                  {person.headline && <p className="discover-muted">{person.headline}</p>}
                  {person.snippet ? <p className="discover-snippet">{person.snippet}</p> : <p className="discover-muted">No snippet was returned.</p>}
                  <details className="discover-brief-help">
                    <summary>Why no brief yet?</summary>
                    <p>Briefs need a complete profile read. Open the LinkedIn profile with the extension, then save it.</p>
                  </details>
                </div>
                {saveAction(connection, reason, Boolean(person.name.trim()))}
              </li>;
            })}
          </ul>
          <div className="discover-pagination">
            <p className="discover-muted discover-small">Showing {webPage * 5 + 1} to {webPage * 5 + visibleWeb.length} of {web.people.length}.</p>
            <div>
              {webPage > 0 && <button type="button" className="button secondary" onClick={() => setWebPage(page => page - 1)}>Previous 5</button>}
              {nextPageCount > 0 && <button type="button" className="button secondary" onClick={() => setWebPage(page => page + 1)}>Show next {nextPageCount}</button>}
            </div>
          </div>
          <div className="discover-more">
            {nextPageCount > 0 ? <p className="discover-muted discover-small">Next results are free.</p> : web.start < 91 ? <>
              <button type="button" className="button secondary" onClick={() => void searchWeb(web.start + 10)} disabled={busy !== null}>Search for more</button>
              <p className="discover-muted discover-small">Uses another web search.</p>
            </> : <p className="discover-muted discover-small">Last batch reached. Try a more specific search.</p>}
          </div>
        </>}
    </section>}
    <p className="discover-save-notice" role="status" aria-live="polite">{saveNotice}</p>
  </section>;
}
