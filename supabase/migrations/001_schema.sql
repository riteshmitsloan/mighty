begin;

-- auth.users is managed by Supabase. No signup flow or auth trigger is installed here.
create table public.users (
 user_id uuid primary key references auth.users(id) on delete restrict,
 display_name text not null default '',
 account_status text not null default 'active' check(account_status in ('active','paused','lapsed')),
 created_at timestamptz not null default now()
);
alter table public.users enable row level security;
create policy users_select on public.users for select to authenticated using(user_id=(select auth.uid()));
create policy users_update on public.users for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
revoke all on public.users from anon,authenticated;
grant select on public.users to anon,authenticated;
grant update(display_name) on public.users to authenticated;

create function public.account_is_active() returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.users where user_id=(select auth.uid()) and account_status='active');
$$;
revoke all on function public.account_is_active() from public,anon;
grant execute on function public.account_is_active() to authenticated,service_role;

create table public.settings (
 user_id uuid primary key references public.users(user_id) on delete restrict,
 data jsonb not null default '{"strategy":"","knowledge":{},"assets":[]}'::jsonb,
 plan_caps jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now(),
 check(jsonb_typeof(data)='object' and octet_length(data::text)<=131072 and data-array['strategy','knowledge','assets','voice']='{}'::jsonb)
);
alter table public.settings enable row level security;
create policy settings_select on public.settings for select to authenticated using(user_id=(select auth.uid()));
create policy settings_insert on public.settings for insert to authenticated with check(user_id=(select auth.uid()) and public.account_is_active());
create policy settings_update on public.settings for update to authenticated using(user_id=(select auth.uid()) and public.account_is_active()) with check(user_id=(select auth.uid()) and public.account_is_active());
revoke all on public.settings from anon,authenticated;
grant select on public.settings to anon,authenticated;
grant insert(user_id,data),update(data,updated_at) on public.settings to authenticated;

create table public.imports (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.users(user_id) on delete restrict,
 kind text not null check(kind in ('linkedin_archive','mailbox')),
 status text not null default 'pending' check(status in ('pending','processing','completed','failed')),
 storage_path text,record_count integer not null default 0 check(record_count>=0),created_at timestamptz not null default now(),
 unique(user_id,id)
);
alter table public.imports enable row level security;
create policy imports_select on public.imports for select to authenticated using(user_id=(select auth.uid()));
create policy imports_insert on public.imports for insert to authenticated with check(user_id=(select auth.uid()) and public.account_is_active() and status='pending' and record_count=0);
revoke all on public.imports from anon,authenticated;
grant select on public.imports to anon,authenticated;
grant insert(id,user_id,kind,storage_path) on public.imports to authenticated;

-- Connection inserts are restricted to the trusted archive importer. No scraping path exists.
create table public.connections (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.users(user_id) on delete restrict,
 import_id uuid not null,person text not null check(length(btrim(person)) between 1 and 200),
 profile_url text,company text,role text,context jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),
 unique(user_id,id),unique(user_id,profile_url),
 foreign key(user_id,import_id) references public.imports(user_id,id) on delete restrict
);
alter table public.connections enable row level security;
create policy connections_select on public.connections for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.connections from anon,authenticated;
grant select on public.connections to anon,authenticated;
create index connections_user_company on public.connections(user_id,company);

create table public.outreach_log (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.users(user_id) on delete restrict,
 person text not null check(length(btrim(person)) between 1 and 200),profile_url text,
 stage text not null default 'saved' check(stage in ('saved','contacted','in_conversation','staying_in_touch')),
 context jsonb not null default '{"memories":[],"saveReason":"","source":"manual"}'::jsonb,
 created_at timestamptz not null default now(),unique(user_id,id),unique(user_id,profile_url),
 check(jsonb_typeof(context)='object' and octet_length(context::text)<=65536),
 check(profile_url is null or profile_url ~ '^https://(www\.)?linkedin\.com/in/[^/?#]+/?$')
);
alter table public.outreach_log enable row level security;
create policy outreach_select on public.outreach_log for select to authenticated using(user_id=(select auth.uid()));
create policy outreach_insert on public.outreach_log for insert to authenticated with check(user_id=(select auth.uid()) and public.account_is_active());
create policy outreach_update on public.outreach_log for update to authenticated using(user_id=(select auth.uid()) and public.account_is_active()) with check(user_id=(select auth.uid()) and public.account_is_active());
revoke all on public.outreach_log from anon,authenticated;
grant select,insert on public.outreach_log to anon,authenticated;
grant update(person,profile_url,stage,context) on public.outreach_log to authenticated;
create index outreach_log_user_stage on public.outreach_log(user_id,stage);

create table public.outreach_events (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.users(user_id) on delete restrict,
 relationship_id uuid not null,kind text not null check(kind in ('contacted','replied','coffee_chat','note','promise_made','promise_kept','stage_change')),
 body text not null default '' check(length(body)<=8000),related_event_id uuid,created_at timestamptz not null default now(),
 unique(user_id,relationship_id,id),
 foreign key(user_id,relationship_id) references public.outreach_log(user_id,id) on delete restrict,
 foreign key(user_id,relationship_id,related_event_id) references public.outreach_events(user_id,relationship_id,id) on delete restrict,
 check(kind not in ('note','promise_made') or length(btrim(body))>0),
 check(kind<>'promise_kept' or related_event_id is not null)
);
alter table public.outreach_events enable row level security;
create policy events_select on public.outreach_events for select to authenticated using(user_id=(select auth.uid()));
create policy events_insert on public.outreach_events for insert to authenticated with check(user_id=(select auth.uid()) and public.account_is_active());
revoke all on public.outreach_events from anon,authenticated;
grant select,insert on public.outreach_events to anon,authenticated;
create index outreach_events_user_created on public.outreach_events(user_id,created_at);
create unique index promise_completion_once on public.outreach_events(user_id,related_event_id) where kind='promise_kept';
create function public.guard_outreach_events() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op<>'INSERT' then raise exception 'Interaction history is append-only.' using errcode='42501'; end if;
 if new.kind='promise_kept' and not exists(select 1 from public.outreach_events where user_id=new.user_id and relationship_id=new.relationship_id and id=new.related_event_id and kind='promise_made') then
  raise exception 'A kept promise must reference an existing promise made.' using errcode='23514';
 end if;
 return new;
end; $$;
revoke all on function public.guard_outreach_events() from public,anon,authenticated;
grant execute on function public.guard_outreach_events() to service_role;
create trigger outreach_events_guard before insert or update or delete on public.outreach_events for each row execute function public.guard_outreach_events();
create trigger outreach_events_no_truncate before truncate on public.outreach_events for each statement execute function public.guard_outreach_events();

-- Analytics contains only bounded values from a closed vocabulary. No arbitrary JSON.
create table public.app_events (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.users(user_id) on delete restrict,
 event_name text not null check(event_name in ('strategy_saved','person_saved','capture_saved','assist_requested','draft_copied','import_completed','feature_opened')),
 approach text check(approach in ('manual','assist','archive','extension')),
 source text check(source in ('web','pwa','extension','linkedin_archive','mailbox')),
 reason text check(reason in ('user_action','reminder','follow_up','goal_fit','not_enough_data')),
 count integer not null default 1 check(count between 0 and 10000),success boolean not null default true,created_at timestamptz not null default now()
);
alter table public.app_events enable row level security;
create policy app_events_select on public.app_events for select to authenticated using(user_id=(select auth.uid()));
create policy app_events_insert on public.app_events for insert to authenticated with check(user_id=(select auth.uid()) and public.account_is_active());
revoke all on public.app_events from anon,authenticated;
grant select,insert on public.app_events to anon,authenticated;

-- Registry only; no invite/signup gate or seat-claim flow is installed in this module.
create table public.invite_codes (
 id uuid primary key default gen_random_uuid(),user_id uuid references public.users(user_id) on delete restrict,
 code_hash text not null unique,channel text not null check(channel in ('founder','mit','referral')),
 seats_remaining integer not null default 1 check(seats_remaining between 0 and 30),created_at timestamptz not null default now()
);
alter table public.invite_codes enable row level security;
create policy invites_select on public.invite_codes for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.invite_codes from anon,authenticated;
grant select on public.invite_codes to anon,authenticated;

grant all on public.users,public.settings,public.imports,public.connections,public.outreach_log,public.outreach_events,public.app_events,public.invite_codes to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('archives','archives',false,52428800,array['application/zip','application/x-zip-compressed','text/csv','application/pdf']) on conflict(id) do nothing;
create policy archives_read_own on storage.objects for select to authenticated using(bucket_id='archives' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy archives_insert_own on storage.objects for insert to authenticated with check(bucket_id='archives' and (storage.foldername(name))[1]=(select auth.uid())::text and public.account_is_active());
create policy archives_update_own on storage.objects for update to authenticated using(bucket_id='archives' and (storage.foldername(name))[1]=(select auth.uid())::text and public.account_is_active()) with check(bucket_id='archives' and (storage.foldername(name))[1]=(select auth.uid())::text and public.account_is_active());
create policy archives_delete_own on storage.objects for delete to authenticated using(bucket_id='archives' and (storage.foldername(name))[1]=(select auth.uid())::text);

commit;
