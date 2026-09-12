import type { ArchiveQaMessage } from './archive-check.worker';
import type { ContactStats, MboxProgress } from '../../src/lib/mbox';
import type { MailboxWorkerResult, MboxWorkerRequest, MboxWorkerResponse } from '../../src/lib/mbox.worker';

const MiB = 1024 * 1024;
const RUN_LIMIT_MS = 4 * 60_000;
const OUTPUT_DATABASE = 'mighty-mailbox-local-output';
const OWN_EMAIL = 'owner@qa.example.invalid';
const ODD_EMAIL = 'odd@qa.example.invalid';
const EVEN_EMAIL = 'even@qa.example.invalid';
const EPOCH = Date.UTC(2026, 8, 12, 12);
const CASES = [
  ['archive', '19,000-connection ZIP'],
  ['mail100', '100-message native storage check'],
  ['mail1000', '1,000-message native storage check'],
  ['mail2g', '2 GiB Blob and real worker check'],
] as const;
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const runButton = element<HTMLButtonElement>('run');
const stopButton = element<HTMLButtonElement>('stop');
const status = element<HTMLParagraphElement>('status');
const phase = element<HTMLParagraphElement>('phase');
const details = element<HTMLPreElement>('details');
const overall = element<HTMLProgressElement>('overall');
const byteProgress = element<HTMLProgressElement>('bytes');
const output = (id: string, value: number | string) => { element<HTMLOutputElement>(id).value = typeof value === 'number' ? value.toLocaleString('en-US') : value; };
class CheckFailure extends Error {}
function expect(condition: unknown, message: string): asserts condition { if (!condition) throw new CheckFailure(message); }
const pauseForPaint = () => new Promise<void>(resolve => setTimeout(resolve, 0));
interface RunContext {
  controller: AbortController;
  accountKey: string;
  requestIds: string[];
  deadline: number;
  timedOut: boolean;
  forcedStops: number;
  notes: string[];
}
let active: RunContext | undefined;
function checkStop(context: RunContext) {
  if (performance.now() >= context.deadline) { context.timedOut = true; context.controller.abort(); }
  if (context.controller.signal.aborted) throw new DOMException('Test run stopped', 'AbortError');
}
function note(context: RunContext, message: string) { context.notes.push(message); details.textContent = context.notes.join('\n'); }
function showMailboxProgress(progress: MboxProgress) {
  output('messages', progress.counts?.messages ?? 0);
  output('sent', progress.counts?.sent ?? 0);
  output('received', progress.counts?.received ?? 0);
  output('contacts', progress.counts?.contacts ?? 0);
  byteProgress.max = Math.max(1, progress.totalBytes);
  byteProgress.value = progress.bytesRead;
  const bytes = `${(progress.bytesRead / MiB).toFixed(1)} / ${(progress.totalBytes / MiB).toFixed(1)} MiB`;
  const aggregate = progress.aggregation ? `; ${progress.aggregation.contactMessagesProcessed.toLocaleString()} contact events, ${progress.aggregation.knownThreadContactPairs.toLocaleString()} thread/contact pairs` : '';
  phase.textContent = `${progress.phase} — ${bytes}${aggregate}`;
}

async function archiveCheck(context: RunContext): Promise<string> {
  checkStop(context);
  const worker = new Worker(new URL('./archive-check.worker.ts', import.meta.url), {type:'module'});
  return new Promise((resolve,reject)=>{
    let done=false, killTimer:ReturnType<typeof setTimeout>|undefined;
    const finish=(error?:Error,message?:string)=>{
      if(done)return;done=true;
      if(killTimer)clearTimeout(killTimer);
      context.controller.signal.removeEventListener('abort',cancel);
      worker.terminate();
      if(error)reject(error);else resolve(message!);
    };
    const cancel=()=>{
      worker.postMessage({type:'cancel'});
      killTimer=setTimeout(()=>{note(context,'The ZIP worker required forced termination.');finish(new DOMException('Test run stopped','AbortError'));},Math.max(1,Math.min(5000,context.deadline-performance.now())));
    };
    context.controller.signal.addEventListener('abort',cancel,{once:true});
    worker.onerror=event=>{event.preventDefault();finish(new CheckFailure('The ZIP browser worker could not run. Check that archive-check.worker.ts was copied next to this test page.'));};
    worker.onmessage=({data}:MessageEvent<ArchiveQaMessage>)=>{
      if(data.type==='progress'){
        output('connections',data.progress.connections);output('messages',data.progress.messages);output('sent',data.progress.sent);output('received',data.progress.received);
        phase.textContent=`${data.progress.phase==='creating'?'Creating':'Reading'} generated ZIP — ${data.progress.connections.toLocaleString()} connections; ${(data.progress.bytesRead/MiB).toFixed(1)} MiB decoded`;
        byteProgress.removeAttribute('value');
      }else if(data.type==='complete'){
        if(context.controller.signal.aborted)finish(new DOMException('Test run stopped','AbortError'));
        else{byteProgress.max=1;byteProgress.value=1;finish(undefined,data.message);}
      }else if(data.type==='cancelled')finish(new DOMException('Test run stopped','AbortError'));
      else finish(new CheckFailure(data.message));
    };
    worker.postMessage({type:'run'});
    if(context.controller.signal.aborted)cancel();
  });
}

function message(id: string, sent: boolean, contact: string, timestamp: number, thread: string, body: string): string {
  return [
    'From sender@qa.example.invalid Sat Sep 12 12:00:00 2026',
    `From: ${sent ? OWN_EMAIL : contact}`, `To: ${sent ? contact : OWN_EMAIL}`,
    `Date: ${new Date(timestamp).toUTCString()}`, `Message-ID: <${id}@qa.example.invalid>`,
    `X-Gmail-Labels: ${sent ? 'Sent' : 'Inbox'}`, `X-GM-THRID: ${thread}`,
    'Content-Type: text/plain; charset=UTF-8', '', body, '', '',
  ].join('\n');
}
function smallMailbox(count: 100 | 1000, canary: string): File {
  const parts: string[] = [];
  const addReplyPairs = (contact: string, durations: number[], offset: number) => {
    durations.forEach((duration, i) => {
      const thread = String(offset + i);
      parts.push(message(`r-${thread}`, false, contact, EPOCH, thread, canary));
      parts.push(message(`s-${thread}`, true, contact, EPOCH + duration, thread, 'My own browser test words.\nRegards,\nSynthetic signature'));
    });
  };
  addReplyPairs(ODD_EMAIL, [1000, 3000, 9000], 100);
  addReplyPairs(EVEN_EMAIL, [2000, 6000], 200);
  for (let i = 0; i < count - 10; i++) parts.push(message(`single-${i}`, true, `single-${i}@qa.example.invalid`, EPOCH + 1000, String(1000 + i), 'My own browser test words.\nThanks,\nSynthetic signature'));
  return new File(parts, `synthetic-${count}.mbox`, { type: 'application/mbox' });
}
function largeMailbox(canary: string): File {
  const size = 2 * 1024 ** 3;
  const contact = 'large@qa.example.invalid';
  const head = new Blob([message('large-received', false, contact, EPOCH, '777', canary).trimEnd(), '\n']);
  const tail = new Blob(['\n\n', message('large-sent', true, contact, EPOCH + 1000, '777', 'I wrote this synthetic message.\n\nThanks,\nParser QA')]);
  // One eight-MiB ArrayBuffer, then repeated references to one immutable Blob.
  // No allocation, read, string, or ArrayBuffer is ever requested for the entire 2 GiB source.
  const shared = new Blob([new Uint8Array(8 * MiB).fill(32)]);
  const padding = size - head.size - tail.size;
  const parts: BlobPart[] = [head];
  for (let left = padding; left > 0; left -= shared.size) parts.push(left >= shared.size ? shared : shared.slice(0, left));
  parts.push(tail);
  const file = new File(parts, 'synthetic-2gib.mbox', { type: 'application/mbox' });
  expect(file.size === size, 'The generated Blob was not exactly 2 GiB.');
  return file;
}

function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { operation.onsuccess = () => resolve(operation.result); operation.onerror = () => reject(operation.error); });
}
async function openOutput(): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    const operation = indexedDB.open(OUTPUT_DATABASE);
    let missing = false;
    operation.onupgradeneeded = () => { missing = true; operation.transaction?.abort(); };
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => missing ? resolve(null) : reject(operation.error);
    operation.onblocked = () => reject(new CheckFailure('The test output database was blocked.'));
  });
}
const contactRange = (accountKey: string, requestId: string) => IDBKeyRange.bound([accountKey, requestId, ''], [accountKey, requestId, '\uffff']);
async function readOutput(accountKey: string, requestId: string) {
  const db = await openOutput();
  expect(db, 'The real worker did not create its local contact output database.');
  try {
    const tx = db.transaction(['contacts', 'imports'], 'readonly');
    const store = tx.objectStore('contacts');
    const [count, odd, even, last, imported] = await Promise.all([
      request(store.count(contactRange(accountKey, requestId))),
      request(store.get([accountKey, requestId, ODD_EMAIL])) as Promise<ContactStats | undefined>,
      request(store.get([accountKey, requestId, EVEN_EMAIL])) as Promise<ContactStats | undefined>,
      request(store.get([accountKey, requestId, 'single-989@qa.example.invalid'])) as Promise<ContactStats | undefined>,
      request(tx.objectStore('imports').get([accountKey, requestId])),
    ]);
    return { count, odd, even, last, imported };
  } finally { db.close(); }
}
async function cleanOutput(context: RunContext): Promise<void> {
  if (!context.requestIds.length) return;
  const db = await openOutput();
  if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['contacts', 'imports'], 'readwrite');
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
      for (const id of context.requestIds) {
        tx.objectStore('contacts').delete(contactRange(context.accountKey, id));
        tx.objectStore('imports').delete([context.accountKey, id]);
      }
    });
    const tx = db.transaction(['contacts', 'imports'], 'readonly');
    // Enqueue every request before yielding; transactions are never held across an await.
    const checks = context.requestIds.flatMap(id => [
      request(tx.objectStore('contacts').count(contactRange(context.accountKey, id))),
      request(tx.objectStore('imports').count(IDBKeyRange.only([context.accountKey, id]))),
    ]);
    expect((await Promise.all(checks)).every(count => count === 0), 'Test output cleanup left this run\'s contact or import rows behind.');
  } finally { db.close(); }
}

async function runRealWorker(file: File, context: RunContext, canary: string): Promise<{ result: MailboxWorkerResult; requestId: string; elapsedMs: number }> {
  checkStop(context);
  const requestId = crypto.randomUUID();
  context.requestIds.push(requestId);
  const worker = new Worker(new URL('../../src/lib/mbox.worker.ts', import.meta.url), { type: 'module' });
  const start = performance.now();
  return new Promise((resolve, reject) => {
    let done = false, killTimer: ReturnType<typeof setTimeout> | undefined, sawCounts = false;
    const finish = (error?: Error, result?: MailboxWorkerResult) => {
      if (done) return; done = true;
      if (killTimer) clearTimeout(killTimer);
      context.controller.signal.removeEventListener('abort', cancel);
      worker.terminate();
      if (error) reject(error);
      else if (!result || !sawCounts) reject(new CheckFailure('The worker did not return a result with visible live counts.'));
      else resolve({ result, requestId, elapsedMs: performance.now() - start });
    };
    const cancel = () => {
      if (done) return;
      worker.postMessage({ type: 'cancel', requestId } satisfies MboxWorkerRequest);
      killTimer = setTimeout(() => { context.forcedStops++; finish(new DOMException('Test run stopped', 'AbortError')); }, Math.max(1, Math.min(5000, context.deadline - performance.now())));
    };
    context.controller.signal.addEventListener('abort', cancel, { once: true });
    worker.onerror = event => { event.preventDefault(); finish(new CheckFailure('The real browser worker could not run. Check that the latest mailbox files were copied into src/lib.')); };
    worker.onmessageerror = () => finish(new CheckFailure('The browser could not transfer the generated File to the worker.'));
    worker.onmessage = ({ data }: MessageEvent<MboxWorkerResponse>) => {
      if (data.requestId !== requestId) return;
      if (JSON.stringify(data).includes(canary)) { finish(new CheckFailure('A received-body canary escaped through the worker message channel.')); return; }
      if (data.type === 'progress') {
        sawCounts ||= typeof data.progress.counts?.messages === 'number' && data.progress.counts.messages > 0;
        showMailboxProgress(data.progress);
      } else if (data.type === 'complete') {
        if (context.controller.signal.aborted) finish(new DOMException('Test run stopped', 'AbortError'));
        else finish(undefined, data.result);
      } else if (data.type === 'cancelled') finish(new DOMException('Test run stopped', 'AbortError'));
      else finish(new CheckFailure(`The browser worker returned ${data.code}.`));
    };
    worker.postMessage({ type: 'parse', requestId, accountKey: context.accountKey, file, ownAddresses: [OWN_EMAIL], accountHolderName: 'Parser QA' } satisfies MboxWorkerRequest);
    if (context.controller.signal.aborted) cancel();
  });
}
async function nativeMailboxCheck(count: 100 | 1000, context: RunContext): Promise<string> {
  const canary = `SYNTHETIC_RECEIVED_MBOX_${count}_CANARY`;
  const { result, requestId, elapsedMs } = await runRealWorker(smallMailbox(count, canary), context, canary);
  checkStop(context);
  expect(result.summary.counts.messages === count && result.summary.counts.sent === count - 5 && result.summary.counts.received === 5, 'The native worker produced incorrect message or direction counts.');
  expect(result.summary.counts.contacts === count - 8, 'The native worker lost contact rows.');
  expect(result.summary.globalMetrics.inferredReplyIntervals === 5, 'The native worker produced incorrect reply interval counts.');
  expect(result.summary.globalMetrics.outboundMessagesWithValidDate === count - 5 && result.summary.globalMetrics.outboundUtcHourCounts[12] === count - 5, 'The native worker global sent-time histogram is incorrect.');
  expect(result.samples.length === 40 && result.samples.every(text => text === 'My own browser test words.'), 'The native worker failed to retain exactly 40 cleaned own samples.');
  expect(!JSON.stringify(result).includes(canary) && !JSON.stringify(result).includes(ODD_EMAIL), 'Raw received text or a structured contact address escaped in the worker result.');
  const saved = await readOutput(context.accountKey, requestId);
  expect(saved.count === count - 8 && saved.imported?.status === 'ready', 'The final native IndexedDB output is incomplete.');
  expect(saved.odd?.medianReplyMs === 3000 && saved.odd.replies === 3, 'The native IndexedDB odd median is incorrect.');
  expect(saved.even?.medianReplyMs === 4000 && saved.even.replies === 2, 'The native IndexedDB even median is incorrect.');
  expect(saved.odd.outboundUtcHourCounts[12] === 3 && saved.even.outboundUtcHourCounts[12] === 2, 'The native contact timing arrays were not saved correctly.');
  if (count === 1000) expect(saved.last?.sent === 1, 'The final contact beyond the output batch boundary was lost.');
  await cleanOutput(context);
  return `PASSED — ${count.toLocaleString()} messages; ${saved.count.toLocaleString()} native contact rows; exact 3s/4s medians; ${(elapsedMs / 1000).toFixed(2)}s.`;
}
async function largeMailboxCheck(context: RunContext): Promise<string> {
  phase.textContent = 'Composing the 2 GiB File from shared 8 MiB Blob parts';
  const canary = 'SYNTHETIC_PRIVATE_LARGE_RECEIVED_BODY_CANARY';
  const creationStart = performance.now();
  const file = largeMailbox(canary);
  const createdMs = performance.now() - creationStart;
  await pauseForPaint(); checkStop(context);
  const { result, requestId, elapsedMs } = await runRealWorker(file, context, canary);
  expect(result.summary.sourceBytes === 2 * 1024 ** 3, 'The worker did not scan the exact 2 GiB Blob size.');
  expect(result.summary.counts.messages === 2 && result.summary.counts.received === 1 && result.summary.counts.sent === 1 && result.summary.counts.contacts === 1, 'The real 2 GiB scan lost or invented a message.');
  expect(result.samples.length === 1 && result.samples[0] === 'I wrote this synthetic message.', 'The real 2 GiB scan did not return the final cleaned own sample.');
  expect(!JSON.stringify(result).includes(canary), 'The large received-body canary escaped in the final result.');
  const saved = await readOutput(context.accountKey, requestId);
  expect(saved.count === 1 && saved.imported?.status === 'ready', 'The large scan did not commit its native local tally.');
  await cleanOutput(context);
  return `PASSED — exact 2 GiB generated Blob; 2 messages; one own sample; composed in ${(createdMs / 1000).toFixed(2)}s, scanned in ${(elapsedMs / 1000).toFixed(2)}s. Browser memory usage was not measured.`;
}

async function runChecks() {
  if (active) return;
  const context: RunContext = { controller: new AbortController(), accountKey: `mighty-browser-qa-${crypto.randomUUID()}`, requestIds: [], deadline: performance.now() + RUN_LIMIT_MS, timedOut: false, forcedStops: 0, notes: [] };
  active = context;
  runButton.disabled = true; stopButton.disabled = false; overall.value = 0;
  status.dataset.state = 'running'; status.textContent = 'RUNNING — generated inputs only';
  for (const [id, label] of CASES) { const row = element<HTMLLIElement>(`case-${id}`); row.dataset.state = 'pending'; row.textContent = `${label} — pending`; }
  for (const id of ['connections', 'messages', 'sent', 'received', 'contacts']) output(id, 0);
  note(context, 'Synthetic browser fixtures. No backend requests or account setup.');
  const started = performance.now();
  const elapsedTimer = setInterval(() => output('elapsed', `${((performance.now() - started) / 1000).toFixed(1)}s`), 250);
  // Leave up to five seconds for worker cancellation before the four-minute parser deadline.
  const timeout = setTimeout(() => { context.timedOut = true; context.controller.abort(); }, RUN_LIMIT_MS - 5000);
  let succeeded = false, failedCase = '';
  try {
    const jobs = [() => archiveCheck(context), () => nativeMailboxCheck(100, context), () => nativeMailboxCheck(1000, context), () => largeMailboxCheck(context)];
    for (let i = 0; i < CASES.length; i++) {
      checkStop(context);
      const [id, label] = CASES[i]; failedCase = id;
      const row = element<HTMLLIElement>(`case-${id}`); row.dataset.state = 'running'; row.textContent = `${label} — RUNNING`;
      byteProgress.max = 1; byteProgress.value = 0;
      const result = await jobs[i]();
      row.dataset.state = 'passed'; row.textContent = `${label} — ${result}`;
      note(context, result); overall.value = i + 1;
    }
    succeeded = true;
  } catch (error) {
    const stopped = context.controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
    const message = stopped ? (context.timedOut ? 'STOPPED — four-minute runtime limit reached.' : 'STOPPED — requested by user.') : error instanceof CheckFailure ? `FAILED — ${error.message}` : `FAILED — browser operation could not complete (${error instanceof Error ? error.name.replace(/[^A-Za-z]/g, '').slice(0, 40) : 'unknown error'}).`;
    status.dataset.state = stopped ? 'stopped' : 'failed'; status.textContent = message;
    if (failedCase) { const row = element<HTMLLIElement>(`case-${failedCase}`); row.dataset.state = 'failed'; row.textContent += ` — ${message}`; }
    note(context, message);
  } finally {
    clearTimeout(timeout);
    phase.textContent = 'Cleaning only this test run’s local output rows';
    try { await cleanOutput(context); note(context, 'Test output cleanup verified. Other account/import rows were not changed.'); }
    catch { succeeded = false; status.dataset.state = 'failed'; status.textContent = 'FAILED — test output cleanup could not be verified.'; note(context, 'Cleanup failed for this test run. No other account rows were targeted.'); }
    if (context.forcedStops) note(context, 'A worker required forced termination before acknowledging cancellation; its transient parser database may remain. Only scoped test output rows were cleaned.');
    clearInterval(elapsedTimer); output('elapsed', `${((performance.now() - started) / 1000).toFixed(1)}s`);
    if (succeeded) { status.dataset.state = 'passed'; status.textContent = 'PASSED — all four real browser checks and output cleanup completed.'; }
    phase.textContent = 'No parser is running.';
    stopButton.disabled = true; runButton.disabled = false; active = undefined;
  }
}
runButton.addEventListener('click', () => { void runChecks(); });
stopButton.addEventListener('click', () => { if (active) { status.textContent = 'Stopping and waiting for local cleanup…'; active.controller.abort(); } });
