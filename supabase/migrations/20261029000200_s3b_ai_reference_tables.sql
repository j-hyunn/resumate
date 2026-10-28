-- S3b: AI connection reference tables (DM 2.11.6, F-AI-04, F-AI-05 (3), F-AI-08, D-38).
-- Non-user tables: read by users (ai_disclosures also by anon for the public privacy page), written by
-- operators only (new rows / migrations). Seeds are the first versions [가정, spec-gaps 2026-10-29].

-- ai_providers: connection screen list, key guide version, provider dashboard links.
create table public.ai_providers (
  provider text primary key,
  display_order smallint not null,
  is_available boolean not null default false,   -- D-38 launch gate: false = "준비 중"
  is_recommended boolean not null default false,
  dashboard_url text,
  billing_url text,
  key_guide_version text,
  key_guide_checked_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_providers_provider_check check (provider in ('openai', 'gemini', 'anthropic')),
  constraint ai_providers_display_order_key unique (display_order)
);

alter table public.ai_providers enable row level security;

create trigger ai_providers_set_updated_at
  before update on public.ai_providers
  for each row execute function private.set_updated_at();

create policy ai_providers_select_authenticated on public.ai_providers
  for select to authenticated using (true);

revoke all on table public.ai_providers from anon, authenticated;
grant select on table public.ai_providers to authenticated;

-- UB-3: all three providers open at launch; Gemini recommended (free tier) [가정].
-- URLs are the providers' official consoles as of 2026-10-29 [가정: operators re-check with the key guide].
insert into public.ai_providers
  (provider, display_order, is_available, is_recommended, dashboard_url, billing_url,
   key_guide_version, key_guide_checked_at)
values
  ('gemini', 1, true, true, 'https://aistudio.google.com/usage', 'https://aistudio.google.com/billing',
   'v2026-10-29', '2026-10-29'),
  ('anthropic', 2, true, false, 'https://platform.claude.com/usage', 'https://platform.claude.com/settings/billing',
   'v2026-10-29', '2026-10-29'),
  ('openai', 3, true, false, 'https://platform.openai.com/usage',
   'https://platform.openai.com/settings/organization/billing/overview',
   'v2026-10-29', '2026-10-29');

-- ai_disclosures: per provider x tier disclosure versions (F-AI-04, D-10). Append-only: a new
-- disclosure is a new row; the current one is the latest with effective_at <= now().
create table public.ai_disclosures (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  connection_tier text not null,
  version text not null,
  effective_at timestamptz not null,
  requires_reconsent boolean not null default false,
  requires_free_tier_ack boolean not null default false,
  document_path text not null,
  terms_checked_at date,
  created_at timestamptz not null default now(),
  constraint ai_disclosures_provider_check check (provider in ('openai', 'gemini', 'anthropic')),
  constraint ai_disclosures_connection_tier_check check (connection_tier in ('free', 'paid')),
  constraint ai_disclosures_version_key unique (provider, connection_tier, version),
  -- F-AI-04 (3): the free tier always needs the separate acknowledgement.
  constraint ai_disclosures_free_tier_ack_check check (connection_tier <> 'free' or requires_free_tier_ack)
);

alter table public.ai_disclosures enable row level security;

create index ai_disclosures_current_idx
  on public.ai_disclosures (provider, connection_tier, effective_at desc);

create policy ai_disclosures_select_all on public.ai_disclosures
  for select to anon, authenticated using (true);

revoke all on table public.ai_disclosures from anon, authenticated;
grant select on table public.ai_disclosures to anon, authenticated;

-- [가정] spec-gaps 2026-10-29: first version v2026-10-29 for 3 providers x 2 tiers. Final wording after
-- legal review (D-39). effective_at is 2026-10-28 KST so the version is in effect as soon as it is deployed.
insert into public.ai_disclosures
  (provider, connection_tier, version, effective_at, requires_reconsent, requires_free_tier_ack,
   document_path, terms_checked_at)
select p, t, 'v2026-10-29', '2026-10-28 00:00:00+09', false, t = 'free',
       '/policies/ai/' || p || '/' || t || '/v2026-10-29', '2026-10-29'
  from unnest(array['gemini', 'anthropic', 'openai']) p
 cross join unnest(array['free', 'paid']) t;

-- Current disclosure version for a provider x tier (null if none is effective yet).
create or replace function private.current_ai_disclosure_version(p_provider text, p_connection_tier text)
returns text
language sql
stable
set search_path = ''
as $$
  select d.version
    from public.ai_disclosures d
   where d.provider = p_provider
     and d.connection_tier = p_connection_tier
     and d.effective_at <= now()
   order by d.effective_at desc, d.created_at desc
   limit 1;
$$;

revoke all on function private.current_ai_disclosure_version(text, text) from public;
grant execute on function private.current_ai_disclosure_version(text, text) to authenticated, service_role;
