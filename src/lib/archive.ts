import { BlobReader, BlobWriter, TextReader, TextWriter, ZipReader, ZipWriter, type FileEntry } from '@zip.js/zip.js';
import { CsvStreamParser, encodeCsv, type RawFact } from './csv';
import { contentFingerprint, deepFreeze, normalizeName, stripQuotedRepliesAndSignature } from './text';

export interface Connection {
  readonly firstName: string; readonly lastName: string; readonly url: string;
  readonly email: string; readonly company: string; readonly position: string; readonly connectedOn: string;
}
export interface LayerOneSnapshot {
  readonly id: string; readonly importedAt: string; readonly fingerprint: string;
  readonly profile: readonly RawFact[]; readonly positions: readonly RawFact[];
  readonly education: readonly RawFact[]; readonly skills: readonly RawFact[];
}
export interface ArchiveCounts {
  connections: number; positions: number; education: number; skills: number; messages: number;
  sentMessages: number; receivedMessages: number; unidentifiedMessages: number; threads: number; invitations: number;
}
export interface ArchiveProgress extends ArchiveCounts { phase: 'reading' | 'complete'; file: string; bytesRead: number; }
export interface CompanyOverlap { readonly company: string; readonly count: number; readonly statement: string; }
export interface ArchiveResult {
  /** Includes facts, the entire connection pool, own samples, and aggregate source counts. */
  readonly fingerprint: string;
  readonly layer1: LayerOneSnapshot;
  readonly verifiedAccountHolder: { readonly fullName: string; readonly profileUrl: string } | null;
  /** Full pool, deliberately independent of the app's tracked relationship limit. */
  readonly connections: readonly Connection[];
  readonly writingSamples: readonly string[];
  readonly counts: Readonly<ArchiveCounts>;
  readonly companyIndex: Readonly<Record<string, CompanyOverlap>>;
  readonly warnings: readonly string[];
}
export interface ArchiveOptions {
  onProgress?: (progress: ArchiveProgress) => void;
  signal?: AbortSignal;
  /** Only pass this after the user has verified their identity, never from a guessed sender. */
  verifiedAccountHolder?: { fullName: string; profileUrl?: string };
  maxUncompressedBytes?: number;
}
const normalizeHeader = (s: string) => s.toLowerCase().replace(/[\s_\-\uFEFF]/g, '');
const get = (row: RawFact, ...names: string[]) => {
  for (const name of names) for (const key of Object.keys(row)) if (normalizeHeader(key) === normalizeHeader(name)) return row[key].trim();
  return '';
};
const normalizeUrl = (s: string) => s.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/[/?#]+$/, '').toLowerCase();
const blankCounts = (): ArchiveCounts => ({ connections: 0, positions: 0, education: 0, skills: 0, messages: 0, sentMessages: 0, receivedMessages: 0, unidentifiedMessages: 0, threads: 0, invitations: 0 });
type Kind = 'profile' | 'connections' | 'positions' | 'education' | 'skills' | 'messages' | 'invitations';
const kindFor = (filename: string): Kind | undefined => {
  const key = filename.split('/').pop()!.replace(/\.csv$/i, '').toLowerCase().replace(/[^a-z]/g, '');
  return ['profile', 'connections', 'positions', 'education', 'skills', 'messages', 'invitations'].includes(key) ? key as Kind : undefined;
};
function isHeader(kind: Kind, row: string[]): boolean {
  const has = (...keys: string[]) => keys.some(key => row.map(normalizeHeader).includes(normalizeHeader(key)));
  if (kind === 'connections') return has('First Name') && has('Last Name');
  if (kind === 'profile') return has('First Name') && has('Last Name');
  if (kind === 'positions') return has('Company Name', 'Company') && has('Title', 'Position');
  if (kind === 'education') return has('School Name', 'School', 'Institution');
  if (kind === 'skills') return has('Name', 'Skill Name', 'Skills');
  if (kind === 'messages') return has('From', 'Sender', 'Sender Name') && has('Content', 'Body', 'Message');
  return has('From', 'To', 'Direction', 'Sent At', 'Invitation Sent At');
}

/** These normalizations alter the lookup key only; source company spelling remains a raw fact. */
export function companyKey(company: string): string {
  return company.normalize('NFKC').replace(/&amp;/gi, '&').replace(/&#0*38;/g, '&').replace(/&quot;/gi, '"').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}
export function decodedCompanyIndex(connections: readonly Connection[]): Readonly<Record<string, CompanyOverlap>> {
  const companies = new Map<string, { company: string; people: Set<string> }>();
  for (const person of connections) {
    const key = companyKey(person.company); if (!key) continue;
    const value = companies.get(key) ?? { company: person.company.replace(/&amp;/gi, '&').trim(), people: new Set<string>() };
    const identity = normalizeUrl(person.url) || person.email.trim().toLowerCase() || `${normalizeName(person.firstName)}|${normalizeName(person.lastName)}|${person.position.trim().toLowerCase()}`;
    if (!identity.replace(/\|/g, '')) continue;
    value.people.add(identity); companies.set(key, value);
  }
  const entries = [...companies.entries()].filter(([, v]) => v.people.size >= 2)
    .sort(([ak, a], [bk, b]) => b.people.size - a.people.size || ak.localeCompare(bk)).slice(0, 500)
    .map(([key, value]) => [key, { company: value.company, count: value.people.size, statement: `You already know ${value.people.size} people at ${value.company}` }] as const);
  return deepFreeze(Object.fromEntries(entries));
}
export function companyOverlapFor(index: Readonly<Record<string, CompanyOverlap>>, company: string): CompanyOverlap | null {
  return Object.hasOwn(index, companyKey(company)) ? index[companyKey(company)] : null;
}
/** The model's output cannot replace the overlap fact. */
export function attachCompanyOverlap<T extends { company: string }>(row: T, index: Readonly<Record<string, CompanyOverlap>>): T & { companyOverlap: CompanyOverlap | null } {
  return { ...row, companyOverlap: companyOverlapFor(index, row.company) };
}

/** Client-side only: no network requests and no received message bodies escape this function. */
export async function readLinkedInArchive(file: Blob, options: ArchiveOptions = {}): Promise<ArchiveResult> {
  const reader = new ZipReader(new BlobReader(file), { useWebWorkers: false });
  const counts = blankCounts(); const connections: Connection[] = []; const writingSamples: string[] = [];
  const facts: Record<'profile' | 'positions' | 'education' | 'skills', RawFact[]> = { profile: [], positions: [], education: [], skills: [] };
  const warnings: string[] = []; const threads = new Set<string>();
  let bytesRead = 0; let currentFile = ''; let lastProgress = 0;
  let holderName = normalizeName(options.verifiedAccountHolder?.fullName ?? '');
  let holderUrl = normalizeUrl(options.verifiedAccountHolder?.profileUrl ?? '');
  const emit = (force = false, phase: ArchiveProgress['phase'] = 'reading') => {
    const now = performance.now(); if (!force && now - lastProgress < 32) return; lastProgress = now;
    options.onProgress?.({ ...counts, phase, file: currentFile, bytesRead });
  };
  const abort = () => { if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('Import cancelled', 'AbortError'); };
  try {
    const allEntries = await reader.getEntries(); abort();
    const entries = allEntries.filter((e): e is FileEntry => !e.directory && /\.csv$/i.test(e.filename) && !!kindFor(e.filename));
    if (!entries.length) throw new Error('No supported LinkedIn CSV files were found inside this ZIP.');
    const budget = options.maxUncompressedBytes ?? 512 * 1024 * 1024;
    if (entries.reduce((sum, entry) => sum + entry.uncompressedSize, 0) > budget) throw new Error('The archive exceeds the safe decompressed import limit.');
    entries.sort((a, b) => Number(kindFor(b.filename) === 'profile') - Number(kindFor(a.filename) === 'profile') || a.filename.localeCompare(b.filename));
    for (const entry of entries) {
      abort(); currentFile = entry.filename; emit(true);
      const kind = kindFor(entry.filename)!; let headers: string[] | null = null;
      const parser = new CsvStreamParser(cells => {
        if (!headers) { if (isHeader(kind, cells)) headers = cells.map(h => h.trim()); return; }
        const row: RawFact = Object.fromEntries(headers.map((header, i) => [header, cells[i] ?? '']));
        if (kind === 'profile' || kind === 'positions' || kind === 'education' || kind === 'skills') {
          facts[kind].push(row); if (kind !== 'profile') counts[kind]++;
        } else if (kind === 'connections') {
          const firstName = get(row, 'First Name'); const lastName = get(row, 'Last Name');
          if (!firstName && !lastName) return;
          connections.push({ firstName, lastName, url: get(row, 'URL', 'Profile URL'), email: get(row, 'Email Address', 'Email'), company: get(row, 'Company'), position: get(row, 'Position'), connectedOn: get(row, 'Connected On') });
          counts.connections++;
        } else if (kind === 'invitations') counts.invitations++;
        else {
          counts.messages++;
          const thread = get(row, 'CONVERSATION ID', 'Conversation ID', 'Thread ID');
          if (thread) { threads.add(thread); counts.threads = threads.size; }
          const sender = normalizeName(get(row, 'From', 'Sender', 'Sender Name'));
          const senderUrl = get(row, 'Sender Profile URL', 'From URL');
          const matches = holderName && sender === holderName && !(holderUrl && senderUrl && normalizeUrl(senderUrl) !== holderUrl);
          if (!holderName || !sender) counts.unidentifiedMessages++;
          else if (!matches) counts.receivedMessages++;
          else {
            counts.sentMessages++;
            if (writingSamples.length < 40) {
              const sample = stripQuotedRepliesAndSignature(get(row, 'Content', 'Body', 'Message'), holderName);
              if (sample) writingSamples.push(sample);
            }
          }
          // `row` is discarded. No recipient names, received content, or thread IDs are returned.
        }
        if ((counts.connections + counts.positions + counts.messages) % 128 === 0) emit();
      });
      await entry.getData(new WritableStream<Uint8Array>({
        async write(chunk) {
          abort(); bytesRead += chunk.byteLength;
          if (bytesRead > budget) throw new Error('The archive exceeds the safe decompressed import limit.');
          parser.write(chunk); emit();
          // Give the browser a paint opportunity while large exports continue streaming.
          await new Promise<void>(resolve => setTimeout(resolve, 0));
        }, close() { parser.finish(); }
      }), { useWebWorkers: false, signal: options.signal });
      if (!headers) warnings.push(`No recognized header in ${entry.filename}.`);
      if (kind === 'profile') {
        // Ambiguous/multiple Profile records never choose a guessed identity.
        if (facts.profile.length === 1) {
          const p = facts.profile[0]; holderName = normalizeName(`${get(p, 'First Name')} ${get(p, 'Last Name')}`);
          holderUrl = normalizeUrl(get(p, 'URL', 'Profile URL', 'Public Profile Url'));
          if (!get(p, 'First Name') || !get(p, 'Last Name')) holderName = '';
        } else { holderName = ''; holderUrl = ''; }
      }
      if (options.verifiedAccountHolder) {
        holderName = normalizeName(options.verifiedAccountHolder.fullName);
        holderUrl = normalizeUrl(options.verifiedAccountHolder.profileUrl ?? '');
      }
      emit(true);
    }
    // A sanitized rebuild keeps the original aggregate counts, without preserving received bodies.
    const manifest = allEntries.find((e): e is FileEntry => !e.directory && e.filename === 'mighty-manifest.json');
    if (manifest && manifest.uncompressedSize <= 512_000) {
      try {
        const parsed = JSON.parse(await manifest.getData(new TextWriter(), { useWebWorkers: false }));
        if (parsed.format === 'mighty-sanitized-archive-v1' && parsed.counts) {
          if (holderName && normalizeName(parsed.verifiedAccountHolder?.fullName ?? '') === holderName && Array.isArray(parsed.ownWritingSamples)) {
            writingSamples.splice(0, writingSamples.length, ...parsed.ownWritingSamples.filter((v: unknown): v is string => typeof v === 'string').slice(0, 40).map((sample: string) => stripQuotedRepliesAndSignature(sample, holderName)).filter(Boolean));
          }
          for (const key of ['messages', 'sentMessages', 'receivedMessages', 'unidentifiedMessages', 'threads', 'invitations'] as const) {
            if (Number.isSafeInteger(parsed.counts[key]) && parsed.counts[key] >= 0) counts[key] = parsed.counts[key];
          }
        }
      } catch { warnings.push('Saved archive counts could not be restored. Parsed counts remain available.'); }
    }
    if (!holderName) warnings.push('The account holder could not be verified. No writing samples were retained.');
    const fingerprint = await contentFingerprint(facts);
    const layer1 = deepFreeze({ id: crypto.randomUUID(), importedAt: new Date().toISOString(), fingerprint, ...facts });
    const archiveFingerprint = await contentFingerprint({ facts, connections, writingSamples, counts });
    emit(true, 'complete');
    return deepFreeze({ fingerprint: archiveFingerprint, layer1, verifiedAccountHolder: holderName ? { fullName: holderName, profileUrl: holderUrl } : null, connections, writingSamples, counts, companyIndex: decodedCompanyIndex(connections), warnings });
  } finally { await reader.close(); }
}

/** Append-only Layer 1: a later import creates a snapshot instead of editing previous facts. */
export function appendLayerOneSnapshot(history: readonly LayerOneSnapshot[], snapshot: LayerOneSnapshot): readonly LayerOneSnapshot[] {
  if (history.some(item => item.fingerprint === snapshot.fingerprint)) return history;
  return deepFreeze([...history, snapshot]);
}

/** A rebuild bundle contains raw own facts, connections, own samples, and aggregate counts only. */
export async function createSanitizedArchive(result: ArchiveResult): Promise<Blob> {
  const writer = new ZipWriter(new BlobWriter('application/zip'), { useWebWorkers: false });
  for (const [kind, rows] of Object.entries({ Profile: result.layer1.profile, Positions: result.layer1.positions, Education: result.layer1.education, Skills: result.layer1.skills })) {
    if (rows.length) await writer.add(`${kind}.csv`, new TextReader(encodeCsv(rows)), { useWebWorkers: false });
  }
  if (result.connections.length) await writer.add('Connections.csv', new TextReader(encodeCsv(result.connections.map(p => ({ 'First Name': p.firstName, 'Last Name': p.lastName, URL: p.url, 'Email Address': p.email, Company: p.company, Position: p.position, 'Connected On': p.connectedOn })))), { useWebWorkers: false });
  const p = result.layer1.profile[0];
  const holder = p ? `${get(p, 'First Name')} ${get(p, 'Last Name')}`.trim() : '';
  if (holder && result.writingSamples.length) await writer.add('Messages.csv', new TextReader(encodeCsv(result.writingSamples.map(sample => ({ From: holder, Content: sample })))), { useWebWorkers: false });
  await writer.add('mighty-manifest.json', new TextReader(JSON.stringify({ format: 'mighty-sanitized-archive-v1', counts: result.counts, verifiedAccountHolder: result.verifiedAccountHolder, ownWritingSamples: result.writingSamples })), { useWebWorkers: false });
  return writer.close();
}
