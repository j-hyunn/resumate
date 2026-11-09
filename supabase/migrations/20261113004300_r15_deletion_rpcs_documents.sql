-- R15 / D9 (DM 11.8 #6, §4.2, §4.3 — CL-3·CL-A6 · v4.15 CF-1·CF-A2·CF-A14)
-- Starting from the R14 definitions (interview branches already gone — DM 11.9 머리 ②); they are NOT revived.
--   * get_deletion_impact('application_project') -> cascade {insights, documents, document_chats, stage_events}
--     documents = 0 or 1 (is the cover letter written: filled_slot_count > 0).
--   * career kinds -> affected_results.by_application_project[] = {application_project_id, name, insights,
--     documents, document_sections}. The basis is evidence_links alone (draft_section_sources is gone, and a
--     section header on a deleted career row is not counted — DM §4.2 `[가정]`). The key name document_sections is
--     kept on purpose (v4.15) although the slots are questions.
--   * delete_career_item(delete_results) resets only the question's body / blocks / evidence; the question text,
--     char_limit, count_basis and note stay. The career description branch is gone (CF-1), and the document chats
--     are NOT deleted (DM §4.2 — the proposals stay in the chat).
--   * cascade.writing_chats and the career delete path get an explicit `project_id is not null`, so a career
--     deletion never meets a document chat (DM §2.5).
--   * entity_type = 'application_document' is NOT created (v4.15 정렬, UX DM-6 `[가정]`): no screen asks for
--     "empty the document". The RLS delete policy stays.
--   * get_account_deletion_summary: the "서류 수" is now filled_slot_count > 0 documents. The RETURN KEY stays
--     'drafts' (DM §4.3 "반환 키 변경 없음").

-- Which document slots cite a row that is about to go.
create or replace function private.career_deletion_document_slots(
  p_uid uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_affiliation_mode text
)
returns table (application_document_id uuid, application_project_id uuid, slot text)
language sql
stable
set search_path = ''
as $$
  select distinct d.id, d.application_project_id, split_part(el.item_key, '.', 1)
    from private.career_deletion_sources(p_uid, p_entity_type, p_entity_id, p_affiliation_mode) s
    join public.evidence_links el
      on el.user_id = p_uid and el.owner_type = 'application_document'
     and el.source_type = s.source_type and el.source_id = s.source_id
    join public.application_documents d on d.id = el.owner_id and d.user_id = p_uid;
$$;

revoke all on function private.career_deletion_document_slots(uuid, text, uuid, text) from public, anon;
grant execute on function private.career_deletion_document_slots(uuid, text, uuid, text) to authenticated;

-- delete_career_item(delete_results): reset the given slots (DM §4.2 "자소서 문항"). Definer: the user may not
-- write evidence_links directly. Lock order: application project -> document (by id).
-- p_pairs element: {application_document_id, slot}
create or replace function private.reset_application_document_slots(p_pairs jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_doc_id uuid;
  v_slots text[];
  v_doc public.application_documents%rowtype;
  v_questions jsonb;
  v_count integer := 0;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_pairs is null or jsonb_typeof(p_pairs) <> 'array' or jsonb_array_length(p_pairs) = 0 then
    return 0;
  end if;

  perform 1 from public.application_projects ap
   where ap.user_id = v_uid
     and ap.id in (select d.application_project_id from public.application_documents d
                    where d.user_id = v_uid
                      and d.id in (select (e ->> 'application_document_id')::uuid
                                     from jsonb_array_elements(p_pairs) e))
   order by ap.id for update;

  for v_doc_id, v_slots in
    select (e ->> 'application_document_id')::uuid, array_agg(distinct e ->> 'slot')
      from jsonb_array_elements(p_pairs) e
     group by 1
     order by 1
  loop
    select * into v_doc from public.application_documents d
     where d.id = v_doc_id and d.user_id = v_uid
       for update;
    if not found then
      continue;
    end if;

    select coalesce(jsonb_agg(case when (q ->> 'slot') = any (v_slots)
                                   then q || jsonb_build_object('body', '', 'blocks', '[]'::jsonb)
                                   else q end order by o), '[]'::jsonb)
      into v_questions
      from jsonb_array_elements(coalesce(v_doc.body -> 'questions', '[]'::jsonb)) with ordinality as t (q, o);

    delete from public.evidence_links el
     where el.user_id = v_uid and el.owner_type = 'application_document' and el.owner_id = v_doc_id
       and split_part(el.item_key, '.', 1) = any (v_slots);

    update public.application_documents d
       set body = jsonb_build_object('questions', v_questions),
           filled_slot_count = (select count(*)::integer from jsonb_array_elements(v_questions) q
                                 where nullif(btrim(coalesce(q ->> 'body', '')), '') is not null)
     where d.id = v_doc_id and d.user_id = v_uid;

    v_count := v_count + cardinality(v_slots);
  end loop;
  return v_count;
end;
$$;

revoke all on function private.reset_application_document_slots(jsonb) from public, anon;
grant execute on function private.reset_application_document_slots(jsonb) to authenticated;

-- The in-flight document turns that would write into the reset questions get a cancel request (the runner
-- observes it). Replaces private.cancel_draft_jobs for the new structure `[가정]`.
create or replace function private.cancel_document_jobs(p_application_project_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  update public.ai_jobs j
     set cancel_requested_at = now()
   where j.user_id = v_uid
     and j.status in ('queued', 'running')
     and j.cancel_requested_at is null
     and j.job_type = 'cover_letter'
     and j.application_project_id = any (coalesce(p_application_project_ids, '{}'));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function private.cancel_document_jobs(uuid[]) from public, anon;
grant execute on function private.cancel_document_jobs(uuid[]) to authenticated;

create or replace function public.get_deletion_impact(p_entity_type text, p_entity_id uuid,
  p_affiliation_mode text default 'delete_projects')
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
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
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  -- OD-I6: application project deletion impact (C-05 on S-13).
  if p_entity_type = 'application_project' then
    if not exists (select 1 from public.application_projects ap where ap.id = p_entity_id and ap.user_id = v_uid) then
      raise exception using errcode = 'P0001', message = 'not_found';
    end if;
    return jsonb_build_object(
      'cascade', jsonb_build_object(
        'insights', (select count(*)::int from public.insights i
                      where i.application_project_id = p_entity_id and i.user_id = v_uid),
        -- (v4.15, CF-A2·CF-A14) 0 or 1: is the cover letter written.
        'documents', (select count(*)::int from public.application_documents d
                       where d.application_project_id = p_entity_id and d.user_id = v_uid
                         and d.filled_slot_count > 0),
        'document_chats', (select count(*)::int from public.writing_chats w
                            where w.application_project_id = p_entity_id and w.user_id = v_uid),
        'stage_events', (select count(*)::int from public.application_stage_events e
                          where e.application_project_id = p_entity_id and e.user_id = v_uid)));
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
    -- No result impact; applied STAR stays in the project. A document chat answers the same shape, and the screen
    -- only changes the wording ("저장한 서류 본문은 남아요", DM §4.2).
    return (select jsonb_build_object(
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

  -- R15 (DM §2.5): a career deletion never meets a document chat.
  select count(*) into v_writing_chats
    from public.writing_chats w
   where w.user_id = v_uid and w.project_id is not null
     and (w.project_id = any (v_project_ids)
          or (p_entity_type = 'project_deliverable' and w.project_deliverable_id = p_entity_id));

  v_insight_ids := private.career_deletion_insight_ids(v_uid, p_entity_type, p_entity_id, v_mode);

  with doc as (
    select * from private.career_deletion_document_slots(v_uid, p_entity_type, p_entity_id, v_mode)
  ), per_project as (
    select doc.application_project_id as id,
           count(distinct doc.application_document_id)::int as documents,
           count(*)::int as document_sections
      from doc group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'application_project_id', ap.id, 'name', ap.name,
           'insights', coalesce(ins.n, 0),
           'documents', coalesce(pp.documents, 0),
           'document_sections', coalesce(pp.document_sections, 0))
           order by ap.name nulls last, ap.id), '[]'::jsonb)
    into v_by_project
    from public.application_projects ap
    left join (select i.application_project_id as id, count(*)::int as n
                 from public.insights i where i.id = any (v_insight_ids) group by 1) ins on ins.id = ap.id
    left join per_project pp on pp.id = ap.id
   where ap.user_id = v_uid
     and (ins.n is not null or pp.id is not null);

  return jsonb_build_object(
    'cascade', jsonb_build_object(
      'projects', v_projects,
      'project_deliverables', v_deliverables,
      'project_skills', v_project_skills,
      'writing_chats', v_writing_chats),
    'affected_results', jsonb_build_object('by_application_project', v_by_project));
end;
$$;

create or replace function public.delete_career_item(p_entity_type text, p_entity_id uuid,
  p_affiliation_mode text default 'delete_projects', p_result_mode text default 'keep_results')
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_mode text := coalesce(p_affiliation_mode, 'delete_projects');
  v_result_mode text := coalesce(p_result_mode, 'keep_results');
  v_impact jsonb;
  v_insight_ids uuid[] := '{}';
  v_doc_pairs jsonb := '[]'::jsonb;
  v_doc_projects uuid[] := '{}';
begin
  if v_result_mode not in ('keep_results', 'delete_results') then
    raise exception using errcode = 'P0001', message = 'invalid_result_mode';
  end if;

  -- get_deletion_impact also answers 'application_project' (OD-I6); that is not a career item.
  if p_entity_type = 'application_project' then
    raise exception using errcode = 'P0001', message = 'invalid_entity_type';
  end if;

  -- Validates auth, entity_type, affiliation_mode, ownership; counts what will go.
  v_impact := public.get_deletion_impact(p_entity_type, p_entity_id, v_mode);

  -- Collect before the rows go (the cascade set is computed from live rows, and the source deletion triggers
  -- mark source rows deleted).
  if v_result_mode = 'delete_results' then
    v_insight_ids := private.career_deletion_insight_ids(v_uid, p_entity_type, p_entity_id, v_mode);
    select coalesce(jsonb_agg(jsonb_build_object('application_document_id', s.application_document_id,
                                                 'slot', s.slot)), '[]'::jsonb),
           coalesce(array_agg(distinct s.application_project_id), '{}')
      into v_doc_pairs, v_doc_projects
      from private.career_deletion_document_slots(v_uid, p_entity_type, p_entity_id, v_mode) s;
  end if;

  case p_entity_type
    when 'experience' then
      -- v4.4 (CR-15): affiliated projects (and their chats) go with it (projects FK on delete cascade).
      delete from public.experiences where id = p_entity_id and user_id = v_uid;
    when 'education' then
      delete from public.educations where id = p_entity_id and user_id = v_uid;
    when 'project' then
      delete from public.projects where id = p_entity_id and user_id = v_uid;
    when 'project_deliverable' then
      -- Not a completion condition: the parent project's status is unaffected.
      delete from public.project_deliverables where id = p_entity_id and user_id = v_uid;
    when 'skill' then
      delete from public.skills where id = p_entity_id and user_id = v_uid;
    when 'writing_chat' then
      -- Messages cascade; career rows keep existing with source_writing_chat_id = null (DM §3.4).
      -- R15: a document chat is deleted through this path too (the document of record stays — DM §4.4).
      delete from public.writing_chats where id = p_entity_id and user_id = v_uid;
  end case;

  if not found then
    raise exception using errcode = 'P0001', message = 'career_item_not_found';
  end if;

  -- DM §4.2 result unit = one insight version. writing_chat has no result impact (ids stay empty).
  perform private.delete_insights_by_ids(v_insight_ids);
  -- R15 (DM §4.2): the cover letter question's result unit = its body, blocks and evidence. The question text,
  -- char_limit, count_basis and note stay, and the document chats are not touched.
  if jsonb_array_length(v_doc_pairs) > 0 then
    perform private.reset_application_document_slots(v_doc_pairs);
    perform private.cancel_document_jobs(v_doc_projects);
  end if;

  return jsonb_build_object(
    'entity_type', p_entity_type,
    'entity_id', p_entity_id,
    'affiliation_mode', v_mode,
    'result_mode', v_result_mode) || v_impact;
end;
$$;

create or replace function public.get_account_deletion_summary()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_keys integer;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  -- authenticated has no SELECT on ai_provider_keys.user_id (metadata column grants only, DM 2.11.1): count through
  -- the security-invoker metadata view, whose RLS already limits rows to the caller.
  select count(k.id)::integer into v_keys from public.ai_provider_keys_public k;

  return jsonb_build_object(
    'career', jsonb_build_object(
      'experiences', (select count(*) from public.experiences t where t.user_id = v_uid),
      'educations', (select count(*) from public.educations t where t.user_id = v_uid),
      'projects', (select count(*) from public.projects t where t.user_id = v_uid),
      'project_deliverables', (select count(*) from public.project_deliverables t where t.user_id = v_uid),
      'skills', (select count(*) from public.skills t where t.user_id = v_uid),
      -- DM §4.3: one number for every AI writing chat — STAR + deliverable + document chats (user_id is enough).
      'writing_chats', (select count(*) from public.writing_chats t where t.user_id = v_uid)),
    'applications', jsonb_build_object(
      'application_projects', (select count(*) from public.application_projects t where t.user_id = v_uid),
      'insights', (select count(*) from public.insights t where t.user_id = v_uid),
      -- R15 (CL-A6 · v4.15 CF-A14): "서류 수" = documents whose cover letter is written. The RETURN KEY stays
      -- 'drafts' (DM §4.3 "반환 키 변경 없음").
      'drafts', (select count(*) from public.application_documents t
                  where t.user_id = v_uid and t.filled_slot_count > 0),
      'application_stage_events',
        (select count(*) from public.application_stage_events t where t.user_id = v_uid)),
    'ai_connection', jsonb_build_object(
      'provider_keys', v_keys,
      'ai_data_use_consents', (select count(*) from public.ai_data_use_consents t where t.user_id = v_uid),
      'usage_records', (select count(*) from public.ai_usage_records t where t.user_id = v_uid),
      'has_provider_keys', v_keys > 0));
end;
$$;

-- private.delete_account_data: + application_documents (R15). The drafts / draft_sections /
-- draft_section_sources lines stay until the destructive migration drops those tables.
CREATE OR REPLACE FUNCTION private.delete_account_data(p_uid uuid, p_subject_hash text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_in_flight integer;
  v_keys integer;
  v_logged integer;
  v_now timestamptz := now();
  v_done timestamptz;
begin
  if p_uid is null then
    raise exception using errcode = 'P0001', message = 'invalid_user_id';
  end if;
  if p_subject_hash is null or p_subject_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'invalid_subject_hash';
  end if;
  if p_reason is null or p_reason not in ('user_request', 'inactivity') then
    raise exception using errcode = 'P0001', message = 'invalid_reason';
  end if;

  -- One deletion at a time per user (double submit / retry while the first call still runs, or the cron and the
  -- user at the same time).
  perform pg_advisory_xact_lock(hashtextextended('resumate.delete_account:' || p_uid::text, 0));

  select count(*)::integer into v_in_flight
    from public.ai_jobs j
   where j.user_id = p_uid and j.status in ('queued', 'running');

  -- 1. Usage records first: avoids the set-null updates the application project cascade would make.
  delete from public.ai_usage_records t where t.user_id = p_uid;

  -- 2. Application projects (lock order: projects by id first, like delete_career_item), cascading to
  --    job_descriptions, jd_requirements, insights, drafts, draft_sections, draft_section_sources,
  --    application_stage_events, evidence_links and project-scoped ai_jobs.
  perform 1 from public.application_projects ap where ap.user_id = p_uid order by ap.id for update;
  delete from public.application_projects t where t.user_id = p_uid;

  -- Sweep anything of the application area that did not hang off a project (all should be gone already).
  delete from public.evidence_links t where t.user_id = p_uid;
  -- R15 (DM §2.7.3): the cover letter of record. The application project cascade already takes it; the
  -- explicit delete keeps delete_account's "every user table by name" rule (DM §4.5).
  delete from public.application_documents t where t.user_id = p_uid;
  delete from public.draft_section_sources t where t.user_id = p_uid;
  delete from public.draft_sections t where t.user_id = p_uid;
  delete from public.drafts t where t.user_id = p_uid;
  delete from public.insights t where t.user_id = p_uid;
  delete from public.jd_requirements t where t.user_id = p_uid;
  delete from public.job_descriptions t where t.user_id = p_uid;
  delete from public.application_stage_events t where t.user_id = p_uid;

  -- 3. AI writing chats: chats locked first, then messages (S4 locks chat -> messages, QA-S9-02).
  perform 1 from public.writing_chats w where w.user_id = p_uid order by w.id for update;
  delete from public.writing_chats t where t.user_id = p_uid;
  delete from public.writing_chat_messages t where t.user_id = p_uid;

  -- 4. Career data, leaves first.
  delete from public.project_deliverables t where t.user_id = p_uid;
  delete from public.project_skills t where t.user_id = p_uid;
  delete from public.projects t where t.user_id = p_uid;
  delete from public.skills t where t.user_id = p_uid;
  delete from public.educations t where t.user_id = p_uid;
  delete from public.experiences t where t.user_id = p_uid;

  -- 5. Jobs not tied to an application project (writing chat turns, key verification, ...).
  delete from public.ai_jobs t where t.user_id = p_uid;

  -- 6. Provider keys: immediate hard delete (NFR-KEY-06). FK sets profiles.active_ai_provider null.
  delete from public.ai_provider_keys t where t.user_id = p_uid;
  get diagnostics v_keys = row_count;

  -- 7. Consent history: deleted; the de-identified log below is the only proof kept (D-DM-02 (b)).
  delete from public.ai_data_use_consents t where t.user_id = p_uid;
  delete from public.consents t where t.user_id = p_uid;

  -- 7a. R13: 내 정보 관심 직군·직무 쌍 (profile_job_interests). The auth.users cascade would also take it, but
  --     delete_account must leave no user row behind on its own (DM §4.3, account_deletion.test.sql).
  delete from public.profile_job_interests t where t.user_id = p_uid;

  -- 8. Profile.
  delete from public.profiles t where t.id = p_uid;

  -- 9. De-identified log (A.17). A repeated call with the same hash keeps the first row.
  v_done := clock_timestamp();
  insert into public.account_deletion_logs (subject_hash, requested_at, db_deleted_at, storage_deleted_at, reason)
  values (p_subject_hash, v_now, greatest(v_done, v_now), null, p_reason)
  on conflict (subject_hash) do nothing;
  get diagnostics v_logged = row_count;

  return jsonb_build_object(
    'deleted', true,
    'log_written', v_logged > 0,
    'in_flight_jobs', v_in_flight,
    'deleted_provider_keys', v_keys,
    'db_deleted_at', greatest(v_done, v_now));
end;
$function$;
