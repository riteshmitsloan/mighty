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
