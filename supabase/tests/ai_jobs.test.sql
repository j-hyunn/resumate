-- S3 ai_jobs: RLS, app_ai_writer limits, status transition guard, error_category,
-- request_ai_job_cancel, sweep_stalled_ai_jobs.
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

-- app_ai_writer as A creates jobs.
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';

select lives_ok($$insert into public.ai_jobs (id, job_type, target_type, target_id, params)
                  values ('a1000000-0000-0000-0000-000000000001', 'insight', 'insight', gen_random_uuid(), '{"k":1}')$$,
                'app_ai_writer inserts a job (user_id defaults to JWT sub)');
select is((select user_id from public.ai_jobs where id = 'a1000000-0000-0000-0000-000000000001'),
          'a0000000-0000-0000-0000-000000000001'::uuid, 'user_id default = JWT sub');
select is((select status from public.ai_jobs where id = 'a1000000-0000-0000-0000-000000000001'), 'queued', 'default queued');
select throws_ok($$insert into public.ai_jobs (job_type, user_id) values ('insight', 'b0000000-0000-0000-0000-000000000002')$$,
                 '42501', null, 'app_ai_writer cannot insert a job for another user');
select throws_ok($$insert into public.ai_jobs (job_type, cancel_requested_at) values ('insight', now())$$,
                 '42501', null, 'app_ai_writer cannot set cancel_requested_at');
select throws_ok($$insert into public.ai_jobs (job_type, target_type) values ('writing_chat_turn', 'insight')$$,
                 '23514', null, 'writing_chat_turn must target writing_chat');
select throws_ok($$insert into public.ai_jobs (job_type) values ('follow_up_question')$$,
                 '23514', null, 'job_type CHECK');
select lives_ok($$insert into public.ai_jobs (id, job_type, target_type) values
                  ('a1000000-0000-0000-0000-000000000002', 'writing_chat_turn', 'writing_chat')$$,
                'writing_chat_turn job');

-- Claim + progress + step checkpoint (all granted columns).
select lives_ok($$update public.ai_jobs
                     set status = 'running', heartbeat_at = now(), attempt_count = 1,
                         progress = '{"stage":"match","done":0,"total":3}', step_outputs = '{"match":{"ok":true}}'
                   where id = 'a1000000-0000-0000-0000-000000000001' and status = 'queued'$$,
                'claim job with conditional update');
select isnt((select started_at from public.ai_jobs where id = 'a1000000-0000-0000-0000-000000000001'), null,
            'started_at stamped on running');
select throws_ok($$update public.ai_jobs set cancel_requested_at = now() where id = 'a1000000-0000-0000-0000-000000000001'$$,
                 '42501', null, 'app_ai_writer cannot update cancel_requested_at');
select throws_ok($$update public.ai_jobs set params = '{}' where id = 'a1000000-0000-0000-0000-000000000001'$$,
                 '42501', null, 'app_ai_writer cannot update params');
select throws_ok($$delete from public.ai_jobs where id = 'a1000000-0000-0000-0000-000000000001'$$,
                 '42501', null, 'app_ai_writer cannot delete jobs');

-- error_category
select lives_ok($$update public.ai_jobs set status = 'failed', error_code = 'rate_limited'
                   where id = 'a1000000-0000-0000-0000-000000000002'$$, 'fail a job');
select is((select error_category from public.ai_jobs where id = 'a1000000-0000-0000-0000-000000000002'), 'transient',
          'rate_limited -> transient');
select isnt((select finished_at from public.ai_jobs where id = 'a1000000-0000-0000-0000-000000000002'), null,
            'finished_at stamped on terminal status');

-- Guard: failed -> succeeded refused, failed -> queued allowed (clears error).
select throws_ok($$update public.ai_jobs set status = 'succeeded' where id = 'a1000000-0000-0000-0000-000000000002'$$,
                 'P0001', 'invalid_ai_job_transition', 'failed -> succeeded refused');
select throws_ok($$update public.ai_jobs set status = 'running' where id = 'a1000000-0000-0000-0000-000000000002'$$,
                 'P0001', 'invalid_ai_job_transition', 'failed -> running refused');
select lives_ok($$update public.ai_jobs set status = 'queued', attempt_count = 2 where id = 'a1000000-0000-0000-0000-000000000002'$$,
                'failed -> queued (retry)');
select results_eq($$select error_code, error_category, finished_at from public.ai_jobs where id = 'a1000000-0000-0000-0000-000000000002'$$,
                  $$values (null::text, null::text, null::timestamptz)$$, 'retry clears error_code / finished_at');
select lives_ok($$update public.ai_jobs set status = 'succeeded', output = '{"x":1}' where id = 'a1000000-0000-0000-0000-000000000001'$$,
                'running -> succeeded');
select lives_ok($$update public.ai_jobs set usage = '{"input_tokens":1}' where id = 'a1000000-0000-0000-0000-000000000001'$$,
                'non-status update on a succeeded job is allowed');
select throws_ok($$update public.ai_jobs set status = 'failed' where id = 'a1000000-0000-0000-0000-000000000001'$$,
                 'P0001', 'invalid_ai_job_transition', 'succeeded is terminal');
select throws_ok($$update public.ai_jobs set error_code = 'oops' where id = 'a1000000-0000-0000-0000-000000000001'$$,
                 '23514', null, 'error_code CHECK');

-- B (app_ai_writer) sees nothing of A.
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"app_ai_writer"}';
select is((select count(*)::int from public.ai_jobs), 0, 'app_ai_writer B sees no A jobs');
update public.ai_jobs set progress = '{}' where id = 'a1000000-0000-0000-0000-000000000002';
reset role;
select is((select progress from public.ai_jobs where id = 'a1000000-0000-0000-0000-000000000002'), null,
          'app_ai_writer B update of A job affects nothing');

-- authenticated: select own only, no writes.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.ai_jobs), 2, 'A sees own jobs');
select lives_ok($$select id, status, progress, error_code, error_category, output, usage, cancel_requested_at from public.ai_jobs$$,
                'user reads status columns');
select throws_ok($$select step_outputs from public.ai_jobs$$, '42501', null, 'user cannot read step_outputs (QA-S3-08)');
select throws_ok($$select params from public.ai_jobs$$, '42501', null, 'user cannot read params (QA-S3-08)');
select throws_ok($$select * from public.ai_jobs$$, '42501', null, 'user select * is refused (explicit columns only)');
select throws_ok($$insert into public.ai_jobs (job_type) values ('insight')$$, '42501', null, 'user cannot insert jobs');
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
reset role;

-- QA-S3-09: retry after a cancel request clears it.
update public.ai_jobs set status = 'failed', error_code = 'model_unavailable' where id = 'a1000000-0000-0000-0000-000000000002';
update public.ai_jobs set status = 'queued', attempt_count = 3 where id = 'a1000000-0000-0000-0000-000000000002';
select is((select cancel_requested_at from public.ai_jobs where id = 'a1000000-0000-0000-0000-000000000002'), null,
          'failed -> queued clears cancel_requested_at');
-- QA-S3-05: attempt_count never decreases.
select throws_ok($$update public.ai_jobs set attempt_count = 2 where id = 'a1000000-0000-0000-0000-000000000002'$$,
                 'P0001', 'invalid_ai_job_transition', 'attempt_count cannot decrease');
select lives_ok($$update public.ai_jobs set attempt_count = 3 where id = 'a1000000-0000-0000-0000-000000000002'$$,
                'same attempt_count is fine');

-- QA-S3-03: one in-flight job per same input.
insert into public.ai_jobs (id, user_id, job_type, input_hash, status) values
  ('a1000000-0000-0000-0000-000000000020', 'a0000000-0000-0000-0000-000000000001', 'insight', 'h1', 'running');
select throws_ok($$insert into public.ai_jobs (user_id, job_type, input_hash) values
                   ('a0000000-0000-0000-0000-000000000001', 'insight', 'h1')$$,
                 '23505', null, 'second in-flight job with the same input refused');
select lives_ok($$insert into public.ai_jobs (user_id, job_type, input_hash, application_project_id) values
                  ('a0000000-0000-0000-0000-000000000001', 'insight', 'h1', gen_random_uuid())$$,
                'same hash in another application project is allowed');
select lives_ok($$insert into public.ai_jobs (user_id, job_type, input_hash) values
                  ('b0000000-0000-0000-0000-000000000002', 'insight', 'h1')$$, 'other user is allowed');
select lives_ok($$insert into public.ai_jobs (user_id, job_type) values
                  ('a0000000-0000-0000-0000-000000000001', 'insight'), ('a0000000-0000-0000-0000-000000000001', 'insight')$$,
                'null input_hash is not constrained');
update public.ai_jobs set status = 'succeeded' where id = 'a1000000-0000-0000-0000-000000000020';
select lives_ok($$insert into public.ai_jobs (id, user_id, job_type, input_hash) values
                  ('a1000000-0000-0000-0000-000000000021', 'a0000000-0000-0000-0000-000000000001', 'insight', 'h1')$$,
                'after the first finishes, a new in-flight job is allowed');

select ok(not has_function_privilege('app_ai_writer', 'public.request_ai_job_cancel(uuid)', 'execute'),
          'app_ai_writer cannot request cancel');
select ok(not has_function_privilege('anon', 'public.request_ai_job_cancel(uuid)', 'execute'), 'anon cannot request cancel');
select ok(not has_function_privilege('app_ai_writer', 'public.sweep_stalled_ai_jobs(timestamptz)', 'execute'),
          'app_ai_writer cannot sweep');

-- sweep_stalled_ai_jobs (service_role, all users)
insert into public.ai_jobs (id, user_id, job_type, status, heartbeat_at, created_at) values
  ('a1000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000001', 'insight', 'running', now() - interval '10 minutes', now() - interval '20 minutes'),
  ('b1000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000002', 'insight', 'queued', null, now() - interval '10 minutes'),
  ('a1000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000001', 'insight', 'running', now(), now() - interval '20 minutes');
insert into public.usage_events (id, user_id, feature, period_month, status, ai_job_id, created_at) values
  ('a2000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000001', 'insight', private.current_usage_period(), 'reserved', 'a1000000-0000-0000-0000-000000000010', now() - interval '20 minutes'),
  ('b2000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000002', 'insight', private.current_usage_period(), 'reserved', 'b1000000-0000-0000-0000-000000000011', now() - interval '10 minutes'),
  ('a2000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000001', 'insight', private.current_usage_period(), 'reserved', 'a1000000-0000-0000-0000-000000000012', now() - interval '20 minutes'),
  -- leaked: job row never inserted
  ('a2000000-0000-0000-0000-000000000013', 'a0000000-0000-0000-0000-000000000001', 'insight', private.current_usage_period(), 'reserved', 'a1000000-0000-0000-0000-0000000000ff', now() - interval '20 minutes'),
  -- recent reservation without job row yet: kept
  ('a2000000-0000-0000-0000-000000000014', 'a0000000-0000-0000-0000-000000000001', 'insight', private.current_usage_period(), 'reserved', 'a1000000-0000-0000-0000-0000000000fe', now()),
  -- already charged on a stalled job's sibling: untouched
  ('a2000000-0000-0000-0000-000000000015', 'a0000000-0000-0000-0000-000000000001', 'insight', private.current_usage_period(), 'charged', 'a1000000-0000-0000-0000-000000000010', now() - interval '20 minutes');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.sweep_stalled_ai_jobs(now() - interval '2 minutes'), 2, 'sweep fails 2 stalled jobs (both users)');
reset role;
select results_eq(
  $$select id::text, status, error_code, error_category, finished_at is not null
      from public.ai_jobs where id in ('a1000000-0000-0000-0000-000000000010', 'b1000000-0000-0000-0000-000000000011',
                                       'a1000000-0000-0000-0000-000000000012') order by id$$,
  $$values ('a1000000-0000-0000-0000-000000000010', 'failed', 'stalled', 'timeout', true),
           ('a1000000-0000-0000-0000-000000000012', 'running', null, null, false),
           ('b1000000-0000-0000-0000-000000000011', 'failed', 'stalled', 'timeout', true)$$,
  'stalled running/queued jobs failed; fresh heartbeat kept');
select results_eq(
  $$select id::text, status from public.usage_events where id::text like '_2000000-0000-0000-0000-0000000000__' order by id$$,
  $$values ('a2000000-0000-0000-0000-000000000010', 'released'),
           ('a2000000-0000-0000-0000-000000000012', 'reserved'),
           ('a2000000-0000-0000-0000-000000000013', 'released'),
           ('a2000000-0000-0000-0000-000000000014', 'reserved'),
           ('a2000000-0000-0000-0000-000000000015', 'charged'),
           ('b2000000-0000-0000-0000-000000000011', 'released')$$,
  'sweep releases reserved usage of swept jobs and leaked reservations only');
set local role service_role;
select is(public.sweep_stalled_ai_jobs(now() - interval '2 minutes'), 0, 'second sweep is a no-op');
select throws_ok($$select public.sweep_stalled_ai_jobs(null)$$, 'P0001', 'invalid_stalled_before', 'null threshold');
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
