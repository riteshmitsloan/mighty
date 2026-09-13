begin;

create function public.valid_goal_document(doc jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare criterion jsonb; term jsonb; ids text[] := '{}'; n bigint;
begin
 if jsonb_typeof(doc) is distinct from 'object' or octet_length(doc::text)>65536
    or doc-array['id','kind','title','outcome','criteria','openQuestions','version','status','createdAt','updatedAt']<>'{}'::jsonb then return false; end if;
 if not (doc ?& array['id','kind','title','outcome','criteria','openQuestions','version','status','createdAt','updatedAt']) then return false; end if;
 if jsonb_typeof(doc->'kind')<>'string' or jsonb_typeof(doc->'status')<>'string' then return false; end if;
 if doc::text ~ '\\u00(0[1-8bef]|1[0-9a-f]|7f)' then return false; end if;
 if jsonb_typeof(doc->'id')<>'string' or (doc->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or (doc->>'kind') not in ('career','fundraising','advisory','partnership','other')
    or (doc->>'status') not in ('active','paused','completed') then return false; end if;
 if jsonb_typeof(doc->'title')<>'string' or length(doc->>'title') not between 1 and 200 or (doc->>'title') !~ '[^[:space:]]'
    or jsonb_typeof(doc->'outcome')<>'string' or length(doc->>'outcome') not between 1 and 16000 or (doc->>'outcome') !~ '[^[:space:]]' then return false; end if;
 if jsonb_typeof(doc->'version')<>'number' or (doc->>'version') !~ '^[1-9][0-9]*$' then return false; end if;
 n := (doc->>'version')::bigint; if n>2147483647 then return false; end if;
 if jsonb_typeof(doc->'criteria')<>'array' or jsonb_array_length(doc->'criteria')>30
    or jsonb_typeof(doc->'openQuestions')<>'array' or jsonb_array_length(doc->'openQuestions')>30 then return false; end if;
 for criterion in select value from jsonb_array_elements(doc->'criteria') loop
  if jsonb_typeof(criterion)<>'object' or not (criterion ?& array['id','field','label','terms','importance','appliesTo','origin'])
     or criterion-array['id','field','label','terms','importance','appliesTo','origin']<>'{}'::jsonb then return false; end if;
  if jsonb_typeof(criterion->'id')<>'string' or length(criterion->>'id') not between 1 and 100 or (criterion->>'id') !~ '^[A-Za-z0-9_-]+$'
     or (criterion->>'id')=any(ids) then return false; end if;
  ids := array_append(ids,criterion->>'id');
  if jsonb_typeof(criterion->'field')<>'string' or jsonb_typeof(criterion->'importance')<>'string'
     or jsonb_typeof(criterion->'appliesTo')<>'string' or jsonb_typeof(criterion->'origin')<>'string' then return false; end if;
  if (criterion->>'field') not in ('role','industry','location','stage','check_size','custom')
     or (criterion->>'importance') not in ('required','preferred') or (criterion->>'appliesTo') not in ('opportunity','contact')
     or (criterion->>'origin') not in ('user','suggested') then return false; end if;
  if jsonb_typeof(criterion->'label')<>'string' or length(criterion->>'label') not between 1 and 200 or (criterion->>'label') !~ '[^[:space:]]'
     or jsonb_typeof(criterion->'terms')<>'array' or jsonb_array_length(criterion->'terms')>20 then return false; end if;
  for term in select value from jsonb_array_elements(criterion->'terms') loop
   if jsonb_typeof(term)<>'string' or length(term #>> '{}') not between 1 and 200 or (term #>> '{}') !~ '[^[:space:]]' then return false; end if;
  end loop;
 end loop;
 for term in select value from jsonb_array_elements(doc->'openQuestions') loop
  if jsonb_typeof(term)<>'string' or length(term #>> '{}') not between 1 and 1000 or (term #>> '{}') !~ '[^[:space:]]' then return false; end if;
 end loop;
 if jsonb_typeof(doc->'createdAt')<>'string' or jsonb_typeof(doc->'updatedAt')<>'string'
    or (doc->>'createdAt') !~ '^\d{4}-\d{2}-\d{2}T' or (doc->>'updatedAt') !~ '^\d{4}-\d{2}-\d{2}T'
    or (doc->>'updatedAt')::timestamptz < (doc->>'createdAt')::timestamptz then return false; end if;
 return true;
exception when others then return false;
end; $$;
revoke all on function public.valid_goal_document(jsonb) from public,anon;
grant execute on function public.valid_goal_document(jsonb) to authenticated,service_role;

create table public.goals (
 id uuid primary key,user_id uuid not null references public.users(user_id) on delete restrict,
 version integer not null check(version>0),document jsonb not null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(user_id,id),check(public.valid_goal_document(document)),
 check((document->>'id')::uuid=id and (document->>'version')::integer=version)
);
create table public.goal_versions (
 user_id uuid not null,goal_id uuid not null,version integer not null check(version>0),
 document jsonb not null,created_at timestamptz not null default now(),
 primary key(user_id,goal_id,version),
 foreign key(user_id,goal_id) references public.goals(user_id,id) on delete restrict,
 check(public.valid_goal_document(document)),
 check((document->>'id')::uuid=goal_id and (document->>'version')::integer=version)
);
alter table public.goals enable row level security;
alter table public.goal_versions enable row level security;
create policy goals_select on public.goals for select to authenticated using(user_id=(select auth.uid()));
create policy goal_versions_select on public.goal_versions for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.goals,public.goal_versions from public,anon,authenticated;
grant select on public.goals,public.goal_versions to anon,authenticated;
grant all on public.goals,public.goal_versions to service_role;
create index goals_user_updated on public.goals(user_id,updated_at desc,id);

create function public.guard_goal_history() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'Goal version history is append-only.' using errcode='42501'; end; $$;
revoke all on function public.guard_goal_history() from public,anon,authenticated;
grant execute on function public.guard_goal_history() to service_role;
create trigger goal_history_immutable before update or delete on public.goal_versions for each row execute function public.guard_goal_history();
create trigger goal_history_no_truncate before truncate on public.goal_versions for each statement execute function public.guard_goal_history();

-- Only this bounded RPC writes client goals. Table grants cannot bypass version
-- checks or append forged history, and every call checks the actual JWT owner.
create function public.save_goal(p_user_id uuid,p_goal jsonb,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare current_goal public.goals; goal_id uuid; saved jsonb; next_version integer; stamp text;
begin
 if p_user_id is distinct from (select auth.uid()) or p_user_id is null then raise exception 'The goal account changed.' using errcode='42501'; end if;
 -- One account lock serializes creation limits and concurrent retries.
 perform 1 from public.users where user_id=p_user_id and account_status='active' for update;
 if not found then raise exception 'An active account is required to save goals.' using errcode='42501'; end if;
 if p_expected_version is null or p_expected_version<0 or not public.valid_goal_document(p_goal) then raise exception 'The goal document or expected version is invalid.' using errcode='22023'; end if;
 goal_id := (p_goal->>'id')::uuid;
 select * into current_goal from public.goals where user_id=p_user_id and id=goal_id for update;
 if found then
  -- Exact-content retries acknowledge the current committed version.
  if p_expected_version<=current_goal.version and current_goal.document-array['version','createdAt','updatedAt']=p_goal-array['version','createdAt','updatedAt'] then return current_goal.document; end if;
  if current_goal.version<>p_expected_version then raise exception 'This goal changed elsewhere. Reload it before saving.' using errcode='40001'; end if;
  if current_goal.version=2147483647 then raise exception 'Goal version limit reached.' using errcode='22023'; end if;
  next_version := current_goal.version+1;
 else
  if exists(select 1 from public.goals where id=goal_id) then raise exception 'This goal is unavailable in this account.' using errcode='42501'; end if;
  if p_expected_version<>0 then raise exception 'This goal is no longer available. Reload before saving.' using errcode='40001'; end if;
  if (select count(*) from public.goals where user_id=p_user_id)>=100 then raise exception 'This account has reached its goal limit.' using errcode='22023'; end if;
  next_version := 1;
 end if;
 stamp := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 saved := p_goal||jsonb_build_object('id',goal_id::text,'version',next_version,'createdAt',coalesce(current_goal.document->>'createdAt',stamp),'updatedAt',stamp);
 insert into public.goals(id,user_id,version,document) values(goal_id,p_user_id,next_version,saved)
 on conflict(id) do update set version=excluded.version,document=excluded.document,updated_at=now()
 where public.goals.user_id=p_user_id returning document into saved;
 if not found then raise exception 'This goal is unavailable in this account.' using errcode='42501'; end if;
 insert into public.goal_versions(user_id,goal_id,version,document) values(p_user_id,goal_id,next_version,saved);
 return saved;
end; $$;
revoke all on function public.save_goal(uuid,jsonb,integer) from public,anon;
grant execute on function public.save_goal(uuid,jsonb,integer) to authenticated,service_role;

-- Existing strategy text becomes one goal only when the account has no goals.
-- The original settings value remains untouched for rollback and old clients.
with candidates as (
 select s.user_id,jsonb_build_object('id',gen_random_uuid()::text,'kind','other','title','Imported goal',
   'outcome',s.data->>'strategy','criteria','[]'::jsonb,'openQuestions','[]'::jsonb,'version',1,'status','active',
   'createdAt',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'updatedAt',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) as doc
 from public.settings s where jsonb_typeof(s.data->'strategy')='string' and (s.data->>'strategy') ~ '[^[:space:]]'
 and not exists(select 1 from public.goals g where g.user_id=s.user_id)
), inserted as (
 insert into public.goals(id,user_id,version,document)
 select (doc->>'id')::uuid,user_id,1,doc from candidates where public.valid_goal_document(doc)
 returning user_id,id,version,document
) insert into public.goal_versions(user_id,goal_id,version,document) select user_id,id,version,document from inserted;

do $$ begin
 if has_function_privilege('anon','public.save_goal(uuid,jsonb,integer)','execute')
    or has_table_privilege('authenticated','public.goals','insert')
    or has_table_privilege('authenticated','public.goal_versions','insert') then raise exception 'Goal mutation grants are unsafe.'; end if;
end; $$;
commit;
