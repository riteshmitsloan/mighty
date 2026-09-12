begin;

create table public.ai_config (
 feature text primary key check(feature ~ '^[a-z][a-z0-9_]{1,63}$'),
 provider text not null check(provider in ('gemini','astra','google_search')),
 model text not null,tier text not null check(tier in ('standard','pro')),weight integer not null check(weight between 1 and 50),
 cache_ttl_days numeric(5,2) not null default 1 check(cache_ttl_days between 0 and 90),
 max_tokens integer not null default 2048 check(max_tokens between 64 and 8192),
 max_prompt_bytes integer not null default 16000 check(max_prompt_bytes between 256 and 48000),
 input_usd_per_million numeric(12,6) not null check(input_usd_per_million>=0),
 cached_input_usd_per_million numeric(12,6) not null check(cached_input_usd_per_million>=0),
 output_usd_per_million numeric(12,6) not null check(output_usd_per_million>=0),
 cache_write_usd_per_million numeric(12,6) not null default 0 check(cache_write_usd_per_million>=0),
 reasoning_token_allowance integer not null default 1024 check(reasoning_token_allowance between 0 and 32768),
 rates_valid_until date not null default '2026-12-31',
 fixed_cost_usd numeric(12,6) not null default 0 check(fixed_cost_usd>=0),
 enabled boolean not null default false,revision integer not null default 1 check(revision>0)
);
alter table public.ai_config enable row level security;
revoke all on public.ai_config from public,anon,authenticated;

create table public.ai_user_limits (
 user_id uuid primary key references public.users(user_id) on delete restrict,
 daily_cap integer not null default 20 check(daily_cap between 0 and 10000),
 monthly_usd_ceiling numeric(12,6) not null default 5 check(monthly_usd_ceiling between 0 and 10000),
 tier text not null default 'standard' check(tier in ('standard','pro'))
);
alter table public.ai_user_limits enable row level security;
create policy ai_limits_select on public.ai_user_limits for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.ai_user_limits from public,anon,authenticated;
grant select on public.ai_user_limits to anon,authenticated;

create table public.ai_company_budget (
 id boolean primary key default true check(id),daily_usd_ceiling numeric(12,6) not null default 10 check(daily_usd_ceiling between 0 and 100000)
);
alter table public.ai_company_budget enable row level security;
revoke all on public.ai_company_budget from public,anon,authenticated;
insert into public.ai_company_budget(id) values(true);

create table public.ai_call_log (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.users(user_id) on delete restrict,
 feature text not null references public.ai_config(feature),tokens_in integer not null default 0 check(tokens_in>=0),tokens_out integer not null default 0 check(tokens_out>=0),
 cached_tokens_in integer not null default 0 check(cached_tokens_in>=0 and cached_tokens_in<=tokens_in),
 cache_write_tokens_in integer not null default 0 check(cache_write_tokens_in>=0 and cache_write_tokens_in+cached_tokens_in<=tokens_in),
 cost_usd numeric(16,8) not null default 0 check(cost_usd>=0),cache_hit boolean not null default false,pending boolean not null default true,
 reserved_usd numeric(16,8) not null check(reserved_usd>=0),weight integer not null check(weight>=0),
 model text not null,input_rate numeric(12,6) not null,cached_input_rate numeric(12,6) not null,output_rate numeric(12,6) not null,cache_write_rate numeric(12,6) not null default 0,fixed_cost_usd numeric(12,6) not null default 0,
 max_tokens integer not null,created_at timestamptz not null default now(),dispatched_at timestamptz,confirmed_at timestamptz,
 unique(user_id,id),check(not cache_hit or (not pending and cost_usd=0 and weight=0))
);
alter table public.ai_call_log enable row level security;
create policy ai_logs_select on public.ai_call_log for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.ai_call_log from public,anon,authenticated;
grant select(id,user_id,feature,tokens_in,tokens_out,cached_tokens_in,cost_usd,cache_hit,pending,created_at,confirmed_at) on public.ai_call_log to anon,authenticated;
create index ai_log_user_day on public.ai_call_log(user_id,created_at);
create index ai_log_company_day on public.ai_call_log(created_at) include(cost_usd,reserved_usd,pending);

create table public.ai_cache (
 user_id uuid not null references public.users(user_id) on delete restrict,cache_key text not null check(cache_key ~ '^[a-f0-9]{64}$'),
 feature text not null references public.ai_config(feature),text text not null check(octet_length(text)<=131072),
 created_at timestamptz not null default now(),expires_at timestamptz not null,primary key(user_id,cache_key)
);
alter table public.ai_cache enable row level security;
create policy ai_cache_select on public.ai_cache for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.ai_cache from public,anon,authenticated;
grant select on public.ai_cache to anon,authenticated;
create index ai_cache_expiry on public.ai_cache(expires_at);

-- SQL remains the authority for budget decisions. It runs under the global budget row lock.
create function public.ai_precheck(p_user_id uuid,p_feature text,p_max_tokens integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare f public.ai_config;u public.ai_user_limits;state text;daily bigint;monthly numeric;company numeric;cap numeric;bound numeric;mt integer;
begin
 select * into f from public.ai_config where feature=p_feature and enabled and rates_valid_until>=(now() at time zone 'UTC')::date;
 if not found then raise exception 'Feature is unavailable.' using errcode='22023'; end if;
 select account_status into state from public.users where user_id=p_user_id;
 if state is null or state<>'active' then raise exception 'Account is locked.' using errcode='42501'; end if;
 select * into u from public.ai_user_limits where user_id=p_user_id;
 if not found then raise exception 'Account usage limits are not configured.' using errcode='42501'; end if;
 if f.tier='pro' and u.tier<>'pro' then raise exception 'Feature requires a different plan.' using errcode='42501'; end if;
 mt:=least(f.max_tokens,greatest(64,coalesce(p_max_tokens,f.max_tokens)));
 -- A conservative one-token-per-UTF8-byte input bound includes every prompt byte.
 bound:=((f.max_prompt_bytes+1024)*greatest(f.input_usd_per_million,f.cache_write_usd_per_million)+(mt+f.reasoning_token_allowance)*f.output_usd_per_million)/1000000+f.fixed_cost_usd;
 select coalesce(sum(weight),0) into daily from public.ai_call_log where user_id=p_user_id and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 select coalesce(sum(case when pending then reserved_usd else cost_usd end),0) into monthly from public.ai_call_log where user_id=p_user_id and created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
 select coalesce(sum(case when pending then reserved_usd else cost_usd end),0) into company from public.ai_call_log where created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 select daily_usd_ceiling into cap from public.ai_company_budget where id=true;
 if daily+f.weight>u.daily_cap then raise exception 'Daily Assist limit reached.' using errcode='P0001'; end if;
 if monthly+bound>u.monthly_usd_ceiling then raise exception 'Monthly cost ceiling reached.' using errcode='P0001'; end if;
 if cap is null or company+bound>cap then raise exception 'Daily company budget reached.' using errcode='P0001'; end if;
 return jsonb_build_object('remaining',u.daily_cap-daily-f.weight,'reserved_usd',bound,'max_tokens',mt);
end; $$;

create function public.ai_reserve_call(p_feature text,p_user_id uuid,p_request_id uuid default gen_random_uuid(),p_max_tokens integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; f public.ai_config;
begin
 -- Every reservation serializes here, including those for different users.
 perform 1 from public.ai_company_budget where id=true for update;
 perform 1 from public.ai_user_limits where user_id=p_user_id for update;
 select * into f from public.ai_config where feature=p_feature for share;
 if exists(select 1 from public.ai_call_log where id=p_request_id) then raise exception 'Request already reserved. Do not dispatch again.' using errcode='23505'; end if;
 result:=public.ai_precheck(p_user_id,p_feature,p_max_tokens);
 insert into public.ai_call_log(id,user_id,feature,reserved_usd,weight,model,input_rate,cached_input_rate,output_rate,cache_write_rate,fixed_cost_usd,max_tokens)
 values(p_request_id,p_user_id,p_feature,(result->>'reserved_usd')::numeric,f.weight,f.model,f.input_usd_per_million,f.cached_input_usd_per_million,f.output_usd_per_million,f.cache_write_usd_per_million,f.fixed_cost_usd,(result->>'max_tokens')::integer);
 return result||jsonb_build_object('id',p_request_id,'config',to_jsonb(f));
end; $$;

create function public.ai_confirm_call(p_id uuid,p_tokens_in integer,p_tokens_out integer,p_cost_usd numeric,p_cached_tokens_in integer default 0,p_cache_write_tokens_in integer default 0)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.ai_call_log; calculated numeric;
begin
 select * into r from public.ai_call_log where id=p_id for update;
 if not found or not r.pending then return false; end if;
 if p_tokens_in<0 or p_tokens_out<0 or p_cached_tokens_in<0 or p_cache_write_tokens_in<0 or p_cached_tokens_in+p_cache_write_tokens_in>p_tokens_in or p_cost_usd<0 then raise exception 'Invalid usage.' using errcode='22023'; end if;
 calculated:=((p_tokens_in-p_cached_tokens_in-p_cache_write_tokens_in)*r.input_rate+p_cached_tokens_in*r.cached_input_rate+p_cache_write_tokens_in*r.cache_write_rate+p_tokens_out*r.output_rate)/1000000+r.fixed_cost_usd;
 if abs(calculated-p_cost_usd)>0.00000002 then raise exception 'Cost does not match reserved rate card.' using errcode='22023'; end if;
 update public.ai_call_log set tokens_in=p_tokens_in,tokens_out=p_tokens_out,cached_tokens_in=p_cached_tokens_in,cache_write_tokens_in=p_cache_write_tokens_in,cost_usd=calculated,pending=false,confirmed_at=now() where id=p_id;
 return true;
end; $$;

create function public.ai_release_call(p_id uuid,p_definitive_no_charge boolean default false)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 delete from public.ai_call_log where id=p_id and pending and (dispatched_at is null or p_definitive_no_charge);
 return found;
end; $$;

revoke all on function public.ai_precheck(uuid,text,integer) from public,anon,authenticated;
revoke all on function public.ai_reserve_call(text,uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.ai_confirm_call(uuid,integer,integer,numeric,integer,integer) from public,anon,authenticated;
revoke all on function public.ai_release_call(uuid,boolean) from public,anon,authenticated;
grant execute on function public.ai_precheck(uuid,text,integer),public.ai_reserve_call(text,uuid,uuid,integer),public.ai_confirm_call(uuid,integer,integer,numeric,integer,integer),public.ai_release_call(uuid,boolean) to service_role;
grant all on public.ai_config,public.ai_user_limits,public.ai_company_budget,public.ai_call_log,public.ai_cache to service_role;

-- Disabled until current rates, model availability, and no-training controls are verified.
insert into public.ai_config(feature,provider,model,tier,weight,cache_ttl_days,input_usd_per_million,cached_input_usd_per_million,output_usd_per_million) values
 ('profile_briefing','gemini','gemini-2.5-pro','standard',1,7,1.25,0.125,10),
 ('profile_fit','gemini','gemini-2.5-flash','standard',1,1,0.30,0.03,2.50),
 ('capture_extraction','gemini','gemini-2.5-flash','standard',1,0,0.30,0.03,2.50),
 ('message_drafting','astra','gpt-6-astra','pro',1,7,10,1,50),
 ('transcription','gemini','gemini-2.5-flash','standard',1,0,0.30,0.03,2.50);
update public.ai_config set cache_write_usd_per_million=12.5,reasoning_token_allowance=0 where provider='astra';

-- Fail the migration, rather than merely printing a warning, if any grant is unsafe.
do $$ declare fn regprocedure; begin
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('ai_precheck','ai_reserve_call','ai_confirm_call','ai_release_call') loop
  if has_function_privilege('anon',fn,'EXECUTE') or has_function_privilege('authenticated',fn,'EXECUTE') or not has_function_privilege('service_role',fn,'EXECUTE') then raise exception 'Unsafe gateway function grant: %',fn; end if;
 end loop;
end $$;
commit;

select p.proname as function, r.rolname as role, has_function_privilege(r.oid,p.oid,'EXECUTE') as can_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join pg_roles r
where n.nspname='public' and p.proname in ('ai_precheck','ai_reserve_call','ai_confirm_call','ai_release_call') and r.rolname in ('anon','authenticated','service_role') order by p.proname,r.rolname;
