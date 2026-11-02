-- S1 QA-01, QA-02: make direct writes to consents follow the same rules as record_consents.
-- Direct insert stays open (A.2: insert 본인), but the guard now enforces:
--   * policy_version must be the version currently in effect for the mapped policy type
--     (no consent to a not-yet-effective or superseded document)
--   * required types (terms, privacy_required, cross_border_transfer) only as agreed = true
--     (A.2: required consents are never withdrawn / declined after sign-up)
-- and withdrawn_at always gets the server time on update.

create or replace function private.consents_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
      from public.policy_versions pv
     where pv.policy_type = private.consent_policy_type(new.consent_type)
       and pv.version = new.policy_version
  ) then
    raise exception using errcode = 'P0001', message = 'unknown_policy_version';
  end if;

  if new.policy_version is distinct from
     private.current_policy_version(private.consent_policy_type(new.consent_type)) then
    raise exception using errcode = 'P0001', message = 'policy_version_not_current';
  end if;

  if new.consent_type in ('terms', 'privacy_required', 'cross_border_transfer')
     and not new.agreed then
    raise exception using errcode = 'P0001', message = 'required_consent_missing';
  end if;

  new.agreed_at := clock_timestamp();
  new.withdrawn_at := null;
  return new;
end;
$$;

revoke all on function private.consents_before_insert() from public;

-- QA-01: the withdrawal time is the server's, whatever non-null value the client sends.
create or replace function private.consents_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.withdrawn_at is distinct from old.withdrawn_at and new.withdrawn_at is not null then
    new.withdrawn_at := clock_timestamp();
  end if;
  return new;
end;
$$;

revoke all on function private.consents_before_update() from public;

create trigger consents_before_update
  before update on public.consents
  for each row execute function private.consents_before_update();
