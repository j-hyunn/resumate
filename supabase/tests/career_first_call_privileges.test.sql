-- S2 privilege regression: every career write path and RPC must work when its *first* call in
-- the session is made by the end role. plpgsql caches simple-expression plans per transaction,
-- so a test that first writes as postgres can hide a missing EXECUTE grant on a helper that a
-- trigger calls (found via the API integration tests: private.project_is_complete). R4: v4.4 model.
-- Rule: in this file, nothing touches career tables or S2 functions as postgres before the
-- role under test does.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated');

-- app_ai_writer first: readiness on an empty account.
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select lives_ok($$select public.get_data_readiness()$$, 'app_ai_writer: first get_data_readiness call');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok($$insert into public.experiences (id, company_name, start_month, job_rank)
                  values ('aaaaaaaa-1111-0000-0000-000000000001', 'A', '2020-01-01', 'S')$$,
                'insert experience');
select lives_ok($$update public.experiences set department = 'Platform'
                   where id = 'aaaaaaaa-1111-0000-0000-000000000001'$$, 'update experience');
select lives_ok($$insert into public.educations (id, institution_name, education_type, start_month)
                  values ('aaaaaaaa-2222-0000-0000-000000000001', 'U', 'degree', '2014-03-01')$$,
                'insert education');
select lives_ok($$update public.educations set program_name = 'CS'
                   where id = 'aaaaaaaa-2222-0000-0000-000000000001'$$, 'update education');
select lives_ok($$insert into public.projects (id, experience_id, name)
                  values ('aaaaaaaa-3333-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', 'P')$$,
                'insert affiliated project (name only, CR-6)');
select lives_ok($$update public.projects set situation = 's', action = 'a', competencies = '{analysis}'
                   where id = 'aaaaaaaa-3333-0000-0000-000000000001'$$, 'update project STAR + classification');
select is((select status from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000001'), 'complete',
          'affiliated project status computed through the user session');
select lives_ok($$insert into public.projects (id, name, description)
                  values ('aaaaaaaa-3333-0000-0000-000000000002', 'Side', 'body')$$, 'insert standalone project');
select lives_ok($$insert into public.project_deliverables (id, project_id, title)
                  values ('aaaaaaaa-4444-0000-0000-000000000001', 'aaaaaaaa-3333-0000-0000-000000000002', 'D1')$$,
                'insert deliverable (sort_order default, limit check)');
select lives_ok($$insert into public.project_deliverables (id, project_id, title, body)
                  values ('aaaaaaaa-4444-0000-0000-000000000002', 'aaaaaaaa-3333-0000-0000-000000000002', 'D2', 'x')$$,
                'insert second deliverable');
select lives_ok($$update public.project_deliverables set body = 'y'
                   where id = 'aaaaaaaa-4444-0000-0000-000000000001'$$, 'update deliverable');
select lives_ok($$insert into public.skills (id, name, is_manual)
                  values ('aaaaaaaa-6666-0000-0000-000000000001', 'Kafka', false)$$, 'insert skill');
select lives_ok($$update public.skills set proficiency = 'practical'
                   where id = 'aaaaaaaa-6666-0000-0000-000000000001'$$, 'update skill');
select lives_ok($$insert into public.project_skills (project_id, skill_id)
                  values ('aaaaaaaa-3333-0000-0000-000000000002', 'aaaaaaaa-6666-0000-0000-000000000001')$$,
                'insert project_skill (standalone check)');

select lives_ok($$select public.get_data_readiness()$$, 'authenticated: get_data_readiness');
select lives_ok($$select public.reorder_project_deliverables('aaaaaaaa-3333-0000-0000-000000000002',
                   array['aaaaaaaa-4444-0000-0000-000000000002', 'aaaaaaaa-4444-0000-0000-000000000001']::uuid[])$$,
                'reorder_project_deliverables');
select lives_ok($$select public.get_deletion_impact('experience', 'aaaaaaaa-1111-0000-0000-000000000001')$$,
                'get_deletion_impact');
select lives_ok($$select public.delete_career_item('project_deliverable', 'aaaaaaaa-4444-0000-0000-000000000001')$$,
                'delete_career_item project_deliverable');
select lives_ok($$delete from public.project_skills where skill_id = 'aaaaaaaa-6666-0000-0000-000000000001'$$,
                'delete project_skill (orphan cleanup)');
select lives_ok($$update public.projects set situation = null
                   where id = 'aaaaaaaa-3333-0000-0000-000000000001'$$, 'clear situation');
select is((select status from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000001'), 'draft',
          'project back to draft');
select throws_ok($$select public.delete_career_item('project_deliverable', gen_random_uuid())$$,
                 'P0001', 'career_item_not_found', 'delete_career_item reaches its own checks');
select lives_ok($$select public.delete_career_item('experience', 'aaaaaaaa-1111-0000-0000-000000000001')$$,
                'delete_career_item experience (projects cascade)');
select lives_ok($$select public.delete_career_item('education', 'aaaaaaaa-2222-0000-0000-000000000001')$$,
                'delete_career_item education');
select is((select count(*)::int from public.skills where id = 'aaaaaaaa-6666-0000-0000-000000000001'), 0,
          'orphan tag skill removed through the user session');
insert into public.skills (id, name) values ('aaaaaaaa-6666-0000-0000-000000000002', 'Java');
select lives_ok($$select public.delete_career_item('skill', 'aaaaaaaa-6666-0000-0000-000000000002')$$,
                'delete_career_item skill');

select * from finish();
rollback;
