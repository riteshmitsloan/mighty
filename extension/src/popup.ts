import {mightyAppLink} from './app-link.js';

const account = document.querySelector('#account')!;
const notice = document.querySelector('#notice')!;
const retry = document.querySelector('#retry')! as HTMLButtonElement;
let connected = false, checking = false, goalsUnavailable = false, appOrigin = '', message = '';
let generation = 0, disposed = false, reconnectAttempts = 0;
let reconnect: ReturnType<typeof setTimeout> | undefined, port: chrome.runtime.Port | undefined;

function render() {
  account.replaceChildren(); account.setAttribute('aria-busy', String(checking));
  const status = document.createElement('p');
  status.className = 'account-state' + (connected ? ' connected' : '');
  status.textContent = checking ? 'Checking account…' : connected ? 'Account connected' : 'Account not connected';
  account.append(status);
  if (appOrigin) {
    try {
      const link = document.createElement('a'); link.textContent = connected ? 'Open Mighty' : 'Connect to Mighty';
      link.href = mightyAppLink(appOrigin, chrome.runtime.id, connected);
      link.target = '_blank'; link.rel = 'noopener noreferrer'; account.append(link);
    } catch { /* An invalid destination must not become a navigation link. */ }
  }
  notice.textContent = message;
  retry.hidden = !goalsUnavailable && !message; retry.disabled = checking;
  retry.textContent = goalsUnavailable ? 'Retry goals' : 'Try again';
}
async function refresh(refreshGoals = false, force = false) {
  if (disposed || (checking && !force)) return;
  const ticket = ++generation; checking = true; render();
  try {
    const result = await chrome.runtime.sendMessage({type: 'mighty:status', refreshGoals});
    if (disposed || ticket !== generation) return;
    if (!result?.ok) throw Error(result?.message || 'Mighty could not check the connection. Try again.');
    connected = result.connected === true;
    appOrigin = typeof result.appOrigin === 'string' ? result.appOrigin : '';
    goalsUnavailable = connected && !result.goalContext;
    message = typeof result.message === 'string' ? result.message.slice(0, 300) : '';
    if (goalsUnavailable && !message) message = 'Your saved goals could not load.';
  } catch (error) {
    if (disposed || ticket !== generation) return;
    message = error instanceof Error ? error.message.slice(0, 300) : 'Mighty could not check the connection. Try again.';
  } finally {if (!disposed && ticket === generation) {checking = false; render();}}
}
retry.addEventListener('click', () => void refresh(true));
function connect() {
  if (disposed) return;
  try {
    const current = chrome.runtime.connect({name: 'mighty:popup'}); port = current;
    current.onMessage.addListener(event => {
      if (disposed || port !== current || event?.type !== 'mighty:account_changed') return;
      generation++; connected = false; goalsUnavailable = false; message = ''; render();
      reconnectAttempts = 0; void refresh(false, true);
    });
    current.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (disposed || port !== current) return;
      port = undefined; generation++; checking = false; connected = false; goalsUnavailable = false;
      message = 'Reconnecting to Mighty…'; render(); clearTimeout(reconnect);
      if (++reconnectAttempts > 8) {message = 'Mighty could not reconnect. Close and reopen this window.'; render(); return;}
      reconnect = setTimeout(() => {connect(); void refresh();}, Math.min(1000, reconnectAttempts * 100));
    });
  } catch {message = 'Mighty was reloaded. Close and reopen this window.'; render();}
}
addEventListener('focus', () => void refresh(true));
addEventListener('unload', () => {disposed = true; generation++; clearTimeout(reconnect); port?.disconnect();});
connect(); void refresh(true);
