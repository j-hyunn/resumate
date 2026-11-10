-- R15 / D11 (DM 11.10 #2·#5b·#9, §2.6.2 — CF-10·CF-A6·CF-A17·CF-9, AI 요청 2)
-- Two new trailing arguments, so the old 8-argument function must be DROPPED and recreated (two overloads of the
-- same name would make every caller ambiguous).
--   p_source_url      the posting URL from step 1 (CHECK: http(s), <= 2,048 — invalid_source_url 400 `[가정]`).
--   p_preview_job_id  the [다음] preview extraction run. Ownership / job_type / target_type / succeeded /
--                     not-yet-linked / finished within 24h failures are NOT errors: the result is simply not
--                     applied and the return says why.
-- The preview is applied only when the hash the RPC RECOMPUTES from p_raw_text matches params.raw_text_hash and
-- jsonb_array_length(p_sentences) = params.sentence_count — the client's p_raw_text_hash is never trusted, because
-- authenticated may call this RPC directly and could otherwise attach a preview result to a different posting.
-- The linking (ai_jobs.target_id / application_project_id and the run's ai_usage_records.application_project_id)
-- happens even when the result is discarded — those tokens were spent for this application `[가정]`.
drop function public.create_application_project(uuid, text, text, jsonb, text, text, text, date);

create function public.create_application_project(
  p_id uuid,
  p_raw_text text,
  p_raw_text_hash text,
  p_sentences jsonb,
  p_company_name text default null,
  p_position_title text default null,
  p_name text default null,
  p_deadline date default null,
  p_source_url text default null,
  p_preview_job_id uuid default null
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
  v_source_url text := nullif(btrim(p_source_url), '');
  v_allowed boolean;
  v_name_source text;
  v_inserted uuid;
  v_owner uuid;
  v_jd_id uuid;
  v_status text;
  v_key_status text;
  v_key_provider text;
  v_key_tier text;
  v_job public.ai_jobs%rowtype;
  v_jd public.job_descriptions%rowtype;
  v_project public.application_projects%rowtype;
  v_preview_applied boolean := false;
  v_preview_reason text;
  v_linkable boolean := false;
  v_hash text;
  v_sentence_count integer;
  v_applied jsonb;
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
  -- (v4.15, CF-10 `[가정]`) argument check, so nothing is written: the screen may resend the same p_id without it.
  if v_source_url is not null and (char_length(v_source_url) > 2048 or v_source_url !~* '^https?://') then
    raise exception using errcode = 'P0001', message = 'invalid_source_url';
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

  -- (v4.15 ★, CF-9·CF-A7) a company name — confirmed by the user in step 2 — names the application right away,
  -- with or without a key. Only when there is none does the old "wait for the extraction" path apply.
  if v_name is not null then
    v_name_source := 'user';
  elsif v_company is not null then
    v_name := private.application_compose_name(v_company, null);
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
    -- Retry with the same id (or someone else's id). The preview is not applied again (a linked run already has
    -- target_id filled, DM §2.6.2).
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
      'ai_run_allowed', v_allowed, 'created', false,
      'preview_applied', false, 'preview_skip_reason', null);
  end if;

  insert into public.job_descriptions (user_id, application_project_id, raw_text, raw_text_hash, sentences,
                                       company_name, company_name_source, position_title, position_title_source,
                                       source_url)
  values (v_uid, p_id, p_raw_text, btrim(p_raw_text_hash), p_sentences,
          v_company, case when v_company is not null then 'user' end,
          v_position, case when v_position is not null then 'user' end,
          v_source_url)
  returning id into v_jd_id;

  insert into public.application_stage_events (user_id, application_project_id, event_type, to_stage)
  values (v_uid, p_id, 'created', 'before_apply');

  -- (v4.15, CF-A17) the preview run of [다음].
  if p_preview_job_id is not null then
    select * into v_job from public.ai_jobs j
     where j.id = p_preview_job_id and j.user_id = v_uid
       for update;
    if not found or v_job.job_type <> 'jd_extraction' or v_job.target_type <> 'jd_preview'
       or v_job.status <> 'succeeded' or v_job.target_id is not null
       or v_job.application_project_id is not null then
      v_preview_reason := 'preview_not_found';
    else
      v_linkable := true;
      if v_job.finished_at is null or v_job.finished_at < now() - interval '24 hours' then
        v_preview_reason := 'preview_expired';
      else
        -- AI 요청 2: recompute the hash; do not trust p_raw_text_hash.
        v_hash := lower(encode(extensions.digest(p_raw_text, 'sha256'), 'hex'));
        begin
          v_sentence_count := (v_job.params ->> 'sentence_count')::integer;
        exception when others then
          v_sentence_count := null;
        end;
        if v_hash is distinct from nullif(btrim(v_job.params ->> 'raw_text_hash'), '')
           or v_sentence_count is distinct from jsonb_array_length(p_sentences)
           or not private.jd_extraction_result_valid(v_job.output, jsonb_array_length(p_sentences)) then
          v_preview_reason := 'preview_mismatch';
        end if;
      end if;
    end if;

    if v_linkable then
      -- The link happens even when the result is discarded (the tokens belong to this application).
      update public.ai_jobs j
         set target_id = v_jd_id, application_project_id = p_id
       where j.id = p_preview_job_id and j.user_id = v_uid;
      update public.ai_usage_records u
         set application_project_id = p_id
       where u.ai_job_id = p_preview_job_id and u.user_id = v_uid;
    end if;

    if v_linkable and v_preview_reason is null then
      select * into v_jd from public.job_descriptions jd where jd.id = v_jd_id and jd.user_id = v_uid for update;
      select * into v_project from public.application_projects ap where ap.id = p_id and ap.user_id = v_uid
        for update;
      v_applied := private.jd_apply_extraction_result(v_uid, v_jd, v_project, p_preview_job_id, v_job.output,
                                                      v_job.provider, v_job.model);
      v_preview_applied := coalesce((v_applied ->> 'applied')::boolean, false);
      v_name := v_applied ->> 'name';
      v_name_source := v_applied ->> 'name_source';
    end if;
  end if;

  select jd.extraction_status into v_status from public.job_descriptions jd where jd.id = v_jd_id;

  return jsonb_build_object(
    'application_project_id', p_id, 'job_description_id', v_jd_id,
    'name', v_name, 'name_source', v_name_source, 'extraction_status', v_status,
    'ai_run_allowed', v_allowed, 'created', true,
    'preview_applied', v_preview_applied, 'preview_skip_reason', v_preview_reason);
end;
$$;

revoke all on function public.create_application_project(uuid, text, text, jsonb, text, text, text, date, text, uuid)
  from public, anon;
grant execute on function public.create_application_project(uuid, text, text, jsonb, text, text, text, date, text,
  uuid) to authenticated;
