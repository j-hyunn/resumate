-- S1 QA-04: global grant guard. Fails when a new object in `public` is opened to anon or
-- app_ai_writer beyond the allow list. Update the allow lists only together with DM §5.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- anon table privileges in public: only SELECT on policy_versions.
select set_eq(
  $$select c.relname::text || ':' || p.privilege_type
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                                 ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p (privilege_type)
     where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f')
       and has_table_privilege('anon', c.oid, p.privilege_type)$$,
  array['policy_versions:SELECT'],
  'anon has only SELECT on policy_versions in public');

-- anon column-level privileges: none.
select is_empty(
  $$select table_name, column_name, privilege_type
      from information_schema.column_privileges
     where table_schema = 'public' and grantee = 'anon'
       and table_name <> 'policy_versions'$$,
  'anon has no column privileges outside policy_versions');

-- public functions anon can execute: none.
select is_empty(
  $$select p.oid::regprocedure::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and has_function_privilege('anon', p.oid, 'execute')$$,
  'anon cannot execute any public function');

-- app_ai_writer table-level privileges in public. S1: none (profiles is column-level only).
-- S2: SELECT on the 7 career tables, nothing else (DM §5, DM-13: career tables are read-only).
-- S3: + SELECT on ai_jobs, evidence_links, usage_events, usage_limits (writes are column-level / RPC).
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
        'ai_jobs:SELECT', 'evidence_links:SELECT', 'usage_events:SELECT', 'usage_limits:SELECT'],
  'app_ai_writer table privileges in public: SELECT on career + S3 AI tables only');

-- profiles stays column-level for app_ai_writer (display_name excluded, A.1).
select ok(not has_column_privilege('app_ai_writer', 'public.profiles', 'display_name', 'SELECT'),
          'app_ai_writer cannot read profiles.display_name');

-- QA-S2-05 -> S3 allow list: app_ai_writer column-level writes in public are exactly these
-- (DM §5: ai_jobs, evidence_links; usage_events only through definer RPCs; career tables never).
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
      'target_type', 'target_id', 'status', 'progress', 'params', 'step_outputs', 'attempt_count', 'error_code',
      'input_hash', 'prompt_version', 'model', 'usage', 'output', 'heartbeat_at', 'started_at', 'finished_at']) col
    union all
    select 'ai_jobs.' || col || ':UPDATE' from unnest(array['status', 'progress', 'step_outputs', 'attempt_count',
      'error_code', 'input_hash', 'prompt_version', 'model', 'usage', 'output', 'heartbeat_at', 'started_at',
      'finished_at']) col
    union all
    select 'evidence_links.' || col || ':INSERT' from unnest(array['id', 'user_id', 'application_project_id',
      'owner_type', 'owner_id', 'item_key', 'sort_order', 'source_type', 'source_id', 'source_locator', 'source_field',
      'quote', 'quote_adjusted', 'source_snapshot_at', 'source_label']) col),
  'app_ai_writer column-level INSERT / UPDATE / REFERENCES in public = S3 allow list');

-- authenticated: no write privilege at all on the S3 AI tables (cancel and ledger go through RPCs).
select is_empty(
  $$select c.relname, p.privilege_type
      from pg_class c
      cross join lateral (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p (privilege_type)
     where c.oid in ('public.ai_jobs'::regclass, 'public.evidence_links'::regclass,
                     'public.usage_events'::regclass, 'public.usage_limits'::regclass)
       and (has_table_privilege('authenticated', c.oid, p.privilege_type)
            or (p.privilege_type in ('INSERT', 'UPDATE')
                and has_any_column_privilege('authenticated', c.oid, p.privilege_type)))$$,
  'authenticated cannot write S3 AI tables directly');

-- app_ai_writer can never write usage_events / usage_limits directly.
select ok(not has_any_column_privilege('app_ai_writer', 'public.usage_events', 'INSERT')
          and not has_any_column_privilege('app_ai_writer', 'public.usage_events', 'UPDATE')
          and not has_table_privilege('app_ai_writer', 'public.usage_events', 'DELETE'),
          'app_ai_writer has no direct write on usage_events');

-- app_ai_writer can execute exactly these public functions.
select set_eq(
  $$select p.proname::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and has_function_privilege('app_ai_writer', p.oid, 'execute')$$,
  array['get_data_readiness', 'get_usage_summary', 'reserve_usage', 'charge_usage', 'release_usage',
        'charge_usage_for_job', 'release_usage_for_job', 'complete_ai_job'],
  'app_ai_writer can execute exactly the readiness, usage summary and ledger functions in public');

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

select * from finish();
rollback;
