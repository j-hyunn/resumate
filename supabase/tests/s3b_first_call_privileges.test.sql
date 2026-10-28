-- S3b privilege regression (see career_first_call_privileges.test.sql for why): every key / consent path is
-- first called in the session by its real end role, in the order the app uses them. Nothing touches these
-- tables or functions as postgres before the role under test does (except auth.users and the job row,
-- which only app_ai_writer can create and is exercised there first).
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer, app_key_reader;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated');

-- anon: public disclosure page
set local role anon;
select lives_ok($$select provider, connection_tier, version, document_path from public.ai_disclosures$$, 'anon: read ai_disclosures');
reset role;

-- authenticated: connection screen → consent → register → screen reads → recheck → active switch
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select * from public.ai_providers order by display_order$$, 'authenticated: read ai_providers');
select lives_ok($$select * from public.ai_disclosures$$, 'authenticated: read ai_disclosures');
select lives_ok($$select * from public.ai_provider_keys_public$$, 'authenticated: read key view (empty)');
select lives_ok($$select * from public.ai_data_use_consents$$, 'authenticated: read consents');
select lives_ok($$insert into public.ai_data_use_consents (provider, connection_tier, disclosure_version, free_tier_acknowledged)
                  values ('gemini', 'free', 'v2026-10-29', true)$$, 'authenticated: record consent (guard trigger)');
select lives_ok($$select public.save_provider_key('gemini', 'free', '\x01', '\x02', '\x03', 'env-v1', 'gm01', 'v2026-10-29', 'valid',
                                                  'aaaaaaaa-9999-0000-0000-000000000001')$$, 'authenticated: save_provider_key');
select lives_ok($$select id, provider, connection_tier, key_last4, status, last_verified_at, last_failure_cause, last_failure_at,
                         created_at, updated_at from public.ai_provider_keys$$, 'authenticated: read key metadata columns');
select lives_ok($$select active_ai_provider from public.profiles$$, 'authenticated: read active provider');
select lives_ok($$select public.get_data_readiness()$$, 'authenticated: readiness with ai_connection');
select lives_ok($$select public.record_provider_key_check('gemini', 'failed', 'rate_limited')$$, 'authenticated: record_provider_key_check');
select lives_ok($$insert into public.ai_data_use_consents (provider, connection_tier, disclosure_version)
                  values ('openai', 'paid', 'v2026-10-29')$$, 'authenticated: second consent');
select lives_ok($$select public.save_provider_key('openai', 'paid', '\x01', '\x02', '\x03', 'env-v1', 'oa01', 'v2026-10-29', 'limited',
                                                  'aaaaaaaa-9999-0000-0000-000000000002', 'provider_unavailable')$$,
                'authenticated: save limited key');
select lives_ok($$select public.set_active_ai_provider('openai')$$, 'authenticated: set_active_ai_provider');
select lives_ok($$update public.ai_data_use_consents set withdrawn_at = now()
                   where provider = 'openai' and withdrawn_at is null$$, 'authenticated: withdraw consent');
reset role;

-- app_ai_writer: readiness, job, key status reports
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select lives_ok($$select public.get_data_readiness()$$, 'app_ai_writer: readiness (ai_connection helper)');
select lives_ok($$insert into public.ai_jobs (id, job_type, target_type, target_id, provider, model_tier, connection_tier, status, heartbeat_at)
                  values ('aaaaaaaa-7777-0000-0000-000000000001', 'key_verification', 'ai_provider', gen_random_uuid(),
                          'gemini', 'light', 'free', 'running', now())$$,
                'app_ai_writer: key_verification job (target ai_provider)');
reset role;

-- app_key_reader: fetch ciphertext for the running job
set local role app_key_reader;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_key_reader"}';
select lives_ok($$select * from public.get_provider_key_secret('aaaaaaaa-7777-0000-0000-000000000001')$$,
                'app_key_reader: get_provider_key_secret');
reset role;

set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select lives_ok($$select public.check_ai_run_allowed('aaaaaaaa-7777-0000-0000-000000000001')$$,
                'app_ai_writer: check_ai_run_allowed');
select lives_ok($$select public.record_provider_key_success('aaaaaaaa-7777-0000-0000-000000000001')$$,
                'app_ai_writer: record_provider_key_success');
select lives_ok($$select public.mark_provider_key_invalid('aaaaaaaa-7777-0000-0000-000000000001', 'key_invalid')$$,
                'app_ai_writer: mark_provider_key_invalid');
reset role;

-- authenticated: delete (invoker, FK set null, consent withdrawal)
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.delete_provider_key('openai')$$, 'authenticated: delete_provider_key (active key)');
select lives_ok($$delete from public.ai_provider_keys where provider = 'gemini'$$, 'authenticated: direct delete own key');
reset role;

select * from finish();
rollback;
