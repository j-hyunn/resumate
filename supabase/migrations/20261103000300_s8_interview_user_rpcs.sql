-- S8 user-session interview RPCs (F-P3-01, 03, 04, 07, 15; DM A.12 / A.13, §5, §6.1; S-20, S-33, S-22, S-37).
-- authenticated only, security definer with an auth.uid() owner check (users have no insert / update grant on
-- interview_sessions). No AI call, no key needed.
--   create_interview_session, abandon_interview_session, mark_interview_result_viewed, submit_interview_session,
--   get_interview_question_reveals.
-- Lock order: application_projects -> (submit: interview_answers) -> interview_sessions -> ai_jobs.
-- Errors: 42501 not_authenticated; P0001 application_project_not_found, interview_session_not_found,
-- invalid_interview_type, invalid_question_count, invalid_data_sufficiency, interview_in_progress (detail = session id),
-- session_id_conflict, interview_not_in_progress, interview_already_submitted, interview_not_ready,
-- interview_not_submitted.

-- Return shape of create_interview_session.
create or replace function private.interview_session_create_json(p_session public.interview_sessions, p_created boolean)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'session_id', p_session.id, 'application_project_id', p_session.application_project_id,
    'interview_type', p_session.interview_type, 'question_count', p_session.question_count,
    'data_sufficiency', p_session.data_sufficiency, 'status', p_session.status,
    'generation_status', p_session.generation_status, 'created', p_created);
$$;

revoke all on function private.interview_session_create_json(public.interview_sessions, boolean) from public;

-- Flags the session's queued / running jobs of the given types for cancellation (request_ai_job_cancel semantics).
-- Caller's own jobs only (p_uid is the caller, checked by the calling RPC). Returns the number of jobs flagged.
create or replace function private.interview_cancel_jobs(p_uid uuid, p_session_id uuid, p_job_types text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.ai_jobs j
     set cancel_requested_at = now()
   where j.user_id = p_uid
     and j.target_type = 'interview_session' and j.target_id = p_session_id
     and j.job_type = any (p_job_types)
     and j.status in ('queued', 'running')
     and j.cancel_requested_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function private.interview_cancel_jobs(uuid, uuid, text[]) from public;


-- ── create_interview_session (F-P3-01, S-20 시작하기) ───────────────────────
-- One answering session per application project (A.12 partial unique): an existing in_progress session raises
-- interview_in_progress with detail = its id (API 409 + details.sessionId, "이어 쓰기"). p_session_id (client uuid,
-- optional) makes retries idempotent. data_sufficiency is the server's readiness judgement (C-1).
create or replace function public.create_interview_session(
  p_application_project_id uuid,
  p_interview_type text,
  p_question_count integer,
  p_data_sufficiency text,
  p_session_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
      if v_session.user_id <> v_uid or v_session.application_project_id <> p_application_project_id then
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
$$;

revoke all on function public.create_interview_session(uuid, text, integer, text, uuid) from public, anon;
grant execute on function public.create_interview_session(uuid, text, integer, text, uuid) to authenticated;


-- ── abandon_interview_session (S-20 / S-33 그만두기) ────────────────────────
-- in_progress only (generating, generation failed or answering). Its running question generation is asked to stop;
-- the ai_jobs end trigger then marks generation_status failed.
create or replace function public.abandon_interview_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_project_id uuid;
  v_session public.interview_sessions%rowtype;
  v_now timestamptz := now();
  v_canceled integer;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  select s.application_project_id into v_project_id
    from public.interview_sessions s where s.id = p_session_id and s.user_id = v_uid;
  perform 1 from public.application_projects ap where ap.id = v_project_id for update;
  select * into v_session from public.interview_sessions s
   where s.id = p_session_id and s.user_id = v_uid
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'interview_session_not_found';
  end if;

  if v_session.status = 'abandoned' then
    return jsonb_build_object('session_id', v_session.id, 'status', v_session.status,
                              'abandoned_at', v_session.abandoned_at, 'changed', false, 'cancel_requested', 0);
  end if;
  if v_session.status <> 'in_progress' then
    raise exception using errcode = 'P0001', message = 'interview_not_in_progress';
  end if;

  update public.interview_sessions s
     set status = 'abandoned', abandoned_at = v_now, last_activity_at = v_now
   where s.id = p_session_id;

  v_canceled := private.interview_cancel_jobs(v_uid, p_session_id, array['interview_questions']);

  return jsonb_build_object('session_id', p_session_id, 'status', 'abandoned', 'abandoned_at', v_now,
                            'changed', true, 'cancel_requested', v_canceled);
end;
$$;

revoke all on function public.abandon_interview_session(uuid) from public, anon;
grant execute on function public.abandon_interview_session(uuid) to authenticated;


-- ── mark_interview_result_viewed (F-P3-07 새 결과 표식) ──────────────────────
-- Records the first view of a completed result. Anything else is a no-op (changed: false), not an error.
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
   where s.id = p_session_id and s.user_id = v_uid and s.status = 'completed' and s.result_viewed_at is null
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

revoke all on function public.mark_interview_result_viewed(uuid) from public, anon;
grant execute on function public.mark_interview_result_viewed(uuid) to authenticated;


-- ── submit_interview_session (F-P3-03, AI 4.0 단계 4, D-16 (b)) ──────────────
-- Once, in one transaction: blank answers -> unanswered (score 'unanswered'), others -> submitted; session
-- submitted_at / counts / evaluating. No answered question -> completed + session score not_scored right away (AI-07
-- is not called, no evaluation job). Returns the answered answer ids for the evaluation job.
-- Lock order: project -> answers -> session (the answer autosave trigger goes answer -> session).
create or replace function public.submit_interview_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_project_id uuid;
  v_session public.interview_sessions%rowtype;
  v_now timestamptz := now();
  v_answered uuid[];
  v_unanswered integer;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  select s.application_project_id into v_project_id
    from public.interview_sessions s where s.id = p_session_id and s.user_id = v_uid;
  perform 1 from public.application_projects ap where ap.id = v_project_id for update;
  perform 1 from public.interview_answers a where a.session_id = p_session_id and a.user_id = v_uid
   order by a.id for update;
  select * into v_session from public.interview_sessions s
   where s.id = p_session_id and s.user_id = v_uid
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'interview_session_not_found';
  end if;

  if v_session.submitted_at is not null then
    raise exception using errcode = 'P0001', message = 'interview_already_submitted';
  end if;
  if v_session.status <> 'in_progress' then
    raise exception using errcode = 'P0001', message = 'interview_not_in_progress';
  end if;
  if v_session.generation_status <> 'ready' then
    raise exception using errcode = 'P0001', message = 'interview_not_ready';
  end if;

  update public.interview_answers a
     set status = case when a.answer_text ~ '\S' then 'submitted' else 'unanswered' end,
         score_status = case when a.answer_text ~ '\S' then null else 'unanswered' end
   where a.session_id = p_session_id;

  select coalesce(array_agg(a.id order by q.sequence) filter (where a.status = 'submitted'), '{}'),
         count(*) filter (where a.status = 'unanswered')
    into v_answered, v_unanswered
    from public.interview_answers a
    join public.interview_questions q on q.id = a.question_id
   where a.session_id = p_session_id;

  update public.interview_sessions s
     set submitted_at = v_now,
         answered_count = cardinality(v_answered),
         unanswered_count = v_unanswered,
         last_activity_at = v_now,
         status = case when cardinality(v_answered) = 0 then 'completed' else 'evaluating' end,
         completed_at = case when cardinality(v_answered) = 0 then v_now end,
         score_status = case when cardinality(v_answered) = 0 then 'not_scored' end,
         score_counted_count = case when cardinality(v_answered) = 0 then 0 end
   where s.id = p_session_id;

  update public.application_projects ap set last_activity_at = v_now where ap.id = v_session.application_project_id;

  return jsonb_build_object(
    'session_id', p_session_id,
    'status', case when cardinality(v_answered) = 0 then 'completed' else 'evaluating' end,
    'submitted_at', v_now,
    'answered_count', cardinality(v_answered),
    'unanswered_count', v_unanswered,
    'answered_answer_ids', to_jsonb(v_answered),
    'evaluation_needed', cardinality(v_answered) > 0);
end;
$$;

revoke all on function public.submit_interview_session(uuid) from public, anon;
grant execute on function public.submit_interview_session(uuid) to authenticated;


-- ── get_interview_question_reveals (S-22, AI-05 "intent는 결과 화면에서 공개") ─────
-- intent after submission only. good_answer_signals never leaves the server (no user grant, not returned here).
create or replace function public.get_interview_question_reveals(p_session_id uuid)
returns table (question_id uuid, sequence integer, intent text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_submitted timestamptz;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  select s.submitted_at into v_submitted from public.interview_sessions s
   where s.id = p_session_id and s.user_id = v_uid;
  if not found then
    raise exception using errcode = 'P0001', message = 'interview_session_not_found';
  end if;
  if v_submitted is null then
    raise exception using errcode = 'P0001', message = 'interview_not_submitted';
  end if;

  return query
    select q.id, q.sequence, q.intent
      from public.interview_questions q
     where q.session_id = p_session_id and q.user_id = v_uid
     order by q.sequence;
end;
$$;

revoke all on function public.get_interview_question_reveals(uuid) from public, anon;
grant execute on function public.get_interview_question_reveals(uuid) to authenticated;
