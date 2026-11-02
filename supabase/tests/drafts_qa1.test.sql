-- S7 QA round 1: QA-S7-07 (generating is judged by queued / running jobs, both directions; draft status recompute
-- ignores leftover generating rows) and QA-S7-09 (delete_results flags the in-flight jobs for cancel; complete on a
-- reset question is stale_run). QA-S7-01 (one in-flight career description per project) is in
-- career_description.test.sql.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into public.experiences (id, company_name, start_month, job_rank)
  values ('a0000000-1111-0000-0000-000000000001', 'A사', '2020-01-01', 'S');
insert into public.projects (id, experience_id, name, role)
  values ('a0000000-3333-0000-0000-000000000001', 'a0000000-1111-0000-0000-000000000001', '결제', 'Dev');
insert into public.project_details (id, project_id, title, situation, action)
  values ('a0000000-4444-0000-0000-000000000001', 'a0000000-3333-0000-0000-000000000001', 't', 's', 'a');
reset role;

insert into public.application_projects (id, user_id, name, name_source) values
  ('a0000000-aaaa-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '에이', 'user');
insert into public.job_descriptions (id, user_id, application_project_id, raw_text, raw_text_hash, sentences,
                                     extraction_status, extraction, tech_keywords, requirements_hash,
                                     extraction_provider, extraction_model) values
  ('a0000000-dddd-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001',
   '결제', 'h', '[{"sid":"S1","text":"결제","start":0,"end":2}]', 'succeeded', '{}', '[]', 'rh', 'gemini', 'm');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.create_cover_letter_draft('a0000000-aaaa-0000-0000-000000000001', 'a0000000-cccc-0000-0000-000000000001')$$,
                'fixture: cover letter');
select set_config('t.q1', (select id::text from public.draft_sections where sort_order = 0), true);
select set_config('t.q2', (select id::text from public.draft_sections where sort_order = 1), true);
select set_config('t.q3', (select id::text from public.draft_sections where sort_order = 2), true);
select lives_ok($$select public.set_section_sources(current_setting('t.q3')::uuid, '[{"project_id":"a0000000-3333-0000-0000-000000000001"}]')$$,
                'fixture: Q3 uses P1');
reset role;

set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier) values
  -- J1: queued for Q1, begin not called yet (prepare / D-30 window)
  ('a0000000-7777-0000-0000-000000000001', 'cover_letter', 'a0000000-aaaa-0000-0000-000000000001', 'draft_section',
   current_setting('t.q1')::uuid, 'queued', 1, 'gemini', 'default', 'free'),
  -- J2: already ended (failed) — used as a leftover generating row on Q2
  ('a0000000-7777-0000-0000-000000000002', 'cover_letter', 'a0000000-aaaa-0000-0000-000000000001', 'draft_section',
   current_setting('t.q2')::uuid, 'failed', 1, 'gemini', 'default', 'free'),
  -- J3: running for Q3
  ('a0000000-7777-0000-0000-000000000003', 'cover_letter', 'a0000000-aaaa-0000-0000-000000000001', 'draft_section',
   current_setting('t.q3')::uuid, 'running', 1, 'gemini', 'default', 'free'),
  -- J4: running career description
  ('a0000000-7777-0000-0000-000000000004', 'career_description', 'a0000000-aaaa-0000-0000-000000000001', 'draft',
   'a0000000-eeee-0000-0000-000000000001', 'running', 1, 'gemini', 'default', 'free');
select lives_ok($$select public.begin_cover_letter_section(current_setting('t.q3')::uuid, 'a0000000-7777-0000-0000-000000000003')$$,
                'begin Q3 (its own job does not count as another one)');
select lives_ok($$select public.begin_career_description('a0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000004',
                    '{"included_project_ids":["a0000000-3333-0000-0000-000000000001"],"selection_origin":"user"}',
                    '[{"section_kind":"experience","experience_id":"a0000000-1111-0000-0000-000000000001"}]')$$,
                'begin career description');
reset role;
-- Leftover: Q2 generating for the ended J2 (end trigger skipped under SKIP LOCKED).
update public.draft_sections set status = 'generating', ai_job_id = 'a0000000-7777-0000-0000-000000000002'
 where id = current_setting('t.q2')::uuid;

-- ── QA-S7-07 ──
select is(private.draft_recompute_status('a0000000-cccc-0000-0000-000000000001'), 'generating',
          'recompute: Q3 really generating -> generating');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.set_section_sources(current_setting('t.q1')::uuid, '[]')$$, 'P0001', 'section_generating',
                 'queued job before begin blocks set_section_sources');
select throws_ok($$select public.delete_cover_letter_question(current_setting('t.q1')::uuid)$$, 'P0001', 'section_generating',
                 'queued job before begin blocks delete');
select lives_ok($$select public.set_section_sources(current_setting('t.q2')::uuid, '[]')$$,
                'leftover generating row (job ended) does not block set_section_sources');
reset role;
select is(private.draft_section_job_active(current_setting('t.q2')::uuid), false, 'leftover row is not active');
select is(private.draft_section_job_active(current_setting('t.q1')::uuid), true, 'queued job is active');
select is(private.draft_section_job_active(current_setting('t.q1')::uuid, 'a0000000-7777-0000-0000-000000000001'), false,
          'own job excluded');

-- recompute with leftover counted as failed: Q3 done by hand to isolate the rule.
update public.ai_jobs set status = 'canceled', error_code = 'canceled' where id = 'a0000000-7777-0000-0000-000000000001';
select is((select status from public.draft_sections where id = current_setting('t.q2')::uuid), 'generating',
          'fixture: Q2 still a leftover generating row');

-- ── QA-S7-09 ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.delete_career_item('experience', 'a0000000-1111-0000-0000-000000000001', 'delete_projects', 'delete_results')$$,
                'delete_results: experience with its projects');
reset role;
select results_eq($$select id::text, cancel_requested_at is not null, status from public.ai_jobs order by id$$,
                  $$values ('a0000000-7777-0000-0000-000000000001'::text, false, 'canceled'::text),
                           ('a0000000-7777-0000-0000-000000000002', false, 'failed'),
                           ('a0000000-7777-0000-0000-000000000003', true, 'running'),
                           ('a0000000-7777-0000-0000-000000000004', true, 'running')$$,
                  'delete_results: cancel requested on the in-flight jobs of the reset question and deleted draft only');
select results_eq($$select status, ai_job_id is null from public.draft_sections where id = current_setting('t.q3')::uuid$$,
                  $$values ('pending'::text, true)$$, 'delete_results: Q3 reset');
select is((select count(*)::int from public.drafts where id = 'a0000000-eeee-0000-0000-000000000001'), 0,
          'delete_results: career description deleted');
select is(private.draft_recompute_status('a0000000-cccc-0000-0000-000000000001'), 'failed',
          'recompute: leftover generating Q2 counts as failed, Q1 / Q3 pending -> failed');

set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.complete_cover_letter_section(current_setting('t.q3')::uuid, 'a0000000-7777-0000-0000-000000000003', 1, '{}'),
          '{"applied": false, "reason": "stale_run"}'::jsonb, 'complete on a reset question -> stale_run (not invalid_ai_job)');
select throws_ok($$select public.complete_career_description('a0000000-eeee-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000004', 1, '{}')$$,
                 'P0001', 'draft_not_found', 'complete on a deleted career description -> draft_not_found (api: canceled)');
select is(public.fail_draft_section(current_setting('t.q3')::uuid, 'a0000000-7777-0000-0000-000000000003'), false,
          'fail on a reset question -> false');
reset role;

select * from finish();
rollback;
