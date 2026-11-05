-- R11 OD-C6 (DM v4.11 2.5.1 멱등 키, 7장, 11.6 #9): save_project_page / save_project_deliverable take a last argument
-- p_client_id uuid default null — the id the screen generated when it opened a new page, sent with every create
-- request until the first save succeeds. Create requests only (target id argument null):
--   * a row of the caller with that id exists -> no new row; that row is saved with the update rules (expected
--     version ignored — a create request has none; an unchanged save writes nothing, R5-DB-11). Wrong shape -> the
--     update codes (project_not_affiliated / not_found).
--   * no such row -> insert with id = p_client_id.
--   * the id is another user's row (PK conflict, practically never) -> not_found (the other row is not revealed).
--   * a concurrent create with the same client id that commits first (our insert waits, then hits the PK): the
--     call runs again and saves as a replay of the caller's row (QA-02), so both requests succeed on one row.
--   * null -> server-generated id as before.
-- Update requests ignore p_client_id. A replayed p_applied_proposals entry already recorded comes back as
-- skipped / already_applied (unchanged rule). No `created` field in the response.
-- The old signatures are dropped (a defaulted extra argument would make overloaded calls ambiguous).

drop function public.save_project_page(uuid, jsonb, timestamptz, jsonb);
drop function public.save_project_deliverable(uuid, uuid, text, text, timestamptz, jsonb);

CREATE OR REPLACE FUNCTION public.save_project_page(p_project_id uuid, p_values jsonb, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_applied_proposals jsonb DEFAULT NULL::jsonb, p_client_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  c_keys constant text[] := array['name', 'experience_id', 'education_id', 'start_month', 'end_month', 'is_current',
                                  'project_type', 'experience_type', 'competencies',
                                  'situation', 'task', 'action', 'result', 'learnings'];
  c_text constant text[] := array['name', 'start_month', 'end_month', 'project_type', 'experience_type',
                                  'situation', 'task', 'action', 'result', 'learnings'];
  c_star constant text[] := array['situation', 'task', 'action', 'result', 'learnings'];
  c_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_uid uuid := auth.uid();
  v_vals jsonb := coalesce(nullif(p_values, 'null'::jsonb), '{}'::jsonb);
  v_props jsonb := coalesce(nullif(p_applied_proposals, 'null'::jsonb), '[]'::jsonb);
  v_bad text;
  v_create boolean := p_project_id is null;
  v_replay boolean := false;
  v_p public.projects%rowtype;
  v_old public.projects%rowtype;
  v_field text;
  v_txt text;
  v_el jsonb;
  v_ord bigint;
  v_reason text;
  v_results jsonb := '[]'::jsonb;
  v_last_chat uuid;
  v_status text;
  v_updated_at timestamptz;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  -- ── shape (nothing written yet) ──
  if jsonb_typeof(v_vals) <> 'object' then
    raise exception using errcode = 'P0001', message = 'invalid_fields', detail = 'p_values';
  end if;
  select string_agg(k, ',' order by k) into v_bad from jsonb_object_keys(v_vals) k where k <> all (c_keys);
  if v_bad is not null then
    raise exception using errcode = 'P0001', message = 'invalid_fields', detail = v_bad;
  end if;
  select string_agg(k, ',' order by k) into v_bad
    from jsonb_each(v_vals) as e (k, v)
   where jsonb_typeof(v) <> 'null'
     and ((k = any (c_text) and jsonb_typeof(v) <> 'string')
          or (k in ('experience_id', 'education_id') and (jsonb_typeof(v) <> 'string' or (v #>> '{}') !~* c_uuid_re))
          or (k = 'is_current' and jsonb_typeof(v) <> 'boolean')
          or (k = 'competencies' and jsonb_typeof(v) <> 'array'));
  if v_bad is not null then
    raise exception using errcode = 'P0001', message = 'invalid_fields', detail = v_bad;
  end if;
  if jsonb_typeof(v_props) <> 'array' or jsonb_array_length(v_props) > 50 then
    raise exception using errcode = 'P0001', message = 'invalid_fields', detail = 'p_applied_proposals';
  end if;

  -- ── target row ──
  -- OD-C6: a create request whose client id already names the caller's row is a replay of a create that went
  -- through (lost response) -> save that row with the update rules.
  if v_create and p_client_id is not null then
    perform 1 from public.projects p where p.id = p_client_id and p.user_id = v_uid;
    if found then
      v_create := false;
      v_replay := true;
    end if;
  end if;

  if v_create then
    v_p.id := coalesce(p_client_id, gen_random_uuid());
    v_p.user_id := v_uid;
    v_p.is_current := false;
    v_p.competencies := '{}';
  else
    select * into v_p from public.projects p
     where p.id = case when v_replay then p_client_id else p_project_id end and p.user_id = v_uid
       for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'not_found';
    end if;
    if num_nonnulls(v_p.experience_id, v_p.education_id) = 0 then
      -- S-43 standalone projects save by section (C-24).
      raise exception using errcode = 'P0001', message = 'project_not_affiliated';
    end if;
    if not v_replay and p_expected_updated_at is not null and v_p.updated_at <> p_expected_updated_at then
      raise exception using errcode = 'P0001', message = 'stale_write',
        detail = to_char(v_p.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
    end if;
    v_old := v_p;
  end if;

  -- ── merge: absent key = keep, null = clear ──
  if v_vals ? 'name' then
    v_p.name := btrim(v_vals ->> 'name');
  end if;
  if v_vals ? 'experience_id' then
    v_p.experience_id := (v_vals ->> 'experience_id')::uuid;
  end if;
  if v_vals ? 'education_id' then
    v_p.education_id := (v_vals ->> 'education_id')::uuid;
  end if;
  foreach v_field in array array['start_month', 'end_month'] loop
    if v_vals ? v_field then
      v_txt := v_vals ->> v_field;
      if v_txt is not null and v_txt !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
        raise exception using errcode = 'P0001', message = 'invalid_period', detail = v_field;
      end if;
      if v_field = 'start_month' then
        v_p.start_month := to_date(v_txt || '-01', 'YYYY-MM-DD');
      else
        v_p.end_month := to_date(v_txt || '-01', 'YYYY-MM-DD');
      end if;
    end if;
  end loop;
  if v_vals ? 'is_current' then
    v_p.is_current := coalesce((v_vals ->> 'is_current')::boolean, false);
  end if;
  foreach v_field in array array['project_type', 'experience_type'] loop
    if v_vals ? v_field then
      v_txt := v_vals ->> v_field;
      if v_txt is not null and v_txt <> all (private.classification_keys(v_field)) then
        raise exception using errcode = 'P0001', message = 'invalid_classification', detail = v_field;
      end if;
      if v_field = 'project_type' then
        v_p.project_type := v_txt;
      else
        v_p.experience_type := v_txt;
      end if;
    end if;
  end loop;
  if v_vals ? 'competencies' then
    if jsonb_typeof(v_vals -> 'competencies') = 'null' then
      v_p.competencies := '{}';
    elsif jsonb_array_length(v_vals -> 'competencies') > 3
          or exists (select 1 from jsonb_array_elements(v_vals -> 'competencies') e
                      where jsonb_typeof(e) <> 'string'
                         or (e #>> '{}') <> all (private.classification_keys('competencies')))
          or (select count(distinct e) from jsonb_array_elements(v_vals -> 'competencies') e)
             <> jsonb_array_length(v_vals -> 'competencies') then
      raise exception using errcode = 'P0001', message = 'invalid_classification', detail = 'competencies';
    else
      v_p.competencies := array(select e from jsonb_array_elements_text(v_vals -> 'competencies') with ordinality as t (e, o)
                                order by o);
    end if;
  end if;
  foreach v_field in array c_star loop
    if v_vals ? v_field then
      v_txt := v_vals ->> v_field;
      if char_length(v_txt) > 2000 then
        raise exception using errcode = 'P0001', message = 'field_too_long', detail = v_field;
      end if;
      -- Blank-only text is stored as empty (the status trigger treats it as empty anyway).
      v_txt := case when nullif(btrim(v_txt), '') is null then null else v_txt end;
      case v_field
        when 'situation' then v_p.situation := v_txt;
        when 'task' then v_p.task := v_txt;
        when 'action' then v_p.action := v_txt;
        when 'result' then v_p.result := v_txt;
        when 'learnings' then v_p.learnings := v_txt;
      end case;
    end if;
  end loop;

  -- ── value checks (DB CHECKs guard the same) ──
  if nullif(v_p.name, '') is null then
    raise exception using errcode = 'P0001', message = 'project_name_required';
  end if;
  if char_length(v_p.name) > 100 then
    raise exception using errcode = 'P0001', message = 'field_too_long', detail = 'name';
  end if;
  if num_nonnulls(v_p.experience_id, v_p.education_id) = 2
     or (v_create and num_nonnulls(v_p.experience_id, v_p.education_id) = 0) then
    raise exception using errcode = 'P0001', message = 'project_affiliation_required';
  end if;
  if num_nonnulls(v_p.experience_id, v_p.education_id) = 0 then
    -- update: affiliated -> standalone is not a move (PRD F-P1-03 (7) [가정]).
    raise exception using errcode = 'P0001', message = 'project_scope_change_not_allowed';
  end if;
  -- The parent must be the caller's row (RLS hides others; the composite FK would refuse it anyway).
  if (v_create or v_p.experience_id is distinct from v_old.experience_id
                or v_p.education_id is distinct from v_old.education_id)
     and not (exists (select 1 from public.experiences e where e.id = v_p.experience_id and e.user_id = v_uid)
              or exists (select 1 from public.educations e where e.id = v_p.education_id and e.user_id = v_uid)) then
    raise exception using errcode = 'P0001', message = 'not_found',
      detail = case when v_p.experience_id is not null then 'experience_id' else 'education_id' end;
  end if;
  if v_p.is_current and v_p.end_month is not null then
    raise exception using errcode = 'P0001', message = 'invalid_period', detail = 'end_month';
  end if;
  if v_p.end_month < v_p.start_month then
    raise exception using errcode = 'P0001', message = 'invalid_period', detail = 'end_month';
  end if;

  -- ── write (status / content_updated_at / career_data_updated_at come from triggers) ──
  if v_create then
    begin
      insert into public.projects (id, user_id, experience_id, education_id, name, start_month, end_month, is_current,
                                   project_type, experience_type, competencies,
                                   situation, task, action, result, learnings)
      values (v_p.id, v_uid, v_p.experience_id, v_p.education_id, v_p.name, v_p.start_month, v_p.end_month,
              v_p.is_current, v_p.project_type, v_p.experience_type, v_p.competencies,
              v_p.situation, v_p.task, v_p.action, v_p.result, v_p.learnings);
    exception when unique_violation then
      if p_client_id is not null then
        -- QA-02: a concurrent create with the same client id committed first (the insert waited for it). Nothing
        -- is written yet in this call, so run it again: it now finds the caller's row and takes the replay path.
        if exists (select 1 from public.projects p where p.id = p_client_id and p.user_id = v_uid) then
          return public.save_project_page(p_project_id, p_values, p_expected_updated_at, p_applied_proposals,
                                          p_client_id);
        end if;
        -- OD-C6: p_client_id is another user's project id (RLS hides it). Don't reveal it.
        raise exception using errcode = 'P0001', message = 'not_found';
      end if;
      raise;
    end;
  elsif (v_p.experience_id, v_p.education_id, v_p.name, v_p.start_month, v_p.end_month, v_p.is_current,
         v_p.project_type, v_p.experience_type, v_p.competencies,
         v_p.situation, v_p.task, v_p.action, v_p.result, v_p.learnings)
        is distinct from
        (v_old.experience_id, v_old.education_id, v_old.name, v_old.start_month, v_old.end_month, v_old.is_current,
         v_old.project_type, v_old.experience_type, v_old.competencies,
         v_old.situation, v_old.task, v_old.action, v_old.result, v_old.learnings) then
    -- An unchanged save writes nothing, so updated_at (the expected version) does not move.
    update public.projects p
       set experience_id = v_p.experience_id, education_id = v_p.education_id, name = v_p.name,
           start_month = v_p.start_month, end_month = v_p.end_month, is_current = v_p.is_current,
           project_type = v_p.project_type, experience_type = v_p.experience_type, competencies = v_p.competencies,
           situation = v_p.situation, task = v_p.task, action = v_p.action, result = v_p.result,
           learnings = v_p.learnings
     where p.id = v_p.id and p.user_id = v_uid;
  end if;

  -- ── "반영됨" records: chat id order (lock order), results reported in the request's order ──
  for v_el, v_ord in
    select e, o from jsonb_array_elements(v_props) with ordinality as t (e, o)
     order by case when jsonb_typeof(e -> 'writing_chat_id') = 'string' then lower(e ->> 'writing_chat_id') end
              nulls last, o
  loop
    v_reason := null;
    if jsonb_typeof(v_el) <> 'object'
       or jsonb_typeof(v_el -> 'writing_chat_id') is distinct from 'string'
       or (v_el ->> 'writing_chat_id') !~* c_uuid_re
       or jsonb_typeof(v_el -> 'field') is distinct from 'string'
       or jsonb_typeof(v_el -> 'rev') is distinct from 'number'
       or (v_el ->> 'rev') !~ '^[0-9]{1,9}$' then
      v_reason := 'invalid_entry';
    else
      begin
        v_reason := private.wc_mark_proposal_applied((v_el ->> 'writing_chat_id')::uuid, 'project', v_p.id,
                                                     v_el ->> 'field', (v_el ->> 'rev')::integer, null);
      exception when others then
        v_reason := 'mark_failed';
      end;
    end if;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'o', v_ord, 'reason', v_reason,
      'writing_chat_id', case when jsonb_typeof(v_el) = 'object' then v_el -> 'writing_chat_id' end,
      'field', case when jsonb_typeof(v_el) = 'object' then v_el -> 'field' end));
  end loop;

  -- The last recorded element (request order) is the project's source chat; updated_at stays.
  select (r ->> 'writing_chat_id')::uuid into v_last_chat
    from jsonb_array_elements(v_results) r
   where r ->> 'reason' is null
   order by (r ->> 'o')::bigint desc
   limit 1;
  if v_last_chat is not null then
    perform private.projects_set_source_writing_chat(v_p.id, v_last_chat);
  end if;

  select p.status, p.updated_at into v_status, v_updated_at from public.projects p where p.id = v_p.id;

  return jsonb_build_object(
    'project_id', v_p.id,
    'status', v_status,
    'updated_at', v_updated_at,
    'applied', coalesce((select jsonb_agg(jsonb_build_object('writing_chat_id', r -> 'writing_chat_id',
                                                             'field', r -> 'field') order by (r ->> 'o')::bigint)
                           from jsonb_array_elements(v_results) r where r ->> 'reason' is null), '[]'::jsonb),
    'skipped', coalesce((select jsonb_agg(jsonb_build_object('writing_chat_id', r -> 'writing_chat_id',
                                                             'field', r -> 'field', 'reason', r -> 'reason')
                                          order by (r ->> 'o')::bigint)
                           from jsonb_array_elements(v_results) r where r ->> 'reason' is not null), '[]'::jsonb));
end;
$function$;

revoke all on function public.save_project_page(uuid, jsonb, timestamptz, jsonb, uuid) from public, anon;
grant execute on function public.save_project_page(uuid, jsonb, timestamptz, jsonb, uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.save_project_deliverable(p_project_deliverable_id uuid, p_project_id uuid, p_title text, p_body text, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_applied_proposals jsonb DEFAULT NULL::jsonb, p_client_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  c_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_uid uuid := auth.uid();
  v_props jsonb := coalesce(nullif(p_applied_proposals, 'null'::jsonb), '[]'::jsonb);
  v_title text := btrim(p_title);
  v_body text := coalesce(p_body, '');
  v_d public.project_deliverables%rowtype;
  v_el jsonb;
  v_ord bigint;
  v_reason text;
  v_results jsonb := '[]'::jsonb;
  v_target uuid := p_project_deliverable_id;
  v_replay boolean := false;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  if nullif(v_title, '') is null then
    raise exception using errcode = 'P0001', message = 'deliverable_title_required';
  end if;
  if char_length(v_title) > 100 then
    raise exception using errcode = 'P0001', message = 'field_too_long', detail = 'title';
  end if;
  if char_length(v_body) > 20000 then
    raise exception using errcode = 'P0001', message = 'field_too_long', detail = 'body';
  end if;
  if jsonb_typeof(v_props) <> 'array' or jsonb_array_length(v_props) > 50 then
    raise exception using errcode = 'P0001', message = 'invalid_fields', detail = 'p_applied_proposals';
  end if;

  -- OD-C6: replay of a create that went through -> save that row with the update rules (expected version ignored).
  if v_target is null and p_client_id is not null then
    perform 1 from public.project_deliverables d where d.id = p_client_id and d.user_id = v_uid;
    if found then
      v_target := p_client_id;
      v_replay := true;
    end if;
  end if;

  if v_target is null then
    -- Create: the parent must be the caller's project; standalone-only and the 50 limit are the insert trigger's
    -- (deliverable_requires_standalone_project / deliverable_limit_reached), sort_order = last + 1.
    if p_project_id is null
       or not exists (select 1 from public.projects p where p.id = p_project_id and p.user_id = v_uid) then
      raise exception using errcode = 'P0001', message = 'not_found', detail = 'project_id';
    end if;
    begin
      insert into public.project_deliverables (id, user_id, project_id, title, body)
      values (coalesce(p_client_id, gen_random_uuid()), v_uid, p_project_id, v_title, v_body)
      returning * into v_d;
    exception when unique_violation then
      if p_client_id is not null then
        -- QA-02: a concurrent create with the same client id committed first; run again to take the replay path.
        if exists (select 1 from public.project_deliverables d where d.id = p_client_id and d.user_id = v_uid) then
          return public.save_project_deliverable(p_project_deliverable_id, p_project_id, p_title, p_body,
                                                 p_expected_updated_at, p_applied_proposals, p_client_id);
        end if;
        -- OD-C6: p_client_id is another user's deliverable id (RLS hides it). Don't reveal it.
        raise exception using errcode = 'P0001', message = 'not_found';
      end if;
      raise;
    end;
  else
    select * into v_d from public.project_deliverables d
     where d.id = v_target and d.user_id = v_uid
       for update;
    if not found or (p_project_id is not null and p_project_id <> v_d.project_id) then
      raise exception using errcode = 'P0001', message = 'not_found';
    end if;
    if not v_replay and p_expected_updated_at is not null and v_d.updated_at <> p_expected_updated_at then
      raise exception using errcode = 'P0001', message = 'stale_write',
        detail = to_char(v_d.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
    end if;
    if (v_title, v_body) is distinct from (v_d.title, v_d.body) then
      update public.project_deliverables d
         set title = v_title, body = v_body
       where d.id = v_d.id and d.user_id = v_uid
      returning * into v_d;
    end if;
  end if;

  for v_el, v_ord in
    select e, o from jsonb_array_elements(v_props) with ordinality as t (e, o)
     order by case when jsonb_typeof(e -> 'writing_chat_id') = 'string' then lower(e ->> 'writing_chat_id') end
              nulls last, o
  loop
    v_reason := null;
    if jsonb_typeof(v_el) <> 'object'
       or jsonb_typeof(v_el -> 'writing_chat_id') is distinct from 'string'
       or (v_el ->> 'writing_chat_id') !~* c_uuid_re
       or jsonb_typeof(v_el -> 'rev') is distinct from 'number'
       or (v_el ->> 'rev') !~ '^[0-9]{1,9}$'
       or jsonb_typeof(v_el -> 'mode') is distinct from 'string' then
      v_reason := 'invalid_entry';
    else
      begin
        v_reason := private.wc_mark_proposal_applied((v_el ->> 'writing_chat_id')::uuid, 'project_deliverable', v_d.id,
                                                     null, (v_el ->> 'rev')::integer, v_el ->> 'mode');
      exception when others then
        v_reason := 'mark_failed';
      end;
    end if;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'o', v_ord, 'reason', v_reason,
      'writing_chat_id', case when jsonb_typeof(v_el) = 'object' then v_el -> 'writing_chat_id' end));
  end loop;

  return jsonb_build_object(
    'project_deliverable_id', v_d.id,
    'project_id', v_d.project_id,
    'sort_order', v_d.sort_order,
    'updated_at', v_d.updated_at,
    'applied', coalesce((select jsonb_agg(jsonb_build_object('writing_chat_id', r -> 'writing_chat_id')
                                          order by (r ->> 'o')::bigint)
                           from jsonb_array_elements(v_results) r where r ->> 'reason' is null), '[]'::jsonb),
    'skipped', coalesce((select jsonb_agg(jsonb_build_object('writing_chat_id', r -> 'writing_chat_id',
                                                             'reason', r -> 'reason') order by (r ->> 'o')::bigint)
                           from jsonb_array_elements(v_results) r where r ->> 'reason' is not null), '[]'::jsonb));
end;
$function$;

revoke all on function public.save_project_deliverable(uuid, uuid, text, text, timestamptz, jsonb, uuid) from public, anon;
grant execute on function public.save_project_deliverable(uuid, uuid, text, text, timestamptz, jsonb, uuid) to authenticated;
