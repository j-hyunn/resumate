-- S4: source_writing_chat_id FKs on projects / project_details / achievements (QA-S2-07, DM §3.4, §4.1).
-- Composite (source_writing_chat_id, user_id) -> writing_chats(id, user_id); deleting the chat only
-- clears the column ("대화만 삭제" keeps the saved career rows).
-- Clearing the link is not a content change: updated_at stays, so evidence chips don't show "변경됨"
-- after a chat-only deletion [구현 결정].

alter table public.projects
  add constraint projects_source_writing_chat_fkey foreign key (source_writing_chat_id, user_id)
    references public.writing_chats (id, user_id) on delete set null (source_writing_chat_id);
alter table public.project_details
  add constraint project_details_source_writing_chat_fkey foreign key (source_writing_chat_id, user_id)
    references public.writing_chats (id, user_id) on delete set null (source_writing_chat_id);
alter table public.achievements
  add constraint achievements_source_writing_chat_fkey foreign key (source_writing_chat_id, user_id)
    references public.writing_chats (id, user_id) on delete set null (source_writing_chat_id);

create index projects_source_writing_chat_id_idx on public.projects (source_writing_chat_id)
  where source_writing_chat_id is not null;
create index project_details_source_writing_chat_id_idx on public.project_details (source_writing_chat_id)
  where source_writing_chat_id is not null;
create index achievements_source_writing_chat_id_idx on public.achievements (source_writing_chat_id)
  where source_writing_chat_id is not null;

-- Runs after the tables' own updated_at triggers (trigger names sort after *_set_updated_at).
create or replace function private.keep_updated_at_on_source_unlink()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.source_writing_chat_id is not null and new.source_writing_chat_id is null
     and (to_jsonb(new) - array['updated_at', 'source_writing_chat_id', 'kind'])
         = (to_jsonb(old) - array['updated_at', 'source_writing_chat_id', 'kind'])
  then
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

revoke all on function private.keep_updated_at_on_source_unlink() from public;

create trigger projects_source_unlink_keep_updated_at
  before update of source_writing_chat_id on public.projects
  for each row execute function private.keep_updated_at_on_source_unlink();
create trigger project_details_source_unlink_keep_updated_at
  before update of source_writing_chat_id on public.project_details
  for each row execute function private.keep_updated_at_on_source_unlink();
create trigger achievements_source_unlink_keep_updated_at
  before update of source_writing_chat_id on public.achievements
  for each row execute function private.keep_updated_at_on_source_unlink();

-- save_writing_chat / hand_off_writing_chat (security invoker) mark the existing rows they fill in
-- augment_project mode (DM §3.3 "생성·수정한 행에 source_writing_chat_id").
grant update (source_writing_chat_id) on table public.projects to authenticated;
grant update (source_writing_chat_id) on table public.project_details to authenticated;
