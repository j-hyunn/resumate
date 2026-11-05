-- S2 → R4 get_deletion_impact / delete_career_item (DM v4.4 §4.1, §4.2; CR-15). reorder_project_deliverables is
-- covered in career_tables.test.sql.
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
--   E1 ─ P1 (affiliated, 2 chats)
--      └ P2 (affiliated)
--   ED1 ─ P3 (affiliated, 1 chat)
--   SP (standalone) ─ DL1, DL2 deliverables; tags: S1 (tag, only SP), S2 (manual, SP + SP2)
--   SP2 (standalone) ─ tag S2
insert into public.experiences (id, company_name, start_month, job_rank)
values ('aaaaaaaa-1111-0000-0000-000000000001', 'A', '2020-01-01', 'S');
insert into public.educations (id, institution_name, education_type, start_month)
values ('aaaaaaaa-2222-0000-0000-000000000001', 'U', 'degree', '2014-03-01');
insert into public.projects (id, experience_id, education_id, name, situation, action) values
  ('aaaaaaaa-3333-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', null, 'P1', 's', 'a'),
  ('aaaaaaaa-3333-0000-0000-000000000002', 'aaaaaaaa-1111-0000-0000-000000000001', null, 'P2', null, null),
  ('aaaaaaaa-3333-0000-0000-000000000003', null, 'aaaaaaaa-2222-0000-0000-000000000001', 'P3', 's', 'a');
insert into public.projects (id, name, description) values
  ('aaaaaaaa-3333-0000-0000-000000000004', 'SP', 'd'),
  ('aaaaaaaa-3333-0000-0000-000000000005', 'SP2', 'd');
insert into public.project_deliverables (id, project_id, title) values
  ('aaaaaaaa-4444-0000-0000-000000000001', 'aaaaaaaa-3333-0000-0000-000000000004', 'DL1'),
  ('aaaaaaaa-4444-0000-0000-000000000002', 'aaaaaaaa-3333-0000-0000-000000000004', 'DL2');
insert into public.skills (id, name, is_manual) values
  ('aaaaaaaa-6666-0000-0000-000000000001', 'Kafka', false),
  ('aaaaaaaa-6666-0000-0000-000000000002', 'Java', true);
insert into public.project_skills (project_id, skill_id) values
  ('aaaaaaaa-3333-0000-0000-000000000004', 'aaaaaaaa-6666-0000-0000-000000000001'),
  ('aaaaaaaa-3333-0000-0000-000000000004', 'aaaaaaaa-6666-0000-0000-000000000002'),
  ('aaaaaaaa-3333-0000-0000-000000000005', 'aaaaaaaa-6666-0000-0000-000000000002');
select set_config('t.c1', public.start_writing_chat('aaaaaaaa-3333-0000-0000-000000000001')::text, true);
select set_config('t.c2', public.start_writing_chat('aaaaaaaa-3333-0000-0000-000000000001')::text, true);
select set_config('t.c3', public.start_writing_chat('aaaaaaaa-3333-0000-0000-000000000003')::text, true);

-- ── get_deletion_impact ───────────────────────────────────────────────────
select is(public.get_deletion_impact('experience', 'aaaaaaaa-1111-0000-0000-000000000001'),
          '{"cascade": {"projects": 2, "project_deliverables": 0, "project_skills": 0, "writing_chats": 2},
            "affected_results": {"by_application_project": [], "detached_interview_sessions": 0}}'::jsonb,
          'experience (default delete_projects): its projects and their chats');
select is(public.get_deletion_impact('experience', 'aaaaaaaa-1111-0000-0000-000000000001', 'delete_projects') -> 'cascade',
          '{"projects": 2, "project_deliverables": 0, "project_skills": 0, "writing_chats": 2}'::jsonb,
          'experience + explicit delete_projects');
select is(public.get_deletion_impact('education', 'aaaaaaaa-2222-0000-0000-000000000001') -> 'cascade',
          '{"projects": 1, "project_deliverables": 0, "project_skills": 0, "writing_chats": 1}'::jsonb,
          'education: its project and chat');
select is(public.get_deletion_impact('project', 'aaaaaaaa-3333-0000-0000-000000000001') -> 'cascade',
          '{"projects": 0, "project_deliverables": 0, "project_skills": 0, "writing_chats": 2}'::jsonb,
          'affiliated project: its chats (target excluded)');
select is(public.get_deletion_impact('project', 'aaaaaaaa-3333-0000-0000-000000000004') -> 'cascade',
          '{"projects": 0, "project_deliverables": 2, "project_skills": 2, "writing_chats": 0}'::jsonb,
          'standalone project: deliverables and tags');
select is(public.get_deletion_impact('project_deliverable', 'aaaaaaaa-4444-0000-0000-000000000001') -> 'cascade',
          '{"projects": 0, "project_deliverables": 0, "project_skills": 0, "writing_chats": 0}'::jsonb,
          'deliverable: nothing cascades');
select is(public.get_deletion_impact('skill', 'aaaaaaaa-6666-0000-0000-000000000002') -> 'cascade',
          '{"projects": 0, "project_deliverables": 0, "project_skills": 2, "writing_chats": 0}'::jsonb,
          'skill: its project links');
select is(public.get_deletion_impact('writing_chat', current_setting('t.c1')::uuid),
          '{"message_count": 0, "last_applied_at": null}'::jsonb,
          'writing_chat: {message_count, last_applied_at} only; message_count = column (greeting excluded, QA-R4-03)');

select throws_ok($$select public.get_deletion_impact('experience', 'aaaaaaaa-1111-0000-0000-000000000001', 'keep_projects')$$,
                 'P0001', 'affiliation_mode_not_supported', 'keep_projects is no longer supported (CR-15)');
select throws_ok($$select public.get_deletion_impact('project_detail', 'aaaaaaaa-1111-0000-0000-000000000001')$$,
                 'P0001', 'invalid_entity_type', 'project_detail is retired');
select throws_ok($$select public.get_deletion_impact('achievement', 'aaaaaaaa-1111-0000-0000-000000000001')$$,
                 'P0001', 'invalid_entity_type', 'achievement is retired');
select throws_ok($$select public.get_deletion_impact('writing_chat', 'aaaaaaaa-1111-0000-0000-000000000001')$$,
                 'P0001', 'career_item_not_found', 'writing_chat: an id that is not a chat is not found');
select throws_ok($$select public.get_deletion_impact('chat', 'aaaaaaaa-1111-0000-0000-000000000001')$$,
                 'P0001', 'invalid_entity_type', 'unknown entity_type rejected');
select throws_ok($$select public.get_deletion_impact(null, 'aaaaaaaa-1111-0000-0000-000000000001')$$,
                 'P0001', 'invalid_entity_type', 'null entity_type rejected');
select throws_ok($$select public.get_deletion_impact('experience', 'aaaaaaaa-1111-0000-0000-000000000001', 'orphan')$$,
                 'P0001', 'invalid_affiliation_mode', 'unknown affiliation_mode rejected');
select throws_ok($$select public.get_deletion_impact('experience', 'bbbbbbbb-1111-0000-0000-000000000001')$$,
                 'P0001', 'career_item_not_found', 'B''s experience is not found for A');
select throws_ok($$select public.get_deletion_impact('project_deliverable', gen_random_uuid())$$,
                 'P0001', 'career_item_not_found', 'unknown id is not found');

-- ── delete_career_item ───────────────────────────────────────────────────
select throws_ok($$select public.delete_career_item('project', 'aaaaaaaa-3333-0000-0000-000000000001', 'delete_projects', 'keep')$$,
                 'P0001', 'invalid_result_mode', 'unknown result_mode rejected');
select throws_ok($$select public.delete_career_item('project', 'bbbbbbbb-3333-0000-0000-000000000001')$$,
                 'P0001', 'career_item_not_found', 'A cannot delete B''s project');
select throws_ok($$select public.delete_career_item('experience', 'aaaaaaaa-1111-0000-0000-000000000001', 'keep_projects')$$,
                 'P0001', 'affiliation_mode_not_supported', 'delete: keep_projects rejected');
select throws_ok($$select public.delete_career_item('writing_chat', 'aaaaaaaa-3333-0000-0000-000000000001')$$,
                 'P0001', 'career_item_not_found', 'delete: a project id is not a writing chat');
select is((select count(*)::int from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000001'), 1,
          'failed calls deleted nothing');

-- deliverable delete: parent status unchanged
select is(public.delete_career_item('project_deliverable', 'aaaaaaaa-4444-0000-0000-000000000001'),
          '{"entity_type": "project_deliverable", "entity_id": "aaaaaaaa-4444-0000-0000-000000000001",
            "affiliation_mode": "delete_projects", "result_mode": "keep_results",
            "cascade": {"projects": 0, "project_deliverables": 0, "project_skills": 0, "writing_chats": 0},
            "affected_results": {"by_application_project": [], "detached_interview_sessions": 0}}'::jsonb,
          'delete project_deliverable returns the counted cascade and modes');
select is((select status from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000004'), 'complete',
          'deleting a deliverable leaves the parent status');

-- writing chat delete: messages go, the project stays
select is(public.delete_career_item('writing_chat', current_setting('t.c2')::uuid) ->> 'entity_type', 'writing_chat',
          'delete writing_chat');
select is((select count(*)::int from public.writing_chat_messages where writing_chat_id = current_setting('t.c2')::uuid), 0,
          'chat messages cascaded');

-- experience delete: projects and chats cascade (CR-15)
select is(public.delete_career_item('experience', 'aaaaaaaa-1111-0000-0000-000000000001', 'delete_projects', 'delete_results')
            -> 'cascade',
          '{"projects": 2, "project_deliverables": 0, "project_skills": 0, "writing_chats": 1}'::jsonb,
          'delete experience');
select is((select count(*)::int from public.projects
            where id in ('aaaaaaaa-3333-0000-0000-000000000001', 'aaaaaaaa-3333-0000-0000-000000000002')), 0,
          'projects of the deleted experience are gone');
select is((select count(*)::int from public.writing_chats where id = current_setting('t.c1')::uuid), 0,
          'their chats are gone');

-- standalone project delete: deliverables, tags; orphan tag skill removed, manual skill kept
select is(public.delete_career_item('project', 'aaaaaaaa-3333-0000-0000-000000000004') -> 'cascade',
          '{"projects": 0, "project_deliverables": 1, "project_skills": 2, "writing_chats": 0}'::jsonb,
          'delete standalone project');
select is((select count(*)::int from public.project_deliverables), 0, 'deliverables cascaded');
select is((select count(*)::int from public.skills where id = 'aaaaaaaa-6666-0000-0000-000000000001'), 0,
          'tag-only skill removed once its project is deleted');
select is((select count(*)::int from public.skills where id = 'aaaaaaaa-6666-0000-0000-000000000002'), 1,
          'manual skill kept');

-- education
select is(public.delete_career_item('education', 'aaaaaaaa-2222-0000-0000-000000000001') -> 'cascade',
          '{"projects": 1, "project_deliverables": 0, "project_skills": 0, "writing_chats": 1}'::jsonb,
          'delete education');
select is((select count(*)::int from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000003'), 0,
          'education project deleted');

-- skill
select is(public.delete_career_item('skill', 'aaaaaaaa-6666-0000-0000-000000000002') -> 'cascade',
          '{"projects": 0, "project_deliverables": 0, "project_skills": 1, "writing_chats": 0}'::jsonb,
          'delete skill removes its links');
select is((select count(*)::int from public.project_skills), 0, 'no links left');

reset role;
select is((select count(*)::int from public.experiences where user_id = 'bbbbbbbb-0000-0000-0000-000000000002')
          + (select count(*)::int from public.projects where user_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
          2, 'B''s rows untouched');

-- ── auth / role limits ───────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated"}';
select throws_ok($$select public.get_deletion_impact('project', gen_random_uuid())$$,
                 '42501', 'not_authenticated', 'impact: no sub → not_authenticated');
select throws_ok($$select public.reorder_project_deliverables(gen_random_uuid(), '{}'::uuid[])$$,
                 '42501', 'not_authenticated', 'reorder: no sub → not_authenticated');

reset role;
select ok(not has_function_privilege('app_ai_writer', 'public.delete_career_item(text, uuid, text, text)', 'execute'),
          'app_ai_writer cannot execute delete_career_item');
select ok(not has_function_privilege('app_ai_writer', 'public.get_deletion_impact(text, uuid, text)', 'execute'),
          'app_ai_writer cannot execute get_deletion_impact');
select ok(not has_function_privilege('app_ai_writer', 'public.reorder_project_deliverables(uuid, uuid[])', 'execute'),
          'app_ai_writer cannot execute reorder_project_deliverables');
set local role anon;
select throws_ok($$select public.delete_career_item('project', gen_random_uuid())$$, '42501', null,
                 'anon cannot execute delete_career_item');

select * from finish();
rollback;
