import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDeviceHandoff, HandoffConflictError, type DeviceCopyRequest, type RemoteHandoffSources} from '../src/lib/device-handoff';
import type {LocalSources} from '../src/lib/workspace';

const A = '11111111-1111-4111-a111-111111111111';
const B = '22222222-2222-4222-a222-222222222222';
const resume = (fingerprint='fixture-resume') => ({text:'Synthetic resume text', pages:1, fingerprint});
const clone = <T>(value:T):T => structuredClone(value);
function harness(device:LocalSources, account:LocalSources={}) {
  const records = new Map<string,LocalSources>([['device-draft',clone(device)],[A,clone(account)],[B,{}]]);
  let current = A;
  let remote:RemoteHandoffSources = {archive:[],resume:[],mailbox:[]};
  const copies:DeviceCopyRequest[]=[];
  let beforeCopy:(()=>void)|undefined;
  let beforeRemote:(()=>void)|undefined;
  const dependencies = {
    verifyAccount:async(uid:string)=>{if(uid!==current)throw Error('Account changed');return uid;},
    readLocal:async(key:string)=>clone(records.get(key)||{}),
    readRemote:async(_uid:string)=>{beforeRemote?.();return clone(remote);},
    fingerprint:async(value:unknown)=>JSON.stringify(value),
    copyLocal:async(request:DeviceCopyRequest)=>{
      beforeCopy?.();
      const source=records.get('device-draft')!;const target=records.get(request.destinationUid)||{};
      // Model the atomic storage boundary; native IndexedDB is checked separately.
      for(const field of request.fields){
        if(JSON.stringify(source[field])!==JSON.stringify(request.expectedDevice[field]))throw Error('Device changed in transaction');
        if(JSON.stringify(target[field])!==JSON.stringify(request.expectedAccount[field]))throw Error('Account changed in transaction');
      }
      const next=clone(target);const copied:LocalSources={};
      for(const field of request.fields){if(next[field]===undefined)Object.assign(next,{[field]:clone(source[field])});Object.assign(copied,{[field]:clone(next[field])});}
      records.set(request.destinationUid,next);copies.push(clone(request));return copied;
    },
  };
  return {api:createDeviceHandoff(dependencies),records,copies,setCurrent:(uid:string)=>{current=uid;},setRemote:(value:RemoteHandoffSources)=>{remote=value;},onCopy:(fn:()=>void)=>{beforeCopy=fn;},onRemote:(fn:()=>void)=>{beforeRemote=fn;}};
}

test('preparation performs no writes; explicit selected copy preserves the device and unrelated account sources',async()=>{
 const h=harness({resume:resume(),strategy:'Device goal'},{strategy:'Keep account goal'});
 const before=clone(h.records.get('device-draft'));
 const preview=await h.api.prepare(A,['resume']);assert.equal(h.copies.length,0);assert.deepEqual(preview.conflicts,[]);
 const result=await h.api.copy(preview);assert.equal(h.copies.length,1);assert.equal(result.destinationUid,A);assert.deepEqual(result.fields,['resume']);
 assert.deepEqual(h.records.get('device-draft'),before);assert.equal(h.records.get(A)?.strategy,'Keep account goal');assert.deepEqual(h.records.get(A)?.resume,resume());assert.deepEqual(h.records.get(B),{});
});

test('blank remote provisioning goal is absent, but an explicitly cleared local goal conflicts',async()=>{
 const h=harness({strategy:'Device goal'});h.setRemote({archive:[],resume:[],mailbox:[],strategy:''});
 assert.deepEqual((await h.api.prepare(A,['strategy'])).conflicts,[]);
 h.records.set(A,{strategy:''});const preview=await h.api.prepare(A,['strategy']);assert.deepEqual(preview.conflicts,[{field:'strategy',location:'local-account',reason:'different-source'}]);
 await assert.rejects(h.api.copy(preview),HandoffConflictError);assert.equal(h.copies.length,0);
});

test('different local or remote sources are refused rather than overwritten',async()=>{
 const h=harness({resume:resume('device-version'),strategy:'Device goal'},{resume:resume('account-version')});
 h.setRemote({archive:[],resume:['remote-version'],mailbox:[],strategy:'Account goal'});
 const preview=await h.api.prepare(A,['resume','strategy']);assert.equal(preview.conflicts.length,3);
 await assert.rejects(h.api.copy(preview),HandoffConflictError);assert.equal(h.copies.length,0);assert.equal(h.records.get(A)?.resume?.fingerprint,'account-version');
});

test('matching existing sources stay unchanged and retrying a copy is idempotent',async()=>{
 const existing={...resume(),pages:9};const h=harness({resume:resume()},{resume:existing});h.setRemote({archive:[],resume:['older-fingerprint','fixture-resume'],mailbox:[]});
 const preview=await h.api.prepare(A,['resume']);await h.api.copy(preview);await h.api.copy(preview);
 assert.deepEqual(h.records.get(A)?.resume,existing);assert.deepEqual(h.records.get('device-draft')?.resume,resume());
});

test('switching accounts between preview and action writes to neither account',async()=>{
 const h=harness({resume:resume()});const preview=await h.api.prepare(A,['resume']);h.setCurrent(B);
 await assert.rejects(h.api.copy(preview),/Account changed/);assert.equal(h.copies.length,0);assert.deepEqual(h.records.get(A),{});assert.deepEqual(h.records.get(B),{});
});

test('an account switch during fresh remote checks refuses the copy',async()=>{
 const h=harness({strategy:'Device goal'});const preview=await h.api.prepare(A,['strategy']);h.onRemote(()=>h.setCurrent(B));
 await assert.rejects(h.api.copy(preview),/Account changed/);assert.equal(h.copies.length,0);assert.deepEqual(h.records.get(B),{});
});

test('changing the selected source fingerprint invalidates its preview',async()=>{
 const h=harness({resume:resume('first')});const preview=await h.api.prepare(A,['resume']);h.records.set('device-draft',{resume:resume('second')});
 await assert.rejects(h.api.copy(preview),/device sources changed/);assert.equal(h.copies.length,0);
});

test('preview pins the source payload even when a stale fingerprint string is unchanged',async()=>{
 const h=harness({resume:resume()});const preview=await h.api.prepare(A,['resume']);h.records.set('device-draft',{resume:{...resume(),text:'Changed content without updating fingerprint'}});
 await assert.rejects(h.api.copy(preview),/Device changed in transaction/);assert.equal(h.copies.length,0);assert.deepEqual(h.records.get(A),{});
});

test('a destination change at the final copy boundary is refused atomically',async()=>{
 const h=harness({resume:resume(),strategy:'Device goal'});const preview=await h.api.prepare(A,['resume','strategy']);
 h.onCopy(()=>h.records.set(A,{strategy:'Concurrent account goal'}));await assert.rejects(h.api.copy(preview),/Account changed in transaction/);
 assert.deepEqual(h.records.get(A),{strategy:'Concurrent account goal'});assert.equal(h.copies.length,0);
});

test('a new remote conflict after preview is checked again before any local write',async()=>{
 const h=harness({strategy:'Device goal'});const preview=await h.api.prepare(A,['strategy']);h.setRemote({archive:[],resume:[],mailbox:[],strategy:'New account goal'});
 await assert.rejects(h.api.copy(preview),HandoffConflictError);assert.equal(h.copies.length,0);
});

test('missing sources, duplicate selections, and forged previews cannot copy data',async()=>{
 const h=harness({resume:resume()});await assert.rejects(h.api.prepare(A,['resume','resume']),/distinct/);
 const missing=await h.api.prepare(A,['strategy']);await assert.rejects(h.api.copy(missing),HandoffConflictError);
 const real=await h.api.prepare(A,['resume']);await assert.rejects(h.api.copy({...real}),/Prepare/);assert.equal(h.copies.length,0);
});

test('copying an explicitly empty device goal keeps it empty and does not touch another account',async()=>{
 const h=harness({strategy:''});const preview=await h.api.prepare(A,['strategy']);const result=await h.api.copy(preview);
 assert.equal(h.records.get(A)?.strategy,'');assert.equal(result.snapshot.strategy,'');assert.equal(h.records.get('device-draft')?.strategy,'');assert.deepEqual(h.records.get(B),{});
});
