begin;
create table public.people_search_config(id boolean primary key default true check(id),daily_cap integer not null default 95 check(daily_cap between 0 and 95));
alter table public.people_search_config enable row level security;
revoke all on public.people_search_config from public,anon,authenticated;
insert into public.people_search_config(id) values(true);
create table public.people_search_usage(day date primary key,used integer not null check(used>=0));
alter table public.people_search_usage enable row level security;
revoke all on public.people_search_usage from public,anon,authenticated;
grant all on public.people_search_config,public.people_search_usage to service_role;

create function public.claim_people_search() returns jsonb language plpgsql security definer set search_path='' as $$
declare cap integer; claimed integer;
begin
 select daily_cap into cap from public.people_search_config where id=true for share;
 insert into public.people_search_usage(day,used)
 select (now() at time zone 'UTC')::date,1 where cap>0
 on conflict(day) do update set used=public.people_search_usage.used+1 where public.people_search_usage.used<cap
 returning used into claimed;
 if claimed is null then return jsonb_build_object('allowed',false,'remaining',0,'reason','Daily people search limit reached. Try again tomorrow.'); end if;
 return jsonb_build_object('allowed',true,'remaining',cap-claimed,'reason',null);
end; $$;
revoke all on function public.claim_people_search() from public,anon,authenticated;
grant execute on function public.claim_people_search() to service_role;

insert into public.ai_config(feature,provider,model,tier,weight,cache_ttl_days,input_usd_per_million,cached_input_usd_per_million,output_usd_per_million,fixed_cost_usd)
values('people_search','google_search','programmable-search','standard',1,1,0,0,0,0.005);

do $$ begin
 if has_function_privilege('anon','public.claim_people_search()','EXECUTE') or has_function_privilege('authenticated','public.claim_people_search()','EXECUTE') then raise exception 'Search quota is not service-only.'; end if;
end $$;
commit;
