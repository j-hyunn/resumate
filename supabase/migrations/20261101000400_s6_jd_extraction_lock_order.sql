-- QA-S5-06: the ai_jobs end trigger (S5, QA-S5-02) ran with the ai_jobs row locked and then waited for the
-- application_projects row (ai_jobs -> project -> JD). A project delete locks the project first and reaches the
-- ai_jobs / JD rows through its FK cascade (project -> JD / ai_jobs), so the two could deadlock (40P01).
-- Fix (forward migration; S5 is committed): the trigger path takes the project row with SKIP LOCKED and does
-- nothing when it can't (the JD goes away with the project anyway). fail_jd_extraction keeps waiting (it holds no
-- ai_jobs lock). A JD left `running` by a skipped trigger (a short concurrent writer on the project row) is taken
-- over by begin_jd_extraction (its job has ended) and should read as failed (api: running + ended job).

create or replace function private.jd_extraction_mark_failed(
  p_job_description_id uuid,
  p_ai_job_id uuid,
  p_skip_locked boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.application_projects%rowtype;
  v_jd public.job_descriptions%rowtype;
begin
  if p_skip_locked then
    select ap.* into v_project
      from public.application_projects ap
      join public.job_descriptions jd on jd.application_project_id = ap.id
     where jd.id = p_job_description_id
       for update of ap skip locked;
  else
    select ap.* into v_project
      from public.application_projects ap
      join public.job_descriptions jd on jd.application_project_id = ap.id
     where jd.id = p_job_description_id
       for update of ap;
  end if;
  if not found then
    return false;
  end if;

  -- Safe to wait here: every JD writer takes the project row first.
  select * into v_jd from public.job_descriptions jd where jd.id = p_job_description_id for update;
  if not found then
    return false;
  end if;

  if v_jd.extraction_status <> 'running' or v_jd.extraction_job_id is distinct from p_ai_job_id then
    return false;
  end if;

  update public.job_descriptions jd set extraction_status = 'failed' where jd.id = p_job_description_id;

  if v_project.name is null then
    update public.application_projects ap
       set (name, name_source) = (
         select f.name, f.name_source
           from private.application_fallback_name(v_jd.company_name, v_jd.position_title, v_project.created_at) f)
     where ap.id = v_project.id;
  end if;

  return true;
end;
$$;

revoke all on function private.jd_extraction_mark_failed(uuid, uuid, boolean) from public;

create or replace function public.fail_jd_extraction(p_job_description_id uuid, p_ai_job_id uuid)
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
  if not exists (select 1 from public.job_descriptions jd
                  where jd.id = p_job_description_id and jd.user_id = v_uid) then
    raise exception using errcode = 'P0001', message = 'job_description_not_found';
  end if;
  return private.jd_extraction_mark_failed(p_job_description_id, p_ai_job_id, false);
end;
$$;

create or replace function private.ai_jobs_release_jd_extraction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.job_type = 'jd_extraction' and new.target_type = 'job_description'
     and new.status in ('failed', 'canceled') and old.status is distinct from new.status then
    perform private.jd_extraction_mark_failed(new.target_id, new.id, true);
  end if;
  return null;
end;
$$;

drop function private.jd_extraction_mark_failed(uuid, uuid);
