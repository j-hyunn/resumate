-- S2 career tables: RLS isolation, composite FKs, CHECKs, DB-computed status, triggers,
-- app_ai_writer read-only (DM §2.2–2.3, §4.1, §5, A.3–A.4).
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
                          'public.projects'::regclass, 'public.project_details'::regclass,
                          'public.achievements'::regclass, 'public.skills'::regclass,
                          'public.project_skills'::regclass)),
          'RLS enabled on all 7 career tables');

select policies_are('public', t, array[t || '_select_own', t || '_insert_own', t || '_update_own',
                                       t || '_delete_own', t || '_select_ai_writer'])
  from unnest(array['experiences', 'educations', 'projects', 'project_details', 'achievements', 'skills']) t;
select policies_are('public', 'project_skills',
  array['project_skills_select_own', 'project_skills_insert_own', 'project_skills_delete_own',
        'project_skills_select_ai_writer']);

-- ── B's data (as postgres) ────────────────────────────────────────────────
insert into public.experiences (id, user_id, company_name, start_month, job_rank)
values ('bbbbbbbb-1111-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'B Corp', '2020-01-01', 'Senior');
insert into public.educations (id, user_id, institution_name, education_type, start_month)
values ('bbbbbbbb-2222-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'B Univ', 'degree', '2015-03-01');
insert into public.projects (id, user_id, experience_id, name, role)
values ('bbbbbbbb-3333-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002',
        'bbbbbbbb-1111-0000-0000-000000000001', 'B Project', 'Lead');
insert into public.project_details (id, user_id, project_id, title, situation, action)
values ('bbbbbbbb-4444-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002',
        'bbbbbbbb-3333-0000-0000-000000000001', 'B detail', 'S', 'A');
insert into public.achievements (id, user_id, project_detail_id, description)
values ('bbbbbbbb-5555-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002',
        'bbbbbbbb-4444-0000-0000-000000000001', 'B achievement');
insert into public.skills (id, user_id, name)
values ('bbbbbbbb-6666-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'Go');
insert into public.project_skills (project_id, skill_id, user_id)
values ('bbbbbbbb-3333-0000-0000-000000000001', 'bbbbbbbb-6666-0000-0000-000000000001',
        'bbbbbbbb-0000-0000-0000-000000000002');

select is((select status from public.projects where id = 'bbbbbbbb-3333-0000-0000-000000000001'),
          'complete', 'B project became complete once a complete detail was added');

-- ── user A ────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select is((select count(*)::int from public.experiences) + (select count(*)::int from public.educations)
          + (select count(*)::int from public.projects) + (select count(*)::int from public.project_details)
          + (select count(*)::int from public.achievements) + (select count(*)::int from public.skills)
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
select throws_ok($$insert into public.projects (summary) values (repeat('x', 201))$$,
                 '23514', null, 'projects.summary ≤ 200');

insert into public.projects (id, experience_id, name, role)
values ('aaaaaaaa-3333-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', 'A Project', 'Backend');
select is((select status from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000001'),
          'draft', 'project with name + role but no complete detail is draft');

-- project_details: composite FK, sort_order default, status, parent recalculation
select throws_ok($$insert into public.project_details (project_id, title)
                   values ('bbbbbbbb-3333-0000-0000-000000000001', 'steal')$$,
                 '23503', null, 'A cannot add a detail to B''s project (composite FK)');

insert into public.project_details (id, project_id, title, situation)
values ('aaaaaaaa-4444-0000-0000-000000000001', 'aaaaaaaa-3333-0000-0000-000000000001', 'Detail 1', 'S1');
insert into public.project_details (id, project_id, title)
values ('aaaaaaaa-4444-0000-0000-000000000002', 'aaaaaaaa-3333-0000-0000-000000000001', 'Detail 2');
select results_eq($$select sort_order::int from public.project_details
                     where project_id = 'aaaaaaaa-3333-0000-0000-000000000001' order by sort_order$$,
                  array[1, 2], 'omitted sort_order is filled with last + 1');
select is((select status from public.project_details where id = 'aaaaaaaa-4444-0000-0000-000000000001'),
          'draft', 'detail without action is draft');
select is((select status from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000001'),
          'draft', 'project stays draft with only draft details');

-- make the project's updated_at observable
reset role;
alter table public.projects disable trigger projects_set_updated_at;
update public.projects set updated_at = '2000-01-01' where id = 'aaaaaaaa-3333-0000-0000-000000000001';
alter table public.projects enable trigger projects_set_updated_at;
update public.profiles set career_data_updated_at = null where id = 'aaaaaaaa-0000-0000-0000-000000000001';
set local role authenticated;

update public.project_details set action = 'A1' where id = 'aaaaaaaa-4444-0000-0000-000000000001';
select is((select status from public.project_details where id = 'aaaaaaaa-4444-0000-0000-000000000001'),
          'complete', 'detail complete with title, situation, action');
select is((select status from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000001'),
          'complete', 'first complete detail makes the project complete');
select ok((select updated_at > '2000-01-01' from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000001'),
          'project updated_at bumps when its status is recalculated');
select ok((select career_data_updated_at is not null from public.profiles),
          'career data change touches profiles.career_data_updated_at');

reset role;
alter table public.projects disable trigger projects_set_updated_at;
update public.projects set updated_at = '2000-01-01' where id = 'aaaaaaaa-3333-0000-0000-000000000001';
alter table public.projects enable trigger projects_set_updated_at;
set local role authenticated;
update public.project_details set result = 'R' where id = 'aaaaaaaa-4444-0000-0000-000000000001';
select is((select updated_at from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000001'),
          '2000-01-01'::timestamptz, 'editing a detail without a status change leaves project updated_at');

update public.projects set role = '' where id = 'aaaaaaaa-3333-0000-0000-000000000001';
select is((select status from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000001'),
          'draft', 'blank role makes the project draft even with a complete detail');
update public.projects set role = 'Backend' where id = 'aaaaaaaa-3333-0000-0000-000000000001';
select is((select status from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000001'),
          'complete', 'restoring role makes it complete again');

select throws_ok($$update public.project_details set project_id = 'aaaaaaaa-3333-0000-0000-000000000001'
                    where id = 'aaaaaaaa-4444-0000-0000-000000000002'$$,
                 '42501', null, 'project_id of a detail is not updatable');
select throws_ok($$insert into public.project_details (project_id, situation)
                   values ('aaaaaaaa-3333-0000-0000-000000000001', repeat('x', 2001))$$,
                 '23514', null, 'situation ≤ 2000');
select throws_ok($$insert into public.project_details (project_id, title)
                   values ('aaaaaaaa-3333-0000-0000-000000000001', repeat('x', 101))$$,
                 '23514', null, 'title ≤ 100');

-- deleting the last complete detail returns the project to draft
delete from public.project_details where id = 'aaaaaaaa-4444-0000-0000-000000000001';
select is((select status from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000001'),
          'draft', 'deleting the last complete detail makes the project draft');
insert into public.project_details (id, project_id, title, situation, action, sort_order)
values ('aaaaaaaa-4444-0000-0000-000000000001', 'aaaaaaaa-3333-0000-0000-000000000001', 'Detail 1', 'S', 'A', 3);
select is((select status from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000001'),
          'complete', 'inserting a complete detail makes the project complete');

-- achievements
select throws_ok($$insert into public.achievements (description) values ('orphan')$$,
                 '23514', null, 'achievement needs exactly one owner');
select throws_ok($$insert into public.achievements (project_detail_id, experience_id, description)
                   values ('aaaaaaaa-4444-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', 'two')$$,
                 '23514', null, 'achievement cannot have two owners');
select throws_ok($$insert into public.achievements (project_detail_id, description)
                   values ('bbbbbbbb-4444-0000-0000-000000000001', 'steal')$$,
                 '23503', null, 'A cannot add an achievement to B''s detail (composite FK)');

insert into public.achievements (id, project_detail_id, metric_name)
values ('aaaaaaaa-5555-0000-0000-000000000001', 'aaaaaaaa-4444-0000-0000-000000000001', 'latency');
select results_eq($$select status, kind from public.achievements where id = 'aaaaaaaa-5555-0000-0000-000000000001'$$,
                  $$values ('draft'::text, 'qualitative'::text)$$, 'metric without values: draft, qualitative');
update public.achievements set value_before = 1.2, value_after = 0.3, unit = 's'
 where id = 'aaaaaaaa-5555-0000-0000-000000000001';
select results_eq($$select status, kind from public.achievements where id = 'aaaaaaaa-5555-0000-0000-000000000001'$$,
                  $$values ('complete'::text, 'quantitative'::text)$$, 'metric with values: complete, quantitative');
insert into public.achievements (id, experience_id, description)
values ('aaaaaaaa-5555-0000-0000-000000000002', 'aaaaaaaa-1111-0000-0000-000000000001', '연간 평가 S');
select results_eq($$select status, kind from public.achievements where id = 'aaaaaaaa-5555-0000-0000-000000000002'$$,
                  $$values ('complete'::text, 'qualitative'::text)$$, 'experience-level description achievement');
select throws_ok($$update public.achievements set experience_id = null
                    where id = 'aaaaaaaa-5555-0000-0000-000000000002'$$,
                 '42501', null, 'achievement owner is not updatable');

-- QA-S2-06: blank metric_name is "missing" for both kind and status
insert into public.achievements (id, project_detail_id, metric_name, value_after)
values ('aaaaaaaa-5555-0000-0000-000000000003', 'aaaaaaaa-4444-0000-0000-000000000001', '   ', 5);
select results_eq($$select status, kind from public.achievements where id = 'aaaaaaaa-5555-0000-0000-000000000003'$$,
                  $$values ('draft'::text, 'qualitative'::text)$$, 'blank metric_name: draft and qualitative alike');
delete from public.achievements where id = 'aaaaaaaa-5555-0000-0000-000000000003';

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
insert into public.project_skills (project_id, skill_id) values
  ('aaaaaaaa-3333-0000-0000-000000000001', 'aaaaaaaa-6666-0000-0000-000000000001'),
  ('aaaaaaaa-3333-0000-0000-000000000001', 'aaaaaaaa-6666-0000-0000-000000000002');
select throws_ok($$insert into public.project_skills (project_id, skill_id)
                   values ('aaaaaaaa-3333-0000-0000-000000000001', 'bbbbbbbb-6666-0000-0000-000000000001')$$,
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
update public.project_details set title = 'hacked' where id = 'bbbbbbbb-4444-0000-0000-000000000001';
update public.achievements set description = 'hacked' where id = 'bbbbbbbb-5555-0000-0000-000000000001';
update public.skills set name = 'hacked' where id = 'bbbbbbbb-6666-0000-0000-000000000001';
update public.educations set institution_name = 'hacked' where id = 'bbbbbbbb-2222-0000-0000-000000000001';
delete from public.project_skills where user_id = 'bbbbbbbb-0000-0000-0000-000000000002';
delete from public.achievements where id = 'bbbbbbbb-5555-0000-0000-000000000001';
delete from public.project_details where id = 'bbbbbbbb-4444-0000-0000-000000000001';
delete from public.skills where id = 'bbbbbbbb-6666-0000-0000-000000000001';
delete from public.projects where id = 'bbbbbbbb-3333-0000-0000-000000000001';
delete from public.educations where id = 'bbbbbbbb-2222-0000-0000-000000000001';
delete from public.experiences where id = 'bbbbbbbb-1111-0000-0000-000000000001';

-- anon
reset role;
set local role anon;
select throws_ok($$select id from public.experiences$$, '42501', null, 'anon cannot read experiences');
select throws_ok($$select project_id from public.project_skills$$, '42501', null, 'anon cannot read project_skills');

reset role;
select results_eq(
  $$select (select company_name from public.experiences where id = 'bbbbbbbb-1111-0000-0000-000000000001'),
           (select institution_name from public.educations where id = 'bbbbbbbb-2222-0000-0000-000000000001'),
           (select name from public.projects where id = 'bbbbbbbb-3333-0000-0000-000000000001'),
           (select title from public.project_details where id = 'bbbbbbbb-4444-0000-0000-000000000001'),
           (select description from public.achievements where id = 'bbbbbbbb-5555-0000-0000-000000000001'),
           (select name from public.skills where id = 'bbbbbbbb-6666-0000-0000-000000000001'),
           (select count(*)::int from public.project_skills where user_id = 'bbbbbbbb-0000-0000-0000-000000000002')$$,
  $$values ('B Corp'::text, 'B Univ'::text, 'B Project'::text, 'B detail'::text, 'B achievement'::text, 'Go'::text, 1)$$,
  'A''s updates and deletes did not touch any of B''s rows');

-- ── app_ai_writer acting for A: read only ────────────────────────────────
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is((select count(*)::int from public.experiences), 1, 'app_ai_writer reads only the JWT user''s experiences');
select is((select count(*)::int from public.project_details), 2, 'app_ai_writer reads the user''s details');
select is((select count(*)::int from public.skills where user_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
          0, 'app_ai_writer cannot see other users'' skills');
select throws_ok($$insert into public.experiences (user_id, company_name)
                   values ('aaaaaaaa-0000-0000-0000-000000000001', 'ai')$$,
                 '42501', null, 'app_ai_writer cannot insert experiences');
select throws_ok($$update public.projects set name = 'ai'$$, '42501', null, 'app_ai_writer cannot update projects');
select throws_ok($$update public.project_details set action = 'ai'$$, '42501', null,
                 'app_ai_writer cannot update project_details');
select throws_ok($$delete from public.achievements$$, '42501', null, 'app_ai_writer cannot delete achievements');
select throws_ok($$insert into public.skills (user_id, name) values ('aaaaaaaa-0000-0000-0000-000000000001', 'ai')$$,
                 '42501', null, 'app_ai_writer cannot insert skills');
select throws_ok($$delete from public.project_skills$$, '42501', null, 'app_ai_writer cannot delete project_skills');
select throws_ok($$update public.educations set description = 'ai'$$, '42501', null,
                 'app_ai_writer cannot update educations');

-- ── affiliation delete keeps projects (FK set null) and account deletion cascades ──
reset role;
delete from public.experiences where id = 'aaaaaaaa-1111-0000-0000-000000000001';
select results_eq($$select experience_id, status from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000001'$$,
                  $$values (null::uuid, 'complete'::text)$$,
                  'deleting an experience leaves its project standalone (set null), status intact');
select is((select count(*)::int from public.achievements where id = 'aaaaaaaa-5555-0000-0000-000000000002'),
          0, 'experience-level achievements cascade with the experience');

delete from auth.users where id = 'bbbbbbbb-0000-0000-0000-000000000002';
select is((select count(*)::int from public.experiences where user_id = 'bbbbbbbb-0000-0000-0000-000000000002')
          + (select count(*)::int from public.educations where user_id = 'bbbbbbbb-0000-0000-0000-000000000002')
          + (select count(*)::int from public.projects where user_id = 'bbbbbbbb-0000-0000-0000-000000000002')
          + (select count(*)::int from public.project_details where user_id = 'bbbbbbbb-0000-0000-0000-000000000002')
          + (select count(*)::int from public.achievements where user_id = 'bbbbbbbb-0000-0000-0000-000000000002')
          + (select count(*)::int from public.skills where user_id = 'bbbbbbbb-0000-0000-0000-000000000002')
          + (select count(*)::int from public.project_skills where user_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
          0, 'account deletion cascades through all 7 career tables');

select * from finish();
rollback;
