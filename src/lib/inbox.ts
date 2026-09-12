import {db,accountId} from './platform';
const drains=new Map<string,Promise<{saved:number;failed:number}>>();
export async function drainInbox(){const uid=await accountId();const existing=drains.get(uid);if(existing)return existing;const work=(async()=>{
 const {data:items,error}=await db!.from('outreach_inbox').select('id,profile_url').eq('user_id',uid).is('consumed_at',null).order('created_at').limit(100);if(error)throw Error(error.message);if(!items?.length)return {saved:0,failed:0};
 const urls=[...new Set(items.map(i=>i.profile_url))];
 // One .in query preloads all saved matches. The transaction remains the race authority.
 const {error:lookupError}=await db!.from('outreach_log').select('id,profile_url').eq('user_id',uid).in('profile_url',urls);if(lookupError)throw Error(lookupError.message);
 let saved=0,failed=0;
 for(let i=0;i<items.length;i+=8){const outcomes=await Promise.allSettled(items.slice(i,i+8).map(async item=>{const {data,error}=await db!.rpc('consume_inbox',{p_id:item.id});if(error||!data)throw Error(error?.message||'Inbox item was not saved.');}));for(const outcome of outcomes){if(outcome.status==='fulfilled')saved++;else failed++;}}
 return {saved,failed};
 })();drains.set(uid,work);try{return await work;}finally{drains.delete(uid);}}
export function watchInbox(onResult:(r:{saved:number;failed:number})=>void,onError:(e:Error)=>void){let active=true;const run=()=>{void drainInbox().then(r=>{if(active)onResult(r);}).catch(e=>{if(active)onError(e);});};const visible=()=>{if(document.visibilityState==='visible')run();};run();window.addEventListener('focus',run);document.addEventListener('visibilitychange',visible);return()=>{active=false;window.removeEventListener('focus',run);document.removeEventListener('visibilitychange',visible);};}
