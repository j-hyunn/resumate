-- S1 foundation: consents (DM A.2, F-COM-02, NFR-PRV-02/03).
-- One consent action = one row. Withdrawal sets withdrawn_at (optional consents only).
-- Re-consent is a new row. No updated_at: rows are an append-only record [가정, A.2 column list].

create table public.consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  consent_type text not null,
  policy_version text not null,
  agreed boolean not null,
  agreed_at timestamptz not null default clock_timestamp(),
  withdrawn_at timestamptz,
  user_agent_hash text,
  created_at timestamptz not null default now(),
  constraint consents_consent_type_check
    check (consent_type in ('terms', 'privacy_required', 'cross_border_transfer',
                            'service_improvement', 'marketing')),
  -- Only optional consents can be withdrawn (A.2).
  constraint consents_withdrawn_at_check
    check (withdrawn_at is null or consent_type in ('service_improvement', 'marketing')),
  constraint consents_user_agent_hash_check check (char_length(user_agent_hash) <= 128)
);

alter table public.consents enable row level security;

create index consents_user_type_agreed_at_idx
  on public.consents (user_id, consent_type, agreed_at desc);

-- consent_type -> policy_type. Optional consents follow the privacy policy version [가정, spec-gaps.md].
create or replace function private.consent_policy_type(p_consent_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_consent_type
    when 'terms' then 'terms'
    when 'privacy_required' then 'privacy'
    when 'cross_border_transfer' then 'cross_border_transfer'
    when 'service_improvement' then 'privacy'
    when 'marketing' then 'privacy'
  end;
$$;

-- Latest effective version of a policy type (null if none is effective yet).
create or replace function private.current_policy_version(p_policy_type text)
returns text
language sql
stable
set search_path = ''
as $$
  select pv.version
    from public.policy_versions pv
   where pv.policy_type = p_policy_type
     and pv.effective_at <= now()
   order by pv.effective_at desc
   limit 1;
$$;

revoke all on function private.consent_policy_type(text) from public;
revoke all on function private.current_policy_version(text) from public;
grant execute on function private.consent_policy_type(text) to authenticated, service_role;
grant execute on function private.current_policy_version(text) to authenticated, service_role;

-- Insert guard: the row must cite an existing version of the mapped policy, the timestamp is
-- the server's, and a new row is never born withdrawn. Applies to direct inserts and the RPC.
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

  new.agreed_at := clock_timestamp();
  new.withdrawn_at := null;
  return new;
end;
$$;

revoke all on function private.consents_before_insert() from public;

create trigger consents_before_insert
  before insert on public.consents
  for each row execute function private.consents_before_insert();

-- RLS (A.2): select/insert own; update = withdraw an active optional consent only; no delete.
create policy consents_select_own on public.consents
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy consents_insert_own on public.consents
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy consents_update_withdraw_optional_own on public.consents
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and consent_type in ('service_improvement', 'marketing')
    and agreed
    and withdrawn_at is null
  )
  with check (
    user_id = (select auth.uid())
    and consent_type in ('service_improvement', 'marketing')
    and withdrawn_at is not null
  );

revoke all on table public.consents from anon, authenticated;
grant select on table public.consents to authenticated;
grant insert (user_id, consent_type, policy_version, agreed, user_agent_hash)
  on table public.consents to authenticated;
grant update (withdrawn_at) on table public.consents to authenticated;
-- app_ai_writer: no access (DM §5).
