begin;
-- Free model slots still have a daily call guard and dollar ceilings.
alter table public.ai_config drop constraint ai_config_weight_check;
alter table public.ai_config add constraint ai_config_weight_check check(weight between 0 and 50);
alter table public.ai_user_limits add column daily_call_cap integer not null default 40 check(daily_call_cap between 0 and 10000);
update public.ai_config set weight=0,max_tokens=4096,max_prompt_bytes=48000 where feature='profile_briefing';
insert into public.ai_config(feature,provider,model,tier,weight,cache_ttl_days,input_usd_per_million,cached_input_usd_per_million,output_usd_per_million) values
 ('classify_ask','gemini','gemini-2.5-flash','standard',0,7,.30,.03,2.50),
 ('ask_mighty','gemini','gemini-2.5-flash','standard',0,1,.30,.03,2.50),
 ('search_keywords','gemini','gemini-2.5-flash','standard',0,7,.30,.03,2.50);
create function public.enforce_daily_model_calls() returns trigger language plpgsql security invoker set search_path='' as $$
declare cap integer; used bigint;
begin
 if new.cache_hit then return new; end if;
 -- Shares the exact company lock used by reservations, including weight-zero features.
 perform 1 from public.ai_company_budget where id=true for update;
 select daily_call_cap into cap from public.ai_user_limits where user_id=new.user_id;
 select count(*) into used from public.ai_call_log where user_id=new.user_id and not cache_hit and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 if cap is null or used>=cap then raise exception 'Daily model call limit reached.' using errcode='P0001'; end if;
 return new;
end; $$;
revoke all on function public.enforce_daily_model_calls() from public,anon,authenticated;
grant execute on function public.enforce_daily_model_calls() to service_role;
create trigger ai_daily_call_guard before insert on public.ai_call_log for each row execute function public.enforce_daily_model_calls();

create table public.knowledge_sources (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.users(user_id) on delete restrict,
 source text not null check(source in ('archive','resume','mailbox','profile')),
 fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),facts jsonb not null,
 created_at timestamptz not null default now(),unique(user_id,source,fingerprint),
 check(jsonb_typeof(facts)='object' and octet_length(facts::text)<=4194304)
);
alter table public.knowledge_sources enable row level security;
create policy knowledge_select on public.knowledge_sources for select to authenticated using(user_id=(select auth.uid()));
create policy knowledge_insert on public.knowledge_sources for insert to authenticated with check(user_id=(select auth.uid()) and public.account_is_active());
revoke all on public.knowledge_sources from public,anon,authenticated;
grant select on public.knowledge_sources to anon,authenticated;
grant insert on public.knowledge_sources to authenticated;
create trigger immutable_knowledge before update or delete on public.knowledge_sources for each row execute function public.guard_outreach_events();

-- Client imports may insert only into their own, explicitly created archive import.
create policy connections_insert on public.connections for insert to authenticated with check(user_id=(select auth.uid()) and public.account_is_active() and exists(select 1 from public.imports i where i.id=import_id and i.user_id=(select auth.uid()) and i.kind='linkedin_archive'));
grant insert on public.connections to authenticated;
create policy imports_update on public.imports for update to authenticated using(user_id=(select auth.uid()) and public.account_is_active()) with check(user_id=(select auth.uid()) and public.account_is_active());
grant update(status,record_count) on public.imports to authenticated;
create function public.import_connections(p_rows jsonb) returns integer language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>500 or octet_length(p_rows::text)>2097152 then raise exception 'Import batch is too large or invalid.' using errcode='22023'; end if;
 insert into public.connections(id,user_id,import_id,person,profile_url,company,role,context)
 select id,user_id,import_id,person,profile_url,company,role,context from jsonb_to_recordset(p_rows) as r(id uuid,user_id uuid,import_id uuid,person text,profile_url text,company text,role text,context jsonb)
 on conflict do nothing;
 get diagnostics n = row_count;
 return n;
end; $$;
revoke all on function public.import_connections(jsonb) from public,anon;
grant execute on function public.import_connections(jsonb) to authenticated,service_role;

create table public.outreach_inbox (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.users(user_id) on delete restrict,
 operation_id uuid not null,profile_url text not null check(profile_url ~ '^https://www\.linkedin\.com/in/[^/?#]+/$'),
 person text not null check(length(btrim(person)) between 1 and 200),snapshot jsonb not null check(jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<=60000),
 profile_read_at timestamptz,created_at timestamptz not null default now(),consumed_at timestamptz,relationship_id uuid,
 unique(user_id,operation_id),foreign key(user_id,relationship_id) references public.outreach_log(user_id,id) on delete restrict
);
alter table public.outreach_inbox enable row level security;
create policy inbox_select on public.outreach_inbox for select to authenticated using(user_id=(select auth.uid()));
create policy inbox_insert on public.outreach_inbox for insert to authenticated with check(user_id=(select auth.uid()) and public.account_is_active());
create policy inbox_update on public.outreach_inbox for update to authenticated using(user_id=(select auth.uid()) and public.account_is_active()) with check(user_id=(select auth.uid()) and public.account_is_active());
revoke all on public.outreach_inbox from public,anon,authenticated;
grant select on public.outreach_inbox to anon,authenticated;
grant insert(id,user_id,operation_id,profile_url,person,snapshot,profile_read_at),update(consumed_at,relationship_id) on public.outreach_inbox to authenticated;
create index inbox_pending on public.outreach_inbox(user_id,created_at) where consumed_at is null;

create table public.profile_reads (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.users(user_id) on delete restrict,
 relationship_id uuid not null,inbox_id uuid not null unique references public.outreach_inbox(id) on delete restrict,
 snapshot jsonb not null,observed_at timestamptz not null,created_at timestamptz not null default now(),
 foreign key(user_id,relationship_id) references public.outreach_log(user_id,id) on delete restrict
);
alter table public.profile_reads enable row level security;
create policy profile_reads_select on public.profile_reads for select to authenticated using(user_id=(select auth.uid()));
create policy profile_reads_insert on public.profile_reads for insert to authenticated with check(user_id=(select auth.uid()) and public.account_is_active() and exists(select 1 from public.outreach_inbox i where i.id=inbox_id and i.user_id=(select auth.uid()) and i.profile_read_at is not null));
revoke all on public.profile_reads from public,anon,authenticated;
grant select on public.profile_reads to anon,authenticated;
grant insert on public.profile_reads to authenticated;
create trigger immutable_profile_reads before update or delete on public.profile_reads for each row execute function public.guard_outreach_events();

create function public.consume_inbox(p_id uuid) returns uuid language plpgsql security invoker set search_path='' as $$
declare item public.outreach_inbox;rid uuid;
begin
 select * into item from public.outreach_inbox where id=p_id and user_id=(select auth.uid()) for update;
 if not found then raise exception 'Inbox item is unavailable.' using errcode='42501'; end if;
 if item.consumed_at is not null then return item.relationship_id; end if;
 insert into public.outreach_log(user_id,person,profile_url,context)
 values(item.user_id,item.person,item.profile_url,jsonb_build_object('source','extension','saveReason','Saved by you from LinkedIn','profile',item.snapshot,'profileComplete',item.profile_read_at is not null))
 on conflict(user_id,profile_url) do nothing returning id into rid;
 if rid is null then select id into rid from public.outreach_log where user_id=item.user_id and profile_url=item.profile_url; end if;
 if item.profile_read_at is not null then
  insert into public.profile_reads(user_id,relationship_id,inbox_id,snapshot,observed_at) values(item.user_id,rid,item.id,item.snapshot,item.profile_read_at) on conflict(inbox_id) do nothing;
 end if;
 update public.outreach_inbox set relationship_id=rid,consumed_at=now() where id=item.id;
 return rid;
end; $$;
revoke all on function public.consume_inbox(uuid) from public,anon;
grant execute on function public.consume_inbox(uuid) to authenticated,service_role;
grant all on public.knowledge_sources,public.outreach_inbox,public.profile_reads to service_role;
commit;
