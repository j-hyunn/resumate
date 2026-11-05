-- R11 OD-L2 / OD-L2a (DM v4.11 2.11.6, 4.5, 11.6 #12; AI v4.11 C-7.1): AI disclosure version v2026-11-05, 6 rows
-- (3 providers x 2 tiers). The v2026-10-29 rows stay untouched (consent rows point at them).
--   * requires_reconsent: anthropic rows only (processing region "inference global (several countries), storage US"
--     widens the transfer). Gemini / OpenAI rows only make the wording concrete -> no reconsent.
--   * requires_free_tier_ack: gemini free only (R-OD-15: the only tier whose input is used for training / product
--     improvement). This needs the S3b CHECK ai_disclosures_free_tier_ack_check ("every free row needs the ack")
--     dropped; nothing in the app reads the column (the consent row CHECK on ai_data_use_consents is unchanged —
--     see spec-gaps 2026-11-05 R11).
--   * effective_at 2026-11-05 00:00 KST [가정 DM 2.11.6]: in effect as soon as this is applied. The disclosure text
--     module (UI) must ship in the same deploy.
-- Insert only (on conflict do nothing); not destructive.

alter table public.ai_disclosures drop constraint ai_disclosures_free_tier_ack_check;

insert into public.ai_disclosures
  (provider, connection_tier, version, effective_at, requires_reconsent, requires_free_tier_ack,
   document_path, terms_checked_at)
select p, t, 'v2026-11-05', '2026-11-05 00:00:00+09', p = 'anthropic', p = 'gemini' and t = 'free',
       '/policies/ai/' || p || '/' || t || '/v2026-11-05', '2026-11-05'
  from unnest(array['gemini', 'anthropic', 'openai']) p
 cross join unnest(array['free', 'paid']) t
on conflict (provider, connection_tier, version) do nothing;
