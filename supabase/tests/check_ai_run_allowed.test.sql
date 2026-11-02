-- S3b QA-S3b-01: check_ai_run_allowed (app_ai_writer run-time gate).
-- First call in the session is by app_ai_writer (first-call privileges).
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

-- A: gemini key (free, valid) + consent; openai key (paid, invalid) + consent; anthropic: no key.
insert into public.ai_provider_keys (id, user_id, provider, connection_tier, key_ciphertext, key_nonce, wrapped_dek, kek_id, key_last4, status) values
  ('aaaaaaaa-9999-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'free', '\x01', '\x02', '\x03', 'env-v1', 'gm01', 'valid'),
  ('aaaaaaaa-9999-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'openai', 'paid', '\x01', '\x02', '\x03', 'env-v1', 'oa01', 'invalid'),
  ('bbbbbbbb-9999-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'gemini', 'free', '\x01', '\x02', '\x03', 'env-v1', 'bg01', 'valid');
insert into public.ai_data_use_consents (user_id, provider, connection_tier, disclosure_version, free_tier_acknowledged) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'free', 'v2026-10-29', true),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'openai', 'paid', 'v2026-10-29', false),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'gemini', 'free', 'v2026-10-29', true);
insert into public.ai_jobs (id, user_id, job_type, target_type, target_id, provider, model_tier, connection_tier, status, heartbeat_at) values
  ('aaaaaaaa-7777-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'insight', 'application_project', gen_random_uuid(), 'gemini', 'default', 'free', 'running', now()),
  ('aaaaaaaa-7777-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'insight', 'application_project', gen_random_uuid(), 'openai', 'default', 'paid', 'running', now()),
  ('aaaaaaaa-7777-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'insight', 'application_project', gen_random_uuid(), 'anthropic', 'default', 'paid', 'queued', null),
  ('bbbbbbbb-7777-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'insight', 'application_project', gen_random_uuid(), 'gemini', 'default', 'free', 'running', now());

select ok((select prosecdef from pg_proc where oid = 'public.check_ai_run_allowed(uuid)'::regprocedure), 'security definer');

set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.check_ai_run_allowed('aaaaaaaa-7777-0000-0000-000000000001'), null, 'valid key + current consent → null (allowed)');
select is(public.check_ai_run_allowed('aaaaaaaa-7777-0000-0000-000000000002'), 'key_invalid', 'invalid key → key_invalid');
select is(public.check_ai_run_allowed('aaaaaaaa-7777-0000-0000-000000000003'), 'key_missing', 'no key for the job provider → key_missing');
select throws_ok($$select public.check_ai_run_allowed('bbbbbbbb-7777-0000-0000-000000000001')$$,
                 'P0001', 'ai_job_not_found', 'another user''s job refused');
select throws_ok($$select public.check_ai_run_allowed(gen_random_uuid())$$, 'P0001', 'ai_job_not_found', 'unknown job refused');
select throws_ok($$select key_ciphertext from public.ai_provider_keys$$, '42501', null, 'app_ai_writer still cannot read keys');
reset role;

-- needs_check is allowed (UX C-19)
update public.ai_provider_keys set status = 'needs_check' where id = 'aaaaaaaa-9999-0000-0000-000000000001';
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.check_ai_run_allowed('aaaaaaaa-7777-0000-0000-000000000001'), null, 'needs_check key → allowed');
reset role;

-- wording-only disclosure update (requires_reconsent = false) does not block
insert into public.ai_disclosures (provider, connection_tier, version, effective_at, requires_reconsent, requires_free_tier_ack, document_path)
values ('gemini', 'free', 'v2026-10-28b', now() - interval '1 minute', false, true, '/policies/ai/gemini/free/v2026-10-28b');
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.check_ai_run_allowed('aaaaaaaa-7777-0000-0000-000000000001'), null, 'newer version without requires_reconsent → allowed');
reset role;

-- a future requires_reconsent version is not in effect yet
insert into public.ai_disclosures (provider, connection_tier, version, effective_at, requires_reconsent, requires_free_tier_ack, document_path)
values ('gemini', 'free', 'v2099-01-01', '2099-01-01', true, true, '/policies/ai/gemini/free/v2099-01-01');
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.check_ai_run_allowed('aaaaaaaa-7777-0000-0000-000000000001'), null, 'future requires_reconsent version → still allowed');
reset role;

-- an effective requires_reconsent version newer than the agreed one → consent_required
insert into public.ai_disclosures (provider, connection_tier, version, effective_at, requires_reconsent, requires_free_tier_ack, document_path)
values ('gemini', 'free', 'v2026-10-28c', now() - interval '30 seconds', true, true, '/policies/ai/gemini/free/v2026-10-28c');
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.check_ai_run_allowed('aaaaaaaa-7777-0000-0000-000000000001'), 'consent_required',
          'effective requires_reconsent version after the agreed one → consent_required');
reset role;
-- re-consent to the new version → allowed again
insert into public.ai_data_use_consents (user_id, provider, connection_tier, disclosure_version, free_tier_acknowledged)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'free', 'v2026-10-28c', true);
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.check_ai_run_allowed('aaaaaaaa-7777-0000-0000-000000000001'), null, 're-consent to the new version → allowed');
reset role;

-- withdrawn consent → consent_required
update public.ai_data_use_consents set withdrawn_at = now()
 where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and provider = 'gemini';
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.check_ai_run_allowed('aaaaaaaa-7777-0000-0000-000000000001'), 'consent_required', 'withdrawn consent → consent_required');
reset role;

-- consent is checked against the key's CURRENT tier, not the job's: key moved to paid, only free consent exists
insert into public.ai_data_use_consents (user_id, provider, connection_tier, disclosure_version, free_tier_acknowledged)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'free', 'v2026-10-28c', true);
update public.ai_provider_keys set connection_tier = 'paid' where id = 'aaaaaaaa-9999-0000-0000-000000000001';
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.check_ai_run_allowed('aaaaaaaa-7777-0000-0000-000000000001'), 'consent_required',
          'no consent for the key''s current tier (paid) → consent_required');
reset role;

-- key deleted mid-run → key_missing
delete from public.ai_provider_keys where id = 'aaaaaaaa-9999-0000-0000-000000000001';
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.check_ai_run_allowed('aaaaaaaa-7777-0000-0000-000000000001'), 'key_missing', 'key deleted → key_missing');
set local request.jwt.claims = '{"role":"app_ai_writer"}';
select throws_ok($$select public.check_ai_run_allowed('aaaaaaaa-7777-0000-0000-000000000001')$$, '42501', 'not_authenticated', 'no sub');
reset role;

-- B's own job is fine for B
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"app_ai_writer"}';
select is(public.check_ai_run_allowed('bbbbbbbb-7777-0000-0000-000000000001'), 'consent_required',
          'B''s own job answers for B (B also faces the reconsent version published above)');
select throws_ok($$select public.check_ai_run_allowed('aaaaaaaa-7777-0000-0000-000000000001')$$,
                 'P0001', 'ai_job_not_found', 'B cannot probe A''s job');
reset role;

-- execute: app_ai_writer only
select set_eq(
  $$select r.rolname::text from pg_roles r
     where r.rolname in ('anon', 'authenticated', 'app_ai_writer', 'app_key_reader', 'service_role', 'authenticator')
       and has_function_privilege(r.oid, 'public.check_ai_run_allowed(uuid)', 'execute')$$,
  array['app_ai_writer'], 'check_ai_run_allowed executable by app_ai_writer only');

select * from finish();
rollback;
