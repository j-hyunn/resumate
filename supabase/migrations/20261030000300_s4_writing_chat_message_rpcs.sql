-- S4 writing chat lifecycle + message RPCs (DM §2.5, §7; AI-12 저장; UX S-36).
--   start_writing_chat            authenticated  definer  chat row + fixed greeting (no AI call)
--   append_writing_chat_message   authenticated  definer  user message, cap check, message_count
--   begin_assistant_message       app_ai_writer  definer  streaming assistant row (or reuse failed = 다시 보내기)
--   finish_assistant_message      app_ai_writer  definer  streaming -> done / failed
--   mark_writing_chat_extracted   app_ai_writer  definer  last_extracted_sequence (monotonic)
-- append is definer although DM §5 lists it as invoker: an invoker version needs a direct INSERT grant on
-- messages and UPDATE on message_count, which DM §5 does not give the user (spec-gaps 2026-10-30 S4 DB).
-- Every definer function checks ownership with auth.uid() first.
--
-- Message cap (D-34, [가정] spec-gaps 2026-10-30 ②): the greeting counts (1). A user message is accepted
-- only while message_count <= 38, so the AI reply to it always fits (<= 40); assistant rows need
-- message_count <= 39. 다시 보내기 reuses the failed assistant row and doesn't count (UX S-36 [가정]).

create or replace function private.writing_chat_empty_draft()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'schema_version', 1,
    'project', '{}'::jsonb,
    'affiliation_suggestion', null,
    'details', '[]'::jsonb,
    'skills', '[]'::jsonb,
    'clarifications', '[]'::jsonb,
    'sensitive_flags_count', 0);
$$;

revoke all on function private.writing_chat_empty_draft() from public;
grant execute on function private.writing_chat_empty_draft() to authenticated, app_ai_writer;

-- Fixed greeting (AI-12: no AI call). Includes the sensitive-information notice (NFR-PRV-05, UX G-2);
-- free tier adds a stronger notice (AI C-7 [가정]).
create or replace function private.writing_chat_greeting(p_mode text, p_free_tier boolean)
returns text
language sql
immutable
set search_path = ''
as $$
  select
    case p_mode
      when 'augment_project' then
        '안녕하세요! 이 프로젝트에 상세 내용을 더하거나 비어 있는 칸을 함께 채워 볼게요. '
        || '질문에 답해 주시면 상황·과제·행동·결과·회고 및 배운 점으로 정리해 드려요. '
        || '이미 쓰신 내용은 바꾸지 않고, 말씀하지 않은 내용은 쓰지 않아요. 저장하기 전에 직접 확인하고 고칠 수 있어요.'
      else
        '안녕하세요! 프로젝트 하나를 함께 정리해 볼게요. '
        || '질문에 답해 주시면 프로젝트 정보와 상세 내용(상황·과제·행동·결과·회고 및 배운 점)으로 정리해 드려요. '
        || '말씀하지 않은 내용은 쓰지 않아요. 저장하기 전에 직접 확인하고 고칠 수 있어요.'
    end
    || E'\n\n'
    || '건강·종교·노조 활동 같은 민감정보, 동료·고객의 개인정보, 회사 기밀은 말하지 말아 주세요.'
    || case when p_free_tier
         then ' 지금 연결된 AI는 무료 등급이라 입력한 내용이 공급자의 서비스 개선에 쓰일 수 있어요. 민감한 내용은 특히 조심해 주세요.'
         else '' end
    || E'\n\n'
    || case p_mode
         when 'augment_project' then '먼저, 이 프로젝트에서 정리하고 싶은 일이나 에피소드를 알려 주세요.'
         else '먼저, 어떤 프로젝트였는지, 언제 어디에서 하셨는지 알려 주세요.'
       end;
$$;

revoke all on function private.writing_chat_greeting(text, boolean) from public;


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
  values (v_uid, p_mode, p_project_id, private.writing_chat_empty_draft(), 1, v_return_target)
  returning id into v_chat_id;

  insert into public.writing_chat_messages (user_id, writing_chat_id, sequence, role, content, status)
  values (v_uid, v_chat_id, 1, 'assistant', private.writing_chat_greeting(p_mode, v_free), 'done');

  return v_chat_id;
end;
$$;

revoke all on function public.start_writing_chat(text, uuid, jsonb) from public, anon;
grant execute on function public.start_writing_chat(text, uuid, jsonb) to authenticated;


-- ── live streaming turn (QA-S4-04) ─────────────────────────────────────────
-- An assistant row still counts as "in progress" only while it is streaming, was touched within 2 minutes,
-- and its turn job (if any) is not finished. Otherwise it is a dead turn: resend reuses it, a new turn closes it.
create or replace function private.writing_chat_message_is_live(p_msg public.writing_chat_messages)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_msg.role = 'assistant' and p_msg.status = 'streaming'
     and p_msg.updated_at >= now() - interval '2 minutes'
     and not exists (select 1 from public.ai_jobs j
                      where j.id = p_msg.ai_job_id and j.status in ('succeeded', 'failed', 'canceled'));
$$;

revoke all on function private.writing_chat_message_is_live(public.writing_chat_messages) from public;

-- ── append_writing_chat_message ────────────────────────────────────────────
create or replace function public.append_writing_chat_message(p_writing_chat_id uuid, p_content text)
returns table (message_id uuid, sequence smallint, message_count smallint)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_chat public.writing_chats%rowtype;
  v_content text := btrim(p_content);
  v_seq smallint;
  v_id uuid;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  select * into v_chat from public.writing_chats w
   where w.id = p_writing_chat_id and w.user_id = v_uid
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'writing_chat_not_found';
  end if;
  if v_chat.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'writing_chat_not_active';
  end if;

  if v_content is null or v_content = '' or char_length(v_content) > 4000 then
    raise exception using errcode = 'P0001', message = 'invalid_content';
  end if;

  -- QA-S4-04: one turn at a time (two tabs can't interleave a user message into a running turn).
  if exists (select 1 from public.writing_chat_messages m
              where m.writing_chat_id = p_writing_chat_id and private.writing_chat_message_is_live(m)) then
    raise exception using errcode = 'P0001', message = 'turn_in_progress';
  end if;

  -- Keep room for the AI reply to this message (cap 40 = user + AI).
  if v_chat.message_count > 38 then
    raise exception using errcode = 'P0001', message = 'message_limit_reached';
  end if;

  select coalesce(max(m.sequence), 0) + 1 into v_seq
    from public.writing_chat_messages m where m.writing_chat_id = p_writing_chat_id;

  insert into public.writing_chat_messages (user_id, writing_chat_id, sequence, role, content, status)
  values (v_uid, p_writing_chat_id, v_seq, 'user', v_content, 'done')
  returning id into v_id;

  update public.writing_chats w
     set message_count = w.message_count + 1, last_activity_at = now()
   where w.id = p_writing_chat_id;

  message_id := v_id;
  sequence := v_seq;
  message_count := v_chat.message_count + 1;
  return next;
end;
$$;

revoke all on function public.append_writing_chat_message(uuid, text) from public, anon;
grant execute on function public.append_writing_chat_message(uuid, text) to authenticated;


-- ── begin_assistant_message ────────────────────────────────────────────────
-- Needs a pending user turn: the last message is a user message (new reply) or a failed assistant
-- message (다시 보내기: same row back to streaming, message_count unchanged). A live streaming assistant row
-- (private.writing_chat_message_is_live) means another turn is running (turn_in_progress); a dead one (older
-- than 2 minutes, or its job already finished) is reused like a failed one.
create or replace function public.begin_assistant_message(
  p_writing_chat_id uuid,
  p_ai_job_id uuid,
  p_provider text,
  p_model text,
  p_model_tier text,
  p_connection_tier text
)
returns table (message_id uuid, sequence smallint, message_count smallint, reused boolean, is_final boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_chat public.writing_chats%rowtype;
  v_last public.writing_chat_messages%rowtype;
  v_count smallint;
  v_seq smallint;
  v_id uuid;
  v_reused boolean := false;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  select * into v_chat from public.writing_chats w
   where w.id = p_writing_chat_id and w.user_id = v_uid
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'writing_chat_not_found';
  end if;
  if v_chat.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'writing_chat_not_active';
  end if;

  if p_provider is null or p_provider not in ('openai', 'gemini', 'anthropic')
     or p_model_tier is null or p_model_tier not in ('light', 'default', 'heavy')
     or p_connection_tier is null or p_connection_tier not in ('free', 'paid')
     or nullif(btrim(p_model), '') is null then
    raise exception using errcode = 'P0001', message = 'invalid_ai_metadata';
  end if;

  if not exists (
    select 1 from public.ai_jobs j
     where j.id = p_ai_job_id and j.user_id = v_uid and j.job_type = 'writing_chat_turn'
       and j.target_type = 'writing_chat' and j.target_id = p_writing_chat_id) then
    raise exception using errcode = 'P0001', message = 'invalid_ai_job';
  end if;

  select * into v_last from public.writing_chat_messages m
   where m.writing_chat_id = p_writing_chat_id
   order by m.sequence desc
   limit 1;

  v_count := v_chat.message_count;

  if v_last.role = 'assistant'
     and (v_last.status = 'failed'
          or (v_last.status = 'streaming' and not private.writing_chat_message_is_live(v_last))) then
    update public.writing_chat_messages m
       set status = 'streaming', content = '', ai_job_id = p_ai_job_id, provider = p_provider,
           model = p_model, model_tier = p_model_tier, connection_tier = p_connection_tier
     where m.id = v_last.id;
    v_id := v_last.id;
    v_seq := v_last.sequence;
    v_reused := true;
  elsif v_last.role = 'assistant' and v_last.status = 'streaming' then
    raise exception using errcode = 'P0001', message = 'turn_in_progress';
  elsif v_last.role is distinct from 'user' then
    raise exception using errcode = 'P0001', message = 'no_pending_user_message';
  else
    if v_count >= 40 then
      raise exception using errcode = 'P0001', message = 'message_limit_reached';
    end if;
    -- Older dead streaming rows (a turn that never finished) can't stay "streaming" behind the new one.
    update public.writing_chat_messages m set status = 'failed'
     where m.writing_chat_id = p_writing_chat_id and m.role = 'assistant' and m.status = 'streaming';
    v_seq := v_last.sequence + 1;
    insert into public.writing_chat_messages (user_id, writing_chat_id, sequence, role, content, status,
                                              ai_job_id, provider, model, model_tier, connection_tier)
    values (v_uid, p_writing_chat_id, v_seq, 'assistant', '', 'streaming',
            p_ai_job_id, p_provider, p_model, p_model_tier, p_connection_tier)
    returning id into v_id;
    v_count := v_count + 1;
  end if;

  update public.writing_chats w
     set message_count = v_count, last_activity_at = now()
   where w.id = p_writing_chat_id;

  message_id := v_id;
  sequence := v_seq;
  message_count := v_count;
  reused := v_reused;
  -- No further user message fits after this reply: the reply should wrap up (AI-12 상한 안내).
  is_final := v_count > 38;
  return next;
end;
$$;

revoke all on function public.begin_assistant_message(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.begin_assistant_message(uuid, uuid, text, text, text, text) to app_ai_writer;


-- ── finish_assistant_message ───────────────────────────────────────────────
-- done needs non-blank content; failed keeps whatever streamed so far (C-6: 받은 부분 보존).
-- Allowed after the chat was saved / abandoned mid-stream, so the row never stays streaming.
create or replace function public.finish_assistant_message(p_message_id uuid, p_status text, p_content text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_msg public.writing_chat_messages%rowtype;
  v_content text := coalesce(p_content, '');
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  if p_status is null or p_status not in ('done', 'failed') then
    raise exception using errcode = 'P0001', message = 'invalid_message_status';
  end if;

  select * into v_msg from public.writing_chat_messages m
   where m.id = p_message_id and m.user_id = v_uid
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'message_not_found';
  end if;
  if v_msg.role <> 'assistant' or v_msg.status <> 'streaming' then
    raise exception using errcode = 'P0001', message = 'invalid_message_state';
  end if;

  if char_length(v_content) > 4000 or (p_status = 'done' and btrim(v_content) = '') then
    raise exception using errcode = 'P0001', message = 'invalid_content';
  end if;

  update public.writing_chat_messages m
     set status = p_status, content = v_content
   where m.id = p_message_id;

  update public.writing_chats w set last_activity_at = now() where w.id = v_msg.writing_chat_id;
end;
$$;

revoke all on function public.finish_assistant_message(uuid, text, text) from public, anon;
grant execute on function public.finish_assistant_message(uuid, text, text) to app_ai_writer;


-- ── mark_writing_chat_extracted ────────────────────────────────────────────
-- After a successful extract: user messages with sequence <= p_sequence are processed. Never moves back.
-- Returns the stored value.
create or replace function public.mark_writing_chat_extracted(p_writing_chat_id uuid, p_sequence smallint)
returns smallint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_current smallint;
  v_max smallint;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  select w.last_extracted_sequence into v_current from public.writing_chats w
   where w.id = p_writing_chat_id and w.user_id = v_uid
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'writing_chat_not_found';
  end if;

  select coalesce(max(m.sequence), 0) into v_max
    from public.writing_chat_messages m where m.writing_chat_id = p_writing_chat_id;
  if p_sequence is null or p_sequence < 0 or p_sequence > v_max then
    raise exception using errcode = 'P0001', message = 'invalid_sequence';
  end if;

  if p_sequence > v_current then
    update public.writing_chats w set last_extracted_sequence = p_sequence where w.id = p_writing_chat_id;
    return p_sequence;
  end if;
  return v_current;
end;
$$;

revoke all on function public.mark_writing_chat_extracted(uuid, smallint) from public, anon;
grant execute on function public.mark_writing_chat_extracted(uuid, smallint) to app_ai_writer;
