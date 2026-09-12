begin;
update public.ai_config set weight=0 where feature='people_search';
-- Each patch merges atomically, including across browser tabs. Client permissions
-- still apply: this function cannot cross accounts or unlock a lapsed account.
create function public.patch_settings(p_user_id uuid,p_patch jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare saved jsonb;
begin
 if p_user_id is distinct from (select auth.uid()) then raise exception 'The account changed.' using errcode='42501'; end if;
 if jsonb_typeof(p_patch) is distinct from 'object' then raise exception 'Settings patch must be an object.' using errcode='22023'; end if;
 insert into public.settings(user_id,data) values(p_user_id,p_patch)
 on conflict(user_id) do update set data=public.settings.data||excluded.data,updated_at=now()
 returning data into saved;
 return saved;
end; $$;
revoke all on function public.patch_settings(uuid,jsonb) from public,anon;
grant execute on function public.patch_settings(uuid,jsonb) to authenticated,service_role;
create index profile_reads_latest on public.profile_reads(user_id,observed_at desc,created_at desc);
create trigger immutable_knowledge_truncate before truncate on public.knowledge_sources for each statement execute function public.guard_outreach_events();
create trigger immutable_profile_reads_truncate before truncate on public.profile_reads for each statement execute function public.guard_outreach_events();
commit;
