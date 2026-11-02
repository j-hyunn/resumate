-- S7: source deletion for draft_section_sources (DM §2.7, A.11, AI-04 storage) and the user_note evidence source
-- (AI C-3 NOTE-n, F-DOC-09).
--   * experience / education / project deleted -> source_deleted_at = now() and source_label = the pre-deletion
--     "회사명 › 프로젝트명" (first deletion wins: rows already marked are left alone).
--   * project_detail deleted -> its id is removed from project_detail_ids (DM §2.7: no per-element soft marker; the
--     section's evidence_links of source_type project_detail show "원본 삭제됨").
--   * evidence_links user_note: source_id = the draft_sections row whose user_note was quoted. A note of another
--     application project is a pipeline bug (invalid_evidence_source); a missing section stores the link as deleted.

-- Label of a source row's parent (experience company / education institution), live rows only.
create or replace function private.draft_source_parent_name(p_user_id uuid, p_experience_id uuid, p_education_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select e.company_name from public.experiences e where e.id = p_experience_id and e.user_id = p_user_id),
    (select ed.institution_name from public.educations ed where ed.id = p_education_id and ed.user_id = p_user_id));
$$;

revoke all on function private.draft_source_parent_name(uuid, uuid, uuid) from public;

-- "parent › project" for a source row from live rows (null when nothing is left to name).
create or replace function private.draft_source_label(p_user_id uuid, p_experience_id uuid, p_education_id uuid,
                                                     p_project_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(left(concat_ws(' › ',
                               private.draft_source_parent_name(p_user_id, p_experience_id, p_education_id),
                               (select p.name from public.projects p where p.id = p_project_id and p.user_id = p_user_id)),
                     300), '');
$$;

revoke all on function private.draft_source_label(uuid, uuid, uuid, uuid) from public;

create or replace function private.draft_sources_mark_project_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.draft_section_sources s
     set source_deleted_at = now(),
         source_label = left(coalesce(
           case when private.draft_source_parent_name(s.user_id, s.experience_id, s.education_id) is not null
                then private.draft_source_parent_name(s.user_id, s.experience_id, s.education_id)
                     || ' › ' || coalesce(old.name, '')
           end,
           s.source_label,
           old.name), 300)
   where s.user_id = old.user_id and s.project_id = old.id and s.source_deleted_at is null;
  return null;
end;
$$;

revoke all on function private.draft_sources_mark_project_deleted() from public;

create or replace function private.draft_sources_mark_experience_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.draft_section_sources s
     set source_deleted_at = now(),
         source_label = left(coalesce(
           case when s.project_id is null then old.company_name
                else old.company_name || ' › '
                     || (select p.name from public.projects p where p.id = s.project_id and p.user_id = s.user_id)
           end,
           s.source_label,
           old.company_name), 300)
   where s.user_id = old.user_id and s.experience_id = old.id and s.source_deleted_at is null;
  return null;
end;
$$;

revoke all on function private.draft_sources_mark_experience_deleted() from public;

create or replace function private.draft_sources_mark_education_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.draft_section_sources s
     set source_deleted_at = now(),
         source_label = left(coalesce(
           case when s.project_id is null then old.institution_name
                else old.institution_name || ' › '
                     || (select p.name from public.projects p where p.id = s.project_id and p.user_id = s.user_id)
           end,
           s.source_label,
           old.institution_name), 300)
   where s.user_id = old.user_id and s.education_id = old.id and s.source_deleted_at is null;
  return null;
end;
$$;

revoke all on function private.draft_sources_mark_education_deleted() from public;

create or replace function private.draft_sources_remove_project_detail()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.draft_section_sources s
     set project_detail_ids = array_remove(s.project_detail_ids, old.id)
   where s.user_id = old.user_id and s.project_id = old.project_id and old.id = any (s.project_detail_ids);
  return null;
end;
$$;

revoke all on function private.draft_sources_remove_project_detail() from public;

create trigger projects_draft_sources_deleted
  after delete on public.projects
  for each row execute function private.draft_sources_mark_project_deleted();
create trigger experiences_draft_sources_deleted
  after delete on public.experiences
  for each row execute function private.draft_sources_mark_experience_deleted();
create trigger educations_draft_sources_deleted
  after delete on public.educations
  for each row execute function private.draft_sources_mark_education_deleted();
create trigger project_details_draft_sources_deleted
  after delete on public.project_details
  for each row execute function private.draft_sources_remove_project_detail();


-- evidence_links insert guard: S6 version + user_note (S7). Other branches unchanged.
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
      -- interview_answer: checked by S8.
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
