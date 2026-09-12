import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFile, installMboxWorker, CONTACT_BATCH_SIZE, type ContactOutput, type MailboxSummary, type MboxWorkerResponse, type MboxWorkerScope } from '../src/lib/mbox.worker.ts';
import { parseMbox, MemoryMetadataSink, aggregateMetadata, decodeHeaderWords, parseAddresses, MBOX_CHUNK_BYTES, type MboxOptions, type ByteSource, type ContactStats, type PairEvent, type MessageEvent, type MboxProgress, stripQuotedRepliesAndSignature, sliceTextSafely } from '../src/lib/mbox.ts';
const enc = new TextEncoder();
const epoch = Date.UTC(2026, 8, 12, 12, 0, 0);
type MailOptions = {
    id?: string;
    label?: string | null;
    thread?: string | null;
    date?: number | string;
    from?: string;
    to?: string;
    cc?: string;
    bcc?: string;
    body?: string;
    type?: string;
    encoding?: string;
    extra?: string;
    newline?: string;
};
function mail(o: MailOptions = {}) {
    const sent = (o.label ?? 'Sent').includes('Sent');
    const headers = [
        'From: ' + (o.from ?? (sent ? 'me@example.com' : 'person@example.com')),
        'To: ' + (o.to ?? (sent ? 'person@example.com' : 'me@example.com')),
        'Date: ' + (typeof o.date === 'string' ? o.date : new Date(o.date ?? epoch).toUTCString()),
        'Message-ID: <' + (o.id ?? 'a') + '@example.com>',
    ];
    if (o.label !== null)
        headers.push('X-Gmail-Labels: ' + (o.label ?? 'Sent'));
    if (o.thread !== null)
        headers.push('X-GM-THRID: ' + (o.thread ?? '123'));
    if (o.cc)
        headers.push('Cc: ' + o.cc);
    if (o.bcc)
        headers.push('Bcc: ' + o.bcc);
    headers.push('Content-Type: ' + (o.type ?? 'text/plain; charset=UTF-8'));
    if (o.encoding)
        headers.push('Content-Transfer-Encoding: ' + o.encoding);
    if (o.extra)
        headers.push(o.extra);
    return ('From sender@example.com Sat Sep 12 12:00:00 2026\n' + headers.join('\n') + '\n\n' + (o.body ?? 'Hello there') + '\n\n').replace(/\n/g, o.newline ?? '\n');
}
async function parse(text: string, opts: Partial<MboxOptions> = {}) { return parseMbox(new Blob([text]), { sink: new MemoryMetadataSink(), ownAddresses: ['me@example.com'], ...opts }); }
async function contacts(result: Awaited<ReturnType<typeof parse>>) {
    const out: ContactStats[] = [];
    for await (const c of result.contacts())
        out.push(c);
    return out;
}
class VirtualSource implements ByteSource {
    private scratch = new Uint8Array(0);
    reads = 0;
    maxRead = 0;
    maxOffset = 0;
    constructor(readonly size: number, private overlays: {
        at: number;
        bytes: Uint8Array;
    }[]) { }
    slice(start: number, end: number) {
        assert.ok(end - start <= MBOX_CHUNK_BYTES);
        assert.ok(start >= 0 && end <= this.size);
        this.reads++;
        this.maxRead = Math.max(this.maxRead, end - start);
        this.maxOffset = Math.max(this.maxOffset, start);
        return { arrayBuffer: async () => {
                if (this.scratch.length !== end - start)
                    this.scratch = new Uint8Array(end - start);
                this.scratch.fill(32);
                for (const item of this.overlays) {
                    const lo = Math.max(start, item.at), hi = Math.min(end, item.at + item.bytes.length);
                    if (hi > lo)
                        this.scratch.set(item.bytes.subarray(lo - item.at, hi - item.at), lo - start);
                }
                return this.scratch.buffer as ArrayBuffer;
            } };
    }
}
class CountContactOutput implements ContactOutput {
    rows = 0;
    batches = 0;
    maxBatch = 0;
    begun = false;
    committed = false;
    aborted = false;
    closed = false;
    async begin() { this.begun = true; }
    async append(rows: readonly ContactStats[]) { assert.ok(rows.length <= CONTACT_BATCH_SIZE); assert.ok(rows.every(r => r.email.includes('@'))); this.rows += rows.length; this.batches++; this.maxBatch = Math.max(this.maxBatch, rows.length); }
    async commit(summary: MailboxSummary) { this.committed = true; assert.equal(summary.counts.contacts, this.rows); }
    async abort() { this.aborted = true; this.rows = 0; }
    async close() { this.closed = true; }
}
test('01 empty file produces no messages or samples', async () => { const r = await parse(''); assert.equal(r.totals.messages, 0); assert.deepEqual(r.samples, []); });
test('02 final message without newline is counted once', async () => { const r = await parse(mail().trimEnd()); assert.equal(r.totals.messages, 1); assert.equal(r.samples[0].text, 'Hello there'); });
test('03 LF and CRLF archives are equivalent', async () => { const a = await parse(mail()), b = await parse(mail({ newline: '\r\n' })); assert.deepEqual(a.totals, b.totals); assert.deepEqual(a.samples, b.samples); });
test('04 separators split at every tiny chunk size remain two messages', async () => {
    for (let chunkBytes = 1; chunkBytes <= 55; chunkBytes++) {
        const r = await parse(mail() + mail({ id: 'b' }), { chunkBytes });
        assert.equal(r.totals.messages, 2, 'chunk ' + chunkBytes);
    }
});
test('05 CRLF split into one-byte reads has no phantom messages', async () => { const r = await parse(mail({ newline: '\r\n' }) + mail({ id: 'b', newline: '\r\n' }), { chunkBytes: 1 }); assert.equal(r.totals.messages, 2); assert.equal(r.samples[1].text, 'Hello there'); });
test('06 split header/body delimiter preserves direction and body start', async () => { const r = await parse(mail({ body: 'FIRST BODY BYTE' }), { chunkBytes: 3 }); assert.equal(r.totals.sent, 1); assert.equal(r.samples[0].text, 'FIRST BODY BYTE'); });
test('07 split UTF-8 retains multibyte headers and sent bodies', async () => {
    for (const chunkBytes of [1, 2, 3, 5, 7, 11]) {
        const r = await parse(mail({ extra: 'Subject: Grüße 👋 नमस्ते', body: 'Café 👋 नमस्ते' }), { chunkBytes });
        assert.equal(r.samples[0].text, 'Café 👋 नमस्ते');
    }
});
test('08 64MiB physical received line uses bounded carry', async () => { const head = enc.encode(mail({ label: 'Inbox', body: '' }).trimEnd() + '\n\n'), tail = enc.encode('\n\n'); const size = 64 * 1024 * 1024 + head.length + tail.length; const source = new VirtualSource(size, [{ at: 0, bytes: head }, { at: size - tail.length, bytes: tail }]); const r = await parseMbox(source, { sink: new MemoryMetadataSink() }); assert.equal(r.totals.received, 1); assert.ok(r.diagnostics.maxLineCarryBytes <= 512); assert.equal(r.diagnostics.decodedSentBodyBytes, 0); });
test('09 synthetic 6GiB reads preserve offsets above 2^32 with no huge allocation', async () => { const head = enc.encode(mail({ label: 'Inbox', body: '' }).trimEnd() + '\n\n'), tail = enc.encode('\n\n' + mail({ id: 'last', body: 'At the end' })); const size = 6 * 1024 ** 3; const source = new VirtualSource(size, [{ at: 0, bytes: head }, { at: size - tail.length, bytes: tail }]); let earlyReceived = false; let finalProgress: MboxProgress | undefined; const r = await parseMbox(source, { sink: new MemoryMetadataSink(), ownAddresses: ['me@example.com'], onProgress: progress => { if (progress.phase === 'headers' && progress.counts.received === 1 && progress.bytesRead <= MBOX_CHUNK_BYTES)
        earlyReceived = true; finalProgress = progress; } }); assert.equal(r.totals.messages, 2); assert.equal(r.samples[0].text, 'At the end'); assert.ok(source.maxOffset > 2 ** 32); assert.equal(source.maxRead, MBOX_CHUNK_BYTES); assert.ok(r.diagnostics.maxLineCarryBytes <= 512); assert.equal(earlyReceived, true); assert.equal(finalProgress?.counts.messages, 2); assert.equal(finalProgress?.counts.sent, 1); assert.equal(finalProgress?.counts.received, 1); assert.equal(finalProgress?.counts.contacts, 1); assert.equal(finalProgress?.aggregation?.contactMessagesProcessed, 2); assert.equal(finalProgress?.aggregation?.knownThreadContactPairs, 1); });
test('10 mbox escapes and plain reply/signature markers retain only leading authored text', async () => {
    const r = await parse(mail({ body: '>From person@example.com Sat Sep 12 12:00:00 2026\n>>From quoted\nend' }));
    assert.equal(r.totals.messages, 1);
    assert.equal(r.samples[0].text, 'From person@example.com Sat Sep 12 12:00:00 2026');
    for (const marker of ['> quoted text', 'On Monday, sender wrote:', 'On Monday,\nsender\nwrote:', '-----Original Message-----', '---------- Forwarded message ---------', 'Begin forwarded message:', 'From: someone@example.com', 'Sent: Monday', 'To: someone@example.com', 'Subject: reply', '-- ', 'Sent from my phone', 'Best regards,', 'Thanks', 'Account Holder']) {
        const clean = await parse(mail({ body: 'My own words\n' + marker + '\nPRIVATE QUOTED OR SIGNATURE MATERIAL' }), { accountHolderName: 'Account Holder' });
        assert.equal(clean.samples[0].text, 'My own words', marker);
    }
    assert.equal(stripQuotedRepliesAndSignature('My text\u0000\nCheers,\nMy title'), 'My text');
});
test('11 ordinary From prose does not split a message', async () => { const r = await parse(mail({ body: 'From yesterday we have an update\nFrom someone@example.com today' })); assert.equal(r.totals.messages, 1); assert.match(r.samples[0].text, /From yesterday/); });
test('12 folded case-insensitive headers preserve metadata', async () => { const text = mail().replace('X-Gmail-Labels: Sent', 'x-gMAIL-labels: Important,\n\tSent').replace('To: person@example.com', 'tO: Person <person@example.com>,\n other@example.com'); const r = await parse(text); assert.equal(r.totals.sent, 1); assert.deepEqual((await contacts(r)).map(c => c.email), ['other@example.com', 'person@example.com']); });
test('13 RFC2047 Q correctly decodes underscores and hex octets', () => { assert.equal(decodeHeaderWords('=?UTF-8?Q?Caf=C3=A9_and_tea?='), 'Café and tea'); });
test('14 adjacent RFC2047 B words join without inserted whitespace', () => { const a = Buffer.from('Hello ').toString('base64'), b = Buffer.from('世界').toString('base64'); assert.equal(decodeHeaderWords('=?UTF-8?B?' + a + '?=\r\n\t=?UTF-8?B?' + b + '?='), 'Hello 世界'); });
test('15 unknown charsets and malformed encoded words preserve recoverable original', () => { const warnings: string[] = []; const a = '=?madeup?Q?hello?=', b = '=?UTF-8?B?@@@@?='; assert.equal(decodeHeaderWords(a, c => warnings.push(c)), a); assert.equal(decodeHeaderWords(b, c => warnings.push(c)), b); assert.equal(warnings.length, 2); });
test('16 exact Sent label does not match Sentiment', async () => { const r = await parse(mail({ label: 'Sentiment' }) + mail({ id: 'b', label: 'Important, Sent' })); assert.equal(r.totals.sent, 1); assert.equal(r.totals.received, 1); assert.equal(r.samples.length, 1); });
test('17 Inbox from own address never acquires sent-body permission', async () => { const r = await parse(mail({ label: 'Inbox', from: 'me@example.com' })); assert.equal(r.totals.received, 1); assert.equal(r.samples.length, 0); assert.equal(r.diagnostics.decodedBodyMessages, 0); });
test('18 Sent and Inbox together count a single sent message', async () => { const r = await parse(mail({ label: 'Sent, Inbox' })); assert.equal(r.totals.sent, 1); assert.equal(r.totals.received, 0); assert.equal(r.samples.length, 1); });
test('19 draft and missing direction evidence never enter samples', async () => { const r = await parse(mail({ label: 'Drafts' }) + mail({ id: 'b', label: null }) + mail({ id: 'c', label: 'Sent, Drafts' })); assert.equal(r.totals.draft, 2); assert.equal(r.totals.unknown, 1); assert.equal(r.samples.length, 0); assert.equal(r.diagnostics.decodedSentBodyBytes, 0); });
test('20 quoted commas, groups, duplicates and aliases give correct contacts', async () => { assert.deepEqual(parseAddresses('"Last, First" <person@example.com>, Team: other@example.com;'), ['person@example.com', 'other@example.com']); const r = await parse(mail({ to: '"Last, First" <person@example.com>, Team: other@example.com;', cc: 'PERSON@example.com, alias@example.com' }), { ownAddresses: ['me@example.com', 'alias@example.com'] }); const c = await contacts(r); assert.equal(c.length, 2); assert.equal(c[1].sent, 1); assert.equal(r.outboundTiming.outboundMessagesWithValidDate, 1); assert.equal(r.outboundTiming.outboundUtcWeekdayCounts[6], 1); assert.equal(r.outboundTiming.outboundUtcHourCounts[12], 1); assert.ok(c.every(row => row.outboundUtcHourCounts[12] === 1)); });
test('21 unsigned64 Gmail thread IDs never round into one thread', async () => { const r = await parse(mail({ thread: '9007199254740992' }) + mail({ id: 'b', thread: '9007199254740993' })); assert.equal((await contacts(r))[0].threads, 2); assert.notEqual(r.samples[0].threadId, r.samples[1].threadId); const normalized = await parse(mail({ thread: '00123' }) + mail({ id: 'b', thread: '123' })); assert.equal((await contacts(normalized))[0].threads, 1); });
test('22 absent thread IDs remain explicitly unresolved', async () => { const r = await parse(mail({ thread: null }) + mail({ id: 'b', thread: null })); const c = (await contacts(r))[0]; assert.equal(c.threads, 0); assert.equal(c.unresolvedThreadMessages, 2); assert.equal(c.replies, 0); });
test('23 quoted-printable soft breaks and hex survive boundaries', async () => {
    for (const chunkBytes of [1, 2, 7, 31]) {
        const r = await parse(mail({ encoding: 'quoted-printable', body: 'Hello=\r\nworld=20=C3=A9' }), { chunkBytes });
        assert.equal(r.samples[0].text, 'Helloworld é');
    }
});
test('24 base64 whitespace, quartet splits and padding decode', async () => { const body = Buffer.from('Padded text 👋').toString('base64').match(/.{1,3}/g)!.join('\r\n'); const r = await parse(mail({ encoding: 'base64', body }), { chunkBytes: 2 }); assert.equal(r.samples[0].text, 'Padded text 👋'); });
test('25 quoted-printable body underscores are literal', async () => { const r = await parse(mail({ encoding: 'quoted-printable', body: 'a_b=20c_d' })); assert.equal(r.samples[0].text, 'a_b c_d'); });
test('26 nested multipart prefers plain text and excludes attachments', async () => { const body = ['--outer', 'Content-Type: text/plain', 'Content-Disposition: attachment; filename=\"secret.txt\"', '', 'SECRET ATTACHMENT', '--outer', 'Content-Type: multipart/alternative; boundary=\"inner\"', '', '--inner', 'Content-Type: text/html', '', '<p>HTML VERSION</p>', '--inner', 'Content-Type: text/plain', '', 'PLAIN VERSION', '--inner--', '--outer--'].join('\n'); const r = await parse(mail({ type: 'multipart/mixed; boundary=\"outer\"', body })); assert.equal(r.samples[0].text, 'PLAIN VERSION'); assert.equal(r.samples[0].contentType, 'text/plain'); assert.equal(r.diagnostics.maxMimeDepth, 2); });
test('27 nested HTML-only extraction is inert and preserves text/entities/spacing', async () => {
    const body = ['--outer', 'Content-Type: multipart/alternative; boundary=\"inner\"', '', '--inner', 'Content-Type: text/html; charset=UTF-8', '', '<html><head><style>BAD STYLE</style></head><body><p>Hello &amp; welcome</p><script>BAD SCRIPT</script><p>Next&#32;line<img src=\"https://invalid.example/pixel\"></p></body></html>', '--inner--', '--outer--'].join('\n');
    const r = await parse(mail({ type: 'multipart/mixed; boundary=outer', body }), { chunkBytes: 7 });
    assert.equal(r.samples[0].text, 'Hello & welcome\n\nNext line');
    assert.doesNotMatch(r.samples[0].text, /BAD|pixel/);
    for (const marker of ['<blockquote>', '<div class="gmail_quote">', '<div class="gmail_signature">', '<div class="yahoo_quoted">']) {
        const quoted = await parse(mail({ type: 'text/html', body: '<p>My own words</p>' + marker + 'PRIVATE QUOTED MATERIAL</div><p>Late text</p>' }));
        assert.equal(quoted.samples[0].text, 'My own words');
    }
});
test('28 quoted MIME boundaries match full lines, not prefixes, across chunks', async () => { const body = '--a;b\nContent-Type: text/plain\n\ntext\n--a;bPREFIX\nstill body\n--a;b--'; const r = await parse(mail({ type: 'multipart/mixed; boundary=\"a;b\"', body }), { chunkBytes: 3 }); assert.equal(r.samples[0].text, 'text\n--a;bPREFIX\nstill body'); });
test('29 malformed MIME cannot swallow the next mbox message', async () => { const body = '--outer\nContent-Type: text/plain\nContent-Transfer-Encoding: quoted-printable\n\nbad=XY'; const r = await parse(mail({ type: 'multipart/mixed; boundary=outer', body }) + mail({ id: 'next', body: 'next message' }), { chunkBytes: 7 }); assert.equal(r.totals.messages, 2); assert.equal(r.samples[1].text, 'next message'); assert.ok(r.diagnostics.warnings['unclosed-multipart'] > 0); assert.ok(r.diagnostics.warnings['malformed-transfer-encoding'] > 0); });
test('30 embedded message/rfc822 bodies never become samples', async () => { const body = '--x\nContent-Type: message/rfc822\n\nFrom: stranger@example.com\n\nEMBEDDED RECEIVED BODY\n--x\nContent-Type: text/plain\n\nMy own words\n--x--'; const r = await parse(mail({ type: 'multipart/mixed; boundary=x', body })); assert.equal(r.samples[0].text, 'My own words'); assert.doesNotMatch(JSON.stringify(r.samples), /EMBEDDED/); });
test('31 seeded reservoir keeps at most40 bounded sent samples', async () => {
    const text = Array.from({ length: 150 }, (_, i) => mail({ id: 'id' + i, body: 'Message ' + i + ' ' + '.'.repeat(500) })).join('');
    const a = await parse(text, { seed: 123, maxSampleChars: 40 }), b = await parse(text, { seed: 123, maxSampleChars: 40 });
    assert.equal(a.samples.length, 40);
    assert.deepEqual(a.samples, b.samples);
    assert.ok(a.samples.every(s => s.text.length <= 40 && s.truncated));
    assert.equal(a.diagnostics.maxSampleCount, 40);
    assert.equal(a.diagnostics.decodedBodyMessages, 40);
    const zero = await parse(text, { seed: 0, maxSampleChars: 40 });
    assert.equal(zero.samples.length, 40);
    assert.ok(new Set(zero.samples.map(s => s.messageKey)).size === 40);
    const emoji = await parse(mail({ body: 'abc👋tail' }), { maxSampleChars: 4 });
    assert.equal(emoji.samples[0].text, 'abc');
    assert.equal(emoji.samples[0].truncated, true);
    assert.equal(sliceTextSafely('👋', 1), '');
    const finalCap = await parse(mail({ body: 'a'.repeat(11999) + '👋tail' }));
    assert.equal(finalCap.samples[0].text.length, 11999);
    assert.equal(finalCap.samples[0].text.isWellFormed(), true);
});
test('32 duplicate Message-ID is counted and sampled once', async () => { const r = await parse(mail() + mail()); assert.equal(r.totals.messages, 1); assert.equal(r.totals.duplicates, 1); assert.equal(r.samples.length, 1); assert.equal((await contacts(r))[0].sent, 1); assert.equal(r.outboundTiming.outboundMessagesWithValidDate, 1); assert.equal(r.outboundTiming.outboundUtcHourCounts[12], 1); });
test('33 archive ordering does not change chronological reply metrics', async () => { const a = mail({ id: 'r', label: 'Inbox', date: epoch }), b = mail({ id: 's', date: epoch + 5000 }); const x = await contacts(await parse(a + b)), y = await contacts(await parse(b + a)); assert.deepEqual(x, y); assert.equal(x[0].medianReplyMs, 5000); });
test('34 distinct threads and actual UTC sent-time histograms stay exact', async () => {
    const r = await parse(mail() + mail({ id: 'b' }) + mail({ id: 'c', thread: '999' }));
    const c = (await contacts(r))[0];
    assert.equal(c.sent, 3);
    assert.equal(c.threads, 2);
    const timed = await parse(mail({ id: 'm1', date: 'Mon, 14 Sep 2026 18:00:00 -0400' }) + mail({ id: 'm2', date: 'Mon, 14 Sep 2026 22:30:00 +0000' }) + mail({ id: 'f1', date: 'Fri, 18 Sep 2026 08:00:00 +0000' }) + mail({ id: 'bad', date: 'invalid date' }) + mail({ id: 'received', label: 'Inbox', date: epoch }));
    const time = (await contacts(timed))[0];
    assert.equal(time.sent, 4);
    assert.equal(time.received, 1);
    assert.equal(time.invalidDateMessages, 1);
    assert.deepEqual(time.outboundUtcWeekdayCounts, [0, 2, 0, 0, 0, 1, 0]);
    assert.equal(time.outboundUtcHourCounts.length, 24);
    assert.equal(time.outboundUtcHourCounts[22], 2);
    assert.equal(time.outboundUtcHourCounts[8], 1);
    assert.equal(time.outboundUtcHourCounts[12], 0);
    assert.equal(time.outboundMessagesWithValidDate, 3);
    assert.equal(time.mostCommonSentUtcWeekday, 1);
    assert.equal(time.mostCommonSentUtcHour, 22);
    const noTiming = (await contacts(await parse(mail({ date: 'invalid date' }))))[0];
    assert.equal(noTiming.mostCommonSentUtcHour, undefined);
    assert.equal(noTiming.outboundMessagesWithValidDate, 0);
    assert.ok(noTiming.outboundUtcWeekdayCounts.every(n => n === 0));
    const tie = (await contacts(await parse(mail({ id: 't1', date: 'Tue, 15 Sep 2026 16:00:00 +0000' }) + mail({ id: 't2', date: 'Mon, 14 Sep 2026 08:00:00 +0000' }))))[0];
    assert.equal(tie.mostCommonSentUtcWeekday, 1);
    assert.equal(tie.mostCommonSentUtcHour, 8);
});
test('35 received run followed by sent reply produces one latest-received interval', async () => { const r = await parse(mail({ id: 'r1', label: 'Inbox', date: epoch }) + mail({ id: 'r2', label: 'Inbox', date: epoch + 10000 }) + mail({ id: 's1', date: epoch + 30000 }) + mail({ id: 's2', date: epoch + 40000 })); const c = (await contacts(r))[0]; assert.equal(c.replies, 1); assert.equal(c.medianReplyMs, 20000); });
test('36 exact odd/even medians use all derived intervals', async () => {
    for (const durations of [[1000, 5000, 9000], [1000, 3000]]) {
        const text = durations.map((ms, i) => mail({ id: 'r' + i, label: 'Inbox', thread: String(i + 1), date: epoch }) + mail({ id: 's' + i, thread: String(i + 1), date: epoch + ms })).join('');
        const c = (await contacts(await parse(text)))[0];
        assert.equal(c.medianReplyMs, durations.length === 3 ? 5000 : 2000);
    }
});
test('37 received canaries reach no body decoder, sink values, or output', async () => {
    const written: unknown[] = [];
    class SpySink extends MemoryMetadataSink {
        override async putMessage(e: MessageEvent, own: ReadonlySet<string>) { written.push(structuredClone(e)); return super.putMessage(e, own); }
    }
    let bodyCalls = 0;
    const r = await parse(mail({ label: 'Inbox', body: 'RECEIVED_SECRET_CANARY\nContent-Type: text/html\n<script>CANARY</script>' }) + mail({ id: 'b', label: 'Inbox', encoding: 'base64', body: Buffer.from('RECEIVED_SECRET_CANARY').toString('base64') }), { sink: new SpySink(), onDecode: (scope) => {
            if (scope === 'sent-body')
                bodyCalls++;
        } });
    assert.equal(bodyCalls, 0);
    assert.equal(r.diagnostics.decodedBodyMessages, 0);
    assert.doesNotMatch(JSON.stringify(written) + JSON.stringify(r), /RECEIVED_SECRET_CANARY/);
});
test('38 cancellation and capacity errors dispose temporary state and reject success', async () => {
    class Tracked extends MemoryMetadataSink {
        disposed = false;
        override async dispose() { this.disposed = true; await super.dispose(); }
    }
    const aborter = new AbortController(), cancelSink = new Tracked();
    aborter.abort();
    await assert.rejects(parse(mail(), { sink: cancelSink, signal: aborter.signal }), { name: 'AbortError' });
    assert.ok(cancelSink.disposed);
    const quotaSink = new Tracked(1);
    await assert.rejects(parse(mail(), { sink: quotaSink }), /limit exceeded/);
    assert.ok(quotaSink.disposed);
    assert.deepEqual(await Array.fromAsync(quotaSink.scanContacts()), []);
    const duringOutput = new AbortController();
    class CancellingOutput extends CountContactOutput {
        override async append(rows: readonly ContactStats[]) { await super.append(rows); duringOutput.abort(); }
    }
    const cancelledOutput = new CancellingOutput();
    await assert.rejects(parseFile(new Blob([mail()]), { accountKey: 'account', requestId: 'cancel', createSink: () => new MemoryMetadataSink(), contactOutput: cancelledOutput, signal: duringOutput.signal }), { name: 'AbortError' });
    assert.ok(cancelledOutput.aborted && cancelledOutput.closed && !cancelledOutput.committed);
    const messages: MboxWorkerResponse[] = [];
    const scope: MboxWorkerScope = { onmessage: null, postMessage: message => { messages.push(message); } };
    installMboxWorker(scope, async (_file, options) => new Promise((_resolve, reject) => { options.signal?.addEventListener('abort', () => reject(new DOMException('CANCELLED RAW CANARY', 'AbortError')), { once: true }); }));
    scope.onmessage!({ data: { type: 'parse', requestId: 'a', accountKey: 'account', file: new Blob([mail()]) } });
    scope.onmessage!({ data: { type: 'parse', requestId: 'b', accountKey: 'account', file: new Blob([mail()]) } });
    scope.onmessage!({ data: { type: 'cancel', requestId: 'a' } });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.ok(messages.some(m => m.type === 'error' && m.code === 'busy'));
    assert.ok(messages.some(m => m.type === 'cancelled' && m.requestId === 'a'));
    assert.doesNotMatch(JSON.stringify(messages), /CANARY/);
    installMboxWorker(scope, async () => { throw new Error('PRIVATE RAW BODY CANARY'); });
    scope.onmessage!({ data: { type: 'parse', requestId: 'c', accountKey: 'account', file: new Blob([mail()]) } });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.ok(messages.some(m => m.type === 'error' && m.code === 'import_failed'));
    assert.doesNotMatch(JSON.stringify(messages), /PRIVATE RAW BODY CANARY/);
});
test('39 streaming aggregate handles100000 distinct threads without retaining events', async () => {
    for (const count of [1000, 100000]) {
        class GeneratedSink extends MemoryMetadataSink {
            maxLive = 0;
            override async *scanPairs(): AsyncIterable<PairEvent> {
                let live = 0;
                for (let i = 0; i < count; i++) {
                    live++;
                    this.maxLive = Math.max(this.maxLive, live);
                    const thread = String(i).padStart(8, '0');
                    yield { key: ['p@example.com', thread, epoch, i], contact: 'p@example.com', thread, knownThread: true, timestamp: epoch, direction: 'sent', ordinal: i };
                    live--;
                }
            }
        }
        const sink = new GeneratedSink();
        let lastAggregate: {
            contactMessagesProcessed: number;
            contactsSeen: number;
            knownThreadContactPairs: number;
        } | undefined;
        assert.equal(await aggregateMetadata(sink, undefined, p => { lastAggregate = p; }), 1);
        assert.equal(lastAggregate?.contactMessagesProcessed, count);
        assert.equal(lastAggregate?.knownThreadContactPairs, count);
        assert.equal(lastAggregate?.contactsSeen, 1);
        const list = await Array.fromAsync(sink.scanContacts());
        assert.equal(list[0].threads, count);
        assert.equal(list[0].sent, count);
        assert.equal(sink.maxLive, 1);
    }
    const output = new CountContactOutput();
    const sent = Array.from({ length: 260 }, (_, i) => mail({ id: 'sent' + i, to: i === 0 ? 'p0@example.com, p1@example.com' : 'p' + i + '@example.com', date: epoch + 1000, body: 'My own words\nThanks,\nPrivate signature' })).join('');
    const received = mail({ id: 'received', label: 'Inbox', from: 'p0@example.com', date: epoch, body: 'RECEIVED BODY CANARY' });
    const result = await parseFile(new Blob([sent + received]), { accountKey: 'PRIVATE ACCOUNT KEY', requestId: 'worker-import', ownAddresses: ['me@example.com'], createSink: () => new MemoryMetadataSink(), contactOutput: output });
    assert.equal(result.summary.counts.messages, 261);
    assert.equal(result.summary.counts.contacts, 260);
    assert.equal(result.summary.globalMetrics.contactSentMessages, 261);
    assert.equal(result.summary.globalMetrics.contactReceivedMessages, 1);
    assert.equal(result.summary.globalMetrics.bidirectionalContacts, 1);
    assert.equal(result.summary.globalMetrics.sentOnlyContacts, 259);
    assert.equal(result.summary.globalMetrics.knownThreadContactPairs, 260);
    assert.equal(result.summary.globalMetrics.inferredReplyIntervals, 1);
    assert.equal(result.summary.globalMetrics.outboundMessagesWithValidDate, 260);
    assert.equal(result.summary.globalMetrics.outboundUtcWeekdayCounts[6], 260);
    assert.equal(result.summary.globalMetrics.outboundUtcHourCounts[12], 260);
    assert.equal(result.summary.globalMetrics.mostCommonSentUtcWeekday, 6);
    assert.equal(result.summary.globalMetrics.mostCommonSentUtcHour, 12);
    assert.equal(result.samples.length, 40);
    assert.ok(result.samples.every(text => text === 'My own words'));
    assert.equal(output.rows, 260);
    assert.equal(output.batches, 3);
    assert.equal(output.maxBatch, 128);
    assert.ok(output.begun && output.committed && output.closed && !output.aborted);
    assert.doesNotMatch(JSON.stringify(result), /p0@example|messageKey|threadId|PRIVATE ACCOUNT KEY|RECEIVED BODY CANARY|Private signature/);
});
