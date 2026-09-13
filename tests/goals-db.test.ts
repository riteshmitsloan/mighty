import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
import {createGoal,reviseGoal,type Goal} from '../src/lib/goals';
const root=process.env.MIGRATIONS_ROOT??fileURLToPath(new URL('../supabase/migrations/',import.meta.url));
const A='11111111-1111-4111-8111-111111111111', B='22222222-2222-4222-8222-222222222222';
const denied=(e:unknown)=>(e as {code?:string}).code==='42501';
test('goal migration, version RPC, and account isolation',async t=>{
 const db=new PGlite();
 try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;grant usage on schema storage to authenticated;grant all on storage.objects to authenticated;`);
  for(const name of ['001_schema.sql','002_ai.sql','003_quota.sql','004_modules.sql','005_settings.sql','006_gemini_thinking.sql'])await db.exec(await readFile(root+'/'+name,'utf8'));
  const legacy='  Synthetic legacy words\n\twith exact spacing.  ';
  await db.exec(`insert into auth.users values('${A}'),('${B}');insert into public.users(user_id) values('${A}'),('${B}');`);
  await db.query(`insert into public.settings(user_id,data) values($1,jsonb_build_object('strategy',$2::text)),($3,'{"strategy":""}')`,[A,legacy,B]);
  await db.exec(await readFile(root+'/007_goals.sql','utf8'));
  const asUser=async<T>(uid:string,operation:()=>Promise<T>)=>{await db.exec(`set role authenticated;set request.jwt.claim.sub='${uid}';`);try{return await operation();}finally{await db.exec('reset role;reset request.jwt.claim.sub');}};
  const save=async(uid:string,goal:Goal|Record<string,unknown>,expected:number)=>((await db.query<{result:Goal}>('select public.save_goal($1,$2::jsonb,$3) as result',[uid,JSON.stringify(goal),expected])).rows[0].result);
  await t.test('legacy account text is migrated once without modification',async()=>{
   const rows=(await db.query<{document:Goal}>('select document from public.goals')).rows;assert.equal(rows.length,1);assert.equal(rows[0].document.outcome,legacy);assert.equal(rows[0].document.version,1);
   assert.equal((await db.query('select * from public.goal_versions')).rows.length,1);assert.equal((await db.query<{value:string}>('select data->>\'strategy\' as value from public.settings where user_id=$1',[A])).rows[0].value,legacy);
  });
  const created=createGoal({kind:'other',title:'Database test goal',outcome:'Synthetic test outcome'});let saved:Goal;
  await t.test('atomic create, revisions and exact retry append precisely one version each',async()=>asUser(B,async()=>{
   saved=await save(B,created,0);assert.equal(saved.version,1);assert.equal((await save(B,created,0)).version,1);
   const changed=reviseGoal(saved,{outcome:'A revised synthetic outcome'});saved=await save(B,changed,1);assert.equal(saved.version,2);assert.equal((await save(B,changed,1)).version,2);
   const history=(await db.query<{document:Goal}>('select document from public.goal_versions where goal_id=$1 order by version',[created.id])).rows;assert.equal(history.length,2);assert.equal(history[0].document.outcome,created.outcome);assert.equal(history[1].document.outcome,changed.outcome);
  }));
  await t.test('stale competing edits fail and later offline revisions use the authoritative version',async()=>asUser(B,async()=>{
   await assert.rejects(save(B,reviseGoal(created,{outcome:'Stale conflicting edit'}),1),(e:unknown)=>(e as {code:string}).code==='40001');
   const offline={...reviseGoal(saved!,{title:'Offline edited title'}),version:12};saved=await save(B,offline,2);assert.equal(saved.version,3);
   assert.equal((await db.query('select * from public.goal_versions where goal_id=$1',[created.id])).rows.length,3);
  }));
  await t.test('anonymous reads are empty and writes/RPC are forbidden',async()=>{
   await db.exec('set role anon');try{for(const table of ['goals','goal_versions'])assert.equal((await db.query('select * from public.'+table)).rows.length,0);await assert.rejects(save(A,created,0),denied);await assert.rejects(db.query('insert into public.goals(id,user_id,version,document) values($1,$2,1,$3)',[crypto.randomUUID(),A,JSON.stringify(created)]),denied);}finally{await db.exec('reset role');}
  });
  await t.test('cross-account rows, foreign IDs and direct history forgery are refused',async()=>asUser(A,async()=>{
   assert.equal((await db.query('select * from public.goals where id=$1',[created.id])).rows.length,0);assert.equal((await db.query('select * from public.goal_versions where goal_id=$1',[created.id])).rows.length,0);
   await assert.rejects(save(B,created,0),denied);await assert.rejects(save(A,created,0),denied);
   await assert.rejects(db.query('update public.goals set version=8 where user_id=$1',[A]),denied);
   await assert.rejects(db.query('insert into public.goal_versions(user_id,goal_id,version,document) values($1,$2,4,$3)',[A,created.id,JSON.stringify({...saved!,version:4})]),denied);
  }));
  await t.test('invalid JSON fields, empty strings, unsafe control text and duplicate criteria fail without writes',async()=>asUser(B,async()=>{
   const criterion={id:'sector',field:'industry',label:'Industry',terms:['Test sector'],importance:'preferred',appliesTo:'opportunity',origin:'user'};
   for(const patch of [{kind:null},{status:null},{title:'\n\t'},{outcome:'bad\u0001text'},{criteria:[criterion,criterion]},{criteria:[{...criterion,field:null}]},{criteria:{}},{version:0},{title:'x'.repeat(201)},{unexpected:true}])await assert.rejects(save(B,{...created,...patch},0),(e:unknown)=>(e as {code:string}).code==='22023');
   assert.equal((await db.query('select * from public.goal_versions where goal_id=$1',[created.id])).rows.length,3);
  }));
  await t.test('history is immutable even through privileged ordinary update/delete/truncate paths',async()=>{
   for(const sql of ['update public.goal_versions set version=99','delete from public.goal_versions','truncate public.goal_versions'])await assert.rejects(db.exec(sql),denied);
   await assert.rejects(db.query('insert into public.goal_versions(user_id,goal_id,version,document) values($1,$2,4,$3)',[A,created.id,JSON.stringify({...saved!,version:4})]),(e:unknown)=>(e as {code:string}).code==='23503');
  });
  await t.test('paused goals retain history; inactive or missing sessions cannot save',async()=>{
   await asUser(B,async()=>{saved=await save(B,reviseGoal(saved!,{status:'paused'}),3);assert.equal(saved.status,'paused');assert.equal(saved.version,4);});
   await db.query("update public.users set account_status='lapsed' where user_id=$1",[B]);
   await asUser(B,async()=>{assert.equal((await db.query('select * from public.goals')).rows.length,1);await assert.rejects(save(B,created,0),denied);});
   await db.exec('set role authenticated');try{await assert.rejects(save(A,created,0),denied);}finally{await db.exec('reset role');}
  });
 } finally {await db.close();}
});
