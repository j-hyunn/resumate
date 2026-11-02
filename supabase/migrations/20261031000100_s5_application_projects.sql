-- S5 application projects (F-AP-01·02·05, F-ST-01~05): application_projects + application_stage_events
-- (DM §2.6, A.5, §5) + RLS + grants.
--
-- Write paths (DM §5):
--   * insert: create_application_project RPC only (definer; also inserts the JD and the `created` event).
--   * user session direct UPDATE: name, deadline, memo only (column grant). A name change sets
--     name_source = 'user'; any of the three bumps last_activity_at (trigger).
--   * stage / stage_outcome / stage_changed_at: no direct UPDATE for any role. Only move_application_stage /
--     set_application_outcome (definer + owner check) change them and write the history row.
--   * app_ai_writer: SELECT (no memo). Name / last_activity_at are changed by the JD extraction definer RPCs,
--     so it gets no column UPDATE grant (S4 precedent: AI writes only through owner-checking RPCs).
--   * application_stage_events: immutable. SELECT own; rows only from the definer RPCs, removed only by cascade.

create table public.application_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text,                         -- null = waiting for JD extraction (A.5)
  name_source text,
  deadline date,
  memo text,
  stage text not null default 'before_apply',
  stage_outcome text,
  stage_changed_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  duplicated_from_id uuid,           -- F-AP-09 (Could)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint application_projects_id_user_id_key unique (id, user_id),
  constraint application_projects_duplicated_from_fkey foreign key (duplicated_from_id, user_id)
    references public.application_projects (id, user_id) on delete set null (duplicated_from_id),
  constraint application_projects_name_check check (
    name is null or (char_length(name) between 1 and 100 and btrim(name) <> '')),
  constraint application_projects_name_source_check check (name_source in ('user', 'ai', 'default')),
  constraint application_projects_name_name_source_check check ((name is null) = (name_source is null)),
  constraint application_projects_memo_check check (memo is null or char_length(memo) <= 2000),
  constraint application_projects_stage_check check (stage in (
    'before_apply', 'document', 'assignment', 'job_interview', 'culture_fit_interview', 'closed')),
  constraint application_projects_stage_outcome_check check (stage_outcome in ('passed', 'failed')),
  constraint application_projects_stage_outcome_closed_check check (stage = 'closed' or stage_outcome is null)
);

-- DM §2.6 indexes: board (D-26 (a) most recently moved first), list by recent activity, list by deadline.
create index application_projects_user_stage_idx
  on public.application_projects (user_id, stage, stage_changed_at desc);
create index application_projects_user_last_activity_idx
  on public.application_projects (user_id, last_activity_at desc);
create index application_projects_user_deadline_idx on public.application_projects (user_id, deadline);
create index application_projects_duplicated_from_idx on public.application_projects (duplicated_from_id)
  where duplicated_from_id is not null;

alter table public.application_projects enable row level security;

-- User-session direct updates (column grant: name, deadline, memo).
--   * a name can't be cleared (null / blank) -> invalid_name; it is trimmed; source becomes 'user'.
--   * name / deadline / memo change -> last_activity_at = now().
-- Definer RPCs run as the owner (current_user <> 'authenticated') and set these columns themselves.
create or replace function private.application_projects_user_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    if new.name is distinct from old.name then
      new.name := btrim(new.name);
      if new.name is null or new.name = '' or char_length(new.name) > 100 then
        raise exception using errcode = 'P0001', message = 'invalid_name';
      end if;
      new.name_source := 'user';
    end if;
    if new.name is distinct from old.name or new.deadline is distinct from old.deadline
       or new.memo is distinct from old.memo then
      new.last_activity_at := now();
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.application_projects_user_update() from public;

create trigger application_projects_user_update
  before update on public.application_projects
  for each row execute function private.application_projects_user_update();

create trigger application_projects_set_updated_at
  before update on public.application_projects
  for each row execute function private.set_updated_at();

create policy application_projects_select_own on public.application_projects
  for select to authenticated using (user_id = (select auth.uid()));
create policy application_projects_update_own on public.application_projects
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy application_projects_delete_own on public.application_projects
  for delete to authenticated using (user_id = (select auth.uid()));
create policy application_projects_select_ai_writer on public.application_projects
  for select to app_ai_writer using (user_id = (select private.current_uid()));

grant select, delete on table public.application_projects to authenticated;
grant update (name, deadline, memo) on table public.application_projects to authenticated;
-- AI pipelines read the project header; the user's memo is not AI input [가정].
grant select (id, user_id, name, name_source, deadline, stage, stage_outcome, stage_changed_at,
              last_activity_at, created_at, updated_at)
  on table public.application_projects to app_ai_writer;


create table public.application_stage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  application_project_id uuid not null,
  event_type text not null,
  from_stage text,
  to_stage text not null,
  from_outcome text,
  to_outcome text,
  created_at timestamptz not null default now(),
  -- F-AP-05: deleted with the application project.
  constraint application_stage_events_application_project_fkey foreign key (application_project_id, user_id)
    references public.application_projects (id, user_id) on delete cascade,
  constraint application_stage_events_event_type_check check (event_type in ('created', 'stage_changed', 'outcome_changed')),
  constraint application_stage_events_from_stage_check check (from_stage in (
    'before_apply', 'document', 'assignment', 'job_interview', 'culture_fit_interview', 'closed')),
  constraint application_stage_events_to_stage_check check (to_stage in (
    'before_apply', 'document', 'assignment', 'job_interview', 'culture_fit_interview', 'closed')),
  constraint application_stage_events_from_outcome_check check (from_outcome in ('passed', 'failed')),
  constraint application_stage_events_to_outcome_check check (to_outcome in ('passed', 'failed')),
  constraint application_stage_events_created_check check (
    event_type <> 'created' or (from_stage is null and from_outcome is null and to_outcome is null))
);

create index application_stage_events_project_created_idx
  on public.application_stage_events (application_project_id, created_at);

alter table public.application_stage_events enable row level security;

create policy application_stage_events_select_own on public.application_stage_events
  for select to authenticated using (user_id = (select auth.uid()));

grant select on table public.application_stage_events to authenticated;

-- DM §5 "운영자 ... application_stage_events·application_projects.stage* 쓰기 없음": service_role (Supabase
-- default privileges) keeps SELECT / DELETE only on both tables.
revoke insert, update, truncate, references, trigger on table public.application_projects from service_role;
revoke insert, update, truncate, references, trigger on table public.application_stage_events from service_role;
