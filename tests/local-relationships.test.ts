import test from 'node:test';
import assert from 'node:assert/strict';
import {insertLocalPerson,insertLocalCapture,type LocalRelationshipState} from '../src/lib/local-relationships';
const state=():LocalRelationshipState=>({people:[],events:[],observations:[],drafts:[]});
test('saving the same profile twice preserves original facts and one local relationship',()=>{
 const s=state(),url='https://www.linkedin.com/in/fixture/';
 const first=insertLocalPerson(s,{person:'Fixture Person',reason:'First reason',company:'Acme'},url);
 assert.equal(insertLocalPerson(s,{person:'Changed',reason:'Overwrite'},url),first);assert.equal(s.people.length,1);assert.equal(s.people[0].context.saveReason,'First reason');
});
test('local search results remain unverified and user-entered controls are cleaned',()=>{
 const s=state();insertLocalPerson(s,{person:'Fixture\u0000 Name',reason:'Typed',source:'web_search',searchSnippet:'Boston\u0000',searchHeadline:'Example'},null);
 assert.equal(s.people[0].person,'Fixture Name');assert.equal(s.people[0].profile,undefined);assert.equal(s.people[0].context.profileComplete,false);assert.equal(s.people[0].context.searchSnippet,'Boston');
});
test('local promise completion is idempotent and cannot refer to another person',()=>{
 const s=state(),a=insertLocalPerson(s,{person:'Alpha',reason:''},null),b=insertLocalPerson(s,{person:'Beta',reason:''},null);
 insertLocalCapture(s,a,'promise_made','Share a resource');const promise=s.events[0].id;
 assert.throws(()=>insertLocalCapture(s,b,'promise_kept','',promise),/different person/);
 insertLocalCapture(s,a,'promise_kept','',promise);insertLocalCapture(s,a,'promise_kept','',promise);assert.equal(s.events.length,2);
 assert.throws(()=>insertLocalCapture(s,'missing','note','Hello'),/no longer/);
});
