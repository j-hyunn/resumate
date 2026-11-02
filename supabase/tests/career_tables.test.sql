-- S2 career tables, R4 v4.4 model: RLS isolation, composite FKs, CHECKs (DM-20 shape, classifications, is_current),
-- DB-computed status, scope-change guard, content_updated_at, deliverables (standalone only, 50 cap), project_skills
-- standalone only, app_ai_writer read-only (DM §2.2–2.3, §4.1, §5, A.3–A.4).
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

-- ── structure ──────────────────────────────────────────────────────────────
select ok((select bool_and(relrowsecurity) from pg_class
            where oid in ('public.experiences'::regclass, 'public.educations'::regclass,
                          'public.projects'::regclass, 'public.project_deliverables'::regclass,
                          'public.skills'::regclass, 'public.project_skills'::regclass)),
          'RLS enabled on all 6 career tables');
select hasnt_table('public', 'project_details', 'project_details is retired (CR-2)');
select hasnt_table('public', 'achievements', 'achievements is retired (CR-11)');

select policies_are('public', t, array[t || '_select_own', t || '_insert_own', t || '_update_own',
                                       t || '_delete_own', t || '_select_ai_writer'])
  from unnest(array['experiences', 'educations', 'projects', 'project_deliverables', 'skills']) t;
select policies_are('public', 'project_skills',
  array['project_skills_select_own', 'project_skills_insert_own', 'project_skills_delete_own',
        'project_skills_select_ai_writer']);
select hasnt_column('public', 'projects', 'summary', 'projects.summary dropped');
select hasnt_column('public', 'projects', 'team_size', 'projects.team_size dropped');
select col_not_null('public', 'projects', 'name', 'projects.name is not null (CR-6)');

-- ── B's data (as postgres) ────────────────────────────────────────────────
insert into public.experiences (id, user_id, company_name, start_month, job_rank)
values ('bbbbbbbb-1111-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'B Corp', '2020-01-01', 'Senior');
insert into public.educations (id, user_id, institution_name, education_type, start_month)
values ('bbbbbbbb-2222-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'B Univ', 'degree', '2015-03-01');
insert into public.projects (id, user_id, experience_id, name, situation, action)
values ('bbbbbbbb-3333-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002',
        'bbbbbbbb-1111-0000-0000-000000000001', 'B Project', 'S', 'A');
insert into public.projects (id, user_id, name, description)
values ('bbbbbbbb-3333-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'B Side', 'D');
insert into public.project_deliverables (id, user_id, project_id, title, body)
values ('bbbbbbbb-4444-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002',
        'bbbbbbbb-3333-0000-0000-000000000002', 'B deliverable', 'body');
insert into public.skills (id, user_id, name)
values ('bbbbbbbb-6666-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'Go');
insert into public.project_skills (project_id, skill_id, user_id)
values ('bbbbbbbb-3333-0000-0000-000000000002', 'bbbbbbbb-6666-0000-0000-000000000001',
        'bbbbbbbb-0000-0000-0000-000000000002');

select is((select status from public.projects where id = 'bbbbbbbb-3333-0000-0000-000000000001'),
          'complete', 'affiliated project complete with name + situation + action');
select is((select status from public.projects where id = 'bbbbbbbb-3333-0000-0000-000000000002'),
          'complete', 'standalone project complete with name + description');

-- ── user A ────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select is((select count(*)::int from public.experiences) + (select count(*)::int from public.educations)
          + (select count(*)::int from public.projects) + (select count(*)::int from public.project_deliverables)
          + (select count(*)::int from public.skills)
          + (select count(*)::int from public.project_skills),
          0, 'A sees none of B''s rows in any career table');

-- experiences: status computation
insert into public.experiences (id, company_name) values ('aaaaaaaa-1111-0000-0000-000000000001', 'A Corp');
select is((select status from public.experiences where id = 'aaaaaaaa-1111-0000-0000-000000000001'),
          'draft', 'experience with only company_name is draft');
select is((select user_id from public.experiences where id = 'aaaaaaaa-1111-0000-0000-000000000001'),
          'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'user_id defaults to auth.uid()');
update public.experiences set start_month = '2021-03-01', job_position = 'Backend'
 where id = 'aaaaaaaa-1111-0000-0000-000000000001';
select is((select status from public.experiences where id = 'aaaaaaaa-1111-0000-0000-000000000001'),
          'complete', 'experience complete with company, start, job_position');
update public.experiences set job_position = '  ' where id = 'aaaaaaaa-1111-0000-0000-000000000001';
select is((select status from public.experiences where id = 'aaaaaaaa-1111-0000-0000-000000000001'),
          'draft', 'blank job_position counts as missing');
update public.experiences set job_position = null, job_rank = 'Manager'
 where id = 'aaaaaaaa-1111-0000-0000-000000000001';
select is((select status from public.experiences where id = 'aaaaaaaa-1111-0000-0000-000000000001'),
          'complete', 'job_rank alone also satisfies the rank/position rule');

select throws_ok($$update public.experiences set status = 'complete' where id = 'aaaaaaaa-1111-0000-0000-000000000001'$$,
                 '42501', null, 'status is not client-writable');
select throws_ok($$insert into public.experiences (company_name, status) values ('X', 'complete')$$,
                 '42501', null, 'status cannot be sent on insert');
select throws_ok($$insert into public.experiences (company_name, start_month) values ('X', '2021-03-15')$$,
                 '23514', null, 'year-month must be day 1');
select throws_ok($$insert into public.experiences (start_month, end_month) values ('2021-03-01', '2020-01-01')$$,
                 '23514', null, 'end_month >= start_month');
select throws_ok($$insert into public.experiences (is_current, end_month) values (true, '2022-01-01')$$,
                 '23514', null, 'is_current requires end_month null');
select throws_ok($$insert into public.experiences (employment_type) values ('volunteer')$$,
                 '23514', null, 'employment_type CHECK');
select throws_ok($$insert into public.experiences (summary) values (repeat('x', 2001))$$,
                 '23514', null, 'summary ≤ 2000');
select throws_ok($$insert into public.experiences (user_id, company_name)
                   values ('bbbbbbbb-0000-0000-0000-000000000002', 'spoof')$$,
                 '42501', null, 'A cannot insert a row owned by B');

-- educations
insert into public.educations (id, institution_name, education_type)
values ('aaaaaaaa-2222-0000-0000-000000000001', 'A Univ', 'course');
select is((select status from public.educations where id = 'aaaaaaaa-2222-0000-0000-000000000001'),
          'draft', 'education without start_month is draft');
update public.educations set start_month = '2019-03-01' where id = 'aaaaaaaa-2222-0000-0000-000000000001';
select is((select status from public.educations where id = 'aaaaaaaa-2222-0000-0000-000000000001'),
          'complete', 'education complete with institution, type, start');
select throws_ok($$insert into public.educations (education_type) values ('bootcamp')$$,
                 '23514', null, 'education_type CHECK');
select throws_ok($$insert into public.educations (enrollment_status, start_month, end_month)
                   values ('enrolled', '2020-03-01', '2022-02-01')$$,
                 '23514', null, 'enrolled requires end_month null');
select throws_ok($$insert into public.educations (enrollment_status) values ('paused')$$,
                 '23514', null, 'enrollment_status CHECK');
select throws_ok($$insert into public.educations (institution_name) values (repeat('x', 101))$$,
                 '23514', null, 'institution_name ≤ 100');

-- projects + composite FK
select throws_ok($$insert into public.projects (experience_id, name)
                   values ('bbbbbbbb-1111-0000-0000-000000000001', 'steal')$$,
                 '23503', null, 'A cannot attach a project to B''s experience (composite FK)');
select throws_ok($$insert into public.projects (education_id, name)
                   values ('bbbbbbbb-2222-0000-0000-000000000001', 'steal')$$,
                 '23503', null, 'A cannot attach a project to B''s education (composite FK)');
select throws_ok($$insert into public.projects (experience_id, education_id, name)
                   values ('aaaaaaaa-1111-0000-0000-000000000001', 'aaaaaaaa-2222-0000-0000-000000000001', 'both')$$,
                 '23514', null, 'project belongs to at most one of experience / education');
select throws_ok($$insert into public.projects (experience_id) values ('aaaaaaaa-1111-0000-0000-000000000001')$$,
                 '23502', null, 'name is required (not null)');
select throws_ok($$insert into public.projects (name) values ('   ')$$, '23514', null, 'blank name rejected');

-- DM-20 shape
select throws_ok($$insert into public.projects (name, situation) values ('x', 'S')$$,
                 '23514', null, 'standalone project cannot carry STAR');
select throws_ok($$insert into public.projects (name, experience_type) values ('x', 'impact')$$,
                 '23514', null, 'standalone project cannot carry classifications');
select throws_ok($$insert into public.projects (name, competencies) values ('x', '{analysis}')$$,
                 '23514', null, 'standalone project cannot carry competencies');
select throws_ok($$insert into public.projects (experience_id, name, role)
                   values ('aaaaaaaa-1111-0000-0000-000000000001', 'x', 'Dev')$$,
                 '23514', null, 'affiliated project has no role (CR-10)');
select throws_ok($$insert into public.projects (experience_id, name, description)
                   values ('aaaaaaaa-1111-0000-0000-000000000001', 'x', 'D')$$,
                 '23514', null, 'affiliated project has no description');
select throws_ok($$insert into public.projects (education_id, name, link_url)
                   values ('aaaaaaaa-2222-0000-0000-000000000001', 'x', 'https://a.example')$$,
                 '23514', null, 'affiliated project has no link_url');

-- value CHECKs
select throws_ok($$insert into public.projects (name, link_url) values ('x', 'ftp://a.example')$$,
                 '23514', null, 'link_url must be http(s)');
select throws_ok($$insert into public.projects (name, description) values ('x', repeat('d', 5001))$$,
                 '23514', null, 'description ≤ 5000');
select throws_ok($$insert into public.projects (experience_id, name, situation)
                   values ('aaaaaaaa-1111-0000-0000-000000000001', 'x', repeat('s', 2001))$$,
                 '23514', null, 'situation ≤ 2000');
select throws_ok($$insert into public.projects (experience_id, name, project_type)
                   values ('aaaaaaaa-1111-0000-0000-000000000001', 'x', 'hobby')$$,
                 '23514', null, 'project_type CHECK (CR-17 keys)');
select throws_ok($$insert into public.projects (experience_id, name, experience_type)
                   values ('aaaaaaaa-1111-0000-0000-000000000001', 'x', 'analysis')$$,
                 '23514', null, 'experience_type CHECK (CR-17 keys)');
select throws_ok($$insert into public.projects (experience_id, name, competencies)
                   values ('aaaaaaaa-1111-0000-0000-000000000001', 'x', '{analysis,planning,execution,leadership}')$$,
                 '23514', null, 'competencies ≤ 3');
select throws_ok($$insert into public.projects (experience_id, name, competencies)
                   values ('aaaaaaaa-1111-0000-0000-000000000001', 'x', '{analysis,analysis}')$$,
                 '23514', null, 'competencies distinct');
select throws_ok($$insert into public.projects (experience_id, name, competencies)
                   values ('aaaaaaaa-1111-0000-0000-000000000001', 'x', '{impact}')$$,
                 '23514', null, 'competencies elements CHECK');
select throws_ok($$insert into public.projects (name, is_current, end_month) values ('x', true, '2024-01-01')$$,
                 '23514', null, 'is_current requires end_month null (CR-22)');
select throws_ok($$update public.projects set content_updated_at = now()$$, '42501', null,
                 'content_updated_at is not client-writable');
select throws_ok($$update public.projects set source_writing_chat_id = null$$, '42501', null,
                 'source_writing_chat_id is not client-writable');

insert into public.projects (id, experience_id, name, project_type, experience_type, competencies)
values ('aaaaaaaa-3333-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', 'A Project',
        'improvement', 'problem_solving', '{analysis,execution}');
select is((select status from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000001'),
          'draft', 'affiliated project with name only is draft (CR-6)');
update public.projects set situation = 'S1' where id = 'aaaaaaaa-3333-0000-0000-000000000001';
select is((select status from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000001'),
          'draft', 'situation without action is draft');

-- make updated_at / content_updated_at observable
reset role;
alter table public.projects disable trigger projects_set_updated_at;
alter table public.projects disable trigger projects_set_content_updated_at;
update public.projects set updated_at = '2000-01-01', content_updated_at = '2000-01-01'
 where id = 'aaaaaaaa-3333-0000-0000-000000000001';
alter table public.projects enable trigger projects_set_updated_at;
alter table public.projects enable trigger projects_set_content_updated_at;
update public.profiles set career_data_updated_at = null where id = 'aaaaaaaa-0000-0000-0000-000000000001';
set local role authenticated;

update public.projects set action = '  ' where id = 'aaaaaaaa-3333-0000-0000-000000000001';
select is((select status from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000001'),
          'draft', 'blank action counts as missing');
update public.projects set action = 'A1' where id = 'aaaaaaaa-3333-0000-0000-000000000001';
select is((select status from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000001'),
          'complete', 'affiliated project complete with name + situation + action');
select ok((select content_updated_at > '2000-01-01' from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000001'),
          'STAR edit moves content_updated_at');
select ok((select career_data_updated_at is not null from public.profiles),
          'career data change touches profiles.career_data_updated_at');

reset role;
alter table public.projects disable trigger projects_set_content_updated_at;
update public.projects set content_updated_at = '2000-01-01' where id = 'aaaaaaaa-3333-0000-0000-000000000001';
alter table public.projects enable trigger projects_set_content_updated_at;
set local role authenticated;
update public.projects set project_type = 'operation', competencies = '{analysis}'
 where id = 'aaaaaaaa-3333-0000-0000-000000000001';
select is((select content_updated_at from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000001'),
          '2000-01-01'::timestamptz, 'classification-only edit leaves content_updated_at');
update public.projects set is_current = true where id = 'aaaaaaaa-3333-0000-0000-000000000001';
select ok((select content_updated_at > '2000-01-01' from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000001'),
          'is_current is an evidence field (period)');
update public.projects set is_current = false where id = 'aaaaaaaa-3333-0000-0000-000000000001';

-- scope guard (PRD F-P1-03 (7) [가정])
insert into public.educations (id, institution_name, education_type)
values ('aaaaaaaa-2222-0000-0000-000000000002', 'A Course', 'course');
select lives_ok($$update public.projects set experience_id = null, education_id = 'aaaaaaaa-2222-0000-0000-000000000002'
                   where id = 'aaaaaaaa-3333-0000-0000-000000000001'$$, 'experience -> education move is allowed');
select lives_ok($$update public.projects set education_id = null, experience_id = 'aaaaaaaa-1111-0000-0000-000000000001'
                   where id = 'aaaaaaaa-3333-0000-0000-000000000001'$$, 'and back');
select throws_ok($$update public.projects set experience_id = null where id = 'aaaaaaaa-3333-0000-0000-000000000001'$$,
                 'P0001', 'project_scope_change_not_allowed', 'affiliated -> standalone is rejected');

insert into public.projects (id, name) values ('aaaaaaaa-3333-0000-0000-000000000002', 'A Side');
select is((select status from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000002'),
          'draft', 'standalone project without description is draft');
update public.projects set description = '내용', role = 'Lead', link_url = 'https://a.example'
 where id = 'aaaaaaaa-3333-0000-0000-000000000002';
select is((select status from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000002'),
          'complete', 'standalone project complete with name + description');
select throws_ok($$update public.projects set experience_id = 'aaaaaaaa-1111-0000-0000-000000000001'
                    where id = 'aaaaaaaa-3333-0000-0000-000000000002'$$,
                 'P0001', 'project_scope_change_not_allowed', 'standalone -> affiliated is rejected');

-- project_deliverables (DM v4.4 §2.3)
select throws_ok($$insert into public.project_deliverables (project_id, title)
                   values ('aaaaaaaa-3333-0000-0000-000000000001', 'x')$$,
                 'P0001', 'deliverable_requires_standalone_project', 'deliverables only under standalone projects');
select throws_ok($$insert into public.project_deliverables (project_id, title)
                   values ('bbbbbbbb-3333-0000-0000-000000000002', 'steal')$$,
                 '23503', null, 'A cannot add a deliverable to B''s project (composite FK)');
-- QA-R4-01: B's affiliated project with B's user_id -> RLS refusal, not a business error that leaks its kind.
select throws_ok($$insert into public.project_deliverables (user_id, project_id, title)
                   values ('bbbbbbbb-0000-0000-0000-000000000002', 'bbbbbbbb-3333-0000-0000-000000000001', 'x')$$,
                 '42501', null, 'deliverable guard does not reveal B''s project kind (RLS 42501 first)');
select throws_ok($$insert into public.project_skills (user_id, project_id, skill_id)
                   values ('bbbbbbbb-0000-0000-0000-000000000002', 'bbbbbbbb-3333-0000-0000-000000000001',
                           'bbbbbbbb-6666-0000-0000-000000000001')$$,
                 '42501', null, 'project_skill guard does not reveal B''s project kind (RLS 42501 first)');
insert into public.project_deliverables (id, project_id, title)
values ('aaaaaaaa-4444-0000-0000-000000000001', 'aaaaaaaa-3333-0000-0000-000000000002', 'D1');
insert into public.project_deliverables (id, project_id, title, body)
values ('aaaaaaaa-4444-0000-0000-000000000002', 'aaaaaaaa-3333-0000-0000-000000000002', 'D2', '# md');
select results_eq($$select sort_order::int from public.project_deliverables
                     where project_id = 'aaaaaaaa-3333-0000-0000-000000000002' order by sort_order$$,
                  array[1, 2], 'omitted sort_order is filled with last + 1');
insert into public.project_deliverables (id, project_id, title, sort_order)
values ('aaaaaaaa-4444-0000-0000-000000000009', 'aaaaaaaa-3333-0000-0000-000000000002', 'D0', 0);
select is((select sort_order::int from public.project_deliverables where id = 'aaaaaaaa-4444-0000-0000-000000000009'),
          3, 'sort_order 0 (column default) is filled with last + 1 (QA-R4-05)');
delete from public.project_deliverables where id = 'aaaaaaaa-4444-0000-0000-000000000009';
select is((select body from public.project_deliverables where id = 'aaaaaaaa-4444-0000-0000-000000000001'), '',
          'body defaults to empty');
select throws_ok($$insert into public.project_deliverables (project_id, title)
                   values ('aaaaaaaa-3333-0000-0000-000000000002', '  ')$$, '23514', null, 'blank title rejected');
select throws_ok($$insert into public.project_deliverables (project_id, title)
                   values ('aaaaaaaa-3333-0000-0000-000000000002', repeat('t', 101))$$, '23514', null, 'title ≤ 100');
select throws_ok($$insert into public.project_deliverables (project_id, title, body)
                   values ('aaaaaaaa-3333-0000-0000-000000000002', 't', repeat('b', 20001))$$, '23514', null,
                 'body ≤ 20000');
select throws_ok($$update public.project_deliverables set project_id = 'aaaaaaaa-3333-0000-0000-000000000002'$$,
                 '42501', null, 'project_id of a deliverable is not updatable');
reset role;
alter table public.project_deliverables disable trigger project_deliverables_set_updated_at;
update public.project_deliverables set updated_at = '2000-01-01' where id = 'aaaaaaaa-4444-0000-0000-000000000001';
alter table public.project_deliverables enable trigger project_deliverables_set_updated_at;
set local role authenticated;
select lives_ok($$select public.reorder_project_deliverables('aaaaaaaa-3333-0000-0000-000000000002',
                   array['aaaaaaaa-4444-0000-0000-000000000002', 'aaaaaaaa-4444-0000-0000-000000000001']::uuid[])$$,
                'reorder_project_deliverables');
select results_eq($$select id from public.project_deliverables
                     where project_id = 'aaaaaaaa-3333-0000-0000-000000000002' order by sort_order$$,
                  $$values ('aaaaaaaa-4444-0000-0000-000000000002'::uuid), ('aaaaaaaa-4444-0000-0000-000000000001'::uuid)$$,
                  'reorder applied');
select is((select updated_at from public.project_deliverables where id = 'aaaaaaaa-4444-0000-0000-000000000001'),
          '2000-01-01'::timestamptz, 'a pure reorder does not move updated_at (evidence snapshot)');
select throws_ok($$select public.reorder_project_deliverables('aaaaaaaa-3333-0000-0000-000000000002',
                    array['aaaaaaaa-4444-0000-0000-000000000002']::uuid[])$$,
                 'P0001', 'invalid_deliverable_order', 'reorder must list every deliverable once');
select throws_ok($$select public.reorder_project_deliverables('bbbbbbbb-3333-0000-0000-000000000002',
                    array['bbbbbbbb-4444-0000-0000-000000000001']::uuid[])$$,
                 'P0001', 'career_item_not_found', 'reorder of another user''s project');
update public.project_deliverables set body = 'changed' where id = 'aaaaaaaa-4444-0000-0000-000000000001';
select ok((select updated_at > '2000-01-01' from public.project_deliverables where id = 'aaaaaaaa-4444-0000-0000-000000000001'),
          'a body edit moves updated_at');
select is((select status from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000002'), 'complete',
          'deliverables do not affect the parent status');
-- 50 cap [가정]
insert into public.project_deliverables (project_id, title)
select 'aaaaaaaa-3333-0000-0000-000000000002', 'bulk ' || g from generate_series(1, 48) g;
select throws_ok($$insert into public.project_deliverables (project_id, title)
                   values ('aaaaaaaa-3333-0000-0000-000000000002', 'fifty-first')$$,
                 'P0001', 'deliverable_limit_reached', 'the 51st deliverable is rejected');
delete from public.project_deliverables
 where project_id = 'aaaaaaaa-3333-0000-0000-000000000002' and title like 'bulk %';

-- skills / project_skills
insert into public.skills (id, name) values ('aaaaaaaa-6666-0000-0000-000000000001', '  Spring   Boot ');
select is((select normalized_name from public.skills where id = 'aaaaaaaa-6666-0000-0000-000000000001'),
          'spring boot', 'normalized_name trims, collapses whitespace, lowercases');
select is((select is_manual from public.skills where id = 'aaaaaaaa-6666-0000-0000-000000000001'),
          true, 'is_manual defaults to true');
select throws_ok($$insert into public.skills (name) values ('SPRING BOOT')$$,
                 '23505', null, 'normalized_name unique per user');
select throws_ok($$insert into public.skills (name) values ('   ')$$, '23514', null, 'blank skill name rejected');
select throws_ok($$insert into public.skills (name) values (repeat('x', 51))$$, '23514', null, 'skill name ≤ 50');
select throws_ok($$insert into public.skills (name, proficiency) values ('Rust', 'guru')$$,
                 '23514', null, 'proficiency CHECK');

insert into public.skills (id, name, is_manual) values ('aaaaaaaa-6666-0000-0000-000000000002', 'Kafka', false);
select throws_ok($$insert into public.project_skills (project_id, skill_id)
                   values ('aaaaaaaa-3333-0000-0000-000000000001', 'aaaaaaaa-6666-0000-0000-000000000001')$$,
                 'P0001', 'project_skill_requires_standalone_project', 'skills attach to standalone projects only (CR-10)');
insert into public.project_skills (project_id, skill_id) values
  ('aaaaaaaa-3333-0000-0000-000000000002', 'aaaaaaaa-6666-0000-0000-000000000001'),
  ('aaaaaaaa-3333-0000-0000-000000000002', 'aaaaaaaa-6666-0000-0000-000000000002');
select throws_ok($$insert into public.project_skills (project_id, skill_id)
                   values ('aaaaaaaa-3333-0000-0000-000000000002', 'bbbbbbbb-6666-0000-0000-000000000001')$$,
                 '23503', null, 'A cannot tag B''s skill (composite FK)');

delete from public.project_skills where skill_id = 'aaaaaaaa-6666-0000-0000-000000000002';
select is((select count(*)::int from public.skills where id = 'aaaaaaaa-6666-0000-0000-000000000002'),
          0, 'orphaned tag skill (is_manual = false) is deleted');
delete from public.project_skills where skill_id = 'aaaaaaaa-6666-0000-0000-000000000001';
select is((select count(*)::int from public.skills where id = 'aaaaaaaa-6666-0000-0000-000000000001'),
          1, 'manual skill survives losing its last link');

-- cross-user update / delete have no effect
update public.experiences set company_name = 'hacked' where id = 'bbbbbbbb-1111-0000-0000-000000000001';
update public.projects set name = 'hacked' where id = 'bbbbbbbb-3333-0000-0000-000000000001';
update public.project_deliverables set title = 'hacked' where id = 'bbbbbbbb-4444-0000-0000-000000000001';
update public.skills set name = 'hacked' where id = 'bbbbbbbb-6666-0000-0000-000000000001';
update public.educations set institution_name = 'hacked' where id = 'bbbbbbbb-2222-0000-0000-000000000001';
delete from public.project_skills where user_id = 'bbbbbbbb-0000-0000-0000-000000000002';
delete from public.project_deliverables where id = 'bbbbbbbb-4444-0000-0000-000000000001';
delete from public.skills where id = 'bbbbbbbb-6666-0000-0000-000000000001';
delete from public.projects where id in ('bbbbbbbb-3333-0000-0000-000000000001', 'bbbbbbbb-3333-0000-0000-000000000002');
delete from public.educations where id = 'bbbbbbbb-2222-0000-0000-000000000001';
delete from public.experiences where id = 'bbbbbbbb-1111-0000-0000-000000000001';

-- anon
reset role;
set local role anon;
select throws_ok($$select id from public.experiences$$, '42501', null, 'anon cannot read experiences');
select throws_ok($$select project_id from public.project_skills$$, '42501', null, 'anon cannot read project_skills');
select throws_ok($$select id from public.project_deliverables$$, '42501', null, 'anon cannot read project_deliverables');

reset role;
select results_eq(
  $$select (select company_name from public.experiences where id = 'bbbbbbbb-1111-0000-0000-000000000001'),
           (select institution_name from public.educations where id = 'bbbbbbbb-2222-0000-0000-000000000001'),
           (select name from public.projects where id = 'bbbbbbbb-3333-0000-0000-000000000001'),
           (select title from public.project_deliverables where id = 'bbbbbbbb-4444-0000-0000-000000000001'),
           (select name from public.skills where id = 'bbbbbbbb-6666-0000-0000-000000000001'),
           (select count(*)::int from public.project_skills where user_id = 'bbbbbbbb-0000-0000-0000-000000000002')$$,
  $$values ('B Corp'::text, 'B Univ'::text, 'B Project'::text, 'B deliverable'::text, 'Go'::text, 1)$$,
  'A''s updates and deletes did not touch any of B''s rows');

-- ── app_ai_writer acting for A: read only ────────────────────────────────
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is((select count(*)::int from public.experiences), 1, 'app_ai_writer reads only the JWT user''s experiences');
select is((select count(*)::int from public.project_deliverables), 2, 'app_ai_writer reads the user''s deliverables');
select is((select count(*)::int from public.skills where user_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
          0, 'app_ai_writer cannot see other users'' skills');
select throws_ok($$insert into public.experiences (user_id, company_name)
                   values ('aaaaaaaa-0000-0000-0000-000000000001', 'ai')$$,
                 '42501', null, 'app_ai_writer cannot insert experiences');
select throws_ok($$update public.projects set name = 'ai'$$, '42501', null, 'app_ai_writer cannot update projects');
select throws_ok($$update public.projects set situation = 'ai'$$, '42501', null, 'app_ai_writer cannot write STAR');
select throws_ok($$update public.project_deliverables set body = 'ai'$$, '42501', null,
                 'app_ai_writer cannot update project_deliverables');
select throws_ok($$delete from public.project_deliverables$$, '42501', null, 'app_ai_writer cannot delete deliverables');
select throws_ok($$insert into public.skills (user_id, name) values ('aaaaaaaa-0000-0000-0000-000000000001', 'ai')$$,
                 '42501', null, 'app_ai_writer cannot insert skills');
select throws_ok($$delete from public.project_skills$$, '42501', null, 'app_ai_writer cannot delete project_skills');
select throws_ok($$update public.educations set description = 'ai'$$, '42501', null,
                 'app_ai_writer cannot update educations');

-- ── affiliation delete cascades to projects (CR-15) and account deletion cascades ──
reset role;
delete from public.experiences where id = 'aaaaaaaa-1111-0000-0000-000000000001';
select is((select count(*)::int from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000001'), 0,
          'deleting an experience deletes its projects (on delete cascade)');
select is((select count(*)::int from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000002'), 1,
          'standalone project untouched');
delete from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000002';
select is((select count(*)::int from public.project_deliverables where project_id = 'aaaaaaaa-3333-0000-0000-000000000002'),
          0, 'deliverables cascade with their project');

delete from auth.users where id = 'bbbbbbbb-0000-0000-0000-000000000002';
select is((select count(*)::int from public.experiences where user_id = 'bbbbbbbb-0000-0000-0000-000000000002')
          + (select count(*)::int from public.educations where user_id = 'bbbbbbbb-0000-0000-0000-000000000002')
          + (select count(*)::int from public.projects where user_id = 'bbbbbbbb-0000-0000-0000-000000000002')
          + (select count(*)::int from public.project_deliverables where user_id = 'bbbbbbbb-0000-0000-0000-000000000002')
          + (select count(*)::int from public.skills where user_id = 'bbbbbbbb-0000-0000-0000-000000000002')
          + (select count(*)::int from public.project_skills where user_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
          0, 'account deletion cascades through all 6 career tables');

select * from finish();
rollback;
