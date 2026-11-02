-- R1 A7 (DM 6.1 "탈퇴 미완료 상태의 서버 판정" v4.2, UX FL-07·S-25; 확정 2026-11-05).
-- get_account_deletion_state(p_user_id, p_subject_hash) -> text
--   'active'              profiles row exists
--   'deletion_incomplete' no profiles row + an account_deletion_logs row with this subject_hash
--                         (delete_account committed the public deletion; only the auth.users delete failed)
--   'profile_missing'     neither (signup trigger missing -> app logs an error, generic error screen [가정])
-- Executed only by service_role (server-only role, same pattern as the A19 key RPCs): users can't read
-- account_deletion_logs, and the HMAC secret behind subject_hash never reaches the browser or the DB.
-- Deviation from DM 6.1 (signature lists only p_user_id): the DB can't compute the hash because the HMAC secret
-- lives only on the server (S9 delete_account(p_subject_hash) works the same way). The server passes the hash
-- computed with the same function / secret it uses for delete_account. Logged in spec-gaps (2026-11-05 R1 db).
-- The hash is always validated, even when the profile exists, so a caller bug shows up on the normal path too.
-- Errors: P0001 invalid_user_id, invalid_subject_hash.

create or replace function public.get_account_deletion_state(p_user_id uuid, p_subject_hash text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_user_id';
  end if;
  if p_subject_hash is null or p_subject_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'invalid_subject_hash';
  end if;

  if exists (select 1 from public.profiles p where p.id = p_user_id) then
    return 'active';
  end if;
  if exists (select 1 from public.account_deletion_logs l where l.subject_hash = p_subject_hash) then
    return 'deletion_incomplete';
  end if;
  return 'profile_missing';
end;
$$;

revoke all on function public.get_account_deletion_state(uuid, text)
  from public, anon, authenticated, app_ai_writer, app_key_reader;
grant execute on function public.get_account_deletion_state(uuid, text) to service_role;
