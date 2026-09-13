import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';import {fileURLToPath} from 'node:url';
import {buildSavedPersonEvidence} from '../src/lib/person-evidence';
import {readRelationshipData} from '../src/lib/data-access';
import {MemoryServer} from './fake-client';
const MIGRATIONS_ROOT=process.env.MIGRATIONS_ROOT ?? fileURLToPath(new URL('../supabase/migrations/',import.meta.url));
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',P='33333333-3333-4333-8333-333333333333';
test('all migrations apply and database security/budgets enforce the brief',async t=>{
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;grant usage on schema storage to authenticated;grant all on storage.objects to authenticated;`);
 for(const name of ['001_schema.sql','002_ai.sql','003_quota.sql','004_modules.sql','005_settings.sql'])await db.exec(await readFile(MIGRATIONS_ROOT+'/'+name,'utf8'));
 await db.exec(`insert into auth.users values('${A}'),('${B}');insert into public.users(user_id) values('${A}'),('${B}');insert into public.settings(user_id) values('${A}'),('${B}');insert into public.ai_user_limits(user_id) values('${A}'),('${B}');insert into public.outreach_log(id,user_id,person) values('${P}','${B}','Isolated test record');update public.ai_config set enabled=true;`);
 await t.test('every table has RLS; anonymous reads empty and writes return 42501',async()=>{const r=await db.query<any>(`select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;`);assert.equal(r.rows.length,0);await db.exec('set role anon');assert.equal((await db.query('select * from public.outreach_log')).rows.length,0);await assert.rejects(db.query(`insert into public.outreach_log(user_id,person) values('${A}','refused')`),(e:any)=>e.code==='42501');await db.exec('reset role');});
 await t.test('cross-account reads/writes/references and entitlement changes fail',async()=>{await db.exec(`set role authenticated;set request.jwt.claim.sub='${A}';`);assert.equal((await db.query('select * from public.outreach_log')).rows.length,0);await assert.rejects(db.query(`insert into public.outreach_log(user_id,person) values('${B}','refused')`),(e:any)=>e.code==='42501');await assert.rejects(db.query(`insert into public.outreach_events(user_id,relationship_id,kind,body) values('${A}','${P}','note','refused')`),(e:any)=>e.code==='23503');await assert.rejects(db.query(`update public.users set account_status='active'`),(e:any)=>e.code==='42501');await assert.rejects(db.query(`update public.settings set plan_caps='{"unlimited":true}'`),(e:any)=>e.code==='42501');await db.exec('reset role');});
 await t.test('private archive paths are isolated and no bucket is public',async()=>{await db.exec(`insert into storage.objects(bucket_id,name) values('archives','${B}/archive.zip');set role authenticated;set request.jwt.claim.sub='${A}';`);assert.equal((await db.query('select * from storage.objects')).rows.length,0);await assert.rejects(db.query(`insert into storage.objects(bucket_id,name) values('archives','${B}/other.zip')`),(e:any)=>e.code==='42501');await db.exec(`insert into storage.objects(bucket_id,name) values('archives','${A}/own.zip');reset role;`);assert.equal((await db.query<any>('select public from storage.buckets')).rows[0].public,false);});
 await t.test('fact history is immutable and kept promises must reference promises',async()=>{await db.exec(`insert into public.outreach_events(user_id,relationship_id,kind,body) values('${B}','${P}','note','A test-only note');`);await assert.rejects(db.exec('update public.outreach_events set body=\'changed\''),(e:any)=>e.code==='42501');await assert.rejects(db.exec('delete from public.outreach_events'),(e:any)=>e.code==='42501');await assert.rejects(db.exec(`insert into public.outreach_events(user_id,relationship_id,kind,related_event_id) select user_id,relationship_id,'promise_kept',id from public.outreach_events`),(e:any)=>e.code==='23514');});
 await t.test('AI configuration and privileged functions remain service-only',async()=>{await db.exec('set role anon');await assert.rejects(db.query('select * from public.ai_config'),(e:any)=>e.code==='42501');await assert.rejects(db.query(`select public.ai_precheck('${A}','profile_briefing')`),(e:any)=>e.code==='42501');await db.exec('reset role');const r=await db.query<any>(`select has_function_privilege('service_role','public.ai_reserve_call(text,uuid,uuid,integer)','execute') as allowed`);assert.equal(r.rows[0].allowed,true);});
 await t.test('pending calls consume daily cap; a duplicate cannot dispatch twice',async()=>{await db.exec(`update public.ai_user_limits set daily_cap=1 where user_id='${A}';`);const id=crypto.randomUUID();await db.query(`select public.ai_reserve_call('profile_fit','${A}','${id}')`);await assert.rejects(db.query(`select public.ai_reserve_call('profile_fit','${A}','${id}')`),(e:any)=>e.code==='23505');await assert.rejects(db.query(`select public.ai_reserve_call('profile_fit','${A}')`),/Daily Assist limit/);await db.query(`select public.ai_release_call('${id}')`);assert.equal((await db.query('select * from public.ai_call_log')).rows.length,0);await db.exec(`update public.ai_user_limits set daily_cap=20`);});
 await t.test('monthly and project-wide dollar budgets include pending reservations',async()=>{await db.exec(`update public.ai_user_limits set monthly_usd_ceiling=0 where user_id='${A}';`);await assert.rejects(db.query(`select public.ai_reserve_call('profile_briefing','${A}')`),/Monthly cost ceiling/);await db.exec(`update public.ai_user_limits set monthly_usd_ceiling=5;update public.ai_company_budget set daily_usd_ceiling=0;`);await assert.rejects(db.query(`select public.ai_reserve_call('profile_briefing','${A}')`),/Daily company budget/);await db.exec('update public.ai_company_budget set daily_usd_ceiling=10');});
 await t.test('real usage rates confirm once and uncertain dispatch is never refunded',async()=>{const id=crypto.randomUUID();await db.query(`select public.ai_reserve_call('profile_briefing','${A}','${id}')`);await db.exec(`update public.ai_call_log set dispatched_at=now() where id='${id}'`);assert.equal((await db.query<any>(`select public.ai_release_call('${id}') as released`)).rows[0].released,false);await assert.rejects(db.query(`select public.ai_confirm_call('${id}',1000,400,0)`),/Cost does not match/);assert.equal((await db.query<any>(`select public.ai_confirm_call('${id}',1000,400,0.00525) as ok`)).rows[0].ok,true);assert.equal((await db.query<any>(`select public.ai_confirm_call('${id}',1000,400,0.00525) as ok`)).rows[0].ok,false);const r=(await db.query<any>('select pending,tokens_in,tokens_out,cost_usd from public.ai_call_log')).rows[0];assert.equal(r.pending,false);assert.equal(Number(r.cost_usd),.00525);});
 await t.test('flat search cap admits exactly three and refuses the fourth',async()=>{await db.exec('update public.people_search_config set daily_cap=3');const r=[];for(let i=0;i<4;i++)r.push((await db.query<any>('select public.claim_people_search() as result')).rows[0].result);assert.deepEqual(r.map(x=>x.allowed),[true,true,true,false]);assert.deepEqual(r.map(x=>x.remaining),[2,1,0,0]);});
 await t.test('lapsed accounts keep records and cannot mutate them',async()=>{await db.exec(`update public.users set account_status='lapsed' where user_id='${B}';set role authenticated;set request.jwt.claim.sub='${B}';`);assert.equal((await db.query('select * from public.outreach_log')).rows.length,1);await assert.rejects(db.query(`insert into public.outreach_events(user_id,relationship_id,kind,body) values('${B}','${P}','note','refused')`),(e:any)=>e.code==='42501');await db.exec('reset role');});

 await moduleAssertions(db,t);
 await settingsAssertions(db,t);
 await db.close();
});

// Appended module coverage; apply 001-004 in the same Supabase-compatible PGlite database.
async function moduleAssertions(db: PGlite, t: import('node:test').TestContext) {
 const C='44444444-4444-4444-8444-444444444444';
 await db.exec(`insert into auth.users values('${C}');insert into public.users(user_id) values('${C}');insert into public.ai_user_limits(user_id,daily_cap,daily_call_cap) values('${C}',0,2);`);
 const asUser = async<T>(userId:string, operation:()=>Promise<T>):Promise<T> => {
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${userId}';`);
  try{return await operation();}finally{await db.exec('reset role;reset request.jwt.claim.sub;');}
 };
 const asService = async<T>(operation:()=>Promise<T>):Promise<T> => {
  await db.exec('set role service_role;');
  try{return await operation();}finally{await db.exec('reset role;');}
 };
 const refused42501=(e:any)=>e.code==='42501';
 let firstCall='';
 await t.test('free profile_briefing still reserves a real cost and two calls exhaust the daily model guard',async()=>{
  const config=(await db.query<any>(`select weight,max_tokens,max_prompt_bytes from public.ai_config where feature='profile_briefing'`)).rows[0];
  assert.deepEqual(config,{weight:0,max_tokens:4096,max_prompt_bytes:48000});
  await asService(async()=>{
   const one=(await db.query<any>(`select public.ai_reserve_call('profile_briefing',$1) as result`,[C])).rows[0].result;
   const two=(await db.query<any>(`select public.ai_reserve_call('profile_briefing',$1) as result`,[C])).rows[0].result;
   firstCall=one.id;assert.equal(one.remaining,0);assert.equal(two.remaining,0);assert.ok(Number(one.reserved_usd)>0);
   assert.equal((await db.query<any>(`select public.ai_confirm_call($1,100,10,0.000225) as confirmed`,[one.id])).rows[0].confirmed,true);
   await assert.rejects(db.query(`select public.ai_reserve_call('profile_briefing',$1)`,[C]),/Daily model call limit reached/);
   // A definitive no-charge failure frees its slot; a confirmed model call remains counted.
   assert.equal((await db.query<any>(`select public.ai_release_call($1) as released`,[two.id])).rows[0].released,true);
   const replacement=(await db.query<any>(`select public.ai_reserve_call('profile_briefing',$1) as result`,[C])).rows[0].result;
   assert.ok(replacement.id);await assert.rejects(db.query(`select public.ai_reserve_call('profile_briefing',$1)`,[C]),/Daily model call limit reached/);
  });
  const rows=(await db.query<any>(`select pending,weight,cost_usd from public.ai_call_log where user_id=$1 order by pending`,[C])).rows;
  assert.equal(rows.length,2);assert.equal(rows[0].pending,false);assert.equal(Number(rows[0].cost_usd),.000225);assert.equal(rows[0].weight,0);assert.equal(rows[1].pending,true);
 });
 await t.test('cache-hit logs are exempt, yesterday does not consume today, and a zero model cap refuses free calls',async()=>{
  await asService(async()=>{
   await db.query(`insert into public.ai_call_log(user_id,feature,reserved_usd,weight,model,input_rate,cached_input_rate,output_rate,cache_write_rate,fixed_cost_usd,max_tokens,cache_hit,pending) select user_id,feature,0,0,model,input_rate,cached_input_rate,output_rate,cache_write_rate,fixed_cost_usd,max_tokens,true,false from public.ai_call_log where id=$1`,[firstCall]);
   await assert.rejects(db.query(`select public.ai_reserve_call('profile_briefing',$1)`,[C]),/Daily model call limit reached/);
   await db.query(`update public.ai_call_log set created_at=(date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')-interval '1 second' where id=$1`,[firstCall]);
   assert.ok((await db.query<any>(`select public.ai_reserve_call('profile_briefing',$1) as result`,[C])).rows[0].result.id);
   await db.query('update public.ai_user_limits set daily_call_cap=0 where user_id=$1',[C]);
   await assert.rejects(db.query(`select public.ai_reserve_call('profile_briefing',$1)`,[C]),/Daily model call limit reached/);
  });
 });
 await t.test('client roles cannot change model call limits or execute the privileged trigger helper',async()=>{
  const permissions=(await db.query<any>(`select has_function_privilege('anon','public.enforce_daily_model_calls()','execute') as anon,has_function_privilege('authenticated','public.enforce_daily_model_calls()','execute') as authenticated,has_function_privilege('service_role','public.enforce_daily_model_calls()','execute') as service`)).rows[0];
  assert.deepEqual(permissions,{anon:false,authenticated:false,service:true});
  await asUser(A,()=>assert.rejects(db.query('update public.ai_user_limits set daily_call_cap=10000'),refused42501));
 });
 const URL='https://www.linkedin.com/in/module-person/';
 const search={name:'Module Person',headline:'Product leader',profileComplete:false};
 const full={name:'Module Person',headline:'Product leader',career:[{company:'Acme',title:'Director',dates:'2022–present'}],education:[{school:'MIT',degree:'MSc'}],location:'Boston',skills:['Product strategy'],languages:['English','Spanish'],certifications:['Product management'],timingSignals:{recentPosts:[{text:'Launched a product',observedAt:'2026-09-10'}],recentRoleChange:{company:'Acme',started:'2026-08'}},anchors:[{field:'career',text:'Director at Acme'}],profileComplete:true};
 const newest={...full,skills:['Product strategy','Hiring'],timingSignals:{...full.timingSignals,recentPosts:[{text:'Hiring product managers',observedAt:'2026-09-12'}]}};
 let searchInbox='',fullInbox='',rid='',sourceId='';
 async function enqueue(snapshot:unknown,observedAt:string|null,url=URL){
  const id=crypto.randomUUID();
  await db.query(`insert into public.outreach_inbox(id,user_id,operation_id,profile_url,person,snapshot,profile_read_at) values($1,$2,$3,$4,'Module Person',$5::jsonb,$6)`,[id,A,crypto.randomUUID(),url,JSON.stringify(snapshot),observedAt]);return id;
 }
 async function consume(id:string){return (await db.query<any>('select public.consume_inbox($1) as id',[id])).rows[0].id as string;}
 await t.test('current extension snapshot stays complete through inbox SQL, account reading and person assessment',async()=>{
  await asUser(A,async()=>{
   const url='https://www.linkedin.com/in/current-contract-fixture/',at='2026-09-12T13:00:00Z';
   const snapshot={name:'Module Person',profileUrl:url,profileReadAt:at,truncated:false,truncationReasons:[],anchors:[
    {kind:'headline',text:'Exploring AI leadership roles',sourceUrl:url,observedAt:at},
    {kind:'about',text:'Led an explicitly recorded product programme.',sourceUrl:url,observedAt:at},
    {kind:'education',text:'Fixture University',sourceUrl:url,observedAt:at},
    {kind:'timing',text:'Recent activity: September 2026',sourceUrl:url,observedAt:at}]};
   const inbox=await enqueue(snapshot,at,url),relationship=await consume(inbox);
   const people=(await db.query<any>('select * from public.outreach_log where id=$1',[relationship])).rows;
   const reads=(await db.query<any>('select * from public.profile_reads where relationship_id=$1',[relationship])).rows;
   const server=new MemoryServer({outreach_log:people,profile_reads:reads});server.actor=A;
   const loaded=(await readRelationshipData(server.client,A)).people[0];
   assert.deepEqual(loaded.profile,snapshot);
   const evidence=buildSavedPersonEvidence(loaded);
   assert.equal(evidence.completeProfile,true);assert.equal(evidence.profileReadAt,at);
   assert.deepEqual(evidence.claims.filter(c=>c.sourceKind==='profile').map(c=>c.text),snapshot.anchors.map(a=>a.text));
  });
 });
 await t.test('inbox consumption is idempotent and incomplete search saves create no fake profile read',async()=>{
  await asUser(A,async()=>{
   searchInbox=await enqueue(search,null);rid=await consume(searchInbox);
   const before=(await db.query<any>('select consumed_at,relationship_id from public.outreach_inbox where id=$1',[searchInbox])).rows[0];
   assert.equal(await consume(searchInbox),rid);
   assert.deepEqual((await db.query<any>('select consumed_at,relationship_id from public.outreach_inbox where id=$1',[searchInbox])).rows[0],before);
   assert.equal((await db.query('select * from public.outreach_log where profile_url=$1',[URL])).rows.length,1);
   assert.equal((await db.query('select * from public.profile_reads where relationship_id=$1',[rid])).rows.length,0);
   const context=(await db.query<any>('select context from public.outreach_log where id=$1',[rid])).rows[0].context;
   assert.equal(context.profileComplete,false);assert.deepEqual(context.profile,search);
  });
 });
 await t.test('complete anchors are appended intact, retries do not duplicate reads, and original save context stays immutable',async()=>{
  await asUser(A,async()=>{
   fullInbox=await enqueue(full,'2026-09-11T12:00:00Z');assert.equal(await consume(fullInbox),rid);assert.equal(await consume(fullInbox),rid);
   const reads=(await db.query<any>('select snapshot,observed_at,inbox_id from public.profile_reads where relationship_id=$1',[rid])).rows;
   assert.equal(reads.length,1);assert.deepEqual(reads[0].snapshot,full);assert.equal(reads[0].inbox_id,fullInbox);
   const context=(await db.query<any>('select context from public.outreach_log where id=$1',[rid])).rows[0].context;
   assert.deepEqual(context.profile,search);assert.equal(context.profileComplete,false);
   // The app must prefer profile_reads: a complete read exists although the original save was incomplete.
  });
 });
 await t.test('later incomplete saves cannot discard complete anchors and latest-read queries use observed time',async()=>{
  await asUser(A,async()=>{
   const latest=await enqueue(newest,'2026-09-12T12:00:00Z');assert.equal(await consume(latest),rid);
   const oldArrivingLate=await enqueue(full,'2026-09-10T12:00:00Z');assert.equal(await consume(oldArrivingLate),rid);
   const incomplete=await enqueue({name:'Module Person',headline:'New search snippet'},null);assert.equal(await consume(incomplete),rid);
   const reads=(await db.query<any>('select snapshot,inbox_id from public.profile_reads where relationship_id=$1 order by observed_at desc,created_at desc,id desc',[rid])).rows;
   assert.equal(reads.length,3);assert.deepEqual(reads[0].snapshot,newest);assert.deepEqual(reads[1].snapshot,full);assert.deepEqual(reads[2].snapshot,full);
  });
 });
 await t.test('complete first saves preserve all parsed fields in both original context and immutable profile read',async()=>{
  await asUser(A,async()=>{
   const item=await enqueue(full,'2026-09-12T12:00:00Z','https://www.linkedin.com/in/complete-first/');const relationship=await consume(item);
   const context=(await db.query<any>('select context from public.outreach_log where id=$1',[relationship])).rows[0].context;
   assert.equal(context.profileComplete,true);assert.deepEqual(context.profile,full);
   assert.deepEqual((await db.query<any>('select snapshot from public.profile_reads where inbox_id=$1',[item])).rows[0].snapshot,full);
  });
 });
 await t.test('extension operation IDs deduplicate submissions and canonical URL checks reject malformed data',async()=>{
  await asUser(A,async()=>{
   const operation=crypto.randomUUID();
   await db.query(`insert into public.outreach_inbox(user_id,operation_id,profile_url,person,snapshot) values($1,$2,$3,'Operation test','{}')`,[A,operation,'https://www.linkedin.com/in/operation-test/']);
   await assert.rejects(db.query(`insert into public.outreach_inbox(user_id,operation_id,profile_url,person,snapshot) values($1,$2,$3,'Duplicate','{}')`,[A,operation,'https://www.linkedin.com/in/operation-test/']),(e:any)=>e.code==='23505');
   await assert.rejects(db.query(`insert into public.outreach_inbox(user_id,operation_id,profile_url,person,snapshot) values($1,$2,'https://example.com/person','Malformed','{}')`,[A,crypto.randomUUID()]),(e:any)=>e.code==='23514');
  });
 });
 await t.test('knowledge sources deduplicate by owner/source/fingerprint, and raw facts plus profile reads cannot be rewritten',async()=>{
  const fingerprint='a'.repeat(64);
  await asUser(A,async()=>{
   const params=[A,fingerprint,JSON.stringify({positions:[{title:'Director',company:'Acme'}]})];
   sourceId=(await db.query<any>(`insert into public.knowledge_sources(user_id,source,fingerprint,facts) values($1,'archive',$2,$3::jsonb) returning id`,params)).rows[0].id;
   await assert.rejects(db.query(`insert into public.knowledge_sources(user_id,source,fingerprint,facts) values($1,'archive',$2,$3::jsonb)`,params),(e:any)=>e.code==='23505');
   await assert.rejects(db.query(`update public.knowledge_sources set facts='{}' where id=$1`,[sourceId]),refused42501);
   await assert.rejects(db.query(`delete from public.profile_reads where relationship_id=$1`,[rid]),refused42501);
  });
  await assert.rejects(db.query(`update public.knowledge_sources set facts='{}' where id=$1`,[sourceId]),refused42501);
  await assert.rejects(db.query(`delete from public.knowledge_sources where id=$1`,[sourceId]),refused42501);
  await assert.rejects(db.query(`update public.profile_reads set snapshot='{}' where relationship_id=$1`,[rid]),refused42501);
  await assert.rejects(db.query(`delete from public.profile_reads where relationship_id=$1`,[rid]),refused42501);
 });
 await t.test('new tables return no anonymous rows and refuse anonymous writes/RPC access with 42501',async()=>{
  await db.exec('set role anon;');
  try{
   for(const table of ['knowledge_sources','outreach_inbox','profile_reads'])assert.equal((await db.query(`select * from public.${table}`)).rows.length,0);
   await assert.rejects(db.query(`insert into public.knowledge_sources(user_id,source,fingerprint,facts) values($1,'resume',$2,'{}')`,[A,'b'.repeat(64)]),refused42501);
   await assert.rejects(db.query(`insert into public.outreach_inbox(user_id,operation_id,profile_url,person,snapshot) values($1,$2,$3,'Anonymous','{}')`,[A,crypto.randomUUID(),URL]),refused42501);
   await assert.rejects(db.query('select public.consume_inbox($1)',[fullInbox]),refused42501);
  }finally{await db.exec('reset role;');}
 });
 await t.test('cross-user reads, new rows, consumption and relationship references are refused',async()=>{
  const otherRelationship=crypto.randomUUID();
  await db.query(`insert into public.outreach_log(id,user_id,person,profile_url) values($1,$2,'Other account','https://www.linkedin.com/in/other-account/')`,[otherRelationship,C]);
  await asUser(C,async()=>{
   for(const table of ['knowledge_sources','outreach_inbox','profile_reads'])assert.equal((await db.query(`select * from public.${table}`)).rows.length,0);
   await assert.rejects(db.query('select public.consume_inbox($1)',[fullInbox]),refused42501);
   await assert.rejects(db.query(`insert into public.knowledge_sources(user_id,source,fingerprint,facts) values($1,'resume',$2,'{}')`,[A,'b'.repeat(64)]),refused42501);
   await assert.rejects(db.query(`insert into public.outreach_inbox(user_id,operation_id,profile_url,person,snapshot) values($1,$2,$3,'Wrong owner','{}')`,[A,crypto.randomUUID(),URL]),refused42501);
   await assert.rejects(db.query(`insert into public.profile_reads(user_id,relationship_id,inbox_id,snapshot,observed_at) values($1,$2,$3,'{}',now())`,[C,otherRelationship,fullInbox]),refused42501);
   const changed=(await db.query('update public.outreach_inbox set consumed_at=null where id=$1 returning id',[fullInbox])).rows;assert.equal(changed.length,0);
  });
  await asUser(A,()=>assert.rejects(db.query('update public.outreach_inbox set relationship_id=$1 where id=$2',[otherRelationship,searchInbox]),(e:any)=>e.code==='23503'));
 });
 await t.test('archive connection inserts require an active owned archive import, with cross-user and mailbox imports refused',async()=>{
  let ownImport='',mailboxImport='';const foreignImport=crypto.randomUUID();
  await db.query(`insert into public.imports(id,user_id,kind) values($1,$2,'linkedin_archive')`,[foreignImport,C]);
  await asUser(A,async()=>{
   ownImport=(await db.query<any>(`insert into public.imports(user_id,kind) values($1,'linkedin_archive') returning id`,[A])).rows[0].id;
   mailboxImport=(await db.query<any>(`insert into public.imports(user_id,kind) values($1,'mailbox') returning id`,[A])).rows[0].id;
   await db.query(`insert into public.connections(user_id,import_id,person,profile_url) values($1,$2,'Archive Person','https://www.linkedin.com/in/archive-test/')`,[A,ownImport]);
   await assert.rejects(db.query(`insert into public.connections(user_id,import_id,person) values($1,$2,'Wrong import')`,[A,foreignImport]),refused42501);
   await assert.rejects(db.query(`insert into public.connections(user_id,import_id,person) values($1,$2,'Mailbox import')`,[A,mailboxImport]),refused42501);
   await db.query(`update public.imports set status='completed',record_count=1 where id=$1`,[ownImport]);
   assert.equal((await db.query<any>('select status,record_count from public.imports where id=$1',[ownImport])).rows[0].record_count,1);
  });
 });
 await t.test('bulk connection RPC accepts owned imports and retries by stable ID or profile URL without rewriting facts',async()=>{
  await asUser(A,async()=>{
   const importId=(await db.query<any>(`insert into public.imports(user_id,kind) values($1,'linkedin_archive') returning id`,[A])).rows[0].id;
   const row={id:crypto.randomUUID(),user_id:A,import_id:importId,person:'Bulk Person',profile_url:'https://www.linkedin.com/in/bulk-test/',company:'Original Co',role:'Original role',context:{connectedOn:'2020-01-01',evidence:'Original archive fact'}};
   const call=async(rows:unknown)=>(await db.query<any>('select public.import_connections($1::jsonb) as count',[JSON.stringify(rows)])).rows[0].count;
   assert.equal(await call([row]),1);assert.equal(await call([row]),0);
   assert.equal(await call([{...row,company:'Attempted rewrite'}]),0);
   assert.equal(await call([{...row,id:crypto.randomUUID(),company:'Different ID same URL'}]),0);
   const saved=(await db.query<any>('select person,company,role,context,import_id from public.connections where id=$1',[row.id])).rows[0];
   assert.deepEqual(saved,{person:row.person,company:row.company,role:row.role,context:row.context,import_id:importId});
   const missingUrl={...row,id:crypto.randomUUID(),profile_url:null,person:'No URL'};
   assert.equal(await call([missingUrl]),1);assert.equal(await call([missingUrl]),0);assert.equal(await call([]),0);
  });
 });
 await t.test('bulk connection RPC rejects wrong-user or mixed-owner batches atomically and enforces size/type bounds',async()=>{
  const foreignImport=(await db.query<any>(`insert into public.imports(user_id,kind) values($1,'linkedin_archive') returning id`,[C])).rows[0].id;
  await asUser(A,async()=>{
   const importId=(await db.query<any>(`insert into public.imports(user_id,kind) values($1,'linkedin_archive') returning id`,[A])).rows[0].id;
   const own={id:crypto.randomUUID(),user_id:A,import_id:importId,person:'Atomic own row',profile_url:null,company:'Co',role:'Role',context:{}};
   const wrong={...own,id:crypto.randomUUID(),user_id:C,import_id:foreignImport};
   const call=(rows:unknown)=>db.query('select public.import_connections($1::jsonb)',[JSON.stringify(rows)]);
   await assert.rejects(call([wrong]),refused42501);await assert.rejects(call([own,wrong]),refused42501);
   assert.equal((await db.query('select id from public.connections where id=$1',[own.id])).rows.length,0);
   await assert.rejects(call([{...own,import_id:foreignImport}]),refused42501);
   await assert.rejects(call(Array.from({length:501},()=>own)),(e:any)=>e.code==='22023');
   await assert.rejects(call({...own}),(e:any)=>e.code==='22023');
   await assert.rejects(call([{...own,context:{large:'x'.repeat(2097152)}}]),(e:any)=>e.code==='22023');
  });
  await db.exec('set role anon;');try{await assert.rejects(db.query(`select public.import_connections('[]'::jsonb)`),refused42501);}finally{await db.exec('reset role;');}
 });
 await t.test('lapsed accounts retain module reads while new imports, inbox consumption and knowledge writes are blocked',async()=>{
  let pending='';await asUser(A,async()=>{pending=await enqueue(full,'2026-09-12T13:00:00Z','https://www.linkedin.com/in/lapse-test/');});
  await db.query(`update public.users set account_status='lapsed' where user_id=$1`,[A]);
  await asUser(A,async()=>{
   assert.ok((await db.query('select * from public.profile_reads')).rows.length>0);
   assert.ok((await db.query('select * from public.knowledge_sources')).rows.length>0);
   await assert.rejects(db.query('select public.consume_inbox($1)',[pending]),refused42501);
   await assert.rejects(db.query(`insert into public.knowledge_sources(user_id,source,fingerprint,facts) values($1,'resume',$2,'{}')`,[A,'c'.repeat(64)]),refused42501);
   await assert.rejects(db.query(`insert into public.imports(user_id,kind) values($1,'linkedin_archive')`,[A]),refused42501);
  });
  await db.query(`update public.users set account_status='active' where user_id=$1`,[A]);
 });
}

async function settingsAssertions(db:PGlite,t:import('node:test').TestContext){
 const C='44444444-4444-4444-8444-444444444444';
 const refused42501=(e:any)=>e.code==='42501';
 const asUser=async<T>(userId:string,operation:()=>Promise<T>):Promise<T>=>{
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${userId}';`);
  try{return await operation();}finally{await db.exec('reset role;reset request.jwt.claim.sub;');}
 };
 const patch=async(userId:string,value:unknown)=>(await db.query<any>('select public.patch_settings($1,$2::jsonb) as data',[userId,JSON.stringify(value)])).rows[0].data;
 const read=async(userId:string)=>(await db.query<any>('select data from public.settings where user_id=$1',[userId])).rows[0]?.data;
 const assets=[{name:'resume.pdf',path:`${A}/resume.pdf`,parsed:true},{name:'archive.zip',path:`${A}/archive.zip`,parsed:true}];
 const knowledge={fingerprint:'a'.repeat(64),source:'original',proofPoints:['Led 15 engineers']};
 const initial={strategy:'Original goal',knowledge,assets,voice:{samples:['My own writing.']}};
 await db.query('update public.settings set data=$2::jsonb where user_id=$1',[A,JSON.stringify(initial)]);
 await t.test('005 preserves schema grants and makes people search free without changing its project quota',async()=>{
  const grants=(await db.query<any>(`select has_function_privilege('anon','public.patch_settings(uuid,jsonb)','execute') as anon,has_function_privilege('authenticated','public.patch_settings(uuid,jsonb)','execute') as authenticated,has_function_privilege('service_role','public.patch_settings(uuid,jsonb)','execute') as service`)).rows[0];
  assert.deepEqual(grants,{anon:false,authenticated:true,service:true});
  assert.equal((await db.query<any>(`select weight from public.ai_config where feature='people_search'`)).rows[0].weight,0);
  assert.equal((await db.query<any>('select daily_cap from public.people_search_config')).rows[0].daily_cap,3);
 });
 await t.test('strategy-only patch atomically preserves existing knowledge, assets and voice',async()=>{
  await asUser(A,async()=>{
   const result=await patch(A,{strategy:'Meet product leaders in Boston'});
   assert.deepEqual(result,{...initial,strategy:'Meet product leaders in Boston'});
   assert.deepEqual(await read(A),result);
  });
 });
 await t.test('knowledge-only and repeated patches preserve the current strategy and all uploaded asset references',async()=>{
  await asUser(A,async()=>{
   const nextKnowledge={fingerprint:'b'.repeat(64),proofPoints:['Led 15 engineers','Shipped 8 products']};
   const one=await patch(A,{knowledge:nextKnowledge});
   assert.equal(one.strategy,'Meet product leaders in Boston');assert.deepEqual(one.assets,assets);assert.deepEqual(one.voice,initial.voice);assert.deepEqual(one.knowledge,nextKnowledge);
   const two=await patch(A,{knowledge:nextKnowledge});assert.deepEqual(two,one);assert.deepEqual(await read(A),one);
   assert.deepEqual(await patch(A,{}),one);
   assert.equal((await db.query('select user_id from public.settings where user_id=$1',[A])).rows.length,1);
  });
 });
 await t.test('separate goal and asset patches accumulate without replacing unrelated top-level fields',async()=>{
  await asUser(A,async()=>{
   const before=await read(A);const newAssets=[...assets,{name:'new-resume.pdf',path:`${A}/new-resume.pdf`,parsed:true}];
   await patch(A,{strategy:'Explore healthcare partnerships'});const after=await patch(A,{assets:newAssets});
   assert.equal(after.strategy,'Explore healthcare partnerships');assert.deepEqual(after.assets,newAssets);assert.deepEqual(after.knowledge,before.knowledge);assert.deepEqual(after.voice,before.voice);
  });
 });
 await t.test('first settings patch creates one row for a provisioned user without existing settings',async()=>{
  assert.equal(await read(C),undefined);
  await asUser(C,async()=>{
   assert.deepEqual(await patch(C,{strategy:'My first goal'}),{strategy:'My first goal'});
   assert.deepEqual(await patch(C,{assets:[]}),{strategy:'My first goal',assets:[]});
   assert.deepEqual(await patch(C,{knowledge:{rawFacts:['Original fact']}}),{strategy:'My first goal',assets:[],knowledge:{rawFacts:['Original fact']}});
   assert.equal((await db.query('select user_id from public.settings where user_id=$1',[C])).rows.length,1);
  });
 });
 await t.test('unknown keys, non-object patches and merged data over the byte limit refuse without altering saved settings',async()=>{
  await asUser(A,async()=>{
   const before=await read(A);
   for(const value of[null,[],['strategy'],'text',5,true])await assert.rejects(patch(A,value),(e:any)=>e.code==='22023');
   await assert.rejects(db.query('select public.patch_settings($1,null)',[A]),(e:any)=>e.code==='22023');
   for(const key of['plan_caps','user_id','account_status','unrecognized'])await assert.rejects(patch(A,{[key]:'refused'}),(e:any)=>e.code==='23514');
   await assert.rejects(patch(A,{knowledge:{large:'医'.repeat(50_000)}}),(e:any)=>e.code==='23514');
   assert.deepEqual(await read(A),before);
  });
 });
 await t.test('cross-user and absent-session settings patches fail with 42501 before any row changes',async()=>{
  const beforeA=await read(A),beforeB=await read(B);
  await asUser(A,async()=>{
   await assert.rejects(patch(B,{strategy:'Wrong account'}),refused42501);
   await assert.rejects(db.query('select public.patch_settings(null,$1::jsonb)',[JSON.stringify({strategy:'No owner'})]),refused42501);
   await assert.rejects(db.query('select public.patch_settings($1,$2::jsonb)',[B,JSON.stringify(['bad patch'])]),refused42501);
  });
  await db.exec('set role authenticated;reset request.jwt.claim.sub;');
  try{await assert.rejects(patch(A,{strategy:'No session'}),refused42501);}finally{await db.exec('reset role;');}
  assert.deepEqual(await read(A),beforeA);assert.deepEqual(await read(B),beforeB);
 });
 await t.test('anonymous callers cannot patch settings even with a forged local claim',async()=>{
  const before=await read(A);await db.exec(`set role anon;set request.jwt.claim.sub='${A}';`);
  try{await assert.rejects(patch(A,{strategy:'Anonymous overwrite'}),refused42501);}finally{await db.exec('reset role;reset request.jwt.claim.sub;');}
  assert.deepEqual(await read(A),before);
 });
 await t.test('lapsed account patches are refused with 42501 and existing goals, knowledge and files remain readable',async()=>{
  const before=await read(A);await db.query(`update public.users set account_status='lapsed' where user_id=$1`,[A]);
  try{
   await asUser(A,async()=>{await assert.rejects(patch(A,{strategy:'Overwrite after lapse'}),refused42501);assert.deepEqual(await read(A),before);});
  }finally{await db.query(`update public.users set account_status='active' where user_id=$1`,[A]);}
 });
 await t.test('immutable history tables refuse TRUNCATE for owner and service role and retain all rows',async()=>{
  for(const table of['outreach_events','knowledge_sources','profile_reads']){
   const before=Number((await db.query<any>(`select count(*) as count from public.${table}`)).rows[0].count);assert.ok(before>0);
   await assert.rejects(db.exec(`truncate table public.${table}`),refused42501);
   await db.exec('set role service_role;');try{await assert.rejects(db.exec(`truncate table public.${table}`),refused42501);}finally{await db.exec('reset role;');}
   assert.equal(Number((await db.query<any>(`select count(*) as count from public.${table}`)).rows[0].count),before);
  }
 });
}
