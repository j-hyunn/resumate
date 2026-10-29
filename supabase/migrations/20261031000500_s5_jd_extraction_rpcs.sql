-- S5 JD extraction RPCs (AI-01, D-19, D-30; DM §2.6 v4, A.6, A.7). app_ai_writer only, security definer with
-- an owner check through private.current_uid() (JWT sub). The job runner calls:
--   begin_jd_extraction  -> (AI-01 call + server validation) -> apply_jd_extraction | fail_jd_extraction
-- Lock order everywhere: application_projects row, then job_descriptions row (same as a project delete cascade).
-- Errors: 42501 not_authenticated; P0001 job_description_not_found, invalid_ai_job, already_extracted,
-- extraction_in_progress, invalid_ai_metadata, invalid_extraction_result, user_edited_requirements_exist.

-- ── helpers ────────────────────────────────────────────────────────────────

-- Is p_job a jd_extraction job for this JD row?
create or replace function private.jd_extraction_job_matches(p_job public.ai_jobs, p_jd public.job_descriptions)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_job.id is not null
     and p_job.user_id = p_jd.user_id
     and p_job.job_type = 'jd_extraction'
     and p_job.target_type = 'job_description'
     and p_job.target_id = p_jd.id
     and p_job.application_project_id = p_jd.application_project_id;
$$;

revoke all on function private.jd_extraction_job_matches(public.ai_jobs, public.job_descriptions) from public;

-- Every sid exists in the JD: sentences are S1..Sn in order (job_descriptions_sentences_check), so a sid exists
-- iff it has the S<k> shape and k <= n.
create or replace function private.jd_sids_exist(p_sids jsonb, p_sentence_count integer, p_allow_empty boolean)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_sids) = 'array'
     and (p_allow_empty or jsonb_array_length(p_sids) >= 1)
     and coalesce((
       select bool_and(case
                         when jsonb_typeof(s) = 'string' and (s #>> '{}') ~ '^S[1-9][0-9]{0,8}$'
                           then substr(s #>> '{}', 2)::integer <= p_sentence_count
                         else false
                       end)
         from jsonb_array_elements(p_sids) s), true);
$$;

revoke all on function private.jd_sids_exist(jsonb, integer, boolean) from public;

-- p_result shape (S5 notes "p_result 모양"). Only the keys the DB stores are checked; the rest lives in
-- `extraction`. Requirements: 1..200, each {category, content 1..500, keywords string[] (each 1..100),
-- importance, source_sids >= 1 existing sid}. tech_keywords: [{keyword 1..100, source_sids existing sids}].
create or replace function private.jd_extraction_result_valid(p_result jsonb, p_sentence_count integer)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_req jsonb;
  v_kw jsonb;
  v_field text;
begin
  if p_result is null or jsonb_typeof(p_result) <> 'object'
     or jsonb_typeof(p_result -> 'extraction') is distinct from 'object'
     or jsonb_typeof(p_result -> 'requirements_hash') is distinct from 'string'
     or char_length(btrim(p_result ->> 'requirements_hash')) not between 1 and 128
     or coalesce(jsonb_typeof(p_result -> 'detected_language'), 'null') not in ('string', 'null')
     or char_length(p_result ->> 'detected_language') not between 1 and 16
     or jsonb_typeof(p_result -> 'requirements') is distinct from 'array'
     or jsonb_array_length(p_result -> 'requirements') not between 1 and 200
     or jsonb_typeof(p_result -> 'tech_keywords') is distinct from 'array' then
    return false;
  end if;

  foreach v_field in array array['company_name', 'position_title'] loop
    if coalesce(jsonb_typeof(p_result -> v_field), 'null') not in ('object', 'null')
       or coalesce(jsonb_typeof(p_result -> v_field -> 'value'), 'null') not in ('string', 'null') then
      return false;
    end if;
  end loop;

  for v_req in select e from jsonb_array_elements(p_result -> 'requirements') e loop
    if jsonb_typeof(v_req) <> 'object'
       or coalesce(v_req ->> 'category', '') not in ('responsibility', 'required', 'preferred')
       or coalesce(v_req ->> 'importance', '') not in ('high', 'normal')
       or jsonb_typeof(v_req -> 'content') is distinct from 'string'
       or btrim(v_req ->> 'content') = ''
       or char_length(btrim(v_req ->> 'content')) > 500
       or jsonb_typeof(v_req -> 'keywords') is distinct from 'array'
       or not private.jd_sids_exist(v_req -> 'source_sids', p_sentence_count, false) then
      return false;
    end if;
    if exists (select 1 from jsonb_array_elements(v_req -> 'keywords') k
                where jsonb_typeof(k) <> 'string' or char_length(btrim(k #>> '{}')) not between 1 and 100) then
      return false;
    end if;
  end loop;

  for v_kw in select e from jsonb_array_elements(p_result -> 'tech_keywords') e loop
    if jsonb_typeof(v_kw) <> 'object'
       or jsonb_typeof(v_kw -> 'keyword') is distinct from 'string'
       or char_length(btrim(v_kw ->> 'keyword')) not between 1 and 100
       or not private.jd_sids_exist(v_kw -> 'source_sids', p_sentence_count, false) then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

revoke all on function private.jd_extraction_result_valid(jsonb, integer) from public;


-- ── begin_jd_extraction ────────────────────────────────────────────────────
-- pending / failed -> running with extraction_job_id = p_ai_job_id.
--   succeeded                                 -> already_extracted (D-19: re-extraction is a failure retry only)
--   running, same job                         -> no-op (idempotent)
--   running, previous job finished or missing -> taken over (stalled-extraction recovery)
--   running, previous job queued / running    -> extraction_in_progress
-- The job must be this JD's jd_extraction job and still queued / running (else invalid_ai_job).
create or replace function public.begin_jd_extraction(p_job_description_id uuid, p_ai_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.current_uid();
  v_project_id uuid;
  v_jd public.job_descriptions%rowtype;
  v_job public.ai_jobs%rowtype;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  select jd.application_project_id into v_project_id
    from public.job_descriptions jd where jd.id = p_job_description_id and jd.user_id = v_uid;
  perform 1 from public.application_projects ap where ap.id = v_project_id for update;
  select * into v_jd from public.job_descriptions jd
   where jd.id = p_job_description_id and jd.user_id = v_uid
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'job_description_not_found';
  end if;

  if v_jd.extraction_status = 'succeeded' then
    raise exception using errcode = 'P0001', message = 'already_extracted';
  end if;

  select * into v_job from public.ai_jobs j where j.id = p_ai_job_id and j.user_id = v_uid;
  if not found or not private.jd_extraction_job_matches(v_job, v_jd) or v_job.status not in ('queued', 'running') then
    raise exception using errcode = 'P0001', message = 'invalid_ai_job';
  end if;

  if v_jd.extraction_status = 'running' then
    if v_jd.extraction_job_id = p_ai_job_id then
      return;
    end if;
    if exists (select 1 from public.ai_jobs j
                where j.id = v_jd.extraction_job_id and j.status in ('queued', 'running')) then
      raise exception using errcode = 'P0001', message = 'extraction_in_progress';
    end if;
  end if;

  update public.job_descriptions jd
     set extraction_status = 'running', extraction_job_id = p_ai_job_id
   where jd.id = p_job_description_id;
end;
$$;

revoke all on function public.begin_jd_extraction(uuid, uuid) from public, anon;
grant execute on function public.begin_jd_extraction(uuid, uuid) to app_ai_writer;


-- ── apply_jd_extraction ────────────────────────────────────────────────────
-- Stores a validated AI-01 result for the run (p_ai_job_id, p_run_generation).
-- A late run is ignored ({applied: false, reason: 'stale_run'}): the JD is not running this job, or the job
-- is not running this generation (QA-S3-05).
-- On apply:
--   * user-edited requirements (origin = 'user' or is_user_edited) -> user_edited_requirements_exist (AI-01).
--   * previous origin = 'ai' requirements are replaced; sort_order = output order (0-based).
--   * extraction, detected_language, tech_keywords, requirements_hash, provider / model, status succeeded.
--   * company_name / position_title: filled only when empty (source 'ai') and their source_sids exist (QA-S5-05).
--   * project name: when name_source is null or 'default' -> composed "회사명 – 포지션명" ('ai') if both are
--     known after this step; otherwise a null name becomes the default name ('default'). last_activity_at = now().
create or replace function public.apply_jd_extraction(
  p_job_description_id uuid,
  p_ai_job_id uuid,
  p_run_generation integer,
  p_result jsonb,
  p_provider text,
  p_model text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.current_uid();
  v_project_id uuid;
  v_project public.application_projects%rowtype;
  v_jd public.job_descriptions%rowtype;
  v_job public.ai_jobs%rowtype;
  v_company text;
  v_company_source text;
  v_position text;
  v_position_source text;
  v_name text;
  v_name_source text;
  v_composed text;
  v_count integer;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  select jd.application_project_id into v_project_id
    from public.job_descriptions jd where jd.id = p_job_description_id and jd.user_id = v_uid;
  select * into v_project from public.application_projects ap where ap.id = v_project_id for update;
  select * into v_jd from public.job_descriptions jd
   where jd.id = p_job_description_id and jd.user_id = v_uid
     for update;
  if not found or v_project.id is null then
    raise exception using errcode = 'P0001', message = 'job_description_not_found';
  end if;

  select * into v_job from public.ai_jobs j where j.id = p_ai_job_id and j.user_id = v_uid;
  if not found or not private.jd_extraction_job_matches(v_job, v_jd) then
    raise exception using errcode = 'P0001', message = 'invalid_ai_job';
  end if;

  if v_jd.extraction_status <> 'running' or v_jd.extraction_job_id is distinct from p_ai_job_id
     or v_job.status <> 'running' or v_job.run_generation is distinct from p_run_generation then
    return jsonb_build_object('applied', false, 'reason', 'stale_run');
  end if;

  if p_provider is distinct from v_job.provider or nullif(btrim(p_model), '') is null then
    raise exception using errcode = 'P0001', message = 'invalid_ai_metadata';
  end if;

  if exists (select 1 from public.jd_requirements r
              where r.job_description_id = p_job_description_id and (r.origin = 'user' or r.is_user_edited)) then
    raise exception using errcode = 'P0001', message = 'user_edited_requirements_exist';
  end if;

  if not private.jd_extraction_result_valid(p_result, jsonb_array_length(v_jd.sentences)) then
    raise exception using errcode = 'P0001', message = 'invalid_extraction_result';
  end if;

  delete from public.jd_requirements r where r.job_description_id = p_job_description_id and r.origin = 'ai';

  insert into public.jd_requirements (user_id, job_description_id, category, content, keywords, importance,
                                      source_sids, sort_order, origin)
  select v_uid, p_job_description_id, e ->> 'category', btrim(e ->> 'content'),
         array(select btrim(k) from jsonb_array_elements_text(e -> 'keywords') k),
         e ->> 'importance',
         array(select s from jsonb_array_elements_text(e -> 'source_sids') s),
         (o - 1)::integer, 'ai'
    from jsonb_array_elements(p_result -> 'requirements') with ordinality as t (e, o);
  get diagnostics v_count = row_count;

  -- QA-S5-05: an AI company / position value counts only when its source_sids exist in this JD (same as the
  -- TS validator); otherwise the value is dropped, not the whole result.
  v_company := v_jd.company_name;
  v_company_source := v_jd.company_name_source;
  if v_company is null and nullif(btrim(p_result -> 'company_name' ->> 'value'), '') is not null
     and private.jd_sids_exist(p_result -> 'company_name' -> 'source_sids', jsonb_array_length(v_jd.sentences), false) then
    v_company := rtrim(left(btrim(p_result -> 'company_name' ->> 'value'), 200));
    v_company_source := 'ai';
  end if;
  v_position := v_jd.position_title;
  v_position_source := v_jd.position_title_source;
  if v_position is null and nullif(btrim(p_result -> 'position_title' ->> 'value'), '') is not null
     and private.jd_sids_exist(p_result -> 'position_title' -> 'source_sids', jsonb_array_length(v_jd.sentences), false) then
    v_position := rtrim(left(btrim(p_result -> 'position_title' ->> 'value'), 200));
    v_position_source := 'ai';
  end if;

  update public.job_descriptions jd
     set extraction = p_result -> 'extraction',
         detected_language = p_result ->> 'detected_language',
         tech_keywords = p_result -> 'tech_keywords',
         requirements_hash = btrim(p_result ->> 'requirements_hash'),
         extraction_status = 'succeeded',
         extraction_provider = p_provider,
         extraction_model = btrim(p_model),
         company_name = v_company, company_name_source = v_company_source,
         position_title = v_position, position_title_source = v_position_source
   where jd.id = p_job_description_id;

  v_name := v_project.name;
  v_name_source := v_project.name_source;
  if v_name_source is null or v_name_source = 'default' then
    v_composed := private.application_compose_name(v_company, v_position);
    if v_composed is not null then
      v_name := v_composed;
      v_name_source := 'ai';
    elsif v_name is null then
      v_name := private.application_default_name(v_project.created_at);
      v_name_source := 'default';
    end if;
  end if;

  update public.application_projects ap
     set name = v_name, name_source = v_name_source, last_activity_at = now()
   where ap.id = v_project.id;

  return jsonb_build_object(
    'applied', true,
    'job_description_id', p_job_description_id,
    'application_project_id', v_project.id,
    'extraction_status', 'succeeded',
    'name', v_name, 'name_source', v_name_source,
    'company_name', v_company, 'company_name_source', v_company_source,
    'position_title', v_position, 'position_title_source', v_position_source,
    'requirement_count', v_count);
end;
$$;

revoke all on function public.apply_jd_extraction(uuid, uuid, integer, jsonb, text, text) from public, anon;
grant execute on function public.apply_jd_extraction(uuid, uuid, integer, jsonb, text, text) to app_ai_writer;


-- ── failing a running extraction ──────────────────────────────────────────
-- Shared by fail_jd_extraction and the ai_jobs end trigger: when the JD is `running` p_ai_job_id, set it to
-- `failed` and give a null project name the key-less fallback name [가정 1]. Returns whether it changed.
-- Lock order: project row, then JD row. No owner check here (callers do it / the trigger acts for the job's
-- own row, whose user_id matches through the composite FK).
create or replace function private.jd_extraction_mark_failed(p_job_description_id uuid, p_ai_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.application_projects%rowtype;
  v_jd public.job_descriptions%rowtype;
begin
  select ap.* into v_project
    from public.application_projects ap
    join public.job_descriptions jd on jd.application_project_id = ap.id
   where jd.id = p_job_description_id
     for update of ap;
  select * into v_jd from public.job_descriptions jd where jd.id = p_job_description_id for update;
  if not found or v_project.id is null then
    return false;
  end if;

  if v_jd.extraction_status <> 'running' or v_jd.extraction_job_id is distinct from p_ai_job_id then
    return false;
  end if;

  update public.job_descriptions jd set extraction_status = 'failed' where jd.id = p_job_description_id;

  if v_project.name is null then
    update public.application_projects ap
       set (name, name_source) = (
         select f.name, f.name_source
           from private.application_fallback_name(v_jd.company_name, v_jd.position_title, v_project.created_at) f)
     where ap.id = v_project.id;
  end if;

  return true;
end;
$$;

revoke all on function private.jd_extraction_mark_failed(uuid, uuid) from public;


-- ── fail_jd_extraction ─────────────────────────────────────────────────────
-- running -> failed only when the JD is running p_ai_job_id (returns true); otherwise nothing (false).
-- The cause stays on ai_jobs (error_code). A null project name gets the key-less fallback name [가정 1].
create or replace function public.fail_jd_extraction(p_job_description_id uuid, p_ai_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.current_uid();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if not exists (select 1 from public.job_descriptions jd
                  where jd.id = p_job_description_id and jd.user_id = v_uid) then
    raise exception using errcode = 'P0001', message = 'job_description_not_found';
  end if;
  return private.jd_extraction_mark_failed(p_job_description_id, p_ai_job_id);
end;
$$;

revoke all on function public.fail_jd_extraction(uuid, uuid) from public, anon;
grant execute on function public.fail_jd_extraction(uuid, uuid) to app_ai_writer;


-- ── ai_jobs end -> JD failed (QA-S5-02) ──────────────────────────────────
-- A jd_extraction job that ends without success (failed incl. stalled from sweep_stalled_ai_jobs, canceled)
-- releases the JD it was running: running -> failed + fallback name, exactly like fail_jd_extraction. Covers
-- runner crashes, the sweep, and cancel paths that never call fail_jd_extraction. Security definer because the
-- updating role (app_ai_writer, service_role via sweep, postgres) has no write grant on job_descriptions.
create or replace function private.ai_jobs_release_jd_extraction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.job_type = 'jd_extraction' and new.target_type = 'job_description'
     and new.status in ('failed', 'canceled') and old.status is distinct from new.status then
    perform private.jd_extraction_mark_failed(new.target_id, new.id);
  end if;
  return null;
end;
$$;

revoke all on function private.ai_jobs_release_jd_extraction() from public;

create trigger ai_jobs_release_jd_extraction
  after update of status on public.ai_jobs
  for each row execute function private.ai_jobs_release_jd_extraction();
