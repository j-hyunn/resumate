-- S6: career deletion impact on insights (DM §4.2, F-COM-04, D-UX-08 (a)). Same signatures and grants as S2 / S4.
--   * get_deletion_impact.affected_results.by_application_project[] =
--       {application_project_id, name, insights, drafts: 0, draft_sections: 0, interview_sessions: 0}
--     insights = distinct insights with an evidence link (owner_type 'insight') to any row that the deletion removes
--     (cascade included). Only projects with insights > 0, ordered by name. drafts / interview_sessions: S7 / S8.
--   * delete_career_item(result_mode = 'delete_results'): those insight rows are deleted (unit = one insight
--     version, DM §4.2) with their evidence links; when a project's latest goes, the newest remaining ready row
--     becomes latest [가정 S6-3]. keep_results: the links are only marked "source deleted" by the S3 triggers.
-- Insight rows have no user DELETE grant (S6 plan: no individual insight delete in the MVP), so the invoker RPC
-- deletes them through the definer helper private.delete_insights_by_ids (own rows only).

-- Every (source_type, source_id) the deletion removes (the entity + cascade), as evidence source keys.
-- Security invoker: runs under the caller's RLS; p_uid narrows to the caller's rows.
create or replace function private.career_deletion_sources(
  p_uid uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_affiliation_mode text
)
returns table (source_type text, source_id uuid)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_project_ids uuid[] := '{}';
  v_detail_ids uuid[] := '{}';
begin
  if p_entity_type not in ('experience', 'education', 'project', 'project_detail', 'achievement', 'skill') then
    return;
  end if;

  if p_entity_type = 'experience' and p_affiliation_mode = 'delete_projects' then
    select coalesce(array_agg(p.id), '{}') into v_project_ids
      from public.projects p where p.experience_id = p_entity_id and p.user_id = p_uid;
  elsif p_entity_type = 'education' and p_affiliation_mode = 'delete_projects' then
    select coalesce(array_agg(p.id), '{}') into v_project_ids
      from public.projects p where p.education_id = p_entity_id and p.user_id = p_uid;
  elsif p_entity_type = 'project' then
    v_project_ids := array[p_entity_id];
  end if;

  if p_entity_type = 'project_detail' then
    v_detail_ids := array[p_entity_id];
  else
    select coalesce(array_agg(d.id), '{}') into v_detail_ids
      from public.project_details d where d.project_id = any (v_project_ids) and d.user_id = p_uid;
  end if;

  return query
    select p_entity_type, p_entity_id
    union
    select 'project', u from unnest(v_project_ids) u
    union
    select 'project_detail', u from unnest(v_detail_ids) u
    union
    select 'achievement', a.id
      from public.achievements a
     where a.user_id = p_uid
       and (a.project_detail_id = any (v_detail_ids)
            or (p_entity_type = 'experience' and a.experience_id = p_entity_id));
end;
$$;

revoke all on function private.career_deletion_sources(uuid, text, uuid, text) from public;
grant execute on function private.career_deletion_sources(uuid, text, uuid, text) to authenticated;

-- Insights citing any of those rows (caller's rows only, RLS applies).
create or replace function private.career_deletion_insight_ids(
  p_uid uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_affiliation_mode text
)
returns uuid[]
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(array_agg(distinct i.id), '{}')
    from private.career_deletion_sources(p_uid, p_entity_type, p_entity_id, p_affiliation_mode) s
    join public.evidence_links el
      on el.user_id = p_uid and el.owner_type = 'insight'
     and el.source_type = s.source_type and el.source_id = s.source_id
    join public.insights i on i.id = el.owner_id and i.user_id = p_uid;
$$;

revoke all on function private.career_deletion_insight_ids(uuid, text, uuid, text) from public;
grant execute on function private.career_deletion_insight_ids(uuid, text, uuid, text) to authenticated;

-- When a project has no latest insight, the ready row with the highest version_no becomes latest [가정 S6-3].
create or replace function private.insight_promote_latest(p_application_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.insights i
                  where i.application_project_id = p_application_project_id and i.is_latest) then
    update public.insights i
       set is_latest = true
     where i.id = (select i2.id from public.insights i2
                    where i2.application_project_id = p_application_project_id and i2.status = 'ready'
                    order by i2.version_no desc
                    limit 1);
  end if;
end;
$$;

revoke all on function private.insight_promote_latest(uuid) from public;

-- delete_career_item(delete_results): delete the caller's insights in p_ids (evidence goes with them through
-- insights_delete_evidence) and re-pick latest. Lock order: project rows (by id), then insights.
create or replace function private.delete_insights_by_ids(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_projects uuid[];
  v_project uuid;
  v_count integer;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;

  select coalesce(array_agg(distinct i.application_project_id), '{}') into v_projects
    from public.insights i where i.id = any (p_ids) and i.user_id = v_uid;
  perform 1 from public.application_projects ap where ap.id = any (v_projects) order by ap.id for update;

  delete from public.insights i where i.id = any (p_ids) and i.user_id = v_uid;
  get diagnostics v_count = row_count;

  foreach v_project in array v_projects loop
    perform private.insight_promote_latest(v_project);
  end loop;
  return v_count;
end;
$$;

revoke all on function private.delete_insights_by_ids(uuid[]) from public;
grant execute on function private.delete_insights_by_ids(uuid[]) to authenticated;

create or replace function public.get_deletion_impact(
  p_entity_type text,
  p_entity_id uuid,
  p_affiliation_mode text default 'keep_projects'
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_mode text := coalesce(p_affiliation_mode, 'keep_projects');
  v_project_ids uuid[] := '{}';
  v_detail_ids uuid[] := '{}';
  v_projects int := 0;
  v_details int := 0;
  v_achievements int := 0;
  v_project_skills int := 0;
  v_writing_chats int := 0;
  v_found boolean;
  v_by_project jsonb;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  if p_entity_type is null
     or p_entity_type not in ('experience', 'education', 'project', 'project_detail', 'achievement', 'skill',
                              'writing_chat') then
    raise exception using errcode = 'P0001', message = 'invalid_entity_type';
  end if;

  if v_mode not in ('keep_projects', 'delete_projects') then
    raise exception using errcode = 'P0001', message = 'invalid_affiliation_mode';
  end if;

  v_found := case p_entity_type
    when 'experience' then exists (select 1 from public.experiences where id = p_entity_id and user_id = v_uid)
    when 'education' then exists (select 1 from public.educations where id = p_entity_id and user_id = v_uid)
    when 'project' then exists (select 1 from public.projects where id = p_entity_id and user_id = v_uid)
    when 'project_detail' then exists (select 1 from public.project_details where id = p_entity_id and user_id = v_uid)
    when 'achievement' then exists (select 1 from public.achievements where id = p_entity_id and user_id = v_uid)
    when 'skill' then exists (select 1 from public.skills where id = p_entity_id and user_id = v_uid)
    when 'writing_chat' then exists (select 1 from public.writing_chats where id = p_entity_id and user_id = v_uid)
  end;
  if not v_found then
    raise exception using errcode = 'P0001', message = 'career_item_not_found';
  end if;

  if p_entity_type = 'writing_chat' then
    return jsonb_build_object(
      'message_count',
        (select count(*) from public.writing_chat_messages m
          where m.writing_chat_id = p_entity_id and m.user_id = v_uid),
      'linked_saved_rows',
        (select count(*) from public.projects where source_writing_chat_id = p_entity_id and user_id = v_uid)
        + (select count(*) from public.project_details where source_writing_chat_id = p_entity_id and user_id = v_uid)
        + (select count(*) from public.achievements where source_writing_chat_id = p_entity_id and user_id = v_uid));
  end if;

  if p_entity_type = 'experience' and v_mode = 'delete_projects' then
    select coalesce(array_agg(id), '{}') into v_project_ids
      from public.projects where experience_id = p_entity_id and user_id = v_uid;
    v_projects := cardinality(v_project_ids);
  elsif p_entity_type = 'education' and v_mode = 'delete_projects' then
    select coalesce(array_agg(id), '{}') into v_project_ids
      from public.projects where education_id = p_entity_id and user_id = v_uid;
    v_projects := cardinality(v_project_ids);
  elsif p_entity_type = 'project' then
    v_project_ids := array[p_entity_id];
  end if;

  if p_entity_type = 'project_detail' then
    v_detail_ids := array[p_entity_id];
  else
    select coalesce(array_agg(id), '{}') into v_detail_ids
      from public.project_details where project_id = any (v_project_ids) and user_id = v_uid;
    v_details := cardinality(v_detail_ids);
  end if;

  select count(*) into v_achievements
    from public.achievements a
   where a.user_id = v_uid
     and (a.project_detail_id = any (v_detail_ids)
          or (p_entity_type = 'experience' and a.experience_id = p_entity_id));

  select count(*) into v_project_skills
    from public.project_skills ps
   where ps.user_id = v_uid
     and (ps.project_id = any (v_project_ids)
          or (p_entity_type = 'skill' and ps.skill_id = p_entity_id));

  select count(*) into v_writing_chats
    from public.writing_chats w
   where w.user_id = v_uid and w.project_id = any (v_project_ids);

  -- S6: insights citing a removed row, per application project (drafts / interview sessions: S7 / S8).
  select coalesce(jsonb_agg(jsonb_build_object(
           'application_project_id', x.id, 'name', x.name, 'insights', x.insights,
           'drafts', 0, 'draft_sections', 0, 'interview_sessions', 0) order by x.name nulls last, x.id), '[]'::jsonb)
    into v_by_project
    from (select ap.id, ap.name, count(*)::int as insights
            from public.insights i
            join public.application_projects ap on ap.id = i.application_project_id
           where i.id = any (private.career_deletion_insight_ids(v_uid, p_entity_type, p_entity_id, v_mode))
           group by ap.id, ap.name) x;

  return jsonb_build_object(
    'cascade', jsonb_build_object(
      'projects', v_projects,
      'project_details', v_details,
      'achievements', v_achievements,
      'project_skills', v_project_skills,
      'writing_chats', v_writing_chats),
    'affected_results', jsonb_build_object('by_application_project', v_by_project));
end;
$$;

revoke all on function public.get_deletion_impact(text, uuid, text) from public, anon;
grant execute on function public.get_deletion_impact(text, uuid, text) to authenticated;

create or replace function public.delete_career_item(
  p_entity_type text,
  p_entity_id uuid,
  p_affiliation_mode text default 'keep_projects',
  p_result_mode text default 'keep_results'
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_mode text := coalesce(p_affiliation_mode, 'keep_projects');
  v_result_mode text := coalesce(p_result_mode, 'keep_results');
  v_impact jsonb;
  v_insight_ids uuid[] := '{}';
begin
  if v_result_mode not in ('keep_results', 'delete_results') then
    raise exception using errcode = 'P0001', message = 'invalid_result_mode';
  end if;

  -- Validates auth, entity_type, affiliation_mode, ownership; counts what will go.
  v_impact := public.get_deletion_impact(p_entity_type, p_entity_id, v_mode);

  -- S6: collect before the rows go (the cascade set is computed from live rows).
  if v_result_mode = 'delete_results' then
    v_insight_ids := private.career_deletion_insight_ids(v_uid, p_entity_type, p_entity_id, v_mode);
  end if;

  case p_entity_type
    when 'experience' then
      if v_mode = 'delete_projects' then
        delete from public.projects where experience_id = p_entity_id and user_id = v_uid;
      end if;
      -- keep_projects: projects.experience_id is set null by the FK; experience-level
      -- achievements cascade.
      delete from public.experiences where id = p_entity_id and user_id = v_uid;
    when 'education' then
      if v_mode = 'delete_projects' then
        delete from public.projects where education_id = p_entity_id and user_id = v_uid;
      end if;
      delete from public.educations where id = p_entity_id and user_id = v_uid;
    when 'project' then
      delete from public.projects where id = p_entity_id and user_id = v_uid;
    when 'project_detail' then
      -- The detail trigger recalculates the parent project's status.
      delete from public.project_details where id = p_entity_id and user_id = v_uid;
    when 'achievement' then
      delete from public.achievements where id = p_entity_id and user_id = v_uid;
    when 'skill' then
      delete from public.skills where id = p_entity_id and user_id = v_uid;
    when 'writing_chat' then
      -- Messages cascade; career rows keep existing with source_writing_chat_id = null (DM §3.4).
      delete from public.writing_chats where id = p_entity_id and user_id = v_uid;
  end case;

  if not found then
    raise exception using errcode = 'P0001', message = 'career_item_not_found';
  end if;

  -- DM §4.2 result unit = one insight version. writing_chat has no result impact (ids stay empty).
  perform private.delete_insights_by_ids(v_insight_ids);

  return jsonb_build_object(
    'entity_type', p_entity_type,
    'entity_id', p_entity_id,
    'affiliation_mode', v_mode,
    'result_mode', v_result_mode) || v_impact;
end;
$$;

revoke all on function public.delete_career_item(text, uuid, text, text) from public, anon;
grant execute on function public.delete_career_item(text, uuid, text, text) to authenticated;
