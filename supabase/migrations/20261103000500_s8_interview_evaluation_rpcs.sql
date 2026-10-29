-- S8 interview evaluation RPCs (AI-06 / AI-07; DM A.12 / A.13, AI 4.3 score slots, C-3 storage) + the ai_jobs end
-- trigger for both interview job types. app_ai_writer only, security definer + private.current_uid() owner check.
-- The job runner calls:
--   begin_interview_evaluation -> (AI-06 per answered answer) save_answer_evaluation | fail_answer_evaluation
--   -> (AI-07) save_session_feedback -> complete_interview_evaluation, then complete_ai_job when the session completed
--   (stale_run: leave the job alone).
-- Job shape: job_type 'interview_evaluation', target_type 'interview_session', target_id = session id.
-- Re-evaluation (S-22 다시 채점): a new run evaluates only the answered answers without a succeeded evaluation, then
-- the session feedback again. Succeeded evaluations are kept (plan [가정 2]).
-- Lock order: application_projects -> interview_sessions -> interview_answers -> answer_evaluations.
-- Errors: 42501 not_authenticated; P0001 interview_session_not_found, interview_answer_not_found, invalid_ai_job,
-- invalid_ai_metadata, interview_not_submitted, interview_evaluation_not_needed, interview_evaluation_in_progress,
-- answer_not_evaluable, invalid_interview_payload, invalid_evidence_source.

-- save / complete run check for evaluation: 'ok', 'reopen' (evaluation_failed in an earlier run of this job,
-- QA-S6-01) or 'stale'.
create or replace function private.interview_evaluation_run_state(p_session public.interview_sessions,
                                                                   p_job public.ai_jobs, p_run_generation integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_job.status <> 'running' or p_job.run_generation is distinct from p_run_generation then 'stale'
    when p_session.evaluation_job_id is distinct from p_job.id then 'stale'
    when p_session.status = 'evaluating' then 'ok'
    when p_session.status = 'evaluation_failed'
         and coalesce(p_session.evaluation_run_generation, -1) < p_run_generation then 'reopen'
    else 'stale'
  end;
$$;

revoke all on function private.interview_evaluation_run_state(public.interview_sessions, public.ai_jobs, integer)
  from public;

-- (Re)opens evaluation for a run: status evaluating, result not final, feedback to be redone.
create or replace function private.interview_evaluation_open(p_session_id uuid, p_ai_job_id uuid,
                                                             p_run_generation integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.interview_sessions s
     set status = 'evaluating', evaluation_job_id = p_ai_job_id, evaluation_run_generation = p_run_generation,
         score_status = null, score_counted_count = null, completed_at = null, result_viewed_at = null
   where s.id = p_session_id;
  update public.session_feedbacks f set status = 'pending' where f.session_id = p_session_id and f.status <> 'pending';
end;
$$;

revoke all on function private.interview_evaluation_open(uuid, uuid, integer) from public;

-- Answered answers without a succeeded evaluation -> score not_scored, pending evaluations -> failed.
create or replace function private.interview_mark_unscored(p_session_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  update public.answer_evaluations e set status = 'failed'
   where e.session_id = p_session_id and e.status = 'pending';

  select coalesce(array_agg(a.id order by q.sequence), '{}') into v_ids
    from public.interview_answers a
    join public.interview_questions q on q.id = a.question_id
   where a.session_id = p_session_id and a.status = 'submitted'
     and not exists (select 1 from public.answer_evaluations e where e.answer_id = a.id and e.status = 'succeeded');

  update public.interview_answers a
     set score_status = 'not_scored', score_value = null, score_max = null, score_method_version = null,
         score_rationale = null
   where a.id = any (v_ids) and a.score_status is distinct from 'not_scored';
  return v_ids;
end;
$$;

revoke all on function private.interview_mark_unscored(uuid) from public;

-- evaluating -> evaluation_failed for (session, evaluation job); saved evaluations are kept. p_skip_locked: end trigger
-- path (QA-S5-06), take project and session without waiting, else do nothing.
create or replace function private.interview_evaluation_mark_failed(p_session_id uuid, p_ai_job_id uuid,
                                                                    p_skip_locked boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_generation integer;
begin
  select s.application_project_id into v_project_id from public.interview_sessions s where s.id = p_session_id;
  if not found then
    return false;
  end if;

  if p_skip_locked then
    perform 1 from public.application_projects ap where ap.id = v_project_id for update skip locked;
    if not found then
      return false;
    end if;
    perform 1 from public.interview_sessions s where s.id = p_session_id for update skip locked;
  else
    perform 1 from public.application_projects ap where ap.id = v_project_id for update;
    if not found then
      return false;
    end if;
    perform 1 from public.interview_sessions s where s.id = p_session_id for update;
  end if;
  if not found then
    return false;
  end if;

  select j.run_generation into v_generation from public.ai_jobs j where j.id = p_ai_job_id;

  update public.interview_sessions s
     set status = 'evaluation_failed', score_status = 'not_scored',
         evaluation_run_generation = coalesce(v_generation, s.evaluation_run_generation)
   where s.id = p_session_id and s.status = 'evaluating' and s.evaluation_job_id = p_ai_job_id;
  if not found then
    return false;
  end if;

  perform private.interview_mark_unscored(p_session_id);
  update public.session_feedbacks f set status = 'failed' where f.session_id = p_session_id and f.status = 'pending';
  return true;
end;
$$;

revoke all on function private.interview_evaluation_mark_failed(uuid, uuid, boolean) from public;

-- begin_interview_evaluation's return shape.
create or replace function private.interview_evaluation_begin_json(p_session_id uuid, p_reopened boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'session_id', s.id, 'application_project_id', s.application_project_id, 'interview_type', s.interview_type,
    'data_sufficiency', s.data_sufficiency, 'status', s.status, 'reopened', p_reopened,
    'answers_to_evaluate', coalesce((select jsonb_agg(jsonb_build_object(
        'answer_id', a.id, 'question_id', a.question_id, 'sequence', q.sequence) order by q.sequence)
        from public.interview_answers a join public.interview_questions q on q.id = a.question_id
       where a.session_id = s.id and a.status = 'submitted'
         and not exists (select 1 from public.answer_evaluations e
                          where e.answer_id = a.id and e.status = 'succeeded')), '[]'::jsonb),
    'evaluated_answer_ids', coalesce((select jsonb_agg(a.id order by q.sequence)
        from public.interview_answers a join public.interview_questions q on q.id = a.question_id
       where a.session_id = s.id and a.status = 'submitted'
         and exists (select 1 from public.answer_evaluations e
                      where e.answer_id = a.id and e.status = 'succeeded')), '[]'::jsonb),
    'unanswered_answer_ids', coalesce((select jsonb_agg(a.id order by q.sequence)
        from public.interview_answers a join public.interview_questions q on q.id = a.question_id
       where a.session_id = s.id and a.status = 'unanswered'), '[]'::jsonb),
    'feedback_needed', true)
    from public.interview_sessions s where s.id = p_session_id;
$$;

revoke all on function private.interview_evaluation_begin_json(uuid, boolean) from public;

-- Shape of save_answer_evaluation / save_session_feedback payloads: {result (object, no evidence key at any depth,
-- C-3), hashes, meta, evidence}. Source types: career + JD + interview_answer.
create or replace function private.interview_result_payload_valid(p_payload jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_payload is not null and jsonb_typeof(p_payload) = 'object'
     and jsonb_typeof(p_payload -> 'result') = 'object'
     and not jsonb_path_exists(p_payload -> 'result', 'lax $.**.evidence')
     and private.draft_payload_common_valid(p_payload)
     and private.interview_evidence_valid(p_payload -> 'evidence',
           array['profile', 'experience', 'education', 'project', 'project_detail', 'achievement', 'skill',
                 'jd_requirement', 'jd_sentence', 'interview_answer']);
$$;

revoke all on function private.interview_result_payload_valid(jsonb) from public;


-- ── begin_interview_evaluation ─────────────────────────────────────────────
-- Records evaluation_provider / evaluation_model (v4.1, overwritten on re-evaluation).
create or replace function public.begin_interview_evaluation(
  p_session_id uuid,
  p_ai_job_id uuid,
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
  v_session public.interview_sessions%rowtype;
  v_job public.ai_jobs%rowtype;
  v_reopened boolean;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  v_session := private.interview_lock_session(p_session_id, v_uid);

  select * into v_job from public.ai_jobs j where j.id = p_ai_job_id and j.user_id = v_uid;
  if not found or not private.interview_job_matches(v_job, v_session, 'interview_evaluation') then
    raise exception using errcode = 'P0001', message = 'invalid_ai_job';
  end if;

  if p_provider is distinct from v_job.provider or coalesce(char_length(btrim(p_model)), 0) not between 1 and 200 then
    raise exception using errcode = 'P0001', message = 'invalid_ai_metadata';
  end if;

  if v_session.submitted_at is null then
    raise exception using errcode = 'P0001', message = 'interview_not_submitted';
  end if;

  -- Same job: idempotent; a manual retry (higher run_generation) reopens its failed evaluation.
  if v_session.evaluation_job_id = p_ai_job_id and v_session.status in ('evaluating', 'evaluation_failed') then
    if v_session.status = 'evaluation_failed' and v_job.status in ('queued', 'running')
       and coalesce(v_session.evaluation_run_generation, -1) < v_job.run_generation then
      perform private.interview_evaluation_open(p_session_id, p_ai_job_id, v_job.run_generation);
      update public.interview_sessions s
         set evaluation_provider = v_job.provider, evaluation_model = btrim(p_model)
       where s.id = p_session_id;
      return private.interview_evaluation_begin_json(p_session_id, true);
    end if;
    return private.interview_evaluation_begin_json(p_session_id, false);
  end if;

  if v_job.status not in ('queued', 'running') then
    raise exception using errcode = 'P0001', message = 'invalid_ai_job';
  end if;

  if v_session.status = 'evaluating' then
    if v_session.evaluation_job_id is not null and private.interview_job_live(v_session.evaluation_job_id) then
      raise exception using errcode = 'P0001', message = 'interview_evaluation_in_progress';
    end if;
    v_reopened := v_session.evaluation_job_id is not null;
  elsif v_session.status = 'evaluation_failed' then
    v_reopened := true;
  else
    -- completed: only when an answered answer has no succeeded evaluation (not_scored, 다시 채점).
    if not exists (select 1 from public.interview_answers a
                    where a.session_id = p_session_id and a.status = 'submitted'
                      and not exists (select 1 from public.answer_evaluations e
                                       where e.answer_id = a.id and e.status = 'succeeded')) then
      raise exception using errcode = 'P0001', message = 'interview_evaluation_not_needed';
    end if;
    v_reopened := true;
  end if;

  perform private.interview_evaluation_open(p_session_id, p_ai_job_id, v_job.run_generation);
  update public.interview_sessions s
     set evaluation_provider = v_job.provider, evaluation_model = btrim(p_model)
   where s.id = p_session_id;

  return private.interview_evaluation_begin_json(p_session_id, v_reopened);
end;
$$;

revoke all on function public.begin_interview_evaluation(uuid, uuid, text, text) from public, anon;
grant execute on function public.begin_interview_evaluation(uuid, uuid, text, text) to app_ai_writer;


-- ── save_answer_evaluation (AI-06 저장) ─────────────────────────────────────
-- Creates or replaces the answer's evaluation (one row per answer, id kept) and its evidence (owner_type
-- 'answer_evaluation'); the answer's score slot becomes pending_method (D-14, AI 4.3: server-computed later).
create or replace function public.save_answer_evaluation(
  p_answer_id uuid,
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
  v_session_id uuid;
  v_session public.interview_sessions%rowtype;
  v_answer public.interview_answers%rowtype;
  v_job public.ai_jobs%rowtype;
  v_state text;
  v_meta jsonb;
  v_eval_id uuid;
  v_count integer;
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  select a.session_id into v_session_id from public.interview_answers a where a.id = p_answer_id and a.user_id = v_uid;
  if not found then
    raise exception using errcode = 'P0001', message = 'interview_answer_not_found';
  end if;
  begin
    v_session := private.interview_lock_session(v_session_id, v_uid);
  exception when sqlstate 'P0001' then
    raise exception using errcode = 'P0001', message = 'interview_answer_not_found';
  end;
  select * into v_answer from public.interview_answers a where a.id = p_answer_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'interview_answer_not_found';
  end if;

  select * into v_job from public.ai_jobs j where j.id = p_ai_job_id and j.user_id = v_uid;
  if not found or not private.interview_job_matches(v_job, v_session, 'interview_evaluation') then
    raise exception using errcode = 'P0001', message = 'invalid_ai_job';
  end if;

  v_state := private.interview_evaluation_run_state(v_session, v_job, p_run_generation);
  if v_state = 'stale' then
    return jsonb_build_object('applied', false, 'reason', 'stale_run');
  end if;

  if v_answer.status <> 'submitted' then
    raise exception using errcode = 'P0001', message = 'answer_not_evaluable';
  end if;

  if not private.interview_result_payload_valid(p_payload) then
    raise exception using errcode = 'P0001', message = 'invalid_interview_payload';
  end if;

  v_meta := p_payload -> 'meta';
  if not private.draft_meta_matches_job(v_meta, v_job) then
    raise exception using errcode = 'P0001', message = 'invalid_ai_metadata';
  end if;

  if v_state = 'reopen' then
    perform private.interview_evaluation_open(v_session_id, p_ai_job_id, p_run_generation);
  end if;

  insert into public.answer_evaluations as e (
    user_id, session_id, answer_id, status, result, ai_job_id, run_generation, schema_version, prompt_version,
    provider, model, model_tier, connection_tier, input_hash, career_snapshot_hash, validation_report, usage,
    completed_at)
  values (
    v_uid, v_session_id, p_answer_id, 'succeeded', p_payload -> 'result', p_ai_job_id, p_run_generation,
    (v_meta ->> 'schema_version')::integer, btrim(v_meta ->> 'prompt_version'), v_job.provider,
    btrim(v_meta ->> 'model'), v_job.model_tier, v_job.connection_tier,
    btrim(p_payload -> 'hashes' ->> 'input_hash'), btrim(p_payload -> 'hashes' ->> 'career_snapshot_hash'),
    case when jsonb_typeof(v_meta -> 'validation_report') = 'object' then v_meta -> 'validation_report' end,
    case when jsonb_typeof(v_meta -> 'usage') = 'object' then v_meta -> 'usage' end,
    v_now)
  on conflict (answer_id) do update
     set status = excluded.status, result = excluded.result, ai_job_id = excluded.ai_job_id,
         run_generation = excluded.run_generation, schema_version = excluded.schema_version,
         prompt_version = excluded.prompt_version, provider = excluded.provider, model = excluded.model,
         model_tier = excluded.model_tier, connection_tier = excluded.connection_tier,
         input_hash = excluded.input_hash, career_snapshot_hash = excluded.career_snapshot_hash,
         validation_report = excluded.validation_report, usage = excluded.usage, completed_at = excluded.completed_at
  returning e.id into v_eval_id;

  delete from public.evidence_links el
   where el.owner_type = 'answer_evaluation' and el.owner_id = v_eval_id and el.user_id = v_uid;
  v_count := private.interview_insert_evidence(v_uid, v_session.application_project_id, 'answer_evaluation',
                                               v_eval_id, p_payload -> 'evidence');

  update public.interview_answers a
     set score_status = 'pending_method', score_value = null, score_max = null, score_method_version = null,
         score_rationale = null
   where a.id = p_answer_id;

  return jsonb_build_object('applied', true, 'evaluation_id', v_eval_id, 'answer_id', p_answer_id,
                            'session_id', v_session_id, 'status', 'succeeded', 'evidence_count', v_count,
                            'completed_at', v_now);
end;
$$;

revoke all on function public.save_answer_evaluation(uuid, uuid, integer, jsonb) from public, anon;
grant execute on function public.save_answer_evaluation(uuid, uuid, integer, jsonb) to app_ai_writer;


-- ── fail_answer_evaluation ─────────────────────────────────────────────────
-- AI-06 "답변 일부 평가 실패": that answer -> not_scored (its evaluation row failed), the run goes on.
create or replace function public.fail_answer_evaluation(p_answer_id uuid, p_ai_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.current_uid();
  v_session_id uuid;
  v_session public.interview_sessions%rowtype;
  v_answer public.interview_answers%rowtype;
  v_job public.ai_jobs%rowtype;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  select a.session_id into v_session_id from public.interview_answers a where a.id = p_answer_id and a.user_id = v_uid;
  if not found then
    raise exception using errcode = 'P0001', message = 'interview_answer_not_found';
  end if;
  begin
    v_session := private.interview_lock_session(v_session_id, v_uid);
  exception when sqlstate 'P0001' then
    raise exception using errcode = 'P0001', message = 'interview_answer_not_found';
  end;
  select * into v_answer from public.interview_answers a where a.id = p_answer_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'interview_answer_not_found';
  end if;

  select * into v_job from public.ai_jobs j where j.id = p_ai_job_id and j.user_id = v_uid;
  if not found or v_job.status <> 'running' or v_session.status <> 'evaluating'
     or v_session.evaluation_job_id is distinct from p_ai_job_id or v_answer.status <> 'submitted'
     or exists (select 1 from public.answer_evaluations e where e.answer_id = p_answer_id and e.status = 'succeeded') then
    return false;
  end if;

  insert into public.answer_evaluations as e (user_id, session_id, answer_id, status, ai_job_id, run_generation,
                                              provider, model_tier, connection_tier)
  values (v_uid, v_session_id, p_answer_id, 'failed', p_ai_job_id, v_job.run_generation, v_job.provider,
          v_job.model_tier, v_job.connection_tier)
  on conflict (answer_id) do update
     set status = 'failed', ai_job_id = excluded.ai_job_id, run_generation = excluded.run_generation
   where e.status <> 'succeeded';

  update public.interview_answers a
     set score_status = 'not_scored', score_value = null, score_max = null, score_method_version = null,
         score_rationale = null
   where a.id = p_answer_id;
  return true;
end;
$$;

revoke all on function public.fail_answer_evaluation(uuid, uuid) from public, anon;
grant execute on function public.fail_answer_evaluation(uuid, uuid) to app_ai_writer;


-- ── save_session_feedback (AI-07 저장) ──────────────────────────────────────
create or replace function public.save_session_feedback(
  p_session_id uuid,
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
  v_session public.interview_sessions%rowtype;
  v_job public.ai_jobs%rowtype;
  v_state text;
  v_meta jsonb;
  v_feedback_id uuid;
  v_count integer;
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  v_session := private.interview_lock_session(p_session_id, v_uid);

  select * into v_job from public.ai_jobs j where j.id = p_ai_job_id and j.user_id = v_uid;
  if not found or not private.interview_job_matches(v_job, v_session, 'interview_evaluation') then
    raise exception using errcode = 'P0001', message = 'invalid_ai_job';
  end if;

  v_state := private.interview_evaluation_run_state(v_session, v_job, p_run_generation);
  if v_state = 'stale' then
    return jsonb_build_object('applied', false, 'reason', 'stale_run');
  end if;

  if not private.interview_result_payload_valid(p_payload) then
    raise exception using errcode = 'P0001', message = 'invalid_interview_payload';
  end if;

  v_meta := p_payload -> 'meta';
  if not private.draft_meta_matches_job(v_meta, v_job) then
    raise exception using errcode = 'P0001', message = 'invalid_ai_metadata';
  end if;

  if v_state = 'reopen' then
    perform private.interview_evaluation_open(p_session_id, p_ai_job_id, p_run_generation);
  end if;

  insert into public.session_feedbacks as f (
    user_id, session_id, status, result, ai_job_id, run_generation, schema_version, prompt_version, provider, model,
    model_tier, connection_tier, input_hash, career_snapshot_hash, validation_report, usage, completed_at)
  values (
    v_uid, p_session_id, 'succeeded', p_payload -> 'result', p_ai_job_id, p_run_generation,
    (v_meta ->> 'schema_version')::integer, btrim(v_meta ->> 'prompt_version'), v_job.provider,
    btrim(v_meta ->> 'model'), v_job.model_tier, v_job.connection_tier,
    btrim(p_payload -> 'hashes' ->> 'input_hash'), btrim(p_payload -> 'hashes' ->> 'career_snapshot_hash'),
    case when jsonb_typeof(v_meta -> 'validation_report') = 'object' then v_meta -> 'validation_report' end,
    case when jsonb_typeof(v_meta -> 'usage') = 'object' then v_meta -> 'usage' end,
    v_now)
  on conflict (session_id) do update
     set status = excluded.status, result = excluded.result, ai_job_id = excluded.ai_job_id,
         run_generation = excluded.run_generation, schema_version = excluded.schema_version,
         prompt_version = excluded.prompt_version, provider = excluded.provider, model = excluded.model,
         model_tier = excluded.model_tier, connection_tier = excluded.connection_tier,
         input_hash = excluded.input_hash, career_snapshot_hash = excluded.career_snapshot_hash,
         validation_report = excluded.validation_report, usage = excluded.usage, completed_at = excluded.completed_at
  returning f.id into v_feedback_id;

  delete from public.evidence_links el
   where el.owner_type = 'session_feedback' and el.owner_id = v_feedback_id and el.user_id = v_uid;
  v_count := private.interview_insert_evidence(v_uid, v_session.application_project_id, 'session_feedback',
                                               v_feedback_id, p_payload -> 'evidence');

  return jsonb_build_object('applied', true, 'feedback_id', v_feedback_id, 'session_id', p_session_id,
                            'status', 'succeeded', 'evidence_count', v_count, 'completed_at', v_now);
end;
$$;

revoke all on function public.save_session_feedback(uuid, uuid, integer, jsonb) from public, anon;
grant execute on function public.save_session_feedback(uuid, uuid, integer, jsonb) to app_ai_writer;


-- ── complete_interview_evaluation ──────────────────────────────────────────
-- completed (session score pending_method, score_counted_count) when at least one answer evaluation and the session
-- feedback succeeded; otherwise evaluation_failed (all answers failed, or the feedback alone failed [가정 1]).
create or replace function public.complete_interview_evaluation(
  p_session_id uuid,
  p_ai_job_id uuid,
  p_run_generation integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.current_uid();
  v_session public.interview_sessions%rowtype;
  v_job public.ai_jobs%rowtype;
  v_state text;
  v_succeeded integer;
  v_feedback_ok boolean;
  v_not_scored uuid[];
  v_status text;
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  v_session := private.interview_lock_session(p_session_id, v_uid);

  select * into v_job from public.ai_jobs j where j.id = p_ai_job_id and j.user_id = v_uid;
  if not found or not private.interview_job_matches(v_job, v_session, 'interview_evaluation') then
    raise exception using errcode = 'P0001', message = 'invalid_ai_job';
  end if;

  v_state := private.interview_evaluation_run_state(v_session, v_job, p_run_generation);
  if v_state = 'stale' then
    return jsonb_build_object('applied', false, 'reason', 'stale_run');
  end if;

  v_not_scored := private.interview_mark_unscored(p_session_id);

  select count(*) into v_succeeded
    from public.interview_answers a
   where a.session_id = p_session_id and a.status = 'submitted'
     and exists (select 1 from public.answer_evaluations e where e.answer_id = a.id and e.status = 'succeeded');
  v_feedback_ok := exists (select 1 from public.session_feedbacks f
                            where f.session_id = p_session_id and f.status = 'succeeded');

  if v_succeeded > 0 and v_feedback_ok then
    v_status := 'completed';
    update public.interview_sessions s
       set status = 'completed', completed_at = v_now, score_status = 'pending_method', score_value = null,
           score_max = null, score_method_version = null, score_rationale = null,
           score_counted_count = v_succeeded, evaluation_run_generation = p_run_generation, last_activity_at = v_now
     where s.id = p_session_id;
  else
    v_status := 'evaluation_failed';
    update public.session_feedbacks f set status = 'failed' where f.session_id = p_session_id and f.status = 'pending';
    update public.interview_sessions s
       set status = 'evaluation_failed', completed_at = null, score_status = 'not_scored', score_counted_count = null,
           evaluation_run_generation = p_run_generation, last_activity_at = v_now
     where s.id = p_session_id;
  end if;

  update public.application_projects ap set last_activity_at = v_now where ap.id = v_session.application_project_id;

  return jsonb_build_object(
    'applied', true, 'session_id', p_session_id, 'status', v_status,
    'score_status', case when v_status = 'completed' then 'pending_method' else 'not_scored' end,
    'score_counted_count', v_succeeded, 'not_scored_answer_ids', to_jsonb(v_not_scored),
    'completed_at', case when v_status = 'completed' then v_now end);
end;
$$;

revoke all on function public.complete_interview_evaluation(uuid, uuid, integer) from public, anon;
grant execute on function public.complete_interview_evaluation(uuid, uuid, integer) to app_ai_writer;


-- ── ai_jobs end -> interview generation / evaluation failed (S6 / S7 pattern) ──
-- A job that ends (failed incl. sweep stalled, canceled, or succeeded without complete_*) while the session is still
-- its generating / evaluating run releases it. Project and session are taken SKIP LOCKED (QA-S5-06); readers treat a
-- generating / evaluating session whose job has ended as failed, and the next begin_* cleans it up.
create or replace function private.ai_jobs_release_interview()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('failed', 'canceled', 'succeeded') and old.status is distinct from new.status
     and new.target_type = 'interview_session' then
    if new.job_type = 'interview_questions' then
      perform private.interview_questions_mark_failed(s.id, new.id, true)
         from public.interview_sessions s
        where s.question_job_id = new.id and s.generation_status = 'generating';
    elsif new.job_type = 'interview_evaluation' then
      perform private.interview_evaluation_mark_failed(s.id, new.id, true)
         from public.interview_sessions s
        where s.evaluation_job_id = new.id and s.status = 'evaluating';
    end if;
  end if;
  return null;
end;
$$;

revoke all on function private.ai_jobs_release_interview() from public;

create trigger ai_jobs_release_interview
  after update of status on public.ai_jobs
  for each row execute function private.ai_jobs_release_interview();
