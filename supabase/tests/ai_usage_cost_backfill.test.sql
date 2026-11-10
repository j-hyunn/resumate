-- R13 QA-R13-04: the backfill's cost split must equal what the recording path
-- (src/server/jobs/cost.ts estimateCost) computes for the same price row and the same tokens.
-- The local ai_usage_records table is empty, so this code first runs for real on the remote.
--
-- Expected values are copied verbatim from the golden table in
-- _workspace/backend/R13/02_api_notes.md §3 ("백필 SQL과의 동일성"), which is also pinned on the TS side by
-- src/server/jobs/cost-backfill-parity.test.ts. 11 price rows (every distinct price in the seed: 9 models of
-- v2026-10-28 + the two scheduled changes) × 3 usage combinations:
--   U1  10,000 / 0 / 0 / 2,000            (no cache)
--   U2  10,000 / 50,000 / 4,000 / 2,000   (cache read + cache write; 64,000 prompt tokens)
--   U3  300,000 / 20,000 / 5,000 / 10,000 (325,000 prompt tokens -> long context for OpenAI and Haiku)
-- Rule (a) shows up in the OpenAI / Gemini U2·U3 cells: cache-write price is null there, so the input price of
-- the tier in use applies (luna U2 input = 0.0019; coalesce(...,0) would give 0.0015).
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated');

create temp table t_usage (u text, input_tokens int, cached int, cache_write int, output_tokens int);
insert into t_usage values
  ('U1', 10000, 0, 0, 2000),
  ('U2', 10000, 50000, 4000, 2000),
  ('U3', 300000, 20000, 5000, 10000);

-- version, provider, model, usage, expected input / output / estimated (golden table)
create temp table t_gold (version text, provider text, model text, u text,
                          input_cost numeric, output_cost numeric, est numeric);
insert into t_gold values
  ('v2026-10-28', 'openai', 'gpt-6-luna', 'U1', 0.001, 0.001, 0.002),
  ('v2026-10-28', 'openai', 'gpt-6-luna', 'U2', 0.0019, 0.001, 0.0029),
  ('v2026-10-28', 'openai', 'gpt-6-luna', 'U3', 0.0614, 0.0075, 0.0689),
  ('v2026-10-28', 'openai', 'gpt-6.1-terra', 'U1', 0.01, 0.01, 0.02),
  ('v2026-10-28', 'openai', 'gpt-6.1-terra', 'U2', 0.0165, 0.01, 0.0265),
  ('v2026-10-28', 'openai', 'gpt-6.1-terra', 'U3', 0.612, 0.075, 0.687),
  ('v2026-10-28', 'openai', 'gpt-6.1-sol', 'U1', 0.02, 0.02, 0.04),
  ('v2026-10-28', 'openai', 'gpt-6.1-sol', 'U2', 0.033, 0.02, 0.053),
  ('v2026-10-28', 'openai', 'gpt-6.1-sol', 'U3', 1.224, 0.15, 1.374),
  ('v2026-10-28', 'gemini', 'gemini-3.5-flash-lite', 'U1', 0.003, 0.005, 0.008),
  ('v2026-10-28', 'gemini', 'gemini-3.5-flash-lite', 'U2', 0.0057, 0.005, 0.0107),
  ('v2026-10-28', 'gemini', 'gemini-3.5-flash-lite', 'U3', 0.0921, 0.025, 0.1171),
  ('v2026-10-28', 'gemini', 'gemini-3.8-flash', 'U1', 0.0075, 0.0075, 0.015),
  ('v2026-10-28', 'gemini', 'gemini-3.8-flash', 'U2', 0.01425, 0.0075, 0.02175),
  ('v2026-10-28', 'gemini', 'gemini-3.8-flash', 'U3', 0.23025, 0.0375, 0.26775),
  ('v2026-10-28', 'gemini', 'gemini-4-argon', 'U1', 0.02, 0.02, 0.04),
  ('v2026-10-28', 'gemini', 'gemini-4-argon', 'U2', 0.033, 0.02, 0.053),
  ('v2026-10-28', 'gemini', 'gemini-4-argon', 'U3', 0.612, 0.1, 0.712),
  ('v2026-10-28', 'anthropic', 'claude-haiku-5-5', 'U1', 0.001, 0.001, 0.002),
  ('v2026-10-28', 'anthropic', 'claude-haiku-5-5', 'U2', 0.002, 0.001, 0.003),
  ('v2026-10-28', 'anthropic', 'claude-haiku-5-5', 'U3', 0.154125, 0.025, 0.179125),
  ('v2026-10-28', 'anthropic', 'claude-sonnet-5-5', 'U1', 0.02, 0.02, 0.04),
  ('v2026-10-28', 'anthropic', 'claude-sonnet-5-5', 'U2', 0.035, 0.02, 0.055),
  ('v2026-10-28', 'anthropic', 'claude-sonnet-5-5', 'U3', 0.6145, 0.1, 0.7145),
  ('v2026-10-28', 'anthropic', 'claude-opus-5-5', 'U1', 0.04, 0.04, 0.08),
  ('v2026-10-28', 'anthropic', 'claude-opus-5-5', 'U2', 0.07, 0.04, 0.11),
  ('v2026-10-28', 'anthropic', 'claude-opus-5-5', 'U3', 1.229, 0.2, 1.429),
  ('v2026-12-01', 'gemini', 'gemini-4-argon', 'U1', 0.04, 0.04, 0.08),
  ('v2026-12-01', 'gemini', 'gemini-4-argon', 'U2', 0.066, 0.04, 0.106),
  ('v2026-12-01', 'gemini', 'gemini-4-argon', 'U3', 1.224, 0.2, 1.424),
  ('v2027-01-01', 'gemini', 'gemini-3.8-flash', 'U1', 0.015, 0.015, 0.03),
  ('v2027-01-01', 'gemini', 'gemini-3.8-flash', 'U2', 0.0285, 0.015, 0.0435),
  ('v2027-01-01', 'gemini', 'gemini-3.8-flash', 'U3', 0.4605, 0.075, 0.5355);

select is((select count(*)::int from t_gold), 33, 'golden table: 11 price rows × 3 usage combinations');
select is_empty($$select g.version, g.provider, g.model from t_gold g
                   where not exists (select 1 from public.ai_price_tables t
                                      where t.version = g.version and t.provider = g.provider
                                        and t.model = g.model)$$,
                'every golden row names a seeded price row');
select ok((select bool_and(abs(input_cost + output_cost - est) < 0.0000005) from t_gold),
          'golden table itself is consistent (input + output = estimated)');

-- ① the formula function against the golden table
select is_empty($$select g.version || ' ' || g.model || ' ' || g.u
                     || ' got ' || c.input_cost_usd || '/' || c.output_cost_usd
                     || ' want ' || g.input_cost || '/' || g.output_cost
                    from t_gold g
                    join t_usage u on u.u = g.u
                    cross join lateral private.usage_split_cost(g.version, g.provider, g.model,
                      u.input_tokens, u.cached, u.cache_write, u.output_tokens) c
                   where c.input_cost_usd <> g.input_cost or c.output_cost_usd <> g.output_cost$$,
                'private.usage_split_cost matches cost.ts for all 33 golden cases');

-- ② the real backfill UPDATE over stored rows, same 33 cases
insert into public.ai_usage_records (user_id, occurred_at, feature, job_type, provider, model, model_tier,
  connection_tier, input_tokens, cached_input_tokens, cache_write_tokens, output_tokens, usage_source, outcome,
  price_table_version, estimated_cost_usd)
select 'a0000000-0000-0000-0000-000000000001', '2026-10-05 01:00+09', 'insight', 'insight',
       g.provider, g.model, 'default', 'paid',
       u.input_tokens, u.cached, u.cache_write, u.output_tokens, 'provider_reported', 'succeeded',
       g.version, g.est
  from t_gold g join t_usage u on u.u = g.u;
-- plus the two "no price" shapes and one row whose stored total disagrees
insert into public.ai_usage_records (id, user_id, occurred_at, feature, job_type, provider, model, model_tier,
  connection_tier, input_tokens, cached_input_tokens, cache_write_tokens, output_tokens, usage_source, outcome,
  price_table_version, estimated_cost_usd) values
  ('c0000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-000000000001', '2026-10-05 01:00+09',
   'insight', 'insight', 'openai', 'some-unmapped-model', 'default', 'paid', 10000, 0, 0, 2000,
   'provider_reported', 'succeeded', 'unpriced', 0),
  ('c0000000-0000-0000-0000-0000000000f2', 'a0000000-0000-0000-0000-000000000001', '2026-10-05 01:00+09',
   'insight', 'insight', 'openai', 'gpt-5-retired', 'default', 'paid', 10000, 0, 0, 2000,
   'provider_reported', 'succeeded', 'v2026-10-28', 0.000900),
  ('c0000000-0000-0000-0000-0000000000f3', 'a0000000-0000-0000-0000-000000000001', '2026-10-05 01:00+09',
   'insight', 'insight', 'gemini', 'gemini-3.8-flash', 'default', 'free', 10000, 0, 0, 2000,
   'provider_reported', 'succeeded', 'v2026-10-28', 0.999000);

-- QA-04 (리더 수정 2026-11-09): 픽스처 사용자로 좁힌다. 전역 count(*)는 다른 사용자의 사용량
-- 행 하나에도 깨진다(공유 로컬 Supabase에서 run-checks.sh가 불안정해지는 원인).
select is((select count(*)::int from public.ai_usage_records
            where input_cost_usd = 0 and output_cost_usd = 0
              and user_id = 'a0000000-0000-0000-0000-000000000001'), 36,
          'fixture: all 36 rows start at 0 / 0 (the column defaults)');

create temp table t_b as select private.backfill_usage_split_costs() as r;
select is((select (r -> 'updated')::int from t_b), 34,
          '34 rows recomputed (the unpriced row and the row without a price row are skipped)');
select is((select (r -> 'mismatch')::int from t_b), 1,
          'one recomputed row disagrees with its stored total (the 0.999 row)');

select is_empty($$select g.version || ' ' || g.model || ' ' || g.u
                    from t_gold g
                    join t_usage u on u.u = g.u
                    join public.ai_usage_records r
                      on r.price_table_version = g.version and r.provider = g.provider and r.model = g.model
                     and r.input_tokens = u.input_tokens and r.cached_input_tokens = u.cached
                     and r.cache_write_tokens = u.cache_write and r.output_tokens = u.output_tokens
                     and r.estimated_cost_usd = g.est
                   where r.input_cost_usd <> g.input_cost or r.output_cost_usd <> g.output_cost$$,
                'the backfilled rows hold the golden split');

-- rule (a) in one explicit assertion: luna U2 input cost is 0.0019, not 0.0015
select is((select input_cost_usd from private.usage_split_cost('v2026-10-28', 'openai', 'gpt-6-luna',
                                                              10000, 50000, 4000, 2000)),
          0.0019::numeric,
          'cache-write price null falls back to the input price (0.0019, not 0.0015 — 규칙 (a))');

-- rule (b): a price row with a threshold but no long-context prices cannot even be stored (CHECK), and the
-- function is defensive on top of that — no path returns null, so the not-null update can never abort.
select throws_ok($$insert into public.ai_price_tables (version, effective_from, provider, model,
                     input_usd_per_mtok, output_usd_per_mtok, long_context_threshold_tokens, source_checked_at)
                   values ('v2026-10-28', '2026-10-28', 'openai', 'synthetic-threshold-only',
                           1.0, 2.0, 100000, '2026-10-28')$$,
                 '23514', null,
                 'a threshold without long-context input / output prices is refused by the CHECK (규칙 (b))');
select is_empty($$select t.version, t.provider, t.model
                    from public.ai_price_tables t
                    cross join lateral private.usage_split_cost(t.version, t.provider, t.model,
                      300000, 20000, 5000, 10000) c
                   where c.input_cost_usd is null or c.output_cost_usd is null$$,
                'no seeded price row can produce a null cost (every rate has a fallback)');

-- the two "no price" shapes and the disagreeing row
select results_eq($$select id, input_cost_usd, output_cost_usd, estimated_cost_usd
                      from public.ai_usage_records
                     where id in ('c0000000-0000-0000-0000-0000000000f1',
                                  'c0000000-0000-0000-0000-0000000000f2',
                                  'c0000000-0000-0000-0000-0000000000f3')
                     order by id$$,
  $$values ('c0000000-0000-0000-0000-0000000000f1'::uuid, 0.000000::numeric(12,6), 0.000000::numeric(12,6),
            0.000000::numeric(12,6)),
           ('c0000000-0000-0000-0000-0000000000f2'::uuid, 0.000000::numeric(12,6), 0.000000::numeric(12,6),
            0.000900::numeric(12,6)),
           ('c0000000-0000-0000-0000-0000000000f3'::uuid, 0.007500::numeric(12,6), 0.007500::numeric(12,6),
            0.999000::numeric(12,6))$$,
  'unpriced stays 0/0; a row without a price row stays 0/0 and keeps its stored total; a disagreeing total is left as recorded');

-- running it again changes nothing (safe to repeat on the remote)
select is((select (private.backfill_usage_split_costs() -> 'updated')::int), 0, 'a second run updates no row');

select * from finish();
rollback;
