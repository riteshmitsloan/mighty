import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {build} from 'esbuild';
import {createProfilePanel, relevantPageMutation, supportedPanelURL} from '../src/profile-panel.js';
import {compactFit, profileIdentity} from '../src/compact-profile.js';
import {profilePanelEligibility} from '../src/panel-eligibility.js';
import {loadPanelFont, PANEL_FONT_FAMILY} from '../src/panel-font.js';
import {accountGoalContext} from '../src/goal-context.js';
import {assessCandidate} from '../../src/lib/assessment';
import {createEvidenceClaim} from '../../src/lib/evidence';
import type {Goal, GoalCriterion} from '../../src/lib/goals';
import type {PageSnapshot, Profile} from '../src/types.js';
const {parseHTML} = createRequire(import.meta.url)('linkedom');
const uid='11111111-1111-4111-a111-111111111111',other='22222222-2222-4222-a222-222222222222',date='2026-09-12T12:00:00Z';
const profileUrl='https://www.linkedin.com/in/fixture/';
const panelDocument=(controls:string,extra='',slug='fixture')=>parseHTML('<html><body><main><section aria-label="Primary content"><div componentkey="com.linkedin.sdui.profile.card.ref.fixtureTopcard"><section><div componentkey="ProfileVerificationTriggerRef-'+slug+'"><h2>Fixture Person</h2></div>'+controls+'</section></div><section><h2>About</h2><p>Healthcare experience.</p></section>'+extra+'</section></main></body></html>').document;
const goal=(id:string,title:string,criteria:GoalCriterion[]=[]):Goal=>({id,kind:'career',title,outcome:title,criteria,openQuestions:[],status:'active',version:1,createdAt:date,updatedAt:date});
const criterion=(id:string,field:GoalCriterion['field'],terms:string[]):GoalCriterion=>({id:id.replace(/\W+/g,'_'),field,terms,label:id,appliesTo:'contact',importance:'required',origin:'user'});
const career=goal('33333333-3333-4333-a333-333333333333','Career',[criterion('Healthcare experience','custom',['healthcare'])]);
const fundraising={...goal('44444444-4444-4444-a444-444444444444','Fundraising',[criterion('Investor','role',['investor'])]),kind:'fundraising' as const};
const context=(owner=uid,goals:Goal[]=[career,fundraising])=>accountGoalContext(owner,goals.map(document=>({id:document.id,user_id:owner,version:document.version,document})));
const profile=():Profile=>({profileUrl,name:'Fixture Person',anchors:[{kind:'about',text:'Healthcare '+ 'full original evidence '.repeat(30)+'END_SENTINEL',sourceUrl:profileUrl+'#about',observedAt:date}],profileReadAt:date,truncated:false,truncationReasons:[]});
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};}
async function harness(initial:PageSnapshot={kind:'profile',state:'ready',profile:profile(),message:''}){
 const {document}=parseHTML('<html><head></head><body><main>LinkedIn content</main></body></html>');
 const state={url:profileUrl,page:initial,owner:uid,goals:context(),connected:true,message:'',readError:false,readCount:0,statusWait:null as Promise<void>|null,saveWait:null as Promise<void>|null,fail:false};
 const calls:any[]=[],ports:any[]=[];
 const runtime={id:'a'.repeat(32),getURL:(path:string)=>'chrome-extension://'+ 'a'.repeat(32)+'/'+path,
  async sendMessage(message:any){calls.push(structuredClone(message));if(message.type==='mighty:status'){const reply={ok:true,connected:state.connected,userId:state.owner,goalContext:state.goals,appOrigin:'https://riteshmitsloan.github.io/mighty/',message:state.message};if(state.statusWait)await state.statusWait;return reply;}
   if(message.type==='mighty:save'){if(state.saveWait)await state.saveWait;return state.fail?{ok:false,message:'Save pending. Try again.'}:{ok:true};}return{ok:true};},
  connect(){const messages:Function[]=[],disconnects:Function[]=[];const port={onMessage:{addListener(f:Function){messages.push(f);}},onDisconnect:{addListener(f:Function){disconnects.push(f);}},disconnect(){for(const f of disconnects)f();},emit(message:unknown){for(const f of messages)f(message);}};ports.push(port);return port;}};
 const panel=createProfilePanel({document,runtime:runtime as any,url:()=>state.url,read:()=>{state.readCount++;if(state.readError)throw Error('Unreadable page');return state.page;}});
 await tick();return{state,panel,document,calls,ports,find:(selector:string)=>panel.shadow.querySelector(selector) as HTMLElement,all:(selector:string)=>[...panel.shadow.querySelectorAll(selector)] as HTMLElement[]};
}
test('compact panel mounts automatically with two goal pills, one result and no evidence sections',async()=>{
 const h=await harness();try{
  assert.ok(h.document.querySelector('#mighty-profile-panel'));assert.equal(h.panel.host.shadowRoot,null);
  assert.equal(h.all('.goal-pill').length,2);assert.equal(h.all('.goal-fit').length,1);assert.equal(h.find('.fit-label').textContent,'Possible fit');
  h.all('.goal-pill')[1].click();assert.equal(h.find('.goal-pill[aria-pressed="true"]').textContent,'Fundraising');assert.equal(h.find('.fit-label').textContent,'No clear connection yet');
  assert.equal(h.all('.evidence-section,.assessment-sources,.goal-unknowns').length,0);assert.doesNotMatch(h.find('.content').textContent||'',/END_SENTINEL|Why this matters|\d+%/);
  assert.equal(h.find('.skip').textContent,'Skip');assert.equal(h.find('.save').textContent,'Save to Mighty');
 }finally{h.panel.dispose();}
});
test('fit labels require explicit support and never turn missing facts into Low fit',()=>{
 const claims=[createEvidenceClaim({subject:'candidate',field:'role',text:'CEO',sourceKind:'manual',sourceLabel:'Known fact',confidence:'user_confirmed',appliesTo:'contact'}),createEvidenceClaim({subject:'candidate',field:'industry',text:'Healthcare',sourceKind:'manual',sourceLabel:'Known fact',confidence:'user_confirmed',appliesTo:'contact'})];
 const criteria=[criterion('Role','role',['CEO']),criterion('Industry','industry',['healthcare'])];
 const candidate={name:'Fixture',claims};const strong=goal(career.id,'Two supported facts',criteria);
 assert.equal(compactFit(assessCandidate(strong,candidate)).label,'Strong potential');
 assert.equal(compactFit(assessCandidate({...strong,criteria:[...criteria,criterion('Unknown stage','stage',['seed'])]},candidate)).label,'Possible fit');
 assert.equal(compactFit(assessCandidate(fundraising,candidate)).label,'No clear connection yet');
 const negative={...claims[0],id:'negative-role',polarity:'negative' as const};
 const low=compactFit(assessCandidate(strong,{name:'Fixture',claims:[negative,claims[1]]}));assert.equal(low.label,'Low fit');assert.match(low.reason,/contradicts/);
 const conflict=compactFit(assessCandidate(strong,{name:'Fixture',claims:[...claims,negative]}));assert.equal(conflict.label,'Not enough information');
 const onlyContext=goal(career.id,'Context',[criterion('First','custom',['CEO']),criterion('Second','custom',['Healthcare'])]);
 assert.notEqual(compactFit(assessCandidate(onlyContext,candidate)).label,'Strong potential');
});
test('a manual goal choice survives rereads but a different profile starts with its best fit',async()=>{
 const h=await harness();try{
  assert.equal(h.find('.goal-pill[aria-pressed="true"]').textContent,'Career');
  h.all('.goal-pill')[1].click();h.panel.readPage();
  assert.equal(h.find('.goal-pill[aria-pressed="true"]').textContent,'Fundraising');
  h.state.page={kind:'profile',state:'ready',profile:{...profile(),anchors:[...profile().anchors,{kind:'skills',text:'Additional profile context',sourceUrl:profileUrl+'#skills',observedAt:date}]},message:''};
  h.panel.readPage();assert.equal(h.find('.goal-pill[aria-pressed="true"]').textContent,'Fundraising');
  h.state.url='https://www.linkedin.com/in/second/';
  h.state.page={kind:'profile',state:'ready',profile:{...profile(),name:'Second Person',profileUrl:h.state.url,anchors:profile().anchors.map(anchor=>({...anchor,sourceUrl:anchor.sourceUrl.replace(profileUrl,h.state.url)}))},message:''};
  h.panel.readPage();await tick();
  assert.equal(h.find('.profile-identity h1').textContent,'Second Person');
  assert.equal(h.find('.goal-pill[aria-pressed="true"]').textContent,'Career');
  assert.equal(h.find('.fit-label').textContent,'Possible fit');
 }finally{h.panel.dispose();}
});
test('Save carries the untouched profile once, acknowledges success and prevents duplicate clicks',async()=>{
 const h=await harness();try{
  const pending=deferred<void>();h.state.saveWait=pending.promise;h.find('.save').click();h.find('.save').click();await tick();
  const saves=h.calls.filter(row=>row.type==='mighty:save');assert.equal(saves.length,1);assert.deepEqual(saves[0].save.profile,profile());
  pending.resolve();await tick();assert.equal(h.find('.save').textContent,'Saved to Mighty');assert.equal((h.find('.save') as HTMLButtonElement).disabled,true);
  assert.match(h.find('.notice').textContent||'',/Saved to Relationships/);assert.equal(h.all('a').some(a=>a.textContent==='View in Mighty'),true);
 }finally{h.panel.dispose();}
});
test('failed saves retry the same immutable operation and cannot claim success after an account switch',async()=>{
 const h=await harness();try{
  h.state.fail=true;h.find('.save').click();await tick();h.find('.save').click();await tick();
  const saves=h.calls.filter(row=>row.type==='mighty:save');assert.equal(saves[0].save.operationId,saves[1].save.operationId);
  const pending=deferred<void>();h.state.saveWait=pending.promise;h.state.fail=false;h.find('.save').click();await tick();
  h.state.owner=other;h.state.goals=context(other,[{...fundraising,title:'Other account goal'}]);h.ports[0].emit({type:'mighty:account_changed'});
  assert.doesNotMatch(h.find('.content').textContent||'',/Healthcare experience/);await tick();
  pending.resolve();await tick();assert.match(h.find('.goal-pill').textContent||'',/Other account goal/);assert.equal(h.find('.notice'),null);
 }finally{h.panel.dispose();}
});
test('profile reads and missing goals do not falsely disconnect a verified account',async()=>{
 const h=await harness();try{
  h.state.readError=true;h.panel.readPage();assert.equal(h.find('.account-state').textContent,'Account connected');assert.equal((h.find('.save') as HTMLButtonElement).disabled,true);
  h.state.readError=false;h.panel.readPage();h.state.goals=null as any;h.state.message='Your goals could not load.';await h.panel.refreshAccount();
  assert.equal(h.find('.account-state').textContent,'Account connected');assert.equal(h.find('.goal-fit'),null);assert.equal(h.find('.retry').textContent,'Try again');
 }finally{h.panel.dispose();}
});
test('Skip and minimize reopen explicitly; new profiles reset Skip but retain a deliberate minimize',async()=>{
 const h=await harness();try{
  h.find('.skip').click();assert.ok(h.find('.reopen'));h.panel.readPage();assert.ok(h.find('.reopen'));
  h.state.url='https://www.linkedin.com/in/second/';h.state.page={kind:'profile',state:'ready',profile:{...profile(),profileUrl:h.state.url,name:'Second Person'},message:''};h.panel.readPage();await tick();assert.ok(h.find('.save'));
  h.find('.minimize').click();assert.ok(h.find('.reopen'));h.state.url='https://www.linkedin.com/in/third/';h.panel.readPage();await tick();assert.ok(h.find('.reopen'));
  h.find('.reopen').click();assert.ok(h.find('.save'));
 }finally{h.panel.dispose();}
});
test('profile avatars permit only validated LinkedIn media and fall back to initials on error',()=>{
 const {document}=parseHTML('<html><body></body></html>');const p={...profile(),photoUrl:'https://media.licdn.com/dms/image/v2/ABC/profile-displayphoto-shrink_100_100/test?e=1&v=beta&t=signature'};
 const row=profileIdentity(document,p);const image=row.querySelector('img')!;assert.ok(image);assert.equal(image.referrerPolicy,'no-referrer');image.dispatchEvent(new document.defaultView.Event('error'));assert.equal(row.querySelector('.profile-avatar')?.textContent,'FP');
 assert.equal(profileIdentity(document,{...p,photoUrl:'https://evil.example/photo.png'}).querySelector('img'),null);
});
test('panel loads the bundled font once per document and keeps font failures nonblocking',async()=>{
 const fonts=new Set<any>();let loads=0;
 class Font {family:string;constructor(family:string,public source:string,public descriptors:unknown){this.family=family;}load(){loads++;return Promise.reject(Error('Font unavailable'));}}
 const document={fonts} as unknown as Document;
 loadPanelFont(document,'chrome-extension://fixture/assets/mighty-ui.woff2',Font as any);
 loadPanelFont(document,'chrome-extension://fixture/assets/mighty-ui.woff2',Font as any);
 await tick();assert.equal(fonts.size,1);assert.equal(loads,1);assert.equal([...fonts][0].family,PANEL_FONT_FAMILY);assert.match([...fonts][0].source,/mighty-ui\.woff2/);
 assert.doesNotThrow(()=>loadPanelFont({} as Document,'font',undefined));
});
test('panel stays top-right with an explicit sans-serif surface and reopens the same host',async()=>{
 const h=await harness();try{
  const css=h.panel.shadow.querySelector('style')!.textContent!;
  assert.match(css,/:host\{[^}]*top:82px;right:22px;bottom:auto/);
  assert.match(css,/\.surface\{font:14px\/1\.5 'Mighty Panel Schibsted',Arial,Helvetica,sans-serif/);
  assert.doesNotMatch(css,/@font-face|bottom:24px/);
  h.find('.skip').click();h.panel.open();assert.ok(h.find('.save'));assert.equal(h.document.querySelectorAll('#mighty-profile-panel').length,1);
  h.ports[0].emit({type:'mighty:panel_rejected',message:'Refresh this page. (panel_route_changed)'});
  assert.match(h.find('.notice').textContent||'',/panel_route_changed/);
 }finally{h.panel.dispose();}
});
test('successful status recovery clears only the connection diagnostic, preserving save and read failures',async()=>{
 const h=await harness();try{
  const reject=()=>h.ports[0].emit({type:'mighty:panel_rejected',message:'Refresh this page. (panel_route_changed)'});
  reject();h.ports[0].emit({type:'mighty:ready',protocol:1});
  assert.match(h.find('.content').textContent||'',/panel_route_changed/);
  await h.panel.refreshAccount();assert.equal(h.find('.account-state').textContent,'Account connected');assert.equal(h.find('.notice'),null);
  h.state.fail=true;h.find('.save').click();await tick();reject();
  assert.match(h.find('.content').textContent||'',/Save pending/);assert.match(h.find('.content').textContent||'',/panel_route_changed/);
  await h.panel.refreshAccount();assert.match(h.find('.notice').textContent||'',/Save pending/);assert.doesNotMatch(h.find('.content').textContent||'',/panel_route_changed/);
  h.state.readError=true;h.panel.readPage();reject();await h.panel.refreshAccount();
  assert.match(h.find('.notice').textContent||'',/profile could not be read/);assert.doesNotMatch(h.find('.content').textContent||'',/panel_route_changed/);
 }finally{h.panel.dispose();}
});
test('late messages and duplicate disconnects from a replaced port cannot reset the current account',async()=>{
 const h=await harness();try{
  const oldPort=h.ports[0];oldPort.disconnect();
  assert.equal(h.find('.account-state').textContent,'Account not connected');
  await new Promise(resolve=>setTimeout(resolve,120));await tick();
  assert.equal(h.ports.length,2);assert.equal(h.find('.account-state').textContent,'Account connected');
  const requests=h.calls.length;
  oldPort.emit({type:'mighty:account_changed'});oldPort.emit({type:'mighty:panel_rejected',message:'Obsolete port rejection'});oldPort.disconnect();
  await tick();
  assert.equal(h.find('.account-state').textContent,'Account connected');assert.equal(h.find('.notice'),null);
  assert.equal(h.calls.length,requests);assert.equal(h.ports.length,2);
  h.state.owner=other;h.state.goals=context(other,[{...fundraising,title:'Current owner goal'}]);
  h.ports[1].emit({type:'mighty:account_changed'});await tick();
  assert.equal(h.find('.goal-pill').textContent,'Current owner goal','The current port remains usable.');
 }finally{h.panel.dispose();}
});
test('observer ignores panel-only mutations while retaining actual page changes',async()=>{
 const h=await harness();try{
  const mutation=(target:Node,added:Node[],removed:Node[]=[])=>({type:'childList',target,addedNodes:added,removedNodes:removed}) as unknown as MutationRecord;
  assert.equal(relevantPageMutation([mutation(h.document.documentElement,[h.panel.host])],h.panel.host),false);
  assert.equal(relevantPageMutation([mutation(h.panel.host,[h.document.createElement('div')])],h.panel.host),false);
  assert.equal(relevantPageMutation([mutation(h.document.querySelector('main'),[h.document.createElement('h2')])],h.panel.host),true);
  assert.equal(supportedPanelURL('https://www.linkedin.com/feed/'),false);assert.equal(supportedPanelURL(profileUrl),true);
 }finally{h.panel.dispose();}
});
test('automatic panel eligibility requires other-person top-card controls and self controls always veto it',()=>{
 const doc=panelDocument;
 assert.equal(profilePanelEligibility(doc('<button>Message</button>'),profileUrl),'other');
 assert.equal(profilePanelEligibility(doc('<a href="/messaging/compose/?screenContext=NON_SELF_PROFILE_VIEW">Message</a>'),profileUrl),'other');
 assert.equal(profilePanelEligibility(doc('<button aria-label="Invite Fixture Person to connect">Connect</button>'),profileUrl),'other');
 assert.equal(profilePanelEligibility(doc('<button>Message</button><button>Add profile section</button>'),profileUrl),'self');
 assert.equal(profilePanelEligibility(doc('<a href="'+profileUrl+'edit/intro/">Edit introduction</a>'),profileUrl),'self');
 assert.equal(profilePanelEligibility(doc('<button aria-label="Edit profile">Edit</button>'),profileUrl),'self');
 assert.equal(profilePanelEligibility(doc('<button hidden>Message</button>'),profileUrl),'unknown');
 assert.equal(profilePanelEligibility(doc('','<aside><button>Message</button></aside>'),profileUrl),'unknown');
 assert.equal(profilePanelEligibility(doc('<button>Message</button>','','previous-person'),profileUrl),'unknown');
 const legacy=parseHTML('<main><section><h1>Previous Person</h1><button>Message</button></section></main>').document;
 assert.equal(profilePanelEligibility(legacy,profileUrl),'unknown');
 for(const route of ['https://www.linkedin.com/feed/','https://www.linkedin.com/messaging/','https://www.linkedin.com/pulse/article','https://www.linkedin.com/search/results/people/'])assert.equal(profilePanelEligibility(doc('<button>Message</button>'),route),'unsupported');
});
test('actual content lifecycle bounds mutation debounce and tears down on route-away and reinjection',async()=>{
 const {outputFiles}=await build({entryPoints:[new URL('../src/content.ts',import.meta.url).pathname],bundle:true,write:false,platform:'browser',format:'iife',target:'chrome120'});
 const document=panelDocument('<button>Message</button>');
 const location={href:profileUrl};const listeners=new Map<string,Function>(),timeouts=new Map<number,{fn:Function,ms:number}>(),intervals=new Map<number,Function>();let sequence=0,observed:any,disconnected=0;
 class Observer {constructor(fn:Function){observed=this;this.callback=fn;}callback:Function;observe(){}disconnect(){disconnected++;}}
 const runtime={id:'a'.repeat(32),getURL:(path:string)=>'chrome-extension://'+'a'.repeat(32)+'/'+path,onMessage:{addListener(){},removeListener(){}},connect(){return{onMessage:{addListener(){}},onDisconnect:{addListener(){}},disconnect(){}};},async sendMessage(message:any){return message.type==='mighty:status'?{ok:true,connected:true,userId:uid,goalContext:context(),appOrigin:'https://riteshmitsloan.github.io/mighty/'}:{ok:true};}};
 const globals:any={document,location,chrome:{runtime},MutationObserver:Observer,URL,TextEncoder,structuredClone,crypto:globalThis.crypto,
  addEventListener:(name:string,fn:Function)=>listeners.set(name,fn),removeEventListener:(name:string)=>listeners.delete(name),
  setTimeout:(fn:Function,ms:number)=>{timeouts.set(++sequence,{fn,ms});return sequence;},clearTimeout:(id:number)=>timeouts.delete(id),setInterval:(fn:Function)=>{intervals.set(++sequence,fn);return sequence;},clearInterval:(id:number)=>intervals.delete(id)};
 runInNewContext(outputFiles[0].text,globals);await tick();assert.equal(document.querySelectorAll('#mighty-profile-panel').length,1);
 const host=document.querySelector('#mighty-profile-panel');observed.callback([{type:'childList',target:document.documentElement,addedNodes:[host],removedNodes:[]}]);assert.equal(timeouts.size,0);
 const change={type:'characterData',target:document.querySelector('h2'),addedNodes:[],removedNodes:[]};observed.callback([change]);observed.callback([change]);
 assert.deepEqual([...timeouts.values()].map(value=>value.ms).sort((a,b)=>a-b),[180,900]);
 runInNewContext(outputFiles[0].text,globals);await tick();assert.equal(document.querySelectorAll('#mighty-profile-panel').length,1);assert.ok(disconnected>=1);
 const ownAction=document.createElement('button');ownAction.textContent='Add profile section';document.querySelector('h2').closest('section').append(ownAction);
 observed.callback([{type:'childList',target:ownAction.parentElement,addedNodes:[ownAction],removedNodes:[]}]);
 for(const [id,pending] of [...timeouts.entries()])if(timeouts.has(id)){timeouts.delete(id);pending.fn();}
 assert.equal(document.querySelector('#mighty-profile-panel'),null);
 // Fresh worker reinjection under another URL must not trust the previous card.
 ownAction.remove();location.href='https://www.linkedin.com/in/next-person/';runInNewContext(outputFiles[0].text,globals);await tick();
 assert.equal(document.querySelector('#mighty-profile-panel'),null);
 document.querySelector('main').innerHTML='<section><h1>Stale Person</h1><button>Message</button></section>';
 runInNewContext(outputFiles[0].text,globals);await tick();assert.equal(document.querySelector('#mighty-profile-panel'),null);
 location.href='https://www.linkedin.com/search/results/people/';for(const callback of [...intervals.values()])callback();assert.equal(document.querySelector('#mighty-profile-panel'),null);
 location.href='https://www.linkedin.com/messaging/';for(const callback of [...intervals.values()])callback();
 assert.equal(document.querySelector('#mighty-profile-panel'),null);assert.equal(intervals.size,0);assert.equal(timeouts.size,0);assert.equal(listeners.size,0);
});
