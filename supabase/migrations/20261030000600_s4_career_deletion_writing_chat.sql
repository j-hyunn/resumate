-- S4: get_deletion_impact / delete_career_item + entity_type 'writing_chat' and real cascade.writing_chats
-- counts (DM §4.1, §4.2, §3.4). Same signatures and grants as S2 (create or replace).
--   * writing_chat impact = { message_count, linked_saved_rows } only (DM §4.2: no result impact).
--     linked_saved_rows = projects / project_details / achievements whose source_writing_chat_id is the chat
--     (they stay; the FK clears the column). affiliation_mode / result_mode are validated and ignored.
--   * cascade.writing_chats = chats of the projects that are deleted (project, or experience / education with
--     delete_projects). keep_projects only clears writing_chats.experience_id / education_id.
--   * delete_career_item returns the input echo merged with the impact object, so the writing_chat result
--     carries message_count / linked_saved_rows instead of cascade / affected_results.

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

  return jsonb_build_object(
    'cascade', jsonb_build_object(
      'projects', v_projects,
      'project_details', v_details,
      'achievements', v_achievements,
      'project_skills', v_project_skills,
      'writing_chats', v_writing_chats),
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
    when 'writing_chat' then
      -- Messages cascade; career rows keep existing with source_writing_chat_id = null (DM §3.4).
      delete from public.writing_chats where id = p_entity_id and user_id = v_uid;
  end case;

  if not found then
    raise exception using errcode = 'P0001', message = 'career_item_not_found';
  end if;

  return jsonb_build_object(
    'entity_type', p_entity_type,
    'entity_id', p_entity_id,
    'affiliation_mode', v_mode,
    'result_mode', v_result_mode) || v_impact;
end;
$$;

revoke all on function public.delete_career_item(text, uuid, text, text) from public, anon;
grant execute on function public.delete_career_item(text, uuid, text, text) to authenticated;
