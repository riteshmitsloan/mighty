import {createLocalSourceStore} from '../../src/lib/local-sources';
import type {LocalSources} from '../../src/lib/workspace';
import type {ArchiveResult} from '../../src/lib/archive';

const button = document.getElementById('run') as HTMLButtonElement;
const status = document.getElementById('status')!;
const results = document.getElementById('results')!;
const details = document.getElementById('details')!;
const expect = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
const same = (actual: unknown, expected: unknown, message: string) => expect(JSON.stringify(actual) === JSON.stringify(expected), message);
const isGoalKey = (key: unknown): key is [string, string] => Array.isArray(key) && key[0] === 'mighty:goal:v1';

interface Operation {kind: 'get' | 'put'; key: unknown; transaction: IDBTransaction;}

// Instrument native requests only for this run's unique database, restoring the
// original methods immediately afterward. Other databases pass through unchanged.
async function trace<T>(databaseName: string, work: () => Promise<T>, failSourceKey?: string) {
  const originalGet = IDBObjectStore.prototype.get;
  const originalPut = IDBObjectStore.prototype.put;
  const operations: Operation[] = [];
  IDBObjectStore.prototype.get = function (query: IDBValidKey | IDBKeyRange) {
    if (this.transaction.db.name === databaseName) operations.push({kind:'get', key:query, transaction:this.transaction});
    return originalGet.call(this, query);
  };
  IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
    if (this.transaction.db.name === databaseName) {
      operations.push({kind:'put', key, transaction:this.transaction});
      if (key === failSourceKey) throw new DOMException('Synthetic source-write failure', 'QuotaExceededError');
    }
    return originalPut.call(this, value, key);
  };
  try { return {value:await work(), operations}; }
  finally { IDBObjectStore.prototype.get = originalGet; IDBObjectStore.prototype.put = originalPut; }
}

async function openFixture(databaseName: string) {
  return await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('sources');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function rawRecord(databaseName: string, key: string, value?: LocalSources): Promise<LocalSources | undefined> {
  const db = await openFixture(databaseName);
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('sources', value ? 'readwrite' : 'readonly');
      const store = tx.objectStore('sources');
      const request = value ? store.put(value, key) : store.get(key);
      tx.oncomplete = () => resolve(value || request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
async function removeFixture(databaseName: string) {
  expect(/^mighty-goal-storage-check-[0-9a-f-]{36}$/.test(databaseName), 'Cleanup may delete only this generated fixture database.');
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Fixture cleanup is blocked by another open test connection.'));
  });
}

function fixtureArchive(): ArchiveResult {
  return {
    fingerprint:'synthetic-archive-fingerprint',
    layer1:{id:'synthetic-snapshot', importedAt:'2026-01-01T00:00:00Z', fingerprint:'synthetic-facts', profile:[], positions:[{'Company Name':'Fixture Company', Title:'Fixture Role'}], education:[], skills:[]},
    verifiedAccountHolder:null,
    connections:[{firstName:'Fixture',lastName:'Contact',url:'',email:'',company:'Fixture Company',position:'Fixture Role',connectedOn:'2020-01-01'}],
    writingSamples:[], companyIndex:{}, warnings:[],
    counts:{connections:1,positions:1,education:0,skills:0,messages:0,sentMessages:0,receivedMessages:0,unidentifiedMessages:0,threads:0,invitations:0},
  };
}

button.addEventListener('click', async () => {
  button.disabled = true;
  results.replaceChildren();
  status.dataset.state = 'running';
  status.textContent = 'Running native IndexedDB checks with synthetic records only…';
  const databaseName = `mighty-goal-storage-check-${crypto.randomUUID()}`;
  const accountA = crypto.randomUUID();
  const accountB = crypto.randomUUID();
  const storage = createLocalSourceStore(databaseName);
  const otherConnection = createLocalSourceStore(databaseName);
  const archive = fixtureArchive();
  const legacy: LocalSources = {archive, resume:{text:'Synthetic storage payload. '.repeat(12_000),pages:1,fingerprint:'fixture-resume'},strategy:'Legacy goal'};
  let passed = 0;
  let failure: unknown;
  const check = async (name: string, work: () => Promise<void>) => {
    const row = document.createElement('li');
    row.textContent = `${name} — running`;
    results.append(row);
    try { await work(); passed++; row.dataset.state = 'passed'; row.textContent = `${name} — passed`; }
    catch (error) { row.dataset.state = 'failed'; row.textContent = `${name} — failed`; throw error; }
  };
  try {
    await check('Legacy version-1 imports and goal remain readable', async () => {
      await rawRecord(databaseName, accountA, legacy);
      same(await storage.localSources(accountA), legacy, 'Legacy source fields changed.');
      const db = await openFixture(databaseName);
      try { expect(db.version === 1 && [...db.objectStoreNames].join(',') === 'sources', 'Storage schema changed.'); }
      finally { db.close(); }
    });
    await check('Typing a goal never reads or rewrites the large source record', async () => {
      const {operations} = await trace(databaseName, () => storage.keepLocal(accountA, {strategy:'Current goal'}));
      expect(operations.length === 1 && operations[0].kind === 'put' && isGoalKey(operations[0].key), 'A goal-only save touched more than its lightweight record.');
      expect(indexedDB.cmp(operations[0].key as IDBValidKey, accountA) !== 0, 'Goal and account keys collide.');
      expect(indexedDB.cmp(operations[0].key as IDBValidKey, 'device-draft') !== 0, 'Goal and device-draft keys collide.');
      same(await rawRecord(databaseName, accountA), legacy, 'Typing a goal rewrote legacy sources.');
      const read = await storage.localSources(accountA);
      expect(read.strategy === 'Current goal', 'The new goal did not override the legacy goal.');
      same(read.archive, archive, 'The archive changed while typing a goal.');
    });
    await check('An empty goal overrides the old goal without removing imports', async () => {
      await storage.keepLocal(accountA, {strategy:''});
      const read = await storage.localSources(accountA);
      expect(read.strategy === '', 'An intentionally empty goal fell back to the legacy goal.');
      same(read.archive, archive, 'Clearing the goal removed the archive.');
    });
    await check('Combined source and goal updates share one native transaction', async () => {
      const resume = {text:'Updated synthetic resume',pages:2,fingerprint:'fixture-resume-2'};
      const {operations} = await trace(databaseName, () => storage.keepLocal(accountA, {resume,strategy:'Combined goal'}));
      const writes = operations.filter(operation => operation.kind === 'put');
      expect(writes.length === 2 && writes[0].transaction === writes[1].transaction, 'A combined patch used separate transactions.');
      const read = await storage.localSources(accountA);
      expect(read.strategy === 'Combined goal', 'The combined goal did not commit.');
      same(read.resume, resume, 'The combined source did not commit.');
      same(read.archive, archive, 'The combined patch overwrote another import.');
    });
    await check('A failed combined write rolls back both records and recovers', async () => {
      const before = await storage.localSources(accountA);
      let refused = false;
      try {
        await trace(databaseName, () => storage.keepLocal(accountA, {resume:{text:'Must not persist',pages:9,fingerprint:'rollback'},strategy:'Must not persist'}), accountA);
      } catch { refused = true; }
      expect(refused, 'The injected write failure was not returned to the caller.');
      same(await storage.localSources(accountA), before, 'A failed combined write committed half its data.');
      await storage.keepLocal(accountA, {strategy:'Recovered goal'});
      expect((await storage.localSources(accountA)).strategy === 'Recovered goal', 'A rejected write poisoned later saves.');
    });
    await check('Separate connections merge source patches without losing the latest goal', async () => {
      const resume = {text:'Concurrent synthetic resume',pages:3,fingerprint:'fixture-concurrent'};
      await Promise.all([
        storage.keepLocal(accountA, {resume}),
        otherConnection.keepLocal(accountA, {strategy:'Concurrent goal'}),
      ]);
      const read = await storage.localSources(accountA);
      same(read.resume, resume, 'Concurrent source update was lost.');
      same(read.archive, archive, 'A concurrent update removed the original archive.');
      expect(read.strategy === 'Concurrent goal', 'A source merge restored a stale goal.');
      await storage.keepLocal(accountA, {archive:undefined});
      same((await storage.localSources(accountA)).archive, archive, 'An omitted source wiped the archive.');
    });
    await check('Rapid goal saves preserve order and snapshot values without source I/O', async () => {
      const {operations} = await trace(databaseName, async () => {
        const pending = Array.from({length:20}, (_, index) => storage.keepLocal(accountA, {strategy:`Synthetic goal ${index}`}));
        pending.push(storage.keepLocal(accountA, {strategy:''}));
        await Promise.all(pending);
      });
      expect(operations.length === 21 && operations.every(operation => operation.kind === 'put' && isGoalKey(operation.key)), 'Rapid goal saves accessed source records.');
      expect((await storage.localSources(accountA)).strategy === '', 'Queued goal writes finished out of order.');
      const patch = {strategy:'Snapshot goal'};
      const pending = storage.keepLocal(accountA, patch);
      patch.strategy = 'Mutated after enqueue';
      await pending;
      expect((await storage.localSources(accountA)).strategy === 'Snapshot goal', 'A queued patch read later caller mutations.');
    });
    await check('Account keys remain isolated and invalid goals cannot overwrite data', async () => {
      await storage.keepLocal(accountB, {strategy:'Other account goal'});
      const accountARead = await storage.localSources(accountA);
      const accountBRead = await storage.localSources(accountB);
      expect(accountARead.strategy === 'Snapshot goal', 'Another account changed the first goal.');
      same(accountBRead, {strategy:'Other account goal'}, 'Another account received source data.');
      let refused = false;
      try { await storage.keepLocal(accountA, {strategy:undefined}); } catch { refused = true; }
      expect(refused, 'An invalid goal was accepted.');
      same(await storage.localSources(accountA), accountARead, 'An invalid goal changed the stored data.');
    });
  } catch (error) { failure = error; }
  finally {
    try { await removeFixture(databaseName); }
    catch (error) { failure ??= error; }
    button.disabled = false;
  }
  status.dataset.state = failure ? 'failed' : 'passed';
  status.textContent = failure ? `${passed} checks passed; a check or cleanup failed.` : `${passed} of 8 checks passed. Temporary fixture storage removed.`;
  details.textContent = failure instanceof Error ? `${failure.name}: ${failure.message}` : failure ? String(failure) : 'Goal-only saves issued one lightweight put and zero source reads or writes. Source/goal rollback, legacy compatibility, save ordering, and account isolation passed with native IndexedDB.';
});
