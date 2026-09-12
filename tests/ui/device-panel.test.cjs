const {test,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const {parseHTML}=require('linkedom');
const React=require('react');const {act}=React;const {createRoot}=require('react-dom/client');
const Panel=require('./panel.cjs').default;
const {createDeviceHandoff}=require('./handoff.cjs');
const props=e=>e[Object.keys(e).find(k=>k.startsWith('__reactProps$'))];
const tick=()=>new Promise(r=>setTimeout(r,0));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const button=name=>[...document.querySelectorAll('button')].find(e=>e.textContent===name);
const click=async name=>{const e=button(name);assert.ok(e,`Button exists: ${name}`);await act(async()=>{props(e).onClick();await tick();});};
const toggle=async index=>act(async()=>{props(document.querySelectorAll('input')[index]).onChange();await tick();});
const text=()=>document.body.textContent;
let state,root,options;
const render=async patch=>{options={...options,...patch};await act(async()=>{root.render(React.createElement(Panel,{uid:state.uid,busy:false,onCopy:state.onCopy,...options}));await tick();});};
beforeEach(()=>{
 const {window}=parseHTML('<html><body><div id="root"></div></body></html>');Object.assign(global,{window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 root=createRoot(document.getElementById('root'));options={};
 state=global.__DEVICE_PANEL__={uid:'fixture-a',device:{archive:{fingerprint:'archive-a',counts:{connections:19000}},resume:{fingerprint:'resume-a',pages:2},mailbox:{summary:{counts:{messages:31}},samples:[]},strategy:'My private goal',knowledge:{shouldNeverCopy:true}},account:{},remote:{archive:[],resume:[],mailbox:[]},reads:[],prepares:[],copies:[],writes:[]};
 state.readLocal=async key=>{state.reads.push(key);return key==='device-draft'?state.device:state.account;};
 state.handoff=createDeviceHandoff({verifyAccount:async uid=>{assert.equal(uid,state.uid);},readLocal:state.readLocal,readRemote:async()=>state.remote,fingerprint:async value=>JSON.stringify(value),copyLocal:async request=>{state.writes.push(request);const snapshot=Object.fromEntries(request.fields.map(f=>[f,state.device[f]]));state.account={...state.account,...snapshot};return snapshot;}});
 state.prepare=async(uid,fields)=>{state.prepares.push({uid,fields:[...fields]});return state.handoff.prepare(uid,fields);};
 state.onCopy=async preview=>{state.copies.push(preview);await state.handoff.copy(preview);return true;};
});
afterEach(async()=>{await act(async()=>root.unmount());});

test('mount and account changes never read or transfer device files',async()=>{
 await render();state.uid='fixture-b';await render();assert.deepEqual(state.reads,[]);assert.deepEqual(state.copies,[]);assert.deepEqual(state.writes,[]);
});
test('explicit review selects available sources, shows real counts, and never copies',async()=>{
 await render();await click('Review device files');
 assert.equal(document.querySelectorAll('input').length,4);assert.ok([...document.querySelectorAll('input')].every(e=>e.checked));
 assert.match(text(),/19,000 connections/);assert.match(text(),/2 pages/);assert.match(text(),/31 messages/);assert.match(text(),/15 characters/);
 assert.deepEqual(state.prepares,[{uid:'fixture-a',fields:['archive','resume','mailbox','strategy']}]);assert.equal(state.copies.length,0);
});
test('changing selection invalidates its preview; copying passes the exact real helper plan once',async()=>{
 await render();await click('Review device files');await toggle(1);assert.equal(button('Use selected files'),undefined);
 await click('Review selection');assert.deepEqual(state.prepares.at(-1).fields,['archive','mailbox','strategy']);
 await act(async()=>{const copy=props(button('Use selected files')).onClick;copy();copy();await tick();});
 assert.equal(state.copies.length,1);assert.equal(state.writes.length,1);assert.deepEqual(state.copies[0].fields,['archive','mailbox','strategy']);
 assert.equal(state.account.resume,undefined);assert.equal(state.account.knowledge,undefined);assert.match(text(),/Selected files are available/);
});
test('conflicts are visible, cannot be forced through a disabled control, and can be deselected',async()=>{
 state.account.archive={fingerprint:'different',counts:{connections:1}};
 await render();await click('Review device files');assert.match(text(),/already has a different version on this device/);assert.equal(button('Use selected files').disabled,true);
 await click('Use selected files');assert.equal(state.copies.length,0);
 await toggle(0);await click('Review selection');assert.equal(button('Use selected files').disabled,false);await click('Use selected files');assert.equal(state.account.archive.fingerprint,'different');
});
test('account change while reading invalidates the result and reveals no old counts',async()=>{
 const read=deferred();state.readLocal=key=>{state.reads.push(key);return read.promise;};await render();await click('Review device files');state.uid='fixture-b';await render();
 await act(async()=>{read.resolve(state.device);await tick();});assert.equal(state.prepares.length,0);assert.doesNotMatch(text(),/19,000/);assert.ok(button('Review device files'));
});
test('late preview from an earlier account is ignored even after returning to that account',async()=>{
 const preparing=deferred();state.prepare=()=>preparing.promise;await render();await click('Review device files');
 state.uid='fixture-b';await render();state.uid='fixture-a';await render();
 await act(async()=>{preparing.resolve({destinationUid:'fixture-a',fields:['archive'],conflicts:[]});await tick();});assert.equal(button('Use selected files'),undefined);assert.doesNotMatch(text(),/19,000/);
});
test('busy and synchronous repeated clicks do not start duplicate reviews',async()=>{
 await render({busy:true});await click('Review device files');assert.equal(state.reads.length,0);
 await render({busy:false});await act(async()=>{const review=props(button('Review device files')).onClick;review();review();await tick();});assert.equal(state.prepares.length,1);
});
test('review errors restore controls; a failed parent copy requires another review',async()=>{
 state.prepare=()=>{throw Error('Account could not be checked');};await render();await click('Review device files');assert.match(text(),/Account could not be checked/);assert.equal(button('Review selection').disabled,false);
 state.prepare=(uid,fields)=>state.handoff.prepare(uid,fields);await click('Review selection');await render({onCopy:async()=>false});await click('Use selected files');assert.match(text(),/Files were not copied/);assert.equal(button('Use selected files'),undefined);
});
test('empty device state and selecting nothing are clear and cannot invoke copy',async()=>{
 state.device={};await render();await click('Review device files');assert.match(text(),/No files or goal from before sign-in/);assert.equal(state.prepares.length,0);
 state.uid='fixture-b';state.device={strategy:''};await render();await click('Review device files');assert.match(text(),/Empty goal/);await toggle(0);assert.equal(button('Review selection').disabled,true);assert.equal(button('Use selected files'),undefined);
});
test('unmount during review ignores a later private result',async()=>{
 const preparing=deferred();state.prepare=()=>preparing.promise;await render();await click('Review device files');await act(async()=>{root.render(null);});
 await act(async()=>{preparing.resolve({destinationUid:'fixture-a',fields:['archive'],conflicts:[]});await tick();});assert.equal(document.body.textContent,'');assert.equal(state.copies.length,0);
});
