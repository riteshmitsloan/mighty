// Actual React rendering with synthetic records; no network, account, or browser storage reads.
// This is DOM regression coverage, not native browser focus/accessibility certification.
import {test, before, after, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {parseHTML} from 'linkedom';
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {createGoal} from '../src/lib/goals';
import type {CandidateObservation, CandidateObservationInput} from '../src/lib/relationship-context';
const checkout=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const id=(n:number)=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const person={id:id(1),person:'Synthetic Person',profile_url:null,stage:'saved',context:{},created_at:'2026-09-12T12:00:00Z'};
const goalA=createGoal({kind:'career',title:'Career fixture',outcome:'A synthetic professional goal',criteria:[{id:'industry',field:'industry',label:'Industry',terms:['Robotics'],importance:'required',appliesTo:'contact',origin:'user'}]},{id:id(10)});
const goalB=createGoal({kind:'fundraising',title:'Funding fixture',outcome:'A separate synthetic goal',criteria:[{id:'stage',field:'stage',label:'Stage',terms:['seed'],importance:'required',appliesTo:'contact',origin:'user'}]},{id:id(11)});
const observation=(n:number,patch:Partial<CandidateObservation>={}):CandidateObservation=>({id:id(n),requestId:id(n+100),relationshipId:person.id,goalId:goalA.id,field:'industry',text:'Robotics',sourceKind:'manual',sourceLabel:'Synthetic observed source',appliesTo:'contact',confirmed:true,observedAt:'2026-09-12T12:00:00Z',confirmedAt:'2026-09-12T12:00:00Z',createdAt:'2026-09-12T12:00:00Z',...patch});
const event=(n:number,patch:Record<string,unknown>={})=>({id:id(n),relationship_id:person.id,kind:'next_step',body:'A synthetic next step',related_event_id:null,goal_id:goalA.id,goal_version:1,created_at:'2026-09-12T12:00:00Z',...patch});
const props=(element:Element)=>(element as any)[Object.keys(element).find(key=>key.startsWith('__reactProps$'))!];
const button=(name:string)=>[...document.querySelectorAll('button')].find(node=>node.textContent===name)!;
const click=async(element:Element)=>{assert.ok(element);await act(async()=>{props(element).onClick({preventDefault(){}});await tick();});};
const input=async(element:Element,value:string)=>{assert.ok(element);await act(async()=>{props(element).onChange({target:{value}});await tick();});};
const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes;});return {promise,resolve};};
let output:string,Timeline:any,PersonEvidencePanel:any,root:Root,properties:any,writes:CandidateObservationInput[];
before(async()=>{
 output=await mkdtemp(join(tmpdir(),'mighty-context-ui-'));await symlink(join(checkout,'node_modules'),join(output,'node_modules'),'dir');
 await build({entryPoints:[join(checkout,'src/components/RelationshipViews.tsx'),join(checkout,'src/components/PersonEvidencePanel.tsx')],outdir:output,entryNames:'[name]',outExtension:{'.js':'.cjs'},bundle:true,platform:'node',format:'cjs',jsx:'automatic',packages:'external',loader:{'.css':'empty'},define:{'import.meta.env':'{}'}});
 Timeline=require(join(output,'RelationshipViews.cjs')).Timeline;PersonEvidencePanel=require(join(output,'PersonEvidencePanel.cjs')).default;
});
after(async()=>{await rm(output,{recursive:true,force:true});});
beforeEach(()=>{
 const {window}=parseHTML('<html><body><div id="root"></div></body></html>'),data=new Map();
 const storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>data.set(key,value),removeItem:(key:string)=>data.delete(key)};
 Object.assign(window,{localStorage:storage});Object.assign(globalThis,{window,document:window.document,HTMLElement:window.HTMLElement,localStorage:storage,IS_REACT_ACT_ENVIRONMENT:true});
 root=createRoot(document.getElementById('root')!);writes=[];
 properties={uid:id(70),person,goals:[goalA,goalB],activeGoal:goalA,selfEvidence:[],call:async()=>{throw Error('Unexpected AI call');},onRemaining:()=>{},onRecorded:async()=>{},contextStore:{read:async()=>({observations:[],drafts:[],events:[]}),save:async(_uid:string|null,value:CandidateObservationInput)=>{writes.push(value);return observation(50,{...value,goalId:value.goalId??null});}}};
});
afterEach(async()=>{await act(async()=>root.unmount());});
async function renderPerson(){await act(async()=>{root.render(React.createElement(PersonEvidencePanel,properties));await tick();});}
async function submit(){await act(async()=>{props(document.querySelector('.fact-editor')!).onSubmit({preventDefault(){}});await tick();});}

test('Timeline names goals and next-step completion, filters unrelated people and writes only on action',async()=>{
 const saved=event(20),done=event(21,{kind:'next_step_completed',related_event_id:saved.id,body:''});let calls=0;
 const render=async(events:unknown[])=>act(async()=>{root.render(React.createElement(Timeline,{people:[person],events,goals:[goalA],onComplete:async()=>{calls++;}}));await tick();});
 await render([saved,event(22,{relationship_id:id(2),body:'Other person private event'})]);assert.match(document.body.textContent!,/Next step recorded/);assert.match(document.body.textContent!,/Goal: Career fixture/);assert.doesNotMatch(document.body.textContent!,/Other person private event/);assert.equal(calls,0);
 await click(button('Mark next step complete'));assert.equal(calls,1);await render([saved,done]);assert.match(document.body.textContent!,/Next step completed/);assert.equal(button('Mark next step complete'),undefined);
});
test('Timeline double click is locked while saving and failure restores an actionable control',async()=>{
 const pending=deferred<void>();let calls=0;
 await act(async()=>{root.render(React.createElement(Timeline,{people:[person],events:[event(20)],onComplete:async()=>{calls++;await pending.promise;throw Error('Temporary completion failure');}}));await tick();});
 const handler=props(button('Mark next step complete')).onClick;
 await act(async()=>{handler();handler();await tick();});assert.equal(calls,1);assert.ok(button('Saving…').hasAttribute('disabled'));
 await act(async()=>{pending.resolve();await tick();});assert.match(document.body.textContent!,/Temporary completion failure/);assert.ok(button('Mark next step complete'));assert.equal(calls,1);
});
test('each goal assessment renders its own supporting source and excludes the other goal evidence',async()=>{
 properties.contextStore.read=async()=>({observations:[observation(20),observation(21,{goalId:goalB.id,field:'stage',text:'seed',sourceLabel:'Funding-only source'})],drafts:[],events:[]});await renderPerson();
 const cards=[...document.querySelectorAll('.person-goal-assessments article')];
 assert.match(cards[0].textContent!,/Robotics/);assert.doesNotMatch(cards[0].textContent!,/Funding-only source/);
 assert.match(cards[1].textContent!,/Funding-only source/);assert.match(cards[1].querySelector('blockquote')!.textContent!,/seed/);
 assert.match(document.querySelectorAll('.confirmed-fact')[1].textContent!,/Goal: Funding fixture/);
});
test('correcting a non-active goal fact preserves its original goal and negative polarity',async()=>{
 const original=observation(20,{goalId:goalB.id,field:'stage',text:'seed',polarity:'negative'});properties.contextStore.read=async()=>({observations:[original],drafts:[],events:[]});await renderPerson();await click(button('Correct'));
 const goalSelect=document.querySelector('.fact-editor select')!;assert.equal(props(goalSelect).value,goalB.id);assert.ok(goalSelect.hasAttribute('disabled'));
 await input(document.querySelector('.fact-editor textarea')!,'pre-seed');properties.activeGoal=goalB;await renderPerson();await submit();
 assert.equal(writes.length,1);assert.equal(writes[0].goalId,goalB.id);assert.equal(writes[0].supersedesId,original.id);assert.equal(writes[0].polarity,'negative');assert.equal(writes[0].text,'pre-seed');
});
test('new facts pin the selected goal while global facts remain an explicit choice',async()=>{
 await renderPerson();await click(button('Add a fact'));await input(document.querySelector('.fact-editor textarea')!,'Robotics');properties.activeGoal=goalB;await renderPerson();await submit();assert.equal(writes[0].goalId,goalA.id);
 await click(button('Add a fact'));await input(document.querySelector('.fact-editor select')!,'');await input(document.querySelector('.fact-editor textarea')!,'A shared detail');await submit();assert.equal(writes[1].goalId,null);
});
test('an uncertain fact retry preserves the original payload and prevents duplicate parallel submissions',async()=>{
 const pending=deferred<CandidateObservation>();properties.contextStore.save=async(_uid:string|null,value:CandidateObservationInput)=>{writes.push(value);if(writes.length===1){await pending.promise;throw Error('Uncertain save');}return observation(50,{...value,goalId:value.goalId??null});};
 await renderPerson();await click(button('Add a fact'));await input(document.querySelector('.fact-editor textarea')!,'Original detail');const handler=props(document.querySelector('.fact-editor')!).onSubmit;
 await act(async()=>{handler({preventDefault(){}});handler({preventDefault(){}});await tick();});assert.equal(writes.length,1);
 await act(async()=>{pending.resolve(observation(50));await tick();});properties.activeGoal=goalB;await renderPerson();assert.ok(document.querySelector('.fact-editor fieldset')!.hasAttribute('disabled'));await submit();assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);
});
test('an old account read cannot populate a new account, including an account switch back',async()=>{
 const readA=deferred<any>();let reads=0;properties.contextStore.read=async()=>{reads++;return reads===1?readA.promise:{observations:[],drafts:[],events:[]};};await renderPerson();properties.uid=id(71);await renderPerson();properties.uid=id(70);await renderPerson();
 await act(async()=>{readA.resolve({observations:[observation(20,{text:'Old private response'})],drafts:[],events:[]});await tick();});assert.doesNotMatch(document.body.textContent!,/Old private response/);
});
test('a slow initial context read cannot erase a newly committed fact',async()=>{
 const read=deferred<any>();properties.contextStore.read=()=>read.promise;await renderPerson();await click(button('Add a fact'));await input(document.querySelector('.fact-editor textarea')!,'New committed detail');await submit();
 await act(async()=>{read.resolve({observations:[],drafts:[],events:[]});await tick();});assert.match(document.body.textContent!,/New committed detail/);
});
test('a fact saved before initial hydration triggers a read that restores older facts too',async()=>{
 const initial=deferred<any>();let reads=0;
 properties.contextStore.read=()=>++reads===1?initial.promise:Promise.resolve({observations:[observation(20,{text:'Earlier saved fact'})],drafts:[],events:[]});
 await renderPerson();await click(button('Add a fact'));await input(document.querySelector('.fact-editor textarea')!,'New committed detail');await submit();
 assert.ok(reads>=2);assert.match(document.body.textContent!,/Earlier saved fact/);assert.match(document.body.textContent!,/New committed detail/);
 await act(async()=>{initial.resolve({observations:[],drafts:[],events:[]});await tick();});assert.match(document.body.textContent!,/Earlier saved fact/);assert.match(document.body.textContent!,/New committed detail/);
});
test('person context exposes saved drafts for the active goal on a fresh editor',async()=>{
 properties.contextStore.read=async()=>({observations:[],events:[],drafts:[{id:id(80),requestId:id(81),relationshipId:person.id,goalId:goalA.id,goalVersion:1,evidenceFingerprint:'a'.repeat(64),evidenceIds:[],channel:'linkedin',purpose:'A saved purpose',body:'Saved account wording',status:'draft',revision:2,createdAt:'2026-09-12T12:00:00Z',updatedAt:'2026-09-12T12:00:00Z'}]});
 await renderPerson();assert.ok(button('Open saved draft'));await click(button('Open saved draft'));assert.equal((document.querySelector('.conversation-message') as HTMLTextAreaElement).value,'Saved account wording');
 properties.activeGoal=goalB;await renderPerson();assert.doesNotMatch(document.body.textContent!,/Saved account wording/);
});
