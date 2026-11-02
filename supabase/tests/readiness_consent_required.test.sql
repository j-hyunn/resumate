-- R3 (R-67): get_data_readiness().ai_connection.consent_required (DM 2.11.7, DM §6).
-- Same rule as check_ai_run_allowed / retry_ai_job (private.ai_consent_allows_run) for the active
-- provider and the active key's connection_tier; null without an active provider / key.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

-- Keys written as owner (save_provider_key would demand consent first; the key RPCs are tested elsewhere).
insert into public.ai_provider_keys (id, user_id, provider, connection_tier, key_ciphertext, key_nonce, wrapped_dek,
                                     kek_id, key_last4, status)
values ('aaaaaaaa-9999-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'free',
        '\x01', '\x02', '\x03', 'env-v1', 'abcd', 'valid'),
       ('bbbbbbbb-9999-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'gemini', 'free',
        '\x01', '\x02', '\x03', 'env-v1', 'wxyz', 'valid');
update public.profiles set active_ai_provider = 'gemini'
 where id in ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002');

-- B consents for gemini/free; that must not count for A.
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
insert into public.ai_data_use_consents (provider, connection_tier, disclosure_version, free_tier_acknowledged)
values ('gemini', 'free', 'v2026-10-29', true);
select is(public.get_data_readiness() #> '{ai_connection,consent_required}', 'false'::jsonb, 'B (consented) → false');
reset role;

-- 1. no consent row → true; other fields unchanged.
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.get_data_readiness() -> 'ai_connection',
          '{"active_provider": "gemini", "key_status": "valid", "connection_tier": "free", "consent_required": true}'::jsonb,
          'no consent row → consent_required true (B''s consent does not count for A)');

-- 2. consent present for (gemini, free) → false.
insert into public.ai_data_use_consents (provider, connection_tier, disclosure_version, free_tier_acknowledged)
values ('gemini', 'free', 'v2026-10-29', true);
select is(public.get_data_readiness() -> 'ai_connection',
          '{"active_provider": "gemini", "key_status": "valid", "connection_tier": "free", "consent_required": false}'::jsonb,
          'consent present → consent_required false, other fields unchanged');

-- key_status is independent: needs_check / invalid keep consent_required as computed.
reset role;
update public.ai_provider_keys set status = 'invalid' where id = 'aaaaaaaa-9999-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.get_data_readiness() -> 'ai_connection',
          '{"active_provider": "gemini", "key_status": "invalid", "connection_tier": "free", "consent_required": false}'::jsonb,
          'invalid key: consent_required computed independently of key_status');
reset role;
update public.ai_provider_keys set status = 'valid' where id = 'aaaaaaaa-9999-0000-0000-000000000001';

-- app_ai_writer gets the same value (definer helper; it cannot read consents itself).
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.get_data_readiness() #> '{ai_connection,consent_required}', 'false'::jsonb,
          'app_ai_writer sees consent_required false for A');
reset role;

-- 3. an effective requires_reconsent disclosure newer than the agreed one → true.
insert into public.ai_disclosures (provider, connection_tier, version, effective_at, requires_reconsent,
                                   requires_free_tier_ack, document_path)
values ('gemini', 'free', 'v2026-10-30', now(), true, true, '/policies/ai/gemini/free/v2026-10-30');
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.get_data_readiness() #> '{ai_connection,consent_required}', 'true'::jsonb,
          'requires_reconsent notice effective after the consent → true');
-- re-consent to the new version → false again.
insert into public.ai_data_use_consents (provider, connection_tier, disclosure_version, free_tier_acknowledged)
values ('gemini', 'free', 'v2026-10-30', true);
select is(public.get_data_readiness() #> '{ai_connection,consent_required}', 'false'::jsonb,
          're-consent to the new version → false');
reset role;

-- a future requires_reconsent notice is not effective yet → still false.
insert into public.ai_disclosures (provider, connection_tier, version, effective_at, requires_reconsent,
                                   requires_free_tier_ack, document_path)
values ('gemini', 'free', 'v2099-01-01', '2099-01-01', true, true, '/policies/ai/gemini/free/v2099-01-01');
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.get_data_readiness() #> '{ai_connection,consent_required}', 'false'::jsonb,
          'future requires_reconsent notice not effective → false');
reset role;

-- 4. consent only for the other tier → true (key tier is what counts).
update public.ai_provider_keys set connection_tier = 'paid' where id = 'aaaaaaaa-9999-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.get_data_readiness() -> 'ai_connection',
          '{"active_provider": "gemini", "key_status": "valid", "connection_tier": "paid", "consent_required": true}'::jsonb,
          'consent only for the free tier, key is paid → true');
insert into public.ai_data_use_consents (provider, connection_tier, disclosure_version)
values ('gemini', 'paid', 'v2026-10-29');
select is(public.get_data_readiness() #> '{ai_connection,consent_required}', 'false'::jsonb,
          'paid-tier consent → false');

-- withdrawn consent → true.
update public.ai_data_use_consents set withdrawn_at = now() where provider = 'gemini' and connection_tier = 'paid';
select is(public.get_data_readiness() #> '{ai_connection,consent_required}', 'true'::jsonb,
          'withdrawn consent → true');

-- 5. no active provider / key → null like the other fields.
select ok(public.delete_provider_key('gemini'), 'A deletes the key (FK clears active provider)');
select is(public.get_data_readiness() -> 'ai_connection',
          '{"active_provider": null, "key_status": null, "connection_tier": null, "consent_required": null}'::jsonb,
          'no active key → consent_required null');
reset role;

-- key kept but no active provider → null.
update public.profiles set active_ai_provider = null where id = 'bbbbbbbb-0000-0000-0000-000000000002';
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
select is(public.get_data_readiness() -> 'ai_connection',
          '{"active_provider": null, "key_status": null, "connection_tier": null, "consent_required": null}'::jsonb,
          'key row but no active provider → all null');
reset role;

-- helper privileges unchanged.
select ok(prosecdef, 'current_ai_connection stays security definer')
  from pg_proc where oid = 'private.current_ai_connection()'::regprocedure;
select ok(has_function_privilege('authenticated', 'private.current_ai_connection()', 'execute'), 'authenticated may execute');
select ok(has_function_privilege('app_ai_writer', 'private.current_ai_connection()', 'execute'), 'app_ai_writer may execute');
select ok(not has_function_privilege('anon', 'private.current_ai_connection()', 'execute'), 'anon may not execute');
select ok(not has_function_privilege('authenticated', 'private.ai_consent_allows_run(uuid, text, text)', 'execute'),
          'ai_consent_allows_run still not callable by authenticated');

select * from finish();
rollback;
