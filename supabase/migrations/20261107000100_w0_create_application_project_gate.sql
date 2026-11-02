-- W0 Q53-1 (DM 2.7.1, 2.11.7 path ⑥): create_application_project refuses BEFORE any insert when the active provider
-- can't run: key_invalid / ai_consent_required, HTTP 409, no orphan row.
-- Order: arguments -> existing p_id (created: false, gate not checked) -> gate -> insert.
--   no active provider (or no key row for it) -> passes, saved without extraction (D-30)
--   needs_check                               -> passes
-- Passing here means user_ai_run_allowed is true for any user with an active provider, so the fallback-name branch
-- now only runs for key-less users. Same p_id after consent creates normally.

create or replace function public.create_application_project(
  p_id uuid,
  p_raw_text text,
  p_raw_text_hash text,
  p_sentences jsonb,
  p_company_name text default null,
  p_position_title text default null,
  p_name text default null,
  p_deadline date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := nullif(btrim(p_name), '');
  v_company text := nullif(btrim(p_company_name), '');
  v_position text := nullif(btrim(p_position_title), '');
  v_allowed boolean;
  v_name_source text;
  v_inserted uuid;
  v_owner uuid;
  v_jd_id uuid;
  v_status text;
  v_key_status text;
  v_key_provider text;
  v_key_tier text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_id';
  end if;
  if p_raw_text is null or btrim(p_raw_text) = '' or char_length(p_raw_text) > 50000 then
    raise exception using errcode = 'P0001', message = 'invalid_raw_text';
  end if;
  if p_raw_text_hash is null or btrim(p_raw_text_hash) = '' or char_length(p_raw_text_hash) > 128 then
    raise exception using errcode = 'P0001', message = 'invalid_raw_text_hash';
  end if;
  if not private.jd_sentences_valid(p_sentences) then
    raise exception using errcode = 'P0001', message = 'invalid_sentences';
  end if;
  if char_length(v_name) > 100 then
    raise exception using errcode = 'P0001', message = 'invalid_name';
  end if;
  if char_length(v_company) > 200 then
    raise exception using errcode = 'P0001', message = 'invalid_company_name';
  end if;
  if char_length(v_position) > 200 then
    raise exception using errcode = 'P0001', message = 'invalid_position_title';
  end if;

  -- Q53-1: only a new id reaches the gate; a retry with an existing id falls through to the conflict branch below.
  -- Never reads ciphertext columns.
  if not exists (select 1 from public.application_projects ap where ap.id = p_id) then
    select k.status, k.provider, k.connection_tier into v_key_status, v_key_provider, v_key_tier
      from public.profiles p
      join public.ai_provider_keys k on k.user_id = p.id and k.provider = p.active_ai_provider
     where p.id = v_uid;
    if found then
      if v_key_status = 'invalid' then
        raise exception using errcode = 'P0001', message = 'key_invalid';
      end if;
      if not private.ai_consent_allows_run(v_uid, v_key_provider, v_key_tier) then
        raise exception using errcode = 'P0001', message = 'ai_consent_required';
      end if;
    end if;
  end if;

  v_allowed := private.user_ai_run_allowed(v_uid);

  if v_name is not null then
    v_name_source := 'user';
  elsif not v_allowed then
    select f.name, f.name_source into v_name, v_name_source
      from private.application_fallback_name(v_company, v_position, now()) f;
  end if;

  insert into public.application_projects (id, user_id, name, name_source, deadline)
  values (p_id, v_uid, v_name, v_name_source, p_deadline)
  on conflict (id) do nothing
  returning id into v_inserted;

  if v_inserted is null then
    -- Retry with the same id (or someone else's id).
    select ap.user_id, ap.name, ap.name_source into v_owner, v_name, v_name_source
      from public.application_projects ap where ap.id = p_id;
    if v_owner is distinct from v_uid then
      raise exception using errcode = 'P0001', message = 'application_project_id_conflict';
    end if;
    select jd.id, jd.extraction_status into v_jd_id, v_status
      from public.job_descriptions jd where jd.application_project_id = p_id;
    return jsonb_build_object(
      'application_project_id', p_id, 'job_description_id', v_jd_id,
      'name', v_name, 'name_source', v_name_source, 'extraction_status', v_status,
      'ai_run_allowed', v_allowed, 'created', false);
  end if;

  insert into public.job_descriptions (user_id, application_project_id, raw_text, raw_text_hash, sentences,
                                       company_name, company_name_source, position_title, position_title_source)
  values (v_uid, p_id, p_raw_text, btrim(p_raw_text_hash), p_sentences,
          v_company, case when v_company is not null then 'user' end,
          v_position, case when v_position is not null then 'user' end)
  returning id into v_jd_id;

  insert into public.application_stage_events (user_id, application_project_id, event_type, to_stage)
  values (v_uid, p_id, 'created', 'before_apply');

  return jsonb_build_object(
    'application_project_id', p_id, 'job_description_id', v_jd_id,
    'name', v_name, 'name_source', v_name_source, 'extraction_status', 'pending',
    'ai_run_allowed', v_allowed, 'created', true);
end;
$$;
