-- Cross-border transfer notice 2026-11-04.1 (docs/legal/cross-border-transfer.md): adds recipients' contacts
-- and policy links, retention, the Gmail inactivity notice (processing abroad) and a contact line. The
-- processing itself does not change, and cross_border_transfer is not a sign-up consent (20261108000100), so
-- no reconsent. Effective from the same day so S-30 shows the new version as soon as this is applied.
insert into public.policy_versions (policy_type, version, effective_at, requires_reconsent, document_path)
values ('cross_border_transfer', '2026-11-04.1', '2026-11-04 15:00:00+09', false,
        '/policies/cross_border_transfer/2026-11-04.1')
on conflict (policy_type, version) do nothing;
