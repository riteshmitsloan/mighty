import test from 'node:test';
import assert from 'node:assert/strict';
import {readRelationshipData,readConnectionsData,savePersonData,updateStageData,finishImportData,drainInboxData} from '../src/lib/data-access';
import {MemoryServer,id} from './fake-client';
const stamp=(n:number)=>new Date(Date.UTC(2026,0,1)+n*1000).toISOString();
test('more than 1000 relationships, events and reads survive pagination and latest observation determines profile evidence',async()=>{
 const people=Array.from({length:2051},(_,n)=>({id:id(n),user_id:'A',person:'Person '+n,profile_url:null,stage:'saved',created_at:stamp(n),context:{profileComplete:false,source:'original',profile:{headline:'Original snippet'}}}));
 const events=Array.from({length:2117},(_,n)=>({id:id(n),user_id:'A',relationship_id:id(n%2051),kind:'note',body:'Event '+n,related_event_id:null,created_at:stamp(n)}));
 const reads=Array.from({length:2203},(_,n)=>({id:id(n),user_id:'A',relationship_id:id(n%2051),snapshot:{anchors:['Captured '+n]},observed_at:stamp(n),created_at:stamp(n)}));
 // The last ID arrived last but represents an older read of Person 0.
 reads.push({id:id(3000),user_id:'A',relationship_id:id(0),snapshot:{anchors:['Older arrived late']},observed_at:stamp(-1),created_at:stamp(4000)});
 const server=new MemoryServer({outreach_log:[...people,{...people[0],id:'B-only',user_id:'B'}],outreach_events:events,profile_reads:reads});server.pageCap=137;
 const result=await readRelationshipData(server.client,'A');assert.equal(result.people.length,2051);assert.equal(result.events.length,2117);assert.equal(result.people[0].id,id(2050));assert.equal(result.events[0].id,id(2116));
 assert.deepEqual(result.people.find(person=>person.id===id(0))?.profile,{anchors:['Captured 2051']});assert.deepEqual(result.people.find(person=>person.id===id(0))?.context,people[0].context);
 assert.ok(!result.people.some(person=>person.id==='B-only'));assert.ok(server.calls.filter(call=>call.table==='profile_reads').length>10);
});
test('a failed history page refuses the refresh instead of returning a partial or empty workspace',async()=>{
 const server=new MemoryServer();server.failReadTable='outreach_events';await assert.rejects(readRelationshipData(server.client,'A'),/Fixture read failure/);
});
test('connection pool pagination attaches the latest imported overlap fact only to explicit matching companies',async()=>{
 const fact={company:'A & B',count:3,statement:'You already know 3 people at A & B'};
 const server=new MemoryServer({connections:Array.from({length:1003},(_,n)=>({id:id(n),user_id:'A',person:'Person '+n,company:n===0?'A &amp; B':undefined,role:'Leader at A & B',context:{}})),knowledge_sources:[{id:'old',user_id:'A',source:'archive',created_at:stamp(0),facts:{companyIndex:{'a & b':{...fact,count:2,statement:'You already know 2 people at A & B'}}}},{id:'new',user_id:'A',source:'archive',created_at:stamp(1),facts:{companyIndex:{'a & b':fact}}}]});server.pageCap=100;
 const result=await readConnectionsData(server.client,'A');assert.equal(result.length,1003);assert.deepEqual(result[0].companyOverlap,fact);assert.equal(result[1].companyOverlap,null);
 assert.equal(server.calls.filter(call=>call.table==='knowledge_sources').length,1);
});
test('two simultaneous profile saves resolve to one relationship and preserve the original save facts',async()=>{
 const server=new MemoryServer();const url='https://www.linkedin.com/in/same-person/';
 const [a,b]=await Promise.all([savePersonData(server.client,'A',{person:'Person',reason:'Original reason',company:'Acme'},url),savePersonData(server.client,'A',{person:'Second name',reason:'Attempted replacement',company:'Other'},url)]);
 assert.equal(a,b);assert.equal(server.tables.outreach_log.length,1);assert.equal(server.insertAttempts,2);assert.equal(server.tables.outreach_log[0].person,'Person');assert.equal(server.tables.outreach_log[0].context.saveReason,'Original reason');assert.equal(server.tables.outreach_log[0].context.company,'Acme');
});
test('saving an existing profile returns its ID without editing its original context',async()=>{
 const server=new MemoryServer({outreach_log:[{id:'existing',user_id:'A',person:'Original',profile_url:'https://www.linkedin.com/in/existing/',context:{saveReason:'Original'}}]});
 assert.equal(await savePersonData(server.client,'A',{person:'New',reason:'New'},'https://www.linkedin.com/in/existing/'),'existing');assert.equal(server.insertAttempts,0);assert.deepEqual(server.tables.outreach_log[0].context,{saveReason:'Original'});
});
test('zero-row stage and import completion updates fail without reporting success',async()=>{
 const server=new MemoryServer({outreach_log:[{id:'person',user_id:'A',stage:'saved'}],imports:[{id:'import',user_id:'A',status:'pending',record_count:0}]});
 await assert.rejects(updateStageData(server.client,'A','missing','contacted'),/not updated/);await assert.rejects(finishImportData(server.client,'A','missing',19000),/not marked complete/);
 server.actor='B';await assert.rejects(updateStageData(server.client,'A','person','contacted'),/not updated/);await assert.rejects(finishImportData(server.client,'A','import',19000),/not marked complete/);
 assert.equal(server.tables.outreach_log[0].stage,'saved');assert.equal(server.tables.imports[0].status,'pending');
 server.actor='A';await updateStageData(server.client,'A','person','contacted');await finishImportData(server.client,'A','import',19000);assert.equal(server.tables.outreach_log[0].stage,'contacted');assert.equal(server.tables.imports[0].record_count,19000);
});
test('inbox drains beyond 100 pending items, advances past failures, and overlaps independent RPCs',async()=>{
 const items=Array.from({length:253},(_,n)=>({id:id(n),user_id:'A',profile_url:'https://www.linkedin.com/in/person-'+n+'/',consumed_at:null,fail:n<100}));
 const server=new MemoryServer({outreach_inbox:[...items,{id:'Z-other',user_id:'B',profile_url:'https://www.linkedin.com/in/other/',consumed_at:null}],outreach_log:[]});
 const result=await drainInboxData(server.client,'A');assert.deepEqual(result,{saved:153,failed:100});assert.equal(server.rpcCalls.length,253);assert.equal(new Set(server.rpcCalls).size,253);assert.ok(server.maxActiveRPC>1);assert.ok(server.maxActiveRPC<=8);
 assert.equal(server.calls.filter(call=>call.table==='outreach_log'&&call.inValues).length,3);assert.equal(server.tables.outreach_inbox.filter(row=>row.user_id==='A'&&row.consumed_at===null).length,100);assert.equal(server.tables.outreach_inbox.find(row=>row.user_id==='B')?.consumed_at,null);
 const retry=await drainInboxData(server.client,'A');assert.deepEqual(retry,{saved:0,failed:100});
});
test('inbox pagination handles a project row cap below 100 without skipping records',async()=>{
 const server=new MemoryServer({outreach_inbox:Array.from({length:145},(_,n)=>({id:id(n),user_id:'A',profile_url:'https://www.linkedin.com/in/person-'+n+'/',consumed_at:null})),outreach_log:[]});server.pageCap=37;
 assert.deepEqual(await drainInboxData(server.client,'A'),{saved:145,failed:0});assert.equal(server.calls.filter(call=>call.table==='outreach_log'&&call.inValues).length,4);
});
test('a pinned-account change halts remaining inbox work rather than draining another account',async()=>{
 const server=new MemoryServer({outreach_inbox:Array.from({length:120},(_,n)=>({id:id(n),user_id:'A',profile_url:'https://www.linkedin.com/in/person-'+n+'/',consumed_at:null})),outreach_log:[]});let checks=0;
 await assert.rejects(drainInboxData(server.client,'A',async()=>{if(++checks===3){server.actor='B';throw Error('The account changed');}}),/account changed/);
 assert.equal(server.rpcCalls.length,8);assert.ok(server.calls.filter(call=>call.table==='outreach_inbox').every(call=>call.filters.user_id==='A'));
});
test('saved search details survive without becoming a complete profile read',async()=>{
 const server=new MemoryServer();
 const saved=await savePersonData(server.client,'A',{person:'Search result',reason:'Saved from search',source:'web_search',searchHeadline:'Product lead',searchSnippet:'Boston\u0000 · Previously Acme'},'https://www.linkedin.com/in/search-result/');
 const result=await readRelationshipData(server.client,'A');
 const person=result.people.find(row=>row.id===saved)!;
 assert.equal(person.context.searchHeadline,'Product lead');assert.equal(person.context.searchSnippet,'Boston · Previously Acme');assert.equal(person.context.source,'web_search');assert.equal(person.context.profileComplete,false);assert.equal(person.profile,undefined);
});
