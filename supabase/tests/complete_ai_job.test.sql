-- S3a complete_ai_job(p_job_id, p_run_generation, p_progress) v4: succeed one run generation, no charging.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer, service_role;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

select function_returns('public', 'complete_ai_job', array['uuid', 'integer', 'jsonb'], 'void', 'v4 signature returns void');
select hasnt_function('public', 'complete_ai_job', array['uuid', 'uuid', 'integer', 'jsonb'], 'S3 4-arg (ledger) form is gone');
select hasnt_function('public', 'complete_ai_job', array['uuid', 'jsonb'], 'old 2-arg form is gone');
select is((select prosecdef from pg_proc where oid = 'public.complete_ai_job(uuid, integer, jsonb)'::regprocedure), false,
          'security invoker');
select ok(has_function_privilege('app_ai_writer', 'public.complete_ai_job(uuid, integer, jsonb)', 'execute'), 'app_ai_writer can complete');
select ok(not has_function_privilege('authenticated', 'public.complete_ai_job(uuid, integer, jsonb)', 'execute'), 'user cannot complete');
select ok(not has_function_privilege('anon', 'public.complete_ai_job(uuid, integer, jsonb)', 'execute'), 'anon cannot complete');

set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
insert into public.ai_jobs (id, job_type, status, run_generation, next_run_at, progress, provider, model_tier, connection_tier) values
  ('a1000000-0000-0000-0000-000000000001', 'cover_letter', 'running', 1, now(), '{"stage":"a","done":0,"total":1}', 'openai', 'default', 'paid'),
  ('a1000000-0000-0000-0000-000000000002', 'cover_letter', 'queued', 0, null, null, 'openai', 'default', 'paid'),
  ('a1000000-0000-0000-0000-000000000003', 'interview_questions', 'running', 2, null, '{"stage":"x","done":1,"total":2}', 'gemini', 'light', 'free');
insert into public.ai_jobs (id, job_type, status, error_code, provider, model_tier, connection_tier) values
  ('a1000000-0000-0000-0000-000000000004', 'insight', 'failed', 'timeout', 'openai', 'default', 'paid');

-- Wrong / null generation: refused, nothing changes.
select throws_ok($$select public.complete_ai_job('a1000000-0000-0000-0000-000000000001', 0)$$,
                 'P0001', 'invalid_ai_job_transition', 'stale run_generation refused');
select throws_ok($$select public.complete_ai_job('a1000000-0000-0000-0000-000000000001', 2)$$,
                 'P0001', 'invalid_ai_job_transition', 'newer run_generation refused');
select throws_ok($$select public.complete_ai_job('a1000000-0000-0000-0000-000000000001', null)$$,
                 'P0001', 'invalid_ai_job_transition', 'null run_generation refused');
select is((select status from public.ai_jobs where id = 'a1000000-0000-0000-0000-000000000001'), 'running',
          'refused call left the job running');

-- Happy path.
select lives_ok($$select public.complete_ai_job('a1000000-0000-0000-0000-000000000001', 1, '{"stage":"done","done":1,"total":1}')$$,
                'running -> succeeded');
select results_eq($$select status, finished_at is not null, next_run_at, progress from public.ai_jobs
                     where id = 'a1000000-0000-0000-0000-000000000001'$$,
                  $$values ('succeeded'::text, true, null::timestamptz, '{"stage":"done","done":1,"total":1}'::jsonb)$$,
                  'succeeded + finished_at + next_run_at cleared + progress replaced');
select lives_ok($$select public.complete_ai_job('a1000000-0000-0000-0000-000000000001', 1)$$, 'repeat call is idempotent');
select is((select progress from public.ai_jobs where id = 'a1000000-0000-0000-0000-000000000001'),
          '{"stage":"done","done":1,"total":1}'::jsonb, 'repeat call without progress keeps progress');
select throws_ok($$select public.complete_ai_job('a1000000-0000-0000-0000-000000000001', 0)$$,
                 'P0001', 'invalid_ai_job_transition', 'repeat with another generation refused');
select lives_ok($$select public.complete_ai_job('a1000000-0000-0000-0000-000000000003', 2)$$, 'null progress keeps progress');
select is((select progress from public.ai_jobs where id = 'a1000000-0000-0000-0000-000000000003'),
          '{"stage":"x","done":1,"total":2}'::jsonb, 'progress kept');

-- Wrong status.
select throws_ok($$select public.complete_ai_job('a1000000-0000-0000-0000-000000000002', 0)$$,
                 'P0001', 'invalid_ai_job_transition', 'queued job cannot complete');
select throws_ok($$select public.complete_ai_job('a1000000-0000-0000-0000-000000000004', 0)$$,
                 'P0001', 'invalid_ai_job_transition', 'failed job cannot complete');
select throws_ok($$select public.complete_ai_job(gen_random_uuid(), 0)$$, 'P0001', 'ai_job_not_found', 'unknown job');

-- B cannot complete A's job.
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"app_ai_writer"}';
select throws_ok($$select public.complete_ai_job('a1000000-0000-0000-0000-000000000002', 0)$$,
                 'P0001', 'ai_job_not_found', 'B cannot complete A job');
set local request.jwt.claims = '{"role":"app_ai_writer"}';
select throws_ok($$select public.complete_ai_job('a1000000-0000-0000-0000-000000000002', 0)$$,
                 '42501', 'not_authenticated', 'no sub');
reset role;
select is((select status from public.ai_jobs where id = 'a1000000-0000-0000-0000-000000000002'), 'queued', 'A job unchanged');

select * from finish();
rollback;
