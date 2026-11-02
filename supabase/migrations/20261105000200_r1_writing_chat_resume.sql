-- R1 A6 (DM §2.5 v4.2 상태 전이, §3.4, §5; 확정 2026-11-05): an abandoned chat can be resumed
-- (abandoned -> active) by the user session while the row exists (90-day cleanup for unlinked chats).
-- Allowed transitions now:
--   active    -> saved / handed_off   save_writing_chat / hand_off_writing_chat (definer helper, not the user role)
--   active    -> abandoned            user session (그만두기)
--   abandoned -> active               user session (다시 이어 하기); last_activity_at = now() [가정 DM §2.5],
--                                      which also restarts the 90-day cleanup clock (DM §3.4)
-- saved / handed_off stay terminal for every role (read-only archive, D-27 (a)). Everything else is refused.
-- Resuming needs no AI call and no usage record; message_count carries over (DM §2.5).
-- The user has no UPDATE grant on last_activity_at, so the trigger sets it.

create or replace function private.writing_chats_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if old.status in ('saved', 'handed_off') then
      raise exception using errcode = 'P0001', message = 'invalid_writing_chat_transition',
        detail = old.status || ' -> ' || new.status;
    end if;

    if old.status = 'abandoned' then
      -- A6: the only way out of abandoned is back to active.
      if new.status <> 'active' then
        raise exception using errcode = 'P0001', message = 'invalid_writing_chat_transition',
          detail = old.status || ' -> ' || new.status;
      end if;
      new.last_activity_at := now();
    elsif current_user = 'authenticated' and new.status <> 'abandoned' then
      -- From active, the user session may only abandon; saved / handed_off come from the definer helper.
      raise exception using errcode = 'P0001', message = 'invalid_writing_chat_transition',
        detail = old.status || ' -> ' || new.status;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.writing_chats_guard() from public;
