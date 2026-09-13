import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {compactProfile, type CompactProfileOptions} from '../src/compact-profile.js';
import {accountGoalContext} from '../src/goal-context.js';
import {createGoal, type Goal} from '../../src/lib/goals';
import type {PageSnapshot, Profile} from '../src/types.js';

const {parseHTML}=createRequire(import.meta.url)('linkedom');
const uid='11111111-1111-4111-a111-111111111111',at='2026-09-13T12:00:00.000Z',url='https://www.linkedin.com/in/synthetic-goal-selection/';
const career=createGoal({kind:'career',title:'Career',outcome:'Meet people for a leadership career move',criteria:[
  {id:'career-contact',field:'role',label:'Career contact',terms:['CAIO','CEO'],importance:'preferred',appliesTo:'contact',origin:'user'},
]},{id:'22222222-2222-4222-a222-222222222222',now:at});
const funding=createGoal({kind:'fundraising',title:'Fundraising',outcome:'Meet people for venture funding',criteria:[
  {id:'funding-contact',field:'role',label:'Investor contact',terms:['Investor','Angel Investor'],importance:'preferred',appliesTo:'contact',origin:'user'},
]},{id:'33333333-3333-4333-a333-333333333333',now:at});
const context=(goals:readonly Goal[])=>accountGoalContext(uid,goals.map(goal=>({id:goal.id,user_id:uid,version:goal.version,document:goal})),at);
function profilePage(headline='Investor at Example Organization',roles:readonly string[]=[],ready=true):Extract<PageSnapshot,{kind:'profile'}> {
  const source={sourceUrl:url+'#experience',observedAt:at},dateRange='Jan 2024 - Present';
  const anchors:Profile['anchors']=[{kind:'headline',text:headline,sourceUrl:url+'#profile',observedAt:at},
    ...(ready?[{kind:'about' as const,text:'Professional background and experience.',sourceUrl:url+'#about',observedAt:at}]:[]),
    ...roles.flatMap(role=>{const entryText=`${role} Example Organization ${dateRange}`;return[
      {kind:'experience' as const,text:entryText,...source},{kind:'timing' as const,text:dateRange,...source},
      {kind:'experience' as const,field:'role' as const,text:role,...source,currentExperience:{dateRange,entryText}},
    ];})];
  return {kind:'profile',state:ready?'ready':'unknown',message:'',profile:{name:'Synthetic Person',profileUrl:url,profileReadAt:ready?at:null,truncated:false,truncationReasons:[],anchors}};
}
function render(overrides:Partial<CompactProfileOptions>={}) {
  const {document}=parseHTML('<html><body></body></html>');
  return compactProfile(document,{page:profilePage(),connected:true,userId:uid,goalContext:context([career,funding]),selectedGoalId:null,onSelect(){},...overrides});
}
const selected=(view:HTMLElement)=>view.querySelector('.goal-pill[aria-pressed="true"]')?.getAttribute('aria-label');
const label=(view:HTMLElement)=>view.querySelector('.fit-label')?.textContent;

test('a real provisional fundraising fit beats the first career goal with no clear connection',()=>{
  const goalContext=context([career,funding]),before=structuredClone(goalContext),calls:string[]=[];
  const view=render({goalContext,onSelect:id=>calls.push(id)});
  assert.equal(selected(view),'Fundraising');assert.equal(label(view),'Possible fit');
  assert.match(view.querySelector('.reason')?.textContent||'',/headline describes an investor role/);
  assert.equal(view.querySelectorAll('.goal-pill[aria-pressed="true"]').length,1);
  assert.equal(view.querySelector('.goal-fit')?.getAttribute('data-goal-id'),funding.id);
  assert.deepEqual(calls,[],'Automatic display choice is not an explicit user selection.');
  assert.deepEqual(goalContext,before,'Default selection never changes saved goals.');
});

test('a verified Strong fundraising fit beats a provisional Possible career fit',()=>{
  const page=profilePage('Chief AI Officer at Example Organization',['Angel Investor']);
  const careerView=render({page,selectedGoalId:career.id});assert.equal(label(careerView),'Possible fit');
  const view=render({page});assert.equal(selected(view),'Fundraising');assert.equal(label(view),'Strong potential');
});

test('equal fit tiers keep the saved goal order, including when neither goal fits',()=>{
  for(const page of [profilePage('Chief AI Officer | Investor'),profilePage('Professional interests')]){
    for(const goals of [[career,funding],[funding,career]]){
      const view=render({page,goalContext:context(goals)});
      assert.equal(selected(view),goals[0].title);
      const expected=page.profile?.anchors[0].text.includes('Investor')?'Possible fit':'No clear connection yet';
      assert.equal(label(view),expected);
    }
  }
});

test('a deliberate click overrides the automatic best fit and stays selected as evidence updates',()=>{
  const calls:string[]=[];
  const initial=render({onSelect:id=>calls.push(id)});assert.equal(selected(initial),'Fundraising');
  const button=initial.querySelector<HTMLButtonElement>('.goal-pill[aria-label="Career"]')!;
  button.click();assert.deepEqual(calls,[career.id]);
  const chosen=render({selectedGoalId:calls[0]});assert.equal(selected(chosen),'Career');assert.equal(label(chosen),'No clear connection yet');
  const updated=render({selectedGoalId:calls[0],page:profilePage('Investor at Example Organization',['Angel Investor'])});
  assert.equal(selected(updated),'Career');assert.equal(label(updated),'No clear connection yet');
});

test('a missing or no-longer-active manual selection falls back to the best active fit',()=>{
  for(const selectedGoalId of ['not-a-saved-goal',career.id]){
    const goals=selectedGoalId===career.id?[{...career,status:'paused' as const},funding]:[career,funding];
    const view=render({selectedGoalId,goalContext:context(goals)});
    assert.equal(selected(view),'Fundraising');assert.equal(label(view),'Possible fit');
  }
});

test('an unread profile does not infer a best fit from its headline or claim a match',()=>{
  const calls:string[]=[];
  for(const page of [null,profilePage('Investor at Example Organization',[],false)]){
    const view=render({page,onSelect:id=>calls.push(id)});
    assert.equal(selected(view),'Career');assert.equal(label(view),'Not enough information');
    assert.doesNotMatch(view.querySelector('.reason')?.textContent||'',/investor role|venture fits/);
  }
  assert.deepEqual(calls,[]);
});

test('a later complete read can choose the fitting goal when the user has not made a selection',()=>{
  const calls:string[]=[];
  const before=render({page:profilePage('Investor at Example Organization',[],false),onSelect:id=>calls.push(id)});
  assert.equal(selected(before),'Career');assert.equal(label(before),'Not enough information');
  const after=render({page:profilePage(),selectedGoalId:null,onSelect:id=>calls.push(id)});
  assert.equal(selected(after),'Fundraising');assert.equal(label(after),'Possible fit');assert.deepEqual(calls,[]);
});
