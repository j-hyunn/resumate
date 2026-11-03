-- R5 (DM v4.5 §2.5, §2.5.1, §3.3, §3.7; PA-3, AI DA-7, UX DM-3): [반영] is a form fill on the screen, and the
-- "반영됨" record is written by the page-save RPCs in the same transaction as the career write.
--   * apply_writing_chat_proposal (and its execute grant) is dropped with its helpers wc_proposal_lock /
--     wc_proposal_mark_applied.
--   * private.wc_mark_proposal_applied(p_writing_chat_id, p_target_kind, p_target_id, p_field, p_rev, p_mode)
--     judges (not_found / already_applied / proposal_changed / needs_review) and records one proposal.
--   * private.projects_set_source_writing_chat(p_project_id, p_writing_chat_id): the chat that last applied.
-- Both are security definer (no user grant on structured_draft / last_applied_at / source_writing_chat_id) and
-- live in `private` (not exposed through the API); the invoker save RPCs call them as the user.

drop function public.apply_writing_chat_proposal(uuid, text[]);
drop function private.wc_proposal_mark_applied(uuid, text[]);
drop function private.wc_proposal_lock(uuid);

-- Returns null when recorded, otherwise the skipped reason: not_found (chat / field missing, chat is not this
-- target's) / already_applied / proposal_changed (rev differs) / needs_review / invalid_entry (bad target kind or
-- field / mode). Locks the chat row (callers lock the career row first, DM §2.5.1 lock order).
create or replace function private.wc_mark_proposal_applied(p_writing_chat_id uuid, p_target_kind text,
                                                            p_target_id uuid, p_field text, p_rev integer,
                                                            p_mode text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_chat public.writing_chats%rowtype;
  v_draft jsonb;
  v_section text;
  v_path text[];
  v_obj jsonb;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_target_kind is null or p_target_kind not in ('project', 'project_deliverable') or p_rev is null then
    return 'invalid_entry';
  end if;

  select * into v_chat from public.writing_chats w
   where w.id = p_writing_chat_id and w.user_id = v_uid
     for update;
  if not found then
    return 'not_found';
  end if;

  if p_target_kind = 'project' then
    v_section := case
      when p_field in ('situation', 'task', 'action', 'result', 'learnings') then 'star'
      when p_field in ('start_month', 'end_month') then 'project'
      when p_field in ('project_type', 'experience_type', 'competencies') then 'classification'
    end;
    if v_section is null then
      return 'invalid_entry';
    end if;
    if v_chat.project_id is distinct from p_target_id or v_chat.project_deliverable_id is not null then
      return 'not_found';
    end if;
    v_draft := private.wc_normalize_draft(v_chat.structured_draft);
    v_path := array[v_section, p_field];
  else
    if p_mode is null or p_mode not in ('replace', 'append') then
      return 'invalid_entry';
    end if;
    if v_chat.project_deliverable_id is distinct from p_target_id then
      return 'not_found';
    end if;
    v_draft := private.wc_normalize_deliverable_draft(v_chat.structured_draft);
    v_path := array['deliverable', 'body'];
  end if;

  v_obj := v_draft #> v_path;
  if jsonb_typeof(v_obj) is distinct from 'object' or v_obj = '{}'::jsonb then
    return 'not_found';
  end if;
  if coalesce(jsonb_typeof(v_obj -> 'applied_at'), 'null') <> 'null' then
    return 'already_applied';
  end if;
  if private.wc_rev(v_obj) <> p_rev then
    return 'proposal_changed';
  end if;
  if coalesce(jsonb_typeof(v_obj -> 'value'), 'null') = 'null' then
    return 'not_found';
  end if;

  if p_target_kind = 'project' then
    if coalesce(v_obj ->> 'review', 'ok') not in ('ok', 'accepted') then
      return 'needs_review';
    end if;
    v_obj := v_obj || jsonb_build_object('applied_at', v_now);
  else
    -- Deliverable: skipped only when no content block can be filled (unaccepted needs_review blocks were already
    -- left out by the fill, DM §2.5.1 / §3.3).
    if not exists (select 1 from jsonb_array_elements(coalesce(v_obj -> 'blocks', '[]'::jsonb)) b
                    where b ->> 'type' <> 'heading' and coalesce(b ->> 'review', 'ok') in ('ok', 'accepted')) then
      return 'needs_review';
    end if;
    v_obj := v_obj || jsonb_build_object('applied_at', v_now, 'applied_mode', p_mode, 'applied_rev', p_rev);
  end if;

  update public.writing_chats w
     set structured_draft = jsonb_set(v_draft, v_path, v_obj),
         last_applied_at = v_now, last_activity_at = v_now
   where w.id = p_writing_chat_id;
  return null;
end;
$$;

revoke all on function private.wc_mark_proposal_applied(uuid, text, uuid, text, integer, text) from public;
-- Called by the security-invoker save RPCs (user session); `private` is not exposed through the API.
grant execute on function private.wc_mark_proposal_applied(uuid, text, uuid, text, integer, text) to authenticated;

-- projects.source_writing_chat_id = the chat whose proposal was recorded last (DM §2.3 v4.5). Only a STAR chat of
-- this project; updated_at stays (projects_source_unlink_keep_updated_at, R5).
create or replace function private.projects_set_source_writing_chat(p_project_id uuid, p_writing_chat_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  update public.projects p
     set source_writing_chat_id = p_writing_chat_id
   where p.id = p_project_id and p.user_id = v_uid
     and p.source_writing_chat_id is distinct from p_writing_chat_id
     and exists (select 1 from public.writing_chats w
                  where w.id = p_writing_chat_id and w.user_id = v_uid and w.project_id = p_project_id
                    and w.project_deliverable_id is null);
end;
$$;

revoke all on function private.projects_set_source_writing_chat(uuid, uuid) from public;
grant execute on function private.projects_set_source_writing_chat(uuid, uuid) to authenticated;
