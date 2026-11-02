-- S7 drafts / draft_sections / draft_section_sources (DM A.9–A.11, §2.7, §5; AI-04 storage): RLS and grants,
-- cover letter user RPCs (seed, add / delete / reorder, set_section_sources), direct user updates, cover letter
-- question generation (begin / complete / fail, AI and user source modes, sources.{n} evidence, run-generation
-- guard, manual retry reopen), draft status recompute, the ai_jobs end trigger, cross-user isolation, cascades.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

-- ── schema ────────────────────────────────────────────────────────────────
select ok((select bool_and(relrowsecurity) from pg_class
            where oid in ('public.drafts'::regclass, 'public.draft_sections'::regclass,
                          'public.draft_section_sources'::regclass)), 'RLS enabled on the 3 draft tables');
select policies_are('public', 'drafts', array['drafts_select_own', 'drafts_update_own', 'drafts_delete_own',
                                              'drafts_select_ai_writer']);
select policies_are('public', 'draft_sections', array['draft_sections_select_own', 'draft_sections_update_own',
                                                      'draft_sections_select_ai_writer']);
select policies_are('public', 'draft_section_sources', array['draft_section_sources_select_own',
                                                             'draft_section_sources_select_ai_writer']);
select has_index('public', 'drafts', 'drafts_project_type_created_idx', 'drafts (project, type, created_at) index');
select has_index('public', 'drafts', 'drafts_reuse_idx', 'drafts input_hash reuse index');

-- ── fixtures ──────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into public.experiences (id, company_name, start_month, job_rank)
  values ('a0000000-1111-0000-0000-000000000001', 'A사', '2020-01-01', 'S');
insert into public.educations (id, institution_name, education_type, start_month)
  values ('a0000000-2222-0000-0000-000000000001', '한빛대', 'degree', '2015-03-01');
insert into public.projects (id, experience_id, education_id, name, role) values
  ('a0000000-3333-0000-0000-000000000001', 'a0000000-1111-0000-0000-000000000001', null, '결제', 'Dev'),
  ('a0000000-3333-0000-0000-000000000002', null, 'a0000000-2222-0000-0000-000000000001', '졸업 프로젝트', 'Lead'),
  ('a0000000-3333-0000-0000-000000000003', null, null, '사이드', 'Dev'),
  ('a0000000-3333-0000-0000-000000000004', null, null, '미완', 'Dev');
insert into public.project_details (id, project_id, title, situation, action, result, learnings) values
  ('a0000000-4444-0000-0000-000000000001', 'a0000000-3333-0000-0000-000000000001', 't1', 's1', '인덱스 재설계', 'r1', null),
  ('a0000000-4444-0000-0000-000000000002', 'a0000000-3333-0000-0000-000000000002', 't2', 's2', 'a2', 'r2', null),
  ('a0000000-4444-0000-0000-000000000003', 'a0000000-3333-0000-0000-000000000003', 't3', 's3', 'a3', 'r3', null),
  ('a0000000-4444-0000-0000-000000000005', 'a0000000-3333-0000-0000-000000000001', 't5', 's5', 'a5', 'r5', '배운 점');
insert into public.skills (id, name) values ('a0000000-6666-0000-0000-000000000001', 'Postgres');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}';
insert into public.experiences (id, company_name, start_month, job_rank)
  values ('b0000000-1111-0000-0000-000000000001', 'B사', '2020-01-01', 'S');
insert into public.projects (id, experience_id, name, role)
  values ('b0000000-3333-0000-0000-000000000001', 'b0000000-1111-0000-0000-000000000001', 'B 결제', 'Dev');
insert into public.project_details (id, project_id, title, situation, action)
  values ('b0000000-4444-0000-0000-000000000001', 'b0000000-3333-0000-0000-000000000001', 't', 's', 'a');
reset role;

select results_eq($$select status from public.projects where user_id = 'a0000000-0000-0000-0000-000000000001' order by id$$,
                  array['complete', 'complete', 'complete', 'draft'], 'fixture: P1–P3 complete, P4 draft');

insert into public.application_projects (id, user_id, name, name_source) values
  ('a0000000-aaaa-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '에이 – 백엔드', 'ai'),
  ('a0000000-aaaa-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '대기', 'user'),
  ('a0000000-aaaa-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', '씨', 'user'),
  ('b0000000-aaaa-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'B', 'user');
update public.application_projects set last_activity_at = '2026-01-01' where id = 'a0000000-aaaa-0000-0000-000000000001';
insert into public.job_descriptions (id, user_id, application_project_id, raw_text, raw_text_hash, sentences,
                                     extraction_status, extraction, tech_keywords, requirements_hash,
                                     extraction_provider, extraction_model) values
  ('a0000000-dddd-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001',
   '결제 API 설계 Kafka 경험 우대', 'h',
   '[{"sid":"S1","text":"결제 API 설계","start":0,"end":9},{"sid":"S2","text":"Kafka 경험 우대","start":10,"end":21}]',
   'succeeded', '{}', '[]', 'rh', 'gemini', 'm'),
  ('a0000000-dddd-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000003',
   '다른 공고', 'h', '[{"sid":"S1","text":"다른 공고","start":0,"end":5}]', 'succeeded', '{}', '[]', 'rh3', 'gemini', 'm');
insert into public.job_descriptions (id, user_id, application_project_id, raw_text, raw_text_hash, sentences) values
  ('a0000000-dddd-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000002',
   '대기 공고', 'h', '[{"sid":"S1","text":"대기 공고","start":0,"end":5}]');
insert into public.jd_requirements (id, user_id, job_description_id, category, content, source_sids, sort_order) values
  ('a0000000-8888-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-dddd-0000-0000-000000000001',
   'responsibility', '결제 API 설계', '{S1}', 0),
  ('a0000000-8888-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'a0000000-dddd-0000-0000-000000000003',
   'required', '다른 요건', '{S1}', 0);


-- ══ cover letter user RPCs ═══════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok($$insert into public.drafts (application_project_id, draft_type, title, status)
                   values ('a0000000-aaaa-0000-0000-000000000001', 'cover_letter', 't', 'composing')$$,
                 '42501', null, 'user cannot insert drafts directly');

create temp table t_res (k text primary key, v jsonb);
insert into t_res values ('cl1', public.create_cover_letter_draft('a0000000-aaaa-0000-0000-000000000001',
                                                                  'a0000000-cccc-0000-0000-000000000001'));
select is((select v ->> 'created' from t_res where k = 'cl1'), 'true', 'create: created');
select is((select v ->> 'status' from t_res where k = 'cl1'), 'composing', 'create: composing');
select ok((select v ->> 'title' from t_res where k = 'cl1') ~ '^자기소개서 \(\d{4}-\d{2}-\d{2}\)$', 'create: default title');
select results_eq($$select sort_order, template_key, question_text, char_limit, count_basis, status, section_kind,
                           source_selection_mode, generation_no
                      from public.draft_sections where draft_id = 'a0000000-cccc-0000-0000-000000000001' order by sort_order$$,
                  $$values (0, 'motivation'::text, '지원 동기'::text, 1000, 'with_spaces'::text, 'pending'::text,
                            'cover_letter_question'::text, 'ai'::text, 0),
                           (1, 'job_competency', '직무 역량', 1000, 'with_spaces', 'pending', 'cover_letter_question', 'ai', 0),
                           (2, 'future_plan', '입사 후 포부 및 성장 계획', 1000, 'with_spaces', 'pending',
                            'cover_letter_question', 'ai', 0)$$,
                  'create: 3 seeded questions (AI-04)');
select is(public.create_cover_letter_draft('a0000000-aaaa-0000-0000-000000000001',
                                           'a0000000-cccc-0000-0000-000000000001') ->> 'created',
          'false', 'create: same p_draft_id is idempotent');
select is((select count(*)::int from public.draft_sections where draft_id = 'a0000000-cccc-0000-0000-000000000001'),
          3, 'create: no duplicate seed');
select throws_ok($$select public.create_cover_letter_draft('a0000000-aaaa-0000-0000-000000000003',
                     'a0000000-cccc-0000-0000-000000000001')$$, 'P0001', 'draft_id_conflict',
                 'create: same id for another project');
select throws_ok($$select public.create_cover_letter_draft('b0000000-aaaa-0000-0000-000000000001')$$,
                 'P0001', 'application_project_not_found', 'create: another user''s project');
select throws_ok($$select public.create_cover_letter_draft('a0000000-aaaa-0000-0000-000000000001', null, repeat('x', 101))$$,
                 'P0001', 'invalid_title', 'create: title > 100');
select is(public.create_cover_letter_draft('a0000000-aaaa-0000-0000-000000000001',
                                           'a0000000-cccc-0000-0000-000000000002', '  카카오 자소서 ') ->> 'title',
          '카카오 자소서', 'create: custom title trimmed');

-- add
select is(public.add_cover_letter_question('a0000000-cccc-0000-0000-000000000001', '갈등 해결 경험', 800, 'without_spaces',
                                           'a0000000-c5c5-0000-0000-000000000004') ->> 'sort_order',
          '3', 'add: appended at the end');
select is(public.add_cover_letter_question('a0000000-cccc-0000-0000-000000000001', '다른 문구', 800, 'without_spaces',
                                           'a0000000-c5c5-0000-0000-000000000004') ->> 'created',
          'false', 'add: same p_section_id is idempotent');
select results_eq($$select template_key, char_limit, count_basis, question_text from public.draft_sections
                     where id = 'a0000000-c5c5-0000-0000-000000000004'$$,
                  $$values (null::text, 800, 'without_spaces'::text, '갈등 해결 경험'::text)$$,
                  'add: user question has no template_key');
select throws_ok($$select public.add_cover_letter_question('a0000000-cccc-0000-0000-000000000001', '  ')$$,
                 'P0001', 'invalid_question', 'add: blank text');
select throws_ok($$select public.add_cover_letter_question('a0000000-cccc-0000-0000-000000000001', 'q', 0)$$,
                 'P0001', 'invalid_question', 'add: char_limit 0');
select throws_ok($$select public.add_cover_letter_question('a0000000-cccc-0000-0000-000000000001', 'q', 500, 'bytes')$$,
                 'P0001', 'invalid_question', 'add: bad count_basis');
select throws_ok($$select public.add_cover_letter_question('a0000000-cccc-0000-0000-000000000001', 'q', 500,
                     'with_spaces', (select id from public.draft_sections where draft_id = 'a0000000-cccc-0000-0000-000000000002' limit 1))$$,
                 'P0001', 'section_id_conflict', 'add: p_section_id taken by another row');
select is((select count(*)::int from (select public.add_cover_letter_question('a0000000-cccc-0000-0000-000000000001', 'q' || n)
                                        from generate_series(1, 6) n) x), 6, 'add: up to 10 questions');
select throws_ok($$select public.add_cover_letter_question('a0000000-cccc-0000-0000-000000000001', 'q11')$$,
                 'P0001', 'question_limit_reached', 'add: 11th question refused');
select throws_ok($$select public.add_cover_letter_question('a0000000-cccc-0000-0000-000000000099', 'q')$$,
                 'P0001', 'draft_not_found', 'add: unknown draft');

-- delete
select is((select count(*)::int from (select public.delete_cover_letter_question(s.id)
                                        from (select id from public.draft_sections
                                               where draft_id = 'a0000000-cccc-0000-0000-000000000001'
                                                 and question_text ~ '^q[0-9]$') s) x), 6, 'delete: 6 questions');

-- reorder
select is(public.reorder_cover_letter_questions('a0000000-cccc-0000-0000-000000000001',
            (select array_agg(id order by sort_order desc) from public.draft_sections
              where draft_id = 'a0000000-cccc-0000-0000-000000000001')) -> 'section_ids' ->> 0,
          'a0000000-c5c5-0000-0000-000000000004', 'reorder: new order returned');
select results_eq($$select sort_order from public.draft_sections where draft_id = 'a0000000-cccc-0000-0000-000000000001'
                     order by sort_order$$, array[0, 1, 2, 3], 'reorder: contiguous 0..3');
select is((select template_key from public.draft_sections where draft_id = 'a0000000-cccc-0000-0000-000000000001'
            and sort_order = 3), 'motivation', 'reorder: motivation is now last');
select throws_ok($$select public.reorder_cover_letter_questions('a0000000-cccc-0000-0000-000000000001',
                     (select array_agg(id) from public.draft_sections
                       where draft_id = 'a0000000-cccc-0000-0000-000000000001' and sort_order < 3))$$,
                 'P0001', 'invalid_section_order', 'reorder: missing a question');
select throws_ok($$select public.reorder_cover_letter_questions('a0000000-cccc-0000-0000-000000000001',
                     (select array_agg(id) || (select id from public.draft_sections where draft_id = 'a0000000-cccc-0000-0000-000000000002' limit 1)
                        from public.draft_sections where draft_id = 'a0000000-cccc-0000-0000-000000000001' and sort_order < 3))$$,
                 'P0001', 'invalid_section_order', 'reorder: question of another draft');

-- direct updates (column grants)
select lives_ok($$update public.draft_sections set question_text = '우리 회사에 지원한 이유', user_note = '메모',
                    char_limit = 700, count_basis = 'without_spaces'
                   where draft_id = 'a0000000-cccc-0000-0000-000000000001' and template_key = 'motivation'$$,
                'user: update question text / note / limit');
select is((select template_key from public.draft_sections where question_text = '우리 회사에 지원한 이유'),
          'motivation', 'user: template_key kept after text edit');
select throws_ok($$update public.draft_sections set ai_content = '[]' where draft_id = 'a0000000-cccc-0000-0000-000000000001'$$,
                 '42501', null, 'user: ai_content not writable');
select throws_ok($$update public.draft_sections set status = 'ready' where draft_id = 'a0000000-cccc-0000-0000-000000000001'$$,
                 '42501', null, 'user: status not writable');
select throws_ok($$update public.draft_sections set user_note = repeat('x', 301) where draft_id = 'a0000000-cccc-0000-0000-000000000001'$$,
                 '23514', null, 'user: note <= 300');
select throws_ok($$update public.draft_sections set question_text = ' ' where draft_id = 'a0000000-cccc-0000-0000-000000000001'$$,
                 '23514', null, 'user: question text not blank');
select throws_ok($$update public.draft_sections set edited_content = '[{"block_id":"x","block_kind":"poem","text":"t"}]'
                    where draft_id = 'a0000000-cccc-0000-0000-000000000001'$$,
                 '23514', null, 'user: edited_content block kind checked');
select throws_ok($$update public.draft_sections set edited_content = '[{"block_id":"x","block_kind":"paragraph","text":"a"},
                                                                    {"block_id":"x","block_kind":"paragraph","text":"b"}]'
                    where draft_id = 'a0000000-cccc-0000-0000-000000000001'$$,
                 '23514', null, 'user: edited_content block ids unique');
select lives_ok($$update public.draft_sections set edited_content =
                    '[{"block_id":"q1-p1","block_kind":"paragraph","text":"편집본","user_modified":true,"flags":[]}]'
                   where draft_id = 'a0000000-cccc-0000-0000-000000000001' and template_key = 'motivation'$$,
                'user: edited_content blocks');
select lives_ok($$update public.drafts set title = '새 제목', edited_at = now() where id = 'a0000000-cccc-0000-0000-000000000001'$$,
                'user: title / edited_at');
update public.drafts set first_copied_at = '2026-11-01T00:00:00Z' where id = 'a0000000-cccc-0000-0000-000000000001';
update public.drafts set first_copied_at = '2026-11-05T00:00:00Z' where id = 'a0000000-cccc-0000-0000-000000000001';
update public.drafts set first_copied_at = null where id = 'a0000000-cccc-0000-0000-000000000001';
select is((select first_copied_at from public.drafts where id = 'a0000000-cccc-0000-0000-000000000001'),
          '2026-11-01T00:00:00Z'::timestamptz, 'user: first_copied_at keeps the first copy (F-DOC-04)');
select throws_ok($$update public.drafts set status = 'ready'$$, '42501', null, 'user: drafts.status not writable');
select throws_ok($$update public.drafts set options = '{}'$$, '42501', null, 'user: drafts.options not writable');
select throws_ok($$delete from public.draft_sections$$, '42501', null, 'user: no direct section delete');
select throws_ok($$insert into public.draft_section_sources (draft_section_id, application_project_id, project_id, role, origin)
                   select id, 'a0000000-aaaa-0000-0000-000000000001', 'a0000000-3333-0000-0000-000000000001', 'primary', 'user'
                     from public.draft_sections limit 1$$, '42501', null, 'user: no direct source insert');

-- last question
select is((select count(*)::int from (select public.delete_cover_letter_question(s.id)
                                        from (select id from public.draft_sections
                                               where draft_id = 'a0000000-cccc-0000-0000-000000000001'
                                               order by sort_order limit 3) s) x), 3, 'delete: down to one question');
select throws_ok($$select public.delete_cover_letter_question(
                     (select id from public.draft_sections where draft_id = 'a0000000-cccc-0000-0000-000000000001'))$$,
                 'P0001', 'last_question', 'delete: the last question stays (최소 1)');
select throws_ok($$select public.delete_cover_letter_question(gen_random_uuid())$$,
                 'P0001', 'section_not_found', 'delete: unknown question');


-- ══ set_section_sources ══════════════════════════════════════════════════
-- CL2's questions (generation tests below).
select set_config('t.q1', (select id::text from public.draft_sections where draft_id = 'a0000000-cccc-0000-0000-000000000002' and sort_order = 0), true);
select set_config('t.q2', (select id::text from public.draft_sections where draft_id = 'a0000000-cccc-0000-0000-000000000002' and sort_order = 1), true);
select set_config('t.q3', (select id::text from public.draft_sections where draft_id = 'a0000000-cccc-0000-0000-000000000002' and sort_order = 2), true);

create temp table t_src_bad (label text, v jsonb, code text);
insert into t_src_bad values
  ('not array', '{}', 'invalid_sources'),
  ('null', null, 'invalid_sources'),
  ('six items', '[{"experience_id":"a0000000-1111-0000-0000-000000000001"},{"project_id":"a0000000-3333-0000-0000-000000000001"},
                  {"project_id":"a0000000-3333-0000-0000-000000000002"},{"project_id":"a0000000-3333-0000-0000-000000000003"},
                  {"education_id":"a0000000-2222-0000-0000-000000000001"},{"project_id":"a0000000-3333-0000-0000-000000000004"}]', 'invalid_sources'),
  ('empty object', '[{}]', 'invalid_sources'),
  ('experience + education', '[{"experience_id":"a0000000-1111-0000-0000-000000000001","education_id":"a0000000-2222-0000-0000-000000000001"}]', 'invalid_sources'),
  ('details without project', '[{"experience_id":"a0000000-1111-0000-0000-000000000001","project_detail_ids":["a0000000-4444-0000-0000-000000000001"]}]', 'invalid_sources'),
  ('duplicate', '[{"project_id":"a0000000-3333-0000-0000-000000000001"},{"project_id":"a0000000-3333-0000-0000-000000000001","experience_id":"a0000000-1111-0000-0000-000000000001"}]', 'invalid_sources'),
  ('bad role', '[{"project_id":"a0000000-3333-0000-0000-000000000001","role":"lead"}]', 'invalid_sources'),
  ('bad uuid', '[{"project_id":"x"}]', 'invalid_sources'),
  ('draft project', '[{"project_id":"a0000000-3333-0000-0000-000000000004"}]', 'source_not_found'),
  ('B project', '[{"project_id":"b0000000-3333-0000-0000-000000000001"}]', 'source_not_found'),
  ('B experience', '[{"experience_id":"b0000000-1111-0000-0000-000000000001"}]', 'source_not_found'),
  ('affiliation mismatch', '[{"project_id":"a0000000-3333-0000-0000-000000000002","experience_id":"a0000000-1111-0000-0000-000000000001"}]', 'source_not_found'),
  ('detail of another project', '[{"project_id":"a0000000-3333-0000-0000-000000000001","project_detail_ids":["a0000000-4444-0000-0000-000000000003"]}]', 'source_not_found'),
  ('requirement of another project', '[{"project_id":"a0000000-3333-0000-0000-000000000001","requirement_ids":["a0000000-8888-0000-0000-000000000003"]}]', 'source_not_found');

create function pg_temp.set_sources_err(p_label text) returns text language plpgsql as $f$
begin
  perform public.set_section_sources(current_setting('t.q1')::uuid, (select v from t_src_bad where label = p_label));
  return 'no error';
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$f$;
select is_empty($$select label, pg_temp.set_sources_err(label), code from t_src_bad
                   where pg_temp.set_sources_err(label) <> 'P0001:' || code$$,
                'set_section_sources: every bad list -> its error code');
select is((select count(*)::int from public.draft_section_sources), 0, 'set_section_sources: errors write nothing');

select is(jsonb_array_length(public.set_section_sources(current_setting('t.q1')::uuid,
            '[{"project_id":"a0000000-3333-0000-0000-000000000001","project_detail_ids":["a0000000-4444-0000-0000-000000000001"],
               "requirement_ids":["a0000000-8888-0000-0000-000000000001"]},
              {"experience_id":"a0000000-1111-0000-0000-000000000001"}]') -> 'sources'), 2,
          'set_section_sources: 2 sources');
select results_eq($$select sort_order, experience_id::text, education_id::text, project_id::text, role, origin, source_label,
                           cardinality(project_detail_ids), cardinality(requirement_ids)
                      from public.draft_section_sources where draft_section_id = current_setting('t.q1')::uuid order by sort_order$$,
                  $$values (0, 'a0000000-1111-0000-0000-000000000001'::text, null::text, 'a0000000-3333-0000-0000-000000000001'::text,
                            'primary'::text, 'user'::text, 'A사 › 결제'::text, 1, 1),
                           (1, 'a0000000-1111-0000-0000-000000000001', null, null, 'supporting', 'user', 'A사', 0, 0)$$,
                  'set_section_sources: affiliation derived from the project, labels, default roles');
select results_eq($$select source_selection_mode, sources_modified_at is not null from public.draft_sections
                     where id = current_setting('t.q1')::uuid$$,
                  $$values ('user'::text, true)$$, 'set_section_sources: user mode + sources_modified_at');
select is(jsonb_array_length(public.set_section_sources(current_setting('t.q1')::uuid, '[]') -> 'sources'), 0,
          'set_section_sources: empty list allowed (memo / JD / profile only)');
reset role;


-- ══ cover letter question generation (app_ai_writer) ═════════════════════
create temp table t_cl (v jsonb);
insert into t_cl values ('{
  "question_class": "motivation",
  "blocks": [{"block_id": "q1-p1", "block_kind": "paragraph", "text": "저는 결제 시스템…", "requirement_ids": [],
              "placeholders": [], "flags": [], "generated_by": "ai", "user_modified": false}],
  "ai_char_count": 812,
  "correction_applied": true,
  "sources": [
    {"project_id": "a0000000-3333-0000-0000-000000000001", "experience_id": "a0000000-1111-0000-0000-000000000001",
     "project_detail_ids": ["a0000000-4444-0000-0000-000000000001"], "role": "primary", "rationale": "r1",
     "requirement_ids": ["a0000000-8888-0000-0000-000000000001"], "reuse_reason": null},
    {"project_id": "a0000000-3333-0000-0000-000000000002", "education_id": "a0000000-2222-0000-0000-000000000001",
     "project_detail_ids": [], "role": "supporting", "rationale": "r2", "requirement_ids": [], "reuse_reason": "대안 없음"}
  ],
  "hashes": {"input_hash": "cih1", "career_snapshot_hash": "cch1"},
  "meta": {"schema_version": 2, "prompt_version": "ai-04.generate.v1+common.v1", "provider": "gemini", "model": "gemini-x",
           "model_tier": "default", "connection_tier": "free", "validation_report": {"removed": 0}, "usage": {"input_tokens": 1}},
  "evidence": [
    {"item_key": "q1-p1", "sort_order": 0, "source_type": "project_detail", "source_id": "a0000000-4444-0000-0000-000000000001",
     "source_field": "action", "quote": "인덱스 재설계", "owner_id": "b0000000-0000-0000-0000-000000000009"},
    {"item_key": "q1-p1", "sort_order": 1, "source_type": "user_note", "source_id": "Q1", "source_field": null, "quote": "메모"},
    {"item_key": "q1-p1", "sort_order": 2, "source_type": "jd_sentence", "source_id": "a0000000-dddd-0000-0000-000000000001",
     "source_field": null, "source_locator": {"sid": "S1", "start": 0, "end": 9}},
    {"item_key": "sources.0", "sort_order": 0, "source_type": "project", "source_id": "a0000000-3333-0000-0000-000000000001",
     "source_field": "name"},
    {"item_key": "sources.1", "sort_order": 0, "source_type": "jd_requirement", "source_id": "a0000000-8888-0000-0000-000000000001",
     "source_field": null}
  ]
}');
update t_cl set v = jsonb_set(v, '{evidence,1,source_id}', to_jsonb(current_setting('t.q1')));
grant select on t_cl to app_ai_writer;

set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';

insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier)
select v.id::uuid, v.jt, v.ap::uuid, v.tt, v.tid::uuid, 'running', 1, 'gemini', 'default', 'free'
  from (values
    ('a0000000-7777-0000-0000-000000000001', 'cover_letter', 'a0000000-aaaa-0000-0000-000000000001', 'draft_section', current_setting('t.q1')),
    ('a0000000-7777-0000-0000-000000000002', 'cover_letter', 'a0000000-aaaa-0000-0000-000000000001', 'draft_section', current_setting('t.q2')),
    ('a0000000-7777-0000-0000-000000000003', 'insight', 'a0000000-aaaa-0000-0000-000000000001', 'draft_section', current_setting('t.q1')),
    ('a0000000-7777-0000-0000-000000000004', 'cover_letter', 'a0000000-aaaa-0000-0000-000000000003', 'draft_section', current_setting('t.q3'))
  ) v (id, jt, ap, tt, tid);

select throws_ok($$select public.begin_cover_letter_section(current_setting('t.q1')::uuid, 'a0000000-7777-0000-0000-000000000002')$$,
                 'P0001', 'invalid_ai_job', 'begin: job of another question');
select throws_ok($$select public.begin_cover_letter_section(current_setting('t.q1')::uuid, 'a0000000-7777-0000-0000-000000000003')$$,
                 'P0001', 'invalid_ai_job', 'begin: not a cover_letter job');
select throws_ok($$select public.begin_cover_letter_section(current_setting('t.q3')::uuid, 'a0000000-7777-0000-0000-000000000004')$$,
                 'P0001', 'invalid_ai_job', 'begin: job of another application project');
update public.ai_jobs set status = 'canceled', error_code = 'canceled' where id = 'a0000000-7777-0000-0000-000000000004';
select throws_ok($$select public.begin_cover_letter_section(gen_random_uuid(), 'a0000000-7777-0000-0000-000000000001')$$,
                 'P0001', 'section_not_found', 'begin: unknown question');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
-- Restore AI mode on Q1 is not a user action; use Q1 in user mode later. Give Q1 an edited_content to check the reset.
update public.draft_sections set edited_content = '[{"block_id":"old","block_kind":"paragraph","text":"옛 편집"}]',
                                 user_note = '메모' where id = current_setting('t.q1')::uuid;
select lives_ok($$select public.create_cover_letter_draft('a0000000-aaaa-0000-0000-000000000002', 'a0000000-cccc-0000-0000-000000000003')$$,
                'fixture: cover letter in a project whose JD is not extracted');
reset role;
-- Q1 back to AI mode for the first generation (fixture shortcut as postgres).
update public.draft_sections set source_selection_mode = 'ai', sources_modified_at = null where id = current_setting('t.q1')::uuid;

set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier)
select 'a0000000-7777-0000-0000-000000000005', 'cover_letter', 'a0000000-aaaa-0000-0000-000000000002', 'draft_section', s.id,
       'running', 1, 'gemini', 'default', 'free'
  from public.draft_sections s where s.draft_id = 'a0000000-cccc-0000-0000-000000000003' and s.sort_order = 0;
select throws_ok($$select public.begin_cover_letter_section(
                     (select id from public.draft_sections where draft_id = 'a0000000-cccc-0000-0000-000000000003' and sort_order = 0),
                     'a0000000-7777-0000-0000-000000000005')$$,
                 'P0001', 'jd_not_extracted', 'begin: JD not extracted (D-30)');

select is(public.begin_cover_letter_section(current_setting('t.q1')::uuid, 'a0000000-7777-0000-0000-000000000001') - 'section_id' - 'draft_id',
          '{"status": "generating", "reopened": false, "draft_status": "generating", "generation_no": 0,
            "source_selection_mode": "ai", "application_project_id": "a0000000-aaaa-0000-0000-000000000001"}'::jsonb,
          'begin: question generating, draft generating');
select is(public.begin_cover_letter_section(current_setting('t.q1')::uuid, 'a0000000-7777-0000-0000-000000000001') ->> 'status',
          'generating', 'begin: idempotent for the same job');
select results_eq($$select provider, model_tier, connection_tier, ai_job_id::text, run_generation from public.draft_sections
                     where id = current_setting('t.q1')::uuid$$,
                  $$values ('gemini'::text, 'default'::text, 'free'::text, 'a0000000-7777-0000-0000-000000000001'::text, 1)$$,
                  'begin: meta copied from the job');

-- user actions on a generating question
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.delete_cover_letter_question(current_setting('t.q1')::uuid)$$,
                 'P0001', 'section_generating', 'delete: question being generated');
select throws_ok($$select public.set_section_sources(current_setting('t.q1')::uuid, '[]')$$,
                 'P0001', 'section_generating', 'set_section_sources: question being generated');
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';

-- complete: guards
select is(public.complete_cover_letter_section(current_setting('t.q1')::uuid, 'a0000000-7777-0000-0000-000000000001', 2,
            (select v from t_cl)), '{"applied": false, "reason": "stale_run"}'::jsonb, 'complete: other generation -> stale_run');
select throws_ok($$select public.complete_cover_letter_section(current_setting('t.q1')::uuid, 'a0000000-7777-0000-0000-000000000002', 1,
                     (select v from t_cl))$$, 'P0001', 'invalid_ai_job', 'complete: job of another question');
select throws_ok($$select public.complete_cover_letter_section(current_setting('t.q1')::uuid, 'a0000000-7777-0000-0000-000000000001', 1,
                     jsonb_set((select v from t_cl), '{meta,provider}', '"openai"'))$$,
                 'P0001', 'invalid_ai_metadata', 'complete: provider differs from the job');

create temp table t_cl_bad (label text, v jsonb);
insert into t_cl_bad
select 'null', null
union all select 'blocks missing', (select v - 'blocks' from t_cl)
union all select 'no blocks', (select jsonb_set(v, '{blocks}', '[]') from t_cl)
union all select 'bullet block', (select jsonb_set(v, '{blocks,0,block_kind}', '"bullet"') from t_cl)
union all select 'bad block id', (select jsonb_set(v, '{blocks,0,block_id}', '"a b"') from t_cl)
union all select 'question_class bad', (select jsonb_set(v, '{question_class}', '"other"') from t_cl)
union all select 'char count negative', (select jsonb_set(v, '{ai_char_count}', '-1') from t_cl)
union all select 'char count string', (select jsonb_set(v, '{ai_char_count}', '"812"') from t_cl)
union all select 'correction missing', (select v - 'correction_applied' from t_cl)
union all select 'sources missing', (select v - 'sources' from t_cl)
union all select 'six sources', (select jsonb_set(v, '{sources}', (v -> 'sources') || (v -> 'sources') || (v -> 'sources')) from t_cl)
union all select 'source without target', (select jsonb_set(v, '{sources,0}', '{"role":"primary"}') from t_cl)
union all select 'source experience + education', (select jsonb_set(v, '{sources,0,education_id}', '"a0000000-2222-0000-0000-000000000001"') from t_cl)
union all select 'source role missing', (select jsonb_set(v, '{sources,0}', (v -> 'sources' -> 0) - 'role') from t_cl)
union all select 'rationale too long', (select jsonb_set(v, '{sources,0,rationale}', to_jsonb(repeat('x', 301))) from t_cl)
union all select 'hashes missing', (select v - 'hashes' from t_cl)
union all select 'schema_version 0', (select jsonb_set(v, '{meta,schema_version}', '0') from t_cl)
union all select 'evidence unknown item_key', (select jsonb_set(v, '{evidence,0,item_key}', '"q9-p9"') from t_cl)
union all select 'evidence sources index out of range', (select jsonb_set(v, '{evidence,3,item_key}', '"sources.2"') from t_cl)
union all select 'user_note of another question', (select jsonb_set(v, '{evidence,1,source_id}', '"a0000000-4444-0000-0000-000000000001"') from t_cl)
union all select 'user_note with field', (select jsonb_set(v, '{evidence,1,source_field}', '"note"') from t_cl)
union all select 'learnings in job_competency', (select jsonb_set(jsonb_set(v, '{question_class}', '"job_competency"'),
                                                  '{evidence,0}', '{"item_key":"q1-p1","sort_order":0,"source_type":"project_detail",
                                                  "source_id":"a0000000-4444-0000-0000-000000000005","source_field":"learnings"}') from t_cl)
union all select 'interview_answer source', (select jsonb_set(v, '{evidence,0,source_type}', '"interview_answer"') from t_cl)
union all select 'evidence bad field (CHECK)', (select jsonb_set(v, '{evidence,0,source_field}', '"company_name"') from t_cl);
grant select on t_cl_bad to app_ai_writer;

create function pg_temp.cl_bad(p_label text) returns text language plpgsql as $f$
begin
  perform public.complete_cover_letter_section(current_setting('t.q1')::uuid, 'a0000000-7777-0000-0000-000000000001', 1,
                                               (select v from t_cl_bad where label = p_label));
  return 'no error';
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$f$;
select is_empty($$select label, pg_temp.cl_bad(label) from t_cl_bad where pg_temp.cl_bad(label) <> 'P0001:invalid_draft_payload'$$,
                'complete: every malformed payload -> invalid_draft_payload');
select is((select count(*)::int from public.evidence_links), 0, 'complete: failed calls leave no evidence');
select is((select status from public.draft_sections where id = current_setting('t.q1')::uuid), 'generating',
          'complete: failed calls leave the question generating');

-- learnings are fine outside job_competency (C-9).
select is(public.complete_cover_letter_section(current_setting('t.q1')::uuid, 'a0000000-7777-0000-0000-000000000001', 1,
            jsonb_set((select v from t_cl), '{evidence,5}', '{"item_key":"q1-p1","sort_order":3,"source_type":"project_detail",
                       "source_id":"a0000000-4444-0000-0000-000000000005","source_field":"learnings","quote":"배운 점"}', true))
            - 'completed_at' - 'section_id' - 'draft_id',
          '{"applied": true, "status": "ready", "draft_status": "composing", "generation_no": 1, "source_count": 2,
            "evidence_count": 6}'::jsonb,
          'complete: applied (other questions pending -> draft composing)');
select results_eq($$select status, generation_no, ai_char_count, correction_applied, question_class, edited_content is null,
                           ai_content -> 0 ->> 'block_id', model, prompt_version, schema_version, input_hash,
                           career_snapshot_hash, sources_modified_at is null, completed_at is not null,
                           validation_report ->> 'removed', usage ->> 'input_tokens'
                      from public.draft_sections where id = current_setting('t.q1')::uuid$$,
                  $$values ('ready'::text, 1, 812, true, 'motivation'::text, true, 'q1-p1'::text, 'gemini-x'::text,
                            'ai-04.generate.v1+common.v1'::text, 2, 'cih1'::text, 'cch1'::text, true, true, '0'::text, '1'::text)$$,
                  'complete: question stored, edited_content reset (S7 [가정 4])');
select results_eq($$select sort_order, origin, role, rationale, reuse_reason, source_label, project_detail_ids::text[],
                           requirement_ids::text[], source_deleted_at is null
                      from public.draft_section_sources where draft_section_id = current_setting('t.q1')::uuid order by sort_order$$,
                  $$values (0, 'ai'::text, 'primary'::text, 'r1'::text, null::text, 'A사 › 결제'::text,
                            array['a0000000-4444-0000-0000-000000000001'], array['a0000000-8888-0000-0000-000000000001'], true),
                           (1, 'ai', 'supporting', 'r2', '대안 없음', '한빛대 › 졸업 프로젝트', '{}'::text[], '{}'::text[], true)$$,
                  'complete: AI sources stored (origin ai, labels)');
select set_eq($$select item_key || ':' || source_type || ':' || owner_type from public.evidence_links
                 where owner_id = current_setting('t.q1')::uuid$$,
              array['q1-p1:project_detail:draft_section', 'q1-p1:user_note:draft_section', 'q1-p1:jd_sentence:draft_section',
                    'sources.0:project:draft_section', 'sources.1:jd_requirement:draft_section'],
              'complete: evidence by block_id and sources.{n}; owner from the RPC');
select is((select quote from public.evidence_links where source_type = 'user_note'), '메모',
          'complete: user_note evidence (source_id = question)');
select results_eq($$select status, provider, model, prompt_version, completed_at is not null from public.drafts
                     where id = 'a0000000-cccc-0000-0000-000000000002'$$,
                  $$values ('composing'::text, 'gemini'::text, 'gemini-x'::text, 'ai-04.generate.v1+common.v1'::text, true)$$,
                  'complete: draft badge = last generated question');
select ok((select last_activity_at > '2026-01-02' from public.application_projects
            where id = 'a0000000-aaaa-0000-0000-000000000001'), 'complete: project last_activity_at');
select is(public.complete_cover_letter_section(current_setting('t.q1')::uuid, 'a0000000-7777-0000-0000-000000000001', 1,
            (select v from t_cl)), '{"applied": false, "reason": "stale_run"}'::jsonb, 'complete: second call -> stale_run');
select lives_ok($$select public.complete_ai_job('a0000000-7777-0000-0000-000000000001', 1)$$, 'complete_ai_job after complete');
select is((select status from public.draft_sections where id = current_setting('t.q1')::uuid), 'ready',
          'end trigger leaves a ready question alone');

-- ── user changes the sources (carry-over + sources.{n} re-key) ──
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.set_section_sources(current_setting('t.q1')::uuid,
                    '[{"project_id":"a0000000-3333-0000-0000-000000000002"},{"project_id":"a0000000-3333-0000-0000-000000000003"}]')$$,
                'set_section_sources after generation');
select results_eq($$select sort_order, project_id::text, education_id::text, origin, role, rationale, reuse_reason
                      from public.draft_section_sources where draft_section_id = current_setting('t.q1')::uuid order by sort_order$$,
                  $$values (0, 'a0000000-3333-0000-0000-000000000002'::text, 'a0000000-2222-0000-0000-000000000001'::text,
                            'user'::text, 'primary'::text, 'r2'::text, '대안 없음'::text),
                           (1, 'a0000000-3333-0000-0000-000000000003', null, 'user', 'supporting', null, null)$$,
                  'set_section_sources: retained entry keeps rationale / reuse_reason');
select set_eq($$select item_key || ':' || source_type from public.evidence_links
                 where owner_id = current_setting('t.q1')::uuid and item_key like 'sources.%'$$,
              array['sources.0:jd_requirement'],
              'set_section_sources: retained sources.{n} evidence re-keyed, dropped entry''s evidence removed');
select is((select count(*)::int from public.evidence_links where owner_id = current_setting('t.q1')::uuid and item_key = 'q1-p1'),
          4, 'set_section_sources: body evidence untouched');
reset role;

-- ── regenerate in user mode ──
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier)
values ('a0000000-7777-0000-0000-000000000006', 'cover_letter', 'a0000000-aaaa-0000-0000-000000000001', 'draft_section',
        current_setting('t.q1')::uuid, 'running', 1, 'anthropic', 'default', 'paid');
select is(public.begin_cover_letter_section(current_setting('t.q1')::uuid, 'a0000000-7777-0000-0000-000000000006') ->> 'source_selection_mode',
          'user', 'begin (regenerate): user mode reported');
select is((select provider from public.draft_sections where id = current_setting('t.q1')::uuid), 'anthropic',
          'begin (regenerate): new provider');
select is(public.complete_cover_letter_section(current_setting('t.q1')::uuid, 'a0000000-7777-0000-0000-000000000006', 1,
            jsonb_set(jsonb_set(jsonb_set(jsonb_set((select v from t_cl), '{meta,provider}', '"anthropic"'),
                      '{meta,connection_tier}', '"paid"'),
                      '{sources}', '[{"project_id":"a0000000-3333-0000-0000-000000000002","education_id":"a0000000-2222-0000-0000-000000000001",
                                      "role":"primary","rationale":"새 이유"},
                                     {"project_id":"a0000000-3333-0000-0000-000000000001","experience_id":"a0000000-1111-0000-0000-000000000001",
                                      "role":"supporting","rationale":"목록 밖"}]'),
                      '{evidence}', '[{"item_key":"q1-p1","sort_order":0,"source_type":"project","source_id":"a0000000-3333-0000-0000-000000000002","source_field":"name"},
                                      {"item_key":"sources.0","sort_order":0,"source_type":"project","source_id":"a0000000-3333-0000-0000-000000000002","source_field":"role"},
                                      {"item_key":"sources.1","sort_order":0,"source_type":"project","source_id":"a0000000-3333-0000-0000-000000000001","source_field":"name"}]'))
            ->> 'generation_no', '2', 'complete (user mode): generation_no 2');
select results_eq($$select sort_order, project_id::text, origin, rationale from public.draft_section_sources
                     where draft_section_id = current_setting('t.q1')::uuid order by sort_order$$,
                  $$values (0, 'a0000000-3333-0000-0000-000000000002'::text, 'user'::text, '새 이유'::text),
                           (1, 'a0000000-3333-0000-0000-000000000003', 'user', null)$$,
                  'complete (user mode): user rows kept, only the rationale refreshed, outside entry ignored');
select set_eq($$select item_key || ':' || source_field from public.evidence_links where owner_id = current_setting('t.q1')::uuid$$,
              array['q1-p1:name', 'sources.0:role'],
              'complete (user mode): previous evidence replaced, outside source''s evidence dropped');
select results_eq($$select source_selection_mode, sources_modified_at is null, provider, connection_tier
                      from public.draft_sections where id = current_setting('t.q1')::uuid$$,
                  $$values ('user'::text, true, 'anthropic'::text, 'paid'::text)$$,
                  'complete (user mode): mode stays user, sources_modified_at cleared');
select lives_ok($$select public.complete_ai_job('a0000000-7777-0000-0000-000000000006', 1)$$, 'complete_ai_job');

-- ── fail / trigger / retry ──
select is(public.begin_cover_letter_section(current_setting('t.q2')::uuid, 'a0000000-7777-0000-0000-000000000002') ->> 'draft_status',
          'generating', 'begin Q2');
select is(public.fail_draft_section(current_setting('t.q2')::uuid, 'a0000000-7777-0000-0000-000000000099'), false,
          'fail: other job -> false');
select is(public.fail_draft_section(current_setting('t.q2')::uuid, 'a0000000-7777-0000-0000-000000000002'), true,
          'fail: generating -> failed');
select is(public.fail_draft_section(current_setting('t.q2')::uuid, 'a0000000-7777-0000-0000-000000000002'), false,
          'fail: already failed -> false');
select is((select status from public.drafts where id = 'a0000000-cccc-0000-0000-000000000002'), 'partially_failed',
          'draft: ready + failed + pending -> partially_failed');
select throws_ok($$select public.fail_draft_section(gen_random_uuid(), 'a0000000-7777-0000-0000-000000000002')$$,
                 'P0001', 'section_not_found', 'fail: unknown question');
-- Same run: begin does not reopen, complete is stale.
select is(public.begin_cover_letter_section(current_setting('t.q2')::uuid, 'a0000000-7777-0000-0000-000000000002') ->> 'status',
          'failed', 'begin: same-run failure is not reopened');
select is(public.complete_cover_letter_section(current_setting('t.q2')::uuid, 'a0000000-7777-0000-0000-000000000002', 1,
            jsonb_set((select v from t_cl), '{evidence}', '[]')) ->> 'applied', 'false', 'complete: same-run failure -> stale_run');
-- Manual retry (run_generation 2) without begin: complete reopens (QA-S6-01 pattern).
update public.ai_jobs set status = 'failed', error_code = 'rate_limited' where id = 'a0000000-7777-0000-0000-000000000002';
update public.ai_jobs set status = 'queued', run_generation = 2 where id = 'a0000000-7777-0000-0000-000000000002';
update public.ai_jobs set status = 'running' where id = 'a0000000-7777-0000-0000-000000000002';
select is(public.complete_cover_letter_section(current_setting('t.q2')::uuid, 'a0000000-7777-0000-0000-000000000002', 2,
            jsonb_set(jsonb_set((select v from t_cl), '{evidence}', '[]'), '{question_class}', '"job_competency"')) ->> 'applied',
          'true', 'complete: retry generation applies to the failed question');
select is((select run_generation from public.draft_sections where id = current_setting('t.q2')::uuid), 2,
          'complete: run_generation stamped');
select lives_ok($$select public.complete_ai_job('a0000000-7777-0000-0000-000000000002', 2)$$, 'complete_ai_job (retry)');

-- End trigger (failed / canceled) and reopen by begin.
insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier)
values ('a0000000-7777-0000-0000-000000000007', 'cover_letter', 'a0000000-aaaa-0000-0000-000000000001', 'draft_section',
        current_setting('t.q3')::uuid, 'running', 1, 'gemini', 'default', 'free');
select lives_ok($$select public.begin_cover_letter_section(current_setting('t.q3')::uuid, 'a0000000-7777-0000-0000-000000000007')$$,
                'begin Q3');
update public.ai_jobs set status = 'failed', error_code = 'provider_unavailable' where id = 'a0000000-7777-0000-0000-000000000007';
select results_eq($$select status, run_generation from public.draft_sections where id = current_setting('t.q3')::uuid$$,
                  $$values ('failed'::text, 1)$$, 'trigger: failed job -> failed question');
select is((select status from public.drafts where id = 'a0000000-cccc-0000-0000-000000000002'), 'partially_failed',
          'trigger: draft recomputed');
update public.ai_jobs set status = 'queued', run_generation = 2 where id = 'a0000000-7777-0000-0000-000000000007';
select is(public.begin_cover_letter_section(current_setting('t.q3')::uuid, 'a0000000-7777-0000-0000-000000000007') ->> 'reopened',
          'true', 'begin: manual retry reopens the failed question');
select is(public.complete_cover_letter_section(current_setting('t.q3')::uuid, 'a0000000-7777-0000-0000-000000000007', 1,
            jsonb_set((select v from t_cl), '{evidence}', '[]')) ->> 'applied', 'false', 'complete: old generation -> stale_run');
update public.ai_jobs set status = 'running' where id = 'a0000000-7777-0000-0000-000000000007';
select is(public.complete_cover_letter_section(current_setting('t.q3')::uuid, 'a0000000-7777-0000-0000-000000000007', 2,
            jsonb_set((select v from t_cl), '{evidence}', '[]')) ->> 'draft_status', 'ready', 'complete: all ready -> draft ready');
select lives_ok($$select public.complete_ai_job('a0000000-7777-0000-0000-000000000007', 2)$$, 'complete_ai_job (Q3)');

-- Cancel trigger on a ready question: AI original stays, question failed, draft partially_failed.
insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier)
values ('a0000000-7777-0000-0000-000000000008', 'cover_letter', 'a0000000-aaaa-0000-0000-000000000001', 'draft_section',
        current_setting('t.q3')::uuid, 'running', 1, 'gemini', 'default', 'free');
select lives_ok($$select public.begin_cover_letter_section(current_setting('t.q3')::uuid, 'a0000000-7777-0000-0000-000000000008')$$,
                'begin regenerate Q3');
update public.ai_jobs set status = 'canceled', error_code = 'canceled' where id = 'a0000000-7777-0000-0000-000000000008';
select results_eq($$select s.status, s.ai_content is not null, d.status from public.draft_sections s
                      join public.drafts d on d.id = s.draft_id where s.id = current_setting('t.q3')::uuid$$,
                  $$values ('failed'::text, true, 'partially_failed'::text)$$,
                  'trigger: canceled -> failed, previous AI original kept');

-- Takeover and section_in_progress.
reset role;
update public.draft_sections set status = 'generating', ai_job_id = 'a0000000-7777-0000-0000-000000000003'
 where id = current_setting('t.q2')::uuid;  -- job 3 is still running -> blocks
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier)
values ('a0000000-7777-0000-0000-000000000009', 'cover_letter', 'a0000000-aaaa-0000-0000-000000000001', 'draft_section',
        current_setting('t.q2')::uuid, 'running', 1, 'gemini', 'default', 'free');
select throws_ok($$select public.begin_cover_letter_section(current_setting('t.q2')::uuid, 'a0000000-7777-0000-0000-000000000009')$$,
                 'P0001', 'section_in_progress', 'begin: another active job is generating the question');
update public.ai_jobs set status = 'canceled', error_code = 'canceled' where id = 'a0000000-7777-0000-0000-000000000003';
select is(public.begin_cover_letter_section(current_setting('t.q2')::uuid, 'a0000000-7777-0000-0000-000000000009') ->> 'status',
          'generating', 'begin: generating row of an ended job is taken over');
select is((select ai_job_id::text from public.draft_sections where id = current_setting('t.q2')::uuid),
          'a0000000-7777-0000-0000-000000000009', 'begin: takeover records the new job');

-- ── cross-user ──
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"app_ai_writer"}';
select is((select count(*)::int from public.drafts), 0, 'B app_ai_writer sees no drafts of A');
select is((select count(*)::int from public.draft_sections), 0, 'B app_ai_writer sees no sections of A');
select is((select count(*)::int from public.draft_section_sources), 0, 'B app_ai_writer sees no sources of A');
select throws_ok($$select public.begin_cover_letter_section(current_setting('t.q2')::uuid, 'a0000000-7777-0000-0000-000000000009')$$,
                 'P0001', 'section_not_found', 'B app_ai_writer: begin on A''s question');
select throws_ok($$select public.complete_cover_letter_section(current_setting('t.q2')::uuid, 'a0000000-7777-0000-0000-000000000009', 1,
                     (select v from t_cl))$$, 'P0001', 'section_not_found', 'B app_ai_writer: complete on A''s question');
select throws_ok($$select public.fail_draft_section(current_setting('t.q2')::uuid, 'a0000000-7777-0000-0000-000000000009')$$,
                 'P0001', 'section_not_found', 'B app_ai_writer: fail on A''s question');
set local request.jwt.claims = '{"role":"app_ai_writer"}';
select throws_ok($$select public.begin_cover_letter_section(current_setting('t.q2')::uuid, 'a0000000-7777-0000-0000-000000000009')$$,
                 '42501', 'not_authenticated', 'app_ai_writer without sub');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.drafts), 0, 'B sees no drafts of A');
select is((select count(*)::int from public.draft_sections), 0, 'B sees no sections of A');
select is((select count(*)::int from public.draft_section_sources), 0, 'B sees no sources of A');
update public.drafts set title = 'hijack';
update public.draft_sections set user_note = 'hijack';
delete from public.drafts;
select throws_ok($$select public.set_section_sources(current_setting('t.q1')::uuid, '[]')$$,
                 'P0001', 'section_not_found', 'B: set_section_sources on A''s question');
select throws_ok($$select public.add_cover_letter_question('a0000000-cccc-0000-0000-000000000002', 'q')$$,
                 'P0001', 'draft_not_found', 'B: add question to A''s draft');
select throws_ok($$select public.reorder_cover_letter_questions('a0000000-cccc-0000-0000-000000000002', '{}')$$,
                 'P0001', 'draft_not_found', 'B: reorder A''s draft');
select throws_ok($$select public.delete_cover_letter_question(current_setting('t.q1')::uuid)$$,
                 'P0001', 'section_not_found', 'B: delete A''s question');
select throws_ok($$select public.begin_cover_letter_section(current_setting('t.q1')::uuid, 'a0000000-7777-0000-0000-000000000009')$$,
                 '42501', null, 'authenticated cannot run AI RPCs');
reset role;
select is((select count(*)::int from public.drafts where title = 'hijack'), 0, 'B could not update A''s title');
select is((select count(*)::int from public.draft_sections where user_note = 'hijack'), 0, 'B could not update A''s sections');
select is((select count(*)::int from public.drafts where user_id = 'a0000000-0000-0000-0000-000000000001'), 3,
          'B could not delete A''s drafts');

-- ── CHECK / FK ──
set constraints public.draft_sections_draft_id_sort_order_key immediate;
select throws_ok($$insert into public.draft_sections (user_id, draft_id, sort_order, section_kind, question_text, count_basis)
                   values ('a0000000-0000-0000-0000-000000000001', 'a0000000-cccc-0000-0000-000000000002', 0,
                           'cover_letter_question', 'dup', 'with_spaces')$$, '23505', null, 'sort_order unique per draft');
select throws_ok($$insert into public.draft_sections (user_id, draft_id, sort_order, section_kind, question_text, count_basis)
                   values ('a0000000-0000-0000-0000-000000000001', 'a0000000-cccc-0000-0000-000000000002', 9,
                           'experience', 'q', 'with_spaces')$$, '23514', null, 'career section cannot have question columns');
select throws_ok($$insert into public.draft_sections (user_id, draft_id, sort_order, section_kind)
                   values ('b0000000-0000-0000-0000-000000000002', 'a0000000-cccc-0000-0000-000000000002', 9,
                           'standalone_projects')$$, '23503', null, 'composite FK: section of another user''s draft');
select throws_ok($$insert into public.draft_section_sources (user_id, draft_section_id, application_project_id, role, origin)
                   values ('a0000000-0000-0000-0000-000000000001', current_setting('t.q1')::uuid,
                           'a0000000-aaaa-0000-0000-000000000001', 'primary', 'user')$$, '23514', null,
                 'source needs experience / education / project');
select throws_ok($$insert into public.drafts (user_id, application_project_id, draft_type, title, status)
                   values ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001',
                           'career_description', 't', 'composing')$$, '23514', null,
                 'career description cannot be composing');
select throws_ok($$insert into public.drafts (user_id, application_project_id, draft_type, title, status, options)
                   values ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001',
                           'cover_letter', 't', 'composing', '{"color":"red"}')$$, '23514', null, 'options: unknown key');
select throws_ok($$insert into public.drafts (user_id, application_project_id, draft_type, title, status, options)
                   values ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001',
                           'cover_letter', 't', 'composing', '{"selection_origin":"magic"}')$$, '23514', null,
                 'options: selection_origin list');

-- ── cascades ──
select is((select count(*)::int from public.evidence_links where owner_id = current_setting('t.q1')::uuid), 2,
          'before delete: Q1 has evidence');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$delete from public.drafts where id = 'a0000000-cccc-0000-0000-000000000002'$$, 'user deletes a draft (S7 [가정 3])');
reset role;
select is((select count(*)::int from public.draft_sections where draft_id = 'a0000000-cccc-0000-0000-000000000002'), 0,
          'draft delete: sections cascade');
select is((select count(*)::int from public.draft_section_sources where draft_section_id = current_setting('t.q1')::uuid), 0,
          'draft delete: sources cascade');
select is((select count(*)::int from public.evidence_links where owner_type = 'draft_section'), 0,
          'draft delete: section evidence deleted');
delete from public.application_projects where id = 'a0000000-aaaa-0000-0000-000000000002';
select is((select count(*)::int from public.drafts where id = 'a0000000-cccc-0000-0000-000000000003'), 0,
          'project delete: drafts cascade');
delete from auth.users where id = 'a0000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.drafts), 0, 'account delete: drafts cascade');

-- ── lock order (QA-S5-06 pattern): end trigger skips a locked project; fail RPCs wait ──
select ok(pg_get_functiondef('private.ai_jobs_release_drafts()'::regprocedure)
            ~* 'career_description_mark_failed\(d\.id, new\.id, true\)'
          and pg_get_functiondef('private.ai_jobs_release_drafts()'::regprocedure)
            ~* 'draft_section_mark_failed\(s\.id, new\.id, true\)', 'release trigger uses the skip-locked path');
select ok(pg_get_functiondef('public.fail_draft_section(uuid, uuid)'::regprocedure)
            ~* 'draft_section_mark_failed\(p_section_id, p_ai_job_id, false\)'
          and pg_get_functiondef('public.fail_career_description(uuid, uuid)'::regprocedure)
            ~* 'career_description_mark_failed\(p_draft_id, p_ai_job_id, false\)', 'fail RPCs keep waiting');

select * from finish();
rollback;
