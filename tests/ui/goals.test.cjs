const {test,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const {parseHTML}=require('linkedom');
const React=require('react');
const {act}=React;
const {createRoot}=require('react-dom/client');
const GoalsPanel=require('./GoalsPanel.cjs').default;
const GoalSwitcher=require('./GoalSwitcher.cjs').default;
const {createGoal,reviseGoal}=require('./goals.cjs');
const reactProps=e=>e[Object.keys(e).find(key=>key.startsWith('__reactProps$'))];
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const text=()=>document.body.textContent;
const button=name=>[...document.querySelectorAll('button')].find(e=>e.textContent===name||e.getAttribute('aria-label')===name);
const control=(name,within=document)=>{
  const label=[...within.querySelectorAll('label')].find(e=>[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim()===name);
  assert.ok(label,`Label exists: ${name}`);return label.querySelector('input,textarea,select');
};
const edit=async(name,value,within)=>act(async()=>{reactProps(control(name,within)).onChange({target:{value}});await tick();});
const click=async name=>act(async()=>{const e=button(name);assert.ok(e,`Button exists: ${name}`);reactProps(e).onClick();await tick();});
const submit=async()=>act(async()=>{reactProps(document.querySelector('form')).onSubmit({preventDefault(){}});await tick();});
let root,options,calls,selections,storage;
const render=async(patch={},Component=GoalsPanel)=>{options={...options,...patch};await act(async()=>{root.render(React.createElement(Component,options));await tick();});};
const goal=(patch={})=>createGoal({kind:'career',title:'Leadership role',outcome:'Meet a hiring leader',...patch});
beforeEach(()=>{
 const {window}=parseHTML('<html><body><div id="root"></div></body></html>');
 storage=new Map();window.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)};
 Object.assign(global,{window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 root=createRoot(document.getElementById('root'));calls=[];selections=[];
 options={goals:[],activeGoalId:null,onSelect:id=>selections.push(id),onSave:async next=>{calls.push(next);}};
});
afterEach(async()=>{await act(async()=>root.unmount());});

test('new goal requires a title and outcome and never saves automatically',async()=>{
 await render();await submit();assert.equal(calls.length,0);assert.match(text(),/Add a name and the outcome/);
 await edit('Goal name','Career direction');assert.equal(calls.length,0);await submit();assert.equal(calls.length,0);
 await edit('Outcome you want','Speak with an industry operator');await submit();assert.equal(calls.length,1);
 assert.equal(calls[0].version,1);assert.deepEqual(calls[0].criteria,[]);assert.deepEqual(calls[0].openQuestions,[]);
});
test('career conditions distinguish opportunity cities from the person and preserve user choices',async()=>{
 await render();await edit('Goal name','Next role');await edit('Outcome you want','Find a suitable leadership position');
 await edit('Role','Chief AI Officer, Head of AI');await edit('Industry','Consumer goods');await edit('Opportunity locations','New York, Chicago, Boston');
 const location=[...document.querySelectorAll('.goal-criterion')].find(e=>e.textContent.includes('Opportunity locations'));
 await edit('Importance','required',location);await submit();
 const saved=calls[0];assert.deepEqual(saved.criteria.find(c=>c.field==='role').terms,['Chief AI Officer','Head of AI']);
 assert.deepEqual(saved.criteria.find(c=>c.field==='location'),{...saved.criteria.find(c=>c.field==='location'),terms:['New York','Chicago','Boston'],importance:'required',appliesTo:'opportunity',origin:'user'});
});
test('fundraising fields remain unanswered rather than inferring a stage or check size',async()=>{
 await render();await edit('Goal type','fundraising');assert.match(text(),/Stage and Investor check size: unanswered/);
 assert.equal(control('Stage').value,'');assert.equal(control('Investor check size').value,'');
 await edit('Goal name','Raise for the company');await edit('Outcome you want','Find investors whose thesis fits');
 await edit('Questions to resolve','What stage are we raising at?\nHow much should we raise?');await submit();
 assert.equal(calls[0].kind,'fundraising');assert.deepEqual(calls[0].criteria,[]);assert.equal(calls[0].openQuestions.length,2);
});
test('switching editors preserves separate drafts and does not change the active goal',async()=>{
 const career=goal(),fund=goal({kind:'fundraising',title:'Company funding'});
 await render({goals:[career,fund],activeGoalId:career.id});await edit('Outcome you want','My unsaved career draft');
 await click('Edit Company funding');await edit('Outcome you want','My separate fundraising draft');
 await click('Edit Leadership role');assert.equal(control('Outcome you want').value,'My unsaved career draft');
 await click('Edit Company funding');assert.equal(control('Outcome you want').value,'My separate fundraising draft');assert.deepEqual(selections,[]);
});
test('synchronous duplicate saves call once, failures retain edits, and new-goal retries keep identity',async()=>{
 const request=deferred();await render({onSave:next=>{calls.push(next);return request.promise;}});
 await edit('Goal name','One goal');await edit('Outcome you want','One result');
 await act(async()=>{const handler=reactProps(document.querySelector('form')).onSubmit;handler({preventDefault(){}});handler({preventDefault(){}});await tick();});
 assert.equal(calls.length,1);assert.equal(button('Saving…').disabled,true);
 await edit('Outcome you want','Must not replace an in-flight draft');assert.equal(control('Outcome you want').value,'One result');
 await act(async()=>{request.reject(Error('Synthetic failure'));await tick();});assert.match(text(),/Your edits are still here/);assert.equal(button('Save goal').disabled,false);
 await render({onSave:async next=>{calls.push(next);}});await submit();assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);
});
test('existing no-op saves preserve compound terms, questions, timestamps and version',async()=>{
 const existing=goal({outcome:'A goal\nwith its original wording',criteria:[{id:'region',field:'location',label:'Region',terms:['New York, NY','Boston'],importance:'required',appliesTo:'opportunity',origin:'suggested'}],openQuestions:['First question\nwith context']});
 await render({goals:[existing],activeGoalId:existing.id});await submit();assert.deepEqual(calls[0],existing);
});
test('editing a suggested condition confirms only that condition; a goal revision increments once',async()=>{
 const existing=goal({criteria:[{id:'one',field:'role',label:'Role',terms:['VP'],importance:'preferred',appliesTo:'opportunity',origin:'suggested'},{id:'two',field:'custom',label:'Context',terms:['Research'],importance:'preferred',appliesTo:'contact',origin:'suggested'}]});
 await render({goals:[existing],activeGoalId:existing.id});await edit('Role','Head of AI');await submit();
 assert.equal(calls[0].version,2);assert.equal(calls[0].criteria[0].origin,'user');assert.equal(calls[0].criteria[1].origin,'suggested');assert.equal(calls[0].id,existing.id);
});
test('a newer saved version blocks stale writes without overwriting the local draft',async()=>{
 const existing=goal();await render({goals:[existing],activeGoalId:existing.id});await edit('Outcome you want','My local draft');
 const newer=reviseGoal(existing,{outcome:'A change from another tab'});await render({goals:[newer]});
 assert.equal(control('Outcome you want').value,'My local draft');assert.match(text(),/changed elsewhere/);assert.equal(button('Save goal').disabled,true);
 await submit();assert.equal(calls.length,0);
 await click('Replace these edits with the saved version');assert.equal(control('Outcome you want').value,newer.outcome);assert.equal(button('Save goal').disabled,false);
});
test('pausing is explicit, keeps goal details, and switcher omits paused and completed goals',async()=>{
 const career=goal();await render({goals:[career],activeGoalId:career.id});await edit('Status','paused');assert.equal(calls.length,0);await submit();
 assert.equal(calls[0].status,'paused');assert.equal(calls[0].outcome,career.outcome);
 const other=goal({title:'Partnership',kind:'partnership'}),done=goal({title:'Done',status:'completed'});
 await render({goals:[calls[0],other,done],activeGoalId:other.id},GoalSwitcher);
 assert.equal(document.querySelectorAll('button').length,1);assert.equal(button('Partnership').getAttribute('aria-pressed'),'true');
 await click('Partnership');assert.equal(selections.length,0);
});
test('busy guards suppress direct callbacks and switcher selection stays explicit',async()=>{
 const one=goal(),two=goal({title:'Second goal'});await render({busy:true,goals:[one,two],activeGoalId:one.id});
 await edit('Outcome you want','Blocked edit');await submit();await click('Use this goal');assert.equal(calls.length,0);assert.deepEqual(selections,[]);assert.equal(control('Outcome you want').value,one.outcome);
 await render({busy:true},GoalSwitcher);await click('Second goal');assert.deepEqual(selections,[]);
 await render({busy:false},GoalSwitcher);await click('Second goal');assert.deepEqual(selections,[two.id]);
});
test('unmount and account-key remount cannot display a late save error or an old private draft',async()=>{
 const request=deferred();await render({key:'account-a',onSave:next=>{calls.push(next);return request.promise;}});
 await edit('Goal name','Private goal A');await edit('Outcome you want','Private outcome A');await submit();
 await render({key:'account-b',goals:[],activeGoalId:null,onSave:async()=>{}});
 await act(async()=>{request.reject(Error('Private late failure'));await tick();});
 assert.equal(control('Goal name').value,'');assert.doesNotMatch(text(),/Private goal A|Private outcome A|Private late failure|Couldn’t save/);
});
test('too many condition alternatives produce a visible validation error without a partial save',async()=>{
 await render();await edit('Goal name','One role');await edit('Outcome you want','A clear result');await edit('Role',Array.from({length:21},(_,i)=>'Role '+i).join(', '));
 await submit();assert.equal(calls.length,0);assert.match(text(),/at most 20/);assert.equal(button('Save goal').disabled,false);
});


test('unfinished forms restore on navigation/remount and write only their small draft record',async()=>{
 await render({draftKey:'owner-a'});await edit('Goal name','Return to this goal');await edit('Outcome you want','Keep my unfinished wording');await edit('Opportunity locations','Boston, Chicago');
 assert.equal(storage.size,1);assert.match([...storage.keys()][0],/^mighty:goal-drafts:v1:owner-a$/);assert.ok([...storage.values()][0].length<6000);
 await act(async()=>root.render(null));await render();
 assert.equal(control('Goal name').value,'Return to this goal');assert.equal(control('Outcome you want').value,'Keep my unfinished wording');assert.equal(control('Opportunity locations').value,'Boston, Chicago');assert.equal(calls.length,0);
});
test('draft-key changes isolate owner, device and other-account forms without discarding the owner draft',async()=>{
 await render({draftKey:'owner-a'});await edit('Goal name','Private owner goal');await edit('Outcome you want','Owner-only context');
 await render({draftKey:'device-draft'});assert.equal(control('Goal name').value,'');assert.doesNotMatch(text(),/Private owner goal|Owner-only context/);await edit('Goal name','A device draft');
 await render({draftKey:'owner-b'});assert.equal(control('Goal name').value,'');await edit('Goal name','Another account draft');
 await render({draftKey:'owner-a'});assert.equal(control('Goal name').value,'Private owner goal');assert.equal(control('Outcome you want').value,'Owner-only context');assert.equal(storage.size,3);
});
test('successful save clears only its unfinished draft and reopening uses the committed goal',async()=>{
 await render({draftKey:'owner-a'});await edit('Goal name','A saved goal');await edit('Outcome you want','An actual outcome');await submit();
 assert.equal(storage.size,0);const committed=calls[0];await act(async()=>root.render(null));await render({goals:[committed],activeGoalId:committed.id});
 assert.equal(control('Goal name').value,committed.title);assert.equal(control('Outcome you want').value,committed.outcome);assert.doesNotMatch(text(),/Unsaved edits|unfinished edits are restored/);
});
test('delayed goal hydration cannot replace a dirty new form or its stored draft',async()=>{
 await render({draftKey:'owner-a'});await edit('Goal name','Typed while loading');await edit('Outcome you want','This draft must survive');
 const loaded=goal({title:'A previously saved goal'});await render({goals:[loaded],activeGoalId:loaded.id});
 assert.equal(control('Goal name').value,'Typed while loading');assert.equal(control('Outcome you want').value,'This draft must survive');assert.match([...storage.values()][0],/Typed while loading/);
});
test('local save followed by cloud failure remains retryable without a false stale warning or extra revision',async()=>{
 const existing=goal();const request=deferred();await render({draftKey:'owner-a',goals:[existing],activeGoalId:existing.id,onSave:next=>{calls.push(next);return request.promise;}});
 await edit('Outcome you want','Saved locally, awaiting account sync');await submit();const locallySaved=calls[0];await render({goals:[locallySaved]});
 await act(async()=>{request.reject(Error('Synthetic cloud failure'));await tick();});assert.equal(button('Save goal').disabled,false);assert.doesNotMatch(text(),/changed elsewhere/);
 await render({onSave:async next=>{calls.push(next);}});await submit();assert.equal(calls[1].version,locallySaved.version);assert.equal(calls[1].id,locallySaved.id);assert.equal(storage.size,0);
});
test('a committed server version becomes the edit base even when lower than offline revisions',async()=>{
 const offline={...goal(),version:8};await render({goals:[offline],activeGoalId:offline.id});await edit('Outcome you want','The synchronized outcome');await submit();
 const committed={...calls[0],version:3};await render({goals:[committed]});assert.doesNotMatch(text(),/changed elsewhere/);await edit('Outcome you want','The next edit');await submit();
 assert.equal(calls[1].version,4);assert.equal(calls[1].id,offline.id);
});
test('malformed stored drafts and unavailable storage never break saved goals or save actions',async()=>{
 storage.set('mighty:goal-drafts:v1:owner-a','{broken');const existing=goal();await render({draftKey:'owner-a',goals:[existing],activeGoalId:existing.id});
 assert.equal(control('Goal name').value,existing.title);assert.match(text(),/could not be restored/);
 window.localStorage.setItem=()=>{throw Error('Synthetic quota');};await edit('Outcome you want','Still editable');assert.match(text(),/couldn’t keep the latest draft/);await submit();assert.equal(calls[0].outcome,'Still editable');
});

const coachProposal=(patch={})=>({kind:'career',title:'A leadership move',outcome:'Find a suitable AI leadership role',criteria:[{id:'coach-role',field:'role',label:'Target role',terms:['Chief AI Officer'],importance:'required',appliesTo:'opportunity',origin:'suggested'},{id:'coach-contact',field:'role',label:'People to speak with',terms:['Recruiter'],importance:'preferred',appliesTo:'contact',origin:'suggested'}],openQuestions:['Which industry should I prioritize?'],...patch});
const chatKey=(account,goalId)=>`mighty:goal-coach:v1:${encodeURIComponent(JSON.stringify([account,goalId]))}`;

test('goal conversation sends only explicitly and reads the current dirty draft without saving it',async()=>{
 const requests=[];const existing=goal();
 await render({draftKey:'owner-a',goals:[existing],activeGoalId:existing.id,coach:async(context,messages)=>{requests.push({context,messages});return {message:'Who could help you reach that outcome?',proposal:null};}});
 await edit('Outcome you want','My current unfinished outcome');await edit('Your answer','I want a leadership role');await render({busy:false});
 assert.equal(requests.length,0);assert.equal(calls.length,0);
 await click('Send answer');
 assert.equal(requests.length,1);assert.equal(requests[0].context.outcome,'My current unfinished outcome');
 assert.deepEqual(requests[0].messages,[{role:'user',text:'I want a leadership role'}]);
 assert.match(text(),/Who could help you reach that outcome/);assert.equal(control('Your answer').value,'');
 assert.equal(control('Outcome you want').value,'My current unfinished outcome');assert.equal(calls.length,0);
});

test('AI proposals require review and Apply, then the separate save preserves identity, status and version semantics',async()=>{
 const existing=goal({status:'paused'}),proposal=coachProposal();
 await render({draftKey:'owner-a',goals:[existing],activeGoalId:null,coach:async()=>({message:'Review these details.',proposal})});
 await edit('Your answer','Use Chief AI Officer roles and recruiters');await click('Send answer');
 assert.equal(control('Goal name').value,existing.title);assert.equal(calls.length,0);
 assert.match(document.querySelector('.goal-coach-preview').textContent,/Required · Opportunity/);
 assert.match(document.querySelector('.goal-coach-preview').textContent,/Preferred · Person who could help/);
 await click('Use these details');
 assert.equal(control('Goal name').value,proposal.title);assert.equal(control('Outcome you want').value,proposal.outcome);assert.equal(control('Status').value,'paused');assert.equal(calls.length,0);
 assert.match(text(),/Details added to the form/);
 await submit();assert.equal(calls.length,1);
 assert.equal(calls[0].id,existing.id);assert.equal(calls[0].createdAt,existing.createdAt);assert.equal(calls[0].version,existing.version+1);assert.equal(calls[0].status,'paused');
 assert.deepEqual(calls[0].criteria,proposal.criteria.map(c=>({...c,origin:'user'})));
 assert.deepEqual(calls[0].openQuestions,proposal.openQuestions);
});

test('unchanged suggestions retain origins and compound alternatives survive Apply plus draft restoration',async()=>{
 const unchanged={id:'existing-location',field:'location',label:'Region',terms:['New York, NY','Boston'],importance:'required',appliesTo:'opportunity',origin:'suggested'};
 const existing=goal({criteria:[unchanged]});
 const proposal=coachProposal({criteria:[{...unchanged,terms:[...unchanged.terms]},...coachProposal().criteria]});
 await render({draftKey:'owner-a',goals:[existing],activeGoalId:existing.id,coach:async()=>({message:'Review the proposed details.',proposal})});
 await edit('Your answer','Keep those locations and add the role');await click('Send answer');await click('Use these details');
 await act(async()=>root.render(null));await render();await submit();
 assert.deepEqual(calls[0].criteria[0],unchanged);assert.equal(calls[0].criteria[1].origin,'user');
 assert.deepEqual(calls[0].criteria[0].terms,['New York, NY','Boston']);
});

test('new-goal answers survive navigation before any details are filled in, without an account save',async()=>{
 const requests=[];await render({draftKey:'owner-a',coach:async(context,messages)=>{requests.push(messages);return {message:'Which kind of role interests you?',proposal:null};}});
 await edit('Your answer','Keep this unfinished private intention');
 const firstChatKey=[...storage.keys()].find(key=>key.startsWith('mighty:goal-coach:'));
 assert.ok(firstChatKey);assert.equal(calls.length,0);
 await act(async()=>root.render(null));await render();
 assert.equal(control('Your answer').value,'Keep this unfinished private intention');assert.equal(control('Goal name').value,'');
 await click('Send answer');await edit('Your answer','A leadership role');
 await act(async()=>root.render(null));await render();
 assert.equal(control('Your answer').value,'A leadership role');assert.match(text(),/Which kind of role interests you/);
 assert.equal([...storage.keys()].filter(key=>key.startsWith('mighty:goal-coach:')).length,1);assert.ok(storage.has(firstChatKey));assert.equal(requests.length,1);assert.equal(calls.length,0);
});

test('synchronous duplicate sends dispatch once and failed answers remain editable for an explicit retry',async()=>{
 const request=deferred(),requests=[];
 await render({draftKey:'owner-a',coach:(context,messages)=>{requests.push(messages);return request.promise;}});
 await edit('Your answer','My answer should survive a failed request');
 await act(async()=>{const handler=reactProps(button('Send answer')).onClick;handler();handler();await tick();});
 assert.equal(requests.length,1);assert.equal(control('Your answer').disabled,true);
 await act(async()=>{request.reject(Error('AI is unavailable for this account.'));await tick();});
 assert.match(text(),/AI is unavailable for this account/);assert.equal(control('Your answer').value,'My answer should survive a failed request');assert.equal(control('Your answer').disabled,false);
 await render({coach:async(context,messages)=>{requests.push(messages);return {message:'Which location would work?',proposal:null};}});
 await click('Send answer');assert.equal(requests.length,2);assert.deepEqual(requests[1],requests[0]);assert.equal(calls.length,0);
});

test('manual edits invalidate both pending replies and previously shown previews without losing the answer',async()=>{
 const request=deferred();await render({draftKey:'owner-a',coach:()=>request.promise});
 await edit('Your answer','A useful answer');await click('Send answer');await edit('Outcome you want','A newer manual outcome');
 await act(async()=>{request.resolve({message:'An obsolete private reply',proposal:coachProposal()});await tick();});
 assert.doesNotMatch(text(),/An obsolete private reply/);assert.equal(button('Use these details'),undefined);assert.equal(control('Your answer').value,'A useful answer');
 assert.match(text(),/goal details changed while the reply was loading/);
 await render({coach:async()=>({message:'Review these current details.',proposal:coachProposal()})});await click('Send answer');
 await edit('Goal name','A later handwritten name');assert.equal(button('Use these details').disabled,true);await click('Use these details');
 assert.equal(control('Goal name').value,'A later handwritten name');assert.equal(calls.length,0);
});

test('account changes hide prior answers and ignore late replies, while returning restores only that account conversation',async()=>{
 const request=deferred();const existing=goal();
 await render({draftKey:'owner-a',goals:[existing],activeGoalId:existing.id,coach:()=>request.promise});await edit('Your answer','Private account A answer');await click('Send answer');
 await render({draftKey:'owner-b',goals:[],activeGoalId:null,coach:undefined});
 await act(async()=>{request.resolve({message:'Private account A response',proposal:coachProposal()});await tick();});
 assert.doesNotMatch(text(),/Private account A/);assert.equal(control('Your answer').value,'');assert.match(text(),/Sign in to send/);
 await edit('Your answer','Account B local answer');
 await render({draftKey:'owner-a',goals:[existing],activeGoalId:existing.id});
 assert.equal(control('Your answer').value,'Private account A answer');assert.doesNotMatch(text(),/Account B local answer|Private account A response/);assert.equal(calls.length,0);
});

test('goal switching restores independent chats and callback rerenders do not reset them',async()=>{
 const one=goal(),two=goal({kind:'fundraising',title:'Fundraising goal'});
 await render({draftKey:'owner-a',goals:[one,two],activeGoalId:one.id,coach:async()=>({message:'Which role?',proposal:null})});
 await edit('Your answer','Career-only answer');await click('Send answer');
 await click('Edit Fundraising goal');assert.doesNotMatch(text(),/Career-only answer|Which role/);await edit('Your answer','Fundraising-only answer');
 await render({coach:async()=>({message:'A new callback',proposal:null})});assert.equal(control('Your answer').value,'Fundraising-only answer');
 await click('Edit Leadership role');assert.match(text(),/Career-only answer|Which role/);assert.equal(control('Your answer').value,'');
 await click('Edit Fundraising goal');assert.equal(control('Your answer').value,'Fundraising-only answer');assert.equal(calls.length,0);
});

test('busy or signed-out state never dispatches and a bounded stored history is not silently trimmed',async()=>{
 const existing=goal(),requests=[];const key=chatKey('owner-a',existing.id);
 const messages=Array.from({length:20},(_,index)=>({role:index%2?'assistant':'user',text:`Synthetic turn ${index}`}));
 storage.set(key,JSON.stringify({version:1,input:'One more question',messages}));
 await render({draftKey:'owner-a',goals:[existing],activeGoalId:existing.id,coach:async()=>{requests.push(1);return {message:'Unexpected',proposal:null};}});
 assert.equal(button('Send answer').disabled,true);await click('Send answer');assert.equal(requests.length,0);
 assert.match(text(),/conversation has reached its limit/);assert.equal(JSON.parse(storage.get(key)).messages.length,20);
 await click('Start a new conversation');await click('Clear conversation');await edit('Your answer','A fresh answer');
 await render({busy:true});await click('Send answer');assert.equal(requests.length,0);
 await render({busy:false,coach:undefined});await click('Send answer');assert.equal(requests.length,0);assert.equal(control('Your answer').value,'A fresh answer');
});

test('starting over requires confirmation and clears only this chat, preserving the current goal and other account data',async()=>{
 const existing=goal();storage.set('mighty:goal-coach:v1:unrelated','private-other-scope');
 await render({draftKey:'owner-a',goals:[existing],activeGoalId:existing.id});await edit('Outcome you want','Keep these manual edits');await edit('Your answer','An answer to clear');
 const key=chatKey('owner-a',existing.id);
 await click('Start a new conversation');assert.ok(storage.has(key));await click('Keep conversation');assert.equal(control('Your answer').value,'An answer to clear');
 await click('Start a new conversation');await click('Clear conversation');
 assert.equal(storage.has(key),false);assert.equal(storage.get('mighty:goal-coach:v1:unrelated'),'private-other-scope');
 assert.equal(control('Outcome you want').value,'Keep these manual edits');assert.equal(calls.length,0);
});

test('malformed chat storage and quota failures leave the goal editor and current typed answer usable',async()=>{
 const existing=goal();storage.set(chatKey('owner-a',existing.id),JSON.stringify({version:1,input:'',messages:[{role:'assistant',text:'untrusted-only assistant'}]}));
 await render({draftKey:'owner-a',goals:[existing],activeGoalId:existing.id});
 assert.match(text(),/conversation could not be restored/);assert.doesNotMatch(text(),/untrusted-only assistant/);
 window.localStorage.setItem=()=>{throw Error('Synthetic storage quota');};await edit('Your answer','Still available on this page');
 assert.equal(control('Your answer').value,'Still available on this page');assert.match(text(),/browser could not keep your latest answer/);assert.equal(control('Goal name').value,existing.title);
});

test('proposal preview identifies removed conditions and shows prior scope and importance for changed ones',async()=>{
 const remove={id:'remove-region',field:'location',label:'Region',terms:['Boston'],importance:'required',appliesTo:'opportunity',origin:'user'};
 const change={id:'change-role',field:'role',label:'Role',terms:['Chief AI Officer'],importance:'required',appliesTo:'opportunity',origin:'user'};
 const existing=goal({criteria:[remove,change]});
 await render({draftKey:'owner-a',goals:[existing],activeGoalId:existing.id,coach:async()=>({message:'Review the changes.',proposal:coachProposal({criteria:[{...change,terms:['Recruiter'],appliesTo:'contact',importance:'preferred',origin:'suggested'}]})})});
 await edit('Your answer','Show a different contact route');await click('Send answer');
 assert.match(document.querySelector('.goal-coach-removals').textContent,/Region: BostonRequired · Opportunity/);
 assert.match(document.querySelector('.goal-coach-before').textContent,/Previously: Role, Chief AI OfficerRequired · Opportunity/);
 assert.match(document.querySelector('.goal-coach-conditions').textContent,/RecruiterPreferred · Person who could help/);
 assert.equal(calls.length,0);
 assert.ok([...document.querySelector('.goals-panel').children].indexOf(document.querySelector('.goal-coach')) < [...document.querySelector('.goals-panel').children].indexOf(document.querySelector('.goal-detail-form')));
});

test('inactive workspace save explains activation once, keeps all edits and permits an exact retry after activation',async()=>{
 const inactive=Object.assign(Error('An active account is required to save goals.'),{code:'42501'});
 await render({draftKey:'private-account',onSave:async next=>{calls.push(next);throw inactive;}});
 await edit('Goal name','Jayati fixture goal');await edit('Outcome you want','Find a suitable leadership role');await edit('Role','Chief AI Officer');
 await submit();
 assert.match(text(),/You’re signed in, but this workspace isn’t active for account saves/);
 assert.match(text(),/Ask the person who set up your account to activate it/);
 assert.doesNotMatch(text(),/Couldn’t save this goal|An active account is required|42501/);
 await render({notice:'Your edit is kept on this device. An active account is required to save goals.'});
 assert.equal([...document.querySelectorAll('[role=alert]')].filter(element=>element.textContent.includes('workspace isn’t active')).length,1);
 assert.equal(control('Goal name').value,'Jayati fixture goal');assert.equal(control('Role').value,'Chief AI Officer');assert.equal(button('Save goal').disabled,false);
 const attempted=calls[0];
 await render({notice:'',onSave:async next=>{calls.push(next);}});await submit();
 assert.deepEqual(calls[1],attempted);assert.match(text(),/Goal saved/);assert.doesNotMatch(text(),/workspace isn’t active/);
});

test('inactive workspace notice on load is actionable without claiming missing setup versus paused status',async()=>{
 await render({notice:'Your edit is kept on this device. An active account is required to save goals.'});
 assert.match(text(),/workspace isn’t active/);assert.match(text(),/Your edits are still here/);
 assert.doesNotMatch(text(),/profile was never created|account is paused|email|Supabase|42501/);
 assert.equal(calls.length,0);
});

test('unrelated permission failures remain generic and late activation errors cannot appear in another account',async()=>{
 await render({draftKey:'account-a',onSave:async()=>{throw Object.assign(Error('Private unrelated database detail'),{code:'42501'});}});
 await edit('Goal name','Private draft A');await edit('Outcome you want','A real outcome');await submit();
 assert.match(text(),/Couldn’t save this goal/);assert.doesNotMatch(text(),/Private unrelated database detail|workspace isn’t active/);
 const request=deferred();await render({onSave:()=>request.promise});await submit();
 await render({draftKey:'account-b',notice:''});
 await act(async()=>{request.reject(Error('An active account is required to save goals.'));await tick();});
 assert.equal(control('Goal name').value,'');assert.doesNotMatch(text(),/Private draft A|workspace isn’t active|Couldn’t save/);
});
