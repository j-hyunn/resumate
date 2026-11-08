-- get_ai_usage_summary(p_period_month, p_include_previous) (DM §2.9.5, F-AI-07): shape, sums, month selection,
-- previous_month, isolation, privileges.
-- R13 (DM v4.12 §2.9.5, SD-A10·SD-A11): the response is the provider × feature cross aggregate — providers[]
-- ordered by ai_providers.display_order, only providers with records, by_feature with the stored feature values,
-- cost columns input_cost_usd / output_cost_usd from the stored columns. Top-level by_feature / by_provider gone.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer, service_role;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

select is((select prosecdef from pg_proc where oid = 'public.get_ai_usage_summary(date, boolean)'::regprocedure), false,
          'security invoker');
select ok(has_function_privilege('authenticated', 'public.get_ai_usage_summary(date, boolean)', 'execute'), 'authenticated can call');
select ok(not has_function_privilege('anon', 'public.get_ai_usage_summary(date, boolean)', 'execute'), 'anon cannot call');
select ok(not has_function_privilege('app_ai_writer', 'public.get_ai_usage_summary(date, boolean)', 'execute'),
          'app_ai_writer cannot call');

-- Records (inserted as postgres; occurred_at sets period_month). input_cost_usd + output_cost_usd =
-- estimated_cost_usd in every row here (AI C-13).
insert into public.ai_usage_records (user_id, occurred_at, feature, job_type, provider, model, model_tier, connection_tier,
  input_tokens, cached_input_tokens, cache_write_tokens, output_tokens, usage_source, outcome, error_code,
  price_table_version, input_cost_usd, output_cost_usd, estimated_cost_usd) values
  -- A, 2026-10 (KST): gemini free ×2 (one failed) + gemini paid ×1 (two tiers in one month) + anthropic paid ×2
  ('a0000000-0000-0000-0000-000000000001', '2026-10-05 01:00+09', 'insight', 'insight', 'gemini', 'gemini-3.8-flash', 'default', 'free',
   1000, 100, 0, 200, 'provider_reported', 'succeeded', null, 'v2026-10-28', 0.000750, 0.000750, 0.001500),
  ('a0000000-0000-0000-0000-000000000001', '2026-10-06 01:00+09', 'insight', 'insight', 'gemini', 'gemini-3.8-flash', 'default', 'free',
   0, 0, 0, 0, 'unavailable', 'failed', 'rate_limited', 'v2026-10-28', 0, 0, 0),
  ('a0000000-0000-0000-0000-000000000001', '2026-10-08 01:00+09', 'insight', 'insight', 'gemini', 'gemini-3.8-flash', 'default', 'paid',
   200, 0, 0, 50, 'provider_reported', 'succeeded', null, 'v2026-10-28', 0.000150, 0.000188, 0.000338),
  ('a0000000-0000-0000-0000-000000000001', '2026-10-07 01:00+09', 'cover_letter', 'cover_letter', 'anthropic', 'claude-sonnet-5-5', 'default', 'paid',
   500, 0, 50, 400, 'provider_reported', 'succeeded', null, 'v2026-10-28', 0.001125, 0.004000, 0.005125),
  -- A, 2026-10-31 23:30 KST is still October
  ('a0000000-0000-0000-0000-000000000001', '2026-10-31 14:30+00', 'jd_extraction', 'jd_extraction', 'anthropic', 'claude-haiku-5-5', 'light', 'paid',
   10, 0, 0, 5, 'provider_reported', 'succeeded', null, 'v2026-10-28', 0.000001, 0.000003, 0.000004),
  -- A, 2026-09 (openai only — so openai must NOT appear in the 2026-10 providers[])
  ('a0000000-0000-0000-0000-000000000001', '2026-09-20 12:00+09', 'insight', 'insight', 'openai', 'gpt-6.1-terra', 'default', 'paid',
   300, 0, 0, 100, 'provider_reported', 'succeeded', null, 'v2026-10-28', 0.000300, 0.000500, 0.000800),
  -- A, 2026-12 (other version)
  ('a0000000-0000-0000-0000-000000000001', '2026-12-02 12:00+09', 'insight', 'insight', 'gemini', 'gemini-4-argon', 'heavy', 'paid',
   100, 0, 0, 100, 'provider_reported', 'succeeded', null, 'v2026-12-01', 0.000400, 0.002000, 0.002400),
  -- B, 2026-10
  ('b0000000-0000-0000-0000-000000000002', '2026-10-10 12:00+09', 'insight', 'insight', 'openai', 'gpt-6-luna', 'light', 'paid',
   9999, 0, 0, 9999, 'provider_reported', 'succeeded', null, 'v2026-10-28', 0.100000, 0.400000, 0.500000);

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';

create temp table t_s as select public.get_ai_usage_summary('2026-10-15') as s;

select set_eq($$select jsonb_object_keys(s) from t_s$$,
              array['period_month', 'as_of', 'totals', 'providers', 'price_table_versions'],
              'top-level keys: providers[] replaces by_feature / by_provider, no previous_month by default');
select is((select s ->> 'period_month' from t_s), '2026-10-01', 'period_month normalized to day 1');
select ok((select (s ->> 'as_of')::timestamptz is not null from t_s), 'as_of is a timestamp');
select is((select s -> 'totals' from t_s),
          '{"input_tokens": 1710, "cached_input_tokens": 100, "cache_write_tokens": 50, "output_tokens": 655,
            "input_cost_usd": 0.002026, "output_cost_usd": 0.004941, "estimated_cost_usd": 0.006967,
            "calls": 5, "failed_calls": 1}'::jsonb,
          'totals for A in 2026-10 (KST boundary included, B excluded, two cost columns)');

-- providers[]: ai_providers.display_order (gemini 1, anthropic 2, openai 3); openai has no October record.
select is((select jsonb_agg(p ->> 'provider') from t_s, jsonb_array_elements(s -> 'providers') p),
          '["gemini", "anthropic"]'::jsonb,
          'providers[] ordered by display_order, and only providers with records that month');
select is((select p from t_s, jsonb_array_elements(s -> 'providers') p where p ->> 'provider' = 'gemini'),
          '{"provider": "gemini",
            "connection_tiers": ["free", "paid"],
            "totals": {"input_tokens": 1200, "cached_input_tokens": 100, "cache_write_tokens": 0,
                       "output_tokens": 250, "input_cost_usd": 0.000900, "output_cost_usd": 0.000938,
                       "estimated_cost_usd": 0.001838, "calls": 3, "failed_calls": 1},
            "by_feature": [{"feature": "insight", "input_tokens": 1200, "cached_input_tokens": 100,
                            "cache_write_tokens": 0, "output_tokens": 250, "input_cost_usd": 0.000900,
                            "output_cost_usd": 0.000938, "estimated_cost_usd": 0.001838,
                            "calls": 3, "failed_calls": 1}],
            "price_table_versions": [{"version": "v2026-10-28", "source_checked_at": "2026-10-28"}]}'::jsonb,
          'gemini row: both tiers in one month, feature totals, price table versions');
select is((select p from t_s, jsonb_array_elements(s -> 'providers') p where p ->> 'provider' = 'anthropic'),
          '{"provider": "anthropic",
            "connection_tiers": ["paid"],
            "totals": {"input_tokens": 510, "cached_input_tokens": 0, "cache_write_tokens": 50,
                       "output_tokens": 405, "input_cost_usd": 0.001126, "output_cost_usd": 0.004003,
                       "estimated_cost_usd": 0.005129, "calls": 2, "failed_calls": 0},
            "by_feature": [{"feature": "cover_letter", "input_tokens": 500, "cached_input_tokens": 0,
                            "cache_write_tokens": 50, "output_tokens": 400, "input_cost_usd": 0.001125,
                            "output_cost_usd": 0.004000, "estimated_cost_usd": 0.005125,
                            "calls": 1, "failed_calls": 0},
                           {"feature": "jd_extraction", "input_tokens": 10, "cached_input_tokens": 0,
                            "cache_write_tokens": 0, "output_tokens": 5, "input_cost_usd": 0.000001,
                            "output_cost_usd": 0.000003, "estimated_cost_usd": 0.000004,
                            "calls": 1, "failed_calls": 0}],
            "price_table_versions": [{"version": "v2026-10-28", "source_checked_at": "2026-10-28"}]}'::jsonb,
          'anthropic row: two features, stored feature values (no 7-row grouping in the RPC)');
-- The two cost columns add up to estimated_cost_usd in each aggregate level.
select ok((select ((s #>> '{totals,input_cost_usd}')::numeric + (s #>> '{totals,output_cost_usd}')::numeric)
                  = (s #>> '{totals,estimated_cost_usd}')::numeric from t_s),
          'totals: input_cost_usd + output_cost_usd = estimated_cost_usd');

select is((select s -> 'price_table_versions' from t_s),
          '[{"version": "v2026-10-28", "source_checked_at": "2026-10-28"}]'::jsonb,
          'top-level price_table_versions = the whole month');

select is(public.get_ai_usage_summary('2026-12-01') -> 'price_table_versions',
          '[{"version": "v2026-12-01", "source_checked_at": "2026-10-28"}]'::jsonb, 'another month, another version');
select is(public.get_ai_usage_summary('2026-10-01', true) -> 'previous_month',
          '{"period_month": "2026-09-01", "estimated_cost_usd": 0.000800, "input_tokens": 300, "output_tokens": 100}'::jsonb,
          'previous_month with p_include_previous (kept, UB-2 (b))');
select is(public.get_ai_usage_summary('2026-08-01', true) -> 'previous_month',
          '{"period_month": "2026-07-01", "estimated_cost_usd": 0, "input_tokens": 0, "output_tokens": 0}'::jsonb,
          'empty previous_month is zeros');
select is(public.get_ai_usage_summary('2026-08-01') - 'as_of',
          '{"period_month": "2026-08-01",
            "totals": {"input_tokens": 0, "cached_input_tokens": 0, "cache_write_tokens": 0, "output_tokens": 0,
                       "input_cost_usd": 0, "output_cost_usd": 0, "estimated_cost_usd": 0,
                       "calls": 0, "failed_calls": 0},
            "providers": [], "price_table_versions": []}'::jsonb,
          'empty month: zeros, empty providers[]');
select is(public.get_ai_usage_summary() ->> 'period_month',
          to_char(date_trunc('month', now() at time zone 'Asia/Seoul'), 'YYYY-MM-DD'), 'default = this KST month');
select is(public.get_ai_usage_summary(null) ->> 'period_month',
          to_char(date_trunc('month', now() at time zone 'Asia/Seoul'), 'YYYY-MM-DD'), 'null = this KST month');

set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(public.get_ai_usage_summary('2026-10-01') -> 'totals' -> 'calls', '1'::jsonb, 'B sees only own calls');
select is((select jsonb_agg(p ->> 'provider')
             from jsonb_array_elements(public.get_ai_usage_summary('2026-10-01') -> 'providers') p),
          '["openai"]'::jsonb, 'B sees only own providers');
set local request.jwt.claims = '{"role":"authenticated"}';
select throws_ok($$select public.get_ai_usage_summary()$$, '42501', 'not_authenticated', 'no sub');
reset role;

select * from finish();
rollback;
