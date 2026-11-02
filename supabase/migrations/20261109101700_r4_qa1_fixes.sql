-- R4 QA round 1 fixes (_workspace/backend/R4/03_backend-qa_report.md).
--   QA-R4-01: the deliverable / project_skill insert guards run as security invoker. Under the user session another
--             user's project is invisible (RLS), so the guard finds nothing and RLS / the composite FK reject the row
--             (42501 / 23503) instead of a business error that reveals the other project's kind or deliverable count.
--             The parent lock (for no key update) now also needs the caller's own UPDATE right on projects, which the
--             user session has; postgres / service_role bypass RLS and keep the full check.
--   QA-R4-02: apply_writing_chat_proposal rtrims the current STAR value before appending / measuring.
--   QA-R4-03: get_deletion_impact('writing_chat') returns writing_chats.message_count (greeting excluded, A5).
-- Signatures and grants are unchanged.

CREATE OR REPLACE FUNCTION private.project_deliverables_before_insert()
 RETURNS trigger
 LANGUAGE plpgsql
  SET search_path TO ''
AS $function$
declare
  v_exp uuid;
  v_edu uuid;
begin
  select p.experience_id, p.education_id into v_exp, v_edu
    from public.projects p
   where p.id = new.project_id and p.user_id = new.user_id
     for no key update;
  if found and num_nonnulls(v_exp, v_edu) > 0 then
    raise exception using errcode = 'P0001', message = 'deliverable_requires_standalone_project';
  end if;

  if tg_op = 'INSERT' then
    if (select count(*) from public.project_deliverables d where d.project_id = new.project_id) >= 50 then
      raise exception using errcode = 'P0001', message = 'deliverable_limit_reached';
    end if;
    if new.sort_order is null then
      select coalesce(max(d.sort_order), 0) + 1 into new.sort_order
        from public.project_deliverables d where d.project_id = new.project_id;
    end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.project_skills_require_standalone()
 RETURNS trigger
 LANGUAGE plpgsql
  SET search_path TO ''
AS $function$
begin
  if exists (select 1 from public.projects p
              where p.id = new.project_id and p.user_id = new.user_id
                and num_nonnulls(p.experience_id, p.education_id) > 0) then
    raise exception using errcode = 'P0001', message = 'project_skill_requires_standalone_project';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.apply_writing_chat_proposal(p_writing_chat_id uuid, p_fields text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
      -- QA-R4-02: trailing whitespace / blank lines of the current value are dropped before joining, so the
      -- result is "value + one newline + proposal" and the length matches the pipeline's trimmed estimate.
      v_cur := rtrim(to_jsonb(v_p) ->> v_field, E' \t\r\n');
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
$function$;

CREATE OR REPLACE FUNCTION public.get_deletion_impact(p_entity_type text, p_entity_id uuid, p_affiliation_mode text DEFAULT 'delete_projects'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_mode text := coalesce(p_affiliation_mode, 'delete_projects');
  v_project_ids uuid[] := '{}';
  v_projects int := 0;
  v_deliverables int := 0;
  v_project_skills int := 0;
  v_writing_chats int := 0;
  v_found boolean;
  v_by_project jsonb;
  v_insight_ids uuid[];
  v_draft_ids uuid[];
  v_section_ids uuid[];
  v_session_ids uuid[];
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  if p_entity_type is null
     or p_entity_type not in ('experience', 'education', 'project', 'project_deliverable', 'skill',
                              'writing_chat') then
    raise exception using errcode = 'P0001', message = 'invalid_entity_type';
  end if;

  if v_mode = 'keep_projects' then
    -- CR-15: a project left without its experience / education would break the DM-20 shape.
    raise exception using errcode = 'P0001', message = 'affiliation_mode_not_supported';
  elsif v_mode <> 'delete_projects' then
    raise exception using errcode = 'P0001', message = 'invalid_affiliation_mode';
  end if;

  v_found := case p_entity_type
    when 'experience' then exists (select 1 from public.experiences where id = p_entity_id and user_id = v_uid)
    when 'education' then exists (select 1 from public.educations where id = p_entity_id and user_id = v_uid)
    when 'project' then exists (select 1 from public.projects where id = p_entity_id and user_id = v_uid)
    when 'project_deliverable' then exists (select 1 from public.project_deliverables
                                             where id = p_entity_id and user_id = v_uid)
    when 'skill' then exists (select 1 from public.skills where id = p_entity_id and user_id = v_uid)
    when 'writing_chat' then exists (select 1 from public.writing_chats where id = p_entity_id and user_id = v_uid)
  end;
  if not v_found then
    raise exception using errcode = 'P0001', message = 'career_item_not_found';
  end if;

  if p_entity_type = 'writing_chat' then
    -- No result impact; applied STAR stays in the project ("반영된 STAR는 남아요" when last_applied_at is set).
    return (select jsonb_build_object(
              -- QA-R4-03: the column (user + AI messages, greeting excluded, A5) — same number as the panel.
              'message_count', w.message_count,
              'last_applied_at', w.last_applied_at)
              from public.writing_chats w where w.id = p_entity_id and w.user_id = v_uid);
  end if;

  if p_entity_type = 'experience' then
    select coalesce(array_agg(id), '{}') into v_project_ids
      from public.projects where experience_id = p_entity_id and user_id = v_uid;
    v_projects := cardinality(v_project_ids);
  elsif p_entity_type = 'education' then
    select coalesce(array_agg(id), '{}') into v_project_ids
      from public.projects where education_id = p_entity_id and user_id = v_uid;
    v_projects := cardinality(v_project_ids);
  elsif p_entity_type = 'project' then
    v_project_ids := array[p_entity_id];
  end if;

  select count(*) into v_deliverables
    from public.project_deliverables d
   where d.user_id = v_uid and d.project_id = any (v_project_ids);

  select count(*) into v_project_skills
    from public.project_skills ps
   where ps.user_id = v_uid
     and (ps.project_id = any (v_project_ids)
          or (p_entity_type = 'skill' and ps.skill_id = p_entity_id));

  select count(*) into v_writing_chats
    from public.writing_chats w
   where w.user_id = v_uid and w.project_id = any (v_project_ids);

  v_insight_ids := private.career_deletion_insight_ids(v_uid, p_entity_type, p_entity_id, v_mode);
  v_draft_ids := private.career_deletion_draft_ids(v_uid, p_entity_type, p_entity_id, v_mode);
  v_section_ids := private.career_deletion_section_ids(v_uid, p_entity_type, p_entity_id, v_mode);
  v_session_ids := private.career_deletion_interview_session_ids(v_uid, p_entity_type, p_entity_id, v_mode);

  select coalesce(jsonb_agg(jsonb_build_object(
           'application_project_id', ap.id, 'name', ap.name,
           'insights', coalesce(ins.n, 0), 'drafts', coalesce(dr.n, 0), 'draft_sections', coalesce(sec.n, 0),
           'interview_sessions', coalesce(iv.n, 0)) order by ap.name nulls last, ap.id), '[]'::jsonb)
    into v_by_project
    from public.application_projects ap
    left join (select i.application_project_id as id, count(*)::int as n
                 from public.insights i where i.id = any (v_insight_ids) group by 1) ins on ins.id = ap.id
    left join (select d.application_project_id as id, count(*)::int as n
                 from public.drafts d where d.id = any (v_draft_ids) group by 1) dr on dr.id = ap.id
    left join (select d.application_project_id as id, count(*)::int as n
                 from public.draft_sections s join public.drafts d on d.id = s.draft_id
                where s.id = any (v_section_ids) group by 1) sec on sec.id = ap.id
    left join (select s.application_project_id as id, count(*)::int as n
                 from public.interview_sessions s where s.id = any (v_session_ids) group by 1) iv on iv.id = ap.id
   where ap.user_id = v_uid
     and (ins.n is not null or dr.n is not null or sec.n is not null or iv.n is not null);

  return jsonb_build_object(
    'cascade', jsonb_build_object(
      'projects', v_projects,
      'project_deliverables', v_deliverables,
      'project_skills', v_project_skills,
      'writing_chats', v_writing_chats),
    'affected_results', jsonb_build_object('by_application_project', v_by_project));
end;
$function$;
