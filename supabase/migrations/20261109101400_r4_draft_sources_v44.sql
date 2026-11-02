-- R4 cover letter source selection (DM v4.4 §11.1 S7 row): draft_section_sources.project_detail_ids is gone, so
-- set_section_sources no longer reads / validates / stores it (a project_detail_ids key in p_sources is ignored)
-- and the sources JSON no longer returns it. Bodies are the previous definitions with only these edits.

CREATE OR REPLACE FUNCTION public.set_section_sources(p_section_id uuid, p_sources jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_draft_id uuid;
  v_draft public.drafts%rowtype;
  v_elem jsonb;
  v_ord bigint;
  v_proj uuid;
  v_exp uuid;
  v_edu uuid;
  v_reqs uuid[];
  v_role text;
  v_p_exp uuid;
  v_p_edu uuid;
  v_p_status text;
  v_old public.draft_section_sources%rowtype;
  v_rows jsonb := '[]'::jsonb;
  v_keys text[] := '{}';
  v_key text;
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  v_draft_id := private.cover_letter_section_draft_id(p_section_id, v_uid);
  v_draft := private.lock_cover_letter_draft(v_draft_id, v_uid);
  perform 1 from public.draft_sections s where s.id = p_section_id and s.user_id = v_uid for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'section_not_found';
  end if;

  if private.draft_section_job_active(p_section_id) then
    raise exception using errcode = 'P0001', message = 'section_generating';
  end if;

  if p_sources is null or jsonb_typeof(p_sources) <> 'array' or jsonb_array_length(p_sources) > 5 then
    raise exception using errcode = 'P0001', message = 'invalid_sources';
  end if;

  for v_elem, v_ord in select e, o from jsonb_array_elements(p_sources) with ordinality as t (e, o) loop
    if jsonb_typeof(v_elem) <> 'object'
       or not (coalesce(jsonb_typeof(v_elem -> 'project_id'), 'null') = 'null' or private.is_uuid_text(v_elem -> 'project_id'))
       or not (coalesce(jsonb_typeof(v_elem -> 'experience_id'), 'null') = 'null' or private.is_uuid_text(v_elem -> 'experience_id'))
       or not (coalesce(jsonb_typeof(v_elem -> 'education_id'), 'null') = 'null' or private.is_uuid_text(v_elem -> 'education_id'))
       or not private.is_uuid_array(v_elem -> 'requirement_ids', 50, true)
       or not (coalesce(jsonb_typeof(v_elem -> 'role'), 'null') = 'null'
               or v_elem ->> 'role' in ('primary', 'supporting')) then
      raise exception using errcode = 'P0001', message = 'invalid_sources';
    end if;

    v_proj := (v_elem ->> 'project_id')::uuid;
    v_exp := (v_elem ->> 'experience_id')::uuid;
    v_edu := (v_elem ->> 'education_id')::uuid;
    v_reqs := coalesce((select array_agg(distinct x::uuid)
                          from jsonb_array_elements_text(coalesce(nullif(v_elem -> 'requirement_ids', 'null'::jsonb), '[]'::jsonb)) x),
                       '{}');

    if v_proj is not null then
      select p.experience_id, p.education_id, p.status into v_p_exp, v_p_edu, v_p_status
        from public.projects p where p.id = v_proj and p.user_id = v_uid;
      if not found or v_p_status <> 'complete'
         or (v_exp is not null and v_exp is distinct from v_p_exp)
         or (v_edu is not null and v_edu is distinct from v_p_edu) then
        raise exception using errcode = 'P0001', message = 'source_not_found';
      end if;
      -- Affiliation comes from the project (standalone project: neither).
      v_exp := v_p_exp;
      v_edu := v_p_edu;
    else
      if num_nonnulls(v_exp, v_edu) <> 1 then
        raise exception using errcode = 'P0001', message = 'invalid_sources';
      end if;
    end if;

    if v_exp is not null and not exists (select 1 from public.experiences e
                                          where e.id = v_exp and e.user_id = v_uid and e.status = 'complete') then
      raise exception using errcode = 'P0001', message = 'source_not_found';
    end if;
    if v_edu is not null and not exists (select 1 from public.educations ed
                                          where ed.id = v_edu and ed.user_id = v_uid and ed.status = 'complete') then
      raise exception using errcode = 'P0001', message = 'source_not_found';
    end if;
    if cardinality(v_reqs) > 0
       and (select count(*) from public.jd_requirements r
              join public.job_descriptions jd on jd.id = r.job_description_id
             where r.id = any (v_reqs) and r.user_id = v_uid
               and jd.application_project_id = v_draft.application_project_id)
           <> cardinality(v_reqs) then
      raise exception using errcode = 'P0001', message = 'source_not_found';
    end if;

    v_key := coalesce(v_exp::text, '-') || '|' || coalesce(v_edu::text, '-') || '|' || coalesce(v_proj::text, '-');
    if v_key = any (v_keys) then
      raise exception using errcode = 'P0001', message = 'invalid_sources';
    end if;
    v_keys := v_keys || v_key;

    v_role := coalesce(v_elem ->> 'role', case when v_ord = 1 then 'primary' else 'supporting' end);

    select * into v_old from public.draft_section_sources s
     where s.draft_section_id = p_section_id
       and s.experience_id is not distinct from v_exp
       and s.education_id is not distinct from v_edu
       and s.project_id is not distinct from v_proj
     limit 1;

    v_rows := v_rows || jsonb_build_object(
      'sort_order', v_ord - 1,
      'old_sort_order', case when v_old.id is not null then v_old.sort_order end,
      'experience_id', v_exp, 'education_id', v_edu, 'project_id', v_proj,
      'requirement_ids', to_jsonb(case when v_elem ? 'requirement_ids' or v_old.id is null then v_reqs
                                       else v_old.requirement_ids end),
      'role', v_role,
      'rationale', case when v_old.id is not null then v_old.rationale end,
      'reuse_reason', case when v_old.id is not null then v_old.reuse_reason end);
  end loop;

  -- sources.{n} evidence: retained entries move to their new index, the rest go (two-phase to avoid collisions).
  update public.evidence_links el
     set item_key = 'tmp:sources.' || (r ->> 'sort_order')
    from jsonb_array_elements(v_rows) r
   where el.owner_type = 'draft_section' and el.owner_id = p_section_id and el.user_id = v_uid
     and r ->> 'old_sort_order' is not null
     and el.item_key = 'sources.' || (r ->> 'old_sort_order');
  delete from public.evidence_links el
   where el.owner_type = 'draft_section' and el.owner_id = p_section_id and el.user_id = v_uid
     and el.item_key like 'sources.%';
  update public.evidence_links el
     set item_key = substr(el.item_key, 5)
   where el.owner_type = 'draft_section' and el.owner_id = p_section_id and el.user_id = v_uid
     and el.item_key like 'tmp:sources.%';

  delete from public.draft_section_sources s where s.draft_section_id = p_section_id;

  insert into public.draft_section_sources (user_id, draft_section_id, application_project_id, experience_id,
                                            education_id, project_id, role, origin, rationale,
                                            reuse_reason, requirement_ids, sort_order, source_label)
  select v_uid, p_section_id, v_draft.application_project_id, (r ->> 'experience_id')::uuid,
         (r ->> 'education_id')::uuid, (r ->> 'project_id')::uuid,
         r ->> 'role', 'user', r ->> 'rationale', r ->> 'reuse_reason',
         coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(r -> 'requirement_ids') x), '{}'),
         (r ->> 'sort_order')::integer,
         private.draft_source_label(v_uid, (r ->> 'experience_id')::uuid, (r ->> 'education_id')::uuid,
                                    (r ->> 'project_id')::uuid)
    from jsonb_array_elements(v_rows) r;

  update public.draft_sections s
     set source_selection_mode = 'user', sources_modified_at = v_now
   where s.id = p_section_id;

  return jsonb_build_object('section_id', p_section_id, 'source_selection_mode', 'user',
                            'sources_modified_at', v_now,
                            'sources', private.draft_section_sources_json(p_section_id));
end;
$function$;

CREATE OR REPLACE FUNCTION private.draft_section_sources_json(p_section_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'sort_order', s.sort_order, 'experience_id', s.experience_id,
           'education_id', s.education_id, 'project_id', s.project_id,
           'role', s.role, 'origin', s.origin,
           'rationale', s.rationale, 'requirement_ids', to_jsonb(s.requirement_ids),
           'reuse_reason', s.reuse_reason, 'source_label', s.source_label,
           'source_deleted_at', s.source_deleted_at) order by s.sort_order), '[]'::jsonb)
    from public.draft_section_sources s where s.draft_section_id = p_section_id;
$function$;
