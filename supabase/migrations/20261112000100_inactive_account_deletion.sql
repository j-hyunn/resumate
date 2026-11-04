-- Inactive account deletion (privacy policy 2026-11-04 §4 "보유 기간"; DM A.1 last_active_at /
-- inactivity_notice_sent_at, A.17 reason 'inactivity'; D-11).
--
-- Policy: an account with no access for 1 year is told by e-mail 30 days before deletion, then all its data is
-- deleted. Signing in before that keeps the account.
--
-- Timeline (per account, "last access" = coalesce(profiles.last_active_at, profiles.created_at)):
--   last access + (1 year - 30 days)  notice target (inactivity_notice_sent_at is null)
--   notice sent                       inactivity_notice_sent_at := send time (server, after the mail was accepted)
--   any access                        touch_last_active(): last_active_at := now(), inactivity_notice_sent_at := null
--   notice + 30 days, and             purge_inactive_account(): same deletion as delete_account, reason 'inactivity'
--   last access + 1 year
--
-- 1. private.delete_account_data(uid, hash, reason): the body of public.delete_account (R4), unchanged except the
--    user id and reason are parameters. public.delete_account now calls it with auth.uid() / 'user_request'.
-- 2. public.touch_last_active(): authenticated, own row only. Called by the proxy at most every few hours.
-- 3. service_role only (cron): list_inactivity_notice_targets, mark_inactivity_notice_sent,
--    list_inactive_accounts_due, purge_inactive_account, list_incomplete_account_deletions.
-- 4. Backfill: last_active_at null -> greatest(auth.users.last_sign_in_at, profiles.created_at).

-- ── 1. shared deletion body ──

create or replace function private.delete_account_data(p_uid uuid, p_subject_hash text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke all on function private.delete_account_data(uuid, text, text) from public;

create or replace function public.delete_account(p_subject_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  return private.delete_account_data(v_uid, p_subject_hash, 'user_request');
end;
$$;

-- ── 2. activity ──

-- Updates the caller's last_active_at and cancels a pending inactivity notice. Writes only when the stored value is
-- older than an hour or a notice is pending, so frequent calls stay cheap. Returns whether a row was written.
create or replace function public.touch_last_active()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_n integer;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  update public.profiles p
     set last_active_at = now(),
         inactivity_notice_sent_at = null
   where p.id = v_uid
     and (p.last_active_at is null
          or p.last_active_at < now() - interval '1 hour'
          or p.inactivity_notice_sent_at is not null);
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

revoke all on function public.touch_last_active() from public, anon, app_ai_writer, app_key_reader;
grant execute on function public.touch_last_active() to authenticated;

-- ── 3. cron (service_role) ──

create index if not exists profiles_inactivity_idx
  on public.profiles ((coalesce(last_active_at, created_at)));

-- Accounts that reach 1 year without access within 30 days and have not been told yet. Returns the Auth e-mail
-- (the only place it lives); rows whose Auth user has no e-mail are skipped. Oldest first.
create or replace function public.list_inactivity_notice_targets(p_now timestamptz, p_limit integer default 50)
returns table (user_id uuid, email text, last_active_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_now is null then
    raise exception using errcode = 'P0001', message = 'invalid_now';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception using errcode = 'P0001', message = 'invalid_limit';
  end if;
  return query
    select p.id, u.email::text, coalesce(p.last_active_at, p.created_at)
      from public.profiles p
      join auth.users u on u.id = p.id
     where p.inactivity_notice_sent_at is null
       and coalesce(p.last_active_at, p.created_at) <= p_now - (interval '1 year' - interval '30 days')
       and u.email is not null and u.email <> ''
     order by coalesce(p.last_active_at, p.created_at), p.id
     limit p_limit;
end;
$$;

-- Records that the notice went out. Re-checks the target condition under a row lock, so an account that signed in
-- after it was listed is not marked (returns false). Called only after the mail server accepted the message.
create or replace function public.mark_inactivity_notice_sent(p_user_id uuid, p_sent_at timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if p_user_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_user_id';
  end if;
  if p_sent_at is null then
    raise exception using errcode = 'P0001', message = 'invalid_now';
  end if;
  update public.profiles p
     set inactivity_notice_sent_at = p_sent_at
   where p.id = p_user_id
     and p.inactivity_notice_sent_at is null
     and coalesce(p.last_active_at, p.created_at) <= p_sent_at - (interval '1 year' - interval '30 days');
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- Accounts whose notice is at least 30 days old and that have had no access for a full year.
create or replace function public.list_inactive_accounts_due(p_now timestamptz, p_limit integer default 50)
returns table (user_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_now is null then
    raise exception using errcode = 'P0001', message = 'invalid_now';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception using errcode = 'P0001', message = 'invalid_limit';
  end if;
  return query
    select p.id
      from public.profiles p
     where p.inactivity_notice_sent_at is not null
       and p.inactivity_notice_sent_at <= p_now - interval '30 days'
       and coalesce(p.last_active_at, p.created_at) <= p_now - interval '1 year'
       and coalesce(p.last_active_at, p.created_at) < p.inactivity_notice_sent_at
     order by p.inactivity_notice_sent_at, p.id
     limit p_limit;
end;
$$;

-- Deletes one inactive account exactly like delete_account (reason 'inactivity'), after re-checking the due
-- condition under a row lock (a sign-in since listing wins). Returns null when the account is no longer due or
-- already gone; otherwise delete_account's result. The server then deletes the Auth user (service-role admin API).
create or replace function public.purge_inactive_account(p_user_id uuid, p_subject_hash text, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_user_id';
  end if;
  if p_now is null then
    raise exception using errcode = 'P0001', message = 'invalid_now';
  end if;
  if p_subject_hash is null or p_subject_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'invalid_subject_hash';
  end if;
  perform 1
     from public.profiles p
    where p.id = p_user_id
      and p.inactivity_notice_sent_at is not null
      and p.inactivity_notice_sent_at <= p_now - interval '30 days'
      and coalesce(p.last_active_at, p.created_at) <= p_now - interval '1 year'
      and coalesce(p.last_active_at, p.created_at) < p.inactivity_notice_sent_at
      for update;
  if not found then
    return null;
  end if;
  return private.delete_account_data(p_user_id, p_subject_hash, 'inactivity');
end;
$$;

-- Auth users with no profile row: their public data was deleted (delete_account / purge_inactive_account) but the
-- Auth delete failed. The server checks each with get_account_deletion_state (needs the HMAC) before deleting the
-- Auth user. Ids only. Oldest first.
create or replace function public.list_incomplete_account_deletions(p_limit integer default 50)
returns table (user_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception using errcode = 'P0001', message = 'invalid_limit';
  end if;
  return query
    select u.id
      from auth.users u
     where not exists (select 1 from public.profiles p where p.id = u.id)
     order by u.created_at, u.id
     limit p_limit;
end;
$$;

revoke all on function public.list_inactivity_notice_targets(timestamptz, integer)
  from public, anon, authenticated, app_ai_writer, app_key_reader;
revoke all on function public.mark_inactivity_notice_sent(uuid, timestamptz)
  from public, anon, authenticated, app_ai_writer, app_key_reader;
revoke all on function public.list_inactive_accounts_due(timestamptz, integer)
  from public, anon, authenticated, app_ai_writer, app_key_reader;
revoke all on function public.purge_inactive_account(uuid, text, timestamptz)
  from public, anon, authenticated, app_ai_writer, app_key_reader;
revoke all on function public.list_incomplete_account_deletions(integer)
  from public, anon, authenticated, app_ai_writer, app_key_reader;
grant execute on function public.list_inactivity_notice_targets(timestamptz, integer) to service_role;
grant execute on function public.mark_inactivity_notice_sent(uuid, timestamptz) to service_role;
grant execute on function public.list_inactive_accounts_due(timestamptz, integer) to service_role;
grant execute on function public.purge_inactive_account(uuid, text, timestamptz) to service_role;
grant execute on function public.list_incomplete_account_deletions(integer) to service_role;

-- ── 4. backfill ──
-- last_active_at was never written before this migration. Start every existing account from its last sign-in.
update public.profiles p
   set last_active_at = greatest(coalesce(u.last_sign_in_at, p.created_at), p.created_at)
  from auth.users u
 where u.id = p.id
   and p.last_active_at is null;
