-- R11 OD-I6 (DM v4.11 2.7.2 삭제 영향, 4.2, 7장, 11.6 #5): get_deletion_impact
--   * entity_type 'application_project' (affiliation_mode ignored): owner check (not_found) then
--     {cascade: {insights, drafts, interview_sessions, stage_events}, kept: {interview_sessions}}.
--     cascade.interview_sessions = sessions that the delete will remove (status <> 'completed'), kept = completed.
--     insights / drafts / stage_events = the data layer's current count (getApplicationDeletionImpact): every insight
--     row, drafts except a composing career description (countsAsDraft), every stage event.
--   * career kinds: affected_results.detached_interview_sessions = affected sessions whose application project is
--     already gone (by_application_project joins the projects, so they were missing).
-- delete_career_item keeps its entity list: 'application_project' -> invalid_entity_type (deleting an application
-- project stays the direct table delete).

CREATE OR REPLACE FUNCTION public.get_deletion_impact(p_entity_type text, p_entity_id uuid, p_affiliation_mode text DEFAULT 'delete_projects'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_mode text := coalesce(p_affiliation_mode, 'delete_projects');
  v_project_ids uuid[] := '{}';
  v_projects int := 0;
  v_deliverables int := 0;
  v_project_skills int := 0;
  v_writing_chats int := 0;
  v_found boolean;
  v_by_project jsonb;
  v_insight_ids uuid[];
  v_draft_ids uuid[];
  v_section_ids uuid[];
  v_session_ids uuid[];
  v_detached int := 0;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  -- OD-I6: application project deletion impact (C-05 on S-13).
  if p_entity_type = 'application_project' then
    if not exists (select 1 from public.application_projects ap where ap.id = p_entity_id and ap.user_id = v_uid) then
      raise exception using errcode = 'P0001', message = 'not_found';
    end if;
    return jsonb_build_object(
      'cascade', jsonb_build_object(
        'insights', (select count(*)::int from public.insights i
                      where i.application_project_id = p_entity_id and i.user_id = v_uid),
        'drafts', (select count(*)::int from public.drafts d
                    where d.application_project_id = p_entity_id and d.user_id = v_uid
                      and not (d.draft_type = 'career_description' and d.status = 'composing')),
        'interview_sessions', (select count(*)::int from public.interview_sessions s
                                where s.application_project_id = p_entity_id and s.user_id = v_uid
                                  and s.status <> 'completed'),
        'stage_events', (select count(*)::int from public.application_stage_events e
                          where e.application_project_id = p_entity_id and e.user_id = v_uid)),
      'kept', jsonb_build_object(
        'interview_sessions', (select count(*)::int from public.interview_sessions s
                                where s.application_project_id = p_entity_id and s.user_id = v_uid
                                  and s.status = 'completed')));
  end if;

  if p_entity_type is null
     or p_entity_type not in ('experience', 'education', 'project', 'project_deliverable', 'skill',
                              'writing_chat') then
    raise exception using errcode = 'P0001', message = 'invalid_entity_type';
  end if;

  if v_mode = 'keep_projects' then
    -- CR-15: a project left without its experience / education would break the DM-20 shape.
    raise exception using errcode = 'P0001', message = 'affiliation_mode_not_supported';
  elsif v_mode <> 'delete_projects' then
    raise exception using errcode = 'P0001', message = 'invalid_affiliation_mode';
  end if;

  v_found := case p_entity_type
    when 'experience' then exists (select 1 from public.experiences where id = p_entity_id and user_id = v_uid)
    when 'education' then exists (select 1 from public.educations where id = p_entity_id and user_id = v_uid)
    when 'project' then exists (select 1 from public.projects where id = p_entity_id and user_id = v_uid)
    when 'project_deliverable' then exists (select 1 from public.project_deliverables
                                             where id = p_entity_id and user_id = v_uid)
    when 'skill' then exists (select 1 from public.skills where id = p_entity_id and user_id = v_uid)
    when 'writing_chat' then exists (select 1 from public.writing_chats where id = p_entity_id and user_id = v_uid)
  end;
  if not v_found then
    raise exception using errcode = 'P0001', message = 'career_item_not_found';
  end if;

  if p_entity_type = 'writing_chat' then
    -- No result impact; applied STAR stays in the project ("반영된 STAR는 남아요" when last_applied_at is set).
    return (select jsonb_build_object(
              -- QA-R4-03: the column (user + AI messages, greeting excluded, A5) — same number as the panel.
              'message_count', w.message_count,
              'last_applied_at', w.last_applied_at)
              from public.writing_chats w where w.id = p_entity_id and w.user_id = v_uid);
  end if;

  if p_entity_type = 'experience' then
    select coalesce(array_agg(id), '{}') into v_project_ids
      from public.projects where experience_id = p_entity_id and user_id = v_uid;
    v_projects := cardinality(v_project_ids);
  elsif p_entity_type = 'education' then
    select coalesce(array_agg(id), '{}') into v_project_ids
      from public.projects where education_id = p_entity_id and user_id = v_uid;
    v_projects := cardinality(v_project_ids);
  elsif p_entity_type = 'project' then
    v_project_ids := array[p_entity_id];
  end if;

  select count(*) into v_deliverables
    from public.project_deliverables d
   where d.user_id = v_uid and d.project_id = any (v_project_ids);

  select count(*) into v_project_skills
    from public.project_skills ps
   where ps.user_id = v_uid
     and (ps.project_id = any (v_project_ids)
          or (p_entity_type = 'skill' and ps.skill_id = p_entity_id));

  select count(*) into v_writing_chats
    from public.writing_chats w
   where w.user_id = v_uid
     and (w.project_id = any (v_project_ids)
          or (p_entity_type = 'project_deliverable' and w.project_deliverable_id = p_entity_id));

  v_insight_ids := private.career_deletion_insight_ids(v_uid, p_entity_type, p_entity_id, v_mode);
  v_draft_ids := private.career_deletion_draft_ids(v_uid, p_entity_type, p_entity_id, v_mode);
  v_section_ids := private.career_deletion_section_ids(v_uid, p_entity_type, p_entity_id, v_mode);
  v_session_ids := private.career_deletion_interview_session_ids(v_uid, p_entity_type, p_entity_id, v_mode);

  select coalesce(jsonb_agg(jsonb_build_object(
           'application_project_id', ap.id, 'name', ap.name,
           'insights', coalesce(ins.n, 0), 'drafts', coalesce(dr.n, 0), 'draft_sections', coalesce(sec.n, 0),
           'interview_sessions', coalesce(iv.n, 0)) order by ap.name nulls last, ap.id), '[]'::jsonb)
    into v_by_project
    from public.application_projects ap
    left join (select i.application_project_id as id, count(*)::int as n
                 from public.insights i where i.id = any (v_insight_ids) group by 1) ins on ins.id = ap.id
    left join (select d.application_project_id as id, count(*)::int as n
                 from public.drafts d where d.id = any (v_draft_ids) group by 1) dr on dr.id = ap.id
    left join (select d.application_project_id as id, count(*)::int as n
                 from public.draft_sections s join public.drafts d on d.id = s.draft_id
                where s.id = any (v_section_ids) group by 1) sec on sec.id = ap.id
    left join (select s.application_project_id as id, count(*)::int as n
                 from public.interview_sessions s where s.id = any (v_session_ids) group by 1) iv on iv.id = ap.id
   where ap.user_id = v_uid
     and (ins.n is not null or dr.n is not null or sec.n is not null or iv.n is not null);

  -- OD-I6: kept sessions of deleted application projects are still result units (delete_results removes them).
  select count(*)::int into v_detached
    from public.interview_sessions s
   where s.id = any (v_session_ids) and s.user_id = v_uid and s.application_project_id is null;

  return jsonb_build_object(
    'cascade', jsonb_build_object(
      'projects', v_projects,
      'project_deliverables', v_deliverables,
      'project_skills', v_project_skills,
      'writing_chats', v_writing_chats),
    'affected_results', jsonb_build_object('by_application_project', v_by_project,
                                           'detached_interview_sessions', v_detached));
end;
$function$;

revoke all on function public.get_deletion_impact(text, uuid, text) from public, anon;
grant execute on function public.get_deletion_impact(text, uuid, text) to authenticated;

CREATE OR REPLACE FUNCTION public.delete_career_item(p_entity_type text, p_entity_id uuid, p_affiliation_mode text DEFAULT 'delete_projects'::text, p_result_mode text DEFAULT 'keep_results'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_mode text := coalesce(p_affiliation_mode, 'delete_projects');
  v_result_mode text := coalesce(p_result_mode, 'keep_results');
  v_impact jsonb;
  v_insight_ids uuid[] := '{}';
  v_draft_ids uuid[] := '{}';
  v_section_ids uuid[] := '{}';
  v_session_ids uuid[] := '{}';
begin
  if v_result_mode not in ('keep_results', 'delete_results') then
    raise exception using errcode = 'P0001', message = 'invalid_result_mode';
  end if;

  -- get_deletion_impact also answers 'application_project' (OD-I6); that is not a career item.
  if p_entity_type = 'application_project' then
    raise exception using errcode = 'P0001', message = 'invalid_entity_type';
  end if;

  -- Validates auth, entity_type, affiliation_mode, ownership; counts what will go.
  v_impact := public.get_deletion_impact(p_entity_type, p_entity_id, v_mode);

  -- S6 / S7: collect before the rows go (the cascade set is computed from live rows, and the source deletion
  -- triggers mark source rows deleted).
  if v_result_mode = 'delete_results' then
    v_insight_ids := private.career_deletion_insight_ids(v_uid, p_entity_type, p_entity_id, v_mode);
    v_draft_ids := private.career_deletion_draft_ids(v_uid, p_entity_type, p_entity_id, v_mode);
    v_section_ids := private.career_deletion_section_ids(v_uid, p_entity_type, p_entity_id, v_mode);
    v_session_ids := private.career_deletion_interview_session_ids(v_uid, p_entity_type, p_entity_id, v_mode);
  end if;

  case p_entity_type
    when 'experience' then
      -- v4.4 (CR-15): affiliated projects (and their chats) go with it (projects FK on delete cascade).
      delete from public.experiences where id = p_entity_id and user_id = v_uid;
    when 'education' then
      delete from public.educations where id = p_entity_id and user_id = v_uid;
    when 'project' then
      delete from public.projects where id = p_entity_id and user_id = v_uid;
    when 'project_deliverable' then
      -- Not a completion condition: the parent project's status is unaffected.
      delete from public.project_deliverables where id = p_entity_id and user_id = v_uid;
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
  -- S7 (DM §4.2): result unit = the career description document (deleted; users may delete their drafts) /
  -- the cover letter question's generated result (reset, question text and note kept).
  if cardinality(v_draft_ids) > 0 then
    delete from public.drafts d where d.id = any (v_draft_ids) and d.user_id = v_uid;
  end if;
  perform private.reset_cover_letter_sections(v_section_ids);
  if cardinality(v_draft_ids) > 0 or cardinality(v_section_ids) > 0 then
    perform private.cancel_draft_jobs(v_draft_ids, v_section_ids);
  end if;
  -- S8 (DM §4.2): result unit = the interview session (users may delete their sessions, F-P3-15). The session delete
  -- trigger requests cancellation of its running interview jobs.
  if cardinality(v_session_ids) > 0 then
    delete from public.interview_sessions s where s.id = any (v_session_ids) and s.user_id = v_uid;
  end if;

  return jsonb_build_object(
    'entity_type', p_entity_type,
    'entity_id', p_entity_id,
    'affiliation_mode', v_mode,
    'result_mode', v_result_mode) || v_impact;
end;
$function$;

revoke all on function public.delete_career_item(text, uuid, text, text) from public, anon;
grant execute on function public.delete_career_item(text, uuid, text, text) to authenticated;
