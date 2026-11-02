-- S9 account deletion RPCs (PRD F-COM-05, NFR-PRV-06, NFR-KEY-06 / 09; DM §4.3, §4.4, A.17; UX FL-07, S-25).
--   get_account_deletion_summary()      authenticated, security invoker (RLS: own rows only)
--   delete_account(p_subject_hash text) authenticated, security definer + auth.uid()
-- delete_account removes every public row of the caller in one transaction (profiles + all user_id tables,
-- including the ones that only cascade from auth.users: consents, ai_data_use_consents, ai_usage_records, ai_jobs,
-- evidence_links ...), hard-deletes the provider keys (NFR-KEY-06) and writes one de-identified
-- account_deletion_logs row. auth.users itself is deleted afterwards by the server (service role,
-- auth.admin.deleteUser); if that fails the call can be repeated (idempotent).
--
-- Lock order (QA-S5-06 lessons; S5–S8 RPCs lock application_projects -> result rows -> ai_jobs, job-end
-- triggers take the project row with skip locked; S4 start / append / begin_assistant_message lock chat -> messages):
--   advisory lock (one delete_account per user)
--   -> ai_usage_records (append-only, nobody else locks existing rows)
--   -> application_projects ordered by id, then their cascade (JD, results, interviews, evidence, project jobs)
--   -> writing_chats ordered by id (FOR UPDATE), then their messages (QA-S9-02: same direction as S4)
--   -> career rows (their touch trigger updates profiles)
--   -> remaining ai_jobs -> keys -> consents -> profiles -> log.
-- S5–S8 runner RPCs and S4 turn start never wait in the reverse direction. Two paths still can:
-- finish_assistant_message (message -> chat, S4 has both orders so one side is always reversed) and a user-session
-- edit in another tab (career row -> profiles touch). Postgres then aborts one side with 40P01 and the API retries
-- once (the function is idempotent). In-flight jobs are not flagged with cancel_requested_at first: their rows are
-- deleted in this same transaction, which the runner sees as "lost" on its next heartbeat (0 rows), and
-- get_provider_key_secret refuses (key_not_available) because neither the job nor the key exists any more.
-- Errors: 42501 not_authenticated; P0001 invalid_subject_hash.


-- ── get_account_deletion_summary (DM §4.3, S-25 삭제 범위) ──────────────────────
-- Plain row counts of everything delete_account removes, grouped like S-25. Not the result-impact shape of
-- get_deletion_impact (different purpose, DM §4.3).
create or replace function public.get_account_deletion_summary()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
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
      'project_details', (select count(*) from public.project_details t where t.user_id = v_uid),
      'achievements', (select count(*) from public.achievements t where t.user_id = v_uid),
      'skills', (select count(*) from public.skills t where t.user_id = v_uid),
      'writing_chats', (select count(*) from public.writing_chats t where t.user_id = v_uid)),
    'applications', jsonb_build_object(
      'application_projects', (select count(*) from public.application_projects t where t.user_id = v_uid),
      'insights', (select count(*) from public.insights t where t.user_id = v_uid),
      'drafts', (select count(*) from public.drafts t where t.user_id = v_uid),
      'interview_sessions', (select count(*) from public.interview_sessions t where t.user_id = v_uid),
      'application_stage_events',
        (select count(*) from public.application_stage_events t where t.user_id = v_uid)),
    'ai_connection', jsonb_build_object(
      'provider_keys', v_keys,
      'ai_data_use_consents', (select count(*) from public.ai_data_use_consents t where t.user_id = v_uid),
      'usage_records', (select count(*) from public.ai_usage_records t where t.user_id = v_uid),
      'has_provider_keys', v_keys > 0));
end;
$$;

revoke all on function public.get_account_deletion_summary() from public, anon, app_ai_writer, app_key_reader, service_role;
grant execute on function public.get_account_deletion_summary() to authenticated;


-- ── delete_account (F-COM-05, FL-07) ──────────────────────────────────────────
create or replace function public.delete_account(p_subject_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_in_flight integer;
  v_keys integer;
  v_logged integer;
  v_now timestamptz := now();
  v_done timestamptz;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_subject_hash is null or p_subject_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'invalid_subject_hash';
  end if;

  -- One deletion at a time per user (double submit / retry while the first call still runs).
  perform pg_advisory_xact_lock(hashtextextended('resumate.delete_account:' || v_uid::text, 0));

  select count(*)::integer into v_in_flight
    from public.ai_jobs j
   where j.user_id = v_uid and j.status in ('queued', 'running');

  -- 1. Usage records first: avoids the set-null updates the application project cascade would make.
  delete from public.ai_usage_records t where t.user_id = v_uid;

  -- 2. Application projects (lock order: projects by id first, like delete_career_item), cascading to
  --    job_descriptions, jd_requirements, insights, drafts, draft_sections, draft_section_sources,
  --    interview_*, application_stage_events, evidence_links and project-scoped ai_jobs.
  perform 1 from public.application_projects ap where ap.user_id = v_uid order by ap.id for update;
  delete from public.application_projects t where t.user_id = v_uid;

  -- Sweep anything of the application area that did not hang off a project (all should be gone already).
  delete from public.evidence_links t where t.user_id = v_uid;
  delete from public.answer_evaluations t where t.user_id = v_uid;
  delete from public.session_feedbacks t where t.user_id = v_uid;
  delete from public.interview_answers t where t.user_id = v_uid;
  delete from public.interview_questions t where t.user_id = v_uid;
  delete from public.interview_sessions t where t.user_id = v_uid;
  delete from public.draft_section_sources t where t.user_id = v_uid;
  delete from public.draft_sections t where t.user_id = v_uid;
  delete from public.drafts t where t.user_id = v_uid;
  delete from public.insights t where t.user_id = v_uid;
  delete from public.jd_requirements t where t.user_id = v_uid;
  delete from public.job_descriptions t where t.user_id = v_uid;
  delete from public.application_stage_events t where t.user_id = v_uid;

  -- 3. AI writing chats: chats locked first, then messages (S4 locks chat -> messages, QA-S9-02).
  perform 1 from public.writing_chats w where w.user_id = v_uid order by w.id for update;
  delete from public.writing_chats t where t.user_id = v_uid;
  delete from public.writing_chat_messages t where t.user_id = v_uid;

  -- 4. Career data, leaves first.
  delete from public.achievements t where t.user_id = v_uid;
  delete from public.project_details t where t.user_id = v_uid;
  delete from public.project_skills t where t.user_id = v_uid;
  delete from public.projects t where t.user_id = v_uid;
  delete from public.skills t where t.user_id = v_uid;
  delete from public.educations t where t.user_id = v_uid;
  delete from public.experiences t where t.user_id = v_uid;

  -- 5. Jobs not tied to an application project (writing chat turns, key verification, ...).
  delete from public.ai_jobs t where t.user_id = v_uid;

  -- 6. Provider keys: immediate hard delete (NFR-KEY-06). FK sets profiles.active_ai_provider null.
  delete from public.ai_provider_keys t where t.user_id = v_uid;
  get diagnostics v_keys = row_count;

  -- 7. Consent history: deleted; the de-identified log below is the only proof kept (D-DM-02 (b)).
  delete from public.ai_data_use_consents t where t.user_id = v_uid;
  delete from public.consents t where t.user_id = v_uid;

  -- 8. Profile.
  delete from public.profiles t where t.id = v_uid;

  -- 9. De-identified log (A.17). A repeated call with the same hash keeps the first row.
  v_done := clock_timestamp();
  insert into public.account_deletion_logs (subject_hash, requested_at, db_deleted_at, storage_deleted_at, reason)
  values (p_subject_hash, v_now, greatest(v_done, v_now), null, 'user_request')
  on conflict (subject_hash) do nothing;
  get diagnostics v_logged = row_count;

  return jsonb_build_object(
    'deleted', true,
    'log_written', v_logged > 0,
    'in_flight_jobs', v_in_flight,
    'deleted_provider_keys', v_keys,
    'db_deleted_at', greatest(v_done, v_now));
end;
$$;

revoke all on function public.delete_account(text) from public, anon, app_ai_writer, app_key_reader, service_role;
grant execute on function public.delete_account(text) to authenticated;
