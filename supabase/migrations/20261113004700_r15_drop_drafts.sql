-- DESTRUCTIVE: 자기소개서 흐름 재설계(CF-1·CF-M1) — 서류 3테이블 drop(drafts, draft_sections, draft_section_sources와 그 RLS·grant·트리거·인덱스), 옛 서류 결과·문항 RPC 42개 drop, evidence_links_owner_type_check에서 draft_section 제거. 지우는 행은 0이다(가드가 다시 확인한다). 스키마는 되돌릴 수 없다.
--
-- R15 deployment stage 4 (DM 11.8 (2) 4단계, decisions 4.23 백엔드 #11). One file, one transaction (the Supabase
-- CLI wraps each migration file in a transaction; no explicit begin/commit).
-- PUSH THIS ONLY AFTER THE CODE DEPLOYMENT — the old code would call tables and RPCs that no longer exist.
-- Order:
--   0. guard: stop unless drafts / draft_sections / draft_section_sources and the draft_section evidence rows are
--      all empty (CF-M1 — nothing is migrated; the message carries row counts only, no values and no ids)
--   R. replace the two RPCs that still read the dropped tables
--   1. triggers living on surviving tables (ai_jobs, experiences, educations, projects) + their functions
--   2. the old document result / question RPCs and helpers
--   3. the 3 tables, child -> parent, NO cascade (an unexpected dependency should stop the migration)
--   4. the trigger functions of the dropped tables and the validators their CHECKs used
--   5. evidence_links_owner_type_check: drop -> add without draft_section
-- KEPT on purpose: private.education_display_name, private.trim_js_whitespace (DM 11.8 #8), the generic
--   private.is_uuid_text / is_uuid_array helpers, and the CHECK values ai_jobs.job_type /
--   ai_usage_records.job_type / feature 'career_description' + 'draft_source_ranking' and
--   ai_jobs.target_type 'draft' / 'draft_section' (past rows, CF-A3).

-- 0. Guard (CF-M1, same shape as R14 step 0) ------------------------------------------------------------------
do $$
declare
  v_drafts bigint;
  v_sections bigint;
  v_sources bigint;
  v_evidence bigint;
begin
  select count(*) into v_drafts from public.drafts;
  select count(*) into v_sections from public.draft_sections;
  select count(*) into v_sources from public.draft_section_sources;
  select count(*) into v_evidence from public.evidence_links where owner_type = 'draft_section';
  if v_drafts > 0 or v_sections > 0 or v_sources > 0 or v_evidence > 0 then
    raise exception 'r15_drop_drafts: old document rows still exist (drafts=%, draft_sections=%, draft_section_sources=%, evidence_links[draft_section]=%); nothing is migrated, so resolve them first',
      v_drafts, v_sections, v_sources, v_evidence;
  end if;
end;
$$;

-- R. Replaced RPCs ---------------------------------------------------------------------------------------------
-- public.update_failed_jd_raw_text: condition 5 loses the draft_sections check (R15).
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
     -- R15 (CL-3): the drafts tables are gone. A written cover letter does not quote JD sentences by itself —
     -- the evidence_links condition below already covers "a result built on this posting text" (DM §2.6.1).
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

-- private.delete_account_data: the three drafts tables are gone; application_documents stays (R15).
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
  --    job_descriptions, jd_requirements, insights, application_documents,
  --    application_stage_events, evidence_links and project-scoped ai_jobs.
  perform 1 from public.application_projects ap where ap.user_id = p_uid order by ap.id for update;
  delete from public.application_projects t where t.user_id = p_uid;

  -- Sweep anything of the application area that did not hang off a project (all should be gone already).
  delete from public.evidence_links t where t.user_id = p_uid;
  delete from public.application_documents t where t.user_id = p_uid;
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

-- 1. Triggers on surviving tables ------------------------------------------------------------------------------
-- These four live on tables that stay; a table drop would not remove them, and they would then fail on every
-- job finish / career deletion (same reason as R14 step 1).
drop trigger ai_jobs_release_drafts on public.ai_jobs;
drop trigger experiences_draft_sources_deleted on public.experiences;
drop trigger educations_draft_sources_deleted on public.educations;
drop trigger projects_draft_sources_deleted on public.projects;

drop function private.ai_jobs_release_drafts();
drop function private.draft_sources_mark_experience_deleted();
drop function private.draft_sources_mark_education_deleted();
drop function private.draft_sources_mark_project_deleted();
-- One-off backfill of the education display labels inside the dropped tables (DM 11.8 #8).
drop function private.backfill_education_display_labels();

-- 2. Old document RPCs and helpers (DM 11.8 #8 — 결과 RPC·문항 사용자 RPC 일괄) --------------------------------
drop function public.begin_career_description(uuid, uuid, jsonb, jsonb, uuid, uuid, text);
drop function public.complete_career_description(uuid, uuid, integer, jsonb);
drop function public.fail_career_description(uuid, uuid);
drop function public.begin_cover_letter_section(uuid, uuid);
drop function public.complete_cover_letter_section(uuid, uuid, integer, jsonb);
drop function public.fail_draft_section(uuid, uuid);
drop function public.create_cover_letter_draft(uuid, uuid, text);
drop function public.add_cover_letter_question(uuid, text, integer, text, uuid);
drop function public.delete_cover_letter_question(uuid);
drop function public.reorder_cover_letter_questions(uuid, uuid[]);
drop function public.set_section_sources(uuid, jsonb);

drop function private.career_description_begin_json(uuid, boolean);
drop function private.career_description_job_matches(public.ai_jobs, uuid, uuid);
drop function private.career_description_mark_failed(uuid, uuid, boolean);
drop function private.career_description_sections_valid(uuid, jsonb);
drop function private.cover_letter_begin_json(uuid, boolean);
drop function private.cover_letter_job_matches(public.ai_jobs, uuid, uuid);
drop function private.cover_letter_section_draft_id(uuid, uuid);
drop function private.draft_insert_evidence(uuid, uuid, jsonb);
drop function private.draft_recompute_status(uuid);
drop function private.draft_section_job_active(uuid, uuid);
drop function private.draft_section_mark_failed(uuid, uuid, boolean);
drop function private.draft_section_sources_json(uuid);
drop function private.draft_source_label(uuid, uuid, uuid, uuid);
drop function private.draft_source_parent_name(uuid, uuid, uuid);
drop function private.lock_cover_letter_draft(uuid, uuid);
drop function private.lock_cover_letter_section(uuid, uuid);
-- Career deletion helpers of the old structure; private.career_deletion_document_slots and
-- private.reset_application_document_slots (R15) replaced them.
drop function private.career_deletion_draft_ids(uuid, text, uuid, text);
drop function private.career_deletion_section_ids(uuid, text, uuid, text);
drop function private.reset_cover_letter_sections(uuid[]);
drop function private.cancel_draft_jobs(uuid[], uuid[]);

-- 3. The 3 tables, child -> parent, no cascade -----------------------------------------------------------------
-- Their select RLS policies, the authenticated / app_ai_writer grants, their own triggers, CHECKs and indexes go
-- with them.
drop table public.draft_section_sources;
drop table public.draft_sections;
drop table public.drafts;

-- 4. Trigger functions of the dropped tables (after the tables: a trigger depends on its function) and the
--    validators their CHECK constraints used --------------------------------------------------------------------
drop function private.draft_sections_delete_evidence();
drop function private.drafts_keep_first_copied_at();
drop function private.draft_blocks_valid(jsonb);
drop function private.draft_options_valid(jsonb);
drop function private.draft_evidence_elem_valid(jsonb, text[]);
drop function private.draft_default_title(text);
drop function private.draft_resolve_title(text, text);

-- 5. evidence_links_owner_type_check: draft_section leaves the list (the guard proved 0 rows) -------------------
alter table public.evidence_links drop constraint evidence_links_owner_type_check;
alter table public.evidence_links
  add constraint evidence_links_owner_type_check
    check (owner_type in ('insight', 'chat_message', 'application_document'));
