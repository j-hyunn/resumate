-- S9 retention purge RPCs (DM §3.4, §4.4, §2.9, A.17): boundaries (89 / 91 days, 13 KST months, 3 years), kept rows
-- (linked chats, chats with a live turn, in-flight jobs), result rows surviving job purge, per-call cap, argument
-- errors, privileges (service_role only).
-- Assertions filter on this test's user / hashes: the shared local DB may hold rows from integration test runs.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated');

-- p_now used throughout: 2026-11-15 12:00 KST.
create temp table t_now as select '2026-11-15 12:00:00+09'::timestamptz as v;
grant select on t_now to service_role, authenticated;

insert into public.projects (id, user_id, name, role) values
  ('a0000000-3333-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'P1', 'Dev');

-- ── writing chats ──
insert into public.writing_chats (id, user_id, mode, project_id, status, saved_at, last_activity_at) values
  -- unlinked active, 89 days -> kept
  ('a0000000-c4a7-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'new_project', null, 'active', null,
   (select v from t_now) - interval '89 days'),
  -- unlinked active, 91 days -> purged
  ('a0000000-c4a7-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'new_project', null, 'active', null,
   (select v from t_now) - interval '91 days'),
  -- unlinked abandoned, 91 days -> purged
  ('a0000000-c4a7-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'new_project', null, 'abandoned', null,
   (select v from t_now) - interval '91 days'),
  -- linked (augment), 400 days -> kept
  ('a0000000-c4a7-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'augment_project',
   'a0000000-3333-0000-0000-000000000001', 'active', null, (select v from t_now) - interval '400 days'),
  -- linked saved, 400 days -> kept
  ('a0000000-c4a7-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'new_project',
   'a0000000-3333-0000-0000-000000000001', 'saved', now(), (select v from t_now) - interval '400 days'),
  -- unlinked active, 91 days, but a turn job is queued -> kept
  ('a0000000-c4a7-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'new_project', null, 'active', null,
   (select v from t_now) - interval '91 days'),
  -- exactly 90 days -> kept (strictly older than 90 days is purged)
  ('a0000000-c4a7-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', 'new_project', null, 'active', null,
   (select v from t_now) - interval '90 days');
insert into public.writing_chat_messages (user_id, writing_chat_id, sequence, role, content) values
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-c4a7-0000-0000-000000000002', 1, 'user', 'x'),
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-c4a7-0000-0000-000000000002', 2, 'user', 'y'),
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-c4a7-0000-0000-000000000001', 1, 'user', 'z');
insert into public.ai_jobs (id, user_id, job_type, target_type, target_id, status, run_generation, provider, model_tier,
                            connection_tier) values
  ('a0000000-7777-0000-0000-0000000000c6', 'a0000000-0000-0000-0000-000000000001', 'writing_chat_turn', 'writing_chat',
   'a0000000-c4a7-0000-0000-000000000006', 'queued', 1, 'gemini', 'default', 'free');

select is(public.purge_unlinked_writing_chats((select v from t_now)), 2, 'chats: 2 purged (91-day active + abandoned)');
select results_eq($$select id::text from public.writing_chats where user_id = 'a0000000-0000-0000-0000-000000000001' order by id$$,
                  $$values ('a0000000-c4a7-0000-0000-000000000001'::text), ('a0000000-c4a7-0000-0000-000000000004'),
                           ('a0000000-c4a7-0000-0000-000000000005'), ('a0000000-c4a7-0000-0000-000000000006'),
                           ('a0000000-c4a7-0000-0000-000000000007')$$,
                  'chats kept: 89 days, exactly 90 days, linked (any age), live turn');
select is((select count(*)::int from public.writing_chat_messages where user_id = 'a0000000-0000-0000-0000-000000000001'), 1, 'chats: messages of purged chats cascade');
select is(public.purge_unlinked_writing_chats((select v from t_now)), 0, 'chats: second run deletes nothing');

-- ── ai_jobs ──
insert into public.application_projects (id, user_id, name, name_source) values
  ('a0000000-aaaa-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '가', 'user');
insert into public.ai_jobs (id, user_id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier, created_at, finished_at) values
  -- succeeded, finished 91 days ago -> purged (an insight points at it)
  ('a0000000-7777-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'insight',
   'a0000000-aaaa-0000-0000-000000000001', 'application_project', 'a0000000-aaaa-0000-0000-000000000001', 'succeeded', 1,
   'gemini', 'default', 'free', (select v from t_now) - interval '120 days', (select v from t_now) - interval '91 days'),
  -- failed, finished 89 days ago (created long before) -> kept
  ('a0000000-7777-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'key_verification', null, null, null,
   'failed', 1, 'gemini', 'light', 'free', (select v from t_now) - interval '200 days', (select v from t_now) - interval '89 days'),
  -- canceled, finished_at null (fallback created_at 91 days) -> purged
  ('a0000000-7777-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'key_verification', null, null, null,
   'canceled', 1, 'gemini', 'light', 'free', (select v from t_now) - interval '91 days', null),
  -- running, created 200 days ago -> kept
  ('a0000000-7777-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'key_verification', null, null, null,
   'running', 1, 'gemini', 'light', 'free', (select v from t_now) - interval '200 days', null),
  -- queued (retry wait), created 200 days ago -> kept
  ('a0000000-7777-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'key_verification', null, null, null,
   'queued', 1, 'gemini', 'light', 'free', (select v from t_now) - interval '200 days', null);
-- the guard fills finished_at on insert; put the canceled job back to "no finished_at" to test the created_at fallback
update public.ai_jobs set finished_at = null where id = 'a0000000-7777-0000-0000-000000000003';

insert into public.insights (id, user_id, application_project_id, version_no, is_latest, status, result,
                             match_stage_result, requirements_hash, career_snapshot_hash, input_hash, schema_version,
                             prompt_version, provider, model, model_tier, connection_tier, completed_at, ai_job_id)
values ('a0000000-1a51-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
        'a0000000-aaaa-0000-0000-000000000001', 1, true, 'ready', '{"k":1}', '{}', 'rh', 'ch', 'ih', 1, 'pv', 'gemini', 'm',
        'default', 'free', now(), 'a0000000-7777-0000-0000-000000000001');
insert into public.ai_usage_records (id, user_id, occurred_at, feature, job_type, ai_job_id, provider, model, model_tier,
                                     connection_tier, usage_source, outcome, price_table_version, estimated_cost_usd)
values ('a0000000-0e5e-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', (select v from t_now), 'insight',
        'insight', 'a0000000-7777-0000-0000-000000000001', 'gemini', 'm', 'default', 'free', 'provider_reported',
        'succeeded', 'v1', 0.01);

-- QA-S9-05 (b): every column that references ai_jobs points at the purged job 0001 (catalog-driven check below).
insert into public.job_descriptions (id, user_id, application_project_id, raw_text, raw_text_hash, sentences,
                                     extraction_job_id) values
  ('a0000000-1d00-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001',
   'x', 'h', '[{"sid":"S1","text":"x","start":0,"end":1}]', 'a0000000-7777-0000-0000-000000000001');
insert into public.drafts (id, user_id, application_project_id, draft_type, title, status, ai_job_id) values
  ('a0000000-cccc-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001',
   'cover_letter', '자소서', 'composing', 'a0000000-7777-0000-0000-000000000001');
insert into public.draft_sections (id, user_id, draft_id, sort_order, section_kind, question_text, count_basis, ai_job_id)
values ('a0000000-5c00-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
        'a0000000-cccc-0000-0000-000000000001', 0, 'cover_letter_question', 'q', 'with_spaces',
        'a0000000-7777-0000-0000-000000000001');
insert into public.interview_sessions (id, user_id, application_project_id, interview_type, question_count,
                                       data_sufficiency, status, generation_status, question_provider, question_model,
                                       submitted_at, question_job_id, evaluation_job_id) values
  ('a0000000-5e55-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001',
   'job', 3, 'ok', 'evaluating', 'ready', 'gemini', 'm', now(), 'a0000000-7777-0000-0000-000000000001',
   'a0000000-7777-0000-0000-000000000001');
insert into public.interview_questions (id, user_id, session_id, sequence, source_kind, anchor, question_text, intent,
                                        ai_job_id) values
  ('a0000000-9001-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-5e55-0000-0000-000000000001',
   1, 'project_deep_dive', 'experience', 'q', 'i', 'a0000000-7777-0000-0000-000000000001');
insert into public.interview_answers (id, user_id, session_id, question_id, answer_text, status) values
  ('a0000000-9002-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-5e55-0000-0000-000000000001',
   'a0000000-9001-0000-0000-000000000001', '답', 'submitted');
insert into public.answer_evaluations (id, user_id, session_id, answer_id, status, ai_job_id) values
  ('a0000000-9003-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-5e55-0000-0000-000000000001',
   'a0000000-9002-0000-0000-000000000001', 'pending', 'a0000000-7777-0000-0000-000000000001');
insert into public.session_feedbacks (id, user_id, session_id, status, ai_job_id) values
  ('a0000000-9004-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-5e55-0000-0000-000000000001',
   'pending', 'a0000000-7777-0000-0000-000000000001');

-- Rows per (table, column) of every FK that references ai_jobs, matching p_job_id.
create function pg_temp.job_refs(p_job_id uuid)
returns table (ref text, n bigint)
language plpgsql
as $$
declare
  r record;
begin
  for r in
    select con.conrelid::regclass::text as tbl, a.attname::text as col
      from pg_constraint con
      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
     where con.contype = 'f' and con.confrelid = 'public.ai_jobs'::regclass
     order by 1, 2
  loop
    ref := r.tbl || '.' || r.col;
    execute format('select count(*) from %s where %I = $1', r.tbl, r.col) into n using p_job_id;
    return next;
  end loop;
end;
$$;

select set_eq($$select ref from pg_temp.job_refs(null)$$,
              array['insights.ai_job_id', 'drafts.ai_job_id', 'draft_sections.ai_job_id', 'interview_questions.ai_job_id',
                    'answer_evaluations.ai_job_id', 'session_feedbacks.ai_job_id', 'interview_sessions.question_job_id',
                    'interview_sessions.evaluation_job_id', 'job_descriptions.extraction_job_id'],
              'FKs referencing ai_jobs = the list this test covers (new FK: add a fixture row here)');
select is_empty($$select ref from pg_temp.job_refs('a0000000-7777-0000-0000-000000000001') where n = 0$$,
                'fixture: every ai_jobs FK column points at the job to purge');
select is_empty(
  $$select con.conname from pg_constraint con
     where con.contype = 'f' and con.confrelid = 'public.ai_jobs'::regclass
       and (con.confdeltype <> 'n' or cardinality(con.confdelsetcols) <> 1)$$,
  'every ai_jobs FK is on delete set null (job column only)');
create temp table ref_rows_before as
  select (select count(*) from public.insights) + (select count(*) from public.drafts)
       + (select count(*) from public.draft_sections) + (select count(*) from public.interview_sessions)
       + (select count(*) from public.interview_questions) + (select count(*) from public.answer_evaluations)
       + (select count(*) from public.session_feedbacks) + (select count(*) from public.job_descriptions) as n;

select is(public.purge_old_ai_jobs((select v from t_now)), 2, 'jobs: 2 purged');
select is_empty($$select ref, n from pg_temp.job_refs('a0000000-7777-0000-0000-000000000001') where n > 0$$,
                'jobs: every referencing column of the purged job is now null');
select is((select (select count(*) from public.insights) + (select count(*) from public.drafts)
                + (select count(*) from public.draft_sections) + (select count(*) from public.interview_sessions)
                + (select count(*) from public.interview_questions) + (select count(*) from public.answer_evaluations)
                + (select count(*) from public.session_feedbacks) + (select count(*) from public.job_descriptions)),
          (select n from ref_rows_before), 'jobs: no referencing result row was deleted');

select results_eq($$select id::text from public.ai_jobs where user_id = 'a0000000-0000-0000-0000-000000000001'
                      and id::text like 'a0000000-7777-0000-0000-00000000000%' order by id$$,
                  $$values ('a0000000-7777-0000-0000-000000000002'::text), ('a0000000-7777-0000-0000-000000000004'),
                           ('a0000000-7777-0000-0000-000000000005')$$,
                  'jobs kept: finished 89 days, running, queued (any age)');
select results_eq($$select ai_job_id, result from public.insights where id = 'a0000000-1a51-0000-0000-000000000001'$$,
                  $$values (null::uuid, '{"k":1}'::jsonb)$$, 'jobs: the insight stays, its ai_job_id set null');
select is((select ai_job_id::text from public.ai_usage_records where id = 'a0000000-0e5e-0000-0000-000000000001'),
          'a0000000-7777-0000-0000-000000000001', 'jobs: usage record keeps the soft ai_job_id');

-- ── ai_usage_records: 13 KST months ──
insert into public.ai_usage_records (id, user_id, occurred_at, feature, job_type, provider, model, model_tier,
                                     connection_tier, usage_source, outcome, price_table_version, estimated_cost_usd) values
  ('a0000000-0e5e-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000001', '2025-10-31 23:59:59+09', 'insight',
   'insight', 'gemini', 'm', 'default', 'free', 'provider_reported', 'succeeded', 'v1', 0),
  ('a0000000-0e5e-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000001', '2025-11-01 00:00:00+09', 'insight',
   'insight', 'gemini', 'm', 'default', 'free', 'provider_reported', 'succeeded', 'v1', 0),
  ('a0000000-0e5e-0000-0000-000000000013', 'a0000000-0000-0000-0000-000000000001', '2024-01-10 00:00:00+09', 'insight',
   'insight', 'gemini', 'm', 'default', 'free', 'provider_reported', 'succeeded', 'v1', 0);

-- p_now = 2026-10-31 23:59:59 KST (still October): window 2025-10 .. 2026-10 -> only the 2024 row goes
select is(public.purge_old_ai_usage_records('2026-10-31 14:59:59+00'), 1, 'usage, now in Oct KST: only 2024-01 purged');
select ok(exists (select 1 from public.ai_usage_records where id = 'a0000000-0e5e-0000-0000-000000000011'),
          'usage, now in Oct KST: 2025-10 (13th month back) kept');
-- p_now = 2026-11-01 00:00 KST (UTC still Oct 31): window 2025-11 .. 2026-11 -> 2025-10-31 23:59:59 KST goes
select is(public.purge_old_ai_usage_records('2026-10-31 15:00:00+00'), 1,
          'usage, now = Nov 1 00:00 KST: the 2025-10 row is purged (KST month, not UTC)');
select results_eq($$select id::text from public.ai_usage_records where user_id = 'a0000000-0000-0000-0000-000000000001' order by id$$,
                  $$values ('a0000000-0e5e-0000-0000-000000000001'::text), ('a0000000-0e5e-0000-0000-000000000012')$$,
                  'usage kept: 2025-11-01 00:00 KST and current month');

-- ── account_deletion_logs: 3 years + per-call cap ──
insert into public.account_deletion_logs (subject_hash, requested_at, db_deleted_at, reason) values
  (repeat('1', 64), (select v from t_now) - interval '3 years' - interval '1 second', null, 'user_request'),
  (repeat('2', 64), (select v from t_now) - interval '3 years' + interval '1 second', null, 'user_request'),
  (repeat('3', 64), (select v from t_now) - interval '4 years', null, 'inactivity'),
  (repeat('4', 64), (select v from t_now) - interval '5 years', null, 'user_request');
select is(public.purge_old_account_deletion_logs((select v from t_now), 2), 2, 'logs: cap 2 -> 2 deleted (oldest first)');
select is(public.purge_old_account_deletion_logs((select v from t_now), 2), 1, 'logs: next call deletes the remaining 1');
select is(public.purge_old_account_deletion_logs((select v from t_now), 2), 0, 'logs: then nothing');
select results_eq($$select subject_hash from public.account_deletion_logs where subject_hash ~ '^([1-4])\1{63}$'$$, $$values (repeat('2', 64))$$,
                  'logs kept: younger than 3 years');

-- ── argument errors ──
select throws_ok($$select public.purge_old_ai_jobs(null)$$, 'P0001', 'invalid_now', 'p_now null');
select throws_ok($$select public.purge_old_ai_jobs(now(), 0)$$, 'P0001', 'invalid_limit', 'p_limit 0');
select throws_ok($$select public.purge_unlinked_writing_chats(now(), 50001)$$, 'P0001', 'invalid_limit', 'p_limit 50001');
select throws_ok($$select public.purge_old_ai_usage_records(now(), null)$$, 'P0001', 'invalid_limit', 'p_limit null');

-- ── privileges ──
select set_eq(
  $$select p.proname::text || ':' || r.rolname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      cross join (values ('anon'), ('authenticated'), ('app_ai_writer'), ('app_key_reader'), ('service_role')) r (rolname)
     where n.nspname = 'public' and p.proname like 'purge\_%'
       and has_function_privilege(r.rolname, p.oid, 'execute')$$,
  array['purge_unlinked_writing_chats:service_role', 'purge_old_ai_jobs:service_role',
        'purge_old_ai_usage_records:service_role', 'purge_old_account_deletion_logs:service_role'],
  'purge RPCs: service_role only');
select is_empty($$select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname like 'purge\_%' and not p.prosecdef$$,
                'purge RPCs are security definer');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.purge_old_ai_jobs(now() + interval '10 years')$$, '42501', null,
                 'user cannot call purge_old_ai_jobs');
select throws_ok($$select public.purge_unlinked_writing_chats(now() + interval '10 years')$$, '42501', null,
                 'user cannot call purge_unlinked_writing_chats');
reset role;

set local role service_role;
select is(public.purge_old_ai_jobs((select v from t_now)), 0, 'service_role can run the purge');
reset role;

select * from finish();
rollback;
