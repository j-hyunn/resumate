-- R4 apply_structured_draft_patch v3 (DM v4.4 §2.5, AI-12 v4.5 mapping, CR-20, R-CR-14, R-CR-15).
-- structured_draft v3 = { schema_version: 3, project: {start_month, end_month}, star: {situation, task, action,
-- result, learnings}, classification: {project_type, experience_type, competencies}, clarifications,
-- sensitive_flags_count }. Field key = the projects column it would be applied to.
--
-- p_patch = { "ops": [ ... 1..100 ops, applied in order ... ] }
--   AI (app_ai_writer), chat must be active:
--     { op: "set" | "append", target: { section: "star", field }, value, source_message_ids, source_quotes, review? }
--     { op: "set", target: { section: "project", field: "start_month" | "end_month" }, value: "YYYY-MM",
--       source_message_ids, source_quotes, review? }
--     { op: "set", target: { section: "classification", field }, value, source_message_ids?, reason? }
--     { op: "set_clarifications", items: [ { kind, field? } ] }        -- replaces the list
--     { op: "add_sensitive_flags", count }
--   user session, chat active or closed [가정]:
--     { op: "set", target, value }      -- edit (null value clears the field)
--     { op: "accept" | "reject", target }
-- AI ops that break a field rule are skipped and reported in `rejected`; a user op that breaks one raises.
-- Returns { structured_draft, rejected: [ { index, op, reason } ] }.

-- v3 drafts only: anything else (v1 rows were cleared in 20261109100100) normalizes to an empty v3 draft.
create or replace function private.wc_normalize_draft(p_draft jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select private.writing_chat_empty_draft()
         || case when p_draft ->> 'schema_version' = '3' then p_draft else '{}'::jsonb end;
$$;

revoke all on function private.wc_normalize_draft(jsonb) from public;
grant execute on function private.wc_normalize_draft(jsonb) to authenticated;

-- Value formats for STAR (≤ 2,000 chars) and period ('YYYY-MM').
create or replace function private.wc_value_ok(p_field text, p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null or jsonb_typeof(p_value) = 'null' then false
    when p_field in ('situation', 'task', 'action', 'result', 'learnings') then
      jsonb_typeof(p_value) = 'string' and char_length(btrim(p_value #>> '{}')) between 1 and 2000
    when p_field in ('start_month', 'end_month') then
      jsonb_typeof(p_value) = 'string' and (p_value #>> '{}') ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    else false
  end;
$$;

revoke all on function private.wc_value_ok(text, jsonb) from public;

-- CR-17 classification keys (same lists as the projects CHECKs).
create or replace function private.classification_keys(p_field text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_field
    when 'project_type' then array['new_build', 'improvement', 'operation', 'research', 'marketing',
                                   'process_improvement', 'migration', 'coursework', 'other']
    when 'experience_type' then array['impact', 'problem_solving', 'collaboration', 'leadership',
                                      'failure_recovery', 'new_challenge', 'customer_facing']
    when 'competencies' then array['problem_solving', 'analysis', 'planning', 'execution', 'communication',
                                   'collaboration', 'leadership', 'technical_expertise', 'customer_insight',
                                   'learning_agility']
  end;
$$;

revoke all on function private.classification_keys(text) from public;
-- Also called by apply_writing_chat_proposal (security invoker, user session).
grant execute on function private.classification_keys(text) to authenticated;

-- AI V-9i DB defense (DM §2.5): keys outside the list are dropped; competencies keeps distinct valid keys in order,
-- first 3. Returns null when nothing valid remains.
create or replace function private.wc_classification_value(p_field text, p_value jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_field in ('project_type', 'experience_type') then
      case when jsonb_typeof(p_value) = 'string'
                and (p_value #>> '{}') = any (private.classification_keys(p_field))
           then p_value end
    when p_field = 'competencies' and jsonb_typeof(p_value) = 'array' then
      (select nullif(jsonb_agg(k order by first_ord), '[]'::jsonb)
         from (select k, first_ord
                 from (select e #>> '{}' as k, min(o) as first_ord
                         from jsonb_array_elements(p_value) with ordinality as t (e, o)
                        where jsonb_typeof(e) = 'string'
                          and (e #>> '{}') = any (private.classification_keys('competencies'))
                        group by e #>> '{}') d
                order by first_ord
                limit 3) l)
  end;
$$;

revoke all on function private.wc_classification_value(text, jsonb) from public;
-- Also called by apply_writing_chat_proposal (security invoker, user session).
grant execute on function private.wc_classification_value(text, jsonb) to authenticated;

create or replace function private.apply_structured_draft_patch_impl(p_writing_chat_id uuid, p_patch jsonb,
                                                                     p_actor text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_star constant text[] := array['situation', 'task', 'action', 'result', 'learnings'];
  c_period constant text[] := array['start_month', 'end_month'];
  c_class constant text[] := array['project_type', 'experience_type', 'competencies'];
  c_ai_ops constant text[] := array['set', 'append', 'set_clarifications', 'add_sensitive_flags'];
  c_user_ops constant text[] := array['set', 'accept', 'reject'];
  v_uid uuid := auth.uid();
  v_chat public.writing_chats%rowtype;
  v_project public.projects%rowtype;
  v_draft jsonb;
  v_work jsonb;
  v_user_msg_ids uuid[];
  v_ops jsonb;
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
  v_live boolean;      -- v_cur exists and has not been applied yet
  v_filled boolean;    -- the projects column already has a value
  v_value jsonb;
  v_sources jsonb;
  v_quotes jsonb;
  v_review text;
  v_star_op text;
  v_note text;
  v_obj jsonb;
  v_item jsonb;
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

  -- Current project values (V-9h, classification "empty only"). Read, not locked: the apply RPC re-checks.
  select * into v_project from public.projects p where p.id = v_chat.project_id and p.user_id = v_uid;

  v_draft := private.wc_normalize_draft(v_chat.structured_draft);

  if p_actor = 'ai' then
    select coalesce(array_agg(m.id), '{}') into v_user_msg_ids
      from public.writing_chat_messages m
     where m.writing_chat_id = p_writing_chat_id and m.role = 'user';
  end if;

  for v_i in 0 .. jsonb_array_length(v_ops) - 1 loop
    v_op := v_ops -> v_i;
    v_kind := v_op ->> 'op';
    if jsonb_typeof(v_op) <> 'object' or v_kind is null
       or not (v_kind = any (case when p_actor = 'ai' then c_ai_ops else c_user_ops end)) then
      raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i;
    end if;

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
      v_filled := case
        when v_section = 'star' then nullif(btrim(to_jsonb(v_project) ->> v_field), '') is not null
        when v_field = 'start_month' then v_project.start_month is not null
        -- An ongoing project (is_current) has no end month by definition (CR-22).
        when v_field = 'end_month' then v_project.end_month is not null or coalesce(v_project.is_current, false)
        when v_field in ('project_type', 'experience_type') then to_jsonb(v_project) ->> v_field is not null
        when v_field = 'competencies' then cardinality(coalesce(v_project.competencies, '{}')) > 0
        else false
      end;

      if v_section = 'project' and v_field = 'is_current' then
        -- R-CR-15: "진행 중" is the user's call in the period section, never a proposal.
        v_reason := 'field_not_patchable';

      elsif v_kind in ('set', 'append') and p_actor = 'ai' then
        if v_cur is not null and jsonb_typeof(v_cur) = 'object' and v_live
           and (v_cur ->> 'origin' = 'user_edit' or v_cur ->> 'review' = 'accepted') then
          v_reason := 'protected_field';
        elsif v_section = 'classification' then
          v_value := private.wc_classification_value(v_field, v_op -> 'value');
          if v_filled then
            v_reason := 'classification_already_set';
          elsif v_value is null then
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
              'review', 'ok', 'reviewed_at', null, 'applied_at', null), true);
          end if;
        else
          v_value := v_op -> 'value';
          v_sources := private.wc_sources(v_op -> 'source_message_ids', v_user_msg_ids);
          v_quotes := private.wc_quotes(v_op -> 'source_quotes');
          v_review := coalesce(v_op ->> 'review', 'ok');
          if v_review not in ('ok', 'needs_review') then
            raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' review';
          end if;
          if v_section = 'project' and v_filled then
            v_reason := 'field_already_filled';
          -- V-9h: a STAR column that already has a value only takes append (an append on an empty one is a set).
          elsif v_section = 'star' and v_kind = 'set' and v_filled then
            v_reason := 'field_already_filled';
          elsif not private.wc_value_ok(v_field, v_value) then
            v_reason := 'invalid_value';
          elsif v_sources is null or v_quotes is null then
            v_reason := 'invalid_source';
          else
            v_value := private.wc_clean_value(v_value);
            v_star_op := case when v_filled then 'append' else 'set' end;
            -- Same field, not applied yet: set replaces, append adds a line (AI-12 mapping).
            if v_section = 'star' and v_kind = 'append' and v_live
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
                'review', v_review, 'reviewed_at', null, 'applied_at', null);
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
          -- Clearing a field removes it: it becomes an empty slot again.
          v_work := v_work #- v_path;
        elsif v_section = 'classification' then
          v_value := private.wc_classification_value(v_field, v_value);
          if v_filled then
            v_reason := 'classification_already_set';
          elsif v_value is null then
            v_reason := 'invalid_value';
          else
            v_work := jsonb_set(v_work, v_path, jsonb_build_object(
              'value', v_value, 'origin', 'user_edit', 'source_message_ids', coalesce(v_cur -> 'source_message_ids', '[]'::jsonb),
              'reason', v_cur -> 'reason', 'review', 'ok', 'reviewed_at', null, 'applied_at', null), true);
          end if;
        elsif v_section = 'project' and v_filled then
          v_reason := 'field_already_filled';
        elsif not private.wc_value_ok(v_field, v_value) then
          v_reason := 'invalid_value';
        else
          v_obj := jsonb_build_object(
            'value', private.wc_clean_value(v_value), 'origin', 'user_edit', 'source_message_ids', '[]'::jsonb,
            'source_quotes', '[]'::jsonb, 'review', 'ok', 'reviewed_at', null, 'applied_at', null);
          if v_section = 'star' then
            -- V-9h for users too: the op follows the project column (filled -> append, empty -> set).
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
          v_work := jsonb_set(v_work, v_path, v_cur || jsonb_build_object('review', 'accepted', 'reviewed_at', now()));
        else
          -- Reject: empty again (AI asks for it later), not protected.
          v_obj := jsonb_build_object(
            'value', null, 'origin', 'ai', 'source_message_ids', '[]'::jsonb, 'source_quotes', '[]'::jsonb,
            'review', 'ok', 'reviewed_at', now(), 'applied_at', null);
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

  update public.writing_chats w
     set structured_draft = v_draft, last_activity_at = now()
   where w.id = p_writing_chat_id;

  return jsonb_build_object('structured_draft', v_draft, 'rejected', v_rejected);
end;
$$;

revoke all on function private.apply_structured_draft_patch_impl(uuid, jsonb, text) from public;
grant execute on function private.apply_structured_draft_patch_impl(uuid, jsonb, text) to authenticated, app_ai_writer;
