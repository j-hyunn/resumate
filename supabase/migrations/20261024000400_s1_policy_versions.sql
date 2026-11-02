-- S1 foundation: policy_versions (DM A.2). Non-user table, readable by everyone,
-- written only by migrations.

create table public.policy_versions (
  id uuid primary key default gen_random_uuid(),
  policy_type text not null,
  version text not null,
  effective_at timestamptz not null,
  requires_reconsent boolean not null default false,
  document_path text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint policy_versions_policy_type_check
    check (policy_type in ('terms', 'privacy', 'cross_border_transfer')),
  constraint policy_versions_policy_type_version_key unique (policy_type, version)
);

alter table public.policy_versions enable row level security;

create index policy_versions_type_effective_idx
  on public.policy_versions (policy_type, effective_at desc);

create trigger policy_versions_set_updated_at
  before update on public.policy_versions
  for each row execute function private.set_updated_at();

create policy policy_versions_select_all on public.policy_versions
  for select to anon, authenticated
  using (true);

revoke all on table public.policy_versions from anon, authenticated;
grant select on table public.policy_versions to anon, authenticated;

-- Initial versions. [가정] version string, effective date and document path are placeholders
-- until the real policy documents are fixed (spec-gaps.md 2026-10-24 S1, D-10).
insert into public.policy_versions (policy_type, version, effective_at, requires_reconsent, document_path)
values
  ('terms',                 '2026-10-01', '2026-10-01 00:00:00+09', true, '/policies/terms/2026-10-01'),
  ('privacy',               '2026-10-01', '2026-10-01 00:00:00+09', true, '/policies/privacy/2026-10-01'),
  ('cross_border_transfer', '2026-10-01', '2026-10-01 00:00:00+09', true, '/policies/cross_border_transfer/2026-10-01');
