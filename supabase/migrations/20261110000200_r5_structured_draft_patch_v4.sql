-- R5 apply_structured_draft_patch (DM v4.5 §2.5, §2.5.0; AI-12 v4.6, AI-13; AI DA-8~DA-14).
-- Signature unchanged: apply_structured_draft_patch(p_writing_chat_id uuid, p_patch jsonb) -> jsonb
-- { structured_draft, rejected: [ { index, op, reason[, fact_index] } ] }. The actor is the calling role.
-- The chat's target decides which ops are valid (project_deliverable_id null = STAR chat); an op of the other
-- target is invalid_patch.
--
-- STAR chat (structured_draft v3) — changes from R4:
--   * every field object carries `rev` (int, from 1, per slot, monotonic). +1 whenever the slot's value changes
--     (AI patch, user edit, reject / clear) and when the slot gets a new object; accept keeps it. A stored object
--     without rev reads as 1.
--   * AI op flag `new_object: true` (set / append; app_ai_writer only): replace the slot with a fresh object, never
--     concatenate onto the pending one, even a user_edit / accepted one [가정] (the server sets it only when that
--     value is already in the form). A user op with new_object is invalid_patch.
--   * V-9h: a `set` on a STAR column that already has a DB value is stored as op `append` (no rejection). Period and
--     classification "empty only" are no longer checked in the DB (classification_already_set / period
--     field_already_filled gone, for AI and users). is_current is still field_not_patchable.
--   * user clear (`set` with null value) keeps the slot as an empty object (rev + 1) instead of deleting it, so a
--     later object cannot reuse an old rev.
--
-- Deliverable chat (structured_draft target 'project_deliverable', schema_version 1, DM §2.5.0):
--   AI (chat active):
--     { op: "add_facts", facts: [ { id?, slot, text, actor, source_message_ids, source_quotes?, review? } ] }
--     { op: "replace_draft", body: { blocks, base_body_hash?, replace_allowed?, missing_slots?, dropped_block_count? } }
--       -> deliverable.body = new object (value assembled here from blocks, rev + 1, generated_at now(),
--          applied_* null), draft_count + 1
--     { op: "count_draft" }                       -- V-10 left no content block: count only
--     { op: "set_writing_kind", value }           -- kind or null
--     { op: "set_clarifications", items: [ { kind, slot?, note? } ] }
--     { op: "add_sensitive_flags", count }
--     replace_draft / count_draft at draft_count >= 6 raise writing_chat_draft_limit_reached.
--   user (chat active or closed):
--     { op: "accept_fact" | "reject_fact", fact_id }    -- needs_review only; reject removes the fact [가정]
--     { op: "accept_block", block_id }                  -- needs_review -> accepted, rev unchanged
--     { op: "remove_block", block_id }                  -- block removed, value reassembled, rev + 1
--     block ops on an applied draft raise field_already_applied.

-- ── helpers ──
-- Current rev of a stored field object (missing / malformed = 1).
create or replace function private.wc_rev(p_obj jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p_obj -> 'rev') = 'number' and (p_obj ->> 'rev') ~ '^[0-9]{1,9}$'
              then (p_obj ->> 'rev')::integer else 1 end;
$$;

-- rev of the next object in a slot: previous + 1, or 1 for an empty slot.
create or replace function private.wc_next_rev(p_cur jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p_cur) = 'object' and p_cur <> '{}'::jsonb then private.wc_rev(p_cur) + 1 else 1 end;
$$;

revoke all on function private.wc_rev(jsonb) from public;
revoke all on function private.wc_next_rev(jsonb) from public;

-- Deliverable drafts: anything that is not a v1 deliverable draft normalizes to an empty one.
create or replace function private.wc_normalize_deliverable_draft(p_draft jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select private.writing_chat_empty_deliverable_draft()
         || case when p_draft ->> 'target' = 'project_deliverable' and p_draft ->> 'schema_version' = '1'
                 then p_draft else '{}'::jsonb end;
$$;

revoke all on function private.wc_normalize_deliverable_draft(jsonb) from public;

-- Text of a list item / table cell: a string, or an object's "text".
create or replace function private.wc_md_text(p jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(case jsonb_typeof(p) when 'string' then p #>> '{}' when 'object' then p ->> 'text' end);
$$;

-- Cells of a table row: an array, or an object's "cells".
create or replace function private.wc_md_cells(p_row jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case jsonb_typeof(p_row) when 'array' then p_row when 'object' then p_row -> 'cells' end;
$$;

-- Deterministic markdown of one block (DM §2.5.0 "value = 서버가 blocks로 조립한 마크다운").
create or replace function private.wc_block_markdown(p_block jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_block ->> 'type'
    when 'heading' then repeat('#', coalesce((p_block ->> 'level')::integer, 2)) || ' ' || btrim(p_block ->> 'text')
    when 'paragraph' then btrim(p_block ->> 'text')
    when 'quote' then '> ' || replace(btrim(p_block ->> 'text'), E'\n', E'\n> ')
    when 'code' then '```' || E'\n' || rtrim(p_block ->> 'text', E' \t\r\n') || E'\n' || '```'
    when 'bullet_list' then
      (select string_agg('- ' || replace(private.wc_md_text(i), E'\n', ' '), E'\n' order by o)
         from jsonb_array_elements(p_block -> 'items') with ordinality as t (i, o))
    when 'numbered_list' then
      (select string_agg(o || '. ' || replace(private.wc_md_text(i), E'\n', ' '), E'\n' order by o)
         from jsonb_array_elements(p_block -> 'items') with ordinality as t (i, o))
    when 'table' then
      (select string_agg(line, E'\n' order by ord)
         from (select r.o * 2 as ord,
                      '| ' || (select string_agg(replace(replace(coalesce(private.wc_md_text(c), ''), '|', '\|'), E'\n', ' '),
                                                 ' | ' order by co)
                                 from jsonb_array_elements(private.wc_md_cells(r.row)) with ordinality as cc (c, co))
                      || ' |' as line
                 from jsonb_array_elements(p_block -> 'rows') with ordinality as r (row, o)
               union all
               select 3,
                      '| ' || (select string_agg('---', ' | ')
                                 from jsonb_array_elements(private.wc_md_cells(p_block #> '{rows,0}'))) || ' |') l)
  end;
$$;

create or replace function private.wc_deliverable_markdown(p_blocks jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce((select string_agg(private.wc_block_markdown(b), E'\n\n' order by o)
                     from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb)) with ordinality as t (b, o)), '');
$$;

revoke all on function private.wc_md_text(jsonb) from public;
revoke all on function private.wc_md_cells(jsonb) from public;
revoke all on function private.wc_block_markdown(jsonb) from public;
revoke all on function private.wc_deliverable_markdown(jsonb) from public;

-- uuid[] of string elements of a jsonb array that are uuids (others dropped).
create or replace function private.wc_uuid_array(p jsonb)
returns uuid[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg((e #>> '{}')::uuid), '{}')
    from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) e
   where private.wc_is_uuid(e);
$$;

revoke all on function private.wc_uuid_array(jsonb) from public;

-- Source lists of a block or list item: absent -> []; otherwise validated. Null when malformed or a fact id is
-- not one of p_fact_ids (DM defense for V-10a; the pipeline runs the real check).
create or replace function private.wc_block_sources(p jsonb, p_fact_ids uuid[])
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_facts jsonb := coalesce(nullif(p -> 'source_fact_ids', 'null'::jsonb), '[]'::jsonb);
  v_quotes jsonb := private.wc_quotes(p -> 'source_body_quotes');
  v_fields jsonb := coalesce(nullif(p -> 'source_project_fields', 'null'::jsonb), '[]'::jsonb);
begin
  if jsonb_typeof(v_facts) <> 'array' or jsonb_array_length(v_facts) > 40
     or exists (select 1 from jsonb_array_elements(v_facts) e
                 where not private.wc_is_uuid(e) or not ((e #>> '{}')::uuid = any (coalesce(p_fact_ids, '{}')))) then
    return null;
  end if;
  if v_quotes is null then
    return null;
  end if;
  if jsonb_typeof(v_fields) <> 'array' or jsonb_array_length(v_fields) > 10
     or exists (select 1 from jsonb_array_elements(v_fields) e
                 where jsonb_typeof(e) <> 'string' or char_length(e #>> '{}') not between 1 and 50) then
    return null;
  end if;
  return jsonb_build_object(
    'source_fact_ids', (select coalesce(jsonb_agg(distinct lower(e #>> '{}')), '[]'::jsonb) from jsonb_array_elements(v_facts) e),
    'source_body_quotes', v_quotes,
    'source_project_fields', v_fields);
end;
$$;

revoke all on function private.wc_block_sources(jsonb, uuid[]) from public;

-- One AI draft block -> normalized stored block, or {"reason": ...} (invalid_value / invalid_source).
create or replace function private.wc_deliverable_block(p_block jsonb, p_fact_ids uuid[])
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_type text := p_block ->> 'type';
  v_src jsonb;
  v_out jsonb;
  v_el jsonb;
  v_cells jsonb;
begin
  if jsonb_typeof(p_block) <> 'object'
     or jsonb_typeof(p_block -> 'block_id') is distinct from 'string'
     or char_length(p_block ->> 'block_id') not between 1 and 50
     or v_type is null
     or v_type not in ('heading', 'paragraph', 'bullet_list', 'numbered_list', 'table', 'quote', 'code')
     or coalesce(p_block ->> 'basis', 'new') not in ('new', 'current_body')
     or coalesce(jsonb_typeof(p_block -> 'basis'), 'null') not in ('string', 'null')
     or coalesce(p_block ->> 'review', 'ok') not in ('ok', 'needs_review') then
    return jsonb_build_object('reason', 'invalid_value');
  end if;

  v_src := private.wc_block_sources(p_block, p_fact_ids);
  if v_src is null then
    return jsonb_build_object('reason', 'invalid_source');
  end if;

  v_out := jsonb_build_object('block_id', p_block ->> 'block_id', 'type', v_type);

  if v_type = 'heading' then
    if coalesce(jsonb_typeof(p_block -> 'level'), 'null') not in ('number', 'null')
       or coalesce(p_block ->> 'level', '2') !~ '^[1-6]$'
       or jsonb_typeof(p_block -> 'text') is distinct from 'string'
       or char_length(btrim(p_block ->> 'text')) not between 1 and 500
       or p_block ->> 'text' ~ E'[\\r\\n]' then
      return jsonb_build_object('reason', 'invalid_value');
    end if;
    v_out := v_out || jsonb_build_object('level', coalesce((p_block ->> 'level')::integer, 2),
                                         'text', btrim(p_block ->> 'text'));
  elsif v_type in ('paragraph', 'quote', 'code') then
    if jsonb_typeof(p_block -> 'text') is distinct from 'string'
       or char_length(btrim(p_block ->> 'text')) not between 1 and 8000 then
      return jsonb_build_object('reason', 'invalid_value');
    end if;
    v_out := v_out || jsonb_build_object('text', p_block ->> 'text');
  elsif v_type in ('bullet_list', 'numbered_list') then
    if jsonb_typeof(p_block -> 'items') is distinct from 'array'
       or jsonb_array_length(p_block -> 'items') not between 1 and 100 then
      return jsonb_build_object('reason', 'invalid_value');
    end if;
    for v_el in select * from jsonb_array_elements(p_block -> 'items') loop
      if jsonb_typeof(v_el) not in ('string', 'object')
         or char_length(coalesce(private.wc_md_text(v_el), '')) not between 1 and 2000 then
        return jsonb_build_object('reason', 'invalid_value');
      end if;
      if jsonb_typeof(v_el) = 'object' and private.wc_block_sources(v_el, p_fact_ids) is null then
        return jsonb_build_object('reason', 'invalid_source');
      end if;
    end loop;
    v_out := v_out || jsonb_build_object('items', p_block -> 'items');
  else -- table
    if jsonb_typeof(p_block -> 'rows') is distinct from 'array'
       or jsonb_array_length(p_block -> 'rows') not between 1 and 100 then
      return jsonb_build_object('reason', 'invalid_value');
    end if;
    for v_el in select * from jsonb_array_elements(p_block -> 'rows') loop
      v_cells := private.wc_md_cells(v_el);
      if jsonb_typeof(v_cells) is distinct from 'array' or jsonb_array_length(v_cells) not between 1 and 20
         or exists (select 1 from jsonb_array_elements(v_cells) c
                     where jsonb_typeof(c) not in ('string', 'object')
                        or char_length(coalesce(private.wc_md_text(c), '')) > 1000) then
        return jsonb_build_object('reason', 'invalid_value');
      end if;
      if jsonb_typeof(v_el) = 'object' and private.wc_block_sources(v_el, p_fact_ids) is null then
        return jsonb_build_object('reason', 'invalid_source');
      end if;
    end loop;
    v_out := v_out || jsonb_build_object('rows', p_block -> 'rows');
  end if;

  return v_out
    || jsonb_build_object('basis', case when v_type = 'heading' then p_block ->> 'basis'
                                        else coalesce(p_block ->> 'basis', 'new') end)
    || v_src
    || jsonb_build_object('review', coalesce(p_block ->> 'review', 'ok'));
end;
$$;

revoke all on function private.wc_deliverable_block(jsonb, uuid[]) from public;

-- ════════ STAR chat ops ════════
create or replace function private.wc_patch_star(p_chat public.writing_chats, p_ops jsonb, p_actor text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  c_star constant text[] := array['situation', 'task', 'action', 'result', 'learnings'];
  c_period constant text[] := array['start_month', 'end_month'];
  c_class constant text[] := array['project_type', 'experience_type', 'competencies'];
  c_ai_ops constant text[] := array['set', 'append', 'set_clarifications', 'add_sensitive_flags'];
  c_user_ops constant text[] := array['set', 'accept', 'reject'];
  v_project public.projects%rowtype;
  v_draft jsonb;
  v_work jsonb;
  v_user_msg_ids uuid[];
  v_op jsonb;
  v_kind text;
  v_i integer;
  v_reason text;
  v_rejected jsonb := '[]'::jsonb;
  v_target jsonb;
  v_section text;
  v_field text;
  v_path text[];
  v_cur jsonb;
  v_live boolean;      -- v_cur exists, has a value and has not been applied yet
  v_filled boolean;    -- the projects column already has a value (STAR op only)
  v_new_obj boolean;
  v_value jsonb;
  v_sources jsonb;
  v_quotes jsonb;
  v_review text;
  v_star_op text;
  v_note text;
  v_obj jsonb;
  v_item jsonb;
begin
  -- Saved project values, read only for the V-9h op choice (the form snapshot check is the app's).
  select * into v_project from public.projects p where p.id = p_chat.project_id and p.user_id = p_chat.user_id;

  v_draft := private.wc_normalize_draft(p_chat.structured_draft);

  if p_actor = 'ai' then
    select coalesce(array_agg(m.id), '{}') into v_user_msg_ids
      from public.writing_chat_messages m
     where m.writing_chat_id = p_chat.id and m.role = 'user';
  end if;

  for v_i in 0 .. jsonb_array_length(p_ops) - 1 loop
    v_op := p_ops -> v_i;
    v_kind := v_op ->> 'op';
    if jsonb_typeof(v_op) <> 'object' or v_kind is null
       or not (v_kind = any (case when p_actor = 'ai' then c_ai_ops else c_user_ops end)) then
      raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i;
    end if;
    -- new_object: AI set / append only, boolean.
    if v_op ? 'new_object'
       and (p_actor <> 'ai' or v_kind not in ('set', 'append')
            or jsonb_typeof(v_op -> 'new_object') not in ('boolean', 'null')) then
      raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' new_object';
    end if;
    v_new_obj := coalesce(v_op -> 'new_object' = 'true'::jsonb, false);

    v_reason := null;
    v_work := v_draft;

    if v_kind in ('set', 'append', 'accept', 'reject') then
      v_target := v_op -> 'target';
      v_section := v_target ->> 'section';
      v_field := v_target ->> 'field';
      if jsonb_typeof(v_target) is distinct from 'object'
         or v_section is null or v_section not in ('project', 'star', 'classification')
         or v_field is null
         or (v_section = 'project' and not (v_field = any (c_period || 'is_current'::text)))
         or (v_section = 'star' and not (v_field = any (c_star)))
         or (v_section = 'classification' and not (v_field = any (c_class)))
         or (v_kind = 'append' and v_section <> 'star') then
        raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' target';
      end if;

      v_path := array[v_section, v_field];
      v_cur := v_work #> v_path;
      v_live := v_cur is not null and jsonb_typeof(v_cur) = 'object'
                and coalesce(jsonb_typeof(v_cur -> 'applied_at'), 'null') = 'null';
      v_filled := v_section = 'star' and nullif(btrim(to_jsonb(v_project) ->> v_field), '') is not null;

      if v_section = 'project' and v_field = 'is_current' then
        -- R-CR-15: "진행 중" is the user's call in the period input, never a proposal.
        v_reason := 'field_not_patchable';

      elsif v_kind in ('set', 'append') and p_actor = 'ai' then
        if v_live and not v_new_obj
           and coalesce(jsonb_typeof(v_cur -> 'value'), 'null') <> 'null'
           and (v_cur ->> 'origin' = 'user_edit' or v_cur ->> 'review' = 'accepted') then
          v_reason := 'protected_field';
        elsif v_section = 'classification' then
          -- DM v4.5: "empty only" is judged by the app on the form snapshot; the DB only filters values (V-9i).
          v_value := private.wc_classification_value(v_field, v_op -> 'value');
          if v_value is null then
            v_reason := 'invalid_value';
          elsif v_op ? 'reason' and coalesce(jsonb_typeof(v_op -> 'reason'), 'null') not in ('string', 'null') then
            v_reason := 'invalid_value';
          else
            -- source_message_ids are optional for a suggestion; ids that are not this chat's user messages drop.
            select coalesce(jsonb_agg(distinct lower(e #>> '{}')), '[]'::jsonb) into v_sources
              from jsonb_array_elements(case when jsonb_typeof(v_op -> 'source_message_ids') = 'array'
                                             then v_op -> 'source_message_ids' else '[]'::jsonb end) e
             where private.wc_is_uuid(e) and (e #>> '{}')::uuid = any (v_user_msg_ids);
            v_note := left(nullif(btrim(v_op ->> 'reason'), ''), 200);
            v_work := jsonb_set(v_work, v_path, jsonb_build_object(
              'value', v_value, 'origin', 'ai', 'source_message_ids', v_sources, 'reason', v_note,
              'review', 'ok', 'reviewed_at', null, 'applied_at', null, 'rev', private.wc_next_rev(v_cur)), true);
          end if;
        else
          v_value := v_op -> 'value';
          v_sources := private.wc_sources(v_op -> 'source_message_ids', v_user_msg_ids);
          v_quotes := private.wc_quotes(v_op -> 'source_quotes');
          v_review := coalesce(v_op ->> 'review', 'ok');
          if v_review not in ('ok', 'needs_review') then
            raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' review';
          end if;
          if not private.wc_value_ok(v_field, v_value) then
            v_reason := 'invalid_value';
          elsif v_sources is null or v_quotes is null then
            v_reason := 'invalid_source';
          else
            v_value := private.wc_clean_value(v_value);
            -- V-9h (v4.5): a filled STAR column takes append only — a set is lowered to append, not refused.
            v_star_op := case when v_filled then 'append' else 'set' end;
            -- Same field, pending (and not new_object): set replaces, append adds a line (AI-12 mapping).
            if v_section = 'star' and v_kind = 'append' and v_live and not v_new_obj
               and nullif(btrim(v_cur ->> 'value'), '') is not null then
              v_value := to_jsonb((v_cur ->> 'value') || E'\n' || (v_value #>> '{}'));
              select coalesce(jsonb_agg(distinct x), '[]'::jsonb) into v_sources
                from jsonb_array_elements(coalesce(v_cur -> 'source_message_ids', '[]'::jsonb) || v_sources) x;
              v_quotes := coalesce(v_cur -> 'source_quotes', '[]'::jsonb) || v_quotes;
              if v_cur ->> 'review' = 'needs_review' then
                v_review := 'needs_review';
              end if;
            end if;
            if char_length(v_value #>> '{}') > 2000 or jsonb_array_length(v_quotes) > 40 then
              v_reason := 'invalid_value';
            else
              v_obj := jsonb_build_object(
                'value', v_value, 'origin', 'ai', 'source_message_ids', v_sources, 'source_quotes', v_quotes,
                'review', v_review, 'reviewed_at', null, 'applied_at', null, 'rev', private.wc_next_rev(v_cur));
              if v_section = 'star' then
                v_obj := v_obj || jsonb_build_object('op', v_star_op);
              end if;
              v_work := jsonb_set(v_work, v_path, v_obj, true);
            end if;
          end if;
        end if;

      elsif v_kind = 'set' then -- user edit
        v_value := v_op -> 'value';
        if v_cur is not null and not v_live then
          v_reason := 'field_already_applied';
        elsif v_value is null or jsonb_typeof(v_value) = 'null' then
          -- Clearing: the slot stays as an empty, unprotected object with the next rev (rev never goes back).
          if jsonb_typeof(v_cur) = 'object' then
            v_obj := jsonb_build_object('value', null, 'origin', 'ai', 'source_message_ids', '[]'::jsonb,
                                        'review', 'ok', 'reviewed_at', now(), 'applied_at', null,
                                        'rev', private.wc_next_rev(v_cur));
            v_obj := v_obj || case v_section
              when 'star' then jsonb_build_object('source_quotes', '[]'::jsonb, 'op', coalesce(v_cur ->> 'op', 'set'))
              when 'project' then jsonb_build_object('source_quotes', '[]'::jsonb)
              else jsonb_build_object('reason', null) end;
            v_work := jsonb_set(v_work, v_path, v_obj);
          end if;
        elsif v_section = 'classification' then
          v_value := private.wc_classification_value(v_field, v_value);
          if v_value is null then
            v_reason := 'invalid_value';
          else
            v_work := jsonb_set(v_work, v_path, jsonb_build_object(
              'value', v_value, 'origin', 'user_edit',
              'source_message_ids', coalesce(v_cur -> 'source_message_ids', '[]'::jsonb),
              'reason', v_cur -> 'reason', 'review', 'ok', 'reviewed_at', null, 'applied_at', null,
              'rev', private.wc_next_rev(v_cur)), true);
          end if;
        elsif not private.wc_value_ok(v_field, v_value) then
          v_reason := 'invalid_value';
        else
          v_obj := jsonb_build_object(
            'value', private.wc_clean_value(v_value), 'origin', 'user_edit', 'source_message_ids', '[]'::jsonb,
            'source_quotes', '[]'::jsonb, 'review', 'ok', 'reviewed_at', null, 'applied_at', null,
            'rev', private.wc_next_rev(v_cur));
          if v_section = 'star' then
            -- V-9h for users too: the op follows the saved column (filled -> append, empty -> set).
            v_obj := v_obj || jsonb_build_object('op', case when v_filled then 'append' else 'set' end);
          end if;
          v_work := jsonb_set(v_work, v_path, v_obj, true);
        end if;

      else -- accept / reject (user): only a needs_review field that has not been applied.
        if v_cur is not null and not v_live then
          v_reason := 'field_already_applied';
        elsif v_cur is null or v_cur ->> 'review' is distinct from 'needs_review' then
          v_reason := 'invalid_review_transition';
        elsif v_kind = 'accept' then
          -- rev unchanged: the value did not change.
          v_work := jsonb_set(v_work, v_path, v_cur || jsonb_build_object('review', 'accepted', 'reviewed_at', now()));
        else
          -- Reject: empty again (AI asks for it later), not protected, next rev.
          v_obj := jsonb_build_object(
            'value', null, 'origin', 'ai', 'source_message_ids', '[]'::jsonb, 'source_quotes', '[]'::jsonb,
            'review', 'ok', 'reviewed_at', now(), 'applied_at', null, 'rev', private.wc_next_rev(v_cur));
          if v_section = 'star' then
            v_obj := v_obj || jsonb_build_object('op', coalesce(v_cur ->> 'op', 'set'));
          end if;
          v_work := jsonb_set(v_work, v_path, v_obj);
        end if;
      end if;

    elsif v_kind = 'set_clarifications' then
      v_item := v_op -> 'items';
      if jsonb_typeof(v_item) is distinct from 'array' or jsonb_array_length(v_item) > 50
         or exists (
           select 1 from jsonb_array_elements(v_item) c
            where jsonb_typeof(c) <> 'object'
               or coalesce(c ->> 'kind', '') not in ('actor_ambiguous', 'number_vague', 'period_unclear')
               or (c ? 'field' and jsonb_typeof(c -> 'field') not in ('string', 'null'))
               or char_length(coalesce(c ->> 'field', '')) > 50) then
        raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' clarifications';
      end if;
      v_work := jsonb_set(v_work, '{clarifications}', coalesce((
        select jsonb_agg(jsonb_build_object('kind', c ->> 'kind', 'field', c ->> 'field'))
          from jsonb_array_elements(v_item) c), '[]'::jsonb));

    elsif v_kind = 'add_sensitive_flags' then
      if jsonb_typeof(v_op -> 'count') is distinct from 'number'
         or (v_op ->> 'count')::numeric <> trunc((v_op ->> 'count')::numeric)
         or (v_op ->> 'count')::numeric not between 0 and 100 then
        raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' count';
      end if;
      v_work := jsonb_set(v_work, '{sensitive_flags_count}',
        to_jsonb(coalesce((v_work ->> 'sensitive_flags_count')::integer, 0) + (v_op ->> 'count')::integer));
    end if;

    if v_reason is null then
      v_draft := v_work;
    elsif p_actor = 'ai' then
      v_rejected := v_rejected || jsonb_build_array(jsonb_build_object('index', v_i, 'op', v_kind, 'reason', v_reason));
    else
      raise exception using errcode = 'P0001', message = v_reason, detail = 'op ' || v_i;
    end if;
  end loop;

  return jsonb_build_object('structured_draft', v_draft, 'rejected', v_rejected);
end;
$$;

revoke all on function private.wc_patch_star(public.writing_chats, jsonb, text) from public;

-- ════════ deliverable chat ops ════════
create or replace function private.wc_patch_deliverable(p_chat public.writing_chats, p_ops jsonb, p_actor text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  c_ai_ops constant text[] := array['add_facts', 'replace_draft', 'count_draft', 'set_writing_kind',
                                    'set_clarifications', 'add_sensitive_flags'];
  c_user_ops constant text[] := array['accept_fact', 'reject_fact', 'accept_block', 'remove_block'];
  -- AI-13 slot keys [가정].
  c_slots constant text[] := array['background', 'goal', 'contribution', 'scope', 'outcome', 'requirements',
                                   'structure', 'decisions', 'limits', 'went_well', 'went_wrong', 'learnings',
                                   'audience', 'message', 'outline', 'reaction', 'what', 'purpose', 'content'];
  c_kinds constant text[] := array['planning_summary', 'design_doc', 'retrospective', 'presentation', 'other'];
  c_draft_limit constant integer := 6;   -- AI 7.4 [가정]
  c_fact_limit constant integer := 80;   -- DM §2.5.0 [가정]
  v_draft jsonb;
  v_work jsonb;
  v_user_msg_ids uuid[];
  v_op jsonb;
  v_kind text;
  v_i integer;
  v_j integer;
  v_reason text;
  v_rejected jsonb := '[]'::jsonb;
  v_fact jsonb;
  v_fact_id uuid;
  v_sources jsonb;
  v_quotes jsonb;
  v_text text;
  v_body jsonb;
  v_cur_body jsonb;
  v_blocks jsonb;
  v_block jsonb;
  v_value text;
  v_item jsonb;
  v_idx integer;
begin
  v_draft := private.wc_normalize_deliverable_draft(p_chat.structured_draft);

  if p_actor = 'ai' then
    select coalesce(array_agg(m.id), '{}') into v_user_msg_ids
      from public.writing_chat_messages m
     where m.writing_chat_id = p_chat.id and m.role = 'user';
  end if;

  for v_i in 0 .. jsonb_array_length(p_ops) - 1 loop
    v_op := p_ops -> v_i;
    v_kind := v_op ->> 'op';
    if jsonb_typeof(v_op) <> 'object' or v_kind is null
       or not (v_kind = any (case when p_actor = 'ai' then c_ai_ops else c_user_ops end)) then
      raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i;
    end if;

    v_reason := null;
    v_work := v_draft;

    if v_kind = 'add_facts' then
      if jsonb_typeof(v_op -> 'facts') is distinct from 'array'
         or jsonb_array_length(v_op -> 'facts') not between 1 and c_fact_limit then
        raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' facts';
      end if;
      for v_j in 0 .. jsonb_array_length(v_op -> 'facts') - 1 loop
        v_fact := v_op #> array['facts', v_j::text];
        v_text := btrim(v_fact ->> 'text');
        v_sources := private.wc_sources(v_fact -> 'source_message_ids', v_user_msg_ids);
        v_quotes := private.wc_quotes(v_fact -> 'source_quotes');
        v_reason := case
          when jsonb_typeof(v_fact) <> 'object'
               or jsonb_typeof(v_fact -> 'text') is distinct from 'string'
               or char_length(v_text) not between 1 and 500
               or coalesce(v_fact ->> 'slot', '') <> all (c_slots)
               or coalesce(v_fact ->> 'actor', '') not in ('self', 'team', 'unknown')
               or coalesce(v_fact ->> 'review', 'ok') not in ('ok', 'needs_review')
               or (v_fact ? 'id' and not private.wc_is_uuid(v_fact -> 'id')) then 'invalid_value'
          when v_sources is null or v_quotes is null then 'invalid_source'
          when jsonb_array_length(v_work -> 'facts') >= c_fact_limit then 'facts_limit_reached'
        end;
        if v_reason is null then
          v_fact_id := case when v_fact ? 'id' then (v_fact ->> 'id')::uuid end;
          if v_fact_id is null
             or v_fact_id = any (private.wc_uuid_array(jsonb_path_query_array(v_work -> 'facts', '$[*].id'))) then
            v_fact_id := gen_random_uuid();
          end if;
          v_work := jsonb_set(v_work, '{facts}', (v_work -> 'facts') || jsonb_build_array(jsonb_build_object(
            'id', v_fact_id, 'slot', v_fact ->> 'slot', 'text', v_text, 'actor', v_fact ->> 'actor',
            'source_message_ids', v_sources, 'source_quotes', v_quotes,
            'review', coalesce(v_fact ->> 'review', 'ok'), 'reviewed_at', null, 'origin', 'ai')));
        else
          v_rejected := v_rejected || jsonb_build_array(jsonb_build_object(
            'index', v_i, 'op', v_kind, 'fact_index', v_j, 'reason', v_reason));
        end if;
      end loop;
      v_reason := null;

    elsif v_kind in ('replace_draft', 'count_draft') then
      if coalesce((v_work ->> 'draft_count')::integer, 0) >= c_draft_limit then
        raise exception using errcode = 'P0001', message = 'writing_chat_draft_limit_reached';
      end if;
      if v_kind = 'replace_draft' then
        v_body := v_op -> 'body';
        if jsonb_typeof(v_body) is distinct from 'object' then
          raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' body';
        end if;
        if jsonb_typeof(v_body -> 'blocks') is distinct from 'array'
           or jsonb_array_length(v_body -> 'blocks') not between 1 and 200
           or coalesce(jsonb_typeof(v_body -> 'base_body_hash'), 'null') not in ('string', 'null')
           or char_length(v_body ->> 'base_body_hash') > 200
           or coalesce(jsonb_typeof(v_body -> 'replace_allowed'), 'boolean') <> 'boolean'
           or coalesce(jsonb_typeof(v_body -> 'missing_slots'), 'array') <> 'array'
           or exists (select 1 from jsonb_array_elements(coalesce(v_body -> 'missing_slots', '[]'::jsonb)) s
                       where jsonb_typeof(s) <> 'string' or (s #>> '{}') <> all (c_slots))
           or coalesce(jsonb_typeof(v_body -> 'dropped_block_count'), 'number') <> 'number'
           or coalesce(v_body ->> 'dropped_block_count', '0') !~ '^[0-9]{1,3}$' then
          v_reason := 'invalid_value';
        else
          v_blocks := '[]'::jsonb;
          for v_block in select * from jsonb_array_elements(v_body -> 'blocks') loop
            v_block := private.wc_deliverable_block(
              v_block, private.wc_uuid_array(jsonb_path_query_array(v_work -> 'facts', '$[*].id')));
            if v_block ? 'reason' then
              v_reason := v_block ->> 'reason';
              exit;
            end if;
            v_blocks := v_blocks || jsonb_build_array(v_block);
          end loop;
          if v_reason is null
             and (select count(distinct b ->> 'block_id') from jsonb_array_elements(v_blocks) b)
                 <> jsonb_array_length(v_blocks) then
            v_reason := 'invalid_value';
          end if;
          if v_reason is null then
            v_value := private.wc_deliverable_markdown(v_blocks);
            if char_length(v_value) not between 1 and 8000 then
              v_reason := 'invalid_value';
            end if;
          end if;
          if v_reason is null then
            v_cur_body := v_work #> '{deliverable,body}';
            v_work := jsonb_set(v_work, '{deliverable}', jsonb_build_object('body', jsonb_build_object(
              'value', v_value, 'blocks', v_blocks, 'rev', private.wc_next_rev(v_cur_body),
              'generated_at', now(), 'base_body_hash', v_body -> 'base_body_hash',
              'replace_allowed', coalesce(v_body -> 'replace_allowed', 'true'::jsonb),
              'missing_slots', coalesce(v_body -> 'missing_slots', '[]'::jsonb),
              'dropped_block_count', coalesce((v_body ->> 'dropped_block_count')::integer, 0),
              'applied_at', null, 'applied_mode', null, 'applied_rev', null)));
          end if;
        end if;
      end if;
      if v_reason is null then
        v_work := jsonb_set(v_work, '{draft_count}',
                            to_jsonb(coalesce((v_work ->> 'draft_count')::integer, 0) + 1));
      end if;

    elsif v_kind = 'set_writing_kind' then
      if coalesce(jsonb_typeof(v_op -> 'value'), 'null') <> 'null'
         and (jsonb_typeof(v_op -> 'value') <> 'string' or (v_op ->> 'value') <> all (c_kinds)) then
        v_reason := 'invalid_value';
      else
        v_work := jsonb_set(v_work, '{writing_kind}', coalesce(v_op -> 'value', 'null'::jsonb));
      end if;

    elsif v_kind = 'set_clarifications' then
      v_item := v_op -> 'items';
      if jsonb_typeof(v_item) is distinct from 'array' or jsonb_array_length(v_item) > 50
         or exists (
           select 1 from jsonb_array_elements(v_item) c
            where jsonb_typeof(c) <> 'object'
               or coalesce(c ->> 'kind', '') not in ('actor_ambiguous', 'number_vague')
               or coalesce(jsonb_typeof(c -> 'slot'), 'null') not in ('string', 'null')
               or (c ->> 'slot') <> all (c_slots)
               or coalesce(jsonb_typeof(c -> 'note'), 'null') not in ('string', 'null')
               or char_length(c ->> 'note') > 200) then
        raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' clarifications';
      end if;
      v_work := jsonb_set(v_work, '{clarifications}', coalesce((
        select jsonb_agg(jsonb_build_object('kind', c ->> 'kind', 'slot', c ->> 'slot', 'note', c ->> 'note'))
          from jsonb_array_elements(v_item) c), '[]'::jsonb));

    elsif v_kind = 'add_sensitive_flags' then
      if jsonb_typeof(v_op -> 'count') is distinct from 'number'
         or (v_op ->> 'count')::numeric <> trunc((v_op ->> 'count')::numeric)
         or (v_op ->> 'count')::numeric not between 0 and 100 then
        raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' count';
      end if;
      v_work := jsonb_set(v_work, '{sensitive_flags_count}',
        to_jsonb(coalesce((v_work ->> 'sensitive_flags_count')::integer, 0) + (v_op ->> 'count')::integer));

    elsif v_kind in ('accept_fact', 'reject_fact') then
      if not private.wc_is_uuid(v_op -> 'fact_id') then
        raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' fact_id';
      end if;
      select (o - 1)::integer into v_idx
        from jsonb_array_elements(v_work -> 'facts') with ordinality as t (f, o)
       where lower(f ->> 'id') = lower(v_op ->> 'fact_id');
      if v_idx is null then
        raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' fact_id';
      end if;
      if v_work #>> array['facts', v_idx::text, 'review'] is distinct from 'needs_review' then
        v_reason := 'invalid_review_transition';
      elsif v_kind = 'accept_fact' then
        v_work := jsonb_set(v_work, array['facts', v_idx::text],
                            (v_work #> array['facts', v_idx::text])
                            || jsonb_build_object('review', 'accepted', 'reviewed_at', now()));
      else
        v_work := jsonb_set(v_work, '{facts}', (v_work -> 'facts') - v_idx);
      end if;

    else -- accept_block / remove_block
      v_cur_body := v_work #> '{deliverable,body}';
      if jsonb_typeof(v_op -> 'block_id') is distinct from 'string'
         or jsonb_typeof(v_cur_body) is distinct from 'object' then
        raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' block_id';
      end if;
      select (o - 1)::integer into v_idx
        from jsonb_array_elements(coalesce(v_cur_body -> 'blocks', '[]'::jsonb)) with ordinality as t (b, o)
       where b ->> 'block_id' = v_op ->> 'block_id';
      if v_idx is null then
        raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' block_id';
      end if;
      if coalesce(jsonb_typeof(v_cur_body -> 'applied_at'), 'null') <> 'null' then
        v_reason := 'field_already_applied';
      elsif v_kind = 'accept_block' then
        if v_cur_body #>> array['blocks', v_idx::text, 'review'] is distinct from 'needs_review' then
          v_reason := 'invalid_review_transition';
        else
          -- rev unchanged (AI-13: accepting does not change the text).
          v_work := jsonb_set(v_work, array['deliverable', 'body', 'blocks', v_idx::text, 'review'], '"accepted"');
        end if;
      else
        v_blocks := (v_cur_body -> 'blocks') - v_idx;
        v_work := jsonb_set(v_work, '{deliverable,body}', v_cur_body || jsonb_build_object(
          'blocks', v_blocks, 'value', private.wc_deliverable_markdown(v_blocks),
          'rev', private.wc_rev(v_cur_body) + 1));
      end if;
    end if;

    if v_reason is null then
      v_draft := v_work;
    elsif p_actor = 'ai' then
      v_rejected := v_rejected || jsonb_build_array(jsonb_build_object('index', v_i, 'op', v_kind, 'reason', v_reason));
    else
      raise exception using errcode = 'P0001', message = v_reason, detail = 'op ' || v_i;
    end if;
  end loop;

  return jsonb_build_object('structured_draft', v_draft, 'rejected', v_rejected);
end;
$$;

revoke all on function private.wc_patch_deliverable(public.writing_chats, jsonb, text) from public;

-- ════════ entry (same signature / grants as R4) ════════
create or replace function private.apply_structured_draft_patch_impl(p_writing_chat_id uuid, p_patch jsonb,
                                                                     p_actor text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_chat public.writing_chats%rowtype;
  v_ops jsonb;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_actor is null or p_actor not in ('ai', 'user') then
    raise exception using errcode = 'P0001', message = 'invalid_patch';
  end if;
  -- QA-S4-06: the actor must match the calling role (SET ROLE survives the definer switch).
  if not ((p_actor = 'ai' and current_setting('role', true) = 'app_ai_writer')
          or (p_actor = 'user' and current_setting('role', true) = 'authenticated')) then
    raise exception using errcode = '42501', message = 'actor_mismatch';
  end if;

  -- Locks only the chat row (never a career row), so it cannot deadlock with the page-save RPCs (DM §2.5.1).
  select * into v_chat from public.writing_chats w
   where w.id = p_writing_chat_id and w.user_id = v_uid
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'writing_chat_not_found';
  end if;
  -- AI turns need an active chat; users may still review a closed one [가정] DM §2.5.
  if p_actor = 'ai' and v_chat.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'writing_chat_closed';
  end if;

  v_ops := p_patch -> 'ops';
  if jsonb_typeof(p_patch) is distinct from 'object' or jsonb_typeof(v_ops) is distinct from 'array'
     or jsonb_array_length(v_ops) not between 1 and 100 then
    raise exception using errcode = 'P0001', message = 'invalid_patch';
  end if;

  if v_chat.project_deliverable_id is null then
    v_result := private.wc_patch_star(v_chat, v_ops, p_actor);
  else
    v_result := private.wc_patch_deliverable(v_chat, v_ops, p_actor);
  end if;

  update public.writing_chats w
     set structured_draft = v_result -> 'structured_draft', last_activity_at = now()
   where w.id = p_writing_chat_id;

  return v_result;
end;
$$;

revoke all on function private.apply_structured_draft_patch_impl(uuid, jsonb, text) from public;
grant execute on function private.apply_structured_draft_patch_impl(uuid, jsonb, text) to authenticated, app_ai_writer;
