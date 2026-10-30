-- S1 QA-04: global grant guard. Fails when a new object in `public` is opened to anon or
-- app_ai_writer beyond the allow list. Update the allow lists only together with DM §5.
begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

-- anon table privileges in public: only SELECT on policy_versions (+ S3b ai_disclosures, DM 2.11.6).
select set_eq(
  $$select c.relname::text || ':' || p.privilege_type
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                                 ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p (privilege_type)
     where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f')
       and has_table_privilege('anon', c.oid, p.privilege_type)$$,
  array['policy_versions:SELECT', 'ai_disclosures:SELECT'],
  'anon has only SELECT on policy_versions and ai_disclosures in public');

-- anon column-level privileges: none.
select is_empty(
  $$select table_name, column_name, privilege_type
      from information_schema.column_privileges
     where table_schema = 'public' and grantee = 'anon'
       and table_name not in ('policy_versions', 'ai_disclosures')$$,
  'anon has no column privileges outside policy_versions / ai_disclosures');

-- public functions anon can execute: none.
select is_empty(
  $$select p.oid::regprocedure::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and has_function_privilege('anon', p.oid, 'execute')$$,
  'anon cannot execute any public function');

-- app_ai_writer table-level privileges in public. S1: none (profiles is column-level only).
-- S2: SELECT on the 7 career tables, nothing else (DM §5, DM-13: career tables are read-only).
-- S3: + SELECT on ai_jobs, evidence_links (writes are column-level / RPC).
-- S3a: usage_events / usage_limits dropped (D-34); + SELECT on ai_usage_records (own rows), ai_price_tables.
-- S4: + SELECT on writing_chats, writing_chat_messages (writes only through the definer message / patch RPCs).
-- S5: + SELECT on job_descriptions, jd_requirements (application_projects is column-level without memo;
--     JD extraction writes only through begin / apply / fail_jd_extraction).
-- S6: + SELECT on insights (writes only through begin / complete / fail_insight).
-- S7: + SELECT on drafts, draft_sections, draft_section_sources (writes only through the S7 definer RPCs).
-- S8: + SELECT on the 5 interview tables (writes only through the S8 definer RPCs).
select set_eq(
  $$select c.relname::text || ':' || p.privilege_type
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                                 ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p (privilege_type)
     where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f')
       and has_table_privilege('app_ai_writer', c.oid, p.privilege_type)
       and not (c.relname = 'profiles' and p.privilege_type = 'SELECT')$$,
  array['experiences:SELECT', 'educations:SELECT', 'projects:SELECT', 'project_details:SELECT',
        'achievements:SELECT', 'skills:SELECT', 'project_skills:SELECT',
        'ai_jobs:SELECT', 'evidence_links:SELECT', 'ai_usage_records:SELECT', 'ai_price_tables:SELECT',
        'writing_chats:SELECT', 'writing_chat_messages:SELECT',
        'job_descriptions:SELECT', 'jd_requirements:SELECT', 'insights:SELECT',
        'drafts:SELECT', 'draft_sections:SELECT', 'draft_section_sources:SELECT',
        'interview_sessions:SELECT', 'interview_questions:SELECT', 'interview_answers:SELECT',
        'answer_evaluations:SELECT', 'session_feedbacks:SELECT'],
  'app_ai_writer table privileges in public: SELECT on career + AI + writing chat + JD + insight + draft + interview tables only');

-- profiles stays column-level for app_ai_writer (display_name excluded, A.1).
select ok(not has_column_privilege('app_ai_writer', 'public.profiles', 'display_name', 'SELECT'),
          'app_ai_writer cannot read profiles.display_name');

-- QA-S2-05 -> S3 allow list: app_ai_writer column-level writes in public are exactly these
-- (DM §5 v4.2: ai_jobs, ai_usage_records insert; career tables and ai_price_tables never).
-- R1 A24: evidence_links INSERT removed — evidence is written only inside the result RPCs.
-- Grows only with DM §5. S4: unchanged — DM §5 allows app_ai_writer writing_chats.message_count / last_activity_at and
-- assistant rows, but S4 writes them only through definer RPCs (begin / finish_assistant_message), so no column grant.
select set_eq(
  $$select c.relname::text || '.' || a.attname || ':' || p.privilege_type
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      cross join lateral (values ('INSERT'), ('UPDATE'), ('REFERENCES')) p (privilege_type)
     where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f')
       and has_column_privilege('app_ai_writer', c.oid, a.attnum, p.privilege_type)$$,
  array(
    select 'ai_jobs.' || col || ':INSERT' from unnest(array['id', 'user_id', 'job_type', 'application_project_id',
      'target_type', 'target_id', 'status', 'progress', 'params', 'step_outputs', 'run_generation', 'error_code',
      'input_hash', 'prompt_version', 'model', 'usage', 'output', 'heartbeat_at', 'started_at', 'finished_at',
      'provider', 'model_tier', 'connection_tier', 'retry_count', 'next_run_at', 'retry_wait_total_ms',
      'quota_resets_at', 'retry_after']) col
    union all
    select 'ai_jobs.' || col || ':UPDATE' from unnest(array['status', 'progress', 'step_outputs', 'run_generation',
      'error_code', 'input_hash', 'prompt_version', 'model', 'usage', 'output', 'heartbeat_at', 'started_at',
      'finished_at', 'retry_count', 'next_run_at', 'retry_wait_total_ms', 'quota_resets_at', 'retry_after']) col
    union all
    select 'ai_usage_records.' || col || ':INSERT' from unnest(array['id', 'user_id', 'occurred_at', 'feature',
      'job_type', 'ai_job_id', 'call_key', 'application_project_id', 'provider', 'model', 'model_tier',
      'connection_tier', 'input_tokens', 'cached_input_tokens', 'cache_write_tokens', 'output_tokens',
      'reasoning_tokens', 'usage_source', 'outcome', 'error_code', 'price_table_version', 'estimated_cost_usd']) col),
  'app_ai_writer column-level INSERT / UPDATE / REFERENCES in public = ai_jobs + ai_usage_records (R1 A24: no evidence_links)');

-- authenticated: no write privilege at all on the AI tables (cancel goes through an RPC).
select is_empty(
  $$select c.relname, p.privilege_type
      from pg_class c
      cross join lateral (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p (privilege_type)
     where c.oid in ('public.ai_jobs'::regclass, 'public.evidence_links'::regclass,
                     'public.ai_usage_records'::regclass, 'public.ai_price_tables'::regclass)
       and (has_table_privilege('authenticated', c.oid, p.privilege_type)
            or (p.privilege_type in ('INSERT', 'UPDATE')
                and has_any_column_privilege('authenticated', c.oid, p.privilege_type)))$$,
  'authenticated cannot write AI tables directly');

-- app_ai_writer: ai_usage_records is append-only, ai_price_tables read-only (DM §5).
select ok(not has_any_column_privilege('app_ai_writer', 'public.ai_usage_records', 'UPDATE')
          and not has_table_privilege('app_ai_writer', 'public.ai_usage_records', 'DELETE')
          and not has_any_column_privilege('app_ai_writer', 'public.ai_price_tables', 'INSERT')
          and not has_any_column_privilege('app_ai_writer', 'public.ai_price_tables', 'UPDATE')
          and not has_table_privilege('app_ai_writer', 'public.ai_price_tables', 'DELETE'),
          'app_ai_writer: no update / delete on ai_usage_records, no writes on ai_price_tables');

-- app_ai_writer can execute exactly these public functions.
select set_eq(
  $$select p.proname::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and has_function_privilege('app_ai_writer', p.oid, 'execute')$$,
  array['get_data_readiness', 'complete_ai_job', 'mark_provider_key_invalid', 'record_provider_key_success',
        'check_ai_run_allowed',
        'begin_assistant_message', 'finish_assistant_message', 'mark_writing_chat_extracted', 'apply_structured_draft_patch',
        'begin_jd_extraction', 'apply_jd_extraction', 'fail_jd_extraction',
        'begin_insight', 'complete_insight', 'fail_insight',
        'begin_career_description', 'complete_career_description', 'fail_career_description',
        'begin_cover_letter_section', 'complete_cover_letter_section', 'fail_draft_section',
        'begin_interview_questions', 'save_interview_question', 'complete_interview_questions',
        'fail_interview_questions', 'begin_interview_evaluation', 'save_answer_evaluation', 'fail_answer_evaluation',
        'save_session_feedback', 'complete_interview_evaluation',
        'retry_ai_job'],
  'app_ai_writer can execute exactly the S2–S3b functions + the S4 assistant-message / extract / patch RPCs + S5 JD extraction + S6 insight + S7 draft + S8 interview RPCs + R2 retry_ai_job');

-- S7 (DM §5, A.9–A.11): draft RPC execute matrix. Cover letter editing is user-session only; generation writes
-- are app_ai_writer only.
select set_eq(
  $$select p.proname::text || ':' || r.rolname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      cross join (values ('anon'), ('authenticated'), ('app_ai_writer'), ('app_key_reader')) r (rolname)
     where n.nspname = 'public'
       and p.proname in ('create_cover_letter_draft', 'add_cover_letter_question', 'delete_cover_letter_question',
                         'reorder_cover_letter_questions', 'set_section_sources',
                         'begin_career_description', 'complete_career_description', 'fail_career_description',
                         'begin_cover_letter_section', 'complete_cover_letter_section', 'fail_draft_section')
       and has_function_privilege(r.rolname, p.oid, 'execute')$$,
  array['create_cover_letter_draft:authenticated', 'add_cover_letter_question:authenticated',
        'delete_cover_letter_question:authenticated', 'reorder_cover_letter_questions:authenticated',
        'set_section_sources:authenticated',
        'begin_career_description:app_ai_writer', 'complete_career_description:app_ai_writer',
        'fail_career_description:app_ai_writer', 'begin_cover_letter_section:app_ai_writer',
        'complete_cover_letter_section:app_ai_writer', 'fail_draft_section:app_ai_writer'],
  'S7 draft RPC execute matrix');

-- S7 (DM §5): user-session write privileges on the draft tables = drafts DELETE + UPDATE (title, edited_at,
-- first_copied_at), draft_sections UPDATE (question_text, char_limit, count_basis, user_note, edited_content).
select set_eq(
  $$select c.relname::text || ':' || p.privilege_type
      from pg_class c
      cross join lateral (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p (privilege_type)
     where c.oid in ('public.drafts'::regclass, 'public.draft_sections'::regclass,
                     'public.draft_section_sources'::regclass)
       and has_table_privilege('authenticated', c.oid, p.privilege_type)$$,
  array['drafts:DELETE'],
  'authenticated: table-level writes on draft tables = drafts DELETE only');
select set_eq(
  $$select c.relname::text || '.' || a.attname || ':' || p.privilege_type
      from pg_class c
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      cross join lateral (values ('INSERT'), ('UPDATE')) p (privilege_type)
     where c.oid in ('public.drafts'::regclass, 'public.draft_sections'::regclass,
                     'public.draft_section_sources'::regclass)
       and has_column_privilege('authenticated', c.oid, a.attnum, p.privilege_type)$$,
  array['drafts.title:UPDATE', 'drafts.edited_at:UPDATE', 'drafts.first_copied_at:UPDATE',
        'draft_sections.question_text:UPDATE', 'draft_sections.char_limit:UPDATE',
        'draft_sections.count_basis:UPDATE', 'draft_sections.user_note:UPDATE',
        'draft_sections.edited_content:UPDATE'],
  'authenticated: column writes on draft tables = DM §5 user columns only');

-- S7: no other API / app role writes the draft tables (service_role keeps SELECT / DELETE).
select is_empty(
  $$select r.rolname, c.oid::regclass::text, p.privilege_type
      from pg_roles r
      cross join (values ('public.drafts'::regclass), ('public.draft_sections'::regclass),
                         ('public.draft_section_sources'::regclass)) c (oid)
      cross join lateral (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p (privilege_type)
     where r.rolname in ('anon', 'app_ai_writer', 'app_key_reader', 'authenticator', 'service_role')
       and not (r.rolname = 'service_role' and p.privilege_type = 'DELETE')
       and (has_table_privilege(r.oid, c.oid, p.privilege_type)
            or (p.privilege_type in ('INSERT', 'UPDATE') and has_any_column_privilege(r.oid, c.oid, p.privilege_type)))$$,
  'nobody but the user session (DM §5 columns) writes the draft tables directly');

-- S7: ai_content is never user-writable (AI original, AI-03 / AI-04 storage).
select ok(not has_column_privilege('authenticated', 'public.draft_sections', 'ai_content', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.draft_sections', 'status', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.draft_sections', 'template_key', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.drafts', 'status', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.drafts', 'options', 'UPDATE'),
          'authenticated cannot update ai_content / status / template_key / options');

-- S6 (DM §5, A.8): insight RPCs are app_ai_writer only.
select set_eq(
  $$select p.proname::text || ':' || r.rolname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      cross join (values ('anon'), ('authenticated'), ('app_ai_writer'), ('app_key_reader')) r (rolname)
     where n.nspname = 'public'
       and p.proname in ('begin_insight', 'complete_insight', 'fail_insight')
       and has_function_privilege(r.rolname, p.oid, 'execute')$$,
  array['begin_insight:app_ai_writer', 'complete_insight:app_ai_writer', 'fail_insight:app_ai_writer'],
  'S6 insight RPC execute matrix');

-- S6: no API / app role writes insights directly (RPCs + cascade + delete_career_item's definer helper only);
-- service_role keeps SELECT / DELETE.
select is_empty(
  $$select r.rolname, p.privilege_type
      from pg_roles r
      cross join lateral (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p (privilege_type)
     where r.rolname in ('anon', 'authenticated', 'app_ai_writer', 'app_key_reader', 'authenticator', 'service_role')
       and not (r.rolname = 'service_role' and p.privilege_type = 'DELETE')
       and (has_table_privilege(r.oid, 'public.insights'::regclass, p.privilege_type)
            or (p.privilege_type in ('INSERT', 'UPDATE')
                and has_any_column_privilege(r.oid, 'public.insights'::regclass, p.privilege_type)))$$,
  'nobody writes insights directly (service_role: SELECT / DELETE only)');

-- S5 (DM §5, §7): application / JD RPC execute matrix. Stage and outcome RPCs are user-session only; JD
-- extraction RPCs are app_ai_writer only.
select set_eq(
  $$select p.proname::text || ':' || r.rolname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      cross join (values ('anon'), ('authenticated'), ('app_ai_writer'), ('app_key_reader')) r (rolname)
     where n.nspname = 'public'
       and p.proname in ('create_application_project', 'move_application_stage', 'set_application_outcome',
                         'begin_jd_extraction', 'apply_jd_extraction', 'fail_jd_extraction')
       and has_function_privilege(r.rolname, p.oid, 'execute')$$,
  array['create_application_project:authenticated', 'move_application_stage:authenticated',
        'set_application_outcome:authenticated', 'begin_jd_extraction:app_ai_writer',
        'apply_jd_extraction:app_ai_writer', 'fail_jd_extraction:app_ai_writer'],
  'S5 application / JD RPC execute matrix');

-- S5 (DM §5): user-session write privileges on the application tables. application_projects: DELETE +
-- UPDATE (name, deadline, memo) only; stage events / JD / requirements: none (RPC + cascade only).
select set_eq(
  $$select c.relname::text || ':' || p.privilege_type
      from pg_class c
      cross join lateral (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p (privilege_type)
     where c.oid in ('public.application_projects'::regclass, 'public.application_stage_events'::regclass,
                     'public.job_descriptions'::regclass, 'public.jd_requirements'::regclass)
       and has_table_privilege('authenticated', c.oid, p.privilege_type)$$,
  array['application_projects:DELETE'],
  'authenticated: table-level writes on application tables = application_projects DELETE only');
select set_eq(
  $$select c.relname::text || '.' || a.attname || ':' || p.privilege_type
      from pg_class c
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      cross join lateral (values ('INSERT'), ('UPDATE')) p (privilege_type)
     where c.oid in ('public.application_projects'::regclass, 'public.application_stage_events'::regclass,
                     'public.job_descriptions'::regclass, 'public.jd_requirements'::regclass)
       and has_column_privilege('authenticated', c.oid, a.attnum, p.privilege_type)$$,
  array['application_projects.name:UPDATE', 'application_projects.deadline:UPDATE', 'application_projects.memo:UPDATE'],
  'authenticated: column writes on application tables = name / deadline / memo UPDATE');

-- S5 (DM §5 운영자): no API / app role can write stage columns or stage events directly.
select is_empty(
  $$select r.rolname, a.attname
      from pg_roles r
      cross join pg_attribute a
     where r.rolname in ('anon', 'authenticated', 'app_ai_writer', 'app_key_reader', 'service_role', 'authenticator')
       and a.attrelid = 'public.application_projects'::regclass
       and a.attname in ('stage', 'stage_outcome', 'stage_changed_at')
       and has_column_privilege(r.oid, a.attrelid, a.attnum, 'UPDATE')
    union all
    select r.rolname, p.privilege_type
      from pg_roles r
      cross join lateral (values ('INSERT'), ('UPDATE')) p (privilege_type)
     where r.rolname in ('anon', 'authenticated', 'app_ai_writer', 'app_key_reader', 'service_role', 'authenticator')
       and (has_table_privilege(r.oid, 'public.application_stage_events'::regclass, p.privilege_type)
            or has_any_column_privilege(r.oid, 'public.application_stage_events'::regclass, p.privilege_type))$$,
  'nobody can write application_projects.stage* or application_stage_events directly');

-- S5: app_ai_writer reads the project header but not the user's memo.
select ok(has_column_privilege('app_ai_writer', 'public.application_projects', 'name', 'SELECT')
          and not has_column_privilege('app_ai_writer', 'public.application_projects', 'memo', 'SELECT'),
          'app_ai_writer: application_projects name readable, memo not');

-- S4: writing chat RPCs by role (DM §5, §7). Career-writing RPCs (save / hand-off) are user-session only (DM-13).
select set_eq(
  $$select p.proname::text || ':' || r.rolname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      cross join (values ('anon'), ('authenticated'), ('app_ai_writer'), ('app_key_reader')) r (rolname)
     where n.nspname = 'public'
       and p.proname in ('start_writing_chat', 'append_writing_chat_message', 'begin_assistant_message',
                         'finish_assistant_message', 'mark_writing_chat_extracted', 'apply_structured_draft_patch',
                         'set_writing_chat_affiliation', 'save_writing_chat', 'hand_off_writing_chat')
       and has_function_privilege(r.rolname, p.oid, 'execute')$$,
  array['start_writing_chat:authenticated', 'append_writing_chat_message:authenticated',
        'set_writing_chat_affiliation:authenticated', 'save_writing_chat:authenticated', 'hand_off_writing_chat:authenticated',
        'apply_structured_draft_patch:authenticated', 'apply_structured_draft_patch:app_ai_writer',
        'begin_assistant_message:app_ai_writer', 'finish_assistant_message:app_ai_writer',
        'mark_writing_chat_extracted:app_ai_writer'],
  'S4 writing chat RPC execute matrix');

-- S4 (DM §2.5): no API / app role can UPDATE writing_chats.structured_draft directly.
select is_empty(
  $$select r.rolname from pg_roles r
     where r.rolname in ('anon', 'authenticated', 'app_ai_writer', 'app_key_reader', 'service_role', 'authenticator')
       and has_column_privilege(r.oid, 'public.writing_chats'::regclass, 'structured_draft', 'UPDATE')$$,
  'nobody can update writing_chats.structured_draft directly');

-- service_role-only functions (cron), catalog-wide (QA-S9-04 (c)): every public function service_role can execute
-- that no API role (anon / authenticated / app_ai_writer / app_key_reader) can. A new cron RPC must be added here.
select set_eq(
  $$select p.oid::regprocedure::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and has_function_privilege('service_role', p.oid, 'execute')
       and not has_function_privilege('anon', p.oid, 'execute')
       and not has_function_privilege('authenticated', p.oid, 'execute')
       and not has_function_privilege('app_ai_writer', p.oid, 'execute')
       and not has_function_privilege('app_key_reader', p.oid, 'execute')$$,
  array['sweep_stalled_ai_jobs(timestamp with time zone)',
        'claim_due_ai_jobs(timestamp with time zone,integer)',
        'purge_unlinked_writing_chats(timestamp with time zone,integer)',
        'purge_old_ai_jobs(timestamp with time zone,integer)',
        'purge_old_ai_usage_records(timestamp with time zone,integer)',
        'purge_old_account_deletion_logs(timestamp with time zone,integer)',
        'save_provider_key(uuid,text,text,bytea,bytea,bytea,text,text,text,text,uuid,text,smallint)',
        'record_provider_key_check(uuid,text,text,text)',
        'get_account_deletion_state(uuid,text)'],
  'service_role-only public functions = sweep / claim_due (S3a) + the 4 S9 retention purges + R1 server-only RPCs (A19 key save / check, A7 deletion state)');

-- QA-S9-04 (b): public functions the user session can execute, catalog-wide. Grows only with a user-session RPC
-- in DM §5 / §7.
select set_eq(
  $$select distinct p.proname::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and has_function_privilege('authenticated', p.oid, 'execute')$$,
  array['abandon_interview_session', 'add_cover_letter_question', 'append_writing_chat_message',
        'apply_structured_draft_patch', 'create_application_project', 'create_cover_letter_draft',
        'create_interview_session', 'delete_account', 'delete_career_item', 'delete_cover_letter_question',
        'delete_provider_key', 'get_account_deletion_summary', 'get_ai_usage_summary', 'get_consent_status',
        'get_data_readiness', 'get_deletion_impact', 'get_interview_question_reveals', 'hand_off_writing_chat',
        'mark_interview_result_viewed', 'move_application_stage', 'record_consents',
        'reorder_cover_letter_questions', 'reorder_project_details', 'request_ai_job_cancel',
        'save_writing_chat', 'set_active_ai_provider', 'set_application_outcome', 'set_section_sources',
        'set_writing_chat_affiliation', 'start_writing_chat', 'submit_interview_session'],
  'authenticated can execute exactly the S1–S9 user-session RPCs in public (R1 A19: key save / check moved to service_role)');

-- QA-S9-04 (a): every table in public has RLS enabled (a new table without RLS fails here).
select is_empty(
  $$select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity$$,
  'every public table has row level security enabled');

-- QA-S3-06: app_ai_writer reads profiles.updated_at (profile evidence snapshot).
select ok(has_column_privilege('app_ai_writer', 'public.profiles', 'updated_at', 'SELECT'),
          'app_ai_writer can read profiles.updated_at');

-- QA-S3-08: users can't read ai_jobs.params / step_outputs.
select ok(not has_column_privilege('authenticated', 'public.ai_jobs', 'step_outputs', 'SELECT')
          and not has_column_privilege('authenticated', 'public.ai_jobs', 'params', 'SELECT')
          and not has_table_privilege('authenticated', 'public.ai_jobs', 'SELECT'),
          'authenticated: ai_jobs select is column-level without params / step_outputs');

-- default privileges: new postgres-created objects in public are not opened to anon/authenticated.
select is_empty(
  $$select d.defaclobjtype, a.grantee::regrole::text
      from pg_default_acl d
      cross join lateral aclexplode(d.defaclacl) a
     where d.defaclrole = 'postgres'::regrole
       and (d.defaclnamespace = 'public'::regnamespace or d.defaclnamespace = 0)
       and a.grantee in ('anon'::regrole, 'authenticated'::regrole, 0)$$,
  'no default privileges to anon / authenticated / PUBLIC for postgres objects in public');

-- S3b (DM-16, DM 2.11.1): no role other than the owner holds any privilege on the 4 ciphertext columns.
select is_empty(
  $$select r.rolname, a.attname, p.privilege_type
      from pg_roles r
      cross join pg_attribute a
      cross join lateral (values ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) p (privilege_type)
     where a.attrelid = 'public.ai_provider_keys'::regclass
       and a.attname in ('key_ciphertext', 'key_nonce', 'wrapped_dek', 'kek_id')
       and r.rolname not in ('postgres', 'supabase_admin')
       and not r.rolsuper
       and not pg_has_role(r.oid, 'pg_read_all_data', 'usage')
       and not pg_has_role(r.oid, 'pg_write_all_data', 'usage')
       and has_column_privilege(r.oid, a.attrelid, a.attnum, p.privilege_type)$$,
  'no app / API role has any privilege on the ai_provider_keys ciphertext columns');

-- Platform roles that bypass grants through the predefined pg_read_all_data / pg_write_all_data
-- (can't be revoked per column). Pinned so a new member is noticed; DM 2.11.2 relies on the KEK living
-- outside the DB for these (spec-gaps 2026-10-29).
select set_eq(
  $$select r.rolname::text from pg_roles r
     where r.rolname not in ('postgres', 'supabase_admin', 'pg_read_all_data', 'pg_write_all_data')
       and not r.rolsuper
       and (pg_has_role(r.oid, 'pg_read_all_data', 'usage') or pg_has_role(r.oid, 'pg_write_all_data', 'usage'))$$,
  array['supabase_etl_admin', 'supabase_read_only_user'],
  'only supabase_etl_admin / supabase_read_only_user inherit pg_read_all_data / pg_write_all_data');

-- S3b: ai_provider_keys table-level privileges: authenticated DELETE only (select is column-level);
-- nothing for anon, app_ai_writer, app_key_reader, service_role.
select set_eq(
  $$select r.rolname::text || ':' || p.privilege_type
      from pg_roles r
      cross join lateral (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                                 ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p (privilege_type)
     where r.rolname in ('anon', 'authenticated', 'app_ai_writer', 'app_key_reader', 'service_role')
       and has_table_privilege(r.oid, 'public.ai_provider_keys'::regclass, p.privilege_type)$$,
  array['authenticated:DELETE'],
  'ai_provider_keys table privileges = authenticated DELETE only');

-- authenticated column-level SELECT on ai_provider_keys = DM 2.11.1 screen columns exactly; no INSERT / UPDATE.
select set_eq(
  $$select a.attname::text || ':' || p.privilege_type
      from pg_attribute a
      cross join lateral (values ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) p (privilege_type)
     where a.attrelid = 'public.ai_provider_keys'::regclass and a.attnum > 0 and not a.attisdropped
       and has_column_privilege('authenticated', a.attrelid, a.attnum, p.privilege_type)$$,
  array(select col || ':SELECT' from unnest(array['id', 'provider', 'connection_tier', 'key_last4', 'status',
    'last_verified_at', 'last_failure_cause', 'last_failure_at', 'created_at', 'updated_at']) col),
  'authenticated: ai_provider_keys SELECT on the 10 metadata columns only');

-- app_key_reader: no table / column privilege anywhere in public, and exactly one executable function.
select is_empty(
  $$select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public', 'private', 'auth', 'storage')
       and c.relkind in ('r', 'v', 'm', 'p', 'f')
       and (has_table_privilege('app_key_reader', c.oid, 'SELECT')
            or has_table_privilege('app_key_reader', c.oid, 'INSERT')
            or has_table_privilege('app_key_reader', c.oid, 'UPDATE')
            or has_table_privilege('app_key_reader', c.oid, 'DELETE')
            or has_any_column_privilege('app_key_reader', c.oid, 'SELECT')
            or has_any_column_privilege('app_key_reader', c.oid, 'INSERT')
            or has_any_column_privilege('app_key_reader', c.oid, 'UPDATE'))$$,
  'app_key_reader has no table or column privileges');
select set_eq(
  $$select p.oid::regprocedure::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private')
       and has_function_privilege('app_key_reader', p.oid, 'execute')$$,
  array['get_provider_key_secret(uuid)'],
  'app_key_reader can execute exactly get_provider_key_secret in public / private');

-- get_provider_key_secret: app_key_reader only.
select set_eq(
  $$select r.rolname::text
      from pg_roles r
     where r.rolname in ('anon', 'authenticated', 'app_ai_writer', 'app_key_reader', 'service_role', 'authenticator')
       and has_function_privilege(r.oid, 'public.get_provider_key_secret(uuid)', 'execute')$$,
  array['app_key_reader'],
  'get_provider_key_secret is executable by app_key_reader only');

-- S8 (DM §5, A.12 / A.13): interview RPC execute matrix. User-session RPCs vs app_ai_writer generation / evaluation.
select set_eq(
  $$select p.proname::text || ':' || r.rolname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      cross join (values ('anon'), ('authenticated'), ('app_ai_writer'), ('app_key_reader')) r (rolname)
     where n.nspname = 'public'
       and p.proname in ('create_interview_session', 'abandon_interview_session', 'mark_interview_result_viewed',
                         'submit_interview_session', 'get_interview_question_reveals',
                         'begin_interview_questions', 'save_interview_question', 'complete_interview_questions',
                         'fail_interview_questions', 'begin_interview_evaluation', 'save_answer_evaluation',
                         'fail_answer_evaluation', 'save_session_feedback', 'complete_interview_evaluation')
       and has_function_privilege(r.rolname, p.oid, 'execute')$$,
  array['create_interview_session:authenticated', 'abandon_interview_session:authenticated',
        'mark_interview_result_viewed:authenticated', 'submit_interview_session:authenticated',
        'get_interview_question_reveals:authenticated',
        'begin_interview_questions:app_ai_writer', 'save_interview_question:app_ai_writer',
        'complete_interview_questions:app_ai_writer', 'fail_interview_questions:app_ai_writer',
        'begin_interview_evaluation:app_ai_writer', 'save_answer_evaluation:app_ai_writer',
        'fail_answer_evaluation:app_ai_writer', 'save_session_feedback:app_ai_writer',
        'complete_interview_evaluation:app_ai_writer'],
  'S8 interview RPC execute matrix');

-- R2 (A1 change, DM 2.9.1 case (1)): retry_ai_job is the job runner's (app_ai_writer) only.
select set_eq(
  $$select r.rolname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      cross join (values ('anon'), ('authenticated'), ('service_role'), ('app_ai_writer'), ('app_key_reader')) r (rolname)
     where n.nspname = 'public' and p.proname = 'retry_ai_job'
       and has_function_privilege(r.rolname, p.oid, 'execute')$$,
  array['app_ai_writer'],
  'R2 retry_ai_job: execute = app_ai_writer only');

-- S8: user-session writes on the interview tables = interview_sessions DELETE + interview_answers.answer_text UPDATE.
select set_eq(
  $$select c.relname::text || ':' || p.privilege_type
      from pg_class c
      cross join lateral (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p (privilege_type)
     where c.oid in ('public.interview_sessions'::regclass, 'public.interview_questions'::regclass,
                     'public.interview_answers'::regclass, 'public.answer_evaluations'::regclass,
                     'public.session_feedbacks'::regclass)
       and has_table_privilege('authenticated', c.oid, p.privilege_type)$$,
  array['interview_sessions:DELETE'],
  'authenticated: table-level writes on interview tables = interview_sessions DELETE only');
select set_eq(
  $$select c.relname::text || '.' || a.attname || ':' || p.privilege_type
      from pg_class c
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      cross join lateral (values ('INSERT'), ('UPDATE')) p (privilege_type)
     where c.oid in ('public.interview_sessions'::regclass, 'public.interview_questions'::regclass,
                     'public.interview_answers'::regclass, 'public.answer_evaluations'::regclass,
                     'public.session_feedbacks'::regclass)
       and has_column_privilege('authenticated', c.oid, a.attnum, p.privilege_type)$$,
  array['interview_answers.answer_text:UPDATE'],
  'authenticated: column writes on interview tables = interview_answers.answer_text only (score slots never)');

-- S8: no other API / app role writes the interview tables directly (service_role keeps SELECT / DELETE).
select is_empty(
  $$select r.rolname, c.oid::regclass::text, p.privilege_type
      from pg_roles r
      cross join (values ('public.interview_sessions'::regclass), ('public.interview_questions'::regclass),
                         ('public.interview_answers'::regclass), ('public.answer_evaluations'::regclass),
                         ('public.session_feedbacks'::regclass)) c (oid)
      cross join lateral (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p (privilege_type)
     where r.rolname in ('anon', 'app_ai_writer', 'app_key_reader', 'authenticator', 'service_role')
       and not (r.rolname = 'service_role' and p.privilege_type = 'DELETE')
       and (has_table_privilege(r.oid, c.oid, p.privilege_type)
            or (p.privilege_type in ('INSERT', 'UPDATE') and has_any_column_privilege(r.oid, c.oid, p.privilege_type)))$$,
  'nobody but the user session (DM §5) writes the interview tables directly');

-- S8 (A.13): intent / good_answer_signals are never readable by the user session or anon; app_ai_writer reads them.
select ok(not has_column_privilege('authenticated', 'public.interview_questions', 'intent', 'SELECT')
          and not has_column_privilege('authenticated', 'public.interview_questions', 'good_answer_signals', 'SELECT')
          and not has_table_privilege('authenticated', 'public.interview_questions', 'SELECT')
          and not has_any_column_privilege('anon', 'public.interview_questions', 'SELECT')
          and has_column_privilege('app_ai_writer', 'public.interview_questions', 'intent', 'SELECT')
          and has_column_privilege('app_ai_writer', 'public.interview_questions', 'good_answer_signals', 'SELECT'),
          'interview_questions private columns: no user grant, app_ai_writer reads');

select * from finish();
rollback;
