-- S3 AI infrastructure: ai_jobs (DM §2.9, A.15, AI C-6) + status transition guard + RLS + grants.
-- application_project_id is a plain uuid until S5 creates application_projects (FK cascade added there).

create table public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  -- app_ai_writer has no USAGE on schema auth, so the default goes through private.current_uid().
  user_id uuid not null default private.current_uid() references auth.users (id) on delete cascade,
  job_type text not null,
  application_project_id uuid,
  target_type text,
  target_id uuid,
  status text not null default 'queued',
  progress jsonb,
  params jsonb not null default '{}'::jsonb,
  -- Step checkpoints (C-6: keep finished step results, resume from the failed step). Leader-approved S3.
  step_outputs jsonb not null default '{}'::jsonb,
  attempt_count smallint not null default 0,
  error_code text,
  error_category text generated always as (
    case
      when error_code in ('model_unavailable', 'rate_limited', 'schema_invalid', 'refused') then 'transient'
      when error_code in ('not_a_jd', 'insufficient_data', 'input_too_long') then 'input'
      when error_code in ('timeout', 'stalled') then 'timeout'
      when error_code = 'canceled' then 'canceled'
    end
  ) stored,
  input_hash text,
  prompt_version text,
  model text,
  usage jsonb,
  output jsonb,
  heartbeat_at timestamptz,
  cancel_requested_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_jobs_id_user_id_key unique (id, user_id),
  constraint ai_jobs_job_type_check check (job_type in (
    'jd_extraction', 'insight', 'career_description', 'draft_source_ranking', 'cover_letter',
    'interview_questions', 'interview_evaluation', 'writing_assist', 'chat_reply', 'writing_chat_turn')),
  constraint ai_jobs_status_check check (status in ('queued', 'running', 'succeeded', 'failed', 'canceled')),
  constraint ai_jobs_error_code_check check (error_code in (
    'model_unavailable', 'rate_limited', 'schema_invalid', 'refused', 'not_a_jd', 'insufficient_data',
    'input_too_long', 'timeout', 'stalled', 'canceled')),
  constraint ai_jobs_progress_check check (progress is null or jsonb_typeof(progress) = 'object'),
  constraint ai_jobs_params_check check (jsonb_typeof(params) = 'object'),
  constraint ai_jobs_step_outputs_check check (jsonb_typeof(step_outputs) = 'object'),
  constraint ai_jobs_attempt_count_check check (attempt_count >= 0),
  -- DM §2.9: a writing chat turn targets the chat and has no application project.
  constraint ai_jobs_writing_chat_turn_check check (
    job_type <> 'writing_chat_turn' or (target_type = 'writing_chat' and application_project_id is null))
);

-- C-6 same-input reuse lookup.
create index ai_jobs_reuse_idx on public.ai_jobs (user_id, application_project_id, job_type, input_hash)
  where status = 'succeeded';
-- Stalled-job sweep (heartbeat).
create index ai_jobs_active_heartbeat_idx on public.ai_jobs (status, heartbeat_at)
  where status in ('queued', 'running');
-- QA-S3-03: at most one in-flight job per same input (api maps 23505 to "return the in-flight job").
create unique index ai_jobs_in_flight_input_key on public.ai_jobs (
    user_id, coalesce(application_project_id, '00000000-0000-0000-0000-000000000000'::uuid), job_type, input_hash)
  where status in ('queued', 'running') and input_hash is not null;
create index ai_jobs_user_id_created_at_idx on public.ai_jobs (user_id, created_at desc);
create index ai_jobs_application_project_id_idx on public.ai_jobs (application_project_id);

alter table public.ai_jobs enable row level security;

-- Status transition guard (spec silent; protects against a zombie runner overwriting a swept job).
--   succeeded, canceled: terminal (status can't change).
--   failed: only -> queued (explicit retry; clears error_code / finished_at).
--   queued / running: any status.
--   attempt_count never decreases (QA-S3-05: it is the run generation; a late writer can't roll it back).
--   failed -> queued also clears cancel_requested_at (QA-S3-09).
-- Also stamps started_at on entering running and finished_at on entering a terminal status
-- when the caller didn't set them.
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
    end if;
  end if;

  if tg_op = 'UPDATE' and new.attempt_count < old.attempt_count then
    raise exception using errcode = 'P0001', message = 'invalid_ai_job_transition',
      detail = 'attempt_count ' || old.attempt_count || ' -> ' || new.attempt_count;
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

create trigger ai_jobs_guard_status
  before insert or update on public.ai_jobs
  for each row execute function private.ai_jobs_guard_status();

create trigger ai_jobs_set_updated_at
  before update on public.ai_jobs
  for each row execute function private.set_updated_at();

-- RLS (DM §5): user reads own jobs; no direct user writes (cancel goes through request_ai_job_cancel).
-- app_ai_writer creates and advances jobs for the JWT user.
create policy ai_jobs_select_own on public.ai_jobs
  for select to authenticated using (user_id = (select auth.uid()));
create policy ai_jobs_select_ai_writer on public.ai_jobs
  for select to app_ai_writer using (user_id = (select private.current_uid()));
create policy ai_jobs_insert_ai_writer on public.ai_jobs
  for insert to app_ai_writer with check (user_id = (select private.current_uid()));
create policy ai_jobs_update_ai_writer on public.ai_jobs
  for update to app_ai_writer
  using (user_id = (select private.current_uid())) with check (user_id = (select private.current_uid()));

-- QA-S3-08: users don't read params / step_outputs (step checkpoints may hold pre-validation output).
grant select (id, user_id, job_type, application_project_id, target_type, target_id, status, progress,
              attempt_count, error_code, error_category, input_hash, prompt_version, model, usage, output,
              heartbeat_at, cancel_requested_at, started_at, finished_at, created_at, updated_at)
  on table public.ai_jobs to authenticated;
grant select on table public.ai_jobs to app_ai_writer;
grant insert (id, user_id, job_type, application_project_id, target_type, target_id, status, progress,
              params, step_outputs, attempt_count, error_code, input_hash, prompt_version, model, usage,
              output, heartbeat_at, started_at, finished_at)
  on table public.ai_jobs to app_ai_writer;
grant update (status, progress, step_outputs, attempt_count, error_code, input_hash, prompt_version, model,
              usage, output, heartbeat_at, started_at, finished_at)
  on table public.ai_jobs to app_ai_writer;
