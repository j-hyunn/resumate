-- S9 retention purge RPCs (DM §3.4, §4.4, §2.9.1 / 2.9.2, A.17, §7 정기 배치; PRD NFR-PRV-06, D-DM-08 / 09).
-- Called by the daily retention cron (GET /api/cron/retention) through a service-role client.
-- security definer, service_role only (never authenticated / app_ai_writer / app_key_reader).
-- Every call deletes at most p_limit rows (default 5000, 1..50000) and returns the number deleted; a return value
-- equal to p_limit means more rows may be left for the next call / run. Rows locked by someone else are skipped
-- (for update skip locked) and picked up next time, so the cron never waits on user traffic.
--   purge_unlinked_writing_chats   project_id null, active / abandoned, last_activity_at older than 90 days
--   purge_old_ai_jobs              finished (succeeded / failed / canceled), coalesce(finished_at, created_at) > 90 days
--   purge_old_ai_usage_records     KST period_month older than the 13 months ending with p_now's KST month [가정]
--   purge_old_account_deletion_logs requested_at older than 3 years
-- Errors: P0001 invalid_now, invalid_limit.

-- ── indexes for the purge scans ──────────────────────────────────────────────
create index writing_chats_unlinked_last_activity_idx
  on public.writing_chats (last_activity_at)
  where project_id is null and status in ('active', 'abandoned');

create index ai_jobs_finished_purge_idx
  on public.ai_jobs ((coalesce(finished_at, created_at)))
  where status in ('succeeded', 'failed', 'canceled');

create index ai_usage_records_period_month_idx on public.ai_usage_records (period_month);


-- Shared argument check.
create or replace function private.purge_check_args(p_now timestamptz, p_limit integer)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_now is null then
    raise exception using errcode = 'P0001', message = 'invalid_now';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50000 then
    raise exception using errcode = 'P0001', message = 'invalid_limit';
  end if;
end;
$$;

revoke all on function private.purge_check_args(timestamptz, integer) from public;


-- ── unlinked AI writing chats, 90 days (DM §3.4, D-DM-08 [가정]) ──────────────
-- Messages cascade. Chats a queued / running job is working on are kept (a turn in progress).
create or replace function public.purge_unlinked_writing_chats(
  p_now timestamptz default now(),
  p_limit integer default 5000
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform private.purge_check_args(p_now, p_limit);

  delete from public.writing_chats w
   where w.id in (
     select c.id
       from public.writing_chats c
      where c.project_id is null
        and c.status in ('active', 'abandoned')
        and c.last_activity_at < p_now - interval '90 days'
        and not exists (
          select 1 from public.ai_jobs j
           where j.user_id = c.user_id
             and j.target_type = 'writing_chat' and j.target_id = c.id
             and j.status in ('queued', 'running'))
      order by c.last_activity_at, c.id
      limit p_limit
        for update skip locked);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.purge_unlinked_writing_chats(timestamptz, integer)
  from public, anon, authenticated, app_ai_writer, app_key_reader;
grant execute on function public.purge_unlinked_writing_chats(timestamptz, integer) to service_role;


-- ── finished ai_jobs, 90 days (DM §2.9.1) ─────────────────────────────────────
-- Result rows keep their content: their job FKs (insights / drafts / draft_sections / interview_* /
-- job_descriptions.extraction_job_id ...) are `on delete set null (col)`, ai_usage_records.ai_job_id is soft.
-- queued / running jobs are never touched.
create or replace function public.purge_old_ai_jobs(
  p_now timestamptz default now(),
  p_limit integer default 5000
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform private.purge_check_args(p_now, p_limit);

  delete from public.ai_jobs d
   where d.id in (
     select j.id
       from public.ai_jobs j
      where j.status in ('succeeded', 'failed', 'canceled')
        and coalesce(j.finished_at, j.created_at) < p_now - interval '90 days'
      order by coalesce(j.finished_at, j.created_at), j.id
      limit p_limit
        for update skip locked)
     and d.status in ('succeeded', 'failed', 'canceled');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.purge_old_ai_jobs(timestamptz, integer)
  from public, anon, authenticated, app_ai_writer, app_key_reader;
grant execute on function public.purge_old_ai_jobs(timestamptz, integer) to service_role;


-- ── ai_usage_records, 13 KST months (DM §2.9.2, D-DM-09 [가정]) ───────────────
-- Keeps p_now's KST month and the 12 before it; deletes rows whose period_month is earlier.
create or replace function public.purge_old_ai_usage_records(
  p_now timestamptz default now(),
  p_limit integer default 5000
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff date;
  v_count integer;
begin
  perform private.purge_check_args(p_now, p_limit);

  v_cutoff := (date_trunc('month', p_now at time zone 'Asia/Seoul') - interval '12 months')::date;

  delete from public.ai_usage_records d
   where d.id in (
     select r.id
       from public.ai_usage_records r
      where r.period_month < v_cutoff
      order by r.period_month, r.id
      limit p_limit
        for update skip locked);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.purge_old_ai_usage_records(timestamptz, integer)
  from public, anon, authenticated, app_ai_writer, app_key_reader;
grant execute on function public.purge_old_ai_usage_records(timestamptz, integer) to service_role;


-- ── account_deletion_logs, 3 years (DM §4.4, A.17) ─────────────────────────────
create or replace function public.purge_old_account_deletion_logs(
  p_now timestamptz default now(),
  p_limit integer default 5000
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform private.purge_check_args(p_now, p_limit);

  delete from public.account_deletion_logs d
   where d.id in (
     select l.id
       from public.account_deletion_logs l
      where l.requested_at < p_now - interval '3 years'
      order by l.requested_at, l.id
      limit p_limit
        for update skip locked);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.purge_old_account_deletion_logs(timestamptz, integer)
  from public, anon, authenticated, app_ai_writer, app_key_reader;
grant execute on function public.purge_old_account_deletion_logs(timestamptz, integer) to service_role;
