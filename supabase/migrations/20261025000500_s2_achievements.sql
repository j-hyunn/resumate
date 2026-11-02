-- S2 career: achievements (DM §2.2, §2.3 v3, D-24 (b)) + status trigger + RLS + grants.
-- Belongs to exactly one of: a project detail (STAR result) or an experience (경력 단위 성과).

create table public.achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  status text not null default 'draft',
  project_detail_id uuid,
  experience_id uuid,
  metric_name text,
  value_before numeric,
  value_after numeric,
  unit text,
  description text,
  -- [가정] spec-gaps 2026-10-25: quantitative when a metric with at least one value exists.
  -- Same "has a value" rule as the status trigger: blank metric_name counts as missing (QA-S2-06).
  kind text generated always as (
    case when nullif(btrim(metric_name), '') is not null and (value_before is not null or value_after is not null)
         then 'quantitative' else 'qualitative' end) stored,
  source_writing_chat_id uuid, -- FK to writing_chats added in S4
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint achievements_id_user_id_key unique (id, user_id),
  constraint achievements_project_detail_fkey foreign key (project_detail_id, user_id)
    references public.project_details (id, user_id) on delete cascade,
  constraint achievements_experience_fkey foreign key (experience_id, user_id)
    references public.experiences (id, user_id) on delete cascade,
  constraint achievements_owner_check check (num_nonnulls(project_detail_id, experience_id) = 1),
  constraint achievements_status_check check (status in ('draft', 'complete')),
  -- DM §2.2: complete requires description or (metric_name and (value_before or value_after)).
  constraint achievements_complete_check check (
    status = 'draft'
    or description is not null
    or (metric_name is not null and (value_before is not null or value_after is not null))),
  constraint achievements_kind_check check (kind in ('quantitative', 'qualitative'))
);

create index achievements_user_id_project_detail_id_idx on public.achievements (user_id, project_detail_id);
create index achievements_user_id_experience_id_idx on public.achievements (user_id, experience_id);

alter table public.achievements enable row level security;

create or replace function private.achievements_set_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if nullif(btrim(new.description), '') is not null
     or (nullif(btrim(new.metric_name), '') is not null
         and (new.value_before is not null or new.value_after is not null))
  then
    new.status := 'complete';
  else
    new.status := 'draft';
  end if;
  return new;
end;
$$;

revoke all on function private.achievements_set_status() from public;

create trigger achievements_set_status
  before insert or update on public.achievements
  for each row execute function private.achievements_set_status();

create trigger achievements_set_updated_at
  before update on public.achievements
  for each row execute function private.set_updated_at();

create trigger achievements_touch_career_data
  after insert or update or delete on public.achievements
  for each row execute function private.touch_career_data_updated_at();

create policy achievements_select_own on public.achievements
  for select to authenticated using (user_id = (select auth.uid()));
create policy achievements_insert_own on public.achievements
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy achievements_update_own on public.achievements
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy achievements_delete_own on public.achievements
  for delete to authenticated using (user_id = (select auth.uid()));
create policy achievements_select_ai_writer on public.achievements
  for select to app_ai_writer using (user_id = (select private.current_uid()));

grant select, delete on table public.achievements to authenticated;
grant insert (id, user_id, project_detail_id, experience_id, metric_name, value_before, value_after,
              unit, description, source_writing_chat_id)
  on table public.achievements to authenticated;
-- The owner (project_detail_id / experience_id) is fixed after insert.
grant update (metric_name, value_before, value_after, unit, description)
  on table public.achievements to authenticated;
grant select on table public.achievements to app_ai_writer;
