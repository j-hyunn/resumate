-- R15 / D2 (DM 11.8 #2, §2.5 writing_chats, CL-1·CL-A7 · v4.15 CF-1·CF-A2)
-- Third chat target: one document (the application project's cover letter). The table is extended instead of a
-- sibling table so the turn / extraction / proposal / apply rules stay in one place (CL-A7).
-- Deployment stage 2. Reversible only until the code deployment creates document chat rows (project_id not null
-- cannot come back once such a row exists — DM 11.8 (2)).

alter table public.writing_chats
  add column application_project_id uuid,
  add column document_kind text;

-- Document chats do not belong to any project (DM §2.5 ★ — the exclusive CHECK below keeps "exactly one target").
alter table public.writing_chats alter column project_id drop not null;

alter table public.writing_chats
  add constraint writing_chats_application_project_fkey
    foreign key (application_project_id, user_id)
    references public.application_projects (id, user_id) on delete cascade;

-- CHECK 1: exactly one target (a career target or a document target), never none.
alter table public.writing_chats
  add constraint writing_chats_target_check
    check (num_nonnulls(project_id, application_project_id) = 1);
-- CHECK 2: a document chat always has a kind, a non-document chat never has one.
--          (v4.15, CF-1·CF-A2) the only kind is cover_letter.
alter table public.writing_chats
  add constraint writing_chats_document_kind_check
    check ((application_project_id is null) = (document_kind is null)
           and (document_kind is null or document_kind = 'cover_letter'));
-- CHECK 3: a deliverable chat always carries its parent project (the v4.5 premise).
alter table public.writing_chats
  add constraint writing_chats_deliverable_project_check
    check (project_deliverable_id is null or project_id is not null);

-- return_target: only a career chat opened from a gate carries one (DM §2.5, 6장 U-5). Replaces the v4.5
-- deliverable-only shape.
alter table public.writing_chats drop constraint writing_chats_deliverable_return_target_check;
alter table public.writing_chats
  add constraint writing_chats_target_return_target_check
    check ((project_deliverable_id is null and application_project_id is null) or return_target is null);

-- S-46 chat history list; the application project FK cascade delete uses this index too.
create index writing_chats_application_document_last_activity_idx
  on public.writing_chats (application_project_id, document_kind, last_activity_at desc)
  where application_project_id is not null;

-- Target columns stay as inserted. authenticated has no column grant for them, so this guard is the defense for
-- the definer RPCs and the migration owner.
create or replace function private.writing_chats_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     and not (old.status = 'active' and new.status = 'closed') then
    raise exception using errcode = 'P0001', message = 'invalid_writing_chat_transition',
      detail = old.status || ' -> ' || new.status;
  end if;
  if new.project_id is distinct from old.project_id then
    raise exception using errcode = 'P0001', message = 'invalid_writing_chat_transition',
      detail = 'project_id is fixed';
  end if;
  if new.project_deliverable_id is distinct from old.project_deliverable_id then
    raise exception using errcode = 'P0001', message = 'invalid_writing_chat_transition',
      detail = 'project_deliverable_id is fixed';
  end if;
  -- R15 (CL-1): the document target columns are fixed too.
  if new.application_project_id is distinct from old.application_project_id then
    raise exception using errcode = 'P0001', message = 'invalid_writing_chat_transition',
      detail = 'application_project_id is fixed';
  end if;
  if new.document_kind is distinct from old.document_kind then
    raise exception using errcode = 'P0001', message = 'invalid_writing_chat_transition',
      detail = 'document_kind is fixed';
  end if;
  return new;
end;
$$;

-- R15 (CL-1 ★): a document chat skips the affiliated-project check — the composite FK already guarantees "the
-- caller's application project", and a document belongs to no project.
create or replace function private.writing_chats_check_target()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.application_project_id is not null then
    return new;
  end if;
  if new.project_deliverable_id is null
     and not exists (select 1 from public.projects p
                      where p.id = new.project_id and p.user_id = new.user_id
                        and num_nonnulls(p.experience_id, p.education_id) = 1) then
    raise exception using errcode = 'P0001', message = 'writing_chat_requires_affiliated_project';
  end if;
  return new;
end;
$$;

-- Deleting a chat cancels its in-flight turn. R15: document turns run as job_type = 'cover_letter'
-- (DM §2.9.1 — the same target_type 'writing_chat') `[가정]`.
create or replace function private.writing_chats_cancel_jobs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ai_jobs j
     set cancel_requested_at = now()
   where j.user_id = old.user_id
     and j.job_type in ('writing_chat_turn', 'cover_letter')
     and j.target_type = 'writing_chat' and j.target_id = old.id
     and j.status in ('queued', 'running')
     and j.cancel_requested_at is null;
  return null;
end;
$$;

grant select (application_project_id, document_kind) on public.writing_chats to authenticated;
grant select (application_project_id, document_kind) on public.writing_chats to app_ai_writer;
grant select (application_project_id, document_kind) on public.writing_chats to service_role;
