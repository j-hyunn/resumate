-- S1 QA-04: global grant guard. Fails when a new object in `public` is opened to anon or
-- app_ai_writer beyond the allow list. Update the allow lists only together with DM §5.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

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
        'ai_jobs:SELECT', 'evidence_links:SELECT', 'ai_usage_records:SELECT', 'ai_price_tables:SELECT'],
  'app_ai_writer table privileges in public: SELECT on career + AI tables only');

-- profiles stays column-level for app_ai_writer (display_name excluded, A.1).
select ok(not has_column_privilege('app_ai_writer', 'public.profiles', 'display_name', 'SELECT'),
          'app_ai_writer cannot read profiles.display_name');

-- QA-S2-05 -> S3 allow list: app_ai_writer column-level writes in public are exactly these
-- (DM §5: ai_jobs, evidence_links, ai_usage_records insert; career tables and ai_price_tables never).
-- Grows only with DM §5 (S4: writing_chats.message_count / last_activity_at, writing_chat_messages assistant).
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
      'reasoning_tokens', 'usage_source', 'outcome', 'error_code', 'price_table_version', 'estimated_cost_usd']) col
    union all
    select 'evidence_links.' || col || ':INSERT' from unnest(array['id', 'user_id', 'application_project_id',
      'owner_type', 'owner_id', 'item_key', 'sort_order', 'source_type', 'source_id', 'source_locator', 'source_field',
      'quote', 'quote_adjusted', 'source_snapshot_at', 'source_label']) col),
  'app_ai_writer column-level INSERT / UPDATE / REFERENCES in public = S3a allow list');

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
        'check_ai_run_allowed'],
  'app_ai_writer can execute exactly get_data_readiness, complete_ai_job, the two key-status RPCs and check_ai_run_allowed (S3b)');

-- service_role-only job functions (cron): exactly these in public beyond what authenticated can run.
select set_eq(
  $$select p.proname::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('sweep_stalled_ai_jobs', 'claim_due_ai_jobs')
       and has_function_privilege('service_role', p.oid, 'execute')
       and not has_function_privilege('authenticated', p.oid, 'execute')
       and not has_function_privilege('app_ai_writer', p.oid, 'execute')$$,
  array['sweep_stalled_ai_jobs', 'claim_due_ai_jobs'],
  'sweep / claim_due are service_role only');

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

select * from finish();
rollback;
