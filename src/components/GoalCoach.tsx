import {useEffect, useId, useRef, useState} from 'react';
import type {GoalCoachContext, GoalCoachMessage, GoalCoachReply} from '../lib/goal-coach';
import type {GoalCriterion} from '../lib/goals';
import './GoalCoach.css';

export type GoalCoachCall = (context: GoalCoachContext, messages: readonly GoalCoachMessage[]) => Promise<GoalCoachReply>;
export type GoalCoachProps = {
  context: GoalCoachContext;
  storageScope?: string;
  coach?: GoalCoachCall;
  disabled?: boolean;
  onInteract?: () => void;
  onApply: (proposal: GoalCoachContext, expectedContext: GoalCoachContext) => boolean;
};
type Chat = {messages: GoalCoachMessage[]; input: string};
const MAX_ANSWER = 2000;
const MAX_MESSAGES = 20;
const MAX_BYTES = 65_536;
const readable = (text: unknown, max: number): text is string => typeof text === 'string' && text.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text);
const keyFor = (scope?: string) => scope && scope.length <= 500 ? `mighty:goal-coach:v1:${encodeURIComponent(scope)}` : null;
export const goalCoachContextKey = (context: GoalCoachContext) => JSON.stringify(context);
const sameCriterion = (first: GoalCriterion, second: GoalCriterion) => first.field === second.field && first.label === second.label && first.importance === second.importance && first.appliesTo === second.appliesTo && JSON.stringify(first.terms) === JSON.stringify(second.terms);
const criterionScope = (criterion: GoalCriterion) => `${criterion.importance === 'required' ? 'Required' : 'Preferred'} · ${criterion.appliesTo === 'opportunity' ? 'Opportunity' : 'Person who could help'}`;
function restore(scope?: string): {chat: Chat; notice: string} {
  const empty = {chat: {messages: [], input: ''}, notice: ''};
  const key = keyFor(scope);
  if (!key) return empty;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return empty;
    if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) throw Error();
    const saved = JSON.parse(raw);
    if (saved?.version !== 1 || !readable(saved.input, MAX_ANSWER) || !Array.isArray(saved.messages) || saved.messages.length > MAX_MESSAGES || saved.messages.length % 2) throw Error();
    const messages = saved.messages.map((message: GoalCoachMessage, index: number) => {
      if (!message || message.role !== (index % 2 ? 'assistant' : 'user') || !readable(message.text, MAX_ANSWER) || !message.text.trim()) throw Error();
      return {role: message.role, text: message.text};
    });
    return {chat: {messages, input: saved.input}, notice: 'Your conversation is restored for this goal. Send to continue.'};
  } catch {return {...empty, notice: 'This conversation could not be restored. Your goal details are still available.'};}
}

/** Account and goal changes remount this component; callback identity changes do not. */
export default function GoalCoach(props: GoalCoachProps) {
  return <GoalConversation key={props.storageScope ?? 'memory'} {...props}/>;
}
function GoalConversation({context, storageScope, coach, disabled = false, onApply, onInteract}: GoalCoachProps) {
  const id = useId();
  const [initial] = useState(() => restore(storageScope));
  const [chat, setChat] = useState(initial.chat);
  const [notice, setNotice] = useState(initial.notice);
  const [storageNotice, setStorageNotice] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<{proposal: GoalCoachContext; context: GoalCoachContext; key: string} | null>(null);
  const [restartReview, setRestartReview] = useState(false);
  const mounted = useRef(true);
  const history = useRef<HTMLDivElement>(null);
  const pending = useRef(false);
  const chatRef = useRef(chat);
  const live = useRef({context, key: goalCoachContextKey(context), coach, disabled, onApply});
  live.current = {context, key: goalCoachContextKey(context), coach, disabled, onApply};
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  useEffect(() => {if (history.current) history.current.scrollTop = history.current.scrollHeight;}, [chat.messages.length]);

  function keep(next: Chat) {
    chatRef.current = next; setChat(next);
    const key = keyFor(storageScope);
    if (!key) return;
    try {
      if (!next.messages.length && !next.input) window.localStorage.removeItem(key);
      else {
        const value = JSON.stringify({version: 1, ...next});
        if (new TextEncoder().encode(value).byteLength > MAX_BYTES) throw Error();
        window.localStorage.setItem(key, value);
      }
      setStorageNotice('');
    } catch {setStorageNotice('This browser could not keep your latest answer. Keep this page open or copy it before leaving.');}
  }
  const full = chat.messages.length + 2 > MAX_MESSAGES;
  const stalePreview = Boolean(preview && preview.key !== live.current.key);
  const removed = preview?.context.criteria.filter(criterion => !preview.proposal.criteria.some(next => next.id === criterion.id)) ?? [];
  const controlsDisabled = disabled || working;

  async function send() {
    const current = live.current;
    const currentChat = chatRef.current;
    if (!current.coach || current.disabled || pending.current || currentChat.messages.length + 2 > MAX_MESSAGES) return;
    const answer = currentChat.input.trim();
    if (!answer) {setError('Add your answer before sending.'); return;}
    if (!readable(answer, MAX_ANSWER)) {setError('Keep this answer to 2,000 readable characters.'); return;}
    const user: GoalCoachMessage = {role: 'user', text: answer};
    const messages = [...currentChat.messages, user];
    pending.current = true; setWorking(true); setError(''); setNotice(''); setPreview(null); setRestartReview(false);
    // Keep the typed answer until a current response succeeds, including on navigation or failure.
    try {
      const reply = await current.coach(current.context, messages);
      if (!mounted.current) return;
      if (current.key !== live.current.key) {
        setNotice('Your goal details changed while the reply was loading. Your answer is kept. Send again to use the updated details.');
        return;
      }
      keep({messages: [...messages, {role: 'assistant', text: reply.message}], input: ''});
      if (reply.proposal) setPreview({proposal: reply.proposal, context: current.context, key: current.key});
    } catch (failure) {
      if (mounted.current) {
        if (current.key !== live.current.key) setNotice('Your goal details changed while the reply was loading. Your answer is kept. Send again to use the updated details.');
        else setError(failure instanceof Error ? failure.message : 'The AI conversation could not continue. Your answer is kept. Try again.');
      }
    } finally {
      pending.current = false;
      if (mounted.current) setWorking(false);
    }
  }

  function apply() {
    if (!preview || pending.current || live.current.disabled || preview.key !== live.current.key) return;
    if (!live.current.onApply(preview.proposal, preview.context)) {
      setNotice('Your goal details changed. Review them and ask for an updated proposal.');
      return;
    }
    setPreview(null); setNotice('Details added to the form. Review them, then Save goal.');
  }

  return <section className="panel goal-coach" aria-labelledby={`${id}-title`}>
    <div className="goal-coach-heading"><div><p className="goal-coach-eyebrow">AI goal conversation</p><h3 id={`${id}-title`}>Talk through this goal</h3></div><span className="goal-coach-scope">{context.title.trim() || 'New goal'}</span></div>
    <p className="goal-coach-intro">Tell Mighty what you want to achieve. Review the details before saving.</p>
    {!coach && <p className="goal-coach-account" role="status">Sign in to send an answer to the AI. You can keep writing here or fill in the goal form yourself.</p>}
    <div ref={history} className="goal-coach-history" role="log" aria-label="Goal conversation" aria-live="polite" aria-relevant="additions" tabIndex={0}>
      {!chat.messages.length && <div className="goal-coach-message is-assistant"><span>Mighty</span><p>{context.outcome.trim() ? 'What would you like to clarify about this goal?' : 'What are you trying to achieve?'}</p></div>}
      {chat.messages.map((message, index) => <div key={index} className={`goal-coach-message is-${message.role}`}><span>{message.role === 'user' ? 'You' : 'Mighty'}</span><p>{message.text}</p></div>)}
    </div>
    {working && <p className="goal-coach-notice" role="status">Thinking about your goal…</p>}
    <label className="goal-coach-answer">Your answer<textarea id={`${id}-answer`} rows={3} maxLength={MAX_ANSWER} value={chat.input} disabled={controlsDisabled} placeholder="Start with what you want to achieve." onChange={event => {
      if (pending.current || live.current.disabled) return;
      onInteract?.();
      keep({...chatRef.current, input: event.target.value}); setError('');
    }}/></label>
    <div className="goal-coach-actions"><button type="button" className="button primary" disabled={controlsDisabled || !coach || full || !chat.input.trim()} onClick={() => void send()}>{working ? 'Waiting for reply…' : 'Send answer'}</button><span>{chat.input.length.toLocaleString()} / 2,000</span></div>
    <p className="goal-coach-footnote">Your answers go to Mighty’s AI. Use these details fills the form; Save goal updates matching and your connected extension.</p>
    {full && <p className="goal-coach-notice">This conversation has reached its limit. Apply any details you want to keep, then start a new conversation for this goal.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="goal-coach-notice" role="status">{notice}</p>}
    {storageNotice && <p className="goal-coach-notice" role="status">{storageNotice}</p>}
    {preview && <section className="goal-coach-preview" aria-labelledby={`${id}-preview`}>
      <p className="goal-coach-eyebrow">Suggested details</p><h4 id={`${id}-preview`}>Review before filling the form</h4>
      <p className="goal-coach-footnote">This will replace the goal details below.</p>
      {removed.length > 0 && <div className="goal-coach-removals"><strong>Conditions this would remove</strong><ul>{removed.map(criterion => <li key={criterion.id}><strong>{criterion.label}: </strong>{criterion.terms.join(' · ') || 'Unanswered'}<span>{criterionScope(criterion)}</span></li>)}</ul></div>}
      <dl><dt>Goal type</dt><dd>{preview.proposal.kind}</dd><dt>Name</dt><dd>{preview.proposal.title}</dd><dt>Outcome</dt><dd>{preview.proposal.outcome}</dd></dl>
      <h5>Conditions</h5>
      {preview.proposal.criteria.length ? <ul className="goal-coach-conditions">{preview.proposal.criteria.map(criterion => {
        const previous = preview.context.criteria.find(item => item.id === criterion.id);
        return <li key={criterion.id}><strong>{criterion.label}</strong><p>{criterion.terms.join(' · ') || 'Unanswered'}</p><span>{criterionScope(criterion)}{criterion.origin === 'suggested' ? ' · Suggested' : ''}</span>{previous && !sameCriterion(previous, criterion) && <p className="goal-coach-before">Previously: {previous.label}, {previous.terms.join(' · ') || 'Unanswered'}<span>{criterionScope(previous)}</span></p>}</li>;
      })}</ul> : <p>No conditions specified yet. Missing facts will remain unknown.</p>}
      <h5>Open questions</h5>{preview.proposal.openQuestions.length ? <ul>{preview.proposal.openQuestions.map((question, index) => <li key={index}>{question}</li>)}</ul> : <p>No open questions proposed.</p>}
      {stalePreview && <p className="goal-coach-notice" role="status">Your goal details have changed. Send another answer to review a proposal for the current draft.</p>}
      <button type="button" className="button secondary" disabled={controlsDisabled || stalePreview} onClick={apply}>Use these details</button>
    </section>}
    {(chat.messages.length > 0 || chat.input) && <div className="goal-coach-restart">{restartReview ? <><p>Clear this conversation and typed answer? Your goal form and saved goals stay as they are.</p><button type="button" className="text-button" disabled={controlsDisabled} onClick={() => {
      if (pending.current || live.current.disabled) return;
      keep({messages: [], input: ''}); setPreview(null); setRestartReview(false); setError(''); setNotice('');
    }}>Clear conversation</button><button type="button" className="text-button" disabled={controlsDisabled} onClick={() => setRestartReview(false)}>Keep conversation</button></> : <button type="button" className="text-button" disabled={controlsDisabled} onClick={() => {if (!pending.current && !live.current.disabled) setRestartReview(true);}}>Start a new conversation</button>}</div>}
  </section>;
}
