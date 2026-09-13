import {validateGoalContext} from './goal-context.js';
import {validSession} from './messaging.js';
import type {Session} from './types.js';
export interface AccountSessionStorage {read(): Promise<Session | null>; write(value: Session | null): Promise<void>}
/** Serializes account replacement so a slow handoff cannot restore a previous account. */
export function createAccountSession(storage: AccountSessionStorage, changed: () => void = () => {}, now = Date.now) {
  let generation = 0, message = '';
  let writes: Promise<unknown> = Promise.resolve();
  const write = (ticket: number, value: Session | null) => {
    const job = writes.catch(() => {}).then(async () => {if (ticket === generation) await storage.write(value);});
    writes = job; return job;
  };
  const checked = (value: Session | null): Session => {
    if (!validSession(value, now())) throw Error('Your account session expired. Reconnect from Mighty.');
    return {...value, goalContext: validateGoalContext(value.goalContext, value.userId), strategy: ''};
  };
  async function current(): Promise<Session | null> {
    const ticket = generation, pendingWrites = writes;
    await pendingWrites;
    if (ticket !== generation || pendingWrites !== writes) return current();
    const value = await storage.read();
    if (ticket !== generation || pendingWrites !== writes) return current();
    if (!value) return null;
    try {return checked(value);}
    catch (error) {
      if (ticket === generation) message = (error as Error).message;
      await write(ticket, null); changed(); return null;
    }
  }
  async function disconnect() {
    const ticket = ++generation; message = '';
    await write(ticket, null); changed();
  }
  async function connect(load: () => Promise<Session>): Promise<Session> {
    const ticket = ++generation; message = '';
    // Invalidate the old owner before verifying a replacement, including failed replacements.
    await write(ticket, null); changed();
    try {
      const result = checked(await load());
      if (ticket !== generation) throw Error('A newer account handoff replaced this request.');
      await write(ticket, result);
      if (ticket !== generation) throw Error('A newer account handoff replaced this request.');
      changed(); return result;
    } catch (error) {
      if (ticket === generation) {message = error instanceof Error ? error.message : 'The account could not be connected.'; await write(ticket, null); changed();}
      throw error;
    }
  }
  async function refresh(load: (previous: Session) => Promise<Session>): Promise<Session | null> {
    const ticket = generation, previous = await current();
    if (ticket !== generation) return current();
    if (!previous) return null;
    return connect(() => load(previous));
  }
  return {current, connect, disconnect, refresh, message: () => message};
}
