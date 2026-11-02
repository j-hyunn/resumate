-- S7 cover letter question RPCs (AI-04; DM A.9–A.11, §2.8, AI C-3 storage incl. sources.{n}, D-DM-06) and the
-- ai_jobs end trigger for both draft job types. app_ai_writer only, security definer + private.current_uid().
-- The job runner calls (per question):
--   begin_cover_letter_section -> (AI-04 stream, validation, length adjustment) -> complete_cover_letter_section |
--   fail_draft_section, then complete_ai_job (complete first; stale_run means: don't complete the job).
-- Job shape: job_type 'cover_letter', target_type 'draft_section', target_id = the question id,
-- application_project_id = the draft's project. One in-flight job per question (ai_jobs_in_flight_target_key).
-- A regeneration overwrites the question in place (DM-5, D-DM-06): previous blocks, edited_content, sources (AI
-- mode) and evidence are not kept.
-- Lock order: application_projects row -> drafts row -> draft_sections row.
-- Errors: 42501 not_authenticated; P0001 section_not_found, invalid_ai_job, jd_not_extracted, section_in_progress,
-- invalid_ai_metadata, invalid_draft_payload, invalid_evidence_source.

-- Is p_job the cover letter job of (question p_section_id, project p_application_project_id)?
create or replace function private.cover_letter_job_matches(p_job public.ai_jobs, p_section_id uuid,
                                                            p_application_project_id uuid)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_job.id is not null
     and p_job.job_type = 'cover_letter'
     and p_job.target_type = 'draft_section'
     and p_job.target_id = p_section_id
     and p_job.application_project_id = p_application_project_id;
$$;

revoke all on function private.cover_letter_job_matches(public.ai_jobs, uuid, uuid) from public;

-- Locks project -> draft -> question of the caller's cover letter question; returns the question row.
create or replace function private.lock_cover_letter_section(p_section_id uuid, p_uid uuid)
returns public.draft_sections
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft_id uuid;
  v_project_id uuid;
  v_section public.draft_sections%rowtype;
begin
  select s.draft_id, d.application_project_id into v_draft_id, v_project_id
    from public.draft_sections s
    join public.drafts d on d.id = s.draft_id
   where s.id = p_section_id and s.user_id = p_uid and s.section_kind = 'cover_letter_question';
  perform 1 from public.application_projects ap where ap.id = v_project_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'section_not_found';
  end if;
  perform 1 from public.drafts d where d.id = v_draft_id for update;
  select * into v_section from public.draft_sections s
   where s.id = p_section_id and s.user_id = p_uid and s.section_kind = 'cover_letter_question'
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'section_not_found';
  end if;
  return v_section;
end;
$$;

revoke all on function private.lock_cover_letter_section(uuid, uuid) from public;

-- generating -> failed for (p_section_id, p_ai_job_id), stamped with the job's run_generation, then the draft
-- status is recomputed. p_skip_locked: end trigger path (QA-S5-06).
create or replace function private.draft_section_mark_failed(p_section_id uuid, p_ai_job_id uuid,
                                                             p_skip_locked boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft_id uuid;
  v_project_id uuid;
  v_generation integer;
begin
  select s.draft_id, d.application_project_id into v_draft_id, v_project_id
    from public.draft_sections s join public.drafts d on d.id = s.draft_id
   where s.id = p_section_id;
  if not found then
    return false;
  end if;

  if p_skip_locked then
    perform 1 from public.application_projects ap where ap.id = v_project_id for update skip locked;
  else
    perform 1 from public.application_projects ap where ap.id = v_project_id for update;
  end if;
  if not found then
    return false;
  end if;
  perform 1 from public.drafts d where d.id = v_draft_id for update;

  select j.run_generation into v_generation from public.ai_jobs j where j.id = p_ai_job_id;

  update public.draft_sections s
     set status = 'failed', run_generation = coalesce(v_generation, s.run_generation)
   where s.id = p_section_id and s.status = 'generating' and s.ai_job_id = p_ai_job_id;
  if not found then
    return false;
  end if;

  perform private.draft_recompute_status(v_draft_id);
  return true;
end;
$$;

revoke all on function private.draft_section_mark_failed(uuid, uuid, boolean) from public;

create or replace function private.cover_letter_begin_json(p_section_id uuid, p_reopened boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'section_id', s.id, 'draft_id', s.draft_id, 'application_project_id', d.application_project_id,
    'status', s.status, 'generation_no', s.generation_no, 'source_selection_mode', s.source_selection_mode,
    'reopened', p_reopened, 'draft_status', d.status)
    from public.draft_sections s join public.drafts d on d.id = s.draft_id
   where s.id = p_section_id;
$$;

revoke all on function private.cover_letter_begin_json(uuid, boolean) from public;


-- ── begin_cover_letter_section ─────────────────────────────────────────────
--   same job already opened the question -> current state (idempotent); a manual retry (higher run_generation) of a
--   failed question reopens it.
--   job not queued / running, or not this question's cover letter job -> invalid_ai_job
--   JD extraction not succeeded (D-30 runs it first) -> jd_not_extracted
--   question generating by another job still queued / running -> section_in_progress; job ended -> taken over.
create or replace function public.begin_cover_letter_section(p_section_id uuid, p_ai_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.current_uid();
  v_section public.draft_sections%rowtype;
  v_project_id uuid;
  v_job public.ai_jobs%rowtype;
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

  if v_section.ai_job_id = p_ai_job_id then
    if v_section.status = 'failed' and v_job.status in ('queued', 'running')
       and coalesce(v_section.run_generation, -1) < v_job.run_generation then
      update public.draft_sections s
         set status = 'generating', run_generation = v_job.run_generation
       where s.id = p_section_id;
      perform private.draft_recompute_status(v_section.draft_id);
      return private.cover_letter_begin_json(p_section_id, true);
    end if;
    return private.cover_letter_begin_json(p_section_id, false);
  end if;

  if v_job.status not in ('queued', 'running') then
    raise exception using errcode = 'P0001', message = 'invalid_ai_job';
  end if;

  if not exists (select 1 from public.job_descriptions jd
                  where jd.application_project_id = v_project_id and jd.extraction_status = 'succeeded') then
    raise exception using errcode = 'P0001', message = 'jd_not_extracted';
  end if;

  if private.draft_section_job_active(p_section_id, p_ai_job_id) then
    raise exception using errcode = 'P0001', message = 'section_in_progress';
  end if;

  update public.draft_sections s
     set status = 'generating',
         ai_job_id = p_ai_job_id,
         run_generation = v_job.run_generation,
         provider = v_job.provider,
         model_tier = v_job.model_tier,
         connection_tier = v_job.connection_tier
   where s.id = p_section_id;
  perform private.draft_recompute_status(v_section.draft_id);

  return private.cover_letter_begin_json(p_section_id, false);
end;
$$;

revoke all on function public.begin_cover_letter_section(uuid, uuid) from public, anon;
grant execute on function public.begin_cover_letter_section(uuid, uuid) to app_ai_writer;


-- ── complete_cover_letter_section ──────────────────────────────────────────
create or replace function public.complete_cover_letter_section(
  p_section_id uuid,
  p_ai_job_id uuid,
  p_run_generation integer,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  v_types constant text[] := array['profile', 'experience', 'education', 'project', 'project_detail',
                                   'achievement', 'skill', 'jd_requirement', 'jd_sentence', 'user_note'];
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
                 or not private.is_uuid_array(e -> 'project_detail_ids', 20, true)
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
                 or (e ->> 'source_type' = 'project_detail' and e ->> 'source_field' = 'learnings'
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
                                              education_id, project_id, project_detail_ids, role, origin, rationale,
                                              reuse_reason, requirement_ids, sort_order, source_label,
                                              source_deleted_at)
    select v_uid, p_section_id, v_project_id, x.exp, x.edu, x.proj,
           coalesce((select array_agg(distinct d::uuid)
                       from jsonb_array_elements_text(coalesce(nullif(t.e -> 'project_detail_ids', 'null'::jsonb), '[]'::jsonb)) d), '{}'),
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
$$;

revoke all on function public.complete_cover_letter_section(uuid, uuid, integer, jsonb) from public, anon;
grant execute on function public.complete_cover_letter_section(uuid, uuid, integer, jsonb) to app_ai_writer;


-- ── fail_draft_section ─────────────────────────────────────────────────────
create or replace function public.fail_draft_section(p_section_id uuid, p_ai_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.current_uid();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if not exists (select 1 from public.draft_sections s
                  where s.id = p_section_id and s.user_id = v_uid and s.section_kind = 'cover_letter_question') then
    raise exception using errcode = 'P0001', message = 'section_not_found';
  end if;
  return private.draft_section_mark_failed(p_section_id, p_ai_job_id, false);
end;
$$;

revoke all on function public.fail_draft_section(uuid, uuid) from public, anon;
grant execute on function public.fail_draft_section(uuid, uuid) to app_ai_writer;


-- ── ai_jobs end -> draft / question failed (S6 pattern) ───────────────────
-- A career_description / cover_letter job that ends (failed incl. sweep stalled, canceled, or succeeded without
-- complete_*) releases its generating rows. Project row taken with SKIP LOCKED (QA-S5-06); readers treat a
-- generating row whose job has ended as failed, and the next begin_* cleans it up.
create or replace function private.ai_jobs_release_drafts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('failed', 'canceled', 'succeeded') and old.status is distinct from new.status then
    if new.job_type = 'career_description' then
      perform private.career_description_mark_failed(d.id, new.id, true)
         from public.drafts d
        where d.ai_job_id = new.id and d.status = 'generating';
    elsif new.job_type = 'cover_letter' then
      perform private.draft_section_mark_failed(s.id, new.id, true)
         from public.draft_sections s
        where s.ai_job_id = new.id and s.status = 'generating';
    end if;
  end if;
  return null;
end;
$$;

revoke all on function private.ai_jobs_release_drafts() from public;

create trigger ai_jobs_release_drafts
  after update of status on public.ai_jobs
  for each row execute function private.ai_jobs_release_drafts();
