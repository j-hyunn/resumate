-- DESTRUCTIVE: drops public RPCs begin_jd_extraction, apply_jd_extraction, fail_jd_extraction, update_failed_jd_raw_text, purge_unused_jd_preview_outputs and the 10-argument create_application_project (no data is lost, but old app code calling them breaks and they cannot be restored by a later push).
--
-- R17 alignment (2026-11-16), migration B of three (DM v4.16 §11.11 (3) #1–#11, decisions 4.24 #3·#9·#11–#14):
--   1. drop the extraction RPCs and private helpers (#3)
--   2. create_application_project: 9 arguments, no gate, name always decided, jd_no_sentences, 5-key return (#9)
--   3. update_jd_raw_text (new) + job_descriptions_guard (before C drops extraction_status) (#11)
--   4. evidence allow lists: insight = career 5 + jd_sentence, application_document = career 5 + user_note (#12)
--   5. insights: raw_text_hash payload, schema_version = 2, stale_run on a JD hash mismatch, jd_no_sentences (#13)
--   6. start_writing_chat params.insight_id / insight_item_key, document greeting 3 kinds, delete_account_data (#14)
-- Runs after A (…004800, raw_text_hash rename, trigger drop) and before C (…004820, table / column drops).

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Extraction RPCs and helpers (4.24 #3). private.jd_sids_valid stays until C (the jd_requirements CHECK uses it).
-- ---------------------------------------------------------------------------------------------------------------
drop function if exists public.begin_jd_extraction(uuid, uuid);
drop function if exists public.apply_jd_extraction(uuid, uuid, integer, jsonb, text, text);
drop function if exists public.fail_jd_extraction(uuid, uuid);
drop function if exists public.update_failed_jd_raw_text(uuid, text, text, jsonb);
drop function if exists public.purge_unused_jd_preview_outputs(timestamptz, integer);
drop function if exists private.jd_apply_extraction_result(uuid, public.job_descriptions,
  public.application_projects, uuid, jsonb, text, text);
drop function if exists private.jd_extraction_mark_failed(uuid, uuid, boolean);
drop function if exists private.jd_extraction_job_matches(public.ai_jobs, public.job_descriptions);
drop function if exists private.jd_extraction_result_valid(jsonb, integer);
drop function if exists private.jd_sids_exist(jsonb, integer, boolean);

-- ---------------------------------------------------------------------------------------------------------------
-- 2. create_application_project (DM §2.6.2, 4.24 #9)
-- ---------------------------------------------------------------------------------------------------------------
drop function if exists public.create_application_project(uuid, text, text, jsonb, text, text, text, date, text, uuid);
drop function if exists public.create_application_project(uuid, text, text, jsonb, text, text, text, date, text);

-- Returns {application_project_id, job_description_id, created, name, name_source}.
-- Name: p_name (user) -> otherwise always private.application_fallback_name(company, position, now())
-- ("{회사명} 자기소개서" user / "새 자기소개서 (YYYY-MM-DD)" default), whatever the key state (CF-A7, DM §11.11 #10).
-- No key_invalid / ai_consent_required gate (Q53-1 removed, 2.11.7 path ⑥ gone).
create function public.create_application_project(
  p_id uuid,
  p_raw_text text,
  p_raw_text_hash text,
  p_sentences jsonb,
  p_company_name text default null,
  p_position_title text default null,
  p_name text default null,
  p_deadline date default null,
  p_source_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := nullif(btrim(p_name), '');
  v_company text := nullif(btrim(p_company_name), '');
  v_position text := nullif(btrim(p_position_title), '');
  v_source_url text := nullif(btrim(p_source_url), '');
  v_name_source text;
  v_inserted uuid;
  v_owner uuid;
  v_jd_id uuid;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_id';
  end if;
  if p_raw_text is null or btrim(p_raw_text) = '' or char_length(p_raw_text) > 50000 then
    raise exception using errcode = 'P0001', message = 'invalid_raw_text';
  end if;
  if p_raw_text_hash is null or btrim(p_raw_text_hash) = '' or char_length(p_raw_text_hash) > 128 then
    raise exception using errcode = 'P0001', message = 'invalid_raw_text_hash';
  end if;
  if not private.jd_sentences_valid(p_sentences) then
    raise exception using errcode = 'P0001', message = 'invalid_sentences';
  end if;
  -- DM §2.6: a text that yields no sentence is refused at save time (not_a_jd is gone).
  if jsonb_array_length(p_sentences) < 1 then
    raise exception using errcode = 'P0001', message = 'jd_no_sentences';
  end if;
  if char_length(v_name) > 100 then
    raise exception using errcode = 'P0001', message = 'invalid_name';
  end if;
  if char_length(v_company) > 200 then
    raise exception using errcode = 'P0001', message = 'invalid_company_name';
  end if;
  if char_length(v_position) > 200 then
    raise exception using errcode = 'P0001', message = 'invalid_position_title';
  end if;
  if v_source_url is not null and (char_length(v_source_url) > 2048 or v_source_url !~* '^https?://') then
    raise exception using errcode = 'P0001', message = 'invalid_source_url';
  end if;

  if v_name is not null then
    v_name_source := 'user';
  else
    select f.name, f.name_source into v_name, v_name_source
      from private.application_fallback_name(v_company, v_position, now()) f;
  end if;

  insert into public.application_projects (id, user_id, name, name_source, deadline)
  values (p_id, v_uid, v_name, v_name_source, p_deadline)
  on conflict (id) do nothing
  returning id into v_inserted;

  if v_inserted is null then
    -- Retry with the same id (or someone else's id): the stored values, created false.
    select ap.user_id, ap.name, ap.name_source into v_owner, v_name, v_name_source
      from public.application_projects ap where ap.id = p_id;
    if v_owner is distinct from v_uid then
      raise exception using errcode = 'P0001', message = 'application_project_id_conflict';
    end if;
    select jd.id into v_jd_id from public.job_descriptions jd where jd.application_project_id = p_id;
    return jsonb_build_object(
      'application_project_id', p_id, 'job_description_id', v_jd_id, 'created', false,
      'name', v_name, 'name_source', v_name_source);
  end if;

  insert into public.job_descriptions (user_id, application_project_id, raw_text, raw_text_hash, sentences,
                                       company_name, company_name_source, position_title, position_title_source,
                                       source_url)
  values (v_uid, p_id, p_raw_text, btrim(p_raw_text_hash), p_sentences,
          v_company, case when v_company is not null then 'user' end,
          v_position, case when v_position is not null then 'user' end,
          v_source_url)
  returning id into v_jd_id;

  insert into public.application_stage_events (user_id, application_project_id, event_type, to_stage)
  values (v_uid, p_id, 'created', 'before_apply');

  return jsonb_build_object(
    'application_project_id', p_id, 'job_description_id', v_jd_id, 'created', true,
    'name', v_name, 'name_source', v_name_source);
end;
$$;

revoke all on function public.create_application_project(uuid, text, text, jsonb, text, text, text, date, text)
  from public, anon;
grant execute on function public.create_application_project(uuid, text, text, jsonb, text, text, text, date, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Raw text edit — any time (DM §2.6.1, JR-7, 4.24 #11)
-- ---------------------------------------------------------------------------------------------------------------

-- Raw text columns change only together with raw_text_edited_at (the only writer is update_jd_raw_text).
-- application_project_id, user_id, source_url never change. Replaces the extraction_status conditions, before C
-- drops that column.
create or replace function private.job_descriptions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_text_changed boolean := new.raw_text is distinct from old.raw_text
                            or new.raw_text_hash is distinct from old.raw_text_hash
                            or new.sentences is distinct from old.sentences;
  v_stamp_changed boolean := new.raw_text_edited_at is distinct from old.raw_text_edited_at;
begin
  if new.application_project_id is distinct from old.application_project_id
     or new.user_id is distinct from old.user_id
     or new.source_url is distinct from old.source_url then
    raise exception using errcode = 'P0001', message = 'job_description_immutable';
  end if;

  if (v_text_changed or v_stamp_changed)
     and not (v_text_changed and v_stamp_changed and new.raw_text_edited_at is not null) then
    raise exception using errcode = 'P0001', message = 'job_description_immutable';
  end if;

  return new;
end;
$$;

-- Returns {application_project_id, job_description_id, raw_text_edited_at}.
-- Order (DM §2.6.1): 0 session → 1 arguments / ≥ 1 sentence → 2 mine (lock projects → JD) → 3 no queued / running
-- insight job → 4 text changed. Existing insights and their evidence stay (they show as stale via raw_text_hash).
create function public.update_jd_raw_text(
  p_application_project_id uuid,
  p_raw_text text,
  p_raw_text_hash text,
  p_sentences jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_jd public.job_descriptions%rowtype;
  -- clock_timestamp: two edits in one transaction still move raw_text_edited_at (the guard trigger requires it).
  v_now timestamptz := clock_timestamp();
begin
  -- 0
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  -- 1
  if p_raw_text is null or btrim(p_raw_text) = '' or char_length(p_raw_text) > 50000 then
    raise exception using errcode = 'P0001', message = 'invalid_raw_text';
  end if;
  if p_raw_text_hash is null or btrim(p_raw_text_hash) = '' or char_length(p_raw_text_hash) > 128 then
    raise exception using errcode = 'P0001', message = 'invalid_raw_text_hash';
  end if;
  if not private.jd_sentences_valid(p_sentences) then
    raise exception using errcode = 'P0001', message = 'invalid_sentences';
  end if;
  if jsonb_array_length(p_sentences) < 1 then
    raise exception using errcode = 'P0001', message = 'jd_no_sentences';
  end if;

  -- 2 (lock order: application_projects -> job_descriptions)
  perform 1 from public.application_projects ap
   where ap.id = p_application_project_id and ap.user_id = v_uid
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'job_description_not_found';
  end if;
  select * into v_jd from public.job_descriptions jd
   where jd.application_project_id = p_application_project_id and jd.user_id = v_uid
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'job_description_not_found';
  end if;

  -- 3: only an insight run blocks (a cover letter turn does not read the posting, JR-5).
  if exists (select 1 from public.ai_jobs j
              where j.application_project_id = p_application_project_id and j.user_id = v_uid
                and j.job_type = 'insight' and j.status in ('queued', 'running')) then
    raise exception using errcode = 'P0001', message = 'jd_job_in_progress';
  end if;

  -- 4: the server sends normalized text; leading / trailing whitespace is ignored like the previous RPC
  --    (`[가정 R17b-db-3]`).
  if regexp_replace(p_raw_text, '^\s+|\s+$', '', 'g') = regexp_replace(v_jd.raw_text, '^\s+|\s+$', '', 'g') then
    raise exception using errcode = 'P0001', message = 'jd_raw_text_unchanged';
  end if;

  update public.job_descriptions jd
     set raw_text = p_raw_text,
         raw_text_hash = btrim(p_raw_text_hash),
         sentences = p_sentences,
         raw_text_edited_at = v_now
   where jd.id = v_jd.id;

  update public.application_projects ap set last_activity_at = v_now where ap.id = p_application_project_id;

  return jsonb_build_object(
    'application_project_id', p_application_project_id,
    'job_description_id', v_jd.id,
    'raw_text_edited_at', v_now);
end;
$$;

revoke all on function public.update_jd_raw_text(uuid, text, text, jsonb) from public, anon, service_role;
grant execute on function public.update_jd_raw_text(uuid, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Evidence allow lists (DM §2.8, JR-Q1 (a)·JR-5, 4.24 #12)
--    save_application_document, private.doc_evidence_row, private.wc_patch_document → wc_doc_sources /
--    wc_document_block → wc_doc_evidence all take their list from evidence_allowed_sources('application_document'),
--    so a JD source in a document save or proposal patch is now refused there too (invalid_evidence_source /
--    invalid_patch). doc_proposal_sources and doc_replace_slot_evidence only pass rows the save RPC already checked.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.evidence_allowed_sources(p_owner_type text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  -- (v4.12, SD-A19) career sources of a new row: 5 values, profile is gone.
  select case p_owner_type
    -- (v4.16, JR-Q1 (a)) the only JD source is the raw sentence, and only on insights.
    when 'insight' then array['experience', 'education', 'project', 'project_deliverable', 'skill', 'jd_sentence']
    -- (v4.16, JR-5) the posting feeds the insight only; a cover letter cites career data and its own note.
    when 'application_document' then array['experience', 'education', 'project', 'project_deliverable', 'skill',
                                           'user_note']
  end;
$$;

create or replace function private.evidence_links_check_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed text[];
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

  -- R15 (CL-3·CL-5): the drafts tables are gone from the design; no new row may hang off a draft section.
  if new.owner_type = 'draft_section' then
    raise exception using errcode = 'P0001', message = 'invalid_evidence_source',
      detail = 'draft_section is not an evidence owner (v4.13)';
  end if;

  -- Per-owner allowed sources (DM §2.8 — the same list save_application_document uses).
  v_allowed := private.evidence_allowed_sources(new.owner_type);
  if v_allowed is not null and not (new.source_type = any (v_allowed)) then
    raise exception using errcode = 'P0001', message = 'invalid_evidence_source',
      detail = new.source_type || ' is not an allowed source of ' || new.owner_type;
  end if;

  -- R17 (v4.16): the jd_requirement branch is gone (C removes the value from the CHECK), and so is the CF-S1
  -- slot-level jd_sentence exception — that was for cover letter `{slot}.sources.{n}` rows, which no longer cite
  -- the posting. An insight's jd_sentence row always points at a range inside one sentence.
  if new.source_type = 'jd_sentence' then
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

  elsif new.source_type = 'user_note' then
    -- R15 (CL-5·CL-8, AI 요청 4): source_id = application_documents.body -> questions[].question_id, a uuid inside
    -- jsonb. A trigger cannot tell "the question is gone", so save_application_document judges that and the
    -- "원본 삭제됨" marking; here only the shape is checked and the row is taken as live.
    v_exists := true;

  elsif new.source_type = 'project' then
    -- R4 (DM v4.4 §2.8, AI V-2 DB defense): the field must fit the project kind.
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
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Insights (DM §2.7.0, 4.24 #13)
-- ---------------------------------------------------------------------------------------------------------------

-- hashes = {raw_text_hash, career_snapshot_hash, input_hash}; meta.schema_version must be 2 (the R17 result shape;
-- 1 is the old requirement-list shape, never written again); evidence sources = insight allow list.
create or replace function private.insight_payload_valid(p_payload jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
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
  foreach v_key in array array['raw_text_hash', 'career_snapshot_hash', 'input_hash'] loop
    if jsonb_typeof(v_hashes -> v_key) is distinct from 'string'
       or char_length(btrim(v_hashes ->> v_key)) not between 1 and 128 then
      return false;
    end if;
  end loop;

  v_meta := p_payload -> 'meta';
  if jsonb_typeof(v_meta -> 'schema_version') is distinct from 'number'
     or (v_meta ->> 'schema_version') <> '2'
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
       or not (coalesce(v_ev ->> 'source_type', '') = any (private.evidence_allowed_sources('insight')))
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
$$;

create or replace function public.complete_insight(p_insight_id uuid, p_ai_job_id uuid, p_run_generation integer,
                                                   p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.current_uid();
  v_project_id uuid;
  v_insight public.insights%rowtype;
  v_job public.ai_jobs%rowtype;
  v_meta jsonb;
  v_hashes jsonb;
  v_jd_hash text;
  v_prev uuid;
  v_count integer;
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  -- Lock order: application_projects -> insights -> job_descriptions (update_jd_raw_text: projects -> JD).
  select i.application_project_id into v_project_id
    from public.insights i where i.id = p_insight_id and i.user_id = v_uid;
  perform 1 from public.application_projects ap where ap.id = v_project_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'insight_not_found';
  end if;
  select * into v_insight from public.insights i where i.id = p_insight_id and i.user_id = v_uid for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'insight_not_found';
  end if;

  select * into v_job from public.ai_jobs j where j.id = p_ai_job_id and j.user_id = v_uid;
  if not found or v_insight.ai_job_id is distinct from p_ai_job_id
     or not private.insight_job_matches(v_job, v_insight.application_project_id) then
    raise exception using errcode = 'P0001', message = 'invalid_ai_job';
  end if;

  if v_job.status <> 'running' or v_job.run_generation is distinct from p_run_generation
     or not (v_insight.status = 'generating'
             or (v_insight.status = 'failed' and coalesce(v_insight.run_generation, -1) < p_run_generation)) then
    return jsonb_build_object('applied', false, 'reason', 'stale_run');
  end if;

  if not private.insight_payload_valid(p_payload) then
    raise exception using errcode = 'P0001', message = 'invalid_insight_payload';
  end if;

  v_meta := p_payload -> 'meta';
  v_hashes := p_payload -> 'hashes';
  if v_meta ->> 'provider' is distinct from v_job.provider
     or v_meta ->> 'model_tier' is distinct from v_job.model_tier
     or v_meta ->> 'connection_tier' is distinct from v_job.connection_tier
     or char_length(btrim(v_meta ->> 'model')) not between 1 and 200 then
    raise exception using errcode = 'P0001', message = 'invalid_ai_metadata';
  end if;

  -- DM §2.6.1 narrow-gap defense: the posting changed after prepare read it -> stale_run (the runner cancels the
  -- job; no new error_code).
  select jd.raw_text_hash into v_jd_hash from public.job_descriptions jd
   where jd.application_project_id = v_insight.application_project_id and jd.user_id = v_uid
     for update;
  if v_jd_hash is distinct from btrim(v_hashes ->> 'raw_text_hash') then
    return jsonb_build_object('applied', false, 'reason', 'stale_run');
  end if;

  begin
    insert into public.evidence_links (user_id, application_project_id, owner_type, owner_id, item_key, sort_order,
                                       source_type, source_id, source_locator, source_field, quote, quote_adjusted,
                                       source_snapshot_at, source_label)
    select v_uid, v_insight.application_project_id, 'insight', p_insight_id, btrim(e ->> 'item_key'),
           (e ->> 'sort_order')::integer, e ->> 'source_type', (e ->> 'source_id')::uuid,
           case when jsonb_typeof(e -> 'source_locator') = 'object' then e -> 'source_locator' end,
           e ->> 'source_field', e ->> 'quote', coalesce((e ->> 'quote_adjusted')::boolean, false),
           coalesce((e ->> 'source_snapshot_at')::timestamptz, v_now), e ->> 'source_label'
      from jsonb_array_elements(p_payload -> 'evidence') e;
    get diagnostics v_count = row_count;
  exception
    when check_violation or invalid_text_representation or invalid_datetime_format
         or datetime_field_overflow or numeric_value_out_of_range then
      raise exception using errcode = 'P0001', message = 'invalid_insight_payload';
  end;

  select i.id into v_prev from public.insights i
   where i.application_project_id = v_insight.application_project_id and i.is_latest;
  if v_prev is not null then
    update public.insights i set is_latest = false where i.id = v_prev;
  end if;

  update public.insights i
     set status = 'ready',
         is_latest = true,
         result = p_payload -> 'result',
         match_stage_result = p_payload -> 'match_stage_result',
         raw_text_hash = btrim(v_hashes ->> 'raw_text_hash'),
         career_snapshot_hash = btrim(v_hashes ->> 'career_snapshot_hash'),
         input_hash = btrim(v_hashes ->> 'input_hash'),
         schema_version = 2,
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
   where i.id = p_insight_id;

  update public.application_projects ap set last_activity_at = v_now where ap.id = v_insight.application_project_id;

  return jsonb_build_object(
    'applied', true,
    'insight_id', p_insight_id,
    'application_project_id', v_insight.application_project_id,
    'version_no', v_insight.version_no,
    'status', 'ready',
    'is_latest', true,
    'previous_latest_id', v_prev,
    'evidence_count', v_count,
    'completed_at', v_now);
end;
$$;

-- jd_not_extracted is gone; a posting with 0 sentences -> jd_no_sentences (DM §2.6, §2.7.0). A project without a
-- JD row (not reachable through the RPCs) keeps job_description_not_found.
create or replace function public.begin_insight(p_application_project_id uuid, p_ai_job_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.current_uid();
  v_job public.ai_jobs%rowtype;
  v_id uuid;
  v_status text;
  v_row_generation integer;
  v_version integer;
  v_sentence_count integer;
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
  if not found or not private.insight_job_matches(v_job, p_application_project_id) then
    raise exception using errcode = 'P0001', message = 'invalid_ai_job';
  end if;

  select i.id, i.status, i.run_generation into v_id, v_status, v_row_generation
    from public.insights i where i.ai_job_id = p_ai_job_id and i.user_id = v_uid
     for update;
  if found then
    -- QA-S6-01: a manual retry requeues the same job with a higher run_generation; reopen the failed row.
    if v_status = 'failed' and v_job.status in ('queued', 'running')
       and coalesce(v_row_generation, -1) < v_job.run_generation then
      update public.insights i
         set status = 'generating', run_generation = v_job.run_generation
       where i.id = v_id;
    end if;
    return v_id;
  end if;

  if v_job.status not in ('queued', 'running') then
    raise exception using errcode = 'P0001', message = 'invalid_ai_job';
  end if;

  select jsonb_array_length(jd.sentences) into v_sentence_count
    from public.job_descriptions jd
   where jd.application_project_id = p_application_project_id and jd.user_id = v_uid;
  if not found then
    raise exception using errcode = 'P0001', message = 'job_description_not_found';
  end if;
  if v_sentence_count < 1 then
    raise exception using errcode = 'P0001', message = 'jd_no_sentences';
  end if;

  if exists (select 1 from public.insights i
               join public.ai_jobs j on j.id = i.ai_job_id
              where i.application_project_id = p_application_project_id
                and i.status = 'generating'
                and j.status in ('queued', 'running')) then
    raise exception using errcode = 'P0001', message = 'insight_in_progress';
  end if;

  update public.insights i
     set status = 'failed'
   where i.application_project_id = p_application_project_id and i.status = 'generating';

  select coalesce(max(i.version_no), 0) + 1 into v_version
    from public.insights i where i.application_project_id = p_application_project_id;

  insert into public.insights (user_id, application_project_id, version_no, status, ai_job_id, run_generation,
                               provider, model_tier, connection_tier)
  values (v_uid, p_application_project_id, v_version, 'generating', p_ai_job_id, v_job.run_generation,
          v_job.provider, v_job.model_tier, v_job.connection_tier)
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 6a. Document chat greeting: 3 kinds (no body / partly filled / all filled) — the "요건 정리 전" branch and its
--     p_requirements_ready argument are gone (DM §11.11 #8, 4.24 #14).
-- ---------------------------------------------------------------------------------------------------------------
create function private.writing_chat_document_greeting(p_slot_count integer, p_filled_count integer,
                                                       p_free_tier boolean)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_body text;
begin
  if coalesce(p_slot_count, 0) = 0 or coalesce(p_filled_count, 0) = 0 then
    v_body := '자기소개서 문항에 답할 내용을 함께 정리해 볼게요. 어떤 경험을 쓰고 싶으신지 알려 주시거나, '
              || '아래 버튼으로 초안부터 받아 보세요.';
  elsif p_filled_count < p_slot_count then
    v_body := '지금 쓰신 답변을 바탕으로 남은 문항을 채워 볼게요. 먼저 손보고 싶은 문항이 있으면 알려 주세요.';
  else
    v_body := '문항을 모두 채우셨네요. 더 다듬고 싶은 문항이나 보강할 내용을 알려 주시면 함께 고쳐 볼게요.';
  end if;

  return v_body
    || E'\n\n'
    || '회사 기밀, 민감정보, 다른 사람의 개인정보는 쓰지 말아 주세요.'
    || case when p_free_tier
         then ' 무료 등급에서는 입력한 내용이 Google 제품 개선에 쓰이고 사람이 검토할 수 있어요. 민감정보·회사 기밀은 쓰지 마세요.'
         else '' end;
end;
$$;

revoke all on function private.writing_chat_document_greeting(integer, integer, boolean) from public;

create or replace function public.start_document_writing_chat(p_application_project_id uuid, p_document_kind text,
                                                              p_form_snapshot jsonb default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_snap jsonb;
  v_questions jsonb;
  v_q jsonb;
  v_slot_count integer := 0;
  v_filled integer := 0;
  v_chat_id uuid;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_document_kind is distinct from 'cover_letter' then
    raise exception using errcode = 'P0001', message = 'invalid_fields', detail = 'document_kind';
  end if;
  if not exists (select 1 from public.application_projects ap
                  where ap.id = p_application_project_id and ap.user_id = v_uid) then
    raise exception using errcode = 'P0001', message = 'application_project_not_found';
  end if;

  v_snap := nullif(p_form_snapshot, 'null'::jsonb);
  if v_snap is not null then
    v_questions := nullif(v_snap -> 'questions', 'null'::jsonb);
    if jsonb_typeof(v_snap) <> 'object'
       or (v_questions is not null and jsonb_typeof(v_questions) <> 'array')
       or coalesce(jsonb_array_length(v_questions), 0) > 20 then
      raise exception using errcode = 'P0001', message = 'invalid_form_snapshot';
    end if;
    for v_q in select e from jsonb_array_elements(coalesce(v_questions, '[]'::jsonb)) e loop
      if jsonb_typeof(v_q) <> 'object'
         or coalesce(v_q ->> 'slot', '') !~ '^q_[0-9]{1,3}$'
         or coalesce(jsonb_typeof(v_q -> 'question_text'), 'null') not in ('string', 'null')
         or char_length(v_q ->> 'question_text') > 1000
         or coalesce(jsonb_typeof(v_q -> 'answer_title'), 'null') not in ('string', 'null')
         or char_length(v_q ->> 'answer_title') > 100
         or coalesce(jsonb_typeof(v_q -> 'user_note'), 'null') not in ('string', 'null')
         or char_length(v_q ->> 'user_note') > 300
         or coalesce(jsonb_typeof(v_q -> 'body'), 'null') not in ('string', 'null')
         or char_length(v_q ->> 'body') > 8000
         or coalesce(jsonb_typeof(v_q -> 'char_limit'), 'null') not in ('number', 'null')
         or coalesce(jsonb_typeof(v_q -> 'count_basis'), 'null') not in ('string', 'null') then
        raise exception using errcode = 'P0001', message = 'invalid_form_snapshot';
      end if;
    end loop;
    v_slot_count := coalesce(jsonb_array_length(v_questions), 0);
    select count(*)::integer into v_filled
      from jsonb_array_elements(coalesce(v_questions, '[]'::jsonb)) e
     where nullif(btrim(coalesce(e ->> 'body', '')), '') is not null;
  else
    select d.slot_count,
           (select count(*)::integer from jsonb_array_elements(coalesce(d.body -> 'questions', '[]'::jsonb)) e
             where nullif(btrim(coalesce(e ->> 'body', '')), '') is not null)
      into v_slot_count, v_filled
      from public.application_documents d
     where d.application_project_id = p_application_project_id and d.document_kind = p_document_kind
       and d.user_id = v_uid;
    v_slot_count := coalesce(v_slot_count, 0);
    v_filled := coalesce(v_filled, 0);
  end if;

  insert into public.writing_chats (user_id, project_id, application_project_id, document_kind, structured_draft,
                                    message_count, return_target)
  values (v_uid, null, p_application_project_id, p_document_kind,
          private.writing_chat_empty_document_draft(p_document_kind), 0, null)
  returning id into v_chat_id;

  insert into public.writing_chat_messages (user_id, writing_chat_id, sequence, role, content, status)
  values (v_uid, v_chat_id, 1, 'assistant',
          private.writing_chat_document_greeting(v_slot_count, v_filled, private.writing_chat_free_tier(v_uid)),
          'done');

  return v_chat_id;
end;
$$;

drop function private.writing_chat_document_greeting(boolean, integer, integer, boolean);

-- ---------------------------------------------------------------------------------------------------------------
-- 6b. start_writing_chat: an AI-12 gate opened from an insight gap carries params.insight_id / insight_item_key
--     (DM §2.7.0, JR-5). Shape and ownership are checked; everything else is unchanged.
--     `[가정 R17b-db-4]` insight_item_key needs insight_id; insight_id alone is accepted (AI then reads that insight's
--     gaps[]). Neither key depends on return_target.feature.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.start_writing_chat(p_project_id uuid, p_return_target jsonb default null,
                                                     p_form_snapshot jsonb default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_star constant text[] := array['situation', 'task', 'action', 'result', 'learnings'];
  c_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_uid uuid := auth.uid();
  v_project public.projects%rowtype;
  v_return_target jsonb;
  v_params jsonb;
  v_snap jsonb;
  v_star jsonb;
  v_field text;
  v_chat_id uuid;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  select * into v_project from public.projects p where p.id = p_project_id and p.user_id = v_uid;
  if not found then
    raise exception using errcode = 'P0001', message = 'project_not_found';
  end if;
  if num_nonnulls(v_project.experience_id, v_project.education_id) = 0 then
    raise exception using errcode = 'P0001', message = 'writing_chat_requires_affiliated_project';
  end if;

  if p_return_target is not null and jsonb_typeof(p_return_target) <> 'null' then
    if jsonb_typeof(p_return_target) <> 'object'
       -- R15 (CF-1): insight / cover_letter only.
       or coalesce(p_return_target ->> 'feature', '') not in ('insight', 'cover_letter')
       or jsonb_typeof(p_return_target -> 'application_project_id') is distinct from 'string'
       or (p_return_target ->> 'application_project_id') !~* c_uuid_re
       or coalesce(jsonb_typeof(p_return_target -> 'params'), 'object') not in ('object', 'null') then
      raise exception using errcode = 'P0001', message = 'invalid_return_target';
    end if;
    v_params := coalesce(nullif(p_return_target -> 'params', 'null'::jsonb), '{}'::jsonb);

    -- R17 (JR-5): the gap the gate was opened from.
    if v_params ? 'insight_id' or v_params ? 'insight_item_key' then
      if jsonb_typeof(v_params -> 'insight_id') is distinct from 'string'
         or (v_params ->> 'insight_id') !~* c_uuid_re
         or (v_params ? 'insight_item_key'
             and (jsonb_typeof(v_params -> 'insight_item_key') is distinct from 'string'
                  or (v_params ->> 'insight_item_key') !~ '^gaps\.[0-9]{1,2}$')) then
        raise exception using errcode = 'P0001', message = 'invalid_return_target';
      end if;
      if not exists (select 1 from public.insights i
                         where i.id = (v_params ->> 'insight_id')::uuid
                           and i.user_id = v_uid
                           and i.application_project_id = (p_return_target ->> 'application_project_id')::uuid) then
        raise exception using errcode = 'P0001', message = 'invalid_return_target';
      end if;
    end if;

    v_return_target := jsonb_build_object(
      'application_project_id', lower(p_return_target ->> 'application_project_id'),
      'feature', p_return_target ->> 'feature',
      'params', v_params,
      'created_at', to_jsonb(now()));
  end if;

  -- Greeting input: snapshot values win over saved ones (리더 정렬 2). Local copy only.
  v_snap := nullif(p_form_snapshot, 'null'::jsonb);
  if v_snap is not null then
    v_star := nullif(v_snap -> 'star', 'null'::jsonb);
    if jsonb_typeof(v_snap) <> 'object'
       or coalesce(jsonb_typeof(v_snap -> 'name'), 'null') not in ('string', 'null')
       or char_length(v_snap ->> 'name') > 100
       or (v_star is not null and jsonb_typeof(v_star) <> 'object') then
      raise exception using errcode = 'P0001', message = 'invalid_form_snapshot';
    end if;
    if nullif(btrim(v_snap ->> 'name'), '') is not null then
      v_project.name := v_snap ->> 'name';
    end if;
    if v_star is not null then
      foreach v_field in array c_star loop
        if v_star ? v_field then
          if coalesce(jsonb_typeof(v_star -> v_field), 'null') not in ('string', 'null')
             or char_length(v_star ->> v_field) > 2000 then
            raise exception using errcode = 'P0001', message = 'invalid_form_snapshot';
          end if;
          case v_field
            when 'situation' then v_project.situation := v_star ->> v_field;
            when 'task' then v_project.task := v_star ->> v_field;
            when 'action' then v_project.action := v_star ->> v_field;
            when 'result' then v_project.result := v_star ->> v_field;
            when 'learnings' then v_project.learnings := v_star ->> v_field;
          end case;
        end if;
      end loop;
    end if;
  end if;

  insert into public.writing_chats (user_id, project_id, structured_draft, message_count, return_target)
  values (v_uid, p_project_id, private.writing_chat_empty_draft(), 0, v_return_target)
  returning id into v_chat_id;

  insert into public.writing_chat_messages (user_id, writing_chat_id, sequence, role, content, status)
  values (v_uid, v_chat_id, 1, 'assistant',
          private.writing_chat_greeting(v_project, v_return_target ->> 'feature', private.writing_chat_free_tier(v_uid)),
          'done');

  return v_chat_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 6c. delete_account_data: the jd_requirements sweep goes with the table (C). Body otherwise unchanged.
-- ---------------------------------------------------------------------------------------------------------------
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
  --    job_descriptions, insights, application_documents,
  --    application_stage_events, evidence_links and project-scoped ai_jobs.
  perform 1 from public.application_projects ap where ap.user_id = p_uid order by ap.id for update;
  delete from public.application_projects t where t.user_id = p_uid;

  -- Sweep anything of the application area that did not hang off a project (all should be gone already).
  delete from public.evidence_links t where t.user_id = p_uid;
  delete from public.application_documents t where t.user_id = p_uid;
  delete from public.insights t where t.user_id = p_uid;
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
$function$

;
