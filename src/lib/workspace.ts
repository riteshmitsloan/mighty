import { db, accountId, gatewayForAccount, saveSettings } from './platform';
import { createSanitizedArchive, type ArchiveResult } from './archive';
import { cleanText, contentFingerprint } from './text';
import { createKnowledgeSynthesizer, knowledgeForStrategyBrief, type KnowledgeState } from './knowledge';
import type { ResumeExtraction } from './resume';
import type { MailboxWorkerResult } from './mbox.worker';
import type { Connection } from './discover';

export interface Person { id:string;person:string;profile_url:string|null;stage:string;context:Record<string,unknown>;created_at:string; profile?:Record<string,unknown> }
export interface Capture { id:string;relationship_id:string;kind:string;body:string;related_event_id:string|null;created_at:string }
export interface LocalSources { archive?:ArchiveResult;resume?:ResumeExtraction;mailbox?:MailboxWorkerResult;strategy?:string;knowledge?:KnowledgeState }
const openLocal=()=>new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('mighty-local-sources',1);request.onupgradeneeded=()=>request.result.createObjectStore('sources');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
export async function localSources(key:string):Promise<LocalSources>{const store=await openLocal();try{return await new Promise((resolve,reject)=>{const request=store.transaction('sources').objectStore('sources').get(key);request.onsuccess=()=>resolve(request.result||{});request.onerror=()=>reject(request.error);});}finally{store.close();}}
let localChain:Promise<unknown>=Promise.resolve();
export function keepLocal(key:string,patch:LocalSources){
 const snapshot=structuredClone(patch);
 const job=localChain.catch(()=>{}).then(async()=>{
  const store=await openLocal();
  try{await new Promise<void>((resolve,reject)=>{
   // One read/write transaction serializes merges across browser tabs too.
   const tx=store.transaction('sources','readwrite');const sources=tx.objectStore('sources');
   tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
   const read=sources.get(key);
   read.onsuccess=()=>{try{sources.put({...read.result,...snapshot},key);}catch(error){tx.abort();reject(error);}};
  });}finally{store.close();}
 });
 localChain=job;return job;
}
export function canonicalProfile(value:string){if(!value.trim())return null;let url:URL;try{url=new URL(/^https?:/i.test(value)?value:`https://${value}`);}catch{throw Error('Enter a LinkedIn profile, such as linkedin.com/in/your-name.');}if(!['www.linkedin.com','linkedin.com'].includes(url.hostname)||!/^\/in\/[^/?#]+\/?$/.test(url.pathname))throw Error('Use a LinkedIn profile link.');return `https://www.linkedin.com${url.pathname.replace(/\/$/,'')}/`;}
export function archiveConnections(archive?:ArchiveResult):Connection[]{return archive?.connections.map(p=>({person:`${p.firstName} ${p.lastName}`.trim(),profile_url:p.url,company:p.company,position:p.position,connectedOn:p.connectedOn}))||[];}
export async function allConnections(uid:string){const rows:Connection[]=[];for(let offset=0;;offset+=1000){const {data,error}=await db!.from('connections').select('id,person,profile_url,company,role,context').eq('user_id',uid).order('id').range(offset,offset+999);if(error)throw Error(error.message);rows.push(...data);if(data.length<1000)return rows;}}
export async function readRelationships(uid:string){
 const [people,events,reads]=await Promise.all([db!.from('outreach_log').select('*').eq('user_id',uid).order('created_at',{ascending:false}),db!.from('outreach_events').select('*').eq('user_id',uid).order('created_at',{ascending:false}),db!.from('profile_reads').select('relationship_id,snapshot,observed_at,created_at').eq('user_id',uid).order('observed_at',{ascending:false}).order('created_at',{ascending:false})]);
 for(const result of [people,events,reads])if(result.error)throw Error(result.error.message);
 const latest=new Map<string,Record<string,unknown>>();for(const row of reads.data||[])if(!latest.has(row.relationship_id))latest.set(row.relationship_id,row.snapshot);
 return {people:(people.data||[]).map(p=>({...p,profile:latest.get(p.id)||(p.context.profileComplete?p.context.profile:undefined)})) as Person[],events:(events.data||[]) as Capture[]};
}
export async function savePerson(expectedUid:string|null,input:{person:string;url?:string|null;reason:string;company?:string;position?:string;source?:string}){
 const uid=await accountId(expectedUid);const profile_url=canonicalProfile(input.url||'');const person=cleanText(input.person).trim();if(!person||person.length>200)throw Error('Enter a name under 200 characters.');
 if(profile_url){const existing=await db!.from('outreach_log').select('id').eq('user_id',uid).eq('profile_url',profile_url).maybeSingle();if(existing.error)throw Error(existing.error.message);if(existing.data)return existing.data.id;}
 const {data,error}=await db!.from('outreach_log').insert({user_id:uid,person,profile_url,context:{saveReason:cleanText(input.reason),source:input.source||'manual',company:input.company||'',position:input.position||'',profileComplete:false}}).select('id').single();if(error)throw Error(error.message);return data.id;
}
export async function capture(expectedUid:string|null,personId:string,kind:string,body='',relatedId?:string){const uid=await accountId(expectedUid);const {error}=await db!.from('outreach_events').insert({user_id:uid,relationship_id:personId,kind,body:cleanText(body),related_event_id:relatedId||null});if(error)throw Error(error.message);}
export async function changeStage(expectedUid:string|null,personId:string,stage:string){const uid=await accountId(expectedUid);const {error}=await db!.from('outreach_log').update({stage}).eq('user_id',uid).eq('id',personId);if(error)throw Error(error.message);}

async function saveSource(uid:string,source:string,fingerprint:string,facts:unknown){const {error}=await db!.from('knowledge_sources').upsert({user_id:uid,source,fingerprint,facts},{onConflict:'user_id,source,fingerprint',ignoreDuplicates:true});if(error)throw Error(error.message);}
export async function saveResume(expectedUid:string|null,resume:ResumeExtraction){const uid=await accountId(expectedUid);await saveSource(uid,'resume',resume.fingerprint,{text:cleanText(resume.text),pages:resume.pages});}
export async function saveMailbox(expectedUid:string|null,result:MailboxWorkerResult){const uid=await accountId(expectedUid);const facts={...result.summary,writingSamples:result.samples};await saveSource(uid,'mailbox',await contentFingerprint(facts),facts);}
export async function saveArchive(expectedUid:string|null,archive:ArchiveResult,onProgress:(saved:number)=>void){
 const uid=await accountId(expectedUid);const hash=await contentFingerprint({uid,archive:archive.fingerprint});const id=`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
 const path=`${uid}/${archive.fingerprint}.zip`;
 const begin=await db!.from('imports').upsert({id,user_id:uid,kind:'linkedin_archive',storage_path:path},{onConflict:'id',ignoreDuplicates:true});if(begin.error)throw Error(begin.error.message);
 // Deterministic row IDs make retrying a partially completed upload safe, including missing URLs.
 for(let offset=0;offset<archive.connections.length;offset+=500){const rows=await Promise.all(archive.connections.slice(offset,offset+500).map(async(p,i)=>{const hash=await contentFingerprint({uid,archive:archive.fingerprint,row:offset+i});return {id:`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`,user_id:uid,import_id:id,person:cleanText(`${p.firstName} ${p.lastName}`).trim(),profile_url:p.url||null,company:p.company,role:p.position,context:{connectedOn:p.connectedOn}};}));
  // A SQL import function handles either stable row-id or profile-url conflicts without editing raw facts.
  const result=await db!.rpc('import_connections',{p_rows:rows});if(result.error)throw Error(result.error.message);onProgress(Math.min(offset+500,archive.connections.length));
 }
 await saveSource(uid,'archive',archive.fingerprint,{layer1:archive.layer1,counts:archive.counts,writingSamples:archive.writingSamples,companyIndex:archive.companyIndex});
 const bundle=await createSanitizedArchive(archive);const upload=await db!.storage.from('archives').upload(path,bundle,{contentType:'application/zip',upsert:true});if(upload.error)throw Error(upload.error.message);
 const finish=await db!.from('imports').update({status:'completed',record_count:archive.connections.length}).eq('user_id',uid).eq('id',id);if(finish.error)throw Error(finish.error.message);
}
export async function savedArchiveBlob(expectedUid:string|null){const uid=await accountId(expectedUid);const {data,error}=await db!.from('imports').select('storage_path').eq('user_id',uid).eq('kind','linkedin_archive').eq('status','completed').order('created_at',{ascending:false}).limit(1).maybeSingle();if(error)throw Error(error.message);if(!data?.storage_path)throw Error('No saved archive is available yet.');const result=await db!.storage.from('archives').download(data.storage_path);if(result.error)throw Error(result.error.message);return result.data;}
export function synthesizer(key:string){return createKnowledgeSynthesizer({gateway:gatewayForAccount(key),read:async()=>((await localSources(key)).knowledge||null),persist:async knowledge=>{await saveSettings({knowledge},key);await keepLocal(key,{knowledge});return {error:null};}});}
export async function strategyBrief(strategy:string,key:string){const local=await localSources(key);return {strategy,careerEvidence:knowledgeForStrategyBrief(local.knowledge||null)};}
