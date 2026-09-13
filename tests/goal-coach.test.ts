import test from 'node:test';
import assert from 'node:assert/strict';
import {coachGoal, parseGoalCoachReply, type GoalCoachContext, type GoalCoachMessage} from '../src/lib/goal-coach';
import {createGoal} from '../src/lib/goals';
import {assessCandidate} from '../src/lib/assessment';
const context: GoalCoachContext = {kind:'fundraising',title:'Raise for Mighty',outcome:'Raise $2M by December 2026',criteria:[],openQuestions:[]};
const history: GoalCoachMessage[] = [{role:'user',text:'Pre-seed, AI software. I want to meet a Partner or an Angel investor. I do not know check size yet.'}];
const proposal = () => ({...context,criteria:[{id:'contact-role',field:'role',label:'People who could help',terms:['Partner','Angel investor'],importance:'preferred',appliesTo:'contact',origin:'suggested',evidenceQuote:'Partner or an Angel investor'},{id:'stage',field:'stage',label:'Funding stage',terms:['Pre-seed'],importance:'preferred',appliesTo:'opportunity',origin:'suggested',evidenceQuote:'Pre-seed'}],openQuestions:['What individual check size would be useful?']});
const raw = (value = proposal()) => JSON.stringify({message:'Review these details.',proposal:value});
test('one metered Ask request uses bounded JSON and sends no tools or archive data',async()=>{
  let calls=0;
  const result=await coachGoal(context,history,async request=>{
    calls++;assert.equal(request.feature,'ask_mighty');assert.equal(request.maxTokens,2048);assert.equal(request.tools,undefined);
    const data=JSON.parse(request.user);assert.deepEqual(data.current_goal,context);assert.deepEqual(data.conversation,history);
    assert.match(request.system,/total fundraising target/);assert.match(request.system,/untrusted/);
    return {text:raw(),remaining:20};
  });
  assert.equal(calls,1);assert.equal(result.proposal?.criteria[0].appliesTo,'contact');assert.equal(context.criteria.length,0);
});
test('short follow-up answers and empty new-goal forms can reach the coach',async()=>{
  const blank={...context,title:'',outcome:''};
  const result=await coachGoal(blank,[{role:'user',text:'Boston'}],async()=>({text:JSON.stringify({message:'What professional goal are you working toward?',proposal:null}),remaining:20}));
  assert.equal(result.proposal,null);assert.match(result.message,/goal/);
});
test('bounded inputs fail before dispatch without silently dropping answers',async()=>{
  let calls=0;const call=async()=>{calls++;return {text:raw(),remaining:20};};
  await assert.rejects(coachGoal(context,[],call));
  await assert.rejects(coachGoal(context,[{role:'user',text:'x'.repeat(2001)}],call));
  await assert.rejects(coachGoal(context,[{role:'user',text:'bad\u0000text'}],call));
  await assert.rejects(coachGoal(context,Array.from({length:21},()=>history[0]),call));
  await assert.rejects(coachGoal({...context,outcome:'大'.repeat(5000)},history,call),/conversation is getting long/);
  assert.equal(calls,0);
});
test('provider failures propagate with no automatic retries or success proposal',async()=>{
  let calls=0;await assert.rejects(coachGoal(context,history,async()=>{calls++;throw Error('Daily call limit reached');}),/Daily call limit/);assert.equal(calls,1);
});
test('invalid and truncated replies cannot become scoring criteria',()=>{
  for(const value of ['oops','{"message":"hello"}',JSON.stringify({message:'hello',proposal:{}}),raw().slice(0,-3),JSON.stringify({message:'x',proposal:null,save:true})])assert.throws(()=>parseGoalCoachReply(value,context,history));
  for(const patch of [{field:'probability'},{terms:['\u0000']},{appliesTo:'everyone'},{importance:'high'},{origin:'confirmed'}]){
    const value=proposal();Object.assign(value.criteria[0],patch);assert.throws(()=>parseGoalCoachReply(raw(value),context,history));
  }
  const duplicate=proposal();duplicate.criteria.push(duplicate.criteria[0]);assert.throws(()=>parseGoalCoachReply(raw(duplicate),context,history));
});
test('invented amounts are rejected and suggested criteria cannot self-confirm',()=>{
  const invented=proposal();invented.criteria.push({id:'check',field:'check_size',label:'Check size',terms:['$500K'],importance:'required',appliesTo:'contact',origin:'user',evidenceQuote:'$500K'});
  assert.throws(()=>parseGoalCoachReply(raw(invented),context,history));
  const claimed=proposal();claimed.criteria[0].origin='user';
  assert.equal(parseGoalCoachReply(raw(claimed),context,history).proposal?.criteria[0].origin,'suggested');
});
test('unchanged user criteria retain origin and identity, changed ones become suggestions',()=>{
  const value=proposal();value.criteria[0].origin='user';
  const existing=value as GoalCoachContext;
  assert.equal(parseGoalCoachReply(raw(value),existing,history).proposal?.criteria[0].origin,'user');
  const changed=structuredClone(value);changed.criteria[0].terms=['Angel investor'];
  assert.equal(parseGoalCoachReply(raw(changed),existing,history).proposal?.criteria[0].origin,'suggested');
});
test('reviewed contact criteria feed shared scoring while funding mandate stays unknown',()=>{
  const result=parseGoalCoachReply(raw(),context,history);assert.ok(result.proposal);
  const goal=createGoal(result.proposal);
  const assessment=assessCandidate(goal,{name:'Synthetic investor',url:'https://www.linkedin.com/in/synthetic-investor/',sourceKind:'profile',completeProfile:true,claims:[{id:'role',subject:'candidate',field:'role',text:'Partner',sourceKind:'profile',sourceLabel:'Rendered profile',confidence:'observed',appliesTo:'contact'}]});
  assert.equal(assessment.criteria[0].status,'supported');assert.equal(assessment.criteria[1].status,'unknown');
  assert.ok(!result.proposal.criteria.some(c=>c.field==='check_size'));
});
test('fenced JSON works, em dashes are removed from chat copy, prose stays text',()=>{
  const result=parseGoalCoachReply('```json\n'+JSON.stringify({message:'Let’s clarify\u2014which goal?',proposal:null})+'\n```',context,history);
  assert.equal(result.message.includes('\u2014'),false);
});

const grounded = (field:string,terms:string[],evidenceQuote:string,importance='preferred') => ({...context,
  criteria:[{...proposal().criteria[0],field,terms,evidenceQuote,importance}],openQuestions:[]});
const answer = (text:string):GoalCoachMessage[] => [{role:'user',text}];
test('new and changed criteria need exact owner quotes, not assistant claims or model source keys',()=>{
  const value=grounded('role',['Investor'],'Investor');
  assert.throws(()=>parseGoalCoachReply(raw(value),context,[{role:'assistant',text:'Consider an Investor.'},{role:'user',text:'Yes'}]));
  assert.throws(()=>parseGoalCoachReply(raw({...value,criteria:[{...value.criteria[0],evidenceQuote:undefined}]}),context,answer('Investor')));
  assert.throws(()=>parseGoalCoachReply(raw({...value,criteria:[{...value.criteria[0],sourceKey:'user-1'}]}),context,answer('Investor')));
  assert.throws(()=>parseGoalCoachReply(raw(value),context,answer('investor'))); // Exact quote case matters, normalized terms do not.
  const result=parseGoalCoachReply(raw(grounded('role',['investor'],'Investor')),context,answer('Investor'));
  assert.equal(result.proposal?.criteria[0].origin,'suggested');assert.equal('evidenceQuote' in result.proposal!.criteria[0],false);
});
test('whole phrases and numeric wording prevent substring matches, invented stages and changed currencies',()=>{
  assert.throws(()=>parseGoalCoachReply(raw(grounded('role',['Partner'],'Partnership')),context,answer('Partnership')));
  assert.throws(()=>parseGoalCoachReply(raw(grounded('stage',['Series A'],'Pre-seed')),context,answer('Pre-seed')));
  assert.throws(()=>parseGoalCoachReply(raw(grounded('stage',['Series A'],'Series A')),context,[{role:'assistant',text:'Series A?'},{role:'user',text:'I do not know yet'}]));
  assert.throws(()=>parseGoalCoachReply(raw(grounded('check_size',['€100K'],'$100K')),context,answer('Individual check size: $100K')));
  assert.throws(()=>parseGoalCoachReply(raw(grounded('check_size',['$0.1M'],'$100K')),context,answer('Individual check size: $100K')));
});
test('round totals cannot become individual check criteria, including when the amount already appears in the goal',()=>{
  const value=grounded('check_size',['$2M'],'$2M');
  for(const messages of [answer('I do not know check size yet.'),answer('My total round is $2M.'),answer('I want to raise $2M.'),
    [{role:'assistant',text:'What individual check size?'},{role:'user',text:'The total round is $2M.'}] as GoalCoachMessage[]]) {
    assert.throws(()=>parseGoalCoachReply(raw(value),context,messages));
  }
});
test('individual check answers are grounded in their own clause or immediately preceding question',()=>{
  const value=grounded('check_size',['$100K'],'$100K');
  const messages:GoalCoachMessage[]=[{role:'assistant',text:'What individual check size would be useful?'},{role:'user',text:'$100K'}];
  assert.equal(parseGoalCoachReply(raw(value),context,messages).proposal?.criteria[0].terms[0],'$100K');
  assert.equal(parseGoalCoachReply(raw(value),context,answer('Total round $2M; individual check size $100K.')).proposal?.criteria[0].importance,'preferred');
  assert.throws(()=>parseGoalCoachReply(raw(value),context,[{role:'assistant',text:'What individual check size?'},{role:'user',text:'Unknown'},{role:'assistant',text:'What is the round total?'},{role:'user',text:'$100K'}]));
  for(const text of ['Individual check size is not $100K','Maybe $100K per investor','No individual check of $100K','Unsure about a $100K check']) assert.throws(()=>parseGoalCoachReply(raw(value),context,answer(text)));
});
test('new requirements need affirmative owner wording, and existing importance cannot change silently',()=>{
  const value=grounded('role',['Investor'],'Investor','required');
  assert.equal(parseGoalCoachReply(raw(value),context,answer('Investor')).proposal?.criteria[0].importance,'preferred');
  const must=grounded('role',['Investor'],'Must be an Investor','required');
  assert.equal(parseGoalCoachReply(raw(must),context,answer('Must be an Investor')).proposal?.criteria[0].importance,'required');
  const negated=grounded('role',['Investor'],'required Investor','required');
  assert.equal(parseGoalCoachReply(raw(negated),context,answer('Not required Investor')).proposal?.criteria[0].importance,'preferred');
  const existing:GoalCoachContext={...context,criteria:[{...proposal().criteria[0],terms:['Investor'],importance:'required',origin:'user'}]};
  const changed=grounded('role',['Investor'],'Investor','preferred');changed.criteria[0].label='Investor contacts';
  assert.equal(parseGoalCoachReply(raw(changed),existing,answer('Investor')).proposal?.criteria[0].importance,'required');
  changed.criteria[0].evidenceQuote='Investor is preferred';
  assert.equal(parseGoalCoachReply(raw(changed),existing,answer('Investor is preferred')).proposal?.criteria[0].importance,'preferred');
});
test('context-only opportunity evidence cannot be promoted to a contact criterion',()=>{
  const existing:GoalCoachContext={...context,title:'Find a Partner role',criteria:[{...proposal().criteria[0],terms:['Partner'],appliesTo:'opportunity',origin:'user'}]};
  const value=grounded('role',['Partner'],'Partner');
  assert.throws(()=>parseGoalCoachReply(raw(value),existing,answer('Keep the current details.')));
  assert.equal(parseGoalCoachReply(raw(value),existing,answer('I want to meet a Partner.')).proposal?.criteria[0].appliesTo,'contact');
});
test('unchanged criteria can omit quotes and preserve their identity, importance and origin',()=>{
  const existing:GoalCoachContext={...context,criteria:[{id:'keep-123',field:'role',label:'Investor',terms:['Investor'],importance:'required',appliesTo:'contact',origin:'user'}]};
  const result=parseGoalCoachReply(JSON.stringify({message:'Review.',proposal:existing}),existing,answer('Keep this condition.'));
  assert.deepEqual(result.proposal?.criteria,existing.criteria);
  const invented={...existing,outcome:'Raise $123'};
  assert.throws(()=>parseGoalCoachReply(JSON.stringify({message:'Review.',proposal:invented}),existing,answer('Keep this condition.')));
});
test('reviewed role plurals ground canonical singular terms without changing the exact owner quote',()=>{
  for(const role of ['partner','investor','recruiter','founder','director','officer','manager','advisor','adviser','executive']){
    const quote=`I want to meet ${role}s`;
    const value=grounded('role',[role],quote);
    const result=parseGoalCoachReply(raw(value),context,answer(quote));
    assert.deepEqual(result.proposal?.criteria[0].terms,[role]);
    assert.equal(value.criteria[0].evidenceQuote,quote);
    assert.equal(assessCandidate(createGoal(result.proposal!),{role}).criteria[0].status,'supported');
  }
  const quote='partners, angel investors and recruiters';
  const result=parseGoalCoachReply(raw(grounded('role',['Partner','Angel investor','Recruiter'],quote)),context,answer(quote));
  assert.deepEqual(result.proposal?.criteria[0].terms,['Partner','Angel investor','Recruiter']);
});
test('role plural equivalence never expands unrelated words, substrings or company-name criteria',()=>{
  for(const [field,term,quote] of [['role','Partner','Partnerships'],['role','Investor','Investments'],['role','Company','Companies'],['custom','Insight Partner','Insight Partners'],['industry','Investment manager','Investment managers']]){
    assert.throws(()=>parseGoalCoachReply(raw(grounded(field,[term],quote)),context,answer(quote)),`${field}: ${quote}`);
  }
  const exact=grounded('custom',['Insight Partners'],'Insight Partners');
  assert.deepEqual(parseGoalCoachReply(raw(exact),context,answer('Insight Partners')).proposal?.criteria[0].terms,['Insight Partners']);
});
test('raw plural model role terms become singular matches but unchanged saved criteria remain exact',()=>{
  const quote='recruiters and Angel investors';
  const value=grounded('role',['recruiters','Angel investors'],quote);
  const result=parseGoalCoachReply(raw(value),context,answer(quote));
  assert.deepEqual(result.proposal?.criteria[0].terms,['recruiter','Angel investor']);
  assert.equal(value.criteria[0].evidenceQuote,quote);
  for(const role of ['Recruiter','Angel investor']) assert.equal(assessCandidate(createGoal(result.proposal!),{role}).criteria[0].status,'supported');
  const existing:GoalCoachContext={...context,criteria:[{id:'existing',field:'role',label:'People',terms:['recruiters'],importance:'required',appliesTo:'contact',origin:'user'}]};
  assert.deepEqual(parseGoalCoachReply(JSON.stringify({message:'Review.',proposal:existing}),existing,answer('Keep this.')).proposal?.criteria,existing.criteria);
  const named=grounded('custom',['Founders Fund'],'Founders Fund');
  assert.deepEqual(parseGoalCoachReply(raw(named),context,answer('Founders Fund')).proposal?.criteria[0].terms,['Founders Fund']);
});

// Same response shape as the reported failure, with synthetic goal identifiers,
// institution and role. No private cached response is included in this fixture.
const careerContext:GoalCoachContext={kind:'career',title:'Find a research leadership role',outcome:'Find a research leadership role in manufacturing in Boston or Chicago, with help from recruiters and senior leaders.',criteria:[
  {id:'goal-role',field:'role',label:'Role',terms:['Research Director'],importance:'preferred',appliesTo:'opportunity',origin:'user'},
  {id:'goal-industry',field:'industry',label:'Industry',terms:['Manufacturing'],importance:'preferred',appliesTo:'opportunity',origin:'user'},
  {id:'goal-location',field:'location',label:'Location',terms:['Boston','Chicago'],importance:'preferred',appliesTo:'opportunity',origin:'user'},
  {id:'goal-contacts',field:'role',label:'People who could help',terms:['Director','Recruiter'],importance:'preferred',appliesTo:'contact',origin:'user'},
],openQuestions:[]};
const ambiguousAnswer=answer('i want a role in the USA - after my MBA at Example University starting my 27');
const metadataOmitted=()=>({...careerContext,criteria:careerContext.criteria.map(({origin:_origin,...criterion})=>({...criterion,terms:[...criterion.terms]}))});

test('cached failure shape with unchanged omitted origins and invented chronology becomes a neutral clarification',async()=>{
  const before=JSON.stringify(careerContext),value={message:'Since you are beginning your MBA in 2027, should we focus on post-graduation placement?',proposal:{...metadataOmitted(),openQuestions:['Should the goal reflect a 2027 start date after the MBA?']}};
  let calls=0;
  const result=await coachGoal(careerContext,ambiguousAnswer,async request=>{
    calls++;assert.match(request.system,/Never expand a short year/);assert.equal(request.maxTokens,2048);
    return {text:JSON.stringify(value),remaining:10};
  });
  assert.equal(calls,1);assert.equal(result.proposal,null);assert.match(result.message,/What timing do you mean/);
  assert.doesNotMatch(result.message,/2027|beginning|graduation|MBA/);assert.equal(JSON.stringify(careerContext),before);
});

test('unchanged existing-ID criteria alone may recover omitted origin without losing any saved semantics',()=>{
  const result=parseGoalCoachReply(JSON.stringify({message:'Which role location would you like to clarify?',proposal:metadataOmitted()}),careerContext,ambiguousAnswer);
  assert.deepEqual(result.proposal?.criteria,careerContext.criteria);
  assert.notEqual(result.proposal?.criteria[0].terms,careerContext.criteria[0].terms);
  for(const patch of [{id:'new-id'},{field:'custom'},{label:'A changed condition'},{terms:['USA']},{importance:'required'},{appliesTo:'contact'},{origin:null},{origin:'confirmed'}]){
    const value=metadataOmitted();Object.assign(value.criteria[0],patch,{evidenceQuote:'USA'});
    assert.throws(()=>parseGoalCoachReply(JSON.stringify({message:'Review.',proposal:value}),careerContext,ambiguousAnswer),JSON.stringify(patch));
  }
  const newCriterion={id:'new-location',field:'location',label:'New location',terms:['USA'],importance:'preferred',appliesTo:'opportunity',evidenceQuote:'USA'};
  const value={...metadataOmitted(),criteria:[...metadataOmitted().criteria,newCriterion]};
  assert.throws(()=>parseGoalCoachReply(JSON.stringify({message:'Review.',proposal:value}),careerContext,ambiguousAnswer));
  const explicit={...value,criteria:[...metadataOmitted().criteria,{...newCriterion,origin:'suggested'}]};
  assert.equal(parseGoalCoachReply(JSON.stringify({message:'Review.',proposal:explicit}),careerContext,ambiguousAnswer).proposal?.criteria.at(-1)?.origin,'suggested');
});

test('unsupported numbers in follow-up messages or open questions cannot borrow grounding from assistant text',()=>{
  const messages:GoalCoachMessage[]=[{role:'assistant',text:'Would 2027 work?'},...ambiguousAnswer];
  for(const value of [
    {message:'Will you begin in 2027?',proposal:null},
    {message:'Review these details.',proposal:{...metadataOmitted(),openQuestions:['Do you mean 2027?']}},
    {message:'Should we target a $500K salary?',proposal:null},
  ]){
    const result=parseGoalCoachReply(JSON.stringify(value),careerContext,messages);
    assert.equal(result.proposal,null);assert.doesNotMatch(result.message,/2027|500|salary/);
  }
});

test('date clarification does not expand an ambiguous month or rearrange a known year into a new date',()=>{
  const value=(message:string)=>JSON.stringify({message,proposal:null});
  const expanded=parseGoalCoachReply(value('Do you mean May 27?'),careerContext,ambiguousAnswer);
  assert.match(expanded.message,/What timing/);assert.doesNotMatch(expanded.message,/May/);
  const known=answer('The program ends in May 2027.');
  assert.match(parseGoalCoachReply(value('Do you mean June 2027?'),careerContext,known).message,/What timing/);
  const literal='With the program ending in May 2027, which role would you like?';
  assert.equal(parseGoalCoachReply(value(literal),careerContext,known).message,literal);
  assert.equal(parseGoalCoachReply(value('What does “my 27” refer to?'),careerContext,ambiguousAnswer).message,'What does “my 27” refer to?');
});

test('proposal titles and outcomes cannot switch a grounded month while retaining its known year',()=>{
  const known=answer('The program ends in May 2027.');
  for(const field of ['title','outcome'] as const){
    const value={...metadataOmitted(),[field]:'Find a role after the program ends in June 2027'};
    const result=parseGoalCoachReply(JSON.stringify({message:'Review these details.',proposal:value}),careerContext,known);
    assert.equal(result.proposal,null,field);assert.match(result.message,/What timing do you mean/);assert.doesNotMatch(result.message,/June/);
    const literal={...value,[field]:'Find a role after the program ends in May 2027'};
    assert.equal(parseGoalCoachReply(JSON.stringify({message:'Review these details.',proposal:literal}),careerContext,known).proposal?.[field],literal[field]);
    assert.throws(()=>parseGoalCoachReply(JSON.stringify({message:'Review.',proposal:{...value,[field]:'Find a role in June 2028'}}),careerContext,known),'New proposal numbers retain the existing strict rejection.');
  }
});
