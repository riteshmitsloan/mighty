import test from 'node:test';
import assert from 'node:assert/strict';
import {startExtensionBridge} from '../src/lib/extension-bridge';
import {buildExtensionSelfContext} from '../src/lib/extension-self-context';
import {createEvidenceClaim} from '../src/lib/evidence';
const uid='11111111-1111-4111-a111-111111111111';
function setup(){
  const saved={chrome:globalThis.chrome,add:globalThis.addEventListener,remove:globalThis.removeEventListener};
  const messages:Record<string,unknown>[]=[],listeners:Record<string,Function>={};
  Object.assign(globalThis,{chrome:{runtime:{connect:()=>({onMessage:{addListener(){}},onDisconnect:{addListener(){}},disconnect(){}}),async sendMessage(_id:string,value:Record<string,unknown>){messages.push(value);return {ok:true};}}},addEventListener:(type:string,fn:Function)=>{listeners[type]=fn;},removeEventListener:(type:string)=>{delete listeners[type];}});
  return {messages,listeners,restore(){Object.assign(globalThis,{chrome:saved.chrome,addEventListener:saved.add,removeEventListener:saved.remove});}};
}
test('bridge reads the current projection on every synchronization and omission clears previous source data',async()=>{
  const env=setup();let token:string|null='fixture-token',context:ReturnType<typeof buildExtensionSelfContext>|null=buildExtensionSelfContext(uid,[createEvidenceClaim({subject:'self',field:'company',text:'Example',sourceKind:'profile',sourceLabel:'Own',confidence:'observed',appliesTo:'contact'})]);
  const bridge=startExtensionBridge({extensionId:'a'.repeat(32),getAccessToken:async()=>token,getSelfContext:()=>context});
  try{
    await bridge.sync();assert.deepEqual(env.messages[0].selfContext,context);
    context=null;await bridge.sync();assert.equal(env.messages[1].selfContext,undefined);
    token=null;await bridge.sync();assert.deepEqual(env.messages[2],{type:'mighty:disconnect',protocol:1});
    assert.ok(env.messages.every(value=>!('refreshToken' in value)));
  }finally{bridge.dispose();env.restore();}
});
test('a late session read or disposed bridge cannot dispatch stale account profile context',async()=>{
  const env=setup();let release!:(value:string|null)=>void,reads=0;
  const delayed=new Promise<string|null>(done=>{release=done;});
  const bridge=startExtensionBridge({extensionId:'a'.repeat(32),getAccessToken:()=>++reads===1?delayed:Promise.resolve(null)});
  try{
    const old=bridge.sync();await bridge.sync();release('old-account-token');await old;
    assert.deepEqual(env.messages,[{type:'mighty:disconnect',protocol:1}]);
    bridge.dispose();await bridge.sync();assert.equal(env.messages.length,1);
  }finally{bridge.dispose();env.restore();}
});
