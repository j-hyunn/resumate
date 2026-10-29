-- QA-S6-01: manual retry of a failed insight job (same ai_jobs row, run_generation + 1, step outputs kept).
-- The end trigger failed the row in the earlier run; the retry must be able to complete it, with or without
-- calling begin_insight again. A row failed within the current run stays stale_run.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('c0000000-0000-0000-0000-000000000001', 'c@example.test', 'authenticated', 'authenticated');
insert into public.application_projects (id, user_id, name, name_source) values
  ('c0000000-aaaa-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'C1', 'user'),
  ('c0000000-aaaa-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'C2', 'user'),
  ('c0000000-aaaa-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001', 'C3', 'user');
insert into public.job_descriptions (id, user_id, application_project_id, raw_text, raw_text_hash, sentences,
                                     extraction_status, extraction, tech_keywords, requirements_hash,
                                     extraction_provider, extraction_model)
select ('c0000000-dddd-0000-0000-00000000000' || n)::uuid, 'c0000000-0000-0000-0000-000000000001',
       ('c0000000-aaaa-0000-0000-00000000000' || n)::uuid, 'x', 'h', '[{"sid":"S1","text":"x","start":0,"end":1}]',
       'succeeded', '{}', '[]', 'rh', 'gemini', 'm'
  from generate_series(1, 3) n;

create temp table t_payload (v jsonb);
insert into t_payload values ('{"result":{"schema_version":1},"match_stage_result":{"matches":[]},
  "hashes":{"requirements_hash":"rh","career_snapshot_hash":"ch","input_hash":"ih"},
  "meta":{"schema_version":1,"prompt_version":"pv","provider":"gemini","model":"m","model_tier":"default",
          "connection_tier":"free","validation_report":null,"usage":null},"evidence":[]}');
grant select on t_payload to app_ai_writer;

set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier)
select ('c0000000-7777-0000-0000-00000000000' || n)::uuid, 'insight', ('c0000000-aaaa-0000-0000-00000000000' || n)::uuid,
       'application_project', ('c0000000-aaaa-0000-0000-00000000000' || n)::uuid, 'running', 1, 'gemini', 'default', 'free'
  from generate_series(1, 3) n;

create function pg_temp.retry(p_job uuid, p_gen int) returns void language sql as $f$
  update public.ai_jobs set status = 'queued', run_generation = p_gen where id = p_job;
  update public.ai_jobs set status = 'running' where id = p_job;
$f$;

-- ── A: fail -> retry -> begin again -> complete ─────────────────────────
select set_config('t.a', public.begin_insight('c0000000-aaaa-0000-0000-000000000001', 'c0000000-7777-0000-0000-000000000001')::text, true);
select is(public.begin_insight('c0000000-aaaa-0000-0000-000000000001', 'c0000000-7777-0000-0000-000000000001')::text,
          current_setting('t.a'), 'same run: begin is idempotent');
select is((select status from public.insights where id = current_setting('t.a')::uuid), 'generating', 'same run: still generating');
update public.ai_jobs set status = 'failed', error_code = 'rate_limited' where id = 'c0000000-7777-0000-0000-000000000001';
select results_eq($$select status, run_generation from public.insights where id = current_setting('t.a')::uuid$$,
                  $$values ('failed'::text, 1)$$, 'A: run 1 failed by the end trigger (generation stamped)');
select pg_temp.retry('c0000000-7777-0000-0000-000000000001', 2);
select is(public.begin_insight('c0000000-aaaa-0000-0000-000000000001', 'c0000000-7777-0000-0000-000000000001')::text,
          current_setting('t.a'), 'A: retry begin returns the same row');
select results_eq($$select status, run_generation from public.insights where id = current_setting('t.a')::uuid$$,
                  $$values ('generating'::text, 2)$$, 'A: retry begin reopens the row for run 2');
select is(public.complete_insight(current_setting('t.a')::uuid, 'c0000000-7777-0000-0000-000000000001', 1, (select v from t_payload)),
          '{"applied": false, "reason": "stale_run"}'::jsonb, 'A: late run 1 complete -> stale_run');
select is(public.complete_insight(current_setting('t.a')::uuid, 'c0000000-7777-0000-0000-000000000001', 2, (select v from t_payload))
            ->> 'applied', 'true', 'A: run 2 completes');
select results_eq($$select status, is_latest, version_no, run_generation from public.insights
                     where application_project_id = 'c0000000-aaaa-0000-0000-000000000001'$$,
                  $$values ('ready'::text, true, 1, 2)$$, 'A: one row, ready and latest (no new version)');
select lives_ok($$select public.complete_ai_job('c0000000-7777-0000-0000-000000000001', 2)$$, 'A: job completes');
select is(public.begin_insight('c0000000-aaaa-0000-0000-000000000001', 'c0000000-7777-0000-0000-000000000001')::text,
          current_setting('t.a'), 'A: begin after success returns the ready row unchanged');
select is((select status from public.insights where id = current_setting('t.a')::uuid), 'ready', 'A: ready row never reopened');

-- ── B: fail -> retry without begin (prepare output kept) -> complete ────
select set_config('t.b', public.begin_insight('c0000000-aaaa-0000-0000-000000000002', 'c0000000-7777-0000-0000-000000000002')::text, true);
update public.ai_jobs set status = 'failed', error_code = 'timeout' where id = 'c0000000-7777-0000-0000-000000000002';
select pg_temp.retry('c0000000-7777-0000-0000-000000000002', 2);
select is((select status from public.insights where id = current_setting('t.b')::uuid), 'failed', 'B: row still failed before validate');
select is(public.complete_insight(current_setting('t.b')::uuid, 'c0000000-7777-0000-0000-000000000002', 2, (select v from t_payload))
            ->> 'applied', 'true', 'B: run 2 completes the earlier-run failed row directly');
select results_eq($$select status, is_latest from public.insights where id = current_setting('t.b')::uuid$$,
                  $$values ('ready'::text, true)$$, 'B: ready and latest');

-- ── C: failed within the current run stays failed ───────────────────────
select set_config('t.c', public.begin_insight('c0000000-aaaa-0000-0000-000000000003', 'c0000000-7777-0000-0000-000000000003')::text, true);
select is(public.fail_insight(current_setting('t.c')::uuid, 'c0000000-7777-0000-0000-000000000003'), true, 'C: fail_insight in run 1');
select is(public.begin_insight('c0000000-aaaa-0000-0000-000000000003', 'c0000000-7777-0000-0000-000000000003')::text,
          current_setting('t.c'), 'C: begin again in the same run returns the row');
select is((select status from public.insights where id = current_setting('t.c')::uuid), 'failed', 'C: same run does not reopen');
select is(public.complete_insight(current_setting('t.c')::uuid, 'c0000000-7777-0000-0000-000000000003', 1, (select v from t_payload)),
          '{"applied": false, "reason": "stale_run"}'::jsonb, 'C: complete in the failing run -> stale_run');
-- The retry after fail_insight (row stamped with run 1) works like A/B.
update public.ai_jobs set status = 'failed', error_code = 'schema_invalid' where id = 'c0000000-7777-0000-0000-000000000003';
select pg_temp.retry('c0000000-7777-0000-0000-000000000003', 2);
select is(public.fail_insight(current_setting('t.c')::uuid, 'c0000000-7777-0000-0000-000000000003'), false,
          'C: fail_insight on the not-yet-reopened row is a no-op');
select is(public.complete_insight(current_setting('t.c')::uuid, 'c0000000-7777-0000-0000-000000000003', 2, (select v from t_payload))
            ->> 'applied', 'true', 'C: run 2 completes');
reset role;

select * from finish();
rollback;
