-- S8 mock interview (DM A.12 / A.13, §5; AI-05 / 06 / 07 storage): RLS and grants, private question columns and the
-- post-submit reveal, one answering session per project, answer edit conditions, submit (unanswered / zero answers),
-- question generation begin / save / complete / fail with run generations, evaluation begin / save / fail / feedback /
-- complete, re-evaluation, ai_jobs end trigger, abandon (job cancel), session delete (cascade + job cancel),
-- board popup in_progress_session_id, cross-user isolation. Calls run as the real roles.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

-- ── structure ──
select ok((select bool_and(relrowsecurity) from pg_class
            where oid in ('public.interview_sessions'::regclass, 'public.interview_questions'::regclass,
                          'public.interview_answers'::regclass, 'public.answer_evaluations'::regclass,
                          'public.session_feedbacks'::regclass)), 'RLS enabled on the 5 interview tables');
select policies_are('public', 'interview_sessions',
  array['interview_sessions_select_own', 'interview_sessions_delete_own', 'interview_sessions_select_ai_writer']);
select policies_are('public', 'interview_questions',
  array['interview_questions_select_own', 'interview_questions_select_ai_writer']);
select policies_are('public', 'interview_answers',
  array['interview_answers_select_own', 'interview_answers_update_own', 'interview_answers_select_ai_writer']);
select policies_are('public', 'answer_evaluations',
  array['answer_evaluations_select_own', 'answer_evaluations_select_ai_writer']);
select policies_are('public', 'session_feedbacks',
  array['session_feedbacks_select_own', 'session_feedbacks_select_ai_writer']);
select has_index('public', 'interview_sessions', 'interview_sessions_in_progress_key', 'A.12 partial unique index');

-- ── fixtures: A's career, projects AP1 (JD), AP2 (JD), AP3 (no JD) ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into public.experiences (id, company_name, start_month, job_rank)
  values ('a0000000-1111-0000-0000-000000000001', 'A사', '2020-01-01', 'S');
insert into public.projects (id, experience_id, name, role)
  values ('a0000000-3333-0000-0000-000000000001', 'a0000000-1111-0000-0000-000000000001', '결제', 'Dev');
insert into public.project_details (id, project_id, title, situation, action, learnings)
  values ('a0000000-4444-0000-0000-000000000001', 'a0000000-3333-0000-0000-000000000001', 't', 's', '인덱스 재설계', '배움');
reset role;

insert into public.application_projects (id, user_id, name, name_source) values
  ('a0000000-aaaa-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '에이', 'user'),
  ('a0000000-aaaa-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '비', 'user'),
  ('a0000000-aaaa-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', '씨', 'user'),
  ('b0000000-aaaa-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', '남', 'user');
insert into public.job_descriptions (id, user_id, application_project_id, raw_text, raw_text_hash, sentences,
                                     extraction_status, extraction, tech_keywords, requirements_hash,
                                     extraction_provider, extraction_model) values
  ('a0000000-dddd-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001',
   '결제 팀', 'h', '[{"sid":"S1","text":"결제 팀","start":0,"end":4}]', 'succeeded', '{}', '[]', 'rh', 'gemini', 'm'),
  ('a0000000-dddd-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000002',
   '협업 팀', 'h', '[{"sid":"S1","text":"협업 팀","start":0,"end":4}]', 'succeeded', '{}', '[]', 'rh', 'gemini', 'm');
insert into public.jd_requirements (id, user_id, job_description_id, category, content, source_sids, sort_order) values
  ('a0000000-8888-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-dddd-0000-0000-000000000001',
   'responsibility', '결제 API', '{S1}', 0),
  ('a0000000-8888-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'a0000000-dddd-0000-0000-000000000001',
   'required', 'Kafka', '{S1}', 1),
  ('a0000000-8888-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'a0000000-dddd-0000-0000-000000000002',
   'required', '협업', '{S1}', 0);

-- Payload templates (question / evaluation result).
select set_config('t.meta', '{"schema_version":2,"prompt_version":"ai-05.generate.v1","provider":"gemini","model":"gm",'
  || '"model_tier":"default","connection_tier":"free","validation_report":null,"usage":null}', true);
select set_config('t.q', jsonb_build_object(
  'sequence', 1, 'source_kind', 'project_deep_dive', 'anchor', 'experience', 'question_text', ' 질문? ',
  'intent', '기여 검증', 'focus_criteria', jsonb_build_array('specificity', 'intent_fit'),
  'target_requirement_ids', jsonb_build_array('a0000000-8888-0000-0000-000000000001'),
  'target_gap_requirement_ids', '[]'::jsonb, 'good_answer_signals', jsonb_build_array('측정 방법'),
  'hashes', jsonb_build_object('input_hash', 'ih', 'career_snapshot_hash', 'ch'),
  'meta', current_setting('t.meta')::jsonb,
  'evidence', jsonb_build_array(jsonb_build_object('item_key', 'question', 'sort_order', 0,
    'source_type', 'project_detail', 'source_id', 'a0000000-4444-0000-0000-000000000001', 'source_field', 'action',
    'quote', '인덱스 재설계'),
    jsonb_build_object('item_key', 'question', 'sort_order', 1, 'source_type', 'jd_requirement',
    'source_id', 'a0000000-8888-0000-0000-000000000001')))::text, true);
select set_config('t.done', jsonb_build_object(
  'weak_requirement_ids', jsonb_build_array('a0000000-8888-0000-0000-000000000002'), 'insight_id', null,
  'career_snapshot_hash', 'ch', 'meta', current_setting('t.meta')::jsonb)::text, true);
select set_config('t.eval', jsonb_build_object(
  'result', jsonb_build_object('criteria', '[]'::jsonb, 'intent_reveal', '의도', 'model_answer', jsonb_build_object('text', 'x'),
                               'score', jsonb_build_object('status', 'pending_method')),
  'hashes', jsonb_build_object('input_hash', 'ih', 'career_snapshot_hash', 'ch'),
  'meta', current_setting('t.meta')::jsonb,
  'evidence', jsonb_build_array(jsonb_build_object('item_key', 'model_answer', 'sort_order', 0,
    'source_type', 'project_detail', 'source_id', 'a0000000-4444-0000-0000-000000000001', 'source_field', 'action')))::text,
  true);

-- ══ 1. create_interview_session ══
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.create_interview_session('a0000000-aaaa-0000-0000-000000000001', 'tech', 5, 'ok')$$,
                 'P0001', 'invalid_interview_type', 'create: bad type');
select throws_ok($$select public.create_interview_session('a0000000-aaaa-0000-0000-000000000001', 'job', 4, 'ok')$$,
                 'P0001', 'invalid_question_count', 'create: bad count');
select throws_ok($$select public.create_interview_session('a0000000-aaaa-0000-0000-000000000001', 'job', 5, 'rich')$$,
                 'P0001', 'invalid_data_sufficiency', 'create: bad sufficiency');
select throws_ok($$select public.create_interview_session('b0000000-aaaa-0000-0000-000000000001', 'job', 5, 'ok')$$,
                 'P0001', 'application_project_not_found', 'create: other user project');
select is(public.create_interview_session('a0000000-aaaa-0000-0000-000000000001', 'job', 3, 'ok',
                                          'a0000000-5e55-0000-0000-000000000001') - 'session_id' - 'application_project_id',
          '{"interview_type":"job","question_count":3,"data_sufficiency":"ok","status":"in_progress","generation_status":"generating","created":true}'::jsonb,
          'create S1 (job, 3)');
select is(public.create_interview_session('a0000000-aaaa-0000-0000-000000000001', 'job', 3, 'ok',
                                          'a0000000-5e55-0000-0000-000000000001') ->> 'created', 'false',
          'create: same id is idempotent');
select throws_ok($$select public.create_interview_session('a0000000-aaaa-0000-0000-000000000002', 'job', 3, 'ok',
                                                          'a0000000-5e55-0000-0000-000000000001')$$,
                 'P0001', 'session_id_conflict', 'create: same id on another project');
do $$
declare v_detail text;
begin
  perform public.create_interview_session('a0000000-aaaa-0000-0000-000000000001', 'culture_fit', 5, 'thin');
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  perform set_config('t.err', sqlerrm || '|' || coalesce(v_detail, ''), true);
end $$;
select is(current_setting('t.err'), 'interview_in_progress|a0000000-5e55-0000-0000-000000000001',
          'create: in-progress session -> interview_in_progress + detail = its id');
select is((select question_count from public.interview_sessions where id = 'a0000000-5e55-0000-0000-000000000001'), 3,
          'user reads own session');
select throws_ok($$insert into public.interview_sessions (application_project_id, interview_type, data_sufficiency)
                   values ('a0000000-aaaa-0000-0000-000000000002', 'job', 'ok')$$, '42501', null,
                 'no direct insert');
select throws_ok($$update public.interview_sessions set status = 'completed'$$, '42501', null, 'no direct update');
select throws_ok($$select public.submit_interview_session('a0000000-5e55-0000-0000-000000000001')$$,
                 'P0001', 'interview_not_ready', 'submit before questions are ready');
reset role;

-- ══ 2. question generation ══
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier) values
  ('a0000000-7777-0000-0000-000000000001', 'interview_questions', 'a0000000-aaaa-0000-0000-000000000001',
   'interview_session', 'a0000000-5e55-0000-0000-000000000001', 'running', 1, 'gemini', 'default', 'free'),
  ('a0000000-7777-0000-0000-000000000002', 'insight', 'a0000000-aaaa-0000-0000-000000000001',
   'interview_session', 'a0000000-5e55-0000-0000-000000000001', 'running', 1, 'gemini', 'default', 'free');
select throws_ok($$select public.begin_interview_questions('a0000000-5e55-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000002')$$,
                 'P0001', 'invalid_ai_job', 'begin: wrong job type');
select results_eq($$select r ->> 'generation_status', (r ->> 'reopened')::boolean, (r ->> 'remaining')::int,
                           (r ->> 'next_sequence')::int, jsonb_array_length(r -> 'existing_questions')
                      from public.begin_interview_questions('a0000000-5e55-0000-0000-000000000001',
                                                            'a0000000-7777-0000-0000-000000000001') r$$,
                  $$values ('generating'::text, false, 3, 1, 0)$$, 'begin: first run');
select is(public.begin_interview_questions('a0000000-5e55-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000001') ->> 'reopened',
          'false', 'begin: idempotent');

select results_eq($$select (r ->> 'applied')::boolean, (r ->> 'created')::boolean, (r ->> 'saved_count')::int
                      from public.save_interview_question('a0000000-5e55-0000-0000-000000000001',
                        'a0000000-7777-0000-0000-000000000001', 1, current_setting('t.q')::jsonb) r$$,
                  $$values (true, true, 1)$$, 'save Q1');
select is(public.save_interview_question('a0000000-5e55-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000001', 1,
            current_setting('t.q')::jsonb || '{"question_text":"다른"}') ->> 'created', 'false', 'save: same sequence is idempotent');
select is(public.save_interview_question('a0000000-5e55-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000001', 2,
            current_setting('t.q')::jsonb || '{"sequence":2}'), '{"applied":false,"reason":"stale_run"}'::jsonb,
          'save: other run generation -> stale_run');

-- invalid payloads
select throws_ok(format($$select public.save_interview_question('a0000000-5e55-0000-0000-000000000001',
                   'a0000000-7777-0000-0000-000000000001', 1, %L::jsonb)$$, current_setting('t.q')::jsonb || p),
                 'P0001', 'invalid_interview_payload', 'save: invalid payload ' || p::text)
  from (values ('{"sequence":4}'::jsonb), ('{"sequence":0}'), ('{"sequence":"2"}'), ('{"sequence":1.5}'),
               ('{"sequence":2,"source_kind":"conflict"}'), ('{"sequence":2,"anchor":"general"}'),
               ('{"sequence":2,"anchor":"other"}'), ('{"sequence":2,"question_text":"  "}'),
               ('{"sequence":2,"intent":null}'), ('{"sequence":2,"focus_criteria":["tone"]}'),
               ('{"sequence":2,"focus_criteria":["structure","structure"]}'),
               ('{"sequence":2,"target_requirement_ids":["a0000000-8888-0000-0000-000000000003"]}'),
               ('{"sequence":2,"target_gap_requirement_ids":["nope"]}'),
               ('{"sequence":2,"good_answer_signals":[1]}'), ('{"sequence":2,"hashes":{}}'),
               ('{"sequence":2,"evidence":[{"item_key":"q","sort_order":0,"source_type":"interview_answer","source_id":"a0000000-4444-0000-0000-000000000001"}]}'),
               ('{"sequence":2,"evidence":[{"item_key":"q","sort_order":0,"source_type":"project_detail","source_id":"a0000000-4444-0000-0000-000000000001","source_field":"learnings"}]}'),
               ('{"sequence":2,"evidence":[{"item_key":"q","sort_order":0,"source_type":"project_detail","source_id":"a0000000-4444-0000-0000-000000000001","source_field":"budget"}]}')
       ) t (p);
select throws_ok(format($$select public.save_interview_question('a0000000-5e55-0000-0000-000000000001',
                   'a0000000-7777-0000-0000-000000000001', 1, %L::jsonb)$$,
                   current_setting('t.q')::jsonb || '{"sequence":2}' || jsonb_build_object('meta',
                     current_setting('t.meta')::jsonb || '{"provider":"openai"}')),
                 'P0001', 'invalid_ai_metadata', 'save: provider differs from the job');
select is((select count(*)::int from public.interview_questions where session_id = 'a0000000-5e55-0000-0000-000000000001'), 1,
          'nothing saved by the rejected payloads');
select results_eq($$select q.question_text, q.provider, q.model, q.run_generation, q.target_requirement_ids,
                           q.good_answer_signals, a.status, a.answer_text
                      from public.interview_questions q join public.interview_answers a on a.question_id = q.id
                     where q.session_id = 'a0000000-5e55-0000-0000-000000000001'$$,
                  $$values ('질문?'::text, 'gemini'::text, 'gm'::text, 1, '{a0000000-8888-0000-0000-000000000001}'::uuid[],
                           '["측정 방법"]'::jsonb, 'draft'::text, ''::text)$$,
                  'Q1 row (trimmed, AI meta) + blank draft answer');
select is((select count(*)::int from public.evidence_links where owner_type = 'interview_question'), 2,
          'Q1 evidence (owner interview_question)');
select throws_ok($$select public.complete_interview_questions('a0000000-5e55-0000-0000-000000000001',
                   'a0000000-7777-0000-0000-000000000001', 1, current_setting('t.done')::jsonb)$$,
                 'P0001', 'interview_questions_incomplete', 'complete before the full set');
select lives_ok($$select public.save_interview_question('a0000000-5e55-0000-0000-000000000001',
                  'a0000000-7777-0000-0000-000000000001', 1, current_setting('t.q')::jsonb || '{"sequence":2,"anchor":"jd"}')$$,
                'save Q2');
select is(public.fail_interview_questions('a0000000-5e55-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000001'),
          true, 'fail: generating -> failed');
select is(public.fail_interview_questions('a0000000-5e55-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000001'),
          false, 'fail again: no-op');
select is(public.save_interview_question('a0000000-5e55-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000001', 1,
            current_setting('t.q')::jsonb || '{"sequence":3}') ->> 'reason', 'stale_run',
          'save after fail in the same run -> stale_run');
reset role;
select results_eq($$select generation_status, question_run_generation,
                           (select count(*)::int from public.interview_questions q where q.session_id = s.id)
                      from public.interview_sessions s where id = 'a0000000-5e55-0000-0000-000000000001'$$,
                  $$values ('failed'::text, 1, 2)$$, 'failed generation keeps the saved questions');
-- Manual retry of the same job: run_generation 2, prepare (begin) skipped.
update public.ai_jobs set run_generation = 2 where id = 'a0000000-7777-0000-0000-000000000001';
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.save_interview_question('a0000000-5e55-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000001', 2,
            current_setting('t.q')::jsonb || '{"sequence":3}') ->> 'created', 'true',
          'retry (higher generation) without begin: reopens and saves Q3');
select throws_ok(format($$select public.complete_interview_questions('a0000000-5e55-0000-0000-000000000001',
                   'a0000000-7777-0000-0000-000000000001', 2, %L::jsonb)$$, current_setting('t.done')::jsonb || p),
                 'P0001', 'invalid_interview_payload', 'complete: invalid ' || p::text)
  from (values ('{"weak_requirement_ids":["a0000000-8888-0000-0000-000000000003"]}'::jsonb),
               ('{"insight_id":"a0000000-9999-0000-0000-000000000001"}'), ('{"career_snapshot_hash":""}'),
               ('{"meta":null}'),
               -- R1 A22: set-level validation_report / usage must be objects (or null / absent).
               ('{"validation_report":"ok"}'), ('{"usage":[1]}')) t (p);
select results_eq($$select r ->> 'generation_status', r ->> 'question_provider', r ->> 'question_model'
                      from public.complete_interview_questions('a0000000-5e55-0000-0000-000000000001',
                        'a0000000-7777-0000-0000-000000000001', 2, current_setting('t.done')::jsonb
                          || '{"validation_report":{"composition_relaxed":true,"warnings":["composition_relaxed"]},
                               "usage":{"input_tokens":1200,"output_tokens":340}}'::jsonb) r$$,
                  $$values ('ready'::text, 'gemini'::text, 'gm'::text)$$, 'complete: ready');
select is(public.complete_interview_questions('a0000000-5e55-0000-0000-000000000001',
            'a0000000-7777-0000-0000-000000000001', 2, current_setting('t.done')::jsonb) ->> 'reason', 'stale_run',
          'complete again -> stale_run');
select throws_ok($$select public.begin_interview_questions('a0000000-5e55-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000001')$$,
                 'P0001', 'interview_questions_ready', 'begin on a ready set');
reset role;
update public.ai_jobs set status = 'succeeded' where id = 'a0000000-7777-0000-0000-000000000001';
select results_eq($$select generation_status, weak_requirement_ids, career_snapshot_hash, question_provider
                      from public.interview_sessions where id = 'a0000000-5e55-0000-0000-000000000001'$$,
                  $$values ('ready'::text, '{a0000000-8888-0000-0000-000000000002}'::uuid[], 'ch'::text, 'gemini'::text)$$,
                  'session after complete (job succeeded: trigger leaves a ready set alone)');
select results_eq($$select question_validation_report, question_usage
                      from public.interview_sessions where id = 'a0000000-5e55-0000-0000-000000000001'$$,
                  $$values ('{"composition_relaxed":true,"warnings":["composition_relaxed"]}'::jsonb,
                           '{"input_tokens":1200,"output_tokens":340}'::jsonb)$$,
                  'R1 A22: set validation report / usage stored on the session');
select set_config('t.a1', (select a.id::text from public.interview_answers a join public.interview_questions q on q.id = a.question_id
                            where q.session_id = 'a0000000-5e55-0000-0000-000000000001' and q.sequence = 1), true);
select set_config('t.a2', (select a.id::text from public.interview_answers a join public.interview_questions q on q.id = a.question_id
                            where q.session_id = 'a0000000-5e55-0000-0000-000000000001' and q.sequence = 2), true);
select set_config('t.a3', (select a.id::text from public.interview_answers a join public.interview_questions q on q.id = a.question_id
                            where q.session_id = 'a0000000-5e55-0000-0000-000000000001' and q.sequence = 3), true);

-- ══ 3. private columns, answers ══
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select intent from public.interview_questions$$, '42501', null, 'user cannot read intent');
select throws_ok($$select good_answer_signals from public.interview_questions$$, '42501', null,
                 'user cannot read good_answer_signals');
select throws_ok($$select * from public.interview_questions$$, '42501', null, 'select * is refused (column grants)');
select is((select count(*)::int from (select id, sequence, question_text, focus_criteria from public.interview_questions) x), 3,
          'user reads the public question columns');
select throws_ok($$select * from public.get_interview_question_reveals('a0000000-5e55-0000-0000-000000000001')$$,
                 'P0001', 'interview_not_submitted', 'no reveal before submission');

with u as (update public.interview_answers set answer_text = '제가 인덱스를 재설계했습니다' where id = current_setting('t.a1')::uuid returning 1)
select is(count(*)::int, 1, 'answer autosave (ready, draft, not submitted)') from u;
with u as (update public.interview_answers set answer_text = E'  \n ' where id = current_setting('t.a2')::uuid returning 1)
select is(count(*)::int, 1, 'whitespace-only answer saved') from u;
select results_eq($$select answered_count from public.interview_sessions where id = 'a0000000-5e55-0000-0000-000000000001'$$,
                  $$values (1)$$, 'answered_count counts non-blank answers (trigger)');
select throws_ok($$update public.interview_answers set answer_text = repeat('x', 5001) where id = current_setting('t.a3')::uuid$$,
                 '23514', null, 'answer_text <= 5000');
select throws_ok($$update public.interview_answers set score_status = 'scored'$$, '42501', null,
                 'score slot not writable');
select throws_ok($$update public.interview_answers set status = 'submitted'$$, '42501', null, 'answer status not writable');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.interview_sessions), 0, 'B sees no session of A');
select is((select count(*)::int from public.interview_answers), 0, 'B sees no answer of A');
with u as (update public.interview_answers set answer_text = 'x' returning 1)
select is(count(*)::int, 0, 'B cannot update A answers') from u;
with d as (delete from public.interview_sessions returning 1)
select is(count(*)::int, 0, 'B cannot delete A sessions') from d;
select throws_ok($$select public.submit_interview_session('a0000000-5e55-0000-0000-000000000001')$$,
                 'P0001', 'interview_session_not_found', 'B cannot submit A session');
select throws_ok($$select public.abandon_interview_session('a0000000-5e55-0000-0000-000000000001')$$,
                 'P0001', 'interview_session_not_found', 'B cannot abandon A session');
select throws_ok($$select * from public.get_interview_question_reveals('a0000000-5e55-0000-0000-000000000001')$$,
                 'P0001', 'interview_session_not_found', 'B cannot reveal A intents');
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"app_ai_writer"}';
select is((select count(*)::int from public.interview_questions), 0, 'app_ai_writer as B sees no question of A');
select throws_ok($$select public.begin_interview_questions('a0000000-5e55-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000001')$$,
                 'P0001', 'interview_session_not_found', 'app_ai_writer as B cannot touch A session');
reset role;

-- ══ 4. submit ══
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select results_eq($$select r ->> 'status', (r ->> 'answered_count')::int, (r ->> 'unanswered_count')::int,
                           r -> 'answered_answer_ids', (r ->> 'evaluation_needed')::boolean
                      from public.submit_interview_session('a0000000-5e55-0000-0000-000000000001') r$$,
                  format($$values ('evaluating'::text, 1, 2, %L::jsonb, true)$$, jsonb_build_array(current_setting('t.a1'))),
                  'submit: 1 answered, 2 unanswered (blank / whitespace)');
select throws_ok($$select public.submit_interview_session('a0000000-5e55-0000-0000-000000000001')$$,
                 'P0001', 'interview_already_submitted', 'submit only once');
select results_eq($$select id::text, status, score_status from public.interview_answers
                     where session_id = 'a0000000-5e55-0000-0000-000000000001' order by status, id$$,
                  format($$select * from (values (%L, 'submitted'::text, null::text)) a
                           union all select * from (select x, 'unanswered', 'unanswered' from unnest(array[%L, %L]) x order by x) b$$,
                         current_setting('t.a1'), least(current_setting('t.a2'), current_setting('t.a3')),
                         greatest(current_setting('t.a2'), current_setting('t.a3'))),
                  'answer statuses and score slots after submit');
with u as (update public.interview_answers set answer_text = '늦은 수정' where id = current_setting('t.a1')::uuid returning 1)
select is(count(*)::int, 0, 'no edit after submit') from u;
select results_eq($$select sequence, intent
                      from public.get_interview_question_reveals('a0000000-5e55-0000-0000-000000000001')$$,
                  $$values (1, '기여 검증'::text), (2, '기여 검증'), (3, '기여 검증')$$,
                  'reveal after submission: intents in sequence order');
select throws_ok($$select public.abandon_interview_session('a0000000-5e55-0000-0000-000000000001')$$,
                 'P0001', 'interview_not_in_progress', 'abandon after submit');
select is(public.mark_interview_result_viewed('a0000000-5e55-0000-0000-000000000001') ->> 'changed', 'false',
          'mark viewed while evaluating: no-op');
reset role;

-- ══ 5. evaluation ══
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier) values
  ('a0000000-7777-0000-0000-000000000011', 'interview_evaluation', 'a0000000-aaaa-0000-0000-000000000001',
   'interview_session', 'a0000000-5e55-0000-0000-000000000001', 'running', 1, 'gemini', 'default', 'free');
select throws_ok($$select public.begin_interview_evaluation('a0000000-5e55-0000-0000-000000000001',
                   'a0000000-7777-0000-0000-000000000011', 'openai', 'gm')$$,
                 'P0001', 'invalid_ai_metadata', 'begin evaluation: provider differs');
select throws_ok($$select public.begin_interview_evaluation('a0000000-5e55-0000-0000-000000000001',
                   'a0000000-7777-0000-0000-000000000001', 'gemini', 'gm')$$,
                 'P0001', 'invalid_ai_job', 'begin evaluation: question job');
select results_eq($$select r ->> 'status', (r ->> 'reopened')::boolean, r -> 'answers_to_evaluate' -> 0 ->> 'answer_id',
                           jsonb_array_length(r -> 'unanswered_answer_ids'), (r ->> 'feedback_needed')::boolean
                      from public.begin_interview_evaluation('a0000000-5e55-0000-0000-000000000001',
                        'a0000000-7777-0000-0000-000000000011', 'gemini', 'gm-eval') r$$,
                  format($$values ('evaluating'::text, false, %L::text, 2, true)$$, current_setting('t.a1')),
                  'begin evaluation: answered answer to evaluate');
select throws_ok(format($$select public.save_answer_evaluation(%L, 'a0000000-7777-0000-0000-000000000011', 1, %L::jsonb)$$,
                        current_setting('t.a2'), current_setting('t.eval')),
                 'P0001', 'answer_not_evaluable', 'save evaluation for an unanswered answer');
select throws_ok(format($$select public.save_answer_evaluation(%L, 'a0000000-7777-0000-0000-000000000011', 1, %L::jsonb)$$,
                        current_setting('t.a1'), current_setting('t.eval')::jsonb || p),
                 'P0001', 'invalid_interview_payload', 'save evaluation: invalid ' || p::text)
  from (values ('{"result":{"improvements":[{"evidence":[]}]}}'::jsonb), ('{"result":[]}'), ('{"meta":{}}'),
               ('{"evidence":[{"item_key":"x","sort_order":0,"source_type":"user_note","source_id":"a0000000-4444-0000-0000-000000000001"}]}')) t (p);
select is(public.save_answer_evaluation(current_setting('t.a1')::uuid, 'a0000000-7777-0000-0000-000000000011', 9,
            current_setting('t.eval')::jsonb) ->> 'reason', 'stale_run', 'save evaluation: other generation -> stale_run');
select is(public.save_answer_evaluation(current_setting('t.a1')::uuid, 'a0000000-7777-0000-0000-000000000011', 1,
            current_setting('t.eval')::jsonb || jsonb_build_object('evidence', jsonb_build_array(
              jsonb_build_object('item_key', 'criteria.specificity', 'sort_order', 0, 'source_type', 'interview_answer',
                                 'source_id', current_setting('t.a1'), 'quote', '인덱스'),
              jsonb_build_object('item_key', 'model_answer', 'sort_order', 0, 'source_type', 'project_detail',
                                 'source_id', 'a0000000-4444-0000-0000-000000000001', 'source_field', 'learnings'))))
            ->> 'evidence_count', '2', 'save evaluation with an interview_answer source');
select is(public.fail_answer_evaluation(current_setting('t.a1')::uuid, 'a0000000-7777-0000-0000-000000000011'), false,
          'fail after success: no downgrade');
-- Complete without the session feedback -> evaluation_failed [가정 1].
select results_eq($$select r ->> 'status', r ->> 'score_status', (r ->> 'score_counted_count')::int
                      from public.complete_interview_evaluation('a0000000-5e55-0000-0000-000000000001',
                        'a0000000-7777-0000-0000-000000000011', 1) r$$,
                  $$values ('evaluation_failed'::text, 'not_scored'::text, 1)$$, 'feedback missing -> evaluation_failed');
reset role;
select results_eq($$select e.status, a.score_status from public.answer_evaluations e join public.interview_answers a on a.id = e.answer_id$$,
                  $$values ('succeeded'::text, 'pending_method'::text)$$, 'saved evaluation kept, answer score pending_method');
select results_eq($$select evaluation_provider, evaluation_model from public.interview_sessions
                     where id = 'a0000000-5e55-0000-0000-000000000001'$$,
                  $$values ('gemini'::text, 'gm-eval'::text)$$, 'evaluation provider / model recorded at begin');
update public.ai_jobs set status = 'failed', error_code = 'schema_invalid' where id = 'a0000000-7777-0000-0000-000000000011';

-- Re-evaluation with a new job: only the feedback is left.
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier) values
  ('a0000000-7777-0000-0000-000000000012', 'interview_evaluation', 'a0000000-aaaa-0000-0000-000000000001',
   'interview_session', 'a0000000-5e55-0000-0000-000000000001', 'running', 1, 'gemini', 'default', 'free');
select results_eq($$select r ->> 'status', (r ->> 'reopened')::boolean, jsonb_array_length(r -> 'answers_to_evaluate'),
                           jsonb_array_length(r -> 'evaluated_answer_ids')
                      from public.begin_interview_evaluation('a0000000-5e55-0000-0000-000000000001',
                        'a0000000-7777-0000-0000-000000000012', 'gemini', 'gm2') r$$,
                  $$values ('evaluating'::text, true, 0, 1)$$, 're-evaluation: reopened, the succeeded answer is kept');
select throws_ok(format($$select public.save_session_feedback('a0000000-5e55-0000-0000-000000000001',
                   'a0000000-7777-0000-0000-000000000012', 1, %L::jsonb)$$,
                   current_setting('t.eval')::jsonb || '{"result":{"overall_strengths":[{"evidence":[]}]}}'),
                 'P0001', 'invalid_interview_payload', 'feedback result with evidence key');
select is(public.save_session_feedback('a0000000-5e55-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000012', 1,
            current_setting('t.eval')::jsonb || '{"result":{"headline":"h"}}') ->> 'status', 'succeeded', 'save feedback');
select results_eq($$select r ->> 'status', r ->> 'score_status', (r ->> 'score_counted_count')::int, r -> 'not_scored_answer_ids'
                      from public.complete_interview_evaluation('a0000000-5e55-0000-0000-000000000001',
                        'a0000000-7777-0000-0000-000000000012', 1) r$$,
                  $$values ('completed'::text, 'pending_method'::text, 1, '[]'::jsonb)$$, 'complete evaluation');
reset role;
update public.ai_jobs set status = 'succeeded' where id = 'a0000000-7777-0000-0000-000000000012';
select results_eq($$select status, score_status, score_counted_count, completed_at is not null, evaluation_model,
                           (select count(*)::int from public.evidence_links el
                             where el.owner_type in ('answer_evaluation', 'session_feedback'))
                      from public.interview_sessions where id = 'a0000000-5e55-0000-0000-000000000001'$$,
                  $$values ('completed'::text, 'pending_method'::text, 1, true, 'gm2'::text, 3)$$,
                  'completed session (evaluation_model overwritten by re-evaluation)');
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier) values
  ('a0000000-7777-0000-0000-000000000013', 'interview_evaluation', 'a0000000-aaaa-0000-0000-000000000001',
   'interview_session', 'a0000000-5e55-0000-0000-000000000001', 'queued', 0, 'gemini', 'default', 'free');
select throws_ok($$select public.begin_interview_evaluation('a0000000-5e55-0000-0000-000000000001',
                   'a0000000-7777-0000-0000-000000000013', 'gemini', 'gm')$$,
                 'P0001', 'interview_evaluation_not_needed', 'nothing left to re-evaluate');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.mark_interview_result_viewed('a0000000-5e55-0000-0000-000000000001') ->> 'changed', 'true', 'mark viewed');
select is(public.mark_interview_result_viewed('a0000000-5e55-0000-0000-000000000001') ->> 'changed', 'false',
          'mark viewed again: no-op');
select is((select count(*)::int from public.answer_evaluations), 1, 'user reads own evaluations');
select is((select count(*)::int from public.session_feedbacks), 1, 'user reads own feedback');
reset role;
update public.ai_jobs set status = 'canceled', error_code = 'canceled' where id = 'a0000000-7777-0000-0000-000000000013';
-- QA-S8-02: cross-user isolation with A's questions, evaluation and feedback present.
select results_eq($$select (select count(*)::int from public.interview_questions),
                           (select count(*)::int from public.answer_evaluations),
                           (select count(*)::int from public.session_feedbacks)$$,
                  $$values (3, 1, 1)$$, 'QA-S8-02 fixture: A has questions, an evaluation and a feedback');
set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from (select id from public.interview_questions) x), 0,
          'QA-S8-02: B (authenticated) sees no question of A');
select is((select count(*)::int from public.answer_evaluations), 0, 'QA-S8-02: B (authenticated) sees no evaluation of A');
select is((select count(*)::int from public.session_feedbacks), 0, 'QA-S8-02: B (authenticated) sees no feedback of A');
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"app_ai_writer"}';
select is((select count(*)::int from public.answer_evaluations), 0, 'QA-S8-02: B (app_ai_writer) sees no evaluation of A');
select is((select count(*)::int from public.session_feedbacks), 0, 'QA-S8-02: B (app_ai_writer) sees no feedback of A');
reset role;


-- ══ 6. partial evaluation failure, re-evaluation, end trigger (S2 on AP2, culture fit) ══
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.create_interview_session('a0000000-aaaa-0000-0000-000000000002', 'culture_fit', 3, 'none',
                  'a0000000-5e55-0000-0000-000000000002')$$, 'create S2 (culture fit)');
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier) values
  ('a0000000-7777-0000-0000-000000000021', 'interview_questions', 'a0000000-aaaa-0000-0000-000000000002',
   'interview_session', 'a0000000-5e55-0000-0000-000000000002', 'running', 1, 'gemini', 'default', 'free');
select lives_ok($$select public.begin_interview_questions('a0000000-5e55-0000-0000-000000000002', 'a0000000-7777-0000-0000-000000000021')$$,
                'begin S2 questions');
select throws_ok(format($$select public.save_interview_question('a0000000-5e55-0000-0000-000000000002',
                   'a0000000-7777-0000-0000-000000000021', 1, %L::jsonb)$$, current_setting('t.q')),
                 'P0001', 'invalid_interview_payload', 'culture fit rejects a job source_kind');
select lives_ok(format($$select public.save_interview_question('a0000000-5e55-0000-0000-000000000002',
                  'a0000000-7777-0000-0000-000000000021', 1, %L::jsonb)$$,
                  current_setting('t.q')::jsonb || jsonb_build_object('sequence', s, 'source_kind', k, 'anchor', 'general',
                    'target_requirement_ids', jsonb_build_array('a0000000-8888-0000-0000-000000000003'),
                    'evidence', jsonb_build_array(jsonb_build_object('item_key', 'question', 'sort_order', 0,
                      'source_type', 'project_detail', 'source_id', 'a0000000-4444-0000-0000-000000000001',
                      'source_field', 'learnings')))),
                'save S2 Q' || s || ' (culture fit may cite learnings)')
  from (values (1, 'collaboration'), (2, 'conflict'), (3, 'values')) t (s, k);
select is(public.complete_interview_questions('a0000000-5e55-0000-0000-000000000002', 'a0000000-7777-0000-0000-000000000021', 1,
            current_setting('t.done')::jsonb || '{"weak_requirement_ids":[]}') ->> 'generation_status', 'ready', 'S2 ready');
reset role;
update public.ai_jobs set status = 'succeeded' where id = 'a0000000-7777-0000-0000-000000000021';
select set_config('t.b1', (select a.id::text from public.interview_answers a join public.interview_questions q on q.id = a.question_id
                            where q.session_id = 'a0000000-5e55-0000-0000-000000000002' and q.sequence = 1), true);
select set_config('t.b2', (select a.id::text from public.interview_answers a join public.interview_questions q on q.id = a.question_id
                            where q.session_id = 'a0000000-5e55-0000-0000-000000000002' and q.sequence = 2), true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
update public.interview_answers set answer_text = '답 하나' where id = current_setting('t.b1')::uuid;
update public.interview_answers set answer_text = '답 둘' where id = current_setting('t.b2')::uuid;
select is(public.submit_interview_session('a0000000-5e55-0000-0000-000000000002') ->> 'answered_count', '2', 'submit S2');
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier) values
  ('a0000000-7777-0000-0000-000000000022', 'interview_evaluation', 'a0000000-aaaa-0000-0000-000000000002',
   'interview_session', 'a0000000-5e55-0000-0000-000000000002', 'running', 1, 'gemini', 'default', 'free');
select is(jsonb_array_length(public.begin_interview_evaluation('a0000000-5e55-0000-0000-000000000002',
            'a0000000-7777-0000-0000-000000000022', 'gemini', 'gm') -> 'answers_to_evaluate'), 2, 'S2: two answers to evaluate');
select is(public.fail_answer_evaluation(current_setting('t.b1')::uuid, 'a0000000-7777-0000-0000-000000000022'), true,
          'answer 1 evaluation failed');
select throws_ok(format($$select public.save_answer_evaluation(%L, 'a0000000-7777-0000-0000-000000000022', 1, %L::jsonb)$$,
                        current_setting('t.b2'), current_setting('t.eval')::jsonb || jsonb_build_object('evidence',
                          jsonb_build_array(jsonb_build_object('item_key', 'criteria.structure', 'sort_order', 0,
                            'source_type', 'interview_answer', 'source_id', current_setting('t.a1'))))),
                 'P0001', 'invalid_evidence_source', 'interview_answer source of another application project');
select lives_ok(format($$select public.save_answer_evaluation(%L, 'a0000000-7777-0000-0000-000000000022', 1, %L::jsonb)$$,
                       current_setting('t.b2'), current_setting('t.eval')), 'answer 2 evaluated');
select lives_ok($$select public.save_session_feedback('a0000000-5e55-0000-0000-000000000002',
                  'a0000000-7777-0000-0000-000000000022', 1, current_setting('t.eval')::jsonb)$$, 'S2 feedback');
select results_eq($$select r ->> 'status', (r ->> 'score_counted_count')::int, r -> 'not_scored_answer_ids'
                      from public.complete_interview_evaluation('a0000000-5e55-0000-0000-000000000002',
                        'a0000000-7777-0000-0000-000000000022', 1) r$$,
                  format($$values ('completed'::text, 1, %L::jsonb)$$, jsonb_build_array(current_setting('t.b1'))),
                  'partial failure: completed, failed answer not_scored [가정 2]');
reset role;
update public.ai_jobs set status = 'succeeded' where id = 'a0000000-7777-0000-0000-000000000022';
select results_eq($$select a.score_status, e.status from public.interview_answers a
                      join public.answer_evaluations e on e.answer_id = a.id where a.id = current_setting('t.b1')::uuid$$,
                  $$values ('not_scored'::text, 'failed'::text)$$, 'not_scored answer + failed evaluation row');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.mark_interview_result_viewed('a0000000-5e55-0000-0000-000000000002') ->> 'changed', 'true', 'S2 viewed');
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier) values
  ('a0000000-7777-0000-0000-000000000023', 'interview_evaluation', 'a0000000-aaaa-0000-0000-000000000002',
   'interview_session', 'a0000000-5e55-0000-0000-000000000002', 'running', 1, 'openai', 'default', 'paid');
select results_eq($$select r -> 'answers_to_evaluate' -> 0 ->> 'answer_id', (r ->> 'reopened')::boolean
                      from public.begin_interview_evaluation('a0000000-5e55-0000-0000-000000000002',
                        'a0000000-7777-0000-0000-000000000023', 'openai', 'o-model') r$$,
                  format($$values (%L::text, true)$$, current_setting('t.b1')), 're-evaluate the not_scored answer only');
reset role;
select results_eq($$select s.status, s.result_viewed_at is null, s.evaluation_provider, f.status
                      from public.interview_sessions s join public.session_feedbacks f on f.session_id = s.id
                     where s.id = 'a0000000-5e55-0000-0000-000000000002'$$,
                  $$values ('evaluating'::text, true, 'openai'::text, 'pending'::text)$$,
                  'reopened: new-result mark reset, feedback to redo, provider overwritten');
-- The run dies -> end trigger: evaluation_failed, saved evaluation kept.
update public.ai_jobs set status = 'failed', error_code = 'stalled' where id = 'a0000000-7777-0000-0000-000000000023';
select results_eq($$select s.status, s.score_status, f.status,
                           (select count(*)::int from public.answer_evaluations e where e.session_id = s.id and e.status = 'succeeded')
                      from public.interview_sessions s join public.session_feedbacks f on f.session_id = s.id
                     where s.id = 'a0000000-5e55-0000-0000-000000000002'$$,
                  $$values ('evaluation_failed'::text, 'not_scored'::text, 'failed'::text, 1)$$,
                  'end trigger: evaluation_failed, saved evaluation kept');

-- ══ 7. question end trigger, retry take-over, abandon, zero-answer submit, board popup ══
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.create_interview_session('a0000000-aaaa-0000-0000-000000000003', 'job', 3, 'ok',
                  'a0000000-5e55-0000-0000-000000000003')$$, 'create S3 on a project without JD');
select lives_ok($$select public.create_interview_session('a0000000-aaaa-0000-0000-000000000001', 'job', 3, 'ok',
                  'a0000000-5e55-0000-0000-000000000004')$$, 'create S4 on AP1 (S1 is submitted)');
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier) values
  ('a0000000-7777-0000-0000-000000000031', 'interview_questions', 'a0000000-aaaa-0000-0000-000000000003',
   'interview_session', 'a0000000-5e55-0000-0000-000000000003', 'running', 1, 'gemini', 'default', 'free'),
  ('a0000000-7777-0000-0000-000000000041', 'interview_questions', 'a0000000-aaaa-0000-0000-000000000001',
   'interview_session', 'a0000000-5e55-0000-0000-000000000004', 'running', 1, 'gemini', 'default', 'free');
select throws_ok($$select public.begin_interview_questions('a0000000-5e55-0000-0000-000000000003', 'a0000000-7777-0000-0000-000000000031')$$,
                 'P0001', 'jd_not_extracted', 'begin: JD not extracted (D-30 is the API''s job)');
select lives_ok($$select public.begin_interview_questions('a0000000-5e55-0000-0000-000000000004', 'a0000000-7777-0000-0000-000000000041')$$,
                'begin S4');
select lives_ok($$select public.save_interview_question('a0000000-5e55-0000-0000-000000000004',
                  'a0000000-7777-0000-0000-000000000041', 1, current_setting('t.q')::jsonb)$$, 'save S4 Q1');
-- The runner (app_ai_writer) ends the job: the definer end trigger runs on its first call.
update public.ai_jobs set status = 'canceled', error_code = 'canceled' where id = 'a0000000-7777-0000-0000-000000000041';
reset role;
select is((select generation_status from public.interview_sessions where id = 'a0000000-5e55-0000-0000-000000000004'),
          'failed', 'end trigger: canceled question job -> generation failed');
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier) values
  ('a0000000-7777-0000-0000-000000000042', 'interview_questions', 'a0000000-aaaa-0000-0000-000000000001',
   'interview_session', 'a0000000-5e55-0000-0000-000000000004', 'running', 1, 'gemini', 'default', 'free');
select results_eq($$select (r ->> 'reopened')::boolean, (r ->> 'remaining')::int, (r ->> 'next_sequence')::int,
                           r -> 'existing_questions' -> 0 ->> 'question_text'
                      from public.begin_interview_questions('a0000000-5e55-0000-0000-000000000004',
                        'a0000000-7777-0000-0000-000000000042') r$$,
                  $$values (true, 2, 2, '질문?'::text)$$, '남은 질문 다시 만들기: new job reopens, existing questions listed');
reset role;
-- One in-flight question job per session (D-34).
select throws_ok($$insert into public.ai_jobs (user_id, job_type, application_project_id, target_type, target_id, status,
                     provider, model_tier, connection_tier) values
                   ('a0000000-0000-0000-0000-000000000001', 'interview_questions', 'a0000000-aaaa-0000-0000-000000000001',
                    'interview_session', 'a0000000-5e55-0000-0000-000000000004', 'queued', 'gemini', 'default', 'free')$$,
                 '23505', null, 'one in-flight question job per session (ai_jobs_in_flight_target_key)');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select results_eq($$select r -> 'interview_prompt' ->> 'in_progress_session_id',
                           r -> 'interview_prompt' -> 'in_progress_session' ->> 'interview_type',
                           (r -> 'interview_prompt' -> 'in_progress_session' ->> 'question_count')::int
                      from public.move_application_stage('a0000000-aaaa-0000-0000-000000000001', 'culture_fit_interview') r$$,
                  $$values ('a0000000-5e55-0000-0000-000000000004'::text, 'job'::text, 3)$$,
                  'board popup: in_progress_session_id of the answering session (any type)');
with u as (update public.interview_answers set answer_text = 'x'
            where session_id = 'a0000000-5e55-0000-0000-000000000004' returning 1)
select is(count(*)::int, 0, 'no answer edit while questions are generating') from u;
select results_eq($$select r ->> 'status', (r ->> 'changed')::boolean, (r ->> 'cancel_requested')::int
                      from public.abandon_interview_session('a0000000-5e55-0000-0000-000000000004') r$$,
                  $$values ('abandoned'::text, true, 1)$$, 'abandon while generating: job asked to stop');
select is(public.abandon_interview_session('a0000000-5e55-0000-0000-000000000004') ->> 'changed', 'false',
          'abandon again: no-op');
select is((select cancel_requested_at is not null from public.ai_jobs where id = 'a0000000-7777-0000-0000-000000000042'), true,
          'abandon: cancel_requested_at on the question job');
select is(public.move_application_stage('a0000000-aaaa-0000-0000-000000000001', 'job_interview') -> 'interview_prompt',
          '{"interview_type":"job","in_progress_session_id":null,"in_progress_session":null}'::jsonb,
          'board popup: no answering session after abandon');
reset role;
update public.ai_jobs set status = 'canceled', error_code = 'canceled' where id = 'a0000000-7777-0000-0000-000000000042';
select results_eq($$select status, generation_status, abandoned_at is not null
                      from public.interview_sessions where id = 'a0000000-5e55-0000-0000-000000000004'$$,
                  $$values ('abandoned'::text, 'failed'::text, true)$$, 'abandoned session; trigger still marks generation failed');
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier) values
  ('a0000000-7777-0000-0000-000000000044', 'interview_questions', 'a0000000-aaaa-0000-0000-000000000001',
   'interview_session', 'a0000000-5e55-0000-0000-000000000004', 'running', 1, 'gemini', 'default', 'free');
select throws_ok($$select public.begin_interview_questions('a0000000-5e55-0000-0000-000000000004', 'a0000000-7777-0000-0000-000000000044')$$,
                 'P0001', 'interview_not_in_progress', 'begin on an abandoned session');
reset role;
update public.ai_jobs set status = 'canceled', error_code = 'canceled' where id = 'a0000000-7777-0000-0000-000000000044';

-- Zero answers: S5 (new answering session allowed after abandon).
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.create_interview_session('a0000000-aaaa-0000-0000-000000000001', 'job', 3, 'ok',
                  'a0000000-5e55-0000-0000-000000000005')$$, 'create S5 after abandon');
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier) values
  ('a0000000-7777-0000-0000-000000000051', 'interview_questions', 'a0000000-aaaa-0000-0000-000000000001',
   'interview_session', 'a0000000-5e55-0000-0000-000000000005', 'running', 1, 'gemini', 'default', 'free');
select lives_ok($$select public.begin_interview_questions('a0000000-5e55-0000-0000-000000000005', 'a0000000-7777-0000-0000-000000000051')$$,
                'begin S5');
select lives_ok(format($$select public.save_interview_question('a0000000-5e55-0000-0000-000000000005',
                  'a0000000-7777-0000-0000-000000000051', 1, %L::jsonb)$$, current_setting('t.q')::jsonb || jsonb_build_object('sequence', s)),
                'save S5 Q' || s) from generate_series(1, 3) s;
select lives_ok($$select public.complete_interview_questions('a0000000-5e55-0000-0000-000000000005',
                  'a0000000-7777-0000-0000-000000000051', 1, current_setting('t.done')::jsonb)$$, 'S5 ready');
reset role;
select results_eq($$select question_validation_report, question_usage
                      from public.interview_sessions where id = 'a0000000-5e55-0000-0000-000000000005'$$,
                  $$values (null::jsonb, null::jsonb)$$, 'R1 A22: report / usage absent in the payload -> null');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select results_eq($$select r ->> 'status', (r ->> 'answered_count')::int, (r ->> 'unanswered_count')::int,
                           r -> 'answered_answer_ids', (r ->> 'evaluation_needed')::boolean
                      from public.submit_interview_session('a0000000-5e55-0000-0000-000000000005') r$$,
                  $$values ('completed'::text, 0, 3, '[]'::jsonb, false)$$, 'zero answers: completed right away');
select results_eq($$select status, score_status, score_counted_count, completed_at is not null
                      from public.interview_sessions where id = 'a0000000-5e55-0000-0000-000000000005'$$,
                  $$values ('completed'::text, 'not_scored'::text, 0, true)$$, 'zero answers: session score not_scored');
reset role;

-- ══ 8. session delete: cascade, evidence, job cancel ══
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier) values
  ('a0000000-7777-0000-0000-000000000024', 'interview_evaluation', 'a0000000-aaaa-0000-0000-000000000002',
   'interview_session', 'a0000000-5e55-0000-0000-000000000002', 'queued', 0, 'gemini', 'default', 'free');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
with d as (delete from public.interview_sessions where id = 'a0000000-5e55-0000-0000-000000000002' returning 1)
select is(count(*)::int, 1, 'user deletes an evaluation_failed session (F-P3-15)') from d;
reset role;
select results_eq($$select (select count(*)::int from public.interview_questions where session_id = 'a0000000-5e55-0000-0000-000000000002'),
                           (select count(*)::int from public.interview_answers where session_id = 'a0000000-5e55-0000-0000-000000000002'),
                           (select count(*)::int from public.answer_evaluations where session_id = 'a0000000-5e55-0000-0000-000000000002'),
                           (select count(*)::int from public.session_feedbacks where session_id = 'a0000000-5e55-0000-0000-000000000002'),
                           (select count(*)::int from public.evidence_links where application_project_id = 'a0000000-aaaa-0000-0000-000000000002')$$,
                  $$values (0, 0, 0, 0, 0)$$, 'session delete cascades to questions, answers, evaluations, feedback, evidence');
select is((select cancel_requested_at is not null from public.ai_jobs where id = 'a0000000-7777-0000-0000-000000000024'), true,
          'session delete asks its queued job to stop');
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select throws_ok($$select public.save_session_feedback('a0000000-5e55-0000-0000-000000000002',
                   'a0000000-7777-0000-0000-000000000024', 0, current_setting('t.eval')::jsonb)$$,
                 'P0001', 'interview_session_not_found', 'RPC on a deleted session -> not found (API: canceled)');
reset role;

-- Project delete and account delete cascades.
delete from public.application_projects where id = 'a0000000-aaaa-0000-0000-000000000001';
select is((select count(*)::int from public.interview_sessions where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'), 0,
          'application project delete cascades to its sessions');
delete from auth.users where id = 'a0000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.interview_sessions), 0, 'account delete removes every session');

select * from finish();
rollback;
