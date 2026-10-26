-- S2 get_deletion_impact / delete_career_item / reorder_project_details (DM §4.1, §4.2, §7).
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

insert into public.experiences (id, user_id, company_name)
values ('bbbbbbbb-1111-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'B');
insert into public.projects (id, user_id, name)
values ('bbbbbbbb-3333-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'BP');

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

-- Fixture for A:
--   E1 (complete) ─ P1 ─ D1 (complete) ─ ACH1, ACH2
--                │      └ D2 (draft)
--                │      tags: S1 (tag, only P1), S2 (manual)
--                ├ P2 ─ D3 ─ ACH3
--                └ ACH-E (experience-level)
--   ED1 ─ P3 ─ D4
insert into public.experiences (id, company_name, start_month, job_rank)
values ('aaaaaaaa-1111-0000-0000-000000000001', 'A', '2020-01-01', 'S');
insert into public.educations (id, institution_name, education_type, start_month)
values ('aaaaaaaa-2222-0000-0000-000000000001', 'U', 'degree', '2014-03-01');
insert into public.projects (id, experience_id, education_id, name, role) values
  ('aaaaaaaa-3333-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', null, 'P1', 'Dev'),
  ('aaaaaaaa-3333-0000-0000-000000000002', 'aaaaaaaa-1111-0000-0000-000000000001', null, 'P2', 'Dev'),
  ('aaaaaaaa-3333-0000-0000-000000000003', null, 'aaaaaaaa-2222-0000-0000-000000000001', 'P3', 'Dev');
insert into public.project_details (id, project_id, title, situation, action) values
  ('aaaaaaaa-4444-0000-0000-000000000001', 'aaaaaaaa-3333-0000-0000-000000000001', 'D1', 's', 'a'),
  ('aaaaaaaa-4444-0000-0000-000000000002', 'aaaaaaaa-3333-0000-0000-000000000001', 'D2', null, null),
  ('aaaaaaaa-4444-0000-0000-000000000003', 'aaaaaaaa-3333-0000-0000-000000000002', 'D3', 's', 'a'),
  ('aaaaaaaa-4444-0000-0000-000000000004', 'aaaaaaaa-3333-0000-0000-000000000003', 'D4', 's', 'a');
insert into public.achievements (id, project_detail_id, experience_id, description) values
  ('aaaaaaaa-5555-0000-0000-000000000001', 'aaaaaaaa-4444-0000-0000-000000000001', null, 'ach1'),
  ('aaaaaaaa-5555-0000-0000-000000000002', 'aaaaaaaa-4444-0000-0000-000000000001', null, 'ach2'),
  ('aaaaaaaa-5555-0000-0000-000000000003', 'aaaaaaaa-4444-0000-0000-000000000003', null, 'ach3'),
  ('aaaaaaaa-5555-0000-0000-000000000004', null, 'aaaaaaaa-1111-0000-0000-000000000001', 'ach-e');
insert into public.skills (id, name, is_manual) values
  ('aaaaaaaa-6666-0000-0000-000000000001', 'Kafka', false),
  ('aaaaaaaa-6666-0000-0000-000000000002', 'Java', true);
insert into public.project_skills (project_id, skill_id) values
  ('aaaaaaaa-3333-0000-0000-000000000001', 'aaaaaaaa-6666-0000-0000-000000000001'),
  ('aaaaaaaa-3333-0000-0000-000000000001', 'aaaaaaaa-6666-0000-0000-000000000002'),
  ('aaaaaaaa-3333-0000-0000-000000000002', 'aaaaaaaa-6666-0000-0000-000000000002');

-- ── get_deletion_impact ───────────────────────────────────────────────────
select is(public.get_deletion_impact('experience', 'aaaaaaaa-1111-0000-0000-000000000001'),
          '{"cascade": {"projects": 0, "project_details": 0, "achievements": 1, "project_skills": 0, "writing_chats": 0},
            "affected_results": {"by_application_project": []}}'::jsonb,
          'experience + keep_projects (default): only experience-level achievements go');
select is(public.get_deletion_impact('experience', 'aaaaaaaa-1111-0000-0000-000000000001', 'delete_projects') -> 'cascade',
          '{"projects": 2, "project_details": 3, "achievements": 4, "project_skills": 3, "writing_chats": 0}'::jsonb,
          'experience + delete_projects: projects and everything under them');
select is(public.get_deletion_impact('education', 'aaaaaaaa-2222-0000-0000-000000000001', 'keep_projects') -> 'cascade',
          '{"projects": 0, "project_details": 0, "achievements": 0, "project_skills": 0, "writing_chats": 0}'::jsonb,
          'education + keep_projects: nothing cascades');
select is(public.get_deletion_impact('education', 'aaaaaaaa-2222-0000-0000-000000000001', 'delete_projects') -> 'cascade',
          '{"projects": 1, "project_details": 1, "achievements": 0, "project_skills": 0, "writing_chats": 0}'::jsonb,
          'education + delete_projects');
select is(public.get_deletion_impact('project', 'aaaaaaaa-3333-0000-0000-000000000001') -> 'cascade',
          '{"projects": 0, "project_details": 2, "achievements": 2, "project_skills": 2, "writing_chats": 0}'::jsonb,
          'project: its details, their achievements, its tags (target excluded)');
select is(public.get_deletion_impact('project_detail', 'aaaaaaaa-4444-0000-0000-000000000001') -> 'cascade',
          '{"projects": 0, "project_details": 0, "achievements": 2, "project_skills": 0, "writing_chats": 0}'::jsonb,
          'project_detail: its achievements');
select is(public.get_deletion_impact('achievement', 'aaaaaaaa-5555-0000-0000-000000000001') -> 'cascade',
          '{"projects": 0, "project_details": 0, "achievements": 0, "project_skills": 0, "writing_chats": 0}'::jsonb,
          'achievement: nothing cascades');
select is(public.get_deletion_impact('skill', 'aaaaaaaa-6666-0000-0000-000000000002') -> 'cascade',
          '{"projects": 0, "project_details": 0, "achievements": 0, "project_skills": 2, "writing_chats": 0}'::jsonb,
          'skill: its project links');

select throws_ok($$select public.get_deletion_impact('writing_chat', 'aaaaaaaa-1111-0000-0000-000000000001')$$,
                 'P0001', 'invalid_entity_type', 'writing_chat not supported until S4');
select throws_ok($$select public.get_deletion_impact(null, 'aaaaaaaa-1111-0000-0000-000000000001')$$,
                 'P0001', 'invalid_entity_type', 'null entity_type rejected');
select throws_ok($$select public.get_deletion_impact('experience', 'aaaaaaaa-1111-0000-0000-000000000001', 'orphan')$$,
                 'P0001', 'invalid_affiliation_mode', 'unknown affiliation_mode rejected');
select throws_ok($$select public.get_deletion_impact('experience', 'bbbbbbbb-1111-0000-0000-000000000001')$$,
                 'P0001', 'career_item_not_found', 'B''s experience is not found for A');
select throws_ok($$select public.get_deletion_impact('project', gen_random_uuid())$$,
                 'P0001', 'career_item_not_found', 'unknown id is not found');

-- ── delete_career_item ───────────────────────────────────────────────────
select throws_ok($$select public.delete_career_item('project', 'aaaaaaaa-3333-0000-0000-000000000001', 'keep_projects', 'keep')$$,
                 'P0001', 'invalid_result_mode', 'unknown result_mode rejected');
select throws_ok($$select public.delete_career_item('project', 'bbbbbbbb-3333-0000-0000-000000000001')$$,
                 'P0001', 'career_item_not_found', 'A cannot delete B''s project');
select throws_ok($$select public.delete_career_item('writing_chat', 'aaaaaaaa-3333-0000-0000-000000000001')$$,
                 'P0001', 'invalid_entity_type', 'delete: invalid entity_type');
select is((select count(*)::int from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000001'), 1,
          'failed calls deleted nothing');

-- detail delete: the last complete detail of P1 → P1 draft
select is(public.delete_career_item('project_detail', 'aaaaaaaa-4444-0000-0000-000000000001'),
          '{"entity_type": "project_detail", "entity_id": "aaaaaaaa-4444-0000-0000-000000000001",
            "affiliation_mode": "keep_projects", "result_mode": "keep_results",
            "cascade": {"projects": 0, "project_details": 0, "achievements": 2, "project_skills": 0, "writing_chats": 0},
            "affected_results": {"by_application_project": []}}'::jsonb,
          'delete project_detail returns the counted cascade and modes');
select is((select count(*)::int from public.achievements
            where id in ('aaaaaaaa-5555-0000-0000-000000000001', 'aaaaaaaa-5555-0000-0000-000000000002')),
          0, 'detail achievements cascaded');
select is((select status from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000001'), 'draft',
          'deleting the last complete detail returns the project to draft');

-- experience + keep_projects: projects become standalone
select is(public.delete_career_item('experience', 'aaaaaaaa-1111-0000-0000-000000000001', 'keep_projects', 'delete_results')
            -> 'cascade',
          '{"projects": 0, "project_details": 0, "achievements": 1, "project_skills": 0, "writing_chats": 0}'::jsonb,
          'delete experience (keep_projects, delete_results)');
select is((select count(*)::int from public.projects
            where id in ('aaaaaaaa-3333-0000-0000-000000000001', 'aaaaaaaa-3333-0000-0000-000000000002')
              and experience_id is null),
          2, 'projects of the deleted experience remain standalone');
select is((select count(*)::int from public.achievements where id = 'aaaaaaaa-5555-0000-0000-000000000004'), 0,
          'experience-level achievement deleted');

-- project delete: details, achievements, tags; orphan tag skill removed, manual skill kept
select is(public.delete_career_item('project', 'aaaaaaaa-3333-0000-0000-000000000001') -> 'cascade',
          '{"projects": 0, "project_details": 1, "achievements": 0, "project_skills": 2, "writing_chats": 0}'::jsonb,
          'delete project');
select is((select count(*)::int from public.project_details where project_id = 'aaaaaaaa-3333-0000-0000-000000000001'),
          0, 'project details cascaded');
select is((select count(*)::int from public.skills where id = 'aaaaaaaa-6666-0000-0000-000000000001'), 0,
          'tag-only skill removed once its project is deleted');
select is((select count(*)::int from public.skills where id = 'aaaaaaaa-6666-0000-0000-000000000002'), 1,
          'manual skill kept');

-- education + delete_projects
select is(public.delete_career_item('education', 'aaaaaaaa-2222-0000-0000-000000000001', 'delete_projects') -> 'cascade',
          '{"projects": 1, "project_details": 1, "achievements": 0, "project_skills": 0, "writing_chats": 0}'::jsonb,
          'delete education with delete_projects');
select is((select count(*)::int from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000003'), 0,
          'education project deleted with delete_projects');

-- skill / achievement
select is(public.delete_career_item('skill', 'aaaaaaaa-6666-0000-0000-000000000002') -> 'cascade',
          '{"projects": 0, "project_details": 0, "achievements": 0, "project_skills": 1, "writing_chats": 0}'::jsonb,
          'delete skill removes its links');
select is((select count(*)::int from public.project_skills), 0, 'no links left');
select is(public.delete_career_item('achievement', 'aaaaaaaa-5555-0000-0000-000000000003') ->> 'entity_type',
          'achievement', 'delete achievement');
select is((select count(*)::int from public.achievements), 0, 'achievement gone');

reset role;
select is((select count(*)::int from public.experiences where user_id = 'bbbbbbbb-0000-0000-0000-000000000002')
          + (select count(*)::int from public.projects where user_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
          2, 'B''s rows untouched');

-- ── reorder_project_details ──────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
insert into public.projects (id, name, role) values ('aaaaaaaa-3333-0000-0000-000000000009', 'R', 'Dev');
insert into public.project_details (id, project_id, title) values
  ('aaaaaaaa-4444-0000-0000-000000000091', 'aaaaaaaa-3333-0000-0000-000000000009', 'one'),
  ('aaaaaaaa-4444-0000-0000-000000000092', 'aaaaaaaa-3333-0000-0000-000000000009', 'two'),
  ('aaaaaaaa-4444-0000-0000-000000000093', 'aaaaaaaa-3333-0000-0000-000000000009', 'three');

reset role;
alter table public.project_details disable trigger project_details_set_updated_at;
update public.project_details set updated_at = '2000-01-01' where project_id = 'aaaaaaaa-3333-0000-0000-000000000009';
alter table public.project_details enable trigger project_details_set_updated_at;
set local role authenticated;

select lives_ok($$select public.reorder_project_details('aaaaaaaa-3333-0000-0000-000000000009',
                    array['aaaaaaaa-4444-0000-0000-000000000093', 'aaaaaaaa-4444-0000-0000-000000000091',
                          'aaaaaaaa-4444-0000-0000-000000000092']::uuid[])$$, 'reorder succeeds');
set constraints all immediate;
set constraints all deferred;
select results_eq($$select title from public.project_details
                     where project_id = 'aaaaaaaa-3333-0000-0000-000000000009' order by sort_order$$,
                  array['three', 'one', 'two'], 'details follow the new order');
select results_eq($$select sort_order::int from public.project_details
                     where project_id = 'aaaaaaaa-3333-0000-0000-000000000009' order by sort_order$$,
                  array[1, 2, 3], 'sort_order renumbered 1..n');
select is((select count(*)::int from public.project_details
            where project_id = 'aaaaaaaa-3333-0000-0000-000000000009' and updated_at = '2000-01-01'),
          3, 'a pure reorder does not bump updated_at');

select throws_ok($$select public.reorder_project_details('aaaaaaaa-3333-0000-0000-000000000009',
                    array['aaaaaaaa-4444-0000-0000-000000000093', 'aaaaaaaa-4444-0000-0000-000000000091']::uuid[])$$,
                 'P0001', 'invalid_detail_order', 'missing id rejected');
select throws_ok($$select public.reorder_project_details('aaaaaaaa-3333-0000-0000-000000000009',
                    array['aaaaaaaa-4444-0000-0000-000000000093', 'aaaaaaaa-4444-0000-0000-000000000093',
                          'aaaaaaaa-4444-0000-0000-000000000091']::uuid[])$$,
                 'P0001', 'invalid_detail_order', 'duplicate id rejected');
select throws_ok($$select public.reorder_project_details('aaaaaaaa-3333-0000-0000-000000000009',
                    array['aaaaaaaa-4444-0000-0000-000000000093', 'aaaaaaaa-4444-0000-0000-000000000091',
                          'aaaaaaaa-4444-0000-0000-000000000092', gen_random_uuid()]::uuid[])$$,
                 'P0001', 'invalid_detail_order', 'foreign id rejected');
select throws_ok($$select public.reorder_project_details('aaaaaaaa-3333-0000-0000-000000000009',
                    array['aaaaaaaa-4444-0000-0000-000000000093', null, 'aaaaaaaa-4444-0000-0000-000000000092']::uuid[])$$,
                 'P0001', 'invalid_detail_order', 'null id rejected');
select throws_ok($$select public.reorder_project_details('bbbbbbbb-3333-0000-0000-000000000001', '{}'::uuid[])$$,
                 'P0001', 'career_item_not_found', 'cannot reorder B''s project');
select lives_ok($$select public.reorder_project_details('aaaaaaaa-3333-0000-0000-000000000009',
                    array['aaaaaaaa-4444-0000-0000-000000000091', 'aaaaaaaa-4444-0000-0000-000000000092',
                          'aaaaaaaa-4444-0000-0000-000000000093']::uuid[])$$, 'second reorder in the same transaction');
set constraints all immediate;
select pass('deferred unique constraint holds after two reorders');
set constraints all deferred;

-- ── auth / role limits ───────────────────────────────────────────────────
set local request.jwt.claims = '{"role":"authenticated"}';
select throws_ok($$select public.get_deletion_impact('project', gen_random_uuid())$$,
                 '42501', 'not_authenticated', 'impact: no sub → not_authenticated');
select throws_ok($$select public.reorder_project_details(gen_random_uuid(), '{}'::uuid[])$$,
                 '42501', 'not_authenticated', 'reorder: no sub → not_authenticated');

reset role;
select ok(not has_function_privilege('app_ai_writer', 'public.delete_career_item(text, uuid, text, text)', 'execute'),
          'app_ai_writer cannot execute delete_career_item');
select ok(not has_function_privilege('app_ai_writer', 'public.get_deletion_impact(text, uuid, text)', 'execute'),
          'app_ai_writer cannot execute get_deletion_impact');
select ok(not has_function_privilege('app_ai_writer', 'public.reorder_project_details(uuid, uuid[])', 'execute'),
          'app_ai_writer cannot execute reorder_project_details');
set local role anon;
select throws_ok($$select public.delete_career_item('project', gen_random_uuid())$$, '42501', null,
                 'anon cannot execute delete_career_item');

select * from finish();
rollback;
