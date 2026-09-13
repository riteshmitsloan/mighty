import {validSession} from './messaging.js';
import type {Session} from './types.js';

export function toolbarState(account: Session | null, now = Date.now()) {
  const connected = validSession(account, now);
  const goalsUnavailable = connected && !account.goalContext;
  const state = connected ? 'connected' : 'disconnected';
  return {
    path: Object.fromEntries([16, 24, 32, 48].map(size => [String(size), `assets/icons/mighty-${state}-${size}.png`])),
    title: !connected ? 'Mighty: connect your account' : goalsUnavailable
      ? 'Mighty: account connected, goals unavailable. Open to retry.' : 'Mighty: account connected',
    badge: goalsUnavailable ? '!' : '',
    expiresAt: connected ? account.expiresAt - 5000 : null,
  };
}

/** Update from existing browser events. No new permission, polling or token exposure. */
export function startToolbar(readAccount: () => Promise<Session | null>, api = chrome) {
  if (!api.action) return {refresh: async () => {}};
  let generation = 0;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let updates: Promise<unknown> = Promise.resolve();
  const refresh = () => {
    const ticket = ++generation;
    const next = updates.catch(() => {}).then(async () => {
      let account: Session | null = null;
      try {account = await readAccount();} catch { /* Unknown identity displays disconnected. */ }
      if (ticket !== generation) return;
      const state = toolbarState(account);
      clearTimeout(expiry);
      await Promise.all([
        api.action.setIcon({path: state.path}), api.action.setTitle({title: state.title}),
        api.action.setBadgeText({text: state.badge}), api.action.setBadgeBackgroundColor({color: '#A85818'}),
      ]);
      // Worker timers are best effort; startup and activation also re-check expiry after suspension.
      if (ticket === generation && state.expiresAt !== null) expiry = setTimeout(() => {void refresh();}, Math.max(1000, state.expiresAt - Date.now()));
    });
    updates = next;
    return next.catch(() => {});
  };
  api.storage.onChanged?.addListener((changes, area) => {
    if (area === 'session' && Object.prototype.hasOwnProperty.call(changes, 'account')) void refresh();
  });
  api.runtime.onStartup?.addListener(() => {void refresh();});
  api.runtime.onInstalled?.addListener(() => {void refresh();});
  api.tabs.onActivated?.addListener(() => {void refresh();});
  api.windows?.onFocusChanged?.addListener(() => {void refresh();});
  void refresh();
  return {refresh};
}
