begin;

alter table public.outreach_events add column goal_id uuid,add column goal_version integer,add column request_id uuid,add column request_payload jsonb,add column due_at timestamptz;
alter table public.outreach_events add constraint events_goal_owner foreign key(user_id,goal_id) references public.goals(user_id,id) on delete restrict;
alter table public.outreach_events add constraint events_goal_version foreign key(user_id,goal_id,goal_version) references public.goal_versions(user_id,goal_id,version) on delete restrict;
alter table public.outreach_events add constraint events_goal_pair check((goal_id is null)=(goal_version is null));
alter table public.outreach_events add constraint events_request_pair check((request_id is null)=(request_payload is null));
alter table public.outreach_events add constraint events_request_bound check(request_payload is null or (jsonb_typeof(request_payload)='object' and octet_length(request_payload::text)<=12000));
alter table public.outreach_events drop constraint outreach_events_kind_check;
alter table public.outreach_events add constraint outreach_events_kind_check check(kind in ('contacted','replied','coffee_chat','note','promise_made','promise_kept','stage_change','next_step','next_step_completed'));
alter table public.outreach_events add constraint next_step_body check(kind<>'next_step' or length(btrim(body))>0);
alter table public.outreach_events add constraint next_step_reference check(kind<>'next_step_completed' or related_event_id is not null);
alter table public.outreach_events add constraint commitment_due_date check(due_at is null or kind in ('promise_made','next_step'));
create unique index interaction_request_once on public.outreach_events(user_id,request_id) where request_id is not null;
create unique index next_step_completion_once on public.outreach_events(user_id,related_event_id) where kind='next_step_completed';
create index interactions_goal on public.outreach_events(user_id,goal_id,created_at desc);

create or replace function public.guard_outreach_events() returns trigger language plpgsql security invoker set search_path='' as $$
declare previous public.outreach_events;
begin
 if tg_op<>'INSERT' then raise exception 'Interaction history is append-only.' using errcode='42501'; end if;
 if new.kind in ('promise_kept','next_step_completed') then
  select * into previous from public.outreach_events where user_id=new.user_id and relationship_id=new.relationship_id and id=new.related_event_id;
  if not found or previous.kind<>(case when new.kind='promise_kept' then 'promise_made' else 'next_step' end)
     or previous.goal_id is distinct from new.goal_id then raise exception 'Complete the matching commitment for this person and goal.' using errcode='23514'; end if;
 end if;
 return new;
end; $$;

create table public.candidate_observations (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.users(user_id) on delete restrict,
 relationship_id uuid not null,goal_id uuid,request_id uuid not null,
 field text not null check(field in ('name','company','role','industry','location','stage','check_size','education','skill','email','url','context','custom')),
 text text not null check(length(btrim(text)) between 1 and 8000),
 source_kind text not null check(source_kind in ('manual','authorized_export','public_source')),
 source_label text not null check(length(btrim(source_label)) between 1 and 200),source_ref text not null default '' check(length(source_ref)<=2000),
 applies_to text not null check(applies_to in ('contact','opportunity')),polarity text not null default 'positive' check(polarity in ('positive','negative')),
 observed_at timestamptz not null,confirmed_at timestamptz not null default now(),created_at timestamptz not null default now(),supersedes_id uuid,
 request_payload jsonb not null check(jsonb_typeof(request_payload)='object' and octet_length(request_payload::text)<=16000),
 unique(user_id,id),unique(user_id,relationship_id,id),unique(user_id,request_id),
 foreign key(user_id,relationship_id) references public.outreach_log(user_id,id) on delete restrict,
 foreign key(user_id,goal_id) references public.goals(user_id,id) on delete restrict,
 foreign key(user_id,relationship_id,supersedes_id) references public.candidate_observations(user_id,relationship_id,id) on delete restrict
);
create unique index observation_correction_once on public.candidate_observations(user_id,supersedes_id) where supersedes_id is not null;
create table public.message_drafts (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.users(user_id) on delete restrict,
 relationship_id uuid not null,goal_id uuid not null,goal_version integer not null,request_id uuid not null,
 evidence_fingerprint text not null check(evidence_fingerprint ~ '^[a-f0-9]{64}$'),evidence_ids jsonb not null check(jsonb_typeof(evidence_ids)='array' and jsonb_array_length(evidence_ids)<=200),
 channel text not null check(channel in ('email','linkedin')),purpose text not null check(length(btrim(purpose)) between 1 and 2000),body text not null check(length(body)<=16000),
 status text not null default 'draft' check(status in ('draft','copied','archived')),revision integer not null default 1 check(revision>0),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),request_payload jsonb not null check(jsonb_typeof(request_payload)='object' and octet_length(request_payload::text)<=65536),
 unique(user_id,request_id),foreign key(user_id,relationship_id) references public.outreach_log(user_id,id) on delete restrict,
 foreign key(user_id,goal_id) references public.goals(user_id,id) on delete restrict,
 foreign key(user_id,goal_id,goal_version) references public.goal_versions(user_id,goal_id,version) on delete restrict
);
alter table public.candidate_observations enable row level security;
alter table public.message_drafts enable row level security;
create policy observations_select on public.candidate_observations for select to authenticated using(user_id=(select auth.uid()));
create policy drafts_select on public.message_drafts for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.candidate_observations,public.message_drafts from public,anon,authenticated;
grant select on public.candidate_observations,public.message_drafts to anon,authenticated;
grant all on public.candidate_observations,public.message_drafts to service_role;
create index observations_relationship on public.candidate_observations(user_id,relationship_id,created_at desc);
create index drafts_relationship on public.message_drafts(user_id,relationship_id,updated_at desc);
create trigger observation_immutable before update or delete on public.candidate_observations for each row execute function public.guard_goal_history();
create trigger observation_no_truncate before truncate on public.candidate_observations for each statement execute function public.guard_goal_history();

create function public.assert_relationship_context(p_user_id uuid,p_relationship_id uuid,p_goal_id uuid,p_goal_version integer) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if p_user_id is null or p_user_id is distinct from (select auth.uid()) then raise exception 'The relationship account changed.' using errcode='42501'; end if;
 perform 1 from public.users where user_id=p_user_id and account_status='active' for update;
 if not found then raise exception 'An active account is required.' using errcode='42501'; end if;
 if not exists(select 1 from public.outreach_log where user_id=p_user_id and id=p_relationship_id) then raise exception 'This person is unavailable in this account.' using errcode='42501'; end if;
 if p_goal_id is not null and not exists(select 1 from public.goals where user_id=p_user_id and id=p_goal_id) then raise exception 'This goal is unavailable in this account.' using errcode='42501'; end if;
 if p_goal_version is not null and (p_goal_id is null or not exists(select 1 from public.goal_versions where user_id=p_user_id and goal_id=p_goal_id and version=p_goal_version)) then raise exception 'This goal version is unavailable.' using errcode='42501'; end if;
end; $$;
revoke all on function public.assert_relationship_context(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.assert_relationship_context(uuid,uuid,uuid,integer) to service_role;

create function public.save_candidate_observation(p_user_id uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare rid uuid;gid uuid;request uuid;previous public.candidate_observations;saved public.candidate_observations;superseded uuid;
begin
 rid:=(p_input->>'relationshipId')::uuid;gid:=(p_input->>'goalId')::uuid;request:=(p_input->>'requestId')::uuid;superseded:=(p_input->>'supersedesId')::uuid;
 perform public.assert_relationship_context(p_user_id,rid,gid,null);
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>16000 or p_input->'confirmed' is distinct from 'true'::jsonb or request is null
    or jsonb_typeof(p_input->'text') is distinct from 'string' or jsonb_typeof(p_input->'sourceLabel') is distinct from 'string'
    or p_input::text ~ '\\u00(0[1-8bef]|1[0-9a-f]|7f)'
    or p_input-array['requestId','relationshipId','goalId','field','text','sourceKind','sourceLabel','sourceRef','appliesTo','polarity','observedAt','confirmed','supersedesId']<>'{}'::jsonb then raise exception 'Confirm valid, bounded evidence before saving.' using errcode='22023'; end if;
 select * into previous from public.candidate_observations where user_id=p_user_id and request_id=request;
 if found then
  if previous.request_payload<>p_input then raise exception 'This observation request already contains different evidence.' using errcode='23505'; end if;
  return to_jsonb(previous);
 end if;
 if superseded is not null and not exists(select 1 from public.candidate_observations where user_id=p_user_id and relationship_id=rid and id=superseded and goal_id is not distinct from gid) then raise exception 'The corrected observation is outside this context.' using errcode='42501'; end if;
 if (p_input->>'sourceKind')='public_source' and coalesce(p_input->>'sourceRef','') !~ '^https?://[^[:space:]]+$' then raise exception 'Public evidence needs a source URL.' using errcode='22023'; end if;
 insert into public.candidate_observations(user_id,relationship_id,goal_id,request_id,field,text,source_kind,source_label,source_ref,applies_to,polarity,observed_at,supersedes_id,request_payload)
 values(p_user_id,rid,gid,request,p_input->>'field',p_input->>'text',p_input->>'sourceKind',p_input->>'sourceLabel',coalesce(p_input->>'sourceRef',''),p_input->>'appliesTo',coalesce(p_input->>'polarity','positive'),coalesce((p_input->>'observedAt')::timestamptz,now()),superseded,p_input) returning * into saved;
 return to_jsonb(saved);
end; $$;
revoke all on function public.save_candidate_observation(uuid,jsonb) from public,anon;
grant execute on function public.save_candidate_observation(uuid,jsonb) to authenticated,service_role;

create function public.record_goal_interaction(p_user_id uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare rid uuid;gid uuid;gv integer;request uuid;related uuid;event_kind text;previous public.outreach_events;saved public.outreach_events;
begin
 rid:=(p_input->>'relationshipId')::uuid;gid:=(p_input->>'goalId')::uuid;gv:=(p_input->>'goalVersion')::integer;request:=(p_input->>'requestId')::uuid;related:=(p_input->>'relatedEventId')::uuid;event_kind:=p_input->>'kind';
 perform public.assert_relationship_context(p_user_id,rid,gid,gv);
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>12000 or request is null
    or (p_input ? 'body' and jsonb_typeof(p_input->'body') is distinct from 'string') or p_input::text ~ '\\u00(0[1-8bef]|1[0-9a-f]|7f)'
    or p_input-array['requestId','relationshipId','goalId','goalVersion','kind','body','relatedEventId','dueAt']<>'{}'::jsonb then raise exception 'The interaction is invalid or too large.' using errcode='22023'; end if;
 select * into previous from public.outreach_events where user_id=p_user_id and request_id=request;
 if found then
  if previous.request_payload is distinct from p_input then raise exception 'This request already recorded a different interaction.' using errcode='23505'; end if;
  return to_jsonb(previous);
 end if;
 if event_kind in ('promise_kept','next_step_completed') then
  select * into previous from public.outreach_events where user_id=p_user_id and relationship_id=rid and id=related;
  if not found or previous.kind<>(case when event_kind='promise_kept' then 'promise_made' else 'next_step' end)
     or (gid is not null and gid is distinct from previous.goal_id) then raise exception 'Choose the matching commitment for this person and goal.' using errcode='23514'; end if;
  gid:=previous.goal_id;gv:=coalesce(gv,previous.goal_version);
  select * into saved from public.outreach_events where user_id=p_user_id and related_event_id=related and kind=event_kind;
  if found then return to_jsonb(saved); end if;
 end if;
 if gid is not null and gv is null then select version into gv from public.goals where user_id=p_user_id and id=gid; end if;
 perform public.assert_relationship_context(p_user_id,rid,gid,gv);
 insert into public.outreach_events(user_id,relationship_id,goal_id,goal_version,request_id,request_payload,kind,body,related_event_id,due_at)
 values(p_user_id,rid,gid,gv,request,p_input,event_kind,coalesce(p_input->>'body',''),related,(p_input->>'dueAt')::timestamptz) returning * into saved;
 return to_jsonb(saved);
end; $$;
revoke all on function public.record_goal_interaction(uuid,jsonb) from public,anon;
grant execute on function public.record_goal_interaction(uuid,jsonb) to authenticated,service_role;

create function public.save_message_draft(p_user_id uuid,p_input jsonb,p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare rid uuid;gid uuid;gv integer;request uuid;previous public.message_drafts;saved public.message_drafts;next_revision integer;item jsonb;
begin
 rid:=(p_input->>'relationshipId')::uuid;gid:=(p_input->>'goalId')::uuid;gv:=(p_input->>'goalVersion')::integer;request:=(p_input->>'requestId')::uuid;
 perform public.assert_relationship_context(p_user_id,rid,gid,gv);
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>65536 or request is null or gid is null or gv is null or p_expected_revision is null or p_expected_revision<0
    or jsonb_typeof(p_input->'body') is distinct from 'string' or jsonb_typeof(p_input->'purpose') is distinct from 'string' or p_input::text ~ '\\u00(0[1-8bef]|1[0-9a-f]|7f)'
    or p_input-array['requestId','relationshipId','goalId','goalVersion','evidenceFingerprint','evidenceIds','channel','purpose','body','status']<>'{}'::jsonb
    or jsonb_typeof(p_input->'evidenceIds') is distinct from 'array' or jsonb_array_length(p_input->'evidenceIds')>200 then raise exception 'The draft context is invalid or too large.' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(p_input->'evidenceIds') loop
  if jsonb_typeof(item)<>'string' or length(item #>> '{}') not between 1 and 200 then raise exception 'The draft evidence references are invalid.' using errcode='22023'; end if;
 end loop;
 select * into previous from public.message_drafts where user_id=p_user_id and request_id=request for update;
 if found then
  if previous.request_payload=p_input and p_expected_revision<=previous.revision then return to_jsonb(previous); end if;
  if previous.revision<>p_expected_revision then raise exception 'This draft changed elsewhere. Reload before saving.' using errcode='40001'; end if;
  if previous.relationship_id<>rid or previous.goal_id<>gid or previous.goal_version<>gv or previous.evidence_fingerprint is distinct from (p_input->>'evidenceFingerprint')
     or previous.evidence_ids is distinct from p_input->'evidenceIds' then raise exception 'Changed context requires a new draft request.' using errcode='22023'; end if;
  next_revision:=previous.revision+1;
  update public.message_drafts set channel=p_input->>'channel',purpose=p_input->>'purpose',body=p_input->>'body',status=coalesce(p_input->>'status','draft'),revision=next_revision,request_payload=p_input,updated_at=now()
   where id=previous.id and user_id=p_user_id returning * into saved;
 else
  if p_expected_revision<>0 then raise exception 'This draft is unavailable. Reload before saving.' using errcode='40001'; end if;
  insert into public.message_drafts(user_id,relationship_id,goal_id,goal_version,request_id,evidence_fingerprint,evidence_ids,channel,purpose,body,status,request_payload)
  values(p_user_id,rid,gid,gv,request,p_input->>'evidenceFingerprint',p_input->'evidenceIds',p_input->>'channel',p_input->>'purpose',p_input->>'body',coalesce(p_input->>'status','draft'),p_input) returning * into saved;
 end if;
 if saved.id is null then raise exception 'The draft was not saved.' using errcode='42501'; end if;
 return to_jsonb(saved);
end; $$;
revoke all on function public.save_message_draft(uuid,jsonb,integer) from public,anon;
grant execute on function public.save_message_draft(uuid,jsonb,integer) to authenticated,service_role;

do $$ begin
 if has_function_privilege('anon','public.save_message_draft(uuid,jsonb,integer)','execute') or has_function_privilege('anon','public.record_goal_interaction(uuid,jsonb)','execute')
    or has_table_privilege('authenticated','public.candidate_observations','insert') or has_table_privilege('authenticated','public.message_drafts','update') then raise exception 'Relationship-context grants are unsafe.'; end if;
end; $$;
commit;
