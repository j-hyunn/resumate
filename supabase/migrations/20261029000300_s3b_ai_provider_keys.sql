-- S3b: ai_provider_keys (DM 2.11.1, DM-16, NFR-KEY-01..09) + profiles.active_ai_provider (DM 2.11.4, DM-17).
-- The four ciphertext columns (key_ciphertext, key_nonce, wrapped_dek, kek_id) are granted to NO role:
-- not anon, authenticated, app_ai_writer, app_key_reader, nor service_role (operators). They are written
-- by save_provider_key and read by get_provider_key_secret, both security definer (owner = postgres).

create table public.ai_provider_keys (
  id uuid primary key,   -- no default: the server picks the id before encrypting (AAD), spec-gaps 2026-10-29
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  provider text not null,
  connection_tier text not null,
  key_ciphertext bytea not null,
  key_nonce bytea not null,
  wrapped_dek bytea not null,
  kek_id text not null,
  encryption_version smallint not null default 1,
  key_last4 text not null,
  status text not null,
  last_verified_at timestamptz,
  last_failure_cause text,
  last_failure_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_provider_keys_provider_check check (provider in ('openai', 'gemini', 'anthropic')),
  constraint ai_provider_keys_connection_tier_check check (connection_tier in ('free', 'paid')),
  constraint ai_provider_keys_status_check check (status in ('valid', 'invalid', 'needs_check')),
  constraint ai_provider_keys_key_last4_check check (char_length(key_last4) = 4),
  constraint ai_provider_keys_encryption_version_check check (encryption_version >= 1),
  constraint ai_provider_keys_ciphertext_check
    check (octet_length(key_ciphertext) > 0 and octet_length(key_nonce) > 0
           and octet_length(wrapped_dek) > 0 and char_length(kek_id) > 0),
  -- 2.9.1 failure_cause (F-AI-08, 7 values).
  constraint ai_provider_keys_last_failure_cause_check check (last_failure_cause in (
    'rate_limited', 'daily_quota_exhausted', 'billing_required', 'key_invalid', 'model_not_available',
    'provider_unavailable', 'input_rejected')),
  constraint ai_provider_keys_user_provider_key unique (user_id, provider),
  constraint ai_provider_keys_id_user_key unique (id, user_id)
);

alter table public.ai_provider_keys enable row level security;

create trigger ai_provider_keys_set_updated_at
  before update on public.ai_provider_keys
  for each row execute function private.set_updated_at();

-- RLS (DM §5): select own (metadata columns only, via column grants); insert / update via definer RPCs
-- only; delete own (delete_provider_key is security invoker).
create policy ai_provider_keys_select_own on public.ai_provider_keys
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy ai_provider_keys_delete_own on public.ai_provider_keys
  for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on table public.ai_provider_keys from anon, authenticated, service_role;
grant select (id, provider, connection_tier, key_last4, status, last_verified_at, last_failure_cause,
              last_failure_at, created_at, updated_at)
  on table public.ai_provider_keys to authenticated;
grant delete on table public.ai_provider_keys to authenticated;
-- Operators (service_role) see metadata only (NFR-KEY-07). app_ai_writer / app_key_reader: nothing.
grant select (id, user_id, provider, connection_tier, encryption_version, key_last4, status, last_verified_at,
              last_failure_cause, last_failure_at, created_at, updated_at)
  on table public.ai_provider_keys to service_role;

-- Screens read this view (DM 2.11.1). security invoker: RLS and column grants of the caller apply.
create view public.ai_provider_keys_public
with (security_invoker = true) as
select id, provider, connection_tier, key_last4, status, last_verified_at, last_failure_cause,
       last_failure_at, created_at, updated_at
  from public.ai_provider_keys;

revoke all on table public.ai_provider_keys_public from anon, authenticated, service_role;
grant select on table public.ai_provider_keys_public to authenticated;

-- profiles.active_ai_provider (DM 2.11.4). The composite FK makes a provider without a key unselectable,
-- and deleting the key clears only this column (no automatic switch, F-AI-02 (3)).
alter table public.profiles
  add column active_ai_provider text,
  add constraint profiles_active_ai_provider_check
    check (active_ai_provider in ('openai', 'gemini', 'anthropic')),
  add constraint profiles_active_ai_provider_fkey
    foreign key (id, active_ai_provider)
    references public.ai_provider_keys (user_id, provider)
    on delete set null (active_ai_provider);

-- Users read it (table-level select on profiles already covers new columns) but change it only through
-- set_active_ai_provider / save_provider_key: no update grant. app_ai_writer: no grant (the job's provider
-- is fixed at start from the user session, DM-17).
