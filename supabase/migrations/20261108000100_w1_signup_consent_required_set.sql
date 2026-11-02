-- W1 (spec-gaps ⑲): cross_border_transfer is no longer a required sign-up consent.
-- PRD F-COM-02, UX S-03, D-39: AI-provider cross-border consent is taken per provider at key connection
-- (C-21, ai_data_use_consents), which is what every AI run gate reads (private.ai_consent_allows_run).
-- The type stays valid in the consent_type / policy_type CHECKs for existing rows and the S-30 notice.
--   required set     : terms, privacy_required
--   cross_border_transfer : required = false, needs_consent = false, so a newer requires_reconsent
--                      version no longer sends anyone back to S-03. Still recordable, and can now be
--                      recorded as agreed = false like any other non-required type.
-- Signatures, security invoker, and grants are unchanged. Withdrawal rules are unchanged
-- (consents_withdrawn_at_check, consents_update_withdraw_optional_own: optional types only).

create or replace function public.get_consent_status()
returns table (
  consent_type text,
  required boolean,
  current_version text,
  agreed_version text,
  needs_consent boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with types (consent_type, required, sort_order) as (
    values
      ('terms', true, 1),
      ('privacy_required', true, 2),
      ('cross_border_transfer', false, 3),
      ('service_improvement', false, 4),
      ('marketing', false, 5)
  ),
  latest as (
    select distinct on (c.consent_type)
           c.consent_type, c.policy_version, c.agreed, c.withdrawn_at
      from public.consents c
     where c.user_id = (select auth.uid())
     order by c.consent_type, c.agreed_at desc, c.created_at desc, c.id desc
  ),
  resolved as (
    select t.consent_type,
           t.required,
           t.sort_order,
           private.consent_policy_type(t.consent_type) as policy_type,
           private.current_policy_version(private.consent_policy_type(t.consent_type)) as current_version,
           case when l.agreed and l.withdrawn_at is null then l.policy_version end as agreed_version
      from types t
      left join latest l on l.consent_type = t.consent_type
  )
  select r.consent_type,
         r.required,
         r.current_version,
         r.agreed_version,
         case
           when not r.required then false
           when r.agreed_version is null then true
           when r.agreed_version = r.current_version then false
           else exists (
             select 1
               from public.policy_versions pv
               join public.policy_versions agreed_pv
                 on agreed_pv.policy_type = r.policy_type
                and agreed_pv.version = r.agreed_version
              where pv.policy_type = r.policy_type
                and pv.effective_at > agreed_pv.effective_at
                and pv.effective_at <= now()
                and pv.requires_reconsent
           )
         end as needs_consent
    from resolved r
   order by r.sort_order;
$$;

create or replace function public.record_consents(items jsonb, user_agent_hash text default null)
returns table (
  consent_type text,
  required boolean,
  current_version text,
  agreed_version text,
  needs_consent boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_item jsonb;
  v_type text;
  v_version text;
  v_seen text[] := '{}';
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  if items is null or jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then
    raise exception using errcode = 'P0001', message = 'invalid_consent_items';
  end if;

  for v_item in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item -> 'consent_type') is distinct from 'string'
       or jsonb_typeof(v_item -> 'agreed') is distinct from 'boolean' then
      raise exception using errcode = 'P0001', message = 'invalid_consent_items';
    end if;

    v_type := v_item ->> 'consent_type';

    if v_type not in ('terms', 'privacy_required', 'cross_border_transfer',
                      'service_improvement', 'marketing') then
      raise exception using errcode = 'P0001', message = 'invalid_consent_type';
    end if;

    if v_type = any (v_seen) then
      raise exception using errcode = 'P0001', message = 'duplicate_consent_type';
    end if;
    v_seen := v_seen || v_type;

    if v_type in ('terms', 'privacy_required')
       and not (v_item ->> 'agreed')::boolean then
      raise exception using errcode = 'P0001', message = 'required_consent_missing';
    end if;

    v_version := private.current_policy_version(private.consent_policy_type(v_type));
    if v_version is null then
      raise exception using errcode = 'P0001', message = 'policy_version_missing';
    end if;

    insert into public.consents (user_id, consent_type, policy_version, agreed, user_agent_hash)
    values (v_uid, v_type, v_version, (v_item ->> 'agreed')::boolean,
            record_consents.user_agent_hash);
  end loop;

  if exists (select 1 from public.get_consent_status() s where s.required and s.needs_consent) then
    raise exception using errcode = 'P0001', message = 'required_consent_missing';
  end if;

  return query select * from public.get_consent_status();
end;
$$;

-- Direct-insert guard follows the same required set.
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

  if new.consent_type in ('terms', 'privacy_required')
     and not new.agreed then
    raise exception using errcode = 'P0001', message = 'required_consent_missing';
  end if;

  new.agreed_at := clock_timestamp();
  new.withdrawn_at := null;
  return new;
end;
$$;

revoke all on function private.consents_before_insert() from public;
