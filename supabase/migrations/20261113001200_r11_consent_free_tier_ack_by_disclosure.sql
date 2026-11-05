-- R11 R11-DB-1, leader decision (R-OD-15): the free-tier acknowledgement is required only when the cited disclosure
-- row has requires_free_tier_ack = true (v2026-11-05: Gemini free only; v2026-10-29 rows: every free tier).
-- The S3b CHECK ai_data_use_consents_free_tier_acknowledged_check ("every free consent acknowledges") is replaced by
-- the same rule in the insert guard, which already looks up the disclosure row. Existing rows stay valid (they all
-- satisfied the stricter CHECK). Same SQLSTATE as the CHECK (23514) so the API mapping is unchanged.
-- Not destructive: a constraint is relaxed, no row changes.

alter table public.ai_data_use_consents drop constraint ai_data_use_consents_free_tier_acknowledged_check;

create or replace function private.ai_data_use_consents_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_requires_ack boolean;
begin
  select d.requires_free_tier_ack into v_requires_ack
    from public.ai_disclosures d
   where d.provider = new.provider
     and d.connection_tier = new.connection_tier
     and d.version = new.disclosure_version;
  if not found then
    raise exception using errcode = 'P0001', message = 'unknown_disclosure_version';
  end if;

  if new.disclosure_version is distinct from
     private.current_ai_disclosure_version(new.provider, new.connection_tier) then
    raise exception using errcode = 'P0001', message = 'disclosure_version_not_current';
  end if;

  -- F-AI-04 (3) / R-OD-15: only where the disclosure asks for it.
  if v_requires_ack and not coalesce(new.free_tier_acknowledged, false) then
    raise exception using errcode = '23514', message = 'free_tier_acknowledgement_required';
  end if;

  new.agreed_at := clock_timestamp();
  new.withdrawn_at := null;
  return new;
end;
$$;

revoke all on function private.ai_data_use_consents_before_insert() from public;
