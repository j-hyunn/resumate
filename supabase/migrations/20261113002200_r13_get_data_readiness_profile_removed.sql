-- R13 ⑧ get_data_readiness: profile_filled / "profile" hint removed (DM v4.12 §6, §6-A; SD-A18, SD-6).
-- Taken from 20261109101200 (the newest definition) with exactly three edits, nothing else:
--   1. counts.profile_filled — the key is GONE from the response (not false).
--   2. features.*.hints no longer ever contains "profile" (the "ready여도 붙인다" rule is gone too).
--   3. data_sufficiency 'thin' = D-01 미충족이지만 complete 경력·교육·프로젝트가 하나라도 있음
--      ("프로필 또는" dropped — 프로필은 AI 입력이 아니라 데이터 양의 근거가 될 수 없다, SD-6).
-- Every other judgement (D-01 gate, next_action order, suggested_project_id, ai_connection, draft_item_ids)
-- is unchanged. Signature, security (invoker) and grants are unchanged.
-- The three profiles columns the old flag read are dropped in R13 ⑭, so this must be deployed first.

create or replace function public.get_data_readiness()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := private.current_uid();
  v_complete_experiences int;
  v_complete_educations int;
  v_complete_projects int;
  v_without_star int;
  v_standalone_without_description int;
  v_draft_experiences int;
  v_draft_educations int;
  v_draft_projects int;
  v_star_project_id uuid;
  v_fields_project_id uuid;
  v_missing jsonb;
  v_hints jsonb;
  v_ready boolean;
  v_gated jsonb;
  v_sufficiency text;
  v_ai_connection jsonb;
  v_ai_usable boolean;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  -- Projects that can count (DM §2.2): standalone, or under a complete experience / education.
  with rp as (
    select p.id, p.status, p.updated_at,
           num_nonnulls(p.experience_id, p.education_id) = 1 as affiliated
      from public.projects p
      left join public.experiences e on e.id = p.experience_id
      left join public.educations ed on ed.id = p.education_id
     where p.user_id = v_uid
       and (p.experience_id is null or e.status = 'complete')
       and (p.education_id is null or ed.status = 'complete')
  )
  select (select count(*) from rp where rp.status = 'complete'),
         (select count(*) from rp where rp.affiliated and rp.status = 'draft'),
         (select count(*) from rp where not rp.affiliated and rp.status = 'draft'),
         (select rp.id from rp where rp.affiliated and rp.status = 'draft'
           order by rp.updated_at desc, rp.id limit 1),
         (select rp.id from rp where not rp.affiliated and rp.status = 'draft'
           order by rp.updated_at desc, rp.id limit 1)
    into v_complete_projects, v_without_star, v_standalone_without_description,
         v_star_project_id, v_fields_project_id;

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

  -- D-01 v4.4 gate shared by insight / draft / job_interview.
  v_missing := '[]'::jsonb;
  if v_complete_experiences = 0 then
    v_missing := v_missing || '["complete_experience"]'::jsonb;
  end if;
  if v_complete_projects = 0 then
    v_missing := v_missing || '["complete_project"]'::jsonb;
  end if;
  v_ready := jsonb_array_length(v_missing) = 0;

  -- Hints follow the next_action order: STAR first, then a standalone project's description.
  v_hints := '[]'::jsonb;
  if v_complete_projects = 0 and v_without_star > 0 then
    v_hints := v_hints || '["project_star"]'::jsonb;
  elsif v_complete_projects = 0 and v_standalone_without_description > 0 then
    v_hints := v_hints || '["project_fields"]'::jsonb;
  end if;

  v_ai_connection := private.current_ai_connection();
  -- "AI usable" = an active provider whose key is not invalid (needs_check is usable; consent is not used here).
  v_ai_usable := v_ai_connection ->> 'active_provider' is not null
                 and v_ai_connection ->> 'key_status' is distinct from 'invalid';

  v_gated := jsonb_build_object('ready', v_ready, 'missing', v_missing, 'hints', v_hints);
  if not v_ready then
    if v_complete_experiences = 0 then
      v_gated := v_gated || jsonb_build_object('next_action', 'form');
    elsif v_without_star > 0 then
      v_gated := v_gated || jsonb_build_object(
        'next_action', case when v_ai_usable then 'writing_chat' else 'form' end,
        'suggested_project_id', v_star_project_id);
    elsif v_standalone_without_description > 0 then
      v_gated := v_gated || jsonb_build_object('next_action', 'form', 'suggested_project_id', v_fields_project_id);
    else
      v_gated := v_gated || jsonb_build_object(
        'next_action', case when v_ai_usable then 'create_project' else 'form' end);
    end if;
  end if;

  v_sufficiency := case
    when v_ready then 'ok'
    when v_complete_experiences > 0 or v_complete_educations > 0
         or v_complete_projects > 0 then 'thin'
    else 'none'
  end;

  return jsonb_build_object(
    'ai_connection', v_ai_connection,
    'counts', jsonb_build_object(
      'complete_experiences', v_complete_experiences,
      'complete_educations', v_complete_educations,
      'complete_projects', v_complete_projects,
      'projects_without_complete_star', v_without_star,
      'standalone_projects_without_description', v_standalone_without_description,
      'draft_experiences', v_draft_experiences,
      'draft_educations', v_draft_educations,
      'draft_projects', v_draft_projects),
    'draft_item_ids', jsonb_build_object(
      'experiences', coalesce((select jsonb_agg(id order by updated_at desc, id) from public.experiences
                                where user_id = v_uid and status = 'draft'), '[]'::jsonb),
      'educations', coalesce((select jsonb_agg(id order by updated_at desc, id) from public.educations
                               where user_id = v_uid and status = 'draft'), '[]'::jsonb),
      'projects', coalesce((select jsonb_agg(id order by updated_at desc, id) from public.projects
                             where user_id = v_uid and status = 'draft'), '[]'::jsonb)),
    'features', jsonb_build_object(
      'insight', v_gated,
      'draft', v_gated,
      'job_interview', v_gated,
      'culture_fit_interview', jsonb_build_object('ready', true, 'data_sufficiency', v_sufficiency)));
end;
$$;
