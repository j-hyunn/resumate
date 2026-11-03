-- R5 projects.updated_at (DM v4.5 §2.3 "updated_at 규칙", UX DM-8): updated_at is the expected version of the S-10
-- page save (save_project_page p_expected_updated_at -> stale_write). An update that changes only
-- source_writing_chat_id — the page save recording its source chat, or the FK `set null` when a chat is deleted
-- from the panel — keeps updated_at, so it never makes an open page's save stale. R4 kept it only for the
-- set-null case; this covers any source-only change. Same trigger (runs after projects_set_updated_at).

create or replace function private.keep_updated_at_on_source_unlink()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source_writing_chat_id is distinct from old.source_writing_chat_id
     and (to_jsonb(new) - array['updated_at', 'source_writing_chat_id', 'kind'])
         = (to_jsonb(old) - array['updated_at', 'source_writing_chat_id', 'kind'])
  then
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

revoke all on function private.keep_updated_at_on_source_unlink() from public;
