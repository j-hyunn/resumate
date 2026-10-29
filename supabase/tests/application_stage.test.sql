-- S5 move_application_stage / set_application_outcome (DM §2.6 steps 1–5, D-UX-12 (a), C-13, C-14).
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.create_application_project('a0000000-aaaa-0000-0000-000000000001', '원문', 'h',
                   '[{"sid":"S1","text":"원문","start":0,"end":2}]', null, null, '지원 A')$$, 'project');

-- Validation.
select throws_ok($$select public.move_application_stage('a0000000-aaaa-0000-0000-000000000001', 'offer')$$,
                 'P0001', 'invalid_stage', 'unknown stage');
select throws_ok($$select public.move_application_stage('a0000000-aaaa-0000-0000-000000000001', null)$$,
                 'P0001', 'invalid_stage', 'null stage');
select throws_ok($$select public.move_application_stage('a0000000-aaaa-0000-0000-000000000001', 'document', 'passed')$$,
                 'P0001', 'invalid_outcome', 'outcome only with closed');
select throws_ok($$select public.move_application_stage('a0000000-aaaa-0000-0000-000000000001', 'closed', 'hired')$$,
                 'P0001', 'invalid_outcome', 'unknown outcome');
select throws_ok($$select public.move_application_stage(gen_random_uuid(), 'document')$$,
                 'P0001', 'application_project_not_found', 'unknown project');

-- 1. Same stage: nothing.
select is(public.move_application_stage('a0000000-aaaa-0000-0000-000000000001', 'before_apply') - 'stage_changed_at',
          '{"stage":"before_apply","stage_outcome":null,"changed":false,"interview_prompt":null}'::jsonb,
          'same stage -> changed false');
select is((select count(*)::int from public.application_stage_events), 1, 'same stage -> no event');

-- 4. Normal move.
reset role;
update public.application_projects set stage_changed_at = now() - interval '1 day', last_activity_at = now() - interval '1 day';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.move_application_stage('a0000000-aaaa-0000-0000-000000000001', 'document') - 'stage_changed_at',
          '{"stage":"document","stage_outcome":null,"changed":true,"interview_prompt":null}'::jsonb, 'move to document');
select ok((select stage_changed_at > now() - interval '1 minute' and last_activity_at > now() - interval '1 minute'
             from public.application_projects), 'stage_changed_at and last_activity_at bumped');

-- 5. Interview prompts (C-14).
select is(public.move_application_stage('a0000000-aaaa-0000-0000-000000000001', 'job_interview') -> 'interview_prompt',
          '{"interview_type":"job","in_progress_session_id":null}'::jsonb, 'job interview prompt');
select is(public.move_application_stage('a0000000-aaaa-0000-0000-000000000001', 'culture_fit_interview') -> 'interview_prompt',
          '{"interview_type":"culture_fit","in_progress_session_id":null}'::jsonb, 'culture fit prompt');

-- 3. Closed with an outcome.
select is(public.move_application_stage('a0000000-aaaa-0000-0000-000000000001', 'closed', 'failed') ->> 'stage_outcome',
          'failed', 'closed with outcome');
-- Same stage with an outcome is still a no-op (outcome goes through set_application_outcome).
select is(public.move_application_stage('a0000000-aaaa-0000-0000-000000000001', 'closed', 'passed') ->> 'stage_outcome',
          'failed', 'closed -> closed ignores the outcome');

-- set_application_outcome.
select is(public.set_application_outcome('a0000000-aaaa-0000-0000-000000000001', 'passed') - 'stage_changed_at',
          '{"stage":"closed","stage_outcome":"passed","changed":true}'::jsonb, 'outcome changed');
select is((public.set_application_outcome('a0000000-aaaa-0000-0000-000000000001', 'passed') ->> 'changed')::boolean, false,
          'same outcome -> changed false');
select is(public.set_application_outcome('a0000000-aaaa-0000-0000-000000000001', null) ->> 'stage_outcome', null,
          'outcome cleared [가정 6]');
select lives_ok($$select public.set_application_outcome('a0000000-aaaa-0000-0000-000000000001', 'passed')$$, 'outcome set again');
select throws_ok($$select public.set_application_outcome('a0000000-aaaa-0000-0000-000000000001', 'hired')$$,
                 'P0001', 'invalid_outcome', 'unknown outcome');

-- 2. Leaving closed clears the outcome; the event keeps it as from_outcome (D-UX-12).
select is(public.move_application_stage('a0000000-aaaa-0000-0000-000000000001', 'document') ->> 'stage_outcome', null,
          'leaving closed clears the outcome');
select throws_ok($$select public.set_application_outcome('a0000000-aaaa-0000-0000-000000000001', 'passed')$$,
                 'P0001', 'not_closed', 'outcome needs closed');
select is(public.move_application_stage('a0000000-aaaa-0000-0000-000000000001', 'closed') ->> 'stage_outcome', null,
          'closed without outcome = 결과 미기록');

select results_eq(
  $$select event_type, coalesce(from_stage, '-'), to_stage, coalesce(from_outcome, '-'), coalesce(to_outcome, '-')
      from public.application_stage_events order by created_at, ctid$$,
  $$values ('created', '-', 'before_apply', '-', '-'),
           ('stage_changed', 'before_apply', 'document', '-', '-'),
           ('stage_changed', 'document', 'job_interview', '-', '-'),
           ('stage_changed', 'job_interview', 'culture_fit_interview', '-', '-'),
           ('stage_changed', 'culture_fit_interview', 'closed', '-', 'failed'),
           ('outcome_changed', 'closed', 'closed', 'failed', 'passed'),
           ('outcome_changed', 'closed', 'closed', 'passed', '-'),
           ('outcome_changed', 'closed', 'closed', '-', 'passed'),
           ('stage_changed', 'closed', 'document', 'passed', '-'),
           ('stage_changed', 'document', 'closed', '-', '-')$$,
  'full event history');

select * from finish();
rollback;
