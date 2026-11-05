-- R11 OD-I6 (DM v4.11 2.7.2 읽기 전용 가드, 11.6 #4): a session whose application project was deleted
-- (application_project_id is null) is read-only.
--   * private.interview_grading_decision: always 'none' for it (menus / buttons hidden).
--   * begin_interview_evaluation: interview_session_read_only (409) before anything else about the job.
--   * create_interview_session: always sets application_project_id (unchanged); a client session id that names a
--     detached session is session_id_conflict (was matched through a null comparison and returned as the replay).
--     There is no "copy from session" create RPC yet (F-P3-08 source_session_id is Should, not implemented).
--   * save_answer_evaluation / complete_interview_evaluation get the same guard in the d14.v1 migration.
-- mark_interview_result_viewed and the user's delete stay allowed. Answer edits are already refused by RLS
-- (completed session).
-- New error: P0001 interview_session_read_only.

CREATE OR REPLACE FUNCTION private.interview_grading_decision(p_session_id uuid, p_ignore_job_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- OD-I6: a kept session of a deleted application project is read-only.
  if v_session.application_project_id is null then
    v_decision := 'none';
    v_cause := null;
  end if;

  return jsonb_build_object(
    'status', v_status, 'decision', v_decision, 'cause', v_cause,
    'regrade_target_count', v_targets, 'succeeded_count', v_succeeded,
    'answer_input_cause', v_answer_cause, 'summary_error_code', v_summary_code);
end;
$function$;

revoke all on function private.interview_grading_decision(uuid, uuid) from public;

CREATE OR REPLACE FUNCTION public.begin_interview_evaluation(p_session_id uuid, p_ai_job_id uuid, p_provider text, p_model text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- OD-I6: before the job / connection checks.
  if v_session.application_project_id is null then
    raise exception using errcode = 'P0001', message = 'interview_session_read_only';
  end if;

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
$function$;

revoke all on function public.begin_interview_evaluation(uuid, uuid, text, text) from public, anon;
grant execute on function public.begin_interview_evaluation(uuid, uuid, text, text) to app_ai_writer;

CREATE OR REPLACE FUNCTION public.create_interview_session(p_application_project_id uuid, p_interview_type text, p_question_count integer, p_data_sufficiency text, p_session_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_session public.interview_sessions%rowtype;
  v_count integer := coalesce(p_question_count, 5);
  v_existing uuid;
  v_now timestamptz := now();
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

  if p_session_id is not null then
    select * into v_session from public.interview_sessions s where s.id = p_session_id;
    if found then
      if v_session.user_id <> v_uid
         or v_session.application_project_id is distinct from p_application_project_id then
        raise exception using errcode = 'P0001', message = 'session_id_conflict';
      end if;
      return private.interview_session_create_json(v_session, false);
    end if;
  end if;

  if p_interview_type is null or p_interview_type not in ('job', 'culture_fit') then
    raise exception using errcode = 'P0001', message = 'invalid_interview_type';
  end if;
  if v_count not in (3, 5, 7) then
    raise exception using errcode = 'P0001', message = 'invalid_question_count';
  end if;
  if p_data_sufficiency is null or p_data_sufficiency not in ('ok', 'thin', 'none') then
    raise exception using errcode = 'P0001', message = 'invalid_data_sufficiency';
  end if;

  select s.id into v_existing from public.interview_sessions s
   where s.application_project_id = p_application_project_id and s.status = 'in_progress';
  if found then
    raise exception using errcode = 'P0001', message = 'interview_in_progress', detail = v_existing::text;
  end if;

  insert into public.interview_sessions (id, user_id, application_project_id, interview_type, question_count,
                                         data_sufficiency, status, generation_status, last_activity_at)
  values (coalesce(p_session_id, gen_random_uuid()), v_uid, p_application_project_id, p_interview_type, v_count,
          p_data_sufficiency, 'in_progress', 'generating', v_now)
  returning * into v_session;

  update public.application_projects ap set last_activity_at = v_now where ap.id = p_application_project_id;

  return private.interview_session_create_json(v_session, true);
end;
$function$;

revoke all on function public.create_interview_session(uuid, text, integer, text, uuid) from public, anon;
grant execute on function public.create_interview_session(uuid, text, integer, text, uuid) to authenticated;
