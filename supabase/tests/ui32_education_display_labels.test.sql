-- UI32-2: education display name (trimmed program_name, else trimmed institution_name, else null) in label builders,
-- the education / project delete triggers, and the stored-label backfill.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ── helper ──
select is(private.education_display_name('  데이터 분석 과정 ', '한빛대'), '데이터 분석 과정', 'helper: trimmed program first');
select is(private.education_display_name('   ', ' 한빛대 '), '한빛대', 'helper: blank program -> trimmed institution');
select is(private.education_display_name(null, '한빛대'), '한빛대', 'helper: null program -> institution');
select is(private.education_display_name(' ', ''), null, 'helper: both blank -> null');
select is(private.education_display_name(null, null), null, 'helper: both null -> null');
-- QA-01: same whitespace set as JS String.prototype.trim(), not just U+0020.
select is(private.education_display_name(E'\t', '한빛대'), '한빛대', 'helper: tab-only program -> institution (JS trim)');
select is(private.education_display_name(E'　데이터　', '한빛대'), '데이터', 'helper: full-width spaces trimmed (U+3000)');
select is(private.education_display_name(E'　', E' 한빛대\n'), '한빛대', 'helper: U+3000-only program -> NBSP/newline-trimmed institution');
select is(private.education_display_name(E'\t\r\n', E'﻿ '), null, 'helper: tab/newline/BOM/em-space only -> null');
select is(private.trim_js_whitespace(E'\u0085a b\u0085'), E'\u0085a b\u0085', 'trim: U+0085 kept, inner space kept (as JS)');

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
-- ED1 program + institution, ED2 institution only, ED3 program only (draft), ED4 program + institution (deleted later).
insert into public.educations (id, institution_name, program_name, education_type, start_month) values
  ('a0000000-2222-0000-0000-000000000001', '한빛대', ' 컴퓨터공학 ', 'degree', '2015-03-01'),
  ('a0000000-2222-0000-0000-000000000002', '두리대', null, 'degree', '2012-03-01'),
  ('a0000000-2222-0000-0000-000000000003', null, '부트캠프', 'course', '2019-01-01'),
  ('a0000000-2222-0000-0000-000000000004', '세빛원', '디자인 과정', 'course', '2018-01-01');
insert into public.experiences (id, company_name, start_month, job_rank) values
  ('a0000000-1111-0000-0000-000000000001', 'A사', '2020-01-01', 'S');
insert into public.projects (id, experience_id, education_id, name, situation, action) values
  ('a0000000-3333-0000-0000-000000000001', null, 'a0000000-2222-0000-0000-000000000001', '졸업 프로젝트', 's', 'a'),
  ('a0000000-3333-0000-0000-000000000002', null, 'a0000000-2222-0000-0000-000000000002', '논문', 's', 'a'),
  ('a0000000-3333-0000-0000-000000000003', null, 'a0000000-2222-0000-0000-000000000003', '팀 과제', 's', 'a'),
  ('a0000000-3333-0000-0000-000000000004', null, 'a0000000-2222-0000-0000-000000000001', '캡스톤', 's', 'a'),
  ('a0000000-3333-0000-0000-000000000005', null, 'a0000000-2222-0000-0000-000000000004', '포트폴리오', 's', 'a'),
  ('a0000000-3333-0000-0000-000000000006', 'a0000000-1111-0000-0000-000000000001', null, '결제', 's', 'a');
reset role;

-- ── label builders ──
select is(private.draft_source_parent_name('a0000000-0000-0000-0000-000000000001', null, 'a0000000-2222-0000-0000-000000000001'),
          '컴퓨터공학', 'parent name: education -> trimmed program');
select is(private.draft_source_parent_name('a0000000-0000-0000-0000-000000000001', null, 'a0000000-2222-0000-0000-000000000002'),
          '두리대', 'parent name: education without program -> institution');
select is(private.draft_source_parent_name('a0000000-0000-0000-0000-000000000001', 'a0000000-1111-0000-0000-000000000001', null),
          'A사', 'parent name: experience unchanged');
select is(private.draft_source_parent_name('b0000000-0000-0000-0000-000000000002', null, 'a0000000-2222-0000-0000-000000000001'),
          null, 'parent name: another user''s education -> null');
select is(private.draft_source_label('a0000000-0000-0000-0000-000000000001', null, 'a0000000-2222-0000-0000-000000000001',
                                     'a0000000-3333-0000-0000-000000000001'),
          '컴퓨터공학 › 졸업 프로젝트', 'label: program › project');
select is(private.draft_source_label('a0000000-0000-0000-0000-000000000001', null, 'a0000000-2222-0000-0000-000000000003', null),
          '부트캠프', 'label: education only, program without institution');

-- ── fixtures in the pre-UI32 label format (institution_name) ──
insert into public.application_projects (id, user_id, name, name_source) values
  ('a0000000-aaaa-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '가 프로젝트', 'user');
insert into public.drafts (id, user_id, application_project_id, draft_type, title, status) values
  ('a0000000-cccc-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001',
   'cover_letter', '자소서', 'composing');
insert into public.draft_sections (id, user_id, draft_id, sort_order, section_kind, question_text, count_basis)
select ('a0000000-5c00-0000-0000-00000000000' || n)::uuid, 'a0000000-0000-0000-0000-000000000001',
       'a0000000-cccc-0000-0000-000000000001', n, 'cover_letter_question', '문항 ' || n, 'with_spaces'
  from generate_series(1, 8) n;
-- S1 ED1 › P1 (old form) · S2 ED1 only · S3 ED2 › P2 (already right) · S4 ED3 › P3 (institution was null: project only)
-- S5 ED1 › P4 (P4 deleted below, label old form) · S6 ED4 › P5 (ED4 only, deleted below) · S7 experience › P6 · S8 ED1 › P1 with
-- a label in an unknown form whose project is gone (left alone).
insert into public.draft_section_sources (user_id, draft_section_id, application_project_id, experience_id, education_id,
                                          project_id, role, origin, sort_order, source_label) values
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-5c00-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001',
   null, 'a0000000-2222-0000-0000-000000000001', 'a0000000-3333-0000-0000-000000000001', 'primary', 'ai', 0, '한빛대 › 졸업 프로젝트'),
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-5c00-0000-0000-000000000002', 'a0000000-aaaa-0000-0000-000000000001',
   null, 'a0000000-2222-0000-0000-000000000001', null, 'primary', 'user', 0, '한빛대'),
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-5c00-0000-0000-000000000003', 'a0000000-aaaa-0000-0000-000000000001',
   null, 'a0000000-2222-0000-0000-000000000002', 'a0000000-3333-0000-0000-000000000002', 'primary', 'ai', 0, '두리대 › 논문'),
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-5c00-0000-0000-000000000004', 'a0000000-aaaa-0000-0000-000000000001',
   null, 'a0000000-2222-0000-0000-000000000003', 'a0000000-3333-0000-0000-000000000003', 'primary', 'ai', 0, '팀 과제'),
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-5c00-0000-0000-000000000005', 'a0000000-aaaa-0000-0000-000000000001',
   null, 'a0000000-2222-0000-0000-000000000001', 'a0000000-3333-0000-0000-000000000004', 'primary', 'ai', 0, '한빛대 › 캡스톤'),
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-5c00-0000-0000-000000000006', 'a0000000-aaaa-0000-0000-000000000001',
   null, 'a0000000-2222-0000-0000-000000000004', null, 'primary', 'user', 0, '세빛원'),
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-5c00-0000-0000-000000000007', 'a0000000-aaaa-0000-0000-000000000001',
   'a0000000-1111-0000-0000-000000000001', null, 'a0000000-3333-0000-0000-000000000006', 'primary', 'ai', 0, 'A사 › 결제'),
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-5c00-0000-0000-000000000008', 'a0000000-aaaa-0000-0000-000000000001',
   null, 'a0000000-2222-0000-0000-000000000001', 'a0000000-3333-0000-0000-0000000000ff', 'primary', 'ai', 0, '옛 이름 › 사라진 과제');
update public.draft_section_sources set source_deleted_at = now()
 where draft_section_id = 'a0000000-5c00-0000-0000-000000000008';

-- evidence: EV1 ED1 (old label) · EV2 ED2 (already right) · EV3 ED3 (old label null) · EV4 project under ED1 (project
-- name only, untouched) · EV5 ED4 (deleted below: label kept)
insert into public.evidence_links (user_id, application_project_id, owner_type, owner_id, item_key, source_type, source_id,
                                   source_field, quote, source_label) values
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001', 'draft_section',
   'a0000000-5c00-0000-0000-000000000001', 'e1', 'education', 'a0000000-2222-0000-0000-000000000001', 'institution_name', '한빛대', '한빛대'),
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001', 'draft_section',
   'a0000000-5c00-0000-0000-000000000001', 'e2', 'education', 'a0000000-2222-0000-0000-000000000002', 'institution_name', '두리대', '두리대'),
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001', 'draft_section',
   'a0000000-5c00-0000-0000-000000000001', 'e3', 'education', 'a0000000-2222-0000-0000-000000000003', 'program_name', '부트캠프', null),
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001', 'draft_section',
   'a0000000-5c00-0000-0000-000000000001', 'e4', 'project', 'a0000000-3333-0000-0000-000000000001', 'name', '졸업 프로젝트', '졸업 프로젝트'),
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001', 'draft_section',
   'a0000000-5c00-0000-0000-000000000001', 'e5', 'education', 'a0000000-2222-0000-0000-000000000004', 'institution_name', '세빛원', '세빛원');

-- ── delete triggers (new rule) ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
delete from public.projects where id = 'a0000000-3333-0000-0000-000000000004';
delete from public.educations where id = 'a0000000-2222-0000-0000-000000000004';
reset role;

select results_eq($$select source_label, source_deleted_at is not null from public.draft_section_sources
                     where draft_section_id = 'a0000000-5c00-0000-0000-000000000005'$$,
                  $$values ('컴퓨터공학 › 캡스톤'::text, true)$$, 'project delete under an education: "<program> › <project>"');
select results_eq($$select source_label, source_deleted_at is not null from public.draft_section_sources
                     where draft_section_id = 'a0000000-5c00-0000-0000-000000000006'$$,
                  $$values ('디자인 과정'::text, true)$$, 'education delete: label = program name');

-- reset S5 to the pre-UI32 deleted-project form to exercise backfill rule (b)
update public.draft_section_sources set source_label = '한빛대 › 캡스톤'
 where draft_section_id = 'a0000000-5c00-0000-0000-000000000005';

-- ── backfill ──
select results_eq($$select * from private.backfill_education_display_labels()$$,
                  $$values (2, 4)$$, 'backfill: EV1 + EV3; S1 + S2 + S4 (live) + S5 (deleted project)');

select results_eq($$select source_label from public.draft_section_sources s
                      join public.draft_sections d on d.id = s.draft_section_id
                     where s.user_id = 'a0000000-0000-0000-0000-000000000001' order by d.sort_order$$,
                  $$values ('컴퓨터공학 › 졸업 프로젝트'::text), ('컴퓨터공학'), ('두리대 › 논문'), ('부트캠프 › 팀 과제'),
                           ('컴퓨터공학 › 캡스톤'), ('디자인 과정'), ('A사 › 결제'), ('옛 이름 › 사라진 과제')$$,
                  'backfill: draft_section_sources labels (experience row and unknown-form deleted row untouched)');
select results_eq($$select item_key, source_label from public.evidence_links
                     where user_id = 'a0000000-0000-0000-0000-000000000001' order by item_key$$,
                  $$values ('e1'::text, '컴퓨터공학'::text), ('e2', '두리대'), ('e3', '부트캠프'), ('e4', '졸업 프로젝트'), ('e5', '세빛원')$$,
                  'backfill: evidence_links education labels; project and gone-source rows untouched');
select results_eq($$select * from private.backfill_education_display_labels()$$, $$values (0, 0)$$,
                  'backfill: idempotent');

-- blank names never clear a label
update public.educations set program_name = ' ', institution_name = null
 where id = 'a0000000-2222-0000-0000-000000000003';
select results_eq($$select * from private.backfill_education_display_labels()$$, $$values (0, 1)$$,
                  'backfill: EV3 keeps its label; live S4 follows the save RPC label (project name only)');
select is((select source_label from public.draft_section_sources where draft_section_id = 'a0000000-5c00-0000-0000-000000000004'),
          '팀 과제', 'blank names: live source label = project name');
select is((select source_label from public.evidence_links
           where user_id = 'a0000000-0000-0000-0000-000000000001' and item_key = 'e3'), '부트캠프', 'blank names: evidence label kept');

-- privileges
select ok(not has_function_privilege('authenticated', 'private.backfill_education_display_labels()', 'execute'),
          'authenticated cannot run the backfill');
select ok(not has_function_privilege('app_ai_writer', 'private.backfill_education_display_labels()', 'execute'),
          'app_ai_writer cannot run the backfill');

select * from finish();
rollback;
