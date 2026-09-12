import {createLocalSourceStore} from '../../src/lib/local-sources';
import type {DeviceCopyRequest} from '../../src/lib/device-handoff';
const button=document.getElementById('run') as HTMLButtonElement;
const status=document.getElementById('status')!;
const results=document.getElementById('results')!;
const expect=(condition:unknown,message:string)=>{if(!condition)throw Error(message);};
const same=(a:unknown,b:unknown,message:string)=>expect(JSON.stringify(a)===JSON.stringify(b),message);
button.onclick=async()=>{
 button.disabled=true;results.replaceChildren();status.textContent='Running with synthetic sources only…';
 const name=`mighty-handoff-check-${crypto.randomUUID()}`;
 const store=createLocalSourceStore(name);
 const account=crypto.randomUUID();
 const resume={text:'Synthetic handoff source',pages:1,fingerprint:'fixture-resume'};
 const device={resume,strategy:'Synthetic device goal'};
 let failure:unknown;let passed=0;
 const request=async(fields:DeviceCopyRequest['fields']):Promise<DeviceCopyRequest>=>({destinationUid:account,fields,expectedDevice:await store.localSources('device-draft'),expectedAccount:await store.localSources(account)});
 const check=async(label:string,work:()=>Promise<void>)=>{const row=document.createElement('li');row.textContent=label;results.append(row);await work();passed++;row.textContent=`${label} — passed`;};
 try{
  await store.keepLocal('device-draft',device);
  await check('Selected copy preserves the device and unrelated account data',async()=>{
   await store.keepLocal(account,{resume:{text:'Existing account resume',pages:2,fingerprint:'account-resume'}});
   const before=await store.localSources(account);
   const copied=await store.copyDeviceSources(await request(['strategy']));
   same(copied,{strategy:device.strategy},'Copy returned unselected fields.');
   same((await store.localSources(account)).resume,before.resume,'Unrelated account source changed.');
   same(await store.localSources('device-draft'),device,'Device source was changed.');
  });
  await check('Different existing account sources cannot be replaced',async()=>{
   const before=await store.localSources(account);let refused=false;
   try{await store.copyDeviceSources(await request(['resume']));}catch{refused=true;}
   expect(refused,'A conflicting source was accepted.');same(await store.localSources(account),before,'A conflict changed account data.');
  });
  await check('A changed source after preview invalidates the native copy',async()=>{
   const prepared=await request(['strategy']);
   await store.keepLocal('device-draft',{strategy:'Changed after preview'});let refused=false;
   try{await store.copyDeviceSources(prepared);}catch{refused=true;}
   expect(refused,'A changed device draft was copied.');expect((await store.localSources(account)).strategy===device.strategy,'The target goal changed.');
  });
  await check('A combined copy rolls back both destination records after a write failure',async()=>{
   const isolatedAccount=crypto.randomUUID();
   const prepared:DeviceCopyRequest={destinationUid:isolatedAccount,fields:['resume','strategy'],expectedDevice:await store.localSources('device-draft'),expectedAccount:{}};
   const original=IDBObjectStore.prototype.put;let refused=false;
   // Only this UUID-named fixture database is affected; the production database
   // and any unrelated concurrent transaction pass through unchanged.
   IDBObjectStore.prototype.put=function(value:unknown,key?:IDBValidKey){
    if(this.transaction.db.name===name&&Array.isArray(key)&&key[0]==='mighty:goal:v1'&&key[1]===isolatedAccount)throw new DOMException('Synthetic goal write failure','QuotaExceededError');
    return original.call(this,value,key);
   };
   try{await store.copyDeviceSources(prepared);}catch{refused=true;}finally{IDBObjectStore.prototype.put=original;}
   expect(refused,'The injected failure was not surfaced.');same(await store.localSources(isolatedAccount),{},'Half a combined copy committed.');same(await store.localSources('device-draft'),prepared.expectedDevice,'Rollback altered the device copy.');
  });
 }catch(error){failure=error;}
 finally{
  try{await new Promise<void>((resolve,reject)=>{const removal=indexedDB.deleteDatabase(name);removal.onsuccess=()=>resolve();removal.onerror=()=>reject(removal.error);removal.onblocked=()=>reject(Error('Close the test connection to finish cleanup.'));});}catch(error){failure??=error;}
  button.disabled=false;
 }
 status.textContent=failure?`${passed} checks passed. ${failure instanceof Error?failure.message:String(failure)}`:'4 of 4 native handoff checks passed. Temporary fixture database removed.';
 status.dataset.state=failure?'failed':'passed';
};
