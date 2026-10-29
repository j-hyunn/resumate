-- S8 career deletion impact on interview sessions (DM §4.2): get_deletion_impact interview_sessions counts through
-- question / evaluation / feedback evidence (cascade included, one count per session), keep_results vs delete_results
-- (session deleted, its running job asked to stop), helper isolation.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into public.experiences (id, company_name, start_month, job_rank)
  values ('a0000000-1111-0000-0000-000000000001', 'A사', '2020-01-01', 'S');
insert into public.projects (id, experience_id, name, role) values
  ('a0000000-3333-0000-0000-000000000001', 'a0000000-1111-0000-0000-000000000001', 'P1', 'Dev'),
  ('a0000000-3333-0000-0000-000000000002', 'a0000000-1111-0000-0000-000000000001', 'P2', 'Dev');
insert into public.project_details (id, project_id, title, situation, action) values
  ('a0000000-4444-0000-0000-000000000001', 'a0000000-3333-0000-0000-000000000001', 't1', 's', 'a1'),
  ('a0000000-4444-0000-0000-000000000002', 'a0000000-3333-0000-0000-000000000002', 't2', 's', 'a2');
insert into public.skills (id, name) values ('a0000000-6666-0000-0000-000000000001', 'Go');
reset role;

insert into public.application_projects (id, user_id, name, name_source) values
  ('a0000000-aaaa-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '가', 'user'),
  ('a0000000-aaaa-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '나', 'user');

-- SA (AP1, in progress): Q1, Q2 both cite D1 (counted once). SB (AP2, evaluating): evaluation cites D2, feedback
-- cites D2. SC (AP1, completed... kept simple: abandoned) cites nothing.
insert into public.interview_sessions (id, user_id, application_project_id, interview_type, question_count,
                                       data_sufficiency, status, generation_status, question_provider, question_model,
                                       submitted_at, abandoned_at) values
  ('a0000000-5e55-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001',
   'job', 3, 'ok', 'in_progress', 'ready', 'gemini', 'm', null, null),
  ('a0000000-5e55-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000002',
   'job', 3, 'ok', 'evaluating', 'ready', 'gemini', 'm', now(), null),
  ('a0000000-5e55-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001',
   'job', 3, 'ok', 'abandoned', 'ready', 'gemini', 'm', null, now());
insert into public.interview_questions (id, user_id, session_id, sequence, source_kind, anchor, question_text, intent) values
  ('a0000000-9001-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-5e55-0000-0000-000000000001', 1, 'project_deep_dive', 'experience', 'q', 'i'),
  ('a0000000-9001-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'a0000000-5e55-0000-0000-000000000001', 2, 'project_deep_dive', 'experience', 'q', 'i'),
  ('a0000000-9001-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'a0000000-5e55-0000-0000-000000000002', 1, 'requirement_fit', 'jd', 'q', 'i'),
  ('a0000000-9001-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'a0000000-5e55-0000-0000-000000000003', 1, 'gap_probe', 'jd', 'q', 'i');
insert into public.interview_answers (id, user_id, session_id, question_id, answer_text, status) values
  ('a0000000-9002-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'a0000000-5e55-0000-0000-000000000002',
   'a0000000-9001-0000-0000-000000000003', '답', 'submitted');
insert into public.answer_evaluations (id, user_id, session_id, answer_id, status) values
  ('a0000000-9003-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-5e55-0000-0000-000000000002',
   'a0000000-9002-0000-0000-000000000003', 'pending');
insert into public.session_feedbacks (id, user_id, session_id, status) values
  ('a0000000-9004-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-5e55-0000-0000-000000000002', 'pending');
insert into public.evidence_links (user_id, application_project_id, owner_type, owner_id, item_key, source_type, source_id,
                                   source_field, quote) values
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001', 'interview_question',
   'a0000000-9001-0000-0000-000000000001', 'question', 'project_detail', 'a0000000-4444-0000-0000-000000000001', 'action', 'a1'),
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001', 'interview_question',
   'a0000000-9001-0000-0000-000000000002', 'question', 'project_detail', 'a0000000-4444-0000-0000-000000000001', 'action', 'a1'),
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000002', 'answer_evaluation',
   'a0000000-9003-0000-0000-000000000001', 'model_answer', 'project_detail', 'a0000000-4444-0000-0000-000000000002', 'action', 'a2'),
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000002', 'session_feedback',
   'a0000000-9004-0000-0000-000000000001', 'headline', 'project', 'a0000000-3333-0000-0000-000000000002', 'name', 'P2');
insert into public.ai_jobs (id, user_id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier) values
  ('a0000000-7777-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'interview_evaluation',
   'a0000000-aaaa-0000-0000-000000000002', 'interview_session', 'a0000000-5e55-0000-0000-000000000002', 'running', 1,
   'gemini', 'default', 'free');
update public.interview_sessions set evaluation_job_id = 'a0000000-7777-0000-0000-000000000001'
 where id = 'a0000000-5e55-0000-0000-000000000002';

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.get_deletion_impact('project_detail', 'a0000000-4444-0000-0000-000000000001') -> 'affected_results'
            -> 'by_application_project',
          '[{"application_project_id":"a0000000-aaaa-0000-0000-000000000001","name":"가","insights":0,"drafts":0,"draft_sections":0,"interview_sessions":1}]'::jsonb,
          'detail D1: one session (two question links counted once)');
select is(jsonb_path_query_array(public.get_deletion_impact('project', 'a0000000-3333-0000-0000-000000000002')
            -> 'affected_results' -> 'by_application_project', '$[*].interview_sessions'),
          '[1]'::jsonb, 'project P2 (evaluation via cascaded detail + feedback on the project): one session');
select is(jsonb_path_query_array(public.get_deletion_impact('experience', 'a0000000-1111-0000-0000-000000000001', 'delete_projects')
            -> 'affected_results' -> 'by_application_project', '$[*].name'),
          '["가", "나"]'::jsonb, 'experience with its projects: both application projects, by name');
select is(public.get_deletion_impact('experience', 'a0000000-1111-0000-0000-000000000001', 'keep_projects')
            -> 'affected_results' -> 'by_application_project', '[]'::jsonb, 'experience keeping projects: no session');
select is(public.get_deletion_impact('skill', 'a0000000-6666-0000-0000-000000000001') -> 'affected_results'
            -> 'by_application_project', '[]'::jsonb, 'unrelated skill: none');

-- keep_results: links marked, sessions kept.
select lives_ok($$select public.delete_career_item('project_detail', 'a0000000-4444-0000-0000-000000000001', 'keep_projects', 'keep_results')$$,
                'keep_results delete of D1');
select results_eq($$select count(*)::int, bool_and(quote is null and source_deleted_at is not null)
                      from public.evidence_links where owner_type = 'interview_question'$$,
                  $$values (2, true)$$, 'keep_results: question links show the source as deleted');
select is((select count(*)::int from public.interview_sessions), 3, 'keep_results: sessions kept');

-- delete_results: SB deleted, its running evaluation job asked to stop.
select lives_ok($$select public.delete_career_item('project', 'a0000000-3333-0000-0000-000000000002', 'keep_projects', 'delete_results')$$,
                'delete_results delete of P2');
select results_eq($$select id::text from public.interview_sessions order by id$$,
                  $$values ('a0000000-5e55-0000-0000-000000000001'::text), ('a0000000-5e55-0000-0000-000000000003')$$,
                  'delete_results: the citing session is deleted (unit = session)');
reset role;
select is((select cancel_requested_at is not null from public.ai_jobs where id = 'a0000000-7777-0000-0000-000000000001'), true,
          'delete_results: running evaluation job asked to stop');
select is((select count(*)::int from public.evidence_links where application_project_id = 'a0000000-aaaa-0000-0000-000000000002'), 0,
          'delete_results: its evidence went with it');

-- Helper isolation: B computes nothing for A's rows.
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is(cardinality(private.career_deletion_interview_session_ids('a0000000-0000-0000-0000-000000000001', 'experience',
            'a0000000-1111-0000-0000-000000000001', 'delete_projects')), 0, 'helper under B''s RLS sees no A session');
reset role;

select * from finish();
rollback;
