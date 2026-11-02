-- S2 career: educations (DM §2.2, §2.3 v3, F-P1-14) + status trigger + RLS + grants.
-- No GPA / grade columns (NFR-PRV-01 v3).

create table public.educations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  status text not null default 'draft',
  institution_name text,
  education_type text,
  program_name text,
  start_month date,
  end_month date,
  enrollment_status text,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint educations_id_user_id_key unique (id, user_id),
  constraint educations_status_check check (status in ('draft', 'complete')),
  -- DM §2.2: complete requires institution_name, education_type, start_month.
  constraint educations_complete_check check (
    status = 'draft'
    or (institution_name is not null and education_type is not null and start_month is not null)),
  constraint educations_institution_name_check check (char_length(institution_name) <= 100),
  constraint educations_education_type_check check (education_type in ('degree', 'course')),
  constraint educations_program_name_check check (char_length(program_name) <= 100),
  constraint educations_start_month_check check (extract(day from start_month) = 1),
  constraint educations_end_month_check check (extract(day from end_month) = 1),
  constraint educations_period_check check (end_month >= start_month),
  constraint educations_enrollment_status_check
    check (enrollment_status in ('enrolled', 'graduated', 'completed', 'dropped_out', 'on_leave')),
  constraint educations_enrolled_end_month_check
    check (enrollment_status <> 'enrolled' or end_month is null),
  constraint educations_description_check check (char_length(description) <= 2000)
);

create index educations_user_id_start_month_idx on public.educations (user_id, start_month desc);
create index educations_user_id_draft_idx on public.educations (user_id) where status = 'draft';

alter table public.educations enable row level security;

create or replace function private.educations_set_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if nullif(btrim(new.institution_name), '') is not null
     and new.education_type is not null
     and new.start_month is not null
  then
    new.status := 'complete';
  else
    new.status := 'draft';
  end if;
  return new;
end;
$$;

revoke all on function private.educations_set_status() from public;

create trigger educations_set_status
  before insert or update on public.educations
  for each row execute function private.educations_set_status();

create trigger educations_set_updated_at
  before update on public.educations
  for each row execute function private.set_updated_at();

create trigger educations_touch_career_data
  after insert or update or delete on public.educations
  for each row execute function private.touch_career_data_updated_at();

create policy educations_select_own on public.educations
  for select to authenticated using (user_id = (select auth.uid()));
create policy educations_insert_own on public.educations
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy educations_update_own on public.educations
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy educations_delete_own on public.educations
  for delete to authenticated using (user_id = (select auth.uid()));
create policy educations_select_ai_writer on public.educations
  for select to app_ai_writer using (user_id = (select private.current_uid()));

grant select, delete on table public.educations to authenticated;
grant insert (id, user_id, institution_name, education_type, program_name, start_month, end_month,
              enrollment_status, description)
  on table public.educations to authenticated;
grant update (institution_name, education_type, program_name, start_month, end_month,
              enrollment_status, description)
  on table public.educations to authenticated;
grant select on table public.educations to app_ai_writer;
