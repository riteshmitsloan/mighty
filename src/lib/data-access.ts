import type { SupabaseClient } from '@supabase/supabase-js';
import { cleanText } from './text';
import {verifiedCompanyOverlap,type Connection} from './discover';
import {companyKey} from './archive';
export interface Person { id:string;person:string;profile_url:string|null;stage:string;context:Record<string,unknown>;created_at:string;profile?:Record<string,unknown> }
export interface Capture { id:string;relationship_id:string;kind:string;body:string;related_event_id:string|null;created_at:string }
interface ProfileRead { id:string;relationship_id:string;snapshot:Record<string,unknown>;observed_at:string;created_at:string }
export interface PersonInput { person:string;url?:string|null;reason:string;company?:string;position?:string;source?:string;searchHeadline?:string;searchSnippet?:string }
export type PinnedAccountCheck=()=>Promise<unknown>;

/** A stable ID cursor cannot skip rows when earlier records leave the result set. */
export async function readAllById<T extends {id:string}>(client:SupabaseClient,table:string,columns:string,uid:string):Promise<T[]>{
 const rows:T[]=[];let after:string|undefined;
 for(;;){
  let query=client.from(table).select(columns).eq('user_id',uid).order('id',{ascending:true}).limit(1000);
  if(after)query=query.gt('id',after);
  const {data,error}=await query;if(error)throw Error(error.message);
  if(!data?.length)return rows;
  const page=data as unknown as T[];const next=page[page.length-1].id;
  if(typeof next!=='string'||(after&&next<=after))throw Error('The account records could not be paged safely. Please try again.');
  rows.push(...page);after=next;
  // Fetch until empty: a project's row limit may be lower than the requested page size.
 }
}
const newest=(a:{created_at:string;id:string},b:{created_at:string;id:string})=>Date.parse(b.created_at)-Date.parse(a.created_at)||b.id.localeCompare(a.id);
export async function readRelationshipData(client:SupabaseClient,uid:string){
 const [people,events,reads]=await Promise.all([
  readAllById<Person>(client,'outreach_log','*',uid),
  readAllById<Capture>(client,'outreach_events','*',uid),
  readAllById<ProfileRead>(client,'profile_reads','id,relationship_id,snapshot,observed_at,created_at',uid)
 ]);
 people.sort(newest);events.sort(newest);
 reads.sort((a,b)=>Date.parse(b.observed_at)-Date.parse(a.observed_at)||newest(a,b));
 const latest=new Map<string,Record<string,unknown>>();for(const read of reads)if(!latest.has(read.relationship_id))latest.set(read.relationship_id,read.snapshot);
 return {people:people.map(person=>({...person,profile:latest.get(person.id)||(person.context.profileComplete?person.context.profile as Record<string,unknown>:undefined)})),events};
}
export async function readConnectionsData(client:SupabaseClient,uid:string):Promise<Connection[]>{
 const [rows,source]=await Promise.all([
  readAllById<Connection&{id:string}>(client,'connections','id,person,profile_url,company,role,context',uid),
  client.from('knowledge_sources').select('companyIndex:facts->companyIndex').eq('user_id',uid).eq('source','archive').order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle()
 ]);
 if(source.error)throw Error(source.error.message);
 const candidate=source.data?.companyIndex;
 const index=candidate&&typeof candidate==='object'&&!Array.isArray(candidate)?candidate as Record<string,unknown>:{};
 return rows.map(row=>({...row,companyOverlap:verifiedCompanyOverlap(row.company,Object.hasOwn(index,companyKey(row.company||''))?index[companyKey(row.company||'')]:null)}));
}

/** The unique constraint is the authority when two tabs save the same profile together. */
export async function savePersonData(client:SupabaseClient,uid:string,input:PersonInput,profileUrl:string|null):Promise<string>{
 const person=cleanText(input.person).trim();if(!person||person.length>200)throw Error('Enter a name under 200 characters.');
 const existing=async()=>{const result=await client.from('outreach_log').select('id').eq('user_id',uid).eq('profile_url',profileUrl).maybeSingle();if(result.error)throw Error(result.error.message);return result.data?.id as string|undefined;};
 if(profileUrl){const id=await existing();if(id)return id;}
 const result=await client.from('outreach_log').insert({user_id:uid,person,profile_url:profileUrl,context:{saveReason:cleanText(input.reason),source:input.source||'manual',company:input.company||'',position:input.position||'',...(input.searchHeadline?{searchHeadline:cleanText(input.searchHeadline).slice(0,2000)}:{}),...(input.searchSnippet?{searchSnippet:cleanText(input.searchSnippet).slice(0,8000)}:{}),profileComplete:false}}).select('id').single();
 if(result.error){
  if(result.error.code==='23505'&&profileUrl){const id=await existing();if(id)return id;}
  throw Error(result.error.message);
 }
 if(!result.data?.id)throw Error('This person was not saved. Your draft is preserved.');
 return result.data.id as string;
}
export async function updateStageData(client:SupabaseClient,uid:string,personId:string,stage:string){
 const result=await client.from('outreach_log').update({stage}).eq('user_id',uid).eq('id',personId).select('id').maybeSingle();
 if(result.error)throw Error(result.error.message);
 if(!result.data?.id)throw Error('The stage was not updated. Your account may have changed, expired, or lost access to this person.');
}
export async function finishImportData(client:SupabaseClient,uid:string,id:string,recordCount:number){
 const result=await client.from('imports').update({status:'completed',record_count:recordCount}).eq('user_id',uid).eq('id',id).select('id').maybeSingle();
 if(result.error)throw Error(result.error.message);
 if(!result.data?.id)throw Error('The import was not marked complete. Your local files are preserved; reconnect the original account and retry.');
}

/** Every pending item is attempted once per drain, including rows after a failed batch. */
export async function drainInboxData(client:SupabaseClient,uid:string,assertAccount:PinnedAccountCheck=async()=>{}):Promise<{saved:number;failed:number}>{
 let after:string|undefined;let saved=0,failed=0;
 for(;;){
  await assertAccount();
  let query=client.from('outreach_inbox').select('id,profile_url').eq('user_id',uid).is('consumed_at',null).order('id',{ascending:true}).limit(100);
  if(after)query=query.gt('id',after);
  const {data:items,error}=await query;if(error)throw Error(error.message);if(!items?.length)return {saved,failed};
  const next=items[items.length-1].id as string;if(typeof next!=='string'||(after&&next<=after))throw Error('The extension inbox could not be paged safely. Please try again.');
  const urls=[...new Set(items.map(item=>item.profile_url))];
  // One lookup per batch; consume_inbox remains the atomic authority for existing relationships.
  const lookup=await client.from('outreach_log').select('id,profile_url').eq('user_id',uid).in('profile_url',urls);if(lookup.error)throw Error(lookup.error.message);
  for(let offset=0;offset<items.length;offset+=8){
   await assertAccount();
   const outcomes=await Promise.allSettled(items.slice(offset,offset+8).map(async item=>{
    const result=await client.rpc('consume_inbox',{p_id:item.id});if(result.error||!result.data)throw Error(result.error?.message||'Inbox item was not saved.');
   }));
   for(const result of outcomes)if(result.status==='fulfilled')saved++;else failed++;
  }
  after=next;
 }
}
