-- R2: same-row manual retry runs with the ACTIVE provider (A1 change 2026-11-05, A1 세부, R-63, R-64).
-- DM 2.9.1 case (1), DM 2.11.7 path ②.
--
-- retry_ai_job(p_ai_job_id, p_expected_run_generation, p_model, p_model_tier, p_run_meta, p_expected_provider,
--              p_expected_connection_tier) — app_ai_writer only,
-- security definer with an owner check through private.current_uid() (JWT sub).
--   * provider / connection_tier come from profiles.active_ai_provider and that provider's key row (never from
--     the caller). Gate (path ②, the job row stays failed): key_missing / key_invalid / ai_consent_required.
--   * QA-01: p_model was resolved by the caller for p_expected_provider (/ p_expected_connection_tier). If the
--     active connection changed meanwhile (another tab): ai_connection_changed after the gates, row untouched —
--     never a (provider, model) pair that doesn't belong together.
--   * failed -> queued, run_generation + 1, provider / model / model_tier / connection_tier = active values,
--     heartbeat_at = now(), next_run_at = null. The status guard clears the final-failure fields.
--   * restarted (active provider or connection_tier differs from the job's): step_outputs = {_meta: p_run_meta}
--     and every result row the job wrote is reopened now for the new generation (R-63):
--       insight              its failed insights row -> generating
--       interview_questions  the session's saved questions are deleted (answers are blank: answers are editable
--                            only once generation is ready) and generation -> generating   [가정]
--       interview_evaluation the job's answer_evaluations + session_feedbacks -> pending, session -> evaluating
--     Reopened rows carry the new provider meta, so a re-failure shows the new provider.
--     A result set the job already finished (insight ready, questions ready, evaluation completed) is left
--     alone [가정] (only reachable when complete_* succeeded and the job's own completion did not).
--   * same provider and tier: step_outputs kept (stage outputs + _meta.partials), _meta replaced by p_run_meta;
--     failed rows are reopened lazily by begin_* / save_* / complete_* (QA-S6-01 generation checks), as before.
--   * a late completion of the previous generation is stale_run (existing generation checks).
--   * input_hash is cleared when provider or model changes (it includes both, C-6 v4) [가정]; the runner may
--     write a new one (app_ai_writer has update on input_hash).
-- Lock order: application_projects -> interview_sessions -> ai_jobs (the same as the ai_jobs end triggers, which
-- hold ai_jobs and take the project SKIP LOCKED).
-- Errors: 42501 not_authenticated; P0001 ai_job_not_found, ai_job_not_retryable, invalid_ai_metadata,
-- invalid_run_meta, key_missing, key_invalid, ai_consent_required, ai_connection_changed; 23505 when another job on the same target is
-- in flight (ai_jobs_in_flight_target_key).
-- A row that is no longer failed, or whose run_generation is not p_expected_run_generation, is not an error:
-- {requeued: false, status, run_generation}.

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

revoke all on function public.retry_ai_job(uuid, integer, text, text, jsonb, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.retry_ai_job(uuid, integer, text, text, jsonb, text, text) to app_ai_writer;


-- Guard: the provider / tier of a job change only on the same-row retry (failed -> queued, A1 change).
-- A queued / running job keeps the provider it started with (F-AI-03 (2)).
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

  if tg_op = 'UPDATE'
     and (new.provider is distinct from old.provider
          or new.model_tier is distinct from old.model_tier
          or new.connection_tier is distinct from old.connection_tier)
     and not (old.status = 'failed' and new.status = 'queued') then
    raise exception using errcode = 'P0001', message = 'invalid_ai_job_transition',
      detail = 'provider / tier change outside failed -> queued';
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
