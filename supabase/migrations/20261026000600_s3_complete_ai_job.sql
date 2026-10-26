-- S3 (decisions.md 2026-10-26, QA-S3-01/05): finish a job and charge its reservation atomically, so a
-- succeeded job can't keep a reservation forever. Sweep: leftovers of any finished job are released.

-- complete_ai_job (QA-S3-01/05): running -> succeeded (+ finished_at, optional progress) for the run
-- generation p_attempt_count, and charge exactly one reservation, in one transaction.
--   * status must be running and attempt_count = p_attempt_count; else invalid_ai_job_transition.
--     Exception: already succeeded with the same attempt_count = repeat call (idempotent).
--   * p_usage_event_id null: no usage, returns 0.
--   * otherwise the reservation must belong to this user and job (usage_event_not_found);
--     reserved -> charged returns 1, already charged returns 0, released -> invalid_usage_transition.
--   Any error rolls the whole call back (status and usage unchanged).
create or replace function public.complete_ai_job(
  p_job_id uuid,
  p_usage_event_id uuid,
  p_attempt_count integer,
  p_progress jsonb default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.current_uid();
  v_status text;
  v_attempt integer;
  v_usage_status text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  select j.status, j.attempt_count into v_status, v_attempt
    from public.ai_jobs j
   where j.id = p_job_id and j.user_id = v_uid
   for update;

  if v_status is null then
    raise exception using errcode = 'P0001', message = 'ai_job_not_found';
  end if;

  if v_attempt is distinct from p_attempt_count or v_status not in ('running', 'succeeded') then
    raise exception using errcode = 'P0001', message = 'invalid_ai_job_transition',
      detail = v_status || '#' || v_attempt || ' -> succeeded#' || coalesce(p_attempt_count::text, 'null');
  end if;

  if v_status = 'running' then
    update public.ai_jobs
       set status = 'succeeded',
           finished_at = now(),
           progress = coalesce(p_progress, progress)
     where id = p_job_id;
  end if;

  if p_usage_event_id is null then
    return 0;
  end if;

  select e.status into v_usage_status
    from public.usage_events e
   where e.id = p_usage_event_id and e.user_id = v_uid and e.ai_job_id = p_job_id
   for update;

  if v_usage_status is null then
    raise exception using errcode = 'P0001', message = 'usage_event_not_found';
  end if;
  if v_usage_status = 'charged' then
    return 0;
  end if;
  if v_usage_status <> 'reserved' then
    raise exception using errcode = 'P0001', message = 'invalid_usage_transition',
      detail = v_usage_status || ' -> charged';
  end if;

  update public.usage_events set status = 'charged' where id = p_usage_event_id;
  return 1;
end;
$$;

revoke all on function public.complete_ai_job(uuid, uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.complete_ai_job(uuid, uuid, integer, jsonb) to app_ai_writer;

-- Sweep: same as 20261026000500, but leftover reservations of succeeded jobs are released too (QA-S3-01).
create or replace function public.sweep_stalled_ai_jobs(p_stalled_before timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_stalled_before is null then
    raise exception using errcode = 'P0001', message = 'invalid_stalled_before';
  end if;

  with stalled as (
    update public.ai_jobs j
       set status = 'failed',
           error_code = 'stalled',
           finished_at = now()
     where j.status in ('queued', 'running')
       and coalesce(j.heartbeat_at, j.created_at) < p_stalled_before
    returning j.id, j.user_id
  ), released as (
    update public.usage_events e
       set status = 'released'
      from stalled s
     where e.ai_job_id = s.id and e.user_id = s.user_id and e.status = 'reserved'
    returning e.id
  )
  -- Data-modifying CTEs always run to completion, referenced or not.
  select count(*)::integer into v_count from stalled;

  -- Leaked reservations older than the threshold -> released: the job row was never inserted, or the job
  -- is no longer in flight. complete_ai_job charges the winning reservation atomically, so a reserved row
  -- left on a succeeded job is a losing / duplicate one (QA-S3-01) and must not be charged.
  update public.usage_events e
     set status = 'released'
   where e.status = 'reserved'
     and e.ai_job_id is not null
     and e.created_at < p_stalled_before
     and not exists (
       select 1 from public.ai_jobs j
        where j.id = e.ai_job_id and j.user_id = e.user_id
          and j.status in ('queued', 'running'));

  return v_count;
end;
$$;

revoke all on function public.sweep_stalled_ai_jobs(timestamptz) from public, anon, authenticated, app_ai_writer;
grant execute on function public.sweep_stalled_ai_jobs(timestamptz) to service_role;
