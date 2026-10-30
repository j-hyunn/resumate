-- R1 A22 (DM 2.7 v4.2, A.12; 확정 2026-11-05): set-level AI-05 records on the session.
--   interview_sessions.question_validation_report jsonb null  set validation (composition_relaxed / _unmet, ...)
--   interview_sessions.question_usage             jsonb null  usage total of the set generation
-- Written by complete_interview_questions from p_payload.validation_report / p_payload.usage (each an object, or
-- null / absent -> null). Overwritten on every completed set (incl. "남은 질문 다시 만들기"). Signature unchanged.
-- Users read them through the existing table-level SELECT grant; nobody writes them directly (S8 grants).

alter table public.interview_sessions
  add column question_validation_report jsonb,
  add column question_usage jsonb,
  add constraint interview_sessions_question_validation_report_check
    check (question_validation_report is null or jsonb_typeof(question_validation_report) = 'object'),
  add constraint interview_sessions_question_usage_check
    check (question_usage is null or jsonb_typeof(question_usage) = 'object');

create or replace function public.complete_interview_questions(
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
  v_now timestamptz := now();
  v_insight uuid;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  v_session := private.interview_lock_session(p_session_id, v_uid);

  select * into v_job from public.ai_jobs j where j.id = p_ai_job_id and j.user_id = v_uid;
  if not found or not private.interview_job_matches(v_job, v_session, 'interview_questions') then
    raise exception using errcode = 'P0001', message = 'invalid_ai_job';
  end if;

  if private.interview_questions_run_state(v_session, v_job, p_run_generation) = 'stale' then
    return jsonb_build_object('applied', false, 'reason', 'stale_run');
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or not private.interview_requirement_ids_valid(v_session.application_project_id,
                                                    p_payload -> 'weak_requirement_ids', 50)
     or not (coalesce(jsonb_typeof(p_payload -> 'insight_id'), 'null') = 'null'
             or private.is_uuid_text(p_payload -> 'insight_id'))
     or jsonb_typeof(p_payload -> 'career_snapshot_hash') is distinct from 'string'
     or char_length(btrim(p_payload ->> 'career_snapshot_hash')) not between 1 and 128
     or jsonb_typeof(p_payload -> 'meta') is distinct from 'object'
     -- R1 A22: optional set-level validation report / usage (object, or null / absent).
     or coalesce(jsonb_typeof(p_payload -> 'validation_report'), 'null') not in ('object', 'null')
     or coalesce(jsonb_typeof(p_payload -> 'usage'), 'null') not in ('object', 'null') then
    raise exception using errcode = 'P0001', message = 'invalid_interview_payload';
  end if;

  if jsonb_typeof(p_payload -> 'insight_id') = 'string' then
    select i.id into v_insight from public.insights i
     where i.id = (p_payload ->> 'insight_id')::uuid and i.user_id = v_uid
       and i.application_project_id = v_session.application_project_id and i.status = 'ready';
    if not found then
      raise exception using errcode = 'P0001', message = 'invalid_interview_payload';
    end if;
  end if;

  if not private.draft_meta_matches_job(p_payload -> 'meta', v_job) then
    raise exception using errcode = 'P0001', message = 'invalid_ai_metadata';
  end if;

  if (select count(*) from public.interview_questions q where q.session_id = p_session_id)
     <> v_session.question_count then
    raise exception using errcode = 'P0001', message = 'interview_questions_incomplete';
  end if;

  update public.interview_sessions s
     set generation_status = 'ready',
         question_run_generation = p_run_generation,
         question_provider = v_job.provider,
         question_model = btrim(p_payload -> 'meta' ->> 'model'),
         weak_requirement_ids = private.interview_uuid_array(p_payload -> 'weak_requirement_ids'),
         insight_id = v_insight,
         career_snapshot_hash = btrim(p_payload ->> 'career_snapshot_hash'),
         question_validation_report = nullif(p_payload -> 'validation_report', 'null'::jsonb),
         question_usage = nullif(p_payload -> 'usage', 'null'::jsonb),
         last_activity_at = v_now
   where s.id = p_session_id;

  update public.application_projects ap set last_activity_at = v_now where ap.id = v_session.application_project_id;

  return jsonb_build_object(
    'applied', true, 'session_id', p_session_id, 'generation_status', 'ready',
    'question_count', v_session.question_count, 'question_provider', v_job.provider,
    'question_model', btrim(p_payload -> 'meta' ->> 'model'));
end;
$$;

revoke all on function public.complete_interview_questions(uuid, uuid, integer, jsonb) from public, anon;
grant execute on function public.complete_interview_questions(uuid, uuid, integer, jsonb) to app_ai_writer;
