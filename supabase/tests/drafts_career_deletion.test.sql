-- S7 career deletion and drafts (DM §2.7, §4.1–4.2, F-COM-04): draft_section_sources source deletion triggers
-- (source_deleted_at + pre-deletion label, project_detail_ids removal), get_deletion_impact drafts /
-- draft_sections counts, delete_career_item keep_results / delete_results (career description deleted, cover
-- letter question reset).
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into public.experiences (id, company_name, start_month, job_rank) values
  ('a0000000-1111-0000-0000-000000000001', 'A사', '2020-01-01', 'S'),
  ('a0000000-1111-0000-0000-000000000002', 'C사', '2018-01-01', 'J');
insert into public.educations (id, institution_name, education_type, start_month)
  values ('a0000000-2222-0000-0000-000000000001', '한빛대', 'degree', '2015-03-01');
insert into public.projects (id, experience_id, education_id, name, role) values
  ('a0000000-3333-0000-0000-000000000001', 'a0000000-1111-0000-0000-000000000001', null, '결제', 'Dev'),
  ('a0000000-3333-0000-0000-000000000002', null, 'a0000000-2222-0000-0000-000000000001', '졸업 프로젝트', 'Lead'),
  ('a0000000-3333-0000-0000-000000000003', null, null, '사이드', 'Dev');
insert into public.project_details (id, project_id, title, situation, action) values
  ('a0000000-4444-0000-0000-000000000001', 'a0000000-3333-0000-0000-000000000001', 't1', 's1', 'a1'),
  ('a0000000-4444-0000-0000-000000000002', 'a0000000-3333-0000-0000-000000000001', 't2', 's2', 'a2'),
  ('a0000000-4444-0000-0000-000000000003', 'a0000000-3333-0000-0000-000000000002', 't3', 's3', 'a3'),
  ('a0000000-4444-0000-0000-000000000004', 'a0000000-3333-0000-0000-000000000003', 't4', 's4', 'a4');
insert into public.skills (id, name) values ('a0000000-6666-0000-0000-000000000001', 'Postgres'),
                                            ('a0000000-6666-0000-0000-000000000002', 'Kafka');
reset role;

insert into public.application_projects (id, user_id, name, name_source) values
  ('a0000000-aaaa-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '가 프로젝트', 'user'),
  ('a0000000-aaaa-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '나 프로젝트', 'user');

-- Results (as postgres: fixed rows). DR1: career description in AP1 (experience section E1 + education section).
-- CL1 (AP1): Q1 sources P1 [D1], Q2 evidence on skill S1, Q3 source P2 (ED1), Q4 source E2 only.
-- CL2 (AP2): Q5 evidence on D2.
insert into public.drafts (id, user_id, application_project_id, draft_type, title, status) values
  ('a0000000-eeee-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001',
   'career_description', '경력기술서', 'generating'),
  ('a0000000-cccc-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001',
   'cover_letter', '자소서', 'composing'),
  ('a0000000-cccc-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000002',
   'cover_letter', '자소서2', 'composing');
insert into public.draft_sections (id, user_id, draft_id, sort_order, section_kind, experience_id, education_id) values
  ('a0000000-5e00-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-eeee-0000-0000-000000000001', 0,
   'experience', 'a0000000-1111-0000-0000-000000000001', null),
  ('a0000000-5e00-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'a0000000-eeee-0000-0000-000000000001', 1,
   'education', null, 'a0000000-2222-0000-0000-000000000001');
insert into public.draft_sections (id, user_id, draft_id, sort_order, section_kind, question_text, count_basis, user_note,
                                   status, ai_content, edited_content, ai_char_count, question_class, completed_at,
                                   provider, model, model_tier, connection_tier, source_selection_mode)
select ('a0000000-5c00-0000-0000-00000000000' || n)::uuid, 'a0000000-0000-0000-0000-000000000001',
       case when n = 5 then 'a0000000-cccc-0000-0000-000000000002'::uuid else 'a0000000-cccc-0000-0000-000000000001'::uuid end,
       n, 'cover_letter_question', '문항 ' || n, 'with_spaces', '메모 ' || n, 'ready',
       '[{"block_id":"p1","block_kind":"paragraph","text":"본문"}]', '[{"block_id":"p1","block_kind":"paragraph","text":"편집"}]',
       2, 'motivation', now(), 'gemini', 'm', 'default', 'free', case when n = 1 then 'user' else 'ai' end
  from generate_series(1, 5) n;
insert into public.draft_section_sources (user_id, draft_section_id, application_project_id, experience_id, education_id,
                                          project_id, project_detail_ids, role, origin, sort_order, source_label) values
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-5c00-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001',
   'a0000000-1111-0000-0000-000000000001', null, 'a0000000-3333-0000-0000-000000000001',
   '{a0000000-4444-0000-0000-000000000001,a0000000-4444-0000-0000-000000000002}', 'primary', 'user', 0, 'A사 › 결제'),
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-5c00-0000-0000-000000000003', 'a0000000-aaaa-0000-0000-000000000001',
   null, 'a0000000-2222-0000-0000-000000000001', 'a0000000-3333-0000-0000-000000000002', '{}', 'primary', 'ai', 0, null),
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-5c00-0000-0000-000000000004', 'a0000000-aaaa-0000-0000-000000000001',
   'a0000000-1111-0000-0000-000000000002', null, null, '{}', 'primary', 'ai', 0, null);
insert into public.evidence_links (user_id, application_project_id, owner_type, owner_id, item_key, source_type, source_id,
                                   source_field, quote) values
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001', 'draft_section',
   'a0000000-5e00-0000-0000-000000000001', 'b1', 'project', 'a0000000-3333-0000-0000-000000000001', 'name', '결제'),
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001', 'draft_section',
   'a0000000-5c00-0000-0000-000000000002', 'p1', 'skill', 'a0000000-6666-0000-0000-000000000001', 'name', 'Postgres'),
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000002', 'draft_section',
   'a0000000-5c00-0000-0000-000000000005', 'p1', 'project_detail', 'a0000000-4444-0000-0000-000000000002', 'action', 'a2'),
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001', 'draft_section',
   'a0000000-5c00-0000-0000-000000000001', 'sources.0', 'project', 'a0000000-3333-0000-0000-000000000001', 'name', '결제');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- ── get_deletion_impact ──
select is(public.get_deletion_impact('project_detail', 'a0000000-4444-0000-0000-000000000002') -> 'affected_results',
          '{"by_application_project": [
             {"name": "가 프로젝트", "drafts": 0, "insights": 0, "draft_sections": 1, "interview_sessions": 0,
              "application_project_id": "a0000000-aaaa-0000-0000-000000000001"},
             {"name": "나 프로젝트", "drafts": 0, "insights": 0, "draft_sections": 1, "interview_sessions": 0,
              "application_project_id": "a0000000-aaaa-0000-0000-000000000002"}]}'::jsonb,
          'impact: detail -> Q1 (source detail ids) and Q5 (evidence), by project name');
select is(public.get_deletion_impact('project', 'a0000000-3333-0000-0000-000000000001') -> 'affected_results' -> 'by_application_project',
          '[{"name": "가 프로젝트", "drafts": 1, "insights": 0, "draft_sections": 1, "interview_sessions": 0,
             "application_project_id": "a0000000-aaaa-0000-0000-000000000001"},
            {"name": "나 프로젝트", "drafts": 0, "insights": 0, "draft_sections": 1, "interview_sessions": 0,
             "application_project_id": "a0000000-aaaa-0000-0000-000000000002"}]'::jsonb,
          'impact: project -> DR1 (evidence), Q1 (source + evidence counted once), Q5 (cascade detail evidence)');
select is(public.get_deletion_impact('experience', 'a0000000-1111-0000-0000-000000000001') -> 'affected_results' -> 'by_application_project',
          '[{"name": "가 프로젝트", "drafts": 1, "insights": 0, "draft_sections": 1, "interview_sessions": 0,
             "application_project_id": "a0000000-aaaa-0000-0000-000000000001"}]'::jsonb,
          'impact: experience (keep projects) -> DR1 (section header), Q1 (source experience)');
select is(public.get_deletion_impact('skill', 'a0000000-6666-0000-0000-000000000001') -> 'affected_results' -> 'by_application_project' -> 0 ->> 'draft_sections',
          '1', 'impact: skill -> Q2 (evidence)');
select is(public.get_deletion_impact('education', 'a0000000-2222-0000-0000-000000000001') -> 'affected_results' -> 'by_application_project',
          '[{"name": "가 프로젝트", "drafts": 1, "insights": 0, "draft_sections": 1, "interview_sessions": 0,
             "application_project_id": "a0000000-aaaa-0000-0000-000000000001"}]'::jsonb,
          'impact: education -> DR1 (education section), Q3 (source)');
select is(public.get_deletion_impact('skill', 'a0000000-6666-0000-0000-000000000002') -> 'affected_results' -> 'by_application_project',
          '[]'::jsonb, 'impact: unrelated skill -> nothing');

-- ── keep_results: source deletion triggers ──
select lives_ok($$select public.delete_career_item('project_detail', 'a0000000-4444-0000-0000-000000000001')$$,
                'keep_results: delete D1');
select is((select project_detail_ids::text[] from public.draft_section_sources
            where draft_section_id = 'a0000000-5c00-0000-0000-000000000001'),
          array['a0000000-4444-0000-0000-000000000002'], 'detail delete: id removed from project_detail_ids');
select is((select source_deleted_at from public.draft_section_sources
            where draft_section_id = 'a0000000-5c00-0000-0000-000000000001'), null,
          'detail delete: the source row itself is not marked deleted (DM §2.7)');
select lives_ok($$select public.delete_career_item('project', 'a0000000-3333-0000-0000-000000000002')$$,
                'keep_results: delete P2');
select results_eq($$select source_label, source_deleted_at is not null from public.draft_section_sources
                     where draft_section_id = 'a0000000-5c00-0000-0000-000000000003'$$,
                  $$values ('한빛대 › 졸업 프로젝트'::text, true)$$, 'project delete: pre-deletion label + deleted');
select results_eq($$select status, ai_content is not null from public.draft_sections where id = 'a0000000-5c00-0000-0000-000000000003'$$,
                  $$values ('ready'::text, true)$$, 'keep_results: question result kept');
select lives_ok($$select public.delete_career_item('education', 'a0000000-2222-0000-0000-000000000001')$$,
                'keep_results: delete ED1');
select is((select source_label from public.draft_section_sources where draft_section_id = 'a0000000-5c00-0000-0000-000000000003'),
          '한빛대 › 졸업 프로젝트', 'education delete: first deletion label kept');
select is((select count(*)::int from public.drafts where id = 'a0000000-eeee-0000-0000-000000000001'), 1,
          'keep_results: career description kept');
select lives_ok($$select public.delete_career_item('experience', 'a0000000-1111-0000-0000-000000000002')$$,
                'keep_results: delete E2');
select results_eq($$select source_label, source_deleted_at is not null from public.draft_section_sources
                     where draft_section_id = 'a0000000-5c00-0000-0000-000000000004'$$,
                  $$values ('C사'::text, true)$$, 'experience delete: label = company name');

-- ── delete_results ──
select lives_ok($$select public.delete_career_item('skill', 'a0000000-6666-0000-0000-000000000001', 'keep_projects', 'delete_results')$$,
                'delete_results: skill S1');
select results_eq($$select status, ai_content is null, edited_content is null, ai_char_count is null, question_class is null,
                           completed_at is null, provider is null, question_text, user_note, source_selection_mode
                      from public.draft_sections where id = 'a0000000-5c00-0000-0000-000000000002'$$,
                  $$values ('pending'::text, true, true, true, true, true, true, '문항 2'::text, '메모 2'::text, 'ai'::text)$$,
                  'delete_results: question reset, text and note kept');
select is((select count(*)::int from public.evidence_links where owner_id = 'a0000000-5c00-0000-0000-000000000002'), 0,
          'delete_results: question evidence deleted');
select is((select status from public.drafts where id = 'a0000000-cccc-0000-0000-000000000001'), 'composing',
          'delete_results: draft status recomputed (ready + pending -> composing)');

select lives_ok($$select public.delete_career_item('project', 'a0000000-3333-0000-0000-000000000001', 'keep_projects', 'delete_results')$$,
                'delete_results: project P1');
select is((select count(*)::int from public.drafts where id = 'a0000000-eeee-0000-0000-000000000001'), 0,
          'delete_results: career description document deleted');
select is((select count(*)::int from public.evidence_links where owner_id in ('a0000000-5e00-0000-0000-000000000001',
                                                                             'a0000000-5e00-0000-0000-000000000002')), 0,
          'delete_results: its section evidence deleted');
select results_eq($$select status, ai_content is null, source_selection_mode,
                           (select count(*)::int from public.draft_section_sources where draft_section_id = s.id)
                      from public.draft_sections s where s.id in ('a0000000-5c00-0000-0000-000000000001',
                                                                  'a0000000-5c00-0000-0000-000000000005') order by s.id$$,
                  $$values ('pending'::text, true, 'ai'::text, 0), ('pending', true, 'ai', 0)$$,
                  'delete_results: Q1 (source) and Q5 (detail evidence via cascade) reset, sources removed');
select is((select status from public.drafts where id = 'a0000000-cccc-0000-0000-000000000002'), 'composing',
          'delete_results: other project''s draft recomputed');
select results_eq($$select status from public.draft_sections where id in ('a0000000-5c00-0000-0000-000000000003',
                                                                          'a0000000-5c00-0000-0000-000000000004') order by id$$,
                  array['ready', 'ready'], 'delete_results: untouched questions stay ready');

-- reset helper cannot touch another user's rows
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(private.reset_cover_letter_sections(array['a0000000-5c00-0000-0000-000000000003'::uuid]), 0,
          'reset helper: B cannot reset A''s question');
select is(private.career_deletion_section_ids('a0000000-0000-0000-0000-000000000001', 'project',
            'a0000000-3333-0000-0000-000000000003', 'keep_projects'), '{}'::uuid[],
          'section ids helper: RLS hides A''s rows from B');
reset role;
select is((select status from public.draft_sections where id = 'a0000000-5c00-0000-0000-000000000003'), 'ready',
          'reset helper: A''s question untouched');

select * from finish();
rollback;
