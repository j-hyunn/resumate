-- Test-only fixture for account.integration.test.ts: one row (or more) in every
-- public table that has user_id, for the user :'uid' (S1 … S8 data).
-- Runs as the local superuser with session_replication_role = replica so
-- triggers (counters, guards, FK triggers) don't fire during the insert; every
-- reference still points at a row created here, so the ON DELETE cascades
-- that delete_account relies on behave as in production. CHECKs still apply.
-- Needs psql variable: uid.
\set ON_ERROR_STOP on
begin;
set local session_replication_role = replica;
select set_config('t.uid', :'uid', true) \gset t_

do $$
declare
  u uuid := current_setting('t.uid')::uuid;
  exp uuid := gen_random_uuid();
  edu uuid := gen_random_uuid();
  prj uuid := gen_random_uuid();
  det uuid := gen_random_uuid();
  skl uuid := gen_random_uuid();
  chat uuid := gen_random_uuid();
  ap uuid := gen_random_uuid();
  jd uuid := gen_random_uuid();
  req uuid := gen_random_uuid();
  ins uuid := gen_random_uuid();
  drf uuid := gen_random_uuid();
  sec uuid := gen_random_uuid();
  ses uuid := gen_random_uuid();
  qst uuid := gen_random_uuid();
  ans uuid := gen_random_uuid();
  job_done uuid := gen_random_uuid();
  job_live uuid := gen_random_uuid();
  disclosure text := (select version from public.ai_disclosures where provider = 'gemini' and connection_tier = 'paid' order by effective_at desc limit 1);
begin
  -- S1 consents
  insert into public.consents (user_id, consent_type, policy_version, agreed) values (u, 'terms', '2026-10-01', true);
  -- S2 career
  insert into public.experiences (id, user_id, company_name, start_month, job_rank) values (exp, u, 'A사', '2020-01-01', 'S');
  insert into public.educations (id, user_id, institution_name) values (edu, u, 'B대');
  insert into public.projects (id, user_id, experience_id, name, role) values (prj, u, exp, '결제', 'Dev');
  insert into public.project_details (id, user_id, project_id, sort_order, title) values (det, u, prj, 1, 't');
  insert into public.achievements (user_id, project_detail_id, description) values (u, det, 'd');
  insert into public.skills (id, user_id, name) values (skl, u, 'Kafka');
  insert into public.project_skills (user_id, project_id, skill_id) values (u, prj, skl);
  -- S3b keys / AI consent
  insert into public.ai_data_use_consents (user_id, provider, connection_tier, disclosure_version)
    values (u, 'gemini', 'paid', coalesce(disclosure, 'v2026-10-29'));
  insert into public.ai_provider_keys (id, user_id, provider, connection_tier, key_ciphertext, key_nonce, wrapped_dek, kek_id, key_last4, status)
    values (gen_random_uuid(), u, 'gemini', 'paid', '\x00', '\x00', '\x00', 'env-v1', 'ab12', 'valid');
  -- S3a jobs / usage
  insert into public.ai_jobs (id, user_id, job_type, provider, model_tier, connection_tier, status, finished_at)
    values (job_done, u, 'key_verification', 'gemini', 'light', 'paid', 'succeeded', now());
  insert into public.ai_jobs (id, user_id, job_type, provider, model_tier, connection_tier, status, target_type, target_id, heartbeat_at, started_at)
    values (job_live, u, 'writing_chat_turn', 'gemini', 'default', 'paid', 'running', 'writing_chat', chat, now(), now());
  insert into public.ai_usage_records (user_id, ai_job_id, feature, job_type, provider, model, model_tier, connection_tier, usage_source, outcome, price_table_version, estimated_cost_usd)
    values (u, job_done, 'key_verification', 'key_verification', 'gemini', 'gm', 'light', 'paid', 'unavailable', 'succeeded', 'p1', 0);
  -- S4 writing chat (unlinked)
  insert into public.writing_chats (id, user_id, mode) values (chat, u, 'new_project');
  insert into public.writing_chat_messages (user_id, writing_chat_id, sequence, role, content) values (u, chat, 1, 'user', '안녕');
  -- S5 application project / JD
  insert into public.application_projects (id, user_id, name, name_source) values (ap, u, '에이', 'user');
  insert into public.application_stage_events (user_id, application_project_id, event_type, to_stage) values (u, ap, 'created', 'before_apply');
  insert into public.job_descriptions (id, user_id, application_project_id, raw_text, raw_text_hash, sentences)
    values (jd, u, ap, '결제 팀', 'h', '[{"sid":"S1","text":"결제 팀","start":0,"end":4}]');
  insert into public.jd_requirements (id, user_id, job_description_id, category, content, source_sids, sort_order)
    values (req, u, jd, 'required', 'Kafka', '{S1}', 0);
  -- S6 insight + evidence
  insert into public.insights (id, user_id, application_project_id, version_no) values (ins, u, ap, 1);
  insert into public.evidence_links (user_id, application_project_id, owner_type, owner_id, item_key, source_type, source_id, source_field)
    values (u, ap, 'insight', ins, 'k', 'project_detail', det, 'title');
  -- S7 drafts
  insert into public.drafts (id, user_id, application_project_id, draft_type, title, status) values (drf, u, ap, 'career_description', '경력기술서', 'generating');
  insert into public.draft_sections (id, user_id, draft_id, sort_order, section_kind, experience_id) values (sec, u, drf, 0, 'experience', exp);
  insert into public.draft_section_sources (user_id, draft_section_id, application_project_id, role, origin, experience_id)
    values (u, sec, ap, 'primary', 'ai', exp);
  -- S8 interview
  insert into public.interview_sessions (id, user_id, application_project_id, interview_type, data_sufficiency) values (ses, u, ap, 'job', 'ok');
  insert into public.interview_questions (id, user_id, session_id, sequence, source_kind, anchor, question_text, intent)
    values (qst, u, ses, 1, 'values', 'general', '질문', '의도');
  insert into public.interview_answers (id, user_id, session_id, question_id) values (ans, u, ses, qst);
  insert into public.answer_evaluations (user_id, session_id, answer_id) values (u, ses, ans);
  insert into public.session_feedbacks (user_id, session_id) values (u, ses);
end $$;
commit;
