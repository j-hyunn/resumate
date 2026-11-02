-- R3 (R-67): get_data_readiness().ai_connection gains consent_required (DM 2.11.7, DM §6
-- ai_connection.consent_required). The screen uses it to open C-21 before an AI run and to tell a
-- consent-caused key_missing apart (paths 3/4/5 keep returning key_missing; server refusal unchanged).
--   true  : the active provider's (provider, active key connection_tier) fails the run-time consent
--           rule (DM 2.11.5) — no active consent row, or an effective requires_reconsent disclosure
--           newer than the agreed one.
--   false : consent is in place.
--   null  : no active provider or no active key (same as the other three fields).
-- The rule is private.ai_consent_allows_run, the same helper check_ai_run_allowed / retry_ai_job /
-- save_provider_key use. key_status is not consulted (computed independently, DM §6).
-- Security, owner, and grants are unchanged (security definer: callers have no access to
-- ai_provider_keys / ai_data_use_consents through this helper beyond these four values).

create or replace function private.current_ai_connection()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'active_provider', p.active_ai_provider,
    'key_status', k.status,
    'connection_tier', k.connection_tier,
    'consent_required', case
      when p.active_ai_provider is null or k.id is null then null
      else not private.ai_consent_allows_run(p.id, k.provider, k.connection_tier)
    end)
    from (select auth.uid() as uid) u
    left join public.profiles p on p.id = u.uid
    left join public.ai_provider_keys k on k.user_id = p.id and k.provider = p.active_ai_provider;
$$;

revoke all on function private.current_ai_connection() from public;
grant execute on function private.current_ai_connection() to authenticated, app_ai_writer;
