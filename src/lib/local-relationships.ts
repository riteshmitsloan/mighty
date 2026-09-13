import type {Person,Capture} from './workspace';
import type {PersonInput} from './data-access';
import {cleanText} from './text';
import {canonicalProfilePhotoUrl} from './profile-photo';

export interface LocalRelationshipState {people:Person[];events:Capture[];observations:unknown[];drafts:unknown[]}
const empty=():LocalRelationshipState=>({people:[],events:[],observations:[],drafts:[]});
/** This database represents the explicit device workspace, never an expired account fallback. */
export function createLocalRelationshipStore(name='mighty-local-relationships'){
 let chain:Promise<unknown>=Promise.resolve();
 const open=()=>new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open(name,1);request.onupgradeneeded=()=>request.result.createObjectStore('workspace');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error??Error('Device storage is unavailable.'));});
 async function read():Promise<LocalRelationshipState>{
  await chain.catch(()=>{});const database=await open();
  try{return await new Promise((resolve,reject)=>{const transaction=database.transaction('workspace','readonly'),request=transaction.objectStore('workspace').get('device');transaction.oncomplete=()=>resolve({...empty(),...request.result});transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error??Error('Device read was interrupted.'));});}finally{database.close();}
 }
 function update<T>(mutate:(state:LocalRelationshipState)=>T):Promise<T>{
  const job=chain.catch(()=>{}).then(async()=>{
   const database=await open();
   try{return await new Promise<T>((resolve,reject)=>{
    const transaction=database.transaction('workspace','readwrite'),store=transaction.objectStore('workspace'),request=store.get('device');let value:T,failure:unknown;
    request.onsuccess=()=>{try{const state={...empty(),...request.result};value=mutate(state);store.put(state,'device');}catch(error){failure=error;transaction.abort();}};
    transaction.oncomplete=()=>resolve(value);transaction.onerror=()=>{failure??=transaction.error;};transaction.onabort=()=>reject(failure??Error('Your device changes were not saved.'));
   });}finally{database.close();}
  });chain=job;return job;
 }
 return {read,update};
}
const store=createLocalRelationshipStore();
export const readLocalRelationships=store.read;
export const updateLocalRelationships=store.update;

export function insertLocalPerson(state:LocalRelationshipState,input:PersonInput,url:string|null):string{
 const name=cleanText(input.person).trim();if(!name||name.length>200)throw Error('Enter a name under 200 characters.');
 const existing=url?state.people.find(person=>person.profile_url===url):undefined;if(existing)return existing.id;
 const photoUrl=canonicalProfilePhotoUrl(input.photoUrl);
 const id=crypto.randomUUID();state.people.unshift({id,person:name,profile_url:url,stage:'saved',created_at:new Date().toISOString(),context:{saveReason:cleanText(input.reason),source:input.source||'manual',company:input.company||'',position:input.position||'',...(photoUrl?{photoUrl}:{}),...(input.searchHeadline?{searchHeadline:cleanText(input.searchHeadline).slice(0,2000)}:{}),...(input.searchSnippet?{searchSnippet:cleanText(input.searchSnippet).slice(0,8000)}:{}),profileComplete:false}});return id;
}
export function insertLocalCapture(state:LocalRelationshipState,personId:string,kind:string,body='',relatedId?:string):void{
 if(!state.people.some(person=>person.id===personId))throw Error('This person is no longer in this workspace.');
 if(!['note','contacted','replied','coffee_chat','promise_made','promise_kept'].includes(kind))throw Error('Choose a supported update.');
 if(relatedId){const related=state.events.find(event=>event.id===relatedId&&event.relationship_id===personId);if(!related)throw Error('The related update belongs to a different person or is missing.');if(state.events.some(event=>event.related_event_id===relatedId&&event.kind===kind))return;}
 state.events.unshift({id:crypto.randomUUID(),relationship_id:personId,kind,body:cleanText(body).slice(0,8000),related_event_id:relatedId??null,created_at:new Date().toISOString()});
}
