-- S7: career deletion impact on drafts (DM §4.1–4.2, F-COM-04, D-UX-08 (a)). Same signatures and grants as S2 / S4 / S6.
--   * get_deletion_impact.affected_results.by_application_project[] =
--       {application_project_id, name, insights, drafts, draft_sections, interview_sessions: 0}
--     drafts         = career description documents with an evidence link to a removed row (cascade included) or a
--                      section whose header is a removed experience / education.
--     draft_sections = cover letter questions with an evidence link to a removed row, or a source selection
--                      (draft_section_sources experience_id / education_id / project_id / project_detail_ids) on one.
--     Projects with at least one count > 0, ordered by name.
--   * delete_career_item(result_mode = 'delete_results'): career description drafts are deleted (unit = document;
--     sections, sources and evidence go with them); cover letter questions are reset to "not generated"
--     (ai_content / edited_content null, status pending, sources and evidence deleted; question text, note, limit
--     kept). keep_results: only the S3 / S7 source deletion triggers run (evidence quote null, sources marked).

-- Career description drafts citing a removed row (caller's rows, RLS applies).
create or replace function private.career_deletion_draft_ids(
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
  with src as (
    select s.source_type, s.source_id
      from private.career_deletion_sources(p_uid, p_entity_type, p_entity_id, p_affiliation_mode) s
  )
  select coalesce(array_agg(distinct d.id), '{}')
    from public.drafts d
    join public.draft_sections ds on ds.draft_id = d.id
   where d.user_id = p_uid and d.draft_type = 'career_description'
     and (exists (select 1 from public.evidence_links el
                    join src on src.source_type = el.source_type and src.source_id = el.source_id
                   where el.user_id = p_uid and el.owner_type = 'draft_section' and el.owner_id = ds.id)
          or exists (select 1 from src
                      where (src.source_type = 'experience' and src.source_id = ds.experience_id)
                         or (src.source_type = 'education' and src.source_id = ds.education_id)));
$$;

revoke all on function private.career_deletion_draft_ids(uuid, text, uuid, text) from public;
grant execute on function private.career_deletion_draft_ids(uuid, text, uuid, text) to authenticated;

-- Cover letter questions citing or selecting a removed row (caller's rows, RLS applies).
create or replace function private.career_deletion_section_ids(
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
                                or (src.source_type = 'project_detail' and src.source_id = any (dss.project_detail_ids))
                      where dss.user_id = p_uid and dss.draft_section_id = ds.id));
$$;

revoke all on function private.career_deletion_section_ids(uuid, text, uuid, text) from public;
grant execute on function private.career_deletion_section_ids(uuid, text, uuid, text) to authenticated;

-- delete_career_item(delete_results): reset the caller's cover letter questions in p_ids to "not generated" and
-- recompute their drafts. Security definer (users can't write ai_content / sources / evidence).
-- Lock order: project rows, draft rows, section rows (each by id).
create or replace function private.reset_cover_letter_sections(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ids uuid[];
  v_drafts uuid[];
  v_projects uuid[];
  v_draft uuid;
  v_count integer;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;

  select coalesce(array_agg(s.id), '{}'), coalesce(array_agg(distinct s.draft_id), '{}'),
         coalesce(array_agg(distinct d.application_project_id), '{}')
    into v_ids, v_drafts, v_projects
    from public.draft_sections s join public.drafts d on d.id = s.draft_id
   where s.id = any (p_ids) and s.user_id = v_uid and s.section_kind = 'cover_letter_question';
  if cardinality(v_ids) = 0 then
    return 0;
  end if;

  perform 1 from public.application_projects ap where ap.id = any (v_projects) order by ap.id for update;
  perform 1 from public.drafts d where d.id = any (v_drafts) order by d.id for update;
  perform 1 from public.draft_sections s where s.id = any (v_ids) order by s.id for update;

  delete from public.evidence_links el
   where el.owner_type = 'draft_section' and el.owner_id = any (v_ids) and el.user_id = v_uid;
  delete from public.draft_section_sources dss where dss.draft_section_id = any (v_ids) and dss.user_id = v_uid;

  update public.draft_sections s
     set status = 'pending', ai_content = null, edited_content = null, ai_char_count = null,
         correction_applied = false, question_class = null, validation_report = null, usage = null,
         source_selection_mode = 'ai', sources_modified_at = null, completed_at = null,
         ai_job_id = null, run_generation = null, schema_version = null, prompt_version = null, provider = null,
         model = null, model_tier = null, connection_tier = null, input_hash = null, career_snapshot_hash = null
   where s.id = any (v_ids);
  get diagnostics v_count = row_count;

  foreach v_draft in array v_drafts loop
    perform private.draft_recompute_status(v_draft);
  end loop;
  return v_count;
end;
$$;

revoke all on function private.reset_cover_letter_sections(uuid[]) from public;
grant execute on function private.reset_cover_letter_sections(uuid[]) to authenticated;

-- QA-S7-09: delete_results stops the runs that would write into the deleted drafts / reset questions: their
-- queued / running career_description / cover_letter jobs get cancel_requested_at (the runner observes it, same as
-- request_ai_job_cancel). Called last in delete_career_item so the lock order stays application project -> drafts ->
-- sections -> ai_jobs (as a project delete cascade). Caller's jobs only. Returns the number of jobs flagged.
create or replace function private.cancel_draft_jobs(p_draft_ids uuid[], p_section_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  update public.ai_jobs j
     set cancel_requested_at = now()
   where j.user_id = v_uid
     and j.status in ('queued', 'running')
     and j.cancel_requested_at is null
     and ((j.job_type = 'career_description' and j.target_type = 'draft'
           and j.target_id = any (coalesce(p_draft_ids, '{}')))
          or (j.job_type = 'cover_letter' and j.target_type = 'draft_section'
              and j.target_id = any (coalesce(p_section_ids, '{}'))));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function private.cancel_draft_jobs(uuid[], uuid[]) from public;
grant execute on function private.cancel_draft_jobs(uuid[], uuid[]) to authenticated;

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
  v_insight_ids uuid[];
  v_draft_ids uuid[];
  v_section_ids uuid[];
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

  -- S6 / S7: results citing a removed row, per application project (interview sessions: S8).
  --   insights       = insight versions with an evidence link to a removed row
  --   drafts         = career description documents (evidence link or section header on a removed row)
  --   draft_sections = cover letter questions (evidence link or a source selection on a removed row)
  v_insight_ids := private.career_deletion_insight_ids(v_uid, p_entity_type, p_entity_id, v_mode);
  v_draft_ids := private.career_deletion_draft_ids(v_uid, p_entity_type, p_entity_id, v_mode);
  v_section_ids := private.career_deletion_section_ids(v_uid, p_entity_type, p_entity_id, v_mode);

  select coalesce(jsonb_agg(jsonb_build_object(
           'application_project_id', ap.id, 'name', ap.name,
           'insights', coalesce(ins.n, 0), 'drafts', coalesce(dr.n, 0), 'draft_sections', coalesce(sec.n, 0),
           'interview_sessions', 0) order by ap.name nulls last, ap.id), '[]'::jsonb)
    into v_by_project
    from public.application_projects ap
    left join (select i.application_project_id as id, count(*)::int as n
                 from public.insights i where i.id = any (v_insight_ids) group by 1) ins on ins.id = ap.id
    left join (select d.application_project_id as id, count(*)::int as n
                 from public.drafts d where d.id = any (v_draft_ids) group by 1) dr on dr.id = ap.id
    left join (select d.application_project_id as id, count(*)::int as n
                 from public.draft_sections s join public.drafts d on d.id = s.draft_id
                where s.id = any (v_section_ids) group by 1) sec on sec.id = ap.id
   where ap.user_id = v_uid
     and (ins.n is not null or dr.n is not null or sec.n is not null);

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
  v_draft_ids uuid[] := '{}';
  v_section_ids uuid[] := '{}';
begin
  if v_result_mode not in ('keep_results', 'delete_results') then
    raise exception using errcode = 'P0001', message = 'invalid_result_mode';
  end if;

  -- Validates auth, entity_type, affiliation_mode, ownership; counts what will go.
  v_impact := public.get_deletion_impact(p_entity_type, p_entity_id, v_mode);

  -- S6 / S7: collect before the rows go (the cascade set is computed from live rows, and the source deletion
  -- triggers remove project_detail_ids entries).
  if v_result_mode = 'delete_results' then
    v_insight_ids := private.career_deletion_insight_ids(v_uid, p_entity_type, p_entity_id, v_mode);
    v_draft_ids := private.career_deletion_draft_ids(v_uid, p_entity_type, p_entity_id, v_mode);
    v_section_ids := private.career_deletion_section_ids(v_uid, p_entity_type, p_entity_id, v_mode);
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
  -- S7 (DM §4.2): result unit = the career description document (deleted; users may delete their drafts) /
  -- the cover letter question's generated result (reset, question text and note kept).
  if cardinality(v_draft_ids) > 0 then
    delete from public.drafts d where d.id = any (v_draft_ids) and d.user_id = v_uid;
  end if;
  perform private.reset_cover_letter_sections(v_section_ids);
  if cardinality(v_draft_ids) > 0 or cardinality(v_section_ids) > 0 then
    perform private.cancel_draft_jobs(v_draft_ids, v_section_ids);
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
