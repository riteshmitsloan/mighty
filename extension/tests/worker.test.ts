import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {createProfilePanel} from '../src/profile-panel.js';
const {parseHTML}=createRequire(import.meta.url)('linkedom');
const config = {appOrigins:['https://riteshmitsloan.github.io/mighty/','https://mighty.example'],supabaseUrl:'https://project.supabase.co',publishableKey:'sb_publishable_fixture'};
const {outputFiles} = await build({entryPoints:[fileURLToPath(new URL('../src/worker.ts',import.meta.url))],bundle:true,write:false,platform:'browser',format:'iife',target:'chrome120',metafile:true,define:{__PUBLIC_CONFIG__:JSON.stringify(config)}});
const uid='11111111-1111-4111-a111-111111111111',other='22222222-2222-4222-a222-222222222222';
const now='2026-09-12T12:00:00Z';
const goal={id:'33333333-3333-4333-a333-333333333333',kind:'career',title:'Fixture career',outcome:'Explore a leadership opportunity',criteria:[],openQuestions:[],version:1,status:'active',createdAt:now,updatedAt:now};
const token=(owner=uid)=>'fixture.'+Buffer.from(JSON.stringify({sub:owner,iss:config.supabaseUrl+'/auth/v1',exp:Math.floor(Date.now()/1000)+1800})).toString('base64url')+'.unsigned-test';
function runtime(){
  const events:Record<string,Function>={},session:Record<string,unknown>={},local:Record<string,unknown>={},calls:{path:string;url:URL;headers:Headers;body:unknown}[]=[],access:string[]=[];
  const state={goalRows:[{id:goal.id,user_id:uid,version:1,document:goal}] as unknown,goalStatus:200,goalRange:undefined as string|undefined,goalUnreadable:false,goalFailure:false,goalWait:null as Promise<void>|null,saveStatus:201,saveWait:null as Promise<void>|null,tabUrl:'https://www.linkedin.com/in/person/',tabWait:null as Promise<void>|null,authOwner:uid,authStatus:200,authBody:undefined as unknown,authUnreadable:false,authFailure:false,authWait:null as Promise<void>|null,storageFailure:false,reinject:0,tabSends:0,failFirstRead:false,routeOnFailedRead:undefined as string|undefined};
  const area=(values:Record<string,unknown>,name:string)=>({async setAccessLevel(value:{accessLevel:string}){access.push(name+':'+value.accessLevel);},async get(key:string|null){return structuredClone(key===null?values:{[key]:values[key]});},async set(rows:Record<string,unknown>){if(state.storageFailure)throw Error('PRIVATE_SENTINEL storage');Object.assign(values,structuredClone(rows));},async remove(key:string){if(state.storageFailure)throw Error('PRIVATE_SENTINEL storage');delete values[key];}});
  const chrome={storage:{session:area(session,'session'),local:area(local,'local')},runtime:{id:'fixture-extension',getURL:(path:string)=>'chrome-extension://fixture-extension/'+path,
    onMessageExternal:{addListener:(f:Function)=>{events.external=f;}},onMessage:{addListener:(f:Function)=>{events.internal=f;}},onConnect:{addListener:(f:Function)=>{events.connect=f;}},onConnectExternal:{addListener:(f:Function)=>{events.bridge=f;}}},
    tabs:{onUpdated:{addListener:(f:Function)=>{events.tabUpdated=f;}},async get(id:number){if(state.tabWait)await state.tabWait;return {id,url:state.tabUrl};},async query(){return [{id:4,url:state.tabUrl}];},async sendMessage(){state.tabSends++;if(state.failFirstRead&&state.tabSends===1){if(state.routeOnFailedRead)state.tabUrl=state.routeOnFailedRead;throw Error('Invalidated context');}return {kind:'profile',state:'unknown',profile:null,message:'Wait for visible sections'};}},scripting:{async executeScript(input:unknown){state.reinject++;assert.deepEqual(JSON.parse(JSON.stringify(input)),{target:{tabId:4},files:['content.js']});}}};
  const request=async(input:string|URL,init?:RequestInit)=>{
    const url=new URL(String(input)),headers=new Headers(init?.headers);calls.push({path:url.pathname,url,headers,body:init?.body?JSON.parse(String(init.body)):null});
    if(url.pathname==='/auth/v1/user'){
      const body=state.authBody??{id:state.authOwner};if(state.authWait)await state.authWait;
      if(state.authFailure)throw Error('PRIVATE_SENTINEL network');
      return new Response(state.authUnreadable?'PRIVATE_SENTINEL invalid JSON':JSON.stringify(body),{status:state.authStatus});
    }
    if(url.pathname==='/rest/v1/goals'){
      const body=state.goalRows,status=state.goalStatus,unreadable=state.goalUnreadable,range=state.goalRange;if(state.goalWait)await state.goalWait;
      if(state.goalFailure)throw Error('PRIVATE_SENTINEL goals network');
      return new Response(unreadable?'PRIVATE_SENTINEL invalid JSON':JSON.stringify(body),{status,headers:{'Content-Range':range??(Array.isArray(body)&&body.length?`0-${body.length-1}/${body.length}`:'*/0')}});
    }
    if(url.pathname==='/rest/v1/outreach_inbox'){const status=state.saveStatus;if(state.saveWait)await state.saveWait;return new Response('[]',{status});}
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
  let refused:any;h.events.internal({type:'mighty:status'},{id:h.chrome.runtime.id,url:'https://www.linkedin.com/in/person/',tab:{id:4}},(value:any)=>{refused=value;});assert.equal(refused.ok,false);assert.equal(refused.code,'panel_frame_not_top');assert.equal(refused.goalContext,undefined);
  assert.deepEqual(h.access.sort(),['local:TRUSTED_CONTEXTS','session:TRUSTED_CONTEXTS']);
});
test('verified replacement with foreign goal rows keeps only its new identity and no old goals',async()=>{
  const h=runtime();await h.connect();h.state.authOwner=other;
  const failed=await h.connect();assert.equal(failed.ok,true);assert.equal(failed.code,'goals_invalid');
  const status=await h.send({type:'mighty:status'});assert.equal(status.connected,true);assert.equal(status.userId,other);assert.equal(status.goalContext,null);assert.equal((h.session.account as any).userId,other);assert.equal((h.session.account as any).goalContext,undefined);assert.match(status.message,/incompatible/);
});
test('popup refresh loads changed saved version, while failure and token expiry clear the cache',async()=>{
  const h=runtime();await h.connect();const old=await h.send({type:'mighty:status'});
  h.state.goalRows=[{id:goal.id,user_id:uid,version:2,document:{...goal,version:2}}];
  const refreshed=await h.send({type:'mighty:status',refreshGoals:true});assert.equal(refreshed.goalContext.goals[0].version,2);assert.notEqual(old.goalContext.key,refreshed.goalContext.key);
  h.state.goalStatus=403;const failed=await h.send({type:'mighty:status',refreshGoals:true});assert.equal(failed.ok,true);assert.equal(failed.connected,true);assert.equal(failed.goalContext,null);assert.equal(failed.code,'goals_forbidden');
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
 for(const [code,changes] of cases){const h=runtime();await h.connect();Object.assign(h.state,changes);const result=await h.connect();const rejected=code==='goals_session_rejected';assert.equal(result.ok,!rejected);assert.equal(result.connected,!rejected);assert.equal(result.code,code);assert.equal((h.session.account as any)?.userId??null,rejected?null:uid);assert.equal((h.session.account as any)?.goalContext,undefined);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_SENTINEL|sb_publishable_fixture|unsigned-test/);}
});
test('a superseded handoff reports a safe retry status and cannot erase the newer account',async()=>{
 const h=runtime();let release!:()=>void;h.state.authWait=new Promise(resolve=>{release=resolve;});const older=h.connect();
 await new Promise(resolve=>setImmediate(resolve));h.state.authWait=null;h.state.authOwner=other;h.state.goalRows=[{id:goal.id,user_id:other,version:1,document:goal}];
 assert.equal((await h.connect()).ok,true);release();const result=await older;
 assert.equal(result.ok,false);assert.equal(result.code,'connection_superseded');assert.match(result.message,/newer account connection/);
 assert.equal((await h.send({type:'mighty:status'})).userId,other);
});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function contentSender(h:ReturnType<typeof runtime>,url=h.state.tabUrl){return{id:h.chrome.runtime.id,url,origin:new URL(url).origin,frameId:0,documentLifecycle:'active',tab:{id:4,url}};}
function fromContent(h:ReturnType<typeof runtime>,message:unknown,sender=contentSender(h)){return new Promise<any>(resolve=>{const accepted=h.events.internal(message,sender,resolve);assert.equal(accepted,true,'expected an asynchronous content reply');});}
function saveInput(profileUrl='https://www.linkedin.com/in/person/',source='rendered_profile',owner=uid){return{operationId:'44444444-4444-4444-a444-444444444444',userId:owner,source,profile:{profileUrl,name:'A Person',anchors:source==='rendered_profile'?[{kind:'about',text:'Exact visible source text',sourceUrl:profileUrl+'#about',observedAt:now}]:[],profileReadAt:source==='rendered_profile'?now:null,truncated:false,truncationReasons:[]}};}
function portFixture(h:ReturnType<typeof runtime>,sender:any,name='mighty:panel'){
 const messages:any[]=[],state={disconnected:false};let onDisconnect=()=>{};
 const port={name,sender,postMessage(value:unknown){messages.push(structuredClone(value));},onDisconnect:{addListener(callback:()=>void){onDisconnect=callback;}},disconnect(){state.disconnected=true;onDisconnect();}};
 h.events.connect(port);return{messages,state,port};
}
test('an isolated top-frame profile or people-search panel receives public goals and never credentials',async()=>{
 const h=runtime();await h.connect();
 for(const url of ['https://www.linkedin.com/in/person/','https://www.linkedin.com/search/results/people/?keywords=founder']){
  h.state.tabUrl=url;const result=await fromContent(h,{type:'mighty:status'});
  assert.equal(result.ok,true);assert.equal(result.connected,true);assert.equal(result.goalContext.userId,uid);assert.equal(result.goalContext.goals[0].id,goal.id);
  assert.doesNotMatch(JSON.stringify(result),/accessToken|Authorization|unsigned-test|sb_publishable_fixture|old strategy/);
 }
 assert.equal(h.calls.length,2);
});
test('untrusted senders, frames and unsupported current URLs receive no goals and trigger no requests',async()=>{
 const h=runtime();await h.connect();const valid=contentSender(h);
 const bad=[{...valid,id:'other-extension'},{...valid,frameId:1},{...valid,frameId:undefined},{...valid,origin:'https://evil.example'},{...valid,documentLifecycle:'prerender'},{...valid,tab:{id:-1,url:valid.url}},{...valid,url:h.chrome.runtime.getURL('popup.html')}];
 for(const sender of bad){let reply:any;assert.equal(h.events.internal({type:'mighty:status',refreshGoals:true},sender,(value:any)=>{reply=value;}),undefined);if(sender.id===h.chrome.runtime.id){assert.equal(reply.ok,false);assert.equal(reply.goalContext,undefined);}else assert.equal(reply,undefined);}
 for(const url of ['https://www.linkedin.com/feed/','https://www.linkedin.com/messaging/','https://evil.example/in/person/','https://www.linkedin.com.evil.example/in/person/','http://www.linkedin.com/in/person/','https://www.linkedin.com:8443/search/results/people/','https://name@www.linkedin.com/search/results/people/']){
  h.state.tabUrl=url;const result=await fromContent(h,{type:'mighty:status',refreshGoals:true},valid);assert.equal(result.ok,false);assert.equal(result.goalContext,undefined);assert.equal(result.userId,undefined);
 }
 await tick();assert.equal(h.calls.length,2);
});
test('content cannot access active-tab reads, replace an account, or disconnect it',async()=>{
 const h=runtime();await h.connect();
 for(const type of ['mighty:read_active','mighty:connect','mighty:disconnect']){let replied=false;assert.equal(h.events.internal({type},contentSender(h),()=>{replied=true;}),undefined);assert.equal(replied,false);}
 assert.equal(h.state.tabSends,0);assert.equal(h.calls.length,2);assert.equal((await h.send({type:'mighty:status'})).userId,uid);
});
test('a route change during goal refresh refuses the old content request without disclosing any context',async()=>{
 const h=runtime();await h.connect();let release!:()=>void;h.state.goalWait=new Promise(resolve=>{release=resolve;});
 const request=fromContent(h,{type:'mighty:status',refreshGoals:true});await tick();h.state.tabUrl='https://www.linkedin.com/feed/';release();
 const result=await request;assert.equal(result.ok,false);assert.equal(result.goalContext,undefined);assert.equal(result.userId,undefined);assert.doesNotMatch(JSON.stringify(result),/Fixture career|unsigned-test/);
 assert.equal((await h.send({type:'mighty:status'})).connected,true);
});
test('panel saves retain the exact source and are bound to the sender profile, not the active or payload tab',async()=>{
 const h=runtime();await h.connect();const save=saveInput();const result=await fromContent(h,{type:'mighty:save',save});
 assert.equal(result.ok,true);const call=h.calls.find(row=>row.path==='/rest/v1/outreach_inbox')!;assert.ok(call);
 assert.deepEqual((call.body as any).snapshot.anchors,save.profile.anchors);assert.equal((call.body as any).profile_url,save.profile.profileUrl);assert.equal((call.body as any).user_id,uid);assert.equal((call.body as any).profile_read_at,now);assert.equal(Object.keys(h.local).length,0);
 const bad=await fromContent(h,{type:'mighty:save',save:saveInput('https://www.linkedin.com/in/another/')});assert.equal(bad.ok,false);assert.match(bad.message,/current LinkedIn page/);assert.equal(h.calls.filter(row=>row.path==='/rest/v1/outreach_inbox').length,1);
});
test('search saves require the same current search route, never pretend to be profile reads and preserve unknowns',async()=>{
 const h=runtime();await h.connect();const search=saveInput('https://www.linkedin.com/in/search-person/','search_result');
 const wrong=await fromContent(h,{type:'mighty:save',save:search});assert.equal(wrong.ok,false);
 h.state.tabUrl='https://www.linkedin.com/search/results/people/?keywords=founder';const result=await fromContent(h,{type:'mighty:save',save:search,pageUrl:h.state.tabUrl});assert.equal(result.ok,true);
 const call=h.calls.find(row=>row.path==='/rest/v1/outreach_inbox')!;assert.deepEqual((call.body as any).snapshot.anchors,[]);assert.equal((call.body as any).profile_read_at,null);
 const profile=await fromContent(h,{type:'mighty:save',save:saveInput()});assert.equal(profile.ok,false);
 const old=contentSender(h);h.state.tabUrl='https://www.linkedin.com/search/results/people/?keywords=another';assert.equal((await fromContent(h,{type:'mighty:save',save:search,pageUrl:old.url},old)).ok,false);
 assert.equal(h.calls.filter(row=>row.path==='/rest/v1/outreach_inbox').length,1);
});
test('a stale content sender cannot queue or deliver a save after the tab changes',async()=>{
 const h=runtime();await h.connect();const sender=contentSender(h);h.state.tabUrl='https://www.linkedin.com/in/another/';
 assert.equal((await fromContent(h,{type:'mighty:save',save:saveInput()},sender)).ok,false);assert.equal(Object.keys(h.local).length,0);assert.equal(h.calls.length,2);
});
test('panel ports are top-frame and route gated, acknowledge readiness and broadcast only safe change signals',async()=>{
 const h=runtime();await h.connect();const accepted=portFixture(h,contentSender(h));await tick();assert.deepEqual(accepted.messages,[{type:'mighty:ready',protocol:1}]);
 const wrong=portFixture(h,{...contentSender(h),frameId:1}),forgedPopup=portFixture(h,contentSender(h),'mighty:popup');assert.equal(wrong.state.disconnected,true);assert.equal(forgedPopup.state.disconnected,true);
 await h.send({type:'mighty:disconnect',protocol:1},true);assert.ok(accepted.messages.some(row=>row.type==='mighty:account_changed'));assert.equal(wrong.messages.length,1);assert.equal(wrong.messages[0].code,'panel_frame_not_top');assert.equal(wrong.messages[0].goalContext,undefined);assert.doesNotMatch(JSON.stringify(accepted.messages),/userId|goalContext|accessToken|unsigned-test/);
});
test('a panel port that changes route before verification never joins account notifications',async()=>{
 const h=runtime();let release!:()=>void;h.state.tabWait=new Promise(resolve=>{release=resolve;});const port=portFixture(h,contentSender(h));h.state.tabUrl='https://www.linkedin.com/feed/';release();await tick();assert.equal(port.state.disconnected,true);assert.equal(port.messages.length,1);assert.equal(port.messages[0].code,'panel_current_route_unsupported');assert.equal(port.messages[0].goalContext,undefined);
});
test('save HTTP401 disconnects the matching account while preserving an immutable pending save for retry',async()=>{
 const h=runtime();await h.connect();h.state.saveStatus=401;
 const result=await fromContent(h,{type:'mighty:save',save:saveInput()});assert.equal(result.ok,false);assert.match(result.message,/expired/);const status=await h.send({type:'mighty:status'});assert.equal(status.connected,false);assert.equal(status.goalContext,null);assert.equal(Object.keys(h.local).length,1);
});
test('a late save HTTP401 from account A cannot disconnect B or transfer its pending snapshot',async()=>{
 const h=runtime();await h.connect();let release!:()=>void;h.state.saveStatus=401;h.state.saveWait=new Promise(resolve=>{release=resolve;});
 const pending=fromContent(h,{type:'mighty:save',save:saveInput()});await tick();h.state.authOwner=other;h.state.goalRows=[{id:goal.id,user_id:other,version:1,document:goal}];await h.connect();release();assert.equal((await pending).ok,false);
 const status=await h.send({type:'mighty:status'});assert.equal(status.connected,true);assert.equal(status.userId,other);assert.equal(status.goalContext.userId,other);assert.equal(h.calls.filter(row=>row.path==='/rest/v1/outreach_inbox').length,1);assert.equal((Object.values(h.local)[0] as any).userId,uid);
});
test('a network goal failure leaves Save available for the verified account and retry restores fresh goals',async()=>{
 const h=runtime();h.state.goalFailure=true;const connected=await h.connect();assert.equal(connected.ok,true);assert.equal(connected.connected,true);assert.equal(connected.code,'goals_unavailable');
 const status=await fromContent(h,{type:'mighty:status'});assert.equal(status.goalContext,null);assert.match(status.message,/could not be refreshed/);
 assert.equal((await fromContent(h,{type:'mighty:save',save:saveInput()})).ok,true);
 h.state.goalFailure=false;h.state.goalRows=[{id:goal.id,user_id:uid,version:2,document:{...goal,version:2}}];const recovered=await fromContent(h,{type:'mighty:status',refreshGoals:true});assert.equal(recovered.goalContext.goals[0].version,2);assert.equal(recovered.message,'');
});
test('SPA reinjection uses existing profile/search routes only and rechecks the actual tab',async()=>{
 const h=runtime();
 for(const url of ['https://www.linkedin.com/feed/','https://www.linkedin.com/messaging/','https://evil.example/in/person/','https://www.linkedin.com:8443/search/results/people/']){h.state.tabUrl=url;h.events.tabUpdated(4,{url});}
 await tick();assert.equal(h.state.reinject,0);
 for(const url of ['https://www.linkedin.com/in/person/','https://www.linkedin.com/search/results/people/?keywords=founder']){h.state.tabUrl=url;h.events.tabUpdated(4,{url});await tick();}
 assert.equal(h.state.reinject,2);
 h.state.tabUrl='https://www.linkedin.com/feed/';h.events.tabUpdated(4,{url:'https://www.linkedin.com/in/person/'});await tick();assert.equal(h.state.reinject,2);assert.equal(h.calls.length,0);
});

test('popup reload recovery never reinjects content after the active tab leaves its supported route',async()=>{
 const h=runtime();h.state.failFirstRead=true;h.state.routeOnFailedRead='https://www.linkedin.com/feed/';
 const result=await h.send({type:'mighty:read_active'});assert.equal(result.ok,true);assert.equal(result.snapshot.kind,'unsupported');assert.equal(h.state.reinject,0);assert.equal(h.state.tabSends,1);assert.equal(h.calls.length,0);
});
test('storage exceptions do not disclose arbitrary text to a LinkedIn content context',async()=>{
 const h=runtime();await h.connect();h.state.storageFailure=true;
 const result=await fromContent(h,{type:'mighty:save',save:saveInput()});assert.equal(result.ok,false);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_SENTINEL|unsigned-test|sb_publishable_fixture/);assert.equal(h.calls.length,2);
});

test('opening the popup during handoff goals loading acknowledges the same verified account',async()=>{
 const h=runtime();let release!:()=>void;h.state.goalWait=new Promise(resolve=>{release=resolve;});
 const connection=h.connect();await tick();assert.equal((await h.send({type:'mighty:status'})).connected,true);
 h.state.goalWait=null;h.state.goalRows=[{id:goal.id,user_id:uid,version:2,document:{...goal,version:2}}];
 const refreshed=await h.send({type:'mighty:status',refreshGoals:true});assert.equal(refreshed.goalContext.goals[0].version,2);
 release();const connected=await connection;assert.equal(connected.ok,true);assert.equal(connected.connected,true);assert.equal(connected.code,undefined);
 assert.equal((await h.send({type:'mighty:status'})).goalContext.goals[0].version,2);
});

test('actual worker invalidations and actual panel refreshes settle without recurring goal fetches',async()=>{
 const h=runtime();await h.connect();const {document}=parseHTML('<html><body><main><section><h1>A Person</h1><button>Message</button></section></main></body></html>');
 const transfers:unknown[]=[];
 const panelRuntime={id:h.chrome.runtime.id,getURL:h.chrome.runtime.getURL,lastError:undefined,
  async sendMessage(message:any){
   if(message.type==='mighty:page_changed'){h.events.internal(message,contentSender(h),()=>{});return;}
   const result=await fromContent(h,message);transfers.push(structuredClone(result));return result;
  },
  connect({name}:{name:string}){
   const messages:Function[]=[],disconnects:Function[]=[];let closed=false;
   const disconnect=()=>{if(closed)return;closed=true;for(const listener of disconnects)listener();};
   const workerPort={name,sender:contentSender(h),postMessage(message:unknown){queueMicrotask(()=>{if(!closed)for(const listener of messages)listener(structuredClone(message));});},onDisconnect:{addListener(fn:Function){disconnects.push(fn);}},disconnect};
   h.events.connect(workerPort);
   return{onMessage:{addListener(fn:Function){messages.push(fn);}},onDisconnect:{addListener(fn:Function){disconnects.push(fn);}},disconnect};
  },
 };
 const panel=createProfilePanel({document,runtime:panelRuntime as any,url:()=>h.state.tabUrl,read:()=>({kind:'profile',state:'ready',profile:saveInput().profile as any,message:''})});
 const settle=async()=>{for(let i=0;i<4;i++)await tick();};
 try{
  await settle();assert.equal(panel.shadow.querySelector('.account-state')?.textContent,'Account connected');assert.equal(panel.shadow.querySelectorAll('.goal-pill').length,1);
  const goals=()=>h.calls.filter(row=>row.path==='/rest/v1/goals').length;
  assert.equal(goals(),2);await settle();assert.equal(goals(),2);
  h.state.goalFailure=true;await panel.refreshAccount(true);await settle();assert.equal(goals(),3);
  assert.equal(panel.shadow.querySelector('.account-state')?.textContent,'Account connected');assert.equal(panel.shadow.querySelector('.goal-fit'),null);assert.ok(panel.shadow.querySelector('.retry'));
  h.state.goalFailure=false;await panel.refreshAccount(true);await settle();assert.equal(goals(),4);assert.equal(panel.shadow.querySelectorAll('.goal-pill').length,1);
  await settle();assert.equal(goals(),4);assert.doesNotMatch(JSON.stringify(transfers),/accessToken|Authorization|unsigned-test|sb_publishable_fixture/);
 }finally{panel.dispose();}
});
test('rejected own-extension status requests reveal only bounded sender diagnostics',async()=>{
 const h=runtime();await h.connect();const valid=contentSender(h);
 const cases:[Record<string,unknown>,string][]=[
  [{...valid,frameId:1},'panel_frame_not_top'],
  [{...valid,tab:undefined},'panel_tab_missing'],
  [{...valid,url:'https://other.example/private/'},'panel_sender_url_unsupported'],
  [{...valid,origin:'https://other.example'},'panel_origin_mismatch'],
  [{...valid,documentLifecycle:'cached'},'panel_document_inactive'],
 ];
 for(const [sender,code] of cases){let reply:any;h.events.internal({type:'mighty:status'},sender,(value:any)=>{reply=value;});assert.equal(reply?.ok,false);assert.equal(reply?.code,code);assert.equal(reply?.connected,undefined);assert.equal(reply?.goalContext,undefined);assert.equal(reply?.userId,undefined);assert.doesNotMatch(JSON.stringify(reply),/https:|accessToken|unsigned-test|Fixture career|11111111|other\.example/);}
 let unauthorized=false;h.events.internal({type:'mighty:status'},{...valid,id:'unrelated-extension'},()=>{unauthorized=true;});assert.equal(unauthorized,false);assert.equal(h.calls.length,2);
});

test('fresh current tab scopes permit stale or absent sender URL metadata after same-origin SPA navigation',async()=>{
 const h=runtime();await h.connect();const current='https://www.linkedin.com/in/current-person/';h.state.tabUrl=current;
 for(const url of ['https://www.linkedin.com/in/previous-person/','https://www.linkedin.com/feed/']){
  const sender=contentSender(h,url);sender.tab.url='https://www.linkedin.com/in/older-document/';
  const status=await fromContent(h,{type:'mighty:status'},sender);assert.equal(status.ok,true);assert.equal(status.connected,true);assert.equal(status.goalContext.userId,uid);assert.equal(status.appOrigin,config.appOrigins[0]);
  const port=portFixture(h,sender);await tick();assert.equal(port.state.disconnected,false);assert.equal(port.messages[0].type,'mighty:ready');port.port.disconnect();
  const wrong=await fromContent(h,{type:'mighty:save',save:saveInput(url)},sender);assert.equal(wrong.ok,false);
 }
 const missing={...contentSender(h),tab:{id:4}};const status=await fromContent(h,{type:'mighty:status'},missing as any);assert.equal(status.ok,true);
 const saved=await fromContent(h,{type:'mighty:save',save:saveInput(current)},missing as any);assert.equal(saved.ok,true);
 assert.equal(h.calls.filter(call=>call.path==='/rest/v1/outreach_inbox').length,1);
 assert.equal((h.calls.find(call=>call.path==='/rest/v1/outreach_inbox')!.body as any).profile_url,current);
});
test('a different supported profile reached during a goal request cannot inherit the previous request',async()=>{
 const h=runtime();await h.connect();let release!:()=>void;h.state.goalWait=new Promise(resolve=>{release=resolve;});
 const sender=contentSender(h,'https://www.linkedin.com/in/initial-document/');
 const request=fromContent(h,{type:'mighty:status',refreshGoals:true},sender);await tick();h.state.tabUrl='https://www.linkedin.com/in/next-person/';release();
 const result=await request;assert.equal(result.ok,false);assert.equal(result.code,'panel_current_route_changed');assert.equal(result.goalContext,undefined);assert.equal(result.userId,undefined);
});
