import {useEffect, useId, useRef, useState} from 'react';
import {accountLoginLabel, authErrorMessage, sendOwnerLink, signInPrivateAccount, signOutOwner, type OwnerAuthClient} from '../lib/owner-auth';

type Props = {
  client: OwnerAuthClient | null;
  uid: string | null;
  email?: string;
  busy?: boolean;
  ready?: boolean;
};
export default function AccountPanel({client, uid, email: accountEmail, busy = false, ready = true}: Props) {
  const id = useId();
  const [method, setMethod] = useState<'password' | 'link'>('password');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [signedIn, setSignedIn] = useState(false);
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
    setPending(false); setIdentifier(''); setPassword(''); setSignedIn(false); setEmail(''); setSentTo(''); setError(''); setRetryAt(0);
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

  function changeMethod() {
    if (disabled || lock.current) return;
    setMethod(method === 'password' ? 'link' : 'password');
    setPassword(''); setError(''); setSignedIn(false);
  }

  async function submit(signingOut = false) {
    if (!client || !ready || busy || lock.current || (!signingOut && method === 'link' && Date.now() < retryAt)) return;
    lock.current = true;
    const version = generation.current;
    const account = uid;
    const current = () => version === generation.current && identity.current === account;
    setPending(true); setError(''); setSignedIn(false);
    try {
      if (signingOut) await signOutOwner(client);
      else if (method === 'password') {
        const submittedPassword = password;
        setPassword('');
        await signInPrivateAccount(client, identifier, submittedPassword);
        if (current()) setSignedIn(true);
      }
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
      <p>{accountEmail ? accountLoginLabel(accountEmail) : 'Account connected'}</p>
      <button type="button" className="button secondary" disabled={disabled} onClick={() => void submit(true)}>{pending ? 'Signing out…' : 'Sign out on this device'}</button>
    </> : <>
    {method === 'password' ? <form onSubmit={event => {event.preventDefault(); void submit();}}>
      <p>Use the login ID or email and password provided for your Mighty account.</p>
      <label htmlFor={`${id}-identifier`}>Login ID or email</label>
      <input id={`${id}-identifier`} name="username" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={254} value={identifier} disabled={disabled} onChange={event => setIdentifier(event.target.value)}/>
      <label htmlFor={`${id}-password`}>Password</label>
      <input id={`${id}-password`} name="password" type="password" autoComplete="current-password" required maxLength={1024} value={password} disabled={disabled} onChange={event => setPassword(event.target.value)}/>
      <div className="row-actions"><button className="button primary" type="submit" disabled={disabled}>{pending ? 'Signing in…' : 'Sign in'}</button></div>
      {signedIn && <p role="status">Signed in. Loading your account…</p>}
      <p>For help with a login ID or password, contact the person who created your account.</p>
    </form> : <form onSubmit={event => {event.preventDefault(); void submit();}}>
      <p>Use the email linked to your Mighty account.</p>
      <label htmlFor={`${id}-email`}>Email</label>
      <input id={`${id}-email`} name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254} value={email} disabled={disabled} onChange={event => setEmail(event.target.value)}/>
      <div className="row-actions"><button className="button primary" type="submit" disabled={disabled || seconds > 0}>{pending ? 'Sending…' : seconds > 0 ? `Resend in ${seconds}s` : sentTo ? 'Send another link' : 'Send sign-in link'}</button></div>
      {sentTo && <p role="status">Check {sentTo} for a sign-in link. Open it in this browser; your imports stay in the browser where you added them.</p>}
      <p>Login IDs use passwords and cannot receive email links.</p>
    </form>}
    <button type="button" className="button secondary" disabled={disabled} onClick={changeMethod}>{method === 'password' ? 'Use an email sign-in link' : 'Use a login ID or password'}</button>
    </>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}
