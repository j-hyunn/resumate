-- R2: retry_ai_job — same-row manual retry with the ACTIVE provider (A1 change, A1 세부, R-63, R-64; DM 2.9.1 case (1),
-- DM 2.11.7 path ②). Gates, same vs different provider / tier, result-row reopening (insight, interview questions,
-- interview evaluation), stale_run of the previous generation, other users, non-retryable jobs, in-flight conflict,
-- provider-change guard, privileges. Calls run as the real roles.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('d0000000-0000-0000-0000-000000000001', 'd@example.test', 'authenticated', 'authenticated'),
  ('e0000000-0000-0000-0000-000000000002', 'e@example.test', 'authenticated', 'authenticated');

-- D: gemini (free, valid) + openai (paid, valid), consents for both; active gemini. E: gemini free.
insert into public.ai_provider_keys (id, user_id, provider, connection_tier, key_ciphertext, key_nonce, wrapped_dek, kek_id, key_last4, status) values
  ('d0000000-9999-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'gemini', 'free', '\x01', '\x02', '\x03', 'env-v1', 'gm01', 'valid'),
  ('d0000000-9999-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 'openai', 'paid', '\x01', '\x02', '\x03', 'env-v1', 'oa01', 'valid'),
  ('e0000000-9999-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', 'gemini', 'free', '\x01', '\x02', '\x03', 'env-v1', 'eg01', 'valid');
insert into public.ai_data_use_consents (user_id, provider, connection_tier, disclosure_version, free_tier_acknowledged) values
  ('d0000000-0000-0000-0000-000000000001', 'gemini', 'free', 'v2026-10-29', true),
  ('d0000000-0000-0000-0000-000000000001', 'openai', 'paid', 'v2026-10-29', false),
  ('e0000000-0000-0000-0000-000000000002', 'gemini', 'free', 'v2026-10-29', true);
update public.profiles set active_ai_provider = 'gemini'
 where id in ('d0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002');

-- Career (question evidence) + 8 application projects with an extracted JD.
set local role authenticated;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into public.experiences (id, company_name, start_month, job_rank)
  values ('d0000000-1111-0000-0000-000000000001', 'D사', '2020-01-01', 'S');
insert into public.projects (id, experience_id, name, role)
  values ('d0000000-3333-0000-0000-000000000001', 'd0000000-1111-0000-0000-000000000001', '결제', 'Dev');
insert into public.project_details (id, project_id, title, situation, action, learnings)
  values ('d0000000-4444-0000-0000-000000000001', 'd0000000-3333-0000-0000-000000000001', 't', 's', '인덱스 재설계', '배움');
reset role;

insert into public.application_projects (id, user_id, name, name_source)
select ('d0000000-aaaa-0000-0000-00000000000' || n)::uuid, 'd0000000-0000-0000-0000-000000000001', 'P' || n, 'user'
  from generate_series(1, 8) n;
insert into public.job_descriptions (id, user_id, application_project_id, raw_text, raw_text_hash, sentences,
                                     extraction_status, extraction, tech_keywords, requirements_hash,
                                     extraction_provider, extraction_model)
select ('d0000000-dddd-0000-0000-00000000000' || n)::uuid, 'd0000000-0000-0000-0000-000000000001',
       ('d0000000-aaaa-0000-0000-00000000000' || n)::uuid, 'x', 'h', '[{"sid":"S1","text":"x","start":0,"end":1}]',
       'succeeded', '{}', '[]', 'rh', 'gemini', 'm'
  from generate_series(1, 8) n;
insert into public.jd_requirements (id, user_id, job_description_id, category, content, source_sids, sort_order)
select ('d0000000-8888-0000-0000-00000000000' || n)::uuid, 'd0000000-0000-0000-0000-000000000001',
       ('d0000000-dddd-0000-0000-00000000000' || n)::uuid, 'required', 'R', '{S1}', 0
  from generate_series(1, 8) n;

-- Payload builders (provider meta must match the job's).
create function pg_temp.meta(p_provider text, p_tier text) returns jsonb language sql as $f$
  select jsonb_build_object('schema_version', 2, 'prompt_version', 'pv', 'provider', p_provider, 'model', 'm-' || p_provider,
                            'model_tier', 'default', 'connection_tier', p_tier, 'validation_report', null, 'usage', null);
$f$;
create function pg_temp.insight_payload(p_provider text, p_tier text) returns jsonb language sql as $f$
  select jsonb_build_object('result', '{"schema_version":1}'::jsonb, 'match_stage_result', '{"matches":[]}'::jsonb,
    'hashes', '{"requirements_hash":"rh","career_snapshot_hash":"ch","input_hash":"ih"}'::jsonb,
    'meta', pg_temp.meta(p_provider, p_tier) || '{"schema_version":1}', 'evidence', '[]'::jsonb);
$f$;
create function pg_temp.question(p_seq int, p_req uuid, p_provider text, p_tier text) returns jsonb language sql as $f$
  select jsonb_build_object(
    'sequence', p_seq, 'source_kind', 'project_deep_dive', 'anchor', 'experience', 'question_text', '질문 ' || p_seq,
    'intent', '의도', 'focus_criteria', '[]'::jsonb, 'target_requirement_ids', jsonb_build_array(p_req),
    'target_gap_requirement_ids', '[]'::jsonb, 'good_answer_signals', '[]'::jsonb,
    'hashes', jsonb_build_object('input_hash', 'ih', 'career_snapshot_hash', 'ch'),
    'meta', pg_temp.meta(p_provider, p_tier),
    'evidence', jsonb_build_array(jsonb_build_object('item_key', 'question', 'sort_order', 0,
      'source_type', 'project_detail', 'source_id', 'd0000000-4444-0000-0000-000000000001', 'source_field', 'action')));
$f$;
create function pg_temp.eval_payload(p_provider text, p_tier text) returns jsonb language sql as $f$
  select jsonb_build_object(
    'result', jsonb_build_object('criteria', '[]'::jsonb, 'intent_reveal', '의도'),
    'hashes', jsonb_build_object('input_hash', 'ih', 'career_snapshot_hash', 'ch'),
    'meta', pg_temp.meta(p_provider, p_tier),
    'evidence', jsonb_build_array(jsonb_build_object('item_key', 'model_answer', 'sort_order', 0,
      'source_type', 'project_detail', 'source_id', 'd0000000-4444-0000-0000-000000000001', 'source_field', 'action')));
$f$;

grant execute on function pg_temp.meta(text, text), pg_temp.insight_payload(text, text),
  pg_temp.question(int, uuid, text, text), pg_temp.eval_payload(text, text) to app_ai_writer, authenticated;

select set_config('t.run_meta', '{"runBase":5,"waitBase":0,"retries":{}}', true);

-- ══ structure / privileges ══
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'retry_ai_job'), 1, 'one retry_ai_job signature (QA-01)');
select ok((select prosecdef from pg_proc where oid = 'public.retry_ai_job(uuid,integer,text,text,jsonb,text,text)'::regprocedure),
          'retry_ai_job is security definer');
select ok(has_function_privilege('app_ai_writer', 'public.retry_ai_job(uuid,integer,text,text,jsonb,text,text)', 'EXECUTE'),
          'app_ai_writer may execute retry_ai_job');
select ok(not has_function_privilege('authenticated', 'public.retry_ai_job(uuid,integer,text,text,jsonb,text,text)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.retry_ai_job(uuid,integer,text,text,jsonb,text,text)', 'EXECUTE')
          and not has_function_privilege('service_role', 'public.retry_ai_job(uuid,integer,text,text,jsonb,text,text)', 'EXECUTE'),
          'authenticated / anon / service_role may not execute retry_ai_job');
select ok(has_column_privilege('authenticated', 'public.profiles', 'active_ai_provider', 'SELECT')
          and has_column_privilege('authenticated', 'public.ai_jobs', 'provider', 'SELECT')
          and has_column_privilege('authenticated', 'public.ai_jobs', 'connection_tier', 'SELECT'),
          'authenticated still reads the values the retry badge needs');

-- ══ insight jobs ══
-- I1..I4 on P1..P4 (gemini / free, except I3 gemini / paid). Each begins its insight row, then fails.
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier, model, input_hash)
select ('d0000000-7777-0000-0000-00000000000' || n)::uuid, 'insight', ('d0000000-aaaa-0000-0000-00000000000' || n)::uuid,
       'application_project', ('d0000000-aaaa-0000-0000-00000000000' || n)::uuid, 'running', 1, 'gemini', 'default',
       case when n = 3 then 'paid' else 'free' end, 'm-gemini', 'old-hash'
  from generate_series(1, 4) n;
select set_config('t.i' || n, public.begin_insight(('d0000000-aaaa-0000-0000-00000000000' || n)::uuid,
                                                   ('d0000000-7777-0000-0000-00000000000' || n)::uuid)::text, true)
  from generate_series(1, 4) n;
update public.ai_jobs set status = 'failed', error_code = 'rate_limited'
 where id in ('d0000000-7777-0000-0000-000000000001', 'd0000000-7777-0000-0000-000000000002',
              'd0000000-7777-0000-0000-000000000003', 'd0000000-7777-0000-0000-000000000004');
reset role;
update public.ai_jobs set step_outputs = '{"match":{"x":1},"_meta":{"runBase":1,"waitBase":9,"retries":{"a":1},"partials":{"p":1}}}'
 where id in ('d0000000-7777-0000-0000-000000000001', 'd0000000-7777-0000-0000-000000000002',
              'd0000000-7777-0000-0000-000000000003');

-- ── other user / unknown job ──
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"e0000000-0000-0000-0000-000000000002","role":"app_ai_writer"}';
select throws_ok($$select public.retry_ai_job('d0000000-7777-0000-0000-000000000001', 1, 'm', 'default', '{}', 'gemini')$$,
                 'P0001', 'ai_job_not_found', 'another user''s job -> ai_job_not_found');
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select throws_ok($$select public.retry_ai_job(gen_random_uuid(), 1, 'm', 'default', '{}', 'gemini')$$,
                 'P0001', 'ai_job_not_found', 'unknown job -> ai_job_not_found');

-- ── generation mismatch: no raise ──
select is(public.retry_ai_job('d0000000-7777-0000-0000-000000000001', 7, 'm', 'default', '{}', 'gemini'),
          '{"requeued": false, "status": "failed", "run_generation": 1}'::jsonb,
          'expected generation mismatch -> requeued false');

-- ── argument checks ──
select throws_ok($$select public.retry_ai_job('d0000000-7777-0000-0000-000000000001', 1, '  ', 'default', '{}', 'gemini')$$,
                 'P0001', 'invalid_ai_metadata', 'blank model -> invalid_ai_metadata');
select throws_ok($$select public.retry_ai_job('d0000000-7777-0000-0000-000000000001', 1, 'm', 'huge', '{}', 'gemini')$$,
                 'P0001', 'invalid_ai_metadata', 'bad tier -> invalid_ai_metadata');
select throws_ok($$select public.retry_ai_job('d0000000-7777-0000-0000-000000000001', 1, 'm', 'default', '[]', 'gemini')$$,
                 'P0001', 'invalid_run_meta', 'run meta not an object -> invalid_run_meta');
reset role;

-- ── path ② gates (job stays failed) ──
update public.profiles set active_ai_provider = null where id = 'd0000000-0000-0000-0000-000000000001';
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select throws_ok($$select public.retry_ai_job('d0000000-7777-0000-0000-000000000001', 1, 'm', 'default', '{}', 'gemini')$$,
                 'P0001', 'key_missing', 'no active provider -> key_missing');
reset role;
update public.profiles set active_ai_provider = 'openai' where id = 'd0000000-0000-0000-0000-000000000001';
update public.ai_provider_keys set status = 'invalid' where id = 'd0000000-9999-0000-0000-000000000002';
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select throws_ok($$select public.retry_ai_job('d0000000-7777-0000-0000-000000000001', 1, 'm', 'default', '{}', 'openai')$$,
                 'P0001', 'key_invalid', 'active key invalid -> key_invalid (not the job''s gemini key)');
reset role;
update public.ai_provider_keys set status = 'valid' where id = 'd0000000-9999-0000-0000-000000000002';
update public.ai_data_use_consents set withdrawn_at = now()
 where user_id = 'd0000000-0000-0000-0000-000000000001' and provider = 'openai';
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select throws_ok($$select public.retry_ai_job('d0000000-7777-0000-0000-000000000001', 1, 'm', 'default', '{}', 'openai')$$,
                 'P0001', 'ai_consent_required', 'active provider consent withdrawn -> ai_consent_required');
reset role;
insert into public.ai_data_use_consents (user_id, provider, connection_tier, disclosure_version, free_tier_acknowledged)
values ('d0000000-0000-0000-0000-000000000001', 'openai', 'paid', 'v2026-10-29', false);
select results_eq($$select status, run_generation, provider, error_code from public.ai_jobs
                     where id = 'd0000000-7777-0000-0000-000000000001'$$,
                  $$values ('failed'::text, 1, 'gemini'::text, 'rate_limited'::text)$$, 'rejected retries leave the job failed');

-- ── same provider and tier (I1): step outputs kept, failed row reopened lazily ──
update public.profiles set active_ai_provider = 'gemini' where id = 'd0000000-0000-0000-0000-000000000001';

-- ── QA-01: the active connection changed after the caller resolved the model -> ai_connection_changed ──
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select throws_ok($$select public.retry_ai_job('d0000000-7777-0000-0000-000000000001', 1, 'm-openai', 'default', '{}', 'openai', 'paid')$$,
                 'P0001', 'ai_connection_changed', 'expected provider differs from the active one -> ai_connection_changed');
select throws_ok($$select public.retry_ai_job('d0000000-7777-0000-0000-000000000001', 1, 'm-gemini', 'default', '{}', 'gemini', 'paid')$$,
                 'P0001', 'ai_connection_changed', 'expected tier differs from the active key tier -> ai_connection_changed');
select throws_ok($$select public.retry_ai_job('d0000000-7777-0000-0000-000000000001', 1, 'm', 'default', '{}', null)$$,
                 'P0001', 'invalid_ai_metadata', 'expected provider is required');
select throws_ok($$select public.retry_ai_job('d0000000-7777-0000-0000-000000000001', 1, 'm', 'default', '{}', 'claude')$$,
                 'P0001', 'invalid_ai_metadata', 'unknown expected provider -> invalid_ai_metadata');
select throws_ok($$select public.retry_ai_job('d0000000-7777-0000-0000-000000000001', 1, 'm', 'default', '{}', 'gemini', 'pro')$$,
                 'P0001', 'invalid_ai_metadata', 'unknown expected tier -> invalid_ai_metadata');
reset role;
select results_eq($$select status, run_generation, provider, connection_tier, model, error_code, step_outputs
                      from public.ai_jobs where id = 'd0000000-7777-0000-0000-000000000001'$$,
                  $$values ('failed'::text, 1, 'gemini'::text, 'free'::text, 'm-gemini'::text, 'rate_limited'::text,
                            '{"match":{"x":1},"_meta":{"runBase":1,"waitBase":9,"retries":{"a":1},"partials":{"p":1}}}'::jsonb)$$,
                  'ai_connection_changed leaves the job row unchanged');
select results_eq($$select status, run_generation, provider from public.insights where id = current_setting('t.i1')::uuid$$,
                  $$values ('failed'::text, 1, 'gemini'::text)$$, 'ai_connection_changed leaves the result row unchanged');
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.retry_ai_job('d0000000-7777-0000-0000-000000000001', 1, ' m-gemini ', 'default', current_setting('t.run_meta')::jsonb, 'gemini', 'free'),
          '{"requeued": true, "restarted": false, "status": "queued", "provider": "gemini", "model": "m-gemini",
            "model_tier": "default", "connection_tier": "free", "run_generation": 2}'::jsonb,
          'I1 same provider: requeued, not restarted');
reset role;
select results_eq($$select status, run_generation, error_code, finished_at is null, next_run_at, heartbeat_at is not null,
                           step_outputs, input_hash
                      from public.ai_jobs where id = 'd0000000-7777-0000-0000-000000000001'$$,
                  $$values ('queued'::text, 2, null::text, true, null::timestamptz, true,
                            '{"match":{"x":1},"_meta":{"runBase":5,"waitBase":0,"retries":{},"partials":{"p":1}}}'::jsonb,
                            'old-hash'::text)$$,
                  'I1: queued gen 2, failure cleared, stage outputs + partials kept, _meta replaced, hash kept');
select results_eq($$select status, run_generation from public.insights where id = current_setting('t.i1')::uuid$$,
                  $$values ('failed'::text, 1)$$, 'I1: failed row untouched by the retry (reopened by complete / begin)');
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
update public.ai_jobs set status = 'running' where id = 'd0000000-7777-0000-0000-000000000001';
select is(public.complete_insight(current_setting('t.i1')::uuid, 'd0000000-7777-0000-0000-000000000001', 1,
                                  pg_temp.insight_payload('gemini', 'free')),
          '{"applied": false, "reason": "stale_run"}'::jsonb, 'I1: late generation-1 completion -> stale_run');
select is(public.complete_insight(current_setting('t.i1')::uuid, 'd0000000-7777-0000-0000-000000000001', 2,
                                  pg_temp.insight_payload('gemini', 'free')) ->> 'applied', 'true', 'I1: generation 2 completes');
select is(public.retry_ai_job('d0000000-7777-0000-0000-000000000001', 2, 'm', 'default', '{}', 'gemini'),
          '{"requeued": false, "status": "running", "run_generation": 2}'::jsonb, 'running job -> requeued false');
reset role;

-- empty partials are not carried over
update public.ai_jobs set step_outputs = '{"_meta":{"partials":{}}}' where id = 'd0000000-7777-0000-0000-000000000004';

-- ── different provider (I2): restart from scratch, row reopened now with the new provider ──
update public.profiles set active_ai_provider = 'openai' where id = 'd0000000-0000-0000-0000-000000000001';
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.retry_ai_job('d0000000-7777-0000-0000-000000000002', 1, 'm-openai', 'heavy', current_setting('t.run_meta')::jsonb, 'openai', 'paid'),
          '{"requeued": true, "restarted": true, "status": "queued", "provider": "openai", "model": "m-openai",
            "model_tier": "heavy", "connection_tier": "paid", "run_generation": 2}'::jsonb,
          'I2 other provider: requeued, restarted');
reset role;
select results_eq($$select provider, connection_tier, model, model_tier, step_outputs, input_hash
                      from public.ai_jobs where id = 'd0000000-7777-0000-0000-000000000002'$$,
                  $$values ('openai'::text, 'paid'::text, 'm-openai'::text, 'heavy'::text,
                            '{"_meta":{"runBase":5,"waitBase":0,"retries":{}}}'::jsonb, null::text)$$,
                  'I2: provider columns = active values, step outputs (incl. partials) dropped, input_hash cleared');
select results_eq($$select status, run_generation, provider, connection_tier, model_tier
                      from public.insights where id = current_setting('t.i2')::uuid$$,
                  $$values ('generating'::text, 2, 'openai'::text, 'paid'::text, 'heavy'::text)$$,
                  'I2: insight row reopened for generation 2 with the new provider meta');
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
update public.ai_jobs set status = 'running' where id = 'd0000000-7777-0000-0000-000000000002';
select is(public.complete_insight(current_setting('t.i2')::uuid, 'd0000000-7777-0000-0000-000000000002', 1,
                                  pg_temp.insight_payload('gemini', 'free')),
          '{"applied": false, "reason": "stale_run"}'::jsonb, 'I2: late generation-1 (gemini) completion -> stale_run');
select throws_ok($$select public.complete_insight(current_setting('t.i2')::uuid, 'd0000000-7777-0000-0000-000000000002', 2,
                                  pg_temp.insight_payload('gemini', 'free'))$$,
                 'P0001', 'invalid_ai_metadata', 'I2: generation 2 must carry the new provider meta');
select is(public.complete_insight(current_setting('t.i2')::uuid, 'd0000000-7777-0000-0000-000000000002', 2,
                                  pg_temp.insight_payload('openai', 'paid') || '{"meta":{"schema_version":1,"prompt_version":"pv","provider":"openai","model":"m-openai","model_tier":"heavy","connection_tier":"paid"}}')
            ->> 'applied', 'true', 'I2: generation 2 completes with openai');
reset role;
select results_eq($$select status, provider, model, model_tier from public.insights where id = current_setting('t.i2')::uuid$$,
                  $$values ('ready'::text, 'openai'::text, 'm-openai'::text, 'heavy'::text)$$, 'I2: result row carries the new provider');

-- ── tier only differs (I3: gemini / paid recorded, active gemini key is free) ──
update public.profiles set active_ai_provider = 'gemini' where id = 'd0000000-0000-0000-0000-000000000001';
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select results_eq($$select (r ->> 'restarted')::boolean, r ->> 'provider', r ->> 'connection_tier'
                      from public.retry_ai_job('d0000000-7777-0000-0000-000000000003', 1, 'm-gemini', 'default',
                                               current_setting('t.run_meta')::jsonb, 'gemini', 'free') r$$,
                  $$values (true, 'gemini'::text, 'free'::text)$$, 'I3 tier only differs -> restarted');
reset role;
select results_eq($$select j.step_outputs, j.input_hash, i.status from public.ai_jobs j join public.insights i on i.ai_job_id = j.id
                     where j.id = 'd0000000-7777-0000-0000-000000000003'$$,
                  $$values ('{"_meta":{"runBase":5,"waitBase":0,"retries":{}}}'::jsonb, 'old-hash'::text, 'generating'::text)$$,
                  'I3: step outputs dropped, row reopened; same provider + model keeps input_hash');

-- ── I4 same provider with empty partials ──
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.retry_ai_job('d0000000-7777-0000-0000-000000000004', 1, 'm-gemini', 'default', '{"runBase":1}', 'gemini') ->> 'restarted',
          'false', 'I4 same provider');
reset role;
select is((select step_outputs from public.ai_jobs where id = 'd0000000-7777-0000-0000-000000000004'),
          '{"_meta":{"runBase":1}}'::jsonb, 'I4: empty partials are not carried over');

-- ── non-retryable jobs ──
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier) values
  ('d0000000-7777-0000-0000-000000000005', 'jd_extraction', 'd0000000-aaaa-0000-0000-000000000005',
   'job_description', 'd0000000-dddd-0000-0000-000000000005', 'running', 1, 'gemini', 'light', 'free'),
  ('d0000000-7777-0000-0000-000000000006', 'insight', 'd0000000-aaaa-0000-0000-000000000006',
   'application_project', 'd0000000-aaaa-0000-0000-000000000006', 'running', 1, 'gemini', 'default', 'free');
update public.ai_jobs set status = 'failed', error_code = 'rate_limited' where id = 'd0000000-7777-0000-0000-000000000005';
update public.ai_jobs set status = 'failed', error_code = 'insufficient_data' where id = 'd0000000-7777-0000-0000-000000000006';
select throws_ok($$select public.retry_ai_job('d0000000-7777-0000-0000-000000000005', 1, 'm', 'light', '{}', 'gemini')$$,
                 'P0001', 'ai_job_not_retryable', 'request-scoped job (jd_extraction) -> ai_job_not_retryable');
select throws_ok($$select public.retry_ai_job('d0000000-7777-0000-0000-000000000006', 1, 'm', 'default', '{}', 'gemini')$$,
                 'P0001', 'ai_job_not_retryable', 'input error (insufficient_data) -> ai_job_not_retryable');

-- ── another job on the same target is in flight -> 23505, nothing changes ──
insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier) values
  ('d0000000-7777-0000-0000-000000000007', 'insight', 'd0000000-aaaa-0000-0000-000000000006',
   'application_project', 'd0000000-aaaa-0000-0000-000000000006', 'running', 1, 'gemini', 'default', 'free');
update public.ai_jobs set error_code = 'timeout' where id = 'd0000000-7777-0000-0000-000000000006';
reset role;
update public.ai_jobs set status = 'failed', error_code = 'timeout' where id = 'd0000000-7777-0000-0000-000000000006';
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select throws_ok($$select public.retry_ai_job('d0000000-7777-0000-0000-000000000006', 1, 'm', 'default', '{}', 'gemini')$$,
                 '23505', null, 'in-flight job on the same target -> 23505');
reset role;
select is((select status from public.ai_jobs where id = 'd0000000-7777-0000-0000-000000000006'), 'failed', 'conflict: job stays failed');

-- ── guard: provider / tier change only on failed -> queued ──
select throws_ok($$update public.ai_jobs set provider = 'openai' where id = 'd0000000-7777-0000-0000-000000000007'$$,
                 'P0001', 'invalid_ai_job_transition', 'running job: provider change refused');
select throws_ok($$update public.ai_jobs set connection_tier = 'paid' where id = 'd0000000-7777-0000-0000-000000000006'$$,
                 'P0001', 'invalid_ai_job_transition', 'failed job: tier change without requeue refused');
select lives_ok($$update public.ai_jobs set status = 'canceled', error_code = 'canceled' where id = 'd0000000-7777-0000-0000-000000000007'$$,
                'cleanup: cancel the in-flight job');

-- ══ interview questions ══
-- S7 (P7): two questions saved by Q1 (gemini / free), then Q1 fails; retry with openai deletes them.
-- S8 (P8): one question saved by Q2, then Q2 fails; retry with gemini keeps it.
set local role authenticated;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.create_interview_session('d0000000-aaaa-0000-0000-000000000007', 'job', 3, 'ok',
                                                         'd0000000-5e55-0000-0000-000000000007')$$, 'create S7');
select lives_ok($$select public.create_interview_session('d0000000-aaaa-0000-0000-000000000008', 'job', 3, 'ok',
                                                         'd0000000-5e55-0000-0000-000000000008')$$, 'create S8');
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier) values
  ('d0000000-7777-0000-0000-000000000011', 'interview_questions', 'd0000000-aaaa-0000-0000-000000000007',
   'interview_session', 'd0000000-5e55-0000-0000-000000000007', 'running', 1, 'gemini', 'default', 'free'),
  ('d0000000-7777-0000-0000-000000000012', 'interview_questions', 'd0000000-aaaa-0000-0000-000000000008',
   'interview_session', 'd0000000-5e55-0000-0000-000000000008', 'running', 1, 'gemini', 'default', 'free');
select lives_ok($$select public.begin_interview_questions('d0000000-5e55-0000-0000-000000000007', 'd0000000-7777-0000-0000-000000000011')$$, 'begin S7');
select lives_ok($$select public.begin_interview_questions('d0000000-5e55-0000-0000-000000000008', 'd0000000-7777-0000-0000-000000000012')$$, 'begin S8');
select lives_ok(format($$select public.save_interview_question('d0000000-5e55-0000-0000-000000000007',
                  'd0000000-7777-0000-0000-000000000011', 1, %L::jsonb)$$,
                  pg_temp.question(s, 'd0000000-8888-0000-0000-000000000007', 'gemini', 'free')), 'S7 save Q' || s)
  from generate_series(1, 2) s;
select lives_ok(format($$select public.save_interview_question('d0000000-5e55-0000-0000-000000000008',
                  'd0000000-7777-0000-0000-000000000012', 1, %L::jsonb)$$,
                  pg_temp.question(1, 'd0000000-8888-0000-0000-000000000008', 'gemini', 'free')), 'S8 save Q1');
update public.ai_jobs set status = 'failed', error_code = 'provider_unavailable'
 where id in ('d0000000-7777-0000-0000-000000000011', 'd0000000-7777-0000-0000-000000000012');
reset role;
select set_config('t.s7q1', (select id::text from public.interview_questions
                              where session_id = 'd0000000-5e55-0000-0000-000000000007' and sequence = 1), true);
select results_eq($$select generation_status, question_run_generation from public.interview_sessions
                     where id = 'd0000000-5e55-0000-0000-000000000007'$$,
                  $$values ('failed'::text, 1)$$, 'S7: generation failed by the end trigger');

-- same provider (S8): questions kept, generation reopened lazily
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.retry_ai_job('d0000000-7777-0000-0000-000000000012', 1, 'm-gemini', 'default', '{}', 'gemini', 'free') ->> 'restarted',
          'false', 'Q2 same provider -> not restarted');
reset role;
select results_eq($$select (select count(*)::int from public.interview_questions where session_id = s.id), s.generation_status
                      from public.interview_sessions s where s.id = 'd0000000-5e55-0000-0000-000000000008'$$,
                  $$values (1, 'failed'::text)$$, 'S8: saved question kept, generation still failed until begin');
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select results_eq($$select (r ->> 'reopened')::boolean, (r ->> 'next_sequence')::int
                      from public.begin_interview_questions('d0000000-5e55-0000-0000-000000000008',
                                                            'd0000000-7777-0000-0000-000000000012') r$$,
                  $$values (true, 2)$$, 'S8: begin reopens and continues at question 2');

-- different provider (S7): all saved questions deleted, generation reopened for generation 2
reset role;
update public.profiles set active_ai_provider = 'openai' where id = 'd0000000-0000-0000-0000-000000000001';
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.retry_ai_job('d0000000-7777-0000-0000-000000000011', 1, 'm-openai', 'default', '{}', 'openai', 'paid') ->> 'restarted',
          'true', 'Q1 other provider -> restarted');
reset role;
select results_eq($$select (select count(*)::int from public.interview_questions where session_id = s.id),
                           (select count(*)::int from public.interview_answers where session_id = s.id),
                           (select count(*)::int from public.evidence_links where owner_type = 'interview_question'
                                                                           and owner_id = current_setting('t.s7q1')::uuid),
                           s.generation_status, s.question_run_generation
                      from public.interview_sessions s where s.id = 'd0000000-5e55-0000-0000-000000000007'$$,
                  $$values (0, 0, 0, 'generating'::text, 2)$$,
                  'S7: questions, blank answers and their evidence removed; generation reopened for generation 2');
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
update public.ai_jobs set status = 'running' where id = 'd0000000-7777-0000-0000-000000000011';
select is(public.save_interview_question('d0000000-5e55-0000-0000-000000000007', 'd0000000-7777-0000-0000-000000000011', 1,
                                         pg_temp.question(1, 'd0000000-8888-0000-0000-000000000007', 'gemini', 'free')),
          '{"applied": false, "reason": "stale_run"}'::jsonb, 'S7: late generation-1 save -> stale_run');
select results_eq($$select (r ->> 'reopened')::boolean, (r ->> 'next_sequence')::int, (r ->> 'saved_count')::int
                      from public.begin_interview_questions('d0000000-5e55-0000-0000-000000000007',
                                                            'd0000000-7777-0000-0000-000000000011') r$$,
                  $$values (false, 1, 0)$$, 'S7: begin starts at question 1');
select results_eq($$select f from (select public.save_interview_question('d0000000-5e55-0000-0000-000000000007',
                          'd0000000-7777-0000-0000-000000000011', 2,
                          pg_temp.question(s, 'd0000000-8888-0000-0000-000000000007', 'openai', 'paid')) ->> 'applied' f
                       from generate_series(1, 3) s) t$$,
                  $$values ('true'::text), ('true'::text), ('true'::text)$$, 'S7: generation 2 saves 3 openai questions');
select is(public.complete_interview_questions('d0000000-5e55-0000-0000-000000000007', 'd0000000-7777-0000-0000-000000000011', 2,
            jsonb_build_object('weak_requirement_ids', '[]'::jsonb, 'insight_id', null, 'career_snapshot_hash', 'ch',
                               'meta', pg_temp.meta('openai', 'paid'))) ->> 'question_provider',
          'openai', 'S7: set completes with question_provider = openai');
reset role;
select results_eq($$select distinct provider, connection_tier from public.interview_questions
                     where session_id = 'd0000000-5e55-0000-0000-000000000007'$$,
                  $$values ('openai'::text, 'paid'::text)$$, 'S7: no question mixes the two providers');
update public.ai_jobs set status = 'succeeded' where id = 'd0000000-7777-0000-0000-000000000011';

-- ══ interview evaluation (S7) ══
select set_config('t.a' || q.sequence, a.id::text, true)
  from public.interview_answers a join public.interview_questions q on q.id = a.question_id
 where q.session_id = 'd0000000-5e55-0000-0000-000000000007';
set local role authenticated;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated"}';
update public.interview_answers set answer_text = '답 하나' where id = current_setting('t.a1')::uuid;
update public.interview_answers set answer_text = '답 둘' where id = current_setting('t.a2')::uuid;
select is(public.submit_interview_session('d0000000-5e55-0000-0000-000000000007') ->> 'answered_count', '2', 'submit S7');
reset role;
update public.profiles set active_ai_provider = 'gemini' where id = 'd0000000-0000-0000-0000-000000000001';
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier) values
  ('d0000000-7777-0000-0000-000000000021', 'interview_evaluation', 'd0000000-aaaa-0000-0000-000000000007',
   'interview_session', 'd0000000-5e55-0000-0000-000000000007', 'running', 1, 'gemini', 'heavy', 'free');
select lives_ok($$select public.begin_interview_evaluation('d0000000-5e55-0000-0000-000000000007',
                  'd0000000-7777-0000-0000-000000000021', 'gemini', 'm-gemini')$$, 'E1 begin');
select is(public.save_answer_evaluation(current_setting('t.a1')::uuid, 'd0000000-7777-0000-0000-000000000021', 1,
            pg_temp.eval_payload('gemini', 'free') || jsonb_build_object('meta', pg_temp.meta('gemini', 'free') || '{"model_tier":"heavy"}'))
            ->> 'applied', 'true', 'E1: answer 1 evaluated');
select is(public.fail_answer_evaluation(current_setting('t.a2')::uuid, 'd0000000-7777-0000-0000-000000000021'), true,
          'E1: answer 2 failed');
update public.ai_jobs set status = 'failed', error_code = 'rate_limited' where id = 'd0000000-7777-0000-0000-000000000021';
reset role;
select is((select status from public.interview_sessions where id = 'd0000000-5e55-0000-0000-000000000007'),
          'evaluation_failed', 'E1 failed: session evaluation_failed');

-- same provider: succeeded evaluation kept
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.retry_ai_job('d0000000-7777-0000-0000-000000000021', 1, 'm-gemini', 'heavy', '{}', 'gemini', 'free') ->> 'restarted',
          'false', 'E1 same provider -> not restarted');
reset role;
select results_eq($$select e.status from public.answer_evaluations e
                     where e.session_id = 'd0000000-5e55-0000-0000-000000000007' order by e.answer_id = current_setting('t.a1')::uuid desc$$,
                  $$values ('succeeded'::text), ('failed'::text)$$, 'E1 same provider: succeeded kept, failed stays failed until the run');
select is((select status from public.interview_sessions where id = 'd0000000-5e55-0000-0000-000000000007'),
          'evaluation_failed', 'E1 same provider: session reopened lazily');
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
update public.ai_jobs set status = 'running' where id = 'd0000000-7777-0000-0000-000000000021';
update public.ai_jobs set status = 'failed', error_code = 'rate_limited' where id = 'd0000000-7777-0000-0000-000000000021';
reset role;

-- different provider: every evaluation of this job reopened (pending), session evaluating, new provider meta
update public.profiles set active_ai_provider = 'openai' where id = 'd0000000-0000-0000-0000-000000000001';
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.retry_ai_job('d0000000-7777-0000-0000-000000000021', 2, 'm-openai', 'heavy', '{}', 'openai', 'paid') ->> 'restarted',
          'true', 'E1 other provider -> restarted');
reset role;
select results_eq($$select e.status, e.run_generation, e.provider, e.connection_tier from public.answer_evaluations e
                     where e.session_id = 'd0000000-5e55-0000-0000-000000000007'$$,
                  $$values ('pending'::text, 3, 'openai'::text, 'paid'::text), ('pending'::text, 3, 'openai'::text, 'paid'::text)$$,
                  'E1: succeeded and failed evaluations reopened as pending with the new provider');
select results_eq($$select status, evaluation_run_generation, evaluation_provider, evaluation_model
                      from public.interview_sessions where id = 'd0000000-5e55-0000-0000-000000000007'$$,
                  $$values ('evaluating'::text, 3, 'openai'::text, 'm-openai'::text)$$,
                  'E1: session evaluating for generation 3, evaluation_provider = openai');
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
update public.ai_jobs set status = 'running' where id = 'd0000000-7777-0000-0000-000000000021';
select is(public.save_answer_evaluation(current_setting('t.a1')::uuid, 'd0000000-7777-0000-0000-000000000021', 1,
            pg_temp.eval_payload('gemini', 'free') || jsonb_build_object('meta', pg_temp.meta('gemini', 'free') || '{"model_tier":"heavy"}')),
          '{"applied": false, "reason": "stale_run"}'::jsonb, 'E1: late generation-1 save -> stale_run');
select is(jsonb_array_length(public.begin_interview_evaluation('d0000000-5e55-0000-0000-000000000007',
            'd0000000-7777-0000-0000-000000000021', 'openai', 'm-openai') -> 'answers_to_evaluate'), 2,
          'E1: begin returns both answers to evaluate');
-- the job fails again before saving anything: the end trigger closes the reopened rows
update public.ai_jobs set status = 'failed', error_code = 'timeout' where id = 'd0000000-7777-0000-0000-000000000021';
reset role;
select results_eq($$select s.status, (select count(*)::int from public.answer_evaluations e
                                         where e.session_id = s.id and e.status = 'failed')
                      from public.interview_sessions s where s.id = 'd0000000-5e55-0000-0000-000000000007'$$,
                  $$values ('evaluation_failed'::text, 2)$$, 'E1: re-failure closes the session and the pending evaluations');

-- other user cannot retry an interview job either
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"e0000000-0000-0000-0000-000000000002","role":"app_ai_writer"}';
select throws_ok($$select public.retry_ai_job('d0000000-7777-0000-0000-000000000021', 3, 'm', 'heavy', '{}', 'gemini')$$,
                 'P0001', 'ai_job_not_found', 'other user: interview job -> ai_job_not_found');
reset role;

select * from finish();
rollback;
