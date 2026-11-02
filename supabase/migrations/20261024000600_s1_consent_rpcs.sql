-- S1 foundation: consent RPCs (F-COM-02, S-03 consent gate). Both security invoker (user RLS).

-- Status per consent type for the current user.
--   required        : terms, privacy_required, cross_border_transfer
--   current_version : latest effective version of the mapped policy type
--   agreed_version  : version of the user's latest row for the type, when that row is agreed
--                     and not withdrawn; otherwise null
--   needs_consent   : required types only (optional types are always false). True when there is
--                     no active agreement, or the agreed version is older than current and some
--                     version after it (up to current) has requires_reconsent.
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
      ('cross_border_transfer', true, 3),
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

-- Record one row per item at the server-side current version (client versions are not trusted).
--   items: [{ "consent_type": "<type>", "agreed": true|false }, ...]
--   Raises (errcode P0001, message):
--     invalid_consent_items     items is not a non-empty array of {consent_type, agreed:boolean}
--     invalid_consent_type      unknown consent_type
--     duplicate_consent_type    same type twice in one call
--     policy_version_missing    no effective policy version for the mapped type
--     required_consent_missing  a required item is agreed = false, or after this call a required
--                               type still needs consent
--   Returns the same shape as get_consent_status() after recording.
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

    if v_type in ('terms', 'privacy_required', 'cross_border_transfer')
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

revoke all on function public.get_consent_status() from public, anon;
revoke all on function public.record_consents(jsonb, text) from public, anon;
grant execute on function public.get_consent_status() to authenticated;
grant execute on function public.record_consents(jsonb, text) to authenticated;
