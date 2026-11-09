-- R15 수정 (R15-API-7, 리더 판정 2026-11-09) — 서류 대화의 `draft_count`는 **턴당 1**이다
-- 20261113003800's private.wc_patch_document raised structured_draft.draft_count once per `replace_draft` OP, so
-- a draft turn that proposed two questions cost 2. A 5-question cover letter goes round once in two draft turns
-- (3 + 2 questions) = five ops, which burned 5 of the 6 allowed and left the second round (the "고쳐 줘" pass)
-- refused with writing_chat_draft_limit_reached.
-- 판정 근거: AI 명세 C-14 "서류 작성 대화" — "대화당 초안 제안 ≤ 6회 … **제안 단위가 '최대 3문항'**이라 자소서
-- 5문항이면 초안 턴 2회면 한 바퀴가 돈다". 한 제안 = 한 초안 턴(문항 최대 3개)이므로 6회는 **초안 턴 6회**이고
-- 6회면 세 바퀴다. 보강: ① AI 7.4의 비용 단위는 compose **호출**이다("초안 턴이 질문 턴의 약 10배") — 한 턴이
-- 문항 3개를 써도 호출은 1회 ② DM §2.5.0b는 "문항별 6회가 아니다"(슬롯별 6회를 부정한 것이고, 한 턴이 슬롯 수
-- 만큼 소모한다는 뜻이 아니다) ③ 화면이 "6 − draft_count"를 남은 횟수로 보인다.
-- 그래서 `replace_draft`/`count_draft`를 하나 이상 **적용한 패치 호출당 1**만 올린다(연산이 3개여도 +1).
--   * 산출물(2.5.0a)·STAR 분기는 **건드리지 않았다** — 슬롯이 하나라 "연산당 = 턴당"이어서 결과가 같고, 고치면
--     회귀가 된다. 서류는 슬롯이 여러 개여서 처음 갈라졌다.
--   * 사전 검사와 `writing_chat_draft_limit_reached`(409)는 그대로. 한 호출 안에서 count가 바뀌지 않으므로
--     거부 시점이 "6번째 턴 뒤"가 된다.
--   * 내용 블록이 하나도 안 남은 초안도 센다(AI 명세) — `replace_draft`가 거부되지 않았으면 블록이 비어도 +1,
--     `count_draft`만 온 턴도 +1.
CREATE OR REPLACE FUNCTION private.wc_patch_document(p_chat writing_chats, p_ops jsonb, p_actor text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  v_draft_turn boolean := false;   -- R15 (R15-API-7): one draft TURN, not one op
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
      -- R15 (R15-API-7, 리더 판정 2026-11-09): the count is per DRAFT TURN. A turn that proposes three
      -- questions sends three replace_draft ops and must still cost 1. The increment happens once, after the
      -- loop. The limit check above reads the unchanged count, so every op of this call sees the same value and
      -- a 6th-turn call is refused on its first draft op.
      if v_reason is null then
        v_draft_turn := true;
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

  -- One draft turn = +1, whatever the number of questions it proposed. `count_draft` (a draft whose content
  -- blocks were all dropped) counts too — AI 명세 "초안 횟수는 셈".
  if v_draft_turn then
    v_draft := jsonb_set(v_draft, '{draft_count}',
                         to_jsonb(coalesce((v_draft ->> 'draft_count')::integer, 0) + 1));
  end if;

  return jsonb_build_object('structured_draft', v_draft, 'rejected', v_rejected);
end;
$function$;
