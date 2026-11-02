-- W0 Q53-7 (DM 2.7.1, A.9): stopping a career description is not a failure. No blocks, back to the previous state.
--   regeneration (regenerated_from_id set)  the new draft row is deleted (sections, evidence with it)
--   first generation                        status composing, options kept, sections deleted, job + AI meta null
-- Applies when the job is canceled or has cancel_requested_at, while the draft is `generating` (validated first =
-- done). Failures that aren't cancels still end `failed`. At most one composing career description per project.

alter table public.drafts drop constraint drafts_type_status_check;
alter table public.drafts add constraint drafts_type_status_check check (
  (draft_type = 'career_description' and status in ('composing', 'generating', 'ready', 'failed'))
  or (draft_type = 'cover_letter' and status in ('composing', 'generating', 'ready', 'partially_failed', 'failed')));

create unique index drafts_career_description_composing_key on public.drafts (application_project_id)
  where draft_type = 'career_description' and status = 'composing';


-- Ends p_ai_job_id's generating draft: the stop handling above when the job was stopped, else `failed`.
-- One more case: the runner's fail_career_description can land just before an aborted run closes its job `canceled`;
-- the job's end then moves that `failed` draft to the stop handling as well.
-- Returns whether the draft changed. p_skip_locked (end trigger path, QA-S5-06): take the project row without
-- waiting, else do nothing.
create or replace function private.career_description_mark_failed(p_draft_id uuid, p_ai_job_id uuid,
                                                                  p_skip_locked boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_job public.ai_jobs%rowtype;
  v_draft public.drafts%rowtype;
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

  select * into v_job from public.ai_jobs j where j.id = p_ai_job_id;

  select * into v_draft from public.drafts d
   where d.id = p_draft_id and d.draft_type = 'career_description' and d.ai_job_id = p_ai_job_id
     for update;
  if not found then
    return false;
  end if;

  if not (v_draft.status = 'generating' or (v_draft.status = 'failed' and v_job.status = 'canceled')) then
    return false;
  end if;

  if v_job.status = 'canceled' or v_job.cancel_requested_at is not null then
    if v_draft.regenerated_from_id is not null then
      delete from public.drafts d where d.id = p_draft_id;
      return true;
    end if;

    delete from public.draft_sections s where s.draft_id = p_draft_id;
    delete from public.drafts d
     where d.application_project_id = v_project_id and d.draft_type = 'career_description'
       and d.status = 'composing' and d.id <> p_draft_id;
    update public.drafts d
       set status = 'composing', ai_job_id = null, run_generation = null, schema_version = null, prompt_version = null,
           provider = null, model = null, model_tier = null, connection_tier = null, input_hash = null,
           career_snapshot_hash = null, validation_report = null, usage = null, completed_at = null
     where d.id = p_draft_id;
    return true;
  end if;

  update public.drafts d
     set status = 'failed', run_generation = coalesce(v_job.run_generation, d.run_generation)
   where d.id = p_draft_id;

  update public.draft_sections s
     set status = 'failed'
   where s.draft_id = p_draft_id and s.status in ('pending', 'generating');
  return true;
end;
$$;


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
        where d.ai_job_id = new.id
          and (d.status = 'generating' or (d.status = 'failed' and new.status = 'canceled'));
    elsif new.job_type = 'cover_letter' then
      perform private.draft_section_mark_failed(s.id, new.id, true)
         from public.draft_sections s
        where s.ai_job_id = new.id and s.status = 'generating';
    end if;
  end if;
  return null;
end;
$$;


-- begin_career_description: as in S7, plus the last step before the insert. The project's composing career description
-- is replaced by this new draft; rows a skipped end trigger left `generating` under a canceled job are settled first.
-- A p_regenerated_from_id pointing at one of those deleted rows means there is nothing to regenerate from: first
-- generation.
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
  v_regenerated_from uuid;
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

  -- Q53-7
  perform private.career_description_mark_failed(d.id, d.ai_job_id, false)
     from public.drafts d
     join public.ai_jobs j on j.id = d.ai_job_id
    where d.application_project_id = p_application_project_id and d.draft_type = 'career_description'
      and d.status = 'generating' and j.status = 'canceled';
  delete from public.drafts d
   where d.application_project_id = p_application_project_id and d.draft_type = 'career_description'
     and d.status = 'composing';

  select d.id into v_regenerated_from from public.drafts d where d.id = p_regenerated_from_id;

  insert into public.drafts (id, user_id, application_project_id, insight_id, draft_type, title, status, options,
                             regenerated_from_id, ai_job_id, run_generation, provider, model_tier, connection_tier)
  values (v_job.target_id, v_uid, p_application_project_id, p_insight_id, 'career_description', v_title,
          'generating', p_options, v_regenerated_from, p_ai_job_id, v_job.run_generation, v_job.provider,
          v_job.model_tier, v_job.connection_tier);

  insert into public.draft_sections (user_id, draft_id, sort_order, section_kind, experience_id, education_id,
                                     heading, status)
  select v_uid, v_job.target_id, (t.o - 1)::integer, t.e ->> 'section_kind', (t.e ->> 'experience_id')::uuid,
         (t.e ->> 'education_id')::uuid, t.e ->> 'heading', 'pending'
    from jsonb_array_elements(p_sections) with ordinality as t (e, o);

  return private.career_description_begin_json(v_job.target_id, false);
end;
$$;
