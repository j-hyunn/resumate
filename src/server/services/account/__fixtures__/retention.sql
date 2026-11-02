-- Test-only fixture for account.integration.test.ts (retention cron boundaries).
-- Rows for user :'uid' (who already has the all-slices fixture: one application
-- project, a `projects` row) at both sides of each retention boundary relative
-- to :'now'. Replica mode so triggers don't overwrite the timestamps.
-- Prints "<label>|<id>" per row so the test can check which ones survive.
\set ON_ERROR_STOP on
begin;
set local session_replication_role = replica;
select set_config('t.uid', :'uid', true), set_config('t.now', :'now', true) \gset t_

create temporary table fx (label text, id uuid) on commit drop;

do $$
declare
  u uuid := current_setting('t.uid')::uuid;
  n timestamptz := current_setting('t.now')::timestamptz;
  prj uuid := (select id from public.projects where user_id = u limit 1);
  kst_month date := date_trunc('month', n at time zone 'Asia/Seoul')::date;
  id uuid;
begin
  -- Unlinked writing chats: 90 days after last activity (D-DM-08).
  id := gen_random_uuid();
  insert into public.writing_chats (id, user_id, mode, status, last_activity_at) values (id, u, 'new_project', 'active', n - interval '91 days');
  insert into fx values ('chat_unlinked_91d', id);
  id := gen_random_uuid();
  insert into public.writing_chats (id, user_id, mode, status, last_activity_at) values (id, u, 'new_project', 'abandoned', n - interval '89 days');
  insert into fx values ('chat_unlinked_89d', id);
  id := gen_random_uuid();
  insert into public.writing_chats (id, user_id, mode, status, project_id, last_activity_at) values (id, u, 'augment_project', 'active', prj, n - interval '400 days');
  insert into fx values ('chat_linked_400d', id);

  -- ai_jobs: finished 90 days ago; in-flight jobs are never purged.
  id := gen_random_uuid();
  insert into public.ai_jobs (id, user_id, job_type, provider, model_tier, connection_tier, status, created_at, finished_at)
    values (id, u, 'key_verification', 'gemini', 'light', 'paid', 'succeeded', n - interval '95 days', n - interval '91 days');
  insert into fx values ('job_done_91d', id);
  id := gen_random_uuid();
  insert into public.ai_jobs (id, user_id, job_type, provider, model_tier, connection_tier, status, created_at, finished_at)
    values (id, u, 'key_verification', 'gemini', 'light', 'paid', 'failed', n - interval '95 days', n - interval '89 days');
  insert into fx values ('job_done_89d', id);
  id := gen_random_uuid();
  insert into public.ai_jobs (id, user_id, job_type, provider, model_tier, connection_tier, status, created_at)
    values (id, u, 'key_verification', 'gemini', 'light', 'paid', 'queued', n - interval '200 days');
  insert into fx values ('job_queued_200d', id);

  -- ai_usage_records: 13 KST months including the current one (D-DM-09 [가정]).
  id := gen_random_uuid();
  insert into public.ai_usage_records (id, user_id, occurred_at, period_month, feature, job_type, provider, model, model_tier, connection_tier, usage_source, outcome, price_table_version, estimated_cost_usd)
    values (id, u, (kst_month - interval '13 months')::timestamp at time zone 'Asia/Seoul', kst_month - interval '13 months',
            'key_verification', 'key_verification', 'gemini', 'gm', 'light', 'paid', 'unavailable', 'succeeded', 'p1', 0);
  insert into fx values ('usage_month_minus_13', id);
  id := gen_random_uuid();
  insert into public.ai_usage_records (id, user_id, occurred_at, period_month, feature, job_type, provider, model, model_tier, connection_tier, usage_source, outcome, price_table_version, estimated_cost_usd)
    values (id, u, (kst_month - interval '12 months')::timestamp at time zone 'Asia/Seoul', kst_month - interval '12 months',
            'key_verification', 'key_verification', 'gemini', 'gm', 'light', 'paid', 'unavailable', 'succeeded', 'p1', 0);
  insert into fx values ('usage_month_minus_12', id);

  -- account_deletion_logs: 3 years.
  id := gen_random_uuid();
  insert into public.account_deletion_logs (id, subject_hash, requested_at, db_deleted_at, reason)
    values (id, encode(extensions.gen_random_bytes(32), 'hex'), n - interval '3 years 1 day', n - interval '3 years 1 day', 'user_request');
  insert into fx values ('log_3y_plus', id);
  id := gen_random_uuid();
  insert into public.account_deletion_logs (id, subject_hash, requested_at, db_deleted_at, reason)
    values (id, encode(extensions.gen_random_bytes(32), 'hex'), n - interval '3 years' + interval '1 day', n - interval '3 years' + interval '1 day', 'user_request');
  insert into fx values ('log_3y_minus', id);
end $$;

select label || '|' || id from fx;
commit;
