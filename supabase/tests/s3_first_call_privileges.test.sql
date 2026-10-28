-- S3 / S3a privilege regression (see career_first_call_privileges.test.sql for why): every AI write path
-- and RPC is first called in the session by its real end role. Nothing touches these tables or
-- functions as postgres before the role under test does.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer, service_role;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated');

-- authenticated first: usage meter, price table, career row for evidence.
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.get_ai_usage_summary()$$, 'authenticated: first get_ai_usage_summary');
select lives_ok($$select public.get_ai_usage_summary('2026-10-01', true)$$, 'authenticated: get_ai_usage_summary with args');
select lives_ok($$select * from public.ai_price_tables$$, 'authenticated: read ai_price_tables');
select lives_ok($$insert into public.skills (id, name) values ('aaaaaaaa-6666-0000-0000-000000000001', 'Go')$$,
                'authenticated: insert skill');
select lives_ok($$select id, status, progress, error_code, error_category, failure_cause, provider, retry_after from public.ai_jobs$$,
                'authenticated: read ai_jobs');
select lives_ok($$select * from public.ai_usage_records$$, 'authenticated: read ai_usage_records');
select lives_ok($$select * from public.evidence_links$$, 'authenticated: read evidence_links');
reset role;

-- app_ai_writer first: the full runner path.
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select lives_ok($$select * from public.ai_price_tables where provider = 'gemini' and model = 'gemini-3.8-flash'
                    and effective_from <= current_date order by effective_from desc limit 1$$,
                'app_ai_writer: price lookup');
select lives_ok($$select private.price_for('gemini', 'gemini-3.8-flash')$$, 'app_ai_writer: private.price_for');
select lives_ok($$insert into public.ai_jobs (id, job_type, target_type, target_id, provider, model_tier, connection_tier)
                  values ('aaaaaaaa-7777-0000-0000-000000000001', 'insight', 'application_project', gen_random_uuid(),
                          'gemini', 'default', 'free')$$,
                'app_ai_writer: insert ai_job (default user_id, guard trigger)');
select lives_ok($$update public.ai_jobs set status = 'running', heartbeat_at = now(), run_generation = 1,
                         progress = '{"stage":"match","done":1,"total":2}', step_outputs = '{"match":1}'
                   where id = 'aaaaaaaa-7777-0000-0000-000000000001' and status = 'queued'$$,
                'app_ai_writer: claim job');
select lives_ok($$insert into public.ai_usage_records (feature, job_type, ai_job_id, call_key, provider, model, model_tier,
                    connection_tier, input_tokens, output_tokens, usage_source, outcome, price_table_version, estimated_cost_usd)
                  values ('insight', 'insight', 'aaaaaaaa-7777-0000-0000-000000000001', 'insight.match.0', 'gemini',
                          'gemini-3.8-flash', 'default', 'free', 100, 10, 'provider_reported', 'succeeded', 'v2026-10-28', 0.000113)$$,
                'app_ai_writer: insert usage record (period_month trigger)');
select lives_ok($$select max(occurred_at) from public.ai_usage_records where provider = 'gemini'$$,
                'app_ai_writer: read last call (C-12 spacing)');
select lives_ok($$update public.ai_jobs set status = 'queued', run_generation = 2, retry_count = 1, retry_wait_total_ms = 2000,
                         next_run_at = now() + interval '2 seconds'
                   where id = 'aaaaaaaa-7777-0000-0000-000000000001'$$,
                'app_ai_writer: schedule retry');
select lives_ok($$update public.ai_jobs set status = 'running', next_run_at = null
                   where id = 'aaaaaaaa-7777-0000-0000-000000000001' and run_generation = 2$$,
                'app_ai_writer: resume');
select lives_ok($$insert into public.evidence_links (application_project_id, owner_type, owner_id, item_key, source_type, source_id, source_field)
                  values (gen_random_uuid(), 'insight', gen_random_uuid(), 'strengths.0', 'skill',
                          'aaaaaaaa-6666-0000-0000-000000000001', 'name')$$,
                'app_ai_writer: insert evidence link (source guard)');
select lives_ok($$select public.complete_ai_job('aaaaaaaa-7777-0000-0000-000000000001', 2)$$, 'app_ai_writer: complete_ai_job');
select lives_ok($$insert into public.ai_jobs (id, job_type, provider, model_tier, connection_tier)
                  values ('aaaaaaaa-7777-0000-0000-000000000002', 'insight', 'openai', 'default', 'paid')$$,
                'app_ai_writer: second job');
select lives_ok($$insert into public.ai_jobs (id, job_type, status, next_run_at, provider, model_tier, connection_tier)
                  values ('aaaaaaaa-7777-0000-0000-000000000003', 'cover_letter', 'queued', now() - interval '1 minute',
                          'openai', 'default', 'paid')$$,
                'app_ai_writer: scheduled job');
reset role;

-- authenticated: cancel, and a career delete that fires the evidence trigger.
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.request_ai_job_cancel('aaaaaaaa-7777-0000-0000-000000000002')$$,
                'authenticated: request_ai_job_cancel');
select lives_ok($$delete from public.skills where id = 'aaaaaaaa-6666-0000-0000-000000000001'$$,
                'authenticated: delete evidence source (deletion trigger)');
select is((select count(*)::int from public.evidence_links where source_deleted_at is not null), 1, 'link marked deleted');
reset role;

-- service_role: sweep, claim_due.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$select public.sweep_stalled_ai_jobs(now() + interval '1 minute')$$, 'service_role: sweep_stalled_ai_jobs');
select results_eq($$select id::text from public.claim_due_ai_jobs(now(), 10)$$,
                  $$values ('aaaaaaaa-7777-0000-0000-000000000003')$$, 'service_role: claim_due_ai_jobs');
reset role;
select is((select status from public.ai_jobs where id = 'aaaaaaaa-7777-0000-0000-000000000002'), 'failed', 'swept');

select * from finish();
rollback;
