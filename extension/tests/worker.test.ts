import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const config = {appOrigins:['https://riteshmitsloan.github.io/mighty/','https://mighty.example'],supabaseUrl:'https://project.supabase.co',publishableKey:'sb_publishable_fixture'};
const {outputFiles} = await build({entryPoints:[fileURLToPath(new URL('../src/worker.ts',import.meta.url))],bundle:true,write:false,platform:'browser',format:'iife',target:'chrome120',metafile:true,define:{__PUBLIC_CONFIG__:JSON.stringify(config)}});
const uid='11111111-1111-4111-a111-111111111111',other='22222222-2222-4222-a222-222222222222';
const now='2026-09-12T12:00:00Z';
const goal={id:'33333333-3333-4333-a333-333333333333',kind:'career',title:'Fixture career',outcome:'Explore a leadership opportunity',criteria:[],openQuestions:[],version:1,status:'active',createdAt:now,updatedAt:now};
const token=(owner=uid)=>'fixture.'+Buffer.from(JSON.stringify({sub:owner,iss:config.supabaseUrl+'/auth/v1',exp:Math.floor(Date.now()/1000)+1800})).toString('base64url')+'.unsigned-test';
function runtime(){
  const events:Record<string,Function>={},session:Record<string,unknown>={},local:Record<string,unknown>={},calls:{path:string;url:URL;headers:Headers}[]=[],access:string[]=[];
  const state={goalRows:[{id:goal.id,user_id:uid,version:1,document:goal}] as unknown,goalStatus:200,goalRange:undefined as string|undefined,goalUnreadable:false,goalFailure:false,authOwner:uid,authStatus:200,authBody:undefined as unknown,authUnreadable:false,authFailure:false,authWait:null as Promise<void>|null,storageFailure:false,reinject:0,tabSends:0,failFirstRead:false};
  const area=(values:Record<string,unknown>,name:string)=>({async setAccessLevel(value:{accessLevel:string}){access.push(name+':'+value.accessLevel);},async get(key:string|null){return structuredClone(key===null?values:{[key]:values[key]});},async set(rows:Record<string,unknown>){if(state.storageFailure)throw Error('PRIVATE_SENTINEL storage');Object.assign(values,structuredClone(rows));},async remove(key:string){if(state.storageFailure)throw Error('PRIVATE_SENTINEL storage');delete values[key];}});
  const chrome={storage:{session:area(session,'session'),local:area(local,'local')},runtime:{id:'fixture-extension',getURL:(path:string)=>'chrome-extension://fixture-extension/'+path,
    onMessageExternal:{addListener:(f:Function)=>{events.external=f;}},onMessage:{addListener:(f:Function)=>{events.internal=f;}},onConnect:{addListener:(f:Function)=>{events.connect=f;}},onConnectExternal:{addListener:(f:Function)=>{events.bridge=f;}}},
    tabs:{async query(){return [{id:4,url:'https://www.linkedin.com/in/person/'}];},async sendMessage(){state.tabSends++;if(state.failFirstRead&&state.tabSends===1)throw Error('Invalidated context');return {kind:'profile',state:'unknown',profile:null,message:'Wait for visible sections'};}},scripting:{async executeScript(input:unknown){state.reinject++;assert.deepEqual(JSON.parse(JSON.stringify(input)),{target:{tabId:4},files:['content.js']});}}};
  const request=async(input:string|URL,init?:RequestInit)=>{
    const url=new URL(String(input)),headers=new Headers(init?.headers);calls.push({path:url.pathname,url,headers});
    if(url.pathname==='/auth/v1/user'){
      const body=state.authBody??{id:state.authOwner};if(state.authWait)await state.authWait;
      if(state.authFailure)throw Error('PRIVATE_SENTINEL network');
      return new Response(state.authUnreadable?'PRIVATE_SENTINEL invalid JSON':JSON.stringify(body),{status:state.authStatus});
    }
    if(url.pathname==='/rest/v1/goals'){
      if(state.goalFailure)throw Error('PRIVATE_SENTINEL goals network');
      return new Response(state.goalUnreadable?'PRIVATE_SENTINEL invalid JSON':JSON.stringify(state.goalRows),{status:state.goalStatus,headers:{'Content-Range':state.goalRange??(Array.isArray(state.goalRows)&&state.goalRows.length?`0-${state.goalRows.length-1}/${state.goalRows.length}`:'*/0')}});
    }
    throw Error('Unexpected network request: '+url.pathname);
  };
  runInNewContext(outputFiles[0].text,{chrome,fetch:request,URL,AbortSignal,TextEncoder,structuredClone,atob,setTimeout,clearTimeout});
  const send=(message:unknown,external=false)=>new Promise<any>(resolve=>events[external?'external':'internal'](message,external?{url:'https://mighty.example/',origin:'https://mighty.example'}:{id:chrome.runtime.id,url:chrome.runtime.getURL('popup.html')},resolve));
  return {state,session,local,calls,access,events,chrome,send,connect:()=>send({type:'mighty:connect',protocol:1,accessToken:token(state.authOwner)},true)};
}
test('worker verifies handoff, reads account goals with RLS bearer, and limits goal context to its trusted popup',async()=>{
  const h=runtime();assert.equal((await h.connect()).ok,true);
  assert.deepEqual(h.calls.map(call=>call.path),['/auth/v1/user','/rest/v1/goals']);
  assert.equal(h.calls[1].url.searchParams.get('user_id'),'eq.'+uid);assert.equal(h.calls[1].headers.get('Authorization'),h.calls[0].headers.get('Authorization'));
  const status=await h.send({type:'mighty:status'});assert.equal(status.goalContext.userId,uid);assert.equal(status.goalContext.goals[0].id,goal.id);assert.equal(status.accessToken,undefined);
  const external=await h.send({type:'mighty:status',protocol:1},true);assert.equal(external.goalContext,undefined);assert.equal(external.goalCount,1);
  let replied=false;h.events.internal({type:'mighty:status'},{id:h.chrome.runtime.id,url:'https://www.linkedin.com/in/person/',tab:{id:4}},()=>{replied=true;});assert.equal(replied,false);
  assert.deepEqual(h.access.sort(),['local:TRUSTED_CONTEXTS','session:TRUSTED_CONTEXTS']);
});
test('worker failed foreign-goal handoff leaves no previous account or goal context',async()=>{
  const h=runtime();await h.connect();h.state.authOwner=other;
  const failed=await h.connect();assert.equal(failed.ok,false);
  const status=await h.send({type:'mighty:status'});assert.equal(status.connected,false);assert.equal(status.userId,null);assert.equal(status.goalContext,null);assert.equal(h.session.account,undefined);assert.match(status.message,/incompatible/);
});
test('popup refresh loads changed saved version, while failure and token expiry clear the cache',async()=>{
  const h=runtime();await h.connect();const old=await h.send({type:'mighty:status'});
  h.state.goalRows=[{id:goal.id,user_id:uid,version:2,document:{...goal,version:2}}];
  const refreshed=await h.send({type:'mighty:status',refreshGoals:true});assert.equal(refreshed.goalContext.goals[0].version,2);assert.notEqual(old.goalContext.key,refreshed.goalContext.key);
  h.state.goalStatus=403;assert.equal((await h.send({type:'mighty:status',refreshGoals:true})).ok,false);assert.equal((await h.send({type:'mighty:status'})).goalContext,null);
  h.state.goalStatus=200;await h.connect();(h.session.account as {expiresAt:number}).expiresAt=Date.now()-1;
  const expired=await h.send({type:'mighty:status'});assert.equal(expired.connected,false);assert.equal(expired.userId,null);assert.equal(expired.goalContext,null);
  assert.ok(h.calls.every(call=>['/auth/v1/user','/rest/v1/goals'].includes(call.path)));
});
test('read-active still reinjects exactly once after extension content reload',async()=>{
  const h=runtime();h.state.failFirstRead=true;const result=await h.send({type:'mighty:read_active'});
  assert.equal(result.ok,true);assert.equal(result.snapshot.kind,'profile');assert.equal(h.state.reinject,1);assert.equal(h.state.tabSends,2);assert.equal(h.calls.length,0);
});
test('hosted external messages and persistent ports both reject sibling repositories before handoff',async()=>{
 const h=runtime(),origin='https://riteshmitsloan.github.io';
 for(const path of ['/','/other-project/','/mighty-evil/']){
  const response:any=await new Promise(resolve=>h.events.external({type:'mighty:connect',protocol:1,accessToken:token()},{url:origin+path,origin},resolve));
  assert.equal(response.ok,false);assert.equal(h.calls.length,0);
  let disconnected=false,ready=false;
  h.events.bridge({name:'mighty:bridge',sender:{url:origin+path,origin},disconnect(){disconnected=true;},postMessage(){ready=true;}});
  assert.equal(disconnected,true);assert.equal(ready,false);
 }
 const connected:any=await new Promise(resolve=>h.events.external({type:'mighty:connect',protocol:1,accessToken:token()},{url:origin+'/mighty/',origin},resolve));
 assert.equal(connected.ok,true);assert.equal(connected.appOrigin,origin+'/mighty/');assert.equal(h.calls.length,2);
 let ready=false;
 h.events.bridge({name:'mighty:bridge',sender:{url:origin+'/mighty/',origin},disconnect(){assert.fail('valid hosted bridge disconnected');},postMessage(value:any){ready=value.type==='mighty:ready';}});
 assert.equal(ready,true);
});
test('verification failures identify the safe stage and never echo response bodies or credentials',async()=>{
 const cases:[string,Partial<ReturnType<typeof runtime>['state']>][]=[
  ['verification_unavailable',{authFailure:true}],['verification_rejected',{authStatus:401,authBody:{message:'PRIVATE_SENTINEL'}}],
  ['verification_rejected',{authStatus:403,authBody:{message:'PRIVATE_SENTINEL'}}],['verification_failed',{authStatus:500,authBody:{message:'PRIVATE_SENTINEL'}}],
  ['verification_unreadable',{authUnreadable:true}],['verification_invalid',{authBody:{id:{private:'PRIVATE_SENTINEL'}}}],
  ['connection_failed',{storageFailure:true}],
 ];
 for(const [code,changes] of cases){const h=runtime();Object.assign(h.state,changes);const result=await h.connect();assert.equal(result.ok,false);assert.equal(result.code,code);assert.equal(h.session.account,undefined);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_SENTINEL|sb_publishable_fixture|unsigned-test/);assert.equal(h.calls.some(call=>call.path==='/rest/v1/goals'),false);}
});
test('verified token shape, account, issuer and expiry errors remain distinct and fail closed',async()=>{
 const raw=(claims:unknown)=>'fixture.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.unsigned-test';
 const good={sub:uid,iss:config.supabaseUrl+'/auth/v1',exp:Math.floor(Date.now()/1000)+1800};
 const cases:[string,string][]=[['session_invalid','invalid'],['session_invalid',raw({...good,exp:'private'})],['session_mismatch',raw({...good,sub:other})],['session_project_mismatch',raw({...good,iss:'https://private.example/auth/v1'})],['session_expired',raw({...good,exp:Math.floor(Date.now()/1000)-1})],['session_lifetime',raw({...good,exp:Math.floor(Date.now()/1000)+86400})]];
 for(const [code,accessToken] of cases){const h=runtime();const result=await h.send({type:'mighty:connect',protocol:1,accessToken},true);assert.equal(result.ok,false);assert.equal(result.code,code);assert.equal(h.session.account,undefined);assert.doesNotMatch(JSON.stringify(result),/private\.example|unsigned-test/);assert.equal(h.calls.length,1);}
});
test('goals errors identify retrieval, access, schema and count failures without exposing the response',async()=>{
 const cases:[string,Partial<ReturnType<typeof runtime>['state']>][]=[
  ['goals_unavailable',{goalFailure:true}],['goals_session_rejected',{goalStatus:401}],['goals_forbidden',{goalStatus:403}],['goals_failed',{goalStatus:500}],
  ['goals_unreadable',{goalUnreadable:true}],['goals_invalid',{goalRows:{private:'PRIVATE_SENTINEL'}}],['goals_incomplete',{goalRange:'0-0/2'}],
 ];
 for(const [code,changes] of cases){const h=runtime();await h.connect();Object.assign(h.state,changes);const result=await h.connect();assert.equal(result.ok,false);assert.equal(result.code,code);assert.equal(h.session.account,undefined);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_SENTINEL|sb_publishable_fixture|unsigned-test/);}
});
test('a superseded handoff reports a safe retry status and cannot erase the newer account',async()=>{
 const h=runtime();let release!:()=>void;h.state.authWait=new Promise(resolve=>{release=resolve;});const older=h.connect();
 await new Promise(resolve=>setImmediate(resolve));h.state.authWait=null;h.state.authOwner=other;h.state.goalRows=[{id:goal.id,user_id:other,version:1,document:goal}];
 assert.equal((await h.connect()).ok,true);release();const result=await older;
 assert.equal(result.ok,false);assert.equal(result.code,'connection_superseded');assert.match(result.message,/newer account connection/);
 assert.equal((await h.send({type:'mighty:status'})).userId,other);
});
