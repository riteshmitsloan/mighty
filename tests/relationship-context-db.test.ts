import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
import {createGoal} from '../src/lib/goals';
const root=process.env.MIGRATIONS_ROOT??fileURLToPath(new URL('../supabase/migrations/',import.meta.url));
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',P='33333333-3333-4333-8333-333333333333',Q='44444444-4444-4444-8444-444444444444';
const code=(expected:string)=>(e:unknown)=>(e as {code?:string}).code===expected;
test('relationship context migrations and RPCs preserve evidence, context and ownership',async t=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;grant usage on schema storage to authenticated;grant all on storage.objects to authenticated;`);
  for(const name of ['001_schema.sql','002_ai.sql','003_quota.sql','004_modules.sql','005_settings.sql','006_gemini_thinking.sql','007_goals.sql'])await db.exec(await readFile(root+'/'+name,'utf8'));
  await db.exec(`insert into auth.users values('${A}'),('${B}');insert into public.users(user_id) values('${A}'),('${B}');insert into public.outreach_log(id,user_id,person) values('${P}','${A}','Synthetic record A'),('${Q}','${B}','Synthetic record B');insert into public.outreach_events(user_id,relationship_id,kind,body) values('${A}','${P}','note','Legacy test note');`);
  await db.exec(await readFile(root+'/008_relationship_context.sql','utf8')).catch((error:any)=>{throw new Error(JSON.stringify({message:error.message,position:error.position,internalPosition:error.internalPosition,context:error.where,internalQuery:error.internalQuery}));});
  const asUser=async<T>(uid:string,operation:()=>Promise<T>)=>{await db.exec(`set role authenticated;set request.jwt.claim.sub='${uid}';`);try{return await operation();}finally{await db.exec('reset role;reset request.jwt.claim.sub');}};
  const rpc=async(name:string,uid:string,input:unknown,revision?:number)=>{
   const query=revision===undefined?`select public.${name}($1,$2::jsonb) as result`:`select public.${name}($1,$2::jsonb,$3) as result`;
   return (await db.query<{result:any}>(query,revision===undefined?[uid,JSON.stringify(input)]:[uid,JSON.stringify(input),revision])).rows[0].result;
  };
  const goal=createGoal({kind:'other',title:'Synthetic goal A',outcome:'Test outcome'}),otherGoal=createGoal({kind:'other',title:'Synthetic goal B',outcome:'Other test outcome'});
  await asUser(A,()=>rpc('save_goal',A,goal,0));await asUser(B,()=>rpc('save_goal',B,otherGoal,0));
  const observation={requestId:crypto.randomUUID(),relationshipId:P,goalId:goal.id,field:'industry',text:'Test sector',sourceKind:'manual',sourceLabel:'User-confirmed test context',sourceRef:'',appliesTo:'contact',confirmed:true};
  const draft={requestId:crypto.randomUUID(),relationshipId:P,goalId:goal.id,goalVersion:1,evidenceFingerprint:'a'.repeat(64),evidenceIds:['claim:test'],channel:'email',purpose:'Test request',body:'Synthetic editable draft',status:'draft'};
  let observationId='',draftId='',stepId='';
  await t.test('legacy interaction rows retain content with nullable goal context',async()=>{
   const row=(await db.query<any>('select body,goal_id,goal_version,request_id from public.outreach_events')).rows[0];assert.deepEqual(row,{body:'Legacy test note',goal_id:null,goal_version:null,request_id:null});
  });
  await t.test('confirmed observation retry acknowledges one immutable row and corrections append',async()=>asUser(A,async()=>{
   const saved=await rpc('save_candidate_observation',A,observation);observationId=saved.id;assert.ok(saved.confirmed_at);assert.equal((await rpc('save_candidate_observation',A,observation)).id,saved.id);
   await assert.rejects(rpc('save_candidate_observation',A,{...observation,text:'Different retry evidence'}),code('23505'));
   const correction={...observation,requestId:crypto.randomUUID(),supersedesId:saved.id,text:'Corrected test sector'};await rpc('save_candidate_observation',A,correction);
   const rows=(await db.query<any>('select text from public.candidate_observations order by created_at')).rows;assert.equal(rows.length,2);assert.equal(rows[0].text,observation.text);
   await assert.rejects(rpc('save_candidate_observation',A,{...correction,requestId:crypto.randomUUID()}),code('23505'));
   await assert.rejects(rpc('save_candidate_observation',A,{...observation,requestId:crypto.randomUUID(),confirmed:false}),code('22023'));
  }));
  await t.test('drafts retry and edit with version checks; copied status never creates a sent event',async()=>asUser(A,async()=>{
   const saved=await rpc('save_message_draft',A,draft,0);draftId=saved.id;assert.equal((await rpc('save_message_draft',A,draft,0)).id,draftId);
   const edited={...draft,body:''};const second=await rpc('save_message_draft',A,edited,1);assert.equal(second.revision,2);assert.equal(second.body,'');assert.equal((await rpc('save_message_draft',A,edited,1)).revision,2);
   await assert.rejects(rpc('save_message_draft',A,{...draft,body:'Stale edit'},1),code('40001'));
   await assert.rejects(rpc('save_message_draft',A,{...edited,evidenceFingerprint:'b'.repeat(64)},2),code('22023'));
   await rpc('save_message_draft',A,{...edited,status:'copied'},2);assert.equal((await db.query('select * from public.outreach_events')).rows.length,1);
  }));
  await t.test('explicit actions and next steps are idempotent and completions inherit their goal',async()=>asUser(A,async()=>{
   const sent={requestId:crypto.randomUUID(),relationshipId:P,goalId:goal.id,kind:'contacted',body:''};const first=await rpc('record_goal_interaction',A,sent);assert.equal(first.goal_version,1);assert.equal((await rpc('record_goal_interaction',A,sent)).id,first.id);
   await assert.rejects(rpc('record_goal_interaction',A,{...sent,body:'Different event'}),code('23505'));
   const step=await rpc('record_goal_interaction',A,{requestId:crypto.randomUUID(),relationshipId:P,goalId:goal.id,kind:'next_step',body:'Synthetic next step',dueAt:'2026-12-01T12:00:00.000Z'});stepId=step.id;
   const complete={requestId:crypto.randomUUID(),relationshipId:P,kind:'next_step_completed',relatedEventId:step.id};const done=await rpc('record_goal_interaction',A,complete);assert.equal(done.goal_id,goal.id);assert.equal(done.goal_version,1);
   assert.equal((await rpc('record_goal_interaction',A,{...complete,requestId:crypto.randomUUID()})).id,done.id);
   assert.equal((await db.query('select * from public.outreach_events')).rows.length,4);
  }));
  await t.test('cross-account relation, goal, version and correction references are refused',async()=>asUser(B,async()=>{
   assert.equal((await db.query('select * from public.candidate_observations')).rows.length,0);assert.equal((await db.query('select * from public.message_drafts')).rows.length,0);
   await assert.rejects(rpc('save_message_draft',A,draft,0),code('42501'));
   await assert.rejects(rpc('save_message_draft',B,{...draft,relationshipId:Q},0),code('42501'));
   await assert.rejects(rpc('save_message_draft',B,{...draft,relationshipId:Q,goalId:otherGoal.id,goalVersion:999},0),code('42501'));
   await assert.rejects(rpc('save_candidate_observation',B,{...observation,requestId:crypto.randomUUID(),relationshipId:Q,goalId:otherGoal.id,supersedesId:observationId}),code('42501'));
   await assert.rejects(rpc('record_goal_interaction',B,{requestId:crypto.randomUUID(),relationshipId:Q,kind:'next_step_completed',relatedEventId:stepId}),code('23514'));
   await assert.rejects(db.query('insert into public.outreach_events(user_id,relationship_id,goal_id,goal_version,kind,body) values($1,$2,$3,1,\'note\',\'Foreign goal\')',[B,Q,goal.id]),code('23503'));
  }));
  await t.test('anonymous reads return nothing and table writes and RPCs are forbidden',async()=>{
   await db.exec('set role anon');try{for(const table of ['candidate_observations','message_drafts'])assert.equal((await db.query('select * from public.'+table)).rows.length,0);await assert.rejects(rpc('save_message_draft',A,draft,0),code('42501'));await assert.rejects(rpc('record_goal_interaction',A,{requestId:crypto.randomUUID(),relationshipId:P,kind:'contacted'}),code('42501'));}finally{await db.exec('reset role');}
   await asUser(A,()=>assert.rejects(db.query('update public.message_drafts set body=\'Bypass\' where id=$1',[draftId]),code('42501')));
  });
  await t.test('invalid payloads refuse instead of saving malformed drafts or observations',async()=>asUser(A,async()=>{
   for(const patch of [{body:{}},{purpose:null},{body:'bad\u0001text'},{evidenceIds:{}},{unexpected:'field'}])await assert.rejects(rpc('save_message_draft',A,{...draft,...patch},3),code('22023'));
   await assert.rejects(rpc('save_candidate_observation',A,{...observation,requestId:crypto.randomUUID(),text:{}}),code('22023'));
   await assert.rejects(rpc('record_goal_interaction',A,{requestId:crypto.randomUUID(),relationshipId:P,kind:'note',body:{}}),code('22023'));
  }));
  await t.test('fact and interaction history remain immutable and inactive accounts cannot mutate',async()=>{
   for(const table of ['candidate_observations','outreach_events']){await assert.rejects(db.exec('delete from public.'+table),code('42501'));await assert.rejects(db.exec('truncate public.'+table),code('42501'));}
   await db.query("update public.users set account_status='lapsed' where user_id=$1",[A]);
   await asUser(A,async()=>{assert.equal((await db.query('select * from public.message_drafts')).rows.length,1);await assert.rejects(rpc('save_message_draft',A,draft,3),code('42501'));await assert.rejects(rpc('save_candidate_observation',A,observation),code('42501'));});
  });
 }finally{await db.close();}
});
