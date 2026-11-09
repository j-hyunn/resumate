-- S1 policy_versions: public read, no writes (DM A.2).
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

select ok((select relrowsecurity from pg_class where oid = 'public.policy_versions'::regclass),
          'RLS enabled on policy_versions');
select is((select count(*)::int from public.policy_versions), 20, 'placeholder + 2026-11-04 + cross-border 2026-11-04.1 + 2026-11-05 + ai_data_use + privacy·ai_data_use 2026-11-08 + terms·cross_border_transfer 2026-11-08 + privacy·ai_data_use 2026-11-08.1 (R14) + terms·privacy·ai_data_use 2026-11-09 (R15, CF-S6) versions seeded');

set local role anon;
select is((select count(*)::int from public.policy_versions), 20, 'anon can read policy_versions');
select throws_ok($$insert into public.policy_versions (policy_type, version, effective_at, document_path)
                   values ('terms', 'x', now(), '/x')$$, '42501', null, 'anon cannot insert');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.policy_versions), 20, 'authenticated can read policy_versions');
select throws_ok($$update public.policy_versions set requires_reconsent = false$$, '42501', null,
                 'authenticated cannot update');

reset role;
select throws_ok($$insert into public.policy_versions (policy_type, version, effective_at, document_path)
                   values ('cookies', 'x', now(), '/x')$$, '23514', null, 'policy_type CHECK enforced');

-- ── R15 (CF-S6, 2026-11-09): the 2026-11-09 revisions of terms / privacy / ai_data_use ──
select results_eq($$select policy_type, effective_at, requires_reconsent, document_path from public.policy_versions
                     where version = '2026-11-09' order by policy_type$$,
                  $$values ('ai_data_use'::text, '2026-11-09 00:00:00+09'::timestamptz, false,
                            '/policies/ai_data_use/2026-11-09'::text),
                           ('privacy', '2026-11-09 00:00:00+09', false, '/policies/privacy/2026-11-09'),
                           ('terms', '2026-11-09 00:00:00+09', false, '/policies/terms/2026-11-09')$$,
                  'three 2026-11-09 rows, none requiring re-consent (a narrowing revision — CF-1)');
select is((select count(*)::int from public.policy_versions
            where policy_type = 'cross_border_transfer' and version = '2026-11-09'), 0,
          'cross_border_transfer is not part of this revision');
-- An existing consenter (agreed at the previous current versions) does NOT become a re-consent target: the
-- sign-up gate reads requires_reconsent = true rows only. consents_before_insert accepts current versions only,
-- so the earlier agreement is placed with that trigger off (rolled back with the test).
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-0000000000c6', 'cfs6@example.test', 'authenticated', 'authenticated');
alter table public.consents disable trigger consents_before_insert;
insert into public.consents (user_id, consent_type, policy_version, agreed) values
  ('aaaaaaaa-0000-0000-0000-0000000000c6', 'terms', '2026-11-08', true),
  ('aaaaaaaa-0000-0000-0000-0000000000c6', 'privacy_required', '2026-11-08.1', true);
alter table public.consents enable trigger consents_before_insert;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-0000000000c6","role":"authenticated"}';
select is((select current_version from public.get_consent_status() where consent_type = 'terms'), '2026-11-09',
          'terms current version is 2026-11-09');
select is((select current_version from public.get_consent_status() where consent_type = 'privacy_required'),
          '2026-11-09', 'privacy current version is 2026-11-09');
select is((select count(*)::int from public.get_consent_status() where required and needs_consent), 0,
          'a user who agreed to 2026-11-08 / 2026-11-08.1 is not asked to re-consent (requires_reconsent = false)');
select is((select array_agg(agreed_version order by consent_type) from public.get_consent_status()
            where consent_type in ('privacy_required', 'terms')),
          array['2026-11-08.1', '2026-11-08'], 'their agreements keep the versions they agreed to');
reset role;

select * from finish();
rollback;
