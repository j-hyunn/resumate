-- S9 account deletion (F-COM-05, NFR-PRV-06, NFR-KEY-06; DM §4.3, §4.4, A.17):
-- get_account_deletion_summary counts, delete_account completeness (catalog-driven: every public table with a
-- user_id column, + profiles), other user untouched, de-identified log, idempotency, errors, privileges.
-- Completeness guard: the user_id table list is pinned below. A new user table breaks this test until the fixture
-- seeds it AND delete_account removes it.
begin;
create extension if not exists pgtap with schema extensions;
-- (rolled back) lets the runner roles call pgTAP functions in this file, like get_provider_key_secret.test.sql.
grant usage on schema extensions to app_key_reader, app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'del-a@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000002', 'keep-b@example.test', 'authenticated', 'authenticated');

-- Rows per public table owned by p_uid (user_id tables + profiles by id), catalog-driven.
create function pg_temp.user_rows(p_uid uuid)
returns table (tbl text, n bigint)
language plpgsql
as $$
declare
  r record;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'user_id' and a.attnum > 0 and not a.attisdropped
     where ns.nspname = 'public' and c.relkind in ('r', 'p')
     order by c.relname
  loop
    tbl := r.relname;
    execute format('select count(*) from public.%I where user_id = $1', r.relname) into n using p_uid;
    return next;
  end loop;
  tbl := 'profiles';
  select count(*) into n from public.profiles where id = p_uid;
  return next;
end;
$$;

-- ── pinned list of user tables ──
select set_eq(
  $$select c.relname::text
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'user_id' and a.attnum > 0 and not a.attisdropped
     where ns.nspname = 'public' and c.relkind in ('r', 'p')$$,
  array['achievements', 'ai_data_use_consents', 'ai_jobs', 'ai_provider_keys', 'ai_usage_records',
        'answer_evaluations', 'application_projects', 'application_stage_events', 'consents',
        'draft_section_sources', 'draft_sections', 'drafts', 'educations', 'evidence_links', 'experiences',
        'insights', 'interview_answers', 'interview_questions', 'interview_sessions', 'jd_requirements',
        'job_descriptions', 'project_details', 'project_skills', 'projects', 'session_feedbacks', 'skills',
        'writing_chat_messages', 'writing_chats'],
  'public user_id tables = the list this test seeds (new table: seed it here and delete it in delete_account)');

-- Every table that references auth.users is one of them (or profiles): nothing user-owned hides without user_id.
select set_eq(
  $$select con.conrelid::regclass::text
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace ns on ns.oid = c.relnamespace
     where con.contype = 'f' and con.confrelid = 'auth.users'::regclass and ns.nspname = 'public'$$,
  $$select tbl from pg_temp.user_rows('00000000-0000-0000-0000-000000000000')$$,
  'public tables referencing auth.users = user_id tables + profiles');

-- ── fixture: user A owns at least one row everywhere ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into public.experiences (id, company_name, start_month, job_rank)
  values ('a0000000-1111-0000-0000-000000000001', 'A사', '2020-01-01', 'S');
insert into public.educations (id, institution_name, education_type, start_month)
  values ('a0000000-2222-0000-0000-000000000001', 'U', 'degree', '2014-03-01');
insert into public.projects (id, experience_id, name, role) values
  ('a0000000-3333-0000-0000-000000000001', 'a0000000-1111-0000-0000-000000000001', 'P1', 'Dev'),
  ('a0000000-3333-0000-0000-000000000002', null, 'P2', 'Dev');
insert into public.project_details (id, project_id, title, situation, action) values
  ('a0000000-4444-0000-0000-000000000001', 'a0000000-3333-0000-0000-000000000001', 't1', 's', 'a1');
insert into public.achievements (id, project_detail_id, experience_id, description) values
  ('a0000000-5555-0000-0000-000000000001', 'a0000000-4444-0000-0000-000000000001', null, 'ach1'),
  ('a0000000-5555-0000-0000-000000000002', null, 'a0000000-1111-0000-0000-000000000001', 'ach-e');
insert into public.skills (id, name) values
  ('a0000000-6666-0000-0000-000000000001', 'Go'), ('a0000000-6666-0000-0000-000000000002', 'SQL');
insert into public.project_skills (project_id, skill_id)
  values ('a0000000-3333-0000-0000-000000000001', 'a0000000-6666-0000-0000-000000000001');
reset role;

insert into public.writing_chats (id, user_id, mode, project_id, status) values
  ('a0000000-c4a7-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'new_project', null, 'active'),
  ('a0000000-c4a7-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'augment_project',
   'a0000000-3333-0000-0000-000000000002', 'active');
insert into public.writing_chat_messages (user_id, writing_chat_id, sequence, role, content) values
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-c4a7-0000-0000-000000000001', 1, 'user', 'hi'),
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-c4a7-0000-0000-000000000002', 1, 'user', 'hi');
update public.projects set source_writing_chat_id = 'a0000000-c4a7-0000-0000-000000000001'
 where id = 'a0000000-3333-0000-0000-000000000001';

insert into public.application_projects (id, user_id, name, name_source) values
  ('a0000000-aaaa-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '가', 'user'),
  ('a0000000-aaaa-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '나', 'user');
insert into public.application_stage_events (user_id, application_project_id, event_type, to_stage) values
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001', 'created', 'before_apply');
insert into public.job_descriptions (id, user_id, application_project_id, raw_text, raw_text_hash, sentences) values
  ('a0000000-1d00-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001',
   'x', 'h', '[{"sid":"S1","text":"x","start":0,"end":1}]');
insert into public.jd_requirements (user_id, job_description_id, category, content, source_sids) values
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-1d00-0000-0000-000000000001', 'required', 'Go', '{S1}');

insert into public.ai_jobs (id, user_id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier) values
  ('a0000000-7777-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'insight',
   'a0000000-aaaa-0000-0000-000000000001', 'application_project', 'a0000000-aaaa-0000-0000-000000000001', 'succeeded', 1,
   'gemini', 'default', 'free'),
  ('a0000000-7777-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'interview_evaluation',
   'a0000000-aaaa-0000-0000-000000000002', 'interview_session', 'a0000000-5e55-0000-0000-000000000001', 'running', 1,
   'gemini', 'default', 'free'),
  ('a0000000-7777-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'writing_chat_turn',
   null, 'writing_chat', 'a0000000-c4a7-0000-0000-000000000001', 'queued', 1, 'gemini', 'default', 'free'),
  ('a0000000-7777-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'key_verification',
   null, null, null, 'failed', 1, 'gemini', 'light', 'free');

insert into public.insights (id, user_id, application_project_id, version_no, is_latest, status, result,
                             match_stage_result, requirements_hash, career_snapshot_hash, input_hash, schema_version,
                             prompt_version, provider, model, model_tier, connection_tier, completed_at, ai_job_id)
values ('a0000000-1a51-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
        'a0000000-aaaa-0000-0000-000000000001', 1, true, 'ready', '{}', '{}', 'rh', 'ch', 'ih', 1, 'pv', 'gemini', 'm',
        'default', 'free', now(), 'a0000000-7777-0000-0000-000000000001');
insert into public.drafts (id, user_id, application_project_id, draft_type, title, status) values
  ('a0000000-cccc-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001',
   'cover_letter', '자소서', 'composing');
insert into public.draft_sections (id, user_id, draft_id, sort_order, section_kind, question_text, count_basis) values
  ('a0000000-5c00-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-cccc-0000-0000-000000000001',
   0, 'cover_letter_question', 'q', 'with_spaces');
insert into public.draft_section_sources (user_id, draft_section_id, application_project_id, experience_id, education_id,
                                          project_id, project_detail_ids, role, origin, sort_order, source_label) values
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-5c00-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001',
   'a0000000-1111-0000-0000-000000000001', null, 'a0000000-3333-0000-0000-000000000001',
   '{a0000000-4444-0000-0000-000000000001}', 'primary', 'user', 0, 'A사 › P1');

insert into public.interview_sessions (id, user_id, application_project_id, interview_type, question_count,
                                       data_sufficiency, status, generation_status, question_provider, question_model,
                                       submitted_at, evaluation_job_id) values
  ('a0000000-5e55-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000002',
   'job', 3, 'ok', 'evaluating', 'ready', 'gemini', 'm', now(), 'a0000000-7777-0000-0000-000000000002');
insert into public.interview_questions (id, user_id, session_id, sequence, source_kind, anchor, question_text, intent) values
  ('a0000000-9001-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-5e55-0000-0000-000000000001',
   1, 'project_deep_dive', 'experience', 'q', 'i');
insert into public.interview_answers (id, user_id, session_id, question_id, answer_text, status) values
  ('a0000000-9002-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-5e55-0000-0000-000000000001',
   'a0000000-9001-0000-0000-000000000001', '답', 'submitted');
insert into public.answer_evaluations (id, user_id, session_id, answer_id, status) values
  ('a0000000-9003-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-5e55-0000-0000-000000000001',
   'a0000000-9002-0000-0000-000000000001', 'pending');
insert into public.session_feedbacks (id, user_id, session_id, status) values
  ('a0000000-9004-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-5e55-0000-0000-000000000001',
   'pending');
insert into public.evidence_links (user_id, application_project_id, owner_type, owner_id, item_key, source_type, source_id,
                                   source_field, quote) values
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001', 'insight',
   'a0000000-1a51-0000-0000-000000000001', 'strengths.0', 'project_detail', 'a0000000-4444-0000-0000-000000000001',
   'action', 'a1'),
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000002', 'interview_question',
   'a0000000-9001-0000-0000-000000000001', 'question', 'project', 'a0000000-3333-0000-0000-000000000001', 'name', 'P1');

insert into public.ai_provider_keys (id, user_id, provider, connection_tier, key_ciphertext, key_nonce, wrapped_dek, kek_id,
                                     key_last4, status) values
  ('a0000000-9999-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'gemini', 'free', '\x01', '\x02', '\x03',
   'env-v1', 'gm01', 'valid'),
  ('a0000000-9999-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'openai', 'paid', '\x01', '\x02', '\x03',
   'env-v1', 'op01', 'valid');
update public.profiles set active_ai_provider = 'gemini', display_name = 'A'
 where id = 'a0000000-0000-0000-0000-000000000001';
insert into public.ai_data_use_consents (user_id, provider, connection_tier, disclosure_version, free_tier_acknowledged)
values ('a0000000-0000-0000-0000-000000000001', 'gemini', 'free', 'v2026-10-29', true);
insert into public.consents (user_id, consent_type, policy_version, agreed) values
  ('a0000000-0000-0000-0000-000000000001', 'terms', '2026-10-01', true),
  ('a0000000-0000-0000-0000-000000000001', 'privacy_required', '2026-10-01', true);
insert into public.ai_usage_records (user_id, occurred_at, feature, job_type, ai_job_id, application_project_id, provider,
                                     model, model_tier, connection_tier, usage_source, outcome, price_table_version,
                                     estimated_cost_usd) values
  ('a0000000-0000-0000-0000-000000000001', now(), 'insight', 'insight', 'a0000000-7777-0000-0000-000000000001',
   'a0000000-aaaa-0000-0000-000000000001', 'gemini', 'm', 'default', 'free', 'provider_reported', 'succeeded', 'v1', 0.01),
  ('a0000000-0000-0000-0000-000000000001', now(), 'key_verification', 'key_verification', null, null, 'gemini', 'm',
   'light', 'free', 'provider_reported', 'succeeded', 'v1', 0.001),
  ('a0000000-0000-0000-0000-000000000001', now(), 'writing_chat', 'writing_chat_turn', null, null, 'gemini', 'm',
   'default', 'free', 'unavailable', 'failed', 'v1', 0);

-- ── user B: some rows that must survive ──
insert into public.experiences (id, user_id, company_name, start_month, job_rank)
  values ('b0000000-1111-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'B사', '2021-01-01', 'S');
insert into public.application_projects (id, user_id, name, name_source) values
  ('b0000000-aaaa-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'B', 'user');
insert into public.ai_provider_keys (id, user_id, provider, connection_tier, key_ciphertext, key_nonce, wrapped_dek, kek_id,
                                     key_last4, status) values
  ('b0000000-9999-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'gemini', 'free', '\x01', '\x02', '\x03',
   'env-v1', 'bg01', 'valid');
insert into public.consents (user_id, consent_type, policy_version, agreed) values
  ('b0000000-0000-0000-0000-000000000002', 'terms', '2026-10-01', true);
insert into public.writing_chats (id, user_id, mode, status) values
  ('b0000000-c4a7-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'new_project', 'active');
insert into public.ai_jobs (id, user_id, job_type, status, run_generation, provider, model_tier, connection_tier) values
  ('b0000000-7777-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'key_verification', 'running', 1,
   'gemini', 'light', 'free');
insert into public.ai_usage_records (user_id, occurred_at, feature, job_type, provider, model, model_tier, connection_tier,
                                     usage_source, outcome, price_table_version, estimated_cost_usd) values
  ('b0000000-0000-0000-0000-000000000002', now(), 'key_verification', 'key_verification', 'gemini', 'm', 'light', 'free',
   'provider_reported', 'succeeded', 'v1', 0.001);

-- Fixture coverage: A has rows in every user table.
select is_empty($$select tbl from pg_temp.user_rows('a0000000-0000-0000-0000-000000000001') where n = 0$$,
                'fixture: user A owns rows in every user table (+ profiles)');

create temp table b_before as select * from pg_temp.user_rows('b0000000-0000-0000-0000-000000000002');
grant select on b_before to authenticated;

-- ── get_account_deletion_summary ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.get_account_deletion_summary(),
          '{"career": {"experiences": 1, "educations": 1, "projects": 2, "project_details": 1, "achievements": 2,
                       "skills": 2, "writing_chats": 2},
            "applications": {"application_projects": 2, "insights": 1, "drafts": 1, "interview_sessions": 1,
                             "application_stage_events": 1},
            "ai_connection": {"provider_keys": 2, "ai_data_use_consents": 1, "usage_records": 3,
                              "has_provider_keys": true}}'::jsonb,
          'summary: exact counts for A');

select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is(public.get_account_deletion_summary(),
          '{"career": {"experiences": 1, "educations": 0, "projects": 0, "project_details": 0, "achievements": 0,
                       "skills": 0, "writing_chats": 1},
            "applications": {"application_projects": 1, "insights": 0, "drafts": 0, "interview_sessions": 0,
                             "application_stage_events": 0},
            "ai_connection": {"provider_keys": 1, "ai_data_use_consents": 0, "usage_records": 1,
                              "has_provider_keys": true}}'::jsonb,
          'summary: B sees only B''s rows');

select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$select public.get_account_deletion_summary()$$, '42501', 'not_authenticated',
                 'summary: no sub -> not_authenticated');
select throws_ok($$select public.delete_account(repeat('a', 64))$$, '42501', 'not_authenticated',
                 'delete: no sub -> not_authenticated');

-- ── delete_account argument checks (nothing deleted) ──
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$select public.delete_account(null)$$, 'P0001', 'invalid_subject_hash', 'hash null');
select throws_ok($$select public.delete_account(repeat('a', 63))$$, 'P0001', 'invalid_subject_hash', 'hash 63 chars');
select throws_ok($$select public.delete_account(repeat('A', 64))$$, 'P0001', 'invalid_subject_hash', 'hash uppercase');
select throws_ok($$select public.delete_account('a0000000-0000-0000-0000-000000000001')$$, 'P0001',
                 'invalid_subject_hash', 'raw user id is not a valid hash');
select is((public.get_account_deletion_summary() -> 'career' ->> 'experiences')::int, 1,
          'failed calls deleted nothing');

-- users cannot touch the log table at all
select throws_ok($$select * from public.account_deletion_logs$$, '42501', null, 'user cannot select logs');
select throws_ok($$insert into public.account_deletion_logs (subject_hash, reason) values (repeat('b', 64), 'user_request')$$,
                 '42501', null, 'user cannot insert logs');

-- ── delete_account ──
select is(public.delete_account('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef') - 'db_deleted_at',
          '{"deleted": true, "log_written": true, "in_flight_jobs": 2, "deleted_provider_keys": 2}'::jsonb,
          'delete_account: result shape (2 in-flight jobs, 2 keys)');
select is(public.get_account_deletion_summary(),
          '{"career": {"experiences": 0, "educations": 0, "projects": 0, "project_details": 0, "achievements": 0,
                       "skills": 0, "writing_chats": 0},
            "applications": {"application_projects": 0, "insights": 0, "drafts": 0, "interview_sessions": 0,
                             "application_stage_events": 0},
            "ai_connection": {"provider_keys": 0, "ai_data_use_consents": 0, "usage_records": 0,
                              "has_provider_keys": false}}'::jsonb,
          'summary after deletion: all zero');

-- idempotent retry (e.g. auth.admin.deleteUser failed): passes, keeps the first log row
select is(public.delete_account('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef') - 'db_deleted_at',
          '{"deleted": true, "log_written": false, "in_flight_jobs": 0, "deleted_provider_keys": 0}'::jsonb,
          'delete_account retry: no error, no second log');
reset role;

-- QA-S9-05 (a): the runner after deletion. Its in-flight jobs (insight-evaluation 0002 running, chat turn 0003
-- queued) are gone, so the heartbeat update (supabase-store heartbeat: id + run_generation + active status) hits 0
-- rows -> current:false (lost), and the key fetch is refused.
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
with u as (
  update public.ai_jobs j set heartbeat_at = now()
   where j.id in ('a0000000-7777-0000-0000-000000000002', 'a0000000-7777-0000-0000-000000000003')
     and j.run_generation = 1 and j.status in ('queued', 'running')
  returning 1)
select set_config('t.heartbeat_rows', count(*)::text, true) from u;
reset role;
select is(current_setting('t.heartbeat_rows'), '0', 'after delete_account: runner heartbeat updates 0 rows (lost)');

set local role app_key_reader;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_key_reader"}';
select throws_ok($$select * from public.get_provider_key_secret('a0000000-7777-0000-0000-000000000002')$$,
                 'P0001', 'key_not_available', 'after delete_account: key fetch for the running job is refused');
select throws_ok($$select * from public.get_provider_key_secret('a0000000-7777-0000-0000-000000000003')$$,
                 'P0001', 'key_not_available', 'after delete_account: key fetch for the queued chat turn is refused');
reset role;

-- completeness (catalog-driven)
select is_empty($$select tbl, n from pg_temp.user_rows('a0000000-0000-0000-0000-000000000001') where n > 0$$,
                'after delete_account: A has 0 rows in every public user table and no profile');
select ok(exists (select 1 from auth.users where id = 'a0000000-0000-0000-0000-000000000001'),
          'auth.users row is left for the server (auth.admin.deleteUser)');

-- B untouched
select set_eq($$select tbl, n from pg_temp.user_rows('b0000000-0000-0000-0000-000000000002')$$,
              $$select tbl, n from b_before$$, 'user B rows unchanged');
select is((select status from public.ai_jobs where id = 'b0000000-7777-0000-0000-000000000001'), 'running',
          'B''s running job untouched');

-- de-identified log
select results_eq($$select count(*)::int, min(subject_hash), min(reason),
                           bool_and(db_deleted_at is not null and db_deleted_at >= requested_at),
                           bool_and(storage_deleted_at is null)
                      from public.account_deletion_logs where subject_hash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'$$,
                  $$values (1, '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'::text,
                            'user_request'::text, true, true)$$,
                  'one log row: hash, user_request, db_deleted_at set, storage_deleted_at null (no bucket)');
select columns_are('public', 'account_deletion_logs',
                   array['id', 'subject_hash', 'requested_at', 'db_deleted_at', 'storage_deleted_at', 'reason',
                         'created_at', 'updated_at'],
                   'log columns: no user id / email column');
select is_empty($$select 1 from pg_constraint where conrelid = 'public.account_deletion_logs'::regclass and contype = 'f'$$,
                'log has no FK (survives auth.users deletion)');
select is((select count(*)::int from public.account_deletion_logs l
            where row_to_json(l)::text ilike '%a0000000-0000-0000-0000-000000000001%'
               or row_to_json(l)::text ilike '%del-a@example.test%'), 0,
          'log row contains neither the user id nor the email');

-- the server's auth deletion afterwards works and leaves the log
delete from auth.users where id = 'a0000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.account_deletion_logs where subject_hash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'), 1, 'log survives auth.users deletion');

-- ── table / function privileges ──
select is((select relrowsecurity from pg_class where oid = 'public.account_deletion_logs'::regclass), true,
          'account_deletion_logs: RLS enabled');
select is_empty($$select policyname from pg_policies where schemaname = 'public' and tablename = 'account_deletion_logs'$$,
                'account_deletion_logs: no policy');
select is_empty(
  $$select r.rolname, p.privilege_type
      from pg_roles r
      cross join lateral (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'),
                                 ('TRIGGER')) p (privilege_type)
     where r.rolname in ('anon', 'authenticated', 'app_ai_writer', 'app_key_reader', 'authenticator')
       and (has_table_privilege(r.oid, 'public.account_deletion_logs', p.privilege_type)
            or (p.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
                and has_any_column_privilege(r.oid, 'public.account_deletion_logs', p.privilege_type)))$$,
  'account_deletion_logs: no privilege for anon / authenticated / app_ai_writer / app_key_reader / authenticator');
select set_eq(
  $$select p.privilege_type::text
      from (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p (privilege_type)
     where has_table_privilege('service_role', 'public.account_deletion_logs', p.privilege_type)$$,
  array['SELECT', 'DELETE'], 'service_role: SELECT / DELETE only on account_deletion_logs');

select set_eq(
  $$select p.proname::text || ':' || r.rolname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      cross join (values ('anon'), ('authenticated'), ('app_ai_writer'), ('app_key_reader'), ('service_role')) r (rolname)
     where n.nspname = 'public' and p.proname in ('get_account_deletion_summary', 'delete_account')
       and has_function_privilege(r.rolname, p.oid, 'execute')$$,
  array['get_account_deletion_summary:authenticated', 'delete_account:authenticated'],
  'summary / delete_account: authenticated only');
select is((select prosecdef from pg_proc where oid = 'public.get_account_deletion_summary()'::regprocedure), false,
          'summary is security invoker');
select is((select prosecdef from pg_proc where oid = 'public.delete_account(text)'::regprocedure), true,
          'delete_account is security definer');
select ok((select proconfig @> array['search_path=""'] from pg_proc
            where oid = 'public.delete_account(text)'::regprocedure), 'delete_account pins search_path');

select * from finish();
rollback;
