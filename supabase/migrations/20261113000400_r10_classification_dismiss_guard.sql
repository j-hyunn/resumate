-- R10 classification dismiss guard (R9 QA-05, DM v4.10 11.5 #1 option (a), 2026-11-04). Non-destructive:
-- replaces private.wc_patch_star only. public.apply_structured_draft_patch / private.apply_structured_draft_patch_impl
-- are untouched: same signature (uuid, jsonb) -> jsonb { structured_draft, rejected }, grants, security definer entry.
-- No table / column / CHECK / schema_version change.
--
-- Change from R8 (20261113000300_r8_star_merged_proposal.sql):
--   * An AI `set` on a classification slot the user dismissed ([무시]) is rejected with reason
--     'classification_dismissed' (non-fatal: listed in `rejected`, the slot and every other op are kept).
--     "Dismissed" = the slot is an object, its value is null (or missing), and rev >= 2. The AI can never write a
--     null classification value (invalid_value) and a slot's first object has rev 1, so that state only comes from
--     the user's `set` null — the same judgment as the app's isDismissedClassification (structured-draft.ts).
--     R9 dropped these in the pipeline (V-9i) only, which reads the draft at turn start; a [무시] during a running
--     turn let that turn's suggestion refill the slot. The DB is now the authority.
--   * User ops are unchanged: picking a value on a dismissed slot (`set` value) or clearing it again still works.

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
  v_review_reason text;
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
        elsif v_section = 'classification'
              and jsonb_typeof(v_cur) = 'object'
              and coalesce(jsonb_typeof(v_cur -> 'value'), 'null') = 'null'
              and private.wc_rev(v_cur) >= 2 then
          -- R10 (R9 QA-05): the user dismissed this suggestion ([무시] = user `set` null) — never refill it.
          v_reason := 'classification_dismissed';
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
          -- R8-QA-4: optional review_reason (V-9j existing_missing | V-9e content_unverified); missing = null.
          if coalesce(jsonb_typeof(v_op -> 'review_reason'), 'null') <> 'null'
             and (jsonb_typeof(v_op -> 'review_reason') <> 'string'
                  or v_op ->> 'review_reason' not in ('existing_missing', 'content_unverified')) then
            raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' review_reason';
          end if;
          v_review_reason := v_op ->> 'review_reason';
          if not private.wc_value_ok(v_field, v_value) then
            v_reason := 'invalid_value';
          elsif v_sources is null or v_quotes is null then
            v_reason := 'invalid_source';
          else
            v_value := private.wc_clean_value(v_value);
            -- R8 V-9h (RQ-5): `set` is a full-replacement proposal even on a filled column (merged text);
            -- `append` (compatibility) keeps the R5 rule: the op follows the column (filled -> append).
            v_star_op := case when v_kind = 'set' then 'set' when v_filled then 'append' else 'set' end;
            -- Same field, pending (and not new_object): set replaces, append adds a line (AI-12 mapping).
            if v_section = 'star' and v_kind = 'append' and v_live and not v_new_obj
               and nullif(btrim(v_cur ->> 'value'), '') is not null then
              v_value := to_jsonb((v_cur ->> 'value') || E'\n' || (v_value #>> '{}'));
              select coalesce(jsonb_agg(distinct x), '[]'::jsonb) into v_sources
                from jsonb_array_elements(coalesce(v_cur -> 'source_message_ids', '[]'::jsonb) || v_sources) x;
              v_quotes := coalesce(v_cur -> 'source_quotes', '[]'::jsonb) || v_quotes;
              if v_cur ->> 'review' = 'needs_review' then
                v_review := 'needs_review';
                v_review_reason := coalesce(v_review_reason, v_cur ->> 'review_reason');
              end if;
              -- R8 QA-01: an append onto a pending merged `set` proposal stays a full replacement (op set),
              -- otherwise the screen would add form + merged + new text.
              if v_cur ->> 'op' = 'set' then
                v_star_op := 'set';
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
                -- review_reason is stored only on a needs_review STAR object (absent otherwise).
                if v_review = 'needs_review' and v_review_reason is not null then
                  v_obj := v_obj || jsonb_build_object('review_reason', v_review_reason);
                end if;
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
            -- V-9h for users too: the op follows the saved column (filled -> append, empty -> set), except that
            -- editing a pending `set` proposal (R8 merged proposal) stays a replacement.
            v_obj := v_obj || jsonb_build_object('op', case
              when v_live and v_cur ->> 'op' = 'set' and nullif(btrim(v_cur ->> 'value'), '') is not null then 'set'
              when v_filled then 'append' else 'set' end);
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
          v_work := jsonb_set(v_work, v_path, (v_cur - 'review_reason') || jsonb_build_object('review', 'accepted', 'reviewed_at', now()));
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
