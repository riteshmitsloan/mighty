/** Browser-compatible Gmail/default mbox prototype: no network or raw-body persistence. */
export const MBOX_CHUNK_BYTES = 8 * 1024 * 1024;
export interface ByteSource {
    size: number;
    slice(start: number, end: number): {
        arrayBuffer(): Promise<ArrayBuffer>;
    };
}
export type Direction = 'sent' | 'received' | 'unknown' | 'draft';
export interface MessageEvent {
    key: string;
    ordinal: number;
    direction: Direction;
    threadId?: string;
    timestamp?: number;
    from: string[];
    recipients: string[];
}
export interface PairEvent {
    key: [
        string,
        string,
        number,
        number
    ];
    contact: string;
    thread: string;
    knownThread: boolean;
    timestamp?: number;
    direction: 'sent' | 'received';
    ordinal: number;
}
export interface OutboundTiming {
    /** UTC: Sunday=0 through Saturday=6. Counts actual sent observations, not response success. */
    outboundUtcWeekdayCounts: number[];
    /** UTC hours 0 through 23. */
    outboundUtcHourCounts: number[];
    outboundMessagesWithValidDate: number;
    /** Lowest UTC index wins a tie. Absent when no sent observation has a valid date. */
    mostCommonSentUtcWeekday?: number;
    mostCommonSentUtcHour?: number;
}
export interface MboxCounts {
    messages: number;
    sent: number;
    received: number;
    unknown: number;
    draft: number;
    duplicates: number;
    contacts: number;
}
export interface AggregationProgress {
    contactMessagesProcessed: number;
    contactsSeen: number;
    knownThreadContactPairs: number;
}
export interface MboxProgress {
    phase: 'headers' | 'samples' | 'aggregate';
    bytesRead: number;
    totalBytes: number;
    counts: MboxCounts;
    aggregation?: AggregationProgress;
}
export interface ContactStats extends OutboundTiming {
    email: string;
    sent: number;
    received: number;
    threads: number;
    replies: number;
    unresolvedThreadMessages: number;
    invalidDateMessages: number;
    firstContactAt?: number;
    lastContactAt?: number;
    medianReplyMs?: number;
}
export interface MetadataSink {
    putMessage(event: MessageEvent, own: ReadonlySet<string>): Promise<boolean>;
    /** Sort by contact, thread, timestamp, ordinal; do not buffer the entire scan. */
    scanPairs(): AsyncIterable<PairEvent>;
    putInterval(contact: string, ms: number, ordinal: number): Promise<void>;
    median(contact: string, count: number): Promise<number | undefined>;
    putContact(stats: ContactStats): Promise<void>;
    scanContacts(): AsyncIterable<ContactStats>;
    clearWorking(): Promise<void>;
    dispose(): Promise<void>;
}
export interface Diagnostics {
    warnings: Record<string, number>;
    maxSliceBytes: number;
    maxLineCarryBytes: number;
    maxHeaderBytes: number;
    maxSampleCount: number;
    maxMimeDepth: number;
    decodedSentBodyBytes: number;
    decodedBodyMessages: number;
}
export interface SentSample {
    messageKey: string;
    threadId?: string;
    timestamp?: number;
    text: string;
    contentType: 'text/plain' | 'text/html';
    truncated: boolean;
}
export interface MboxOptions {
    sink: MetadataSink;
    ownAddresses?: string[];
    accountHolderName?: string;
    sentLabels?: string[];
    draftLabels?: string[];
    chunkBytes?: number;
    maxHeaderBytes?: number;
    maxHeaderLineBytes?: number;
    maxSampleChars?: number;
    maxMimeDepth?: number;
    maxMimeParts?: number;
    maxRecipients?: number;
    sampleCount?: number;
    seed?: number;
    signal?: AbortSignal;
    onProgress?: (p: MboxProgress) => void;
    /** Counts/scopes only. No body text is exposed through instrumentation. */
    onDecode?: (scope: 'header' | 'sent-body', byteCount: number) => void;
}
export interface MboxResult {
    totals: MboxCounts;
    /** Global histogram counts each unique sent message once, regardless of recipient count. */
    outboundTiming: OutboundTiming;
    samples: SentSample[];
    diagnostics: Diagnostics;
    contacts(): AsyncIterable<ContactStats>;
    dispose(): Promise<void>;
}
type HeaderMap = Map<string, string>;
type Limits = {
    chunk: number;
    header: number;
    line: number;
    chars: number;
    depth: number;
    parts: number;
    recipients: number;
    samples: number;
};
const UTF8 = new TextEncoder();
const SPACE = (b: number) => b === 32 || b === 9;
function warn(d: Diagnostics, code: string) { d.warnings[code] = (d.warnings[code] ?? 0) + 1; }
function abort(signal?: AbortSignal) {
    if (signal?.aborted)
        throw new DOMException('Import cancelled', 'AbortError');
}
function bounded(value: number | undefined, fallback: number, ceiling = Number.MAX_SAFE_INTEGER) {
    const n = value ?? fallback;
    if (!Number.isSafeInteger(n) || n < 1 || n > ceiling)
        throw new RangeError('Invalid parser limit');
    return n;
}
function asciiEqual(bytes: Uint8Array, text: string) {
    if (bytes.length !== text.length)
        return false;
    for (let i = 0; i < text.length; i++)
        if (bytes[i] !== text.charCodeAt(i))
            return false;
    return true;
}
function digits(bytes: Uint8Array, min: number, max: number) {
    if (!bytes.length || bytes.length > 4)
        return false;
    let n = 0;
    for (const b of bytes) {
        if (b < 48 || b > 57)
            return false;
        n = n * 10 + b - 48;
    }
    return n >= min && n <= max;
}
/** Pure byte framing: candidate received-body lines never go through a TextDecoder. */
export function isMboxSeparator(line: Uint8Array): boolean {
    if (line.length < 24 || line.length > 512 || !asciiEqual(line.subarray(0, 5), 'From '))
        return false;
    const tokens: Uint8Array[] = [];
    for (let i = 5; i < line.length;) {
        while (i < line.length && SPACE(line[i]))
            i++;
        const start = i;
        while (i < line.length && !SPACE(line[i])) {
            if (line[i] < 33 || line[i] > 126)
                return false;
            i++;
        }
        if (i > start)
            tokens.push(line.subarray(start, i));
    }
    if (tokens.length !== 6 && tokens.length !== 7)
        return false;
    const [, day, month, date, time] = tokens;
    return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].some(x => asciiEqual(day, x)) && ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].some(x => asciiEqual(month, x)) && digits(date, 1, 31) && time.length === 8 && time[2] === 58 && time[5] === 58 && digits(time.subarray(0, 2), 0, 23) && digits(time.subarray(3, 5), 0, 59) && digits(time.subarray(6), 0, 60) && digits(tokens[tokens.length - 1], 1900, 9999);
}
interface ByteLine {
    bytes: Uint8Array;
    start: number;
    end: number;
    hadLf: boolean;
    hadCr: boolean;
    truncated: boolean;
    length: number;
}
class Lines {
    private buffer = new Uint8Array(0);
    private used = 0;
    private length = 0;
    private start: number;
    constructor(start: number, private cap: () => number, private d: Diagnostics, private fn: (line: ByteLine) => void | Promise<void>) { this.start = start; }
    private add(bytes: Uint8Array) {
        const cap = this.cap(), take = Math.min(bytes.length, Math.max(0, cap - this.used));
        if (take && this.buffer.length < this.used + take) {
            const next = new Uint8Array(Math.min(cap, Math.max(this.used + take, this.buffer.length * 2, 256)));
            next.set(this.buffer.subarray(0, this.used));
            this.buffer = next;
        }
        if (take)
            this.buffer.set(bytes.subarray(0, take), this.used);
        this.used += take;
        this.length += bytes.length;
        this.d.maxLineCarryBytes = Math.max(this.d.maxLineCarryBytes, this.used);
    }
    private emit(end: number, hadLf: boolean) { const hadCr = this.used === this.length && this.used > 0 && this.buffer[this.used - 1] === 13; const line = { bytes: this.buffer.subarray(0, this.used - (hadCr ? 1 : 0)), start: this.start, end, hadLf, hadCr, truncated: this.length > this.used, length: this.length - (hadCr ? 1 : 0) }; const p = this.fn(line); this.used = 0; this.length = 0; this.start = end; return p; }
    async push(bytes: Uint8Array, offset: number) {
        for (let i = 0; i < bytes.length;) {
            const lf = bytes.indexOf(10, i);
            if (lf < 0) {
                this.add(bytes.subarray(i));
                break;
            }
            this.add(bytes.subarray(i, lf));
            const p = this.emit(offset + lf + 1, true);
            if (p)
                await p;
            i = lf + 1;
        }
    }
    async end(offset: number) {
        if (this.length) {
            const p = this.emit(offset, false);
            if (p)
                await p;
        }
    }
}
async function readRange(source: ByteSource, start: number, end: number, limits: Limits, d: Diagnostics, signal: AbortSignal | undefined, consume: (b: Uint8Array, o: number) => Promise<void>, progress?: (n: number) => void) {
    for (let offset = start; offset < end;) {
        abort(signal);
        const next = Math.min(end, offset + limits.chunk);
        const bytes = new Uint8Array(await source.slice(offset, next).arrayBuffer());
        if (bytes.length !== next - offset)
            throw new Error('Incomplete source byte range');
        d.maxSliceBytes = Math.max(d.maxSliceBytes, bytes.length);
        await consume(bytes, offset);
        offset = next;
        progress?.(offset);
    }
}
class Headers {
    map: HeaderMap = new Map();
    private current = '';
    private size = 0;
    invalid = false;
    constructor(private limits: Limits, private d: Diagnostics, private onDecode?: MboxOptions['onDecode']) { }
    line(line: ByteLine) {
        this.size += line.length + (line.hadCr ? 1 : 0) + (line.hadLf ? 1 : 0);
        this.d.maxHeaderBytes = Math.max(this.d.maxHeaderBytes, Math.min(this.size, this.limits.header));
        if (line.truncated || this.size > this.limits.header) {
            if (!this.invalid)
                warn(this.d, 'header-limit');
            this.invalid = true;
            this.map.clear();
            return;
        }
        if (this.invalid)
            return;
        this.onDecode?.('header', line.bytes.length);
        const text = new TextDecoder('utf-8').decode(line.bytes);
        if (/^[ \t]/.test(text)) {
            if (this.current)
                this.map.set(this.current, (this.map.get(this.current) ?? '') + ' ' + text.trim());
            else
                warn(this.d, 'orphan-header-fold');
            return;
        }
        const at = text.indexOf(':');
        if (at < 1 || !/^[A-Za-z0-9-]+$/.test(text.slice(0, at))) {
            this.current = '';
            warn(this.d, 'malformed-header');
            return;
        }
        this.current = text.slice(0, at).toLowerCase();
        if (this.map.has(this.current) && !['to', 'cc', 'bcc', 'x-gmail-labels'].includes(this.current)) {
            warn(this.d, 'duplicate-header');
            this.current = '';
            return;
        }
        const old = this.map.get(this.current), value = text.slice(at + 1).trim();
        this.map.set(this.current, old === undefined ? value : old + ', ' + value);
    }
}
class TransferDecoder {
    private carry: number[] = [];
    private ended = false;
    constructor(private encoding: string, private emit: (b: Uint8Array) => void, private warning: () => void) { }
    push(bytes: Uint8Array, final = false) {
        if (this.encoding === 'base64') {
            const out: number[] = [];
            for (const b of bytes) {
                if (b === 9 || b === 10 || b === 13 || b === 32)
                    continue;
                if (this.ended) {
                    this.warning();
                    continue;
                }
                const v = b >= 65 && b <= 90 ? b - 65 : b >= 97 && b <= 122 ? b - 71 : b >= 48 && b <= 57 ? b + 4 : b === 43 ? 62 : b === 47 ? 63 : b === 61 ? -1 : -2;
                if (v === -2) {
                    this.warning();
                    continue;
                }
                this.carry.push(v);
                if (this.carry.length === 4) {
                    const [a, c, e, f] = this.carry;
                    this.carry = [];
                    if (a < 0 || c < 0 || (e < 0 && f >= 0)) {
                        this.warning();
                        continue;
                    }
                    out.push((a << 2) | (c >> 4));
                    if (e >= 0)
                        out.push(((c & 15) << 4) | (e >> 2));
                    if (f >= 0 && e >= 0)
                        out.push(((e & 3) << 6) | f);
                    if (e < 0 || f < 0)
                        this.ended = true;
                }
            }
            if (final && this.carry.length) {
                this.warning();
                const [a, c, e] = this.carry;
                if (a >= 0 && c >= 0) {
                    out.push((a << 2) | (c >> 4));
                    if (e >= 0)
                        out.push(((c & 15) << 4) | (e >> 2));
                }
                this.carry = [];
            }
            if (out.length)
                this.emit(Uint8Array.from(out));
            return;
        }
        if (this.encoding === 'quoted-printable') {
            const input = new Uint8Array(this.carry.length + bytes.length);
            input.set(this.carry);
            input.set(bytes, this.carry.length);
            this.carry = [];
            const out: number[] = [];
            const hex = (b: number) => b >= 48 && b <= 57 ? b - 48 : b >= 65 && b <= 70 ? b - 55 : b >= 97 && b <= 102 ? b - 87 : -1;
            for (let i = 0; i < input.length; i++) {
                if (input[i] !== 61) {
                    out.push(input[i]);
                    continue;
                }
                if (i + 1 >= input.length || (input[i + 1] !== 10 && i + 2 >= input.length)) {
                    if (!final) {
                        this.carry = [...input.subarray(i)];
                        break;
                    }
                    this.warning();
                    out.push(...input.subarray(i));
                    break;
                }
                if (input[i + 1] === 10) {
                    i++;
                    continue;
                }
                if (input[i + 1] === 13 && input[i + 2] === 10) {
                    i += 2;
                    continue;
                }
                const a = hex(input[i + 1]), b = hex(input[i + 2]);
                if (a >= 0 && b >= 0) {
                    out.push(a * 16 + b);
                    i += 2;
                }
                else {
                    this.warning();
                    out.push(61);
                }
            }
            if (out.length)
                this.emit(Uint8Array.from(out));
            return;
        }
        this.emit(bytes);
    }
}
export function decodeHeaderWords(value: string, warning: (code: string) => void = () => { }) {
    return value.replace(/(\?=)[ \t\r\n]+(?==\?[^?]+\?[bq]\?)/gi, '$1').replace(/=\?([^?\s]+)\?([bq])\?([^?]*)\?=/gi, (whole, charset: string, kind: string, encoded: string) => {
        try {
            const decoder = new TextDecoder(charset, { fatal: true }), chunks: Uint8Array[] = [];
            let bad = false;
            const transfer = new TransferDecoder(kind.toLowerCase() === 'b' ? 'base64' : 'quoted-printable', b => chunks.push(b), () => { bad = true; });
            transfer.push(UTF8.encode(kind.toLowerCase() === 'q' ? encoded.replace(/_/g, ' ') : encoded), true);
            if (bad) {
                warning('malformed-encoded-word');
                return whole;
            }
            const bytes = new Uint8Array(chunks.reduce((n, b) => n + b.length, 0));
            let at = 0;
            for (const b of chunks) {
                bytes.set(b, at);
                at += b.length;
            }
            return decoder.decode(bytes);
        }
        catch {
            warning('unsupported-header-charset');
            return whole;
        }
    });
}
function splitQuoted(value: string, separators: string) {
    const out: string[] = [];
    let start = 0, quote = false, escape = false, angle = 0, comment = 0;
    for (let i = 0; i < value.length; i++) {
        const c = value[i];
        if (escape) {
            escape = false;
            continue;
        }
        if (c === '\\') {
            escape = true;
            continue;
        }
        if (c === '"' && !comment) {
            quote = !quote;
            continue;
        }
        if (quote)
            continue;
        if (c === '(') {
            comment++;
            continue;
        }
        if (c === ')' && comment) {
            comment--;
            continue;
        }
        if (comment)
            continue;
        if (c === '<')
            angle++;
        if (c === '>')
            angle = Math.max(0, angle - 1);
        if (!angle && separators.includes(c)) {
            out.push(value.slice(start, i));
            start = i + 1;
        }
    }
    out.push(value.slice(start));
    return out;
}
export function parseAddresses(value: string) {
    const found = new Set<string>();
    for (let part of splitQuoted(value, ',;')) {
        const angle = /<([^<>]+)>/.exec(part);
        part = angle ? angle[1] : part.replace(/\([^)]*\)/g, '').replace(/^[^:@<>]*:\s*/, '');
        const match = /^\s*([a-zA-Z0-9.!#$%&'*+\/=?^_{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?)\s*$/.exec(part);
        if (match)
            found.add(match[1].toLowerCase());
    }
    return [...found];
}
function direction(headers: HeaderMap, options: MboxOptions, d: Diagnostics): Direction {
    const value = headers.get('x-gmail-labels');
    if (!value?.trim())
        return 'unknown';
    const labels = new Set(splitQuoted(value, ',').map(v => decodeHeaderWords(v.trim().replace(/^"|"$/g, ''), c => warn(d, c)).toLowerCase()));
    const sent = (options.sentLabels ?? ['Sent', 'Sent Mail', '\\Sent']).some(v => labels.has(v.toLowerCase()));
    const draft = (options.draftLabels ?? ['Draft', 'Drafts', '\\Draft']).some(v => labels.has(v.toLowerCase()));
    if (draft) {
        if (sent)
            warn(d, 'conflicting-direction-labels');
        return 'draft';
    }
    return sent ? 'sent' : 'received';
}
function mimeType(value: string | undefined) {
    const pieces = splitQuoted(value ?? 'text/plain', ';'), params: Record<string, string> = {};
    for (const p of pieces.slice(1)) {
        const m = /^\s*([^=\s]+)\s*=\s*(.*?)\s*$/.exec(p);
        if (m)
            params[m[1].toLowerCase()] = m[2].replace(/^"(.*)"$/s, '$1').replace(/\\(.)/g, '$1');
    }
    return { type: pieces[0].trim().toLowerCase(), params };
}
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', copy: '©', reg: '®', bull: '•' };
function entities(value: string, warning: () => void) {
    return value.replace(/&(#x[\da-f]+|#\d+|[a-z][a-z\d]+);/gi, (whole, key: string) => {
        if (key[0] === '#') {
            const n = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
            return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '�';
        }
        if (ENTITIES[key])
            return ENTITIES[key];
        warning();
        return whole;
    });
}
/** Preserve a complete UTF-16 character at a hard sample boundary. */
export function sliceTextSafely(value: string, limit: number): string {
    const end = Math.min(value.length, Math.max(0, limit));
    const last = value.charCodeAt(end - 1);
    return value.slice(0, last >= 0xd800 && last <= 0xdbff ? end - 1 : end);
}
/** Mirrors src/lib/text.ts cleanup semantics, with a surrogate-safe final cap. */
export function stripQuotedRepliesAndSignature(value: string, accountHolderName?: string): string {
    const clean = (text: string) => text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '');
    const normalized = (text: string) => clean(text).normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
    const withoutHtmlQuotes = clean(value).split(/<blockquote\b|<[^>]*class=["'][^"']*(?:gmail_quote|gmail_signature|yahoo_quoted)[^"']*["']/i)[0];
    const lines = withoutHtmlQuotes.replace(/\r\n?/g, '\n').split('\n');
    const kept: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (i > 0 && accountHolderName && normalized(line) === normalized(accountHolderName))
            break;
        if (/^\s*On\s/i.test(line) && lines.slice(i, i + 4).some(candidate => /wrote:\s*$/i.test(candidate.slice(0, 800))))
            break;
        if (/^\s*>/.test(line)
            || /^\s*On .{1,400}wrote:\s*$/i.test(line)
            || /^\s*-{2,}\s*(original message|forwarded message)/i.test(line)
            || /^\s*(begin forwarded message|from|sent|to|subject):/i.test(line)
            || /^\s*--\s*$/.test(line)
            || /^\s*sent from my\b/i.test(line)
            || /^\s*(best(?: regards| wishes)?|kind regards|regards|sincerely|cheers|thanks|thank you)[,!]?\s*$/i.test(line))
            break;
        kept.push(line);
    }
    return sliceTextSafely(kept.join('\n').trim(), 12000);
}
/** Inert conservative HTML text tokenizer; not a complete HTML5 DOM implementation. */
class HtmlText {
    private tag = '';
    private inTag = false;
    private quote = '';
    private ignored: string[] = [];
    private entityCarry = '';
    private stopped = false;
    constructor(private append: (s: string) => void, private warning: () => void) { }
    private text(s: string, final = false) {
        if (this.ignored.length)
            return;
        s = this.entityCarry + s;
        this.entityCarry = '';
        if (!final) {
            const at = s.lastIndexOf('&');
            if (at >= 0 && s.length - at <= 32 && !s.slice(at).includes(';')) {
                this.entityCarry = s.slice(at);
                s = s.slice(0, at);
            }
        }
        this.append(entities(s, this.warning));
    }
    push(s: string) {
        if (this.stopped)
            return;
        let plain = '';
        for (const c of s) {
            if (!this.inTag) {
                if (c === '<') {
                    this.text(plain);
                    plain = '';
                    this.inTag = true;
                    this.tag = '';
                }
                else
                    plain += c;
                continue;
            }
            if (this.tag.length >= 8192) {
                this.warning();
                this.tag = '';
                this.inTag = false;
                continue;
            }
            this.tag += c;
            if (this.tag.startsWith('!--')) {
                if (this.tag.endsWith('-->')) {
                    this.tag = '';
                    this.inTag = false;
                }
                continue;
            }
            if (this.quote) {
                if (c === this.quote)
                    this.quote = '';
                continue;
            }
            if (c === '"' || c === "'") {
                this.quote = c;
                continue;
            }
            if (c !== '>')
                continue;
            const m = /^\s*(\/?)\s*([a-z][a-z\d:-]*)/i.exec(this.tag);
            this.inTag = false;
            if (!m)
                continue;
            const closing = !!m[1], name = m[2].toLowerCase();
            if (!closing && (name === 'blockquote' || /\bclass\s*=\s*["'][^"']*(?:gmail_quote|gmail_signature|yahoo_quoted)[^"']*["']/i.test(this.tag))) {
                this.stopped = true;
                this.entityCarry = '';
                return;
            }
            if (['script', 'style', 'head', 'iframe', 'svg', 'object', 'blockquote'].includes(name)) {
                if (closing) {
                    const at = this.ignored.lastIndexOf(name);
                    if (at >= 0)
                        this.ignored.splice(at);
                }
                else if (!this.tag.endsWith('/>') && this.ignored.length < 16)
                    this.ignored.push(name);
            }
            if (!this.ignored.length && ['br', 'p', 'div', 'li', 'tr', 'h1', 'h2', 'h3', 'section', 'article', 'hr'].includes(name))
                this.append('\n');
        }
        this.text(plain);
    }
    end() { this.text('', true); }
}
class TextPart {
    text = '';
    truncated = false;
    private decoder: TextDecoder;
    private transfer: TransferDecoder;
    private html?: HtmlText;
    private finishText: () => void;
    private saturated = false;
    constructor(readonly type: 'text/plain' | 'text/html', charset: string, encoding: string, private limits: Limits, private d: Diagnostics, private onDecode?: MboxOptions['onDecode']) {
        try {
            this.decoder = new TextDecoder(charset);
        }
        catch {
            warn(d, 'unsupported-body-charset');
            this.decoder = new TextDecoder('utf-8');
        }
        const append = (s: string) => {
            if (this.saturated)
                return;
            const remaining = limits.chars - this.text.length;
            if (s.length > remaining) {
                this.truncated = true;
                this.saturated = true;
            }
            this.text += sliceTextSafely(s, remaining);
        };
        if (type === 'text/html')
            this.html = new HtmlText(append, () => warn(d, 'html-recovery'));
        const text = (s: string) => {
            if (this.html)
                this.html.push(s);
            else
                append(s);
        };
        this.transfer = new TransferDecoder(encoding, b => { d.decodedSentBodyBytes += b.length; onDecode?.('sent-body', b.length); text(this.decoder.decode(b, { stream: true })); }, () => warn(d, 'malformed-transfer-encoding'));
        this.finishText = () => { text(this.decoder.decode()); this.html?.end(); };
    }
    line(line: ByteLine) {
        if (this.saturated || this.text.length >= this.limits.chars) {
            this.truncated = true;
            return;
        }
        let bytes = line.bytes;
        let gt = 0;
        while (gt < bytes.length && bytes[gt] === 62)
            gt++;
        if (gt > 0 && asciiEqual(bytes.subarray(gt, gt + 5), 'From '))
            bytes = bytes.subarray(1);
        this.transfer.push(bytes);
        if (line.hadLf && !line.truncated)
            this.transfer.push(line.hadCr ? new Uint8Array([13, 10]) : new Uint8Array([10]));
        if (line.truncated) {
            this.truncated = true;
            warn(this.d, 'sample-line-truncated');
        }
    }
    end() { this.transfer.push(new Uint8Array(), true); this.finishText(); this.text = this.text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(); }
}
interface Candidate {
    event: MessageEvent;
    bodyStart: number;
    end: number;
    headers: HeaderMap;
}
function boundaryMatch(bytes: Uint8Array, boundary: string): 'open' | 'close' | undefined {
    const prefix = '--' + boundary;
    if (bytes.length < prefix.length || !asciiEqual(bytes.subarray(0, prefix.length), prefix))
        return;
    let at = prefix.length;
    let type: 'open' | 'close' = 'open';
    if (bytes[at] === 45 && bytes[at + 1] === 45) {
        at += 2;
        type = 'close';
    }
    for (; at < bytes.length; at++)
        if (!SPACE(bytes[at]))
            return;
    return type;
}
async function extractSample(source: ByteSource, candidate: Candidate, limits: Limits, d: Diagnostics, options: MboxOptions): Promise<SentSample | undefined> {
    if (candidate.event.direction !== 'sent')
        throw new Error('Body decoding requires an explicitly sent message');
    d.decodedBodyMessages++;
    const boundaries: string[] = [];
    let phase: 'body' | 'headers' | 'ignore' = 'ignore', partHeaders: Headers | undefined, current: TextPart | undefined, plain: TextPart | undefined, html: TextPart | undefined, parts = 0;
    const finish = () => {
        if (!current)
            return;
        current.end();
        if (current.text) {
            if (current.type === 'text/plain' && !plain)
                plain = current;
            else if (current.type === 'text/html' && !html)
                html = current;
        }
        current = undefined;
    };
    const start = (headers: HeaderMap) => {
        if (++parts > limits.parts) {
            warn(d, 'mime-part-limit');
            phase = 'ignore';
            return;
        }
        const ct = mimeType(headers.get('content-type')), disp = mimeType(headers.get('content-disposition') ?? 'inline');
        if (disp.type === 'attachment' || disp.params.filename || ct.params.name || ct.type === 'message/rfc822') {
            phase = 'ignore';
            return;
        }
        if (ct.type.startsWith('multipart/')) {
            const boundary = ct.params.boundary;
            if (!boundary || boundary.length > 70 || /[^\x20-\x7e]/.test(boundary)) {
                warn(d, 'invalid-mime-boundary');
                phase = 'ignore';
                return;
            }
            if (boundaries.length >= limits.depth) {
                warn(d, 'mime-depth-limit');
                phase = 'ignore';
                return;
            }
            boundaries.push(boundary);
            d.maxMimeDepth = Math.max(d.maxMimeDepth, boundaries.length);
            phase = 'ignore';
            return;
        }
        if ((ct.type === 'text/plain' && !plain) || (ct.type === 'text/html' && !plain && !html)) {
            const encoding = (headers.get('content-transfer-encoding') ?? '8bit').trim().toLowerCase();
            if (!['7bit', '8bit', 'binary', 'base64', 'quoted-printable'].includes(encoding)) {
                warn(d, 'unsupported-transfer-encoding');
                phase = 'ignore';
                return;
            }
            current = new TextPart(ct.type as 'text/plain' | 'text/html', ct.params.charset ?? 'utf-8', encoding, limits, d, options.onDecode);
            phase = 'body';
        }
        else
            phase = 'ignore';
    };
    start(candidate.headers);
    const lines = new Lines(candidate.bodyStart, () => phase === 'ignore' ? 512 : limits.line, d, line => {
        for (let i = boundaries.length - 1; i >= 0; i--) {
            const match = !line.truncated ? boundaryMatch(line.bytes, boundaries[i]) : undefined;
            if (!match)
                continue;
            finish();
            boundaries.splice(i + 1);
            if (match === 'close') {
                boundaries.pop();
                phase = 'ignore';
            }
            else {
                phase = 'headers';
                partHeaders = new Headers(limits, d, options.onDecode);
            }
            return;
        }
        if (phase === 'headers') {
            if (!line.length) {
                if (partHeaders && !partHeaders.invalid)
                    start(partHeaders.map);
                else
                    phase = 'ignore';
                partHeaders = undefined;
            }
            else
                partHeaders?.line(line);
        }
        else if (phase === 'body')
            current?.line(line);
    });
    await readRange(source, candidate.bodyStart, candidate.end, limits, d, options.signal, (b, o) => lines.push(b, o));
    await lines.end(candidate.end);
    finish();
    if (boundaries.length)
        warn(d, 'unclosed-multipart');
    const chosen = plain ?? html;
    if (!chosen?.text)
        return;
    const text = stripQuotedRepliesAndSignature(chosen.text, options.accountHolderName);
    if (!text)
        return;
    return { messageKey: candidate.event.key, threadId: candidate.event.threadId, timestamp: candidate.event.timestamp, text, contentType: chosen.type, truncated: chosen.truncated || chosen.text.length > 12000 };
}
export function pairsFor(event: MessageEvent, own: ReadonlySet<string>): PairEvent[] {
    if (event.direction !== 'sent' && event.direction !== 'received')
        return [];
    const contacts = new Set(event.direction === 'sent' ? event.recipients : event.from), out: PairEvent[] = [];
    for (const contact of contacts) {
        if (own.has(contact))
            continue;
        const thread = event.threadId ?? 'unresolved:' + event.key;
        out.push({ key: [contact, thread, event.timestamp ?? Number.MAX_SAFE_INTEGER, event.ordinal], contact, thread, knownThread: !!event.threadId, timestamp: event.timestamp, direction: event.direction, ordinal: event.ordinal });
    }
    return out;
}
export function emptyOutboundTiming(): OutboundTiming {
    return { outboundUtcWeekdayCounts: Array(7).fill(0), outboundUtcHourCounts: Array(24).fill(0), outboundMessagesWithValidDate: 0 };
}
function addOutboundTime(timing: OutboundTiming, timestamp: number): void {
    const date = new Date(timestamp);
    const day = date.getUTCDay(), hour = date.getUTCHours();
    if (!Number.isInteger(day) || !Number.isInteger(hour))
        return;
    timing.outboundUtcWeekdayCounts[day]++;
    timing.outboundUtcHourCounts[hour]++;
    timing.outboundMessagesWithValidDate++;
}
function finalizeOutboundTiming(timing: OutboundTiming): void {
    if (!timing.outboundMessagesWithValidDate)
        return;
    timing.mostCommonSentUtcWeekday = timing.outboundUtcWeekdayCounts.indexOf(Math.max(...timing.outboundUtcWeekdayCounts));
    timing.mostCommonSentUtcHour = timing.outboundUtcHourCounts.indexOf(Math.max(...timing.outboundUtcHourCounts));
}
export async function aggregateMetadata(sink: MetadataSink, signal?: AbortSignal, onProgress?: (progress: AggregationProgress) => void): Promise<number> {
    let stats: ContactStats | undefined, thread = '', pending: number | undefined, count = 0;
    const progress: AggregationProgress = { contactMessagesProcessed: 0, contactsSeen: 0, knownThreadContactPairs: 0 };
    let lastReportAt = 0;
    const report = (force = false) => {
        if (!onProgress)
            return;
        const now = Date.now();
        if (force || progress.contactMessagesProcessed % 1024 === 0 || now - lastReportAt >= 200) {
            lastReportAt = now;
            onProgress({ ...progress });
        }
    };
    const finish = async () => {
        if (!stats)
            return;
        stats.medianReplyMs = await sink.median(stats.email, stats.replies);
        finalizeOutboundTiming(stats);
        await sink.putContact(stats);
        count++;
    };
    for await (const e of sink.scanPairs()) {
        abort(signal);
        if (!stats || stats.email !== e.contact) {
            await finish();
            stats = { email: e.contact, sent: 0, received: 0, threads: 0, replies: 0, unresolvedThreadMessages: 0, invalidDateMessages: 0, ...emptyOutboundTiming() };
            progress.contactsSeen++;
            thread = '';
            pending = undefined;
        }
        if (thread !== e.thread) {
            thread = e.thread;
            pending = undefined;
            if (e.knownThread) {
                stats.threads++;
                progress.knownThreadContactPairs++;
            }
        }
        stats[e.direction]++;
        progress.contactMessagesProcessed++;
        report();
        if (!e.knownThread)
            stats.unresolvedThreadMessages++;
        if (e.timestamp === undefined) {
            stats.invalidDateMessages++;
            continue;
        }
        stats.firstContactAt = Math.min(stats.firstContactAt ?? e.timestamp, e.timestamp);
        stats.lastContactAt = Math.max(stats.lastContactAt ?? e.timestamp, e.timestamp);
        if (e.direction === 'sent')
            addOutboundTime(stats, e.timestamp);
        if (!e.knownThread)
            continue;
        if (e.direction === 'received')
            pending = e.timestamp;
        else if (pending !== undefined) {
            const duration = e.timestamp - pending;
            pending = undefined;
            if (duration >= 0) {
                await sink.putInterval(e.contact, duration, e.ordinal);
                stats.replies++;
            }
        }
    }
    await finish();
    report(true);
    return count;
}
export async function parseMbox(source: ByteSource, options: MboxOptions): Promise<MboxResult> {
    if (!Number.isSafeInteger(source.size) || source.size < 0)
        throw new RangeError('Invalid source size');
    const limits: Limits = { chunk: bounded(options.chunkBytes, MBOX_CHUNK_BYTES, MBOX_CHUNK_BYTES), header: bounded(options.maxHeaderBytes, 128 * 1024), line: bounded(options.maxHeaderLineBytes, 64 * 1024), chars: bounded(options.maxSampleChars, 16 * 1024), depth: bounded(options.maxMimeDepth, 16, 64), parts: bounded(options.maxMimeParts, 128, 4096), recipients: bounded(options.maxRecipients, 1000, 10000), samples: options.sampleCount === 0 ? 0 : bounded(options.sampleCount, 40, 40) };
    const d: Diagnostics = { warnings: {}, maxSliceBytes: 0, maxLineCarryBytes: 0, maxHeaderBytes: 0, maxSampleCount: 0, maxMimeDepth: 0, decodedSentBodyBytes: 0, decodedBodyMessages: 0 };
    const totals: MboxCounts = { messages: 0, sent: 0, received: 0, unknown: 0, draft: 0, duplicates: 0, contacts: 0 };
    const outboundTiming = emptyOutboundTiming();
    const own = new Set((options.ownAddresses ?? []).map(s => s.trim().toLowerCase())), reservoir: Candidate[] = [];
    let lastHeaderReportAt = 0;
    const report = (phase: MboxProgress['phase'], bytesRead: number, aggregation?: AggregationProgress) => {
        options.onProgress?.({ phase, bytesRead, totalBytes: source.size, counts: { ...totals }, ...(aggregation ? { aggregation: { ...aggregation } } : {}) });
    };
    const reportHeaders = (bytesRead: number, force = false) => {
        if (!options.onProgress)
            return;
        const now = Date.now();
        if (force || totals.messages + totals.duplicates <= 1 || (totals.messages + totals.duplicates) % 128 === 0 || now - lastHeaderReportAt >= 200) {
            lastHeaderReportAt = now;
            report('headers', bytesRead);
        }
    };
    let seenSent = 0, ordinal = 0, rng = (options.seed ?? 0x5f3759df) >>> 0;
    if (rng === 0)
        rng = 0x5f3759df;
    const random = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 4294967296; };
    let current: Headers | undefined, phase: 'headers' | 'body' = 'body', bodyStart = 0, active = false;
    let currentEvent: MessageEvent | undefined, currentAccepted = false;
    // Commit metadata once headers end, so live counts advance even before a giant body finishes.
    const commitHeaders = async () => {
        if (!active || !current || currentEvent)
            return;
        const h = current.map, dir = current.invalid ? 'unknown' : direction(h, options, d), messageId = h.get('message-id')?.trim();
        const key = messageId && /^<[^<>\s]+>$/.test(messageId) ? messageId : 'offset:' + ordinal;
        const date = Date.parse(h.get('date') ?? ''), rawThread = h.get('x-gm-thrid')?.trim();
        const threadId = rawThread && /^\d{1,20}$/.test(rawThread) && BigInt(rawThread) <= 18446744073709551615n ? BigInt(rawThread).toString() : undefined;
        if (rawThread && !threadId)
            warn(d, 'invalid-thread-id');
        const from = parseAddresses(h.get('from') ?? ''), recipients = [...new Set(['to', 'cc', 'bcc'].flatMap(k => parseAddresses(h.get(k) ?? '')))];
        if (from.length + recipients.length > limits.recipients)
            throw new Error('Recipient limit exceeded; exact contact counts cannot be preserved');
        currentEvent = { key, ordinal: ordinal++, direction: dir, threadId, timestamp: Number.isFinite(date) ? date : undefined, from, recipients };
        currentAccepted = await options.sink.putMessage(currentEvent, own);
        if (!currentAccepted)
            totals.duplicates++;
        else {
            totals.messages++;
            totals[dir]++;
            if (dir === 'sent' && currentEvent.timestamp !== undefined)
                addOutboundTime(outboundTiming, currentEvent.timestamp);
        }
        reportHeaders(bodyStart);
    };
    const finish = async (end: number) => {
        if (!active || !current)
            return;
        if (phase === 'headers') {
            warn(d, 'missing-header-terminator');
            bodyStart = end;
        }
        await commitHeaders();
        const event = currentEvent;
        if (!currentAccepted || !event || event.direction !== 'sent' || !limits.samples)
            return;
        seenSent++;
        const index = reservoir.length < limits.samples ? reservoir.length : Math.floor(random() * seenSent);
        if (index < limits.samples) {
            const headers = new Map<string, string>();
            for (const key of ['content-type', 'content-transfer-encoding', 'content-disposition']) {
                if (current.map.has(key))
                    headers.set(key, current.map.get(key)!);
            }
            reservoir[index] = { event, bodyStart, end, headers };
            d.maxSampleCount = Math.max(d.maxSampleCount, reservoir.length);
        }
    };
    const lines = new Lines(0, () => phase === 'headers' ? limits.line : 512, d, line => {
        if (!line.truncated && isMboxSeparator(line.bytes)) {
            const prior = active ? finish(line.start) : undefined;
            const start = () => { current = new Headers(limits, d, options.onDecode); currentEvent = undefined; currentAccepted = false; phase = 'headers'; active = true; bodyStart = line.end; };
            if (prior)
                return prior.then(start);
            start();
            return;
        }
        if (!active) {
            if (line.length)
                warn(d, 'preamble-ignored');
            return;
        }
        if (phase === 'headers') {
            if (!line.length) {
                phase = 'body';
                bodyStart = line.end;
                return commitHeaders();
            }
            current?.line(line);
        }
    });
    try {
        reportHeaders(0, true);
        await readRange(source, 0, source.size, limits, d, options.signal, (b, o) => lines.push(b, o), n => reportHeaders(n, true));
        await lines.end(source.size);
        await finish(source.size);
        finalizeOutboundTiming(outboundTiming);
        reportHeaders(source.size, true);
        const samples: SentSample[] = [];
        for (const c of reservoir.sort((a, b) => a.event.ordinal - b.event.ordinal)) {
            abort(options.signal);
            const sample = await extractSample(source, c, limits, d, options);
            if (sample)
                samples.push(sample);
            report('samples', c.end);
        }
        report('aggregate', source.size, { contactMessagesProcessed: 0, contactsSeen: 0, knownThreadContactPairs: 0 });
        totals.contacts = await aggregateMetadata(options.sink, options.signal, progress => {
            totals.contacts = progress.contactsSeen;
            report('aggregate', source.size, progress);
        });
        await options.sink.clearWorking();
        return { totals, outboundTiming, samples, diagnostics: d, contacts: () => options.sink.scanContacts(), dispose: () => options.sink.dispose() };
    }
    catch (error) {
        await options.sink.dispose().catch(() => { });
        throw error;
    }
}
/** Deliberately capped, test/small-fixture sink. Large imports should use IndexedDbMetadataSink. */
export class MemoryMetadataSink implements MetadataSink {
    private messages = new Set<string>();
    private pairs: PairEvent[] = [];
    private intervals = new Map<string, number[]>();
    private contacts = new Map<string, ContactStats>();
    private intervalCount = 0;
    constructor(readonly maxRecords = 50000) { }
    async putMessage(e: MessageEvent, own: ReadonlySet<string>) {
        if (this.messages.has(e.key))
            return false;
        const p = pairsFor(e, own);
        if (this.messages.size + 1 + this.pairs.length + p.length > this.maxRecords)
            throw new Error('Memory metadata limit exceeded; use IndexedDB');
        this.messages.add(e.key);
        this.pairs.push(...p);
        return true;
    }
    async *scanPairs() { this.pairs.sort((a, b) => a.contact < b.contact ? -1 : a.contact > b.contact ? 1 : a.thread < b.thread ? -1 : a.thread > b.thread ? 1 : a.key[2] - b.key[2] || a.ordinal - b.ordinal); yield* this.pairs; }
    async putInterval(contact: string, ms: number) {
        if (++this.intervalCount > this.maxRecords)
            throw new Error('Memory interval limit exceeded');
        const list = this.intervals.get(contact) ?? [];
        list.push(ms);
        this.intervals.set(contact, list);
    }
    async median(contact: string, count: number) {
        if (!count)
            return;
        const list = this.intervals.get(contact) ?? [];
        list.sort((a, b) => a - b);
        if (list.length !== count)
            throw new Error('Interval count mismatch');
        return (list[Math.floor((count - 1) / 2)] + list[Math.floor(count / 2)]) / 2;
    }
    async putContact(stats: ContactStats) { this.contacts.set(stats.email, { ...stats }); }
    async *scanContacts() {
        for (const s of this.contacts.values())
            yield { ...s };
    }
    async clearWorking() { this.messages.clear(); this.pairs = []; this.intervals.clear(); this.intervalCount = 0; }
    async dispose() { await this.clearWorking(); this.contacts.clear(); }
}
/** Browser IndexedDB adapter: persists only header-derived events, intervals, final tallies. */
export class IndexedDbMetadataSink implements MetadataSink {
    private database: Promise<IDBDatabase>;
    constructor(readonly name = 'mighty-mbox-' + crypto.randomUUID(), private batchSize = 256) {
        if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 4096)
            throw new RangeError('Invalid IndexedDB page size');
        this.database = new Promise((resolve, reject) => { const req = indexedDB.open(name, 1); req.onupgradeneeded = () => { const db = req.result; db.createObjectStore('messages'); db.createObjectStore('pairs', { keyPath: 'key' }); db.createObjectStore('intervals', { keyPath: 'key' }); db.createObjectStore('contacts', { keyPath: 'email' }); }; req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); req.onblocked = () => reject(new Error('IndexedDB import database blocked')); });
    }
    async putMessage(e: MessageEvent, own: ReadonlySet<string>) {
        const db = await this.database;
        return new Promise<boolean>((resolve, reject) => {
            const tx = db.transaction(['messages', 'pairs'], 'readwrite');
            let added = false;
            const messages = tx.objectStore('messages'), req = messages.getKey(e.key);
            req.onsuccess = () => {
                if (req.result !== undefined)
                    return;
                messages.add(e.ordinal, e.key);
                for (const pair of pairsFor(e, own))
                    tx.objectStore('pairs').add(pair);
                added = true;
            };
            tx.oncomplete = () => resolve(added);
            tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'));
            tx.onerror = () => { };
        });
    }
    private async write(store: string, value: unknown) { const db = await this.database; await new Promise<void>((resolve, reject) => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(value); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted')); }); }
    private async *pages<T extends {
        key?: IDBValidKey;
        email?: string;
    }>(store: string): AsyncIterable<T> {
        let last: IDBValidKey | undefined;
        while (true) {
            const db = await this.database;
            const page = await new Promise<T[]>((resolve, reject) => { const tx = db.transaction(store, 'readonly'), req = tx.objectStore(store).getAll(last === undefined ? undefined : IDBKeyRange.lowerBound(last, true), this.batchSize); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
            if (!page.length)
                return;
            for (const row of page)
                yield row;
            const final = page[page.length - 1];
            last = final.key ?? final.email;
            if (last === undefined)
                throw new Error('Missing IndexedDB cursor key');
        }
    }
    scanPairs() { return this.pages<PairEvent>('pairs'); }
    putInterval(contact: string, ms: number, ordinal: number) { return this.write('intervals', { key: [contact, ms, ordinal] }); }
    async median(contact: string, count: number) {
        if (!count)
            return;
        const db = await this.database;
        return new Promise<number>((resolve, reject) => {
            const tx = db.transaction('intervals', 'readonly'), range = IDBKeyRange.bound([contact, 0, 0], [contact, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]), req = tx.objectStore('intervals').openCursor(range);
            const lo = Math.floor((count - 1) / 2), hi = Math.floor(count / 2);
            let at = 0, low = 0, jumped = false;
            req.onerror = () => reject(req.error);
            req.onsuccess = () => {
                const cursor = req.result;
                if (!cursor) {
                    reject(new Error('Interval count mismatch'));
                    return;
                }
                if (!jumped && lo > 0) {
                    jumped = true;
                    at = lo;
                    cursor.advance(lo);
                    return;
                }
                const duration = (cursor.key as [
                    string,
                    number,
                    number
                ])[1];
                if (at === lo)
                    low = duration;
                if (at === hi) {
                    resolve((low + duration) / 2);
                    return;
                }
                at++;
                cursor.continue();
            };
        });
    }
    putContact(s: ContactStats) { return this.write('contacts', s); }
    scanContacts() { return this.pages<ContactStats>('contacts'); }
    async clearWorking() {
        const db = await this.database;
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(['messages', 'pairs', 'intervals'], 'readwrite');
            for (const store of ['messages', 'pairs', 'intervals'])
                tx.objectStore(store).clear();
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(tx.error ?? new Error('IndexedDB cleanup aborted'));
        });
    }
    async dispose() { const db = await this.database; db.close(); await new Promise<void>((resolve, reject) => { const req = indexedDB.deleteDatabase(this.name); req.onsuccess = () => resolve(); req.onerror = () => reject(req.error); req.onblocked = () => reject(new Error('IndexedDB cleanup blocked')); }); }
}
