import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';
import { readLinkedInArchive } from '../../src/lib/archive';

const MiB = 1024 * 1024;
class CheckFailure extends Error {}
function expect(condition: unknown, message: string): asserts condition { if (!condition) throw new CheckFailure(message); }
const pauseForPaint = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const csvCell = (text: string) => /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
const csv = (rows: string[][]) => rows.map(row => row.map(csvCell).join(',')).join('\r\n');
export interface ArchiveQaProgress {phase:'creating'|'reading';connections:number;messages:number;sent:number;received:number;bytesRead:number}
export type ArchiveQaMessage = {type:'progress';progress:ArchiveQaProgress}|{type:'complete';message:string}|{type:'cancelled'}|{type:'failed';message:string};
const scope = globalThis as unknown as {postMessage(message:ArchiveQaMessage):void;onmessage:((event:{data:{type:'run'|'cancel'}})=>void)|null};
const send = (message:ArchiveQaMessage) => scope.postMessage(message);
const progress = (value:ArchiveQaProgress) => send({type:'progress',progress:value});
function checkStop(signal:AbortSignal){if(signal.aborted)throw new DOMException('Synthetic ZIP check stopped','AbortError');}

async function archiveCheck(signal: AbortSignal): Promise<string> {
  progress({phase:'creating',connections:0,messages:0,sent:0,received:0,bytesRead:0});
  const creationStart = performance.now();
  const rows: string[][] = [['First Name', 'Last Name', 'URL', 'Email Address', 'Company', 'Position', 'Connected On']];
  for (let i = 0; i < 19_000; i++) {
    rows.push(['QA', `Person ${String(i).padStart(5, '0')}`, `https://www.linkedin.com/in/qa-synthetic-${i}/`, `person${i}@qa.example.invalid`, `QA Company ${i % 100}`, 'Synthetic role', '2026-09-12']);
    if (i % 500 === 0) { checkStop(signal); progress({phase:'creating',connections:i,messages:0,sent:0,received:0,bytesRead:0}); await pauseForPaint(); }
  }
  const canary = 'SYNTHETIC_RECEIVED_ARCHIVE_CANARY';
  const writer = new ZipWriter(new BlobWriter('application/zip'), { useWebWorkers: false });
  let zip: Blob;
  try {
    const files: [string, string][] = [
      ['Profile.csv', csv([['First Name', 'Last Name', 'URL'], ['Parser', 'QA', 'https://www.linkedin.com/in/qa-owner/']])],
      ['Connections.csv', csv(rows)],
      ['Positions.csv', csv([['Company Name', 'Title'], ['QA Company 0', 'Tester'], ['QA Company 1', 'Reviewer']])],
      ['Skills.csv', csv([['Name'], ['Testing']])],
      ['Messages.csv', csv([
        ['From', 'Sender Profile URL', 'Content', 'Conversation ID'],
        ['Parser QA', 'https://www.linkedin.com/in/qa-owner/', 'My synthetic archive sample.\nThanks,\nSignature', 'thread-1'],
        ['Synthetic Sender', 'https://www.linkedin.com/in/qa-sender/', canary, 'thread-1'],
        ['Another Sender', '', canary, 'thread-2'],
      ])],
    ];
    for (const [filename, text] of files) {
      checkStop(signal);
      await writer.add(filename, new TextReader(text), { useWebWorkers: false, signal: signal });
    }
    zip = await writer.close();
  } catch (error) { await writer.close().catch(() => {}); throw error; }
  rows.length = 0;
  checkStop(signal);
  const createdMs = performance.now() - creationStart;
  const parseStart = performance.now();
  let sawFullCount = false;
  const result = await readLinkedInArchive(zip, {
    signal: signal,
    onProgress: progress => {
      send({type:'progress',progress:{phase:'reading',connections:progress.connections,messages:progress.messages,sent:progress.sentMessages,received:progress.receivedMessages,bytesRead:progress.bytesRead}});
      sawFullCount ||= progress.connections === 19_000;
    },
  });
  const elapsedMs = performance.now() - parseStart;
  expect(result.connections.length === 19_000 && result.counts.connections === 19_000, 'The ZIP parser did not retain all 19,000 connections.');
  expect(result.connections[0].url.endsWith('/qa-synthetic-0/') && result.connections[18_999].url.endsWith('/qa-synthetic-18999/'), 'The first or last generated connection is missing.');
  expect(result.counts.positions === 2 && result.counts.skills === 1, 'The ZIP parser lost own profile facts.');
  expect(result.counts.messages === 3 && result.counts.sentMessages === 1 && result.counts.receivedMessages === 2 && result.counts.threads === 2, 'The ZIP message direction or thread counts are incorrect.');
  expect(result.writingSamples.length === 1 && result.writingSamples[0] === 'My synthetic archive sample.', 'The ZIP sample was not cleaned correctly.');
  expect(result.companyIndex['qa company 0']?.count === 190, 'The company overlap did not retain the complete connection pool.');
  expect(!JSON.stringify(result).includes(canary), 'A received archive canary escaped into the parser result.');
  expect(sawFullCount, 'The ZIP progress never exposed the full connection count.');
  return `PASSED — 19,000 / 19,000 connections; ZIP ${(zip.size / MiB).toFixed(2)} MiB; generated in ${(createdMs / 1000).toFixed(2)}s, parsed in ${(elapsedMs / 1000).toFixed(2)}s.`;
}


let controller:AbortController|undefined;
scope.onmessage = ({data}) => {
  if(data.type==='cancel'){controller?.abort();return;}
  if(data.type!=='run'||controller)return;
  controller=new AbortController();
  void archiveCheck(controller.signal).then(message=>send({type:'complete',message})).catch(error=>{
    if(controller?.signal.aborted||error?.name==='AbortError')send({type:'cancelled'});
    else send({type:'failed',message:error instanceof CheckFailure?error.message:'The generated ZIP could not be created or parsed in this browser.'});
  }).finally(()=>{controller=undefined;});
};
