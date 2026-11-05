-- R13 ⑫ evidence source 'profile': new rows refused, allowed career sources 6종 -> 5종
-- (DM v4.12 §2.8 SD-A19, §5; AI 요청 4). The trigger and every result-saving RPC use the SAME list
-- (experience · education · project · project_deliverable · skill) — fixing only one side would mean the
-- trigger refuses what an RPC's validator accepts.
--
-- NOT changed here, on purpose (DM §2.8):
--   * evidence_links_source_type_check keeps 'profile' — dropping it would invalidate existing rows.
--   * existing profile rows are kept as they are; source_deleted_at is not backfilled and nothing is deleted
--     (the source *screen* S-04 is gone, the data was not deleted).
--   * the source_field list for 'profile' is left alone (it names the three dropped columns as plain text).
--
-- The five function bodies below are the live definitions with a single edit each: 'profile' removed from the
-- allowed source_type array (insight_payload_valid, interview_result_payload_valid — shared by 답변 평가 and
-- 세션 종합, save_interview_question, complete_career_description, complete_cover_letter_section).

CREATE OR REPLACE FUNCTION private.evidence_links_check_source()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_exists boolean;
  v_jd_project uuid;
  v_sentences jsonb;
  v_sentence jsonb;
  v_sid text;
  v_start numeric;
  v_end numeric;
  v_affiliated boolean;
begin
  -- R13 (v4.12, SD-A19): profile is never a source of a new evidence row. The CHECK list keeps the value so
  -- that existing rows stay valid; this one line stops new ones, with the same code as the other source errors.
  if new.source_type = 'profile' then
    raise exception using errcode = 'P0001', message = 'invalid_evidence_source',
      detail = 'profile is not an evidence source (v4.12)';
  end if;

  if new.source_type = 'jd_requirement' then
    select jd.application_project_id into v_jd_project
      from public.jd_requirements r
      join public.job_descriptions jd on jd.id = r.job_description_id
     where r.id = new.source_id and r.user_id = new.user_id;
    v_exists := found;
    if v_exists and v_jd_project is distinct from new.application_project_id then
      raise exception using errcode = 'P0001', message = 'invalid_evidence_source',
        detail = 'jd_requirement of another application project';
    end if;

  elsif new.source_type = 'jd_sentence' then
    select jd.application_project_id, jd.sentences into v_jd_project, v_sentences
      from public.job_descriptions jd
     where jd.id = new.source_id and jd.user_id = new.user_id;
    v_exists := found;
    if v_exists then
      if v_jd_project is distinct from new.application_project_id then
        raise exception using errcode = 'P0001', message = 'invalid_evidence_source',
          detail = 'jd_sentence of another application project';
      end if;
      if new.source_locator is null
         or jsonb_typeof(new.source_locator -> 'sid') is distinct from 'string'
         or jsonb_typeof(new.source_locator -> 'start') is distinct from 'number'
         or jsonb_typeof(new.source_locator -> 'end') is distinct from 'number'
         or (new.source_locator ->> 'start') !~ '^[0-9]+$'
         or (new.source_locator ->> 'end') !~ '^[0-9]+$' then
        raise exception using errcode = 'P0001', message = 'invalid_evidence_source',
          detail = 'jd_sentence source_locator must be {sid, start, end}';
      end if;
      v_sid := new.source_locator ->> 'sid';
      v_start := (new.source_locator ->> 'start')::numeric;
      v_end := (new.source_locator ->> 'end')::numeric;
      select e into v_sentence from jsonb_array_elements(v_sentences) e where e ->> 'sid' = v_sid limit 1;
      if v_sentence is null
         or v_start >= v_end
         or v_start < (v_sentence ->> 'start')::numeric
         or v_end > (v_sentence ->> 'end')::numeric then
        raise exception using errcode = 'P0001', message = 'invalid_evidence_source',
          detail = 'jd_sentence locator outside the JD sentences';
      end if;
    end if;

  elsif new.source_type = 'interview_answer' then
    -- S8: source_id = interview_answers.id (ANS-n), same user and same application project.
    select s.application_project_id into v_jd_project
      from public.interview_answers a
      join public.interview_sessions s on s.id = a.session_id
     where a.id = new.source_id and a.user_id = new.user_id;
    v_exists := found;
    if v_exists and v_jd_project is distinct from new.application_project_id then
      raise exception using errcode = 'P0001', message = 'invalid_evidence_source',
        detail = 'interview_answer of another application project';
    end if;

  elsif new.source_type = 'user_note' then
    -- S7: source_id = draft_sections.id (the question whose note is quoted), same application project.
    select d.application_project_id into v_jd_project
      from public.draft_sections s
      join public.drafts d on d.id = s.draft_id
     where s.id = new.source_id and s.user_id = new.user_id;
    v_exists := found;
    if v_exists and v_jd_project is distinct from new.application_project_id then
      raise exception using errcode = 'P0001', message = 'invalid_evidence_source',
        detail = 'user_note of another application project';
    end if;

  elsif new.source_type = 'project' then
    -- R4 (DM v4.4 §2.8, AI V-2 DB defense): the field must fit the project kind. Affiliated projects carry STAR,
    -- standalone ones carry role / description; name / period fit both.
    select num_nonnulls(p.experience_id, p.education_id) = 1 into v_affiliated
      from public.projects p where p.id = new.source_id and p.user_id = new.user_id;
    v_exists := found;
    if v_exists
       and ((v_affiliated and new.source_field in ('role', 'description'))
            or (not v_affiliated and new.source_field in ('situation', 'task', 'action', 'result', 'learnings'))) then
      raise exception using errcode = 'P0001', message = 'invalid_evidence_source',
        detail = 'project field does not fit the project kind';
    end if;

  else
    v_exists := case new.source_type
      -- 'profile' is refused at the top of this function (R13), so it never reaches here.
      when 'experience' then exists (select 1 from public.experiences where id = new.source_id and user_id = new.user_id)
      when 'education' then exists (select 1 from public.educations where id = new.source_id and user_id = new.user_id)
      when 'project_deliverable' then exists (select 1 from public.project_deliverables
                                                where id = new.source_id and user_id = new.user_id)
      when 'skill' then exists (select 1 from public.skills where id = new.source_id and user_id = new.user_id)
      else true
    end;
  end if;

  if not v_exists then
    new.quote := null;
    new.source_deleted_at := coalesce(new.source_deleted_at, now());
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.insight_payload_valid(p_payload jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  v_hashes jsonb;
  v_meta jsonb;
  v_ev jsonb;
  v_key text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or jsonb_typeof(p_payload -> 'result') is distinct from 'object'
     or coalesce(jsonb_typeof(p_payload -> 'match_stage_result'), 'null') not in ('object', 'array')
     or jsonb_typeof(p_payload -> 'hashes') is distinct from 'object'
     or jsonb_typeof(p_payload -> 'meta') is distinct from 'object'
     or jsonb_typeof(p_payload -> 'evidence') is distinct from 'array'
     or jsonb_array_length(p_payload -> 'evidence') > 2000 then
    return false;
  end if;

  -- C-3: result jsonb never stores evidence arrays.
  if jsonb_path_exists(p_payload -> 'result', 'lax $.**.evidence')
     or jsonb_path_exists(p_payload -> 'result', 'lax $.**.positioning_evidence') then
    return false;
  end if;

  v_hashes := p_payload -> 'hashes';
  foreach v_key in array array['requirements_hash', 'career_snapshot_hash', 'input_hash'] loop
    if jsonb_typeof(v_hashes -> v_key) is distinct from 'string'
       or char_length(btrim(v_hashes ->> v_key)) not between 1 and 128 then
      return false;
    end if;
  end loop;

  v_meta := p_payload -> 'meta';
  if jsonb_typeof(v_meta -> 'schema_version') is distinct from 'number'
     or (v_meta ->> 'schema_version') !~ '^[1-9][0-9]{0,8}$'
     or jsonb_typeof(v_meta -> 'prompt_version') is distinct from 'string'
     or char_length(btrim(v_meta ->> 'prompt_version')) not between 1 and 200
     or jsonb_typeof(v_meta -> 'provider') is distinct from 'string'
     or jsonb_typeof(v_meta -> 'model') is distinct from 'string'
     or jsonb_typeof(v_meta -> 'model_tier') is distinct from 'string'
     or jsonb_typeof(v_meta -> 'connection_tier') is distinct from 'string'
     or coalesce(jsonb_typeof(v_meta -> 'validation_report'), 'null') not in ('object', 'null')
     or coalesce(jsonb_typeof(v_meta -> 'usage'), 'null') not in ('object', 'null') then
    return false;
  end if;

  for v_ev in select e from jsonb_array_elements(p_payload -> 'evidence') e loop
    if jsonb_typeof(v_ev) <> 'object'
       or jsonb_typeof(v_ev -> 'item_key') is distinct from 'string'
       or char_length(btrim(v_ev ->> 'item_key')) not between 1 and 200
       or jsonb_typeof(v_ev -> 'sort_order') is distinct from 'number'
       or (v_ev ->> 'sort_order') !~ '^[0-9]{1,9}$'
       -- AI-02 sources: career 5종 + JD (v4.12, SD-A19 — profile is gone). interview_answer /
       -- user_note never appear in an insight.
       or coalesce(v_ev ->> 'source_type', '') not in (
            'experience', 'education', 'project', 'project_deliverable', 'skill',
            'jd_requirement', 'jd_sentence')
       or jsonb_typeof(v_ev -> 'source_id') is distinct from 'string'
       or (v_ev ->> 'source_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       or coalesce(jsonb_typeof(v_ev -> 'source_field'), 'null') not in ('string', 'null')
       or coalesce(jsonb_typeof(v_ev -> 'quote'), 'null') not in ('string', 'null')
       or char_length(v_ev ->> 'quote') > 2000
       or coalesce(jsonb_typeof(v_ev -> 'quote_adjusted'), 'null') not in ('boolean', 'null')
       or coalesce(jsonb_typeof(v_ev -> 'source_locator'), 'null') not in ('object', 'null')
       or coalesce(jsonb_typeof(v_ev -> 'source_snapshot_at'), 'null') not in ('string', 'null')
       or coalesce(jsonb_typeof(v_ev -> 'source_label'), 'null') not in ('string', 'null')
       or char_length(v_ev ->> 'source_label') > 300 then
      return false;
    end if;
  end loop;

  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.complete_career_description(p_draft_id uuid, p_ai_job_id uuid, p_run_generation integer, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := private.current_uid();
  v_project_id uuid;
  v_draft public.drafts%rowtype;
  v_job public.ai_jobs%rowtype;
  v_meta jsonb;
  v_section jsonb;
  v_section_count integer;
  v_rows jsonb;
  v_count integer;
  v_now timestamptz := now();
  v_career_types constant text[] := array['experience', 'education', 'project',
                                          'project_deliverable', 'skill'];
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  select d.application_project_id into v_project_id
    from public.drafts d where d.id = p_draft_id and d.user_id = v_uid and d.draft_type = 'career_description';
  perform 1 from public.application_projects ap where ap.id = v_project_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'draft_not_found';
  end if;
  select * into v_draft from public.drafts d
   where d.id = p_draft_id and d.user_id = v_uid and d.draft_type = 'career_description'
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'draft_not_found';
  end if;

  select * into v_job from public.ai_jobs j where j.id = p_ai_job_id and j.user_id = v_uid;
  if not found or v_draft.ai_job_id is distinct from p_ai_job_id
     or not private.career_description_job_matches(v_job, p_draft_id, v_draft.application_project_id) then
    raise exception using errcode = 'P0001', message = 'invalid_ai_job';
  end if;

  if v_job.status <> 'running' or v_job.run_generation is distinct from p_run_generation
     or not (v_draft.status = 'generating'
             or (v_draft.status = 'failed' and coalesce(v_draft.run_generation, -1) < p_run_generation)) then
    return jsonb_build_object('applied', false, 'reason', 'stale_run');
  end if;

  -- ── payload shape ──
  if not private.draft_payload_common_valid(p_payload)
     or jsonb_typeof(p_payload -> 'sections') is distinct from 'array' then
    raise exception using errcode = 'P0001', message = 'invalid_draft_payload';
  end if;

  select count(*) into v_section_count from public.draft_sections s where s.draft_id = p_draft_id;

  -- Every section of the draft exactly once.
  if jsonb_array_length(p_payload -> 'sections') <> v_section_count
     or exists (select 1 from jsonb_array_elements(p_payload -> 'sections') e
                 where jsonb_typeof(e) <> 'object' or not private.is_uuid_text(e -> 'section_id'))
     or (select count(distinct e ->> 'section_id') from jsonb_array_elements(p_payload -> 'sections') e)
        <> v_section_count
     or exists (select 1 from jsonb_array_elements(p_payload -> 'sections') e
                 where not exists (select 1 from public.draft_sections s
                                    where s.id = (e ->> 'section_id')::uuid and s.draft_id = p_draft_id)) then
    raise exception using errcode = 'P0001', message = 'invalid_draft_payload';
  end if;

  for v_section in select e from jsonb_array_elements(p_payload -> 'sections') e loop
    if not private.draft_blocks_valid(v_section -> 'blocks')
       or jsonb_typeof(v_section -> 'blocks') is distinct from 'array'
       or exists (select 1 from jsonb_array_elements(v_section -> 'blocks') b
                   where b ->> 'block_kind' not in ('header', 'summary', 'role_line', 'bullet'))
       or coalesce(jsonb_typeof(v_section -> 'validation_report'), 'null') not in ('object', 'null') then
      raise exception using errcode = 'P0001', message = 'invalid_draft_payload';
    end if;
  end loop;

  -- block_id unique across the draft (AI-03 ids such as e1-s / p3-b1).
  if (select count(*) from jsonb_array_elements(p_payload -> 'sections') s, jsonb_array_elements(s -> 'blocks') b)
     <> (select count(distinct b ->> 'block_id')
           from jsonb_array_elements(p_payload -> 'sections') s, jsonb_array_elements(s -> 'blocks') b) then
    raise exception using errcode = 'P0001', message = 'invalid_draft_payload';
  end if;

  -- Evidence: career sources only, never learnings (V-8), item_key = a block_id of the named section.
  if exists (select 1 from jsonb_array_elements(p_payload -> 'evidence') e
              where not private.draft_evidence_elem_valid(e, v_career_types)
                 or not private.is_uuid_text(e -> 'section_id')
                 or (e ->> 'source_type' = 'project' and e ->> 'source_field' = 'learnings')
                 or not exists (select 1 from jsonb_array_elements(p_payload -> 'sections') s,
                                              jsonb_array_elements(s -> 'blocks') b
                                 where s ->> 'section_id' = e ->> 'section_id'
                                   and b ->> 'block_id' = btrim(e ->> 'item_key'))) then
    raise exception using errcode = 'P0001', message = 'invalid_draft_payload';
  end if;

  v_meta := p_payload -> 'meta';
  if not private.draft_meta_matches_job(v_meta, v_job) then
    raise exception using errcode = 'P0001', message = 'invalid_ai_metadata';
  end if;

  -- ── writes ──
  perform 1 from public.draft_sections s where s.draft_id = p_draft_id order by s.id for update;

  update public.draft_sections s
     set ai_content = x.e -> 'blocks',
         validation_report = case when jsonb_typeof(x.e -> 'validation_report') = 'object'
                                  then x.e -> 'validation_report' end,
         status = 'ready',
         generation_no = s.generation_no + 1,
         ai_job_id = p_ai_job_id,
         run_generation = p_run_generation,
         schema_version = (v_meta ->> 'schema_version')::integer,
         prompt_version = btrim(v_meta ->> 'prompt_version'),
         provider = v_job.provider,
         model = btrim(v_meta ->> 'model'),
         model_tier = v_job.model_tier,
         connection_tier = v_job.connection_tier,
         input_hash = btrim(p_payload -> 'hashes' ->> 'input_hash'),
         career_snapshot_hash = btrim(p_payload -> 'hashes' ->> 'career_snapshot_hash'),
         completed_at = v_now
    from jsonb_array_elements(p_payload -> 'sections') as x (e)
   where s.id = (x.e ->> 'section_id')::uuid and s.draft_id = p_draft_id;

  -- Fresh evidence for the draft's sections.
  delete from public.evidence_links el
   where el.owner_type = 'draft_section' and el.user_id = v_uid
     and el.owner_id in (select s.id from public.draft_sections s where s.draft_id = p_draft_id);

  select coalesce(jsonb_agg((e - 'section_id' - 'owner_type' - 'owner_id' - 'user_id' - 'application_project_id')
                            || jsonb_build_object('owner_id', e ->> 'section_id')), '[]'::jsonb)
    into v_rows
    from jsonb_array_elements(p_payload -> 'evidence') e;
  v_count := private.draft_insert_evidence(v_uid, v_draft.application_project_id, v_rows);

  update public.drafts d
     set status = 'ready',
         input_hash = btrim(p_payload -> 'hashes' ->> 'input_hash'),
         career_snapshot_hash = btrim(p_payload -> 'hashes' ->> 'career_snapshot_hash'),
         schema_version = (v_meta ->> 'schema_version')::integer,
         prompt_version = btrim(v_meta ->> 'prompt_version'),
         provider = v_job.provider,
         model = btrim(v_meta ->> 'model'),
         model_tier = v_job.model_tier,
         connection_tier = v_job.connection_tier,
         validation_report = case when jsonb_typeof(v_meta -> 'validation_report') = 'object'
                                  then v_meta -> 'validation_report' end,
         usage = case when jsonb_typeof(v_meta -> 'usage') = 'object' then v_meta -> 'usage' end,
         run_generation = p_run_generation,
         completed_at = v_now
   where d.id = p_draft_id;

  update public.application_projects ap set last_activity_at = v_now where ap.id = v_draft.application_project_id;

  return jsonb_build_object(
    'applied', true,
    'draft_id', p_draft_id,
    'application_project_id', v_draft.application_project_id,
    'status', 'ready',
    'section_count', v_section_count,
    'evidence_count', v_count,
    'completed_at', v_now);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.complete_cover_letter_section(p_section_id uuid, p_ai_job_id uuid, p_run_generation integer, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := private.current_uid();
  v_section public.draft_sections%rowtype;
  v_project_id uuid;
  v_job public.ai_jobs%rowtype;
  v_meta jsonb;
  v_src jsonb;
  v_ord bigint;
  v_source_count integer;
  v_map jsonb := '{}'::jsonb;
  v_match public.draft_section_sources%rowtype;
  v_rows jsonb;
  v_count integer;
  v_status text;
  v_now timestamptz := now();
  v_types constant text[] := array['experience', 'education', 'project', 'project_deliverable',
                                   'skill', 'jd_requirement', 'jd_sentence', 'user_note'];
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  v_section := private.lock_cover_letter_section(p_section_id, v_uid);
  select d.application_project_id into v_project_id from public.drafts d where d.id = v_section.draft_id;

  select * into v_job from public.ai_jobs j where j.id = p_ai_job_id and j.user_id = v_uid;
  if not found or not private.cover_letter_job_matches(v_job, p_section_id, v_project_id) then
    raise exception using errcode = 'P0001', message = 'invalid_ai_job';
  end if;

  -- QA-S7-09: the question no longer belongs to this job (reset by delete_career_item(delete_results), or taken
  -- over by a later job) -> the run is stale, not an error.
  if v_section.ai_job_id is distinct from p_ai_job_id
     or v_job.status <> 'running' or v_job.run_generation is distinct from p_run_generation
     or not (v_section.status = 'generating'
             or (v_section.status = 'failed' and coalesce(v_section.run_generation, -1) < p_run_generation)) then
    return jsonb_build_object('applied', false, 'reason', 'stale_run');
  end if;

  -- ── payload shape ──
  if not private.draft_payload_common_valid(p_payload)
     or coalesce(p_payload ->> 'question_class', '') not in ('motivation', 'job_competency', 'future_plan',
                                                             'experience_story')
     or jsonb_typeof(p_payload -> 'blocks') is distinct from 'array'
     or jsonb_array_length(p_payload -> 'blocks') not between 1 and 20
     or not private.draft_blocks_valid(p_payload -> 'blocks')
     or exists (select 1 from jsonb_array_elements(p_payload -> 'blocks') b where b ->> 'block_kind' <> 'paragraph')
     or jsonb_typeof(p_payload -> 'ai_char_count') is distinct from 'number'
     or (p_payload ->> 'ai_char_count') !~ '^[0-9]{1,9}$'
     or jsonb_typeof(p_payload -> 'correction_applied') is distinct from 'boolean'
     or jsonb_typeof(p_payload -> 'sources') is distinct from 'array'
     or jsonb_array_length(p_payload -> 'sources') > 5 then
    raise exception using errcode = 'P0001', message = 'invalid_draft_payload';
  end if;
  v_source_count := jsonb_array_length(p_payload -> 'sources');

  if exists (select 1 from jsonb_array_elements(p_payload -> 'sources') e
              where jsonb_typeof(e) <> 'object'
                 or not (coalesce(jsonb_typeof(e -> 'project_id'), 'null') = 'null' or private.is_uuid_text(e -> 'project_id'))
                 or not (coalesce(jsonb_typeof(e -> 'experience_id'), 'null') = 'null' or private.is_uuid_text(e -> 'experience_id'))
                 or not (coalesce(jsonb_typeof(e -> 'education_id'), 'null') = 'null' or private.is_uuid_text(e -> 'education_id'))
                 or num_nonnulls(e ->> 'project_id', e ->> 'experience_id', e ->> 'education_id') < 1
                 or num_nonnulls(e ->> 'experience_id', e ->> 'education_id') > 1
                 or not private.is_uuid_array(e -> 'requirement_ids', 50, true)
                 or coalesce(e ->> 'role', '') not in ('primary', 'supporting')
                 or coalesce(jsonb_typeof(e -> 'rationale'), 'null') not in ('string', 'null')
                 or coalesce(char_length(e ->> 'rationale'), 0) > 300
                 or coalesce(jsonb_typeof(e -> 'reuse_reason'), 'null') not in ('string', 'null')
                 or coalesce(char_length(e ->> 'reuse_reason'), 0) > 300
                 or coalesce(jsonb_typeof(e -> 'source_label'), 'null') not in ('string', 'null')
                 or coalesce(char_length(e ->> 'source_label'), 0) > 300) then
    raise exception using errcode = 'P0001', message = 'invalid_draft_payload';
  end if;

  -- Evidence: item_key = a paragraph block_id or sources.{payload index}; user_note quotes this question's note;
  -- learnings only outside job_competency (V-8 / C-9).
  if exists (select 1 from jsonb_array_elements(p_payload -> 'evidence') e
              where not private.draft_evidence_elem_valid(e, v_types)
                 or not (exists (select 1 from jsonb_array_elements(p_payload -> 'blocks') b
                                  where b ->> 'block_id' = btrim(e ->> 'item_key'))
                         or (btrim(e ->> 'item_key') ~ '^sources\.[0-9]{1,2}$'
                             and substr(btrim(e ->> 'item_key'), 9)::integer < v_source_count))
                 or (e ->> 'source_type' = 'user_note'
                     and ((e ->> 'source_id')::uuid <> p_section_id
                          or coalesce(jsonb_typeof(e -> 'source_field'), 'null') <> 'null'))
                 or (e ->> 'source_type' = 'project' and e ->> 'source_field' = 'learnings'
                     and p_payload ->> 'question_class' = 'job_competency')) then
    raise exception using errcode = 'P0001', message = 'invalid_draft_payload';
  end if;

  v_meta := p_payload -> 'meta';
  if not private.draft_meta_matches_job(v_meta, v_job) then
    raise exception using errcode = 'P0001', message = 'invalid_ai_metadata';
  end if;

  -- ── sources ──
  if v_section.source_selection_mode = 'ai' then
    -- AI choice: replace with origin 'ai' rows; sources.{n} stays n.
    delete from public.draft_section_sources s where s.draft_section_id = p_section_id;
    insert into public.draft_section_sources (user_id, draft_section_id, application_project_id, experience_id,
                                              education_id, project_id, role, origin, rationale,
                                              reuse_reason, requirement_ids, sort_order, source_label,
                                              source_deleted_at)
    select v_uid, p_section_id, v_project_id, x.exp, x.edu, x.proj,
           t.e ->> 'role', 'ai', t.e ->> 'rationale', t.e ->> 'reuse_reason',
           coalesce((select array_agg(distinct r::uuid)
                       from jsonb_array_elements_text(coalesce(nullif(t.e -> 'requirement_ids', 'null'::jsonb), '[]'::jsonb)) r), '{}'),
           (t.o - 1)::integer,
           coalesce(private.draft_source_label(v_uid, x.exp, x.edu, x.proj), t.e ->> 'source_label'),
           case when (x.exp is not null and not exists (select 1 from public.experiences e
                                                         where e.id = x.exp and e.user_id = v_uid))
                  or (x.edu is not null and not exists (select 1 from public.educations ed
                                                         where ed.id = x.edu and ed.user_id = v_uid))
                  or (x.proj is not null and not exists (select 1 from public.projects p
                                                          where p.id = x.proj and p.user_id = v_uid))
                then v_now end
      from jsonb_array_elements(p_payload -> 'sources') with ordinality as t (e, o)
      cross join lateral (select (t.e ->> 'experience_id')::uuid as exp, (t.e ->> 'education_id')::uuid as edu,
                                 (t.e ->> 'project_id')::uuid as proj) x;
    select coalesce(jsonb_object_agg((o - 1)::text, o - 1), '{}'::jsonb) into v_map
      from generate_series(1, v_source_count) o;
  else
    -- User choice: keep the user's rows, refresh only the rationale of matching entries (S7 plan, AI-04 user mode).
    for v_src, v_ord in select e, o from jsonb_array_elements(p_payload -> 'sources') with ordinality as t (e, o) loop
      select * into v_match from public.draft_section_sources s
       where s.draft_section_id = p_section_id
         and case when v_src ->> 'project_id' is not null
                  then s.project_id = (v_src ->> 'project_id')::uuid
                  else s.project_id is null
                       and s.experience_id is not distinct from (v_src ->> 'experience_id')::uuid
                       and s.education_id is not distinct from (v_src ->> 'education_id')::uuid
             end
       limit 1;
      if found and not v_map ? (v_ord - 1)::text then
        update public.draft_section_sources s set rationale = v_src ->> 'rationale' where s.id = v_match.id;
        v_map := v_map || jsonb_build_object((v_ord - 1)::text, v_match.sort_order);
      end if;
    end loop;
  end if;

  -- ── evidence (previous generation's links are dropped, D-DM-06) ──
  delete from public.evidence_links el
   where el.owner_type = 'draft_section' and el.owner_id = p_section_id and el.user_id = v_uid;

  select coalesce(jsonb_agg((e - 'owner_type' - 'owner_id' - 'user_id' - 'application_project_id' - 'section_id')
                            || jsonb_build_object(
                                 'owner_id', p_section_id,
                                 'item_key', case when btrim(e ->> 'item_key') ~ '^sources\.[0-9]+$'
                                                  then 'sources.' || (v_map ->> substr(btrim(e ->> 'item_key'), 9))
                                                  else btrim(e ->> 'item_key') end)), '[]'::jsonb)
    into v_rows
    from jsonb_array_elements(p_payload -> 'evidence') e
   where not (btrim(e ->> 'item_key') ~ '^sources\.[0-9]+$'
              and v_map ->> substr(btrim(e ->> 'item_key'), 9) is null);
  v_count := private.draft_insert_evidence(v_uid, v_project_id, v_rows);

  -- ── question ──
  update public.draft_sections s
     set ai_content = p_payload -> 'blocks',
         edited_content = null,
         ai_char_count = (p_payload ->> 'ai_char_count')::integer,
         correction_applied = (p_payload ->> 'correction_applied')::boolean,
         question_class = p_payload ->> 'question_class',
         validation_report = case when jsonb_typeof(v_meta -> 'validation_report') = 'object'
                                  then v_meta -> 'validation_report' end,
         usage = case when jsonb_typeof(v_meta -> 'usage') = 'object' then v_meta -> 'usage' end,
         status = 'ready',
         generation_no = s.generation_no + 1,
         sources_modified_at = null,
         run_generation = p_run_generation,
         schema_version = (v_meta ->> 'schema_version')::integer,
         prompt_version = btrim(v_meta ->> 'prompt_version'),
         provider = v_job.provider,
         model = btrim(v_meta ->> 'model'),
         model_tier = v_job.model_tier,
         connection_tier = v_job.connection_tier,
         input_hash = btrim(p_payload -> 'hashes' ->> 'input_hash'),
         career_snapshot_hash = btrim(p_payload -> 'hashes' ->> 'career_snapshot_hash'),
         completed_at = v_now
   where s.id = p_section_id;

  -- Draft: status + result badge = the last generated question (S-19 C-19).
  update public.drafts d
     set schema_version = (v_meta ->> 'schema_version')::integer,
         prompt_version = btrim(v_meta ->> 'prompt_version'),
         provider = v_job.provider,
         model = btrim(v_meta ->> 'model'),
         model_tier = v_job.model_tier,
         connection_tier = v_job.connection_tier,
         completed_at = v_now
   where d.id = v_section.draft_id;
  v_status := private.draft_recompute_status(v_section.draft_id);

  update public.application_projects ap set last_activity_at = v_now where ap.id = v_project_id;

  return jsonb_build_object(
    'applied', true,
    'section_id', p_section_id,
    'draft_id', v_section.draft_id,
    'generation_no', v_section.generation_no + 1,
    'status', 'ready',
    'draft_status', v_status,
    'source_count', (select count(*) from public.draft_section_sources s where s.draft_section_id = p_section_id),
    'evidence_count', v_count,
    'completed_at', v_now);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_interview_question(p_session_id uuid, p_ai_job_id uuid, p_run_generation integer, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := private.current_uid();
  v_session public.interview_sessions%rowtype;
  v_job public.ai_jobs%rowtype;
  v_state text;
  v_meta jsonb;
  v_seq integer;
  v_kind text;
  v_anchor text;
  v_question_id uuid;
  v_answer_id uuid;
  v_job_kinds constant text[] := array['project_deep_dive', 'requirement_fit', 'gap_probe'];
  v_culture_kinds constant text[] := array['collaboration', 'conflict', 'failure_growth', 'values', 'org_adaptation',
                                           'motivation_career'];
  v_types constant text[] := array['experience', 'education', 'project', 'project_deliverable',
                                   'skill', 'jd_requirement', 'jd_sentence'];
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  v_session := private.interview_lock_session(p_session_id, v_uid);

  select * into v_job from public.ai_jobs j where j.id = p_ai_job_id and j.user_id = v_uid;
  if not found or not private.interview_job_matches(v_job, v_session, 'interview_questions') then
    raise exception using errcode = 'P0001', message = 'invalid_ai_job';
  end if;

  v_state := private.interview_questions_run_state(v_session, v_job, p_run_generation);
  if v_state = 'stale' then
    return jsonb_build_object('applied', false, 'reason', 'stale_run');
  end if;

  -- ── payload shape ──
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or not private.draft_payload_common_valid(p_payload)
     or jsonb_typeof(p_payload -> 'sequence') is distinct from 'number'
     or (p_payload ->> 'sequence') !~ '^[1-7]$'
     or jsonb_typeof(p_payload -> 'question_text') is distinct from 'string'
     or char_length(btrim(p_payload ->> 'question_text')) not between 1 and 1000
     or jsonb_typeof(p_payload -> 'intent') is distinct from 'string'
     or char_length(btrim(p_payload ->> 'intent')) not between 1 and 1000 then
    raise exception using errcode = 'P0001', message = 'invalid_interview_payload';
  end if;

  v_seq := (p_payload ->> 'sequence')::integer;
  if v_seq > v_session.question_count then
    raise exception using errcode = 'P0001', message = 'invalid_interview_payload';
  end if;
  v_kind := p_payload ->> 'source_kind';
  v_anchor := p_payload ->> 'anchor';

  -- AI 4.1: source_kind by interview type; job questions anchor on experience / jd only.
  if v_kind is null or v_anchor is null
     or (v_session.interview_type = 'job' and (v_kind <> all (v_job_kinds) or v_anchor not in ('experience', 'jd')))
     or (v_session.interview_type = 'culture_fit'
         and (v_kind <> all (v_culture_kinds) or v_anchor not in ('experience', 'jd', 'general'))) then
    raise exception using errcode = 'P0001', message = 'invalid_interview_payload';
  end if;

  -- focus_criteria: 0..4 distinct rubric keys. good_answer_signals: 0..10 strings of 1..300.
  if not (coalesce(jsonb_typeof(p_payload -> 'focus_criteria'), 'null') = 'null'
          or (jsonb_typeof(p_payload -> 'focus_criteria') = 'array'
              and jsonb_array_length(p_payload -> 'focus_criteria') <= 4
              and not exists (select 1 from jsonb_array_elements(p_payload -> 'focus_criteria') e
                               where jsonb_typeof(e) <> 'string'
                                  or (e #>> '{}') not in ('specificity', 'intent_fit', 'structure', 'job_relevance'))
              and (select count(distinct e) from jsonb_array_elements(p_payload -> 'focus_criteria') e)
                  = jsonb_array_length(p_payload -> 'focus_criteria')))
     or not (coalesce(jsonb_typeof(p_payload -> 'good_answer_signals'), 'null') = 'null'
             or (jsonb_typeof(p_payload -> 'good_answer_signals') = 'array'
                 and jsonb_array_length(p_payload -> 'good_answer_signals') <= 10
                 and not exists (select 1 from jsonb_array_elements(p_payload -> 'good_answer_signals') e
                                  where jsonb_typeof(e) <> 'string'
                                     or char_length(btrim(e #>> '{}')) not between 1 and 300)))
     or not private.interview_requirement_ids_valid(v_session.application_project_id,
                                                    p_payload -> 'target_requirement_ids', 20)
     or not private.interview_requirement_ids_valid(v_session.application_project_id,
                                                    p_payload -> 'target_gap_requirement_ids', 20) then
    raise exception using errcode = 'P0001', message = 'invalid_interview_payload';
  end if;

  -- Evidence: career + JD sources. Job interview questions never rest on learnings (V-8, C-9).
  if not private.interview_evidence_valid(p_payload -> 'evidence', v_types)
     or (v_session.interview_type = 'job'
         and exists (select 1 from jsonb_array_elements(p_payload -> 'evidence') e
                      where e ->> 'source_type' = 'project' and e ->> 'source_field' = 'learnings')) then
    raise exception using errcode = 'P0001', message = 'invalid_interview_payload';
  end if;

  v_meta := p_payload -> 'meta';
  if not private.draft_meta_matches_job(v_meta, v_job) then
    raise exception using errcode = 'P0001', message = 'invalid_ai_metadata';
  end if;

  -- ── writes ──
  if v_state = 'reopen' then
    update public.interview_sessions s
       set generation_status = 'generating', question_run_generation = p_run_generation
     where s.id = p_session_id;
  end if;

  select q.id into v_question_id from public.interview_questions q
   where q.session_id = p_session_id and q.sequence = v_seq;
  if found then
    select a.id into v_answer_id from public.interview_answers a where a.question_id = v_question_id;
    return jsonb_build_object(
      'applied', true, 'created', false, 'question_id', v_question_id, 'answer_id', v_answer_id, 'sequence', v_seq,
      'saved_count', (select count(*) from public.interview_questions q where q.session_id = p_session_id),
      'question_count', v_session.question_count);
  end if;

  insert into public.interview_questions (
    user_id, session_id, sequence, source_kind, anchor, question_text, intent, focus_criteria,
    target_requirement_ids, target_gap_requirement_ids, good_answer_signals,
    ai_job_id, run_generation, schema_version, prompt_version, provider, model, model_tier, connection_tier,
    input_hash, career_snapshot_hash, validation_report, usage)
  values (
    v_uid, p_session_id, v_seq, v_kind, v_anchor, btrim(p_payload ->> 'question_text'), btrim(p_payload ->> 'intent'),
    coalesce((select array_agg(e) from jsonb_array_elements_text(p_payload -> 'focus_criteria') e), '{}'),
    private.interview_uuid_array(p_payload -> 'target_requirement_ids'),
    private.interview_uuid_array(p_payload -> 'target_gap_requirement_ids'),
    coalesce((select jsonb_agg(to_jsonb(btrim(e)))
                from jsonb_array_elements_text(p_payload -> 'good_answer_signals') e), '[]'::jsonb),
    p_ai_job_id, p_run_generation, (v_meta ->> 'schema_version')::integer, btrim(v_meta ->> 'prompt_version'),
    v_job.provider, btrim(v_meta ->> 'model'), v_job.model_tier, v_job.connection_tier,
    btrim(p_payload -> 'hashes' ->> 'input_hash'), btrim(p_payload -> 'hashes' ->> 'career_snapshot_hash'),
    case when jsonb_typeof(v_meta -> 'validation_report') = 'object' then v_meta -> 'validation_report' end,
    case when jsonb_typeof(v_meta -> 'usage') = 'object' then v_meta -> 'usage' end)
  returning id into v_question_id;

  perform private.interview_insert_evidence(v_uid, v_session.application_project_id, 'interview_question',
                                            v_question_id, p_payload -> 'evidence');

  insert into public.interview_answers (user_id, session_id, question_id)
  values (v_uid, p_session_id, v_question_id)
  returning id into v_answer_id;

  return jsonb_build_object(
    'applied', true, 'created', true, 'question_id', v_question_id, 'answer_id', v_answer_id, 'sequence', v_seq,
    'saved_count', (select count(*) from public.interview_questions q where q.session_id = p_session_id),
    'question_count', v_session.question_count);
end;
$function$
;

CREATE OR REPLACE FUNCTION private.interview_result_payload_valid(p_payload jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select p_payload is not null and jsonb_typeof(p_payload) = 'object'
     and jsonb_typeof(p_payload -> 'result') = 'object'
     and not jsonb_path_exists(p_payload -> 'result', 'lax $.**.evidence')
     and private.draft_payload_common_valid(p_payload)
     and private.interview_evidence_valid(p_payload -> 'evidence',
           array['experience', 'education', 'project', 'project_deliverable', 'skill',
                 'jd_requirement', 'jd_sentence', 'interview_answer']);
$function$;
