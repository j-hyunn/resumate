-- R13 settings dialog follow-ups that have no table of their own
-- (DM v4.12 §2.1.3 policy_versions ai_data_use, §2.8 SD-A19 allowed sources, §2.1.5 SD-6 grants).
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated');

-- ── ⑪ policy_versions.policy_type = 'ai_data_use' (D-UX-31, R-SD-14) ──
-- 2026-11-08: 본문 원문(docs/legal/ai-data-use.md)이 생겨 새 버전 행을 더했다 (UI42-8, 20261113002900).
-- 2026-11-09: CF-S6 (R15) — 경력기술서 문구 삭제 개정판.
select is((select count(*)::int from public.policy_versions where policy_type = 'ai_data_use'), 4,
          'ai_data_use rows: 2026-11-05 + 2026-11-08 + 2026-11-08.1 (R14) + 2026-11-09 (R15, CF-S6)');
select results_eq($$select version, requires_reconsent, document_path from public.policy_versions
                     where policy_type = 'ai_data_use' order by version$$,
  $$values ('2026-11-05', false, '/policies/ai_data_use/2026-11-05'),
           ('2026-11-08', false, '/policies/ai_data_use/2026-11-08'),
           ('2026-11-08.1', false, '/policies/ai_data_use/2026-11-08.1'),
           ('2026-11-09', false, '/policies/ai_data_use/2026-11-09')$$,
  'document_path follows /policies/{type}/{version}, no reconsent (R-SD-14)');
select ok((select pg_get_constraintdef(oid) like '%ai_data_use%'
            from pg_constraint where conname = 'policy_versions_policy_type_check'),
          'policy_type CHECK lists ai_data_use');
-- consents.consent_type is untouched: the new document is a notice, not a consent (DM §2.1.3)
select ok((select pg_get_constraintdef(oid) not like '%ai_data_use%'
            from pg_constraint where conname = 'consents_consent_type_check'),
          'consents.consent_type does NOT gain ai_data_use');
-- the sign-up consent gate still looks at terms / privacy_required only
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.get_consent_status()), 5,
          'get_consent_status still returns the 5 consent types (no ai_data_use)');
select is((select array_agg(consent_type order by consent_type) from public.get_consent_status()
            where required), array['privacy_required', 'terms'],
          'the sign-up gate still requires terms / privacy_required only');
select is((select count(*)::int from public.get_consent_status() where required and needs_consent), 2,
          'a new user still needs both required consents');
select * from public.record_consents(
  '[{"consent_type":"terms","agreed":true},{"consent_type":"privacy_required","agreed":true}]'::jsonb, null);
select is((select count(*)::int from public.get_consent_status() where required and needs_consent), 0,
          'consent recorded: the gate is satisfied without any ai_data_use consent');
reset role;

-- ── ⑫ allowed career sources: 5종 everywhere (SD-A19) ──
-- the shared validators refuse a profile source
select is(private.insight_payload_valid(jsonb_build_object(
            'result', '{}'::jsonb, 'match_stage_result', '{}'::jsonb,
            'hashes', '{"requirements_hash":"r","career_snapshot_hash":"c","input_hash":"i"}'::jsonb,
            'meta', '{"schema_version":1,"prompt_version":"p","provider":"gemini","model":"m",
                      "model_tier":"default","connection_tier":"free"}'::jsonb,
            'evidence', jsonb_build_array(jsonb_build_object(
              'item_key', 'strengths.0', 'sort_order', 0, 'source_type', 'profile',
              'source_id', 'a0000000-0000-0000-0000-000000000001', 'source_field', 'desired_job_title')))),
          false, 'insight payload with a profile source is invalid');
select is(private.insight_payload_valid(jsonb_build_object(
            'result', '{}'::jsonb, 'match_stage_result', '{}'::jsonb,
            'hashes', '{"requirements_hash":"r","career_snapshot_hash":"c","input_hash":"i"}'::jsonb,
            'meta', '{"schema_version":1,"prompt_version":"p","provider":"gemini","model":"m",
                      "model_tier":"default","connection_tier":"free"}'::jsonb,
            'evidence', jsonb_build_array(jsonb_build_object(
              'item_key', 'strengths.0', 'sort_order', 0, 'source_type', 'experience',
              'source_id', 'a0000000-0000-0000-0000-000000000001', 'source_field', 'summary')))),
          true, 'the same payload with an experience source is valid');
-- every result-saving RPC uses the same 5-source list (no 'profile' left in any allowed-source array)
select is_empty($$select n.nspname || '.' || p.proname
                    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname in ('public', 'private')
                     and p.prosrc like '%array[''profile'', ''experience''%'$$,
                'no function still lists profile among the allowed career sources');
select is_empty($$select n.nspname || '.' || p.proname
                    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname in ('public', 'private')
                     and p.prosrc like '%''profile'', ''experience'', ''education''%'$$,
                'no allowed-source list starts with profile, experience, education');

select * from finish();
rollback;
