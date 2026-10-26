-- S2 career: experiences (DM §2.2, §2.3, A.3) + status trigger + RLS + grants.

create table public.experiences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  status text not null default 'draft',
  company_name text,
  start_month date,
  end_month date,
  is_current boolean not null default false,
  job_rank text,
  job_position text,
  department text,
  employment_type text,
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint experiences_id_user_id_key unique (id, user_id),
  constraint experiences_status_check check (status in ('draft', 'complete')),
  -- DM §2.2: complete requires company_name, start_month, (job_rank or job_position).
  constraint experiences_complete_check check (
    status = 'draft'
    or (company_name is not null and start_month is not null
        and (job_rank is not null or job_position is not null))),
  constraint experiences_employment_type_check
    check (employment_type in ('full_time', 'contract', 'freelance', 'intern', 'other')),
  constraint experiences_summary_check check (char_length(summary) <= 2000),
  -- DM-4: year-month pinned to day 1.
  constraint experiences_start_month_check check (extract(day from start_month) = 1),
  constraint experiences_end_month_check check (extract(day from end_month) = 1),
  constraint experiences_period_check check (end_month >= start_month),
  constraint experiences_is_current_check check (not is_current or end_month is null)
);

create index experiences_user_id_start_month_idx on public.experiences (user_id, start_month desc);
create index experiences_user_id_draft_idx on public.experiences (user_id) where status = 'draft';

alter table public.experiences enable row level security;

-- Status is derived by the DB on every write; any client-sent value is overwritten (DM §2.2).
-- Blank strings count as missing.
create or replace function private.experiences_set_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if nullif(btrim(new.company_name), '') is not null
     and new.start_month is not null
     and (nullif(btrim(new.job_rank), '') is not null or nullif(btrim(new.job_position), '') is not null)
  then
    new.status := 'complete';
  else
    new.status := 'draft';
  end if;
  return new;
end;
$$;

revoke all on function private.experiences_set_status() from public;

create trigger experiences_set_status
  before insert or update on public.experiences
  for each row execute function private.experiences_set_status();

create trigger experiences_set_updated_at
  before update on public.experiences
  for each row execute function private.set_updated_at();

create trigger experiences_touch_career_data
  after insert or update or delete on public.experiences
  for each row execute function private.touch_career_data_updated_at();

-- RLS (DM §5): 4 operations own via user session; app_ai_writer select only.
create policy experiences_select_own on public.experiences
  for select to authenticated using (user_id = (select auth.uid()));
create policy experiences_insert_own on public.experiences
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy experiences_update_own on public.experiences
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy experiences_delete_own on public.experiences
  for delete to authenticated using (user_id = (select auth.uid()));
create policy experiences_select_ai_writer on public.experiences
  for select to app_ai_writer using (user_id = (select private.current_uid()));

grant select, delete on table public.experiences to authenticated;
grant insert (id, user_id, company_name, start_month, end_month, is_current, job_rank, job_position,
              department, employment_type, summary)
  on table public.experiences to authenticated;
grant update (company_name, start_month, end_month, is_current, job_rank, job_position,
              department, employment_type, summary)
  on table public.experiences to authenticated;
grant select on table public.experiences to app_ai_writer;
