-- S2 career: skills / project_skills (DM A.4, F-P1-05) + orphan tag cleanup + RLS + grants.

create table public.skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  -- [가정] spec-gaps 2026-10-25: trim → collapse inner whitespace → lower. No alias merging.
  normalized_name text generated always as (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) stored,
  -- true = added directly in the skill list; false = created from a project tag.
  is_manual boolean not null default true,
  proficiency text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint skills_id_user_id_key unique (id, user_id),
  constraint skills_user_id_normalized_name_key unique (user_id, normalized_name),
  constraint skills_name_check check (char_length(btrim(name)) between 1 and 50),
  constraint skills_proficiency_check check (proficiency in ('basic', 'practical', 'expert'))
);

alter table public.skills enable row level security;

create trigger skills_set_updated_at
  before update on public.skills
  for each row execute function private.set_updated_at();

create trigger skills_touch_career_data
  after insert or update or delete on public.skills
  for each row execute function private.touch_career_data_updated_at();

create table public.project_skills (
  project_id uuid not null,
  skill_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint project_skills_pkey primary key (project_id, skill_id),
  constraint project_skills_project_fkey foreign key (project_id, user_id)
    references public.projects (id, user_id) on delete cascade,
  constraint project_skills_skill_fkey foreign key (skill_id, user_id)
    references public.skills (id, user_id) on delete cascade
);

create index project_skills_user_id_skill_id_idx on public.project_skills (user_id, skill_id);

alter table public.project_skills enable row level security;

create trigger project_skills_touch_career_data
  after insert or update or delete on public.project_skills
  for each row execute function private.touch_career_data_updated_at();

-- A.4: a tag-created skill (is_manual = false) with no remaining project links is deleted.
-- Security definer so it also runs inside FK cascades regardless of the deleting role; it only
-- touches the skill the removed link pointed at.
create or replace function private.project_skills_delete_orphan_skill()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.skills s
   where s.id = old.skill_id
     and s.user_id = old.user_id
     and s.is_manual = false
     and not exists (select 1 from public.project_skills ps where ps.skill_id = old.skill_id);
  return null;
end;
$$;

revoke all on function private.project_skills_delete_orphan_skill() from public;

create trigger project_skills_delete_orphan_skill
  after delete on public.project_skills
  for each row execute function private.project_skills_delete_orphan_skill();

create policy skills_select_own on public.skills
  for select to authenticated using (user_id = (select auth.uid()));
create policy skills_insert_own on public.skills
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy skills_update_own on public.skills
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy skills_delete_own on public.skills
  for delete to authenticated using (user_id = (select auth.uid()));
create policy skills_select_ai_writer on public.skills
  for select to app_ai_writer using (user_id = (select private.current_uid()));

-- project_skills has no user-updatable columns (link rows are inserted or deleted).
create policy project_skills_select_own on public.project_skills
  for select to authenticated using (user_id = (select auth.uid()));
create policy project_skills_insert_own on public.project_skills
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy project_skills_delete_own on public.project_skills
  for delete to authenticated using (user_id = (select auth.uid()));
create policy project_skills_select_ai_writer on public.project_skills
  for select to app_ai_writer using (user_id = (select private.current_uid()));

grant select, delete on table public.skills to authenticated;
grant insert (id, user_id, name, is_manual, proficiency) on table public.skills to authenticated;
grant update (name, is_manual, proficiency) on table public.skills to authenticated;
grant select on table public.skills to app_ai_writer;

grant select, delete on table public.project_skills to authenticated;
grant insert (project_id, skill_id, user_id) on table public.project_skills to authenticated;
grant select on table public.project_skills to app_ai_writer;
