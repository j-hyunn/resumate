-- S6 insight RPCs (AI-02; DM A.8, §2.8, AI C-3 storage, C-6). app_ai_writer only, security definer with an owner
-- check through private.current_uid() (JWT sub). The job runner calls:
--   begin_insight -> (stage 1 match, stage 2 synthesize, server validation) -> complete_insight | fail_insight
--   then complete_ai_job (complete_insight first; a stale_run result means: don't complete the job).
-- Lock order everywhere: application_projects row, then insights row (same as a project delete cascade).
-- The ai_jobs end trigger takes the project row with SKIP LOCKED (QA-S5-06): it already holds the ai_jobs row,
-- and waiting for the project could deadlock with a project delete (project -> ... -> ai_jobs).
-- Errors: 42501 not_authenticated; P0001 application_project_not_found, insight_not_found, invalid_ai_job,
-- jd_not_extracted, insight_in_progress, invalid_ai_metadata, invalid_insight_payload, invalid_evidence_source.

-- ── helpers ────────────────────────────────────────────────────────────────

-- Is p_job an insight job for this application project? (user match is checked by the caller's select)
create or replace function private.insight_job_matches(p_job public.ai_jobs, p_application_project_id uuid)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_job.id is not null
     and p_job.job_type = 'insight'
     and p_job.target_type = 'application_project'
     and p_job.target_id = p_application_project_id
     and p_job.application_project_id = p_application_project_id;
$$;

revoke all on function private.insight_job_matches(public.ai_jobs, uuid) from public;

-- complete_insight p_payload shape (S6 db notes "p_payload 모양"). Metadata equality with the job and the
-- non-empty model are checked by complete_insight (invalid_ai_metadata). Unknown top-level keys are ignored.
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

  v_hashes := p_payload -> 'hashes';
  foreach v_key in array array['requirements_hash', 'career_snapshot_hash', 'input_hash'] loop
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
       -- AI-02 sources: career + profile + JD. interview_answer / user_note never appear in an insight.
       or coalesce(v_ev ->> 'source_type', '') not in (
            'profile', 'experience', 'education', 'project', 'project_detail', 'achievement', 'skill',
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

revoke all on function private.insight_payload_valid(jsonb) from public;

-- generating -> failed for (p_insight_id, p_ai_job_id), stamped with the job's current run_generation.
-- Returns whether it changed.
-- p_skip_locked (trigger path, QA-S5-06): take the project row without waiting; if it is locked (a project delete
-- in progress, or a short writer) do nothing and return false. Readers treat a generating row whose job has ended
-- as failed, and the next begin_insight cleans it up.
create or replace function private.insight_mark_failed(p_insight_id uuid, p_ai_job_id uuid, p_skip_locked boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
begin
  select i.application_project_id into v_project_id from public.insights i where i.id = p_insight_id;
  if not found then
    return false;
  end if;

  if p_skip_locked then
    perform 1 from public.application_projects ap where ap.id = v_project_id for update skip locked;
  else
    perform 1 from public.application_projects ap where ap.id = v_project_id for update;
  end if;
  if not found then
    return false;
  end if;

  -- Stamp the failing run's generation: complete_insight reopens a failed row only for a later run (QA-S6-01).
  update public.insights i
     set status = 'failed',
         run_generation = coalesce((select j.run_generation from public.ai_jobs j where j.id = p_ai_job_id),
                                   i.run_generation)
   where i.id = p_insight_id and i.status = 'generating' and i.ai_job_id = p_ai_job_id;
  return found;
end;
$$;

revoke all on function private.insight_mark_failed(uuid, uuid, boolean) from public;


-- ── begin_insight ──────────────────────────────────────────────────────────
-- Creates the generating row of this run (version_no = max + 1 under the project row lock).
--   same job already has a row                   -> that row's id (idempotent). If the row is `failed` and the
--                                                   job is queued / running again (manual retry, new
--                                                   run_generation), the row is reopened: generating, stamped
--                                                   with the job's run_generation (QA-S6-01).
--   job not queued / running, or not this project's insight job -> invalid_ai_job
--   JD extraction not succeeded (D-30 runs it first) -> jd_not_extracted
--   another generating row whose job is queued / running -> insight_in_progress
--   another generating row whose job ended or is gone   -> marked failed (stalled-run recovery)
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
    -- QA-S6-01: a manual retry requeues the same job with a higher run_generation; the end trigger had failed
    -- its row. Reopen it for the new run. Within one run (same generation) a failed row stays failed.
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

  if not exists (select 1 from public.job_descriptions jd
                  where jd.application_project_id = p_application_project_id
                    and jd.extraction_status = 'succeeded') then
    raise exception using errcode = 'P0001', message = 'jd_not_extracted';
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

revoke all on function public.begin_insight(uuid, uuid) from public, anon;
grant execute on function public.begin_insight(uuid, uuid) to app_ai_writer;


-- ── complete_insight ───────────────────────────────────────────────────────
-- Stores a validated AI-02 result for the run (p_ai_job_id, p_run_generation) in one transaction:
-- result / match_stage_result / hashes / meta, evidence_links (owner_type 'insight'), status ready, is_latest
-- moved from the previous latest to this row, application project last_activity_at.
-- A late run is ignored ({applied: false, reason: 'stale_run'}): the row is no longer generating, or the job is
-- not running this generation (QA-S3-05).
-- QA-S6-01: a manual retry keeps the job's step outputs, so begin_insight may not run again. A `failed` row of
-- this job whose run_generation is older than the running generation was failed by an earlier run (end trigger)
-- and is reopened here; a row failed in this same generation (fail_insight) stays stale_run.
create or replace function public.complete_insight(
  p_insight_id uuid,
  p_ai_job_id uuid,
  p_run_generation integer,
  p_payload jsonb
)
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

  -- Evidence rows (C-3 storage mapping). Owner / project / user come from this row, never from the payload.
  -- Value errors (bad timestamp, C-3 field CHECK) -> invalid_insight_payload; the JD source guard's
  -- invalid_evidence_source (P0001) propagates as is.
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
         requirements_hash = btrim(v_hashes ->> 'requirements_hash'),
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

revoke all on function public.complete_insight(uuid, uuid, integer, jsonb) from public, anon;
grant execute on function public.complete_insight(uuid, uuid, integer, jsonb) to app_ai_writer;


-- ── fail_insight ───────────────────────────────────────────────────────────
-- generating -> failed only when the row is generating for p_ai_job_id (true); otherwise nothing (false).
-- The cause stays on ai_jobs (error_code). No partial insight is stored ([가정] AI-02 card).
create or replace function public.fail_insight(p_insight_id uuid, p_ai_job_id uuid)
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
  if not exists (select 1 from public.insights i where i.id = p_insight_id and i.user_id = v_uid) then
    raise exception using errcode = 'P0001', message = 'insight_not_found';
  end if;
  return private.insight_mark_failed(p_insight_id, p_ai_job_id, false);
end;
$$;

revoke all on function public.fail_insight(uuid, uuid) from public, anon;
grant execute on function public.fail_insight(uuid, uuid) to app_ai_writer;


-- ── ai_jobs end -> insight failed (QA-S5-02 pattern) ──────────────────────
-- An insight job that ends (failed incl. stalled from sweep_stalled_ai_jobs, canceled, or succeeded without
-- complete_insight) releases its generating row: generating -> failed. Covers runner crashes, the sweep, and
-- cancel paths that never call fail_insight. Security definer: the updating role has no write grant on insights.
create or replace function private.ai_jobs_release_insight()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.job_type = 'insight' and new.status in ('failed', 'canceled', 'succeeded')
     and old.status is distinct from new.status then
    perform private.insight_mark_failed(i.id, new.id, true)
       from public.insights i
      where i.ai_job_id = new.id and i.status = 'generating';
  end if;
  return null;
end;
$$;

revoke all on function private.ai_jobs_release_insight() from public;

create trigger ai_jobs_release_insight
  after update of status on public.ai_jobs
  for each row execute function private.ai_jobs_release_insight();
