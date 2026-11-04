-- W1 (spec-gaps ⑲, F-COM-02, D-39): a user who signed up with only terms + privacy_required passes the S-03
-- gate, but no AI path runs until C-21 (ai_data_use_consents). A cross_border_transfer row in consents must
-- not open anything: the gates read only ai_data_use_consents. Refusal codes per path follow DM 2.11.7.
-- check_ai_run_allowed answers consent_required; the runner ends the job as key_missing (mapRunGate).
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('f0000000-0000-0000-0000-000000000001', 'f@example.test', 'authenticated', 'authenticated');

-- 1. S-03: only terms + privacy_required, and the gate opens.
set local role authenticated;
set local request.jwt.claims = '{"sub":"f0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.get_consent_status() where required and needs_consent), 2,
          'new user is held at S-03 by the 2 required consents');
select is(
  (select count(*)::int from public.record_consents(
     '[{"consent_type":"terms","agreed":true},{"consent_type":"privacy_required","agreed":true}]'::jsonb, null)
    where required and needs_consent),
  0, 'terms + privacy_required pass the S-03 gate');
select is((select count(*)::int from public.consents), 2, 'only the 2 agreed rows are stored');
select is((select count(*)::int from public.ai_data_use_consents), 0, 'S-03 records no AI data use consent');

-- 2. No key yet: no provider, nothing to run with.
select is(public.get_data_readiness() -> 'ai_connection',
          '{"active_provider": null, "key_status": null, "connection_tier": null, "consent_required": null}'::jsonb,
          'readiness: no AI connection after sign-up');
select is(public.create_application_project('f0000000-aaaa-0000-0000-000000000001', '원문', 'h',
            '[{"sid":"S1","text":"원문","start":0,"end":2}]'::jsonb) ->> 'ai_run_allowed',
          'false', 'path ⑥: project is saved without AI (D-30), AI not allowed');
reset role;

insert into public.ai_jobs (id, user_id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier, model)
values ('f0000000-7777-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'insight',
        'f0000000-aaaa-0000-0000-000000000001', 'application_project', 'f0000000-aaaa-0000-0000-000000000001',
        'running', 1, 'gemini', 'default', 'free', 'm-gemini');
update public.ai_jobs set status = 'failed', error_code = 'rate_limited'
 where id = 'f0000000-7777-0000-0000-000000000001';

set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"f0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.check_ai_run_allowed('f0000000-7777-0000-0000-000000000001'), 'key_missing',
          'path ③ without a key: key_missing');
select throws_ok($$select public.retry_ai_job('f0000000-7777-0000-0000-000000000001', 1, 'm', 'default', '{}', 'gemini')$$,
                 'P0001', 'key_missing', 'path ② without a key: key_missing');
reset role;

-- 3. A key cannot be stored without C-21 (F-AI-04 (4)), so sign-up alone never reaches a connected state.
set local role service_role;
select throws_ok($$select public.save_provider_key('f0000000-0000-0000-0000-000000000001', 'gemini', 'free', '\x01', '\x02', '\x03',
                     'env-v1', 'abcd', 'v2026-10-29', 'valid', gen_random_uuid())$$,
                 'P0001', 'consent_required', 'key save without C-21 refused');
reset role;
select is((select count(*)::int from public.ai_provider_keys where user_id = 'f0000000-0000-0000-0000-000000000001'),
          0, 'refused save stored no key');

-- 4. Key row forced in as owner, still no C-21: every gate refuses.
insert into public.ai_provider_keys (id, user_id, provider, connection_tier, key_ciphertext, key_nonce, wrapped_dek, kek_id, key_last4, status)
values ('f0000000-9999-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'gemini', 'free',
        '\x01', '\x02', '\x03', 'env-v1', 'fg01', 'valid');
update public.profiles set active_ai_provider = 'gemini' where id = 'f0000000-0000-0000-0000-000000000001';

set local role authenticated;
set local request.jwt.claims = '{"sub":"f0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.get_data_readiness() #> '{ai_connection,consent_required}', 'true'::jsonb,
          'readiness: consent_required true without C-21');
select throws_ok($$select public.create_application_project('f0000000-aaaa-0000-0000-000000000002', '원문', 'h',
                     '[{"sid":"S1","text":"원문","start":0,"end":2}]'::jsonb)$$,
                 'P0001', 'ai_consent_required', 'path ⑥ without C-21: ai_consent_required');
reset role;

set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"f0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.check_ai_run_allowed('f0000000-7777-0000-0000-000000000001'), 'consent_required',
          'path ③ without C-21: consent_required (runner ends the job as key_missing)');
select throws_ok($$select public.retry_ai_job('f0000000-7777-0000-0000-000000000001', 1, 'm', 'default', '{}', 'gemini')$$,
                 'P0001', 'ai_consent_required', 'path ② without C-21: ai_consent_required');
reset role;

-- 5. A cross_border_transfer agreement in consents opens nothing.
set local role authenticated;
set local request.jwt.claims = '{"sub":"f0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(
  (select agreed_version from public.record_consents(
     '[{"consent_type":"cross_border_transfer","agreed":true}]'::jsonb, null)
    where consent_type = 'cross_border_transfer'),
  '2026-11-04', 'cross_border_transfer agreement recorded');
select is(public.get_data_readiness() #> '{ai_connection,consent_required}', 'true'::jsonb,
          'readiness: cross_border_transfer does not satisfy C-21');
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"f0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.check_ai_run_allowed('f0000000-7777-0000-0000-000000000001'), 'consent_required',
          'path ③: cross_border_transfer does not satisfy C-21');
select throws_ok($$select public.retry_ai_job('f0000000-7777-0000-0000-000000000001', 1, 'm', 'default', '{}', 'gemini')$$,
                 'P0001', 'ai_consent_required', 'path ②: cross_border_transfer does not satisfy C-21');
reset role;

-- 6. C-21 opens the gates.
set local role authenticated;
set local request.jwt.claims = '{"sub":"f0000000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into public.ai_data_use_consents (provider, connection_tier, disclosure_version, free_tier_acknowledged)
values ('gemini', 'free', 'v2026-10-29', true);
select is(public.get_data_readiness() #> '{ai_connection,consent_required}', 'false'::jsonb,
          'readiness: consent_required false after C-21');
select is(public.create_application_project('f0000000-aaaa-0000-0000-000000000002', '원문', 'h',
            '[{"sid":"S1","text":"원문","start":0,"end":2}]'::jsonb) ->> 'ai_run_allowed',
          'true', 'path ⑥ after C-21: AI allowed');
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"f0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.check_ai_run_allowed('f0000000-7777-0000-0000-000000000001'), null, 'path ③ after C-21: allowed');
select is(public.retry_ai_job('f0000000-7777-0000-0000-000000000001', 1, 'm', 'default', '{}', 'gemini') ->> 'requeued',
          'true', 'path ② after C-21: requeued');
reset role;

select * from finish();
rollback;
