-- S3 usage ledger: usage_limits / usage_events RLS, reserve -> charge / release, limits,
-- idempotency, job-level settlement, serialization lock, get_usage_summary.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

select ok((select relrowsecurity from pg_class where oid = 'public.usage_events'::regclass), 'usage_events RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.usage_limits'::regclass), 'usage_limits RLS');
select policies_are('public', 'usage_events', array['usage_events_select_own', 'usage_events_select_ai_writer']);
select policies_are('public', 'usage_limits', array['usage_limits_select_all']);
select results_eq($$select feature, monthly_limit from public.usage_limits where plan = 'free' order by feature$$,
                  $$values ('draft', 20), ('insight', 10), ('interview_session', 5), ('writing_chat', 10)$$,
                  'A.16 initial free limits (no chat_message row)');
select is(private.current_usage_period(), date_trunc('month', now() at time zone 'Asia/Seoul')::date, 'KST month');

-- Privileges: ledger writers are app_ai_writer only.
select ok(not has_function_privilege('authenticated', 'public.reserve_usage(text, integer, text, uuid)', 'execute'), 'user cannot reserve');
select ok(not has_function_privilege('authenticated', 'public.charge_usage(uuid)', 'execute'), 'user cannot charge');
select ok(not has_function_privilege('authenticated', 'public.release_usage(uuid)', 'execute'), 'user cannot release');
select ok(not has_function_privilege('authenticated', 'public.charge_usage_for_job(uuid)', 'execute'), 'user cannot charge by job');
select ok(not has_function_privilege('authenticated', 'public.release_usage_for_job(uuid)', 'execute'), 'user cannot release by job');
select ok(not has_function_privilege('anon', 'public.get_usage_summary()', 'execute'), 'anon cannot read summary');
select ok(has_function_privilege('authenticated', 'public.get_usage_summary()', 'execute'), 'user can read summary');

set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';

-- No direct writes even for app_ai_writer.
select throws_ok($$insert into public.usage_events (feature, period_month) values ('insight', '2026-10-01')$$,
                 '42501', null, 'app_ai_writer cannot insert usage_events directly');
select throws_ok($$update public.usage_events set status = 'released'$$, '42501', null,
                 'app_ai_writer cannot update usage_events directly');
select throws_ok($$insert into public.usage_limits (feature, monthly_limit, effective_from) values ('insight', 99, now())$$,
                 '42501', null, 'app_ai_writer cannot write usage_limits');

-- reserve: validation
select throws_ok($$select public.reserve_usage('jd_extraction')$$, 'P0001', 'invalid_usage_feature', 'unknown feature');
select throws_ok($$select public.reserve_usage(null)$$, 'P0001', 'invalid_usage_feature', 'null feature');
select throws_ok($$select public.reserve_usage('insight', 0)$$, 'P0001', 'invalid_usage_units', 'units < 1');
select throws_ok($$select public.reserve_usage('insight', 1, 'free_lunch')$$, 'P0001', 'invalid_usage_reason', 'bad reason');
select throws_ok($$select public.reserve_usage('chat_message')$$, 'P0001', 'usage_limit_missing', 'no limit row');

-- reserve: happy path + lock
select lives_ok($$select public.reserve_usage('insight', 1, 'initial', 'a1000000-0000-0000-0000-000000000001')$$,
                'reserve insight');
select ok(exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and granted),
          'reserve holds a transaction advisory lock (serializes concurrent reservations)');
select results_eq($$select feature, units, status, reason, period_month, user_id
                      from public.usage_events where ai_job_id = 'a1000000-0000-0000-0000-000000000001'$$,
                  $$values ('insight'::text, 1, 'reserved'::text, 'initial'::text, private.current_usage_period(),
                            'a0000000-0000-0000-0000-000000000001'::uuid)$$,
                  'reserved row for the JWT user in the KST month');

-- limit: insight = 10 (reserved counts).
select lives_ok($$select public.reserve_usage('insight', 8)$$, 'reserve 8 more (9/10)');
select throws_ok($$select public.reserve_usage('insight', 2)$$, 'P0001', 'usage_limit_reached', 'over the limit by units');
select lives_ok($$select public.reserve_usage('insight', 1, 'explicit_regenerate', 'a1000000-0000-0000-0000-000000000002')$$,
                'exactly at the limit (10/10)');
select throws_ok($$select public.reserve_usage('insight')$$, 'P0001', 'usage_limit_reached', 'limit reached');
select is(public.get_usage_summary() -> 'insight', '{"limit":10,"used":10,"remaining":0}'::jsonb, 'summary at limit');

-- release frees capacity; charge keeps it used.
select lives_ok($$select public.release_usage((select id from public.usage_events where ai_job_id = 'a1000000-0000-0000-0000-000000000002'))$$,
                'release one');
select lives_ok($$select public.release_usage((select id from public.usage_events where ai_job_id = 'a1000000-0000-0000-0000-000000000002'))$$,
                'release again is idempotent');
select throws_ok($$select public.charge_usage((select id from public.usage_events where ai_job_id = 'a1000000-0000-0000-0000-000000000002'))$$,
                 'P0001', 'invalid_usage_transition', 'released -> charged refused');
select is(public.get_usage_summary() -> 'insight' ->> 'remaining', '1', 'released units no longer count');
select lives_ok($$select public.charge_usage((select id from public.usage_events where ai_job_id = 'a1000000-0000-0000-0000-000000000001'))$$,
                'charge one');
select lives_ok($$select public.charge_usage((select id from public.usage_events where ai_job_id = 'a1000000-0000-0000-0000-000000000001'))$$,
                'charge again is idempotent');
select throws_ok($$select public.release_usage((select id from public.usage_events where ai_job_id = 'a1000000-0000-0000-0000-000000000001'))$$,
                 'P0001', 'invalid_usage_transition', 'charged -> released refused');
select throws_ok($$select public.charge_usage(gen_random_uuid())$$, 'P0001', 'usage_event_not_found', 'unknown event');

-- Job-level settlement.
select lives_ok($$select public.reserve_usage('draft', 1, 'initial', 'a1000000-0000-0000-0000-000000000003')$$, 'draft q1');
select lives_ok($$select public.reserve_usage('draft', 1, 'initial', 'a1000000-0000-0000-0000-000000000003')$$, 'draft q2');
select lives_ok($$select public.reserve_usage('draft', 1, 'initial', 'a1000000-0000-0000-0000-000000000004')$$, 'draft other job');
select is(public.charge_usage_for_job('a1000000-0000-0000-0000-000000000003'), 2, 'charge_usage_for_job moves 2 rows');
select is(public.charge_usage_for_job('a1000000-0000-0000-0000-000000000003'), 0, 'charge_usage_for_job idempotent');
select is(public.release_usage_for_job('a1000000-0000-0000-0000-000000000003'), 0, 'release after charge moves nothing');
select is(public.release_usage_for_job('a1000000-0000-0000-0000-000000000004'), 1, 'release_usage_for_job');
select is(public.release_usage_for_job('a1000000-0000-0000-0000-000000000004'), 0, 'release_usage_for_job idempotent');
select is(public.release_usage_for_job(gen_random_uuid()), 0, 'unknown job -> 0');
select is(public.get_usage_summary() -> 'draft', '{"limit":20,"used":2,"remaining":18}'::jsonb, 'draft summary');
select is((select array_agg(k order by k) from jsonb_object_keys(public.get_usage_summary()) k),
          array['draft', 'insight', 'interview_session', 'writing_chat'], 'summary lists features with a limit');

-- B: isolation and own limit.
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"app_ai_writer"}';
select is((select count(*)::int from public.usage_events), 0, 'app_ai_writer B sees no A events');
select throws_ok($$select public.charge_usage((select id from public.usage_events limit 1))$$,
                 'P0001', 'usage_event_not_found', 'B sees nothing to charge');
reset role;
create temp table t_a_event as
  select id from public.usage_events where ai_job_id = 'a1000000-0000-0000-0000-000000000001';
grant select on t_a_event to app_ai_writer;
set local role app_ai_writer;
select throws_ok($$select public.release_usage((select id from t_a_event))$$,
                 'P0001', 'usage_event_not_found', 'B cannot settle A event by id');
select is(public.release_usage_for_job('a1000000-0000-0000-0000-000000000001'), 0, 'B cannot settle A job');
select is(public.get_usage_summary() -> 'insight', '{"limit":10,"used":0,"remaining":10}'::jsonb, 'B has its own quota');
select lives_ok($$select public.reserve_usage('insight', 10)$$, 'B can use its full quota');

-- No sub.
set local request.jwt.claims = '{"role":"app_ai_writer"}';
select throws_ok($$select public.reserve_usage('insight')$$, '42501', 'not_authenticated', 'reserve without sub');
select throws_ok($$select public.charge_usage_for_job(gen_random_uuid())$$, '42501', 'not_authenticated', 'charge_for_job without sub');
select throws_ok($$select public.get_usage_summary()$$, '42501', 'not_authenticated', 'summary without sub');
reset role;

-- Limits from earlier months / other periods don't count; future limit rows aren't active yet.
insert into public.usage_events (user_id, feature, units, period_month, status)
  values ('a0000000-0000-0000-0000-000000000001', 'interview_session', 5, '2020-01-01', 'charged');
insert into public.usage_limits (plan, feature, monthly_limit, effective_from)
  values ('free', 'interview_session', 1, now() + interval '1 day');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.get_usage_summary() -> 'interview_session', '{"limit":5,"used":0,"remaining":5}'::jsonb,
          'user summary: past months ignored, future limit not active');
select is((select count(*)::int from public.usage_events), 7, 'A sees own events');
select throws_ok($$update public.usage_events set status = 'released'$$, '42501', null, 'user cannot update events');
select throws_ok($$delete from public.usage_events$$, '42501', null, 'user cannot delete events');
select is((select count(*)::int from public.usage_limits), 5, 'user reads limits');
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.usage_events), 1, 'B sees only own events');
reset role;

-- Newer limit row wins once effective.
insert into public.usage_limits (plan, feature, monthly_limit, effective_from)
  values ('free', 'writing_chat', 1, now() - interval '1 second');
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select lives_ok($$select public.reserve_usage('writing_chat')$$, 'reserve under the newer limit');
select throws_ok($$select public.reserve_usage('writing_chat')$$, 'P0001', 'usage_limit_reached', 'newer limit row applies');
reset role;

select throws_ok($$insert into public.usage_events (user_id, feature, period_month) values ('a0000000-0000-0000-0000-000000000001', 'insight', '2026-10-02')$$,
                 '23514', null, 'period_month must be day 1');

delete from auth.users where id = 'a0000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.usage_events where user_id = 'a0000000-0000-0000-0000-000000000001'), 0,
          'usage_events cascade on account deletion');

select * from finish();
rollback;
