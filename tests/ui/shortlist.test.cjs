const {test,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const {parseHTML}=require('linkedom');const React=require('react');const {act}=React;const {createRoot}=require('react-dom/client');
const Panel=require('./shortlist.cjs').default;const {createGoal}=require('./goals.cjs');
let root,options;const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const props=element=>element[Object.keys(element).find(key=>key.startsWith('__reactProps$'))];
const buttons=()=>[...document.querySelectorAll('button')];
const click=async name=>{const button=buttons().find(b=>b.textContent===name||b.getAttribute('aria-label')===name);assert.ok(button,name);await act(async()=>{props(button).onClick();await tick();});};
const render=async()=>act(async()=>{root.render(React.createElement(Panel,options));await tick();});
beforeEach(()=>{const {window}=parseHTML('<html><body><main id="root"></main></body></html>');Object.assign(global,{window,document:window.document,IS_REACT_ACT_ENVIRONMENT:true});root=createRoot(document.getElementById('root'));options={goal:createGoal({kind:'career',title:'AI leadership',outcome:'Find a leadership role',criteria:[{id:'role',field:'role',label:'Role',terms:['Chief AI Officer'],importance:'preferred',appliesTo:'opportunity',origin:'user'}]}),all:Array.from({length:13},(_,i)=>({person:`Fixture ${String(i).padStart(2,'0')}`,position:'Chief AI Officer',company:`Company ${i}`,profile_url:`https://www.linkedin.com/in/fixture-${i}/`})),selfEvidence:[],savedUrls:new Set(),onSave:async()=>{}};});
afterEach(async()=>act(async()=>root.unmount()));
test('the full pool yields exactly five initial cards, with unknown opportunity evidence and free next batches',async()=>{
 await render();assert.equal(document.querySelectorAll('.shortlist-card').length,5);assert.match(document.body.textContent,/opportunity role is not established/);assert.doesNotMatch(document.body.textContent,/%|probability/);
 await click('Next five');assert.equal(document.querySelectorAll('.shortlist-card').length,5);assert.match(document.body.textContent,/Fixture 05/);assert.doesNotMatch(document.body.textContent,/Fixture 00/);await click('Next five');assert.equal(document.querySelectorAll('.shortlist-card').length,3);
});
test('fundraising does not inherit career contact relevance or pad an empty result',async()=>{
 await render();options={...options,goal:createGoal({kind:'fundraising',title:'Raise for a company',outcome:'Find appropriate funding'})};await render();assert.equal(document.querySelectorAll('.shortlist-card').length,0);assert.match(document.body.textContent,/enough evidence|criterion|criteria/);
});
test('skipping one candidate reveals another, without a save or a model call',async()=>{
 let saves=0;options.onSave=async()=>{saves++};await render();await click('Skip Fixture 00 for AI leadership');assert.equal(document.querySelectorAll('.shortlist-card').length,5);assert.doesNotMatch(document.body.textContent,/Fixture 00/);assert.match(document.body.textContent,/Fixture 05/);assert.equal(saves,0);
});
test('failed saves retain their action, repeated in-flight clicks cannot duplicate a write',async()=>{
 let reject;let calls=0;options.onSave=()=>{calls++;return new Promise((_,r)=>{reject=r})};await render();const button=buttons().find(b=>b.getAttribute('aria-label')==='Save Fixture 00');await act(async()=>{props(button).onClick();props(button).onClick();await tick();});assert.equal(calls,1);await act(async()=>{reject(Error('Session expired'));await tick();});assert.match(document.body.textContent,/Session expired/);assert.equal(button.disabled,false);
 options.onSave=async()=>{calls++};await render();await click('Save Fixture 00');assert.equal(calls,2);assert.ok(buttons().some(b=>b.getAttribute('aria-label')==='Fixture 00 is saved'&&b.disabled));
});
