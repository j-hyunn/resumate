-- W0 Q53-3, Q53-5, Q53-10 (DM 2.7.1 decision table): the one grading decision. The same helper answers
-- begin_interview_evaluation, retry_ai_job, mark_interview_result_viewed and, through get_interview_grading_decisions,
-- the 다시 채점 route and the session reads. UI twin: src/lib/data/interview-grading.ts.
--
--   status             | condition                                            | decision
--   evaluation_failed  | targets >= 1                                         | regrade
--   evaluation_failed  | targets 0, succeeded >= 1, summary not input-caused  | resummarize
--   evaluation_failed  | targets 0, succeeded >= 1, summary input-caused      | input_only
--   evaluation_failed  | targets 0, succeeded 0                               | input_only
--   completed          | targets >= 1                                         | regrade
--   completed          | targets 0, input-caused answers >= 1                 | input_only
--   otherwise          |                                                      | none
-- target = a submitted answer without a succeeded evaluation that is not input-caused (pending, no row and a failure
-- with a null error_code all count). Input-caused = failed + input_too_long | safety_blocked.

-- Is this answer's evaluation still worth running? (The caller checks that the answer is submitted.)
create or replace function private.interview_answer_is_regrade_target(p_answer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.answer_evaluations e
                      where e.answer_id = p_answer_id
                        and (e.status = 'succeeded'
                             or (e.status = 'failed' and e.error_code in ('input_too_long', 'safety_blocked'))));
$$;

revoke all on function private.interview_answer_is_regrade_target(uuid) from public;

-- Returns {status, decision, cause, regrade_target_count, succeeded_count, answer_input_cause, summary_error_code}.
-- `status` is the effective status of the reads (resolveSessionRun): `evaluating` without a live evaluation job is
-- evaluation_failed. p_ignore_job_id: a job that doesn't count as live (begin_interview_evaluation's own new job).
-- summary_error_code = the evaluation job's error_code; a pruned job -> null -> not input-caused (DM 2.7.1).
-- Null for an unknown session. Callers check ownership.
create or replace function private.interview_grading_decision(p_session_id uuid, p_ignore_job_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.interview_sessions%rowtype;
  v_status text;
  v_targets integer;
  v_succeeded integer;
  v_answer_cause text;
  v_summary_code text;
  v_decision text;
  v_cause text;
begin
  select * into v_session from public.interview_sessions s where s.id = p_session_id;
  if not found then
    return null;
  end if;

  v_status := v_session.status;
  if v_status = 'evaluating'
     and not exists (select 1 from public.ai_jobs j
                      where j.target_type = 'interview_session' and j.target_id = p_session_id
                        and j.job_type = 'interview_evaluation' and j.status in ('queued', 'running')
                        and j.id is distinct from p_ignore_job_id) then
    v_status := 'evaluation_failed';
  end if;

  select count(*) filter (where private.interview_answer_is_regrade_target(a.id)),
         count(*) filter (where exists (select 1 from public.answer_evaluations e
                                         where e.answer_id = a.id and e.status = 'succeeded'))
    into v_targets, v_succeeded
    from public.interview_answers a
   where a.session_id = p_session_id and a.status = 'submitted';

  select e.error_code into v_answer_cause
    from public.interview_answers a
    join public.interview_questions q on q.id = a.question_id
    join public.answer_evaluations e on e.answer_id = a.id
   where a.session_id = p_session_id and a.status = 'submitted'
     and e.status = 'failed' and e.error_code in ('input_too_long', 'safety_blocked')
   order by q.sequence
   limit 1;

  if v_status = 'evaluation_failed' then
    select j.error_code into v_summary_code from public.ai_jobs j where j.id = v_session.evaluation_job_id;
  end if;

  if v_status not in ('evaluation_failed', 'completed') then
    v_decision := 'none';
  elsif v_targets > 0 then
    v_decision := 'regrade';
  elsif v_status = 'completed' then
    if v_answer_cause is not null then
      v_decision := 'input_only';
      v_cause := v_answer_cause;
    else
      v_decision := 'none';
    end if;
  elsif v_succeeded > 0 then
    if v_summary_code in ('input_too_long', 'safety_blocked') then
      v_decision := 'input_only';
      v_cause := v_summary_code;
    else
      v_decision := 'resummarize';
    end if;
  else
    v_decision := 'input_only';
    v_cause := v_answer_cause;
  end if;

  return jsonb_build_object(
    'status', v_status, 'decision', v_decision, 'cause', v_cause,
    'regrade_target_count', v_targets, 'succeeded_count', v_succeeded,
    'answer_input_cause', v_answer_cause, 'summary_error_code', v_summary_code);
end;
$$;

revoke all on function private.interview_grading_decision(uuid, uuid) from public;

-- The decision for the caller's sessions (one row per owned, existing id; others are simply absent). Reads and the
-- route ask here instead of re-deriving the table.
create or replace function public.get_interview_grading_decisions(p_session_ids uuid[])
returns table (
  session_id uuid,
  status text,
  decision text,
  cause text,
  regrade_target_count integer,
  succeeded_count integer,
  answer_input_cause text,
  summary_error_code text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.current_uid();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  return query
    select s.id, d ->> 'status', d ->> 'decision', d ->> 'cause', (d ->> 'regrade_target_count')::integer,
           (d ->> 'succeeded_count')::integer, d ->> 'answer_input_cause', d ->> 'summary_error_code'
      from public.interview_sessions s
     cross join lateral private.interview_grading_decision(s.id) d
     where s.id = any (coalesce(p_session_ids, '{}')) and s.user_id = v_uid;
end;
$$;

revoke all on function public.get_interview_grading_decisions(uuid[]) from public, anon, service_role;
grant execute on function public.get_interview_grading_decisions(uuid[]) to authenticated, app_ai_writer;


-- begin's return shape: input-caused answers are out of answers_to_evaluate (they would fail the same way).
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
         and private.interview_answer_is_regrade_target(a.id)), '[]'::jsonb),
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


-- A new job on an ended session goes by the decision table: regrade / resummarize start, input_only ->
-- interview_evaluation_input_only (detail = cause), none -> interview_evaluation_not_needed. The first run after
-- submit (evaluating, no job yet) and the same-job retry path are unchanged.
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
  v_decision jsonb;
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
  else
    v_reopened := true;
  end if;

  if v_reopened then
    v_decision := private.interview_grading_decision(p_session_id, p_ai_job_id);
    if v_decision ->> 'decision' = 'input_only' then
      raise exception using errcode = 'P0001', message = 'interview_evaluation_input_only',
        detail = coalesce(v_decision ->> 'cause', '');
    elsif v_decision ->> 'decision' = 'none' then
      raise exception using errcode = 'P0001', message = 'interview_evaluation_not_needed';
    end if;
  end if;

  perform private.interview_evaluation_open(p_session_id, p_ai_job_id, v_job.run_generation);
  update public.interview_sessions s
     set evaluation_provider = v_job.provider, evaluation_model = btrim(p_model)
   where s.id = p_session_id;

  return private.interview_evaluation_begin_json(p_session_id, v_reopened);
end;
$$;


-- Q53-10: completed, or evaluation_failed with nothing left to do (input_only). Anything else stays changed: false.
create or replace function public.mark_interview_result_viewed(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_viewed timestamptz;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  update public.interview_sessions s
     set result_viewed_at = now()
   where s.id = p_session_id and s.user_id = v_uid and s.result_viewed_at is null
     and (s.status = 'completed'
          or (s.status = 'evaluation_failed'
              and private.interview_grading_decision(s.id) ->> 'decision' = 'input_only'))
  returning s.result_viewed_at into v_viewed;
  if found then
    return jsonb_build_object('session_id', p_session_id, 'result_viewed_at', v_viewed, 'changed', true);
  end if;

  select s.result_viewed_at into v_viewed from public.interview_sessions s
   where s.id = p_session_id and s.user_id = v_uid;
  if not found then
    raise exception using errcode = 'P0001', message = 'interview_session_not_found';
  end if;
  return jsonb_build_object('session_id', p_session_id, 'result_viewed_at', v_viewed, 'changed', false);
end;
$$;


-- Same-row retry: everything as in r2 except the Q53-5 refusal.
create or replace function public.retry_ai_job(
  p_ai_job_id uuid,
  p_expected_run_generation integer,
  p_model text,
  p_model_tier text,
  p_run_meta jsonb,
  p_expected_provider text,
  p_expected_connection_tier text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.current_uid();
  v_job public.ai_jobs%rowtype;
  v_project_id uuid;
  v_session public.interview_sessions%rowtype;
  v_active text;
  v_key_status text;
  v_key_tier text;
  v_restarted boolean;
  v_partials jsonb;
  v_meta jsonb;
  v_gen integer;
  v_model text := btrim(p_model);
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  -- Unlocked read to find the target, then locks in the standard order.
  select * into v_job from public.ai_jobs j where j.id = p_ai_job_id and j.user_id = v_uid;
  if not found then
    raise exception using errcode = 'P0001', message = 'ai_job_not_found';
  end if;

  if v_job.application_project_id is not null then
    select ap.id into v_project_id from public.application_projects ap
     where ap.id = v_job.application_project_id and ap.user_id = v_uid
       for update;
  end if;
  if v_job.target_type = 'interview_session' and v_job.target_id is not null then
    select * into v_session from public.interview_sessions s
     where s.id = v_job.target_id and s.user_id = v_uid
       for update;
  end if;

  select * into v_job from public.ai_jobs j where j.id = p_ai_job_id and j.user_id = v_uid for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ai_job_not_found';
  end if;

  -- Somebody else already moved the row (another retry, purge race): report, don't raise.
  if v_job.status <> 'failed' or v_job.run_generation is distinct from p_expected_run_generation then
    return jsonb_build_object('requeued', false, 'status', v_job.status, 'run_generation', v_job.run_generation);
  end if;

  -- DM 2.9.1: only the async types use the same-row retry; input errors are not retryable (AI C-11).
  if v_job.job_type not in ('insight', 'interview_questions', 'interview_evaluation')
     or v_job.error_code is null or v_job.error_category = 'input'
     or (v_job.job_type = 'insight' and v_project_id is null)
     or (v_job.job_type <> 'insight' and v_session.id is null) then
    raise exception using errcode = 'P0001', message = 'ai_job_not_retryable';
  end if;

  -- Q53-5 (DM 2.7.1, 2.9.1): nothing to re-grade -> new-job path only, whatever the provider, so that R-63 doesn't
  -- reopen saved answer evaluations for a summary-only redo. Before the connection gates (path ② order).
  if v_job.job_type = 'interview_evaluation'
     and (private.interview_grading_decision(v_session.id) ->> 'regrade_target_count')::integer = 0 then
    raise exception using errcode = 'P0001', message = 'ai_job_not_retryable';
  end if;

  if v_model is null or char_length(v_model) not between 1 and 200
     or p_model_tier is null or p_model_tier not in ('light', 'default', 'heavy')
     or p_expected_provider is null or p_expected_provider not in ('openai', 'gemini', 'anthropic')
     or (p_expected_connection_tier is not null and p_expected_connection_tier not in ('free', 'paid')) then
    raise exception using errcode = 'P0001', message = 'invalid_ai_metadata';
  end if;
  if p_run_meta is null or jsonb_typeof(p_run_meta) <> 'object' then
    raise exception using errcode = 'P0001', message = 'invalid_run_meta';
  end if;

  -- DM 2.11.7 path ②: the ACTIVE provider and its key's current tier (A1 change). Same order as
  -- check_ai_run_allowed. Never reads the ciphertext columns.
  select p.active_ai_provider into v_active from public.profiles p where p.id = v_uid;
  if v_active is not null then
    select k.status, k.connection_tier into v_key_status, v_key_tier
      from public.ai_provider_keys k where k.user_id = v_uid and k.provider = v_active;
  end if;
  if v_key_status is null then
    raise exception using errcode = 'P0001', message = 'key_missing';
  end if;
  if v_key_status = 'invalid' then
    raise exception using errcode = 'P0001', message = 'key_invalid';
  end if;
  if not private.ai_consent_allows_run(v_uid, v_active, v_key_tier) then
    raise exception using errcode = 'P0001', message = 'ai_consent_required';
  end if;

  -- QA-01: the model id was chosen for the connection the caller saw.
  if v_active is distinct from p_expected_provider
     or (p_expected_connection_tier is not null and v_key_tier is distinct from p_expected_connection_tier) then
    raise exception using errcode = 'P0001', message = 'ai_connection_changed',
      detail = v_active || '/' || v_key_tier;
  end if;

  v_restarted := v_active is distinct from v_job.provider or v_key_tier is distinct from v_job.connection_tier;
  v_gen := v_job.run_generation + 1;

  if v_restarted then
    v_meta := jsonb_build_object('_meta', p_run_meta);
  else
    v_partials := v_job.step_outputs -> '_meta' -> 'partials';
    v_meta := (v_job.step_outputs - '_meta')
              || jsonb_build_object('_meta',
                   case when jsonb_typeof(v_partials) = 'object' and v_partials <> '{}'::jsonb
                        then p_run_meta || jsonb_build_object('partials', v_partials)
                        else p_run_meta end);
  end if;

  -- 23505 (ai_jobs_in_flight_target_key) propagates; the whole call rolls back.
  update public.ai_jobs j
     set status = 'queued',
         run_generation = v_gen,
         provider = v_active,
         connection_tier = v_key_tier,
         model = v_model,
         model_tier = p_model_tier,
         input_hash = case when v_active is distinct from v_job.provider or v_model is distinct from v_job.model
                           then null else j.input_hash end,
         heartbeat_at = now(),
         next_run_at = null,
         step_outputs = v_meta
   where j.id = p_ai_job_id;

  -- R-63: a run with another provider / tier redoes everything the job stored.
  if v_restarted then
    if v_job.job_type = 'insight' then
      update public.insights i
         set status = 'generating', run_generation = v_gen,
             provider = v_active, model_tier = p_model_tier, connection_tier = v_key_tier
       where i.ai_job_id = p_ai_job_id and i.user_id = v_uid and i.status = 'failed';

    elsif v_job.job_type = 'interview_questions' then
      if v_session.question_job_id = p_ai_job_id and v_session.generation_status <> 'ready'
         and v_session.status = 'in_progress' then
        -- Answers cascade (blank drafts: editable only after generation is ready); evidence by the owner trigger.
        delete from public.interview_questions q
         where q.session_id = v_session.id
           and not exists (select 1 from public.interview_answers a
                            where a.question_id = q.id and (a.status <> 'draft' or a.answer_text ~ '\S'));
        update public.interview_sessions s
           set generation_status = 'generating', question_run_generation = v_gen
         where s.id = v_session.id;
      end if;

    else -- interview_evaluation
      if v_session.evaluation_job_id = p_ai_job_id and v_session.status in ('evaluation_failed', 'evaluating') then
        update public.answer_evaluations e
           set status = 'pending', run_generation = v_gen,
               provider = v_active, model_tier = p_model_tier, connection_tier = v_key_tier
         where e.session_id = v_session.id and e.ai_job_id = p_ai_job_id;
        perform private.interview_evaluation_open(v_session.id, p_ai_job_id, v_gen);
        update public.session_feedbacks f
           set provider = v_active, model_tier = p_model_tier, connection_tier = v_key_tier, run_generation = v_gen
         where f.session_id = v_session.id and f.ai_job_id = p_ai_job_id;
        -- begin_interview_evaluation's same-job path does not touch these while the session is evaluating.
        update public.interview_sessions s
           set evaluation_provider = v_active, evaluation_model = v_model
         where s.id = v_session.id;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'requeued', true,
    'restarted', v_restarted,
    'status', 'queued',
    'provider', v_active,
    'model', v_model,
    'model_tier', p_model_tier,
    'connection_tier', v_key_tier,
    'run_generation', v_gen);
end;
$$;

