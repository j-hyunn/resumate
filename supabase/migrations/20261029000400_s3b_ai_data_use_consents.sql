-- S3b: ai_data_use_consents (DM 2.11.5, F-AI-04, D-32, NFR-PRV-03/04).
-- One consent action = one row (same rule as consents); re-consent is a new row. Append-only record
-- without updated_at (as consents, A.2). Withdrawn on key delete, tier change, or by the user.

create table public.ai_data_use_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  provider text not null,
  connection_tier text not null,
  disclosure_version text not null,
  free_tier_acknowledged boolean not null default false,
  agreed_at timestamptz not null default clock_timestamp(),
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  constraint ai_data_use_consents_provider_check check (provider in ('openai', 'gemini', 'anthropic')),
  constraint ai_data_use_consents_connection_tier_check check (connection_tier in ('free', 'paid')),
  constraint ai_data_use_consents_free_tier_acknowledged_check
    check (connection_tier <> 'free' or free_tier_acknowledged)
);

alter table public.ai_data_use_consents enable row level security;

create index ai_data_use_consents_lookup_idx
  on public.ai_data_use_consents (user_id, provider, connection_tier, agreed_at desc);

-- Insert guard (same approach as consents, S1 QA-01/02): the cited disclosure must be the version
-- currently in effect for (provider, tier), the time is the server's, and a row is never born withdrawn.
create or replace function private.ai_data_use_consents_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.ai_disclosures d
     where d.provider = new.provider
       and d.connection_tier = new.connection_tier
       and d.version = new.disclosure_version
  ) then
    raise exception using errcode = 'P0001', message = 'unknown_disclosure_version';
  end if;

  if new.disclosure_version is distinct from
     private.current_ai_disclosure_version(new.provider, new.connection_tier) then
    raise exception using errcode = 'P0001', message = 'disclosure_version_not_current';
  end if;

  new.agreed_at := clock_timestamp();
  new.withdrawn_at := null;
  return new;
end;
$$;

revoke all on function private.ai_data_use_consents_before_insert() from public;

create trigger ai_data_use_consents_before_insert
  before insert on public.ai_data_use_consents
  for each row execute function private.ai_data_use_consents_before_insert();

-- Withdrawal time is the server's, whatever non-null value the client sends.
create or replace function private.ai_data_use_consents_before_update()
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

revoke all on function private.ai_data_use_consents_before_update() from public;

create trigger ai_data_use_consents_before_update
  before update on public.ai_data_use_consents
  for each row execute function private.ai_data_use_consents_before_update();

-- RLS (DM 2.11.5): select / insert own; update = withdraw an active row only; no delete (account cascade).
create policy ai_data_use_consents_select_own on public.ai_data_use_consents
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy ai_data_use_consents_insert_own on public.ai_data_use_consents
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy ai_data_use_consents_update_withdraw_own on public.ai_data_use_consents
  for update to authenticated
  using (user_id = (select auth.uid()) and withdrawn_at is null)
  with check (user_id = (select auth.uid()) and withdrawn_at is not null);

revoke all on table public.ai_data_use_consents from anon, authenticated;
grant select on table public.ai_data_use_consents to authenticated;
grant insert (user_id, provider, connection_tier, disclosure_version, free_tier_acknowledged)
  on table public.ai_data_use_consents to authenticated;
grant update (withdrawn_at) on table public.ai_data_use_consents to authenticated;
-- app_ai_writer: no access. The AI run handler checks consent with the user session (DM 2.11.5).

-- Re-consent check (DM 2.11.5): the latest active row for (user, provider, tier) must cite the current
-- disclosure version. Invoker: callers see only their own rows through RLS.
create or replace function private.has_current_ai_consent(p_user_id uuid, p_provider text, p_connection_tier text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select c.disclosure_version = private.current_ai_disclosure_version(p_provider, p_connection_tier)
      from public.ai_data_use_consents c
     where c.user_id = p_user_id
       and c.provider = p_provider
       and c.connection_tier = p_connection_tier
       and c.withdrawn_at is null
     order by c.agreed_at desc, c.created_at desc
     limit 1), false);
$$;

revoke all on function private.has_current_ai_consent(uuid, text, text) from public;
