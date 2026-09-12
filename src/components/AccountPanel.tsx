import {useEffect, useId, useRef, useState} from 'react';
import {authErrorMessage, sendOwnerLink, signOutOwner, type OwnerAuthClient} from '../lib/owner-auth';

type Props = {
  client: OwnerAuthClient | null;
  uid: string | null;
  email?: string;
  busy?: boolean;
  ready?: boolean;
};
export default function AccountPanel({client, uid, email: accountEmail, busy = false, ready = true}: Props) {
  const id = useId();
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now);
  const lock = useRef(false);
  const generation = useRef(0);
  const identity = useRef(uid);
  identity.current = uid;
  useEffect(() => {
    generation.current++;
    lock.current = false;
    setPending(false); setEmail(''); setSentTo(''); setError(''); setRetryAt(0);
    return () => {generation.current++;};
  }, [uid]);
  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time >= retryAt) setRetryAt(0);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);
  const seconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const disabled = !client || !ready || busy || pending;

  async function submit(signingOut = false) {
    if (!client || !ready || busy || lock.current || (!signingOut && Date.now() < retryAt)) return;
    lock.current = true;
    const version = generation.current;
    const account = uid;
    const current = () => version === generation.current && identity.current === account;
    setPending(true); setError('');
    try {
      if (signingOut) await signOutOwner(client);
      else {
        const submitted = await sendOwnerLink(client, email, window.location.href);
        if (current()) {
          const time = Date.now();
          setSentTo(submitted); setNow(time); setRetryAt(time + 60_000);
        }
      }
    } catch (failure) {
      if (current()) setError(authErrorMessage(failure));
    } finally {
      if (current()) {lock.current = false; setPending(false);}
    }
  }

  return <section className="panel content-panel account-signin" aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`}>{uid ? 'Your account' : 'Sign in'}</h2>
    {!client ? <p>Account sign-in is unavailable here. Your local files and goal are still available.</p> : !ready ? <p role="status">Checking your account…</p> : uid ? <>
      <p>{accountEmail || 'Account connected'}</p>
      <button type="button" className="button secondary" disabled={disabled} onClick={() => void submit(true)}>{pending ? 'Signing out…' : 'Sign out on this device'}</button>
    </> : <form onSubmit={event => {event.preventDefault(); void submit();}}>
      <p>Use the email linked to your Mighty account.</p>
      <label htmlFor={`${id}-email`}>Email</label>
      <input id={`${id}-email`} name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254} value={email} disabled={disabled} onChange={event => setEmail(event.target.value)}/>
      <div className="row-actions"><button className="button primary" type="submit" disabled={disabled || seconds > 0}>{pending ? 'Sending…' : seconds > 0 ? `Resend in ${seconds}s` : sentTo ? 'Send another link' : 'Send sign-in link'}</button></div>
      {sentTo && <p role="status">Check {sentTo} for a sign-in link. Open it in this browser; your imports stay in the browser where you added them.</p>}
    </form>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}
