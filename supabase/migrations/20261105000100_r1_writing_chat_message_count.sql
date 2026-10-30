-- R1 A5 (DM §2.5 v4.2 "메시지 상한 규칙", 확정 2026-11-05): message_count = user + AI messages, the fixed
-- greeting (assistant, ai_job_id null, sequence 1) is NOT counted. Before R1 the greeting counted (S4 [가정]),
-- so the real maximum was 39.
--   * start_writing_chat now starts at message_count 0 (only change in the function body).
--   * append_writing_chat_message keeps "accept while message_count <= 38" and begin_assistant_message keeps
--     "count < 40" / is_final = count > 38: user #39 + reply #40 is now reachable, and is_final is set on the
--     40th message (the reply after which no user message fits).
--   * Existing rows: subtract the greeting. Only chats whose sequence-1 row is the greeting are touched.
--     updated_at is left alone (data correction, not a user edit).

-- ── start_writing_chat ─────────────────────────────────────────────────────
-- p_return_target (gate entry, U-5): {application_project_id, feature, params?}. created_at is set here.
-- application_project_id is a soft reference (DM §2.5) checked for uuid shape only.
create or replace function public.start_writing_chat(
  p_mode text,
  p_project_id uuid default null,
  p_return_target jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_return_target jsonb;
  v_free boolean;
  v_chat_id uuid;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  if p_mode is null or p_mode not in ('new_project', 'augment_project') then
    raise exception using errcode = 'P0001', message = 'invalid_mode';
  end if;

  if p_mode = 'augment_project' then
    if p_project_id is null then
      raise exception using errcode = 'P0001', message = 'project_required';
    end if;
    if not exists (select 1 from public.projects where id = p_project_id and user_id = v_uid) then
      raise exception using errcode = 'P0001', message = 'project_not_found';
    end if;
  elsif p_project_id is not null then
    raise exception using errcode = 'P0001', message = 'project_not_allowed';
  end if;

  if p_return_target is not null and jsonb_typeof(p_return_target) <> 'null' then
    if jsonb_typeof(p_return_target) <> 'object'
       or coalesce(p_return_target ->> 'feature', '') not in ('insight', 'career_description', 'cover_letter', 'job_interview')
       or jsonb_typeof(p_return_target -> 'application_project_id') is distinct from 'string'
       or (p_return_target ->> 'application_project_id')
            !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or coalesce(jsonb_typeof(p_return_target -> 'params'), 'object') not in ('object', 'null') then
      raise exception using errcode = 'P0001', message = 'invalid_return_target';
    end if;
    v_return_target := jsonb_build_object(
      'application_project_id', lower(p_return_target ->> 'application_project_id'),
      'feature', p_return_target ->> 'feature',
      'params', coalesce(nullif(p_return_target -> 'params', 'null'::jsonb), '{}'::jsonb),
      'created_at', to_jsonb(now()));
  end if;

  -- Active provider on the free tier -> stronger notice. No key is fine: starting and reading a chat
  -- don't need one (PRD 3.3); sending does.
  select exists (
    select 1 from public.profiles p
      join public.ai_provider_keys k on k.user_id = p.id and k.provider = p.active_ai_provider
     where p.id = v_uid and k.connection_tier = 'free')
    into v_free;

  insert into public.writing_chats (user_id, mode, project_id, structured_draft, message_count, return_target)
  values (v_uid, p_mode, p_project_id, private.writing_chat_empty_draft(), 0, v_return_target)
  returning id into v_chat_id;

  insert into public.writing_chat_messages (user_id, writing_chat_id, sequence, role, content, status)
  values (v_uid, v_chat_id, 1, 'assistant', private.writing_chat_greeting(p_mode, v_free), 'done');

  return v_chat_id;
end;
$$;

revoke all on function public.start_writing_chat(text, uuid, jsonb) from public, anon;
grant execute on function public.start_writing_chat(text, uuid, jsonb) to authenticated;

-- ── data fix for existing chats ────────────────────────────────────────────
alter table public.writing_chats disable trigger writing_chats_set_updated_at;

update public.writing_chats w
   set message_count = w.message_count - 1
 where w.message_count > 0
   and exists (select 1 from public.writing_chat_messages m
                where m.writing_chat_id = w.id and m.sequence = 1 and m.role = 'assistant'
                  and m.ai_job_id is null);

alter table public.writing_chats enable trigger writing_chats_set_updated_at;
