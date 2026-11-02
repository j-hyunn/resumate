-- S7 cover letter user RPCs (F-DOC-02, 08, 09; AI-04 trigger / storage; DM A.9–A.11, §5). No AI call, no key
-- needed (F-DOC-02 [가정], D-36). Security definer + auth.uid() owner check: users have no INSERT on drafts /
-- draft_sections and no write at all on draft_section_sources.
-- Lock order everywhere: application_projects row -> drafts row -> draft_sections rows (same as the AI RPCs and
-- a project delete cascade).
-- Errors: 42501 not_authenticated; P0001 application_project_not_found, draft_not_found, section_not_found,
-- invalid_title, draft_id_conflict, section_id_conflict, invalid_question, question_limit_reached, last_question,
-- section_generating, invalid_section_order, invalid_sources, source_not_found.

-- ── shared helpers ─────────────────────────────────────────────────────────

-- Cover letter draft status from its questions (S7 plan contract DB 4 + [가정]):
--   any generating -> generating; all ready -> ready; failed + ready -> partially_failed; failed only (with or
--   without pending) -> failed; otherwise (pending only, or pending + ready) -> composing.
-- Career descriptions are left alone (their status is the generation's). Returns the (new) status.
create or replace function private.draft_recompute_status(p_draft_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text;
  v_status text;
  v_new text;
  v_total integer;
  v_generating integer;
  v_ready integer;
  v_failed integer;
begin
  select d.draft_type, d.status into v_type, v_status from public.drafts d where d.id = p_draft_id;
  if not found then
    return null;
  end if;
  if v_type <> 'cover_letter' then
    return v_status;
  end if;

  -- QA-S7-07: a generating row counts as generating only while its job is queued / running; a leftover whose job
  -- ended (end trigger skipped) counts as failed (readers show it as failed too).
  select count(*),
         count(*) filter (where s.status = 'generating' and j.status in ('queued', 'running')),
         count(*) filter (where s.status = 'ready'),
         count(*) filter (where s.status = 'failed'
                             or (s.status = 'generating' and j.status is distinct from 'queued'
                                 and j.status is distinct from 'running'))
    into v_total, v_generating, v_ready, v_failed
    from public.draft_sections s
    left join public.ai_jobs j on j.id = s.ai_job_id
   where s.draft_id = p_draft_id;

  v_new := case
    when v_generating > 0 then 'generating'
    when v_total > 0 and v_ready = v_total then 'ready'
    when v_failed > 0 and v_ready > 0 then 'partially_failed'
    when v_failed > 0 then 'failed'
    else 'composing'
  end;

  if v_new is distinct from v_status then
    update public.drafts d set status = v_new where d.id = p_draft_id;
  end if;
  return v_new;
end;
$$;

revoke all on function private.draft_recompute_status(uuid) from public;

-- Is the section being generated (QA-S7-07)? Judged by jobs, not by the row status:
--   * a cover_letter job targeting the question is queued / running (covers the prepare window before
--     begin_cover_letter_section marks the row generating), or
--   * the row is generating for a job that is still queued / running.
-- A generating row whose job ended (end trigger skipped under SKIP LOCKED) does not block. p_exclude_job_id: the
-- caller's own job (begin_cover_letter_section).
create or replace function private.draft_section_job_active(p_section_id uuid, p_exclude_job_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.draft_sections s
                   join public.ai_jobs j
                     on j.user_id = s.user_id and j.job_type = 'cover_letter' and j.target_type = 'draft_section'
                    and j.target_id = s.id
                  where s.id = p_section_id and j.status in ('queued', 'running')
                    and j.id is distinct from p_exclude_job_id)
      or exists (select 1 from public.draft_sections s
                   join public.ai_jobs j on j.id = s.ai_job_id
                  where s.id = p_section_id and s.status = 'generating' and j.status in ('queued', 'running')
                    and j.id is distinct from p_exclude_job_id);
$$;

revoke all on function private.draft_section_job_active(uuid, uuid) from public;

-- Default title "{종류} (YYYY-MM-DD)" in KST (S7 [가정 5]).
create or replace function private.draft_default_title(p_draft_type text)
returns text
language sql
stable
set search_path = ''
as $$
  select case p_draft_type when 'career_description' then '경력기술서' else '자기소개서' end
         || ' (' || to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD') || ')';
$$;

revoke all on function private.draft_default_title(text) from public;

-- p_title null / blank -> default; otherwise 1..100 chars or invalid_title.
create or replace function private.draft_resolve_title(p_title text, p_draft_type text)
returns text
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_title is null or btrim(p_title) = '' then
    return private.draft_default_title(p_draft_type);
  end if;
  if char_length(btrim(p_title)) > 100 then
    raise exception using errcode = 'P0001', message = 'invalid_title';
  end if;
  return btrim(p_title);
end;
$$;

revoke all on function private.draft_resolve_title(text, text) from public;

-- Locks (project, draft) of the caller's cover letter draft in the standard order. draft_not_found otherwise.
create or replace function private.lock_cover_letter_draft(p_draft_id uuid, p_uid uuid)
returns public.drafts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_draft public.drafts%rowtype;
begin
  select d.application_project_id into v_project_id
    from public.drafts d where d.id = p_draft_id and d.user_id = p_uid and d.draft_type = 'cover_letter';
  if not found then
    raise exception using errcode = 'P0001', message = 'draft_not_found';
  end if;
  perform 1 from public.application_projects ap where ap.id = v_project_id for update;
  select * into v_draft from public.drafts d
   where d.id = p_draft_id and d.user_id = p_uid and d.draft_type = 'cover_letter'
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'draft_not_found';
  end if;
  return v_draft;
end;
$$;

revoke all on function private.lock_cover_letter_draft(uuid, uuid) from public;

-- The draft id of the caller's cover letter question, or section_not_found.
create or replace function private.cover_letter_section_draft_id(p_section_id uuid, p_uid uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_draft_id uuid;
begin
  select s.draft_id into v_draft_id
    from public.draft_sections s
   where s.id = p_section_id and s.user_id = p_uid and s.section_kind = 'cover_letter_question';
  if not found then
    raise exception using errcode = 'P0001', message = 'section_not_found';
  end if;
  return v_draft_id;
end;
$$;

revoke all on function private.cover_letter_section_draft_id(uuid, uuid) from public;

-- Sources of a section as returned by set_section_sources (ordered).
create or replace function private.draft_section_sources_json(p_section_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'sort_order', s.sort_order, 'experience_id', s.experience_id,
           'education_id', s.education_id, 'project_id', s.project_id,
           'project_detail_ids', to_jsonb(s.project_detail_ids), 'role', s.role, 'origin', s.origin,
           'rationale', s.rationale, 'requirement_ids', to_jsonb(s.requirement_ids),
           'reuse_reason', s.reuse_reason, 'source_label', s.source_label,
           'source_deleted_at', s.source_deleted_at) order by s.sort_order), '[]'::jsonb)
    from public.draft_section_sources s where s.draft_section_id = p_section_id;
$$;

revoke all on function private.draft_section_sources_json(uuid) from public;


-- ── create_cover_letter_draft ──────────────────────────────────────────────
-- New cover letter draft (composing) with the 3 seeded questions (AI-04 trigger; F-DOC-02). Idempotent on
-- p_draft_id (client-generated id, S2 decision).
create or replace function public.create_cover_letter_draft(
  p_application_project_id uuid,
  p_draft_id uuid default null,
  p_title text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_existing public.drafts%rowtype;
  v_id uuid;
  v_title text;
  v_created boolean := true;
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

  if p_draft_id is not null then
    select * into v_existing from public.drafts d where d.id = p_draft_id;
    if found then
      if v_existing.user_id <> v_uid or v_existing.draft_type <> 'cover_letter'
         or v_existing.application_project_id <> p_application_project_id then
        raise exception using errcode = 'P0001', message = 'draft_id_conflict';
      end if;
      v_id := p_draft_id;
      v_created := false;
    end if;
  end if;

  if v_created then
    v_title := private.draft_resolve_title(p_title, 'cover_letter');
    insert into public.drafts (id, user_id, application_project_id, draft_type, title, status, options)
    values (coalesce(p_draft_id, gen_random_uuid()), v_uid, p_application_project_id, 'cover_letter', v_title,
            'composing', '{}'::jsonb)
    returning id into v_id;

    -- AI-04: default 3 questions, no AI. char_limit 1000 / with_spaces [가정].
    insert into public.draft_sections (user_id, draft_id, sort_order, section_kind, question_text, template_key,
                                       char_limit, count_basis)
    values (v_uid, v_id, 0, 'cover_letter_question', '지원 동기', 'motivation', 1000, 'with_spaces'),
           (v_uid, v_id, 1, 'cover_letter_question', '직무 역량', 'job_competency', 1000, 'with_spaces'),
           (v_uid, v_id, 2, 'cover_letter_question', '입사 후 포부 및 성장 계획', 'future_plan', 1000, 'with_spaces');
  end if;

  return (
    select jsonb_build_object(
      'draft_id', d.id, 'application_project_id', d.application_project_id, 'draft_type', d.draft_type,
      'title', d.title, 'status', d.status, 'created', v_created,
      'sections', coalesce((select jsonb_agg(jsonb_build_object(
                    'section_id', s.id, 'sort_order', s.sort_order, 'template_key', s.template_key,
                    'question_text', s.question_text, 'char_limit', s.char_limit, 'count_basis', s.count_basis)
                    order by s.sort_order)
                    from public.draft_sections s where s.draft_id = d.id), '[]'::jsonb))
      from public.drafts d where d.id = v_id);
end;
$$;

revoke all on function public.create_cover_letter_draft(uuid, uuid, text) from public, anon;
grant execute on function public.create_cover_letter_draft(uuid, uuid, text) to authenticated;


-- ── add_cover_letter_question ──────────────────────────────────────────────
-- Appends a user question (template_key null, AI-04). At most 10 questions per draft [가정].
create or replace function public.add_cover_letter_question(
  p_draft_id uuid,
  p_question_text text,
  p_char_limit integer default 1000,
  p_count_basis text default 'with_spaces',
  p_section_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_draft public.drafts%rowtype;
  v_existing public.draft_sections%rowtype;
  v_id uuid;
  v_sort integer;
  v_created boolean := true;
  v_status text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  v_draft := private.lock_cover_letter_draft(p_draft_id, v_uid);

  if p_section_id is not null then
    select * into v_existing from public.draft_sections s where s.id = p_section_id;
    if found then
      if v_existing.user_id <> v_uid or v_existing.draft_id <> p_draft_id then
        raise exception using errcode = 'P0001', message = 'section_id_conflict';
      end if;
      return jsonb_build_object('section_id', v_existing.id, 'draft_id', p_draft_id,
                                'sort_order', v_existing.sort_order, 'created', false,
                                'draft_status', v_draft.status);
    end if;
  end if;

  if p_question_text is null or btrim(p_question_text) = '' or char_length(p_question_text) > 1000
     or (p_char_limit is not null and p_char_limit not between 1 and 10000)
     or p_count_basis is null or p_count_basis not in ('with_spaces', 'without_spaces') then
    raise exception using errcode = 'P0001', message = 'invalid_question';
  end if;

  if (select count(*) from public.draft_sections s where s.draft_id = p_draft_id) >= 10 then
    raise exception using errcode = 'P0001', message = 'question_limit_reached';
  end if;

  select coalesce(max(s.sort_order) + 1, 0) into v_sort from public.draft_sections s where s.draft_id = p_draft_id;

  insert into public.draft_sections (id, user_id, draft_id, sort_order, section_kind, question_text, char_limit,
                                     count_basis)
  values (coalesce(p_section_id, gen_random_uuid()), v_uid, p_draft_id, v_sort, 'cover_letter_question',
          p_question_text, p_char_limit, p_count_basis)
  returning id into v_id;

  v_status := private.draft_recompute_status(p_draft_id);

  return jsonb_build_object('section_id', v_id, 'draft_id', p_draft_id, 'sort_order', v_sort,
                            'created', v_created, 'draft_status', v_status);
end;
$$;

revoke all on function public.add_cover_letter_question(uuid, text, integer, text, uuid) from public, anon;
grant execute on function public.add_cover_letter_question(uuid, text, integer, text, uuid) to authenticated;


-- ── delete_cover_letter_question ───────────────────────────────────────────
-- Deletes a question (sources cascade, evidence by trigger). Keeps at least one question (F-DOC-02 최소 1).
create or replace function public.delete_cover_letter_question(p_section_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_draft_id uuid;
  v_remaining integer;
  v_status text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  v_draft_id := private.cover_letter_section_draft_id(p_section_id, v_uid);
  perform private.lock_cover_letter_draft(v_draft_id, v_uid);
  perform 1 from public.draft_sections s where s.id = p_section_id and s.user_id = v_uid for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'section_not_found';
  end if;

  if private.draft_section_job_active(p_section_id) then
    raise exception using errcode = 'P0001', message = 'section_generating';
  end if;
  if (select count(*) from public.draft_sections s where s.draft_id = v_draft_id) <= 1 then
    raise exception using errcode = 'P0001', message = 'last_question';
  end if;

  delete from public.draft_sections s where s.id = p_section_id and s.user_id = v_uid;

  select count(*) into v_remaining from public.draft_sections s where s.draft_id = v_draft_id;
  v_status := private.draft_recompute_status(v_draft_id);

  return jsonb_build_object('deleted', true, 'section_id', p_section_id, 'draft_id', v_draft_id,
                            'remaining', v_remaining, 'draft_status', v_status);
end;
$$;

revoke all on function public.delete_cover_letter_question(uuid) from public, anon;
grant execute on function public.delete_cover_letter_question(uuid) to authenticated;


-- ── reorder_cover_letter_questions ─────────────────────────────────────────
-- p_section_ids = every question id of the draft exactly once, in the new order (sort_order = index from 0).
create or replace function public.reorder_cover_letter_questions(p_draft_id uuid, p_section_ids uuid[])
returns jsonb
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

  perform private.lock_cover_letter_draft(p_draft_id, v_uid);

  select count(*) into v_count from public.draft_sections s where s.draft_id = p_draft_id;
  if p_section_ids is null or array_position(p_section_ids, null) is not null
     or cardinality(p_section_ids) <> v_count
     or (select count(distinct u) from unnest(p_section_ids) u) <> v_count
     or exists (select 1 from unnest(p_section_ids) u
                 where not exists (select 1 from public.draft_sections s
                                    where s.id = u and s.draft_id = p_draft_id)) then
    raise exception using errcode = 'P0001', message = 'invalid_section_order';
  end if;

  update public.draft_sections s
     set sort_order = x.ord - 1
    from unnest(p_section_ids) with ordinality as x (id, ord)
   where s.id = x.id and s.draft_id = p_draft_id and s.sort_order is distinct from x.ord - 1;

  return jsonb_build_object('draft_id', p_draft_id, 'section_ids',
    (select to_jsonb(array_agg(s.id order by s.sort_order)) from public.draft_sections s
      where s.draft_id = p_draft_id));
end;
$$;

revoke all on function public.reorder_cover_letter_questions(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_cover_letter_questions(uuid, uuid[]) to authenticated;


-- ── set_section_sources ────────────────────────────────────────────────────
-- F-DOC-08: replaces the question's sources with the user's list (origin 'user'), switches the question to
-- source_selection_mode 'user' and stamps sources_modified_at (C-11 "변경됨"). Only complete career rows the
-- caller owns; details must be complete details of the chosen project; requirement ids of this project's JD.
-- A retained (experience, education, project) keeps its rationale / reuse_reason / requirement_ids and its
-- sources.{n} evidence (re-keyed to the new position); dropped entries lose their sources.{n} evidence.
create or replace function public.set_section_sources(p_section_id uuid, p_sources jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_draft_id uuid;
  v_draft public.drafts%rowtype;
  v_elem jsonb;
  v_ord bigint;
  v_proj uuid;
  v_exp uuid;
  v_edu uuid;
  v_details uuid[];
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
       or not private.is_uuid_array(v_elem -> 'project_detail_ids', 20, true)
       or not private.is_uuid_array(v_elem -> 'requirement_ids', 50, true)
       or not (coalesce(jsonb_typeof(v_elem -> 'role'), 'null') = 'null'
               or v_elem ->> 'role' in ('primary', 'supporting')) then
      raise exception using errcode = 'P0001', message = 'invalid_sources';
    end if;

    v_proj := (v_elem ->> 'project_id')::uuid;
    v_exp := (v_elem ->> 'experience_id')::uuid;
    v_edu := (v_elem ->> 'education_id')::uuid;
    v_details := coalesce((select array_agg(distinct x::uuid)
                             from jsonb_array_elements_text(coalesce(nullif(v_elem -> 'project_detail_ids', 'null'::jsonb), '[]'::jsonb)) x),
                          '{}');
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
      if num_nonnulls(v_exp, v_edu) <> 1 or cardinality(v_details) > 0 then
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
    if cardinality(v_details) > 0
       and (select count(*) from public.project_details d
             where d.id = any (v_details) and d.project_id = v_proj and d.user_id = v_uid and d.status = 'complete')
           <> cardinality(v_details) then
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
      'project_detail_ids', to_jsonb(v_details),
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
                                            education_id, project_id, project_detail_ids, role, origin, rationale,
                                            reuse_reason, requirement_ids, sort_order, source_label)
  select v_uid, p_section_id, v_draft.application_project_id, (r ->> 'experience_id')::uuid,
         (r ->> 'education_id')::uuid, (r ->> 'project_id')::uuid,
         coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(r -> 'project_detail_ids') x), '{}'),
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
$$;

revoke all on function public.set_section_sources(uuid, jsonb) from public, anon;
grant execute on function public.set_section_sources(uuid, jsonb) to authenticated;
