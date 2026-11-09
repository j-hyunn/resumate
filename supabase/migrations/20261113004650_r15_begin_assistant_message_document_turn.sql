-- R15 수정 (backend-qa QA-01 [Critical], 2026-11-09) — 서류 대화 턴의 assistant 메시지 시작
-- public.begin_assistant_message pinned the turn's job to `job_type = 'writing_chat_turn'`. A document turn runs
-- as **`job_type = 'cover_letter'`** (DM §2.9.1 — "서류 작성 대화의 턴 1회"), which this slice's
-- ai_jobs_document_chat_turn_check (20261113003300) now REQUIRES for a writing_chat target. So every document
-- turn — question turns and draft turns alike — died with `invalid_ai_job` right after the user message was
-- stored. The fix belongs here, not in turn.ts: sending `writing_chat_turn` for a document turn would violate
-- that CHECK (and would detach the turn from the application project the usage meter and the board need).
--   Allowed from here on: `writing_chat_turn` (STAR / deliverable chats) and `cover_letter` (document chats).
--   `career_description` is NOT added — no new row of that job_type is created (CF-1·CF-A3); the past rows carry
--   target_type = 'draft' and never reach this RPC.
-- Checked at the same time (no change needed): private.writing_chats_cancel_jobs already takes both values
-- (20261113003200), finish_assistant_message / mark_writing_chat_extracted / complete_ai_job do not look at
-- job_type, and retry_ai_job deliberately allows `insight` only (a document turn is re-sent as a new turn,
-- DM §2.9.1 "같은 행 다시 시도 대상이 아닌 작업"). Nothing else in public / private pins job_type this way.
create or replace function public.begin_assistant_message(p_writing_chat_id uuid, p_ai_job_id uuid,
  p_provider text, p_model text, p_model_tier text, p_connection_tier text)
returns table(message_id uuid, sequence smallint, message_count smallint, reused boolean, is_final boolean)
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
    raise exception using errcode = 'P0001', message = 'writing_chat_closed';
  end if;

  if p_provider is null or p_provider not in ('openai', 'gemini', 'anthropic')
     or p_model_tier is null or p_model_tier not in ('light', 'default', 'heavy')
     or p_connection_tier is null or p_connection_tier not in ('free', 'paid')
     or nullif(btrim(p_model), '') is null then
    raise exception using errcode = 'P0001', message = 'invalid_ai_metadata';
  end if;

  -- R15 (QA-01): a document turn is a `cover_letter` job on a writing_chat target.
  if not exists (
    select 1 from public.ai_jobs j
     where j.id = p_ai_job_id and j.user_id = v_uid
       and j.job_type in ('writing_chat_turn', 'cover_letter')
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
