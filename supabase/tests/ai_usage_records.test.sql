-- S3a ai_usage_records (DM §2.9.2, AI C-13): RLS isolation, app_ai_writer insert-only, immutability,
-- CHECKs, period_month (KST) trigger, account-deletion cascade. Also: the S3 ledger objects are gone.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer, service_role;
select no_plan();

-- Ledger removed (D-34).
select hasnt_table('public', 'usage_events', 'usage_events dropped');
select hasnt_table('public', 'usage_limits', 'usage_limits dropped');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public', 'private')
              and p.proname in ('reserve_usage', 'charge_usage', 'release_usage', 'charge_usage_for_job',
                                'release_usage_for_job', 'get_usage_summary', 'transition_usage_event')), 0,
          'ledger functions dropped');

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

select ok((select relrowsecurity from pg_class where oid = 'public.ai_usage_records'::regclass), 'RLS enabled');
select policies_are('public', 'ai_usage_records',
  array['ai_usage_records_select_own', 'ai_usage_records_select_ai_writer', 'ai_usage_records_insert_ai_writer']);
select hasnt_column('public', 'ai_usage_records', 'updated_at', 'immutable: no updated_at');
select col_type_is('public', 'ai_usage_records', 'estimated_cost_usd', 'numeric(12,6)', 'estimated_cost_usd numeric(12,6)');
select has_index('public', 'ai_usage_records', 'ai_usage_records_user_period_feature_idx',
                 array['user_id', 'period_month', 'feature'], 'index (user_id, period_month, feature)');
select has_index('public', 'ai_usage_records', 'ai_usage_records_user_period_provider_idx',
                 array['user_id', 'period_month', 'provider'], 'index (user_id, period_month, provider)');

set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';

select lives_ok($$insert into public.ai_usage_records (id, occurred_at, feature, job_type, ai_job_id, call_key, provider, model,
                    model_tier, connection_tier, input_tokens, cached_input_tokens, cache_write_tokens, output_tokens,
                    reasoning_tokens, usage_source, outcome, price_table_version, estimated_cost_usd)
                  values ('a3000000-0000-0000-0000-000000000001', '2026-10-31 15:30:00+00', 'insight', 'insight', gen_random_uuid(),
                    'insight.match.2', 'gemini', 'gemini-3.8-flash', 'default', 'free', 1000, 200, 0, 300, 100,
                    'provider_reported', 'succeeded', 'v2026-10-28', 0.001890)$$,
                'app_ai_writer inserts a usage record');
select results_eq($$select user_id, period_month from public.ai_usage_records where id = 'a3000000-0000-0000-0000-000000000001'$$,
                  $$values ('a0000000-0000-0000-0000-000000000001'::uuid, date '2026-11-01')$$,
                  'user_id = JWT sub; period_month = KST month of occurred_at (2026-10-31 15:30Z = 11-01 00:30 KST)');
select lives_ok($$insert into public.ai_usage_records (feature, job_type, provider, model, model_tier, connection_tier,
                    usage_source, outcome, error_code, price_table_version, estimated_cost_usd)
                  values ('cover_letter', 'cover_letter', 'openai', 'gpt-6.1-terra', 'default', 'paid', 'unavailable', 'failed',
                    'rate_limited', 'v2026-10-28', 0)$$,
                'failed call without usage: tokens default 0, unavailable');
select is((select period_month from public.ai_usage_records where feature = 'cover_letter'),
          date_trunc('month', now() at time zone 'Asia/Seoul')::date, 'occurred_at defaults to now (this KST month)');

-- CHECKs
select throws_ok($$insert into public.ai_usage_records (feature, job_type, provider, model, model_tier, connection_tier,
                     usage_source, outcome, price_table_version, estimated_cost_usd, period_month)
                   values ('insight', 'insight', 'openai', 'm', 'default', 'paid', 'provider_reported', 'succeeded', 'v', 0, '2026-10-01')$$,
                 '42501', null, 'period_month is not insertable (trigger computes it)');
select throws_ok($$insert into public.ai_usage_records (feature, job_type, provider, model, model_tier, connection_tier,
                     usage_source, outcome, price_table_version, estimated_cost_usd)
                   values ('draft', 'insight', 'openai', 'm', 'default', 'paid', 'provider_reported', 'succeeded', 'v', 0)$$,
                 '23514', null, 'feature CHECK');
select throws_ok($$insert into public.ai_usage_records (feature, job_type, provider, model, model_tier, connection_tier,
                     usage_source, outcome, price_table_version, estimated_cost_usd)
                   values ('writing_chat', 'writing_chat', 'openai', 'm', 'default', 'paid', 'provider_reported', 'succeeded', 'v', 0)$$,
                 '23514', null, 'job_type CHECK (same list as ai_jobs)');
select throws_ok($$insert into public.ai_usage_records (feature, job_type, provider, model, model_tier, connection_tier,
                     usage_source, outcome, price_table_version, estimated_cost_usd)
                   values ('insight', 'insight', 'mistral', 'm', 'default', 'paid', 'provider_reported', 'succeeded', 'v', 0)$$,
                 '23514', null, 'provider CHECK');
select throws_ok($$insert into public.ai_usage_records (feature, job_type, provider, model, model_tier, connection_tier,
                     usage_source, outcome, price_table_version, estimated_cost_usd)
                   values ('insight', 'insight', 'openai', 'm', 'default', 'paid', 'estimated', 'succeeded', 'v', 0)$$,
                 '23514', null, 'usage_source CHECK');
select throws_ok($$insert into public.ai_usage_records (feature, job_type, provider, model, model_tier, connection_tier,
                     usage_source, outcome, price_table_version, estimated_cost_usd)
                   values ('insight', 'insight', 'openai', 'm', 'default', 'paid', 'provider_reported', 'partial', 'v', 0)$$,
                 '23514', null, 'outcome CHECK');
select throws_ok($$insert into public.ai_usage_records (feature, job_type, provider, model, model_tier, connection_tier,
                     usage_source, outcome, error_code, price_table_version, estimated_cost_usd)
                   values ('insight', 'insight', 'openai', 'm', 'default', 'paid', 'provider_reported', 'succeeded', 'timeout', 'v', 0)$$,
                 '23514', null, 'succeeded call has no error_code');
select throws_ok($$insert into public.ai_usage_records (feature, job_type, provider, model, model_tier, connection_tier,
                     usage_source, outcome, error_code, price_table_version, estimated_cost_usd)
                   values ('insight', 'insight', 'openai', 'm', 'default', 'paid', 'provider_reported', 'failed', 'refused', 'v', 0)$$,
                 '23514', null, 'error_code CHECK (v4 list)');
select throws_ok($$insert into public.ai_usage_records (feature, job_type, provider, model, model_tier, connection_tier,
                     usage_source, outcome, input_tokens, price_table_version, estimated_cost_usd)
                   values ('insight', 'insight', 'openai', 'm', 'default', 'paid', 'unavailable', 'failed', 5, 'v', 0)$$,
                 '23514', null, 'unavailable usage must have 0 tokens');
select throws_ok($$insert into public.ai_usage_records (feature, job_type, provider, model, model_tier, connection_tier,
                     usage_source, outcome, output_tokens, price_table_version, estimated_cost_usd)
                   values ('insight', 'insight', 'openai', 'm', 'default', 'paid', 'provider_reported', 'succeeded', -1, 'v', 0)$$,
                 '23514', null, 'tokens >= 0');
select throws_ok($$insert into public.ai_usage_records (feature, job_type, provider, model, model_tier, connection_tier,
                     usage_source, outcome, price_table_version, estimated_cost_usd)
                   values ('insight', 'insight', 'openai', 'm', 'default', 'paid', 'provider_reported', 'succeeded', 'v', -0.1)$$,
                 '23514', null, 'estimated_cost_usd >= 0');
select throws_ok($$insert into public.ai_usage_records (user_id, feature, job_type, provider, model, model_tier, connection_tier,
                     usage_source, outcome, price_table_version, estimated_cost_usd)
                   values ('b0000000-0000-0000-0000-000000000002', 'insight', 'insight', 'openai', 'm', 'default', 'paid',
                           'provider_reported', 'succeeded', 'v', 0)$$,
                 '42501', null, 'app_ai_writer cannot insert for another user');

-- Immutable.
select throws_ok($$update public.ai_usage_records set input_tokens = 0$$, '42501', null, 'app_ai_writer cannot update');
select throws_ok($$delete from public.ai_usage_records$$, '42501', null, 'app_ai_writer cannot delete');
select is((select count(*)::int from public.ai_usage_records), 2, 'app_ai_writer reads own records (C-12 spacing)');

-- B (app_ai_writer) sees nothing of A.
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"app_ai_writer"}';
select is((select count(*)::int from public.ai_usage_records), 0, 'app_ai_writer B sees no A records');
reset role;

-- authenticated: select own only, no writes.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.ai_usage_records), 2, 'A sees own records');
select lives_ok($$select * from public.ai_usage_records$$, 'user select *');
select throws_ok($$insert into public.ai_usage_records (feature, job_type, provider, model, model_tier, connection_tier,
                     usage_source, outcome, price_table_version, estimated_cost_usd)
                   values ('insight', 'insight', 'openai', 'm', 'default', 'paid', 'provider_reported', 'succeeded', 'v', 0)$$,
                 '42501', null, 'user cannot insert');
select throws_ok($$update public.ai_usage_records set input_tokens = 0$$, '42501', null, 'user cannot update');
select throws_ok($$delete from public.ai_usage_records$$, '42501', null, 'user cannot delete');
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.ai_usage_records), 0, 'B sees no A records');
reset role;

set local role anon;
select throws_ok($$select * from public.ai_usage_records$$, '42501', null, 'anon cannot read');
reset role;

-- Account deletion cascades.
delete from auth.users where id = 'a0000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.ai_usage_records where user_id = 'a0000000-0000-0000-0000-000000000001'), 0,
          'records cascade on account deletion');

select * from finish();
rollback;
