-- R17 (2026-11-14): remove JD AI processing (AI-01 requirement extraction, the [다음] preview extraction).
-- The posting is used as raw text (job_descriptions.raw_text / sentences, deterministic split — not AI).
--
-- Not destructive: no row, column, or CHECK value is removed. Kept on purpose (plan R17-2/3/7):
--   * public.jd_requirements (table, triggers, old evidence rows) — read only for v1 insights.
--   * job_descriptions extraction columns (extraction*, requirements_hash, tech_keywords, detected_language,
--     extraction_status) — no longer written; new rows keep extraction_status = 'pending', and no gate reads it.
--   * insights.requirements_hash — old v1 rows keep their value; new rows leave it null.
--   * ai_jobs.job_type / target_type, ai_usage_records.feature, error_code CHECK values (jd_extraction,
--     jd_preview, not_a_jd) — old rows still exist.
--   * evidence source types jd_requirement / jd_sentence.
-- Removed: the extraction / preview RPCs and helpers, and the ai_jobs trigger that called one of them.
-- The narrowing of all of the above is drafted (not applied) in _workspace/backend/R17/phase2-destructive-draft.sql.
--
-- Release: create_application_project changes signature and the extraction RPCs disappear, so the app code of
-- the same PR must ship right after `db push` (plan §6).

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Extraction / preview RPCs and helpers
-- ---------------------------------------------------------------------------------------------------------------

-- The trigger only forwarded failed / canceled jd_extraction jobs to jd_extraction_mark_failed, which goes away.
-- Leaving it would make any status update of an old jd_extraction row fail at run time (plpgsql resolves the call
-- lazily), so it is dropped with its function. `[가정 R17-db1]`
drop trigger if exists ai_jobs_release_jd_extraction on public.ai_jobs;
drop function if exists private.ai_jobs_release_jd_extraction();

drop function if exists public.begin_jd_extraction(uuid, uuid);
drop function if exists public.apply_jd_extraction(uuid, uuid, integer, jsonb, text, text);
drop function if exists public.fail_jd_extraction(uuid, uuid);
drop function if exists public.purge_unused_jd_preview_outputs(timestamptz, integer);
drop function if exists private.jd_apply_extraction_result(uuid, public.job_descriptions,
  public.application_projects, uuid, jsonb, text, text);
drop function if exists private.jd_extraction_mark_failed(uuid, uuid, boolean);
drop function if exists private.jd_extraction_job_matches(public.ai_jobs, public.job_descriptions);
drop function if exists private.jd_extraction_result_valid(jsonb, integer);

-- ---------------------------------------------------------------------------------------------------------------
-- 2. create_application_project — 9 arguments, no preview, no key / consent gate
-- ---------------------------------------------------------------------------------------------------------------

drop function if exists public.create_application_project(uuid, text, text, jsonb, text, text, text, date, text, uuid);

-- Returns {application_project_id, job_description_id, name, name_source, ai_run_allowed, created}.
-- Name: p_name → company name (composed) → application_fallback_name, whether or not a key exists
-- (`[가정 R17-8]` — the extraction no longer names the application later).
-- No key_invalid / ai_consent_required gate: registering a posting runs no AI (`[가정 R17-9]`).
create function public.create_application_project(
  p_id uuid,
  p_raw_text text,
  p_raw_text_hash text,
  p_sentences jsonb,
  p_company_name text default null,
  p_position_title text default null,
  p_name text default null,
  p_deadline date default null,
  p_source_url text default null
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
  if v_source_url is not null and (char_length(v_source_url) > 2048 or v_source_url !~* '^https?://') then
    raise exception using errcode = 'P0001', message = 'invalid_source_url';
  end if;

  v_allowed := private.user_ai_run_allowed(v_uid);

  if v_name is not null then
    v_name_source := 'user';
  elsif v_company is not null then
    v_name := private.application_compose_name(v_company, null);
    v_name_source := 'user';
  else
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
    select jd.id into v_jd_id from public.job_descriptions jd where jd.application_project_id = p_id;
    return jsonb_build_object(
      'application_project_id', p_id, 'job_description_id', v_jd_id,
      'name', v_name, 'name_source', v_name_source,
      'ai_run_allowed', v_allowed, 'created', false);
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

  return jsonb_build_object(
    'application_project_id', p_id, 'job_description_id', v_jd_id,
    'name', v_name, 'name_source', v_name_source,
    'ai_run_allowed', v_allowed, 'created', true);
end;
$$;

revoke all on function public.create_application_project(uuid, text, text, jsonb, text, text, text, date, text)
  from public, anon;
grant execute on function public.create_application_project(uuid, text, text, jsonb, text, text, text, date, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. insights: jd_text_hash (= job_descriptions.raw_text_hash at run time) replaces requirements_hash
-- ---------------------------------------------------------------------------------------------------------------

alter table public.insights add column jd_text_hash text;
alter table public.insights add constraint insights_jd_text_hash_check
  check (jd_text_hash is null or char_length(jd_text_hash) between 1 and 128);

-- v1 rows (before R17) carry requirements_hash; v2 rows carry jd_text_hash.
alter table public.insights drop constraint insights_ready_check;
alter table public.insights add constraint insights_ready_check
  check (status <> 'ready'
         or (result is not null and match_stage_result is not null and completed_at is not null
             and (requirements_hash is not null or jd_text_hash is not null)
             and career_snapshot_hash is not null and input_hash is not null and schema_version is not null
             and prompt_version is not null and provider is not null and model is not null
             and model_tier is not null and connection_tier is not null));

comment on column public.insights.jd_text_hash is
  'R17: job_descriptions.raw_text_hash the insight was built on. Null on v1 rows (requirements_hash instead).';
comment on column public.insights.requirements_hash is
  'Pre-R17 (v1) rows only: hash of the extracted requirements. New rows leave it null.';

-- (table-level SELECT for authenticated / app_ai_writer / service_role already covers the new column.)

create or replace function private.insight_payload_valid(p_payload jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_hashes jsonb;
  v_meta jsonb;
  v_ev jsonb;
  v_key text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or jsonb_typeof(p_payload -> 'result') is distinct from 'object'
     or coalesce(jsonb_typeof(p_payload -> 'match_stage_result'), 'null') not in ('object', 'array')
     or jsonb_typeof(p_payload -> 'hashes') is distinct from 'object'
     or jsonb_typeof(p_payload -> 'meta') is distinct from 'object'
     or jsonb_typeof(p_payload -> 'evidence') is distinct from 'array'
     or jsonb_array_length(p_payload -> 'evidence') > 2000 then
    return false;
  end if;

  -- C-3: result jsonb never stores evidence arrays.
  if jsonb_path_exists(p_payload -> 'result', 'lax $.**.evidence')
     or jsonb_path_exists(p_payload -> 'result', 'lax $.**.positioning_evidence') then
    return false;
  end if;

  -- R17: jd_text_hash replaces requirements_hash (a payload with only requirements_hash is refused).
  v_hashes := p_payload -> 'hashes';
  foreach v_key in array array['jd_text_hash', 'career_snapshot_hash', 'input_hash'] loop
    if jsonb_typeof(v_hashes -> v_key) is distinct from 'string'
       or char_length(btrim(v_hashes ->> v_key)) not between 1 and 128 then
      return false;
    end if;
  end loop;

  v_meta := p_payload -> 'meta';
  if jsonb_typeof(v_meta -> 'schema_version') is distinct from 'number'
     or (v_meta ->> 'schema_version') !~ '^[1-9][0-9]{0,8}$'
     or jsonb_typeof(v_meta -> 'prompt_version') is distinct from 'string'
     or char_length(btrim(v_meta ->> 'prompt_version')) not between 1 and 200
     or jsonb_typeof(v_meta -> 'provider') is distinct from 'string'
     or jsonb_typeof(v_meta -> 'model') is distinct from 'string'
     or jsonb_typeof(v_meta -> 'model_tier') is distinct from 'string'
     or jsonb_typeof(v_meta -> 'connection_tier') is distinct from 'string'
     or coalesce(jsonb_typeof(v_meta -> 'validation_report'), 'null') not in ('object', 'null')
     or coalesce(jsonb_typeof(v_meta -> 'usage'), 'null') not in ('object', 'null') then
    return false;
  end if;

  for v_ev in select e from jsonb_array_elements(p_payload -> 'evidence') e loop
    if jsonb_typeof(v_ev) <> 'object'
       or jsonb_typeof(v_ev -> 'item_key') is distinct from 'string'
       or char_length(btrim(v_ev ->> 'item_key')) not between 1 and 200
       or jsonb_typeof(v_ev -> 'sort_order') is distinct from 'number'
       or (v_ev ->> 'sort_order') !~ '^[0-9]{1,9}$'
       -- AI-02 sources: career 5종 + JD. jd_requirement stays allowed (plan R17-1: list unchanged), though new
       -- code writes jd_sentence only.
       or coalesce(v_ev ->> 'source_type', '') not in (
            'experience', 'education', 'project', 'project_deliverable', 'skill',
            'jd_requirement', 'jd_sentence')
       or jsonb_typeof(v_ev -> 'source_id') is distinct from 'string'
       or (v_ev ->> 'source_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       or coalesce(jsonb_typeof(v_ev -> 'source_field'), 'null') not in ('string', 'null')
       or coalesce(jsonb_typeof(v_ev -> 'quote'), 'null') not in ('string', 'null')
       or char_length(v_ev ->> 'quote') > 2000
       or coalesce(jsonb_typeof(v_ev -> 'quote_adjusted'), 'null') not in ('boolean', 'null')
       or coalesce(jsonb_typeof(v_ev -> 'source_locator'), 'null') not in ('object', 'null')
       or coalesce(jsonb_typeof(v_ev -> 'source_snapshot_at'), 'null') not in ('string', 'null')
       or coalesce(jsonb_typeof(v_ev -> 'source_label'), 'null') not in ('string', 'null')
       or char_length(v_ev ->> 'source_label') > 300 then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

create or replace function public.complete_insight(p_insight_id uuid, p_ai_job_id uuid, p_run_generation integer,
                                                   p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.current_uid();
  v_project_id uuid;
  v_insight public.insights%rowtype;
  v_job public.ai_jobs%rowtype;
  v_meta jsonb;
  v_hashes jsonb;
  v_prev uuid;
  v_count integer;
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  select i.application_project_id into v_project_id
    from public.insights i where i.id = p_insight_id and i.user_id = v_uid;
  perform 1 from public.application_projects ap where ap.id = v_project_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'insight_not_found';
  end if;
  select * into v_insight from public.insights i where i.id = p_insight_id and i.user_id = v_uid for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'insight_not_found';
  end if;

  select * into v_job from public.ai_jobs j where j.id = p_ai_job_id and j.user_id = v_uid;
  if not found or v_insight.ai_job_id is distinct from p_ai_job_id
     or not private.insight_job_matches(v_job, v_insight.application_project_id) then
    raise exception using errcode = 'P0001', message = 'invalid_ai_job';
  end if;

  if v_job.status <> 'running' or v_job.run_generation is distinct from p_run_generation
     or not (v_insight.status = 'generating'
             or (v_insight.status = 'failed' and coalesce(v_insight.run_generation, -1) < p_run_generation)) then
    return jsonb_build_object('applied', false, 'reason', 'stale_run');
  end if;

  if not private.insight_payload_valid(p_payload) then
    raise exception using errcode = 'P0001', message = 'invalid_insight_payload';
  end if;

  v_meta := p_payload -> 'meta';
  v_hashes := p_payload -> 'hashes';
  if v_meta ->> 'provider' is distinct from v_job.provider
     or v_meta ->> 'model_tier' is distinct from v_job.model_tier
     or v_meta ->> 'connection_tier' is distinct from v_job.connection_tier
     or char_length(btrim(v_meta ->> 'model')) not between 1 and 200 then
    raise exception using errcode = 'P0001', message = 'invalid_ai_metadata';
  end if;

  begin
    insert into public.evidence_links (user_id, application_project_id, owner_type, owner_id, item_key, sort_order,
                                       source_type, source_id, source_locator, source_field, quote, quote_adjusted,
                                       source_snapshot_at, source_label)
    select v_uid, v_insight.application_project_id, 'insight', p_insight_id, btrim(e ->> 'item_key'),
           (e ->> 'sort_order')::integer, e ->> 'source_type', (e ->> 'source_id')::uuid,
           case when jsonb_typeof(e -> 'source_locator') = 'object' then e -> 'source_locator' end,
           e ->> 'source_field', e ->> 'quote', coalesce((e ->> 'quote_adjusted')::boolean, false),
           coalesce((e ->> 'source_snapshot_at')::timestamptz, v_now), e ->> 'source_label'
      from jsonb_array_elements(p_payload -> 'evidence') e;
    get diagnostics v_count = row_count;
  exception
    when check_violation or invalid_text_representation or invalid_datetime_format
         or datetime_field_overflow or numeric_value_out_of_range then
      raise exception using errcode = 'P0001', message = 'invalid_insight_payload';
  end;

  select i.id into v_prev from public.insights i
   where i.application_project_id = v_insight.application_project_id and i.is_latest;
  if v_prev is not null then
    update public.insights i set is_latest = false where i.id = v_prev;
  end if;

  update public.insights i
     set status = 'ready',
         is_latest = true,
         result = p_payload -> 'result',
         match_stage_result = p_payload -> 'match_stage_result',
         requirements_hash = null,
         jd_text_hash = btrim(v_hashes ->> 'jd_text_hash'),
         career_snapshot_hash = btrim(v_hashes ->> 'career_snapshot_hash'),
         input_hash = btrim(v_hashes ->> 'input_hash'),
         schema_version = (v_meta ->> 'schema_version')::integer,
         prompt_version = btrim(v_meta ->> 'prompt_version'),
         provider = v_job.provider,
         model = btrim(v_meta ->> 'model'),
         model_tier = v_job.model_tier,
         connection_tier = v_job.connection_tier,
         validation_report = case when jsonb_typeof(v_meta -> 'validation_report') = 'object'
                                  then v_meta -> 'validation_report' end,
         usage = case when jsonb_typeof(v_meta -> 'usage') = 'object' then v_meta -> 'usage' end,
         run_generation = p_run_generation,
         completed_at = v_now
   where i.id = p_insight_id;

  update public.application_projects ap set last_activity_at = v_now where ap.id = v_insight.application_project_id;

  return jsonb_build_object(
    'applied', true,
    'insight_id', p_insight_id,
    'application_project_id', v_insight.application_project_id,
    'version_no', v_insight.version_no,
    'status', 'ready',
    'is_latest', true,
    'previous_latest_id', v_prev,
    'evidence_count', v_count,
    'completed_at', v_now);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. begin_insight: the JD gate is "a posting row exists" (no extraction needed)
-- ---------------------------------------------------------------------------------------------------------------

create or replace function public.begin_insight(p_application_project_id uuid, p_ai_job_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.current_uid();
  v_job public.ai_jobs%rowtype;
  v_id uuid;
  v_status text;
  v_row_generation integer;
  v_version integer;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  perform 1 from public.application_projects ap
   where ap.id = p_application_project_id and ap.user_id = v_uid
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'application_project_not_found';
  end if;

  select * into v_job from public.ai_jobs j where j.id = p_ai_job_id and j.user_id = v_uid;
  if not found or not private.insight_job_matches(v_job, p_application_project_id) then
    raise exception using errcode = 'P0001', message = 'invalid_ai_job';
  end if;

  select i.id, i.status, i.run_generation into v_id, v_status, v_row_generation
    from public.insights i where i.ai_job_id = p_ai_job_id and i.user_id = v_uid
     for update;
  if found then
    -- QA-S6-01: a manual retry requeues the same job with a higher run_generation; reopen the failed row.
    if v_status = 'failed' and v_job.status in ('queued', 'running')
       and coalesce(v_row_generation, -1) < v_job.run_generation then
      update public.insights i
         set status = 'generating', run_generation = v_job.run_generation
       where i.id = v_id;
    end if;
    return v_id;
  end if;

  if v_job.status not in ('queued', 'running') then
    raise exception using errcode = 'P0001', message = 'invalid_ai_job';
  end if;

  -- R17: replaces the jd_not_extracted gate.
  if not exists (select 1 from public.job_descriptions jd
                  where jd.application_project_id = p_application_project_id and jd.user_id = v_uid) then
    raise exception using errcode = 'P0001', message = 'job_description_not_found';
  end if;

  if exists (select 1 from public.insights i
               join public.ai_jobs j on j.id = i.ai_job_id
              where i.application_project_id = p_application_project_id
                and i.status = 'generating'
                and j.status in ('queued', 'running')) then
    raise exception using errcode = 'P0001', message = 'insight_in_progress';
  end if;

  update public.insights i
     set status = 'failed'
   where i.application_project_id = p_application_project_id and i.status = 'generating';

  select coalesce(max(i.version_no), 0) + 1 into v_version
    from public.insights i where i.application_project_id = p_application_project_id;

  insert into public.insights (user_id, application_project_id, version_no, status, ai_job_id, run_generation,
                               provider, model_tier, connection_tier)
  values (v_uid, p_application_project_id, v_version, 'generating', p_ai_job_id, v_job.run_generation,
          v_job.provider, v_job.model_tier, v_job.connection_tier)
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. start_document_writing_chat: "requirements ready" = a posting row exists
-- ---------------------------------------------------------------------------------------------------------------
-- writing_chat_document_greeting keeps its "요건 정리 전" branch for now; with a JD row always created together
-- with the application, the branch is unreachable from here.

create or replace function public.start_document_writing_chat(p_application_project_id uuid, p_document_kind text,
                                                              p_form_snapshot jsonb default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_snap jsonb;
  v_questions jsonb;
  v_q jsonb;
  v_requirements_ready boolean;
  v_slot_count integer := 0;
  v_filled integer := 0;
  v_chat_id uuid;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_document_kind is distinct from 'cover_letter' then
    raise exception using errcode = 'P0001', message = 'invalid_fields', detail = 'document_kind';
  end if;
  if not exists (select 1 from public.application_projects ap
                  where ap.id = p_application_project_id and ap.user_id = v_uid) then
    raise exception using errcode = 'P0001', message = 'application_project_not_found';
  end if;

  -- R17: the raw posting text is the JD context; no extraction to wait for.
  v_requirements_ready := exists (select 1 from public.job_descriptions jd
                                   where jd.application_project_id = p_application_project_id
                                     and jd.user_id = v_uid);

  v_snap := nullif(p_form_snapshot, 'null'::jsonb);
  if v_snap is not null then
    v_questions := nullif(v_snap -> 'questions', 'null'::jsonb);
    if jsonb_typeof(v_snap) <> 'object'
       or (v_questions is not null and jsonb_typeof(v_questions) <> 'array')
       or coalesce(jsonb_array_length(v_questions), 0) > 20 then
      raise exception using errcode = 'P0001', message = 'invalid_form_snapshot';
    end if;
    for v_q in select e from jsonb_array_elements(coalesce(v_questions, '[]'::jsonb)) e loop
      if jsonb_typeof(v_q) <> 'object'
         or coalesce(v_q ->> 'slot', '') !~ '^q_[0-9]{1,3}$'
         or coalesce(jsonb_typeof(v_q -> 'question_text'), 'null') not in ('string', 'null')
         or char_length(v_q ->> 'question_text') > 1000
         or coalesce(jsonb_typeof(v_q -> 'answer_title'), 'null') not in ('string', 'null')
         or char_length(v_q ->> 'answer_title') > 100
         or coalesce(jsonb_typeof(v_q -> 'user_note'), 'null') not in ('string', 'null')
         or char_length(v_q ->> 'user_note') > 300
         or coalesce(jsonb_typeof(v_q -> 'body'), 'null') not in ('string', 'null')
         or char_length(v_q ->> 'body') > 8000
         or coalesce(jsonb_typeof(v_q -> 'char_limit'), 'null') not in ('number', 'null')
         or coalesce(jsonb_typeof(v_q -> 'count_basis'), 'null') not in ('string', 'null') then
        raise exception using errcode = 'P0001', message = 'invalid_form_snapshot';
      end if;
    end loop;
    v_slot_count := coalesce(jsonb_array_length(v_questions), 0);
    select count(*)::integer into v_filled
      from jsonb_array_elements(coalesce(v_questions, '[]'::jsonb)) e
     where nullif(btrim(coalesce(e ->> 'body', '')), '') is not null;
  else
    select d.slot_count,
           (select count(*)::integer from jsonb_array_elements(coalesce(d.body -> 'questions', '[]'::jsonb)) e
             where nullif(btrim(coalesce(e ->> 'body', '')), '') is not null)
      into v_slot_count, v_filled
      from public.application_documents d
     where d.application_project_id = p_application_project_id and d.document_kind = p_document_kind
       and d.user_id = v_uid;
    v_slot_count := coalesce(v_slot_count, 0);
    v_filled := coalesce(v_filled, 0);
  end if;

  insert into public.writing_chats (user_id, project_id, application_project_id, document_kind, structured_draft,
                                    message_count, return_target)
  values (v_uid, null, p_application_project_id, p_document_kind,
          private.writing_chat_empty_document_draft(p_document_kind), 0, null)
  returning id into v_chat_id;

  insert into public.writing_chat_messages (user_id, writing_chat_id, sequence, role, content, status)
  values (v_uid, v_chat_id, 1, 'assistant',
          private.writing_chat_document_greeting(v_requirements_ready, v_slot_count, v_filled,
                                                 private.writing_chat_free_tier(v_uid)),
          'done');

  return v_chat_id;
end;
$$;
