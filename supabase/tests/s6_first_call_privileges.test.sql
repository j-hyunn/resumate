-- S6 privilege regression (see career_first_call_privileges.test.sql for why): every insight path is first called
-- by its real role. Nothing touches S6 tables / functions as postgres before that role does.
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
select lives_ok($$insert into public.skills (id, name) values ('aaaaaaaa-6666-0000-0000-000000000001', 'Postgres')$$,
                'authenticated: skill');
select lives_ok($$select * from public.insights$$, 'authenticated: select insights (empty)');

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
select lives_ok($$select public.complete_ai_job('aaaaaaaa-7777-0000-0000-000000000001', 1)$$, 'app_ai_writer: complete extraction job');

select lives_ok($$select * from public.insights$$, 'app_ai_writer: select insights');
select lives_ok($$insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                    provider, model_tier, connection_tier) values
                   ('aaaaaaaa-7777-0000-0000-000000000002', 'insight', 'aaaaaaaa-aaaa-0000-0000-000000000001',
                    'application_project', 'aaaaaaaa-aaaa-0000-0000-000000000001', 'running', 1, 'anthropic', 'default', 'paid')$$,
                'app_ai_writer: insight job');
select lives_ok($$select set_config('t.i', public.begin_insight('aaaaaaaa-aaaa-0000-0000-000000000001',
                    'aaaaaaaa-7777-0000-0000-000000000002')::text, true)$$, 'app_ai_writer: begin_insight');
select is(public.complete_insight(current_setting('t.i')::uuid, 'aaaaaaaa-7777-0000-0000-000000000002', 1,
            jsonb_build_object(
              'result', '{"schema_version":1}'::jsonb,
              'match_stage_result', '{"matches":[]}'::jsonb,
              'hashes', '{"requirements_hash":"rh","career_snapshot_hash":"ch","input_hash":"ih"}'::jsonb,
              'meta', '{"schema_version":1,"prompt_version":"pv","provider":"anthropic","model":"claude-sonnet-5-5",
                        "model_tier":"default","connection_tier":"paid","validation_report":null,"usage":null}'::jsonb,
              'evidence', jsonb_build_array(
                jsonb_build_object('item_key', 'strengths.0', 'sort_order', 0, 'source_type', 'skill',
                                   'source_id', 'aaaaaaaa-6666-0000-0000-000000000001', 'source_field', 'name'),
                jsonb_build_object('item_key', 'strengths.0', 'sort_order', 1, 'source_type', 'jd_sentence',
                                   'source_id', current_setting('t.jd'), 'source_field', null,
                                   'source_locator', '{"sid":"S1","start":0,"end":9}'::jsonb),
                jsonb_build_object('item_key', 'strengths.0', 'sort_order', 2, 'source_type', 'jd_requirement',
                                   'source_id', (select id from public.jd_requirements limit 1), 'source_field', null))))
            ->> 'evidence_count',
          '3', 'app_ai_writer: complete_insight');
select lives_ok($$select public.complete_ai_job('aaaaaaaa-7777-0000-0000-000000000002', 1)$$, 'app_ai_writer: complete insight job');
select lives_ok($$insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                    provider, model_tier, connection_tier) values
                   ('aaaaaaaa-7777-0000-0000-000000000003', 'insight', 'aaaaaaaa-aaaa-0000-0000-000000000001',
                    'application_project', 'aaaaaaaa-aaaa-0000-0000-000000000001', 'running', 1, 'anthropic', 'default', 'paid')$$,
                'app_ai_writer: second insight job');
select lives_ok($$select set_config('t.i2', public.begin_insight('aaaaaaaa-aaaa-0000-0000-000000000001',
                    'aaaaaaaa-7777-0000-0000-000000000003')::text, true)$$, 'app_ai_writer: begin_insight 2');
select is(public.fail_insight(current_setting('t.i2')::uuid, 'aaaaaaaa-7777-0000-0000-000000000003'), true,
          'app_ai_writer: fail_insight');
select lives_ok($$update public.ai_jobs set status = 'failed', error_code = 'schema_invalid'
                   where id = 'aaaaaaaa-7777-0000-0000-000000000003'$$, 'app_ai_writer: job end fires the release trigger');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.insights where status = 'ready' and is_latest), 1, 'authenticated: reads latest');
select is(public.get_deletion_impact('skill', 'aaaaaaaa-6666-0000-0000-000000000001')
            -> 'affected_results' -> 'by_application_project' -> 0 ->> 'insights', '1',
          'authenticated: get_deletion_impact counts the insight');
select lives_ok($$select public.delete_career_item('skill', 'aaaaaaaa-6666-0000-0000-000000000001', 'keep_projects', 'delete_results')$$,
                'authenticated: delete_career_item(delete_results)');
select is((select count(*)::int from public.insights where status = 'ready'), 0, 'insight removed with its citation');
select lives_ok($$delete from public.application_projects where id = 'aaaaaaaa-aaaa-0000-0000-000000000001'$$,
                'authenticated: delete application project (insight cascade)');
select is((select count(*)::int from public.insights), 0, 'no insights left');

select * from finish();
rollback;
