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
const archive=(count=1)=>({verifiedAccountHolder:{fullName:'Fixture Owner'},layer1:{id:'fixture',fingerprint:'fixture',profile:[],positions:[],education:[],skills:[],importedAt:'2026-09-12T00:00:00Z'},counts:{connections:count,positions:0,threads:0,receivedMessages:2,skills:0},connections:[{firstName:'Fixture',lastName:'Contact',url:'https://www.linkedin.com/in/mighty-ui-test-connection/',company:'Example Test Company',position:'Engineer'}],writingSamples:[],warnings:[]});
const goal=(number,title)=>({id:`00000000-0000-4000-8000-${String(number).padStart(12,'0')}`,kind:'other',title,outcome:`Outcome for ${title}`,criteria:[],openQuestions:[],version:1,status:'active',createdAt:'2026-09-12T12:00:00.000Z',updatedAt:'2026-09-12T12:00:00.000Z'});
beforeEach(()=>{
 const {window}=parseHTML('<html><body><div id="root"></div></body></html>');
 const storage=new Map();
 Object.assign(global,{window,document:window.document,HTMLElement:window.HTMLElement,Event:window.Event,localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key),key:n=>[...storage.keys()][n],get length(){return storage.size}},IS_REACT_ACT_ENVIRONMENT:true});
 window.HTMLElement.prototype.showModal=function(){this.setAttribute('open','');};window.HTMLElement.prototype.close=function(){this.removeAttribute('open');};
 s=global.__MIGHTY_UI_TEST__={uid:'user-a',authListeners:new Set(),localWrites:[],settings:async()=>({data:{data:{strategy:'Server goal'}},error:null}),localSources:async()=>({}),allConnections:async()=>[],readRelationships:async()=>({people:[],events:[]}),saveSettings:async()=>{},savePerson:async()=> 'saved-id',capture:async()=>{},gateway:async()=>{throw Error('Unexpected gateway call')},readArchive:async()=>archive(),readResume:async()=>({text:'resume',pages:1})};
 container=document.getElementById('root');root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());});
const boot=async()=>act(async()=>{root.render(React.createElement(App));await tick();await tick();});
const openGoal=async()=>{await click('Me');await click('Goal');};
const switchAccount=async uid=>act(async()=>{s.uid=uid;for(const f of s.authListeners)f('SIGNED_IN',uid?{user:{id:uid}}:null);await tick();await tick();});

test('a saved person shows the newer sourced headline in the list and person header',async()=>{
 const saved=person('current-person','Synthetic Current Person','https://www.linkedin.com/in/ui-current-role/');
 const observedAt='2026-09-13T12:00:00Z';
 const sourceUrl=saved.profile_url+'#experience',entryText='Engineering Director Fixture Labs January 2026 - Present';
 const currentExperience={dateRange:'January 2026 - Present',entryText};
 saved.context={position:'Chief Executive Officer',company:'Previous Company'};
 saved.profile={source:'rendered_profile',profileUrl:saved.profile_url,profileReadAt:observedAt,truncated:false,truncationReasons:[],anchors:[
  {kind:'headline',text:'Engineering Director at Fixture Labs',sourceUrl:saved.profile_url+'#profile',observedAt},
  {kind:'about',text:'Building infrastructure for engineering teams.',sourceUrl:saved.profile_url+'#about',observedAt},
  {kind:'experience',text:entryText,sourceUrl,observedAt},
  {kind:'timing',text:currentExperience.dateRange,sourceUrl,observedAt},
  {kind:'experience',field:'role',text:'Engineering Director',sourceUrl,observedAt,currentExperience},
  {kind:'experience',field:'company',text:'Fixture Labs',sourceUrl,observedAt,currentExperience}]};
 s.readRelationships=async()=>({people:[saved],events:[]});
 await boot();await click('Relationships');
 assert.match(document.querySelector('.relationship-row').textContent,/Engineering Director at Fixture Labs/);
 assert.doesNotMatch(document.querySelector('.relationship-row').textContent,/Chief Executive Officer|Previous Company/);
 await click(document.querySelector('.person-open'));
 assert.match(document.querySelector('.person-heading').textContent,/Engineering Director at Fixture Labs/);
 assert.doesNotMatch(document.querySelector('.person-heading').textContent,/Chief Executive Officer|Previous Company/);
});
test('clearing or correcting an extension ID cannot retain an earlier connection status',async()=>{
 localStorage.setItem('mighty-extension-id','a'.repeat(32));await boot();await click('Me');await click('Settings');
 const old=s.extensionBridgeOptions;await act(async()=>{old.onStatus({connected:true});});
 assert.match(document.querySelector('.extension-status').textContent,/Connected to your account/);
 await input(document.querySelector('#extension-id'),'invalid-id');
 assert.match(document.querySelector('.extension-status').textContent,/32 letters/);
 await act(async()=>{old.onStatus({connected:true});});
 assert.match(document.querySelector('.extension-status').textContent,/32 letters/);
 await input(document.querySelector('#extension-id'),'');
 assert.match(document.querySelector('.extension-status').textContent,/Not connected/);
});
test('switching extension IDs waits for the new extension and ignores the old callback',async()=>{
 localStorage.setItem('mighty-extension-id','a'.repeat(32));await boot();await click('Me');await click('Settings');
 const old=s.extensionBridgeOptions;await act(async()=>{old.onStatus({connected:true});});
 await input(document.querySelector('#extension-id'),'b'.repeat(32));
 const next=s.extensionBridgeOptions;assert.notEqual(next,old);
 assert.match(document.querySelector('.extension-status').textContent,/Connecting/);
 await act(async()=>{old.onStatus({connected:true});});
 assert.match(document.querySelector('.extension-status').textContent,/Connecting/);
 await act(async()=>{next.onStatus({connected:true});});
 assert.match(document.querySelector('.extension-status').textContent,/Connected to your account/);
});
test('extension goals refresh only after an account save is confirmed',async()=>{
 localStorage.setItem('mighty-extension-id','a'.repeat(32));let syncs=0;const cloud=deferred();
 s.extensionSync=async()=>{syncs++;};s.saveAccountGoal=()=>cloud.promise;
 await boot();await openGoal();await input(document.querySelector('textarea'),'Updated account goal');
 assert.equal(syncs,0,'Typing is private until saved.');
 await act(async()=>{props(document.querySelector('.goal-detail-form')).onSubmit({preventDefault(){}});await tick();});
 assert.equal(syncs,0,'An in-flight save is not confirmed.');
 await act(async()=>{cloud.resolve({});await tick();await tick();});
 assert.equal(syncs,1);assert.match(text(),/Goal saved to your account/);
});
test('a confirmed account goal refreshes the extension even if its final local reread fails',async()=>{
 localStorage.setItem('mighty-extension-id','a'.repeat(32));let syncs=0,committed=false;
 s.extensionSync=async()=>{assert.equal(committed,true);syncs++;};
 s.saveAccountGoal=async(_uid,goal)=>{committed=true;return goal;};
 s.readGoalWorkspace=async key=>{if(committed)throw Error('Local reread failed');return s.goalRecords?.get(key)??null;};
 await boot();await openGoal();await input(document.querySelector('textarea'),'Confirmed account revision');
 await act(async()=>{props(document.querySelector('.goal-detail-form')).onSubmit({preventDefault(){}});await tick();await tick();});
 assert.equal(committed,true);assert.equal(syncs,1);assert.match(text(),/Local reread failed/);
});
test('a slow extension refresh does not hold a confirmed goal save open',async()=>{
 localStorage.setItem('mighty-extension-id','a'.repeat(32));const refresh=deferred();let started=false;
 s.extensionSync=()=>{started=true;return refresh.promise;};
 await boot();await openGoal();await input(document.querySelector('textarea'),'Saved while the extension reconnects');
 try{
  await act(async()=>{props(document.querySelector('.goal-detail-form')).onSubmit({preventDefault(){}});await tick();await tick();});
  assert.equal(started,true);assert.match(text(),/Goal saved to your account/);assert.equal(button('Save goal').disabled,false);
 }finally{await act(async()=>{refresh.resolve();await tick();});}
});
test('selecting another active goal stays local; status changes refresh only after account save',async()=>{
 localStorage.setItem('mighty-extension-id','a'.repeat(32));let syncs=0;const writes=[];
 const first=goal(1,'First fixture goal'),second=goal(2,'Second fixture goal');
 s.goalRecords=new Map([['user-a',{goals:[first,second],activeGoalId:first.id}]]);
 s.extensionSync=async()=>{syncs++;};s.saveAccountGoal=async(uid,value)=>{writes.push({uid,value});return value;};
 await boot();await click('Second fixture goal');assert.equal(s.goalRecords.get('user-a').activeGoalId,second.id);
 assert.equal(syncs,0);assert.equal(writes.length,0);
 await openGoal();await input(document.querySelector('.goal-extra select'),'paused');assert.equal(syncs,0);
 await act(async()=>{props(document.querySelector('.goal-detail-form')).onSubmit({preventDefault(){}});await tick();await tick();});
 assert.equal(writes.length,1);assert.equal(writes[0].value.id,second.id);assert.equal(writes[0].value.status,'paused');assert.equal(syncs,1);
 await input(document.querySelector('.goal-extra select'),'active');assert.equal(syncs,1);
 await act(async()=>{props(document.querySelector('.goal-detail-form')).onSubmit({preventDefault(){}});await tick();await tick();});
 assert.equal(writes[1].value.status,'active');assert.equal(syncs,2);
});
for(const choice of ['local','remote'])test(`choosing the ${choice} conflict version never syncs until the explicit account save`,async()=>{
 localStorage.setItem('mighty-extension-id','a'.repeat(32));let syncs=0;const writes=[];
 const local=goal(1,'Conflicted fixture goal'),remote={...local,outcome:'Different account outcome',version:2};
 s.goalRecords=new Map([['user-a',{goals:[local],activeGoalId:local.id}]]);s.goalConflicts=[{goalId:local.id,local,remote}];
 s.extensionSync=async()=>{syncs++;};s.saveAccountGoal=async(uid,value)=>{writes.push({uid,value});return value;};
 await boot();await openGoal();await click(choice==='local'?'Keep my version':'Use account version');
 assert.equal(syncs,0);assert.equal(writes.length,0);assert.equal(s.goalConflicts.length,0);
 await act(async()=>{props(document.querySelector('.goal-detail-form')).onSubmit({preventDefault(){}});await tick();await tick();});
 assert.equal(writes.length,1);assert.equal(writes[0].value.outcome,choice==='local'?local.outcome:remote.outcome);assert.equal(syncs,1);
});
test('copied device goals reach the extension only after their explicit account save',async()=>{
 localStorage.setItem('mighty-extension-id','a'.repeat(32));let syncs=0;const writes=[],copied=goal(3,'Copied fixture goal');
 s.goalRecords=new Map([['user-a',{goals:[],activeGoalId:null}]]);
 s.prepareDeviceGoals=async uid=>({destinationUid:uid,goals:[copied],conflicts:[]});
 s.copyDeviceGoals=async preview=>{const workspace={goals:[copied],activeGoalId:copied.id};s.goalRecords.set(preview.destinationUid,workspace);return workspace;};
 s.extensionSync=async()=>{syncs++;};s.saveAccountGoal=async(uid,value)=>{writes.push({uid,value});return value;};
 await boot();await openGoal();await click('Review device goals');await click('Copy selected goals');
 assert.equal(syncs,0);assert.equal(writes.length,0);assert.match(text(),/Save a goal to sync it to your account/);
 await click(document.querySelector('button[aria-label="Edit Copied fixture goal"]'));
 await act(async()=>{props(document.querySelector('.goal-detail-form')).onSubmit({preventDefault(){}});await tick();await tick();});
 assert.equal(writes.length,1);assert.equal(writes[0].uid,'user-a');assert.equal(writes[0].value.id,copied.id);assert.equal(syncs,1);
});
test('a deliberate device-only goal save never refreshes account goals',async()=>{
 localStorage.setItem('mighty-extension-id','a'.repeat(32));s.uid=null;let syncs=0,writes=0;
 const local=goal(4,'Device fixture goal');s.goalRecords=new Map([['device-draft',{goals:[local],activeGoalId:local.id}]]);
 s.extensionSync=async()=>{syncs++;};s.saveAccountGoal=async()=>{writes++;throw Error('Unexpected account write');};
 await boot();await openGoal();await input(document.querySelector('textarea'),'Private device-only revision');
 await act(async()=>{props(document.querySelector('.goal-detail-form')).onSubmit({preventDefault(){}});await tick();await tick();});
 assert.equal(syncs,0);assert.equal(writes,0);assert.match(text(),/Goal saved on this device/);
});
test('a failed account goal save keeps the local edit without refreshing extension goals',async()=>{
 localStorage.setItem('mighty-extension-id','a'.repeat(32));let syncs=0;
 s.extensionSync=async()=>{syncs++;};s.saveAccountGoal=async()=>{throw Error('Account offline');};
 await boot();await openGoal();await input(document.querySelector('textarea'),'Local goal awaiting connection');
 await act(async()=>{props(document.querySelector('.goal-detail-form')).onSubmit({preventDefault(){}});await tick();await tick();});
 assert.equal(syncs,0);assert.match(text(),/Your edit is kept on this device/);assert.equal(document.querySelector('textarea').value,'Local goal awaiting connection');
});
test('a late goal save cannot refresh the extension for the previous account',async()=>{
 localStorage.setItem('mighty-extension-id','a'.repeat(32));let syncs=0;const cloud=deferred();
 s.extensionSync=async()=>{syncs++;};s.saveAccountGoal=()=>cloud.promise;
 await boot();await openGoal();await input(document.querySelector('textarea'),'Goal for account A');
 await act(async()=>{props(document.querySelector('.goal-detail-form')).onSubmit({preventDefault(){}});await tick();});
 await switchAccount('user-b');const afterSwitch=syncs;
 await act(async()=>{cloud.resolve({});await tick();await tick();});
 assert.equal(syncs,afterSwitch);assert.doesNotMatch(text(),/Goal for account A/);
});

test('goal typed before delayed hydration survives the server and local replies',async()=>{
 const local=deferred(),server=deferred();s.localSources=()=>local.promise;s.settings=()=>server.promise;await boot();await openGoal();
 await input(document.querySelector('textarea'),'My unsaved typed goal');
 await act(async()=>{local.resolve({strategy:'Old local goal'});server.resolve({data:{data:{strategy:'Old server goal'}},error:null});await tick();});
 assert.equal(document.querySelector('textarea').value,'My unsaved typed goal');assert.equal(s.localWrites.length,0,'Structured goal typing never rewrites imported sources.');
 await input(document.querySelector('textarea'),'');assert.equal(document.querySelector('textarea').value,'');assert.equal(s.localWrites.length,0);
});

test('account switch hides old sources, people and the old account goal',async()=>{
 s.localSources=async key=>key==='user-a'?{archive:archive(),strategy:'Private A goal'}:{strategy:'Private B goal'};
 s.readRelationships=async uid=>({people:[person(uid,uid==='user-a'?'Private A Person':'Private B Person')],events:[]});await boot();assert.match(text(),/Private A Person/);
 await openGoal();await input(document.querySelector('textarea'),'A draft before switch');await switchAccount('user-b');
 assert.doesNotMatch(text(),/Private A Person|Fixture Owner|A draft before switch/);assert.match(text(),/Private B Person/);await openGoal();assert.equal(document.querySelector('textarea').value,'Private B goal');
 await switchAccount('user-a');await openGoal();assert.equal(document.querySelector('textarea').value,'A draft before switch');
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

test('an explicitly copied device goal is saved with its sources only after Save to account',async()=>{
 const device={archive:archive(),strategy:'Copied device goal'};
 const copies=[],settingsWrites=[];
 s.localSources=async key=>key==='device-draft'?device:{};
 s.settings=async()=>({data:{data:{strategy:''}},error:null});
 s.prepareHandoff=async(uid,fields)=>({destinationUid:uid,fields:[...fields],fingerprint:'synthetic-handoff',conflicts:[]});
 s.copyHandoff=async preview=>{copies.push(preview);return {destinationUid:preview.destinationUid,fields:preview.fields,fingerprint:preview.fingerprint,snapshot:device};};
 s.saveSettings=async(patch,uid)=>settingsWrites.push({patch,uid});
 await boot();assert.equal(copies.length,0);assert.equal(settingsWrites.length,0);
 await click('Me');await click("Things you've learned");await click('Review device files');
 assert.equal(copies.length,0,'Review must not copy or save sources.');
 await click('Use selected files');
 assert.equal(copies.length,1);assert.deepEqual(copies[0].fields,['archive','strategy']);
 assert.equal(settingsWrites.length,0,'A local handoff must not write the cloud goal.');
 assert.equal(button('Save to account').disabled,false);
 await click('Save to account');
 assert.deepEqual(settingsWrites,[{patch:{strategy:'Copied device goal'},uid:'user-a'}]);
 assert.match(text(),/Sources saved to your account/);
});

test('clearing an outcome preserves the existing goal until a valid edit or explicit pause is saved',async()=>{
 s.settings=async()=>({data:{data:{strategy:'Existing saved goal'}},error:null});
 await boot();await openGoal();await input(document.querySelector('textarea'),'');
 const form=document.querySelector('.goal-detail-form');await act(async()=>{props(form).onSubmit({preventDefault(){}});await tick();});
 assert.match(text(),/Add a name and the outcome/);assert.equal(s.goalRecords.get('user-a').goals[0].outcome,'Existing saved goal');
 assert.equal(document.querySelector('textarea').value,'');assert.equal(s.localWrites.length,0);
});

test('newer structured goal typing survives a deferred legacy handoff and source saving',async()=>{
 const completion=deferred();
 const device={archive:archive(),strategy:'Older goal from device copy'};
 const writes=[];let copiedPreview;
 s.localSources=async key=>key==='device-draft'?device:{};
 s.settings=async()=>({data:{data:{strategy:''}},error:null});
 s.prepareHandoff=async(uid,fields)=>({destinationUid:uid,fields:[...fields],fingerprint:'synthetic-delayed-handoff',conflicts:[]});
 // The local transaction has committed, but its final account check/result is
 // delayed. Typing in this interval must remain newer than that copied snapshot.
 s.copyHandoff=async preview=>{copiedPreview=preview;return completion.promise;};
 s.saveSettings=async(patch,uid)=>writes.push({patch,uid});
 await boot();await click('Me');await click("Things you've learned");await click('Review device files');await click('Use selected files');
 assert.ok(copiedPreview);await click('Goal');
 await input(document.querySelector('textarea'),'Newer goal typed while the handoff finishes');
 assert.equal(s.localWrites.length,0,'Typing must not write the source record.');
 await act(async()=>{completion.resolve({destinationUid:copiedPreview.destinationUid,fields:copiedPreview.fields,fingerprint:copiedPreview.fingerprint,snapshot:device});await tick();});
 await click('Goal');assert.equal(document.querySelector('textarea').value,'Newer goal typed while the handoff finishes');
 assert.equal(writes.length,0);
 await click("Things you've learned");await click('Save to account');
 assert.deepEqual(writes,[{patch:{strategy:'Older goal from device copy'},uid:'user-a'}]);
 await click('Goal');assert.equal(document.querySelector('textarea').value,'Newer goal typed while the handoff finishes');
});
