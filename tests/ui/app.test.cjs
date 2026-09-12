// Behavioral regression checks for the actual App and its React components.
// All names, account IDs, URLs and source contents here are synthetic fixtures.
// Network, account storage, parsers and extension APIs are replaced by harness stubs.
// Helpers invoke React's registered callbacks on rendered controls. This is not
// browser automation and does not claim native focus, input-event or dialog coverage.
const {test,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const {parseHTML}=require('linkedom');
const React=require('react');
const {act}=React;
const {createRoot}=require('react-dom/client');
const App=require('./app.cjs').default;
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
let root,container,s;
const tick=()=>new Promise(r=>setTimeout(r,0));
const props=e=>e[Object.keys(e).find(k=>k.startsWith('__reactProps$'))];
const button=t=>[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===t || (e.classList.contains('nav-item') && e.textContent.startsWith(t)));
const click=async t=>{const e=typeof t==='string'?button(t):t;assert.ok(e,`Button exists: ${t}`);await act(async()=>{props(e).onClick({preventDefault(){},currentTarget:e,target:e});await tick();});};
const input=async(e,value)=>{assert.ok(e);await act(async()=>{props(e).onChange({target:{value}});await tick();});};
const text=()=>document.body.textContent;
const person=(id,name,url=null)=>({id,person:name,profile_url:url,stage:'saved',context:{},created_at:'2026-09-12T12:00:00Z'});
const archive=(count=1)=>({verifiedAccountHolder:{fullName:'Fixture Owner'},layer1:{positions:[],education:[],skills:[],importedAt:'2026-09-12T00:00:00Z'},counts:{connections:count,positions:0,threads:0,receivedMessages:2,skills:0},connections:[{firstName:'Fixture',lastName:'Contact',url:'https://www.linkedin.com/in/mighty-ui-test-connection/',company:'Example Test Company',position:'Engineer'}],writingSamples:[],warnings:[]});
beforeEach(()=>{
 const {window}=parseHTML('<html><body><div id="root"></div></body></html>');
 Object.assign(global,{window,document:window.document,HTMLElement:window.HTMLElement,Event:window.Event,localStorage:{getItem:()=>null,setItem(){}},IS_REACT_ACT_ENVIRONMENT:true});
 window.HTMLElement.prototype.showModal=function(){this.setAttribute('open','');};window.HTMLElement.prototype.close=function(){this.removeAttribute('open');};
 s=global.__MIGHTY_UI_TEST__={uid:'user-a',authListeners:new Set(),localWrites:[],settings:async()=>({data:{data:{strategy:'Server goal'}},error:null}),localSources:async()=>({}),allConnections:async()=>[],readRelationships:async()=>({people:[],events:[]}),saveSettings:async()=>{},savePerson:async()=> 'saved-id',capture:async()=>{},gateway:async()=>{throw Error('Unexpected gateway call')},readArchive:async()=>archive(),readResume:async()=>({text:'resume',pages:1})};
 container=document.getElementById('root');root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());});
const boot=async()=>act(async()=>{root.render(React.createElement(App));await tick();await tick();});
const openGoal=async()=>{await click('Me');await click('Goal');};
const switchAccount=async uid=>act(async()=>{s.uid=uid;for(const f of s.authListeners)f('SIGNED_IN',uid?{user:{id:uid}}:null);await tick();await tick();});

test('goal typed before delayed hydration survives the server and local replies',async()=>{
 const local=deferred(),server=deferred();s.localSources=()=>local.promise;s.settings=()=>server.promise;await boot();await openGoal();
 await input(document.querySelector('textarea'),'My unsaved typed goal');
 await act(async()=>{local.resolve({strategy:'Old local goal'});server.resolve({data:{data:{strategy:'Old server goal'}},error:null});await tick();});
 assert.equal(document.querySelector('textarea').value,'My unsaved typed goal');assert.deepEqual(s.localWrites.at(-1),{key:'user-a',patch:{strategy:'My unsaved typed goal'}});
 await input(document.querySelector('textarea'),'');assert.equal(document.querySelector('textarea').value,'');assert.deepEqual(s.localWrites.at(-1),{key:'user-a',patch:{strategy:''}});
});

test('account switch hides old sources, people and the old account goal',async()=>{
 s.localSources=async key=>key==='user-a'?{archive:archive(),strategy:'Private A goal'}:{strategy:'Private B goal'};
 s.readRelationships=async uid=>({people:[person(uid,uid==='user-a'?'Private A Person':'Private B Person')],events:[]});await boot();assert.match(text(),/Private A Person/);
 await openGoal();await input(document.querySelector('textarea'),'A draft before switch');await switchAccount('user-b');
 assert.doesNotMatch(text(),/Private A Person|Fixture Owner|A draft before switch/);assert.match(text(),/Private B Person/);await openGoal();assert.equal(document.querySelector('textarea').value,'Private B goal');
 assert.ok(s.localWrites.some(w=>w.key==='user-a'&&w.patch.strategy==='A draft before switch'));
});

test('an archive completed after account switching remains pinned to its original local account',async()=>{
 const importing=deferred();s.readArchive=()=>importing.promise;await boot();await click('Me');await click("Things you've learned");
 const fileInput=document.querySelector('input[accept=".zip"]');await act(async()=>{props(fileInput).onChange({target:{files:[new Blob(['zip'])],value:'zip'}});await tick();});
 await switchAccount('user-b');await act(async()=>{importing.resolve(archive());await tick();});
 assert.ok(s.localWrites.some(w=>w.key==='user-a'&&w.patch.archive));assert.ok(!s.localWrites.some(w=>w.key==='user-b'&&w.patch.archive));assert.doesNotMatch(text(),/Fixture Owner/);
});

test('web save preserves the visible headline and snippet as unverified search context',async()=>{
 const calls=[];s.savePerson=async(uid,value)=>{calls.push({uid,value});return 'saved-web';};
 s.gateway=async(uid,req)=>req.feature==='search_keywords'?{text:'product Example City',remaining:10}:{text:JSON.stringify([{title:'Fixture Person - Product role in Example City',url:'https://www.linkedin.com/in/mighty-ui-test-person/',snippet:'Location: Example City · Education: Test University'}]),remaining:10};
 await boot();await click('Explore');await input(document.querySelector('input[type="search"]'),'product Example City');await click('Search the web');await click('Save');
 assert.equal(calls.length,1);assert.equal(calls[0].value.person,'Fixture Person');assert.equal(calls[0].value.position,undefined);assert.equal(calls[0].value.searchHeadline,'Product role in Example City');assert.equal(calls[0].value.searchSnippet,'Location: Example City · Education: Test University');assert.equal(calls[0].value.source,'web_search');
 assert.match(text(),/Product role in Example City/);assert.match(text(),/Education: Test University/);
});

test('committed person save closes the form; refresh retry is read-only',async()=>{
 const writes=[];s.savePerson=async(uid,value)=>{writes.push(value);return 'row-'+writes.length;};await boot();await click('Relationships');await click('Save a person');
 s.readRelationships=async()=>{throw Error('Temporary refresh error');};
 const form=document.querySelector('dialog form');const OriginalFormData=global.FormData;global.FormData=class{get(key){return {name:'Sam Without URL',url:'',reason:'Keep in touch'}[key];}};
 try{await act(async()=>{props(form).onSubmit({preventDefault(){},currentTarget:form});await tick();});assert.equal(document.querySelector('dialog'),null);assert.match(text(),/Person saved\. Your list could not refresh/);assert.ok(button('Refresh list'));assert.equal(writes.length,1);
 s.readRelationships=async()=>({people:[person('row-1','Sam Without URL')],events:[]});await click('Refresh list');assert.equal(writes.length,1);assert.match(text(),/Sam Without URL/);assert.doesNotMatch(text(),/Temporary refresh error/);assert.equal(button('Refresh list'),undefined);}
 finally{global.FormData=OriginalFormData;}
});

test('cancelling the person dialog performs no write and allows reopening',async()=>{
 let writes=0;s.savePerson=async()=>{writes++;return 'unused';};
 await boot();await click('Relationships');await click('Save a person');const name=document.querySelector('input[name="name"]');name.value='Typed but unsaved name';
 await click(document.querySelector('button[aria-label="Close dialog"]'));await click('Save a person');assert.equal(document.querySelector('input[name="name"]').value,'');assert.equal(writes,0);
});

test('recording a note is unavailable until a person is selected',async()=>{
 s.readRelationships=async()=>({people:[person('x','Existing Person')],events:[]});await boot();await click('Record an update');const save=[...document.querySelectorAll('dialog button')].find(b=>b.textContent==='Save update');assert.ok(save.disabled);
});

test('person navigation preserves separate drafts and cannot retarget Alpha text to Beta',async()=>{
 const writes=[];s.readRelationships=async()=>({people:[person('person-a','Person Alpha'),person('person-b','Person Beta')],events:[]});s.capture=async(...args)=>writes.push(args);
 await boot();await click('Relationships');await click([...document.querySelectorAll('.person-open')].find(e=>e.textContent.includes('Person Alpha')));await click('Updates');
 await input(document.querySelector('textarea'),'Private context about Alpha');await click('Relationships');await click([...document.querySelectorAll('.person-open')].find(e=>e.textContent.includes('Person Beta')));await click('Updates');
 assert.equal(document.querySelector('textarea').value,'');await input(document.querySelector('textarea'),'Beta context');
 await click('Relationships');await click([...document.querySelectorAll('.person-open')].find(e=>e.textContent.includes('Person Alpha')));await click('Updates');assert.equal(document.querySelector('textarea').value,'Private context about Alpha');
 const form=document.querySelector('.capture-form');await act(async()=>{props(form).onSubmit({preventDefault(){}});await tick();});assert.equal(writes[0][1],'person-a');assert.equal(writes[0][3],'Private context about Alpha');assert.equal(document.querySelector('textarea').value,'');
 await click('Relationships');await click([...document.querySelectorAll('.person-open')].find(e=>e.textContent.includes('Person Beta')));await click('Updates');assert.equal(document.querySelector('textarea').value,'Beta context');
});

test('explicit person dropdown changes load that person’s text and update kind',async()=>{
 s.readRelationships=async()=>({people:[person('person-a','Person Alpha'),person('person-b','Person Beta')],events:[]});await boot();await click('Record an update');
 const selects=()=>[...document.querySelectorAll('dialog select')];await input(selects()[0],'person-a');await input(document.querySelector('dialog textarea'),'Alpha promise');await input(selects()[1],'promise_made');
 await input(selects()[0],'person-b');assert.equal(document.querySelector('dialog textarea').value,'');assert.equal(props(selects()[1]).value,'note');await input(document.querySelector('dialog textarea'),'Beta note');
 await input(selects()[0],'person-a');assert.equal(document.querySelector('dialog textarea').value,'Alpha promise');assert.equal(props(selects()[1]).value,'promise_made');
});

test('account switch clears active note drafts, including when IDs happen to coincide',async()=>{
 s.readRelationships=async()=>({people:[person('same-id','Account Person')],events:[]});await boot();await click('Record an update');await input(document.querySelector('dialog select'),'same-id');await input(document.querySelector('dialog textarea'),'Private Alpha account note');
 await switchAccount('user-b');assert.equal(document.querySelector('dialog'),null);await click('Record an update');await input(document.querySelector('dialog select'),'same-id');assert.equal(document.querySelector('dialog textarea').value,'');assert.doesNotMatch(text(),/Private Alpha account note/);
});

test('committed update clears only its owner draft and a refresh retry does not insert again',async()=>{
 const writes=[];s.readRelationships=async()=>({people:[person('a','Alpha')],events:[]});s.capture=async(...args)=>writes.push(args);await boot();await click('Record an update');await input(document.querySelector('dialog select'),'a');await input(document.querySelector('dialog textarea'),'A saved note');
 s.readRelationships=async()=>{throw Error('Read temporarily failed')};const form=document.querySelector('.capture-form');await act(async()=>{props(form).onSubmit({preventDefault(){}});await tick();});assert.equal(writes.length,1);assert.equal(document.querySelector('dialog'),null);assert.match(text(),/Update saved\. Your list could not refresh/);
 s.readRelationships=async()=>({people:[person('a','Alpha')],events:[]});await click('Refresh list');assert.equal(writes.length,1);await click('Record an update');assert.equal(document.querySelector('dialog textarea').value,'');
});

test('an uncommitted save failure leaves the note draft available for correction and retry',async()=>{
 s.readRelationships=async()=>({people:[person('a','Alpha')],events:[]});s.capture=async()=>{throw Error('Write refused')};await boot();await click('Record an update');await input(document.querySelector('dialog select'),'a');await input(document.querySelector('dialog textarea'),'Keep this draft');
 const form=document.querySelector('.capture-form');await act(async()=>{props(form).onSubmit({preventDefault(){}});await tick();});assert.equal(document.querySelector('dialog textarea').value,'Keep this draft');assert.match(document.querySelector('dialog').textContent,/Write refused/);assert.equal(button('Refresh list'),undefined);
});
