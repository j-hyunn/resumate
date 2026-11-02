-- W0 Q53-2 + Q53-11 (DM 2.6.1, A.6): the one exception to "JD immutable". A JD whose extraction failed for an input
-- cause, or that succeeded with 0 requirements, can get a new raw text through update_failed_jd_raw_text. No AI call,
-- no key needed (D-30); re-extraction is a separate request.

alter table public.job_descriptions add column raw_text_edited_at timestamptz;

-- Guard: raw text / hash / sentences change only as one edit (old failed | running | succeeded, new pending, a new
-- raw_text_edited_at). application_project_id and user_id stay immutable. A JD leaves `succeeded` only through such
-- an edit, and raw_text_edited_at never moves on its own.
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
     or new.user_id is distinct from old.user_id then
    raise exception using errcode = 'P0001', message = 'job_description_immutable';
  end if;

  if v_text_changed or v_stamp_changed then
    if not (v_text_changed and v_stamp_changed and new.raw_text_edited_at is not null
            and old.extraction_status in ('failed', 'running', 'succeeded')
            and new.extraction_status = 'pending') then
      raise exception using errcode = 'P0001', message = 'job_description_immutable';
    end if;
  elsif old.extraction_status = 'succeeded' and new.extraction_status <> 'succeeded' then
    raise exception using errcode = 'P0001', message = 'job_description_immutable';
  end if;

  return new;
end;
$$;


-- update_failed_jd_raw_text: refusal codes in the order of DM 2.6.1 (P0001; the first one found wins).
--   invalid_raw_text / invalid_raw_text_hash / invalid_sentences   same checks as create_application_project
--   job_description_not_found    missing or another user's
--   jd_job_in_progress           1. a queued / running ai_jobs row on this project, any type
--   jd_raw_text_locked           2. not failed (running whose job already failed counts as failed) and not succeeded
--                                3. requirements exist (any origin)
--   jd_failure_not_input         4. failed rows only: the latest run's job is not a failed jd_extraction with an input
--                                   cause (job pruned after 90 days -> cause unknown -> refused)
--   jd_has_results               5. something was built from this text
--   jd_raw_text_unchanged        6. same text, ignoring leading / trailing whitespace [가정]
-- Lock order: application_projects -> job_descriptions.
create or replace function public.update_failed_jd_raw_text(
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
  v_job public.ai_jobs%rowtype;
  v_failed boolean;
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
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

  -- 1
  if exists (select 1 from public.ai_jobs j
              where j.application_project_id = p_application_project_id and j.user_id = v_uid
                and j.status in ('queued', 'running')) then
    raise exception using errcode = 'P0001', message = 'jd_job_in_progress';
  end if;

  select * into v_job from public.ai_jobs j where j.id = v_jd.extraction_job_id and j.user_id = v_uid;

  -- 2
  v_failed := v_jd.extraction_status = 'failed'
              or (v_jd.extraction_status = 'running' and v_job.status is not distinct from 'failed');
  if not v_failed and v_jd.extraction_status <> 'succeeded' then
    raise exception using errcode = 'P0001', message = 'jd_raw_text_locked';
  end if;

  -- 3
  if exists (select 1 from public.jd_requirements r where r.job_description_id = v_jd.id) then
    raise exception using errcode = 'P0001', message = 'jd_raw_text_locked';
  end if;

  -- 4
  if v_failed and not coalesce(v_job.job_type = 'jd_extraction' and v_job.status = 'failed'
                               and v_job.error_code in ('not_a_jd', 'input_too_long', 'safety_blocked'), false) then
    raise exception using errcode = 'P0001', message = 'jd_failure_not_input';
  end if;

  -- 5
  if exists (select 1 from public.insights i
              where i.application_project_id = p_application_project_id and i.status = 'ready')
     or exists (select 1 from public.interview_questions q
                  join public.interview_sessions s on s.id = q.session_id
                 where s.application_project_id = p_application_project_id)
     or exists (select 1 from public.draft_sections ds
                  join public.drafts d on d.id = ds.draft_id
                 where d.application_project_id = p_application_project_id and ds.ai_content is not null)
     or exists (select 1 from public.evidence_links el
                 where el.application_project_id = p_application_project_id
                   and el.source_type in ('jd_requirement', 'jd_sentence')) then
    raise exception using errcode = 'P0001', message = 'jd_has_results';
  end if;

  -- 6
  if regexp_replace(p_raw_text, '^\s+|\s+$', '', 'g') = regexp_replace(v_jd.raw_text, '^\s+|\s+$', '', 'g') then
    raise exception using errcode = 'P0001', message = 'jd_raw_text_unchanged';
  end if;

  update public.job_descriptions jd
     set raw_text = p_raw_text,
         raw_text_hash = btrim(p_raw_text_hash),
         sentences = p_sentences,
         raw_text_edited_at = v_now,
         detected_language = null,
         extraction = null,
         tech_keywords = null,
         requirements_hash = null,
         extraction_status = 'pending',
         extraction_job_id = null,
         extraction_provider = null,
         extraction_model = null,
         company_name = case when jd.company_name_source = 'ai' then null else jd.company_name end,
         company_name_source = case when jd.company_name_source = 'ai' then null else jd.company_name_source end,
         position_title = case when jd.position_title_source = 'ai' then null else jd.position_title end,
         position_title_source = case when jd.position_title_source = 'ai' then null else jd.position_title_source end
   where jd.id = v_jd.id;

  update public.application_projects ap set last_activity_at = v_now where ap.id = p_application_project_id;

  return jsonb_build_object(
    'application_project_id', p_application_project_id,
    'job_description_id', v_jd.id,
    'extraction_status', 'pending',
    'raw_text_edited_at', v_now,
    'ai_run_allowed', private.user_ai_run_allowed(v_uid));
end;
$$;

revoke all on function public.update_failed_jd_raw_text(uuid, text, text, jsonb)
  from public, anon, app_ai_writer, service_role;
grant execute on function public.update_failed_jd_raw_text(uuid, text, text, jsonb) to authenticated;
