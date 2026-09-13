import type {SupabaseClient} from '@supabase/supabase-js';
import type {ArchiveResult} from './archive';
import type {ResumeExtraction} from './resume';
import type {MailboxWorkerResult} from './mbox.worker';
import {cleanText} from './text';

export interface AccountSourceFacts {
  archive?: Pick<ArchiveResult,'layer1'|'counts'|'writingSamples'|'companyIndex'|'fingerprint'>;
  resume?: ResumeExtraction;
  mailbox?: MailboxWorkerResult;
}
type SourceRow={source:string;fingerprint:string;facts:unknown};
const record=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const samples=(value:unknown)=>Array.isArray(value)?value.filter((s):s is string=>typeof s==='string').slice(0,40).map(cleanText):[];

/** Reads processed source snapshots only. Connection pools and source ZIPs stay separate. */
export async function readAccountSourceData(client:SupabaseClient,uid:string):Promise<AccountSourceFacts>{
 const results=await Promise.all(['archive','resume','mailbox'].map(source=>client.from('knowledge_sources').select('source,fingerprint,facts').eq('user_id',uid).eq('source',source).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle()));
 const output:AccountSourceFacts={};
 for(const result of results){
  if(result.error)throw Error(result.error.message);
  const row=result.data as SourceRow|null;if(!row)continue;
  if(!record(row.facts)||typeof row.fingerprint!=='string')throw Error('A saved source could not be read. Your local files are preserved.');
  const facts=row.facts;
  if(row.source==='resume'){
   if(typeof facts.text!=='string'||!Number.isSafeInteger(facts.pages)||Number(facts.pages)<1)throw Error('Your saved resume could not be read.');
   output.resume={text:cleanText(facts.text),pages:Number(facts.pages),fingerprint:row.fingerprint};
  }else if(row.source==='archive'){
   const layer=facts.layer1;
   if(!record(layer)||!['profile','positions','education','skills'].every(key=>Array.isArray(layer[key])&&(layer[key] as unknown[]).every(r=>record(r)&&Object.values(r).every(v=>typeof v==='string')))||typeof layer.importedAt!=='string'||typeof layer.fingerprint!=='string'||typeof layer.id!=='string'||!record(facts.counts)||!Object.values(facts.counts).every(n=>Number.isSafeInteger(n)&&Number(n)>=0))throw Error('Your saved career facts could not be read.');
   output.archive={fingerprint:row.fingerprint,layer1:layer as unknown as ArchiveResult['layer1'],counts:facts.counts as unknown as ArchiveResult['counts'],writingSamples:samples(facts.writingSamples),companyIndex:record(facts.companyIndex)?facts.companyIndex as ArchiveResult['companyIndex']:{}};
  }else if(row.source==='mailbox'){
   if(facts.schemaVersion!==1||!record(facts.counts)||!record(facts.globalMetrics))throw Error('Your saved mailbox tallies could not be read.');
   const {writingSamples,...summary}=facts;
   output.mailbox={summary:summary as unknown as MailboxWorkerResult['summary'],samples:samples(writingSamples)};
  }
 }
 return output;
}
