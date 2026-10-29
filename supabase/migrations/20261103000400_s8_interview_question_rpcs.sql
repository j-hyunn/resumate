-- S8 interview question generation RPCs (AI-05; DM A.12 / A.13, §2.8, AI C-3 storage, C-6). app_ai_writer only,
-- security definer with an owner check through private.current_uid() (JWT sub). The job runner calls:
--   begin_interview_questions -> (AI-05 stream) -> save_interview_question per finished question ->
--   complete_interview_questions | fail_interview_questions, then complete_ai_job (complete first; stale_run means:
--   don't complete the job).
-- Job shape: job_type 'interview_questions', target_type 'interview_session', target_id = session id,
-- application_project_id = the session's project. One in-flight job per session (ai_jobs_in_flight_target_key).
-- Lock order: application_projects -> interview_sessions (S6 / S7). The ai_jobs end trigger takes both SKIP LOCKED.
-- Errors: 42501 not_authenticated; P0001 interview_session_not_found, invalid_ai_job, jd_not_extracted,
-- interview_not_in_progress, interview_questions_ready, interview_generation_in_progress, invalid_ai_metadata,
-- invalid_interview_payload, invalid_evidence_source, interview_questions_incomplete.

-- ── shared helpers (also used by the evaluation RPCs) ───────────────────────

-- Locks (project, session) of the caller's session in the standard order. interview_session_not_found otherwise.
create or replace function private.interview_lock_session(p_session_id uuid, p_uid uuid)
returns public.interview_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_session public.interview_sessions%rowtype;
begin
  select s.application_project_id into v_project_id
    from public.interview_sessions s where s.id = p_session_id and s.user_id = p_uid;
  perform 1 from public.application_projects ap where ap.id = v_project_id for update;
  select * into v_session from public.interview_sessions s
   where s.id = p_session_id and s.user_id = p_uid
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'interview_session_not_found';
  end if;
  return v_session;
end;
$$;

revoke all on function private.interview_lock_session(uuid, uuid) from public;

-- Is p_job a p_job_type job of session p_session?
create or replace function private.interview_job_matches(p_job public.ai_jobs, p_session public.interview_sessions,
                                                         p_job_type text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_job.id is not null
     and p_job.job_type = p_job_type
     and p_job.target_type = 'interview_session'
     and p_job.target_id = p_session.id
     and p_job.application_project_id is not distinct from p_session.application_project_id;
$$;

revoke all on function private.interview_job_matches(public.ai_jobs, public.interview_sessions, text) from public;

-- queued / running job?
create or replace function private.interview_job_live(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.ai_jobs j where j.id = p_job_id and j.status in ('queued', 'running'));
$$;

revoke all on function private.interview_job_live(uuid) from public;

-- uuid array (missing / null = empty), at most p_max, no duplicates, each a requirement of p_project_id's JD.
create or replace function private.interview_requirement_ids_valid(p_project_id uuid, p_ids jsonb, p_max integer)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_uuid_array(p_ids, p_max, true) then
    return false;
  end if;
  if p_ids is null or jsonb_typeof(p_ids) = 'null' then
    return true;
  end if;
  if (select count(distinct lower(x)) from jsonb_array_elements_text(p_ids) x) <> jsonb_array_length(p_ids) then
    return false;
  end if;
  return not exists (
    select 1 from jsonb_array_elements_text(p_ids) x
     where not exists (select 1 from public.jd_requirements r
                         join public.job_descriptions jd on jd.id = r.job_description_id
                        where r.id = x::uuid and jd.application_project_id = p_project_id));
end;
$$;

revoke all on function private.interview_requirement_ids_valid(uuid, jsonb, integer) from public;

-- jsonb uuid array (missing / null = empty) -> uuid[].
create or replace function private.interview_uuid_array(p_ids jsonb)
returns uuid[]
language sql
immutable
set search_path = ''
as $$
  select case when p_ids is null or jsonb_typeof(p_ids) <> 'array' then '{}'::uuid[]
              else coalesce((select array_agg(x::uuid order by o)
                               from jsonb_array_elements_text(p_ids) with ordinality as t (x, o)), '{}') end;
$$;

revoke all on function private.interview_uuid_array(jsonb) from public;

-- Every evidence element has the S6 shape and a source type from p_types.
create or replace function private.interview_evidence_valid(p_evidence jsonb, p_types text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_evidence) = 'array'
     and jsonb_array_length(p_evidence) <= 2000
     and not exists (select 1 from jsonb_array_elements(p_evidence) e
                      where not private.draft_evidence_elem_valid(e, p_types));
$$;

revoke all on function private.interview_evidence_valid(jsonb, text[]) from public;

-- Inserts evidence rows of one owner. Value errors (bad timestamp, C-3 field CHECK) -> invalid_interview_payload; the
-- source guard's invalid_evidence_source propagates as is.
create or replace function private.interview_insert_evidence(p_uid uuid, p_application_project_id uuid,
                                                             p_owner_type text, p_owner_id uuid, p_evidence jsonb)
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
    select p_uid, p_application_project_id, p_owner_type, p_owner_id, btrim(e ->> 'item_key'),
           (e ->> 'sort_order')::integer, e ->> 'source_type', (e ->> 'source_id')::uuid,
           case when jsonb_typeof(e -> 'source_locator') = 'object' then e -> 'source_locator' end,
           e ->> 'source_field', e ->> 'quote', coalesce((e ->> 'quote_adjusted')::boolean, false),
           coalesce((e ->> 'source_snapshot_at')::timestamptz, v_now), e ->> 'source_label'
      from jsonb_array_elements(coalesce(p_evidence, '[]'::jsonb)) e;
    get diagnostics v_count = row_count;
  exception
    when check_violation or invalid_text_representation or invalid_datetime_format
         or datetime_field_overflow or numeric_value_out_of_range then
      raise exception using errcode = 'P0001', message = 'invalid_interview_payload';
  end;
  return v_count;
end;
$$;

revoke all on function private.interview_insert_evidence(uuid, uuid, text, uuid, jsonb) from public;

-- generating -> failed for (session, question job), stamped with the job's current run_generation so the same run
-- never reopens it. Saved questions and their blank answers stay (AI-05 "저장된 질문을 유지", D-36).
-- p_skip_locked (end trigger path, QA-S5-06): take project and session without waiting, else do nothing.
create or replace function private.interview_questions_mark_failed(p_session_id uuid, p_ai_job_id uuid,
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
  select s.application_project_id into v_project_id from public.interview_sessions s where s.id = p_session_id;
  if not found then
    return false;
  end if;

  if p_skip_locked then
    perform 1 from public.application_projects ap where ap.id = v_project_id for update skip locked;
    if not found then
      return false;
    end if;
    perform 1 from public.interview_sessions s where s.id = p_session_id for update skip locked;
  else
    perform 1 from public.application_projects ap where ap.id = v_project_id for update;
    if not found then
      return false;
    end if;
    perform 1 from public.interview_sessions s where s.id = p_session_id for update;
  end if;
  if not found then
    return false;
  end if;

  select j.run_generation into v_generation from public.ai_jobs j where j.id = p_ai_job_id;

  update public.interview_sessions s
     set generation_status = 'failed',
         question_run_generation = coalesce(v_generation, s.question_run_generation)
   where s.id = p_session_id and s.generation_status = 'generating' and s.question_job_id = p_ai_job_id;
  return found;
end;
$$;

revoke all on function private.interview_questions_mark_failed(uuid, uuid, boolean) from public;

-- begin_interview_questions' return shape.
create or replace function private.interview_questions_begin_json(p_session_id uuid, p_reopened boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'session_id', s.id, 'application_project_id', s.application_project_id, 'interview_type', s.interview_type,
    'question_count', s.question_count, 'data_sufficiency', s.data_sufficiency,
    'generation_status', s.generation_status, 'reopened', p_reopened,
    'saved_count', (select count(*) from public.interview_questions q where q.session_id = s.id),
    'remaining', s.question_count - (select count(*) from public.interview_questions q where q.session_id = s.id),
    'next_sequence', (select min(g) from generate_series(1, s.question_count) g
                       where not exists (select 1 from public.interview_questions q
                                          where q.session_id = s.id and q.sequence = g)),
    'existing_questions', coalesce((select jsonb_agg(jsonb_build_object(
        'question_id', q.id, 'sequence', q.sequence, 'source_kind', q.source_kind, 'anchor', q.anchor,
        'question_text', q.question_text, 'target_requirement_ids', to_jsonb(q.target_requirement_ids),
        'target_gap_requirement_ids', to_jsonb(q.target_gap_requirement_ids)) order by q.sequence)
        from public.interview_questions q where q.session_id = s.id), '[]'::jsonb))
    from public.interview_sessions s where s.id = p_session_id;
$$;

revoke all on function private.interview_questions_begin_json(uuid, boolean) from public;

-- save / complete run check for question generation: 'ok', 'reopen' (failed in an earlier run of this job, QA-S6-01)
-- or 'stale'.
create or replace function private.interview_questions_run_state(p_session public.interview_sessions,
                                                                  p_job public.ai_jobs, p_run_generation integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_job.status <> 'running' or p_job.run_generation is distinct from p_run_generation then 'stale'
    when p_session.status <> 'in_progress' or p_session.question_job_id is distinct from p_job.id then 'stale'
    when p_session.generation_status = 'generating' then 'ok'
    when p_session.generation_status = 'failed'
         and coalesce(p_session.question_run_generation, -1) < p_run_generation then 'reopen'
    else 'stale'
  end;
$$;

revoke all on function private.interview_questions_run_state(public.interview_sessions, public.ai_jobs, integer)
  from public;


-- ── begin_interview_questions ──────────────────────────────────────────────
create or replace function public.begin_interview_questions(p_session_id uuid, p_ai_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.current_uid();
  v_session public.interview_sessions%rowtype;
  v_job public.ai_jobs%rowtype;
  v_reopened boolean;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  v_session := private.interview_lock_session(p_session_id, v_uid);

  select * into v_job from public.ai_jobs j where j.id = p_ai_job_id and j.user_id = v_uid;
  if not found or not private.interview_job_matches(v_job, v_session, 'interview_questions') then
    raise exception using errcode = 'P0001', message = 'invalid_ai_job';
  end if;

  if v_session.status <> 'in_progress' then
    raise exception using errcode = 'P0001', message = 'interview_not_in_progress';
  end if;
  if v_session.generation_status = 'ready' then
    raise exception using errcode = 'P0001', message = 'interview_questions_ready';
  end if;

  -- Same job: idempotent; a manual retry (higher run_generation) reopens its failed generation.
  if v_session.question_job_id = p_ai_job_id then
    if v_session.generation_status = 'failed' and v_job.status in ('queued', 'running')
       and coalesce(v_session.question_run_generation, -1) < v_job.run_generation then
      update public.interview_sessions s
         set generation_status = 'generating', question_run_generation = v_job.run_generation
       where s.id = p_session_id;
      return private.interview_questions_begin_json(p_session_id, true);
    end if;
    return private.interview_questions_begin_json(p_session_id, false);
  end if;

  if v_job.status not in ('queued', 'running') then
    raise exception using errcode = 'P0001', message = 'invalid_ai_job';
  end if;

  if not exists (select 1 from public.job_descriptions jd
                  where jd.application_project_id = v_session.application_project_id
                    and jd.extraction_status = 'succeeded') then
    raise exception using errcode = 'P0001', message = 'jd_not_extracted';
  end if;

  if v_session.generation_status = 'generating' and v_session.question_job_id is not null
     and private.interview_job_live(v_session.question_job_id) then
    raise exception using errcode = 'P0001', message = 'interview_generation_in_progress';
  end if;

  -- First run, a failed generation (남은 질문 다시 만들기) or a stalled other job: this job takes it over.
  v_reopened := v_session.generation_status = 'failed'
                or (v_session.generation_status = 'generating' and v_session.question_job_id is not null);
  update public.interview_sessions s
     set generation_status = 'generating', question_job_id = p_ai_job_id,
         question_run_generation = v_job.run_generation
   where s.id = p_session_id;

  return private.interview_questions_begin_json(p_session_id, v_reopened);
end;
$$;

revoke all on function public.begin_interview_questions(uuid, uuid) from public, anon;
grant execute on function public.begin_interview_questions(uuid, uuid) to app_ai_writer;


-- ── save_interview_question ────────────────────────────────────────────────
-- One finished question (AI-05 streaming save): the question row (AI meta), its evidence (owner_type
-- 'interview_question') and the blank answer row (DM v2), in one transaction. Idempotent by sequence.
create or replace function public.save_interview_question(
  p_session_id uuid,
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
  v_types constant text[] := array['profile', 'experience', 'education', 'project', 'project_detail', 'achievement',
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
                      where e ->> 'source_type' = 'project_detail' and e ->> 'source_field' = 'learnings')) then
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
$$;

revoke all on function public.save_interview_question(uuid, uuid, integer, jsonb) from public, anon;
grant execute on function public.save_interview_question(uuid, uuid, integer, jsonb) to app_ai_writer;


-- ── complete_interview_questions ───────────────────────────────────────────
-- The full set is saved: generation ready + session-level AI-05 storage (question_provider / question_model,
-- weak_requirement_ids, insight_id, career_snapshot_hash). Set-level validation_report / usage have no column (spec-gaps).
create or replace function public.complete_interview_questions(
  p_session_id uuid,
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
  v_session public.interview_sessions%rowtype;
  v_job public.ai_jobs%rowtype;
  v_now timestamptz := now();
  v_insight uuid;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  v_session := private.interview_lock_session(p_session_id, v_uid);

  select * into v_job from public.ai_jobs j where j.id = p_ai_job_id and j.user_id = v_uid;
  if not found or not private.interview_job_matches(v_job, v_session, 'interview_questions') then
    raise exception using errcode = 'P0001', message = 'invalid_ai_job';
  end if;

  if private.interview_questions_run_state(v_session, v_job, p_run_generation) = 'stale' then
    return jsonb_build_object('applied', false, 'reason', 'stale_run');
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or not private.interview_requirement_ids_valid(v_session.application_project_id,
                                                    p_payload -> 'weak_requirement_ids', 50)
     or not (coalesce(jsonb_typeof(p_payload -> 'insight_id'), 'null') = 'null'
             or private.is_uuid_text(p_payload -> 'insight_id'))
     or jsonb_typeof(p_payload -> 'career_snapshot_hash') is distinct from 'string'
     or char_length(btrim(p_payload ->> 'career_snapshot_hash')) not between 1 and 128
     or jsonb_typeof(p_payload -> 'meta') is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'invalid_interview_payload';
  end if;

  if jsonb_typeof(p_payload -> 'insight_id') = 'string' then
    select i.id into v_insight from public.insights i
     where i.id = (p_payload ->> 'insight_id')::uuid and i.user_id = v_uid
       and i.application_project_id = v_session.application_project_id and i.status = 'ready';
    if not found then
      raise exception using errcode = 'P0001', message = 'invalid_interview_payload';
    end if;
  end if;

  if not private.draft_meta_matches_job(p_payload -> 'meta', v_job) then
    raise exception using errcode = 'P0001', message = 'invalid_ai_metadata';
  end if;

  if (select count(*) from public.interview_questions q where q.session_id = p_session_id)
     <> v_session.question_count then
    raise exception using errcode = 'P0001', message = 'interview_questions_incomplete';
  end if;

  update public.interview_sessions s
     set generation_status = 'ready',
         question_run_generation = p_run_generation,
         question_provider = v_job.provider,
         question_model = btrim(p_payload -> 'meta' ->> 'model'),
         weak_requirement_ids = private.interview_uuid_array(p_payload -> 'weak_requirement_ids'),
         insight_id = v_insight,
         career_snapshot_hash = btrim(p_payload ->> 'career_snapshot_hash'),
         last_activity_at = v_now
   where s.id = p_session_id;

  update public.application_projects ap set last_activity_at = v_now where ap.id = v_session.application_project_id;

  return jsonb_build_object(
    'applied', true, 'session_id', p_session_id, 'generation_status', 'ready',
    'question_count', v_session.question_count, 'question_provider', v_job.provider,
    'question_model', btrim(p_payload -> 'meta' ->> 'model'));
end;
$$;

revoke all on function public.complete_interview_questions(uuid, uuid, integer, jsonb) from public, anon;
grant execute on function public.complete_interview_questions(uuid, uuid, integer, jsonb) to app_ai_writer;


-- ── fail_interview_questions ───────────────────────────────────────────────
create or replace function public.fail_interview_questions(p_session_id uuid, p_ai_job_id uuid)
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
  if not exists (select 1 from public.interview_sessions s where s.id = p_session_id and s.user_id = v_uid) then
    raise exception using errcode = 'P0001', message = 'interview_session_not_found';
  end if;
  return private.interview_questions_mark_failed(p_session_id, p_ai_job_id, false);
end;
$$;

revoke all on function public.fail_interview_questions(uuid, uuid) from public, anon;
grant execute on function public.fail_interview_questions(uuid, uuid) to app_ai_writer;
