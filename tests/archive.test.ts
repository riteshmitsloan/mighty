import test from 'node:test';
import assert from 'node:assert/strict';
import { BlobWriter, TextReader, TextWriter, BlobReader, ZipWriter, ZipReader } from '@zip.js/zip.js';
import { readLinkedInArchive, createSanitizedArchive, appendLayerOneSnapshot, decodedCompanyIndex, companyOverlapFor, attachCompanyOverlap, type Connection } from '../src/lib/archive';
import { CsvStreamParser } from '../src/lib/csv';
import { cleanText, stripQuotedRepliesAndSignature } from '../src/lib/text';
import { checkedUpsert } from '../src/lib/resume';
async function zip(files: Record<string, string>) {
  const writer = new ZipWriter(new BlobWriter(), { useWebWorkers: false, level: 0 });
  for (const [name, text] of Object.entries(files)) await writer.add(name, new TextReader(text), { useWebWorkers: false, level: 0 });
  return writer.close();
}
const profile = 'First Name,Last Name,Public Profile Url,Geo Location\r\nAlex,Rivera,https://www.linkedin.com/in/alex-rivera/,Boston';
const connectionHeader = 'First Name,Last Name,URL,Email Address,Company,Position,Connected On';
const position = 'Company Name,Title,Description,Started On\nAcme,Engineering Lead,Led 15 engineers in healthcare,2020';
const baseFiles = () => ({ 'folder/Profile.csv': profile, 'folder/Positions.csv': position, 'folder/Connections.csv': `${connectionHeader}\nJamie,Li,https://www.linkedin.com/in/jamie,ja@example.com,Acme,CEO,01 Jan 2020\nSam,Lee,https://www.linkedin.com/in/sam,,Acme,CTO,02 Jan 2021`, 'folder/Education.csv': 'School Name,Degree Name\nMIT,MSc', 'folder/Skills.csv': 'Name\nLeadership\nTypeScript' });
test('streaming CSV preserves quoted commas, escaped quotes, CRLF, and multibyte boundaries', () => {
  const rows: string[][] = []; const parser = new CsvStreamParser(row => rows.push(row));
  for (const byte of new TextEncoder().encode('\uFEFFName,Body\r\nÉva,"hello, ""world""\r\nnext"\r\n李,done')) parser.write(Uint8Array.of(byte));
  parser.finish(); assert.deepEqual(rows, [['Name', 'Body'], ['Éva', 'hello, "world"\r\nnext'], ['李', 'done']]);
});
test('unfinished quoted CSV refuses success', () => { const p = new CsvStreamParser(() => {}); p.writeText('a,"unfinished'); assert.throws(() => p.finish(), /unfinished/); });
test('oversized CSV fields refuse unbounded allocation', () => { const p = new CsvStreamParser(() => {}, 4); assert.throws(() => p.writeText('12345'), /safe import limit/); });
test('strips Postgres NUL and controls while keeping useful whitespace', () => { assert.equal(cleanText('A\u0000B\u0001C\u000bD\u007f\u0085\n\tE'), 'ABCD\n\tE'); });
test('quoted replies and signatures are removed by the same conservative prefix rule', () => {
  for (const suffix of ['> received private body', 'On Tuesday Alice wrote:', '--', 'Best,', 'Sent from my iPhone', 'From: private@person.test', '-----Original Message-----']) assert.equal(stripQuotedRepliesAndSignature(`My own sentence.\n${suffix}\nprivate text`), 'My own sentence.');
});
test('real folder CSVs, LinkedIn preamble, and full uncapped connection pool parse', async () => {
  const f = baseFiles(); f['folder/Connections.csv'] = 'Notes:\nThese are your connections.\n\n' + f['folder/Connections.csv'];
  const progress: number[] = []; const r = await readLinkedInArchive(await zip(f), { onProgress: p => progress.push(p.connections) });
  assert.equal(r.connections.length, 2); assert.equal(r.layer1.positions[0].Description, 'Led 15 engineers in healthcare'); assert.equal(r.counts.skills, 2); assert.equal(r.counts.education, 1); assert.equal(r.layer1.profile[0]['Geo Location'], 'Boston');
  assert.ok(progress.includes(2)); assert.ok(progress.every((v, i) => !i || v >= progress[i - 1])); assert.equal('location' in r.connections[0], false);
});
test('retains exactly forty verified own samples and only received counts', async () => {
  const messages = 'CONVERSATION ID,From,Sender Profile URL,Content\n' + Array.from({ length: 45 }, (_, i) => `t${i},Alex Rivera,https://www.linkedin.com/in/alex-rivera,"Own sentence ${i}.\nBest,\nAlex Rivera"`).join('\n') + '\nt46,Other Person,https://www.linkedin.com/in/other,ULTRA_PRIVATE_RECEIVED_SENTINEL';
  const result = await readLinkedInArchive(await zip({ ...baseFiles(), 'folder/Messages.csv': messages }));
  assert.equal(result.writingSamples.length, 40); assert.equal(result.counts.sentMessages, 45); assert.equal(result.counts.receivedMessages, 1); assert.equal(result.counts.threads, 46); assert.equal(result.counts.messages, 46);
  assert.ok(!JSON.stringify(result).includes('ULTRA_PRIVATE_RECEIVED_SENTINEL')); assert.ok(!JSON.stringify(result.writingSamples).includes('Alex Rivera'));
});
test('a similar sender name is not the holder and mismatched profile URLs refuse a sample', async () => {
  const r = await readLinkedInArchive(await zip({ ...baseFiles(), 'Messages.csv': 'From,Sender Profile URL,Content\nAlexander Rivera,,private1\nAlex Rivera,https://www.linkedin.com/in/impostor,private2\nAlex Rivera,https://www.linkedin.com/in/alex-rivera,own' }));
  assert.deepEqual(r.writingSamples, ['own']); assert.equal(r.counts.receivedMessages, 2);
});
test('without a verified holder no writing is retained', async () => {
  const r = await readLinkedInArchive(await zip({ 'Messages.csv': 'From,Content\nAlex Rivera,private' }));
  assert.deepEqual(r.writingSamples, []); assert.equal(r.counts.unidentifiedMessages, 1); assert.match(r.warnings.join(' '), /could not be verified/);
});
test('explicitly verified holder works even for a messages-only export', async () => {
  const r = await readLinkedInArchive(await zip({ 'Messages.csv': 'From,Content\nAlex Rivera,own' }), { verifiedAccountHolder: { fullName: 'Alex Rivera' } }); assert.deepEqual(r.writingSamples, ['own']);
});
test('multiple holder records do not guess identity', async () => {
  const r = await readLinkedInArchive(await zip({ 'Profile.csv': profile + '\nDifferent,Owner,,', 'Messages.csv': 'From,Content\nAlex Rivera,private' })); assert.deepEqual(r.writingSamples, []);
});
test('unknown archives and decompression over budget fail explicitly', async () => {
  await assert.rejects(readLinkedInArchive(await zip({ 'random.txt': 'hello' })), /No supported/);
  await assert.rejects(readLinkedInArchive(await zip(baseFiles()), { maxUncompressedBytes: 20 }), /safe decompressed/);
});
test('aborted imports never report a completed result', async () => {
  const c = new AbortController(); c.abort(); await assert.rejects(readLinkedInArchive(await zip(baseFiles()), { signal: c.signal }), { name: 'AbortError' });
});
test('Layer 1 is deeply immutable and append-only, duplicate content does not append', async () => {
  const a = await readLinkedInArchive(await zip(baseFiles())); const b = await readLinkedInArchive(await zip(baseFiles()));
  assert.ok(Object.isFrozen(a.layer1.positions[0])); assert.throws(() => { (a.layer1.positions[0] as Record<string, string>).Description = 'AI changed facts'; });
  const first = appendLayerOneSnapshot([], a.layer1); assert.equal(appendLayerOneSnapshot(first, b.layer1), first);
  const changed = await readLinkedInArchive(await zip({ ...baseFiles(), 'folder/Positions.csv': position.replace('15', '16') }));
  assert.equal(appendLayerOneSnapshot(first, changed.layer1).length, 2); assert.equal(first[0].positions[0].Description, 'Led 15 engineers in healthcare');
});
test('sanitized rebuild ZIP contains no received bodies and preserves original tallies and own samples', async () => {
  const a = await readLinkedInArchive(await zip({ ...baseFiles(), 'Messages.csv': 'From,Content,CONVERSATION ID\nAlex Rivera,my own text,t1\nOther Person,ULTRA_PRIVATE_RECEIVED_SENTINEL,t2' }));
  const safe = await createSanitizedArchive(a); const reader = new ZipReader(new BlobReader(safe), { useWebWorkers: false });
  for (const entry of await reader.getEntries()) if (!entry.directory) assert.ok(!(await entry.getData(new TextWriter(), { useWebWorkers: false })).includes('ULTRA_PRIVATE_RECEIVED_SENTINEL'));
  await reader.close(); const b = await readLinkedInArchive(safe);
  assert.deepEqual(b.counts, a.counts); assert.deepEqual(b.writingSamples, a.writingSamples); assert.deepEqual(b.connections, a.connections); assert.equal(b.layer1.fingerprint, a.layer1.fingerprint); assert.equal(b.fingerprint, a.fingerprint);
});
const person = (company: string, n: number): Connection => ({ firstName: `Person${n}`, lastName: 'Test', url: `https://linkedin.com/in/test-${n}`, email: '', company, position: 'Leader', connectedOn: '' });
test('company index decodes, deduplicates people and preserves the statement unchanged', () => {
  const index = decodedCompanyIndex([person('A &amp; B', 1), person('A & B', 2), person('A & B', 2), person('Solo', 3)]);
  assert.equal(Object.keys(index).length, 1); assert.equal(companyOverlapFor(index, ' A & B ')?.count, 2);
  assert.equal(attachCompanyOverlap({ company: 'A & B', score: 4 }, index).companyOverlap, companyOverlapFor(index, 'A & B'));
  assert.equal(companyOverlapFor(index, '__proto__'), null);
});
test('company index deterministically retains top 500 companies by count', () => {
  const people = Array.from({ length: 502 }, (_, i) => [person(`Company ${String(i).padStart(4, '0')}`, 2 * i), person(`Company ${String(i).padStart(4, '0')}`, 2 * i + 1)]).flat();
  people.push(person('Company 0501', 10000)); const index = decodedCompanyIndex(people);
  assert.equal(Object.keys(index).length, 500); assert.equal(Object.keys(index)[0], 'company 0501'); assert.equal(companyOverlapFor(index, 'Company 0500'), null);
});
test('resolved SDK error is surfaced, including Postgres 22P05, and no success is returned', async () => {
  await assert.rejects(checkedUpsert('Saving resume', async () => ({ error: { message: 'unsupported Unicode escape sequence', code: '22P05' } })), /22P05/);
  assert.deepEqual(await checkedUpsert('Saving resume', async () => ({ data: { ok: true }, error: null })), { ok: true });
});
test('GENERATED BENCHMARK: 19,000-connection archive imports under 60 seconds with ticking progress', async t => {
  const csv = connectionHeader + '\n' + Array.from({ length: 19000 }, (_, i) => `Person${i},Test,https://linkedin.com/in/person-${i},,Company ${i % 1200},Product leader,01 Jan 2020`).join('\n');
  const file = await zip({ 'Takeout/Profile.csv': profile, 'Takeout/Connections.csv': csv, 'Takeout/Positions.csv': position });
  const ticks: number[] = []; const started = performance.now();
  const r = await readLinkedInArchive(file, { onProgress: p => ticks.push(p.connections) });
  const elapsed = performance.now() - started;
  assert.equal(r.connections.length, 19000); assert.ok(ticks.some(n => n > 0 && n < 19000)); assert.ok(elapsed < 60000, `${elapsed}ms`);
  t.diagnostic(`Synthetic ZIP ${file.size} bytes, ${r.connections.length} connections, ${elapsed.toFixed(1)} ms in Node; browser/device performance not yet verified.`);
});

test('archive fingerprint includes connection and writing content while Layer 1 fingerprint stays separate', async () => {
  const a = await readLinkedInArchive(await zip(baseFiles()));
  const changed = baseFiles(); changed['folder/Connections.csv'] = changed['folder/Connections.csv'].replace('Jamie,Li', 'Jamie,Lu');
  const b = await readLinkedInArchive(await zip(changed));
  const c = await readLinkedInArchive(await zip({ ...baseFiles(), 'Messages.csv': 'From,Content\nAlex Rivera,my new sample' }));
  assert.equal(a.layer1.fingerprint, b.layer1.fingerprint); assert.notEqual(a.fingerprint, b.fingerprint); assert.notEqual(a.fingerprint, c.fingerprint);
});

test('wrapped reply headers, HTML blockquotes, and a verified holder signature are stripped', () => {
  assert.equal(stripQuotedRepliesAndSignature('My text.\nOn Tuesday, September 1,\nPerson wrote:\nreceived private'), 'My text.');
  assert.equal(stripQuotedRepliesAndSignature('My text.<blockquote>received private</blockquote>'), 'My text.');
  assert.equal(stripQuotedRepliesAndSignature('My text.\nAlex Rivera\nJob title and contact details', 'alex rivera'), 'My text.');
});
