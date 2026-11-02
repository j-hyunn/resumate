-- R1 A19 + A20 (DM 2.11.3 / 2.11.5 / §5 v4.2; 확정 2026-11-05).
-- A19: save_provider_key / record_provider_key_check run from the server-only role (service_role). The Server
--   Action checks the session, then calls with p_user_id. authenticated / anon / app_ai_writer / app_key_reader
--   can't execute them (no unverified ciphertext writes or arbitrary status changes from a browser JWT).
--   Ownership = the p_user_id's own key row (every read / write is filtered by it); p_user_id must have a
--   profiles row (user_not_found otherwise; null -> 42501 not_authenticated, the existing mapping).
--   Bodies are otherwise the S3b ones. Old signatures (without p_user_id) are dropped.
-- A20: save_provider_key uses private.ai_consent_allows_run (the helper check_ai_run_allowed and
--   create_application_project already use) instead of "consent cites exactly the current version".
--   private.has_current_ai_consent is no longer used and is dropped.

drop function public.save_provider_key(text, text, bytea, bytea, bytea, text, text, text, text, uuid, text, smallint);
drop function public.record_provider_key_check(text, text, text);
drop function private.has_current_ai_consent(uuid, text, text);

create or replace function public.save_provider_key(
  p_user_id uuid,
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
  v_uid uuid := p_user_id;
  v_existing public.ai_provider_keys;
  v_key public.ai_provider_keys;
  v_active text;
  v_status text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid) then
    raise exception using errcode = 'P0001', message = 'user_not_found';
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

  -- F-AI-04 (4), R1 A20 (DM 2.11.5 v4.2): same re-consent rule as the run gate (check_ai_run_allowed) —
  -- the latest active consent for (provider, tier) is on an effective disclosure and no effective disclosure with
  -- requires_reconsent = true came after it. p_disclosure_version stays as an argument (DM 2.11.3) and only has
  -- to name a known disclosure of this provider x tier; the decision is made from the consent row.
  if p_disclosure_version is null
     or not exists (select 1 from public.ai_disclosures d
                     where d.provider = p_provider and d.connection_tier = p_connection_tier
                       and d.version = p_disclosure_version)
     or not private.ai_consent_allows_run(v_uid, p_provider, p_connection_tier) then
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

revoke all on function public.save_provider_key(uuid, text, text, bytea, bytea, bytea, text, text, text, text, uuid, text, smallint)
  from public, anon, authenticated, app_ai_writer, app_key_reader;
grant execute on function public.save_provider_key(uuid, text, text, bytea, bytea, bytea, text, text, text, text, uuid, text, smallint)
  to service_role;

-- ---------------------------------------------------------------------------------------------
-- record_provider_key_check: "다시 확인" result (DM 2.11.3 v4.1). Updates status / last_verified_at /
-- last_failure_* only; never removes the key.
--   p_result_status: 'valid' (p_failure_cause null) | 'failed' (p_failure_cause = one of 6 key causes).
--   valid -> status valid, last_verified_at = now() (last_failure_* kept as history)
--   key_invalid -> invalid; any other cause -> needs_check; both record last_failure_cause / _at.
-- Errors (P0001): invalid_provider, invalid_result_status, invalid_failure_cause, key_not_found.
-- ---------------------------------------------------------------------------------------------
create or replace function public.record_provider_key_check(
  p_user_id uuid,
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
  v_uid uuid := p_user_id;
  v_key public.ai_provider_keys;
  v_active text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid) then
    raise exception using errcode = 'P0001', message = 'user_not_found';
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

revoke all on function public.record_provider_key_check(uuid, text, text, text)
  from public, anon, authenticated, app_ai_writer, app_key_reader;
grant execute on function public.record_provider_key_check(uuid, text, text, text) to service_role;
