-- S3 usage ledger RPCs (DM §2.9 차감 규칙, A.16, AI C-6, PRD 6.4/6.5: failed work is never charged).
-- Writers are security definer so usage_events has no direct write grant for anyone: the limit
-- check and the reserved -> charged / released transitions can't be bypassed. Each function acts
-- only on the JWT user's rows (auth.uid()); execute is granted to app_ai_writer only.
-- Errors: errcode / message (lowercase codes, mapped by the app).

-- reserve_usage: serialize per user / KST month / feature, then check reserved + charged + units <= limit.
create or replace function public.reserve_usage(
  p_feature text,
  p_units integer default 1,
  p_reason text default 'initial',
  p_ai_job_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_period date := private.current_usage_period();
  v_limit integer;
  v_used integer;
  v_id uuid;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_feature is null
     or p_feature not in ('insight', 'draft', 'interview_session', 'writing_chat', 'chat_message') then
    raise exception using errcode = 'P0001', message = 'invalid_usage_feature';
  end if;
  if p_units is null or p_units < 1 then
    raise exception using errcode = 'P0001', message = 'invalid_usage_units';
  end if;
  if p_reason is null
     or p_reason not in ('initial', 'explicit_regenerate', 'source_change_regenerate', 'retake') then
    raise exception using errcode = 'P0001', message = 'invalid_usage_reason';
  end if;

  -- Concurrent reservations for the same user / month / feature wait here (released at commit).
  perform pg_advisory_xact_lock(
    hashtextextended('usage:' || v_uid::text || ':' || v_period::text || ':' || p_feature, 0));

  select l.monthly_limit into v_limit
    from public.usage_limits l
   where l.plan = 'free' and l.feature = p_feature and l.effective_from <= now()
   order by l.effective_from desc
   limit 1;

  -- No active limit row (chat_message, D-12) -> refuse [가정].
  if v_limit is null then
    raise exception using errcode = 'P0001', message = 'usage_limit_missing';
  end if;

  select coalesce(sum(e.units), 0) into v_used
    from public.usage_events e
   where e.user_id = v_uid and e.period_month = v_period and e.feature = p_feature
     and e.status in ('reserved', 'charged');

  if v_used + p_units > v_limit then
    raise exception using errcode = 'P0001', message = 'usage_limit_reached',
      detail = json_build_object('feature', p_feature, 'limit', v_limit, 'used', v_used)::text;
  end if;

  insert into public.usage_events (user_id, feature, units, period_month, status, ai_job_id, reason)
  values (v_uid, p_feature, p_units, v_period, 'reserved', p_ai_job_id, p_reason)
  returning id into v_id;

  return v_id;
end;
$$;

-- Shared transition for one event: reserved -> p_to. Same status again = idempotent success.
create or replace function private.transition_usage_event(p_usage_event_id uuid, p_to text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  select e.status into v_status
    from public.usage_events e
   where e.id = p_usage_event_id and e.user_id = v_uid
   for update;

  if v_status is null then
    raise exception using errcode = 'P0001', message = 'usage_event_not_found';
  end if;
  if v_status = p_to then
    return;
  end if;
  if v_status <> 'reserved' then
    raise exception using errcode = 'P0001', message = 'invalid_usage_transition',
      detail = v_status || ' -> ' || p_to;
  end if;

  update public.usage_events set status = p_to where id = p_usage_event_id;
end;
$$;

revoke all on function private.transition_usage_event(uuid, text) from public;

create or replace function public.charge_usage(p_usage_event_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.transition_usage_event(p_usage_event_id, 'charged');
$$;

create or replace function public.release_usage(p_usage_event_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.transition_usage_event(p_usage_event_id, 'released');
$$;

-- Settle every reserved event of one job for the JWT user. Returns the number of rows moved.
-- Idempotent: already charged / released rows are left alone (second call returns 0).
create or replace function public.charge_usage_for_job(p_ai_job_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  update public.usage_events
     set status = 'charged'
   where user_id = v_uid and ai_job_id = p_ai_job_id and status = 'reserved';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.release_usage_for_job(p_ai_job_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  update public.usage_events
     set status = 'released'
   where user_id = v_uid and ai_job_id = p_ai_job_id and status = 'reserved';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- "이번 달 {N}회 남음": per feature with an active limit row, this KST month, reserved counts as used.
-- Security invoker: reads own usage_events under RLS (authenticated or app_ai_writer).
create or replace function public.get_usage_summary()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := (select private.current_uid());
  v_period date := private.current_usage_period();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  return coalesce((
    select jsonb_object_agg(l.feature, jsonb_build_object(
             'limit', l.monthly_limit,
             'used', u.used,
             'remaining', greatest(l.monthly_limit - u.used, 0)))
      from (
        select distinct on (ul.feature) ul.feature, ul.monthly_limit
          from public.usage_limits ul
         where ul.plan = 'free' and ul.effective_from <= now()
         order by ul.feature, ul.effective_from desc
      ) l
      cross join lateral (
        select coalesce(sum(e.units), 0)::integer as used
          from public.usage_events e
         where e.user_id = v_uid and e.period_month = v_period and e.feature = l.feature
           and e.status in ('reserved', 'charged')
      ) u
  ), '{}'::jsonb);
end;
$$;

revoke all on function public.reserve_usage(text, integer, text, uuid) from public, anon, authenticated;
revoke all on function public.charge_usage(uuid) from public, anon, authenticated;
revoke all on function public.release_usage(uuid) from public, anon, authenticated;
revoke all on function public.charge_usage_for_job(uuid) from public, anon, authenticated;
revoke all on function public.release_usage_for_job(uuid) from public, anon, authenticated;
revoke all on function public.get_usage_summary() from public, anon;

grant execute on function public.reserve_usage(text, integer, text, uuid) to app_ai_writer;
grant execute on function public.charge_usage(uuid) to app_ai_writer;
grant execute on function public.release_usage(uuid) to app_ai_writer;
grant execute on function public.charge_usage_for_job(uuid) to app_ai_writer;
grant execute on function public.release_usage_for_job(uuid) to app_ai_writer;
grant execute on function public.get_usage_summary() to authenticated, app_ai_writer;
