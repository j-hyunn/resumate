-- S1 consents + get_consent_status / record_consents (DM A.2, F-COM-02).
begin;
create extension if not exists pgtap with schema extensions;
-- pgTAP lives in `extensions`; let the AI role call it inside this rolled-back test only.
grant usage on schema extensions to app_ai_writer;
select plan(41);

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

select ok((select relrowsecurity from pg_class where oid = 'public.consents'::regclass), 'RLS enabled on consents');
select policies_are('public', 'consents',
  array['consents_select_own', 'consents_insert_own', 'consents_update_withdraw_optional_own']);

-- user A
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select is((select count(*)::int from public.get_consent_status()), 5, 'status returns 5 types');
select is((select count(*)::int from public.get_consent_status() where required and needs_consent), 3,
          'new user needs the 3 required consents');
select is((select current_version from public.get_consent_status() where consent_type = 'marketing'),
          '2026-10-01', 'optional consents follow the privacy version');

-- record_consents error branches
select throws_ok($$select * from public.record_consents('[]'::jsonb, null)$$,
                 'P0001', 'invalid_consent_items', 'empty items rejected');
select throws_ok($$select * from public.record_consents('{"a":1}'::jsonb, null)$$,
                 'P0001', 'invalid_consent_items', 'non-array rejected');
select throws_ok($$select * from public.record_consents('[{"consent_type":"terms","agreed":"yes"}]'::jsonb, null)$$,
                 'P0001', 'invalid_consent_items', 'non-boolean agreed rejected');
select throws_ok($$select * from public.record_consents('[{"consent_type":"cookies","agreed":true}]'::jsonb, null)$$,
                 'P0001', 'invalid_consent_type', 'unknown type rejected');
select throws_ok($$select * from public.record_consents(
                   '[{"consent_type":"marketing","agreed":true},{"consent_type":"marketing","agreed":false}]'::jsonb, null)$$,
                 'P0001', 'duplicate_consent_type', 'duplicate type rejected');
select throws_ok($$select * from public.record_consents(
                   '[{"consent_type":"terms","agreed":true},{"consent_type":"privacy_required","agreed":false},
                     {"consent_type":"cross_border_transfer","agreed":true}]'::jsonb, null)$$,
                 'P0001', 'required_consent_missing', 'required agreed=false rejected');
select throws_ok($$select * from public.record_consents(
                   '[{"consent_type":"terms","agreed":true},{"consent_type":"privacy_required","agreed":true}]'::jsonb, null)$$,
                 'P0001', 'required_consent_missing', 'missing cross_border_transfer rejected');
select is((select count(*)::int from public.consents), 0, 'failed calls left no rows');

-- happy path
select is(
  (select count(*)::int from public.record_consents(
     '[{"consent_type":"terms","agreed":true},{"consent_type":"privacy_required","agreed":true},
       {"consent_type":"cross_border_transfer","agreed":true},{"consent_type":"service_improvement","agreed":true},
       {"consent_type":"marketing","agreed":false}]'::jsonb, 'ua-hash') where needs_consent),
  0, 'after recording, nothing needs consent');
select is((select count(*)::int from public.consents), 5, 'one row per item');
select is((select count(distinct policy_version)::int from public.consents), 1, 'server filled the version');
select is((select agreed_version from public.get_consent_status() where consent_type = 'marketing'),
          null, 'declined optional consent has no agreed_version');
select is((select agreed_version from public.get_consent_status() where consent_type = 'service_improvement'),
          '2026-10-01', 'agreed optional consent has agreed_version');

-- withdrawal rules
select lives_ok($$update public.consents set withdrawn_at = now() where consent_type = 'service_improvement'$$,
                'optional consent can be withdrawn');
select is((select agreed_version from public.get_consent_status() where consent_type = 'service_improvement'),
          null, 'withdrawn consent is no longer active');
update public.consents set withdrawn_at = now() where consent_type = 'terms';
select is((select count(*)::int from public.consents where withdrawn_at is not null and consent_type = 'terms'),
          0, 'required consent cannot be withdrawn (RLS filters it)');
select throws_ok($$update public.consents set agreed = false where consent_type = 'marketing'$$,
                 '42501', null, 'only withdrawn_at is updatable');
select throws_ok($$delete from public.consents$$, '42501', null, 'consents cannot be deleted');

-- direct insert guard
select throws_ok($$insert into public.consents (consent_type, policy_version, agreed)
                   values ('terms', '1999-01-01', true)$$,
                 'P0001', 'unknown_policy_version', 'direct insert must cite a real version');
select throws_ok($$insert into public.consents (user_id, consent_type, policy_version, agreed)
                   values ('bbbbbbbb-0000-0000-0000-000000000002', 'terms', '2026-10-01', true)$$,
                 '42501', null, 'cannot insert consent for another user');

-- QA-02: direct insert follows record_consents rules
select throws_ok($$insert into public.consents (consent_type, policy_version, agreed)
                   values ('privacy_required', '2026-10-01', false)$$,
                 'P0001', 'required_consent_missing', 'direct insert cannot decline a required consent');
select lives_ok($$insert into public.consents (consent_type, policy_version, agreed)
                  values ('marketing', '2026-10-01', true)$$,
                'direct insert of an optional consent at the current version works');
reset role;
insert into public.policy_versions (policy_type, version, effective_at, requires_reconsent, document_path)
values ('terms', '2027-01-01', now() + interval '30 days', true, '/policies/terms/2027-01-01');
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$insert into public.consents (consent_type, policy_version, agreed)
                   values ('terms', '2027-01-01', true)$$,
                 'P0001', 'policy_version_not_current', 'direct insert cannot agree to a not-yet-effective version');
reset role;
delete from public.policy_versions where version = '2027-01-01';
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

-- QA-01: withdrawal time is the server's
update public.consents set withdrawn_at = '1990-01-01' where consent_type = 'marketing' and agreed;
select ok((select withdrawn_at > '2000-01-01' from public.consents
            where consent_type = 'marketing' and agreed and withdrawn_at is not null),
          'client-supplied withdrawn_at is replaced by server time');

-- QA-03: B cannot withdraw A's optional consent
reset role;
insert into public.consents (user_id, consent_type, policy_version, agreed)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'service_improvement', '2026-10-01', true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
update public.consents set withdrawn_at = now() where consent_type = 'service_improvement';
reset role;
select is((select count(*)::int from public.consents
            where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'
              and consent_type = 'service_improvement' and withdrawn_at is null),
          1, 'B''s withdraw attempt did not touch A''s active consent');
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

-- re-consent: a newer version requiring re-consent becomes effective
reset role;
insert into public.policy_versions (policy_type, version, effective_at, requires_reconsent, document_path)
values ('cross_border_transfer', '2026-10-20', now() - interval '1 minute', true,
        '/policies/cross_border_transfer/2026-10-20'),
       ('terms', '2026-10-20', now() - interval '1 minute', false, '/policies/terms/2026-10-20');
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select needs_consent from public.get_consent_status() where consent_type = 'cross_border_transfer'),
          true, 'requires_reconsent version triggers re-consent');
select is((select needs_consent from public.get_consent_status() where consent_type = 'terms'),
          false, 'version without requires_reconsent does not');
select is(
  (select count(*)::int from public.record_consents(
     '[{"consent_type":"cross_border_transfer","agreed":true}]'::jsonb, null) where needs_consent),
  0, 'partial re-consent of the needed type is accepted');

-- user B isolation
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.consents), 0, 'B cannot see A''s consents');

-- app_ai_writer and anon have no access
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select throws_ok($$select id from public.consents$$, '42501', null, 'app_ai_writer cannot read consents');
select throws_ok($$insert into public.consents (user_id, consent_type, policy_version, agreed)
                   values ('aaaaaaaa-0000-0000-0000-000000000001', 'marketing', '2026-10-01', true)$$,
                 '42501', null, 'app_ai_writer cannot insert consents');
reset role;

-- QA-03: RPC execute is limited to authenticated
select ok(not has_function_privilege('anon', 'public.get_consent_status()', 'execute'), 'anon cannot execute get_consent_status');
select ok(not has_function_privilege('anon', 'public.record_consents(jsonb, text)', 'execute'), 'anon cannot execute record_consents');
select ok(not has_function_privilege('app_ai_writer', 'public.get_consent_status()', 'execute'), 'app_ai_writer cannot execute get_consent_status');
select ok(not has_function_privilege('app_ai_writer', 'public.record_consents(jsonb, text)', 'execute'), 'app_ai_writer cannot execute record_consents');
set local role anon;
select throws_ok($$select * from public.get_consent_status()$$, '42501', null, 'anon call to get_consent_status is denied');

select * from finish();
rollback;
