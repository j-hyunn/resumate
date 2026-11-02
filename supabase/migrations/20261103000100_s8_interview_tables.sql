-- S8 mock interview tables (F-P3-01~07, 13, 15; DM A.12 / A.13, §0 AI meta, §2.7 v4.1, §5; AI-05 / 06 / 07 storage).
--   interview_sessions, interview_questions, interview_answers, answer_evaluations, session_feedbacks
--   + CHECKs, composite FKs (DM-2), indexes, RLS, grants, updated_at, evidence cleanup, answer counters,
--   job cancel on session delete.
--
-- Write paths (DM §5, S6 / S7 precedent):
--   * interview_sessions: insert and every state change through RPCs (user: create / abandon / mark viewed / submit;
--     app_ai_writer: question generation and evaluation RPCs). Users may delete their sessions (F-P3-15).
--   * interview_questions / answer_evaluations / session_feedbacks: app_ai_writer RPCs only.
--     intent / good_answer_signals are never granted to the user session (A.13). intent is revealed after
--     submission through get_interview_question_reveals (definer).
--   * interview_answers: rows created with their question (RPC); the user updates answer_text only, while the answer
--     is a draft, the session is in progress, not submitted and its questions are ready (A.13, S-33).
--   * Evidence lives in evidence_links (owner_type interview_question / answer_evaluation / session_feedback, owner
--     soft) and is deleted with its owner row.

-- ── interview_sessions (A.12) ───────────────────────────────────────────────
create table public.interview_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default private.current_uid() references auth.users (id) on delete cascade,
  application_project_id uuid not null,
  insight_id uuid,
  source_session_id uuid,
  interview_type text not null,
  question_count integer not null default 5,
  data_sufficiency text not null,
  weak_requirement_ids uuid[] not null default '{}',
  status text not null default 'in_progress',
  generation_status text not null default 'generating',
  answered_count integer not null default 0,
  unanswered_count integer not null default 0,
  submitted_at timestamptz,
  completed_at timestamptz,
  result_viewed_at timestamptz,
  abandoned_at timestamptz,
  last_activity_at timestamptz not null default now(),
  career_snapshot_hash text,
  -- Session score slot (AI 4.3, D-14 pending).
  score_status text,
  score_value numeric,
  score_max numeric,
  score_method_version text,
  score_rationale text,
  score_counted_count integer,
  -- v4.1 (R-40): provider / model of the question set and of the (latest) evaluation.
  question_provider text,
  question_model text,
  evaluation_provider text,
  evaluation_model text,
  -- Internal [구현 결정]: the job that owns the current generation / evaluation and its run_generation (S6 QA-S6-01
  -- reopen rule). ai_jobs rows are pruned after 90 days -> set null.
  question_job_id uuid,
  question_run_generation integer,
  evaluation_job_id uuid,
  evaluation_run_generation integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint interview_sessions_id_user_id_key unique (id, user_id),
  constraint interview_sessions_application_project_fkey foreign key (application_project_id, user_id)
    references public.application_projects (id, user_id) on delete cascade,
  constraint interview_sessions_insight_fkey foreign key (insight_id, user_id)
    references public.insights (id, user_id) on delete set null (insight_id),
  constraint interview_sessions_source_session_fkey foreign key (source_session_id, user_id)
    references public.interview_sessions (id, user_id) on delete set null (source_session_id),
  constraint interview_sessions_question_job_fkey foreign key (question_job_id, user_id)
    references public.ai_jobs (id, user_id) on delete set null (question_job_id),
  constraint interview_sessions_evaluation_job_fkey foreign key (evaluation_job_id, user_id)
    references public.ai_jobs (id, user_id) on delete set null (evaluation_job_id),
  constraint interview_sessions_interview_type_check check (interview_type in ('job', 'culture_fit')),
  constraint interview_sessions_question_count_check check (question_count in (3, 5, 7)),
  constraint interview_sessions_data_sufficiency_check check (data_sufficiency in ('ok', 'thin', 'none')),
  constraint interview_sessions_weak_requirement_ids_check check (
    cardinality(weak_requirement_ids) <= 50 and array_position(weak_requirement_ids, null) is null),
  constraint interview_sessions_status_check check (status in (
    'in_progress', 'evaluating', 'completed', 'evaluation_failed', 'abandoned')),
  constraint interview_sessions_generation_status_check check (generation_status in ('generating', 'ready', 'failed')),
  constraint interview_sessions_answered_count_check check (answered_count between 0 and 7),
  constraint interview_sessions_unanswered_count_check check (unanswered_count between 0 and 7),
  constraint interview_sessions_score_status_check check (score_status in ('pending_method', 'scored', 'not_scored')),
  constraint interview_sessions_score_counted_count_check check (score_counted_count is null or score_counted_count >= 0),
  constraint interview_sessions_score_method_version_check check (
    score_method_version is null or char_length(score_method_version) between 1 and 100),
  constraint interview_sessions_career_snapshot_hash_check check (
    career_snapshot_hash is null or char_length(career_snapshot_hash) between 1 and 128),
  constraint interview_sessions_question_provider_check check (question_provider in ('openai', 'gemini', 'anthropic')),
  constraint interview_sessions_evaluation_provider_check check (
    evaluation_provider in ('openai', 'gemini', 'anthropic')),
  constraint interview_sessions_question_model_check check (
    question_model is null or char_length(question_model) between 1 and 200),
  constraint interview_sessions_evaluation_model_check check (
    evaluation_model is null or char_length(evaluation_model) between 1 and 200),
  constraint interview_sessions_run_generation_check check (
    (question_run_generation is null or question_run_generation >= 0)
    and (evaluation_run_generation is null or evaluation_run_generation >= 0)),
  -- Lifecycle: answering (in_progress) / abandoned are before submission; the other three are after it.
  constraint interview_sessions_submitted_check check (
    (status in ('in_progress', 'abandoned')) = (submitted_at is null)),
  constraint interview_sessions_abandoned_check check ((status = 'abandoned') = (abandoned_at is not null)),
  constraint interview_sessions_completed_check check (status <> 'completed' or completed_at is not null),
  -- Submission needs the full question set (S-33 edit / submit rule).
  constraint interview_sessions_submitted_ready_check check (submitted_at is null or generation_status = 'ready'),
  constraint interview_sessions_ready_meta_check check (
    generation_status <> 'ready' or (question_provider is not null and question_model is not null))
);

-- A.12 / D-34: one answering session per application project.
create unique index interview_sessions_in_progress_key on public.interview_sessions (application_project_id)
  where status = 'in_progress';
create index interview_sessions_project_created_idx
  on public.interview_sessions (application_project_id, created_at desc);
create index interview_sessions_user_created_idx on public.interview_sessions (user_id, created_at desc);
create index interview_sessions_insight_id_idx on public.interview_sessions (insight_id) where insight_id is not null;
create index interview_sessions_source_session_id_idx on public.interview_sessions (source_session_id)
  where source_session_id is not null;
create index interview_sessions_question_job_id_idx on public.interview_sessions (question_job_id)
  where question_job_id is not null;
create index interview_sessions_evaluation_job_id_idx on public.interview_sessions (evaluation_job_id)
  where evaluation_job_id is not null;

alter table public.interview_sessions enable row level security;

create trigger interview_sessions_set_updated_at
  before update on public.interview_sessions
  for each row execute function private.set_updated_at();


-- ── interview_questions (A.13) ──────────────────────────────────────────────
create table public.interview_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default private.current_uid() references auth.users (id) on delete cascade,
  session_id uuid not null,
  sequence integer not null,
  source_kind text not null,
  anchor text not null,
  question_text text not null,
  intent text not null,                     -- private until submission (A.13, AI-05)
  focus_criteria text[] not null default '{}',
  target_requirement_ids uuid[] not null default '{}',
  target_gap_requirement_ids uuid[] not null default '{}',
  good_answer_signals jsonb not null default '[]'::jsonb,   -- private, never shown to the user
  copied_from_question_id uuid,             -- F-P3-08 (Should)
  -- AI output common meta (DM §0).
  ai_job_id uuid,
  run_generation integer,
  schema_version integer,
  prompt_version text,
  provider text,
  model text,
  model_tier text,
  connection_tier text,
  input_hash text,
  career_snapshot_hash text,
  validation_report jsonb,
  usage jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint interview_questions_id_user_id_key unique (id, user_id),
  constraint interview_questions_id_session_id_key unique (id, session_id),
  constraint interview_questions_session_id_sequence_key unique (session_id, sequence),
  constraint interview_questions_session_fkey foreign key (session_id, user_id)
    references public.interview_sessions (id, user_id) on delete cascade,
  constraint interview_questions_copied_from_fkey foreign key (copied_from_question_id, user_id)
    references public.interview_questions (id, user_id) on delete set null (copied_from_question_id),
  constraint interview_questions_ai_job_fkey foreign key (ai_job_id, user_id)
    references public.ai_jobs (id, user_id) on delete set null (ai_job_id),
  constraint interview_questions_sequence_check check (sequence between 1 and 7),
  constraint interview_questions_source_kind_check check (source_kind in (
    'project_deep_dive', 'requirement_fit', 'gap_probe', 'collaboration', 'conflict', 'failure_growth', 'values',
    'org_adaptation', 'motivation_career')),
  constraint interview_questions_anchor_check check (anchor in ('experience', 'jd', 'general')),
  constraint interview_questions_question_text_check check (char_length(btrim(question_text)) between 1 and 1000),
  constraint interview_questions_intent_check check (char_length(btrim(intent)) between 1 and 1000),
  constraint interview_questions_focus_criteria_check check (
    focus_criteria <@ array['specificity', 'intent_fit', 'structure', 'job_relevance']::text[]
    and array_position(focus_criteria, null) is null),
  constraint interview_questions_target_requirement_ids_check check (
    cardinality(target_requirement_ids) <= 20 and array_position(target_requirement_ids, null) is null),
  constraint interview_questions_target_gap_requirement_ids_check check (
    cardinality(target_gap_requirement_ids) <= 20 and array_position(target_gap_requirement_ids, null) is null),
  constraint interview_questions_good_answer_signals_check check (jsonb_typeof(good_answer_signals) = 'array'),
  constraint interview_questions_run_generation_check check (run_generation is null or run_generation >= 0),
  constraint interview_questions_schema_version_check check (schema_version is null or schema_version >= 1),
  constraint interview_questions_prompt_version_check check (
    prompt_version is null or char_length(prompt_version) between 1 and 200),
  constraint interview_questions_provider_check check (provider in ('openai', 'gemini', 'anthropic')),
  constraint interview_questions_model_check check (model is null or char_length(model) between 1 and 200),
  constraint interview_questions_model_tier_check check (model_tier in ('light', 'default', 'heavy')),
  constraint interview_questions_connection_tier_check check (connection_tier in ('free', 'paid')),
  constraint interview_questions_input_hash_check check (input_hash is null or char_length(input_hash) between 1 and 128),
  constraint interview_questions_career_snapshot_hash_check check (
    career_snapshot_hash is null or char_length(career_snapshot_hash) between 1 and 128),
  constraint interview_questions_validation_report_check check (
    validation_report is null or jsonb_typeof(validation_report) = 'object'),
  constraint interview_questions_usage_check check (usage is null or jsonb_typeof(usage) = 'object')
);

create index interview_questions_ai_job_id_idx on public.interview_questions (ai_job_id) where ai_job_id is not null;
create index interview_questions_copied_from_idx on public.interview_questions (copied_from_question_id)
  where copied_from_question_id is not null;

alter table public.interview_questions enable row level security;

create trigger interview_questions_set_updated_at
  before update on public.interview_questions
  for each row execute function private.set_updated_at();


-- ── interview_answers (A.13) ────────────────────────────────────────────────
create table public.interview_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default private.current_uid() references auth.users (id) on delete cascade,
  session_id uuid not null,
  question_id uuid not null,
  answer_text text not null default '',
  status text not null default 'draft',
  -- Per-question score slot (AI 4.3, D-14 pending).
  score_status text,
  score_value numeric,
  score_max numeric,
  score_method_version text,
  score_rationale text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint interview_answers_id_user_id_key unique (id, user_id),
  constraint interview_answers_id_session_id_key unique (id, session_id),
  constraint interview_answers_question_id_key unique (question_id),
  constraint interview_answers_session_fkey foreign key (session_id, user_id)
    references public.interview_sessions (id, user_id) on delete cascade,
  -- The answer's question belongs to the same session.
  constraint interview_answers_question_fkey foreign key (question_id, session_id)
    references public.interview_questions (id, session_id) on delete cascade,
  constraint interview_answers_answer_text_check check (char_length(answer_text) <= 5000),
  constraint interview_answers_status_check check (status in ('draft', 'submitted', 'unanswered')),
  constraint interview_answers_score_status_check check (score_status in (
    'pending_method', 'scored', 'unanswered', 'not_scored')),
  constraint interview_answers_score_method_version_check check (
    score_method_version is null or char_length(score_method_version) between 1 and 100),
  -- unanswered <-> score 'unanswered' (D-16 (b)); a draft has no score yet.
  constraint interview_answers_unanswered_check check ((status = 'unanswered') = (score_status is not distinct from 'unanswered')),
  constraint interview_answers_draft_score_check check (status <> 'draft' or score_status is null)
);

create index interview_answers_session_id_idx on public.interview_answers (session_id);

alter table public.interview_answers enable row level security;

create trigger interview_answers_set_updated_at
  before update on public.interview_answers
  for each row execute function private.set_updated_at();


-- ── answer_evaluations (A.13, AI-06) ────────────────────────────────────────
create table public.answer_evaluations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default private.current_uid() references auth.users (id) on delete cascade,
  session_id uuid not null,
  answer_id uuid not null,
  status text not null default 'pending',
  result jsonb,
  ai_job_id uuid,
  run_generation integer,
  schema_version integer,
  prompt_version text,
  provider text,
  model text,
  model_tier text,
  connection_tier text,
  input_hash text,
  career_snapshot_hash text,
  validation_report jsonb,
  usage jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint answer_evaluations_id_user_id_key unique (id, user_id),
  constraint answer_evaluations_answer_id_key unique (answer_id),
  constraint answer_evaluations_session_fkey foreign key (session_id, user_id)
    references public.interview_sessions (id, user_id) on delete cascade,
  constraint answer_evaluations_answer_fkey foreign key (answer_id, session_id)
    references public.interview_answers (id, session_id) on delete cascade,
  constraint answer_evaluations_ai_job_fkey foreign key (ai_job_id, user_id)
    references public.ai_jobs (id, user_id) on delete set null (ai_job_id),
  constraint answer_evaluations_status_check check (status in ('pending', 'succeeded', 'failed')),
  constraint answer_evaluations_result_check check (result is null or jsonb_typeof(result) = 'object'),
  constraint answer_evaluations_run_generation_check check (run_generation is null or run_generation >= 0),
  constraint answer_evaluations_schema_version_check check (schema_version is null or schema_version >= 1),
  constraint answer_evaluations_prompt_version_check check (
    prompt_version is null or char_length(prompt_version) between 1 and 200),
  constraint answer_evaluations_provider_check check (provider in ('openai', 'gemini', 'anthropic')),
  constraint answer_evaluations_model_check check (model is null or char_length(model) between 1 and 200),
  constraint answer_evaluations_model_tier_check check (model_tier in ('light', 'default', 'heavy')),
  constraint answer_evaluations_connection_tier_check check (connection_tier in ('free', 'paid')),
  constraint answer_evaluations_input_hash_check check (input_hash is null or char_length(input_hash) between 1 and 128),
  constraint answer_evaluations_career_snapshot_hash_check check (
    career_snapshot_hash is null or char_length(career_snapshot_hash) between 1 and 128),
  constraint answer_evaluations_validation_report_check check (
    validation_report is null or jsonb_typeof(validation_report) = 'object'),
  constraint answer_evaluations_usage_check check (usage is null or jsonb_typeof(usage) = 'object'),
  constraint answer_evaluations_succeeded_check check (
    status <> 'succeeded'
    or (result is not null and completed_at is not null and schema_version is not null and prompt_version is not null
        and provider is not null and model is not null and model_tier is not null and connection_tier is not null))
);

create index answer_evaluations_session_id_idx on public.answer_evaluations (session_id);
create index answer_evaluations_ai_job_id_idx on public.answer_evaluations (ai_job_id) where ai_job_id is not null;

alter table public.answer_evaluations enable row level security;

create trigger answer_evaluations_set_updated_at
  before update on public.answer_evaluations
  for each row execute function private.set_updated_at();


-- ── session_feedbacks (A.13, AI-07) ─────────────────────────────────────────
create table public.session_feedbacks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default private.current_uid() references auth.users (id) on delete cascade,
  session_id uuid not null,
  status text not null default 'pending',
  result jsonb,
  ai_job_id uuid,
  run_generation integer,
  schema_version integer,
  prompt_version text,
  provider text,
  model text,
  model_tier text,
  connection_tier text,
  input_hash text,
  career_snapshot_hash text,
  validation_report jsonb,
  usage jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint session_feedbacks_id_user_id_key unique (id, user_id),
  constraint session_feedbacks_session_id_key unique (session_id),
  constraint session_feedbacks_session_fkey foreign key (session_id, user_id)
    references public.interview_sessions (id, user_id) on delete cascade,
  constraint session_feedbacks_ai_job_fkey foreign key (ai_job_id, user_id)
    references public.ai_jobs (id, user_id) on delete set null (ai_job_id),
  constraint session_feedbacks_status_check check (status in ('pending', 'succeeded', 'failed')),
  constraint session_feedbacks_result_check check (result is null or jsonb_typeof(result) = 'object'),
  constraint session_feedbacks_run_generation_check check (run_generation is null or run_generation >= 0),
  constraint session_feedbacks_schema_version_check check (schema_version is null or schema_version >= 1),
  constraint session_feedbacks_prompt_version_check check (
    prompt_version is null or char_length(prompt_version) between 1 and 200),
  constraint session_feedbacks_provider_check check (provider in ('openai', 'gemini', 'anthropic')),
  constraint session_feedbacks_model_check check (model is null or char_length(model) between 1 and 200),
  constraint session_feedbacks_model_tier_check check (model_tier in ('light', 'default', 'heavy')),
  constraint session_feedbacks_connection_tier_check check (connection_tier in ('free', 'paid')),
  constraint session_feedbacks_input_hash_check check (input_hash is null or char_length(input_hash) between 1 and 128),
  constraint session_feedbacks_career_snapshot_hash_check check (
    career_snapshot_hash is null or char_length(career_snapshot_hash) between 1 and 128),
  constraint session_feedbacks_validation_report_check check (
    validation_report is null or jsonb_typeof(validation_report) = 'object'),
  constraint session_feedbacks_usage_check check (usage is null or jsonb_typeof(usage) = 'object'),
  constraint session_feedbacks_succeeded_check check (
    status <> 'succeeded'
    or (result is not null and completed_at is not null and schema_version is not null and prompt_version is not null
        and provider is not null and model is not null and model_tier is not null and connection_tier is not null))
);

create index session_feedbacks_ai_job_id_idx on public.session_feedbacks (ai_job_id) where ai_job_id is not null;

alter table public.session_feedbacks enable row level security;

create trigger session_feedbacks_set_updated_at
  before update on public.session_feedbacks
  for each row execute function private.set_updated_at();


-- ── evidence cleanup: an owner's evidence links go with it (owner_id is soft, DM-7) ──
-- tg_argv[0] = evidence owner_type. Security definer: no API role deletes evidence_links directly.
create or replace function private.interview_delete_owner_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.evidence_links el
   where el.owner_type = tg_argv[0] and el.owner_id = old.id and el.user_id = old.user_id;
  return null;
end;
$$;

revoke all on function private.interview_delete_owner_evidence() from public;

create trigger interview_questions_delete_evidence
  after delete on public.interview_questions
  for each row execute function private.interview_delete_owner_evidence('interview_question');
create trigger answer_evaluations_delete_evidence
  after delete on public.answer_evaluations
  for each row execute function private.interview_delete_owner_evidence('answer_evaluation');
create trigger session_feedbacks_delete_evidence
  after delete on public.session_feedbacks
  for each row execute function private.interview_delete_owner_evidence('session_feedback');

-- interview_answer sources (AI C-3 ANS-n): a deleted answer marks the links that quote it (same rule as career
-- sources). Usually the owners go in the same cascade.
create trigger interview_answers_evidence_source_deleted
  after delete on public.interview_answers
  for each row execute function private.evidence_mark_source_deleted('interview_answer');


-- ── answer counters (A.12 answered_count / last_activity_at; S-20 / S-37 banner) ──
-- Recounts non-blank answers of the session after an answer_text change. Lock order answer -> session; the submit RPC
-- takes answers before the session for the same reason. Security definer: users can't update sessions.
create or replace function private.interview_answers_touch_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.interview_sessions s
     set answered_count = (select count(*) from public.interview_answers a
                            where a.session_id = new.session_id and a.answer_text ~ '\S'),
         last_activity_at = now()
   where s.id = new.session_id and s.status = 'in_progress';
  return null;
end;
$$;

revoke all on function private.interview_answers_touch_session() from public;

create trigger interview_answers_touch_session
  after update of answer_text on public.interview_answers
  for each row when (old.answer_text is distinct from new.answer_text)
  execute function private.interview_answers_touch_session();


-- ── session delete -> cancel its running jobs (F-P3-15, plan 7) ──
-- A deleted session's queued / running interview_questions / interview_evaluation jobs get cancel_requested_at (the
-- runner observes it, same as request_ai_job_cancel). Covers the user delete, delete_career_item(delete_results)
-- and the application project cascade. Lock order session -> ai_jobs (as the project cascade).
create or replace function private.interview_sessions_cancel_jobs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ai_jobs j
     set cancel_requested_at = now()
   where j.user_id = old.user_id
     and j.target_type = 'interview_session' and j.target_id = old.id
     and j.job_type in ('interview_questions', 'interview_evaluation')
     and j.status in ('queued', 'running')
     and j.cancel_requested_at is null;
  return null;
end;
$$;

revoke all on function private.interview_sessions_cancel_jobs() from public;

create trigger interview_sessions_cancel_jobs
  after delete on public.interview_sessions
  for each row execute function private.interview_sessions_cancel_jobs();


-- ── RLS (DM §5) ──
create policy interview_sessions_select_own on public.interview_sessions
  for select to authenticated using (user_id = (select auth.uid()));
create policy interview_sessions_delete_own on public.interview_sessions
  for delete to authenticated using (user_id = (select auth.uid()));
create policy interview_sessions_select_ai_writer on public.interview_sessions
  for select to app_ai_writer using (user_id = (select private.current_uid()));

create policy interview_questions_select_own on public.interview_questions
  for select to authenticated using (user_id = (select auth.uid()));
create policy interview_questions_select_ai_writer on public.interview_questions
  for select to app_ai_writer using (user_id = (select private.current_uid()));

create policy interview_answers_select_own on public.interview_answers
  for select to authenticated using (user_id = (select auth.uid()));
-- A.13 / S-33 edit rule: draft answer, session in progress, not submitted, questions ready.
create policy interview_answers_update_own on public.interview_answers
  for update to authenticated
  using (user_id = (select auth.uid())
         and status = 'draft'
         and exists (select 1 from public.interview_sessions s
                      where s.id = session_id and s.status = 'in_progress' and s.submitted_at is null
                        and s.generation_status = 'ready'))
  with check (user_id = (select auth.uid()) and status = 'draft');
create policy interview_answers_select_ai_writer on public.interview_answers
  for select to app_ai_writer using (user_id = (select private.current_uid()));

create policy answer_evaluations_select_own on public.answer_evaluations
  for select to authenticated using (user_id = (select auth.uid()));
create policy answer_evaluations_select_ai_writer on public.answer_evaluations
  for select to app_ai_writer using (user_id = (select private.current_uid()));

create policy session_feedbacks_select_own on public.session_feedbacks
  for select to authenticated using (user_id = (select auth.uid()));
create policy session_feedbacks_select_ai_writer on public.session_feedbacks
  for select to app_ai_writer using (user_id = (select private.current_uid()));


-- ── grants ──
grant select on table public.interview_sessions to authenticated, app_ai_writer;
grant delete on table public.interview_sessions to authenticated;

-- intent / good_answer_signals: no user-session grant (A.13). app_ai_writer reads them for AI-06.
grant select (id, user_id, session_id, sequence, source_kind, anchor, question_text, focus_criteria,
              target_requirement_ids, target_gap_requirement_ids, copied_from_question_id, ai_job_id, schema_version,
              prompt_version, provider, model, model_tier, connection_tier, created_at, updated_at)
  on table public.interview_questions to authenticated;
grant select on table public.interview_questions to app_ai_writer;

grant select on table public.interview_answers to authenticated, app_ai_writer;
grant update (answer_text) on table public.interview_answers to authenticated;

grant select on table public.answer_evaluations to authenticated, app_ai_writer;
grant select on table public.session_feedbacks to authenticated, app_ai_writer;

-- Written only through RPCs / triggers / cascade; service_role keeps SELECT / DELETE (S5–S7 precedent).
revoke insert, update, truncate, references, trigger on table public.interview_sessions from service_role;
revoke insert, update, truncate, references, trigger on table public.interview_questions from service_role;
revoke insert, update, truncate, references, trigger on table public.interview_answers from service_role;
revoke insert, update, truncate, references, trigger on table public.answer_evaluations from service_role;
revoke insert, update, truncate, references, trigger on table public.session_feedbacks from service_role;
