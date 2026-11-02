-- S2 career: projects (DM §2.2, §2.3 v3) + status trigger + RLS + grants.
-- complete = name + role + at least one complete project_details row (DM §2.2). The detail side
-- of the recalculation lives in the project_details migration.
-- source_writing_chat_id: plain uuid in S2; the FK to writing_chats (on delete set null) is
-- added in S4 when writing_chats exists (decisions.md 2026-10-25).

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  status text not null default 'draft',
  experience_id uuid,
  education_id uuid,
  name text,
  role text,
  summary text,
  start_month date,
  end_month date,
  team_size smallint,
  source_writing_chat_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_id_user_id_key unique (id, user_id),
  -- DM-2: composite FKs; deleting the affiliation keeps the project as standalone.
  constraint projects_experience_fkey foreign key (experience_id, user_id)
    references public.experiences (id, user_id) on delete set null (experience_id),
  constraint projects_education_fkey foreign key (education_id, user_id)
    references public.educations (id, user_id) on delete set null (education_id),
  constraint projects_affiliation_check check (num_nonnulls(experience_id, education_id) <= 1),
  constraint projects_status_check check (status in ('draft', 'complete')),
  -- Field part of the completion rule; the child-dependent part is enforced by triggers.
  constraint projects_complete_check check (status = 'draft' or (name is not null and role is not null)),
  constraint projects_summary_check check (char_length(summary) <= 200),
  constraint projects_start_month_check check (extract(day from start_month) = 1),
  constraint projects_end_month_check check (extract(day from end_month) = 1),
  constraint projects_period_check check (end_month >= start_month),
  constraint projects_team_size_check check (team_size >= 1)
);

create index projects_user_id_experience_id_idx on public.projects (user_id, experience_id);
create index projects_user_id_education_id_idx on public.projects (user_id, education_id);
create index projects_user_id_start_month_idx on public.projects (user_id, start_month desc);
create index projects_user_id_draft_idx on public.projects (user_id) where status = 'draft';

alter table public.projects enable row level security;

-- Shared rule: is this project complete given its fields and its complete details?
-- Security invoker: a user's trigger sees the project's details through RLS, which is enough
-- because details always share the project's user_id (composite FK). The definer-side caller
-- (project_details_sync_project_status) runs it as the owner.
create or replace function private.project_is_complete(p_project_id uuid, p_name text, p_role text)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  -- plpgsql (not sql) so the body binds to project_details at run time; that table is created
  -- in the next migration.
  return nullif(btrim(p_name), '') is not null
     and nullif(btrim(p_role), '') is not null
     and exists (select 1 from public.project_details d
                  where d.project_id = p_project_id and d.status = 'complete');
end;
$$;

revoke all on function private.project_is_complete(uuid, text, text) from public;
-- Called by the projects BEFORE trigger, which runs as the writing user.
grant execute on function private.project_is_complete(uuid, text, text) to authenticated;

create or replace function private.projects_set_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.status := case when private.project_is_complete(new.id, new.name, new.role)
                     then 'complete' else 'draft' end;
  return new;
end;
$$;

revoke all on function private.projects_set_status() from public;

create trigger projects_set_status
  before insert or update on public.projects
  for each row execute function private.projects_set_status();

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function private.set_updated_at();

create trigger projects_touch_career_data
  after insert or update or delete on public.projects
  for each row execute function private.touch_career_data_updated_at();

create policy projects_select_own on public.projects
  for select to authenticated using (user_id = (select auth.uid()));
create policy projects_insert_own on public.projects
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy projects_update_own on public.projects
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy projects_delete_own on public.projects
  for delete to authenticated using (user_id = (select auth.uid()));
create policy projects_select_ai_writer on public.projects
  for select to app_ai_writer using (user_id = (select private.current_uid()));

grant select, delete on table public.projects to authenticated;
grant insert (id, user_id, experience_id, education_id, name, role, summary, start_month, end_month,
              team_size, source_writing_chat_id)
  on table public.projects to authenticated;
grant update (experience_id, education_id, name, role, summary, start_month, end_month, team_size)
  on table public.projects to authenticated;
grant select on table public.projects to app_ai_writer;
