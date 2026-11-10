-- R15 / D13 + the shared body of D11 (DM 11.10 #4·#5b, §2.6 "마감일", §2.6.2 — CF-2·CF-A5·CF-A17, AI 요청 3)
--   * The apply body moves into private.jd_apply_extraction_result so the preview path in
--     create_application_project runs EXACTLY the same rules (11.10 #5b).
--   * AI-01 output schema 2 carries deadline = {value, source_sids}. The value is written to
--     application_projects.deadline only when it is null (coalesce — a user value is never overwritten), the sids
--     must exist in this JD's split (same rule as company_name), and the date must sit between KST today and
--     today + 366 days. A conversion failure is ignored, never an extraction failure. Old schema-1 results have
--     no key and simply pass through.
--   * The return value gains 'deadline'.

create or replace function private.jd_apply_extraction_result(
  p_uid uuid,
  p_jd public.job_descriptions,
  p_project public.application_projects,
  p_ai_job_id uuid,
  p_result jsonb,
  p_provider text,
  p_model text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sentence_count integer := jsonb_array_length(p_jd.sentences);
  v_company text;
  v_company_source text;
  v_position text;
  v_position_source text;
  v_name text;
  v_name_source text;
  v_composed text;
  v_count integer;
  v_deadline date := p_project.deadline;
  v_deadline_raw text;
  v_deadline_cand date;
  v_today date;
begin
  delete from public.jd_requirements r where r.job_description_id = p_jd.id and r.origin = 'ai';

  insert into public.jd_requirements (user_id, job_description_id, category, content, keywords, importance,
                                      source_sids, sort_order, origin)
  select p_uid, p_jd.id, e ->> 'category', btrim(e ->> 'content'),
         array(select btrim(k) from jsonb_array_elements_text(e -> 'keywords') k),
         e ->> 'importance',
         array(select s from jsonb_array_elements_text(e -> 'source_sids') s),
         (o - 1)::integer, 'ai'
    from jsonb_array_elements(p_result -> 'requirements') with ordinality as t (e, o);
  get diagnostics v_count = row_count;

  -- QA-S5-05: an AI company / position value counts only when its source_sids exist in this JD (same as the
  -- TS validator); otherwise the value is dropped, not the whole result. A step-2 value (user) is never overwritten.
  v_company := p_jd.company_name;
  v_company_source := p_jd.company_name_source;
  if v_company is null and nullif(btrim(p_result -> 'company_name' ->> 'value'), '') is not null
     and private.jd_sids_exist(p_result -> 'company_name' -> 'source_sids', v_sentence_count, false) then
    v_company := rtrim(left(btrim(p_result -> 'company_name' ->> 'value'), 200));
    v_company_source := 'ai';
  end if;
  v_position := p_jd.position_title;
  v_position_source := p_jd.position_title_source;
  if v_position is null and nullif(btrim(p_result -> 'position_title' ->> 'value'), '') is not null
     and private.jd_sids_exist(p_result -> 'position_title' -> 'source_sids', v_sentence_count, false) then
    v_position := rtrim(left(btrim(p_result -> 'position_title' ->> 'value'), 200));
    v_position_source := 'ai';
  end if;

  update public.job_descriptions jd
     set extraction = p_result -> 'extraction',
         detected_language = p_result ->> 'detected_language',
         tech_keywords = p_result -> 'tech_keywords',
         requirements_hash = btrim(p_result ->> 'requirements_hash'),
         extraction_status = 'succeeded',
         extraction_job_id = p_ai_job_id,
         extraction_provider = p_provider,
         extraction_model = btrim(p_model),
         company_name = v_company, company_name_source = v_company_source,
         position_title = v_position, position_title_source = v_position_source
   where jd.id = p_jd.id;

  v_name := p_project.name;
  v_name_source := p_project.name_source;
  if v_name_source is null or v_name_source = 'default' then
    v_composed := private.application_compose_name(v_company, v_position);
    if v_composed is not null then
      v_name := v_composed;
      v_name_source := 'ai';
    elsif v_name is null then
      v_name := private.application_default_name(p_project.created_at);
      v_name_source := 'default';
    end if;
  end if;

  -- (v4.15, CF-2·CF-A5 ★) deadline: only when the project has none.
  if v_deadline is null then
    v_deadline_raw := nullif(btrim(p_result -> 'deadline' ->> 'value'), '');
    if v_deadline_raw is not null
       and private.jd_sids_exist(p_result -> 'deadline' -> 'source_sids', v_sentence_count, false) then
      begin
        v_deadline_cand := v_deadline_raw::date;
      exception when others then
        v_deadline_cand := null;      -- a calendar / format error is ignored (DM §2.6 3.)
      end;
      if v_deadline_cand is not null then
        v_today := (now() at time zone 'Asia/Seoul')::date;
        if v_deadline_cand >= v_today and v_deadline_cand <= v_today + 366 then
          v_deadline := v_deadline_cand;
        end if;
      end if;
    end if;
  end if;

  update public.application_projects ap
     set name = v_name, name_source = v_name_source, deadline = v_deadline, last_activity_at = now()
   where ap.id = p_project.id;

  return jsonb_build_object(
    'applied', true,
    'job_description_id', p_jd.id,
    'application_project_id', p_project.id,
    'extraction_status', 'succeeded',
    'name', v_name, 'name_source', v_name_source,
    'company_name', v_company, 'company_name_source', v_company_source,
    'position_title', v_position, 'position_title_source', v_position_source,
    'deadline', v_deadline,
    'requirement_count', v_count);
end;
$$;

revoke all on function private.jd_apply_extraction_result(uuid, public.job_descriptions,
  public.application_projects, uuid, jsonb, text, text) from public, anon, authenticated, app_ai_writer,
  service_role;

create or replace function public.apply_jd_extraction(p_job_description_id uuid, p_ai_job_id uuid,
  p_run_generation integer, p_result jsonb, p_provider text, p_model text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.current_uid();
  v_project_id uuid;
  v_project public.application_projects%rowtype;
  v_jd public.job_descriptions%rowtype;
  v_job public.ai_jobs%rowtype;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  select jd.application_project_id into v_project_id
    from public.job_descriptions jd where jd.id = p_job_description_id and jd.user_id = v_uid;
  select * into v_project from public.application_projects ap where ap.id = v_project_id for update;
  select * into v_jd from public.job_descriptions jd
   where jd.id = p_job_description_id and jd.user_id = v_uid
     for update;
  if not found or v_project.id is null then
    raise exception using errcode = 'P0001', message = 'job_description_not_found';
  end if;

  select * into v_job from public.ai_jobs j where j.id = p_ai_job_id and j.user_id = v_uid;
  if not found or not private.jd_extraction_job_matches(v_job, v_jd) then
    raise exception using errcode = 'P0001', message = 'invalid_ai_job';
  end if;

  if v_jd.extraction_status <> 'running' or v_jd.extraction_job_id is distinct from p_ai_job_id
     or v_job.status <> 'running' or v_job.run_generation is distinct from p_run_generation then
    return jsonb_build_object('applied', false, 'reason', 'stale_run');
  end if;

  if p_provider is distinct from v_job.provider or nullif(btrim(p_model), '') is null then
    raise exception using errcode = 'P0001', message = 'invalid_ai_metadata';
  end if;

  if exists (select 1 from public.jd_requirements r
              where r.job_description_id = p_job_description_id and (r.origin = 'user' or r.is_user_edited)) then
    raise exception using errcode = 'P0001', message = 'user_edited_requirements_exist';
  end if;

  if not private.jd_extraction_result_valid(p_result, jsonb_array_length(v_jd.sentences)) then
    raise exception using errcode = 'P0001', message = 'invalid_extraction_result';
  end if;

  return private.jd_apply_extraction_result(v_uid, v_jd, v_project, p_ai_job_id, p_result, p_provider, p_model);
end;
$$;
