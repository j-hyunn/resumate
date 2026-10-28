-- S3a: ai_jobs RPCs without the ledger (D-34) + retry wake-up (B-4) + monthly usage meter (DM §2.9.5).

-- complete_ai_job v4: running -> succeeded for the run generation p_run_generation (QA-S3-05). No charging.
--   * job not visible to the caller (missing / another user's)        -> P0001 ai_job_not_found
--   * run_generation <> p_run_generation (or null), or status not running / succeeded
--                                                                    -> P0001 invalid_ai_job_transition
--   * already succeeded with the same generation: repeat call, no change (idempotent).
--   * on success: finished_at = now(), next_run_at cleared, progress replaced when p_progress is given.
-- security invoker: app_ai_writer's own RLS + column grants apply (status, progress, next_run_at, finished_at).
create or replace function public.complete_ai_job(
  p_job_id uuid,
  p_run_generation integer,
  p_progress jsonb default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := private.current_uid();
  v_status text;
  v_generation integer;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  select j.status, j.run_generation into v_status, v_generation
    from public.ai_jobs j
   where j.id = p_job_id and j.user_id = v_uid
   for update;

  if v_status is null then
    raise exception using errcode = 'P0001', message = 'ai_job_not_found';
  end if;

  if v_generation is distinct from p_run_generation or v_status not in ('running', 'succeeded') then
    raise exception using errcode = 'P0001', message = 'invalid_ai_job_transition',
      detail = v_status || '#' || v_generation || ' -> succeeded#' || coalesce(p_run_generation::text, 'null');
  end if;

  if v_status = 'running' then
    update public.ai_jobs
       set status = 'succeeded',
           finished_at = now(),
           next_run_at = null,
           progress = coalesce(p_progress, progress)
     where id = p_job_id;
  end if;
end;
$$;

revoke all on function public.complete_ai_job(uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.complete_ai_job(uuid, integer, jsonb) to app_ai_writer;

-- sweep_stalled_ai_jobs v4 (cron, all users; no reservations to release any more):
--   running jobs, and queued jobs that are NOT waiting for a scheduled run (next_run_at is null),
--   whose coalesce(heartbeat_at, created_at) < p_stalled_before -> failed / stalled.
--   Queued jobs with next_run_at are left to claim_due_ai_jobs (a retry wait or free-tier spacing is
--   not a stall, and the B-4 cron may run long after next_run_at).
-- Returns the number of jobs failed. service_role only.
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

  update public.ai_jobs j
     set status = 'failed',
         error_code = 'stalled',
         finished_at = now()
   where (j.status = 'running' or (j.status = 'queued' and j.next_run_at is null))
     and coalesce(j.heartbeat_at, j.created_at) < p_stalled_before;
  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

revoke all on function public.sweep_stalled_ai_jobs(timestamptz) from public, anon, authenticated, app_ai_writer;
grant execute on function public.sweep_stalled_ai_jobs(timestamptz) to service_role;

-- claim_due_ai_jobs (B-4 safety net, cron): queued jobs with next_run_at <= p_now, oldest due first,
-- at most p_limit. Read-only lookup: the cron resumes each job as that user (app_ai_writer); the
-- runner's conditional queued -> running update (run_generation) settles races with status polling.
-- service_role only.
create or replace function public.claim_due_ai_jobs(p_now timestamptz, p_limit integer)
returns table (id uuid, user_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_now is null then
    raise exception using errcode = 'P0001', message = 'invalid_now';
  end if;
  if p_limit is null or p_limit < 1 then
    raise exception using errcode = 'P0001', message = 'invalid_limit';
  end if;

  return query
    select j.id, j.user_id
      from public.ai_jobs j
     where j.status = 'queued' and j.next_run_at is not null and j.next_run_at <= p_now
     order by j.next_run_at, j.id
     limit p_limit;
end;
$$;

revoke all on function public.claim_due_ai_jobs(timestamptz, integer) from public, anon, authenticated, app_ai_writer;
grant execute on function public.claim_due_ai_jobs(timestamptz, integer) to service_role;

-- get_ai_usage_summary (DM §2.9.5, F-AI-07): the caller's meter for one KST calendar month.
-- security invoker (own rows through RLS). p_period_month null / omitted = this KST month; any day of
-- a month is normalized to day 1. p_include_previous adds "previous_month" (UB-2 (b) [가정]).
create or replace function public.get_ai_usage_summary(
  p_period_month date default null,
  p_include_previous boolean default false
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_month date := date_trunc('month', coalesce(p_period_month, private.current_usage_period()))::date;
  v_prev date := (date_trunc('month', coalesce(p_period_month, private.current_usage_period()))
                  - interval '1 month')::date;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  select jsonb_build_object(
    'period_month', to_char(v_month, 'YYYY-MM-DD'),
    'as_of', now(),
    'totals', (
      select jsonb_build_object(
        'input_tokens', coalesce(sum(r.input_tokens), 0),
        'cached_input_tokens', coalesce(sum(r.cached_input_tokens), 0),
        'cache_write_tokens', coalesce(sum(r.cache_write_tokens), 0),
        'output_tokens', coalesce(sum(r.output_tokens), 0),
        'estimated_cost_usd', coalesce(sum(r.estimated_cost_usd), 0),
        'calls', count(*),
        'failed_calls', count(*) filter (where r.outcome = 'failed'))
        from public.ai_usage_records r
       where r.user_id = v_uid and r.period_month = v_month),
    'by_feature', coalesce((
      select jsonb_agg(jsonb_build_object(
               'feature', f.feature,
               'input_tokens', f.input_tokens,
               'output_tokens', f.output_tokens,
               'estimated_cost_usd', f.estimated_cost_usd,
               'calls', f.calls) order by f.feature)
        from (select r.feature,
                     sum(r.input_tokens) as input_tokens,
                     sum(r.output_tokens) as output_tokens,
                     sum(r.estimated_cost_usd) as estimated_cost_usd,
                     count(*) as calls
                from public.ai_usage_records r
               where r.user_id = v_uid and r.period_month = v_month
               group by r.feature) f), '[]'::jsonb),
    'by_provider', coalesce((
      select jsonb_agg(jsonb_build_object(
               'provider', p.provider,
               'connection_tier', p.connection_tier,
               'input_tokens', p.input_tokens,
               'output_tokens', p.output_tokens,
               'estimated_cost_usd', p.estimated_cost_usd,
               'calls', p.calls) order by p.provider, p.connection_tier)
        from (select r.provider, r.connection_tier,
                     sum(r.input_tokens) as input_tokens,
                     sum(r.output_tokens) as output_tokens,
                     sum(r.estimated_cost_usd) as estimated_cost_usd,
                     count(*) as calls
                from public.ai_usage_records r
               where r.user_id = v_uid and r.period_month = v_month
               group by r.provider, r.connection_tier) p), '[]'::jsonb),
    'price_table_versions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'version', v.version,
               'source_checked_at', to_char(v.source_checked_at, 'YYYY-MM-DD')) order by v.version)
        from (select u.version, max(t.source_checked_at) as source_checked_at
                from (select distinct r.price_table_version as version
                        from public.ai_usage_records r
                       where r.user_id = v_uid and r.period_month = v_month) u
                left join public.ai_price_tables t on t.version = u.version
               group by u.version) v), '[]'::jsonb)
  ) into v_result;

  if coalesce(p_include_previous, false) then
    v_result := v_result || jsonb_build_object('previous_month', (
      select jsonb_build_object(
        'period_month', to_char(v_prev, 'YYYY-MM-DD'),
        'estimated_cost_usd', coalesce(sum(r.estimated_cost_usd), 0),
        'input_tokens', coalesce(sum(r.input_tokens), 0),
        'output_tokens', coalesce(sum(r.output_tokens), 0))
        from public.ai_usage_records r
       where r.user_id = v_uid and r.period_month = v_prev));
  end if;

  return v_result;
end;
$$;

revoke all on function public.get_ai_usage_summary(date, boolean) from public, anon, app_ai_writer;
grant execute on function public.get_ai_usage_summary(date, boolean) to authenticated;
