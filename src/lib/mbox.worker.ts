import { parseMbox, IndexedDbMetadataSink, emptyOutboundTiming, type OutboundTiming, type ByteSource, type ContactStats, type MetadataSink, type MboxOptions, type MboxResult, } from './mbox';
export const CONTACT_BATCH_SIZE = 128;
export interface MailboxGlobalMetrics extends OutboundTiming {
    /** These are contact/message associations; a multi-recipient message contributes more than once. */
    contactSentMessages: number;
    contactReceivedMessages: number;
    contactsWithSent: number;
    contactsWithReceived: number;
    bidirectionalContacts: number;
    sentOnlyContacts: number;
    receivedOnlyContacts: number;
    /** Sum of distinct known threads within each contact, not unique threads globally. */
    knownThreadContactPairs: number;
    unresolvedThreadContactMessages: number;
    invalidDateContactMessages: number;
    /** Latest received -> next sent within a known contact/thread; inferred, not verified replies. */
    inferredReplyIntervals: number;
    firstContactAt?: number;
    lastContactAt?: number;
}
export interface MailboxSummary extends Record<string, unknown> {
    schemaVersion: 1;
    sourceBytes: number;
    counts: MboxResult['totals'];
    globalMetrics: MailboxGlobalMetrics;
    sampleCount: number;
    warnings: Record<string, number>;
}
export interface MailboxWorkerResult {
    summary: MailboxSummary;
    samples: string[];
}
export interface ContactOutput {
    begin(): Promise<void>;
    append(contacts: readonly ContactStats[]): Promise<void>;
    commit(summary: MailboxSummary): Promise<void>;
    abort(): Promise<void>;
    close(): Promise<void>;
}
export interface ParseFileOptions {
    /** Opaque account-scoped local identifier; never written into the returned summary. */
    accountKey: string;
    requestId: string;
    ownAddresses?: string[];
    accountHolderName?: string;
    sentLabels?: string[];
    draftLabels?: string[];
    signal?: AbortSignal;
    onProgress?: MboxOptions['onProgress'];
    /** Injection hooks for bounded tests; production defaults to the IndexedDB adapters. */
    createSink?: () => MetadataSink;
    contactOutput?: ContactOutput;
}
function checkAbort(signal?: AbortSignal) {
    if (signal?.aborted)
        throw new DOMException('Import cancelled', 'AbortError');
}
export function emptyGlobalMetrics(): MailboxGlobalMetrics {
    return {
        contactSentMessages: 0, contactReceivedMessages: 0, contactsWithSent: 0,
        contactsWithReceived: 0, bidirectionalContacts: 0, sentOnlyContacts: 0,
        receivedOnlyContacts: 0, knownThreadContactPairs: 0,
        unresolvedThreadContactMessages: 0, invalidDateContactMessages: 0,
        inferredReplyIntervals: 0, ...emptyOutboundTiming(),
    };
}
export function addContactToGlobal(metrics: MailboxGlobalMetrics, contact: ContactStats): void {
    metrics.contactSentMessages += contact.sent;
    metrics.contactReceivedMessages += contact.received;
    metrics.contactsWithSent += Number(contact.sent > 0);
    metrics.contactsWithReceived += Number(contact.received > 0);
    metrics.bidirectionalContacts += Number(contact.sent > 0 && contact.received > 0);
    metrics.sentOnlyContacts += Number(contact.sent > 0 && contact.received === 0);
    metrics.receivedOnlyContacts += Number(contact.received > 0 && contact.sent === 0);
    metrics.knownThreadContactPairs += contact.threads;
    metrics.unresolvedThreadContactMessages += contact.unresolvedThreadMessages;
    metrics.invalidDateContactMessages += contact.invalidDateMessages;
    metrics.inferredReplyIntervals += contact.replies;
    if (contact.firstContactAt !== undefined) {
        metrics.firstContactAt = Math.min(metrics.firstContactAt ?? contact.firstContactAt, contact.firstContactAt);
    }
    if (contact.lastContactAt !== undefined) {
        metrics.lastContactAt = Math.max(metrics.lastContactAt ?? contact.lastContactAt, contact.lastContactAt);
    }
}
/** Own local output: final contact tallies only, partitioned by account and import request. */
export class IndexedDbContactOutput implements ContactOutput {
    private database?: Promise<IDBDatabase>;
    constructor(private accountKey: string, private requestId: string) { }
    private db(): Promise<IDBDatabase> {
        if (!this.database)
            this.database = new Promise((resolve, reject) => {
                const request = indexedDB.open('mighty-mailbox-local-output', 1);
                request.onupgradeneeded = () => {
                    request.result.createObjectStore('contacts', { keyPath: 'key' });
                    request.result.createObjectStore('imports', { keyPath: 'key' });
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
                request.onblocked = () => reject(new Error('Local output database blocked'));
            });
        return this.database;
    }
    private async transaction(stores: string[], operation: (tx: IDBTransaction) => void) {
        const db = await this.db();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(stores, 'readwrite');
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(tx.error ?? new Error('Local output transaction aborted'));
            try {
                operation(tx);
            }
            catch (error) {
                tx.abort();
                reject(error);
            }
        });
    }
    private range() {
        return IDBKeyRange.bound([this.accountKey, this.requestId, ''], [this.accountKey, this.requestId, '\uffff']);
    }
    async begin() {
        await this.transaction(['contacts', 'imports'], tx => {
            tx.objectStore('contacts').delete(this.range());
            tx.objectStore('imports').put({ key: [this.accountKey, this.requestId], status: 'importing' });
        });
    }
    async append(contacts: readonly ContactStats[]) {
        if (contacts.length > CONTACT_BATCH_SIZE)
            throw new Error('Contact output batch exceeds bound');
        await this.transaction(['contacts'], tx => {
            const store = tx.objectStore('contacts');
            for (const contact of contacts)
                store.put({ key: [this.accountKey, this.requestId, contact.email], ...contact });
        });
    }
    async commit(summary: MailboxSummary) {
        await this.transaction(['imports'], tx => tx.objectStore('imports').put({
            key: [this.accountKey, this.requestId], status: 'ready', summary,
        }));
    }
    async abort() {
        if (!this.database)
            return;
        await this.transaction(['contacts', 'imports'], tx => {
            tx.objectStore('contacts').delete(this.range());
            tx.objectStore('imports').delete([this.accountKey, this.requestId]);
        });
    }
    async close() {
        if (this.database)
            (await this.database).close();
    }
}
/** File/Blob stays inside the worker. Returns no address/ID/header fields or per-contact rows. */
export async function parseFile(file: ByteSource, options: ParseFileOptions): Promise<MailboxWorkerResult> {
    if (!options.accountKey?.trim() || !options.requestId?.trim())
        throw new Error('Local import identity required');
    const sink = options.createSink?.() ?? new IndexedDbMetadataSink();
    const output = options.contactOutput ?? new IndexedDbContactOutput(options.accountKey, options.requestId);
    let result: MboxResult | undefined;
    try {
        checkAbort(options.signal);
        await output.begin();
        result = await parseMbox(file, {
            sink, ownAddresses: options.ownAddresses, accountHolderName: options.accountHolderName,
            sentLabels: options.sentLabels, draftLabels: options.draftLabels,
            signal: options.signal, onProgress: options.onProgress,
        });
        // Preserve unique-message timing; summing contact histograms would double-count recipients.
        const globalMetrics: MailboxGlobalMetrics = {
            ...emptyGlobalMetrics(), ...result.outboundTiming,
            outboundUtcWeekdayCounts: [...result.outboundTiming.outboundUtcWeekdayCounts],
            outboundUtcHourCounts: [...result.outboundTiming.outboundUtcHourCounts],
        };
        let batch: ContactStats[] = [];
        let contacts = 0;
        for await (const contact of result.contacts()) {
            checkAbort(options.signal);
            addContactToGlobal(globalMetrics, contact);
            contacts++;
            batch.push(contact);
            if (batch.length === CONTACT_BATCH_SIZE) {
                await output.append(batch);
                batch = [];
            }
        }
        if (batch.length)
            await output.append(batch);
        if (contacts !== result.totals.contacts)
            throw new Error('Contact summary count mismatch');
        const samples = result.samples.map(sample => sample.text);
        if (samples.length > 40)
            throw new Error('Sample count exceeds bound');
        const summary: MailboxSummary = {
            schemaVersion: 1, sourceBytes: file.size, counts: { ...result.totals }, globalMetrics,
            sampleCount: samples.length, warnings: { ...result.diagnostics.warnings },
        };
        checkAbort(options.signal);
        await output.commit(summary);
        checkAbort(options.signal);
        // Dispose transient IDs/events/intervals and intermediate contact tallies only after output exists.
        await result.dispose();
        checkAbort(options.signal);
        return { summary, samples };
    }
    catch (error) {
        await output.abort().catch(() => { });
        await sink.dispose().catch(() => { });
        throw error;
    }
    finally {
        await output.close();
    }
}
export type MboxWorkerRequest = {
    type: 'parse';
    requestId: string;
    file: File;
    accountKey: string;
    ownAddresses?: string[];
    accountHolderName?: string;
    sentLabels?: string[];
    draftLabels?: string[];
} | {
    type: 'cancel';
    requestId: string;
};
export type MboxWorkerResponse = {
    type: 'progress';
    requestId: string;
    progress: Parameters<NonNullable<MboxOptions['onProgress']>>[0];
} | {
    type: 'complete';
    requestId: string;
    result: MailboxWorkerResult;
} | {
    type: 'cancelled';
    requestId: string;
} | {
    type: 'error';
    requestId: string;
    code: 'busy' | 'invalid_request' | 'quota_exceeded' | 'import_failed';
    message: string;
};
export interface MboxWorkerScope {
    onmessage: ((event: {
        data: unknown;
    }) => void) | null;
    postMessage(message: MboxWorkerResponse): void;
}
/** Error messages are fixed strings; raw parser exceptions and mail content never get logged or posted. */
export function installMboxWorker(scope: MboxWorkerScope, run: typeof parseFile = parseFile): void {
    let active: {
        requestId: string;
        controller: AbortController;
    } | undefined;
    scope.onmessage = event => {
        const message = event.data as Partial<MboxWorkerRequest> | null;
        if (!message || typeof message.requestId !== 'string')
            return;
        const requestId = message.requestId;
        if (message.type === 'cancel') {
            if (active?.requestId === requestId)
                active.controller.abort();
            return;
        }
        if (message.type !== 'parse' || !(message.file instanceof Blob) || typeof message.accountKey !== 'string') {
            scope.postMessage({ type: 'error', requestId, code: 'invalid_request', message: 'The mailbox request was not valid.' });
            return;
        }
        if (active) {
            scope.postMessage({ type: 'error', requestId, code: 'busy', message: 'A mailbox import is already running.' });
            return;
        }
        const controller = new AbortController();
        active = { requestId, controller };
        let lastProgressAt = 0, lastPhase = '';
        const onProgress: NonNullable<MboxOptions['onProgress']> = progress => {
            const now = Date.now();
            if (progress.phase !== lastPhase || now - lastProgressAt >= 200 || (progress.phase === 'headers' && progress.bytesRead === progress.totalBytes)) {
                lastProgressAt = now;
                lastPhase = progress.phase;
                scope.postMessage({ type: 'progress', requestId, progress });
            }
        };
        void run(message.file, {
            accountKey: message.accountKey, requestId, ownAddresses: message.ownAddresses,
            accountHolderName: message.accountHolderName, sentLabels: message.sentLabels,
            draftLabels: message.draftLabels, signal: controller.signal, onProgress,
        }).then(result => {
            scope.postMessage({ type: 'complete', requestId, result });
        }).catch(error => {
            if (controller.signal.aborted || error?.name === 'AbortError') {
                scope.postMessage({ type: 'cancelled', requestId });
            }
            else if (error?.name === 'QuotaExceededError') {
                scope.postMessage({ type: 'error', requestId, code: 'quota_exceeded', message: 'This device does not have enough local storage for the mailbox.' });
            }
            else {
                scope.postMessage({ type: 'error', requestId, code: 'import_failed', message: 'The mailbox import could not be completed.' });
            }
        }).finally(() => { active = undefined; });
    };
}
const workerScope = globalThis as unknown as MboxWorkerScope;
if (typeof workerScope.postMessage === 'function' && !('document' in globalThis))
    installMboxWorker(workerScope);
