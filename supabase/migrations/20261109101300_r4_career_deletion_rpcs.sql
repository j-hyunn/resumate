-- R4 career deletion (DM v4.4 §4.1, §4.2; CR-15).
--   entity_type: experience, education, project, project_deliverable, skill, writing_chat
--                (project_detail / achievement retired).
--   affiliation_mode: only delete_projects (default); keep_projects -> affiliation_mode_not_supported.
--   cascade keys: projects, project_deliverables, project_skills, writing_chats (the target itself is not counted).
--   writing_chat impact: { message_count, last_applied_at }.
--   evidence / source counting covers experience / education / project / project_deliverable / skill rows.

create or replace function private.career_deletion_sources(p_uid uuid, p_entity_type text, p_entity_id uuid,
                                                           p_affiliation_mode text)
returns table (source_type text, source_id uuid)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_project_ids uuid[] := '{}';
  v_deliverable_ids uuid[] := '{}';
begin
  if p_entity_type not in ('experience', 'education', 'project', 'project_deliverable', 'skill') then
    return;
  end if;

  -- v4.4: an experience / education always takes its projects with it (p_affiliation_mode is delete_projects).
  if p_entity_type = 'experience' then
    select coalesce(array_agg(p.id), '{}') into v_project_ids
      from public.projects p where p.experience_id = p_entity_id and p.user_id = p_uid;
  elsif p_entity_type = 'education' then
    select coalesce(array_agg(p.id), '{}') into v_project_ids
      from public.projects p where p.education_id = p_entity_id and p.user_id = p_uid;
  elsif p_entity_type = 'project' then
    v_project_ids := array[p_entity_id];
  end if;

  if p_entity_type = 'project_deliverable' then
    v_deliverable_ids := array[p_entity_id];
  else
    select coalesce(array_agg(d.id), '{}') into v_deliverable_ids
      from public.project_deliverables d where d.project_id = any (v_project_ids) and d.user_id = p_uid;
  end if;

  return query
    select p_entity_type, p_entity_id
    union
    select 'project', u from unnest(v_project_ids) u
    union
    select 'project_deliverable', u from unnest(v_deliverable_ids) u;
end;
$$;

create or replace function public.get_deletion_impact(p_entity_type text, p_entity_id uuid,
                                                      p_affiliation_mode text default 'delete_projects')
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
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
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
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
              'message_count',
                (select count(*) from public.writing_chat_messages m
                  where m.writing_chat_id = w.id and m.user_id = v_uid),
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
   where w.user_id = v_uid and w.project_id = any (v_project_ids);

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

  return jsonb_build_object(
    'cascade', jsonb_build_object(
      'projects', v_projects,
      'project_deliverables', v_deliverables,
      'project_skills', v_project_skills,
      'writing_chats', v_writing_chats),
    'affected_results', jsonb_build_object('by_application_project', v_by_project));
end;
$$;

CREATE OR REPLACE FUNCTION private.career_deletion_section_ids(p_uid uuid, p_entity_type text, p_entity_id uuid, p_affiliation_mode text)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with src as (
    select s.source_type, s.source_id
      from private.career_deletion_sources(p_uid, p_entity_type, p_entity_id, p_affiliation_mode) s
  )
  select coalesce(array_agg(distinct ds.id), '{}')
    from public.draft_sections ds
   where ds.user_id = p_uid and ds.section_kind = 'cover_letter_question'
     and (exists (select 1 from public.evidence_links el
                    join src on src.source_type = el.source_type and src.source_id = el.source_id
                   where el.user_id = p_uid and el.owner_type = 'draft_section' and el.owner_id = ds.id)
          or exists (select 1 from public.draft_section_sources dss
                       join src on (src.source_type = 'experience' and src.source_id = dss.experience_id)
                                or (src.source_type = 'education' and src.source_id = dss.education_id)
                                or (src.source_type = 'project' and src.source_id = dss.project_id)
                      where dss.user_id = p_uid and dss.draft_section_id = ds.id));
$function$;

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
