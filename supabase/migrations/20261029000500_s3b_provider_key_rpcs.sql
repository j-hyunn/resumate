-- S3b: key RPCs (DM 2.11.2, 2.11.3, 2.11.4; AI C-10.5, C-11.1; NFR-KEY-03/06/08/09).
-- Error contract: errcode 42501 not_authenticated (no JWT sub), otherwise errcode P0001 with a stable
-- message the app maps (listed per function).
-- Only get_provider_key_secret reads the ciphertext columns; only save_provider_key writes them.

-- Provider causes a key check / AI call can report (C-11.1 failure_cause minus input_rejected).
create or replace function private.is_key_failure_cause(p_cause text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_cause in ('rate_limited', 'daily_quota_exhausted', 'billing_required', 'key_invalid',
                     'model_not_available', 'provider_unavailable');
$$;

revoke all on function private.is_key_failure_cause(text) from public;

-- Key metadata as returned by the key RPCs (same keys as ai_provider_keys_public + is_active).
create or replace function private.provider_key_meta(p_key public.ai_provider_keys, p_active_provider text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_key.id,
    'provider', p_key.provider,
    'connection_tier', p_key.connection_tier,
    'key_last4', p_key.key_last4,
    'status', p_key.status,
    'last_verified_at', p_key.last_verified_at,
    'last_failure_cause', p_key.last_failure_cause,
    'last_failure_at', p_key.last_failure_at,
    'is_active', p_key.provider is not distinct from p_active_provider);
$$;

revoke all on function private.provider_key_meta(public.ai_provider_keys, text) from public;

-- ---------------------------------------------------------------------------------------------
-- save_provider_key: register or replace after verification (R-38 v4.1).
--   p_key_id: chosen by the server before encryption (AAD = user_id|provider|key id). A replacement must
--   pass the existing row's id (the row keeps its id so AAD stays bound to it). [spec-gaps 2026-10-29]
--   p_verification_result: 'valid' (step 2 succeeded) | 'limited' (auth ok, step 2 hit
--   rate_limited / daily_quota_exhausted / provider_unavailable -> stored as needs_check).
--   p_failure_cause: required for 'limited' (one of those three), must be null for 'valid'.
-- Errors (P0001): invalid_provider, invalid_connection_tier, invalid_verification_result,
--   invalid_failure_cause, invalid_key_id, consent_required, key_id_mismatch.
-- Returns provider_key_meta + 'replaced' (boolean).
-- ---------------------------------------------------------------------------------------------
create or replace function public.save_provider_key(
  p_provider text,
  p_connection_tier text,
  p_key_ciphertext bytea,
  p_key_nonce bytea,
  p_wrapped_dek bytea,
  p_kek_id text,
  p_key_last4 text,
  p_disclosure_version text,
  p_verification_result text,
  p_key_id uuid,
  p_failure_cause text default null,
  p_encryption_version smallint default 1
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_existing public.ai_provider_keys;
  v_key public.ai_provider_keys;
  v_active text;
  v_status text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_provider is null or p_provider not in ('openai', 'gemini', 'anthropic') then
    raise exception using errcode = 'P0001', message = 'invalid_provider';
  end if;
  if p_connection_tier is null or p_connection_tier not in ('free', 'paid') then
    raise exception using errcode = 'P0001', message = 'invalid_connection_tier';
  end if;
  if p_verification_result is null or p_verification_result not in ('valid', 'limited') then
    raise exception using errcode = 'P0001', message = 'invalid_verification_result';
  end if;
  if (p_verification_result = 'valid' and p_failure_cause is not null)
     or (p_verification_result = 'limited'
         and (p_failure_cause is null
              or p_failure_cause not in ('rate_limited', 'daily_quota_exhausted', 'provider_unavailable'))) then
    raise exception using errcode = 'P0001', message = 'invalid_failure_cause';
  end if;
  if p_key_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_key_id';
  end if;

  -- F-AI-04 (4): a valid consent for this provider x tier x current disclosure version.
  if p_disclosure_version is null
     or p_disclosure_version is distinct from private.current_ai_disclosure_version(p_provider, p_connection_tier)
     or not private.has_current_ai_consent(v_uid, p_provider, p_connection_tier) then
    raise exception using errcode = 'P0001', message = 'consent_required';
  end if;

  -- Serialize key changes per user (first-key activation, replacement).
  select p.active_ai_provider into v_active
    from public.profiles p where p.id = v_uid for update;

  select * into v_existing
    from public.ai_provider_keys k
   where k.user_id = v_uid and k.provider = p_provider
     for update;

  v_status := case p_verification_result when 'valid' then 'valid' else 'needs_check' end;

  if v_existing.id is not null then
    if v_existing.id <> p_key_id then
      raise exception using errcode = 'P0001', message = 'key_id_mismatch';
    end if;

    update public.ai_provider_keys k
       set connection_tier = p_connection_tier,
           key_ciphertext = p_key_ciphertext,
           key_nonce = p_key_nonce,
           wrapped_dek = p_wrapped_dek,
           kek_id = p_kek_id,
           encryption_version = coalesce(p_encryption_version, 1),
           key_last4 = p_key_last4,
           status = v_status,
           last_verified_at = case v_status when 'valid' then now() end,
           last_failure_cause = p_failure_cause,
           last_failure_at = case when p_failure_cause is not null then now() end
     where k.id = v_existing.id
    returning * into v_key;

    -- Tier change: the consent for the previous tier is withdrawn (DM 2.11.5).
    if v_existing.connection_tier <> p_connection_tier then
      update public.ai_data_use_consents c
         set withdrawn_at = now()
       where c.user_id = v_uid
         and c.provider = p_provider
         and c.connection_tier = v_existing.connection_tier
         and c.withdrawn_at is null;
    end if;
  else
    insert into public.ai_provider_keys
      (id, user_id, provider, connection_tier, key_ciphertext, key_nonce, wrapped_dek, kek_id,
       encryption_version, key_last4, status, last_verified_at, last_failure_cause, last_failure_at)
    values
      (p_key_id, v_uid, p_provider, p_connection_tier, p_key_ciphertext, p_key_nonce, p_wrapped_dek, p_kek_id,
       coalesce(p_encryption_version, 1), p_key_last4, v_status,
       case v_status when 'valid' then now() end,
       p_failure_cause,
       case when p_failure_cause is not null then now() end)
    returning * into v_key;
  end if;

  -- F-AI-01 (5): the first key becomes active. [구현 결정] "first" = no active provider right now
  -- (also covers re-registering after every key was deleted).
  if v_active is null then
    update public.profiles p set active_ai_provider = p_provider where p.id = v_uid;
    v_active := p_provider;
  end if;

  return private.provider_key_meta(v_key, v_active)
         || jsonb_build_object('replaced', v_existing.id is not null);
end;
$$;

revoke all on function public.save_provider_key(text, text, bytea, bytea, bytea, text, text, text, text, uuid, text, smallint)
  from public, anon;
grant execute on function public.save_provider_key(text, text, bytea, bytea, bytea, text, text, text, text, uuid, text, smallint)
  to authenticated;

-- ---------------------------------------------------------------------------------------------
-- record_provider_key_check: "다시 확인" result (DM 2.11.3 v4.1). Updates status / last_verified_at /
-- last_failure_* only; never removes the key.
--   p_result_status: 'valid' (p_failure_cause null) | 'failed' (p_failure_cause = one of 6 key causes).
--   valid -> status valid, last_verified_at = now() (last_failure_* kept as history)
--   key_invalid -> invalid; any other cause -> needs_check; both record last_failure_cause / _at.
-- Errors (P0001): invalid_provider, invalid_result_status, invalid_failure_cause, key_not_found.
-- ---------------------------------------------------------------------------------------------
create or replace function public.record_provider_key_check(
  p_provider text,
  p_result_status text,
  p_failure_cause text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_key public.ai_provider_keys;
  v_active text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_provider is null or p_provider not in ('openai', 'gemini', 'anthropic') then
    raise exception using errcode = 'P0001', message = 'invalid_provider';
  end if;
  if p_result_status is null or p_result_status not in ('valid', 'failed') then
    raise exception using errcode = 'P0001', message = 'invalid_result_status';
  end if;
  if (p_result_status = 'valid' and p_failure_cause is not null)
     or (p_result_status = 'failed' and not coalesce(private.is_key_failure_cause(p_failure_cause), false)) then
    raise exception using errcode = 'P0001', message = 'invalid_failure_cause';
  end if;

  if p_result_status = 'valid' then
    update public.ai_provider_keys k
       set status = 'valid', last_verified_at = now()
     where k.user_id = v_uid and k.provider = p_provider
    returning * into v_key;
  else
    update public.ai_provider_keys k
       set status = case p_failure_cause when 'key_invalid' then 'invalid' else 'needs_check' end,
           last_failure_cause = p_failure_cause,
           last_failure_at = now()
     where k.user_id = v_uid and k.provider = p_provider
    returning * into v_key;
  end if;

  if v_key.id is null then
    raise exception using errcode = 'P0001', message = 'key_not_found';
  end if;

  select p.active_ai_provider into v_active from public.profiles p where p.id = v_uid;
  return private.provider_key_meta(v_key, v_active);
end;
$$;

revoke all on function public.record_provider_key_check(text, text, text) from public, anon;
grant execute on function public.record_provider_key_check(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- mark_provider_key_invalid (app_ai_writer): an AI call of job p_ai_job_id failed with a key-related
-- provider cause. key_invalid -> status invalid + last_failure_*; other causes -> last_failure_* only
-- (status kept). Never reads the ciphertext columns (NFR-KEY-09).
-- Returns true when a key row was updated, false when the key no longer exists (deleted mid-run).
-- Errors: P0001 ai_job_not_found (unknown / another user's job), invalid_failure_cause.
-- ---------------------------------------------------------------------------------------------
create or replace function public.mark_provider_key_invalid(p_ai_job_id uuid, p_failure_cause text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_provider text;
  v_updated int;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if not coalesce(private.is_key_failure_cause(p_failure_cause), false) then
    raise exception using errcode = 'P0001', message = 'invalid_failure_cause';
  end if;

  select j.provider into v_provider
    from public.ai_jobs j where j.id = p_ai_job_id and j.user_id = v_uid;
  if v_provider is null then
    raise exception using errcode = 'P0001', message = 'ai_job_not_found';
  end if;

  update public.ai_provider_keys k
     set status = case when p_failure_cause = 'key_invalid' then 'invalid' else k.status end,
         last_failure_cause = p_failure_cause,
         last_failure_at = now()
   where k.user_id = v_uid and k.provider = v_provider;
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.mark_provider_key_invalid(uuid, text) from public, anon;
grant execute on function public.mark_provider_key_invalid(uuid, text) to app_ai_writer;

-- ---------------------------------------------------------------------------------------------
-- record_provider_key_success (app_ai_writer) [S3b proposal, DM 2.11.3 "needs_check -> valid on the next
-- successful run"]: a provider call of job p_ai_job_id succeeded. Only a needs_check key changes:
-- -> valid, last_verified_at = now(). valid / invalid keys are left alone (invalid keys can't start jobs).
-- The job must be running or succeeded (a successful call happened inside it).
-- Returns true when the key went needs_check -> valid.
-- Errors: P0001 ai_job_not_found, invalid_ai_job_state.
-- ---------------------------------------------------------------------------------------------
create or replace function public.record_provider_key_success(p_ai_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_job record;
  v_updated int;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  select j.provider, j.status into v_job
    from public.ai_jobs j where j.id = p_ai_job_id and j.user_id = v_uid;
  if v_job.provider is null then
    raise exception using errcode = 'P0001', message = 'ai_job_not_found';
  end if;
  if v_job.status not in ('running', 'succeeded') then
    raise exception using errcode = 'P0001', message = 'invalid_ai_job_state';
  end if;

  update public.ai_provider_keys k
     set status = 'valid', last_verified_at = now()
   where k.user_id = v_uid and k.provider = v_job.provider and k.status = 'needs_check';
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.record_provider_key_success(uuid) from public, anon;
grant execute on function public.record_provider_key_success(uuid) to app_ai_writer;

-- ---------------------------------------------------------------------------------------------
-- delete_provider_key (security invoker, user session): immediate hard delete (NFR-KEY-06). The FK clears
-- profiles.active_ai_provider when it was this provider (no automatic switch, F-AI-02 (3)); the
-- provider's active consents (every tier) get withdrawn_at. Running jobs fail with key_missing at their
-- next step (get_provider_key_secret returns no row).
-- Idempotent: returns false when there was no key.
-- Errors: P0001 invalid_provider.
-- ---------------------------------------------------------------------------------------------
create or replace function public.delete_provider_key(p_provider text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := private.current_uid();
  v_deleted int;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_provider is null or p_provider not in ('openai', 'gemini', 'anthropic') then
    raise exception using errcode = 'P0001', message = 'invalid_provider';
  end if;

  -- Own rows only through RLS (ai_provider_keys_delete_own). No user_id filter here: authenticated has no
  -- SELECT grant on user_id (DM 2.11.1 screen columns), and a WHERE on it would need one.
  delete from public.ai_provider_keys k where k.provider = p_provider;
  get diagnostics v_deleted = row_count;

  update public.ai_data_use_consents c
     set withdrawn_at = now()
   where c.user_id = v_uid and c.provider = p_provider and c.withdrawn_at is null;

  return v_deleted > 0;
end;
$$;

revoke all on function public.delete_provider_key(text) from public, anon;
grant execute on function public.delete_provider_key(text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- set_active_ai_provider (security definer + ownership): only a provider with a registered key
-- (any status). Takes effect from the next job (F-AI-03 (2)); running jobs keep their provider.
-- Errors: P0001 invalid_provider, key_not_found.
-- ---------------------------------------------------------------------------------------------
create or replace function public.set_active_ai_provider(p_provider text)
returns void
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
  if p_provider is null or p_provider not in ('openai', 'gemini', 'anthropic') then
    raise exception using errcode = 'P0001', message = 'invalid_provider';
  end if;
  if not exists (select 1 from public.ai_provider_keys k where k.user_id = v_uid and k.provider = p_provider) then
    raise exception using errcode = 'P0001', message = 'key_not_found';
  end if;

  update public.profiles p set active_ai_provider = p_provider where p.id = v_uid;
end;
$$;

revoke all on function public.set_active_ai_provider(text) from public, anon;
grant execute on function public.set_active_ai_provider(text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- get_provider_key_secret (app_key_reader only; DM 2.11.2 step 2, NFR-KEY-03/08).
-- Returns the ciphertext of the key bound to a RUNNING job of the caller (JWT sub = job user) whose
-- heartbeat is within 2 minutes, for the job's provider:
--   * job not found / another user's / not running / heartbeat null or older than 2 min
--       -> P0001 key_not_available
--   * job ok but no key row for (user, provider) (deleted mid-run) -> zero rows (app: key_missing)
-- key_id is returned for AAD (user_id|provider|key_id).
-- ---------------------------------------------------------------------------------------------
create or replace function public.get_provider_key_secret(p_ai_job_id uuid)
returns table (
  key_id uuid,
  key_ciphertext bytea,
  key_nonce bytea,
  wrapped_dek bytea,
  kek_id text,
  encryption_version smallint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_heartbeat_window constant interval := interval '2 minutes';
  v_uid uuid := auth.uid();
  v_job_user uuid;
  v_provider text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  select j.user_id, j.provider into v_job_user, v_provider
    from public.ai_jobs j
   where j.id = p_ai_job_id
     and j.user_id = v_uid
     and j.status = 'running'
     and j.heartbeat_at is not null
     and j.heartbeat_at >= now() - c_heartbeat_window;

  if v_job_user is null then
    raise exception using errcode = 'P0001', message = 'key_not_available';
  end if;

  return query
    select k.id, k.key_ciphertext, k.key_nonce, k.wrapped_dek, k.kek_id, k.encryption_version
      from public.ai_provider_keys k
     where k.user_id = v_job_user and k.provider = v_provider;
end;
$$;

revoke all on function public.get_provider_key_secret(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_provider_key_secret(uuid) to app_key_reader;
