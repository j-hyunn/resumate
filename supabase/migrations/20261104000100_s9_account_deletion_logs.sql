-- S9 account_deletion_logs (DM A.17, §4.4; PRD F-COM-05, NFR-PRV-06, D-DM-02 (b)).
-- De-identified proof of account deletion, kept 3 years. No user id / email / FK to auth.users:
-- subject_hash is an HMAC of the user id computed by the server with a secret the DB never sees.
-- Written only inside public.delete_account (security definer). Users, app_ai_writer and app_key_reader have
-- no privilege at all; service_role keeps SELECT / DELETE (operator evidence lookup). Rows older than 3 years
-- are removed by public.purge_old_account_deletion_logs (S9 retention cron).

create table public.account_deletion_logs (
  id uuid primary key default gen_random_uuid(),
  subject_hash text not null,
  requested_at timestamptz not null default now(),
  db_deleted_at timestamptz,
  storage_deleted_at timestamptz,
  reason text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_deletion_logs_subject_hash_check check (subject_hash ~ '^[0-9a-f]{64}$'),
  constraint account_deletion_logs_subject_hash_key unique (subject_hash),
  constraint account_deletion_logs_reason_check check (reason in ('user_request', 'inactivity')),
  constraint account_deletion_logs_db_deleted_at_check check (db_deleted_at is null or db_deleted_at >= requested_at),
  constraint account_deletion_logs_storage_deleted_at_check
    check (storage_deleted_at is null or storage_deleted_at >= requested_at)
);

comment on table public.account_deletion_logs is
  'De-identified account deletion proof (DM A.17). subject_hash = server-side HMAC of the user id. 3 years.';

-- Retention purge scans by requested_at.
create index account_deletion_logs_requested_at_idx on public.account_deletion_logs (requested_at);

create trigger account_deletion_logs_set_updated_at
  before update on public.account_deletion_logs
  for each row execute function private.set_updated_at();

-- RLS on, no policy: nobody reads or writes through RLS. Only definer functions (owner postgres) touch rows.
alter table public.account_deletion_logs enable row level security;

revoke all on table public.account_deletion_logs from public, anon, authenticated, app_ai_writer, app_key_reader;
revoke insert, update, truncate, references, trigger on table public.account_deletion_logs from service_role;
