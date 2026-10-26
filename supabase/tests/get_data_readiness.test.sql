-- S2 get_data_readiness() (DM §6 v3, D-01 v3, U-5).
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

-- B has a ready career; it must not leak into A's readiness.
insert into public.experiences (id, user_id, company_name, start_month, job_rank)
values ('bbbbbbbb-1111-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'B', '2020-01-01', 'S');
insert into public.projects (id, user_id, name, role)
values ('bbbbbbbb-3333-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'BP', 'L');
insert into public.project_details (user_id, project_id, title, situation, action)
values ('bbbbbbbb-0000-0000-0000-000000000002', 'bbbbbbbb-3333-0000-0000-000000000001', 't', 's', 'a');

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

-- 1. empty account
select is(public.get_data_readiness(), jsonb_build_object(
  'counts', jsonb_build_object(
    'complete_experiences', 0, 'complete_educations', 0, 'complete_projects', 0,
    'projects_without_complete_detail', 0, 'complete_project_details', 0, 'draft_project_details', 0,
    'draft_experiences', 0, 'draft_educations', 0, 'draft_projects', 0, 'profile_filled', false),
  'draft_item_ids', jsonb_build_object('experiences', '[]'::jsonb, 'educations', '[]'::jsonb,
                                       'projects', '[]'::jsonb, 'project_details', '[]'::jsonb),
  'features', jsonb_build_object(
    'insight', '{"ready": false, "missing": ["complete_experience", "complete_project"], "hints": ["profile"], "next_action": "form"}'::jsonb,
    'draft', '{"ready": false, "missing": ["complete_experience", "complete_project"], "hints": ["profile"], "next_action": "form"}'::jsonb,
    'job_interview', '{"ready": false, "missing": ["complete_experience", "complete_project"], "hints": ["profile"], "next_action": "form"}'::jsonb,
    'culture_fit_interview', '{"ready": true, "data_sufficiency": "none"}'::jsonb)),
  'empty account: full §6 shape, form first, data_sufficiency none (B''s data not counted)');

-- 2. profile only → thin, no profile hint
update public.profiles set desired_job_title = 'Backend' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is(public.get_data_readiness() #> '{counts,profile_filled}', 'true'::jsonb, 'profile_filled from desired_job_title');
select is(public.get_data_readiness() #> '{features,culture_fit_interview,data_sufficiency}', '"thin"'::jsonb,
          'profile only → thin');
select is(public.get_data_readiness() #> '{features,insight,hints}', '[]'::jsonb, 'no profile hint once filled');

-- 3. education only: still not ready, still form (education does not satisfy D-01)
insert into public.educations (id, institution_name, education_type, start_month)
values ('aaaaaaaa-2222-0000-0000-000000000001', 'U', 'degree', '2014-03-01');
select is(public.get_data_readiness() #> '{features,insight}',
          '{"ready": false, "missing": ["complete_experience", "complete_project"], "hints": [], "next_action": "form"}'::jsonb,
          'education only does not satisfy D-01');
select is(public.get_data_readiness() #> '{counts,complete_educations}', '1'::jsonb, 'complete education counted');

-- 4. complete experience + project whose only detail is draft → augment_project
insert into public.experiences (id, company_name, start_month, job_position)
values ('aaaaaaaa-1111-0000-0000-000000000001', 'A', '2020-01-01', 'Dev');
insert into public.projects (id, experience_id, name, role)
values ('aaaaaaaa-3333-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', 'P1', 'Dev');
insert into public.project_details (id, project_id, title)
values ('aaaaaaaa-4444-0000-0000-000000000001', 'aaaaaaaa-3333-0000-0000-000000000001', 'draft detail');

select is(public.get_data_readiness() #> '{features,draft}',
          '{"ready": false, "missing": ["complete_project"], "hints": ["complete_project_detail"],
            "next_action": "writing_chat", "suggested_mode": "augment_project",
            "suggested_project_id": "aaaaaaaa-3333-0000-0000-000000000001"}'::jsonb,
          'project without complete detail → writing_chat augment_project with its id');
select is(public.get_data_readiness() -> 'counts',
          '{"complete_experiences": 1, "complete_educations": 1, "complete_projects": 0,
            "projects_without_complete_detail": 1, "complete_project_details": 0, "draft_project_details": 1,
            "draft_experiences": 0, "draft_educations": 0, "draft_projects": 1, "profile_filled": true}'::jsonb,
          'counts for the augment case');
select is(public.get_data_readiness() -> 'draft_item_ids',
          '{"experiences": [], "educations": [], "projects": ["aaaaaaaa-3333-0000-0000-000000000001"],
            "project_details": ["aaaaaaaa-4444-0000-0000-000000000001"]}'::jsonb,
          'draft_item_ids include project and project_detail ids');
select is(public.get_data_readiness() #> '{features,culture_fit_interview,data_sufficiency}', '"thin"'::jsonb,
          'complete experience without complete project → thin');

-- 5. completing the detail → ready, no next_action / suggested_* keys
update public.project_details set situation = 's', action = 'a' where id = 'aaaaaaaa-4444-0000-0000-000000000001';
select is(public.get_data_readiness() #> '{features,insight}',
          '{"ready": true, "missing": [], "hints": []}'::jsonb, 'D-01 met → ready, gate keys omitted');
select is(public.get_data_readiness() #> '{features,job_interview}', public.get_data_readiness() #> '{features,insight}',
          'job_interview uses the same gate');
select is(public.get_data_readiness() #> '{features,culture_fit_interview}',
          '{"ready": true, "data_sufficiency": "ok"}'::jsonb, 'culture fit ok when D-01 met');
select is(public.get_data_readiness() #>> '{counts,complete_project_details}', '1', 'complete detail counted');

-- 6. draft parent excludes complete children: move the project under a draft experience
insert into public.experiences (id, company_name) values ('aaaaaaaa-1111-0000-0000-000000000002', 'draft exp');
update public.projects set experience_id = 'aaaaaaaa-1111-0000-0000-000000000002'
 where id = 'aaaaaaaa-3333-0000-0000-000000000001';
select is(public.get_data_readiness() #> '{features,insight}',
          '{"ready": false, "missing": ["complete_project"], "hints": [],
            "next_action": "writing_chat", "suggested_mode": "new_project"}'::jsonb,
          'complete project under a draft experience is excluded → new_project');
select results_eq(
  $$select (r #>> '{counts,complete_projects}')::int, (r #>> '{counts,complete_project_details}')::int,
           (r #>> '{counts,projects_without_complete_detail}')::int, (r #>> '{counts,draft_experiences}')::int
      from (select public.get_data_readiness() r) x$$,
  $$values (0, 0, 0, 1)$$, 'draft parent: project and its detail not counted');

-- an education-affiliated complete project counts (affiliation can be experience, education, or none)
update public.projects set experience_id = null, education_id = 'aaaaaaaa-2222-0000-0000-000000000001'
 where id = 'aaaaaaaa-3333-0000-0000-000000000001';
select is(public.get_data_readiness() #> '{features,insight,ready}', 'true'::jsonb,
          'project under a complete education counts toward D-01');

-- 7. app_ai_writer gets the same answer for the JWT user
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.get_data_readiness() #> '{features,insight,ready}', 'true'::jsonb,
          'app_ai_writer can run get_data_readiness for the user');
select is(public.get_data_readiness() #>> '{counts,complete_experiences}', '1', 'app_ai_writer sees A''s counts only');

-- 8. auth errors
reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated"}';
select throws_ok($$select public.get_data_readiness()$$, '42501', 'not_authenticated', 'no sub → not_authenticated');

reset role;
set local role anon;
select throws_ok($$select public.get_data_readiness()$$, '42501', null, 'anon cannot execute get_data_readiness');

select * from finish();
rollback;
