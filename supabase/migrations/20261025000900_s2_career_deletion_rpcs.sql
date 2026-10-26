-- S2 RPCs: get_deletion_impact / delete_career_item (DM §4.1, §4.2, F-COM-04, C-05).
-- Both security invoker (DM §5): every read and delete goes through the caller's RLS.
--
-- S2 scope (decisions.md 2026-10-25):
--   * affected_results.by_application_project is always [] — result tables (evidence_links,
--     draft_section_sources, insights, drafts, interview_sessions) arrive in S3, S5–S7, which
--     extend these functions with `create or replace`.
--   * cascade.writing_chats is 0 and entity_type 'writing_chat' is rejected until S4.
--   * result_mode is validated but has nothing to delete yet.
-- Mode values: affiliation_mode ∈ (keep_projects, delete_projects), result_mode ∈
-- (keep_results, delete_results) — UX 02 C-05 names; see spec-gaps 2026-10-25.
-- cascade counts are descendants removed together with the target (the target itself excluded).

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
  v_found boolean;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  if p_entity_type is null
     or p_entity_type not in ('experience', 'education', 'project', 'project_detail', 'achievement', 'skill') then
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
  end;
  if not v_found then
    raise exception using errcode = 'P0001', message = 'career_item_not_found';
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

  return jsonb_build_object(
    'cascade', jsonb_build_object(
      'projects', v_projects,
      'project_details', v_details,
      'achievements', v_achievements,
      'project_skills', v_project_skills,
      'writing_chats', 0),
    'affected_results', jsonb_build_object('by_application_project', '[]'::jsonb));
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
begin
  if v_result_mode not in ('keep_results', 'delete_results') then
    raise exception using errcode = 'P0001', message = 'invalid_result_mode';
  end if;

  -- Validates auth, entity_type, affiliation_mode, ownership; counts what will go.
  v_impact := public.get_deletion_impact(p_entity_type, p_entity_id, v_mode);

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
  end case;

  if not found then
    raise exception using errcode = 'P0001', message = 'career_item_not_found';
  end if;

  return jsonb_build_object(
    'entity_type', p_entity_type,
    'entity_id', p_entity_id,
    'affiliation_mode', v_mode,
    'result_mode', v_result_mode,
    'cascade', v_impact -> 'cascade',
    'affected_results', v_impact -> 'affected_results');
end;
$$;

revoke all on function public.delete_career_item(text, uuid, text, text) from public, anon;
grant execute on function public.delete_career_item(text, uuid, text, text) to authenticated;
