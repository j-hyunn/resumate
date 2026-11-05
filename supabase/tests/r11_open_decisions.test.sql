-- R11 open decisions (DM v4.11 11.6): OD-I6 kept interview records after an application project delete (schema,
-- BEFORE DELETE trigger, read-only guard, deletion impact, account deletion / inactivity purge / auth cascade,
-- cross-user isolation), OD-I1 d14.v1 scores (helper, live paths, backfill), OD-C6 p_client_id, OD-P11 assistant
-- row for an unanswered user message, OD-L2 disclosure v2026-11-05 reconsent.
-- Assertions filter on this test's users: the shared local DB may hold rows from integration test runs.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();
create schema r11t;
grant usage on schema r11t to authenticated, app_ai_writer, service_role;

insert into auth.users (id, email, aud, role) values
  ('a1100000-0000-0000-0000-000000000001', 'r11a@example.test', 'authenticated', 'authenticated'),
  ('b1100000-0000-0000-0000-000000000002', 'r11b@example.test', 'authenticated', 'authenticated'),
  ('c1100000-0000-0000-0000-000000000003', 'r11c@example.test', 'authenticated', 'authenticated'),
  ('d1100000-0000-0000-0000-000000000004', 'r11d@example.test', 'authenticated', 'authenticated'),
  ('e1100000-0000-0000-0000-000000000005', 'r11e@example.test', 'authenticated', 'authenticated');

create function r11t.eval_result(p_spec text, p_intent text, p_struct text, p_job text) returns jsonb language sql immutable as $$
  select jsonb_build_object('schema_version', 2, 'criteria', jsonb_build_array(
    jsonb_build_object('key', 'specificity', 'grade', p_spec), jsonb_build_object('key', 'intent_fit', 'grade', p_intent),
    jsonb_build_object('key', 'structure', 'grade', p_struct), jsonb_build_object('key', 'job_relevance', 'grade', p_job)))
$$;

-- A session of p_uid in project p_project (null = detached fixture is not built here). p_answers per question:
-- ok (submitted + succeeded evaluation, grades fair/good/good/n.a. = 66) | fail (submitted, failed evaluation) |
-- unanswered | draft. p_score: the answers' / session's score_status as the old code left them (legacy fixtures).
create function r11t.mk(p_uid uuid, p_project uuid, p_sid uuid, p_status text, p_answers text[],
                        p_legacy boolean default false) returns void language plpgsql as $$
declare
  v_k int := 0;
  v_a text;
  v_q uuid;
  v_ans uuid;
  v_submitted boolean := p_status not in ('in_progress', 'abandoned');
begin
  insert into public.interview_sessions (id, user_id, application_project_id, interview_type, data_sufficiency, status,
                                         generation_status, question_provider, question_model, submitted_at, completed_at,
                                         abandoned_at, score_status, score_counted_count, unanswered_count)
  values (p_sid, p_uid, p_project, 'job', 'ok', p_status, 'ready', 'gemini', 'm',
          case when v_submitted then now() end, case when p_status = 'completed' then now() end,
          case when p_status = 'abandoned' then now() end,
          case when p_legacy and p_status = 'completed'
               then case when 'ok' = any (p_answers) then 'pending_method' else 'not_scored' end end,
          case when p_legacy and p_status = 'completed'
               then (select count(*) from unnest(p_answers) x where x = 'ok') end,
          (select count(*) from unnest(p_answers) x where x = 'unanswered'));
  foreach v_a in array p_answers loop
    v_k := v_k + 1;
    v_q := gen_random_uuid();
    v_ans := gen_random_uuid();
    insert into public.interview_questions (id, user_id, session_id, sequence, source_kind, anchor, question_text, intent)
      values (v_q, p_uid, p_sid, v_k, 'project_deep_dive', 'experience', 'q' || v_k, 'i');
    insert into public.interview_answers (id, user_id, session_id, question_id, answer_text, status, score_status)
      values (v_ans, p_uid, p_sid, v_q, case when v_a in ('unanswered', 'draft') then '' else 'answer' end,
              case when v_a = 'unanswered' then 'unanswered' when v_a = 'draft' or not v_submitted then 'draft' else 'submitted' end,
              case when v_a = 'unanswered' then 'unanswered'
                   when v_a = 'draft' or not v_submitted then null
                   when v_a = 'ok' then case when p_legacy then 'pending_method' else 'pending_method' end
                   else 'not_scored' end);
    if v_a = 'ok' and v_submitted then
      insert into public.answer_evaluations (user_id, session_id, answer_id, status, result, completed_at, schema_version,
                                             prompt_version, provider, model, model_tier, connection_tier)
      values (p_uid, p_sid, v_ans, 'succeeded', r11t.eval_result('fair', 'good', 'good', 'not_applicable'), now(), 2,
              'p', 'gemini', 'm', 'default', 'free');
    elsif v_a = 'fail' and v_submitted then
      insert into public.answer_evaluations (user_id, session_id, answer_id, status, error_code)
      values (p_uid, p_sid, v_ans, 'failed', 'rate_limited');
    end if;
  end loop;
end $$;
grant execute on all functions in schema r11t to authenticated, app_ai_writer, service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- OD-I6 schema
-- ══════════════════════════════════════════════════════════════════════════════
select col_is_null('public', 'interview_sessions', 'application_project_id', 'sessions: application_project_id nullable');
select has_column('public', 'interview_sessions', 'company_name_snapshot', 'sessions: company_name_snapshot');
select has_column('public', 'interview_sessions', 'position_title_snapshot', 'sessions: position_title_snapshot');
select col_is_null('public', 'evidence_links', 'application_project_id', 'evidence: application_project_id nullable');
select is((select pg_get_constraintdef(oid) from pg_constraint where conname = 'interview_sessions_application_project_fkey'),
          'FOREIGN KEY (application_project_id, user_id) REFERENCES application_projects(id, user_id) ON DELETE SET NULL (application_project_id)',
          'sessions FK: on delete set null (application_project_id)');
select is((select confdeltype::text from pg_constraint where conname = 'evidence_links_application_project_fkey'), 'c',
          'evidence FK stays cascade');
select has_trigger('public', 'application_projects', 'application_projects_detach_interviews', 'BEFORE DELETE trigger');
select is((select prosecdef from pg_proc where oid = 'private.application_projects_detach_interviews()'::regprocedure), true,
          'trigger function is security definer');

-- ══════════════════════════════════════════════════════════════════════════════
-- OD-I6 fixtures (user A project P1 with JD; user B project PB)
-- ══════════════════════════════════════════════════════════════════════════════
insert into public.experiences (id, user_id, company_name) values
  ('a1100000-1111-0000-0000-000000000001', 'a1100000-0000-0000-0000-000000000001', 'A사');
insert into public.projects (id, user_id, experience_id, name) values
  ('a1100000-3333-0000-0000-000000000001', 'a1100000-0000-0000-0000-000000000001', 'a1100000-1111-0000-0000-000000000001', '결제 API');
insert into public.application_projects (id, user_id, name, name_source) values
  ('a1100000-aaaa-0000-0000-000000000001', 'a1100000-0000-0000-0000-000000000001', 'P1', 'user'),
  ('a1100000-aaaa-0000-0000-000000000002', 'a1100000-0000-0000-0000-000000000001', 'P2', 'user'),
  ('b1100000-aaaa-0000-0000-000000000001', 'b1100000-0000-0000-0000-000000000002', 'PB', 'user');
insert into public.job_descriptions (id, user_id, application_project_id, raw_text, raw_text_hash, sentences, company_name,
                                     company_name_source, position_title, position_title_source) values
  ('a1100000-1d00-0000-0000-000000000001', 'a1100000-0000-0000-0000-000000000001', 'a1100000-aaaa-0000-0000-000000000001',
   'x', 'h', '[{"sid":"S1","text":"x","start":0,"end":1}]', '가나회사', 'user', '백엔드 개발자', 'user');
insert into public.jd_requirements (id, user_id, job_description_id, category, content, source_sids) values
  ('a1100000-8888-0000-0000-000000000001', 'a1100000-0000-0000-0000-000000000001', 'a1100000-1d00-0000-0000-000000000001',
   'required', 'Go', '{S1}');
insert into public.application_stage_events (user_id, application_project_id, event_type, to_stage) values
  ('a1100000-0000-0000-0000-000000000001', 'a1100000-aaaa-0000-0000-000000000001', 'created', 'before_apply'),
  ('a1100000-0000-0000-0000-000000000001', 'a1100000-aaaa-0000-0000-000000000001', 'created', 'before_apply');
insert into public.insights (id, user_id, application_project_id, version_no, is_latest, status, result,
                             match_stage_result, requirements_hash, career_snapshot_hash, input_hash, schema_version,
                             prompt_version, provider, model, model_tier, connection_tier, completed_at)
values ('a1100000-1a51-0000-0000-000000000001', 'a1100000-0000-0000-0000-000000000001',
        'a1100000-aaaa-0000-0000-000000000001', 1, true, 'ready', '{}', '{}', 'rh', 'ch', 'ih', 1, 'pv', 'gemini', 'm',
        'default', 'free', now());
insert into public.drafts (id, user_id, application_project_id, draft_type, title, status) values
  ('a1100000-cccc-0000-0000-000000000001', 'a1100000-0000-0000-0000-000000000001', 'a1100000-aaaa-0000-0000-000000000001',
   'cover_letter', '자소서', 'composing'),
  ('a1100000-cccc-0000-0000-000000000002', 'a1100000-0000-0000-0000-000000000001', 'a1100000-aaaa-0000-0000-000000000001',
   'career_description', '경력기술서', 'composing');

-- S1 completed (one ok, one failed = regrade target, one unanswered), S2 evaluating, S3 abandoned, S4 evaluation_failed,
-- S5 completed second kept session; SB = user B's completed session.
select r11t.mk('a1100000-0000-0000-0000-000000000001', 'a1100000-aaaa-0000-0000-000000000001',
               'a1100000-5e55-0000-0000-000000000001', 'completed', array['ok', 'fail', 'unanswered']);
select r11t.mk('a1100000-0000-0000-0000-000000000001', 'a1100000-aaaa-0000-0000-000000000001',
               'a1100000-5e55-0000-0000-000000000002', 'evaluating', array['ok']);
select r11t.mk('a1100000-0000-0000-0000-000000000001', 'a1100000-aaaa-0000-0000-000000000001',
               'a1100000-5e55-0000-0000-000000000003', 'abandoned', array['draft']);
select r11t.mk('a1100000-0000-0000-0000-000000000001', 'a1100000-aaaa-0000-0000-000000000001',
               'a1100000-5e55-0000-0000-000000000004', 'evaluation_failed', array['fail']);
select r11t.mk('a1100000-0000-0000-0000-000000000001', 'a1100000-aaaa-0000-0000-000000000001',
               'a1100000-5e55-0000-0000-000000000005', 'completed', array['ok']);
select r11t.mk('b1100000-0000-0000-0000-000000000002', 'b1100000-aaaa-0000-0000-000000000001',
               'b1100000-5e55-0000-0000-000000000001', 'completed', array['ok']);
update public.interview_sessions set evaluation_job_id = null where user_id = 'a1100000-0000-0000-0000-000000000001';

-- Jobs: J2 = S2's running evaluation (project-scoped, cascades); J2b = a project-less question job on S2, so the
-- session delete trigger's cancel request stays visible after the project is gone.
insert into public.ai_jobs (id, user_id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier, heartbeat_at) values
  ('a1100000-7777-0000-0000-000000000002', 'a1100000-0000-0000-0000-000000000001', 'interview_evaluation',
   'a1100000-aaaa-0000-0000-000000000001', 'interview_session', 'a1100000-5e55-0000-0000-000000000002', 'running', 1,
   'gemini', 'default', 'free', now()),
  ('a1100000-7777-0000-0000-000000000003', 'a1100000-0000-0000-0000-000000000001', 'interview_questions',
   null, 'interview_session', 'a1100000-5e55-0000-0000-000000000002', 'running', 1, 'gemini', 'default', 'free', now());

-- Evidence of S1 (question: JD requirement + career project; evaluation: career project; feedback: JD requirement),
-- of S2 (deleted with it) and an insight link (deleted with the project).
insert into public.session_feedbacks (id, user_id, session_id, status, result, completed_at, schema_version, prompt_version,
                                      provider, model, model_tier, connection_tier)
values ('a1100000-fb00-0000-0000-000000000001', 'a1100000-0000-0000-0000-000000000001', 'a1100000-5e55-0000-0000-000000000001',
        'succeeded', '{"headline":"h"}', now(), 1, 'p', 'gemini', 'm', 'default', 'free');
insert into public.evidence_links (user_id, application_project_id, owner_type, owner_id, item_key, source_type, source_id,
                                   source_field, quote)
select 'a1100000-0000-0000-0000-000000000001', 'a1100000-aaaa-0000-0000-000000000001', x.owner_type, x.owner_id, x.item_key,
       x.source_type, x.source_id, x.source_field, x.quote
  from (values
    ('interview_question', (select id from public.interview_questions where session_id = 'a1100000-5e55-0000-0000-000000000001' and sequence = 1),
     'question', 'jd_requirement', 'a1100000-8888-0000-0000-000000000001'::uuid, null, 'Go'),
    ('interview_question', (select id from public.interview_questions where session_id = 'a1100000-5e55-0000-0000-000000000001' and sequence = 1),
     'question', 'project', 'a1100000-3333-0000-0000-000000000001'::uuid, 'name', '결제 API'),
    ('answer_evaluation', (select e.id from public.answer_evaluations e join public.interview_answers a on a.id = e.answer_id
                            join public.interview_questions q on q.id = a.question_id
                           where e.session_id = 'a1100000-5e55-0000-0000-000000000001' and q.sequence = 1),
     'model_answer', 'project', 'a1100000-3333-0000-0000-000000000001'::uuid, 'name', '결제 API'),
    ('session_feedback', 'a1100000-fb00-0000-0000-000000000001'::uuid, 'headline', 'jd_requirement',
     'a1100000-8888-0000-0000-000000000001'::uuid, null, 'Go'),
    ('interview_question', (select id from public.interview_questions where session_id = 'a1100000-5e55-0000-0000-000000000002' and sequence = 1),
     'question', 'jd_requirement', 'a1100000-8888-0000-0000-000000000001'::uuid, null, 'Go'),
    ('insight', 'a1100000-1a51-0000-0000-000000000001'::uuid, 'requirements.0', 'jd_requirement',
     'a1100000-8888-0000-0000-000000000001'::uuid, null, 'Go')
  ) x (owner_type, owner_id, item_key, source_type, source_id, source_field, quote);

-- CHECKs
select throws_ok($$update public.interview_sessions set application_project_id = null
                    where id = 'a1100000-5e55-0000-0000-000000000002'$$,
                 '23514', null, 'detached_check: only a completed session may lose its project');
select throws_ok($$update public.evidence_links set application_project_id = null
                    where owner_type = 'insight' and owner_id = 'a1100000-1a51-0000-0000-000000000001'$$,
                 '23514', null, 'evidence detached_check: insight evidence needs its project');
select throws_ok($$update public.interview_sessions set company_name_snapshot = repeat('가', 201)
                    where id = 'a1100000-5e55-0000-0000-000000000001'$$,
                 '23514', null, 'company_name_snapshot <= 200');

-- ── get_deletion_impact('application_project') ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1100000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.get_deletion_impact('application_project', 'a1100000-aaaa-0000-0000-000000000001'),
          '{"cascade": {"insights": 1, "drafts": 1, "interview_sessions": 3, "stage_events": 2},
            "kept": {"interview_sessions": 2}}'::jsonb,
          'impact: cascade (insights, drafts w/o composing career description, non-completed sessions, events) + kept');
select is(public.get_deletion_impact('application_project', 'a1100000-aaaa-0000-0000-000000000001', 'keep_projects')
            -> 'kept', '{"interview_sessions": 2}'::jsonb, 'impact: affiliation_mode ignored');
select throws_ok($$select public.get_deletion_impact('application_project', 'b1100000-aaaa-0000-0000-000000000001')$$,
                 'P0001', 'not_found', 'impact: another user''s project -> not_found');
select throws_ok($$select public.get_deletion_impact('application_project', gen_random_uuid())$$,
                 'P0001', 'not_found', 'impact: unknown project -> not_found');
select throws_ok($$select public.delete_career_item('application_project', 'a1100000-aaaa-0000-0000-000000000001')$$,
                 'P0001', 'invalid_entity_type', 'delete_career_item does not take application_project');
select is((select count(*)::int from public.application_projects where id = 'a1100000-aaaa-0000-0000-000000000001'), 1,
          'project still there');

-- ── the delete (user session, RLS) ──
select lives_ok($$delete from public.application_projects where id = 'a1100000-aaaa-0000-0000-000000000001'$$,
                'user deletes the application project');
reset role;

select results_eq($$select id, application_project_id, company_name_snapshot, position_title_snapshot, status
                      from public.interview_sessions where user_id = 'a1100000-0000-0000-0000-000000000001' order by id$$,
                  $$values ('a1100000-5e55-0000-0000-000000000001'::uuid, null::uuid, '가나회사'::text, '백엔드 개발자'::text, 'completed'::text),
                           ('a1100000-5e55-0000-0000-000000000005'::uuid, null::uuid, '가나회사'::text, '백엔드 개발자'::text, 'completed'::text)$$,
                  'completed sessions kept, detached, JD names copied; the other three deleted');
select results_eq($$select (select count(*)::int from public.interview_questions where session_id = 'a1100000-5e55-0000-0000-000000000001'),
                           (select count(*)::int from public.interview_answers where session_id = 'a1100000-5e55-0000-0000-000000000001'),
                           (select count(*)::int from public.answer_evaluations where session_id = 'a1100000-5e55-0000-0000-000000000001'),
                           (select count(*)::int from public.session_feedbacks where session_id = 'a1100000-5e55-0000-0000-000000000001')$$,
                  $$values (3, 3, 2, 1)$$, 'kept session: questions / answers / evaluations / feedback kept');
select is((select count(*)::int from public.interview_questions q join public.interview_sessions s on s.id = q.session_id
            where s.user_id = 'a1100000-0000-0000-0000-000000000001'
              and s.id in ('a1100000-5e55-0000-0000-000000000002', 'a1100000-5e55-0000-0000-000000000003',
                           'a1100000-5e55-0000-0000-000000000004')), 0, 'deleted sessions'' children gone');
select results_eq($$select owner_type, source_type, application_project_id, quote, source_deleted_at is not null
                      from public.evidence_links where user_id = 'a1100000-0000-0000-0000-000000000001'
                     order by owner_type, source_type$$,
                  $$values ('answer_evaluation'::text, 'project'::text, null::uuid, '결제 API'::text, false),
                           ('interview_question', 'jd_requirement', null, null, true),
                           ('interview_question', 'project', null, '결제 API', false),
                           ('session_feedback', 'jd_requirement', null, null, true)$$,
                  'kept evidence detached; JD sources "원본 삭제됨", career source live; S2 and insight evidence gone');
select results_eq($$select id, cancel_requested_at is not null from public.ai_jobs
                     where user_id = 'a1100000-0000-0000-0000-000000000001' order by id$$,
                  $$values ('a1100000-7777-0000-0000-000000000003'::uuid, true)$$,
                  'deleted session''s jobs: cancel requested (project job cascaded away)');
select results_eq($$select (select count(*)::int from public.job_descriptions where user_id = 'a1100000-0000-0000-0000-000000000001'),
                           (select count(*)::int from public.insights where user_id = 'a1100000-0000-0000-0000-000000000001'),
                           (select count(*)::int from public.drafts where user_id = 'a1100000-0000-0000-0000-000000000001'),
                           (select count(*)::int from public.application_stage_events where user_id = 'a1100000-0000-0000-0000-000000000001')$$,
                  $$values (0, 0, 0, 0)$$, 'the rest of the project cascades as before');
select results_eq($$select id, application_project_id from public.interview_sessions
                     where user_id = 'b1100000-0000-0000-0000-000000000002'$$,
                  $$values ('b1100000-5e55-0000-0000-000000000001'::uuid, 'b1100000-aaaa-0000-0000-000000000001'::uuid)$$,
                  'user B untouched');

-- ── read-only guard ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1100000-0000-0000-0000-000000000001","role":"authenticated"}';
select results_eq($$select decision, regrade_target_count from public.get_interview_grading_decisions(
                      array['a1100000-5e55-0000-0000-000000000001'::uuid])$$,
                  $$values ('none'::text, 1)$$, 'detached session: decision none even with a regrade target');
select is(public.mark_interview_result_viewed('a1100000-5e55-0000-0000-000000000001') ->> 'changed', 'true',
          'result viewed mark still allowed');
select throws_ok($$select public.create_interview_session('a1100000-aaaa-0000-0000-000000000002', 'job', 5, 'ok',
                   'a1100000-5e55-0000-0000-000000000001')$$,
                 'P0001', 'session_id_conflict', 'create with a detached session id -> session_id_conflict (not a replay)');
select is((public.create_interview_session('a1100000-aaaa-0000-0000-000000000002', 'job', 3, 'ok')
            ->> 'application_project_id')::uuid, 'a1100000-aaaa-0000-0000-000000000002'::uuid,
          'create always sets application_project_id');
select is((select count(*)::int from public.interview_sessions where user_id = 'a1100000-0000-0000-0000-000000000001'
              and application_project_id is null and status <> 'completed'), 0, 'no detached non-completed session');
-- B cannot see A's kept session.
set local request.jwt.claims = '{"sub":"b1100000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.interview_sessions where id = 'a1100000-5e55-0000-0000-000000000001'), 0,
          'B cannot read A''s kept session');
select is((select count(*)::int from public.evidence_links where user_id = 'a1100000-0000-0000-0000-000000000001'), 0,
          'B cannot read A''s detached evidence');
reset role;

insert into public.ai_jobs (id, user_id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier) values
  ('a1100000-7777-0000-0000-000000000009', 'a1100000-0000-0000-0000-000000000001', 'interview_evaluation',
   null, 'interview_session', 'a1100000-5e55-0000-0000-000000000001', 'running', 1, 'gemini', 'default', 'free');
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a1100000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select throws_ok($$select public.begin_interview_evaluation('a1100000-5e55-0000-0000-000000000001',
                   'a1100000-7777-0000-0000-000000000009', 'gemini', 'm')$$,
                 'P0001', 'interview_session_read_only', 'begin_interview_evaluation: read-only');
select throws_ok($$select public.complete_interview_evaluation('a1100000-5e55-0000-0000-000000000001',
                   'a1100000-7777-0000-0000-000000000009', 1)$$,
                 'P0001', 'interview_session_read_only', 'complete_interview_evaluation: read-only');
select throws_ok(format($$select public.save_answer_evaluation(%L, 'a1100000-7777-0000-0000-000000000009', 1, '{}')$$,
                        (select a.id from public.interview_answers a join public.interview_questions q on q.id = a.question_id
                          where a.session_id = 'a1100000-5e55-0000-0000-000000000001' and q.sequence = 2)),
                 'P0001', 'interview_session_read_only', 'save_answer_evaluation: read-only');
reset role;

-- ── career deletion sees kept sessions ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1100000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.get_deletion_impact('project', 'a1100000-3333-0000-0000-000000000001') -> 'affected_results',
          '{"by_application_project": [], "detached_interview_sessions": 1}'::jsonb,
          'career impact: detached_interview_sessions counts the kept session citing the project');
select lives_ok($$select public.delete_career_item('project', 'a1100000-3333-0000-0000-000000000001', 'delete_projects',
                  'delete_results')$$, 'delete the project with its results');
reset role;
select results_eq($$select id from public.interview_sessions where user_id = 'a1100000-0000-0000-0000-000000000001'
                       and application_project_id is null order by id$$,
                  $$values ('a1100000-5e55-0000-0000-000000000005'::uuid)$$,
                  'delete_results removed the kept session that cited the project; the other kept session stays');

-- user may delete a kept session
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1100000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$delete from public.interview_sessions where id = 'a1100000-5e55-0000-0000-000000000005'$$,
                'user deletes a kept session');
reset role;
select is((select count(*)::int from public.interview_sessions where id = 'a1100000-5e55-0000-0000-000000000005'), 0,
          'kept session deleted');

-- ── account deletion / inactivity purge / auth.users cascade delete everything ──
insert into public.application_projects (id, user_id, name, name_source) values
  ('c1100000-aaaa-0000-0000-000000000001', 'c1100000-0000-0000-0000-000000000003', 'C', 'user'),
  ('d1100000-aaaa-0000-0000-000000000001', 'd1100000-0000-0000-0000-000000000004', 'D', 'user'),
  ('e1100000-aaaa-0000-0000-000000000001', 'e1100000-0000-0000-0000-000000000005', 'E', 'user');
select r11t.mk(u, p, s, st, array['ok', 'unanswered'])
  from (values ('c1100000-0000-0000-0000-000000000003'::uuid, 'c1100000-aaaa-0000-0000-000000000001'::uuid,
                'c1100000-5e55-0000-0000-000000000001'::uuid, 'completed'),
               ('c1100000-0000-0000-0000-000000000003', 'c1100000-aaaa-0000-0000-000000000001',
                'c1100000-5e55-0000-0000-000000000002', 'evaluating'),
               ('d1100000-0000-0000-0000-000000000004', 'd1100000-aaaa-0000-0000-000000000001',
                'd1100000-5e55-0000-0000-000000000001', 'completed'),
               ('e1100000-0000-0000-0000-000000000005', 'e1100000-aaaa-0000-0000-000000000001',
                'e1100000-5e55-0000-0000-000000000001', 'completed')) x (u, p, s, st);
-- C also had an earlier kept (detached) session.
select r11t.mk('c1100000-0000-0000-0000-000000000003', 'c1100000-aaaa-0000-0000-000000000001',
               'c1100000-5e55-0000-0000-000000000003', 'completed', array['ok']);
update public.interview_sessions set application_project_id = null where id = 'c1100000-5e55-0000-0000-000000000003';

create function r11t.leftovers(p_uid uuid) returns integer language sql as $$
  select ((select count(*) from public.interview_sessions where user_id = p_uid)
        + (select count(*) from public.interview_questions where user_id = p_uid)
        + (select count(*) from public.interview_answers where user_id = p_uid)
        + (select count(*) from public.answer_evaluations where user_id = p_uid)
        + (select count(*) from public.session_feedbacks where user_id = p_uid)
        + (select count(*) from public.evidence_links where user_id = p_uid)
        + (select count(*) from public.application_projects where user_id = p_uid))::integer
$$;
select ok(r11t.leftovers('c1100000-0000-0000-0000-000000000003') > 0, 'C has interview data before deletion');

set local role authenticated;
set local request.jwt.claims = '{"sub":"c1100000-0000-0000-0000-000000000003","role":"authenticated"}';
select lives_ok($$select public.delete_account(repeat('c', 64))$$, 'delete_account runs with kept sessions');
reset role;
select is(r11t.leftovers('c1100000-0000-0000-0000-000000000003'), 0, 'delete_account: nothing kept (incl. detached sessions)');

select lives_ok($$select private.delete_account_data('d1100000-0000-0000-0000-000000000004', repeat('d', 64), 'inactivity')$$,
                'inactivity purge body (purge_inactive_account) runs');
select is(r11t.leftovers('d1100000-0000-0000-0000-000000000004'), 0, 'inactivity purge: nothing kept');

select lives_ok($$delete from auth.users where id = 'e1100000-0000-0000-0000-000000000005'$$, 'auth.users delete cascades');
select is(r11t.leftovers('e1100000-0000-0000-0000-000000000005'), 0, 'auth.users cascade: nothing kept');

-- ══════════════════════════════════════════════════════════════════════════════
-- OD-I1 d14.v1
-- ══════════════════════════════════════════════════════════════════════════════
select is(private.interview_answer_score_d14v1(r11t.eval_result('fair', 'good', 'good', 'not_applicable')),
          '{"value": 66, "rationale": "구체성 보완 필요 · 의도 부합 양호 · 구조 양호 · JD 연관성 해당 없음 → 66점"}'::jsonb,
          'AI 4.3 example: 65.625 -> 66, rationale');
select is(private.interview_answer_score_d14v1(r11t.eval_result('excellent', 'good', 'good', 'good')) -> 'value', '83'::jsonb,
          '82.5 rounds up to 83');
select is(private.interview_answer_score_d14v1(r11t.eval_result('excellent', 'excellent', 'excellent', 'excellent')) -> 'value',
          '100'::jsonb, 'all excellent = 100');
select is(private.interview_answer_score_d14v1(r11t.eval_result('poor', 'poor', 'poor', 'poor')) ->> 'rationale',
          '구체성 미흡 · 의도 부합 미흡 · 구조 미흡 · JD 연관성 미흡 → 25점', 'all poor = 25');
select is(private.interview_answer_score_d14v1('{"criteria": []}'), '{"value": null, "rationale": null}'::jsonb,
          'no criteria -> no score [가정]');
select is(private.interview_answer_score_d14v1(jsonb_build_object('criteria', jsonb_build_array(
            jsonb_build_object('key', 'structure', 'grade', 'good'), jsonb_build_object('key', 'specificity', 'grade', 'poor'),
            jsonb_build_object('key', 'specificity', 'grade', 'excellent'), jsonb_build_object('key', 'tone', 'grade', 'good')))),
          '{"value": 45, "rationale": "구체성 미흡 · 구조 양호 → 45점"}'::jsonb,
          'first entry per key, unknown keys ignored, display order by criterion');

-- Live path: S7 (B) with ok / fail / unanswered via the AI writer RPCs.
insert into public.application_projects (id, user_id, name, name_source) values
  ('b1100000-aaaa-0000-0000-000000000002', 'b1100000-0000-0000-0000-000000000002', 'PB2', 'user');
select r11t.mk('b1100000-0000-0000-0000-000000000002', 'b1100000-aaaa-0000-0000-000000000002',
               'b1100000-5e55-0000-0000-000000000007', 'evaluating', array['draft', 'draft', 'unanswered']);
update public.interview_answers a set status = 'submitted', answer_text = 'answer', score_status = null
 where a.session_id = 'b1100000-5e55-0000-0000-000000000007' and a.status = 'draft';
insert into public.ai_jobs (id, user_id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier) values
  ('b1100000-7777-0000-0000-000000000007', 'b1100000-0000-0000-0000-000000000002', 'interview_evaluation',
   'b1100000-aaaa-0000-0000-000000000002', 'interview_session', 'b1100000-5e55-0000-0000-000000000007', 'running', 1,
   'gemini', 'default', 'free');
create function r11t.ans(p_sid uuid, p_seq int) returns uuid language sql as
  $$ select a.id from public.interview_answers a join public.interview_questions q on q.id = a.question_id
      where a.session_id = p_sid and q.sequence = p_seq $$;
grant execute on all functions in schema r11t to authenticated, app_ai_writer, service_role;
select set_config('t.payload', jsonb_build_object(
  'result', r11t.eval_result('fair', 'good', 'good', 'not_applicable') || '{"score":{"status":"scored","value":99}}',
  'hashes', jsonb_build_object('input_hash', 'i', 'career_snapshot_hash', 'c'),
  'meta', jsonb_build_object('schema_version', 2, 'prompt_version', 'p', 'provider', 'gemini', 'model', 'm',
                             'model_tier', 'default', 'connection_tier', 'free'),
  'evidence', '[]'::jsonb)::text, true);

set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"b1100000-0000-0000-0000-000000000002","role":"app_ai_writer"}';
select lives_ok($$select public.begin_interview_evaluation('b1100000-5e55-0000-0000-000000000007',
                  'b1100000-7777-0000-0000-000000000007', 'gemini', 'm')$$, 'begin S7');
select results_eq(format($$select r ->> 'score_status', (r ->> 'score_value')::int
                             from public.save_answer_evaluation(%L, 'b1100000-7777-0000-0000-000000000007', 1, %L::jsonb) r$$,
                         r11t.ans('b1100000-5e55-0000-0000-000000000007', 1), current_setting('t.payload')),
                  $$values ('scored'::text, 66)$$, 'save_answer_evaluation writes the d14.v1 score (model value ignored)');
select is(public.fail_answer_evaluation(r11t.ans('b1100000-5e55-0000-0000-000000000007', 2),
                                        'b1100000-7777-0000-0000-000000000007', 'rate_limited'), true, 'answer 2 fails');
select lives_ok(format($$select public.save_session_feedback('b1100000-5e55-0000-0000-000000000007',
                  'b1100000-7777-0000-0000-000000000007', 1, %L::jsonb)$$, current_setting('t.payload')), 'feedback');
select results_eq($$select r ->> 'status', r ->> 'score_status', (r ->> 'score_value')::int, (r ->> 'score_counted_count')::int
                      from public.complete_interview_evaluation('b1100000-5e55-0000-0000-000000000007',
                        'b1100000-7777-0000-0000-000000000007', 1) r$$,
                  $$values ('completed'::text, 'scored'::text, 33, 1)$$, 'complete: session score 66 / (1 + 1 unanswered) = 33');
reset role;
select results_eq($$select score_status, score_value, score_max, score_method_version, score_rationale, score_counted_count,
                           unanswered_count
                      from public.interview_sessions where id = 'b1100000-5e55-0000-0000-000000000007'$$,
                  $$values ('scored'::text, 33::numeric, 100::numeric, 'd14.v1'::text,
                            '질문 3개 중 채점 1개 평균, 미응답 1개는 0점으로 포함, 채점하지 못한 1개는 빼고 계산'::text, 1, 1)$$,
                  'session row: value, max, method, rationale, counts');
select results_eq($$select q.sequence, a.score_status, a.score_value, a.score_max, a.score_method_version, a.score_rationale
                      from public.interview_answers a join public.interview_questions q on q.id = a.question_id
                     where a.session_id = 'b1100000-5e55-0000-0000-000000000007' order by q.sequence$$,
                  $$values (1, 'scored'::text, 66::numeric, 100::numeric, 'd14.v1'::text,
                            '구체성 보완 필요 · 의도 부합 양호 · 구조 양호 · JD 연관성 해당 없음 → 66점'::text),
                           (2, 'not_scored', null, null, null, null),
                           (3, 'unanswered', 0, 100, 'd14.v1', '미응답 · 0점')$$,
                  'question rows: scored / failed / unanswered');

-- re-evaluation clears the whole session score slot (A9)
update public.ai_jobs set status = 'succeeded' where id = 'b1100000-7777-0000-0000-000000000007';
insert into public.ai_jobs (id, user_id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier) values
  ('b1100000-7777-0000-0000-000000000008', 'b1100000-0000-0000-0000-000000000002', 'interview_evaluation',
   'b1100000-aaaa-0000-0000-000000000002', 'interview_session', 'b1100000-5e55-0000-0000-000000000007', 'running', 1,
   'gemini', 'default', 'free');
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"b1100000-0000-0000-0000-000000000002","role":"app_ai_writer"}';
select lives_ok($$select public.begin_interview_evaluation('b1100000-5e55-0000-0000-000000000007',
                  'b1100000-7777-0000-0000-000000000008', 'gemini', 'm')$$, 're-evaluation begins');
reset role;
select results_eq($$select status, score_status, score_value, score_max, score_method_version, score_rationale
                      from public.interview_sessions where id = 'b1100000-5e55-0000-0000-000000000007'$$,
                  $$values ('evaluating'::text, null::text, null::numeric, null::numeric, null::text, null::text)$$,
                  're-evaluation: session score slot cleared');

-- answered but none scored -> not_scored (helper, e.g. a succeeded evaluation without usable grades)
select r11t.mk('b1100000-0000-0000-0000-000000000002', 'b1100000-aaaa-0000-0000-000000000001',
               'b1100000-5e55-0000-0000-000000000009', 'completed', array['fail', 'unanswered']);
select is(private.interview_apply_scores_d14v1('b1100000-5e55-0000-0000-000000000009', true) ->> 'score_status', 'not_scored',
          'answered >= 1, none scored -> session not_scored');
select results_eq($$select score_status, score_value, score_counted_count, unanswered_count
                      from public.interview_sessions where id = 'b1100000-5e55-0000-0000-000000000009'$$,
                  $$values ('not_scored'::text, null::numeric, 0, 1)$$, 'not_scored session row');

-- ── backfill_interview_scores ──
-- Legacy rows as the old code left them: L1 completed with pending_method answers, L2 zero-answer not_scored.
select r11t.mk('b1100000-0000-0000-0000-000000000002', 'b1100000-aaaa-0000-0000-000000000001',
               'b1100000-5e55-0000-0000-00000000000a', 'completed', array['ok', 'ok', 'unanswered'], true);
select r11t.mk('b1100000-0000-0000-0000-000000000002', 'b1100000-aaaa-0000-0000-000000000001',
               'b1100000-5e55-0000-0000-00000000000b', 'completed', array['unanswered', 'unanswered'], true);
select results_eq($$select score_status, score_counted_count from public.interview_sessions
                     where id in ('b1100000-5e55-0000-0000-00000000000a', 'b1100000-5e55-0000-0000-00000000000b') order by id$$,
                  $$values ('pending_method'::text, 2), ('not_scored', 0)$$, 'legacy fixtures');

set local role authenticated;
set local request.jwt.claims = '{"sub":"b1100000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$select public.backfill_interview_scores()$$, '42501', null, 'authenticated cannot backfill');
reset role;
set local role app_ai_writer;
select throws_ok($$select public.backfill_interview_scores()$$, '42501', null, 'app_ai_writer cannot backfill');
reset role;
set local role service_role;
select throws_ok($$select public.backfill_interview_scores(0)$$, 'P0001', 'invalid_limit', 'p_limit must be >= 1');
select ok((public.backfill_interview_scores(1) ->> 'sessions')::int <= 1, 'p_limit bounds the sessions per call');
select ok((public.backfill_interview_scores() ->> 'answers')::int >= 0, 'backfill runs');
select is(public.backfill_interview_scores(), '{"sessions": 0, "answers": 0}'::jsonb, 'idempotent: a second call does nothing');
reset role;
select results_eq($$select id, score_status, score_value, score_method_version, score_rationale, score_counted_count
                      from public.interview_sessions
                     where id in ('b1100000-5e55-0000-0000-00000000000a', 'b1100000-5e55-0000-0000-00000000000b') order by id$$,
                  $$values ('b1100000-5e55-0000-0000-00000000000a'::uuid, 'scored'::text, 44::numeric, 'd14.v1'::text,
                            '질문 3개 중 채점 2개 평균, 미응답 1개는 0점으로 포함'::text, 2),
                           ('b1100000-5e55-0000-0000-00000000000b', 'scored', 0, 'd14.v1', '질문 2개 모두 미응답, 0점', 0)$$,
                  'backfill: (66 + 66 + 0) / 3 = 44; all unanswered = 0');
select is((select count(*)::int from public.interview_answers
            where session_id in ('b1100000-5e55-0000-0000-00000000000a', 'b1100000-5e55-0000-0000-00000000000b')
              and score_method_version = 'd14.v1'), 5, 'backfill: every question row on d14.v1');

-- ══════════════════════════════════════════════════════════════════════════════
-- OD-C6 p_client_id
-- ══════════════════════════════════════════════════════════════════════════════
select has_function('public', 'save_project_page', array['uuid', 'jsonb', 'timestamp with time zone', 'jsonb', 'uuid'],
                    'save_project_page takes p_client_id');
select hasnt_function('public', 'save_project_page', array['uuid', 'jsonb', 'timestamp with time zone', 'jsonb'],
                      'old save_project_page signature dropped');
select has_function('public', 'save_project_deliverable',
                    array['uuid', 'uuid', 'text', 'text', 'timestamp with time zone', 'jsonb', 'uuid'],
                    'save_project_deliverable takes p_client_id');
select hasnt_function('public', 'save_project_deliverable',
                      array['uuid', 'uuid', 'text', 'text', 'timestamp with time zone', 'jsonb'],
                      'old save_project_deliverable signature dropped');

insert into public.experiences (id, user_id, company_name) values
  ('a1100000-1111-0000-0000-000000000002', 'a1100000-0000-0000-0000-000000000001', 'A2사');
insert into public.projects (id, user_id, name) values
  ('a1100000-3333-0000-0000-000000000009', 'a1100000-0000-0000-0000-000000000001', 'A standalone'),
  ('b1100000-3333-0000-0000-000000000009', 'b1100000-0000-0000-0000-000000000002', 'B standalone');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a1100000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((public.save_project_page(null, '{"name":"새 프로젝트","experience_id":"a1100000-1111-0000-0000-000000000002"}',
             null, null, 'a1100000-3333-0000-0000-0000000000c1') ->> 'project_id')::uuid,
          'a1100000-3333-0000-0000-0000000000c1'::uuid, 'create with p_client_id: row id = p_client_id');
select set_config('t.w', public.start_writing_chat('a1100000-3333-0000-0000-0000000000c1')::text, true);
select set_config('t.m', (select message_id::text from public.append_writing_chat_message(current_setting('t.w')::uuid,
  '결과는 응답 시간이 줄었어요')), true);
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a1100000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.w')::uuid, jsonb_build_object('ops', jsonb_build_array(
  jsonb_build_object('op', 'set', 'target', '{"section":"star","field":"result"}'::jsonb, 'value', '응답 시간이 줄었다',
                     'source_message_ids', jsonb_build_array(current_setting('t.m'))))))$$, 'a proposal in the new page''s chat');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1100000-0000-0000-0000-000000000001","role":"authenticated"}';
-- The screen lost the create response: it sends the same create request (p_project_id null, same client id).
select set_config('t.r1', public.save_project_page(null,
  '{"name":"새 프로젝트","experience_id":"a1100000-1111-0000-0000-000000000002","result":"응답 시간이 줄었다"}',
  '2000-01-01T00:00:00Z', jsonb_build_array(jsonb_build_object('writing_chat_id', current_setting('t.w'), 'field', 'result', 'rev', 1)),
  'a1100000-3333-0000-0000-0000000000c1')::text, true);
select set_config('t.r2', public.save_project_page(null,
  '{"name":"새 프로젝트","experience_id":"a1100000-1111-0000-0000-000000000002","result":"응답 시간이 줄었다"}',
  null, jsonb_build_array(jsonb_build_object('writing_chat_id', current_setting('t.w'), 'field', 'result', 'rev', 1)),
  'a1100000-3333-0000-0000-0000000000c1')::text, true);
select is((select count(*)::int from public.projects where name = '새 프로젝트'
              and user_id = 'a1100000-0000-0000-0000-000000000001'), 1, 'same p_client_id three times -> one row');
select is(current_setting('t.r1')::jsonb -> 'applied',
          jsonb_build_array(jsonb_build_object('writing_chat_id', current_setting('t.w'), 'field', 'result')),
          'replay: saved as an update of that row (expected version ignored), record applied');
select is(current_setting('t.r2')::jsonb -> 'skipped',
          jsonb_build_array(jsonb_build_object('writing_chat_id', current_setting('t.w'), 'field', 'result', 'reason', 'already_applied')),
          'second identical replay: already_applied');
select is((current_setting('t.r2')::jsonb ->> 'project_id')::uuid, 'a1100000-3333-0000-0000-0000000000c1'::uuid,
          'replay returns the same project id');
select is((select result from public.projects where id = 'a1100000-3333-0000-0000-0000000000c1'), '응답 시간이 줄었다',
          'replay values written');
select is(current_setting('t.r1')::jsonb ? 'created', false, 'no created field in the response');
-- update request ignores p_client_id
select is((public.save_project_page('a1100000-3333-0000-0000-0000000000c1', '{"task":"리드"}', null, null,
             'a1100000-3333-0000-0000-0000000000c2') ->> 'project_id')::uuid, 'a1100000-3333-0000-0000-0000000000c1'::uuid,
          'update request: p_client_id ignored');
select is((select count(*)::int from public.projects where id = 'a1100000-3333-0000-0000-0000000000c2'), 0,
          'update request did not create the client id row');
select throws_ok($$select public.save_project_page(null, '{"name":"x","experience_id":"a1100000-1111-0000-0000-000000000002"}',
                   null, null, 'a1100000-3333-0000-0000-000000000009')$$,
                 'P0001', 'project_not_affiliated', 'client id of a standalone project -> update rule project_not_affiliated');
select is((public.save_project_page(null, '{"name":"서버 id","experience_id":"a1100000-1111-0000-0000-000000000002"}')
             ->> 'project_id') is not null, true, 'null p_client_id: server id as before');
-- another user's id
select throws_ok($$select public.save_project_page(null, '{"name":"x","experience_id":"a1100000-1111-0000-0000-000000000002"}',
                   null, null, 'b1100000-3333-0000-0000-000000000009')$$,
                 'P0001', 'not_found', 'client id = another user''s project -> not_found');
reset role;
select is((select name from public.projects where id = 'b1100000-3333-0000-0000-000000000009'), 'B standalone',
          'B''s project untouched');

-- deliverables
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1100000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((public.save_project_deliverable(null, 'a1100000-3333-0000-0000-000000000009', '런북', '본문', null, null,
             'a1100000-4444-0000-0000-0000000000d1') ->> 'project_deliverable_id')::uuid,
          'a1100000-4444-0000-0000-0000000000d1'::uuid, 'deliverable create with p_client_id');
select is((public.save_project_deliverable(null, 'a1100000-3333-0000-0000-000000000009', '런북', '본문 2', '2000-01-01T00:00:00Z',
             null, 'a1100000-4444-0000-0000-0000000000d1') ->> 'project_deliverable_id')::uuid,
          'a1100000-4444-0000-0000-0000000000d1'::uuid, 'deliverable replay: same row, expected version ignored');
select results_eq($$select count(*)::int, max(body) from public.project_deliverables
                     where project_id = 'a1100000-3333-0000-0000-000000000009'$$,
                  $$values (1, '본문 2'::text)$$, 'deliverable: one row, replay values written');
select throws_ok($$select public.save_project_deliverable(null, 'a1100000-3333-0000-0000-0000000000c1', '런북', '본문', null, null,
                   'a1100000-4444-0000-0000-0000000000d1')$$,
                 'P0001', 'not_found', 'deliverable replay with another parent -> not_found');
reset role;
insert into public.project_deliverables (id, user_id, project_id, title, body) values
  ('b1100000-4444-0000-0000-000000000001', 'b1100000-0000-0000-0000-000000000002', 'b1100000-3333-0000-0000-000000000009', 'B', 'b');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1100000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.save_project_deliverable(null, 'a1100000-3333-0000-0000-000000000009', 't', 'b', null, null,
                   'b1100000-4444-0000-0000-000000000001')$$,
                 'P0001', 'not_found', 'deliverable client id = another user''s row -> not_found');
reset role;
select is((select body from public.project_deliverables where id = 'b1100000-4444-0000-0000-000000000001'), 'b',
          'B''s deliverable untouched');

-- ══════════════════════════════════════════════════════════════════════════════
-- OD-P11 begin_assistant_message for a user message without a reply (no RPC change)
-- ══════════════════════════════════════════════════════════════════════════════
insert into public.ai_jobs (id, user_id, job_type, target_type, target_id, status, run_generation, provider, model_tier,
                            connection_tier) values
  ('a1100000-5555-0000-0000-000000000001', 'a1100000-0000-0000-0000-000000000001', 'writing_chat_turn', 'writing_chat',
   current_setting('t.w')::uuid, 'running', 1, 'gemini', 'default', 'free');
select set_config('t.count0', (select message_count::text from public.writing_chats where id = current_setting('t.w')::uuid), true);
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a1100000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
-- The chat's last message is the user message of the first turn, which never got its assistant row.
select results_eq($$select reused, (message_count - current_setting('t.count0')::smallint)::int
                      from public.begin_assistant_message(current_setting('t.w')::uuid,
                        'a1100000-5555-0000-0000-000000000001', 'gemini', 'g', 'default', 'free')$$,
                  $$values (false, 1)$$, 'last = user message without a reply -> new assistant row, counted once');
reset role;
select results_eq($$select role, status from public.writing_chat_messages where writing_chat_id = current_setting('t.w')::uuid
                     order by sequence desc limit 2$$,
                  $$values ('assistant'::text, 'streaming'::text), ('user', 'done')$$,
                  'the user message is not re-created; the new row follows it');

-- ══════════════════════════════════════════════════════════════════════════════
-- OD-L2 / OD-L2a disclosure v2026-11-05: Claude consent needs reconsent, Gemini / OpenAI do not
-- ══════════════════════════════════════════════════════════════════════════════
-- Consents recorded on v2026-10-29 (before this version). The insert guard only accepts the current version, so it is
-- bypassed for the fixture (rolled back with the test). A = Claude, B = Gemini free, F = OpenAI.
insert into auth.users (id, email, aud, role) values
  ('f1100000-0000-0000-0000-000000000006', 'r11f@example.test', 'authenticated', 'authenticated');
alter table public.ai_data_use_consents disable trigger ai_data_use_consents_before_insert;
insert into public.ai_data_use_consents (user_id, provider, connection_tier, disclosure_version, free_tier_acknowledged, agreed_at)
values ('a1100000-0000-0000-0000-000000000001', 'anthropic', 'paid', 'v2026-10-29', false, '2026-11-01 00:00:00+09'),
       ('b1100000-0000-0000-0000-000000000002', 'gemini', 'free', 'v2026-10-29', true, '2026-11-01 00:00:00+09'),
       ('f1100000-0000-0000-0000-000000000006', 'openai', 'paid', 'v2026-10-29', false, '2026-11-01 00:00:00+09');
alter table public.ai_data_use_consents enable trigger ai_data_use_consents_before_insert;
insert into public.ai_provider_keys (id, user_id, provider, connection_tier, key_ciphertext, key_nonce, wrapped_dek, kek_id, key_last4, status) values
  (gen_random_uuid(), 'a1100000-0000-0000-0000-000000000001', 'anthropic', 'paid', '\x01', '\x02', '\x03', 'env-v1', 'an01', 'valid'),
  (gen_random_uuid(), 'b1100000-0000-0000-0000-000000000002', 'gemini', 'free', '\x01', '\x02', '\x03', 'env-v1', 'gm01', 'valid'),
  (gen_random_uuid(), 'f1100000-0000-0000-0000-000000000006', 'openai', 'paid', '\x01', '\x02', '\x03', 'env-v1', 'oa01', 'valid');
update public.profiles set active_ai_provider = 'anthropic' where id = 'a1100000-0000-0000-0000-000000000001';
update public.profiles set active_ai_provider = 'gemini' where id = 'b1100000-0000-0000-0000-000000000002';
update public.profiles set active_ai_provider = 'openai' where id = 'f1100000-0000-0000-0000-000000000006';

select results_eq($$select private.ai_consent_allows_run('a1100000-0000-0000-0000-000000000001', 'anthropic', 'paid'),
                           private.ai_consent_allows_run('b1100000-0000-0000-0000-000000000002', 'gemini', 'free'),
                           private.ai_consent_allows_run('f1100000-0000-0000-0000-000000000006', 'openai', 'paid')$$,
                  $$values (false, true, true)$$, 'run rule: Claude needs v2026-11-05, Gemini / OpenAI keep running');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1100000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.get_data_readiness() #> '{ai_connection,consent_required}', 'true'::jsonb,
          'Claude-consented user -> consent_required true');
set local request.jwt.claims = '{"sub":"b1100000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(public.get_data_readiness() #> '{ai_connection,consent_required}', 'false'::jsonb,
          'Gemini-consented user -> consent_required false');
set local request.jwt.claims = '{"sub":"f1100000-0000-0000-0000-000000000006","role":"authenticated"}';
select is(public.get_data_readiness() #> '{ai_connection,consent_required}', 'false'::jsonb,
          'OpenAI-consented user -> consent_required false');
-- Claude reconsent on the new version clears it.
set local request.jwt.claims = '{"sub":"a1100000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$insert into public.ai_data_use_consents (provider, connection_tier, disclosure_version)
                  values ('anthropic', 'paid', 'v2026-11-05')$$, 'Claude reconsent on v2026-11-05');
select is(public.get_data_readiness() #> '{ai_connection,consent_required}', 'false'::jsonb,
          'after reconsent -> consent_required false');
reset role;

-- R11-DB-1 (leader decision, R-OD-15): the acknowledgement follows the disclosure row's requires_free_tier_ack.
select is((select count(*)::int from pg_constraint where conname = 'ai_data_use_consents_free_tier_acknowledged_check'), 0,
          'consent free-tier CHECK replaced by the insert guard');
set local role authenticated;
set local request.jwt.claims = '{"sub":"f1100000-0000-0000-0000-000000000006","role":"authenticated"}';
select lives_ok($$insert into public.ai_data_use_consents (provider, connection_tier, disclosure_version, free_tier_acknowledged)
                  values ('openai', 'free', 'v2026-11-05', false)$$, 'OpenAI free consent without acknowledgement -> ok');
select lives_ok($$insert into public.ai_data_use_consents (provider, connection_tier, disclosure_version, free_tier_acknowledged)
                  values ('anthropic', 'free', 'v2026-11-05', false)$$, 'Claude free consent without acknowledgement -> ok');
select throws_ok($$insert into public.ai_data_use_consents (provider, connection_tier, disclosure_version, free_tier_acknowledged)
                   values ('gemini', 'free', 'v2026-11-05', false)$$,
                 '23514', 'free_tier_acknowledgement_required', 'Gemini free consent without acknowledgement -> rejected');
select lives_ok($$insert into public.ai_data_use_consents (provider, connection_tier, disclosure_version, free_tier_acknowledged)
                  values ('gemini', 'free', 'v2026-11-05', true)$$, 'Gemini free consent with acknowledgement -> ok');
reset role;
select is((select count(*)::int from public.ai_data_use_consents
            where disclosure_version = 'v2026-10-29' and connection_tier = 'free' and not free_tier_acknowledged), 0,
          'old rows untouched (all v2026-10-29 free consents acknowledged)');

select * from finish();
rollback;
