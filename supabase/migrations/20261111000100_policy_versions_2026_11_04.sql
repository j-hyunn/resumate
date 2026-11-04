-- Official policy texts (docs/legal/privacy-policy.md, docs/legal/terms-of-service.md), effective
-- 2026-11-04 KST (확정 2026-11-04 (사용자)). Replaces the 2026-10-01 placeholder rows as the
-- current version; the old rows stay so existing consents keep pointing at a real version.
-- terms / privacy: requires_reconsent = true — first real text, so anyone who agreed to the
-- placeholder is asked again at S-03. cross_border_transfer is no longer a sign-up consent
-- (20261108000100), so its flag has no gate effect; false.
insert into public.policy_versions (policy_type, version, effective_at, requires_reconsent, document_path)
values
  ('terms',                 '2026-11-04', '2026-11-04 00:00:00+09', true,  '/policies/terms/2026-11-04'),
  ('privacy',               '2026-11-04', '2026-11-04 00:00:00+09', true,  '/policies/privacy/2026-11-04'),
  ('cross_border_transfer', '2026-11-04', '2026-11-04 00:00:00+09', false, '/policies/cross_border_transfer/2026-11-04')
on conflict (policy_type, version) do nothing;
