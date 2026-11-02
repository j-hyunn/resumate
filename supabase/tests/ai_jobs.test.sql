-- ai_jobs (S3 + S3a v4): RLS, app_ai_writer limits, v4 columns / CHECKs, error_category + failure_cause
-- (AI C-11.1), status transition guard + run_generation, in-flight per target (D-34),
-- request_ai_job_cancel, sweep_stalled_ai_jobs v4, claim_due_ai_jobs (B-4).
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer, service_role;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

select ok((select relrowsecurity from pg_class where oid = 'public.ai_jobs'::regclass), 'ai_jobs has RLS');
select policies_are('public', 'ai_jobs',
  array['ai_jobs_select_own', 'ai_jobs_select_ai_writer', 'ai_jobs_insert_ai_writer', 'ai_jobs_update_ai_writer']);
select hasnt_column('public', 'ai_jobs', 'attempt_count', 'attempt_count renamed');
select has_column('public', 'ai_jobs', 'run_generation', 'run_generation (internal run generation)');
select col_type_is('public', 'ai_jobs', 'run_generation', 'integer', 'run_generation is integer');
select columns_are('public', 'ai_jobs', array[
  'id', 'user_id', 'job_type', 'application_project_id', 'target_type', 'target_id', 'status', 'progress', 'params',
  'step_outputs', 'run_generation', 'error_code', 'error_category', 'input_hash', 'prompt_version', 'model', 'usage',
  'output', 'heartbeat_at', 'cancel_requested_at', 'started_at', 'finished_at', 'created_at', 'updated_at',
  'provider', 'model_tier', 'connection_tier', 'retry_count', 'next_run_at', 'retry_wait_total_ms', 'quota_resets_at',
  'retry_after', 'failure_cause'], 'ai_jobs v4 columns');
select col_default_is('public', 'ai_jobs', 'retry_count', '0', 'retry_count default 0');
select col_default_is('public', 'ai_jobs', 'retry_wait_total_ms', '0', 'retry_wait_total_ms default 0');
select col_hasnt_default('public', 'ai_jobs', 'provider', 'provider has no default');
select col_hasnt_default('public', 'ai_jobs', 'model_tier', 'model_tier has no default');
select col_hasnt_default('public', 'ai_jobs', 'connection_tier', 'connection_tier has no default');
select has_index('public', 'ai_jobs', 'ai_jobs_in_flight_target_key', 'in-flight per target index');
select hasnt_index('public', 'ai_jobs', 'ai_jobs_in_flight_input_key', 'S3 per-input key dropped');
select has_index('public', 'ai_jobs', 'ai_jobs_reuse_idx',
  array['user_id', 'application_project_id', 'job_type', 'provider', 'input_hash'], 'reuse index includes provider');
select has_index('public', 'ai_jobs', 'ai_jobs_due_idx', 'due index');

-- app_ai_writer as A creates jobs.
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';

select lives_ok($$insert into public.ai_jobs (id, job_type, target_type, target_id, params, provider, model_tier, connection_tier)
                  values ('a1000000-0000-0000-0000-000000000001', 'insight', 'application_project', gen_random_uuid(),
                          '{"k":1}', 'gemini', 'default', 'free')$$,
                'app_ai_writer inserts a job (user_id defaults to JWT sub)');
select results_eq($$select user_id, status, provider, model_tier, connection_tier, retry_count, retry_wait_total_ms, run_generation
                      from public.ai_jobs where id = 'a1000000-0000-0000-0000-000000000001'$$,
                  $$values ('a0000000-0000-0000-0000-000000000001'::uuid, 'queued'::text, 'gemini'::text, 'default'::text,
                            'free'::text, 0, 0, 0)$$,
                  'defaults: JWT sub, queued, counters 0');
select throws_ok($$insert into public.ai_jobs (job_type, model_tier, connection_tier) values ('insight', 'default', 'paid')$$,
                 '23502', null, 'provider is required');
select throws_ok($$insert into public.ai_jobs (job_type, provider, connection_tier) values ('insight', 'openai', 'paid')$$,
                 '23502', null, 'model_tier is required');
select throws_ok($$insert into public.ai_jobs (job_type, provider, model_tier) values ('insight', 'openai', 'light')$$,
                 '23502', null, 'connection_tier is required');
select throws_ok($$insert into public.ai_jobs (job_type, provider, model_tier, connection_tier) values ('insight', 'mistral', 'light', 'paid')$$,
                 '23514', null, 'provider CHECK');
select throws_ok($$insert into public.ai_jobs (job_type, provider, model_tier, connection_tier) values ('insight', 'openai', 'mini', 'paid')$$,
                 '23514', null, 'model_tier CHECK');
select throws_ok($$insert into public.ai_jobs (job_type, provider, model_tier, connection_tier) values ('insight', 'openai', 'light', 'pro')$$,
                 '23514', null, 'connection_tier CHECK');
select throws_ok($$insert into public.ai_jobs (job_type, provider, model_tier, connection_tier, retry_count) values ('insight', 'openai', 'light', 'paid', -1)$$,
                 '23514', null, 'retry_count >= 0');
select throws_ok($$insert into public.ai_jobs (job_type, provider, model_tier, connection_tier, retry_wait_total_ms) values ('insight', 'openai', 'light', 'paid', -1)$$,
                 '23514', null, 'retry_wait_total_ms >= 0');
select lives_ok($$insert into public.ai_jobs (job_type, target_type, provider, model_tier, connection_tier)
                  values ('key_verification', 'ai_provider_key', 'openai', 'light', 'paid')$$,
                'job_type key_verification (v4)');
select throws_ok($$insert into public.ai_jobs (job_type, user_id, provider, model_tier, connection_tier)
                   values ('insight', 'b0000000-0000-0000-0000-000000000002', 'openai', 'light', 'paid')$$,
                 '42501', null, 'app_ai_writer cannot insert a job for another user');
select throws_ok($$insert into public.ai_jobs (job_type, cancel_requested_at, provider, model_tier, connection_tier)
                   values ('insight', now(), 'openai', 'light', 'paid')$$,
                 '42501', null, 'app_ai_writer cannot set cancel_requested_at');
select throws_ok($$insert into public.ai_jobs (job_type, target_type, provider, model_tier, connection_tier)
                   values ('writing_chat_turn', 'insight', 'openai', 'light', 'paid')$$,
                 '23514', null, 'writing_chat_turn must target writing_chat');
select throws_ok($$insert into public.ai_jobs (job_type, provider, model_tier, connection_tier) values ('follow_up_question', 'openai', 'light', 'paid')$$,
                 '23514', null, 'job_type CHECK');
select lives_ok($$insert into public.ai_jobs (id, job_type, target_type, target_id, provider, model_tier, connection_tier) values
                  ('a1000000-0000-0000-0000-000000000002', 'writing_chat_turn', 'writing_chat', gen_random_uuid(),
                   'anthropic', 'default', 'paid')$$,
                'writing_chat_turn job');

-- Claim + progress + step checkpoint + retry scheduling columns (all granted).
select lives_ok($$update public.ai_jobs
                     set status = 'running', heartbeat_at = now(), run_generation = 1,
                         progress = '{"stage":"match","done":0,"total":3}', step_outputs = '{"match":{"ok":true}}'
                   where id = 'a1000000-0000-0000-0000-000000000001' and status = 'queued'$$,
                'claim job with conditional update');
select isnt((select started_at from public.ai_jobs where id = 'a1000000-0000-0000-0000-000000000001'), null,
            'started_at stamped on running');
select lives_ok($$update public.ai_jobs
                     set status = 'queued', run_generation = 2, retry_count = 1, retry_wait_total_ms = 2500,
                         next_run_at = now() + interval '3 seconds',
                         progress = '{"stage":"match","done":0,"total":3,"waiting_retry_until":"2026-10-28T00:00:03Z"}'
                   where id = 'a1000000-0000-0000-0000-000000000001'$$,
                'retry scheduling: running -> queued + next_run_at + counters + waiting_retry_until');
select lives_ok($$update public.ai_jobs set status = 'running', next_run_at = null
                   where id = 'a1000000-0000-0000-0000-000000000001' and status = 'queued' and run_generation = 2$$,
                'woken job claimed again');
select throws_ok($$update public.ai_jobs set provider = 'openai' where id = 'a1000000-0000-0000-0000-000000000001'$$,
                 '42501', null, 'provider is fixed (no update grant)');
select throws_ok($$update public.ai_jobs set model_tier = 'heavy' where id = 'a1000000-0000-0000-0000-000000000001'$$,
                 '42501', null, 'model_tier is fixed');
select throws_ok($$update public.ai_jobs set connection_tier = 'paid' where id = 'a1000000-0000-0000-0000-000000000001'$$,
                 '42501', null, 'connection_tier is fixed');
select throws_ok($$update public.ai_jobs set cancel_requested_at = now() where id = 'a1000000-0000-0000-0000-000000000001'$$,
                 '42501', null, 'app_ai_writer cannot update cancel_requested_at');
select throws_ok($$update public.ai_jobs set params = '{}' where id = 'a1000000-0000-0000-0000-000000000001'$$,
                 '42501', null, 'app_ai_writer cannot update params');
select throws_ok($$delete from public.ai_jobs where id = 'a1000000-0000-0000-0000-000000000001'$$,
                 '42501', null, 'app_ai_writer cannot delete jobs');

-- Final failure with retry_after / quota_resets_at.
select lives_ok($$update public.ai_jobs set status = 'failed', error_code = 'rate_limited', retry_count = 4,
                         retry_after = now() + interval '1 minute'
                   where id = 'a1000000-0000-0000-0000-000000000002'$$, 'fail a job (rate_limited)');
select results_eq($$select error_category, failure_cause, finished_at is not null, retry_after is not null
                      from public.ai_jobs where id = 'a1000000-0000-0000-0000-000000000002'$$,
                  $$values ('provider_limit'::text, 'rate_limited'::text, true, true)$$,
                  'rate_limited -> provider_limit / rate_limited, finished_at stamped');

-- Guard: failed -> succeeded / running refused; failed -> queued clears final-failure fields.
select throws_ok($$update public.ai_jobs set status = 'succeeded' where id = 'a1000000-0000-0000-0000-000000000002'$$,
                 'P0001', 'invalid_ai_job_transition', 'failed -> succeeded refused');
select throws_ok($$update public.ai_jobs set status = 'running' where id = 'a1000000-0000-0000-0000-000000000002'$$,
                 'P0001', 'invalid_ai_job_transition', 'failed -> running refused');
select lives_ok($$update public.ai_jobs set status = 'queued', run_generation = 2 where id = 'a1000000-0000-0000-0000-000000000002'$$,
                'failed -> queued (manual retry)');
select results_eq($$select error_code, error_category, failure_cause, finished_at, retry_after, quota_resets_at, retry_count
                      from public.ai_jobs where id = 'a1000000-0000-0000-0000-000000000002'$$,
                  $$values (null::text, null::text, null::text, null::timestamptz, null::timestamptz, null::timestamptz, 4)$$,
                  'retry clears error_code / finished_at / retry_after / quota_resets_at; retry_count kept');
select lives_ok($$update public.ai_jobs set status = 'succeeded', output = '{"x":1}' where id = 'a1000000-0000-0000-0000-000000000001'$$,
                'running -> succeeded');
select lives_ok($$update public.ai_jobs set usage = '{"input_tokens":1}' where id = 'a1000000-0000-0000-0000-000000000001'$$,
                'non-status update on a succeeded job is allowed');
select throws_ok($$update public.ai_jobs set status = 'failed' where id = 'a1000000-0000-0000-0000-000000000001'$$,
                 'P0001', 'invalid_ai_job_transition', 'succeeded is terminal');
select throws_ok($$update public.ai_jobs set error_code = 'oops' where id = 'a1000000-0000-0000-0000-000000000001'$$,
                 '23514', null, 'error_code CHECK');
select throws_ok($$update public.ai_jobs set error_code = 'model_unavailable' where id = 'a1000000-0000-0000-0000-000000000001'$$,
                 '23514', null, 'v3 model_unavailable is gone');
select throws_ok($$update public.ai_jobs set error_code = 'refused' where id = 'a1000000-0000-0000-0000-000000000001'$$,
                 '23514', null, 'v3 refused is gone');
-- run_generation never decreases.
select throws_ok($$update public.ai_jobs set run_generation = 1 where id = 'a1000000-0000-0000-0000-000000000002'$$,
                 'P0001', 'invalid_ai_job_transition', 'run_generation cannot decrease');
select lives_ok($$update public.ai_jobs set run_generation = 2 where id = 'a1000000-0000-0000-0000-000000000002'$$,
                'same run_generation is fine');

-- B (app_ai_writer) sees nothing of A.
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"app_ai_writer"}';
select is((select count(*)::int from public.ai_jobs), 0, 'app_ai_writer B sees no A jobs');
update public.ai_jobs set progress = '{}' where id = 'a1000000-0000-0000-0000-000000000002';
reset role;
select isnt((select progress from public.ai_jobs where id = 'a1000000-0000-0000-0000-000000000002'), '{}'::jsonb,
            'app_ai_writer B update of A job affects nothing');

-- error_code -> error_category / failure_cause (AI C-11.1), every v4 code.
create temp table t_codes (code text, category text, cause text);
insert into t_codes values
  ('rate_limited', 'provider_limit', 'rate_limited'),
  ('daily_quota_exhausted', 'provider_limit', 'daily_quota_exhausted'),
  ('billing_required', 'user_account', 'billing_required'),
  ('key_invalid', 'user_account', 'key_invalid'),
  ('key_missing', 'user_account', null),
  ('model_not_available', 'user_account', 'model_not_available'),
  ('provider_unavailable', 'transient', 'provider_unavailable'),
  ('input_too_long', 'input', 'input_rejected'),
  ('safety_blocked', 'input', 'input_rejected'),
  ('insufficient_data', 'input', null),
  ('not_a_jd', 'input', null),
  ('schema_invalid', 'system', null),
  ('timeout', 'system', null),
  ('stalled', 'system', null),
  ('canceled', 'system', null);
insert into public.ai_jobs (user_id, job_type, status, error_code, input_hash, provider, model_tier, connection_tier)
  select 'b0000000-0000-0000-0000-000000000002', 'insight', 'failed', code, 'code:' || code, 'openai', 'default', 'paid'
    from t_codes;
select set_eq($$select error_code, error_category, failure_cause from public.ai_jobs where input_hash like 'code:%'$$,
              $$select code, category, cause from t_codes$$,
              'error_category / failure_cause follow C-11.1 for all 15 codes');
delete from public.ai_jobs where input_hash like 'code:%';

-- authenticated: select own only (incl. v4 columns), no writes.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.ai_jobs), 3, 'A sees own jobs');
select lives_ok($$select id, status, progress, error_code, error_category, failure_cause, provider, model_tier, connection_tier,
                         retry_count, next_run_at, retry_wait_total_ms, quota_resets_at, retry_after, output, usage,
                         cancel_requested_at from public.ai_jobs$$,
                'user reads status + v4 columns');
select throws_ok($$select step_outputs from public.ai_jobs$$, '42501', null, 'user cannot read step_outputs (QA-S3-08)');
select throws_ok($$select params from public.ai_jobs$$, '42501', null, 'user cannot read params (QA-S3-08)');
select throws_ok($$select * from public.ai_jobs$$, '42501', null, 'user select * is refused (explicit columns only)');
select throws_ok($$insert into public.ai_jobs (job_type, provider, model_tier, connection_tier) values ('insight', 'openai', 'light', 'paid')$$,
                 '42501', null, 'user cannot insert jobs');
select throws_ok($$update public.ai_jobs set status = 'canceled'$$, '42501', null, 'user cannot update jobs');
select throws_ok($$delete from public.ai_jobs$$, '42501', null, 'user cannot delete jobs');

-- request_ai_job_cancel
select is(public.request_ai_job_cancel('a1000000-0000-0000-0000-000000000002') ->> 'status', 'queued',
          'cancel request returns status');
reset role;
select isnt((select cancel_requested_at from public.ai_jobs where id = 'a1000000-0000-0000-0000-000000000002'), null,
            'cancel_requested_at set');
create temp table t_cancel as select cancel_requested_at from public.ai_jobs where id = 'a1000000-0000-0000-0000-000000000002';
grant select on t_cancel to authenticated;
set local role authenticated;
select is((public.request_ai_job_cancel('a1000000-0000-0000-0000-000000000002') ->> 'cancel_requested_at')::timestamptz,
          (select cancel_requested_at from t_cancel), 'second cancel request keeps the first timestamp');
select is(public.request_ai_job_cancel('a1000000-0000-0000-0000-000000000001'),
          jsonb_build_object('job_id', 'a1000000-0000-0000-0000-000000000001'::uuid, 'status', 'succeeded',
                             'cancel_requested_at', null),
          'cancel on a terminal job is a no-op');
select throws_ok($$select public.request_ai_job_cancel(gen_random_uuid())$$, 'P0001', 'ai_job_not_found', 'unknown job');
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.ai_jobs), 0, 'B sees no A jobs');
select throws_ok($$select public.request_ai_job_cancel('a1000000-0000-0000-0000-000000000002')$$,
                 'P0001', 'ai_job_not_found', 'B cannot cancel A job');
set local request.jwt.claims = '{"role":"authenticated"}';
select throws_ok($$select public.request_ai_job_cancel('a1000000-0000-0000-0000-000000000002')$$,
                 '42501', 'not_authenticated', 'no sub');
select throws_ok($$select public.sweep_stalled_ai_jobs(now())$$, '42501', null, 'authenticated cannot sweep');
select throws_ok($$select * from public.claim_due_ai_jobs(now(), 10)$$, '42501', null, 'authenticated cannot claim due jobs');
reset role;

-- QA-S3-09: retry after a cancel request clears it.
update public.ai_jobs set status = 'failed', error_code = 'provider_unavailable' where id = 'a1000000-0000-0000-0000-000000000002';
update public.ai_jobs set status = 'queued', run_generation = 3 where id = 'a1000000-0000-0000-0000-000000000002';
select is((select cancel_requested_at from public.ai_jobs where id = 'a1000000-0000-0000-0000-000000000002'), null,
          'failed -> queued clears cancel_requested_at');

-- D-34: one in-flight job per (user, job_type, target).
create temp table t_target (id uuid);
insert into t_target values (gen_random_uuid());
insert into public.ai_jobs (id, user_id, job_type, target_type, target_id, status, input_hash, provider, model_tier, connection_tier)
  select 'a1000000-0000-0000-0000-000000000020', 'a0000000-0000-0000-0000-000000000001', 'insight', 'application_project',
         id, 'running', 'h1', 'openai', 'default', 'paid' from t_target;
select throws_ok($$insert into public.ai_jobs (user_id, job_type, target_type, target_id, input_hash, provider, model_tier, connection_tier)
                   select 'a0000000-0000-0000-0000-000000000001', 'insight', 'application_project', id, 'h2', 'openai', 'default', 'paid'
                     from t_target$$,
                 '23505', null, 'second in-flight job on the same target refused (even with another input)');
select lives_ok($$insert into public.ai_jobs (user_id, job_type, target_type, target_id, provider, model_tier, connection_tier)
                  select 'a0000000-0000-0000-0000-000000000001', 'cover_letter', 'application_project', id, 'openai', 'default', 'paid'
                    from t_target$$,
                'another job_type on the same target is allowed');
select lives_ok($$insert into public.ai_jobs (user_id, job_type, target_type, target_id, input_hash, provider, model_tier, connection_tier)
                  values ('a0000000-0000-0000-0000-000000000001', 'insight', 'application_project', gen_random_uuid(), 'h1',
                          'openai', 'default', 'paid')$$,
                'same input on another target is allowed');
select lives_ok($$insert into public.ai_jobs (user_id, job_type, target_type, target_id, provider, model_tier, connection_tier)
                  select 'b0000000-0000-0000-0000-000000000002', 'insight', 'application_project', id, 'openai', 'default', 'paid'
                    from t_target$$, 'other user is allowed');
select lives_ok($$insert into public.ai_jobs (user_id, job_type, provider, model_tier, connection_tier) values
                  ('a0000000-0000-0000-0000-000000000001', 'insight', 'openai', 'default', 'paid'),
                  ('a0000000-0000-0000-0000-000000000001', 'insight', 'openai', 'default', 'paid')$$,
                'null target is not constrained');
update public.ai_jobs set status = 'succeeded' where id = 'a1000000-0000-0000-0000-000000000020';
select lives_ok($$insert into public.ai_jobs (id, user_id, job_type, target_type, target_id, provider, model_tier, connection_tier)
                  select 'a1000000-0000-0000-0000-000000000021', 'a0000000-0000-0000-0000-000000000001', 'insight',
                         'application_project', id, 'openai', 'default', 'paid' from t_target$$,
                'after the first finishes, a new in-flight job on the target is allowed');
-- Manual retry (failed -> queued) of an old job while another job on the target is in flight: 23505 (QA-S3-12 path).
insert into public.ai_jobs (id, user_id, job_type, target_type, target_id, status, error_code, provider, model_tier, connection_tier)
  select 'a1000000-0000-0000-0000-000000000022', 'a0000000-0000-0000-0000-000000000001', 'insight', 'application_project',
         id, 'failed', 'timeout', 'openai', 'default', 'paid' from t_target;
select throws_ok($$update public.ai_jobs set status = 'queued' where id = 'a1000000-0000-0000-0000-000000000022'$$,
                 '23505', null, 'retry conflicts with the in-flight job on the same target');

select ok(not has_function_privilege('app_ai_writer', 'public.request_ai_job_cancel(uuid)', 'execute'),
          'app_ai_writer cannot request cancel');
select ok(not has_function_privilege('anon', 'public.request_ai_job_cancel(uuid)', 'execute'), 'anon cannot request cancel');
select ok(not has_function_privilege('app_ai_writer', 'public.sweep_stalled_ai_jobs(timestamptz)', 'execute'),
          'app_ai_writer cannot sweep');
select ok(not has_function_privilege('app_ai_writer', 'public.claim_due_ai_jobs(timestamptz, integer)', 'execute'),
          'app_ai_writer cannot claim due jobs');
select ok(not has_function_privilege('anon', 'public.claim_due_ai_jobs(timestamptz, integer)', 'execute'),
          'anon cannot claim due jobs');
select ok(has_function_privilege('service_role', 'public.claim_due_ai_jobs(timestamptz, integer)', 'execute'),
          'service_role can claim due jobs');

-- sweep_stalled_ai_jobs v4 + claim_due_ai_jobs (service_role, all users).
delete from public.ai_jobs where status in ('queued', 'running');
insert into public.ai_jobs (id, user_id, job_type, status, heartbeat_at, created_at, next_run_at, provider, model_tier, connection_tier) values
  -- running, stale heartbeat: swept
  ('a1000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000001', 'insight', 'running', now() - interval '10 minutes', now() - interval '20 minutes', null, 'openai', 'default', 'paid'),
  -- queued without schedule, old: swept
  ('b1000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000002', 'insight', 'queued', null, now() - interval '10 minutes', null, 'gemini', 'default', 'free'),
  -- running, fresh heartbeat: kept
  ('a1000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000001', 'insight', 'running', now(), now() - interval '20 minutes', null, 'openai', 'default', 'paid'),
  -- queued waiting for retry, due long ago (cron late): not swept, claimed
  ('a1000000-0000-0000-0000-000000000013', 'a0000000-0000-0000-0000-000000000001', 'cover_letter', 'queued', now() - interval '1 hour', now() - interval '2 hours', now() - interval '50 minutes', 'gemini', 'default', 'free'),
  -- queued, due now (B): claimed
  ('b1000000-0000-0000-0000-000000000014', 'b0000000-0000-0000-0000-000000000002', 'cover_letter', 'queued', now() - interval '10 minutes', now() - interval '20 minutes', now() - interval '1 second', 'openai', 'default', 'paid'),
  -- queued, not due yet: not swept, not claimed
  ('a1000000-0000-0000-0000-000000000015', 'a0000000-0000-0000-0000-000000000001', 'interview_questions', 'queued', now() - interval '10 minutes', now() - interval '20 minutes', now() + interval '1 minute', 'openai', 'light', 'paid');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.sweep_stalled_ai_jobs(now() - interval '2 minutes'), 2, 'sweep fails 2 stalled jobs (both users)');
reset role;
select results_eq(
  $$select id::text, status, error_code, error_category, finished_at is not null
      from public.ai_jobs where id::text like '_1000000-0000-0000-0000-00000000001_' order by id$$,
  $$values ('a1000000-0000-0000-0000-000000000010', 'failed', 'stalled', 'system', true),
           ('a1000000-0000-0000-0000-000000000012', 'running', null, null, false),
           ('a1000000-0000-0000-0000-000000000013', 'queued', null, null, false),
           ('a1000000-0000-0000-0000-000000000015', 'queued', null, null, false),
           ('b1000000-0000-0000-0000-000000000011', 'failed', 'stalled', 'system', true),
           ('b1000000-0000-0000-0000-000000000014', 'queued', null, null, false)$$,
  'stalled running / unscheduled queued failed; fresh heartbeat and scheduled queued kept');
set local role service_role;
select is(public.sweep_stalled_ai_jobs(now() - interval '2 minutes'), 0, 'second sweep is a no-op');
select throws_ok($$select public.sweep_stalled_ai_jobs(null)$$, 'P0001', 'invalid_stalled_before', 'null threshold');

select results_eq($$select id::text, user_id::text from public.claim_due_ai_jobs(now(), 10)$$,
                  $$values ('a1000000-0000-0000-0000-000000000013', 'a0000000-0000-0000-0000-000000000001'),
                           ('b1000000-0000-0000-0000-000000000014', 'b0000000-0000-0000-0000-000000000002')$$,
                  'claim_due returns due queued jobs of all users, oldest next_run_at first');
select results_eq($$select id::text from public.claim_due_ai_jobs(now(), 1)$$,
                  $$values ('a1000000-0000-0000-0000-000000000013')$$, 'claim_due respects the limit');
select results_eq($$select id::text from public.claim_due_ai_jobs(now() + interval '2 minutes', 10) order by 1$$,
                  $$values ('a1000000-0000-0000-0000-000000000013'), ('a1000000-0000-0000-0000-000000000015'),
                           ('b1000000-0000-0000-0000-000000000014')$$, 'claim_due uses p_now');
select is((select count(*)::int from public.ai_jobs where status = 'queued'), 3, 'claim_due changes nothing');
select throws_ok($$select * from public.claim_due_ai_jobs(null, 10)$$, 'P0001', 'invalid_now', 'null p_now');
select throws_ok($$select * from public.claim_due_ai_jobs(now(), 0)$$, 'P0001', 'invalid_limit', 'limit < 1');
select throws_ok($$select * from public.claim_due_ai_jobs(now(), null)$$, 'P0001', 'invalid_limit', 'null limit');
reset role;

-- Zombie runner after sweep.
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select throws_ok($$update public.ai_jobs set status = 'succeeded' where id = 'a1000000-0000-0000-0000-000000000010'$$,
                 'P0001', 'invalid_ai_job_transition', 'zombie runner cannot succeed a swept job');
reset role;

-- anon
set local role anon;
select throws_ok($$select * from public.ai_jobs$$, '42501', null, 'anon cannot read ai_jobs');
reset role;

-- account deletion cascades
delete from auth.users where id = 'a0000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.ai_jobs where user_id = 'a0000000-0000-0000-0000-000000000001'), 0,
          'ai_jobs cascade on account deletion');

select * from finish();
rollback;
