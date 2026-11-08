-- R13 ⑪ policy_versions.policy_type += 'ai_data_use' (DM v4.12 §2.1.3; D-UX-31·SD-A13, R-SD-14).
-- The 약관 탭's four [전문 확인] links must all open the same shape (/policies/{type} + "버전 … · 시행일 …"),
-- so the AI 데이터 처리 document gets its own policy_versions row. ai_disclosures stays the body source
-- (provider × tier, 6 rows) — it has no single document version.
--   document_path follows the existing /policies/{type}/{version} rule (R-SD-14): the value is a record, not a
--   link; the page address is the version-less /policies/ai_data_use.
--   requires_reconsent = false, fixed [가정] — this is a notice document; consent is taken per provider at key
--   connection time (ai_data_use_consents).
--   consents.consent_type is NOT touched (DM §2.1.3): the sign-up gate still looks only at terms /
--   privacy_required, so this row cannot change get_consent_status().needs_consent.
-- version / effective_at: 법무 확인 뒤 값이므로 지금은 ai_disclosures v2026-11-05와 같은 날짜를 쓴다 [가정]
-- (20261113001100_r11_ai_disclosures_v2026_11_05, terms_checked_at = 2026-11-05).

alter table public.policy_versions drop constraint policy_versions_policy_type_check;
alter table public.policy_versions
  add constraint policy_versions_policy_type_check
    check (policy_type in ('terms', 'privacy', 'cross_border_transfer', 'ai_data_use'));

insert into public.policy_versions (policy_type, version, effective_at, requires_reconsent, document_path)
values ('ai_data_use', '2026-11-05', '2026-11-05 00:00:00+09', false,
        '/policies/ai_data_use/2026-11-05')
on conflict (policy_type, version) do nothing;
