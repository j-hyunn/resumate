-- S1 foundation: profiles (DM A.1) + sign-up trigger + RLS + grants.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  desired_job_title text,
  total_years_of_experience smallint,
  interested_industries text[] not null default '{}',
  career_data_updated_at timestamptz,
  last_active_at timestamptz,
  inactivity_notice_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_check check (char_length(display_name) <= 50),
  constraint profiles_desired_job_title_check check (char_length(desired_job_title) <= 100),
  constraint profiles_total_years_of_experience_check
    check (total_years_of_experience between 0 and 50)
);

alter table public.profiles enable row level security;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- RLS (A.1): select/update own, insert only via sign-up trigger, no delete (auth.users cascade).
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- AI work reads the profile fields that go into the Career Context Pack; display_name never (A.1).
create policy profiles_select_ai_writer on public.profiles
  for select to app_ai_writer
  using (id = (select private.current_uid()));

-- Grants: replace Supabase's default table grants with the minimum.
revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (display_name, desired_job_title, total_years_of_experience, interested_industries)
  on table public.profiles to authenticated;

grant select (id, desired_job_title, total_years_of_experience, interested_industries,
              career_data_updated_at)
  on table public.profiles to app_ai_writer;

-- Sign-up trigger: one profile row per auth user.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();
