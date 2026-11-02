-- S5 begin / apply / fail_jd_extraction (AI-01, D-19, D-30): job matching, run-generation guard, stalled
-- recovery, result shape (unknown keys ignored), name / company / position fill rules, user-edited requirement
-- refusal, and the project deletion cascade (DM §4.1, F-AP-05).
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

-- A has a usable gemini key -> created names wait for extraction (null).
insert into public.ai_provider_keys (id, user_id, provider, connection_tier, key_ciphertext, key_nonce, wrapped_dek, kek_id, key_last4, status)
values ('a0000000-9999-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'gemini', 'free',
        '\x01', '\x02', '\x03', 'env-v1', 'ag01', 'valid');
insert into public.ai_data_use_consents (user_id, provider, connection_tier, disclosure_version, free_tier_acknowledged)
values ('a0000000-0000-0000-0000-000000000001', 'gemini', 'free', 'v2026-10-29', true);
update public.profiles set active_ai_provider = 'gemini' where id = 'a0000000-0000-0000-0000-000000000001';

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
-- P1: no company / position. P2: user company only. P3: user name. P4: deletion cascade target.
select lives_ok($$select set_config('t.jd1', public.create_application_project('a0000000-aaaa-0000-0000-000000000001', '원문', 'h',
                   '[{"sid":"S1","text":"a","start":0,"end":1},{"sid":"S2","text":"b","start":2,"end":3},{"sid":"S3","text":"c","start":4,"end":5}]')
                   ->> 'job_description_id', true)$$, 'P1');
select lives_ok($$select set_config('t.jd2', public.create_application_project('a0000000-aaaa-0000-0000-000000000002', '원문', 'h',
                   '[{"sid":"S1","text":"a","start":0,"end":1}]', '내가 쓴 회사')
                   ->> 'job_description_id', true)$$, 'P2');
select lives_ok($$select set_config('t.jd3', public.create_application_project('a0000000-aaaa-0000-0000-000000000003', '원문', 'h',
                   '[{"sid":"S1","text":"a","start":0,"end":1}]', null, null, '내 이름')
                   ->> 'job_description_id', true)$$, 'P3');
select lives_ok($$select set_config('t.jd4', public.create_application_project('a0000000-aaaa-0000-0000-000000000004', '원문', 'h',
                   '[{"sid":"S1","text":"a","start":0,"end":1}]')
                   ->> 'job_description_id', true)$$, 'P4');
select lives_ok($$select set_config('t.jd6', public.create_application_project('a0000000-aaaa-0000-0000-000000000006', '원문', 'h',
                   '[{"sid":"S1","text":"a","start":0,"end":1},{"sid":"S2","text":"b","start":2,"end":3}]')
                   ->> 'job_description_id', true)$$, 'P6');
reset role;

create temp table t_result (v jsonb);
-- Extra keys at every level (schema_version, prompt_version, validation, note) must be ignored.
insert into t_result values ('{
  "schema_version": 1, "prompt_version": "AI-01@1", "validation": {"dropped_requirements": 1},
  "detected_language": "ko", "is_likely_jd": true,
  "company_name": {"value": " 에이비씨페이 ", "source_sids": ["S1"], "note": "x"},
  "position_title": {"value": "백엔드 엔지니어", "source_sids": ["S1"]},
  "seniority": {"min_years": 5, "max_years": null, "label": "5년 이상", "source_sids": ["S3"]},
  "requirements": [
    {"category": "responsibility", "content": "결제 API 설계", "keywords": ["결제", " API "], "importance": "high",
     "source_sids": ["S1"], "alias": "REQ-1"},
    {"category": "required", "content": "Java 경험", "keywords": [], "importance": "normal", "source_sids": ["S2", "S3"]}
  ],
  "tech_keywords": [{"keyword": "Kafka", "source_sids": ["S3"], "extra": true}],
  "other_sids": ["S3"], "warnings": [],
  "requirements_hash": "rh1",
  "extraction": {"schema_version": 1, "requirements": []}
}');
grant select on t_result to app_ai_writer;

set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';

select lives_ok($$insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                    provider, model_tier, connection_tier) values
                   ('a0000000-7777-0000-0000-000000000001', 'jd_extraction', 'a0000000-aaaa-0000-0000-000000000001',
                    'job_description', current_setting('t.jd1')::uuid, 'running', 1, 'gemini', 'light', 'free'),
                   ('a0000000-7777-0000-0000-000000000002', 'jd_extraction', 'a0000000-aaaa-0000-0000-000000000002',
                    'job_description', current_setting('t.jd2')::uuid, 'running', 1, 'gemini', 'light', 'free'),
                   ('a0000000-7777-0000-0000-000000000003', 'jd_extraction', 'a0000000-aaaa-0000-0000-000000000003',
                    'job_description', current_setting('t.jd3')::uuid, 'running', 1, 'gemini', 'light', 'free'),
                   ('a0000000-7777-0000-0000-000000000007', 'jd_extraction', 'a0000000-aaaa-0000-0000-000000000006',
                    'job_description', current_setting('t.jd6')::uuid, 'running', 1, 'gemini', 'light', 'free'),
                   ('a0000000-7777-0000-0000-000000000009', 'insight', 'a0000000-aaaa-0000-0000-000000000001',
                    'application_project', 'a0000000-aaaa-0000-0000-000000000001', 'running', 1, 'gemini', 'default', 'free')$$,
                'app_ai_writer creates jd_extraction jobs');
select throws_ok($$insert into public.ai_jobs (job_type, application_project_id, target_type, target_id, provider, model_tier, connection_tier)
                   values ('jd_extraction', 'a0000000-aaaa-0000-0000-000000000001', 'application_project',
                           current_setting('t.jd1')::uuid, 'gemini', 'light', 'free')$$,
                 '23514', null, 'jd_extraction job must target job_description');
select throws_ok($$insert into public.ai_jobs (job_type, application_project_id, target_type, target_id, provider, model_tier, connection_tier)
                   values ('insight', gen_random_uuid(), 'application_project', gen_random_uuid(), 'gemini', 'light', 'free')$$,
                 '23503', null, 'ai_jobs.application_project_id must exist (composite FK)');

-- ── begin ────────────────────────────────────────────────────────────────
select throws_ok($$select public.begin_jd_extraction(gen_random_uuid(), 'a0000000-7777-0000-0000-000000000001')$$,
                 'P0001', 'job_description_not_found', 'unknown JD');
select throws_ok($$select public.begin_jd_extraction(current_setting('t.jd1')::uuid, 'a0000000-7777-0000-0000-000000000002')$$,
                 'P0001', 'invalid_ai_job', 'job of another JD');
select throws_ok($$select public.begin_jd_extraction(current_setting('t.jd1')::uuid, 'a0000000-7777-0000-0000-000000000009')$$,
                 'P0001', 'invalid_ai_job', 'non-extraction job');
select throws_ok($$select public.begin_jd_extraction(current_setting('t.jd1')::uuid, gen_random_uuid())$$,
                 'P0001', 'invalid_ai_job', 'unknown job');
select lives_ok($$select public.begin_jd_extraction(current_setting('t.jd1')::uuid, 'a0000000-7777-0000-0000-000000000001')$$,
                'begin P1');
select is((select array[extraction_status, extraction_job_id::text] from public.job_descriptions where id = current_setting('t.jd1')::uuid),
          array['running', 'a0000000-7777-0000-0000-000000000001'], 'P1 running with its job');
select lives_ok($$select public.begin_jd_extraction(current_setting('t.jd1')::uuid, 'a0000000-7777-0000-0000-000000000001')$$,
                'begin again with the same job is a no-op');

-- ── apply: refusals and stale runs ──────────────────────────────────────
select is(public.apply_jd_extraction(current_setting('t.jd1')::uuid, 'a0000000-7777-0000-0000-000000000001', 2,
            (select v from t_result), 'gemini', 'gemini-3.8-flash-lite'),
          '{"applied":false,"reason":"stale_run"}'::jsonb, 'wrong run generation -> stale_run');
select is(public.apply_jd_extraction(current_setting('t.jd2')::uuid, 'a0000000-7777-0000-0000-000000000002', 1,
            (select v from t_result), 'gemini', 'm'),
          '{"applied":false,"reason":"stale_run"}'::jsonb, 'JD not begun -> stale_run');
select throws_ok($$select public.apply_jd_extraction(current_setting('t.jd1')::uuid, 'a0000000-7777-0000-0000-000000000001', 1,
                   (select v from t_result), 'openai', 'm')$$, 'P0001', 'invalid_ai_metadata', 'provider must match the job');
select throws_ok($$select public.apply_jd_extraction(current_setting('t.jd1')::uuid, 'a0000000-7777-0000-0000-000000000001', 1,
                   (select v from t_result), 'gemini', ' ')$$, 'P0001', 'invalid_ai_metadata', 'model required');
select throws_ok($$select public.apply_jd_extraction(current_setting('t.jd1')::uuid, 'a0000000-7777-0000-0000-000000000002', 1,
                   (select v from t_result), 'gemini', 'm')$$, 'P0001', 'invalid_ai_job', 'job of another JD');

-- Shape refusals.
create temp table t_bad (label text, v jsonb);
insert into t_bad
select 'no requirements', (select v from t_result) || '{"requirements": []}' union all
select 'unknown sid', jsonb_set((select v from t_result), '{requirements,0,source_sids}', '["S4"]') union all
select 'empty sids', jsonb_set((select v from t_result), '{requirements,0,source_sids}', '[]') union all
select 'non-canonical sid', jsonb_set((select v from t_result), '{requirements,0,source_sids}', '["s1"]') union all
select 'bad category', jsonb_set((select v from t_result), '{requirements,0,category}', '"bonus"') union all
select 'bad importance', jsonb_set((select v from t_result), '{requirements,0,importance}', '"low"') union all
select 'blank content', jsonb_set((select v from t_result), '{requirements,0,content}', '"  "') union all
select 'long content', jsonb_set((select v from t_result), '{requirements,0,content}', to_jsonb(repeat('a', 501))) union all
select 'keywords not array', jsonb_set((select v from t_result), '{requirements,0,keywords}', '"x"') union all
select 'keyword not string', jsonb_set((select v from t_result), '{requirements,0,keywords}', '[1]') union all
select 'tech keyword unknown sid', jsonb_set((select v from t_result), '{tech_keywords,0,source_sids}', '["S9"]') union all
select 'tech_keywords missing', (select v from t_result) - 'tech_keywords' union all
select 'extraction missing', (select v from t_result) - 'extraction' union all
select 'hash missing', (select v from t_result) - 'requirements_hash' union all
select 'company not object', jsonb_set((select v from t_result), '{company_name}', '"x"') union all
select 'language too long', jsonb_set((select v from t_result), '{detected_language}', to_jsonb(repeat('a', 17))) union all
select 'not an object', '[]'::jsonb;
grant select on t_bad to app_ai_writer;
reset role;
select is((select array_agg(label order by label) from t_bad b where private.jd_extraction_result_valid(b.v, 3)), null,
          'every malformed result is rejected by the shape check');
select ok(private.jd_extraction_result_valid((select v from t_result), 3), 'result with unknown extra keys is accepted');
select ok(private.jd_extraction_result_valid((select v from t_result) || '{"company_name": null, "position_title": null, "detected_language": null}', 3),
          'null company / position / language accepted');
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select throws_ok($$select public.apply_jd_extraction(current_setting('t.jd1')::uuid, 'a0000000-7777-0000-0000-000000000001', 1,
                   (select v from t_bad where label = 'unknown sid'), 'gemini', 'm')$$,
                 'P0001', 'invalid_extraction_result', 'RPC rejects a sid outside the JD');

-- ── apply: happy path (P1: empty name, no company / position) ──────────
select is(public.apply_jd_extraction(current_setting('t.jd1')::uuid, 'a0000000-7777-0000-0000-000000000001', 1,
            (select v from t_result), 'gemini', 'gemini-3.8-flash-lite') - 'job_description_id',
          '{"applied":true,"application_project_id":"a0000000-aaaa-0000-0000-000000000001","extraction_status":"succeeded",
            "name":"에이비씨페이 – 백엔드 엔지니어","name_source":"ai",
            "company_name":"에이비씨페이","company_name_source":"ai","position_title":"백엔드 엔지니어","position_title_source":"ai",
            "requirement_count":2}'::jsonb,
          'apply fills company / position / name from AI (extra keys ignored)');
select results_eq($$select category, content, keywords, importance, source_sids, sort_order, origin, is_user_edited
                      from public.jd_requirements where job_description_id = current_setting('t.jd1')::uuid order by sort_order$$,
                  $$values ('responsibility'::text, '결제 API 설계'::text, '{결제,API}'::text[], 'high'::text, '{S1}'::text[], 0, 'ai'::text, false),
                           ('required', 'Java 경험', '{}'::text[], 'normal', '{S2,S3}'::text[], 1, 'ai', false)$$,
                  'requirements stored in output order');
select is((select array[extraction_status, detected_language, extraction_provider, extraction_model, requirements_hash,
                        tech_keywords::text, extraction::text]
             from public.job_descriptions where id = current_setting('t.jd1')::uuid),
          array['succeeded', 'ko', 'gemini', 'gemini-3.8-flash-lite', 'rh1',
                '[{"extra": true, "keyword": "Kafka", "source_sids": ["S3"]}]', '{"requirements": [], "schema_version": 1}'],
          'JD extraction columns written');
select is(public.apply_jd_extraction(current_setting('t.jd1')::uuid, 'a0000000-7777-0000-0000-000000000001', 1,
            (select v from t_result), 'gemini', 'm'),
          '{"applied":false,"reason":"stale_run"}'::jsonb, 'second apply of the same run -> stale_run (no duplicate rows)');
select is((select count(*)::int from public.jd_requirements where job_description_id = current_setting('t.jd1')::uuid), 2,
          'still 2 requirements');
select throws_ok($$select public.begin_jd_extraction(current_setting('t.jd1')::uuid, 'a0000000-7777-0000-0000-000000000001')$$,
                 'P0001', 'already_extracted', 'succeeded JD cannot be begun again (D-19)');

-- QA-S5-03: with A's rows present, B (user session and app_ai_writer) reads none of them.
reset role;
select ok((select count(*) from public.jd_requirements where user_id = 'a0000000-0000-0000-0000-000000000001') > 0
          and (select count(*) from public.application_stage_events where user_id = 'a0000000-0000-0000-0000-000000000001') > 0,
          'A has requirements and stage events');
set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.jd_requirements), 0, 'B user: no A requirements');
select is((select count(*)::int from public.job_descriptions), 0, 'B user: no A JDs');
select is((select count(*)::int from public.application_stage_events), 0, 'B user: no A stage events');
select is((select count(*)::int from public.application_projects), 0, 'B user: no A projects');
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"app_ai_writer"}';
select is((select count(*)::int from public.jd_requirements), 0, 'B app_ai_writer: no A requirements');
select is((select count(*)::int from public.job_descriptions), 0, 'B app_ai_writer: no A JDs');
select is((select count(*)::int from public.application_projects), 0, 'B app_ai_writer: no A projects');
select throws_ok($$select count(*) from public.application_stage_events$$, '42501', null,
                 'app_ai_writer has no access to stage events at all');
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select ok((select count(*) from public.jd_requirements) > 0, 'A app_ai_writer reads own requirements');

-- P2: user company kept, AI position fills, name composed from user company + AI position.
select lives_ok($$select public.begin_jd_extraction(current_setting('t.jd2')::uuid, 'a0000000-7777-0000-0000-000000000002')$$, 'begin P2');
select is(public.apply_jd_extraction(current_setting('t.jd2')::uuid, 'a0000000-7777-0000-0000-000000000002', 1,
            jsonb_set((select v from t_result), '{requirements}', '[{"category":"required","content":"x","keywords":[],"importance":"high","source_sids":["S1"]}]')
              || '{"tech_keywords":[]}', 'gemini', 'm')
            - 'job_description_id' - 'application_project_id' - 'applied' - 'extraction_status' - 'requirement_count',
          '{"name":"내가 쓴 회사 – 백엔드 엔지니어","name_source":"ai","company_name":"내가 쓴 회사","company_name_source":"user",
            "position_title":"백엔드 엔지니어","position_title_source":"ai"}'::jsonb,
          'user company not overwritten');

-- P3: user name kept; AI company / position with no position -> name untouched.
select lives_ok($$select public.begin_jd_extraction(current_setting('t.jd3')::uuid, 'a0000000-7777-0000-0000-000000000003')$$, 'begin P3');
reset role;
-- User-edited requirement blocks re-extraction (AI-01; can't happen in MVP, rule kept).
insert into public.jd_requirements (user_id, job_description_id, category, content, source_sids, origin)
values ('a0000000-0000-0000-0000-000000000001', current_setting('t.jd3')::uuid, 'required', '사용자 요건', '{S1}', 'user');
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select throws_ok($$select public.apply_jd_extraction(current_setting('t.jd3')::uuid, 'a0000000-7777-0000-0000-000000000003', 1,
                   jsonb_set((select v from t_result), '{requirements}', '[{"category":"required","content":"x","keywords":[],"importance":"high","source_sids":["S1"]}]')
                     || '{"tech_keywords":[]}', 'gemini', 'm')$$,
                 'P0001', 'user_edited_requirements_exist', 'user requirement blocks apply');
reset role;
delete from public.jd_requirements where job_description_id = current_setting('t.jd3')::uuid;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.apply_jd_extraction(current_setting('t.jd3')::uuid, 'a0000000-7777-0000-0000-000000000003', 1,
            jsonb_set((select v from t_result), '{requirements}', '[{"category":"required","content":"x","keywords":[],"importance":"high","source_sids":["S1"]}]')
              || '{"tech_keywords":[]}', 'gemini', 'm') ->> 'name',
          '내 이름', 'user name never overwritten');

-- QA-S5-05: AI company / position whose sids are not in the JD are dropped (result still applied).
select lives_ok($$select public.begin_jd_extraction(current_setting('t.jd6')::uuid, 'a0000000-7777-0000-0000-000000000007')$$, 'begin P6');
select is(public.apply_jd_extraction(current_setting('t.jd6')::uuid, 'a0000000-7777-0000-0000-000000000007', 1,
            (select v from t_result)
              || '{"company_name": {"value": "가짜회사", "source_sids": ["S9"]}, "position_title": {"value": "가짜 포지션"}}'
              || '{"requirements": [{"category":"required","content":"x","keywords":[],"importance":"high","source_sids":["S2"]}], "tech_keywords": []}',
            'gemini', 'm')
            - 'job_description_id' - 'application_project_id' - 'extraction_status',
          jsonb_build_object('applied', true, 'requirement_count', 1,
            'name', '새 기업 JD (' || to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD') || ')', 'name_source', 'default',
            'company_name', null, 'company_name_source', null, 'position_title', null, 'position_title_source', null),
          'unknown / missing sids drop company and position; name falls back to default');

-- ── fail + stalled recovery (P4) ────────────────────────────────────────
select lives_ok($$insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                    provider, model_tier, connection_tier) values
                   ('a0000000-7777-0000-0000-000000000004', 'jd_extraction', 'a0000000-aaaa-0000-0000-000000000004',
                    'job_description', current_setting('t.jd4')::uuid, 'running', 1, 'gemini', 'light', 'free')$$, 'P4 job');
select lives_ok($$select public.begin_jd_extraction(current_setting('t.jd4')::uuid, 'a0000000-7777-0000-0000-000000000004')$$, 'begin P4');
select is(public.fail_jd_extraction(current_setting('t.jd4')::uuid, gen_random_uuid()), false, 'fail with another job id ignored');
select is(public.fail_jd_extraction(current_setting('t.jd4')::uuid, 'a0000000-7777-0000-0000-000000000004'), true, 'fail recorded');
select is((select extraction_status from public.job_descriptions where id = current_setting('t.jd4')::uuid), 'failed', 'P4 failed');
select is((select array[name, name_source] from public.application_projects where id = 'a0000000-aaaa-0000-0000-000000000004'),
          array['새 기업 JD (' || to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD') || ')', 'default'],
          'failed extraction gives the null name the default name [가정 1]');
select is(public.fail_jd_extraction(current_setting('t.jd4')::uuid, 'a0000000-7777-0000-0000-000000000004'), false,
          'second fail is a no-op');

-- Retry after failure: new job, failed -> running.
select lives_ok($$update public.ai_jobs set status = 'failed', error_code = 'timeout' where id = 'a0000000-7777-0000-0000-000000000004'$$,
                'old job failed');
select lives_ok($$insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                    provider, model_tier, connection_tier) values
                   ('a0000000-7777-0000-0000-000000000005', 'jd_extraction', 'a0000000-aaaa-0000-0000-000000000004',
                    'job_description', current_setting('t.jd4')::uuid, 'running', 1, 'gemini', 'light', 'free')$$, 'retry job');
select lives_ok($$select public.begin_jd_extraction(current_setting('t.jd4')::uuid, 'a0000000-7777-0000-0000-000000000005')$$,
                'failed JD can be begun again');

-- QA-S5-02: the job ends without fail_jd_extraction (runner crash) -> the ai_jobs trigger fails the JD.
select lives_ok($$update public.ai_jobs set status = 'failed', error_code = 'stalled' where id = 'a0000000-7777-0000-0000-000000000005'$$,
                'P4 retry job fails without fail_jd_extraction');
select is((select extraction_status from public.job_descriptions where id = current_setting('t.jd4')::uuid), 'failed',
          'job end trigger: JD running that job -> failed');
select lives_ok($$update public.ai_jobs set status = 'queued' where id = 'a0000000-7777-0000-0000-000000000004'$$,
                'old job queued again (manual retry)');
select lives_ok($$select public.begin_jd_extraction(current_setting('t.jd4')::uuid, 'a0000000-7777-0000-0000-000000000004')$$,
                'failed JD begun again');
reset role;
-- ai_jobs_in_flight_target_key already prevents a second live job for the same JD; drop it (rolled back)
-- to exercise the defense-in-depth branch.
drop index public.ai_jobs_in_flight_target_key;
insert into public.ai_jobs (id, user_id, job_type, application_project_id, target_type, target_id, status, provider, model_tier, connection_tier)
values ('a0000000-7777-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'jd_extraction',
        'a0000000-aaaa-0000-0000-000000000004', 'job_description', current_setting('t.jd4')::uuid, 'failed', 'gemini', 'light', 'free');
update public.ai_jobs set status = 'queued' where id = 'a0000000-7777-0000-0000-000000000006';
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select throws_ok($$select public.begin_jd_extraction(current_setting('t.jd4')::uuid, 'a0000000-7777-0000-0000-000000000006')$$,
                 'P0001', 'extraction_in_progress', 'running JD with a live job refuses another job');
-- Takeover: the JD still runs job 4, which ended without apply (succeeded is not released by the trigger).
reset role;
update public.ai_jobs set status = 'succeeded' where id = 'a0000000-7777-0000-0000-000000000004';
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is((select extraction_status from public.job_descriptions where id = current_setting('t.jd4')::uuid), 'running',
          'succeeded job does not release the JD');
select lives_ok($$select public.begin_jd_extraction(current_setting('t.jd4')::uuid, 'a0000000-7777-0000-0000-000000000006')$$,
                'running JD whose job already ended is taken over');
select is((select extraction_job_id::text from public.job_descriptions where id = current_setting('t.jd4')::uuid),
          'a0000000-7777-0000-0000-000000000006', 'takeover recorded the new job');

-- ── cross-user / role limits ────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"app_ai_writer"}';
select throws_ok($$select public.begin_jd_extraction(current_setting('t.jd4')::uuid, 'a0000000-7777-0000-0000-000000000006')$$,
                 'P0001', 'job_description_not_found', 'B cannot begin A extraction');
select throws_ok($$select public.apply_jd_extraction(current_setting('t.jd4')::uuid, 'a0000000-7777-0000-0000-000000000004', 1,
                   (select v from t_result), 'gemini', 'm')$$, 'P0001', 'job_description_not_found', 'B cannot apply to A');
select throws_ok($$select public.fail_jd_extraction(current_setting('t.jd4')::uuid, 'a0000000-7777-0000-0000-000000000004')$$,
                 'P0001', 'job_description_not_found', 'B cannot fail A extraction');
select is((select count(*)::int from public.job_descriptions), 0, 'B app_ai_writer sees no A JDs');
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select throws_ok($$update public.job_descriptions set extraction_status = 'failed'$$, '42501', null, 'app_ai_writer: no direct JD update');
select throws_ok($$insert into public.jd_requirements (job_description_id, category, content, source_sids)
                   values (current_setting('t.jd1')::uuid, 'required', 'x', '{S1}')$$, '42501', null,
                 'app_ai_writer: no direct requirement insert');
select throws_ok($$update public.application_projects set name = 'x'$$, '42501', null, 'app_ai_writer: no direct project update');
select throws_ok($$select memo from public.application_projects$$, '42501', null, 'app_ai_writer: memo not readable');
select throws_ok($$select public.move_application_stage('a0000000-aaaa-0000-0000-000000000001', 'document')$$,
                 '42501', null, 'app_ai_writer cannot move stages');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.begin_jd_extraction(current_setting('t.jd1')::uuid, 'a0000000-7777-0000-0000-000000000001')$$,
                 '42501', null, 'user session cannot call begin_jd_extraction');
select throws_ok($$select public.apply_jd_extraction(current_setting('t.jd1')::uuid, 'a0000000-7777-0000-0000-000000000001', 1, '{}', 'gemini', 'm')$$,
                 '42501', null, 'user session cannot call apply_jd_extraction');
select results_eq($$select count(*)::int from public.jd_requirements where job_description_id = current_setting('t.jd1')::uuid$$,
                  $$values (2)$$, 'user reads own requirements');
reset role;

-- ── QA-S5-02: sweep and cancel release the JD ───────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select set_config('t.jd5', public.create_application_project('a0000000-aaaa-0000-0000-000000000005', '원문', 'h',
                   '[{"sid":"S1","text":"a","start":0,"end":1}]', '회사', '포지션') ->> 'job_description_id', true)$$, 'P5');
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select lives_ok($$insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                    heartbeat_at, provider, model_tier, connection_tier) values
                   ('a0000000-7777-0000-0000-000000000010', 'jd_extraction', 'a0000000-aaaa-0000-0000-000000000005',
                    'job_description', current_setting('t.jd5')::uuid, 'running', 1, now() - interval '10 minutes', 'gemini', 'light', 'free')$$,
                'P5 job with an old heartbeat');
select lives_ok($$select public.begin_jd_extraction(current_setting('t.jd5')::uuid, 'a0000000-7777-0000-0000-000000000010')$$, 'begin P5');
reset role;
grant usage on schema extensions to service_role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.sweep_stalled_ai_jobs(now() - interval '1 minute'), 1, 'sweep closes the stalled extraction job');
reset role;
select is((select array[jd.extraction_status, ap.name, ap.name_source] from public.job_descriptions jd
             join public.application_projects ap on ap.id = jd.application_project_id
            where jd.id = current_setting('t.jd5')::uuid),
          array['failed', '회사 – 포지션', 'user'], 'swept job -> JD failed with the fallback name');
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select lives_ok($$insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                    provider, model_tier, connection_tier) values
                   ('a0000000-7777-0000-0000-000000000011', 'jd_extraction', 'a0000000-aaaa-0000-0000-000000000005',
                    'job_description', current_setting('t.jd5')::uuid, 'running', 1, 'gemini', 'light', 'free')$$, 'P5 retry job');
select lives_ok($$select public.begin_jd_extraction(current_setting('t.jd5')::uuid, 'a0000000-7777-0000-0000-000000000011')$$, 'begin P5 retry');
select lives_ok($$update public.ai_jobs set status = 'canceled', error_code = 'canceled' where id = 'a0000000-7777-0000-0000-000000000011'$$,
                'P5 retry canceled');
select is((select extraction_status from public.job_descriptions where id = current_setting('t.jd5')::uuid), 'failed',
          'canceled job -> JD failed');
reset role;

-- ── deletion cascade (DM §4.1, F-AP-05) ─────────────────────────────────
insert into public.evidence_links (user_id, application_project_id, owner_type, owner_id, item_key, source_type, source_id, quote)
values ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001', 'insight', gen_random_uuid(), 'k',
        'jd_sentence', gen_random_uuid(), 'q');
insert into public.ai_usage_records (user_id, feature, job_type, ai_job_id, application_project_id, provider, model, model_tier,
                                     connection_tier, usage_source, outcome, price_table_version, estimated_cost_usd)
values ('a0000000-0000-0000-0000-000000000001', 'jd_extraction', 'jd_extraction', 'a0000000-7777-0000-0000-000000000001',
        'a0000000-aaaa-0000-0000-000000000001', 'gemini', 'm', 'light', 'free', 'unavailable', 'succeeded', 'v1', 0);

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$delete from public.application_projects where id = 'a0000000-aaaa-0000-0000-000000000001'$$,
                'user deletes the application project');
reset role;
select is((select count(*)::int from public.job_descriptions where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'), 0, 'JD deleted');
select is((select count(*)::int from public.jd_requirements where job_description_id = current_setting('t.jd1')::uuid), 0, 'requirements deleted');
select is((select count(*)::int from public.application_stage_events where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'), 0, 'events deleted');
select is((select count(*)::int from public.ai_jobs where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'), 0, 'ai_jobs deleted');
select is((select count(*)::int from public.evidence_links where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'), 0, 'evidence_links deleted');
select is((select array[count(*)::text, bool_and(application_project_id is null)::text] from public.ai_usage_records
            where ai_job_id = 'a0000000-7777-0000-0000-000000000001'),
          array['1', 'true'], 'usage record kept with application_project_id null');
select is((select count(*)::int from public.application_projects where user_id = 'a0000000-0000-0000-0000-000000000001'), 5,
          'other projects untouched');

-- Account deletion removes everything (DM-1).
delete from auth.users where id = 'a0000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.application_projects) + (select count(*)::int from public.job_descriptions)
          + (select count(*)::int from public.jd_requirements) + (select count(*)::int from public.application_stage_events),
          0, 'account deletion cascades through all S5 tables');

select * from finish();
rollback;
