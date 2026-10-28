-- S4: apply_structured_draft_patch (DM §2.5 R-29, AI-12 매핑표, V-9a / V-9h) + set_writing_chat_affiliation.
-- The patch format is the contract in _workspace/backend/S4/02_db-engineer_notes.md ("패치 계약").
--
-- apply_structured_draft_patch is a security-invoker wrapper that decides the actor from the calling role
-- (app_ai_writer = AI, authenticated = user; DM: "행위자는 인자가 아니라 호출 역할로 판정") and calls the
-- definer implementation in `private` (not exposed through PostgREST), which is the only code that writes
-- writing_chats.structured_draft besides set_writing_chat_affiliation.

-- ── helpers (pure) ─────────────────────────────────────────────────────────
create or replace function private.wc_is_uuid(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p) = 'string'
     and (p #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$$;

create or replace function private.wc_normalized_name(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- Same expression as skills.normalized_name (S2).
  select lower(regexp_replace(btrim(p), '\s+', ' ', 'g'));
$$;

-- Value shape per storage column (DM §2.5 "값 형식은 컬럼 타입을 따른다", length limits of the columns).
create or replace function private.wc_value_ok(p_field text, p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null or jsonb_typeof(p_value) = 'null' then false
    when p_field in ('name', 'role', 'title') then
      jsonb_typeof(p_value) = 'string' and char_length(btrim(p_value #>> '{}')) between 1 and 100
    when p_field = 'summary' then
      jsonb_typeof(p_value) = 'string' and char_length(btrim(p_value #>> '{}')) between 1 and 200
    when p_field in ('situation', 'task', 'action', 'result', 'learnings') then
      jsonb_typeof(p_value) = 'string' and char_length(btrim(p_value #>> '{}')) between 1 and 2000
    when p_field = 'metric_name' then
      jsonb_typeof(p_value) = 'string' and char_length(btrim(p_value #>> '{}')) between 1 and 200
    when p_field = 'unit' then
      jsonb_typeof(p_value) = 'string' and char_length(btrim(p_value #>> '{}')) between 1 and 50
    when p_field in ('start_month', 'end_month') then
      jsonb_typeof(p_value) = 'string' and (p_value #>> '{}') ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    when p_field = 'team_size' then
      jsonb_typeof(p_value) = 'number' and (p_value #>> '{}')::numeric = trunc((p_value #>> '{}')::numeric)
      and (p_value #>> '{}')::numeric between 1 and 32767
    when p_field in ('value_before', 'value_after') then
      jsonb_typeof(p_value) = 'number'
    else false
  end;
$$;

-- Strings are stored trimmed.
create or replace function private.wc_clean_value(p_value jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p_value) = 'string' then to_jsonb(btrim(p_value #>> '{}')) else p_value end;
$$;

-- V-9a: 1..20 ids, every one a user message of this chat. Returns the normalized (lower-case, distinct)
-- array, or null when the check fails.
create or replace function private.wc_sources(p_ids jsonb, p_allowed uuid[])
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_el jsonb;
begin
  if jsonb_typeof(p_ids) is distinct from 'array'
     or jsonb_array_length(p_ids) not between 1 and 20 then
    return null;
  end if;
  for v_el in select * from jsonb_array_elements(p_ids) loop
    if not private.wc_is_uuid(v_el) or not ((v_el #>> '{}')::uuid = any (coalesce(p_allowed, '{}'))) then
      return null;
    end if;
  end loop;
  return (select jsonb_agg(distinct lower(e #>> '{}')) from jsonb_array_elements(p_ids) e);
end;
$$;

-- source_quotes: absent -> []; else up to 20 strings of <= 1000 chars. null when malformed.
create or replace function private.wc_quotes(p_quotes jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_quotes is null or jsonb_typeof(p_quotes) = 'null' then '[]'::jsonb
    when jsonb_typeof(p_quotes) <> 'array' or jsonb_array_length(p_quotes) > 20 then null
    when exists (select 1 from jsonb_array_elements(p_quotes) e
                  where jsonb_typeof(e) <> 'string' or char_length(e #>> '{}') > 1000) then null
    else p_quotes
  end;
$$;

-- Ensure every top-level key of the stored format exists.
create or replace function private.wc_normalize_draft(p_draft jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select private.writing_chat_empty_draft() || coalesce(p_draft, '{}'::jsonb);
$$;

revoke all on function private.wc_is_uuid(jsonb) from public;
revoke all on function private.wc_normalized_name(text) from public;
revoke all on function private.wc_value_ok(text, jsonb) from public;
revoke all on function private.wc_clean_value(jsonb) from public;
revoke all on function private.wc_sources(jsonb, uuid[]) from public;
revoke all on function private.wc_quotes(jsonb) from public;
revoke all on function private.wc_normalize_draft(jsonb) from public;
-- save_writing_chat (security invoker) uses these as the user.
grant execute on function private.wc_normalized_name(text) to authenticated;
grant execute on function private.wc_normalize_draft(jsonb) to authenticated;

-- Index (0-based) of the details[] item for a detail_key or an existing_detail_id; null when absent.
create or replace function private.wc_detail_index(p_draft jsonb, p_detail_key text, p_existing_detail_id uuid)
returns integer
language sql
immutable
set search_path = ''
as $$
  select (e.ord - 1)::integer
    from jsonb_array_elements(p_draft -> 'details') with ordinality e (item, ord)
   where (p_detail_key is not null and e.item ->> 'detail_key' = p_detail_key)
      or (p_existing_detail_id is not null and e.item ->> 'existing_detail_id' = p_existing_detail_id::text)
   limit 1;
$$;

revoke all on function private.wc_detail_index(jsonb, text, uuid) from public;


-- ── implementation ─────────────────────────────────────────────────────────
create or replace function private.apply_structured_draft_patch_impl(
  p_writing_chat_id uuid,
  p_patch jsonb,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_project_fields constant text[] := array['name', 'role', 'summary', 'start_month', 'end_month', 'team_size'];
  c_detail_fields constant text[] := array['title', 'situation', 'task', 'action', 'result', 'learnings'];
  c_achievement_fields constant text[] := array['metric_name', 'value_before', 'value_after', 'unit'];
  c_ai_ops constant text[] := array['set', 'new_detail', 'add_achievement', 'add_skill',
                                    'set_affiliation_suggestion', 'set_clarifications', 'add_sensitive_flags'];
  c_user_ops constant text[] := array['set', 'accept', 'reject', 'new_detail', 'remove_detail', 'add_achievement',
                                      'remove_achievement', 'add_skill', 'remove_skill'];
  c_detail_key_re constant text := '^D[1-9][0-9]{0,2}$';
  c_achievement_key_re constant text := '^A[1-9][0-9]{0,3}$';
  v_uid uuid := auth.uid();
  v_chat public.writing_chats%rowtype;
  v_draft jsonb;
  v_work jsonb;
  v_user_msg_ids uuid[];
  v_ops jsonb;
  v_op jsonb;
  v_kind text;
  v_i integer;
  v_reason text;
  v_rejected jsonb := '[]'::jsonb;
  -- target resolution
  v_target jsonb;
  v_section text;
  v_field text;
  v_detail_key text;
  v_existing uuid;
  v_di integer;
  v_ai integer;
  v_path text[];
  v_cur jsonb;
  v_value jsonb;
  v_sources jsonb;
  v_quotes jsonb;
  v_review text;
  v_obj jsonb;
  v_filled boolean;
  -- misc
  v_item jsonb;
  v_fields jsonb;
  v_key text;
  v_fi jsonb;
  v_ach jsonb;
  v_n integer;
  v_name text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_actor is null or p_actor not in ('ai', 'user') then
    raise exception using errcode = 'P0001', message = 'invalid_patch';
  end if;
  -- QA-S4-06: the actor must match the role that called (SET ROLE survives the definer switch), so the
  -- argument can't be forged even if `private` were ever exposed.
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
  if v_chat.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'writing_chat_not_active';
  end if;

  v_ops := p_patch -> 'ops';
  if jsonb_typeof(p_patch) is distinct from 'object' or jsonb_typeof(v_ops) is distinct from 'array'
     or jsonb_array_length(v_ops) not between 1 and 100 then
    raise exception using errcode = 'P0001', message = 'invalid_patch';
  end if;

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

    -- ── ops with a field target ──
    if v_kind in ('set', 'accept', 'reject') then
      v_target := v_op -> 'target';
      v_section := v_target ->> 'section';
      v_field := v_target ->> 'field';
      v_existing := null;
      v_detail_key := null;
      if jsonb_typeof(v_target) is distinct from 'object'
         or v_section is null or v_section not in ('project', 'detail', 'achievement')
         or v_field is null
         or (v_section = 'project' and not (v_field = any (c_project_fields)))
         or (v_section = 'detail' and not (v_field = any (c_detail_fields)))
         or (v_section = 'achievement' and not (v_field = any (c_achievement_fields))) then
        raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' target';
      end if;

      if v_section = 'project' then
        v_path := array['project', v_field];
      elsif v_section = 'detail' then
        if (v_target ? 'detail_key') = (v_target ? 'existing_detail_id') then
          raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' detail locator';
        end if;
        if v_target ? 'detail_key' then
          v_detail_key := v_target ->> 'detail_key';
          if v_detail_key is null or v_detail_key !~ c_detail_key_re then
            raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' detail_key';
          end if;
          v_di := private.wc_detail_index(v_work, v_detail_key, null);
          if v_di is null then
            v_reason := 'detail_not_found';
          end if;
        else
          if not private.wc_is_uuid(v_target -> 'existing_detail_id') then
            raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' existing_detail_id';
          end if;
          v_existing := (v_target ->> 'existing_detail_id')::uuid;
          -- V-9h: the reference must be a detail of this chat's (augment) project.
          if v_chat.mode <> 'augment_project'
             or not exists (select 1 from public.project_details d
                             where d.id = v_existing and d.project_id = v_chat.project_id and d.user_id = v_uid) then
            v_reason := 'detail_not_found';
          else
            v_di := private.wc_detail_index(v_work, null, v_existing);
            if v_di is null then
              if v_kind = 'set' then
                v_work := jsonb_set(v_work, '{details}', (v_work -> 'details') || jsonb_build_array(
                  jsonb_build_object('detail_key', null, 'existing_detail_id', v_existing,
                                     'fields', '{}'::jsonb, 'achievements', '[]'::jsonb)));
                v_di := jsonb_array_length(v_work -> 'details') - 1;
              else
                v_reason := 'detail_not_found';
              end if;
            end if;
          end if;
        end if;
        if v_reason is null then
          v_path := array['details', v_di::text, 'fields', v_field];
        end if;
      else
        v_key := v_target ->> 'achievement_key';
        if v_key is null or v_key !~ c_achievement_key_re then
          raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' achievement_key';
        end if;
        select (d.ord - 1)::integer, (a.ord - 1)::integer into v_di, v_ai
          from jsonb_array_elements(v_work -> 'details') with ordinality d (item, ord)
          cross join lateral jsonb_array_elements(d.item -> 'achievements') with ordinality a (ach, ord)
         where a.ach ->> 'achievement_key' = v_key
         limit 1;
        if not found then
          v_reason := 'achievement_not_found';
        else
          v_path := array['details', v_di::text, 'achievements', v_ai::text, v_field];
        end if;
      end if;

      if v_reason is null then
        v_cur := v_work #> v_path;

        if v_kind = 'set' then
          -- V-9h (AI and user): never target a column that the existing row already has.
          if v_section = 'project' and v_chat.mode = 'augment_project' then
            select nullif(btrim(to_jsonb(p) ->> v_field), '') is not null into v_filled
              from public.projects p where p.id = v_chat.project_id and p.user_id = v_uid;
            if v_filled then
              v_reason := 'field_already_filled';
            end if;
          elsif v_section = 'detail' and v_existing is not null then
            select nullif(btrim(to_jsonb(d) ->> v_field), '') is not null into v_filled
              from public.project_details d where d.id = v_existing and d.user_id = v_uid;
            if v_filled then
              v_reason := 'field_already_filled';
            end if;
          end if;

          if v_reason is null and p_actor = 'ai' then
            v_value := v_op -> 'value';
            v_sources := private.wc_sources(v_op -> 'source_message_ids', v_user_msg_ids);
            v_quotes := private.wc_quotes(v_op -> 'source_quotes');
            v_review := coalesce(v_op ->> 'review', 'ok');
            if v_review not in ('ok', 'needs_review') then
              raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' review';
            end if;
            if v_cur is not null and (v_cur ->> 'origin' = 'user_edit' or v_cur ->> 'review' = 'accepted') then
              v_reason := 'protected_field';
            elsif not private.wc_value_ok(v_field, v_value) then
              v_reason := 'invalid_value';
            elsif v_sources is null or v_quotes is null then
              v_reason := 'invalid_source';
            else
              v_work := jsonb_set(v_work, v_path, jsonb_build_object(
                'value', private.wc_clean_value(v_value), 'origin', 'ai', 'source_message_ids', v_sources,
                'source_quotes', v_quotes, 'review', v_review, 'reviewed_at', null), true);
            end if;
          elsif v_reason is null then
            v_value := v_op -> 'value';
            if v_value is null or jsonb_typeof(v_value) = 'null' then
              -- Clearing a field removes it: it becomes an empty slot again.
              v_work := v_work #- v_path;
            elsif not private.wc_value_ok(v_field, v_value) then
              v_reason := 'invalid_value';
            else
              v_work := jsonb_set(v_work, v_path, jsonb_build_object(
                'value', private.wc_clean_value(v_value), 'origin', 'user_edit', 'source_message_ids', '[]'::jsonb,
                'source_quotes', '[]'::jsonb, 'review', 'ok', 'reviewed_at', null), true);
            end if;
          end if;

        elsif v_kind = 'accept' then
          if v_cur is null or v_cur ->> 'review' is distinct from 'needs_review' then
            v_reason := 'invalid_review_transition';
          else
            v_work := jsonb_set(v_work, v_path,
              v_cur || jsonb_build_object('review', 'accepted', 'reviewed_at', now()));
          end if;

        else -- reject: empty again (AI asks for it later), not protected.
          if v_cur is null or v_cur ->> 'review' is distinct from 'needs_review' then
            v_reason := 'invalid_review_transition';
          else
            v_work := jsonb_set(v_work, v_path, jsonb_build_object(
              'value', null, 'origin', 'ai', 'source_message_ids', '[]'::jsonb, 'source_quotes', '[]'::jsonb,
              'review', 'ok', 'reviewed_at', now()));
          end if;
        end if;
      end if;

    -- ── details ──
    elsif v_kind = 'new_detail' then
      v_detail_key := v_op ->> 'detail_key';
      if v_detail_key is null or v_detail_key !~ c_detail_key_re then
        raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' detail_key';
      end if;
      if private.wc_detail_index(v_work, v_detail_key, null) is null then
        v_work := jsonb_set(v_work, '{details}', (v_work -> 'details') || jsonb_build_array(
          jsonb_build_object('detail_key', v_detail_key, 'existing_detail_id', null,
                             'fields', '{}'::jsonb, 'achievements', '[]'::jsonb)));
      end if;

    elsif v_kind = 'remove_detail' then
      if (v_op ? 'detail_key') = (v_op ? 'existing_detail_id')
         or (v_op ? 'detail_key' and coalesce(v_op ->> 'detail_key', '') !~ c_detail_key_re)
         or (v_op ? 'existing_detail_id' and not private.wc_is_uuid(v_op -> 'existing_detail_id')) then
        raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' detail locator';
      end if;
      v_detail_key := v_op ->> 'detail_key';
      v_existing := (v_op ->> 'existing_detail_id')::uuid;
      v_di := private.wc_detail_index(v_work, v_detail_key, v_existing);
      if v_di is null then
        v_reason := 'detail_not_found';
      else
        v_work := jsonb_set(v_work, '{details}', (v_work -> 'details') - v_di);
        v_work := jsonb_set(v_work, '{clarifications}', coalesce((
          select jsonb_agg(c) from jsonb_array_elements(v_work -> 'clarifications') c
           where not ((v_detail_key is not null and c ->> 'detail_key' = v_detail_key)
                      or (v_existing is not null and c ->> 'existing_detail_id' = v_existing::text))), '[]'::jsonb));
      end if;

    -- ── achievements ──
    elsif v_kind = 'add_achievement' then
      v_item := v_op -> 'detail';
      v_fields := v_op -> 'fields';
      if jsonb_typeof(v_item) is distinct from 'object' or jsonb_typeof(v_fields) is distinct from 'object'
         or (v_item ? 'detail_key') = (v_item ? 'existing_detail_id')
         or (v_item ? 'detail_key' and coalesce(v_item ->> 'detail_key', '') !~ c_detail_key_re)
         or (v_item ? 'existing_detail_id' and not private.wc_is_uuid(v_item -> 'existing_detail_id'))
         or exists (select 1 from jsonb_object_keys(v_fields) k where not (k = any (c_achievement_fields)))
         or exists (select 1 from jsonb_each(v_fields) f where jsonb_typeof(f.value) <> 'object') then
        raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' achievement';
      end if;
      v_detail_key := v_item ->> 'detail_key';
      v_existing := (v_item ->> 'existing_detail_id')::uuid;
      v_di := private.wc_detail_index(v_work, v_detail_key, v_existing);
      if v_di is null and v_existing is not null
         and v_chat.mode = 'augment_project'
         and exists (select 1 from public.project_details d
                      where d.id = v_existing and d.project_id = v_chat.project_id and d.user_id = v_uid) then
        v_work := jsonb_set(v_work, '{details}', (v_work -> 'details') || jsonb_build_array(
          jsonb_build_object('detail_key', null, 'existing_detail_id', v_existing,
                             'fields', '{}'::jsonb, 'achievements', '[]'::jsonb)));
        v_di := jsonb_array_length(v_work -> 'details') - 1;
      end if;
      if v_di is null then
        v_reason := 'detail_not_found';
      else
        select coalesce(max(substr(a ->> 'achievement_key', 2)::integer), 0) + 1 into v_n
          from jsonb_array_elements(v_work -> 'details') d
          cross join lateral jsonb_array_elements(d -> 'achievements') a;
        v_ach := jsonb_build_object('achievement_key', 'A' || v_n);
        for v_key, v_fi in select * from jsonb_each(v_fields) loop
          v_value := v_fi -> 'value';
          if v_value is null or jsonb_typeof(v_value) = 'null' then
            continue;
          end if;
          if not private.wc_value_ok(v_key, v_value) then
            v_reason := 'invalid_value';
            exit;
          end if;
          if p_actor = 'ai' then
            v_sources := private.wc_sources(v_fi -> 'source_message_ids', v_user_msg_ids);
            v_quotes := private.wc_quotes(v_fi -> 'source_quotes');
            v_review := coalesce(v_fi ->> 'review', 'ok');
            if v_review not in ('ok', 'needs_review') then
              raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' review';
            end if;
            if v_sources is null or v_quotes is null then
              v_reason := 'invalid_source';
              exit;
            end if;
            v_ach := v_ach || jsonb_build_object(v_key, jsonb_build_object(
              'value', private.wc_clean_value(v_value), 'origin', 'ai', 'source_message_ids', v_sources,
              'source_quotes', v_quotes, 'review', v_review, 'reviewed_at', null));
          else
            v_ach := v_ach || jsonb_build_object(v_key, jsonb_build_object(
              'value', private.wc_clean_value(v_value), 'origin', 'user_edit', 'source_message_ids', '[]'::jsonb,
              'source_quotes', '[]'::jsonb, 'review', 'ok', 'reviewed_at', null));
          end if;
        end loop;
        if v_reason is null and (select count(*) from jsonb_object_keys(v_ach)) = 1 then
          v_reason := 'invalid_value'; -- no field with a value
        end if;
        if v_reason is null then
          v_work := jsonb_set(v_work, array['details', v_di::text, 'achievements'],
                              (v_work #> array['details', v_di::text, 'achievements']) || jsonb_build_array(v_ach));
        end if;
      end if;

    elsif v_kind = 'remove_achievement' then
      v_key := v_op ->> 'achievement_key';
      if v_key is null or v_key !~ c_achievement_key_re then
        raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' achievement_key';
      end if;
      select (d.ord - 1)::integer, (a.ord - 1)::integer into v_di, v_ai
        from jsonb_array_elements(v_work -> 'details') with ordinality d (item, ord)
        cross join lateral jsonb_array_elements(d.item -> 'achievements') with ordinality a (ach, ord)
       where a.ach ->> 'achievement_key' = v_key
       limit 1;
      if not found then
        v_reason := 'achievement_not_found';
      else
        v_work := jsonb_set(v_work, array['details', v_di::text, 'achievements'],
                            (v_work #> array['details', v_di::text, 'achievements']) - v_ai);
      end if;

    -- ── skills ──
    elsif v_kind in ('add_skill', 'remove_skill') then
      v_value := v_op -> 'value';
      if jsonb_typeof(v_value) is distinct from 'string' then
        raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' value';
      end if;
      v_name := btrim(v_value #>> '{}');
      if v_kind = 'remove_skill' then
        v_work := jsonb_set(v_work, '{skills}', coalesce((
          select jsonb_agg(s) from jsonb_array_elements(v_work -> 'skills') s
           where private.wc_normalized_name(s ->> 'value') <> private.wc_normalized_name(v_name)), '[]'::jsonb));
      elsif char_length(v_name) not between 1 and 50 then
        v_reason := 'invalid_value';
      else
        if p_actor = 'ai' then
          v_sources := private.wc_sources(v_op -> 'source_message_ids', v_user_msg_ids);
          v_quotes := private.wc_quotes(v_op -> 'source_quotes');
          if v_sources is null or v_quotes is null then
            v_reason := 'invalid_source';
          end if;
        else
          v_sources := '[]'::jsonb;
          v_quotes := '[]'::jsonb;
        end if;
        if v_reason is null then
          select (e.ord - 1)::integer into v_di
            from jsonb_array_elements(v_work -> 'skills') with ordinality e (s, ord)
           where private.wc_normalized_name(e.s ->> 'value') = private.wc_normalized_name(v_name)
           limit 1;
          if not found then
            v_work := jsonb_set(v_work, '{skills}', (v_work -> 'skills') || jsonb_build_array(jsonb_build_object(
              'value', v_name, 'source_message_ids', v_sources, 'source_quotes', v_quotes)));
          elsif p_actor = 'ai' then
            v_cur := v_work #> array['skills', v_di::text];
            v_work := jsonb_set(v_work, array['skills', v_di::text], v_cur || jsonb_build_object(
              'source_message_ids', (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from jsonb_array_elements(
                 coalesce(v_cur -> 'source_message_ids', '[]'::jsonb) || v_sources) x),
              'source_quotes', (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from jsonb_array_elements(
                 coalesce(v_cur -> 'source_quotes', '[]'::jsonb) || v_quotes) x)));
          end if;
        end if;
      end if;

    -- ── AI-only metadata ──
    elsif v_kind = 'set_affiliation_suggestion' then
      if coalesce(v_op ->> 'type', '') not in ('experience', 'education') or not private.wc_is_uuid(v_op -> 'id') then
        raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' affiliation';
      end if;
      v_sources := private.wc_sources(v_op -> 'source_message_ids', v_user_msg_ids);
      if v_chat.mode = 'augment_project' then
        v_reason := 'affiliation_not_editable';
      elsif (v_op ->> 'type' = 'experience'
             and not exists (select 1 from public.experiences e where e.id = (v_op ->> 'id')::uuid and e.user_id = v_uid))
         or (v_op ->> 'type' = 'education'
             and not exists (select 1 from public.educations e where e.id = (v_op ->> 'id')::uuid and e.user_id = v_uid)) then
        v_reason := 'affiliation_not_found';
      elsif v_sources is null then
        v_reason := 'invalid_source';
      else
        v_work := jsonb_set(v_work, '{affiliation_suggestion}', jsonb_build_object(
          'type', v_op ->> 'type', 'id', lower(v_op ->> 'id'), 'source_message_ids', v_sources));
      end if;

    elsif v_kind = 'set_clarifications' then
      v_item := v_op -> 'items';
      if jsonb_typeof(v_item) is distinct from 'array' or jsonb_array_length(v_item) > 50
         or exists (
           select 1 from jsonb_array_elements(v_item) c
            where jsonb_typeof(c) <> 'object'
               or coalesce(c ->> 'kind', '') not in ('actor_ambiguous', 'number_vague', 'period_unclear', 'affiliation_unclear')
               or (c ? 'field' and jsonb_typeof(c -> 'field') not in ('string', 'null'))
               or char_length(coalesce(c ->> 'field', '')) > 50
               or (c ->> 'detail_key' is not null and (c ->> 'detail_key') !~ c_detail_key_re)
               or (c ->> 'existing_detail_id' is not null and not private.wc_is_uuid(c -> 'existing_detail_id'))) then
        raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' clarifications';
      end if;
      v_work := jsonb_set(v_work, '{clarifications}', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'kind', c ->> 'kind', 'field', c ->> 'field', 'detail_key', c ->> 'detail_key',
                 'existing_detail_id', lower(c ->> 'existing_detail_id')))
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
-- Reached only through the public wrapper below (private is not exposed through PostgREST).
grant execute on function private.apply_structured_draft_patch_impl(uuid, jsonb, text) to authenticated, app_ai_writer;

create or replace function public.apply_structured_draft_patch(p_writing_chat_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return private.apply_structured_draft_patch_impl(
    p_writing_chat_id, p_patch,
    case current_user when 'app_ai_writer' then 'ai' when 'authenticated' then 'user' end);
end;
$$;

revoke all on function public.apply_structured_draft_patch(uuid, jsonb) from public, anon;
grant execute on function public.apply_structured_draft_patch(uuid, jsonb) to authenticated, app_ai_writer;


-- ── set_writing_chat_affiliation ───────────────────────────────────────────
-- DM §3.3, R-28: [연결] / 직접 고르기 / 없음 -> columns + clear the suggestion;
-- [아니요] (p_dismiss_only = true) -> clear the suggestion only. Read-only in augment mode (UX S-36).
create or replace function public.set_writing_chat_affiliation(
  p_writing_chat_id uuid,
  p_experience_id uuid default null,
  p_education_id uuid default null,
  p_dismiss_only boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_chat public.writing_chats%rowtype;
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

  if coalesce(p_dismiss_only, false) then
    update public.writing_chats w
       set structured_draft = jsonb_set(private.wc_normalize_draft(w.structured_draft),
                                        '{affiliation_suggestion}', 'null'::jsonb),
           last_activity_at = now()
     where w.id = p_writing_chat_id;
    return;
  end if;

  if v_chat.mode = 'augment_project' then
    raise exception using errcode = 'P0001', message = 'affiliation_not_editable';
  end if;
  if p_experience_id is not null and p_education_id is not null then
    raise exception using errcode = 'P0001', message = 'invalid_affiliation';
  end if;
  if (p_experience_id is not null
      and not exists (select 1 from public.experiences e where e.id = p_experience_id and e.user_id = v_uid))
     or (p_education_id is not null
      and not exists (select 1 from public.educations e where e.id = p_education_id and e.user_id = v_uid)) then
    raise exception using errcode = 'P0001', message = 'affiliation_not_found';
  end if;

  update public.writing_chats w
     set experience_id = p_experience_id,
         education_id = p_education_id,
         structured_draft = jsonb_set(private.wc_normalize_draft(w.structured_draft),
                                      '{affiliation_suggestion}', 'null'::jsonb),
         last_activity_at = now()
   where w.id = p_writing_chat_id;
end;
$$;

revoke all on function public.set_writing_chat_affiliation(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.set_writing_chat_affiliation(uuid, uuid, uuid, boolean) to authenticated;
