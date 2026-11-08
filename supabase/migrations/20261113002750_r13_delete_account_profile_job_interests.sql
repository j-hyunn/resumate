-- R13 ⑮ account deletion covers profile_job_interests (DM v4.12 §2.1.2, §4.3; DM-1).
-- Not in the slice plan's table: a new user-data table has to be deleted by delete_account / purge_inactive_account
-- too, or the deletion-completeness guard in account_deletion.test.sql fails and a 탈퇴 would rely on the
-- auth.users cascade alone. The body below is the live private.delete_account_data with that one delete added.

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
  --    interview_*, application_stage_events, evidence_links and project-scoped ai_jobs.
  perform 1 from public.application_projects ap where ap.user_id = p_uid order by ap.id for update;
  delete from public.application_projects t where t.user_id = p_uid;

  -- Sweep anything of the application area that did not hang off a project (all should be gone already).
  delete from public.evidence_links t where t.user_id = p_uid;
  delete from public.answer_evaluations t where t.user_id = p_uid;
  delete from public.session_feedbacks t where t.user_id = p_uid;
  delete from public.interview_answers t where t.user_id = p_uid;
  delete from public.interview_questions t where t.user_id = p_uid;
  delete from public.interview_sessions t where t.user_id = p_uid;
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
