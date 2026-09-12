import { db, accountId, gatewayForAccount, saveSettings } from './platform';
import { createSanitizedArchive, companyOverlapFor, type ArchiveResult } from './archive';
import { cleanText, contentFingerprint } from './text';
import { createKnowledgeSynthesizer, knowledgeForStrategyBrief, type KnowledgeState } from './knowledge';
import type { ResumeExtraction } from './resume';
import type { MailboxWorkerResult } from './mbox.worker';
import type { Connection } from './discover';
import { readConnectionsData, readRelationshipData, savePersonData, updateStageData, finishImportData } from './data-access';
import { localSources, keepLocal } from './local-sources';
export { localSources, keepLocal } from './local-sources';

export interface Person { id:string;person:string;profile_url:string|null;stage:string;context:Record<string,unknown>;created_at:string; profile?:Record<string,unknown> }
export interface Capture { id:string;relationship_id:string;kind:string;body:string;related_event_id:string|null;created_at:string }
export interface LocalSources { archive?:ArchiveResult;resume?:ResumeExtraction;mailbox?:MailboxWorkerResult;strategy?:string;knowledge?:KnowledgeState }
export function canonicalProfile(value:string){if(!value.trim())return null;let url:URL;try{url=new URL(/^https?:/i.test(value)?value:`https://${value}`);}catch{throw Error('Enter a LinkedIn profile, such as linkedin.com/in/your-name.');}if(!['www.linkedin.com','linkedin.com'].includes(url.hostname)||!/^\/in\/[^/?#]+\/?$/.test(url.pathname))throw Error('Use a LinkedIn profile link.');return `https://www.linkedin.com${url.pathname.replace(/\/$/,'')}/`;}
export function archiveConnections(archive?:ArchiveResult):Connection[]{return archive?.connections.map(p=>({person:`${p.firstName} ${p.lastName}`.trim(),profile_url:p.url,company:p.company,position:p.position,connectedOn:p.connectedOn,companyOverlap:companyOverlapFor(archive.companyIndex,p.company)}))||[];}
export async function allConnections(uid:string){await accountId(uid);const rows=await readConnectionsData(db!,uid);await accountId(uid);return rows;}
export async function readRelationships(uid:string){await accountId(uid);const result=await readRelationshipData(db!,uid);await accountId(uid);return result;}
export async function savePerson(expectedUid:string|null,input:import('./data-access').PersonInput){
 const uid=await accountId(expectedUid);const profileUrl=canonicalProfile(input.url||'');return savePersonData(db!,uid,input,profileUrl);
}
export async function capture(expectedUid:string|null,personId:string,kind:string,body='',relatedId?:string){const uid=await accountId(expectedUid);const {error}=await db!.from('outreach_events').insert({user_id:uid,relationship_id:personId,kind,body:cleanText(body),related_event_id:relatedId||null});if(error)throw Error(error.message);}
export async function changeStage(expectedUid:string|null,personId:string,stage:string){const uid=await accountId(expectedUid);await updateStageData(db!,uid,personId,stage);}

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
 await accountId(uid);await finishImportData(db!,uid,id,archive.connections.length);
}
export async function savedArchiveBlob(expectedUid:string|null){const uid=await accountId(expectedUid);const {data,error}=await db!.from('imports').select('storage_path').eq('user_id',uid).eq('kind','linkedin_archive').eq('status','completed').order('created_at',{ascending:false}).limit(1).maybeSingle();if(error)throw Error(error.message);if(!data?.storage_path)throw Error('No saved archive is available yet.');const result=await db!.storage.from('archives').download(data.storage_path);if(result.error)throw Error(result.error.message);return result.data;}
export function synthesizer(key:string){return createKnowledgeSynthesizer({gateway:gatewayForAccount(key),read:async()=>((await localSources(key)).knowledge||null),persist:async knowledge=>{await saveSettings({knowledge},key);await keepLocal(key,{knowledge});return {error:null};}});}
export async function strategyBrief(strategy:string,key:string){const local=await localSources(key);return {strategy,careerEvidence:knowledgeForStrategyBrief(local.knowledge||null)};}
