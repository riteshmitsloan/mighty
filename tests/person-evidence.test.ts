import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSavedPersonEvidence} from '../src/lib/person-evidence';
import type {Person} from '../src/lib/data-access';
const at='2026-09-12T12:00:00Z';
const person:Person={id:'person',person:'Fixture Person',profile_url:'https://www.linkedin.com/in/fixture-person/',stage:'saved',context:{source:'extension'},created_at:at};
const anchors=[{kind:'headline',text:'Exploring product leadership',sourceUrl:person.profile_url!,observedAt:at},
 {kind:'about',text:'A recorded account of product delivery.',sourceUrl:person.profile_url!,observedAt:at},
 {kind:'education',text:'Fixture University',sourceUrl:person.profile_url!,observedAt:at},
 {kind:'timing',text:'Recent rendered activity: September 2026',sourceUrl:person.profile_url!,observedAt:at}];
test('saved extension profile keeps its timestamp, completeness and every sourced anchor',()=>{
 const snapshot={name:person.person,profileUrl:person.profile_url,profileReadAt:at,truncated:false,anchors};
 const result=buildSavedPersonEvidence({...person,profile:snapshot});
 assert.equal(result.profileReadAt,at);assert.equal(result.completeProfile,true);
 assert.deepEqual(result.claims.filter(c=>c.sourceKind==='profile').map(c=>[c.text,c.sourceRef,c.observedAt]),anchors.map(a=>[a.text,a.sourceUrl,a.observedAt]));
 assert.deepEqual(snapshot.anchors,anchors);
});
test('an explicit missing read never borrows an old timestamp or turns search context into a profile',()=>{
 const result=buildSavedPersonEvidence({...person,context:{source:'web_search',profile_read_at:at,searchHeadline:'Chief AI Officer'},profile:{anchors,profileReadAt:null,observedAt:at}});
 assert.equal(result.profileReadAt,null);assert.equal(result.completeProfile,false);
 assert.ok(!result.claims.some(c=>c.text==='Chief AI Officer'));
});
test('truncated and invalid-date snapshots remain incomplete',()=>{
 assert.equal(buildSavedPersonEvidence({...person,profile:{anchors,profileReadAt:at,truncated:true}}).completeProfile,false);
 assert.equal(buildSavedPersonEvidence({...person,profile:{anchors,profileReadAt:'not a date',observedAt:at}}).completeProfile,false);
});
test('legacy observed timestamps work only when the current timestamp field is absent',()=>{
 assert.equal(buildSavedPersonEvidence({...person,profile:{anchors,observedAt:at}}).profileReadAt,at);
 assert.equal(buildSavedPersonEvidence({...person,profile:{anchors,profileReadAt:'',observedAt:at}}).profileReadAt,null);
});
