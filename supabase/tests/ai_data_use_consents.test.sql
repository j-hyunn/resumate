-- S3b: ai_disclosures / ai_providers (DM 2.11.6) and ai_data_use_consents (DM 2.11.5).
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

-- Reference tables -------------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.ai_providers'::regclass), 'ai_providers RLS on');
select ok((select relrowsecurity from pg_class where oid = 'public.ai_disclosures'::regclass), 'ai_disclosures RLS on');

select results_eq(
  $$select provider, display_order::int, is_available, is_recommended from public.ai_providers order by display_order$$,
  $$values ('gemini', 1, true, true), ('anthropic', 2, true, false), ('openai', 3, true, false)$$,
  'ai_providers seed: gemini 1 (recommended) / anthropic 2 / openai 3, all available (UB-3)');
select is((select count(*)::int from public.ai_providers where dashboard_url like 'https://%' and billing_url like 'https://%'),
          3, 'every provider has https dashboard / billing urls');

select results_eq(
  $$select provider, connection_tier, version, requires_free_tier_ack, document_path
      from public.ai_disclosures order by provider, connection_tier$$,
  $$values ('anthropic', 'free', 'v2026-10-29', true, '/policies/ai/anthropic/free/v2026-10-29'),
           ('anthropic', 'paid', 'v2026-10-29', false, '/policies/ai/anthropic/paid/v2026-10-29'),
           ('gemini', 'free', 'v2026-10-29', true, '/policies/ai/gemini/free/v2026-10-29'),
           ('gemini', 'paid', 'v2026-10-29', false, '/policies/ai/gemini/paid/v2026-10-29'),
           ('openai', 'free', 'v2026-10-29', true, '/policies/ai/openai/free/v2026-10-29'),
           ('openai', 'paid', 'v2026-10-29', false, '/policies/ai/openai/paid/v2026-10-29')$$,
  'ai_disclosures seed: 3 providers x 2 tiers, v2026-10-29');
select is(private.current_ai_disclosure_version('gemini', 'free'), 'v2026-10-29', 'current disclosure version');
select is(private.current_ai_disclosure_version('gemini', 'nope'), null, 'unknown tier → null');

select throws_ok($$insert into public.ai_providers (provider, display_order) values ('mistral', 9)$$,
                 '23514', null, 'ai_providers provider CHECK');
select throws_ok($$insert into public.ai_disclosures (provider, connection_tier, version, effective_at, document_path)
                   values ('gemini', 'free', 'vX', now(), '/x')$$,
                 '23514', null, 'free-tier disclosure must require the free-tier acknowledgement');
select throws_ok($$insert into public.ai_disclosures (provider, connection_tier, version, effective_at, document_path)
                   values ('gemini', 'paid', 'v2026-10-29', now(), '/x')$$,
                 '23505', null, 'unique (provider, tier, version)');

-- a future version is not current yet; a newer effective one becomes current
insert into public.ai_disclosures (provider, connection_tier, version, effective_at, requires_reconsent, document_path)
values ('openai', 'paid', 'v2099-01-01', '2099-01-01', true, '/policies/ai/openai/paid/v2099-01-01');
select is(private.current_ai_disclosure_version('openai', 'paid'), 'v2026-10-29', 'future version not current');

-- anon reads ai_disclosures, not ai_providers
set local role anon;
select lives_ok($$select * from public.ai_disclosures$$, 'anon can read ai_disclosures');
select throws_ok($$select * from public.ai_providers$$, '42501', null, 'anon cannot read ai_providers');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.ai_providers), 3, 'authenticated reads ai_providers');
select is((select count(*)::int from public.ai_disclosures), 7, 'authenticated reads ai_disclosures');
select throws_ok($$update public.ai_providers set is_available = false$$, '42501', null, 'authenticated cannot write ai_providers');
select throws_ok($$insert into public.ai_disclosures (provider, connection_tier, version, effective_at, document_path)
                   values ('gemini', 'paid', 'v9', now(), '/x')$$, '42501', null, 'authenticated cannot write ai_disclosures');
reset role;

set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select throws_ok($$select * from public.ai_disclosures$$, '42501', null, 'app_ai_writer cannot read ai_disclosures');
select throws_ok($$select * from public.ai_data_use_consents$$, '42501', null, 'app_ai_writer cannot read ai_data_use_consents');
reset role;

-- ai_data_use_consents ------------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.ai_data_use_consents'::regclass), 'consents RLS on');
select policies_are('public', 'ai_data_use_consents',
  array['ai_data_use_consents_select_own', 'ai_data_use_consents_insert_own', 'ai_data_use_consents_update_withdraw_own'],
  'ai_data_use_consents policies (no delete)');
select hasnt_column('public', 'ai_data_use_consents', 'updated_at', 'append-only record: no updated_at');

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok($$insert into public.ai_data_use_consents (provider, connection_tier, disclosure_version, free_tier_acknowledged, agreed_at)
                   values ('gemini', 'free', 'v2026-10-29', true, '2000-01-01')$$,
                 '42501', null, 'agreed_at is not client-writable');
select throws_ok($$insert into public.ai_data_use_consents (id, provider, connection_tier, disclosure_version, free_tier_acknowledged)
                   values (gen_random_uuid(), 'gemini', 'free', 'v2026-10-29', true)$$,
                 '42501', null, 'id is not client-writable');
select lives_ok($$insert into public.ai_data_use_consents (provider, connection_tier, disclosure_version, free_tier_acknowledged)
                  values ('gemini', 'free', 'v2026-10-29', true)$$,
                'insert own free-tier consent with acknowledgement');
reset role;
update public.ai_data_use_consents set id = 'aaaaaaaa-5555-0000-0000-000000000001'
 where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and provider = 'gemini' and connection_tier = 'free';
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select ok((select agreed_at > now() - interval '1 minute' and withdrawn_at is null and user_id = 'aaaaaaaa-0000-0000-0000-000000000001'
             from public.ai_data_use_consents where id = 'aaaaaaaa-5555-0000-0000-000000000001'),
          'server time, not withdrawn, user_id defaults to the caller');
select throws_ok($$insert into public.ai_data_use_consents (provider, connection_tier, disclosure_version)
                   values ('gemini', 'free', 'v2026-10-29')$$,
                 '23514', null, 'free tier without acknowledgement rejected (F-AI-04 (3))');
select lives_ok($$insert into public.ai_data_use_consents (provider, connection_tier, disclosure_version)
                  values ('gemini', 'paid', 'v2026-10-29')$$, 'paid tier needs no acknowledgement');
select throws_ok($$insert into public.ai_data_use_consents (provider, connection_tier, disclosure_version)
                   values ('gemini', 'paid', 'v1999')$$,
                 'P0001', 'unknown_disclosure_version', 'unknown disclosure version rejected');
select throws_ok($$insert into public.ai_data_use_consents (provider, connection_tier, disclosure_version)
                   values ('openai', 'paid', 'v2099-01-01')$$,
                 'P0001', 'disclosure_version_not_current', 'not-yet-effective disclosure rejected');
select throws_ok($$insert into public.ai_data_use_consents (provider, connection_tier, disclosure_version)
                   values ('mistral', 'paid', 'v2026-10-29')$$,
                 'P0001', 'unknown_disclosure_version', 'unknown provider rejected');
select throws_ok($$insert into public.ai_data_use_consents (user_id, provider, connection_tier, disclosure_version)
                   values ('bbbbbbbb-0000-0000-0000-000000000002', 'gemini', 'paid', 'v2026-10-29')$$,
                 '42501', null, 'cannot insert a consent for another user');

reset role;  -- private helper: owner only
select ok(private.ai_consent_allows_run('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'free'),
          'ai_consent_allows_run (R1 A20 shared rule): true for the current version');
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
reset role;  -- private helper: owner only
select ok(not private.ai_consent_allows_run('aaaaaaaa-0000-0000-0000-000000000001', 'openai', 'paid'),
          'ai_consent_allows_run: false without a row');
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

-- withdraw: server time; only active rows; no un-withdraw; no other column; no delete
select lives_ok($$update public.ai_data_use_consents set withdrawn_at = '2000-01-01'
                   where id = 'aaaaaaaa-5555-0000-0000-000000000001'$$, 'withdraw own consent');
select ok((select withdrawn_at > now() - interval '1 minute' from public.ai_data_use_consents
            where id = 'aaaaaaaa-5555-0000-0000-000000000001'), 'withdrawn_at is the server time');
reset role;  -- private helper: owner only
select ok(not private.ai_consent_allows_run('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'free'),
          'withdrawn consent no longer counts');
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select is_empty($$update public.ai_data_use_consents set withdrawn_at = null
                   where id = 'aaaaaaaa-5555-0000-0000-000000000001' returning id$$,
                'a withdrawn consent cannot be re-activated (RLS using withdrawn_at is null)');
select throws_ok($$update public.ai_data_use_consents set disclosure_version = 'v2026-10-29'$$,
                 '42501', null, 'only withdrawn_at is updatable');
select throws_ok($$delete from public.ai_data_use_consents$$, '42501', null, 'no delete');

-- re-consent = new row; latest active row decides
select lives_ok($$insert into public.ai_data_use_consents (provider, connection_tier, disclosure_version, free_tier_acknowledged)
                  values ('gemini', 'free', 'v2026-10-29', true)$$, 're-consent inserts a new row');
reset role;  -- private helper: owner only
select ok(private.ai_consent_allows_run('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'free'),
          're-consent counts again');
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.ai_data_use_consents where provider = 'gemini' and connection_tier = 'free'),
          2, 'two rows kept (1 consent action = 1 row)');
reset role;

-- B isolation
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
select is_empty($$select id from public.ai_data_use_consents$$, 'B sees none of A''s consents');
select is_empty($$update public.ai_data_use_consents set withdrawn_at = now() returning id$$, 'B cannot withdraw A''s consents');
reset role;

-- account deletion cascades
delete from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is((select count(*)::int from public.ai_data_use_consents
            where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 0, 'consents removed with the account (DM-1)');

select * from finish();
rollback;
