-- S5 privilege regression (see career_first_call_privileges.test.sql for why): every application / JD path is
-- first called by its real role. Nothing touches S5 tables / functions as postgres before that role does.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated');

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok($$select set_config('t.jd', public.create_application_project('aaaaaaaa-aaaa-0000-0000-000000000001', '백엔드 공고',
                   'h', '[{"sid":"S1","text":"백엔드 공고","start":0,"end":6}]') ->> 'job_description_id', true)$$,
                'authenticated: create_application_project');
select lives_ok($$select * from public.application_projects$$, 'authenticated: select application_projects');
select lives_ok($$select * from public.job_descriptions$$, 'authenticated: select job_descriptions');
select lives_ok($$select * from public.jd_requirements$$, 'authenticated: select jd_requirements');
select lives_ok($$select * from public.application_stage_events$$, 'authenticated: select application_stage_events');
select lives_ok($$update public.application_projects set memo = 'm', deadline = '2026-12-01'
                   where id = 'aaaaaaaa-aaaa-0000-0000-000000000001'$$, 'authenticated: update memo / deadline');
select lives_ok($$select public.move_application_stage('aaaaaaaa-aaaa-0000-0000-000000000001', 'closed')$$,
                'authenticated: move_application_stage');
select lives_ok($$select public.set_application_outcome('aaaaaaaa-aaaa-0000-0000-000000000001', 'passed')$$,
                'authenticated: set_application_outcome');

reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';

select lives_ok($$select id, name, stage from public.application_projects$$, 'app_ai_writer: select project header');
select lives_ok($$select * from public.job_descriptions$$, 'app_ai_writer: select job_descriptions');
select lives_ok($$select * from public.jd_requirements$$, 'app_ai_writer: select jd_requirements');
select lives_ok($$insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                    provider, model_tier, connection_tier)
                  values ('aaaaaaaa-7777-0000-0000-000000000001', 'jd_extraction', 'aaaaaaaa-aaaa-0000-0000-000000000001',
                          'job_description', current_setting('t.jd')::uuid, 'running', 1, 'anthropic', 'light', 'paid')$$,
                'app_ai_writer: jd_extraction job');
select lives_ok($$select public.begin_jd_extraction(current_setting('t.jd')::uuid, 'aaaaaaaa-7777-0000-0000-000000000001')$$,
                'app_ai_writer: begin_jd_extraction');
select is(public.apply_jd_extraction(current_setting('t.jd')::uuid, 'aaaaaaaa-7777-0000-0000-000000000001', 1,
            '{"schema_version":1,"detected_language":"ko","is_likely_jd":true,
              "company_name":{"value":"회사","source_sids":["S1"]},"position_title":{"value":"백엔드","source_sids":["S1"]},
              "seniority":null,
              "requirements":[{"category":"responsibility","content":"백엔드 개발","keywords":["백엔드"],"importance":"high","source_sids":["S1"]}],
              "tech_keywords":[],"other_sids":[],"warnings":[],"requirements_hash":"rh","extraction":{"schema_version":1}}',
            'anthropic', 'claude-haiku-5-5') ->> 'name',
          '회사 – 백엔드', 'app_ai_writer: apply_jd_extraction');
select lives_ok($$select public.fail_jd_extraction(current_setting('t.jd')::uuid, 'aaaaaaaa-7777-0000-0000-000000000001')$$,
                'app_ai_writer: fail_jd_extraction (no-op after success)');
select lives_ok($$select public.complete_ai_job('aaaaaaaa-7777-0000-0000-000000000001', 1)$$, 'app_ai_writer: complete job');
select lives_ok($$insert into public.ai_usage_records (feature, job_type, ai_job_id, application_project_id, provider, model,
                    model_tier, connection_tier, usage_source, outcome, price_table_version, estimated_cost_usd)
                  values ('jd_extraction', 'jd_extraction', 'aaaaaaaa-7777-0000-0000-000000000001',
                          'aaaaaaaa-aaaa-0000-0000-000000000001', 'anthropic', 'claude-haiku-5-5', 'light', 'paid',
                          'unavailable', 'succeeded', 'v1', 0)$$,
                'app_ai_writer: usage record with application_project_id');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$update public.application_projects set name = '새 이름' where id = 'aaaaaaaa-aaaa-0000-0000-000000000001'$$,
                'authenticated: rename');
select lives_ok($$delete from public.application_projects where id = 'aaaaaaaa-aaaa-0000-0000-000000000001'$$,
                'authenticated: delete application project (cascade + usage set null)');
select is((select count(*)::int from public.ai_usage_records where application_project_id is null), 1,
          'usage record kept after delete');

select * from finish();
rollback;
