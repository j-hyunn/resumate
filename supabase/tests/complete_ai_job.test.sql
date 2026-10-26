-- S3 complete_ai_job(p_job_id, p_usage_event_id, p_attempt_count, p_progress) (QA-S3-01/05):
-- succeed one run generation and charge exactly one reservation; sweep charges succeeded leftovers.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer, service_role;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

select ok(has_function_privilege('app_ai_writer', 'public.complete_ai_job(uuid, uuid, integer, jsonb)', 'execute'), 'app_ai_writer can complete');
select ok(not has_function_privilege('authenticated', 'public.complete_ai_job(uuid, uuid, integer, jsonb)', 'execute'), 'user cannot complete');
select ok(not has_function_privilege('anon', 'public.complete_ai_job(uuid, uuid, integer, jsonb)', 'execute'), 'anon cannot complete');
select hasnt_function('public', 'complete_ai_job', array['uuid', 'jsonb'], 'old 2-arg form is gone');

create temp table t_ev (name text primary key, id uuid);
grant select, insert on t_ev to app_ai_writer;

set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
insert into public.ai_jobs (id, job_type, status, attempt_count) values
  ('a1000000-0000-0000-0000-000000000001', 'cover_letter', 'running', 1),
  ('a1000000-0000-0000-0000-000000000002', 'cover_letter', 'queued', 0),
  ('a1000000-0000-0000-0000-000000000003', 'jd_extraction', 'running', 1),
  ('a1000000-0000-0000-0000-000000000004', 'insight', 'running', 2);
insert into t_ev values
  ('r1', public.reserve_usage('draft', 1, 'initial', 'a1000000-0000-0000-0000-000000000001')),
  ('r2', public.reserve_usage('draft', 1, 'initial', 'a1000000-0000-0000-0000-000000000001')),
  ('q', public.reserve_usage('draft', 1, 'initial', 'a1000000-0000-0000-0000-000000000002')),
  ('a4', public.reserve_usage('insight', 1, 'initial', 'a1000000-0000-0000-0000-000000000004'));

-- Wrong generation: refused, nothing changes.
select throws_ok($$select public.complete_ai_job('a1000000-0000-0000-0000-000000000001', (select id from t_ev where name = 'r2'), 0)$$,
                 'P0001', 'invalid_ai_job_transition', 'stale attempt_count refused');
select throws_ok($$select public.complete_ai_job('a1000000-0000-0000-0000-000000000001', (select id from t_ev where name = 'r2'), null)$$,
                 'P0001', 'invalid_ai_job_transition', 'null attempt_count refused');
select results_eq($$select j.status, e.status from public.ai_jobs j, public.usage_events e
                     where j.id = 'a1000000-0000-0000-0000-000000000001' and e.id = (select id from t_ev where name = 'r2')$$,
                  $$values ('running'::text, 'reserved'::text)$$, 'refused call left job and usage unchanged');

-- Happy path: charges only the given reservation.
select is(public.complete_ai_job('a1000000-0000-0000-0000-000000000001', (select id from t_ev where name = 'r2'), 1,
                                 '{"stage":"validate","done":1,"total":1}'), 1, 'complete charges one reservation');
select results_eq($$select status, progress, finished_at is not null from public.ai_jobs where id = 'a1000000-0000-0000-0000-000000000001'$$,
                  $$values ('succeeded'::text, '{"stage":"validate","done":1,"total":1}'::jsonb, true)$$,
                  'status, progress, finished_at set');
select results_eq($$select t.name, e.status from t_ev t join public.usage_events e on e.id = t.id where t.name in ('r1', 'r2') order by t.name$$,
                  $$values ('r1'::text, 'reserved'::text), ('r2'::text, 'charged'::text)$$,
                  'other reservation of the same job untouched (QA-S3-01)');
select is(public.complete_ai_job('a1000000-0000-0000-0000-000000000001', (select id from t_ev where name = 'r2'), 1), 0,
          'repeat call with the same generation is idempotent (0)');
select is((select progress ->> 'stage' from public.ai_jobs where id = 'a1000000-0000-0000-0000-000000000001'), 'validate',
          'repeat call keeps progress');
select throws_ok($$select public.complete_ai_job('a1000000-0000-0000-0000-000000000001', (select id from t_ev where name = 'r2'), 2)$$,
                 'P0001', 'invalid_ai_job_transition', 'succeeded job with another generation refused');

-- Reservation must belong to this job.
select throws_ok($$select public.complete_ai_job('a1000000-0000-0000-0000-000000000004', (select id from t_ev where name = 'r1'), 2)$$,
                 'P0001', 'usage_event_not_found', 'reservation of another job refused');
select is((select status from public.ai_jobs where id = 'a1000000-0000-0000-0000-000000000004'), 'running',
          'refused (wrong reservation) rolls back the status change');

-- Released reservation: can't succeed.
select lives_ok($$select public.release_usage((select id from t_ev where name = 'a4'))$$, 'release a4');
select throws_ok($$select public.complete_ai_job('a1000000-0000-0000-0000-000000000004', (select id from t_ev where name = 'a4'), 2)$$,
                 'P0001', 'invalid_usage_transition', 'released reservation refused');
select is((select status from public.ai_jobs where id = 'a1000000-0000-0000-0000-000000000004'), 'running',
          'refused (released) rolls back the status change');

-- No usage.
select is(public.complete_ai_job('a1000000-0000-0000-0000-000000000003', null, 1), 0, 'null reservation: succeed only');
select is((select status from public.ai_jobs where id = 'a1000000-0000-0000-0000-000000000003'), 'succeeded', 'no-usage job succeeded');

-- Not running.
select throws_ok($$select public.complete_ai_job('a1000000-0000-0000-0000-000000000002', (select id from t_ev where name = 'q'), 0)$$,
                 'P0001', 'invalid_ai_job_transition', 'queued -> succeeded refused');
select is((select status from public.usage_events where id = (select id from t_ev where name = 'q')), 'reserved', 'usage unchanged');
select throws_ok($$select public.complete_ai_job(gen_random_uuid(), null, 0)$$, 'P0001', 'ai_job_not_found', 'unknown job');

-- Cross-user.
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"app_ai_writer"}';
select throws_ok($$select public.complete_ai_job('a1000000-0000-0000-0000-000000000004', null, 2)$$,
                 'P0001', 'ai_job_not_found', 'B cannot complete A job');
insert into public.ai_jobs (id, job_type, status, attempt_count) values ('b1000000-0000-0000-0000-000000000001', 'insight', 'running', 1);
select throws_ok($$select public.complete_ai_job('b1000000-0000-0000-0000-000000000001', (select id from t_ev where name = 'r1'), 1)$$,
                 'P0001', 'usage_event_not_found', 'B cannot charge A reservation via own job');
set local request.jwt.claims = '{"role":"app_ai_writer"}';
select throws_ok($$select public.complete_ai_job('a1000000-0000-0000-0000-000000000004', null, 2)$$,
                 '42501', 'not_authenticated', 'no sub');
reset role;
select results_eq($$select j.status, e.status from public.ai_jobs j, public.usage_events e
                     where j.id = 'b1000000-0000-0000-0000-000000000001' and e.id = (select id from t_ev where name = 'r1')$$,
                  $$values ('running'::text, 'reserved'::text)$$, 'B job and A usage untouched');

-- Sweep releases old leftovers of succeeded jobs (r1 on job ...001: losing reservation), keeps recent ones.
update public.usage_events set created_at = now() - interval '10 minutes' where id = (select id from t_ev where name = 'r1');
insert into public.usage_events (id, user_id, feature, period_month, status, ai_job_id, created_at) values
  ('a2000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000001', 'draft', private.current_usage_period(),
   'reserved', 'a1000000-0000-0000-0000-000000000001', now());
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$select public.sweep_stalled_ai_jobs(now() - interval '2 minutes')$$, 'sweep');
reset role;
select is((select status from public.usage_events where id = (select id from t_ev where name = 'r1')), 'released',
          'sweep releases old leftover of a succeeded job (no double charge)');
select is((select status from public.usage_events where id = (select id from t_ev where name = 'r2')), 'charged',
          'winning reservation stays charged');
select is((select status from public.usage_events where id = 'a2000000-0000-0000-0000-000000000011'), 'reserved',
          'sweep keeps a recent leftover');

select * from finish();
rollback;
