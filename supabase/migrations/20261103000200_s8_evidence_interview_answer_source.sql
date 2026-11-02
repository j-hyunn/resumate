-- S8: evidence_links insert guard + interview_answer sources (AI C-3 ANS-n, AI-06 / AI-07 answer quotes).
--   interview_answer: source_id = interview_answers.id of the same user; its session must belong to the link's
--   application project (else invalid_evidence_source). A missing answer stores the link as source-deleted.
-- Other branches are the S7 version unchanged.
create or replace function private.evidence_links_check_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exists boolean;
  v_jd_project uuid;
  v_sentences jsonb;
  v_sentence jsonb;
  v_sid text;
  v_start numeric;
  v_end numeric;
begin
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

  else
    v_exists := case new.source_type
      when 'profile' then exists (select 1 from public.profiles where id = new.source_id and id = new.user_id)
      when 'experience' then exists (select 1 from public.experiences where id = new.source_id and user_id = new.user_id)
      when 'education' then exists (select 1 from public.educations where id = new.source_id and user_id = new.user_id)
      when 'project' then exists (select 1 from public.projects where id = new.source_id and user_id = new.user_id)
      when 'project_detail' then exists (select 1 from public.project_details where id = new.source_id and user_id = new.user_id)
      when 'achievement' then exists (select 1 from public.achievements where id = new.source_id and user_id = new.user_id)
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

revoke all on function private.evidence_links_check_source() from public;
