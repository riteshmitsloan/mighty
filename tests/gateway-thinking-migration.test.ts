import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const MIGRATIONS_ROOT = process.env.MIGRATIONS_ROOT ?? fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
const UID = '33333333-3333-4333-8333-333333333333';
const OLD_ID = '44444444-4444-4444-8444-444444444444';
const NEW_ID = '55555555-5555-4555-8555-555555555555';

test('short Flash migration preserves opt-in, Pro thinking, and frozen SQL accounting', async t => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth,public to anon,authenticated,service_role;
      grant execute on function auth.uid() to anon,authenticated,service_role;
      create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
      alter table storage.objects enable row level security;
      create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
      grant usage on schema storage to authenticated; grant all on storage.objects to authenticated;
    `);
    for (const name of ['001_schema.sql', '002_ai.sql', '003_quota.sql', '004_modules.sql', '005_settings.sql']) {
      await db.exec(await readFile(`${MIGRATIONS_ROOT}/${name}`, 'utf8'));
    }
    // These entitlements belong only to this isolated test account.
    await db.exec(`insert into auth.users values('${UID}'); insert into public.users(user_id) values('${UID}'); insert into public.ai_user_limits(user_id) values('${UID}'); update public.ai_config set enabled=true where feature='classify_ask';`);
    const before = (await db.query<any>('select * from public.ai_config order by feature')).rows;
    const oldReservation = (await db.query<any>(`select public.ai_reserve_call('classify_ask',$1,$2,128) as result`, [UID, OLD_ID])).rows[0].result;
    await db.query('update public.ai_call_log set dispatched_at=now() where id=$1', [OLD_ID]);
    const oldLog = (await db.query<any>('select * from public.ai_call_log where id=$1', [OLD_ID])).rows[0];
    const migration = await readFile(`${MIGRATIONS_ROOT}/006_gemini_thinking.sql`, 'utf8');
    await db.exec(migration);
    const after = (await db.query<any>('select * from public.ai_config order by feature')).rows;

    await t.test('only configured short Flash allowances and revisions change; no feature is enabled', async () => {
      const expected = before.map(row => ['classify_ask', 'search_keywords'].includes(row.feature)
        ? { ...row, reasoning_token_allowance: 0, revision: row.revision + 1 } : row);
      assert.deepEqual(after, expected);
      assert.equal(after.find(row => row.feature === 'profile_briefing').reasoning_token_allowance, 1024);
      assert.equal(after.find(row => row.feature === 'ask_mighty').reasoning_token_allowance, 1024);
      assert.equal(after.find(row => row.feature === 'search_keywords').enabled, false);
      await assert.rejects(db.query(`select public.ai_reserve_call('search_keywords',$1)`, [UID]), /Feature is unavailable/);
    });

    await t.test('an already dispatched reservation is unchanged and cannot be released as unspent', async () => {
      assert.equal(oldReservation.config.reasoning_token_allowance, 1024);
      assert.deepEqual((await db.query<any>('select * from public.ai_call_log where id=$1', [OLD_ID])).rows[0], oldLog);
      assert.equal((await db.query<any>('select public.ai_release_call($1) as released', [OLD_ID])).rows[0].released, false);
      assert.equal((await db.query<any>('select pending from public.ai_call_log where id=$1', [OLD_ID])).rows[0].pending, true);
    });

    await t.test('new 128-token calls reserve the smaller bound and both snapshots confirm actual usage once', async () => {
      const next = (await db.query<any>(`select public.ai_reserve_call('classify_ask',$1,$2,128) as result`, [UID, NEW_ID])).rows[0].result;
      assert.equal(next.config.reasoning_token_allowance, 0); assert.equal(next.max_tokens, 128);
      assert.ok(Number(next.reserved_usd) < Number(oldReservation.reserved_usd));
      assert.ok(Math.abs((Number(oldReservation.reserved_usd) - Number(next.reserved_usd)) - 1024 * 2.5 / 1_000_000) < 1e-10);
      const rates = ['input_usd_per_million', 'cached_input_usd_per_million', 'cache_write_usd_per_million', 'output_usd_per_million', 'fixed_cost_usd'];
      for (const key of rates) assert.equal(next.config[key], oldReservation.config[key]);
      for (const id of [OLD_ID, NEW_ID]) {
        await assert.rejects(db.query('select public.ai_confirm_call($1,70,25,0)', [id]), /Cost does not match reserved rate card/);
        assert.equal((await db.query<any>('select public.ai_confirm_call($1,70,25,0.0000835) as confirmed', [id])).rows[0].confirmed, true);
        assert.equal((await db.query<any>('select public.ai_confirm_call($1,70,25,0.0000835) as confirmed', [id])).rows[0].confirmed, false);
        const logged = (await db.query<any>('select * from public.ai_call_log where id=$1', [id])).rows[0];
        assert.equal(logged.pending, false); assert.equal(logged.tokens_in, 70); assert.equal(logged.tokens_out, 25);
        assert.equal(Number(logged.cost_usd), .0000835);
      }
    });

    await t.test('reapplying the migration is idempotent and never assigns zero to a different model', async () => {
      await db.exec(migration);
      assert.deepEqual((await db.query<any>('select * from public.ai_config order by feature')).rows, after);
      await db.exec(`update public.ai_config set model='gemini-2.5-pro',reasoning_token_allowance=128,revision=10 where feature='search_keywords';`);
      await db.exec(migration);
      assert.deepEqual((await db.query<any>(`select model,reasoning_token_allowance,revision,enabled from public.ai_config where feature='search_keywords'`)).rows[0], { model: 'gemini-2.5-pro', reasoning_token_allowance: 128, revision: 10, enabled: false });
    });
  } finally { await db.close(); }
});
