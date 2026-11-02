-- S7 privilege regression (see career_first_call_privileges.test.sql for why): every draft path is first called by
-- its real role. Nothing touches S7 tables / functions as postgres before that role does.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated');

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select set_config('t.jd', public.create_application_project('aaaaaaaa-aaaa-0000-0000-000000000001', '결제 API 설계',
                   'h', '[{"sid":"S1","text":"결제 API 설계","start":0,"end":9}]') ->> 'job_description_id', true)$$,
                'authenticated: create_application_project');
select lives_ok($$insert into public.experiences (id, company_name, start_month, job_rank)
                   values ('aaaaaaaa-1111-0000-0000-000000000001', 'A사', '2020-01-01', 'S')$$, 'authenticated: experience');
select lives_ok($$insert into public.projects (id, experience_id, name, role)
                   values ('aaaaaaaa-3333-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', '결제', 'Dev')$$,
                'authenticated: project');
select lives_ok($$insert into public.project_details (id, project_id, title, situation, action)
                   values ('aaaaaaaa-4444-0000-0000-000000000001', 'aaaaaaaa-3333-0000-0000-000000000001', 't', 's', 'a')$$,
                'authenticated: detail');
select lives_ok($$select * from public.drafts$$, 'authenticated: select drafts (empty)');

-- cover letter editing (no key)
select is(public.create_cover_letter_draft('aaaaaaaa-aaaa-0000-0000-000000000001', 'aaaaaaaa-cccc-0000-0000-000000000001')
            -> 'sections' -> 0 ->> 'template_key', 'motivation', 'authenticated: create_cover_letter_draft');
select lives_ok($$select public.add_cover_letter_question('aaaaaaaa-cccc-0000-0000-000000000001', '추가 문항', 500, 'with_spaces',
                    'aaaaaaaa-5c00-0000-0000-000000000004')$$, 'authenticated: add_cover_letter_question');
select lives_ok($$select public.reorder_cover_letter_questions('aaaaaaaa-cccc-0000-0000-000000000001',
                    (select array_agg(id order by sort_order desc) from public.draft_sections))$$,
                'authenticated: reorder_cover_letter_questions');
select lives_ok($$select public.delete_cover_letter_question('aaaaaaaa-5c00-0000-0000-000000000004')$$,
                'authenticated: delete_cover_letter_question');
select lives_ok($$update public.draft_sections set user_note = '메모', question_text = question_text || '?'$$,
                'authenticated: update question columns');
select set_config('t.q', (select id::text from public.draft_sections where template_key = 'motivation'), true);
select lives_ok($$select public.set_section_sources(current_setting('t.q')::uuid,
                    '[{"project_id":"aaaaaaaa-3333-0000-0000-000000000001","project_detail_ids":["aaaaaaaa-4444-0000-0000-000000000001"]}]')$$,
                'authenticated: set_section_sources');
select lives_ok($$update public.drafts set title = '제목', first_copied_at = now(), edited_at = now()$$,
                'authenticated: update draft columns');
reset role;

set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select lives_ok($$insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                    provider, model_tier, connection_tier) values
                   ('aaaaaaaa-7777-0000-0000-000000000001', 'jd_extraction', 'aaaaaaaa-aaaa-0000-0000-000000000001',
                    'job_description', current_setting('t.jd')::uuid, 'running', 1, 'anthropic', 'light', 'paid')$$,
                'app_ai_writer: jd_extraction job');
select lives_ok($$select public.begin_jd_extraction(current_setting('t.jd')::uuid, 'aaaaaaaa-7777-0000-0000-000000000001')$$,
                'app_ai_writer: begin_jd_extraction');
select lives_ok($$select public.apply_jd_extraction(current_setting('t.jd')::uuid, 'aaaaaaaa-7777-0000-0000-000000000001', 1,
            '{"detected_language":"ko","company_name":null,"position_title":null,
              "requirements":[{"category":"responsibility","content":"결제 API 설계","keywords":[],"importance":"high","source_sids":["S1"]}],
              "tech_keywords":[],"requirements_hash":"rh","extraction":{"schema_version":1}}',
            'anthropic', 'claude-haiku-5-5')$$, 'app_ai_writer: apply_jd_extraction');
select lives_ok($$select public.complete_ai_job('aaaaaaaa-7777-0000-0000-000000000001', 1)$$, 'app_ai_writer: complete extraction');

select lives_ok($$select * from public.drafts, public.draft_sections, public.draft_section_sources$$,
                'app_ai_writer: select draft tables');
-- AI-11: draft_source_ranking output written directly (column grant).
select lives_ok($$insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                    provider, model_tier, connection_tier, output) values
                   ('aaaaaaaa-7777-0000-0000-000000000002', 'draft_source_ranking', 'aaaaaaaa-aaaa-0000-0000-000000000001',
                    'application_project', 'aaaaaaaa-aaaa-0000-0000-000000000001', 'running', 1, 'anthropic', 'light', 'paid',
                    null)$$, 'app_ai_writer: draft_source_ranking job');
select lives_ok($$update public.ai_jobs set output = '{"rankings":[]}' where id = 'aaaaaaaa-7777-0000-0000-000000000002'$$,
                'app_ai_writer: write draft_source_ranking output');

-- cover letter question generation
select lives_ok($$insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                    provider, model_tier, connection_tier) values
                   ('aaaaaaaa-7777-0000-0000-000000000003', 'cover_letter', 'aaaaaaaa-aaaa-0000-0000-000000000001',
                    'draft_section', current_setting('t.q')::uuid, 'running', 1, 'anthropic', 'default', 'paid')$$,
                'app_ai_writer: cover_letter job');
select lives_ok($$select public.begin_cover_letter_section(current_setting('t.q')::uuid, 'aaaaaaaa-7777-0000-0000-000000000003')$$,
                'app_ai_writer: begin_cover_letter_section');
select is(public.complete_cover_letter_section(current_setting('t.q')::uuid, 'aaaaaaaa-7777-0000-0000-000000000003', 1,
            jsonb_build_object(
              'question_class', 'motivation',
              'blocks', '[{"block_id":"q1-p1","block_kind":"paragraph","text":"본문"}]'::jsonb,
              'ai_char_count', 2, 'correction_applied', false,
              'sources', '[{"project_id":"aaaaaaaa-3333-0000-0000-000000000001","experience_id":"aaaaaaaa-1111-0000-0000-000000000001","role":"primary","rationale":"이유"}]'::jsonb,
              'hashes', '{"input_hash":"ih","career_snapshot_hash":"ch"}'::jsonb,
              'meta', '{"schema_version":2,"prompt_version":"pv","provider":"anthropic","model":"claude-sonnet-5-5",
                        "model_tier":"default","connection_tier":"paid","validation_report":null,"usage":null}'::jsonb,
              'evidence', jsonb_build_array(
                jsonb_build_object('item_key', 'q1-p1', 'sort_order', 0, 'source_type', 'user_note',
                                   'source_id', current_setting('t.q'), 'source_field', null, 'quote', '메모'),
                jsonb_build_object('item_key', 'q1-p1', 'sort_order', 1, 'source_type', 'jd_sentence',
                                   'source_id', current_setting('t.jd'), 'source_field', null,
                                   'source_locator', '{"sid":"S1","start":0,"end":9}'::jsonb),
                jsonb_build_object('item_key', 'sources.0', 'sort_order', 0, 'source_type', 'project_detail',
                                   'source_id', 'aaaaaaaa-4444-0000-0000-000000000001', 'source_field', 'action'))))
            ->> 'evidence_count', '3', 'app_ai_writer: complete_cover_letter_section (user mode)');
select lives_ok($$select public.complete_ai_job('aaaaaaaa-7777-0000-0000-000000000003', 1)$$, 'app_ai_writer: complete job');
select lives_ok($$insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                    provider, model_tier, connection_tier)
                   select 'aaaaaaaa-7777-0000-0000-000000000004', 'cover_letter', 'aaaaaaaa-aaaa-0000-0000-000000000001',
                          'draft_section', id, 'running', 1, 'anthropic', 'default', 'paid'
                     from public.draft_sections where template_key = 'job_competency'$$, 'app_ai_writer: second cover_letter job');
select lives_ok($$select public.begin_cover_letter_section((select id from public.draft_sections where template_key = 'job_competency'),
                    'aaaaaaaa-7777-0000-0000-000000000004')$$, 'app_ai_writer: begin 2');
select is(public.fail_draft_section((select id from public.draft_sections where template_key = 'job_competency'),
            'aaaaaaaa-7777-0000-0000-000000000004'), true, 'app_ai_writer: fail_draft_section');
select lives_ok($$update public.ai_jobs set status = 'failed', error_code = 'schema_invalid'
                   where id = 'aaaaaaaa-7777-0000-0000-000000000004'$$, 'app_ai_writer: job end fires the release trigger');

-- career description
select lives_ok($$insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                    provider, model_tier, connection_tier) values
                   ('aaaaaaaa-7777-0000-0000-000000000005', 'career_description', 'aaaaaaaa-aaaa-0000-0000-000000000001',
                    'draft', 'aaaaaaaa-eeee-0000-0000-000000000001', 'running', 1, 'anthropic', 'default', 'paid')$$,
                'app_ai_writer: career_description job');
select set_config('t.s', public.begin_career_description('aaaaaaaa-aaaa-0000-0000-000000000001', 'aaaaaaaa-7777-0000-0000-000000000005',
         '{"included_project_ids":["aaaaaaaa-3333-0000-0000-000000000001"],"selection_origin":"user"}',
         '[{"section_kind":"experience","experience_id":"aaaaaaaa-1111-0000-0000-000000000001"}]') -> 'sections' -> 0 ->> 'section_id', true);
select isnt(current_setting('t.s'), '', 'app_ai_writer: begin_career_description');
select is(public.complete_career_description('aaaaaaaa-eeee-0000-0000-000000000001', 'aaaaaaaa-7777-0000-0000-000000000005', 1,
            jsonb_build_object(
              'sections', jsonb_build_array(jsonb_build_object('section_id', current_setting('t.s'),
                'blocks', '[{"block_id":"p1-b1","block_kind":"bullet","text":"설계"}]'::jsonb)),
              'hashes', '{"input_hash":"ih","career_snapshot_hash":"ch"}'::jsonb,
              'meta', '{"schema_version":1,"prompt_version":"pv","provider":"anthropic","model":"claude-sonnet-5-5",
                        "model_tier":"default","connection_tier":"paid"}'::jsonb,
              'evidence', jsonb_build_array(jsonb_build_object('section_id', current_setting('t.s'), 'item_key', 'p1-b1',
                'sort_order', 0, 'source_type', 'project_detail', 'source_id', 'aaaaaaaa-4444-0000-0000-000000000001',
                'source_field', 'action'))))
            ->> 'evidence_count', '1', 'app_ai_writer: complete_career_description');
select lives_ok($$select public.complete_ai_job('aaaaaaaa-7777-0000-0000-000000000005', 1)$$, 'app_ai_writer: complete job');
select lives_ok($$insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                    provider, model_tier, connection_tier) values
                   ('aaaaaaaa-7777-0000-0000-000000000006', 'career_description', 'aaaaaaaa-aaaa-0000-0000-000000000001',
                    'draft', 'aaaaaaaa-eeee-0000-0000-000000000002', 'running', 1, 'anthropic', 'default', 'paid')$$,
                'app_ai_writer: second career_description job');
select lives_ok($$select public.begin_career_description('aaaaaaaa-aaaa-0000-0000-000000000001', 'aaaaaaaa-7777-0000-0000-000000000006',
         '{"included_project_ids":[],"selection_origin":"user"}', '[{"section_kind":"standalone_projects"}]',
         null, 'aaaaaaaa-eeee-0000-0000-000000000001')$$, 'app_ai_writer: begin (regenerate)');
select is(public.fail_career_description('aaaaaaaa-eeee-0000-0000-000000000002', 'aaaaaaaa-7777-0000-0000-000000000006'), true,
          'app_ai_writer: fail_career_description');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select results_eq($$select draft_type, status from public.drafts order by draft_type, status$$,
                  $$values ('career_description'::text, 'failed'::text), ('career_description', 'ready'),
                           ('cover_letter', 'partially_failed')$$, 'authenticated: reads draft states');
select is((public.get_deletion_impact('project', 'aaaaaaaa-3333-0000-0000-000000000001')
            -> 'affected_results' -> 'by_application_project' -> 0) - 'name',
          '{"drafts": 1, "insights": 0, "draft_sections": 1, "interview_sessions": 0,
            "application_project_id": "aaaaaaaa-aaaa-0000-0000-000000000001"}'::jsonb,
          'authenticated: get_deletion_impact counts drafts / questions');
select lives_ok($$select public.delete_career_item('project', 'aaaaaaaa-3333-0000-0000-000000000001', 'keep_projects', 'delete_results')$$,
                'authenticated: delete_career_item(delete_results)');
select is((select count(*)::int from public.drafts where draft_type = 'career_description' and status = 'ready'), 0,
          'career description removed with its citation');
select is((select status from public.draft_sections where id = current_setting('t.q')::uuid), 'pending',
          'cover letter question reset');
select lives_ok($$delete from public.drafts where draft_type = 'career_description'$$, 'authenticated: delete a draft');
select lives_ok($$delete from public.application_projects where id = 'aaaaaaaa-aaaa-0000-0000-000000000001'$$,
                'authenticated: delete application project (drafts cascade)');
select is((select count(*)::int from public.drafts), 0, 'no drafts left');

select * from finish();
rollback;
