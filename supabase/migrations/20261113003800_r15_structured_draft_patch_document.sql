-- R15 / D8 (DM 11.8 #5, §2.5.0b 패치 연산, §2.5 "대상별 패치 범위" — CL-3 · v4.15 CF-1·CF-6·CF-A4)
-- A third branch of apply_structured_draft_patch: the document (cover letter) chat.
--   AI ops   add_facts / replace_draft (slot required, answer_title optional) / count_draft / set_clarifications /
--            add_sensitive_flags / set_tone / set_question_edit_proposal
--   User ops accept_fact / reject_fact / accept_block (+ slot) / remove_block (+ slot)
--   NOT created (v4.15, CF-1): set_section_order_proposal, set_source_ranking, set_writing_kind.
-- The DB stays the canonical assembler: replace_draft's `value` is ignored and rebuilt from `blocks`
-- (R5-DB-5, per slot). answer_title is NOT part of `value` and not part of char_count / base_body_hash (CF-A4).
-- DB V-10 defence for a document = the 2.5.0a range + the shape / length / count of blocks[].evidence[].
-- Ownership, V-8 and the number guard run in the proposal stage; the save RPC is the last net for V-8.

-- One block's evidence array: normalized, or null when the shape is wrong (-> 'invalid_source').
create or replace function private.wc_doc_evidence(p_evidence jsonb, p_allowed text[])
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  c_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_arr jsonb := coalesce(nullif(p_evidence, 'null'::jsonb), '[]'::jsonb);
begin
  if jsonb_typeof(v_arr) <> 'array' or jsonb_array_length(v_arr) > 20 then   -- 블록당 근거 <= 20 `[가정]`
    return null;
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_arr) e
     where jsonb_typeof(e) <> 'object'
        or coalesce(e ->> 'source_type', '') <> all (p_allowed)
        or coalesce(jsonb_typeof(e -> 'source_id'), 'null') <> 'string'
        or (e ->> 'source_id') !~* c_uuid_re
        or coalesce(jsonb_typeof(e -> 'source_field'), 'null') not in ('string', 'null')
        or coalesce(jsonb_typeof(e -> 'source_locator'), 'object') not in ('object', 'null')
        or coalesce(jsonb_typeof(e -> 'quote'), 'null') not in ('string', 'null')
        or char_length(e ->> 'quote') > 2000
        or coalesce(jsonb_typeof(e -> 'label'), 'null') not in ('string', 'null')
        or char_length(e ->> 'label') > 300) then
    return null;
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
                            'source_type', e ->> 'source_type',
                            'source_id', lower(e ->> 'source_id'),
                            'source_field', e -> 'source_field',
                            'source_locator', e -> 'source_locator',
                            'quote', e -> 'quote',
                            'label', e -> 'label') order by o)
                     from jsonb_array_elements(v_arr) with ordinality as t (e, o)), '[]'::jsonb);
end;
$$;

revoke all on function private.wc_doc_evidence(jsonb, text[]) from public, anon;
grant execute on function private.wc_doc_evidence(jsonb, text[]) to authenticated, app_ai_writer;

-- (CF-S1 2026-11-09, 사용자 결정; document PR #68 not merged here) The slot-level citations a draft carries.
-- Element {source_type, source_id, role}: the allowed source list is the SAME one block evidence uses
-- (DM §2.8 via private.evidence_allowed_sources), role is primary / supporting, 0~5 elements `[가정]`.
-- A user_note source_id is that question's question_id. This is NOT the dropped document.source_ranking (CF-1).
-- Returns the normalized array, or null when the shape is wrong (the caller raises invalid_patch).
create or replace function private.wc_doc_sources(p_sources jsonb, p_allowed text[])
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  c_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_arr jsonb := coalesce(nullif(p_sources, 'null'::jsonb), '[]'::jsonb);
begin
  if jsonb_typeof(v_arr) <> 'array' or jsonb_array_length(v_arr) > 5 then
    return null;
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_arr) e
     where jsonb_typeof(e) <> 'object'
        or coalesce(e ->> 'source_type', '') <> all (p_allowed)
        or coalesce(jsonb_typeof(e -> 'source_id'), 'null') <> 'string'
        or (e ->> 'source_id') !~* c_uuid_re
        or coalesce(e ->> 'role', '') not in ('primary', 'supporting')) then
    return null;
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
                            'source_type', e ->> 'source_type',
                            'source_id', lower(e ->> 'source_id'),
                            'role', e ->> 'role') order by o)
                     from jsonb_array_elements(v_arr) with ordinality as t (e, o)), '[]'::jsonb);
end;
$$;

revoke all on function private.wc_doc_sources(jsonb, text[]) from public, anon;
grant execute on function private.wc_doc_sources(jsonb, text[]) to authenticated, app_ai_writer;

-- A document proposal block = the deliverable block + evidence / placeholders / flags / review_reason.
create or replace function private.wc_document_block(p_block jsonb, p_fact_ids uuid[], p_allowed text[])
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out jsonb := private.wc_deliverable_block(p_block, p_fact_ids);
  v_ev jsonb;
begin
  if v_out ? 'reason' then
    return v_out;
  end if;
  v_ev := private.wc_doc_evidence(p_block -> 'evidence', p_allowed);
  if v_ev is null then
    return jsonb_build_object('reason', 'invalid_source');
  end if;
  if coalesce(jsonb_typeof(p_block -> 'placeholders'), 'array') <> 'array'
     or coalesce(jsonb_array_length(p_block -> 'placeholders'), 0) > 20
     or coalesce(jsonb_typeof(p_block -> 'flags'), 'array') <> 'array'
     or coalesce(jsonb_array_length(p_block -> 'flags'), 0) > 20
     or coalesce(jsonb_typeof(p_block -> 'review_reason'), 'null') not in ('string', 'null') then
    return jsonb_build_object('reason', 'invalid_value');
  end if;
  -- DM §2.5.0b: a block with no evidence must be reviewed before it can be filled in.
  return v_out
    || jsonb_build_object(
         'evidence', v_ev,
         'placeholders', coalesce(p_block -> 'placeholders', '[]'::jsonb),
         'flags', coalesce(p_block -> 'flags', '[]'::jsonb),
         'review', case when jsonb_array_length(v_ev) = 0 and (v_out ->> 'type') <> 'heading'
                        then 'needs_review' else v_out ->> 'review' end,
         'review_reason', case when jsonb_array_length(v_ev) = 0 and (v_out ->> 'type') <> 'heading'
                               then to_jsonb('no_evidence'::text)
                               else coalesce(p_block -> 'review_reason', 'null'::jsonb) end);
end;
$$;

revoke all on function private.wc_document_block(jsonb, uuid[], text[]) from public, anon;
grant execute on function private.wc_document_block(jsonb, uuid[], text[]) to authenticated, app_ai_writer;

create or replace function private.wc_patch_document(p_chat public.writing_chats, p_ops jsonb, p_actor text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  c_ai_ops constant text[] := array['add_facts', 'replace_draft', 'count_draft', 'set_clarifications',
                                    'add_sensitive_flags', 'set_tone', 'set_question_edit_proposal'];
  c_user_ops constant text[] := array['accept_fact', 'reject_fact', 'accept_block', 'remove_block'];
  c_slot_re constant text := '^q_[0-9]{1,3}$';
  c_draft_limit constant integer := 6;   -- DM §2.5.0b: 6 per CHAT, not per slot
  c_fact_limit constant integer := 80;
  v_allowed text[] := private.evidence_allowed_sources('application_document');
  v_draft jsonb;
  v_work jsonb;
  v_user_msg_ids uuid[];
  v_op jsonb;
  v_kind text;
  v_slot text;
  v_i integer;
  v_j integer;
  v_qidx integer;
  v_reason text;
  v_rejected jsonb := '[]'::jsonb;
  v_fact jsonb;
  v_fact_id uuid;
  v_sources jsonb;
  v_quotes jsonb;
  v_text text;
  v_draft_obj jsonb;
  v_cur jsonb;
  v_blocks jsonb;
  v_block jsonb;
  v_value text;
  v_title text;
  v_slot_sources jsonb;
  v_item jsonb;
  v_idx integer;
begin
  v_draft := private.wc_normalize_document_draft(p_chat.structured_draft, p_chat.document_kind);

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
               -- DM §2.5.0b: a document fact's slot is this document's slot key, not a fixed list.
               or coalesce(v_fact ->> 'slot', '') !~ c_slot_re
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
        v_slot := v_op ->> 'slot';
        v_draft_obj := v_op -> 'draft';
        if v_slot is null or v_slot !~ c_slot_re or jsonb_typeof(v_draft_obj) is distinct from 'object' then
          raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' slot';
        end if;
        -- (v4.15, CF-A4) answer_title: text or null, <= 100 — over the limit the whole patch is invalid `[가정]`.
        if coalesce(jsonb_typeof(v_draft_obj -> 'answer_title'), 'null') not in ('string', 'null')
           or char_length(btrim(coalesce(v_draft_obj ->> 'answer_title', ''))) > 100 then
          raise exception using errcode = 'P0001', message = 'invalid_patch',
            detail = 'op ' || v_i || ' answer_title';
        end if;
        v_title := nullif(btrim(coalesce(v_draft_obj ->> 'answer_title', '')), '');
        -- (CF-S1) the slot-level citations ride on replace_draft; no new patch op is created.
        -- "no sources key" is NOT the same as "empty array": without the key the draft stores no sources, and
        -- the save RPC then keeps the slot's existing `{slot}.sources.{n}` rows. An empty array clears them.
        if v_draft_obj ? 'sources' then
          v_slot_sources := private.wc_doc_sources(v_draft_obj -> 'sources', v_allowed);
          if v_slot_sources is null then
            raise exception using errcode = 'P0001', message = 'invalid_patch',
              detail = 'op ' || v_i || ' sources';
          end if;
        else
          v_slot_sources := null;
        end if;
        if jsonb_typeof(v_draft_obj -> 'blocks') is distinct from 'array'
           or jsonb_array_length(v_draft_obj -> 'blocks') not between 1 and 200
           or coalesce(jsonb_typeof(v_draft_obj -> 'base_body_hash'), 'null') not in ('string', 'null')
           or char_length(v_draft_obj ->> 'base_body_hash') > 200
           or coalesce(jsonb_typeof(v_draft_obj -> 'replace_allowed'), 'boolean') <> 'boolean'
           or coalesce(jsonb_typeof(v_draft_obj -> 'missing_slots'), 'array') <> 'array'
           or coalesce(jsonb_array_length(v_draft_obj -> 'missing_slots'), 0) > 20
           or coalesce(jsonb_typeof(v_draft_obj -> 'dropped_block_count'), 'number') <> 'number'
           or coalesce(v_draft_obj ->> 'dropped_block_count', '0') !~ '^[0-9]{1,3}$'
           or coalesce(jsonb_typeof(v_draft_obj -> 'char_count'), 'number') <> 'number'
           or coalesce(v_draft_obj ->> 'char_count', '0') !~ '^[0-9]{1,6}$'
           or coalesce(jsonb_typeof(v_draft_obj -> 'char_limit_at_generation'), 'number') <> 'number'
           or coalesce(jsonb_typeof(v_draft_obj -> 'char_adjust_needed'), 'boolean') <> 'boolean'
           or coalesce(jsonb_typeof(v_draft_obj -> 'correction_applied'), 'boolean') <> 'boolean' then
          v_reason := 'invalid_value';
        else
          v_blocks := '[]'::jsonb;
          for v_block in select * from jsonb_array_elements(v_draft_obj -> 'blocks') loop
            v_block := private.wc_document_block(
              v_block, private.wc_uuid_array(jsonb_path_query_array(v_work -> 'facts', '$[*].id')), v_allowed);
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
            -- R5-DB-5 per slot: the DB rebuilds `value` from the blocks; answer_title is not part of it.
            v_value := private.wc_deliverable_markdown(v_blocks);
            if char_length(v_value) not between 1 and 8000 then
              v_reason := 'invalid_value';
            end if;
          end if;
          if v_reason is null then
            select (o - 1)::integer into v_qidx
              from jsonb_array_elements(v_work #> '{document,questions}') with ordinality as t (q, o)
             where q ->> 'slot' = v_slot;
            v_cur := case when v_qidx is null then '{}'::jsonb
                          else v_work #> array['document', 'questions', v_qidx::text, 'draft'] end;
            v_draft_obj := case when v_slot_sources is null then '{}'::jsonb
                                else jsonb_build_object('sources', v_slot_sources) end
              || jsonb_build_object(
              'answer_title', to_jsonb(v_title),
              'value', v_value, 'blocks', v_blocks, 'rev', private.wc_next_rev(v_cur),
              'char_count', (v_draft_obj ->> 'char_count')::integer,
              'char_limit_at_generation', v_draft_obj -> 'char_limit_at_generation',
              'char_adjust_needed', coalesce(v_draft_obj -> 'char_adjust_needed', 'false'::jsonb),
              'correction_applied', coalesce(v_draft_obj -> 'correction_applied', 'false'::jsonb),
              'generated_at', now(), 'base_body_hash', v_draft_obj -> 'base_body_hash',
              'replace_allowed', coalesce(v_draft_obj -> 'replace_allowed', 'true'::jsonb),
              'missing_slots', coalesce(v_draft_obj -> 'missing_slots', '[]'::jsonb),
              'dropped_block_count', coalesce((v_draft_obj ->> 'dropped_block_count')::integer, 0),
              'applied_at', null, 'applied_rev', null);
            if v_qidx is null then
              v_work := jsonb_set(v_work, '{document,questions}',
                (v_work #> '{document,questions}') || jsonb_build_array(jsonb_build_object(
                  'slot', v_slot,
                  'question_id', case when private.wc_is_uuid(v_op -> 'question_id')
                                      then to_jsonb(lower(v_op ->> 'question_id')) else 'null'::jsonb end,
                  'draft', v_draft_obj)));
            else
              v_work := jsonb_set(v_work, array['document', 'questions', v_qidx::text, 'draft'], v_draft_obj);
            end if;
          end if;
        end if;
      end if;
      if v_reason is null then
        v_work := jsonb_set(v_work, '{draft_count}',
                            to_jsonb(coalesce((v_work ->> 'draft_count')::integer, 0) + 1));
      end if;

    elsif v_kind = 'set_tone' then
      -- DM §2.5.0b: the tone asked for IN THIS CHAT. The canonical value is application_documents.meta.tone.
      if coalesce(jsonb_typeof(v_op -> 'value'), 'null') <> 'null'
         and (jsonb_typeof(v_op -> 'value') <> 'string'
              or (v_op ->> 'value') not in ('concise', 'detailed')) then
        v_reason := 'invalid_value';
      else
        v_work := jsonb_set(v_work, '{meta}', coalesce(v_work -> 'meta', '{}'::jsonb) || jsonb_build_object(
          'tone_requested', coalesce(v_op -> 'value', 'null'::jsonb),
          'tone_requested_at', case when coalesce(jsonb_typeof(v_op -> 'value'), 'null') = 'null'
                                    then 'null'::jsonb else to_jsonb(now()) end));
      end if;

    elsif v_kind = 'set_question_edit_proposal' then
      v_item := v_op -> 'items';
      if jsonb_typeof(v_item) is distinct from 'array' or jsonb_array_length(v_item) > 10
         or exists (
           select 1 from jsonb_array_elements(v_item) c
            where jsonb_typeof(c) <> 'object'
               or coalesce(c ->> 'op', '') not in ('add', 'update', 'remove')
               or coalesce(jsonb_typeof(c -> 'slot'), 'null') not in ('string', 'null')
               or (coalesce(jsonb_typeof(c -> 'slot'), 'null') = 'string' and (c ->> 'slot') !~ c_slot_re)
               or coalesce(jsonb_typeof(c -> 'question_text'), 'null') not in ('string', 'null')
               or char_length(c ->> 'question_text') > 1000
               or coalesce(jsonb_typeof(c -> 'char_limit'), 'null') not in ('number', 'null')) then
        raise exception using errcode = 'P0001', message = 'invalid_patch',
          detail = 'op ' || v_i || ' question_edit_proposal';
      end if;
      v_work := jsonb_set(v_work, '{document,question_edit_proposal}', coalesce((
        select jsonb_agg(jsonb_build_object('slot', c -> 'slot', 'op', c ->> 'op',
                                            'question_text', c -> 'question_text',
                                            'char_limit', c -> 'char_limit'))
          from jsonb_array_elements(v_item) c), '[]'::jsonb));

    elsif v_kind = 'set_clarifications' then
      v_item := v_op -> 'items';
      if jsonb_typeof(v_item) is distinct from 'array' or jsonb_array_length(v_item) > 50
         or exists (
           select 1 from jsonb_array_elements(v_item) c
            where jsonb_typeof(c) <> 'object'
               or coalesce(c ->> 'kind', '') not in ('actor_ambiguous', 'number_vague')
               or coalesce(jsonb_typeof(c -> 'slot'), 'null') not in ('string', 'null')
               or (coalesce(jsonb_typeof(c -> 'slot'), 'null') = 'string' and (c ->> 'slot') !~ c_slot_re)
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

    else -- accept_block / remove_block (+ slot)
      v_slot := v_op ->> 'slot';
      if v_slot is null or v_slot !~ c_slot_re
         or jsonb_typeof(v_op -> 'block_id') is distinct from 'string' then
        raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' slot';
      end if;
      select (o - 1)::integer into v_qidx
        from jsonb_array_elements(v_work #> '{document,questions}') with ordinality as t (q, o)
       where q ->> 'slot' = v_slot;
      v_cur := case when v_qidx is null then null
                    else v_work #> array['document', 'questions', v_qidx::text, 'draft'] end;
      if jsonb_typeof(v_cur) is distinct from 'object' then
        raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' slot';
      end if;
      select (o - 1)::integer into v_idx
        from jsonb_array_elements(coalesce(v_cur -> 'blocks', '[]'::jsonb)) with ordinality as t (b, o)
       where b ->> 'block_id' = v_op ->> 'block_id';
      if v_idx is null then
        raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' block_id';
      end if;
      if coalesce(jsonb_typeof(v_cur -> 'applied_at'), 'null') <> 'null' then
        v_reason := 'field_already_applied';
      elsif v_kind = 'accept_block' then
        if v_cur #>> array['blocks', v_idx::text, 'review'] is distinct from 'needs_review' then
          v_reason := 'invalid_review_transition';
        else
          -- rev unchanged (accepting does not change the text).
          v_work := jsonb_set(v_work,
            array['document', 'questions', v_qidx::text, 'draft', 'blocks', v_idx::text, 'review'], '"accepted"');
        end if;
      else
        v_blocks := (v_cur -> 'blocks') - v_idx;
        v_work := jsonb_set(v_work, array['document', 'questions', v_qidx::text, 'draft'],
          v_cur || jsonb_build_object('blocks', v_blocks,
                                      'value', private.wc_deliverable_markdown(v_blocks),
                                      'rev', private.wc_rev(v_cur) + 1));
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

revoke all on function private.wc_patch_document(public.writing_chats, jsonb, text) from public, anon;
grant execute on function private.wc_patch_document(public.writing_chats, jsonb, text) to authenticated, app_ai_writer;

-- Three-way target dispatch (DM §2.5 "대상 규칙": application_project_id -> document, else deliverable, else STAR).
-- A patch carrying another target's keys / a target mismatch is invalid_patch, which each branch raises.
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

  -- Locks only the chat row (never a career / document row), so it cannot deadlock with the page-save RPCs.
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

  if v_chat.application_project_id is not null then
    -- R15: target / document_kind mismatch with structured_draft.target is caught by wc_normalize_document_draft
    -- (an unmatched draft normalizes to the empty shape) and by the slot lookups.
    v_result := private.wc_patch_document(v_chat, v_ops, p_actor);
  elsif v_chat.project_deliverable_id is null then
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
