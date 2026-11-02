-- R4 projects v4.4 (DM §2.2, §2.3 projects; CR-2, CR-7, CR-9, CR-10, CR-15, CR-17, CR-22).
--   * affiliated project (experience_id or education_id): STAR 5 columns + 3 classifications.
--   * standalone project (neither): role, description, link_url (+ deliverables, skills in other tables).
--   * completion: affiliated = name + situation + action; standalone = name + description (no child lookups).
-- The table is empty at this point (20261109100100_r4_clear_career_chat_data).

-- Immutable helper for "no duplicates" CHECKs on text arrays (competencies).
create or replace function private.text_array_is_distinct(p text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is null or cardinality(p) = (select count(distinct x) from unnest(p) x);
$$;

revoke all on function private.text_array_is_distinct(text[]) from public;
-- Evaluated by the projects CHECK under the writing role (user session; service_role for operator fixes).
grant execute on function private.text_array_is_distinct(text[]) to authenticated, service_role;

-- ── columns ──
alter table public.projects drop constraint projects_complete_check;
alter table public.projects drop constraint projects_summary_check;
alter table public.projects drop constraint projects_team_size_check;
alter table public.projects drop column summary;
alter table public.projects drop column team_size;

alter table public.projects
  alter column name set not null,
  add column is_current boolean not null default false,
  add column project_type text,
  add column experience_type text,
  add column competencies text[] not null default '{}',
  add column situation text,
  add column task text,
  add column action text,
  add column result text,
  add column learnings text,
  add column description text,
  add column link_url text,
  add column content_updated_at timestamptz not null default now();

-- ── CHECKs ──
alter table public.projects
  add constraint projects_name_check check (btrim(name) <> ''),
  -- CR-22: "진행 중" means no end month.
  add constraint projects_is_current_check check (not is_current or end_month is null),
  -- CR-17 / PRD F-P1-19: classification keys (display names live in the app).
  add constraint projects_project_type_check check (project_type in (
    'new_build', 'improvement', 'operation', 'research', 'marketing', 'process_improvement', 'migration',
    'coursework', 'other')),
  add constraint projects_experience_type_check check (experience_type in (
    'impact', 'problem_solving', 'collaboration', 'leadership', 'failure_recovery', 'new_challenge',
    'customer_facing')),
  add constraint projects_competencies_check check (
    array_position(competencies, null) is null
    and cardinality(competencies) <= 3
    and private.text_array_is_distinct(competencies)
    and competencies <@ array['problem_solving', 'analysis', 'planning', 'execution', 'communication',
                              'collaboration', 'leadership', 'technical_expertise', 'customer_insight',
                              'learning_agility']::text[]),
  add constraint projects_situation_check check (char_length(situation) <= 2000),
  add constraint projects_task_check check (char_length(task) <= 2000),
  add constraint projects_action_check check (char_length(action) <= 2000),
  add constraint projects_result_check check (char_length(result) <= 2000),
  add constraint projects_learnings_check check (char_length(learnings) <= 2000),
  add constraint projects_description_check check (char_length(description) <= 5000),
  add constraint projects_link_url_check check (char_length(link_url) <= 2048 and link_url ~* '^https?://'),
  -- DM-20: a standalone project has no STAR, classifications or chat.
  add constraint projects_standalone_shape_check check (
    num_nonnulls(experience_id, education_id) = 1
    or (situation is null and task is null and action is null and result is null and learnings is null
        and project_type is null and experience_type is null and competencies = '{}'
        and source_writing_chat_id is null)),
  -- DM-20: an affiliated project has no role / description / link.
  add constraint projects_affiliated_shape_check check (
    num_nonnulls(experience_id, education_id) = 0
    or (role is null and description is null and link_url is null)),
  -- DM-20: completion (blank-only values are treated as empty by projects_set_status).
  add constraint projects_complete_check check (
    status = 'draft'
    or (case when num_nonnulls(experience_id, education_id) = 1
             then situation is not null and action is not null
             else description is not null end));

-- ── FKs: deleting an experience / education now deletes its projects (CR-15, DM §2.3) ──
alter table public.projects drop constraint projects_experience_fkey;
alter table public.projects drop constraint projects_education_fkey;
alter table public.projects
  add constraint projects_experience_fkey foreign key (experience_id, user_id)
    references public.experiences (id, user_id) on delete cascade,
  add constraint projects_education_fkey foreign key (education_id, user_id)
    references public.educations (id, user_id) on delete cascade;

-- Career list: standalone projects (DM §2.4).
create index projects_user_id_standalone_idx on public.projects (user_id)
  where experience_id is null and education_id is null;

-- ── triggers ──
-- Completion (DM §2.2 v4.4): column rule only.
create or replace function private.projects_set_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.status := case
    when nullif(btrim(new.name), '') is null then 'draft'
    when num_nonnulls(new.experience_id, new.education_id) = 1 then
      case when nullif(btrim(new.situation), '') is not null and nullif(btrim(new.action), '') is not null
           then 'complete' else 'draft' end
    else
      case when nullif(btrim(new.description), '') is not null then 'complete' else 'draft' end
  end;
  return new;
end;
$$;

revoke all on function private.projects_set_status() from public;

-- PRD F-P1-03 (7) [가정]: experience <-> education moves are fine; affiliated <-> standalone is not.
create or replace function private.projects_guard_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (num_nonnulls(old.experience_id, old.education_id) = 0)
     is distinct from (num_nonnulls(new.experience_id, new.education_id) = 0) then
    raise exception using errcode = 'P0001', message = 'project_scope_change_not_allowed';
  end if;
  return new;
end;
$$;

revoke all on function private.projects_guard_scope() from public;

create trigger projects_guard_scope
  before update of experience_id, education_id on public.projects
  for each row execute function private.projects_guard_scope();

-- content_updated_at (DM §2.3, §2.8): moves only when an evidence-capable field changes. Classifications, link_url
-- and source_writing_chat_id do not move it ([가정] DM). Not user-writable (no grant); always derived here.
create or replace function private.projects_set_content_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.content_updated_at := now();
  elsif (new.name, new.start_month, new.end_month, new.is_current, new.situation, new.task, new.action,
         new.result, new.learnings, new.role, new.description)
        is distinct from
        (old.name, old.start_month, old.end_month, old.is_current, old.situation, old.task, old.action,
         old.result, old.learnings, old.role, old.description) then
    new.content_updated_at := now();
  else
    new.content_updated_at := old.content_updated_at;
  end if;
  return new;
end;
$$;

revoke all on function private.projects_set_content_updated_at() from public;

create trigger projects_set_content_updated_at
  before insert or update on public.projects
  for each row execute function private.projects_set_content_updated_at();

-- ── grants (user session writes; content_updated_at / status / source_writing_chat_id are derived) ──
revoke insert, update on table public.projects from authenticated;
grant insert (id, user_id, experience_id, education_id, name, role, start_month, end_month, is_current,
              project_type, experience_type, competencies, situation, task, action, result, learnings,
              description, link_url)
  on table public.projects to authenticated;
grant update (experience_id, education_id, name, role, start_month, end_month, is_current,
              project_type, experience_type, competencies, situation, task, action, result, learnings,
              description, link_url)
  on table public.projects to authenticated;
