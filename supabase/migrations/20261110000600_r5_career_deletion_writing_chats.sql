-- R5 get_deletion_impact (DM v4.5 §4.1, §4.2; UX DM-7): cascade.writing_chats now also covers deliverable chats.
--   * project_deliverable: the chats of that deliverable (FK cascade).
--   * standalone project: chats whose project_id is the project (= its deliverables' chats) — already counted by
--     the project_id rule, unchanged.
-- delete_career_item returns this impact, so it follows. Result-impact counting is unchanged (chats are not an
-- evidence source). Body otherwise identical to 20261109101700_r4_qa1_fixes.

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
   where w.user_id = v_uid
     and (w.project_id = any (v_project_ids)
          or (p_entity_type = 'project_deliverable' and w.project_deliverable_id = p_entity_id));

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
