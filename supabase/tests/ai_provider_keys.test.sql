-- S3b: ai_provider_keys (DM 2.11.1), profiles.active_ai_provider (2.11.4), key RPCs (2.11.3).
-- get_provider_key_secret has its own file.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer, service_role;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

-- Structure ---------------------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.ai_provider_keys'::regclass), 'RLS on');
select policies_are('public', 'ai_provider_keys', array['ai_provider_keys_select_own', 'ai_provider_keys_delete_own'],
                    'policies: select own + delete own only (insert / update via RPC)');
select columns_are('public', 'ai_provider_keys', array['id', 'user_id', 'provider', 'connection_tier', 'key_ciphertext',
  'key_nonce', 'wrapped_dek', 'kek_id', 'encryption_version', 'key_last4', 'status', 'last_verified_at',
  'last_failure_cause', 'last_failure_at', 'created_at', 'updated_at'], 'DM 2.11.1 columns');
select col_type_is('public', 'ai_provider_keys', 'key_ciphertext', 'bytea', 'key_ciphertext bytea');
select col_type_is('public', 'ai_provider_keys', 'encryption_version', 'smallint', 'encryption_version smallint');
select col_hasnt_default('public', 'ai_provider_keys', 'id', 'id has no default (server picks it for AAD)');
select columns_are('public', 'ai_provider_keys_public', array['id', 'provider', 'connection_tier', 'key_last4', 'status',
  'last_verified_at', 'last_failure_cause', 'last_failure_at', 'created_at', 'updated_at'], 'public view = metadata columns');
select ok((select 'security_invoker=true' = any(reloptions) from pg_class where oid = 'public.ai_provider_keys_public'::regclass),
          'view is security invoker');
select has_column('public', 'profiles', 'active_ai_provider', 'profiles.active_ai_provider');
select fk_ok('public', 'profiles', array['id', 'active_ai_provider'], 'public', 'ai_provider_keys', array['user_id', 'provider'],
             'composite FK profiles(id, active_ai_provider) → ai_provider_keys(user_id, provider)');
select is((select confdeltype::text from pg_constraint where conname = 'profiles_active_ai_provider_fkey'), 'n',
          'FK on delete set null');
select is((select array_agg(a.attname::text) from pg_constraint c
             join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.confdelsetcols)
            where c.conname = 'profiles_active_ai_provider_fkey'), array['active_ai_provider'],
          'set null touches active_ai_provider only');

-- CHECKs (as owner)
select throws_ok($$insert into public.ai_provider_keys (id, user_id, provider, connection_tier, key_ciphertext, key_nonce, wrapped_dek, kek_id, key_last4, status)
                   values (gen_random_uuid(), 'aaaaaaaa-0000-0000-0000-000000000001', 'mistral', 'paid', '\x01', '\x01', '\x01', 'k', 'abcd', 'valid')$$,
                 '23514', null, 'provider CHECK');
select throws_ok($$insert into public.ai_provider_keys (id, user_id, provider, connection_tier, key_ciphertext, key_nonce, wrapped_dek, kek_id, key_last4, status)
                   values (gen_random_uuid(), 'aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'pro', '\x01', '\x01', '\x01', 'k', 'abcd', 'valid')$$,
                 '23514', null, 'connection_tier CHECK');
select throws_ok($$insert into public.ai_provider_keys (id, user_id, provider, connection_tier, key_ciphertext, key_nonce, wrapped_dek, kek_id, key_last4, status)
                   values (gen_random_uuid(), 'aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'paid', '\x01', '\x01', '\x01', 'k', 'abcd', 'ok')$$,
                 '23514', null, 'status CHECK');
select throws_ok($$insert into public.ai_provider_keys (id, user_id, provider, connection_tier, key_ciphertext, key_nonce, wrapped_dek, kek_id, key_last4, status)
                   values (gen_random_uuid(), 'aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'paid', '\x01', '\x01', '\x01', 'k', 'abc', 'valid')$$,
                 '23514', null, 'key_last4 must be 4 chars');
select throws_ok($$insert into public.ai_provider_keys (id, user_id, provider, connection_tier, key_ciphertext, key_nonce, wrapped_dek, kek_id, key_last4, status)
                   values (gen_random_uuid(), 'aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'paid', '\x', '\x01', '\x01', 'k', 'abcd', 'valid')$$,
                 '23514', null, 'empty ciphertext rejected');
select throws_ok($$insert into public.ai_provider_keys (id, user_id, provider, connection_tier, key_ciphertext, key_nonce, wrapped_dek, kek_id, key_last4, status, last_failure_cause)
                   values (gen_random_uuid(), 'aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'paid', '\x01', '\x01', '\x01', 'k', 'abcd', 'valid', 'stalled')$$,
                 '23514', null, 'last_failure_cause CHECK (7 causes)');
select throws_ok($$update public.profiles set active_ai_provider = 'gemini' where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
                 '23503', null, 'FK: cannot activate a provider without a key');

-- Direct access by role ----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$insert into public.ai_provider_keys (id, provider, connection_tier, key_ciphertext, key_nonce, wrapped_dek, kek_id, key_last4, status)
                   values (gen_random_uuid(), 'gemini', 'paid', '\x01', '\x01', '\x01', 'k', 'abcd', 'valid')$$,
                 '42501', null, 'authenticated cannot insert keys directly');
select throws_ok($$update public.ai_provider_keys set status = 'valid'$$, '42501', null, 'authenticated cannot update keys directly');
select throws_ok($$update public.profiles set active_ai_provider = null where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
                 '42501', null, 'authenticated cannot update profiles.active_ai_provider directly');
reset role;

-- Seed consents for A (gemini free + paid, openai paid) and B (gemini free).
insert into public.ai_data_use_consents (user_id, provider, connection_tier, disclosure_version, free_tier_acknowledged) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'free', 'v2026-10-29', true),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'paid', 'v2026-10-29', false),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'openai', 'paid', 'v2026-10-29', false),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'gemini', 'free', 'v2026-10-29', true);

-- save_provider_key ---------------------------------------------------------------------------------
select ok((select prosecdef from pg_proc where oid = 'public.save_provider_key(uuid,text,text,bytea,bytea,bytea,text,text,text,text,uuid,text,smallint)'::regprocedure),
          'save_provider_key is security definer');

-- R1 A19: the key RPCs run as service_role (server-only role) with p_user_id.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select throws_ok($$select public.save_provider_key('aaaaaaaa-0000-0000-0000-000000000001', 'mistral', 'paid', '\x01', '\x02', '\x03', 'env-v1', 'abcd', 'v2026-10-29', 'valid', gen_random_uuid())$$,
                 'P0001', 'invalid_provider', 'invalid provider');
select throws_ok($$select public.save_provider_key('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'pro', '\x01', '\x02', '\x03', 'env-v1', 'abcd', 'v2026-10-29', 'valid', gen_random_uuid())$$,
                 'P0001', 'invalid_connection_tier', 'invalid tier');
select throws_ok($$select public.save_provider_key('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'free', '\x01', '\x02', '\x03', 'env-v1', 'abcd', 'v2026-10-29', 'key_invalid', gen_random_uuid())$$,
                 'P0001', 'invalid_verification_result', 'key_invalid is never stored (R-38)');
select throws_ok($$select public.save_provider_key('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'free', '\x01', '\x02', '\x03', 'env-v1', 'abcd', 'v2026-10-29', 'valid', gen_random_uuid(), 'rate_limited')$$,
                 'P0001', 'invalid_failure_cause', 'valid with a failure cause rejected');
select throws_ok($$select public.save_provider_key('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'free', '\x01', '\x02', '\x03', 'env-v1', 'abcd', 'v2026-10-29', 'limited', gen_random_uuid())$$,
                 'P0001', 'invalid_failure_cause', 'limited without a cause rejected');
select throws_ok($$select public.save_provider_key('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'free', '\x01', '\x02', '\x03', 'env-v1', 'abcd', 'v2026-10-29', 'limited', gen_random_uuid(), 'billing_required')$$,
                 'P0001', 'invalid_failure_cause', 'limited with billing_required rejected (not stored, R-38)');
select throws_ok($$select public.save_provider_key('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'free', '\x01', '\x02', '\x03', 'env-v1', 'abcd', 'v2026-10-29', 'valid', null)$$,
                 'P0001', 'invalid_key_id', 'key id required');
select throws_ok($$select public.save_provider_key('aaaaaaaa-0000-0000-0000-000000000001', 'anthropic', 'paid', '\x01', '\x02', '\x03', 'env-v1', 'abcd', 'v2026-10-29', 'valid', gen_random_uuid())$$,
                 'P0001', 'consent_required', 'no consent → consent_required (F-AI-04 (4))');
select throws_ok($$select public.save_provider_key('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'free', '\x01', '\x02', '\x03', 'env-v1', 'abcd', 'v1999', 'valid', gen_random_uuid())$$,
                 'P0001', 'consent_required', 'stale disclosure version → consent_required');
select throws_ok($$select public.save_provider_key('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'free', '\x01', '\x02', '\x03', 'env-v1', 'abcd', null, 'valid', gen_random_uuid())$$,
                 'P0001', 'consent_required', 'null disclosure version → consent_required');
select throws_ok($$select public.save_provider_key('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'free', '\x01', '\x02', '\x03', 'env-v1', 'abc', 'v2026-10-29', 'valid', gen_random_uuid())$$,
                 '23514', null, 'key_last4 length enforced');
select is((select count(*)::int from public.ai_provider_keys), 0, 'nothing stored after the refusals');

-- first key, valid → stored, becomes active
select is(public.save_provider_key('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'free', '\x0a0b', '\x0c', '\x0d', 'env-v1', 'gm01', 'v2026-10-29', 'valid',
                                   'aaaaaaaa-9999-0000-0000-000000000001') - 'last_verified_at',
          '{"id": "aaaaaaaa-9999-0000-0000-000000000001", "provider": "gemini", "connection_tier": "free", "key_last4": "gm01",
            "status": "valid", "last_failure_cause": null, "last_failure_at": null, "is_active": true, "replaced": false}'::jsonb,
          'first valid key: stored, active, meta returned');
select ok((select last_verified_at is not null from public.ai_provider_keys where provider = 'gemini'),
          'valid → last_verified_at set');
select is((select active_ai_provider from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'gemini',
          'first key becomes active (F-AI-01 (5))');

-- second provider, limited → needs_check, not active (active already set)
select is(public.save_provider_key('aaaaaaaa-0000-0000-0000-000000000001', 'openai', 'paid', '\x01', '\x02', '\x03', 'env-v1', 'oa01', 'v2026-10-29', 'limited',
                                   'aaaaaaaa-9999-0000-0000-000000000002', 'daily_quota_exhausted')
            - 'last_failure_at',
          '{"id": "aaaaaaaa-9999-0000-0000-000000000002", "provider": "openai", "connection_tier": "paid", "key_last4": "oa01",
            "status": "needs_check", "last_verified_at": null, "last_failure_cause": "daily_quota_exhausted",
            "is_active": false, "replaced": false}'::jsonb,
          'limited → needs_check with cause, last_verified_at null, not active');
select ok((select last_failure_at is not null from public.ai_provider_keys where provider = 'openai'), 'limited → last_failure_at set');
select is((select active_ai_provider from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'gemini',
          'second key does not switch the active provider');

-- replacement must keep the id
select throws_ok($$select public.save_provider_key('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'free', '\x01', '\x02', '\x03', 'env-v1', 'gm02', 'v2026-10-29', 'valid', gen_random_uuid())$$,
                 'P0001', 'key_id_mismatch', 'replacement with a new id rejected (AAD binding)');

-- replacement with a tier change: same row, new ciphertext, old-tier consent withdrawn
select is(public.save_provider_key('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'paid', '\x1a1b', '\x1c', '\x1d', 'env-v2', 'gm02', 'v2026-10-29', 'valid',
                                   'aaaaaaaa-9999-0000-0000-000000000001') ->> 'replaced', 'true', 'replacement reports replaced');
reset role;
select results_eq(
  $$select id, connection_tier, key_ciphertext, key_nonce, wrapped_dek, kek_id, key_last4, status
      from public.ai_provider_keys where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and provider = 'gemini'$$,
  $$values ('aaaaaaaa-9999-0000-0000-000000000001'::uuid, 'paid', '\x1a1b'::bytea, '\x1c'::bytea, '\x1d'::bytea, 'env-v2', 'gm02', 'valid')$$,
  'replacement overwrites the same row (id kept)');
select is((select count(*)::int from public.ai_provider_keys where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 2,
          'still one row per provider');
select ok((select withdrawn_at is not null from public.ai_data_use_consents
            where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and provider = 'gemini' and connection_tier = 'free'),
          'tier change withdraws the previous tier consent');
select ok((select withdrawn_at is null from public.ai_data_use_consents
            where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and provider = 'gemini' and connection_tier = 'paid'),
          'new tier consent stays active');
-- replacement after a limited result clears verified time and records the cause; valid clears failure fields
update public.ai_provider_keys set last_failure_cause = 'rate_limited', last_failure_at = now()
 where id = 'aaaaaaaa-9999-0000-0000-000000000002';
-- R1 A19: the key RPCs run as service_role (server-only role) with p_user_id.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.save_provider_key('aaaaaaaa-0000-0000-0000-000000000001', 'openai', 'paid', '\x01', '\x02', '\x03', 'env-v1', 'oa02', 'v2026-10-29', 'valid',
                                   'aaaaaaaa-9999-0000-0000-000000000002') ->> 'status', 'valid', 'replacing a needs_check key with a valid one');
select results_eq($$select last_failure_cause, last_failure_at is null, last_verified_at is not null
                      from public.ai_provider_keys where provider = 'openai'$$,
                  $$values (null::text, true, true)$$, 'new valid key clears failure fields');
-- tier change back to free without a current free consent → refused, key unchanged
select throws_ok($$select public.save_provider_key('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'free', '\x01', '\x02', '\x03', 'env-v1', 'gm03', 'v2026-10-29', 'valid',
                                                   'aaaaaaaa-9999-0000-0000-000000000001')$$,
                 'P0001', 'consent_required', 'tier change needs a consent for the new tier');
select is((select key_last4 from public.ai_provider_keys where provider = 'gemini'), 'gm02',
          'failed replacement keeps the existing key');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

-- the view and the metadata columns
select is((select count(*)::int from public.ai_provider_keys_public), 2, 'A sees 2 keys in the view');
select lives_ok($$select id, provider, connection_tier, key_last4, status, last_verified_at, last_failure_cause,
                         last_failure_at, created_at, updated_at from public.ai_provider_keys$$,
                'A can select the metadata columns of the table');
select throws_ok($$select key_ciphertext from public.ai_provider_keys$$, '42501', null, 'authenticated: no key_ciphertext');
select throws_ok($$select key_nonce from public.ai_provider_keys$$, '42501', null, 'authenticated: no key_nonce');
select throws_ok($$select wrapped_dek from public.ai_provider_keys$$, '42501', null, 'authenticated: no wrapped_dek');
select throws_ok($$select kek_id from public.ai_provider_keys$$, '42501', null, 'authenticated: no kek_id');
select throws_ok($$select * from public.ai_provider_keys$$, '42501', null, 'authenticated: select * refused');
select throws_ok($$select user_id from public.ai_provider_keys$$, '42501', null, 'authenticated: no user_id (DM column list)');
reset role;

-- B: isolation + B's own first key
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
select is_empty($$select id from public.ai_provider_keys_public$$, 'B sees none of A''s keys');
select is_empty($$delete from public.ai_provider_keys returning id$$, 'B cannot delete A''s keys');
select throws_ok($$select public.set_active_ai_provider('openai')$$, 'P0001', 'key_not_found', 'B cannot activate a provider it has no key for');
-- B can't call the key RPCs at all (A19), not even for itself.
select throws_ok($$select public.save_provider_key('bbbbbbbb-0000-0000-0000-000000000002', 'gemini', 'free', '\x01', '\x02', '\x03', 'env-v1', 'bbbb', 'v2026-10-29', 'valid', gen_random_uuid())$$,
                 '42501', null, 'authenticated cannot execute save_provider_key (A19)');
select throws_ok($$select public.record_provider_key_check('bbbbbbbb-0000-0000-0000-000000000002', 'gemini', 'valid')$$,
                 '42501', null, 'authenticated cannot execute record_provider_key_check (A19)');
reset role;
-- server role with B's id: B's rows only.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select public.save_provider_key('bbbbbbbb-0000-0000-0000-000000000002', 'gemini', 'free', '\x01', '\x02', '\x03', 'env-v1', 'bbbb', 'v2026-10-29', 'valid',
                                                   'aaaaaaaa-9999-0000-0000-000000000001')$$,
                 '23505', null, 'B cannot reuse A''s key id (PK)');
select throws_ok($$select public.record_provider_key_check('bbbbbbbb-0000-0000-0000-000000000002', 'gemini', 'valid')$$, 'P0001', 'key_not_found', 'B''s id cannot check A''s key');
select throws_ok($$select public.save_provider_key(gen_random_uuid(), 'gemini', 'free', '\x01', '\x02', '\x03', 'env-v1', 'abcd', 'v2026-10-29', 'valid', gen_random_uuid())$$,
                 'P0001', 'user_not_found', 'save: unknown user id');
select throws_ok($$select public.record_provider_key_check(gen_random_uuid(), 'gemini', 'valid')$$,
                 'P0001', 'user_not_found', 'check: unknown user id');
select throws_ok($$select public.save_provider_key(null, 'gemini', 'free', '\x01', '\x02', '\x03', 'env-v1', 'abcd', 'v2026-10-29', 'valid', gen_random_uuid())$$,
                 '42501', 'not_authenticated', 'save: null user id');
select throws_ok($$select public.record_provider_key_check(null, 'gemini', 'valid')$$, '42501', 'not_authenticated', 'check: null user id');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
select is(public.delete_provider_key('gemini'), false, 'B deleting gemini touches nothing (A''s key stays)');
reset role;
select is((select count(*)::int from public.ai_provider_keys where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 2,
          'A''s keys intact after B''s attempts');
select ok((select withdrawn_at is null from public.ai_data_use_consents
            where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and provider = 'gemini' and connection_tier = 'paid'),
          'A''s consent intact after B''s delete call');

-- record_provider_key_check -------------------------------------------------------------------------
-- R1 A19: the key RPCs run as service_role (server-only role) with p_user_id.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select public.record_provider_key_check('aaaaaaaa-0000-0000-0000-000000000001', 'mistral', 'valid')$$, 'P0001', 'invalid_provider', 'check: invalid provider');
select throws_ok($$select public.record_provider_key_check('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'ok')$$, 'P0001', 'invalid_result_status', 'check: invalid result');
select throws_ok($$select public.record_provider_key_check('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'valid', 'rate_limited')$$, 'P0001', 'invalid_failure_cause',
                 'check: valid with cause');
select throws_ok($$select public.record_provider_key_check('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'failed')$$, 'P0001', 'invalid_failure_cause', 'check: failed without cause');
select throws_ok($$select public.record_provider_key_check('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'failed', 'input_rejected')$$, 'P0001', 'invalid_failure_cause',
                 'check: input_rejected is not a key cause');
select throws_ok($$select public.record_provider_key_check('aaaaaaaa-0000-0000-0000-000000000001', 'anthropic', 'valid')$$, 'P0001', 'key_not_found', 'check: no key');

select results_eq($$select r->>'status', r->>'last_failure_cause' from (select public.record_provider_key_check('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'failed', 'rate_limited') r) x$$,
                  $$values ('needs_check', 'rate_limited')$$, 'check rate_limited → needs_check + cause');
select results_eq($$select r->>'status', r->>'last_failure_cause' from (select public.record_provider_key_check('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'failed', 'billing_required') r) x$$,
                  $$values ('needs_check', 'billing_required')$$, 'check billing_required → needs_check (key kept)');
select results_eq($$select r->>'status', r->>'last_failure_cause' from (select public.record_provider_key_check('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'failed', 'model_not_available') r) x$$,
                  $$values ('needs_check', 'model_not_available')$$, 'check model_not_available → needs_check');
select results_eq($$select r->>'status', r->>'last_failure_cause' from (select public.record_provider_key_check('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'failed', 'key_invalid') r) x$$,
                  $$values ('invalid', 'key_invalid')$$, 'check key_invalid → invalid');
select results_eq($$select r->>'status', (r->>'last_verified_at') is not null, r->>'last_failure_cause', (r->>'is_active')::boolean
                      from (select public.record_provider_key_check('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'valid') r) x$$,
                  $$values ('valid', true, 'key_invalid', true)$$, 'check success → valid, verified now, failure kept as history');
select is((select count(*)::int from public.ai_provider_keys), 2, 'checks never delete the key');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

-- set_active_ai_provider ----------------------------------------------------------------------------
select throws_ok($$select public.set_active_ai_provider('mistral')$$, 'P0001', 'invalid_provider', 'set_active: invalid provider');
select throws_ok($$select public.set_active_ai_provider(null)$$, 'P0001', 'invalid_provider', 'set_active: null');
select throws_ok($$select public.set_active_ai_provider('anthropic')$$, 'P0001', 'key_not_found', 'set_active: no key');
select lives_ok($$select public.set_active_ai_provider('openai')$$, 'set_active: provider with a key');
select is((select active_ai_provider from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'openai',
          'active provider switched');

-- delete_provider_key ------------------------------------------------------------------------------
select ok(not (select prosecdef from pg_proc where oid = 'public.delete_provider_key(text)'::regprocedure),
          'delete_provider_key is security invoker');
select throws_ok($$select public.delete_provider_key('mistral')$$, 'P0001', 'invalid_provider', 'delete: invalid provider');
select is(public.delete_provider_key('openai'), true, 'delete the active key');
select is((select active_ai_provider from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001'), null,
          'FK set null: no active provider, no automatic switch (F-AI-02 (3))');
select is((select display_name from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001'), null,
          'profile row kept');
select is((select count(*)::int from public.ai_data_use_consents where provider = 'openai' and withdrawn_at is null), 0,
          'delete withdraws the provider''s active consents');
select is((select count(*)::int from public.ai_data_use_consents where provider = 'gemini' and withdrawn_at is null), 1,
          'other providers'' consents untouched');
select is(public.delete_provider_key('openai'), false, 'delete again: idempotent false');
select is((select count(*)::int from public.ai_provider_keys_public), 1, 'gemini key remains');
-- re-register after the active key is gone → becomes active again ("first" = no active provider)
reset role;
insert into public.ai_data_use_consents (user_id, provider, connection_tier, disclosure_version) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'openai', 'paid', 'v2026-10-29');
-- R1 A19: the key RPCs run as service_role (server-only role) with p_user_id.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is((public.save_provider_key('aaaaaaaa-0000-0000-0000-000000000001', 'openai', 'paid', '\x01', '\x02', '\x03', 'env-v1', 'oa03', 'v2026-10-29', 'valid',
                                    'aaaaaaaa-9999-0000-0000-000000000003') ->> 'is_active')::boolean, true,
          'registering while no provider is active activates the new key');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
-- delete of a non-active key leaves the active provider alone
select is(public.delete_provider_key('gemini'), true, 'delete a non-active key');
select is((select active_ai_provider from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'openai',
          'active provider unchanged when another key is deleted');
reset role;

-- no JWT sub
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated"}';
select throws_ok($$select public.set_active_ai_provider('gemini')$$, '42501', 'not_authenticated', 'set_active: no sub');
select throws_ok($$select public.delete_provider_key('gemini')$$, '42501', 'not_authenticated', 'delete: no sub');
reset role;

-- execute privileges
select set_eq(
  $$select r.rolname::text || ':' || f.fn
      from pg_roles r
      cross join (values ('save_provider_key(uuid,text,text,bytea,bytea,bytea,text,text,text,text,uuid,text,smallint)'),
                         ('record_provider_key_check(uuid,text,text,text)'), ('delete_provider_key(text)'),
                         ('set_active_ai_provider(text)'), ('mark_provider_key_invalid(uuid,text)'),
                         ('record_provider_key_success(uuid)')) f (fn)
     where (r.rolname in ('anon', 'authenticated', 'app_ai_writer', 'app_key_reader')
            or (r.rolname = 'service_role' and f.fn like any (array['save_provider_key%', 'record_provider_key_check%'])))
       and has_function_privilege(r.oid, ('public.' || f.fn)::regprocedure, 'execute')$$,
  $$values ('service_role:save_provider_key(uuid,text,text,bytea,bytea,bytea,text,text,text,text,uuid,text,smallint)'),
           ('service_role:record_provider_key_check(uuid,text,text,text)'), ('authenticated:delete_provider_key(text)'),
           ('authenticated:set_active_ai_provider(text)'), ('app_ai_writer:mark_provider_key_invalid(uuid,text)'),
           ('app_ai_writer:record_provider_key_success(uuid)')$$,
  'key RPC execute grants: save / check → service_role (A19), delete / set_active → authenticated, status RPCs → app_ai_writer');

-- app_ai_writer: mark_provider_key_invalid / record_provider_key_success -------------------------------
-- A now has: openai (active, valid). Add gemini back (needs_check) and jobs for both providers.
insert into public.ai_provider_keys (id, user_id, provider, connection_tier, key_ciphertext, key_nonce, wrapped_dek, kek_id, key_last4, status)
values ('aaaaaaaa-9999-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'free', '\x01', '\x02', '\x03', 'env-v1', 'gm04', 'needs_check');
insert into public.ai_jobs (id, user_id, job_type, target_type, target_id, provider, model_tier, connection_tier, status, heartbeat_at) values
  ('aaaaaaaa-7777-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'insight', 'application_project', gen_random_uuid(), 'openai', 'default', 'paid', 'running', now()),
  ('aaaaaaaa-7777-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'insight', 'application_project', gen_random_uuid(), 'gemini', 'default', 'free', 'running', now()),
  ('aaaaaaaa-7777-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'insight', 'application_project', gen_random_uuid(), 'gemini', 'default', 'free', 'queued', null),
  ('aaaaaaaa-7777-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001', 'insight', 'application_project', gen_random_uuid(), 'anthropic', 'default', 'paid', 'running', now()),
  ('bbbbbbbb-7777-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'insight', 'application_project', gen_random_uuid(), 'gemini', 'default', 'free', 'running', now());

set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select throws_ok($$select * from public.ai_provider_keys$$, '42501', null, 'app_ai_writer: no table access to keys');
select throws_ok($$select id from public.ai_provider_keys_public$$, '42501', null, 'app_ai_writer: no view access');
select throws_ok($$select active_ai_provider from public.profiles$$, '42501', null, 'app_ai_writer: no active_ai_provider column');
select throws_ok($$select public.save_provider_key('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'free', '\x01', '\x02', '\x03', 'env-v1', 'abcd', 'v2026-10-29', 'valid', gen_random_uuid())$$,
                 '42501', null, 'app_ai_writer cannot save keys');
select throws_ok($$select public.record_provider_key_check('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'valid')$$, '42501', null, 'app_ai_writer cannot run user check RPC');

select throws_ok($$select public.mark_provider_key_invalid('aaaaaaaa-7777-0000-0000-000000000001', 'input_rejected')$$,
                 'P0001', 'invalid_failure_cause', 'mark: input_rejected rejected');
select throws_ok($$select public.mark_provider_key_invalid('aaaaaaaa-7777-0000-0000-000000000001', null)$$,
                 'P0001', 'invalid_failure_cause', 'mark: null cause rejected');
select throws_ok($$select public.mark_provider_key_invalid('bbbbbbbb-7777-0000-0000-000000000001', 'key_invalid')$$,
                 'P0001', 'ai_job_not_found', 'mark: another user''s job');
select throws_ok($$select public.mark_provider_key_invalid(gen_random_uuid(), 'key_invalid')$$,
                 'P0001', 'ai_job_not_found', 'mark: unknown job');
select is(public.mark_provider_key_invalid('aaaaaaaa-7777-0000-0000-000000000004', 'key_invalid'), false,
          'mark: job provider has no key (deleted) → false');
select is(public.mark_provider_key_invalid('aaaaaaaa-7777-0000-0000-000000000001', 'billing_required'), true,
          'mark billing_required → updated');
reset role;
select results_eq($$select status, last_failure_cause, last_failure_at is not null from public.ai_provider_keys
                     where id = 'aaaaaaaa-9999-0000-0000-000000000003'$$,
                  $$values ('valid', 'billing_required', true)$$, 'non-key_invalid cause: status kept, failure recorded');
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.mark_provider_key_invalid('aaaaaaaa-7777-0000-0000-000000000001', 'key_invalid'), true, 'mark key_invalid');
reset role;
select results_eq($$select status, last_failure_cause from public.ai_provider_keys where id = 'aaaaaaaa-9999-0000-0000-000000000003'$$,
                  $$values ('invalid', 'key_invalid')$$, 'key_invalid → status invalid');
select is((select status from public.ai_provider_keys where id = 'aaaaaaaa-9999-0000-0000-000000000004'), 'needs_check',
          'mark only touched the job''s provider');

set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select throws_ok($$select public.record_provider_key_success('bbbbbbbb-7777-0000-0000-000000000001')$$,
                 'P0001', 'ai_job_not_found', 'success: another user''s job');
select throws_ok($$select public.record_provider_key_success('aaaaaaaa-7777-0000-0000-000000000003')$$,
                 'P0001', 'invalid_ai_job_state', 'success: queued job rejected');
select is(public.record_provider_key_success('aaaaaaaa-7777-0000-0000-000000000001'), false,
          'success on an invalid key: no change');
select is(public.record_provider_key_success('aaaaaaaa-7777-0000-0000-000000000002'), true,
          'success on a needs_check key → valid');
select is(public.record_provider_key_success('aaaaaaaa-7777-0000-0000-000000000002'), false, 'second call: already valid, no-op');
reset role;
select results_eq($$select status, last_verified_at is not null from public.ai_provider_keys where id = 'aaaaaaaa-9999-0000-0000-000000000004'$$,
                  $$values ('valid', true)$$, 'needs_check → valid with last_verified_at');
select is((select status from public.ai_provider_keys where id = 'aaaaaaaa-9999-0000-0000-000000000003'), 'invalid',
          'invalid key not revived by a success report');
-- succeeded job is accepted too
update public.ai_provider_keys set status = 'needs_check' where id = 'aaaaaaaa-9999-0000-0000-000000000004';
update public.ai_jobs set status = 'succeeded' where id = 'aaaaaaaa-7777-0000-0000-000000000002';
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.record_provider_key_success('aaaaaaaa-7777-0000-0000-000000000002'), true, 'success: succeeded job accepted');
set local request.jwt.claims = '{"role":"app_ai_writer"}';
select throws_ok($$select public.mark_provider_key_invalid('aaaaaaaa-7777-0000-0000-000000000001', 'key_invalid')$$,
                 '42501', 'not_authenticated', 'mark: no sub');
select throws_ok($$select public.record_provider_key_success('aaaaaaaa-7777-0000-0000-000000000001')$$,
                 '42501', 'not_authenticated', 'success: no sub');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.mark_provider_key_invalid('aaaaaaaa-7777-0000-0000-000000000001', 'key_invalid')$$,
                 '42501', null, 'authenticated cannot run mark_provider_key_invalid');
select throws_ok($$select public.record_provider_key_success('aaaaaaaa-7777-0000-0000-000000000001')$$,
                 '42501', null, 'authenticated cannot run record_provider_key_success');
reset role;

-- service_role (operators) see metadata only
set local role service_role;
select lives_ok($$select id, user_id, provider, status, key_last4 from public.ai_provider_keys$$, 'service_role reads metadata');
select throws_ok($$select key_ciphertext from public.ai_provider_keys$$, '42501', null, 'service_role: no ciphertext');
select throws_ok($$select wrapped_dek from public.ai_provider_keys$$, '42501', null, 'service_role: no wrapped_dek');
select throws_ok($$update public.ai_provider_keys set status = 'valid'$$, '42501', null, 'service_role cannot update keys');
reset role;

-- updated_at trigger
update public.ai_provider_keys set updated_at = '2000-01-01' where id = 'aaaaaaaa-9999-0000-0000-000000000004';
select ok((select updated_at > '2000-01-02' from public.ai_provider_keys where id = 'aaaaaaaa-9999-0000-0000-000000000004'),
          'updated_at maintained by trigger');

-- account deletion cascade (DM-1)
delete from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is((select count(*)::int from public.ai_provider_keys where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 0,
          'keys removed with the account');

select * from finish();
rollback;
