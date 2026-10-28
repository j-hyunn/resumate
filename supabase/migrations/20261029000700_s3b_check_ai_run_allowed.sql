-- S3b QA-S3b-01: run-time gate for the job runner (app_ai_writer has no access to keys / consents).
-- check_ai_run_allowed(p_ai_job_id) returns null when the job may call its provider, otherwise
--   'key_missing'      no key row for the job's user + provider
--   'key_invalid'      that key's status is invalid
--   'consent_required' the run-time consent rule (DM 2.11.5) fails for the job's provider and the key's
--                      CURRENT connection_tier — same rule as api mayRunWithConsent():
--                        * latest non-withdrawn consent for (provider, tier) exists,
--                        * its disclosure_version is an effective ai_disclosures row (effective_at <= now()),
--                        * no effective disclosure with requires_reconsent = true is newer than it.
-- Never reads the ciphertext columns. Errors: 42501 not_authenticated, P0001 ai_job_not_found
-- (unknown job or another user's job: JWT sub must be the job's user_id).

create or replace function private.ai_consent_allows_run(p_user_id uuid, p_provider text, p_connection_tier text)
returns boolean
language sql
stable
set search_path = ''
as $$
  with agreed as (
    select c.disclosure_version
      from public.ai_data_use_consents c
     where c.user_id = p_user_id and c.provider = p_provider and c.connection_tier = p_connection_tier
       and c.withdrawn_at is null
     order by c.agreed_at desc, c.created_at desc
     limit 1
  ), agreed_disclosure as (
    select d.effective_at
      from agreed a
      join public.ai_disclosures d
        on d.provider = p_provider and d.connection_tier = p_connection_tier
       and d.version = a.disclosure_version and d.effective_at <= now()
  )
  select exists (select 1 from agreed_disclosure)
         and not exists (
           select 1 from public.ai_disclosures d, agreed_disclosure ad
            where d.provider = p_provider and d.connection_tier = p_connection_tier
              and d.requires_reconsent and d.effective_at <= now() and d.effective_at > ad.effective_at);
$$;

revoke all on function private.ai_consent_allows_run(uuid, text, text) from public;

create or replace function public.check_ai_run_allowed(p_ai_job_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.current_uid();
  v_provider text;
  v_status text;
  v_tier text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  select j.provider into v_provider
    from public.ai_jobs j where j.id = p_ai_job_id and j.user_id = v_uid;
  if v_provider is null then
    raise exception using errcode = 'P0001', message = 'ai_job_not_found';
  end if;

  select k.status, k.connection_tier into v_status, v_tier
    from public.ai_provider_keys k where k.user_id = v_uid and k.provider = v_provider;
  if v_status is null then
    return 'key_missing';
  end if;
  if v_status = 'invalid' then
    return 'key_invalid';
  end if;
  if not private.ai_consent_allows_run(v_uid, v_provider, v_tier) then
    return 'consent_required';
  end if;
  return null;
end;
$$;

revoke all on function public.check_ai_run_allowed(uuid) from public, anon, authenticated, service_role;
grant execute on function public.check_ai_run_allowed(uuid) to app_ai_writer;
