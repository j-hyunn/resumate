-- W0 Q53-3 (DM 2.7.1, A.13): why an answer's evaluation failed. The per-answer cause otherwise lives only in
-- ai_jobs.step_outputs (no user select, pruned after 90 days). Null = no cause known or not failed; existing rows stay
-- null and count as re-gradable (no backfill).

alter table public.answer_evaluations
  add column error_code text,
  add constraint answer_evaluations_error_code_check check (error_code in (
    'rate_limited', 'daily_quota_exhausted', 'billing_required', 'key_invalid', 'model_not_available',
    'provider_unavailable', 'input_too_long', 'safety_blocked', 'key_missing', 'schema_invalid', 'timeout', 'stalled',
    'canceled', 'insufficient_data', 'not_a_jd')),
  add constraint answer_evaluations_error_code_failed_check check (error_code is null or status = 'failed');

-- save_answer_evaluation (success) and retry_ai_job (R-63 reopen to pending) clear the cause here, so every path that
-- leaves `failed` does it without each RPC having to name the column.
create or replace function private.answer_evaluations_clear_error_code()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'failed' then
    new.error_code := null;
  end if;
  return new;
end;
$$;

revoke all on function private.answer_evaluations_clear_error_code() from public;

create trigger answer_evaluations_clear_error_code
  before update on public.answer_evaluations
  for each row execute function private.answer_evaluations_clear_error_code();


-- p_error_code null = no known cause (re-gradable). Unknown code -> invalid_error_code.
drop function public.fail_answer_evaluation(uuid, uuid);

create or replace function public.fail_answer_evaluation(
  p_answer_id uuid,
  p_ai_job_id uuid,
  p_error_code text default null
)
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
  if p_error_code is not null and p_error_code not in (
       'rate_limited', 'daily_quota_exhausted', 'billing_required', 'key_invalid', 'model_not_available',
       'provider_unavailable', 'input_too_long', 'safety_blocked', 'key_missing', 'schema_invalid', 'timeout',
       'stalled', 'canceled', 'insufficient_data', 'not_a_jd') then
    raise exception using errcode = 'P0001', message = 'invalid_error_code';
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

  insert into public.answer_evaluations as e (user_id, session_id, answer_id, status, error_code, ai_job_id,
                                              run_generation, provider, model_tier, connection_tier)
  values (v_uid, v_session_id, p_answer_id, 'failed', p_error_code, p_ai_job_id, v_job.run_generation, v_job.provider,
          v_job.model_tier, v_job.connection_tier)
  on conflict (answer_id) do update
     set status = 'failed', error_code = excluded.error_code, ai_job_id = excluded.ai_job_id,
         run_generation = excluded.run_generation
   where e.status <> 'succeeded';

  update public.interview_answers a
     set score_status = 'not_scored', score_value = null, score_max = null, score_method_version = null,
         score_rationale = null
   where a.id = p_answer_id;
  return true;
end;
$$;

revoke all on function public.fail_answer_evaluation(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.fail_answer_evaluation(uuid, uuid, text) to app_ai_writer;
