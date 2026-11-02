-- S3b: get_provider_key_secret (DM 2.11.2, NFR-KEY-03/08) and the app_key_reader role.
-- This file is first to call the function as app_key_reader in its session (first-call privileges).
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_key_reader, app_ai_writer, service_role;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

insert into public.ai_provider_keys (id, user_id, provider, connection_tier, key_ciphertext, key_nonce, wrapped_dek, kek_id,
                                     encryption_version, key_last4, status) values
  ('aaaaaaaa-9999-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'free',
   '\xa1a1', '\xa2', '\xa3', 'env-v1', 1, 'gm01', 'valid'),
  ('aaaaaaaa-9999-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'openai', 'paid',
   '\xa4a4', '\xa5', '\xa6', 'env-v1', 2, 'oa01', 'invalid'),
  ('bbbbbbbb-9999-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'gemini', 'free',
   '\xb1b1', '\xb2', '\xb3', 'env-v1', 1, 'bg01', 'valid');

insert into public.ai_jobs (id, user_id, job_type, target_type, target_id, provider, model_tier, connection_tier, status, heartbeat_at) values
  -- A running gemini, fresh heartbeat
  ('aaaaaaaa-7777-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'insight', 'application_project', gen_random_uuid(), 'gemini', 'default', 'free', 'running', now()),
  -- A running openai (key status invalid: the function does not judge status)
  ('aaaaaaaa-7777-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'insight', 'application_project', gen_random_uuid(), 'openai', 'default', 'paid', 'running', now() - interval '119 seconds'),
  -- A running anthropic: no key row
  ('aaaaaaaa-7777-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'insight', 'application_project', gen_random_uuid(), 'anthropic', 'default', 'paid', 'running', now()),
  -- A queued / succeeded / failed / canceled
  ('aaaaaaaa-7777-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001', 'insight', 'application_project', gen_random_uuid(), 'gemini', 'default', 'free', 'queued', now()),
  ('aaaaaaaa-7777-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000001', 'insight', 'application_project', gen_random_uuid(), 'gemini', 'default', 'free', 'succeeded', now()),
  ('aaaaaaaa-7777-0000-0000-000000000006', 'aaaaaaaa-0000-0000-0000-000000000001', 'insight', 'application_project', gen_random_uuid(), 'gemini', 'default', 'free', 'failed', now()),
  ('aaaaaaaa-7777-0000-0000-000000000007', 'aaaaaaaa-0000-0000-0000-000000000001', 'insight', 'application_project', gen_random_uuid(), 'gemini', 'default', 'free', 'canceled', now()),
  -- A running gemini, stale heartbeat / null heartbeat
  ('aaaaaaaa-7777-0000-0000-000000000008', 'aaaaaaaa-0000-0000-0000-000000000001', 'cover_letter', 'application_project', gen_random_uuid(), 'gemini', 'default', 'free', 'running', now() - interval '121 seconds'),
  ('aaaaaaaa-7777-0000-0000-000000000009', 'aaaaaaaa-0000-0000-0000-000000000001', 'career_description', 'application_project', gen_random_uuid(), 'gemini', 'default', 'free', 'running', null),
  -- B running gemini
  ('bbbbbbbb-7777-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'insight', 'application_project', gen_random_uuid(), 'gemini', 'default', 'free', 'running', now());

select ok((select prosecdef from pg_proc where oid = 'public.get_provider_key_secret(uuid)'::regprocedure), 'security definer');
select is((select proconfig from pg_proc where oid = 'public.get_provider_key_secret(uuid)'::regprocedure),
          array['search_path=""'], 'search_path pinned to empty');

-- Happy path as app_key_reader (first call in the session) ------------------------------------------
set local role app_key_reader;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_key_reader"}';
select results_eq(
  $$select key_id, key_ciphertext, key_nonce, wrapped_dek, kek_id, encryption_version::int
      from public.get_provider_key_secret('aaaaaaaa-7777-0000-0000-000000000001')$$,
  $$values ('aaaaaaaa-9999-0000-0000-000000000001'::uuid, '\xa1a1'::bytea, '\xa2'::bytea, '\xa3'::bytea, 'env-v1', 1)$$,
  'running job + fresh heartbeat → the job provider''s key (with key_id for AAD)');
select results_eq(
  $$select key_id, encryption_version::int from public.get_provider_key_secret('aaaaaaaa-7777-0000-0000-000000000002')$$,
  $$values ('aaaaaaaa-9999-0000-0000-000000000002'::uuid, 2)$$,
  'provider comes from the job (openai), heartbeat 119s still within 2 minutes');
select is_empty($$select * from public.get_provider_key_secret('aaaaaaaa-7777-0000-0000-000000000003')$$,
                'job ok but no key for its provider → zero rows (app: key_missing)');

-- Refusals ----------------------------------------------------------------------------------------
select throws_ok($$select * from public.get_provider_key_secret('bbbbbbbb-7777-0000-0000-000000000001')$$,
                 'P0001', 'key_not_available', 'another user''s job refused (JWT sub ≠ job user)');
select throws_ok($$select * from public.get_provider_key_secret(gen_random_uuid())$$,
                 'P0001', 'key_not_available', 'unknown job refused');
select throws_ok($$select * from public.get_provider_key_secret(null)$$,
                 'P0001', 'key_not_available', 'null job refused');
select throws_ok($$select * from public.get_provider_key_secret('aaaaaaaa-7777-0000-0000-000000000004')$$,
                 'P0001', 'key_not_available', 'queued job refused');
select throws_ok($$select * from public.get_provider_key_secret('aaaaaaaa-7777-0000-0000-000000000005')$$,
                 'P0001', 'key_not_available', 'succeeded job refused');
select throws_ok($$select * from public.get_provider_key_secret('aaaaaaaa-7777-0000-0000-000000000006')$$,
                 'P0001', 'key_not_available', 'failed job refused');
select throws_ok($$select * from public.get_provider_key_secret('aaaaaaaa-7777-0000-0000-000000000007')$$,
                 'P0001', 'key_not_available', 'canceled job refused');
select throws_ok($$select * from public.get_provider_key_secret('aaaaaaaa-7777-0000-0000-000000000008')$$,
                 'P0001', 'key_not_available', 'stale heartbeat (> 2 min) refused');
select throws_ok($$select * from public.get_provider_key_secret('aaaaaaaa-7777-0000-0000-000000000009')$$,
                 'P0001', 'key_not_available', 'null heartbeat refused');

-- B's sub gets only B's key, never A's (other provider rows of A are irrelevant)
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"app_key_reader"}';
select results_eq($$select key_id from public.get_provider_key_secret('bbbbbbbb-7777-0000-0000-000000000001')$$,
                  $$values ('bbbbbbbb-9999-0000-0000-000000000001'::uuid)$$, 'B gets B''s key for B''s job');
select throws_ok($$select * from public.get_provider_key_secret('aaaaaaaa-7777-0000-0000-000000000001')$$,
                 'P0001', 'key_not_available', 'B cannot fetch A''s key with A''s job id');

set local request.jwt.claims = '{"role":"app_key_reader"}';
select throws_ok($$select * from public.get_provider_key_secret('aaaaaaaa-7777-0000-0000-000000000001')$$,
                 '42501', 'not_authenticated', 'no JWT sub refused');

-- app_key_reader can do nothing else ------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_key_reader"}';
select throws_ok($$select id from public.ai_provider_keys$$, '42501', null, 'app_key_reader: no select on ai_provider_keys');
select throws_ok($$select key_ciphertext from public.ai_provider_keys$$, '42501', null, 'app_key_reader: no ciphertext select');
select throws_ok($$select id from public.ai_provider_keys_public$$, '42501', null, 'app_key_reader: no view');
select throws_ok($$select id from public.ai_jobs$$, '42501', null, 'app_key_reader: no ai_jobs');
select throws_ok($$select id from public.profiles$$, '42501', null, 'app_key_reader: no profiles');
select throws_ok($$select id from public.experiences$$, '42501', null, 'app_key_reader: no career tables');
select throws_ok($$select id from public.ai_data_use_consents$$, '42501', null, 'app_key_reader: no consents');
select throws_ok($$update public.ai_provider_keys set status = 'valid'$$, '42501', null, 'app_key_reader: no update');
select throws_ok($$delete from public.ai_provider_keys$$, '42501', null, 'app_key_reader: no delete');
select throws_ok($$update public.ai_jobs set heartbeat_at = now()$$, '42501', null, 'app_key_reader cannot refresh a heartbeat');
select throws_ok($$select public.get_data_readiness()$$, '42501', null, 'app_key_reader: no get_data_readiness');
select throws_ok($$select public.mark_provider_key_invalid('aaaaaaaa-7777-0000-0000-000000000001', 'key_invalid')$$,
                 '42501', null, 'app_key_reader: no mark_provider_key_invalid');
select throws_ok($$select public.save_provider_key('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'free', '\x01', '\x02', '\x03', 'env-v1', 'abcd', 'v2026-10-29', 'valid', gen_random_uuid())$$,
                 '42501', null, 'app_key_reader: no save_provider_key');
select throws_ok($$select private.current_uid()$$, '42501', null, 'app_key_reader: no private schema');
reset role;

-- Other roles cannot call the function --------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select * from public.get_provider_key_secret('aaaaaaaa-7777-0000-0000-000000000001')$$,
                 '42501', null, 'authenticated cannot call get_provider_key_secret');
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select throws_ok($$select * from public.get_provider_key_secret('aaaaaaaa-7777-0000-0000-000000000001')$$,
                 '42501', null, 'app_ai_writer cannot call get_provider_key_secret');
reset role;
set local role anon;
select throws_ok($$select * from public.get_provider_key_secret('aaaaaaaa-7777-0000-0000-000000000001')$$,
                 '42501', null, 'anon cannot call get_provider_key_secret');
reset role;
set local role service_role;
select throws_ok($$select * from public.get_provider_key_secret('aaaaaaaa-7777-0000-0000-000000000001')$$,
                 '42501', null, 'service_role cannot call get_provider_key_secret');
reset role;

-- Role setup
select ok((select not rolcanlogin and not rolinherit from pg_roles where rolname = 'app_key_reader'),
          'app_key_reader is nologin noinherit');
select ok(pg_has_role('authenticator', 'app_key_reader', 'member'), 'authenticator can switch into app_key_reader');
select ok(not pg_has_role('app_key_reader', 'app_ai_writer', 'member') and not pg_has_role('app_ai_writer', 'app_key_reader', 'member'),
          'app_key_reader and app_ai_writer are separate (no membership either way)');

-- Key deleted mid-run → zero rows next step (D-36 key_missing)
delete from public.ai_provider_keys where id = 'aaaaaaaa-9999-0000-0000-000000000001';
set local role app_key_reader;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_key_reader"}';
select is_empty($$select * from public.get_provider_key_secret('aaaaaaaa-7777-0000-0000-000000000001')$$,
                'key deleted during the run → zero rows');
reset role;

select * from finish();
rollback;
