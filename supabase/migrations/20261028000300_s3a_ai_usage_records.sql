-- S3a: ai_usage_records (DM §2.9.2, A.16; AI C-13; F-AI-07, D-17 redefined, D-33).
-- One row per provider call (each retry attempt included). Tokens as reported by the provider and the
-- estimated cost at record time. No content, no reservation / charge. Immutable (no updated_at,
-- no update / delete grants; only the account-deletion cascade removes rows). Retention 13 months
-- (cleanup job: later slice).
-- application_project_id: plain uuid until S5 creates application_projects (FK on delete set null there).

create table public.ai_usage_records (
  id uuid primary key default gen_random_uuid(),
  -- app_ai_writer has no USAGE on schema auth, so the default goes through private.current_uid().
  user_id uuid not null default private.current_uid() references auth.users (id) on delete cascade,
  occurred_at timestamptz not null default now(),
  -- Set by ai_usage_records_set_period_month from occurred_at (KST month, day 1). Not insertable.
  -- The default only makes the column optional in generated insert types; the trigger always overwrites it.
  period_month date not null default (date_trunc('month', now() at time zone 'Asia/Seoul'))::date,
  feature text not null,
  job_type text not null,
  ai_job_id uuid,
  call_key text,
  application_project_id uuid,
  provider text not null,
  model text not null,
  model_tier text not null,
  connection_tier text not null,
  input_tokens integer not null default 0,
  cached_input_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  output_tokens integer not null default 0,
  reasoning_tokens integer,
  usage_source text not null,
  outcome text not null,
  error_code text,
  price_table_version text not null,
  estimated_cost_usd numeric(12, 6) not null,
  created_at timestamptz not null default now(),
  constraint ai_usage_records_period_month_check check (extract(day from period_month) = 1),
  constraint ai_usage_records_feature_check check (feature in (
    'jd_extraction', 'insight', 'career_description', 'cover_letter', 'interview_questions',
    'interview_evaluation', 'writing_chat', 'key_verification', 'writing_assist', 'chat_reply')),
  -- "ai_jobs.job_type과 같은 값": same list as ai_jobs_job_type_check (change both together).
  constraint ai_usage_records_job_type_check check (job_type in (
    'jd_extraction', 'insight', 'career_description', 'draft_source_ranking', 'cover_letter',
    'interview_questions', 'interview_evaluation', 'writing_chat_turn', 'key_verification',
    'writing_assist', 'chat_reply')),
  constraint ai_usage_records_provider_check check (provider in ('openai', 'gemini', 'anthropic')),
  constraint ai_usage_records_model_tier_check check (model_tier in ('light', 'default', 'heavy')),
  constraint ai_usage_records_connection_tier_check check (connection_tier in ('free', 'paid')),
  constraint ai_usage_records_usage_source_check check (usage_source in ('provider_reported', 'unavailable')),
  constraint ai_usage_records_outcome_check check (outcome in ('succeeded', 'failed')),
  -- Same list as ai_jobs_error_code_check; only failed calls carry a code.
  constraint ai_usage_records_error_code_check check (error_code in (
    'rate_limited', 'daily_quota_exhausted', 'billing_required', 'key_invalid', 'model_not_available',
    'provider_unavailable', 'input_too_long', 'safety_blocked',
    'key_missing',
    'schema_invalid', 'timeout', 'stalled', 'canceled', 'insufficient_data', 'not_a_jd')),
  constraint ai_usage_records_error_code_outcome_check check (outcome = 'failed' or error_code is null),
  constraint ai_usage_records_tokens_check check (
    input_tokens >= 0 and cached_input_tokens >= 0 and cache_write_tokens >= 0 and output_tokens >= 0
    and (reasoning_tokens is null or reasoning_tokens >= 0)),
  -- C-13: no usage reported -> tokens recorded as 0.
  constraint ai_usage_records_unavailable_tokens_check check (
    usage_source <> 'unavailable'
    or (input_tokens = 0 and cached_input_tokens = 0 and cache_write_tokens = 0 and output_tokens = 0
        and reasoning_tokens is null)),
  constraint ai_usage_records_estimated_cost_usd_check check (estimated_cost_usd >= 0)
);

-- DM §2.9.2 indexes (monthly meter by feature / provider).
create index ai_usage_records_user_period_feature_idx on public.ai_usage_records (user_id, period_month, feature);
create index ai_usage_records_user_period_provider_idx on public.ai_usage_records (user_id, period_month, provider);
-- C-12 free-tier call spacing: last call per user / provider.
create index ai_usage_records_user_provider_occurred_at_idx
  on public.ai_usage_records (user_id, provider, occurred_at desc);
create index ai_usage_records_ai_job_id_idx on public.ai_usage_records (ai_job_id) where ai_job_id is not null;
create index ai_usage_records_application_project_id_idx on public.ai_usage_records (application_project_id)
  where application_project_id is not null;

alter table public.ai_usage_records enable row level security;

-- period_month = KST calendar month of occurred_at, day 1 (DM §2.9.2, D-DM-05). Always computed.
create or replace function private.ai_usage_records_set_period_month()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.period_month := date_trunc('month', new.occurred_at at time zone 'Asia/Seoul')::date;
  return new;
end;
$$;

revoke all on function private.ai_usage_records_set_period_month() from public;

create trigger ai_usage_records_set_period_month
  before insert or update on public.ai_usage_records
  for each row execute function private.ai_usage_records_set_period_month();

-- RLS (DM §5): user reads own rows. app_ai_writer inserts for the JWT user and reads own rows
-- (C-12 call spacing reads the last occurred_at; insert ... returning needs select). No update / delete.
create policy ai_usage_records_select_own on public.ai_usage_records
  for select to authenticated using (user_id = (select auth.uid()));
create policy ai_usage_records_select_ai_writer on public.ai_usage_records
  for select to app_ai_writer using (user_id = (select private.current_uid()));
create policy ai_usage_records_insert_ai_writer on public.ai_usage_records
  for insert to app_ai_writer with check (user_id = (select private.current_uid()));

grant select on table public.ai_usage_records to authenticated, app_ai_writer;
grant insert (id, user_id, occurred_at, feature, job_type, ai_job_id, call_key, application_project_id,
              provider, model, model_tier, connection_tier, input_tokens, cached_input_tokens,
              cache_write_tokens, output_tokens, reasoning_tokens, usage_source, outcome, error_code,
              price_table_version, estimated_cost_usd)
  on table public.ai_usage_records to app_ai_writer;
