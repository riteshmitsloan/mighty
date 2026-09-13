import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const UID='33333333-3333-4333-8333-333333333333';
const OLD='44444444-4444-4444-8444-444444444444';
const NEW='55555555-5555-4555-8555-555555555555';
test('reviewed Gemini text migration preserves opt-in, limits, and frozen usage accounting',async t=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
   create schema auth; create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema auth,public to anon,authenticated,service_role;
   grant execute on function auth.uid() to anon,authenticated,service_role;
   create schema storage;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
   alter table storage.objects enable row level security;
   create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
   grant usage on schema storage to authenticated; grant all on storage.objects to authenticated;`);
  for(const name of ['001_schema.sql','002_ai.sql','003_quota.sql','004_modules.sql','005_settings.sql','006_gemini_thinking.sql'])
   await db.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
  await db.exec(`insert into auth.users values('${UID}');insert into public.users(user_id) values('${UID}');
   insert into public.ai_user_limits(user_id) values('${UID}');update public.ai_config set enabled=true where feature='classify_ask';`);
  const configs=async()=> (await db.query<any>('select * from public.ai_config order by feature')).rows;
  const before=await configs();
  const limits=(await db.query('select * from public.ai_user_limits')).rows;
  const budget=(await db.query('select * from public.ai_company_budget')).rows;
  const old=(await db.query<any>(`select public.ai_reserve_call('classify_ask',$1,$2,128) as result`,[UID,OLD])).rows[0].result;
  await db.query('update public.ai_call_log set dispatched_at=now() where id=$1',[OLD]);
  const snapshot=(await db.query('select * from public.ai_call_log where id=$1',[OLD])).rows;
  const migration=await readFile(new URL('../supabase/migrations/009_supported_gemini_text.sql',import.meta.url),'utf8');
  await db.exec(migration);
  const after=await configs();
  await t.test('only four reviewed slots, cheaper tariffs and cache revisions change',async()=>{
   const expected=before.map(c=>['classify_ask','profile_briefing','ask_mighty','search_keywords'].includes(c.feature)?{...c,model:'gemini-3.1-flash-lite',
    input_usd_per_million:'0.250000',cached_input_usd_per_million:'0.025000',output_usd_per_million:'1.500000',revision:c.revision+1}:c);
   assert.deepEqual(after,expected);
   assert.deepEqual((await db.query('select * from public.ai_user_limits')).rows,limits);
   assert.deepEqual((await db.query('select * from public.ai_company_budget')).rows,budget);
   for(const feature of ['profile_briefing','ask_mighty','search_keywords']){
    assert.equal(after.find(c=>c.feature===feature).enabled,false);
    await assert.rejects(db.query('select public.ai_reserve_call($1,$2)',[feature,UID]),/Feature is unavailable/);
   }
   assert.equal(after.find(c=>c.feature==='message_drafting').enabled,false);
  });
  await t.test('already dispatched reservations keep original model, pricing, and outcome rules',async()=>{
   assert.equal(old.config.model,'gemini-2.5-flash');
   assert.deepEqual((await db.query('select * from public.ai_call_log where id=$1',[OLD])).rows,snapshot);
   assert.equal((await db.query<any>('select public.ai_release_call($1) as released',[OLD])).rows[0].released,false);
   await assert.rejects(db.query('select public.ai_confirm_call($1,70,25,0.000055)',[OLD]),/Cost does not match/);
   assert.equal((await db.query<any>('select public.ai_confirm_call($1,70,25,0.0000835) as confirmed',[OLD])).rows[0].confirmed,true);
  });
  await t.test('new requests reserve less, meter exact reviewed tariff, and confirm only once',async()=>{
   const next=(await db.query<any>(`select public.ai_reserve_call('classify_ask',$1,$2,128) as result`,[UID,NEW])).rows[0].result;
   assert.equal(next.config.model,'gemini-3.1-flash-lite');assert.equal(next.max_tokens,128);
   assert.ok(Number(next.reserved_usd)<Number(old.reserved_usd));
   assert.equal((await db.query<any>('select public.ai_confirm_call($1,70,25,0.000055) as confirmed',[NEW])).rows[0].confirmed,true);
   assert.equal((await db.query<any>('select public.ai_confirm_call($1,70,25,0.000055) as confirmed',[NEW])).rows[0].confirmed,false);
   const row=(await db.query<any>('select pending,cost_usd from public.ai_call_log where id=$1',[NEW])).rows[0];
   assert.equal(row.pending,false);assert.equal(Number(row.cost_usd),.000055);
  });
  await t.test('reapplying is idempotent and preserves alternative or cheaper manual configurations',async()=>{
   await db.exec(migration);assert.deepEqual(await configs(),after);
   await db.exec(`update public.ai_config set model='custom-reviewed-model',revision=20 where feature='classify_ask';
    update public.ai_config set model='gemini-2.5-pro',input_usd_per_million=.1,revision=20 where feature='profile_briefing';
    update public.ai_config set model='gemini-2.5-pro',revision=20 where feature='search_keywords';
    update public.ai_config set model='gemini-2.5-flash',provider='astra',revision=20 where feature='ask_mighty';`);
   const alternatives=await configs();await db.exec(migration);assert.deepEqual(await configs(),alternatives);
  });
 }finally{await db.close();}
});
