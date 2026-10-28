-- S3a: ai_jobs v4 (DM §2.9.1, A.15; AI C-11.1, C-11.3, C-12).
--   * provider / model_tier / connection_tier fixed at job start (F-AI-03 (2)).
--   * retry scheduling: next_run_at, retry_count, retry_wait_total_ms, quota_resets_at, retry_after.
--   * error_code list v4; error_category regrouped (5 values); failure_cause (F-AI-08, 7 values).
--   * at most one in-flight job per target (D-34), reuse index includes provider (C-6 v4).
-- spec-gaps 2026-10-28 [가정]: the S3 column attempt_count was the run generation (zombie-runner guard,
-- QA-S3-05). It is renamed to run_generation (internal) and v4 retry_count is a separate counter.
-- progress may carry waiting_retry_until (jsonb, no schema change).

-- 1. Run generation: rename + widen to integer (complete_ai_job takes an integer).
alter table public.ai_jobs rename column attempt_count to run_generation;
alter table public.ai_jobs alter column run_generation type integer;
alter table public.ai_jobs rename constraint ai_jobs_attempt_count_check to ai_jobs_run_generation_check;

-- The guard trigger references the column by name: redefine it before any row update below.
--   succeeded, canceled: terminal. failed: only -> queued (manual retry), which clears the final-failure
--   fields (error_code, finished_at, cancel_requested_at, retry_after, quota_resets_at).
--   run_generation never decreases.
create or replace function private.ai_jobs_guard_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if old.status in ('succeeded', 'canceled')
       or (old.status = 'failed' and new.status <> 'queued') then
      raise exception using errcode = 'P0001', message = 'invalid_ai_job_transition',
        detail = old.status || ' -> ' || new.status;
    end if;
    if old.status = 'failed' then
      new.error_code := null;
      new.finished_at := null;
      new.cancel_requested_at := null;
      new.retry_after := null;
      new.quota_resets_at := null;
    end if;
  end if;

  if tg_op = 'UPDATE' and new.run_generation < old.run_generation then
    raise exception using errcode = 'P0001', message = 'invalid_ai_job_transition',
      detail = 'run_generation ' || old.run_generation || ' -> ' || new.run_generation;
  end if;

  if new.status = 'running' and (tg_op = 'INSERT' or old.status <> 'running') then
    new.started_at := coalesce(new.started_at, now());
  end if;
  if new.status in ('succeeded', 'failed', 'canceled')
     and (tg_op = 'INSERT' or old.status <> new.status) then
    new.finished_at := coalesce(new.finished_at, now());
  end if;
  return new;
end;
$$;

revoke all on function private.ai_jobs_guard_status() from public;

-- 2. New columns. Existing (v3, Anthropic-only) rows get anthropic / paid and a tier from the model id;
-- the defaults are dropped afterwards so every new job must state them.
alter table public.ai_jobs
  add column provider text not null default 'anthropic',
  add column model_tier text not null default 'default',
  add column connection_tier text not null default 'paid',
  add column retry_count integer not null default 0,
  add column next_run_at timestamptz,
  add column retry_wait_total_ms integer not null default 0,
  add column quota_resets_at timestamptz,
  add column retry_after timestamptz;

update public.ai_jobs
   set model_tier = case
         when model ilike '%haiku%' then 'light'
         when model ilike '%opus%' then 'heavy'
         else 'default'
       end
 where model is not null;

alter table public.ai_jobs
  alter column provider drop default,
  alter column model_tier drop default,
  alter column connection_tier drop default;

alter table public.ai_jobs
  add constraint ai_jobs_provider_check check (provider in ('openai', 'gemini', 'anthropic')),
  add constraint ai_jobs_model_tier_check check (model_tier in ('light', 'default', 'heavy')),
  add constraint ai_jobs_connection_tier_check check (connection_tier in ('free', 'paid')),
  add constraint ai_jobs_retry_count_check check (retry_count >= 0),
  add constraint ai_jobs_retry_wait_total_ms_check check (retry_wait_total_ms >= 0);

-- 3. job_type: + key_verification (F-AI-01/02 verification call uses the same run / record path).
alter table public.ai_jobs drop constraint ai_jobs_job_type_check;
alter table public.ai_jobs add constraint ai_jobs_job_type_check check (job_type in (
  'jd_extraction', 'insight', 'career_description', 'draft_source_ranking', 'cover_letter',
  'interview_questions', 'interview_evaluation', 'writing_chat_turn', 'key_verification',
  'writing_assist', 'chat_reply'));

-- 4. error_code v4 (AI C-11.1 + key_missing). DM §2.9.1: model_unavailable -> model_not_available,
-- refused -> safety_blocked.
alter table public.ai_jobs drop constraint ai_jobs_error_code_check;
update public.ai_jobs set error_code = 'model_not_available' where error_code = 'model_unavailable';
update public.ai_jobs set error_code = 'safety_blocked' where error_code = 'refused';
alter table public.ai_jobs add constraint ai_jobs_error_code_check check (error_code in (
  'rate_limited', 'daily_quota_exhausted', 'billing_required', 'key_invalid', 'model_not_available',
  'provider_unavailable', 'input_too_long', 'safety_blocked',
  'key_missing',
  'schema_invalid', 'timeout', 'stalled', 'canceled', 'insufficient_data', 'not_a_jd'));

-- 5. error_category (5 values, C-11.1) and failure_cause (F-AI-08 7 causes; others null).
-- SET EXPRESSION keeps the column and its grants.
alter table public.ai_jobs alter column error_category set expression as (
  case
    when error_code in ('rate_limited', 'daily_quota_exhausted') then 'provider_limit'
    when error_code in ('billing_required', 'key_invalid', 'key_missing', 'model_not_available') then 'user_account'
    when error_code = 'provider_unavailable' then 'transient'
    when error_code in ('input_too_long', 'safety_blocked', 'insufficient_data', 'not_a_jd') then 'input'
    when error_code in ('schema_invalid', 'timeout', 'stalled', 'canceled') then 'system'
  end
);

alter table public.ai_jobs add column failure_cause text generated always as (
  case
    when error_code in ('rate_limited', 'daily_quota_exhausted', 'billing_required', 'key_invalid',
                        'model_not_available', 'provider_unavailable') then error_code
    when error_code in ('input_too_long', 'safety_blocked') then 'input_rejected'
  end
) stored;

-- 6. Indexes.
-- D-34: one in-flight job per (user, job_type, target). Replaces the S3 per-input key (QA-S3-03).
-- Jobs with a null target_type / target_id are not constrained (NULLs are distinct).
drop index public.ai_jobs_in_flight_input_key;
create unique index ai_jobs_in_flight_target_key on public.ai_jobs (user_id, job_type, target_type, target_id)
  where status in ('queued', 'running');

-- C-6 v4 same-input reuse (input_hash includes provider and model).
drop index public.ai_jobs_reuse_idx;
create index ai_jobs_reuse_idx on public.ai_jobs (user_id, application_project_id, job_type, provider, input_hash)
  where status = 'succeeded';

-- B-4 wake-up: queued jobs whose next_run_at has passed (claim_due_ai_jobs, status polling).
create index ai_jobs_due_idx on public.ai_jobs (next_run_at) where status = 'queued' and next_run_at is not null;

-- 7. Grants for the new columns. Users still don't read params / step_outputs (QA-S3-08).
grant select (provider, model_tier, connection_tier, retry_count, next_run_at, retry_wait_total_ms,
              failure_cause, quota_resets_at, retry_after)
  on table public.ai_jobs to authenticated;
-- app_ai_writer: provider / tiers are set on insert only (fixed for the job's life).
grant insert (provider, model_tier, connection_tier, retry_count, next_run_at, retry_wait_total_ms,
              quota_resets_at, retry_after)
  on table public.ai_jobs to app_ai_writer;
grant update (retry_count, next_run_at, retry_wait_total_ms, quota_resets_at, retry_after)
  on table public.ai_jobs to app_ai_writer;
