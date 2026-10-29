-- S7 career description RPCs (AI-03; DM A.9 / A.10, §2.8, AI C-3 storage, C-6). app_ai_writer only, security
-- definer with an owner check through private.current_uid() (JWT sub). The job runner calls:
--   begin_career_description -> (AI-03 stream, server validation) -> complete_career_description |
--   fail_career_description, then complete_ai_job (complete first; stale_run means: don't complete the job).
-- Job shape: job_type 'career_description', target_type 'draft', target_id = the draft id to create (the API makes
-- the uuid before the job), application_project_id = the project. One draft row per run; regeneration is a new
-- row (DM-5, AI-03 storage) with regenerated_from_id.
-- Lock order: application_projects row -> drafts row -> draft_sections rows (S6 / cover letter RPCs).
-- Errors: 42501 not_authenticated; P0001 application_project_not_found, draft_not_found, insight_not_found,
-- invalid_ai_job, jd_not_extracted, invalid_draft_options, invalid_draft_sections, invalid_title,
-- invalid_ai_metadata, invalid_draft_payload, invalid_evidence_source.

-- QA-S7-01 (D-34 "same target, one in-flight job"): the job's target is the new draft, so the generic
-- ai_jobs_in_flight_target_key never collides. One queued / running career description per application project.
-- A second insert fails with 23505 on ai_jobs_career_description_in_flight_key -> the API answers 409.
create unique index ai_jobs_career_description_in_flight_key on public.ai_jobs (user_id, application_project_id)
  where job_type = 'career_description' and status in ('queued', 'running');

-- ── shared payload helpers (also used by the cover letter section RPCs) ───

-- hashes {input_hash, career_snapshot_hash} (1..128 each) and meta (S6 insight meta shape).
create or replace function private.draft_payload_common_valid(p_payload jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_meta jsonb;
  v_key text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or jsonb_typeof(p_payload -> 'hashes') is distinct from 'object'
     or jsonb_typeof(p_payload -> 'meta') is distinct from 'object'
     or jsonb_typeof(p_payload -> 'evidence') is distinct from 'array'
     or jsonb_array_length(p_payload -> 'evidence') > 2000 then
    return false;
  end if;

  foreach v_key in array array['input_hash', 'career_snapshot_hash'] loop
    if jsonb_typeof(p_payload -> 'hashes' -> v_key) is distinct from 'string'
       or char_length(btrim(p_payload -> 'hashes' ->> v_key)) not between 1 and 128 then
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
  return true;
end;
$$;

revoke all on function private.draft_payload_common_valid(jsonb) from public;

-- meta provider / tiers equal the job's, model non-empty (invalid_ai_metadata otherwise).
create or replace function private.draft_meta_matches_job(p_meta jsonb, p_job public.ai_jobs)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_meta ->> 'provider' is not distinct from p_job.provider
     and p_meta ->> 'model_tier' is not distinct from p_job.model_tier
     and p_meta ->> 'connection_tier' is not distinct from p_job.connection_tier
     and coalesce(char_length(btrim(p_meta ->> 'model')), 0) between 1 and 200;
$$;

revoke all on function private.draft_meta_matches_job(jsonb, public.ai_jobs) from public;

-- One evidence element (S6 shape) with a source type from p_types.
create or replace function private.draft_evidence_elem_valid(p_elem jsonb, p_types text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_elem) = 'object'
     and jsonb_typeof(p_elem -> 'item_key') = 'string'
     and char_length(btrim(p_elem ->> 'item_key')) between 1 and 200
     and jsonb_typeof(p_elem -> 'sort_order') = 'number'
     and (p_elem ->> 'sort_order') ~ '^[0-9]{1,9}$'
     and coalesce(p_elem ->> 'source_type', '') = any (p_types)
     and private.is_uuid_text(p_elem -> 'source_id')
     and coalesce(jsonb_typeof(p_elem -> 'source_field'), 'null') in ('string', 'null')
     and coalesce(jsonb_typeof(p_elem -> 'quote'), 'null') in ('string', 'null')
     and coalesce(char_length(p_elem ->> 'quote'), 0) <= 2000
     and coalesce(jsonb_typeof(p_elem -> 'quote_adjusted'), 'null') in ('boolean', 'null')
     and coalesce(jsonb_typeof(p_elem -> 'source_locator'), 'null') in ('object', 'null')
     and coalesce(jsonb_typeof(p_elem -> 'source_snapshot_at'), 'null') in ('string', 'null')
     and coalesce(jsonb_typeof(p_elem -> 'source_label'), 'null') in ('string', 'null')
     and coalesce(char_length(p_elem ->> 'source_label'), 0) <= 300;
$$;

revoke all on function private.draft_evidence_elem_valid(jsonb, text[]) from public;

-- Inserts evidence rows for draft sections. p_rows elements: {owner_id, item_key (final), sort_order, source_type,
-- source_id, source_field, quote, quote_adjusted, source_locator, source_snapshot_at, source_label}.
-- Value errors (bad timestamp, C-3 field CHECK) -> invalid_draft_payload; the source guard's
-- invalid_evidence_source propagates as is.
create or replace function private.draft_insert_evidence(p_uid uuid, p_application_project_id uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_now timestamptz := now();
begin
  begin
    insert into public.evidence_links (user_id, application_project_id, owner_type, owner_id, item_key, sort_order,
                                       source_type, source_id, source_locator, source_field, quote, quote_adjusted,
                                       source_snapshot_at, source_label)
    select p_uid, p_application_project_id, 'draft_section', (e ->> 'owner_id')::uuid, btrim(e ->> 'item_key'),
           (e ->> 'sort_order')::integer, e ->> 'source_type', (e ->> 'source_id')::uuid,
           case when jsonb_typeof(e -> 'source_locator') = 'object' then e -> 'source_locator' end,
           e ->> 'source_field', e ->> 'quote', coalesce((e ->> 'quote_adjusted')::boolean, false),
           coalesce((e ->> 'source_snapshot_at')::timestamptz, v_now), e ->> 'source_label'
      from jsonb_array_elements(p_rows) e;
    get diagnostics v_count = row_count;
  exception
    when check_violation or invalid_text_representation or invalid_datetime_format
         or datetime_field_overflow or numeric_value_out_of_range then
      raise exception using errcode = 'P0001', message = 'invalid_draft_payload';
  end;
  return v_count;
end;
$$;

revoke all on function private.draft_insert_evidence(uuid, uuid, jsonb) from public;

-- Is p_job the career description job of (draft p_draft_id, project p_application_project_id)?
create or replace function private.career_description_job_matches(p_job public.ai_jobs, p_draft_id uuid,
                                                                  p_application_project_id uuid)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_job.id is not null
     and p_job.job_type = 'career_description'
     and p_job.target_type = 'draft'
     and p_job.target_id = p_draft_id
     and p_job.application_project_id = p_application_project_id;
$$;

revoke all on function private.career_description_job_matches(public.ai_jobs, uuid, uuid) from public;

-- p_sections of begin_career_description (S7 db notes).
create or replace function private.career_description_sections_valid(p_uid uuid, p_sections jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_elem jsonb;
  v_kind text;
  v_keys text[] := '{}';
  v_key text;
begin
  if p_sections is null or jsonb_typeof(p_sections) <> 'array'
     or jsonb_array_length(p_sections) not between 1 and 30 then
    return false;
  end if;
  for v_elem in select e from jsonb_array_elements(p_sections) e loop
    if jsonb_typeof(v_elem) <> 'object' then
      return false;
    end if;
    v_kind := v_elem ->> 'section_kind';
    if not (coalesce(jsonb_typeof(v_elem -> 'heading'), 'null') = 'null'
            or (jsonb_typeof(v_elem -> 'heading') = 'string' and char_length(v_elem ->> 'heading') <= 300)) then
      return false;
    end if;
    if v_kind = 'experience' then
      if not private.is_uuid_text(v_elem -> 'experience_id')
         or coalesce(jsonb_typeof(v_elem -> 'education_id'), 'null') <> 'null'
         or not exists (select 1 from public.experiences e
                         where e.id = (v_elem ->> 'experience_id')::uuid and e.user_id = p_uid) then
        return false;
      end if;
      v_key := lower('e:' || (v_elem ->> 'experience_id'));
    elsif v_kind = 'education' then
      if not private.is_uuid_text(v_elem -> 'education_id')
         or coalesce(jsonb_typeof(v_elem -> 'experience_id'), 'null') <> 'null'
         or not exists (select 1 from public.educations ed
                         where ed.id = (v_elem ->> 'education_id')::uuid and ed.user_id = p_uid) then
        return false;
      end if;
      v_key := lower('d:' || (v_elem ->> 'education_id'));
    elsif v_kind = 'standalone_projects' then
      if coalesce(jsonb_typeof(v_elem -> 'experience_id'), 'null') <> 'null'
         or coalesce(jsonb_typeof(v_elem -> 'education_id'), 'null') <> 'null' then
        return false;
      end if;
      v_key := 's';
    else
      return false;
    end if;
    if v_key = any (v_keys) then
      return false;
    end if;
    v_keys := v_keys || v_key;
  end loop;
  return true;
end;
$$;

revoke all on function private.career_description_sections_valid(uuid, jsonb) from public;

-- begin_career_description's return shape.
create or replace function private.career_description_begin_json(p_draft_id uuid, p_reopened boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'draft_id', d.id, 'application_project_id', d.application_project_id, 'status', d.status,
    'reopened', p_reopened,
    'sections', coalesce((select jsonb_agg(jsonb_build_object(
                  'section_id', s.id, 'sort_order', s.sort_order, 'section_kind', s.section_kind,
                  'experience_id', s.experience_id, 'education_id', s.education_id, 'heading', s.heading)
                  order by s.sort_order)
                  from public.draft_sections s where s.draft_id = d.id), '[]'::jsonb))
    from public.drafts d where d.id = p_draft_id;
$$;

revoke all on function private.career_description_begin_json(uuid, boolean) from public;

-- generating -> failed for (p_draft_id, p_ai_job_id): the draft and its pending / generating sections, stamped
-- with the job's current run_generation. Returns whether the draft changed.
-- p_skip_locked (end trigger path, QA-S5-06): take the project row without waiting, else do nothing.
create or replace function private.career_description_mark_failed(p_draft_id uuid, p_ai_job_id uuid,
                                                                  p_skip_locked boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_generation integer;
begin
  select d.application_project_id into v_project_id from public.drafts d where d.id = p_draft_id;
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

  select j.run_generation into v_generation from public.ai_jobs j where j.id = p_ai_job_id;

  update public.drafts d
     set status = 'failed', run_generation = coalesce(v_generation, d.run_generation)
   where d.id = p_draft_id and d.draft_type = 'career_description' and d.status = 'generating'
     and d.ai_job_id = p_ai_job_id;
  if not found then
    return false;
  end if;

  update public.draft_sections s
     set status = 'failed'
   where s.draft_id = p_draft_id and s.status in ('pending', 'generating');
  return true;
end;
$$;

revoke all on function private.career_description_mark_failed(uuid, uuid, boolean) from public;


-- ── begin_career_description ───────────────────────────────────────────────
create or replace function public.begin_career_description(
  p_application_project_id uuid,
  p_ai_job_id uuid,
  p_options jsonb,
  p_sections jsonb,
  p_insight_id uuid default null,
  p_regenerated_from_id uuid default null,
  p_title text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.current_uid();
  v_job public.ai_jobs%rowtype;
  v_draft public.drafts%rowtype;
  v_title text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  perform 1 from public.application_projects ap
   where ap.id = p_application_project_id and ap.user_id = v_uid
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'application_project_not_found';
  end if;

  select * into v_job from public.ai_jobs j where j.id = p_ai_job_id and j.user_id = v_uid;
  if not found or v_job.target_id is null
     or not private.career_description_job_matches(v_job, v_job.target_id, p_application_project_id) then
    raise exception using errcode = 'P0001', message = 'invalid_ai_job';
  end if;

  -- Same job already created its draft: idempotent; a manual retry (higher run_generation) reopens a failed one.
  select * into v_draft from public.drafts d where d.id = v_job.target_id for update;
  if found then
    if v_draft.user_id <> v_uid or v_draft.draft_type <> 'career_description'
       or v_draft.application_project_id <> p_application_project_id
       or v_draft.ai_job_id is distinct from p_ai_job_id then
      raise exception using errcode = 'P0001', message = 'invalid_ai_job';
    end if;
    if v_draft.status = 'failed' and v_job.status in ('queued', 'running')
       and coalesce(v_draft.run_generation, -1) < v_job.run_generation then
      update public.drafts d
         set status = 'generating', run_generation = v_job.run_generation
       where d.id = v_draft.id;
      update public.draft_sections s set status = 'pending' where s.draft_id = v_draft.id and s.status <> 'pending';
      return private.career_description_begin_json(v_draft.id, true);
    end if;
    return private.career_description_begin_json(v_draft.id, false);
  end if;

  if v_job.status not in ('queued', 'running') then
    raise exception using errcode = 'P0001', message = 'invalid_ai_job';
  end if;

  if not exists (select 1 from public.job_descriptions jd
                  where jd.application_project_id = p_application_project_id
                    and jd.extraction_status = 'succeeded') then
    raise exception using errcode = 'P0001', message = 'jd_not_extracted';
  end if;

  if not private.draft_options_valid(p_options)
     or not private.is_uuid_array(p_options -> 'included_project_ids', 200, false)
     or p_options ->> 'selection_origin' is null then
    raise exception using errcode = 'P0001', message = 'invalid_draft_options';
  end if;

  if not private.career_description_sections_valid(v_uid, p_sections) then
    raise exception using errcode = 'P0001', message = 'invalid_draft_sections';
  end if;

  if p_insight_id is not null
     and not exists (select 1 from public.insights i
                      where i.id = p_insight_id and i.user_id = v_uid
                        and i.application_project_id = p_application_project_id and i.status = 'ready') then
    raise exception using errcode = 'P0001', message = 'insight_not_found';
  end if;

  if p_regenerated_from_id is not null
     and not exists (select 1 from public.drafts d
                      where d.id = p_regenerated_from_id and d.user_id = v_uid
                        and d.application_project_id = p_application_project_id
                        and d.draft_type = 'career_description') then
    raise exception using errcode = 'P0001', message = 'draft_not_found';
  end if;

  v_title := private.draft_resolve_title(p_title, 'career_description');

  insert into public.drafts (id, user_id, application_project_id, insight_id, draft_type, title, status, options,
                             regenerated_from_id, ai_job_id, run_generation, provider, model_tier, connection_tier)
  values (v_job.target_id, v_uid, p_application_project_id, p_insight_id, 'career_description', v_title,
          'generating', p_options, p_regenerated_from_id, p_ai_job_id, v_job.run_generation, v_job.provider,
          v_job.model_tier, v_job.connection_tier);

  insert into public.draft_sections (user_id, draft_id, sort_order, section_kind, experience_id, education_id,
                                     heading, status)
  select v_uid, v_job.target_id, (t.o - 1)::integer, t.e ->> 'section_kind', (t.e ->> 'experience_id')::uuid,
         (t.e ->> 'education_id')::uuid, t.e ->> 'heading', 'pending'
    from jsonb_array_elements(p_sections) with ordinality as t (e, o);

  return private.career_description_begin_json(v_job.target_id, false);
end;
$$;

revoke all on function public.begin_career_description(uuid, uuid, jsonb, jsonb, uuid, uuid, text) from public, anon;
grant execute on function public.begin_career_description(uuid, uuid, jsonb, jsonb, uuid, uuid, text) to app_ai_writer;


-- ── complete_career_description ────────────────────────────────────────────
-- Stores a validated AI-03 result for the run (p_ai_job_id, p_run_generation) in one transaction: section blocks
-- (ai_content, header blocks filled by the server), section meta, evidence_links (owner_type 'draft_section',
-- item_key = block_id), draft ready + hashes + meta, application project last_activity_at.
-- Late runs -> {applied: false, reason: 'stale_run'} (same rule as complete_insight, QA-S6-01 included).
create or replace function public.complete_career_description(
  p_draft_id uuid,
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
  v_project_id uuid;
  v_draft public.drafts%rowtype;
  v_job public.ai_jobs%rowtype;
  v_meta jsonb;
  v_section jsonb;
  v_section_count integer;
  v_rows jsonb;
  v_count integer;
  v_now timestamptz := now();
  v_career_types constant text[] := array['profile', 'experience', 'education', 'project', 'project_detail',
                                          'achievement', 'skill'];
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
                 or (e ->> 'source_type' = 'project_detail' and e ->> 'source_field' = 'learnings')
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
$$;

revoke all on function public.complete_career_description(uuid, uuid, integer, jsonb) from public, anon;
grant execute on function public.complete_career_description(uuid, uuid, integer, jsonb) to app_ai_writer;


-- ── fail_career_description ────────────────────────────────────────────────
-- generating -> failed (draft + unfinished sections) only for p_ai_job_id's generating draft (true); else false.
-- No partial blocks are kept: a failed career description is retried as a whole (S7 [가정 2]).
create or replace function public.fail_career_description(p_draft_id uuid, p_ai_job_id uuid)
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
  if not exists (select 1 from public.drafts d
                  where d.id = p_draft_id and d.user_id = v_uid and d.draft_type = 'career_description') then
    raise exception using errcode = 'P0001', message = 'draft_not_found';
  end if;
  return private.career_description_mark_failed(p_draft_id, p_ai_job_id, false);
end;
$$;

revoke all on function public.fail_career_description(uuid, uuid) from public, anon;
grant execute on function public.fail_career_description(uuid, uuid) to app_ai_writer;
