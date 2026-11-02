-- R4 writing chat message RPCs (DM v4.4 §2.5 writing_chat_messages):
--   append_writing_chat_message: closed chat -> writing_chat_closed; the first user message fills title.
--   begin_assistant_message: closed chat -> writing_chat_closed.
--   finish_assistant_message: closes the chat when the cap is reached (active -> closed).
-- Bodies are the previous definitions with only these edits; signatures and grants are unchanged.

CREATE OR REPLACE FUNCTION public.append_writing_chat_message(p_writing_chat_id uuid, p_content text)
 RETURNS TABLE(message_id uuid, sequence smallint, message_count smallint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    -- v4.4: the only other status is closed (message cap reached).
    raise exception using errcode = 'P0001', message = 'writing_chat_closed';
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

  -- v4.4: the first user message names the chat (first 30 chars, whitespace collapsed; no AI call) [가정].
  update public.writing_chats w
     set message_count = w.message_count + 1, last_activity_at = now(),
         title = coalesce(w.title, left(regexp_replace(v_content, '\s+', ' ', 'g'), 30))
   where w.id = p_writing_chat_id;

  message_id := v_id;
  sequence := v_seq;
  message_count := v_chat.message_count + 1;
  return next;
end;
$function$;

CREATE OR REPLACE FUNCTION public.begin_assistant_message(p_writing_chat_id uuid, p_ai_job_id uuid, p_provider text, p_model text, p_model_tier text, p_connection_tier text)
 RETURNS TABLE(message_id uuid, sequence smallint, message_count smallint, reused boolean, is_final boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    raise exception using errcode = 'P0001', message = 'writing_chat_closed';
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
$function$;

CREATE OR REPLACE FUNCTION public.finish_assistant_message(p_message_id uuid, p_status text, p_content text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- v4.4 (DM §2.5): active -> closed once no further user message fits (message_count > 38) and this reply
  -- completed. A failed final reply keeps the chat active so "다시 보내기" can regenerate it.
  update public.writing_chats w
     set last_activity_at = now(),
         status = case when p_status = 'done' and w.message_count > 38 then 'closed' else w.status end
   where w.id = v_msg.writing_chat_id;
end;
$function$;
