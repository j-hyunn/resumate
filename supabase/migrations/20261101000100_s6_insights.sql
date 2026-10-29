-- S6 insights (AI-02, F-P2-04·05·07; DM A.8, §0 AI meta, §5) + RLS + grants.
--
-- Write paths (DM §5, S5 precedent):
--   * No direct write for any API role. begin_insight / complete_insight / fail_insight (app_ai_writer, security
--     definer + owner check) and the ai_jobs end trigger write rows; delete is the application project cascade
--     or delete_career_item(result_mode = 'delete_results') through a definer helper (S6 career deletion file).
--   * One row per generation (history kept, F-P2-07). is_latest only on a ready row, at most one per project.
--   * result holds no evidence (C-3); evidence lives in evidence_links (owner_type 'insight', owner_id = id).
--     Deleting an insight deletes its evidence links (owner_id is a soft reference, DM-7).

create table public.insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default private.current_uid() references auth.users (id) on delete cascade,
  application_project_id uuid not null,
  version_no integer not null,
  is_latest boolean not null default false,
  status text not null default 'generating',
  result jsonb,
  match_stage_result jsonb,
  requirements_hash text,
  career_snapshot_hash text,
  input_hash text,
  -- AI output common meta (DM §0). ai_jobs rows are pruned after 90 days (DM §4.4) -> set null.
  ai_job_id uuid,
  -- Internal: the ai_jobs.run_generation that (re)opened this row (QA-S6-01 manual retry). Not AI meta.
  run_generation integer,
  schema_version integer,
  prompt_version text,
  provider text,
  model text,
  model_tier text,
  connection_tier text,
  validation_report jsonb,
  usage jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint insights_id_user_id_key unique (id, user_id),
  constraint insights_application_project_id_version_no_key unique (application_project_id, version_no),
  -- F-AP-05: deleted with the application project.
  constraint insights_application_project_fkey foreign key (application_project_id, user_id)
    references public.application_projects (id, user_id) on delete cascade,
  constraint insights_ai_job_fkey foreign key (ai_job_id, user_id)
    references public.ai_jobs (id, user_id) on delete set null (ai_job_id),
  constraint insights_version_no_check check (version_no >= 1),
  constraint insights_run_generation_check check (run_generation is null or run_generation >= 0),
  constraint insights_status_check check (status in ('generating', 'ready', 'failed')),
  -- A.8: is_latest only on ready rows.
  constraint insights_is_latest_check check (not is_latest or status = 'ready'),
  constraint insights_result_check check (result is null or jsonb_typeof(result) = 'object'),
  constraint insights_match_stage_result_check check (
    match_stage_result is null or jsonb_typeof(match_stage_result) in ('object', 'array')),
  constraint insights_requirements_hash_check check (
    requirements_hash is null or char_length(requirements_hash) between 1 and 128),
  constraint insights_career_snapshot_hash_check check (
    career_snapshot_hash is null or char_length(career_snapshot_hash) between 1 and 128),
  constraint insights_input_hash_check check (input_hash is null or char_length(input_hash) between 1 and 128),
  constraint insights_schema_version_check check (schema_version is null or schema_version >= 1),
  constraint insights_prompt_version_check check (
    prompt_version is null or char_length(prompt_version) between 1 and 200),
  constraint insights_provider_check check (provider in ('openai', 'gemini', 'anthropic')),
  constraint insights_model_check check (model is null or char_length(model) between 1 and 200),
  constraint insights_model_tier_check check (model_tier in ('light', 'default', 'heavy')),
  constraint insights_connection_tier_check check (connection_tier in ('free', 'paid')),
  constraint insights_validation_report_check check (
    validation_report is null or jsonb_typeof(validation_report) = 'object'),
  constraint insights_usage_check check (usage is null or jsonb_typeof(usage) = 'object'),
  -- A ready insight always carries its result, hashes (F-P2-07 stale check) and provider badge (F-AI-03).
  constraint insights_ready_check check (
    status <> 'ready'
    or (result is not null and match_stage_result is not null and completed_at is not null
        and requirements_hash is not null and career_snapshot_hash is not null and input_hash is not null
        and schema_version is not null and prompt_version is not null and provider is not null
        and model is not null and model_tier is not null and connection_tier is not null))
);

-- A.8 indexes.
create unique index insights_latest_key on public.insights (application_project_id) where is_latest;
create index insights_reuse_idx on public.insights (user_id, application_project_id, input_hash)
  where status = 'ready';
create index insights_project_created_idx on public.insights (application_project_id, created_at desc);
create index insights_ai_job_id_idx on public.insights (ai_job_id) where ai_job_id is not null;

alter table public.insights enable row level security;

create trigger insights_set_updated_at
  before update on public.insights
  for each row execute function private.set_updated_at();

-- An insight's evidence links go with it (C-3 storage: owner_type 'insight', owner_id soft). Security definer:
-- no API role may delete evidence_links directly.
create or replace function private.insights_delete_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.evidence_links el
   where el.owner_type = 'insight' and el.owner_id = old.id and el.user_id = old.user_id;
  return null;
end;
$$;

revoke all on function private.insights_delete_evidence() from public;

create trigger insights_delete_evidence
  after delete on public.insights
  for each row execute function private.insights_delete_evidence();

-- RLS (DM §5): owner reads; app_ai_writer reads (AI-03 / AI-05 reference signal, S7 / S8). No write policies.
create policy insights_select_own on public.insights
  for select to authenticated using (user_id = (select auth.uid()));
create policy insights_select_ai_writer on public.insights
  for select to app_ai_writer using (user_id = (select private.current_uid()));

grant select on table public.insights to authenticated, app_ai_writer;

-- Written only through the RPCs / cascade above; service_role keeps SELECT / DELETE (S5 precedent).
revoke insert, update, truncate, references, trigger on table public.insights from service_role;
