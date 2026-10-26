-- S3 ai_jobs RPCs (AI C-6): user cancel request, stalled-job sweep for the cron route.

-- request_ai_job_cancel: the user has no update grant on ai_jobs, so this is security definer with an
-- ownership check. Sets only cancel_requested_at (first request wins); the runner observes it and
-- moves the job to canceled. Terminal jobs are returned unchanged (idempotent, no error).
create or replace function public.request_ai_job_cancel(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_job public.ai_jobs%rowtype;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  select * into v_job from public.ai_jobs
   where id = p_job_id and user_id = v_uid
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ai_job_not_found';
  end if;

  if v_job.status in ('queued', 'running') and v_job.cancel_requested_at is null then
    update public.ai_jobs set cancel_requested_at = now()
     where id = p_job_id
     returning * into v_job;
  end if;

  return jsonb_build_object(
    'job_id', v_job.id,
    'status', v_job.status,
    'cancel_requested_at', v_job.cancel_requested_at);
end;
$$;

revoke all on function public.request_ai_job_cancel(uuid) from public, anon, app_ai_writer;
grant execute on function public.request_ai_job_cancel(uuid) to authenticated;

-- sweep_stalled_ai_jobs (cron, all users): queued/running jobs whose coalesce(heartbeat_at, created_at)
-- is older than p_stalled_before -> failed / stalled, and their reserved usage -> released, in one
-- transaction. Also releases leaked reservations (see below). Returns the number of jobs failed.
-- service_role only.
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

  -- Leaked reservations (no exit path settled them): the job row was never inserted (the runner
  -- reserves first) or already ended failed / canceled. Same age threshold. Succeeded jobs are left
  -- alone (they should have been charged; not this sweep's call).
  update public.usage_events e
     set status = 'released'
   where e.status = 'reserved'
     and e.ai_job_id is not null
     and e.created_at < p_stalled_before
     and not exists (
       select 1 from public.ai_jobs j
        where j.id = e.ai_job_id and j.user_id = e.user_id
          and j.status in ('queued', 'running', 'succeeded'));

  return v_count;
end;
$$;

revoke all on function public.sweep_stalled_ai_jobs(timestamptz) from public, anon, authenticated, app_ai_writer;
grant execute on function public.sweep_stalled_ai_jobs(timestamptz) to service_role;
