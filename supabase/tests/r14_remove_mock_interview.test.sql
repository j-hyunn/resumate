-- R14 (RM-1~RM-5, DM 11.9): AI mock interview removed from the MVP. Interview objects are gone, the CHECK lists
-- lost their interview values, the replaced RPCs no longer return interview keys, and application project /
-- account deletion still work. The migration guard (RM-4) is checked outside pgTAP (see the slice notes).
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ── interview objects are gone ──
select is_empty($$select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname in ('public', 'private')
                     and c.relname ~* 'interview|answer_evaluation|session_feedback'$$,
                'no interview table / view / index / sequence');
select is_empty($$select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname in ('public', 'private')
                     and (p.proname ~* 'interview|answer_evaluation|session_feedback'
                          or p.prosrc ~* 'interview|answer_evaluation|session_feedback')$$,
                'no interview function, and no surviving function body mentions interview objects');
select is_empty($$select tgname from pg_trigger where not tgisinternal and tgname ~* 'interview|answer_evaluation|session_feedback'$$,
                'no interview trigger');
select is_empty($$select policyname from pg_policies where policyname ~* 'interview|answer_evaluation|session_feedback'$$,
                'no interview policy');
select is_empty($$select conname from pg_constraint where pg_get_constraintdef(oid) ~* 'interview'$$,
                'no constraint mentions an interview value');
select is_empty($$select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname in ('public', 'private') and p.prorettype = 'trigger'::regtype
                     and not exists (select 1 from pg_trigger t where t.tgfoid = p.oid)$$,
                'no orphaned trigger function left behind');

-- ── CHECK lists ──
create function pg_temp.check_values(p_conname text) returns text[] language sql stable as $$
  select array_agg(m[1] order by m[1])
    from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') m
   where c.conname = p_conname
$$;
select is(pg_temp.check_values('application_projects_stage_check'),
          array['assignment', 'before_apply', 'closed', 'document'], 'stage: 4 values');
select is(pg_temp.check_values('application_stage_events_from_stage_check'),
          array['assignment', 'before_apply', 'closed', 'document'], 'stage history from_stage: 4 values');
select is(pg_temp.check_values('application_stage_events_to_stage_check'),
          array['assignment', 'before_apply', 'closed', 'document'], 'stage history to_stage: 4 values');
select is(pg_temp.check_values('ai_jobs_job_type_check'),
          array['career_description', 'chat_reply', 'cover_letter', 'draft_source_ranking', 'insight', 'jd_extraction',
                'key_verification', 'writing_assist', 'writing_chat_turn'], 'ai_jobs.job_type: 9 values');
select is(pg_temp.check_values('ai_usage_records_job_type_check'), pg_temp.check_values('ai_jobs_job_type_check'),
          'ai_usage_records.job_type = ai_jobs.job_type');
select is(pg_temp.check_values('ai_usage_records_feature_check'),
          array['career_description', 'chat_reply', 'cover_letter', 'insight', 'jd_extraction', 'key_verification',
                'writing_assist', 'writing_chat'], 'ai_usage_records.feature: 8 values');
select is(pg_temp.check_values('evidence_links_owner_type_check'),
          array['application_document', 'chat_message', 'insight'],
          'evidence owner_type: interview owners removed (R15: draft_section out, application_document in)');
select is(pg_temp.check_values('evidence_links_source_type_check'),
          array['education', 'experience', 'jd_requirement', 'jd_sentence', 'profile', 'project', 'project_deliverable',
                'skill', 'user_note'], 'evidence source_type: interview_answer removed');
select is(pg_temp.check_values('writing_chats_return_target_check'),
          array['career_description', 'cover_letter', 'feature', 'insight', 'object'], 'return_target feature: 3 values (+ the object / feature literals)');
select is_empty($$select conname from pg_constraint where conname = 'evidence_links_detached_check'$$,
                'OD-I6 undone: evidence_links_detached_check dropped');
select col_not_null('public', 'evidence_links', 'application_project_id', 'evidence_links.application_project_id not null again');

-- ── fixtures ──
insert into auth.users (id, email, aud, role) values
  ('a1400000-0000-0000-0000-000000000001', 'r14a@example.test', 'authenticated', 'authenticated');
insert into public.experiences (id, user_id, company_name) values
  ('a1400000-1111-0000-0000-000000000001', 'a1400000-0000-0000-0000-000000000001', 'A사');
insert into public.projects (id, user_id, experience_id, name) values
  ('a1400000-3333-0000-0000-000000000001', 'a1400000-0000-0000-0000-000000000001', 'a1400000-1111-0000-0000-000000000001', 'P');
insert into public.writing_chats (id, user_id, project_id) values
  ('a1400000-c4a7-0000-0000-000000000001', 'a1400000-0000-0000-0000-000000000001', 'a1400000-3333-0000-0000-000000000001');
insert into public.application_projects (id, user_id, name, name_source) values
  ('a1400000-aaaa-0000-0000-000000000001', 'a1400000-0000-0000-0000-000000000001', 'P1', 'user'),
  ('a1400000-aaaa-0000-0000-000000000002', 'a1400000-0000-0000-0000-000000000001', 'P2', 'user');
insert into public.job_descriptions (id, user_id, application_project_id, raw_text, raw_text_hash, sentences) values
  ('a1400000-1d00-0000-0000-000000000001', 'a1400000-0000-0000-0000-000000000001', 'a1400000-aaaa-0000-0000-000000000001',
   'x', 'h', '[{"sid":"S1","text":"x","start":0,"end":1}]');
insert into public.application_stage_events (user_id, application_project_id, event_type, to_stage) values
  ('a1400000-0000-0000-0000-000000000001', 'a1400000-aaaa-0000-0000-000000000001', 'created', 'before_apply');
insert into public.insights (id, user_id, application_project_id, version_no, is_latest, status, result,
                             match_stage_result, requirements_hash, career_snapshot_hash, input_hash, schema_version,
                             prompt_version, provider, model, model_tier, connection_tier, completed_at)
values ('a1400000-1a51-0000-0000-000000000001', 'a1400000-0000-0000-0000-000000000001',
        'a1400000-aaaa-0000-0000-000000000001', 1, true, 'ready', '{}', '{}', 'rh', 'ch', 'ih', 1, 'pv', 'gemini', 'm',
        'default', 'free', now());
insert into public.evidence_links (user_id, application_project_id, owner_type, owner_id, item_key, source_type, source_id,
                                   source_field, quote) values
  ('a1400000-0000-0000-0000-000000000001', 'a1400000-aaaa-0000-0000-000000000001', 'insight',
   'a1400000-1a51-0000-0000-000000000001', 'strengths.0', 'project', 'a1400000-3333-0000-0000-000000000001', 'name', 'P');

-- ── CHECKs refuse the removed values ──
select throws_ok($$insert into public.application_projects (user_id, name, name_source, stage)
                   values ('a1400000-0000-0000-0000-000000000001', 'x', 'user', 'job_interview')$$,
                 '23514', null, 'stage job_interview refused');
select throws_ok($$insert into public.application_projects (user_id, name, name_source, stage)
                   values ('a1400000-0000-0000-0000-000000000001', 'x', 'user', 'culture_fit_interview')$$,
                 '23514', null, 'stage culture_fit_interview refused');
select throws_ok($$insert into public.application_stage_events (user_id, application_project_id, event_type, from_stage, to_stage)
                   values ('a1400000-0000-0000-0000-000000000001', 'a1400000-aaaa-0000-0000-000000000001', 'stage_changed',
                           'document', 'job_interview')$$,
                 '23514', null, 'stage history to_stage job_interview refused');
select throws_ok($$insert into public.application_stage_events (user_id, application_project_id, event_type, from_stage, to_stage)
                   values ('a1400000-0000-0000-0000-000000000001', 'a1400000-aaaa-0000-0000-000000000001', 'stage_changed',
                           'culture_fit_interview', 'closed')$$,
                 '23514', null, 'stage history from_stage culture_fit_interview refused');
select throws_ok($$insert into public.ai_jobs (user_id, job_type, status, provider, model_tier, connection_tier)
                   values ('a1400000-0000-0000-0000-000000000001', 'interview_questions', 'queued', 'gemini', 'light', 'free')$$,
                 '23514', null, 'job_type interview_questions refused');
select throws_ok($$insert into public.evidence_links (user_id, application_project_id, owner_type, owner_id, item_key,
                                                     source_type, source_id)
                   values ('a1400000-0000-0000-0000-000000000001', 'a1400000-aaaa-0000-0000-000000000001',
                           'interview_question', gen_random_uuid(), 'q', 'project', 'a1400000-3333-0000-0000-000000000001')$$,
                 '23514', null, 'owner_type interview_question refused');
select throws_ok($$update public.writing_chats set return_target = '{"feature":"job_interview"}'
                    where id = 'a1400000-c4a7-0000-0000-000000000001'$$,
                 '23514', null, 'return_target job_interview refused');

-- ── replaced RPCs (user session) ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1400000-0000-0000-0000-000000000001","role":"authenticated"}';

select is((select array_agg(k order by k) from jsonb_object_keys(public.get_data_readiness() -> 'features') k),
          array['draft', 'insight'], 'readiness features: insight / draft only');
select ok(public.get_data_readiness()::text !~ 'data_sufficiency', 'readiness has no data_sufficiency');

select is((select array_agg(k order by k)
             from jsonb_object_keys(public.move_application_stage('a1400000-aaaa-0000-0000-000000000002', 'document')) k),
          array['changed', 'stage', 'stage_changed_at', 'stage_outcome'], 'move_application_stage: no interview_prompt');
select is((select array_agg(k order by k)
             from jsonb_object_keys(public.move_application_stage('a1400000-aaaa-0000-0000-000000000002', 'document')) k),
          array['changed', 'stage', 'stage_changed_at', 'stage_outcome'], 'same-stage branch: no interview_prompt');
select throws_ok($$select public.move_application_stage('a1400000-aaaa-0000-0000-000000000002', 'job_interview')$$,
                 'P0001', 'invalid_stage', 'move to job_interview refused');

select is(public.get_deletion_impact('application_project', 'a1400000-aaaa-0000-0000-000000000001'),
          '{"cascade": {"insights": 1, "documents": 0, "document_chats": 0, "stage_events": 1}}'::jsonb,
          'application project deletion impact: no interview_sessions, no kept');
select is(public.get_deletion_impact('project', 'a1400000-3333-0000-0000-000000000001') -> 'affected_results',
          '{"by_application_project": [{"application_project_id": "a1400000-aaaa-0000-0000-000000000001", "name": "P1",
             "insights": 1, "documents": 0, "document_sections": 0}]}'::jsonb,
          'career deletion impact: no interview_sessions / detached_interview_sessions');

select is((select array_agg(k order by k) from jsonb_object_keys(public.get_account_deletion_summary() -> 'applications') k),
          array['application_projects', 'application_stage_events', 'drafts', 'insights'],
          'account deletion summary: no interview_sessions');

select throws_ok($$select public.start_writing_chat('a1400000-3333-0000-0000-000000000001',
                   '{"feature":"job_interview","application_project_id":"a1400000-aaaa-0000-0000-000000000001"}')$$,
                 'P0001', 'invalid_return_target', 'start_writing_chat: job_interview return target refused');

-- application project delete: nothing of it is left
select lives_ok($$delete from public.application_projects where id = 'a1400000-aaaa-0000-0000-000000000001'$$,
                'user deletes an application project');
reset role;
select is((select (select count(*) from public.job_descriptions where application_project_id = 'a1400000-aaaa-0000-0000-000000000001')
                + (select count(*) from public.insights where application_project_id = 'a1400000-aaaa-0000-0000-000000000001')
                + (select count(*) from public.application_stage_events where application_project_id = 'a1400000-aaaa-0000-0000-000000000001')
                + (select count(*) from public.evidence_links where application_project_id = 'a1400000-aaaa-0000-0000-000000000001'))::int,
          0, 'application project delete leaves no rows');

-- ── account deletion (delete_account_data is shared by delete_account and the inactivity purge) ──
select lives_ok($$select private.delete_account_data('a1400000-0000-0000-0000-000000000001', repeat('a', 64), 'inactivity')$$,
                'delete_account_data runs without the interview tables');
select is((select (select count(*) from public.application_projects where user_id = 'a1400000-0000-0000-0000-000000000001')
                + (select count(*) from public.projects where user_id = 'a1400000-0000-0000-0000-000000000001')
                + (select count(*) from public.writing_chats where user_id = 'a1400000-0000-0000-0000-000000000001'))::int,
          0, 'delete_account_data: user data gone');

-- ── policy versions (RM-1, no reconsent) ──
select results_eq($$select policy_type, requires_reconsent, document_path from public.policy_versions
                     where version = '2026-11-08' and policy_type in ('terms', 'cross_border_transfer') order by 1$$,
                  $$values ('cross_border_transfer'::text, false, '/policies/cross_border_transfer/2026-11-08'::text),
                           ('terms', false, '/policies/terms/2026-11-08')$$,
                  'terms / cross_border_transfer 2026-11-08 without reconsent');

select * from finish();
rollback;
