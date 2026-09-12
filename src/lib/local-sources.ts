import type {LocalSources} from './workspace';

const STORE = 'sources';
const DATABASE = 'mighty-local-sources';
const GOAL_NAMESPACE = 'mighty:goal:v1';
// Existing source keys are strings. An array key cannot collide with an account
// UUID, device-draft, or any other legacy string key in the same object store.
const goalKey = (accountKey: string): IDBValidKey => [GOAL_NAMESPACE, accountKey];

function requireKey(key: string) {
  if (typeof key !== 'string' || !key) throw new TypeError('A local workspace key is required.');
}

/** A separate database name is available for isolated native IndexedDB checks. */
export function createLocalSourceStore(databaseName = DATABASE) {
  let writeChain: Promise<unknown> = Promise.resolve();

  const open = () => new Promise<IDBDatabase>((resolve, reject) => {
    // Keep version 1 and the existing sources object store; no upgrade is needed.
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Local storage is unavailable.'));
  });

  async function localSources(key: string): Promise<LocalSources> {
    requireKey(key);
    await writeChain.catch(() => {});
    const database = await open();
    try {
      return await new Promise<LocalSources>((resolve, reject) => {
        // Both reads share one snapshot. A concurrent combined write is seen
        // either before or after commit, never as half a source/goal update.
        const transaction = database.transaction(STORE, 'readonly');
        const store = transaction.objectStore(STORE);
        const sourceRead = store.get(key);
        const goalRead = store.get(goalKey(key));
        transaction.oncomplete = () => {
          const sources: LocalSources = sourceRead.result || {};
          const goal: unknown = goalRead.result;
          // An empty string is an intentional cleared goal, not a missing value.
          resolve(typeof goal === 'string' ? {...sources, strategy: goal} : sources);
        };
        transaction.onerror = () => reject(transaction.error ?? new Error('Local sources could not be read.'));
        transaction.onabort = () => reject(transaction.error ?? new Error('Reading local sources was interrupted.'));
      });
    } finally {
      database.close();
    }
  }

  function keepLocal(key: string, patch: LocalSources): Promise<void> {
    requireKey(key);
    const snapshot = structuredClone(patch);
    const hasGoal = Object.hasOwn(snapshot, 'strategy');
    if (hasGoal && typeof snapshot.strategy !== 'string') {
      throw new TypeError('A saved goal must be text; use an empty string to clear it.');
    }
    // A missing source must not erase an earlier import. Explicit source values
    // merge only their top-level fields; other imported sources remain untouched.
    const sourcePatch = Object.fromEntries(Object.entries(snapshot)
      .filter(([name, value]) => name !== 'strategy' && value !== undefined));
    const hasSources = Object.keys(sourcePatch).length > 0;
    const job = writeChain.catch(() => {}).then(async () => {
      if (!hasGoal && !hasSources) return;
      const database = await open();
      try {
        await new Promise<void>((resolve, reject) => {
          // Native read/write transactions also serialize merges across tabs.
          // Combined source and goal changes commit or roll back together.
          const transaction = database.transaction(STORE, 'readwrite');
          const store = transaction.objectStore(STORE);
          let failure: unknown;
          const abort = (error: unknown) => {
            failure = error;
            try { transaction.abort(); } catch { reject(error); }
          };
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => { failure ??= transaction.error; };
          transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Local sources were not saved.'));
          try {
            // Typing a goal issues only this small put: it never reads or writes
            // the potentially large source record under the account string key.
            if (hasGoal) store.put(snapshot.strategy, goalKey(key));
            if (hasSources) {
              const sourceRead = store.get(key);
              sourceRead.onsuccess = () => {
                try { store.put({...sourceRead.result, ...sourcePatch}, key); }
                catch (error) { abort(error); }
              };
            }
          } catch (error) { abort(error); }
        });
      } finally {
        database.close();
      }
    });
    writeChain = job;
    return job;
  }

  return {localSources, keepLocal};
}

const defaultStore = createLocalSourceStore();
export const localSources = defaultStore.localSources;
export const keepLocal = defaultStore.keepLocal;
