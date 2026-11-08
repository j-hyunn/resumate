-- DESTRUCTIVE: AI 모의 면접 MVP 제외(RM-1~RM-5) — 면접 테이블 5개 drop(interview_sessions, interview_questions, interview_answers, answer_evaluations, session_feedbacks와 그 데이터), 면접 값 행 삭제(evidence_links 면접 소유자·interview_answer 출처, ai_jobs·ai_usage_records 면접 작업, application_stage_events 면접 단계 이력). 되돌릴 수 없다.
--
-- R14 (decisions 3.26·4.20, DM 11.9). One file, one transaction (supabase applies each migration file in a
-- transaction; the explicit begin/commit is not used so the CLI's own transaction wraps it).
-- Order (DM 11.9 (1)/(2)):
--   0. guard: stop if any application project sits on an interview stage (RM-4, count only)
--   R. replace the RPCs that read interview objects (current definitions minus the interview branches)
--   1. drop the interview triggers living on surviving tables (application_projects, ai_jobs)
--   2. delete interview evidence rows   3. delete interview ai_usage_records / ai_jobs (RM-A2)
--   4. delete interview stage history (RM-5)   5. writing_chats.return_target job_interview -> null (RM-A1)
--   6. drop the 5 interview tables (no cascade). Functions whose signature uses an interview table's row type
--      must go first, or the drop stops on the type dependency (deviation from DM 11.9, see notes).
--   7. drop the remaining interview functions   8. redefine the CHECKs   9. undo OD-I6 (application_project_id not null)
-- Names and signatures were taken from the local DB (pg_proc / pg_trigger / pg_constraint), 2026-11-08.

-- 0. Guard (RM-4) ---------------------------------------------------------------------------------------------
do $$
declare
  v_n bigint;
begin
  select count(*) into v_n from public.application_projects
   where stage in ('job_interview', 'culture_fit_interview');
  if v_n > 0 then
    raise exception 'r14_remove_mock_interview: % application project(s) are on an interview stage; resolve them first', v_n;
  end if;

  -- DM 11.9 step 2: an interview_answer source must only hang off an interview owner.
  select count(*) into v_n from public.evidence_links
   where source_type = 'interview_answer'
     and owner_type not in ('interview_question', 'answer_evaluation', 'session_feedback');
  if v_n > 0 then
    raise exception 'r14_remove_mock_interview: % evidence row(s) quote an interview answer outside an interview owner', v_n;
  end if;
end;
$$;

-- R. Replaced RPCs (security, grants and owners are kept by create or replace) ----------------------------------
-- private.delete_account_data
CREATE OR REPLACE FUNCTION private.delete_account_data(p_uid uuid, p_subject_hash text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_in_flight integer;
  v_keys integer;
  v_logged integer;
  v_now timestamptz := now();
  v_done timestamptz;
begin
  if p_uid is null then
    raise exception using errcode = 'P0001', message = 'invalid_user_id';
  end if;
  if p_subject_hash is null or p_subject_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'invalid_subject_hash';
  end if;
  if p_reason is null or p_reason not in ('user_request', 'inactivity') then
    raise exception using errcode = 'P0001', message = 'invalid_reason';
  end if;

  -- One deletion at a time per user (double submit / retry while the first call still runs, or the cron and the
  -- user at the same time).
  perform pg_advisory_xact_lock(hashtextextended('resumate.delete_account:' || p_uid::text, 0));

  select count(*)::integer into v_in_flight
    from public.ai_jobs j
   where j.user_id = p_uid and j.status in ('queued', 'running');

  -- 1. Usage records first: avoids the set-null updates the application project cascade would make.
  delete from public.ai_usage_records t where t.user_id = p_uid;

  -- 2. Application projects (lock order: projects by id first, like delete_career_item), cascading to
  --    job_descriptions, jd_requirements, insights, drafts, draft_sections, draft_section_sources,
  --    application_stage_events, evidence_links and project-scoped ai_jobs.
  perform 1 from public.application_projects ap where ap.user_id = p_uid order by ap.id for update;
  delete from public.application_projects t where t.user_id = p_uid;

  -- Sweep anything of the application area that did not hang off a project (all should be gone already).
  delete from public.evidence_links t where t.user_id = p_uid;
  delete from public.draft_section_sources t where t.user_id = p_uid;
  delete from public.draft_sections t where t.user_id = p_uid;
  delete from public.drafts t where t.user_id = p_uid;
  delete from public.insights t where t.user_id = p_uid;
  delete from public.jd_requirements t where t.user_id = p_uid;
  delete from public.job_descriptions t where t.user_id = p_uid;
  delete from public.application_stage_events t where t.user_id = p_uid;

  -- 3. AI writing chats: chats locked first, then messages (S4 locks chat -> messages, QA-S9-02).
  perform 1 from public.writing_chats w where w.user_id = p_uid order by w.id for update;
  delete from public.writing_chats t where t.user_id = p_uid;
  delete from public.writing_chat_messages t where t.user_id = p_uid;

  -- 4. Career data, leaves first.
  delete from public.project_deliverables t where t.user_id = p_uid;
  delete from public.project_skills t where t.user_id = p_uid;
  delete from public.projects t where t.user_id = p_uid;
  delete from public.skills t where t.user_id = p_uid;
  delete from public.educations t where t.user_id = p_uid;
  delete from public.experiences t where t.user_id = p_uid;

  -- 5. Jobs not tied to an application project (writing chat turns, key verification, ...).
  delete from public.ai_jobs t where t.user_id = p_uid;

  -- 6. Provider keys: immediate hard delete (NFR-KEY-06). FK sets profiles.active_ai_provider null.
  delete from public.ai_provider_keys t where t.user_id = p_uid;
  get diagnostics v_keys = row_count;

  -- 7. Consent history: deleted; the de-identified log below is the only proof kept (D-DM-02 (b)).
  delete from public.ai_data_use_consents t where t.user_id = p_uid;
  delete from public.consents t where t.user_id = p_uid;

  -- 7a. R13: 내 정보 관심 직군·직무 쌍 (profile_job_interests). The auth.users cascade would also take it, but
  --     delete_account must leave no user row behind on its own (DM §4.3, account_deletion.test.sql).
  delete from public.profile_job_interests t where t.user_id = p_uid;

  -- 8. Profile.
  delete from public.profiles t where t.id = p_uid;

  -- 9. De-identified log (A.17). A repeated call with the same hash keeps the first row.
  v_done := clock_timestamp();
  insert into public.account_deletion_logs (subject_hash, requested_at, db_deleted_at, storage_deleted_at, reason)
  values (p_subject_hash, v_now, greatest(v_done, v_now), null, p_reason)
  on conflict (subject_hash) do nothing;
  get diagnostics v_logged = row_count;

  return jsonb_build_object(
    'deleted', true,
    'log_written', v_logged > 0,
    'in_flight_jobs', v_in_flight,
    'deleted_provider_keys', v_keys,
    'db_deleted_at', greatest(v_done, v_now));
end;
$function$;

-- public.get_account_deletion_summary
CREATE OR REPLACE FUNCTION public.get_account_deletion_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_keys integer;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  -- authenticated has no SELECT on ai_provider_keys.user_id (metadata column grants only, DM 2.11.1): count through
  -- the security-invoker metadata view, whose RLS already limits rows to the caller.
  select count(k.id)::integer into v_keys from public.ai_provider_keys_public k;

  return jsonb_build_object(
    'career', jsonb_build_object(
      'experiences', (select count(*) from public.experiences t where t.user_id = v_uid),
      'educations', (select count(*) from public.educations t where t.user_id = v_uid),
      'projects', (select count(*) from public.projects t where t.user_id = v_uid),
      'project_deliverables', (select count(*) from public.project_deliverables t where t.user_id = v_uid),
      'skills', (select count(*) from public.skills t where t.user_id = v_uid),
      'writing_chats', (select count(*) from public.writing_chats t where t.user_id = v_uid)),
    'applications', jsonb_build_object(
      'application_projects', (select count(*) from public.application_projects t where t.user_id = v_uid),
      'insights', (select count(*) from public.insights t where t.user_id = v_uid),
      'drafts', (select count(*) from public.drafts t where t.user_id = v_uid),
      'application_stage_events',
        (select count(*) from public.application_stage_events t where t.user_id = v_uid)),
    'ai_connection', jsonb_build_object(
      'provider_keys', v_keys,
      'ai_data_use_consents', (select count(*) from public.ai_data_use_consents t where t.user_id = v_uid),
      'usage_records', (select count(*) from public.ai_usage_records t where t.user_id = v_uid),
      'has_provider_keys', v_keys > 0));
end;
$function$;

-- public.get_deletion_impact
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
        'stage_events', (select count(*)::int from public.application_stage_events e
                          where e.application_project_id = p_entity_id and e.user_id = v_uid)));
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

  select coalesce(jsonb_agg(jsonb_build_object(
           'application_project_id', ap.id, 'name', ap.name,
           'insights', coalesce(ins.n, 0), 'drafts', coalesce(dr.n, 0), 'draft_sections', coalesce(sec.n, 0))
           order by ap.name nulls last, ap.id), '[]'::jsonb)
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
      'project_deliverables', v_deliverables,
      'project_skills', v_project_skills,
      'writing_chats', v_writing_chats),
    'affected_results', jsonb_build_object('by_application_project', v_by_project));
end;
$function$;

-- public.delete_career_item
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

  return jsonb_build_object(
    'entity_type', p_entity_type,
    'entity_id', p_entity_id,
    'affiliation_mode', v_mode,
    'result_mode', v_result_mode) || v_impact;
end;
$function$;

-- public.get_data_readiness
CREATE OR REPLACE FUNCTION public.get_data_readiness()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := private.current_uid();
  v_complete_experiences int;
  v_complete_educations int;
  v_complete_projects int;
  v_without_star int;
  v_standalone_without_description int;
  v_draft_experiences int;
  v_draft_educations int;
  v_draft_projects int;
  v_star_project_id uuid;
  v_fields_project_id uuid;
  v_missing jsonb;
  v_hints jsonb;
  v_ready boolean;
  v_gated jsonb;
  v_ai_connection jsonb;
  v_ai_usable boolean;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  -- Projects that can count (DM §2.2): standalone, or under a complete experience / education.
  with rp as (
    select p.id, p.status, p.updated_at,
           num_nonnulls(p.experience_id, p.education_id) = 1 as affiliated
      from public.projects p
      left join public.experiences e on e.id = p.experience_id
      left join public.educations ed on ed.id = p.education_id
     where p.user_id = v_uid
       and (p.experience_id is null or e.status = 'complete')
       and (p.education_id is null or ed.status = 'complete')
  )
  select (select count(*) from rp where rp.status = 'complete'),
         (select count(*) from rp where rp.affiliated and rp.status = 'draft'),
         (select count(*) from rp where not rp.affiliated and rp.status = 'draft'),
         (select rp.id from rp where rp.affiliated and rp.status = 'draft'
           order by rp.updated_at desc, rp.id limit 1),
         (select rp.id from rp where not rp.affiliated and rp.status = 'draft'
           order by rp.updated_at desc, rp.id limit 1)
    into v_complete_projects, v_without_star, v_standalone_without_description,
         v_star_project_id, v_fields_project_id;

  select count(*) filter (where status = 'complete'),
         count(*) filter (where status = 'draft')
    into v_complete_experiences, v_draft_experiences
    from public.experiences where user_id = v_uid;

  select count(*) filter (where status = 'complete'),
         count(*) filter (where status = 'draft')
    into v_complete_educations, v_draft_educations
    from public.educations where user_id = v_uid;

  select count(*) into v_draft_projects
    from public.projects where user_id = v_uid and status = 'draft';

  -- D-01 v4.4 gate shared by insight / draft.
  v_missing := '[]'::jsonb;
  if v_complete_experiences = 0 then
    v_missing := v_missing || '["complete_experience"]'::jsonb;
  end if;
  if v_complete_projects = 0 then
    v_missing := v_missing || '["complete_project"]'::jsonb;
  end if;
  v_ready := jsonb_array_length(v_missing) = 0;

  -- Hints follow the next_action order: STAR first, then a standalone project's description.
  v_hints := '[]'::jsonb;
  if v_complete_projects = 0 and v_without_star > 0 then
    v_hints := v_hints || '["project_star"]'::jsonb;
  elsif v_complete_projects = 0 and v_standalone_without_description > 0 then
    v_hints := v_hints || '["project_fields"]'::jsonb;
  end if;

  v_ai_connection := private.current_ai_connection();
  -- "AI usable" = an active provider whose key is not invalid (needs_check is usable; consent is not used here).
  v_ai_usable := v_ai_connection ->> 'active_provider' is not null
                 and v_ai_connection ->> 'key_status' is distinct from 'invalid';

  v_gated := jsonb_build_object('ready', v_ready, 'missing', v_missing, 'hints', v_hints);
  if not v_ready then
    if v_complete_experiences = 0 then
      v_gated := v_gated || jsonb_build_object('next_action', 'form');
    elsif v_without_star > 0 then
      v_gated := v_gated || jsonb_build_object(
        'next_action', case when v_ai_usable then 'writing_chat' else 'form' end,
        'suggested_project_id', v_star_project_id);
    elsif v_standalone_without_description > 0 then
      v_gated := v_gated || jsonb_build_object('next_action', 'form', 'suggested_project_id', v_fields_project_id);
    else
      v_gated := v_gated || jsonb_build_object(
        'next_action', case when v_ai_usable then 'create_project' else 'form' end);
    end if;
  end if;

  return jsonb_build_object(
    'ai_connection', v_ai_connection,
    'counts', jsonb_build_object(
      'complete_experiences', v_complete_experiences,
      'complete_educations', v_complete_educations,
      'complete_projects', v_complete_projects,
      'projects_without_complete_star', v_without_star,
      'standalone_projects_without_description', v_standalone_without_description,
      'draft_experiences', v_draft_experiences,
      'draft_educations', v_draft_educations,
      'draft_projects', v_draft_projects),
    'draft_item_ids', jsonb_build_object(
      'experiences', coalesce((select jsonb_agg(id order by updated_at desc, id) from public.experiences
                                where user_id = v_uid and status = 'draft'), '[]'::jsonb),
      'educations', coalesce((select jsonb_agg(id order by updated_at desc, id) from public.educations
                               where user_id = v_uid and status = 'draft'), '[]'::jsonb),
      'projects', coalesce((select jsonb_agg(id order by updated_at desc, id) from public.projects
                             where user_id = v_uid and status = 'draft'), '[]'::jsonb)),
    'features', jsonb_build_object(
      'insight', v_gated,
      'draft', v_gated));
end;
$function$;

-- public.move_application_stage
CREATE OR REPLACE FUNCTION public.move_application_stage(p_application_project_id uuid, p_to_stage text, p_outcome text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_project public.application_projects%rowtype;
  v_new_outcome text;
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_to_stage is null or p_to_stage not in (
       'before_apply', 'document', 'assignment', 'closed') then
    raise exception using errcode = 'P0001', message = 'invalid_stage';
  end if;
  if p_outcome is not null and (p_outcome not in ('passed', 'failed') or p_to_stage <> 'closed') then
    raise exception using errcode = 'P0001', message = 'invalid_outcome';
  end if;

  select * into v_project from public.application_projects ap
   where ap.id = p_application_project_id and ap.user_id = v_uid
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'application_project_not_found';
  end if;

  if v_project.stage = p_to_stage then
    return jsonb_build_object(
      'stage', v_project.stage, 'stage_outcome', v_project.stage_outcome,
      'stage_changed_at', v_project.stage_changed_at, 'changed', false);
  end if;

  -- Entering closed: only the given outcome (null = 결과 미기록). Leaving closed: cleared. Other moves: null.
  v_new_outcome := case when p_to_stage = 'closed' then p_outcome end;

  update public.application_projects ap
     set stage = p_to_stage, stage_outcome = v_new_outcome,
         stage_changed_at = v_now, last_activity_at = v_now
   where ap.id = p_application_project_id;

  insert into public.application_stage_events (user_id, application_project_id, event_type,
                                               from_stage, to_stage, from_outcome, to_outcome)
  values (v_uid, p_application_project_id, 'stage_changed',
          v_project.stage, p_to_stage, v_project.stage_outcome, v_new_outcome);

  return jsonb_build_object(
    'stage', p_to_stage, 'stage_outcome', v_new_outcome, 'stage_changed_at', v_now, 'changed', true);
end;
$function$;

-- public.retry_ai_job
CREATE OR REPLACE FUNCTION public.retry_ai_job(p_ai_job_id uuid, p_expected_run_generation integer, p_model text, p_model_tier text, p_run_meta jsonb, p_expected_provider text, p_expected_connection_tier text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := private.current_uid();
  v_job public.ai_jobs%rowtype;
  v_project_id uuid;
  v_active text;
  v_key_status text;
  v_key_tier text;
  v_restarted boolean;
  v_partials jsonb;
  v_meta jsonb;
  v_gen integer;
  v_model text := btrim(p_model);
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  -- Unlocked read to find the target, then locks in the standard order.
  select * into v_job from public.ai_jobs j where j.id = p_ai_job_id and j.user_id = v_uid;
  if not found then
    raise exception using errcode = 'P0001', message = 'ai_job_not_found';
  end if;

  if v_job.application_project_id is not null then
    select ap.id into v_project_id from public.application_projects ap
     where ap.id = v_job.application_project_id and ap.user_id = v_uid
       for update;
  end if;

  select * into v_job from public.ai_jobs j where j.id = p_ai_job_id and j.user_id = v_uid for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ai_job_not_found';
  end if;

  -- Somebody else already moved the row (another retry, purge race): report, don't raise.
  if v_job.status <> 'failed' or v_job.run_generation is distinct from p_expected_run_generation then
    return jsonb_build_object('requeued', false, 'status', v_job.status, 'run_generation', v_job.run_generation);
  end if;

  -- DM 2.9.1: only insight uses the same-row retry; input errors are not retryable (AI C-11).
  if v_job.job_type <> 'insight'
     or v_job.error_code is null or v_job.error_category = 'input'
     or v_project_id is null then
    raise exception using errcode = 'P0001', message = 'ai_job_not_retryable';
  end if;

  if v_model is null or char_length(v_model) not between 1 and 200
     or p_model_tier is null or p_model_tier not in ('light', 'default', 'heavy')
     or p_expected_provider is null or p_expected_provider not in ('openai', 'gemini', 'anthropic')
     or (p_expected_connection_tier is not null and p_expected_connection_tier not in ('free', 'paid')) then
    raise exception using errcode = 'P0001', message = 'invalid_ai_metadata';
  end if;
  if p_run_meta is null or jsonb_typeof(p_run_meta) <> 'object' then
    raise exception using errcode = 'P0001', message = 'invalid_run_meta';
  end if;

  -- DM 2.11.7 path ②: the ACTIVE provider and its key's current tier (A1 change). Same order as
  -- check_ai_run_allowed. Never reads the ciphertext columns.
  select p.active_ai_provider into v_active from public.profiles p where p.id = v_uid;
  if v_active is not null then
    select k.status, k.connection_tier into v_key_status, v_key_tier
      from public.ai_provider_keys k where k.user_id = v_uid and k.provider = v_active;
  end if;
  if v_key_status is null then
    raise exception using errcode = 'P0001', message = 'key_missing';
  end if;
  if v_key_status = 'invalid' then
    raise exception using errcode = 'P0001', message = 'key_invalid';
  end if;
  if not private.ai_consent_allows_run(v_uid, v_active, v_key_tier) then
    raise exception using errcode = 'P0001', message = 'ai_consent_required';
  end if;

  -- QA-01: the model id was chosen for the connection the caller saw.
  if v_active is distinct from p_expected_provider
     or (p_expected_connection_tier is not null and v_key_tier is distinct from p_expected_connection_tier) then
    raise exception using errcode = 'P0001', message = 'ai_connection_changed',
      detail = v_active || '/' || v_key_tier;
  end if;

  v_restarted := v_active is distinct from v_job.provider or v_key_tier is distinct from v_job.connection_tier;
  v_gen := v_job.run_generation + 1;

  if v_restarted then
    v_meta := jsonb_build_object('_meta', p_run_meta);
  else
    v_partials := v_job.step_outputs -> '_meta' -> 'partials';
    v_meta := (v_job.step_outputs - '_meta')
              || jsonb_build_object('_meta',
                   case when jsonb_typeof(v_partials) = 'object' and v_partials <> '{}'::jsonb
                        then p_run_meta || jsonb_build_object('partials', v_partials)
                        else p_run_meta end);
  end if;

  -- 23505 (ai_jobs_in_flight_target_key) propagates; the whole call rolls back.
  update public.ai_jobs j
     set status = 'queued',
         run_generation = v_gen,
         provider = v_active,
         connection_tier = v_key_tier,
         model = v_model,
         model_tier = p_model_tier,
         input_hash = case when v_active is distinct from v_job.provider or v_model is distinct from v_job.model
                           then null else j.input_hash end,
         heartbeat_at = now(),
         next_run_at = null,
         step_outputs = v_meta
   where j.id = p_ai_job_id;

  -- R-63: a run with another provider / tier redoes everything the job stored.
  if v_restarted then
    update public.insights i
       set status = 'generating', run_generation = v_gen,
           provider = v_active, model_tier = p_model_tier, connection_tier = v_key_tier
     where i.ai_job_id = p_ai_job_id and i.user_id = v_uid and i.status = 'failed';
  end if;

  return jsonb_build_object(
    'requeued', true,
    'restarted', v_restarted,
    'status', 'queued',
    'provider', v_active,
    'model', v_model,
    'model_tier', p_model_tier,
    'connection_tier', v_key_tier,
    'run_generation', v_gen);
end;
$function$;

-- public.update_failed_jd_raw_text
CREATE OR REPLACE FUNCTION public.update_failed_jd_raw_text(p_application_project_id uuid, p_raw_text text, p_raw_text_hash text, p_sentences jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_jd public.job_descriptions%rowtype;
  v_job public.ai_jobs%rowtype;
  v_failed boolean;
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_raw_text is null or btrim(p_raw_text) = '' or char_length(p_raw_text) > 50000 then
    raise exception using errcode = 'P0001', message = 'invalid_raw_text';
  end if;
  if p_raw_text_hash is null or btrim(p_raw_text_hash) = '' or char_length(p_raw_text_hash) > 128 then
    raise exception using errcode = 'P0001', message = 'invalid_raw_text_hash';
  end if;
  if not private.jd_sentences_valid(p_sentences) then
    raise exception using errcode = 'P0001', message = 'invalid_sentences';
  end if;

  perform 1 from public.application_projects ap
   where ap.id = p_application_project_id and ap.user_id = v_uid
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'job_description_not_found';
  end if;
  select * into v_jd from public.job_descriptions jd
   where jd.application_project_id = p_application_project_id and jd.user_id = v_uid
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'job_description_not_found';
  end if;

  -- 1
  if exists (select 1 from public.ai_jobs j
              where j.application_project_id = p_application_project_id and j.user_id = v_uid
                and j.status in ('queued', 'running')) then
    raise exception using errcode = 'P0001', message = 'jd_job_in_progress';
  end if;

  select * into v_job from public.ai_jobs j where j.id = v_jd.extraction_job_id and j.user_id = v_uid;

  -- 2
  v_failed := v_jd.extraction_status = 'failed'
              or (v_jd.extraction_status = 'running' and v_job.status is not distinct from 'failed');
  if not v_failed and v_jd.extraction_status <> 'succeeded' then
    raise exception using errcode = 'P0001', message = 'jd_raw_text_locked';
  end if;

  -- 3
  if exists (select 1 from public.jd_requirements r where r.job_description_id = v_jd.id) then
    raise exception using errcode = 'P0001', message = 'jd_raw_text_locked';
  end if;

  -- 4
  if v_failed and not coalesce(v_job.job_type = 'jd_extraction' and v_job.status = 'failed'
                               and v_job.error_code in ('not_a_jd', 'input_too_long', 'safety_blocked'), false) then
    raise exception using errcode = 'P0001', message = 'jd_failure_not_input';
  end if;

  -- 5
  if exists (select 1 from public.insights i
              where i.application_project_id = p_application_project_id and i.status = 'ready')
     or exists (select 1 from public.draft_sections ds
                  join public.drafts d on d.id = ds.draft_id
                 where d.application_project_id = p_application_project_id and ds.ai_content is not null)
     or exists (select 1 from public.evidence_links el
                 where el.application_project_id = p_application_project_id
                   and el.source_type in ('jd_requirement', 'jd_sentence')) then
    raise exception using errcode = 'P0001', message = 'jd_has_results';
  end if;

  -- 6
  if regexp_replace(p_raw_text, '^\s+|\s+$', '', 'g') = regexp_replace(v_jd.raw_text, '^\s+|\s+$', '', 'g') then
    raise exception using errcode = 'P0001', message = 'jd_raw_text_unchanged';
  end if;

  update public.job_descriptions jd
     set raw_text = p_raw_text,
         raw_text_hash = btrim(p_raw_text_hash),
         sentences = p_sentences,
         raw_text_edited_at = v_now,
         detected_language = null,
         extraction = null,
         tech_keywords = null,
         requirements_hash = null,
         extraction_status = 'pending',
         extraction_job_id = null,
         extraction_provider = null,
         extraction_model = null,
         company_name = case when jd.company_name_source = 'ai' then null else jd.company_name end,
         company_name_source = case when jd.company_name_source = 'ai' then null else jd.company_name_source end,
         position_title = case when jd.position_title_source = 'ai' then null else jd.position_title end,
         position_title_source = case when jd.position_title_source = 'ai' then null else jd.position_title_source end
   where jd.id = v_jd.id;

  update public.application_projects ap set last_activity_at = v_now where ap.id = p_application_project_id;

  return jsonb_build_object(
    'application_project_id', p_application_project_id,
    'job_description_id', v_jd.id,
    'extraction_status', 'pending',
    'raw_text_edited_at', v_now,
    'ai_run_allowed', private.user_ai_run_allowed(v_uid));
end;
$function$;

-- private.evidence_links_check_source
CREATE OR REPLACE FUNCTION private.evidence_links_check_source()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_exists boolean;
  v_jd_project uuid;
  v_sentences jsonb;
  v_sentence jsonb;
  v_sid text;
  v_start numeric;
  v_end numeric;
  v_affiliated boolean;
begin
  -- R13 (v4.12, SD-A19): profile is never a source of a new evidence row. The CHECK list keeps the value so
  -- that existing rows stay valid; this one line stops new ones, with the same code as the other source errors.
  if new.source_type = 'profile' then
    raise exception using errcode = 'P0001', message = 'invalid_evidence_source',
      detail = 'profile is not an evidence source (v4.12)';
  end if;

  if new.source_type = 'jd_requirement' then
    select jd.application_project_id into v_jd_project
      from public.jd_requirements r
      join public.job_descriptions jd on jd.id = r.job_description_id
     where r.id = new.source_id and r.user_id = new.user_id;
    v_exists := found;
    if v_exists and v_jd_project is distinct from new.application_project_id then
      raise exception using errcode = 'P0001', message = 'invalid_evidence_source',
        detail = 'jd_requirement of another application project';
    end if;

  elsif new.source_type = 'jd_sentence' then
    select jd.application_project_id, jd.sentences into v_jd_project, v_sentences
      from public.job_descriptions jd
     where jd.id = new.source_id and jd.user_id = new.user_id;
    v_exists := found;
    if v_exists then
      if v_jd_project is distinct from new.application_project_id then
        raise exception using errcode = 'P0001', message = 'invalid_evidence_source',
          detail = 'jd_sentence of another application project';
      end if;
      if new.source_locator is null
         or jsonb_typeof(new.source_locator -> 'sid') is distinct from 'string'
         or jsonb_typeof(new.source_locator -> 'start') is distinct from 'number'
         or jsonb_typeof(new.source_locator -> 'end') is distinct from 'number'
         or (new.source_locator ->> 'start') !~ '^[0-9]+$'
         or (new.source_locator ->> 'end') !~ '^[0-9]+$' then
        raise exception using errcode = 'P0001', message = 'invalid_evidence_source',
          detail = 'jd_sentence source_locator must be {sid, start, end}';
      end if;
      v_sid := new.source_locator ->> 'sid';
      v_start := (new.source_locator ->> 'start')::numeric;
      v_end := (new.source_locator ->> 'end')::numeric;
      select e into v_sentence from jsonb_array_elements(v_sentences) e where e ->> 'sid' = v_sid limit 1;
      if v_sentence is null
         or v_start >= v_end
         or v_start < (v_sentence ->> 'start')::numeric
         or v_end > (v_sentence ->> 'end')::numeric then
        raise exception using errcode = 'P0001', message = 'invalid_evidence_source',
          detail = 'jd_sentence locator outside the JD sentences';
      end if;
    end if;

  elsif new.source_type = 'user_note' then
    -- S7: source_id = draft_sections.id (the question whose note is quoted), same application project.
    select d.application_project_id into v_jd_project
      from public.draft_sections s
      join public.drafts d on d.id = s.draft_id
     where s.id = new.source_id and s.user_id = new.user_id;
    v_exists := found;
    if v_exists and v_jd_project is distinct from new.application_project_id then
      raise exception using errcode = 'P0001', message = 'invalid_evidence_source',
        detail = 'user_note of another application project';
    end if;

  elsif new.source_type = 'project' then
    -- R4 (DM v4.4 §2.8, AI V-2 DB defense): the field must fit the project kind. Affiliated projects carry STAR,
    -- standalone ones carry role / description; name / period fit both.
    select num_nonnulls(p.experience_id, p.education_id) = 1 into v_affiliated
      from public.projects p where p.id = new.source_id and p.user_id = new.user_id;
    v_exists := found;
    if v_exists
       and ((v_affiliated and new.source_field in ('role', 'description'))
            or (not v_affiliated and new.source_field in ('situation', 'task', 'action', 'result', 'learnings'))) then
      raise exception using errcode = 'P0001', message = 'invalid_evidence_source',
        detail = 'project field does not fit the project kind';
    end if;

  else
    v_exists := case new.source_type
      -- 'profile' is refused at the top of this function (R13), so it never reaches here.
      when 'experience' then exists (select 1 from public.experiences where id = new.source_id and user_id = new.user_id)
      when 'education' then exists (select 1 from public.educations where id = new.source_id and user_id = new.user_id)
      when 'project_deliverable' then exists (select 1 from public.project_deliverables
                                                where id = new.source_id and user_id = new.user_id)
      when 'skill' then exists (select 1 from public.skills where id = new.source_id and user_id = new.user_id)
      else true
    end;
  end if;

  if not v_exists then
    new.quote := null;
    new.source_deleted_at := coalesce(new.source_deleted_at, now());
  end if;
  return new;
end;
$function$;

-- private.insight_payload_valid
CREATE OR REPLACE FUNCTION private.insight_payload_valid(p_payload jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  v_hashes jsonb;
  v_meta jsonb;
  v_ev jsonb;
  v_key text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or jsonb_typeof(p_payload -> 'result') is distinct from 'object'
     or coalesce(jsonb_typeof(p_payload -> 'match_stage_result'), 'null') not in ('object', 'array')
     or jsonb_typeof(p_payload -> 'hashes') is distinct from 'object'
     or jsonb_typeof(p_payload -> 'meta') is distinct from 'object'
     or jsonb_typeof(p_payload -> 'evidence') is distinct from 'array'
     or jsonb_array_length(p_payload -> 'evidence') > 2000 then
    return false;
  end if;

  -- C-3: result jsonb never stores evidence arrays.
  if jsonb_path_exists(p_payload -> 'result', 'lax $.**.evidence')
     or jsonb_path_exists(p_payload -> 'result', 'lax $.**.positioning_evidence') then
    return false;
  end if;

  v_hashes := p_payload -> 'hashes';
  foreach v_key in array array['requirements_hash', 'career_snapshot_hash', 'input_hash'] loop
    if jsonb_typeof(v_hashes -> v_key) is distinct from 'string'
       or char_length(btrim(v_hashes ->> v_key)) not between 1 and 128 then
      return false;
    end if;
  end loop;

  v_meta := p_payload -> 'meta';
  if jsonb_typeof(v_meta -> 'schema_version') is distinct from 'number'
     or (v_meta ->> 'schema_version') !~ '^[1-9][0-9]{0,8}$'
     or jsonb_typeof(v_meta -> 'prompt_version') is distinct from 'string'
     or char_length(btrim(v_meta ->> 'prompt_version')) not between 1 and 200
     or jsonb_typeof(v_meta -> 'provider') is distinct from 'string'
     or jsonb_typeof(v_meta -> 'model') is distinct from 'string'
     or jsonb_typeof(v_meta -> 'model_tier') is distinct from 'string'
     or jsonb_typeof(v_meta -> 'connection_tier') is distinct from 'string'
     or coalesce(jsonb_typeof(v_meta -> 'validation_report'), 'null') not in ('object', 'null')
     or coalesce(jsonb_typeof(v_meta -> 'usage'), 'null') not in ('object', 'null') then
    return false;
  end if;

  for v_ev in select e from jsonb_array_elements(p_payload -> 'evidence') e loop
    if jsonb_typeof(v_ev) <> 'object'
       or jsonb_typeof(v_ev -> 'item_key') is distinct from 'string'
       or char_length(btrim(v_ev ->> 'item_key')) not between 1 and 200
       or jsonb_typeof(v_ev -> 'sort_order') is distinct from 'number'
       or (v_ev ->> 'sort_order') !~ '^[0-9]{1,9}$'
       -- AI-02 sources: career 5종 + JD (v4.12, SD-A19 — profile is gone). user_note never
       -- appears in an insight.
       or coalesce(v_ev ->> 'source_type', '') not in (
            'experience', 'education', 'project', 'project_deliverable', 'skill',
            'jd_requirement', 'jd_sentence')
       or jsonb_typeof(v_ev -> 'source_id') is distinct from 'string'
       or (v_ev ->> 'source_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       or coalesce(jsonb_typeof(v_ev -> 'source_field'), 'null') not in ('string', 'null')
       or coalesce(jsonb_typeof(v_ev -> 'quote'), 'null') not in ('string', 'null')
       or char_length(v_ev ->> 'quote') > 2000
       or coalesce(jsonb_typeof(v_ev -> 'quote_adjusted'), 'null') not in ('boolean', 'null')
       or coalesce(jsonb_typeof(v_ev -> 'source_locator'), 'null') not in ('object', 'null')
       or coalesce(jsonb_typeof(v_ev -> 'source_snapshot_at'), 'null') not in ('string', 'null')
       or coalesce(jsonb_typeof(v_ev -> 'source_label'), 'null') not in ('string', 'null')
       or char_length(v_ev ->> 'source_label') > 300 then
      return false;
    end if;
  end loop;

  return true;
end;
$function$;

-- public.start_writing_chat
CREATE OR REPLACE FUNCTION public.start_writing_chat(p_project_id uuid, p_return_target jsonb DEFAULT NULL::jsonb, p_form_snapshot jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c_star constant text[] := array['situation', 'task', 'action', 'result', 'learnings'];
  v_uid uuid := auth.uid();
  v_project public.projects%rowtype;
  v_return_target jsonb;
  v_snap jsonb;
  v_star jsonb;
  v_field text;
  v_chat_id uuid;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  select * into v_project from public.projects p where p.id = p_project_id and p.user_id = v_uid;
  if not found then
    raise exception using errcode = 'P0001', message = 'project_not_found';
  end if;
  if num_nonnulls(v_project.experience_id, v_project.education_id) = 0 then
    raise exception using errcode = 'P0001', message = 'writing_chat_requires_affiliated_project';
  end if;

  if p_return_target is not null and jsonb_typeof(p_return_target) <> 'null' then
    if jsonb_typeof(p_return_target) <> 'object'
       or coalesce(p_return_target ->> 'feature', '') not in ('insight', 'career_description', 'cover_letter')
       or jsonb_typeof(p_return_target -> 'application_project_id') is distinct from 'string'
       or (p_return_target ->> 'application_project_id')
            !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or coalesce(jsonb_typeof(p_return_target -> 'params'), 'object') not in ('object', 'null') then
      raise exception using errcode = 'P0001', message = 'invalid_return_target';
    end if;
    v_return_target := jsonb_build_object(
      'application_project_id', lower(p_return_target ->> 'application_project_id'),
      'feature', p_return_target ->> 'feature',
      'params', coalesce(nullif(p_return_target -> 'params', 'null'::jsonb), '{}'::jsonb),
      'created_at', to_jsonb(now()));
  end if;

  -- Greeting input: snapshot values win over saved ones (리더 정렬 2). Local copy only.
  v_snap := nullif(p_form_snapshot, 'null'::jsonb);
  if v_snap is not null then
    v_star := nullif(v_snap -> 'star', 'null'::jsonb);
    if jsonb_typeof(v_snap) <> 'object'
       or coalesce(jsonb_typeof(v_snap -> 'name'), 'null') not in ('string', 'null')
       or char_length(v_snap ->> 'name') > 100
       or (v_star is not null and jsonb_typeof(v_star) <> 'object') then
      raise exception using errcode = 'P0001', message = 'invalid_form_snapshot';
    end if;
    if nullif(btrim(v_snap ->> 'name'), '') is not null then
      v_project.name := v_snap ->> 'name';
    end if;
    if v_star is not null then
      foreach v_field in array c_star loop
        if v_star ? v_field then
          if coalesce(jsonb_typeof(v_star -> v_field), 'null') not in ('string', 'null')
             or char_length(v_star ->> v_field) > 2000 then
            raise exception using errcode = 'P0001', message = 'invalid_form_snapshot';
          end if;
          case v_field
            when 'situation' then v_project.situation := v_star ->> v_field;
            when 'task' then v_project.task := v_star ->> v_field;
            when 'action' then v_project.action := v_star ->> v_field;
            when 'result' then v_project.result := v_star ->> v_field;
            when 'learnings' then v_project.learnings := v_star ->> v_field;
          end case;
        end if;
      end loop;
    end if;
  end if;

  insert into public.writing_chats (user_id, project_id, structured_draft, message_count, return_target)
  values (v_uid, p_project_id, private.writing_chat_empty_draft(), 0, v_return_target)
  returning id into v_chat_id;

  insert into public.writing_chat_messages (user_id, writing_chat_id, sequence, role, content, status)
  values (v_uid, v_chat_id, 1, 'assistant',
          private.writing_chat_greeting(v_project, v_return_target ->> 'feature', private.writing_chat_free_tier(v_uid)),
          'done');

  return v_chat_id;
end;
$function$;

-- private.writing_chat_greeting
CREATE OR REPLACE FUNCTION private.writing_chat_greeting(p_project projects, p_gate_feature text, p_free_tier boolean)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  c_slots constant text[] := array['situation', 'task', 'action', 'result', 'learnings'];
  c_labels constant text[] := array['상황', '역할', '행동', '결과/성과', '배운 점'];
  c_questions constant text[] := array[
    '그때 어떤 상황이었나요? 팀이나 서비스 배경을 알려 주세요.',
    '그 상황에서 맡은 역할이나 해결해야 했던 목표는 무엇이었나요?',
    '그 안에서 본인이 직접 한 일은 무엇인가요?',
    '결과는 어땠나요? 수치로 알고 있는 게 있다면 함께 말해 주세요.',
    '이 경험에서 배운 점이나 다음에 다르게 할 점이 있나요?'];
  v_values text[] := array[p_project.situation, p_project.task, p_project.action, p_project.result,
                           p_project.learnings];
  v_name text := left(btrim(p_project.name), 100);
  v_filled int := 0;
  v_first int;
  v_body text;
  v_gate text := '';
begin
  for i in 1 .. 5 loop
    if nullif(btrim(v_values[i]), '') is not null then
      v_filled := v_filled + 1;
    elsif v_first is null then
      v_first := i;
    end if;
  end loop;

  if v_filled = 0 then
    v_body := '''' || v_name || '''을 함께 정리해 볼게요. 하나씩 여쭤보고, 정리한 내용은 왼쪽에 반영하기 전에 '
              || '먼저 보여 드릴게요. 이 프로젝트는 어떤 상황에서 시작됐나요?';
  elsif v_filled < 5 then
    v_body := '''' || v_name || '''에서 비어 있는 ' || c_labels[v_first] || '부터 여쭤볼게요. '
              || c_questions[v_first];
  else
    v_body := '모든 항목이 채워져 있어요. 보강하고 싶은 항목을 골라 주세요.';
  end if;

  if p_gate_feature is not null then
    v_gate := case p_gate_feature
                when 'insight' then '인사이트를'
                when 'career_description' then '경력기술서를'
                when 'cover_letter' then '자소서 문항 답변을'
                else '이 기능을'
              end || ' 쓰려면 이 프로젝트의 상황과 행동이 필요해요.' || E'\n\n';
  end if;

  return v_gate || v_body
    || E'\n\n'
    || '건강·종교·노조 활동 같은 민감정보, 동료·고객의 개인정보, 회사 기밀은 말하지 말아 주세요.'
    || case when p_free_tier
         then ' 무료 등급에서는 입력한 내용이 Google 제품 개선에 쓰이고 사람이 검토할 수 있어요. 민감정보·회사 기밀은 쓰지 마세요.'
         else '' end;
end;
$function$;

-- 1. Triggers on surviving tables ----------------------------------------------------------------------------
drop trigger application_projects_detach_interviews on public.application_projects;
drop function private.application_projects_detach_interviews();
drop trigger ai_jobs_release_interview on public.ai_jobs;
drop function private.ai_jobs_release_interview();

-- 2. Interview evidence rows (the owner delete triggers do not run on drop table) -----------------------------
delete from public.evidence_links
 where owner_type in ('interview_question', 'answer_evaluation', 'session_feedback')
    or source_type = 'interview_answer';

-- 3. Interview jobs and usage rows (RM-A2: this month's meter total drops by the interview usage) -------------
delete from public.ai_usage_records
 where feature in ('interview_questions', 'interview_evaluation')
    or job_type in ('interview_questions', 'interview_evaluation');
delete from public.ai_jobs
 where job_type in ('interview_questions', 'interview_evaluation')
    or target_type = 'interview_session';

-- 4. Stage history rows on interview stages (RM-5) ----------------------------------------------------------
delete from public.application_stage_events
 where from_stage in ('job_interview', 'culture_fit_interview')
    or to_stage in ('job_interview', 'culture_fit_interview');

-- 5. Writing chat return targets (RM-A1): the chat, messages and proposals stay ------------------------------
update public.writing_chats
   set return_target = null
 where return_target ->> 'feature' = 'job_interview';

-- 6. Interview tables (child -> parent, no cascade) ---------------------------------------------------------
-- Functions typed on interview_sessions rows depend on the table's row type; drop them first.
drop function private.interview_evaluation_run_state(public.interview_sessions,public.ai_jobs,integer);
drop function private.interview_job_matches(public.ai_jobs,public.interview_sessions,text);
drop function private.interview_lock_session(uuid,uuid);
drop function private.interview_questions_run_state(public.interview_sessions,public.ai_jobs,integer);
drop function private.interview_session_create_json(public.interview_sessions,boolean);

drop table public.session_feedbacks;
drop table public.answer_evaluations;
drop table public.interview_answers;
drop table public.interview_questions;
drop table public.interview_sessions;

-- 7. Remaining interview functions (after the tables: three are trigger functions of the dropped tables) -----
drop function public.abandon_interview_session(uuid);
drop function public.backfill_interview_scores(integer);
drop function public.begin_interview_evaluation(uuid,uuid,text,text);
drop function public.begin_interview_questions(uuid,uuid);
drop function public.complete_interview_evaluation(uuid,uuid,integer);
drop function public.complete_interview_questions(uuid,uuid,integer,jsonb);
drop function public.create_interview_session(uuid,text,integer,text,uuid);
drop function public.fail_answer_evaluation(uuid,uuid,text);
drop function public.fail_interview_questions(uuid,uuid);
drop function public.get_interview_grading_decisions(uuid[]);
drop function public.get_interview_question_reveals(uuid);
drop function public.mark_interview_result_viewed(uuid);
drop function public.save_answer_evaluation(uuid,uuid,integer,jsonb);
drop function public.save_interview_question(uuid,uuid,integer,jsonb);
drop function public.save_session_feedback(uuid,uuid,integer,jsonb);
drop function public.submit_interview_session(uuid);
drop function private.career_deletion_interview_session_ids(uuid,text,uuid,text);
drop function private.interview_answer_is_regrade_target(uuid);
drop function private.interview_answer_score_d14v1(jsonb);
drop function private.interview_answers_touch_session();
drop function private.interview_apply_scores_d14v1(uuid,boolean);
drop function private.interview_cancel_jobs(uuid,uuid,text[]);
drop function private.interview_delete_owner_evidence();
drop function private.interview_evaluation_begin_json(uuid,boolean);
drop function private.interview_evaluation_mark_failed(uuid,uuid,boolean);
drop function private.interview_evaluation_open(uuid,uuid,integer);
drop function private.interview_evidence_valid(jsonb,text[]);
drop function private.interview_grading_decision(uuid,uuid);
drop function private.interview_insert_evidence(uuid,uuid,text,uuid,jsonb);
drop function private.interview_job_live(uuid);
drop function private.interview_mark_unscored(uuid);
drop function private.interview_questions_begin_json(uuid,boolean);
drop function private.interview_questions_mark_failed(uuid,uuid,boolean);
drop function private.interview_requirement_ids_valid(uuid,jsonb,integer);
drop function private.interview_result_payload_valid(jsonb);
drop function private.interview_sessions_cancel_jobs();
drop function private.interview_uuid_array(jsonb);
-- Not in DM 11.9's list: the trigger function of answer_evaluations_clear_error_code (w0), orphaned by the drop.
drop function private.answer_evaluations_clear_error_code();

-- 8. CHECK lists (drop -> add; no "not valid" — a leftover violation must stop the migration) ----------------
alter table public.application_projects drop constraint application_projects_stage_check;
alter table public.application_projects add constraint application_projects_stage_check
  check (stage in ('before_apply', 'document', 'assignment', 'closed'));

alter table public.application_stage_events drop constraint application_stage_events_from_stage_check;
alter table public.application_stage_events add constraint application_stage_events_from_stage_check
  check (from_stage in ('before_apply', 'document', 'assignment', 'closed'));
alter table public.application_stage_events drop constraint application_stage_events_to_stage_check;
alter table public.application_stage_events add constraint application_stage_events_to_stage_check
  check (to_stage in ('before_apply', 'document', 'assignment', 'closed'));

-- ai_jobs.job_type and ai_usage_records.job_type share one list: change both together.
alter table public.ai_jobs drop constraint ai_jobs_job_type_check;
alter table public.ai_jobs add constraint ai_jobs_job_type_check
  check (job_type in ('jd_extraction', 'insight', 'career_description', 'draft_source_ranking', 'cover_letter',
                      'writing_chat_turn', 'key_verification', 'writing_assist', 'chat_reply'));
alter table public.ai_usage_records drop constraint ai_usage_records_job_type_check;
alter table public.ai_usage_records add constraint ai_usage_records_job_type_check
  check (job_type in ('jd_extraction', 'insight', 'career_description', 'draft_source_ranking', 'cover_letter',
                      'writing_chat_turn', 'key_verification', 'writing_assist', 'chat_reply'));

alter table public.ai_usage_records drop constraint ai_usage_records_feature_check;
alter table public.ai_usage_records add constraint ai_usage_records_feature_check
  check (feature in ('jd_extraction', 'insight', 'career_description', 'cover_letter', 'writing_chat',
                     'key_verification', 'writing_assist', 'chat_reply'));

-- v4.13 (11.8) is not implemented yet: no application_document owner here; draft_section stays in the list.
alter table public.evidence_links drop constraint evidence_links_owner_type_check;
alter table public.evidence_links add constraint evidence_links_owner_type_check
  check (owner_type in ('insight', 'draft_section', 'chat_message'));
alter table public.evidence_links drop constraint evidence_links_source_type_check;
alter table public.evidence_links add constraint evidence_links_source_type_check
  check (source_type in ('profile', 'experience', 'education', 'project', 'project_deliverable', 'skill',
                         'jd_requirement', 'jd_sentence', 'user_note'));

alter table public.writing_chats drop constraint writing_chats_return_target_check;
alter table public.writing_chats add constraint writing_chats_return_target_check
  check (return_target is null
         or (jsonb_typeof(return_target) = 'object'
             and (return_target ->> 'feature') in ('insight', 'career_description', 'cover_letter')));

-- 9. Undo OD-I6: only interview owners could have a null application project ------------------------------------
alter table public.evidence_links drop constraint evidence_links_detached_check;
alter table public.evidence_links alter column application_project_id set not null;
