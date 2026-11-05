-- R13 ⑥ private.compute_total_experience_months (DM v4.12 §6.2; AI C-1 computed_total_months; SD-2).
-- The one source of the "총 경력 개월 수" number. Not a stored column, not inline SQL in the pack query.
--
-- p_as_of has NO default (v4.12, R-SD-23): a default would be evaluated at call time, so an omitted argument
-- would behave like reading now() inside the function and "same input -> same result" (input_hash reuse, pgTAP)
-- would break silently. Every caller passes it: the pack assembly passes that run's KST date, pgTAP a fixed date.
--
-- Rules (AI C-1 / DM §6.2, kept word for word):
--   target     experiences of p_user_id with status = 'complete' only; educations and projects never count
--   unit       months, both ends inclusive (2024.03~2024.03 = 1)
--   current    is_current = true counts up to the month of p_as_of
--   open ended is_current = false and end_month is null -> the experience is left OUT of the total and
--              counted in open_ended_experience_count (the period is never guessed)
--   overlap    union of months: a month belonging to any complete experience counts once; gaps add nothing
-- career_snapshot_hash / input_hash never include this value (DM §6.2).
--
-- security definer because both the user session and app_ai_writer call it. [가정] (DM §6.2): the caller must
-- act for p_user_id — both roles carry the user's id as the JWT sub, so one check (auth.uid() = p_user_id)
-- covers the user session and app_ai_writer alike.
create or replace function private.compute_total_experience_months(
  p_user_id uuid,
  p_as_of date,
  out total_months integer,
  out open_ended_experience_count integer,
  out as_of_month date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_as_of is null then
    raise exception using errcode = '22004', message = 'p_user_id and p_as_of are required';
  end if;
  if p_user_id is distinct from private.current_uid() then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  as_of_month := date_trunc('month', p_as_of)::date;

  select count(distinct m.month)::int
    into total_months
    from public.experiences e
    cross join lateral (
      select generate_series(
               date_trunc('month', e.start_month)::date,
               case when e.is_current then as_of_month else date_trunc('month', e.end_month)::date end,
               interval '1 month')::date as month
    ) m
   where e.user_id = p_user_id
     and e.status = 'complete'
     and e.start_month is not null
     and (e.is_current or e.end_month is not null);

  select count(*)::int
    into open_ended_experience_count
    from public.experiences e
   where e.user_id = p_user_id
     and e.status = 'complete'
     and not e.is_current
     and e.end_month is null;
end;
$$;

revoke all on function private.compute_total_experience_months(uuid, date) from public, anon;
grant execute on function private.compute_total_experience_months(uuid, date)
  to authenticated, app_ai_writer;

-- No public RPC wrapper: no screen shows this number yet (DM §6.2). Add get_total_experience_months() when
-- one does.
