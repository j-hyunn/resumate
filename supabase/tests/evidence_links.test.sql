-- S3 evidence_links: RLS, no direct writes by app_ai_writer (R1 A24: result RPCs only), CHECKs, insert source guard,
-- source deletion trigger for each career table (C-3, DM §2.8).
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

select ok((select relrowsecurity from pg_class where oid = 'public.evidence_links'::regclass), 'evidence_links RLS');
select policies_are('public', 'evidence_links',
  array['evidence_links_select_own', 'evidence_links_select_ai_writer']);
-- R1 A24 (DM §5 v4.2): app_ai_writer has no INSERT privilege at all (table or column).
select ok(not has_table_privilege('app_ai_writer', 'public.evidence_links', 'INSERT')
          and not has_any_column_privilege('app_ai_writer', 'public.evidence_links', 'INSERT'),
          'app_ai_writer has no INSERT privilege on evidence_links (A24)');
select set_eq(
  $$select tgname::text from pg_trigger where tgname like '%_evidence_source_deleted' and not tgisinternal$$,
  array['experiences_evidence_source_deleted', 'educations_evidence_source_deleted', 'projects_evidence_source_deleted',
        'project_details_evidence_source_deleted', 'achievements_evidence_source_deleted', 'skills_evidence_source_deleted',
        'jd_requirements_evidence_source_deleted', 'job_descriptions_evidence_source_deleted',
        'interview_answers_evidence_source_deleted'],
  'deletion trigger on each career / JD (S6) / interview answer (S8) evidence source table');

-- A's career data (as the user).
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into public.experiences (id, company_name, start_month, job_rank, summary)
  values ('a0000000-1111-0000-0000-000000000001', 'A사', '2020-01-01', 'S', '결제 플랫폼 운영');
insert into public.experiences (id, company_name, start_month, job_rank)
  values ('a0000000-1111-0000-0000-000000000002', 'B사', '2018-01-01', 'J');
insert into public.educations (id, institution_name, education_type, start_month, description)
  values ('a0000000-2222-0000-0000-000000000001', 'U', 'degree', '2014-03-01', '컴퓨터공학');
insert into public.projects (id, experience_id, name, role, summary)
  values ('a0000000-3333-0000-0000-000000000001', 'a0000000-1111-0000-0000-000000000002', 'P', 'Dev', '결제');
insert into public.project_details (id, project_id, title, situation, action, result)
  values ('a0000000-4444-0000-0000-000000000001', 'a0000000-3333-0000-0000-000000000001', 't', 's', '인덱스 재설계', 'r');
insert into public.project_details (id, project_id, title, situation, action)
  values ('a0000000-4444-0000-0000-000000000002', 'a0000000-3333-0000-0000-000000000001', 't2', 's2', 'a2');
insert into public.achievements (id, project_detail_id, metric_name, value_after, description)
  values ('a0000000-5555-0000-0000-000000000001', 'a0000000-4444-0000-0000-000000000001', 'p95', 120, '지연 감소');
insert into public.skills (id, name) values ('a0000000-6666-0000-0000-000000000001', 'Postgres');
reset role;
-- S5: evidence_links.application_project_id is a composite FK; A's application project for the links below.
insert into public.application_projects (id, user_id, name, name_source)
  values ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'P', 'user'),
         ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'P', 'user');
-- S6: jd_sentence links must point at the project's JD with a valid locator.
insert into public.job_descriptions (id, user_id, application_project_id, raw_text, raw_text_hash, sentences)
  values ('f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
          'c0000000-0000-0000-0000-000000000001', '결제 경험 우대', 'h', '[{"sid":"S1","text":"결제 경험 우대","start":0,"end":8}]');

-- R1 A24: app_ai_writer can't insert links directly.
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select throws_ok($$insert into public.evidence_links (application_project_id, owner_type, owner_id, item_key, source_type, source_id, source_field)
                   values ('c0000000-0000-0000-0000-000000000001', 'insight', gen_random_uuid(), 'k', 'skill', 'a0000000-6666-0000-0000-000000000001', 'name')$$,
                 '42501', null, 'app_ai_writer cannot insert links directly (A24)');
select throws_ok($$update public.evidence_links set quote = 'x'$$, '42501', null, 'app_ai_writer cannot update links');
select throws_ok($$delete from public.evidence_links$$, '42501', null, 'app_ai_writer cannot delete links');
reset role;

-- Links are written by the result RPCs (security definer, owner postgres). The table-level rules below
-- (CHECKs, insert source guard) are exercised as the owner with A's JWT, the way those RPCs run.
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';

create temp table t_links (id uuid, source_type text, source_id uuid, source_field text, quote text, source_locator jsonb);
insert into t_links values
  ('e0000000-0000-0000-0000-000000000001', 'experience', 'a0000000-1111-0000-0000-000000000001', 'summary', '결제 플랫폼', null),
  ('e0000000-0000-0000-0000-000000000002', 'education', 'a0000000-2222-0000-0000-000000000001', 'description', '컴퓨터공학', null),
  ('e0000000-0000-0000-0000-000000000003', 'project', 'a0000000-3333-0000-0000-000000000001', 'summary', '결제', null),
  ('e0000000-0000-0000-0000-000000000004', 'project_detail', 'a0000000-4444-0000-0000-000000000002', 'action', 'a2', null),
  ('e0000000-0000-0000-0000-000000000005', 'achievement', 'a0000000-5555-0000-0000-000000000001', 'description', '지연 감소', null),
  ('e0000000-0000-0000-0000-000000000006', 'skill', 'a0000000-6666-0000-0000-000000000001', 'name', null, null),
  ('e0000000-0000-0000-0000-000000000007', 'project_detail', 'a0000000-4444-0000-0000-000000000001', 'action', '인덱스 재설계', null),
  ('e0000000-0000-0000-0000-000000000008', 'profile', 'a0000000-0000-0000-0000-000000000001', 'desired_job_title', null, null),
  ('e0000000-0000-0000-0000-000000000009', 'jd_sentence', 'f0000000-0000-0000-0000-000000000001', null, '결제 경험',
   '{"sid":"S1","start":0,"end":5}');

select lives_ok($$insert into public.evidence_links
                    (id, application_project_id, owner_type, owner_id, item_key, sort_order, source_type, source_id,
                     source_field, quote, source_snapshot_at, source_label, source_locator)
                  select id, 'c0000000-0000-0000-0000-000000000001', 'insight', 'd0000000-0000-0000-0000-000000000001',
                         'strengths.0', 0, source_type, source_id, source_field, quote, now(), 'label', source_locator
                    from t_links$$,
                'owner (result RPC path) inserts links for each source type');
select is((select count(*)::int from public.evidence_links where source_deleted_at is null), 9,
          'all links live (sources exist)');
select is((select count(*)::int from public.evidence_links where user_id = 'a0000000-0000-0000-0000-000000000001'), 9,
          'user_id defaults to JWT sub');

-- CHECKs
select throws_ok($$insert into public.evidence_links (application_project_id, owner_type, owner_id, item_key, source_type, source_id, source_field)
                   values ('c0000000-0000-0000-0000-000000000001', 'insight', gen_random_uuid(), 'k', 'experience', 'a0000000-1111-0000-0000-000000000001', 'company_name')$$,
                 '23514', null, 'source_field must be allowed for source_type (V-2)');
select throws_ok($$insert into public.evidence_links (application_project_id, owner_type, owner_id, item_key, source_type, source_id, source_field)
                   values ('c0000000-0000-0000-0000-000000000001', 'insight', gen_random_uuid(), 'k', 'project_detail', 'a0000000-4444-0000-0000-000000000001', null)$$,
                 '23514', null, 'project_detail needs a field');
select throws_ok($$insert into public.evidence_links (application_project_id, owner_type, owner_id, item_key, source_type, source_id, source_field)
                   values ('c0000000-0000-0000-0000-000000000001', 'insight', gen_random_uuid(), 'k', 'jd_sentence', gen_random_uuid(), 'action')$$,
                 '23514', null, 'jd_sentence has no field');
select throws_ok($$insert into public.evidence_links (application_project_id, owner_type, owner_id, item_key, source_type, source_id)
                   values ('c0000000-0000-0000-0000-000000000001', 'insight', gen_random_uuid(), 'k', 'writing_chat_message', gen_random_uuid())$$,
                 '23514', null, 'writing_chat_message is not an evidence source (DM-15)');
select throws_ok($$insert into public.evidence_links (application_project_id, owner_type, owner_id, item_key, source_type, source_id, source_field)
                   values (gen_random_uuid(), 'writing_chat', gen_random_uuid(), 'k', 'skill', gen_random_uuid(), 'name')$$,
                 '23514', null, 'owner_type CHECK');

-- Insert guard: missing source -> stored as deleted, quote dropped.
select lives_ok($$insert into public.evidence_links (id, application_project_id, owner_type, owner_id, item_key, source_type, source_id, source_field, quote)
                  values ('e0000000-0000-0000-0000-000000000010', 'c0000000-0000-0000-0000-000000000001', 'insight', gen_random_uuid(), 'k',
                          'project_detail', gen_random_uuid(), 'action', '사라진 원문')$$,
                'link to a missing source is accepted');
select results_eq($$select quote, source_deleted_at is not null from public.evidence_links where id = 'e0000000-0000-0000-0000-000000000010'$$,
                  $$values (null::text, true)$$, 'link to a missing source stored as deleted without quote');

-- app_ai_writer B can't read A's links.
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"app_ai_writer"}';
select is((select count(*)::int from public.evidence_links), 0, 'app_ai_writer B sees no A links');
reset role;

-- B's link pointing at A's source: treated as missing.
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"app_ai_writer"}';
select lives_ok($$insert into public.evidence_links (id, application_project_id, owner_type, owner_id, item_key, source_type, source_id, source_field, quote)
                  values ('e0000000-0000-0000-0000-000000000011', 'c0000000-0000-0000-0000-000000000002', 'insight', gen_random_uuid(), 'k',
                          'experience', 'a0000000-1111-0000-0000-000000000001', 'summary', '결제 플랫폼')$$,
                'B link to A source accepted');
select results_eq($$select quote, source_deleted_at is not null from public.evidence_links where id = 'e0000000-0000-0000-0000-000000000011'$$,
                  $$values (null::text, true)$$, 'B link to A source stored as deleted (no foreign quote kept)');
reset role;

-- authenticated: select own, no writes.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.evidence_links), 10, 'A sees own links');
select throws_ok($$insert into public.evidence_links (application_project_id, owner_type, owner_id, item_key, source_type, source_id, source_field)
                   values ('c0000000-0000-0000-0000-000000000001', 'insight', gen_random_uuid(), 'k', 'skill', gen_random_uuid(), 'name')$$,
                 '42501', null, 'user cannot insert links');
select throws_ok($$update public.evidence_links set quote = null$$, '42501', null, 'user cannot update links');
select throws_ok($$delete from public.evidence_links$$, '42501', null, 'user cannot delete links');

-- Deletion triggers, one table at a time (as the user).
delete from public.project_details where id = 'a0000000-4444-0000-0000-000000000002';
select results_eq($$select quote, source_deleted_at is not null from public.evidence_links where id = 'e0000000-0000-0000-0000-000000000004'$$,
                  $$values (null::text, true)$$, 'project_details delete marks its link');
select is((select quote from public.evidence_links where id = 'e0000000-0000-0000-0000-000000000007'), '인덱스 재설계',
          'sibling detail link untouched');
delete from public.achievements where id = 'a0000000-5555-0000-0000-000000000001';
select results_eq($$select quote, source_deleted_at is not null from public.evidence_links where id = 'e0000000-0000-0000-0000-000000000005'$$,
                  $$values (null::text, true)$$, 'achievements delete marks its link');
delete from public.skills where id = 'a0000000-6666-0000-0000-000000000001';
select is((select source_deleted_at is not null from public.evidence_links where id = 'e0000000-0000-0000-0000-000000000006'), true,
          'skills delete marks its link');
delete from public.educations where id = 'a0000000-2222-0000-0000-000000000001';
select results_eq($$select quote, source_deleted_at is not null from public.evidence_links where id = 'e0000000-0000-0000-0000-000000000002'$$,
                  $$values (null::text, true)$$, 'educations delete marks its link');
delete from public.experiences where id = 'a0000000-1111-0000-0000-000000000001';
select results_eq($$select quote, source_deleted_at is not null from public.evidence_links where id = 'e0000000-0000-0000-0000-000000000001'$$,
                  $$values (null::text, true)$$, 'experiences delete marks its link');
-- Cascade chain: delete_career_item(experience, delete_projects) -> project -> detail.
select lives_ok($$select public.delete_career_item('experience', 'a0000000-1111-0000-0000-000000000002', 'delete_projects')$$,
                'delete experience with its projects');
select results_eq($$select id::text, quote, source_deleted_at is not null from public.evidence_links
                     where id in ('e0000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000007') order by id$$,
                  $$values ('e0000000-0000-0000-0000-000000000003', null::text, true),
                           ('e0000000-0000-0000-0000-000000000007', null::text, true)$$,
                  'cascaded project and detail deletions mark their links');
select results_eq($$select quote, source_deleted_at is null from public.evidence_links where id = 'e0000000-0000-0000-0000-000000000009'$$,
                  $$values ('결제 경험'::text, true)$$, 'non-career link untouched');
reset role;

select is((select count(*)::int from public.evidence_links where source_deleted_at is not null and quote is not null), 0,
          'no deleted link keeps a quote');

delete from auth.users where id = 'a0000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.evidence_links where user_id = 'a0000000-0000-0000-0000-000000000001'), 0,
          'evidence_links cascade on account deletion');

select * from finish();
rollback;
