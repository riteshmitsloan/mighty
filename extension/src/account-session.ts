import {validateGoalContext} from './goal-context.js';
import {AccountConnectionError, accountFailure, isAuthenticationFailure} from './account-errors.js';
import {validSession} from './messaging.js';
import type {Session} from './types.js';
export interface AccountSessionStorage {read(): Promise<Session | null>; write(value: Session | null): Promise<void>}
/** Serializes identity replacement and goal refresh without retaining another account's context. */
export function createAccountSession(storage: AccountSessionStorage, changed: () => void = () => {}, now = Date.now) {
  let generation = 0, message = '', code = '';
  let writes: Promise<unknown> = Promise.resolve();
  const diagnostic = (error?: unknown) => {const failure = error ? accountFailure(error) : null; message = failure?.message ?? ''; code = failure?.code ?? '';};
  const write = (ticket: number, value: Session | null) => {
    const job = writes.catch(() => {}).then(async () => {if (ticket === generation) await storage.write(value);});
    writes = job; return job;
  };
  const identity = (value: Session | null): Session => {
    if (!validSession(value, now())) throw new AccountConnectionError('session_expired');
    if (typeof value.userId !== 'string' || typeof value.accessToken !== 'string' || !value.accessToken) throw new AccountConnectionError('session_invalid');
    return {userId: value.userId, accessToken: value.accessToken, expiresAt: value.expiresAt, strategy: ''};
  };
  async function current(): Promise<Session | null> {
    const ticket = generation, pendingWrites = writes;
    await pendingWrites;
    if (ticket !== generation || pendingWrites !== writes) return current();
    const value = await storage.read();
    if (ticket !== generation || pendingWrites !== writes) return current();
    if (!value) return null;
    let owner: Session;
    try {owner = identity(value);}
    catch (error) {diagnostic(error); await write(ticket, null); changed(); return null;}
    if (value.goalContext === undefined) return owner;
    try {return {...owner, goalContext: validateGoalContext(value.goalContext, owner.userId)};}
    catch (error) {
      // A malformed goal cache is not evidence that a previously verified bearer expired.
      diagnostic(error); await write(ticket, owner); changed();
      return ticket === generation ? owner : current();
    }
  }
  async function disconnect() {
    const ticket = ++generation; diagnostic();
    await write(ticket, null); changed();
  }
  async function hydrate(ticket: number, previous: Session, load: (previous: Session) => Promise<Session>): Promise<Session | null> {
    const owner = identity(previous);
    diagnostic(); await write(ticket, owner); changed();
    if (ticket !== generation) return current();
    try {
      const result = await load(owner);
      if (ticket !== generation) return current();
      // A goals endpoint may replace only goals, never the verified identity or its lifetime.
      if (result.userId !== owner.userId || result.accessToken !== owner.accessToken || result.expiresAt !== owner.expiresAt) throw new AccountConnectionError('goals_cache_invalid');
      const next = {...identity(owner), goalContext: validateGoalContext(result.goalContext, owner.userId)};
      await write(ticket, next);
      if (ticket !== generation) return current();
      diagnostic(); changed(); return next;
    } catch (error) {
      if (ticket !== generation) return current();
      const expired = !validSession(owner, now());
      diagnostic(expired ? new AccountConnectionError('session_expired') : error);
      const next = expired || isAuthenticationFailure(error) ? null : owner;
      await write(ticket, next);
      if (ticket !== generation) return current();
      changed(); return next;
    }
  }
  async function connect(load: () => Promise<Session>, loadGoals?: (previous: Session) => Promise<Session>): Promise<Session | null> {
    const ticket = ++generation; diagnostic();
    // Clear the old owner before verification, even if the replacement handoff fails.
    await write(ticket, null); changed();
    let result: Session | undefined;
    const acknowledgeReplacement = async (): Promise<Session> => {
      const latest = await current();
      // Opening the popup may refresh goals after verification but before this handoff finishes.
      // That can acknowledge only the exact same verified bearer, never a different account.
      if (latest && result && latest.userId === result.userId && latest.accessToken === result.accessToken && latest.expiresAt === result.expiresAt) return latest;
      throw new AccountConnectionError('connection_superseded');
    };
    try {
      const loaded = await load(); result = identity(loaded);
      if (loaded.goalContext !== undefined) result.goalContext = validateGoalContext(loaded.goalContext, result.userId);
      if (ticket !== generation) return acknowledgeReplacement();
      await write(ticket, result);
      if (ticket !== generation) return acknowledgeReplacement();
      changed();
    } catch (error) {
      if (ticket !== generation) return acknowledgeReplacement();
      diagnostic(error); await write(ticket, null); changed(); throw error;
    }
    const connected = loadGoals ? await hydrate(ticket, result, loadGoals) : result;
    if (ticket !== generation) return acknowledgeReplacement();
    return connected;
  }
  async function refresh(load: (previous: Session) => Promise<Session>): Promise<Session | null> {
    const ticket = generation, previous = await current();
    if (ticket !== generation) return current();
    if (!previous) return null;
    return hydrate(++generation, previous, load);
  }
  /** A late HTTP401 for an older bearer must never disconnect its replacement. */
  async function invalidate(rejected: Session, error = new AccountConnectionError('session_expired')): Promise<void> {
    const ticket = generation, previous = await current();
    if (ticket !== generation) return invalidate(rejected, error);
    if (!previous || previous.userId !== rejected.userId || previous.accessToken !== rejected.accessToken) return;
    const nextTicket = ++generation; diagnostic(error); await write(nextTicket, null); changed();
  }
  return {current, connect, disconnect, refresh, invalidate, message: () => message, code: () => code};
}
