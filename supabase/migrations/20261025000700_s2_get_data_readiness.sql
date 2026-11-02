-- S2 RPC: get_data_readiness() (DM §6 v3, D-01 v3, U-5). Returns the §6 JSON shape.
-- Security invoker: reads only the caller's rows through RLS. Callable by the user session and
-- by app_ai_writer (AI Route Handlers re-check readiness, DM §6), hence private.current_uid().
--
-- Inclusion rule (DM §2.2): complete rows only, and children of a draft parent
-- (experience / education / project) are excluded even when complete.

create or replace function public.get_data_readiness()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := private.current_uid();
  v_complete_experiences int;
  v_complete_educations int;
  v_complete_projects int;
  v_projects_without_complete_detail int;
  v_complete_project_details int;
  v_draft_project_details int;
  v_draft_experiences int;
  v_draft_educations int;
  v_draft_projects int;
  v_profile_filled boolean;
  v_suggested_project_id uuid;
  v_missing jsonb;
  v_hints jsonb;
  v_ready boolean;
  v_gated jsonb;
  v_sufficiency text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  -- Projects whose affiliation (if any) is complete: only these can count (DM §2.2).
  with rp as (
    select p.id, p.status, p.updated_at,
           exists (select 1 from public.project_details d
                    where d.project_id = p.id and d.status = 'complete') as has_complete_detail
      from public.projects p
      left join public.experiences e on e.id = p.experience_id
      left join public.educations ed on ed.id = p.education_id
     where p.user_id = v_uid
       and (p.experience_id is null or e.status = 'complete')
       and (p.education_id is null or ed.status = 'complete')
  )
  select (select count(*) from rp where rp.status = 'complete'),
         (select count(*) from rp where not rp.has_complete_detail),
         (select count(*) from public.project_details d
            join rp on rp.id = d.project_id and rp.status = 'complete'
           where d.status = 'complete'),
         -- augment_project candidate: an included project with no complete detail, newest first.
         (select rp.id from rp where not rp.has_complete_detail
           order by rp.updated_at desc, rp.id limit 1)
    into v_complete_projects, v_projects_without_complete_detail,
         v_complete_project_details, v_suggested_project_id;

  select count(*) filter (where status = 'complete'),
         count(*) filter (where status = 'draft')
    into v_complete_experiences, v_draft_experiences
    from public.experiences where user_id = v_uid;

  select count(*) filter (where status = 'complete'),
         count(*) filter (where status = 'draft')
    into v_complete_educations, v_draft_educations
    from public.educations where user_id = v_uid;

  select count(*) into v_draft_projects
    from public.projects where user_id = v_uid and status = 'draft';

  select count(*) into v_draft_project_details
    from public.project_details where user_id = v_uid and status = 'draft';

  -- [가정] spec-gaps 2026-10-25: any AI-visible profile field filled. display_name is not
  -- an AI input and app_ai_writer cannot read it.
  select coalesce(nullif(btrim(p.desired_job_title), '') is not null
                  or p.total_years_of_experience is not null
                  or cardinality(p.interested_industries) > 0, false)
    into v_profile_filled
    from public.profiles p where p.id = v_uid;
  v_profile_filled := coalesce(v_profile_filled, false);

  -- D-01 v3 gate shared by insight / draft / job_interview.
  v_missing := '[]'::jsonb;
  if v_complete_experiences = 0 then
    v_missing := v_missing || '["complete_experience"]'::jsonb;
  end if;
  if v_complete_projects = 0 then
    v_missing := v_missing || '["complete_project"]'::jsonb;
  end if;
  v_ready := jsonb_array_length(v_missing) = 0;

  v_hints := '[]'::jsonb;
  if v_complete_projects = 0 and v_projects_without_complete_detail > 0 then
    v_hints := v_hints || '["complete_project_detail"]'::jsonb;
  end if;
  if not v_profile_filled then
    v_hints := v_hints || '["profile"]'::jsonb;
  end if;

  v_gated := jsonb_build_object('ready', v_ready, 'missing', v_missing, 'hints', v_hints);
  if not v_ready then
    if v_complete_experiences = 0 then
      -- Writing chat does not create experiences (F-P1-16 Could) → experience form first.
      v_gated := v_gated || jsonb_build_object('next_action', 'form');
    elsif v_suggested_project_id is not null then
      v_gated := v_gated || jsonb_build_object('next_action', 'writing_chat',
                                               'suggested_mode', 'augment_project',
                                               'suggested_project_id', v_suggested_project_id);
    else
      v_gated := v_gated || jsonb_build_object('next_action', 'writing_chat',
                                               'suggested_mode', 'new_project');
    end if;
  end if;

  v_sufficiency := case
    when v_ready then 'ok'
    when v_profile_filled or v_complete_experiences > 0 or v_complete_educations > 0
         or v_complete_project_details > 0 then 'thin'
    else 'none'
  end;

  return jsonb_build_object(
    'counts', jsonb_build_object(
      'complete_experiences', v_complete_experiences,
      'complete_educations', v_complete_educations,
      'complete_projects', v_complete_projects,
      'projects_without_complete_detail', v_projects_without_complete_detail,
      'complete_project_details', v_complete_project_details,
      'draft_project_details', v_draft_project_details,
      'draft_experiences', v_draft_experiences,
      'draft_educations', v_draft_educations,
      'draft_projects', v_draft_projects,
      'profile_filled', v_profile_filled),
    'draft_item_ids', jsonb_build_object(
      'experiences', coalesce((select jsonb_agg(id order by updated_at desc, id) from public.experiences
                                where user_id = v_uid and status = 'draft'), '[]'::jsonb),
      'educations', coalesce((select jsonb_agg(id order by updated_at desc, id) from public.educations
                               where user_id = v_uid and status = 'draft'), '[]'::jsonb),
      'projects', coalesce((select jsonb_agg(id order by updated_at desc, id) from public.projects
                             where user_id = v_uid and status = 'draft'), '[]'::jsonb),
      'project_details', coalesce((select jsonb_agg(id order by updated_at desc, id) from public.project_details
                                    where user_id = v_uid and status = 'draft'), '[]'::jsonb)),
    'features', jsonb_build_object(
      'insight', v_gated,
      'draft', v_gated,
      'job_interview', v_gated,
      -- No gate for culture-fit interviews ([가정] U-5).
      'culture_fit_interview', jsonb_build_object('ready', true, 'data_sufficiency', v_sufficiency)));
end;
$$;

revoke all on function public.get_data_readiness() from public, anon;
grant execute on function public.get_data_readiness() to authenticated, app_ai_writer;
