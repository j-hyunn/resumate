-- S1 foundation: shared helper schema and trigger functions (DM §0 공통 컬럼, DM §2.1).
-- `private` is not exposed through PostgREST, so helpers here can't be called as RPCs.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- Shared updated_at trigger (DM §0: updated_at is trigger-maintained on every evidence source table).
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public;

-- profiles.career_data_updated_at maintenance (A.1, DM §2.1).
-- Attached in S2 to the 7 career tables: experiences, educations, projects, project_details,
-- achievements, skills, project_skills. Security definer because users have no update grant
-- on profiles.career_data_updated_at.
create or replace function private.touch_career_data_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  if tg_op = 'DELETE' then
    v_user_id := old.user_id;
  else
    v_user_id := new.user_id;
  end if;

  update public.profiles
     set career_data_updated_at = now()
   where id = v_user_id;

  return null;
end;
$$;

revoke all on function private.touch_career_data_updated_at() from public;

-- auth.uid() equivalent usable by roles without USAGE on schema auth (app_ai_writer).
-- Returns only the caller's own JWT `sub`; nothing else is reachable through it.
create or replace function private.current_uid()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid();
$$;

revoke all on function private.current_uid() from public;
grant execute on function private.current_uid() to authenticated, service_role;
