-- S3 AI infrastructure: usage_limits + usage_events ledger (DM §2.9, A.16, AI C-6, PRD 6.4/6.5).
-- usage_events has no direct write path: every write goes through the ledger RPCs
-- (20261026000400_s3_usage_rpcs.sql), so limits and status transitions can't be bypassed.

-- Reference table (not user data): monthly limits per plan/feature, versioned by effective_from.
create table public.usage_limits (
  id uuid primary key default gen_random_uuid(),
  plan text not null default 'free',
  feature text not null,
  monthly_limit integer not null,
  effective_from timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint usage_limits_plan_feature_effective_from_key unique (plan, feature, effective_from),
  constraint usage_limits_plan_check check (plan in ('free')),
  constraint usage_limits_feature_check
    check (feature in ('insight', 'draft', 'interview_session', 'writing_chat', 'chat_message')),
  constraint usage_limits_monthly_limit_check check (monthly_limit >= 0)
);

alter table public.usage_limits enable row level security;

create trigger usage_limits_set_updated_at
  before update on public.usage_limits
  for each row execute function private.set_updated_at();

create policy usage_limits_select_all on public.usage_limits
  for select to authenticated, app_ai_writer using (true);

grant select on table public.usage_limits to authenticated, app_ai_writer;

-- A.16 initial limits (free). chat_message has no row: D-12 undecided -> reservation refused
-- (usage_limit_missing) [가정, spec-gaps 2026-10-26].
insert into public.usage_limits (plan, feature, monthly_limit, effective_from) values
  ('free', 'insight', 10, '2026-10-01 00:00:00+09'),
  ('free', 'draft', 20, '2026-10-01 00:00:00+09'),
  ('free', 'interview_session', 5, '2026-10-01 00:00:00+09'),
  ('free', 'writing_chat', 10, '2026-10-01 00:00:00+09');

create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default private.current_uid() references auth.users (id) on delete cascade,
  feature text not null,
  units integer not null default 1,
  period_month date not null,
  status text not null default 'reserved',
  -- Soft reference (A.16): the runner reserves before inserting the ai_jobs row.
  ai_job_id uuid,
  reason text not null default 'initial',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint usage_events_id_user_id_key unique (id, user_id),
  constraint usage_events_feature_check
    check (feature in ('insight', 'draft', 'interview_session', 'writing_chat', 'chat_message')),
  constraint usage_events_units_check check (units >= 1),
  -- DM-4 / A.16: KST month, day 1.
  constraint usage_events_period_month_check check (extract(day from period_month) = 1),
  constraint usage_events_status_check check (status in ('reserved', 'charged', 'released')),
  constraint usage_events_reason_check
    check (reason in ('initial', 'explicit_regenerate', 'source_change_regenerate', 'retake'))
);

-- Limit check: sum of reserved + charged per user / month / feature.
create index usage_events_user_period_feature_idx on public.usage_events (user_id, period_month, feature)
  where status in ('reserved', 'charged');
create index usage_events_ai_job_id_idx on public.usage_events (ai_job_id) where ai_job_id is not null;

alter table public.usage_events enable row level security;

create trigger usage_events_set_updated_at
  before update on public.usage_events
  for each row execute function private.set_updated_at();

create policy usage_events_select_own on public.usage_events
  for select to authenticated using (user_id = (select auth.uid()));
create policy usage_events_select_ai_writer on public.usage_events
  for select to app_ai_writer using (user_id = (select private.current_uid()));

grant select on table public.usage_events to authenticated, app_ai_writer;

-- KST month (day 1) for "now".
create or replace function private.current_usage_period()
returns date
language sql
stable
set search_path = ''
as $$
  select date_trunc('month', now() at time zone 'Asia/Seoul')::date;
$$;

revoke all on function private.current_usage_period() from public;
grant execute on function private.current_usage_period() to authenticated, app_ai_writer, service_role;
