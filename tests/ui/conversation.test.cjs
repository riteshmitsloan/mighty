const {test,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const {parseHTML}=require('linkedom');
const React=require('react');const {act}=React;const {createRoot}=require('react-dom/client');
const Panel=require('./ConversationPanel.cjs').default;
const {createGoal}=require('./goals.cjs');
const reactProps=e=>e[Object.keys(e).find(key=>key.startsWith('__reactProps$'))];
const tick=()=>new Promise(setImmediate);
const nativeDigest=crypto.subtle.digest.bind(crypto.subtle);
// Event handlers deliberately return void. Wait for their rendered completion;
// native WebCrypto work is awaited, never replaced with a synchronous fake.
const idle=()=>options.busy || !document.querySelector('form[aria-label="Conversation purpose"] fieldset[disabled]');
const until=async(predicate,description='conversation operation completed')=>{
 const deadline=performance.now()+10_000;
 while(!predicate()){
  assert.ok(performance.now()<deadline,`Timed out waiting for ${description}`);
  await act(async()=>{await Promise.all(state.hashes);await tick();});
 }
};
const finishLateAI=async(request,response)=>{
 const before=state.hashes.length;
 await act(async()=>{request.resolve(response);});
 await until(()=>state.hashes.length>before,'late AI response compilation');
 await act(async()=>{await Promise.all(state.hashes);});
};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const button=name=>[...document.querySelectorAll('button')].find(e=>e.textContent===name);
const control=name=>{const label=[...document.querySelectorAll('label')].find(e=>[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim()===name);assert.ok(label,`Label exists: ${name}`);return label.querySelector('input,textarea,select')||document.getElementById(label.htmlFor||label.getAttribute('for'));};
const edit=async(name,value)=>act(async()=>{reactProps(control(name)).onChange({target:{value}});await tick();});
const click=async(name,completed=idle)=>{await act(async()=>{const e=button(name);assert.ok(e,`Button exists: ${name}`);reactProps(e).onClick();});await until(completed,`${name} completed`);};
const submit=async(label='Conversation purpose',completed=idle)=>{await act(async()=>{reactProps(document.querySelector(`form[aria-label="${label}"]`)).onSubmit({preventDefault(){}});});await until(completed,`${label} completed`);};
const toggle=async fact=>act(async()=>{const label=[...document.querySelectorAll('.conversation-fact')].find(e=>e.textContent.includes(fact));assert.ok(label,`Fact exists: ${fact}`);reactProps(label.querySelector('input')).onChange();await tick();});
const text=()=>document.body.textContent;
const fill=async()=>{await edit('Why are you reaching out?','I am exploring AI leadership work');await edit('What would you like to ask?','Would you share your perspective?');};
const savedDraft=(patch={})=>({id:'stored-draft',requestId:crypto.randomUUID(),relationshipId:options.person.id,goalId:options.goal.id,goalVersion:options.goal.version,evidenceFingerprint:'a'.repeat(64),evidenceIds:['original-fact-1','original-fact-2'],channel:'email',purpose:'A saved purpose',body:'Subject: A saved subject\n\nThe complete saved message.',status:'draft',revision:4,createdAt:'2026-09-12T12:00:00Z',updatedAt:'2026-09-12T13:00:00Z',...patch});
const claim=(id,subject,text,patch={})=>({id,subject,...(subject==='candidate'?{subjectKey:'candidate-a'}:{}),field:'context',text,sourceLabel:'Confirmed note',sourceKind:'manual',confidence:'user_confirmed',appliesTo:'contact',...patch});
const validAI=request=>{const input=JSON.parse(request.user);return {text:JSON.stringify({version:1,greeting:'hi',facts:input.selectedEvidence.map(f=>({claimId:f.claimId,quote:f.quote})),intent:input.intent,ask:input.ask,closing:'thank_you'}),remaining:17};};
let root,options,state,storage;
const render=async patch=>{options={...options,...patch};await act(async()=>{root.render(React.createElement(Panel,options));await tick();});};
beforeEach(()=>{
 const {window}=parseHTML('<html><body><div id="root"></div></body></html>');storage=new Map();window.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value))};
 Object.assign(global,{window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 Object.defineProperty(global,'navigator',{configurable:true,value:{clipboard:{writeText:async text=>{state.copies.push(text);}}}});
 root=createRoot(document.getElementById('root'));
 state=global.__CONVERSATION_PANEL__={events:[],drafts:[],calls:[],copies:[],remaining:[],refreshes:0,hashes:[]};
 crypto.subtle.digest=(...args)=>{const pending=nativeDigest(...args);state.hashes.push(pending);return pending;};
 state.record=async(uid,input)=>{state.events.push({uid,input:structuredClone(input)});return {id:'event-'+state.events.length,...input,createdAt:new Date().toISOString()};};
 state.saveDraft=async(uid,input,expectedRevision)=>{state.drafts.push({uid,input:structuredClone(input),expectedRevision});return {id:'saved-draft',...input,revision:expectedRevision+1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};};
 const goal=createGoal({kind:'career',title:'An AI leadership role',outcome:'Find a suitable leadership opportunity'});
 options={uid:'account-a',person:{id:'person-a',person:'Alex'},goal,candidate:{key:'candidate-a',name:'Alex',company:'A company',claims:[claim('c-role','candidate','Leads an applied AI team'),claim('c-second','candidate','Advises industry operators'),claim('c-third','candidate','Builds practical tools')],profileReadAt:null,completeProfile:false,companyOverlap:null},selfEvidence:[claim('s-role','self','Led a product launch'),claim('s-second','self','Works across functions'),claim('s-third','self','Studies technology strategy')],call:async request=>{state.calls.push(request);return validAI(request);},onRemaining:n=>state.remaining.push(n),onRecorded:async()=>{state.refreshes++;}};
});
afterEach(async()=>{await act(async()=>root.unmount());crypto.subtle.digest=nativeDigest;});

test('mount and typing perform no provider or account operations; source-poor local drafts remain useful',async()=>{
 await render();assert.ok([...document.querySelectorAll('input[type=checkbox]')].every(e=>!e.checked));await fill();assert.equal(state.calls.length,0);assert.equal(state.events.length,0);assert.equal(state.drafts.length,0);
 await submit();assert.equal(state.calls.length,0);assert.match(control('Message text').value,/I am exploring AI leadership work/);assert.match(text(),/No candidate background facts were selected/);assert.equal(state.events.length,0);
});
test('facts are explicit, capped at two per person, and unsuitable sources are absent',async()=>{
 await render({selfEvidence:[...options.selfEvidence,claim('other-goal','self','Fundraising-only secret',{sourceKind:'knowledge'}),claim('writing','self','Unrelated writing',{field:'writing',sourceKind:'writing'})]});await fill();
 await toggle('Leads an applied');await toggle('Advises industry');await toggle('Builds practical');await toggle('Led a product');
 assert.equal([...document.querySelectorAll('input[type=checkbox]')].filter(e=>e.checked).length,3);assert.doesNotMatch(text(),/Fundraising-only secret|Unrelated writing/);
 await submit();assert.match(control('Message text').value,/Leads an applied AI team/);assert.doesNotMatch(control('Message text').value,/Builds practical/);
 await click('Try an AI draft');assert.equal(state.calls.length,1);const sent=JSON.parse(state.calls[0].user);assert.equal(sent.goal.id,options.goal.id);assert.equal(sent.selectedEvidence.length,3);assert.doesNotMatch(state.calls[0].user,/Fundraising-only secret|Unrelated writing/);assert.deepEqual(state.remaining,[17]);
});
test('AI failure or invalid output keeps the edited local draft intact',async()=>{
 await render({call:async()=>{throw Error('Unavailable');}});await fill();await submit();await edit('Message text','My carefully edited version');await click('Try an AI draft');
 assert.equal(control('Message text').value,'My carefully edited version');assert.match(text(),/AI preparation failed/);
 await render({call:async()=>({text:'{"invented":"unchecked fact"}',remaining:12})});await click('Try an AI draft');assert.equal(control('Message text').value,'My carefully edited version');assert.match(text(),/could not be verified/);assert.deepEqual(state.remaining,[12]);
});
test('a requested AI variant can be compared with the previous edited draft',async()=>{
 await render();await fill();await submit();await edit('Message text','My edited version');await click('Try an AI draft');assert.match(control('Message text').value,/^Hi Alex,/);await click('Restore previous draft');assert.equal(control('Message text').value,'My edited version');
});
test('draft recovery is scoped to account, person and goal and never automatically prepares or records',async()=>{
 await render();await fill();await submit();await edit('Message text','Private account A draft');await act(async()=>root.render(null));await render();assert.equal(control('Message text').value,'Private account A draft');
 const originalGoal=options.goal;await render({goal:createGoal({kind:'fundraising',title:'Company funding',outcome:'Meet relevant investors'})});assert.equal(control('Why are you reaching out?').value,'');assert.doesNotMatch(text(),/Private account A draft/);
 await render({goal:originalGoal,uid:'account-b'});assert.equal(control('Why are you reaching out?').value,'');
 await render({uid:'account-a',person:{id:'person-b',person:'Blair'},candidate:{...options.candidate,key:'candidate-b',name:'Blair',claims:[]}});assert.equal(control('Why are you reaching out?').value,'');assert.equal(state.events.length,0);assert.equal(state.calls.length,0);
});
test('copy is separate from saving, sending and recording',async()=>{
 await render();await fill();await edit('Channel','email');await submit();await edit('Subject','A specific question');await click('Copy message');
 assert.match(state.copies[0],/^Subject: A specific question/);assert.equal(state.events.length,0);assert.equal(state.drafts.length,0);assert.match(text(),/Nothing has been sent or recorded/);
 navigator.clipboard.writeText=async()=>{throw Error('Denied');};await click('Copy message');assert.match(text(),/Select and copy/);assert.equal(state.events.length,0);
});
test('duplicate draft saves use one request, remember revisions, and refresh retry never writes again',async()=>{
 const request=deferred();state.saveDraft=(uid,input,expectedRevision)=>{state.drafts.push({uid,input:structuredClone(input),expectedRevision});return request.promise;};
 await render({onRecorded:async()=>{state.refreshes++;throw Error('Refresh failed');}});await fill();await submit();
 await act(async()=>{const save=reactProps(button('Save draft to account')).onClick;save();save();await tick();});assert.equal(state.drafts.length,1);
 await act(async()=>{request.resolve({revision:1});});await until(idle,'draft save and history refresh');assert.equal(button('Draft saved').disabled,true);assert.match(text(),/Saved, but history could not refresh/);
 await click('Refresh history');assert.equal(state.drafts.length,1);assert.equal(state.refreshes,2);
 await render({onRecorded:async()=>{state.refreshes++;}});state.saveDraft=async(uid,input,expectedRevision)=>{state.drafts.push({uid,input:structuredClone(input),expectedRevision});return {revision:expectedRevision+1};};
 await edit('Message text','A revised draft');await click('Save draft to account');assert.equal(state.drafts[1].expectedRevision,1);assert.equal(state.drafts[1].input.requestId,state.drafts[0].input.requestId);
});
test('record sent is explicit and survives remount without a duplicate activity record',async()=>{
 await render({onRecorded:async()=>{state.refreshes++;throw Error('Refresh failed');}});await fill();await submit();await click('Copy message');assert.equal(state.events.length,0);
 await act(async()=>{const record=reactProps(button('Record sent')).onClick;record();record();await tick();});assert.equal(state.events.length,1);assert.equal(state.events[0].input.kind,'contacted');assert.equal(state.events[0].input.goalId,options.goal.id);assert.equal(state.events[0].input.body,state.copies[0]);
 await click('Refresh history');assert.equal(state.events.length,1);await act(async()=>root.render(null));await render();assert.equal(button('Sent recorded').disabled,true);await click('Sent recorded');assert.equal(state.events.length,1);
});
test('actionable account errors retain text and retries stay on the captured account and request',async()=>{
 state.record=async(uid,input)=>{state.events.push({uid,input:structuredClone(input)});throw Error('Sign in again to save to this account.');};
 await render();await fill();await submit();await click('Record sent');assert.match(text(),/Sign in again/);const original=state.events[0];await click('Confirm sent record');assert.deepEqual(state.events[1],original);assert.equal(original.uid,'account-a');
 state.saveDraft=async(uid,input,expectedRevision)=>{state.drafts.push({uid,input,expectedRevision});throw Error('Save this goal to your account before saving a draft.');};await click('Save draft to account');assert.match(text(),/Save this goal to your account/);assert.equal(state.drafts[0].uid,'account-a');assert.ok(control('Message text').value);
});
test('next steps validate input, reuse a failed request, and record an optional follow-up day',async()=>{
 await render();await submit('Record next step');assert.equal(state.events.length,0);await edit('Next step','Share the research notes');await edit('Follow-up day','2026-02-30');await submit('Record next step');assert.equal(state.events.length,0);assert.match(text(),/valid follow-up day/);
 await edit('Follow-up day','2026-09-21');const request=deferred();state.record=(uid,input)=>{state.events.push({uid,input:structuredClone(input)});return request.promise;};
 await submit('Record next step',()=>state.events.length===1);await act(async()=>{request.reject(Error('Try again'));});await until(idle,'failed next-step record');assert.equal(control('Next step').value,'Share the research notes');const first=state.events[0];
 state.record=async(uid,input)=>{state.events.push({uid,input:structuredClone(input)});return {id:'next-step-id'};};await submit('Record next step');assert.deepEqual(state.events[1],first);assert.equal(first.input.kind,'next_step');assert.equal(new Date(first.input.dueAt).getDate(),21);assert.equal(control('Next step').value,'');
});
test('delayed AI results cannot leak text, balance updates or errors after an account change',async()=>{
 const request=deferred();await render({call:input=>{state.calls.push(input);return request.promise;}});await fill();await submit();await click('Try an AI draft',()=>state.calls.length===1);assert.equal(state.calls.length,1);
 await render({uid:'account-b'});await finishLateAI(request,validAI(state.calls[0]));assert.equal(control('Why are you reaching out?').value,'');assert.deepEqual(state.remaining,[]);assert.doesNotMatch(text(),/AI draft ready|I am exploring AI leadership work/);
});
test('busy callbacks do not mutate drafts or write records and cancellation keeps the current draft',async()=>{
 await render();await fill();await submit();const original=control('Message text').value;await render({busy:true});await edit('Message text','Blocked edit');await click('Copy message');await click('Record sent');assert.equal(control('Message text').value,original);assert.equal(state.events.length,0);assert.equal(state.copies.length,0);
 const request=deferred();await render({busy:false,call:input=>{state.calls.push(input);return request.promise;}});await click('Try an AI draft',()=>state.calls.length===1);await click('Keep current draft');await finishLateAI(request,validAI(state.calls[0]));assert.equal(control('Message text').value,original);
});
test('changing a goal version preserves prepared text and keeps sent activity bound to the draft version',async()=>{
 await render();await fill();await submit();const original=control('Message text').value;await render({goal:{...options.goal,version:2,outcome:'A refined goal'}});
 assert.equal(control('Message text').value,original);assert.match(text(),/reflects the earlier choices/);await click('Record sent');assert.equal(state.events[0].input.goalVersion,1);
});
test('a removed selected fact must be cleared before another draft can be prepared',async()=>{
 await render();await fill();await toggle('Leads an applied');await submit();const previous=control('Message text').value;await render({candidate:{...options.candidate,claims:[]}});assert.match(text(),/no longer available/);assert.equal(button('Prepare another draft').disabled,true);
 await click('Clear unavailable selections');assert.equal(button('Prepare another draft').disabled,false);assert.equal(control('Message text').value,previous);
});
test('deliberate local workspace can save drafts and record activity with uid null',async()=>{
 await render({uid:null});await fill();await submit();await click('Save draft');await click('Record sent');assert.equal(state.drafts[0].uid,null);assert.equal(state.events[0].uid,null);assert.match(text(),/Sent activity recorded/);
});
test('a malformed local draft is ignored and storage failures do not block local composition',async()=>{
 const key='mighty:conversation:v1:'+['account-a','person-a',options.goal.id].map(encodeURIComponent).join(':');storage.set(key,'{broken');await render();assert.match(text(),/could not be restored/);
 window.localStorage.setItem=()=>{throw Error('Quota exceeded');};await fill();await submit();assert.ok(control('Message text').value);assert.match(text(),/couldn’t keep the latest draft/);assert.equal(state.calls.length,0);
});


test('uncertain draft saves confirm the original payload before saving newer edits',async()=>{
 state.saveDraft=async(uid,input,expectedRevision)=>{state.drafts.push({uid,input:structuredClone(input),expectedRevision});throw Error('Result uncertain');};
 await render();await fill();await submit();await click('Save draft to account');const attempt=state.drafts[0];await edit('Message text','New edits after the uncertain response');
 state.saveDraft=async(uid,input,expectedRevision)=>{state.drafts.push({uid,input:structuredClone(input),expectedRevision});return {revision:expectedRevision+1};};await click('Confirm draft save');assert.deepEqual(state.drafts[1],attempt);assert.equal(control('Message text').value,'New edits after the uncertain response');
 await click('Save draft to account');assert.equal(state.drafts[2].expectedRevision,1);assert.equal(state.drafts[2].input.body,'New edits after the uncertain response');
});
test('uncertain sent records keep their exact attempted body when the visible draft changes',async()=>{
 state.record=async(uid,input)=>{state.events.push({uid,input:structuredClone(input)});throw Error('Result uncertain');};
 await render();await fill();await submit();await click('Record sent');const attempted=state.events[0];await edit('Message text','A later, unsent revision');
 state.record=async(uid,input)=>{state.events.push({uid,input:structuredClone(input)});return {id:'confirmed-event'};};await click('Confirm sent record');assert.deepEqual(state.events[1],attempted);assert.equal(control('Message text').value,'A later, unsent revision');assert.match(text(),/sent record keeps the earlier message/);
});
test('confirming an uncertain next step preserves a newly typed next step for a separate record',async()=>{
 state.record=async(uid,input)=>{state.events.push({uid,input:structuredClone(input)});throw Error('Result uncertain');};
 await render();await edit('Next step','The original commitment');await submit('Record next step');const original=state.events[0];await edit('Next step','A different follow-up');
 state.record=async(uid,input)=>{state.events.push({uid,input:structuredClone(input)});return {id:'confirmed-step'};};await submit('Record next step');assert.deepEqual(state.events[1],original);assert.equal(control('Next step').value,'A different follow-up');
 await submit('Record next step');assert.equal(state.events[2].input.body,'A different follow-up');assert.notEqual(state.events[2].input.requestId,original.input.requestId);
});

test('fresh browser opens a saved draft with its original goal version and no automatic request',async()=>{
 const saved=savedDraft();await render({goal:{...options.goal,version:3},savedDrafts:[saved]});
 assert.equal(state.calls.length,0);assert.equal(state.drafts.length,0);assert.equal(state.events.length,0);
 await click('Open saved draft');assert.equal(control('Subject').value,'A saved subject');assert.equal(control('Message text').value,'The complete saved message.');
 assert.match(text(),/Saved for goal version 1; the current goal is version 3/);assert.ok(button('Draft saved').disabled);
 assert.equal(state.calls.length,0);assert.equal(state.drafts.length,0);assert.equal(state.events.length,0);
});
test('opening saved text preserves the current message and incomplete next step, then restores both',async()=>{
 const saved=savedDraft();await render({savedDrafts:[saved]});await fill();await submit();await edit('Message text','My unsaved local wording');await edit('Next step','Keep this unfinished next step');
 await click('Open saved draft');assert.equal(control('Message text').value,'My unsaved local wording');await click('Stay here');assert.equal(control('Next step').value,'Keep this unfinished next step');
 await click('Open saved draft');await click('Keep current and open saved');await edit('Message text','Edited stored wording');await click('Return to current draft');
 assert.equal(control('Message text').value,'My unsaved local wording');assert.equal(control('Next step').value,'Keep this unfinished next step');
 await click('Open saved draft');await click('Keep current and open saved');assert.equal(control('Message text').value,'Edited stored wording');
});
test('an incomplete purpose form survives saved-draft switching even when browser persistence fails',async()=>{
 const saved=savedDraft();window.localStorage.setItem=()=>{throw Error('Storage unavailable');};await render({savedDrafts:[saved]});await edit('Why are you reaching out?','My unfinished purpose');await edit('Next step','Unfinished follow-up');
 await click('Open saved draft');await click('Keep current and open saved');await click('Return to current draft');
 assert.equal(control('Why are you reaching out?').value,'My unfinished purpose');assert.equal(control('Next step').value,'Unfinished follow-up');
 assert.equal(state.drafts.length,0);assert.equal(state.events.length,0);
});
test('editing a reopened draft saves against its existing revision and exact source references',async()=>{
 const saved=savedDraft();const acknowledged=[];await render({savedDrafts:[saved],onDraftSaved:draft=>acknowledged.push(draft)});await click('Open saved draft');await edit('Message text','A revision of the saved message');await click('Save draft to account');
 assert.equal(state.drafts.length,1);const call=state.drafts[0];assert.equal(call.uid,'account-a');assert.equal(call.expectedRevision,4);assert.equal(call.input.requestId,saved.requestId);assert.equal(call.input.goalVersion,saved.goalVersion);assert.equal(call.input.evidenceFingerprint,saved.evidenceFingerprint);assert.deepEqual(call.input.evidenceIds,saved.evidenceIds);assert.equal(call.input.body,'Subject: A saved subject\n\nA revision of the saved message');assert.equal(acknowledged[0].revision,5);
 await edit('Message text','A second edit');await click('Save draft to account');assert.equal(state.drafts[1].expectedRevision,5);assert.equal(state.drafts[1].input.requestId,saved.requestId);
});
test('edits to reopened drafts survive remount independently of the original editor',async()=>{
 const saved=savedDraft();await render({savedDrafts:[saved]});await fill();await click('Open saved draft');await click('Keep current and open saved');await edit('Message text','Stored draft edited locally');
 await act(async()=>root.unmount());root=createRoot(document.getElementById('root'));await render();assert.equal(control('Why are you reaching out?').value,'I am exploring AI leadership work');await click('Open saved draft');await click('Keep current and open saved');assert.equal(control('Message text').value,'Stored draft edited locally');
});
test('saved list excludes other people and goals and is discarded across an account transition',async()=>{
 const saved=savedDraft();await render({savedDrafts:[saved,savedDraft({relationshipId:'another-person',body:'Other person private draft'}),savedDraft({goalId:'another-goal',body:'Other goal private draft'})]});
 assert.doesNotMatch(text(),/Other person private draft|Other goal private draft/);await click('Open saved draft');await render({uid:'account-b',savedDrafts:[]});assert.doesNotMatch(text(),/The complete saved message|A saved purpose/);assert.equal(control('Why are you reaching out?').value,'');
});
test('oversized saved text stays readable and is refused without truncating or replacing the current editor',async()=>{
 const body='x'.repeat(2001);await render({savedDrafts:[savedDraft({channel:'linkedin',body})]});await click('Open saved draft');assert.match(text(),/longer than the editor allows/);assert.equal(document.querySelector('.conversation-saved .preserve-text').textContent,body);assert.equal(control('Why are you reaching out?').value,'');assert.equal(state.drafts.length,0);
});
