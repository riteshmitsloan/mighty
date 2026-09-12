import {db,accountId} from './platform';
import {drainInboxData} from './data-access';
const drains=new Map<string,Promise<{saved:number;failed:number}>>();
export async function drainInbox(expectedUid?:string|null){
 const uid=await accountId(expectedUid);const existing=drains.get(uid);if(existing)return existing;
 const work=drainInboxData(db!,uid,()=>accountId(uid));drains.set(uid,work);
 try{return await work;}finally{if(drains.get(uid)===work)drains.delete(uid);}
}
export function watchInbox(onResult:(r:{saved:number;failed:number})=>void,onError:(e:Error)=>void,expectedUid?:string|null){
 let active=true;
 // Resolve the owner once for this watcher; a later focus never selects another account.
 const owner=accountId(expectedUid);
 const run=()=>{void owner.then(uid=>active?drainInbox(uid):null).then(result=>{if(active&&result)onResult(result);}).catch(error=>{if(active)onError(error instanceof Error?error:Error(String(error)));});};
 const visible=()=>{if(document.visibilityState==='visible')run();};run();window.addEventListener('focus',run);document.addEventListener('visibilitychange',visible);
 return()=>{active=false;window.removeEventListener('focus',run);document.removeEventListener('visibilitychange',visible);};
}
