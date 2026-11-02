-- S2 career: project_details (DM §2.2, §2.3 v3, F-P1-15) — STAR episodes under a project.
-- Includes the parent projects.status recalculation (DM §2.2, §4.1) + RLS + grants.

create table public.project_details (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid not null,
  status text not null default 'draft',
  title text,
  situation text,
  task text,
  action text,
  result text,
  -- "회고 및 배운 점" (U-2): the user's reflection, never used as factual evidence (NFR-AI-06, V-8).
  learnings text,
  sort_order smallint not null,
  source_writing_chat_id uuid, -- FK to writing_chats added in S4
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_details_id_user_id_key unique (id, user_id),
  constraint project_details_project_fkey foreign key (project_id, user_id)
    references public.projects (id, user_id) on delete cascade,
  -- Deferred so a reorder can renumber inside one transaction.
  constraint project_details_project_id_sort_order_key unique (project_id, sort_order)
    deferrable initially deferred,
  constraint project_details_status_check check (status in ('draft', 'complete')),
  constraint project_details_complete_check check (
    status = 'draft' or (title is not null and situation is not null and action is not null)),
  constraint project_details_title_check check (char_length(title) <= 100),
  constraint project_details_situation_check check (char_length(situation) <= 2000),
  constraint project_details_task_check check (char_length(task) <= 2000),
  constraint project_details_action_check check (char_length(action) <= 2000),
  constraint project_details_result_check check (char_length(result) <= 2000),
  constraint project_details_learnings_check check (char_length(learnings) <= 2000),
  constraint project_details_sort_order_check check (sort_order >= 1)
);

create index project_details_user_id_draft_idx on public.project_details (user_id) where status = 'draft';
create index project_details_user_id_project_id_idx on public.project_details (user_id, project_id);

alter table public.project_details enable row level security;

-- Status: title + situation + action (DM §2.2). Also fills sort_order = last + 1 when omitted.
create or replace function private.project_details_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if nullif(btrim(new.title), '') is not null
     and nullif(btrim(new.situation), '') is not null
     and nullif(btrim(new.action), '') is not null
  then
    new.status := 'complete';
  else
    new.status := 'draft';
  end if;

  if tg_op = 'INSERT' and new.sort_order is null then
    select coalesce(max(d.sort_order), 0) + 1 into new.sort_order
      from public.project_details d
     where d.project_id = new.project_id;
  end if;

  return new;
end;
$$;

revoke all on function private.project_details_before_write() from public;

create trigger project_details_before_write
  before insert or update on public.project_details
  for each row execute function private.project_details_before_write();

-- updated_at marks content changes for evidence chips ("변경됨"); a pure reorder is not one.
create or replace function private.project_details_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'sort_order' - 'updated_at') is distinct from
     (to_jsonb(old) - 'sort_order' - 'updated_at') then
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

revoke all on function private.project_details_set_updated_at() from public;

create trigger project_details_set_updated_at
  before update on public.project_details
  for each row execute function private.project_details_set_updated_at();

-- Parent recalculation (DM §2.2 projects row, §4.1 상세 내용 row). Updates the project only when
-- its status actually changes, which also bumps projects.updated_at (DM §4.2 last line).
-- Security definer: users have no update grant on projects.status.
create or replace function private.project_details_sync_project_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_ids uuid[];
begin
  if tg_op = 'INSERT' then
    v_project_ids := array[new.project_id];
  elsif tg_op = 'DELETE' then
    v_project_ids := array[old.project_id];
  else
    v_project_ids := array[new.project_id, old.project_id];
  end if;

  update public.projects p
     set status = case when private.project_is_complete(p.id, p.name, p.role)
                       then 'complete' else 'draft' end
   where p.id = any (v_project_ids)
     and p.status is distinct from
         case when private.project_is_complete(p.id, p.name, p.role) then 'complete' else 'draft' end;

  return null;
end;
$$;

revoke all on function private.project_details_sync_project_status() from public;

create trigger project_details_sync_project_status_ins_del
  after insert or delete on public.project_details
  for each row execute function private.project_details_sync_project_status();

create trigger project_details_sync_project_status_upd
  after update on public.project_details
  for each row
  when (old.status is distinct from new.status or old.project_id is distinct from new.project_id)
  execute function private.project_details_sync_project_status();

create trigger project_details_touch_career_data
  after insert or update or delete on public.project_details
  for each row execute function private.touch_career_data_updated_at();

create policy project_details_select_own on public.project_details
  for select to authenticated using (user_id = (select auth.uid()));
create policy project_details_insert_own on public.project_details
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy project_details_update_own on public.project_details
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy project_details_delete_own on public.project_details
  for delete to authenticated using (user_id = (select auth.uid()));
create policy project_details_select_ai_writer on public.project_details
  for select to app_ai_writer using (user_id = (select private.current_uid()));

grant select, delete on table public.project_details to authenticated;
grant insert (id, user_id, project_id, title, situation, task, action, result, learnings, sort_order,
              source_writing_chat_id)
  on table public.project_details to authenticated;
-- project_id is not updatable: a detail does not move between projects.
grant update (title, situation, task, action, result, learnings, sort_order)
  on table public.project_details to authenticated;
grant select on table public.project_details to app_ai_writer;
