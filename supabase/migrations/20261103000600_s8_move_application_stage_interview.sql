-- S8 (C-14, F-ST-04, DM §2.6 step 5): move_application_stage fills interview_prompt.in_progress_session_id with the
-- project's answering session (any interview type, at most one by the A.12 partial unique) and adds
-- interview_prompt.in_progress_session {session_id, interview_type, answered_count, question_count, generation_status,
-- last_activity_at} | null for the board popup ("이어서 쓰기"). Same signature, grants and other behaviour as S5.
create or replace function public.move_application_stage(
  p_application_project_id uuid,
  p_to_stage text,
  p_outcome text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_project public.application_projects%rowtype;
  v_new_outcome text;
  v_now timestamptz := now();
  v_in_progress jsonb;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_to_stage is null or p_to_stage not in (
       'before_apply', 'document', 'assignment', 'job_interview', 'culture_fit_interview', 'closed') then
    raise exception using errcode = 'P0001', message = 'invalid_stage';
  end if;
  if p_outcome is not null and (p_outcome not in ('passed', 'failed') or p_to_stage <> 'closed') then
    raise exception using errcode = 'P0001', message = 'invalid_outcome';
  end if;

  select * into v_project from public.application_projects ap
   where ap.id = p_application_project_id and ap.user_id = v_uid
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'application_project_not_found';
  end if;

  if v_project.stage = p_to_stage then
    return jsonb_build_object(
      'stage', v_project.stage, 'stage_outcome', v_project.stage_outcome,
      'stage_changed_at', v_project.stage_changed_at, 'changed', false, 'interview_prompt', null);
  end if;

  -- Entering closed: only the given outcome (null = 결과 미기록). Leaving closed: cleared. Other moves: null.
  v_new_outcome := case when p_to_stage = 'closed' then p_outcome end;

  update public.application_projects ap
     set stage = p_to_stage, stage_outcome = v_new_outcome,
         stage_changed_at = v_now, last_activity_at = v_now
   where ap.id = p_application_project_id;

  insert into public.application_stage_events (user_id, application_project_id, event_type,
                                               from_stage, to_stage, from_outcome, to_outcome)
  values (v_uid, p_application_project_id, 'stage_changed',
          v_project.stage, p_to_stage, v_project.stage_outcome, v_new_outcome);

  if p_to_stage in ('job_interview', 'culture_fit_interview') then
    select jsonb_build_object('session_id', s.id, 'interview_type', s.interview_type,
                              'answered_count', s.answered_count, 'question_count', s.question_count,
                              'generation_status', s.generation_status, 'last_activity_at', s.last_activity_at)
      into v_in_progress
      from public.interview_sessions s
     where s.application_project_id = p_application_project_id and s.user_id = v_uid and s.status = 'in_progress';
  end if;

  return jsonb_build_object(
    'stage', p_to_stage, 'stage_outcome', v_new_outcome, 'stage_changed_at', v_now, 'changed', true,
    'interview_prompt', case p_to_stage
      when 'job_interview' then jsonb_build_object('interview_type', 'job',
        'in_progress_session_id', v_in_progress -> 'session_id', 'in_progress_session', v_in_progress)
      when 'culture_fit_interview' then jsonb_build_object('interview_type', 'culture_fit',
        'in_progress_session_id', v_in_progress -> 'session_id', 'in_progress_session', v_in_progress)
    end);
end;
$$;

revoke all on function public.move_application_stage(uuid, text, text) from public, anon;
grant execute on function public.move_application_stage(uuid, text, text) to authenticated;

