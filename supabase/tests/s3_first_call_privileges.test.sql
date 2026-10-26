-- S3 privilege regression (see career_first_call_privileges.test.sql for why): every S3 write path
-- and RPC is first called in the session by its real end role. Nothing touches S3 tables or
-- functions as postgres before the role under test does.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer, service_role;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated');

-- authenticated first: summary, career row for evidence.
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.get_usage_summary()$$, 'authenticated: first get_usage_summary');
select lives_ok($$insert into public.skills (id, name) values ('aaaaaaaa-6666-0000-0000-000000000001', 'Go')$$,
                'authenticated: insert skill');
select lives_ok($$select id, status, progress, error_code, error_category from public.ai_jobs$$, 'authenticated: read ai_jobs');
select lives_ok($$select * from public.usage_events$$, 'authenticated: read usage_events');
select lives_ok($$select * from public.evidence_links$$, 'authenticated: read evidence_links');
reset role;

-- app_ai_writer first: the full runner path.
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select lives_ok($$select public.get_usage_summary()$$, 'app_ai_writer: get_usage_summary');
select lives_ok($$select public.reserve_usage('insight', 1, 'initial', 'aaaaaaaa-7777-0000-0000-000000000001')$$,
                'app_ai_writer: reserve_usage before job insert');
select lives_ok($$insert into public.ai_jobs (id, job_type) values ('aaaaaaaa-7777-0000-0000-000000000001', 'insight')$$,
                'app_ai_writer: insert ai_job (default user_id, guard trigger)');
select lives_ok($$update public.ai_jobs set status = 'running', heartbeat_at = now(), attempt_count = 1,
                         progress = '{"stage":"match","done":1,"total":2}', step_outputs = '{"match":1}'
                   where id = 'aaaaaaaa-7777-0000-0000-000000000001' and status = 'queued'$$,
                'app_ai_writer: claim job');
select lives_ok($$insert into public.evidence_links (application_project_id, owner_type, owner_id, item_key, source_type, source_id, source_field)
                  values (gen_random_uuid(), 'insight', gen_random_uuid(), 'strengths.0', 'skill',
                          'aaaaaaaa-6666-0000-0000-000000000001', 'name')$$,
                'app_ai_writer: insert evidence link (source guard)');
select lives_ok($$update public.ai_jobs set status = 'succeeded' where id = 'aaaaaaaa-7777-0000-0000-000000000001'$$,
                'app_ai_writer: succeed job');
select is(public.charge_usage_for_job('aaaaaaaa-7777-0000-0000-000000000001'), 1, 'app_ai_writer: charge_usage_for_job');
select lives_ok($$select public.release_usage_for_job(gen_random_uuid())$$, 'app_ai_writer: release_usage_for_job');
select lives_ok($$select public.charge_usage(public.reserve_usage('draft'))$$, 'app_ai_writer: charge_usage');
select lives_ok($$select public.release_usage(public.reserve_usage('draft'))$$, 'app_ai_writer: release_usage');
select lives_ok($$insert into public.ai_jobs (id, job_type) values ('aaaaaaaa-7777-0000-0000-000000000002', 'insight')$$,
                'app_ai_writer: second job');
select lives_ok($$insert into public.ai_jobs (id, job_type, status) values ('aaaaaaaa-7777-0000-0000-000000000003', 'insight', 'running')$$,
                'app_ai_writer: third job');
select is(public.complete_ai_job('aaaaaaaa-7777-0000-0000-000000000003',
            public.reserve_usage('insight', 1, 'initial', 'aaaaaaaa-7777-0000-0000-000000000003'), 0), 1,
          'app_ai_writer: complete_ai_job');
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

-- service_role: sweep.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$select public.sweep_stalled_ai_jobs(now() + interval '1 minute')$$, 'service_role: sweep_stalled_ai_jobs');
reset role;
select is((select status from public.ai_jobs where id = 'aaaaaaaa-7777-0000-0000-000000000002'), 'failed', 'swept');

select * from finish();
rollback;
