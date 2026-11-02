-- R4 evidence_links v4.4 (DM §2.8): source types and per-type source_field lists.
--   project: name, period (both kinds) / situation, task, action, result, learnings (affiliated)
--            / role, description (standalone). team_size and summary are gone; classifications and link_url
--            are never evidence fields (AI C-1.2).
--   project_deliverable: title, body (body locator = {start, end} in the raw markdown, set by the server).
-- Rows with removed types were cleared in 20261109100100.

alter table public.evidence_links drop constraint evidence_links_source_type_check;
alter table public.evidence_links drop constraint evidence_links_source_field_check;

alter table public.evidence_links
  add constraint evidence_links_source_type_check check (source_type in (
    'profile', 'experience', 'education', 'project', 'project_deliverable', 'skill',
    'jd_requirement', 'jd_sentence', 'interview_answer', 'user_note')),
  add constraint evidence_links_source_field_check check (coalesce(
    case source_type
      when 'profile' then source_field in ('desired_job_title', 'total_years_of_experience', 'interested_industries')
      when 'experience' then source_field in ('job_rank', 'job_position', 'department', 'summary', 'period')
      when 'education' then source_field in ('institution_name', 'program_name', 'education_type',
                                             'enrollment_status', 'period', 'description')
      when 'project' then source_field in ('name', 'period', 'situation', 'task', 'action', 'result', 'learnings',
                                          'role', 'description')
      when 'project_deliverable' then source_field in ('title', 'body')
      when 'skill' then source_field = 'name'
      else source_field is null
    end, false));

-- Insert trigger: deliverable existence ("원본 삭제됨" when gone), project field ↔ project kind check.
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
      when 'profile' then exists (select 1 from public.profiles where id = new.source_id and id = new.user_id)
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
$function$

;
