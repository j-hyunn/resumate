-- R4 apply_writing_chat_proposal (DM v4.4 §3.3, §2.5; CR-5, CR-20, R-CR-15, T-18).
-- [반영] / [모두 반영]: copies reviewed proposal fields from writing_chats.structured_draft into projects.
--   * security invoker: the projects write runs under the user's RLS; the structured_draft / last_applied_at /
--     source_writing_chat_id writes go through definer helpers (no user grant on those columns).
--   * no key / consent / provider checks (no AI call).
--   * lock order: writing_chats row -> projects row (same as a turn).
--   * chat status active or closed.

-- Lock + read the chat (ownership check). Raises writing_chat_not_found.
create or replace function private.wc_proposal_lock(p_writing_chat_id uuid)
returns table (project_id uuid, structured_draft jsonb)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  return query
    select w.project_id, w.structured_draft from public.writing_chats w
     where w.id = p_writing_chat_id and w.user_id = v_uid
       for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'writing_chat_not_found';
  end if;
end;
$$;

revoke all on function private.wc_proposal_lock(uuid) from public;
grant execute on function private.wc_proposal_lock(uuid) to authenticated;

-- Stamp applied_at on the applied fields, the chat's last_applied_at / last_activity_at, and
-- projects.source_writing_chat_id (DM v4.4: the chat that last applied to this project).
create or replace function private.wc_proposal_mark_applied(p_writing_chat_id uuid, p_fields text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_draft jsonb;
  v_project_id uuid;
  v_field text;
  v_section text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  select w.structured_draft, w.project_id into v_draft, v_project_id
    from public.writing_chats w
   where w.id = p_writing_chat_id and w.user_id = v_uid
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'writing_chat_not_found';
  end if;
  if cardinality(coalesce(p_fields, '{}')) = 0 then
    return;
  end if;

  v_draft := private.wc_normalize_draft(v_draft);
  foreach v_field in array p_fields loop
    v_section := case
      when v_field in ('situation', 'task', 'action', 'result', 'learnings') then 'star'
      when v_field in ('start_month', 'end_month') then 'project'
      when v_field in ('project_type', 'experience_type', 'competencies') then 'classification'
    end;
    if v_section is not null and jsonb_typeof(v_draft #> array[v_section, v_field]) = 'object' then
      v_draft := jsonb_set(v_draft, array[v_section, v_field, 'applied_at'], to_jsonb(v_now), true);
    end if;
  end loop;

  update public.writing_chats w
     set structured_draft = v_draft, last_applied_at = v_now, last_activity_at = v_now
   where w.id = p_writing_chat_id;

  update public.projects p
     set source_writing_chat_id = p_writing_chat_id
   where p.id = v_project_id and p.user_id = v_uid
     and p.source_writing_chat_id is distinct from p_writing_chat_id;
end;
$$;

revoke all on function private.wc_proposal_mark_applied(uuid, text[]) from public;
grant execute on function private.wc_proposal_mark_applied(uuid, text[]) to authenticated;

create or replace function public.apply_writing_chat_proposal(p_writing_chat_id uuid, p_fields text[] default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c_all constant text[] := array['situation', 'task', 'action', 'result', 'learnings', 'start_month', 'end_month',
                                 'project_type', 'experience_type', 'competencies'];
  v_uid uuid := auth.uid();
  v_project_id uuid;
  v_draft jsonb;
  v_p public.projects%rowtype;
  v_fields text[];
  v_field text;
  v_section text;
  v_obj jsonb;
  v_value jsonb;
  v_text text;
  v_cur text;
  v_applied text[] := '{}';
  v_skipped jsonb := '[]'::jsonb;
  v_too_long text[] := '{}';
  v_status text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  if p_fields is not null
     and (array_position(p_fields, null) is not null or not (p_fields <@ c_all)) then
    raise exception using errcode = 'P0001', message = 'invalid_fields';
  end if;

  select l.project_id, l.structured_draft into v_project_id, v_draft
    from private.wc_proposal_lock(p_writing_chat_id) l;
  v_draft := private.wc_normalize_draft(v_draft);

  select * into v_p from public.projects p where p.id = v_project_id and p.user_id = v_uid for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'project_not_found';
  end if;

  -- null = every field the proposal has; otherwise the requested fields (canonical order).
  select coalesce(array_agg(f order by o), '{}') into v_fields
    from unnest(c_all) with ordinality as t (f, o)
   where case when p_fields is null
              then jsonb_typeof(v_draft #> array[
                     case when f in ('start_month', 'end_month') then 'project'
                          when f in ('project_type', 'experience_type', 'competencies') then 'classification'
                          else 'star' end, f]) = 'object'
              else f = any (p_fields) end;

  foreach v_field in array v_fields loop
    v_section := case when v_field in ('start_month', 'end_month') then 'project'
                      when v_field in ('project_type', 'experience_type', 'competencies') then 'classification'
                      else 'star' end;
    v_obj := v_draft #> array[v_section, v_field];
    v_value := case when jsonb_typeof(v_obj) = 'object' then v_obj -> 'value' end;
    if v_section = 'classification' then
      v_value := private.wc_classification_value(v_field, v_value);
    elsif jsonb_typeof(v_value) is distinct from 'string' or btrim(v_value #>> '{}') = '' then
      v_value := null;
    end if;

    if v_value is null then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('field', v_field, 'reason', 'empty'));
      continue;
    elsif coalesce(jsonb_typeof(v_obj -> 'applied_at'), 'null') <> 'null' then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('field', v_field, 'reason', 'already_applied'));
      continue;
    elsif coalesce(v_obj ->> 'review', 'ok') not in ('ok', 'accepted') then
      -- T-18: unreviewed needs_review fields stay in the card.
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('field', v_field, 'reason', 'needs_review'));
      continue;
    end if;

    if v_section = 'star' then
      -- Fill an empty column; otherwise append on a new line to whatever is there now (never replace).
      v_text := btrim(v_value #>> '{}');
      v_cur := to_jsonb(v_p) ->> v_field;
      if nullif(btrim(v_cur), '') is not null then
        v_text := v_cur || E'\n' || v_text;
      end if;
      if char_length(v_text) > 2000 then
        v_too_long := v_too_long || v_field;
      end if;
      case v_field
        when 'situation' then v_p.situation := v_text;
        when 'task' then v_p.task := v_text;
        when 'action' then v_p.action := v_text;
        when 'result' then v_p.result := v_text;
        when 'learnings' then v_p.learnings := v_text;
      end case;
    elsif v_section = 'project' then
      if (v_field = 'start_month' and v_p.start_month is not null)
         or (v_field = 'end_month' and (v_p.end_month is not null or v_p.is_current)) then
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('field', v_field, 'reason', 'period_already_set'));
        continue;
      end if;
      if v_field = 'start_month' then
        v_p.start_month := to_date((v_value #>> '{}') || '-01', 'YYYY-MM-DD');
      else
        v_p.end_month := to_date((v_value #>> '{}') || '-01', 'YYYY-MM-DD');
      end if;
    else
      -- CR-20: only into an empty classification (competencies: none picked yet); never overwrite.
      if (v_field = 'project_type' and v_p.project_type is not null)
         or (v_field = 'experience_type' and v_p.experience_type is not null)
         or (v_field = 'competencies' and cardinality(v_p.competencies) > 0) then
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('field', v_field, 'reason', 'classification_already_set'));
        continue;
      end if;
      case v_field
        when 'project_type' then v_p.project_type := v_value #>> '{}';
        when 'experience_type' then v_p.experience_type := v_value #>> '{}';
        when 'competencies' then
          v_p.competencies := array(select e from jsonb_array_elements_text(v_value) with ordinality as t (e, o) order by o);
      end case;
    end if;
    v_applied := v_applied || v_field;
  end loop;

  -- [가정] DM §3.3: all or nothing when a STAR column would pass 2,000 chars.
  if cardinality(v_too_long) > 0 then
    raise exception using errcode = 'P0001', message = 'field_too_long', detail = array_to_string(v_too_long, ',');
  end if;

  if v_p.start_month is not null and v_p.end_month is not null and v_p.end_month < v_p.start_month then
    raise exception using errcode = 'P0001', message = 'invalid_period';
  end if;

  if cardinality(v_applied) = 0 then
    return jsonb_build_object('applied', '[]'::jsonb, 'skipped', v_skipped, 'project_status', v_p.status);
  end if;

  -- status / content_updated_at / career_data_updated_at are recalculated by the projects triggers.
  update public.projects p
     set situation = v_p.situation, task = v_p.task, action = v_p.action, result = v_p.result,
         learnings = v_p.learnings, start_month = v_p.start_month, end_month = v_p.end_month,
         project_type = v_p.project_type, experience_type = v_p.experience_type, competencies = v_p.competencies
   where p.id = v_project_id and p.user_id = v_uid;

  perform private.wc_proposal_mark_applied(p_writing_chat_id, v_applied);

  select p.status into v_status from public.projects p where p.id = v_project_id;

  return jsonb_build_object('applied', to_jsonb(v_applied), 'skipped', v_skipped, 'project_status', v_status);
end;
$$;

revoke all on function public.apply_writing_chat_proposal(uuid, text[]) from public, anon;
grant execute on function public.apply_writing_chat_proposal(uuid, text[]) to authenticated;
