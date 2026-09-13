import test from 'node:test';
import assert from 'node:assert/strict';
import {readAccountSourceData} from '../src/lib/account-sources';
import {MemoryServer} from './fake-client';

test('a fresh device reads the latest processed sources for the current account without downloading source files',async()=>{
 const server=new MemoryServer({knowledge_sources:[
  {id:'1',user_id:'A',source:'resume',fingerprint:'old',created_at:'2026-01-01',facts:{text:'Old',pages:1}},
  {id:'2',user_id:'A',source:'resume',fingerprint:'new',created_at:'2026-02-01',facts:{text:'Latest\u0000 experience',pages:2}},
  {id:'3',user_id:'B',source:'resume',fingerprint:'other',created_at:'2026-03-01',facts:{text:'Private other account',pages:1}},
 ]});
 assert.deepEqual(await readAccountSourceData(server.client,'A'),{resume:{text:'Latest experience',pages:2,fingerprint:'new'}});
 assert.equal(server.calls.length,3);assert.ok(server.calls.every(c=>c.filters.user_id==='A'&&c.table==='knowledge_sources'));
});
test('cloud facts stay separate from the connection pool and cannot bring received bodies into writing samples',async()=>{
 const layer1={id:'snapshot',importedAt:'2026-09-12',fingerprint:'archive',profile:[],positions:[{Company:'Acme',Title:'Lead'}],education:[],skills:[]};
 const server=new MemoryServer({knowledge_sources:[{id:'1',user_id:'A',source:'archive',fingerprint:'archive',created_at:'2026-09-12',facts:{layer1,counts:{connections:19000},writingSamples:['Own text'],companyIndex:{},connections:[{person:'Ignored'}],receivedBodies:['Ignored']}},{id:'2',user_id:'A',source:'mailbox',fingerprint:'mail',created_at:'2026-09-12',facts:{schemaVersion:1,counts:{messages:20},globalMetrics:{bidirectionalContacts:2},writingSamples:['My reply']}}]});
 const facts=await readAccountSourceData(server.client,'A');
 assert.deepEqual(facts.archive?.layer1,layer1);assert.equal('connections' in facts.archive!,false);assert.equal('receivedBodies' in facts.archive!,false);
 assert.deepEqual(facts.mailbox?.samples,['My reply']);assert.equal('writingSamples' in facts.mailbox!.summary,false);
});
test('failed or malformed source reads refuse hydration instead of replacing local sources with emptiness',async()=>{
 const server=new MemoryServer();server.failReadTable='knowledge_sources';await assert.rejects(readAccountSourceData(server.client,'A'),/Fixture read failure/);
 server.failReadTable='';server.tables.knowledge_sources=[{id:'1',user_id:'A',source:'resume',fingerprint:'bad',facts:{text:34,pages:1}}];
 await assert.rejects(readAccountSourceData(server.client,'A'),/saved resume could not be read/);
});
