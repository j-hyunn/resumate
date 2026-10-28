-- S3a ai_price_tables (DM §2.9.3, AI C-13): read-only reference, seed = S3a/00_model-mapping.md §2,
-- private.price_for version lookup.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer, service_role;
select no_plan();

select ok((select relrowsecurity from pg_class where oid = 'public.ai_price_tables'::regclass), 'RLS enabled');
select policies_are('public', 'ai_price_tables', array['ai_price_tables_select_all']);
select hasnt_column('public', 'ai_price_tables', 'user_id', 'not user data');

-- Seed: 3 versions x 9 models.
select results_eq($$select version, effective_from, count(*)::int from public.ai_price_tables group by 1, 2 order by 1$$,
                  $$values ('v2026-10-28', date '2026-10-28', 9), ('v2026-12-01', date '2026-12-01', 9),
                           ('v2027-01-01', date '2027-01-01', 9)$$, '3 versions of 9 models each');
select set_eq($$select distinct provider || '/' || model from public.ai_price_tables$$,
              array['openai/gpt-6-luna', 'openai/gpt-6.1-terra', 'openai/gpt-6.1-sol',
                    'gemini/gemini-3.5-flash-lite', 'gemini/gemini-3.8-flash', 'gemini/gemini-4-argon',
                    'anthropic/claude-haiku-5-5', 'anthropic/claude-sonnet-5-5', 'anthropic/claude-opus-5-5'],
              'model set = C-10.1 mapping');
select set_eq(
  $$select model, input_usd_per_mtok, cached_input_usd_per_mtok, cache_write_usd_per_mtok, output_usd_per_mtok,
           long_context_threshold_tokens, long_context_input_usd_per_mtok, long_context_cached_input_usd_per_mtok,
           long_context_cache_write_usd_per_mtok, long_context_output_usd_per_mtok
      from public.ai_price_tables where version = 'v2026-10-28'$$,
  $$values ('gpt-6-luna', 0.10, 0.01, null::numeric, 0.50, 272000, 0.20, 0.02, null::numeric, 0.75),
           ('gpt-6.1-terra', 1.00, 0.05, null, 5.00, 272000, 2.00, 0.10, null, 7.50),
           ('gpt-6.1-sol', 2.00, 0.10, null, 10.00, 272000, 4.00, 0.20, null, 15.00),
           ('gemini-3.5-flash-lite', 0.30, 0.03, null, 2.50, null, null, null, null, null),
           ('gemini-3.8-flash', 0.75, 0.075, null, 3.75, null, null, null, null, null),
           ('gemini-4-argon', 2.00, 0.10, null, 10.00, null, null, null, null, null),
           ('claude-haiku-5-5', 0.10, 0.01, 0.125, 0.50, 100000, 0.50, 0.05, 0.625, 2.50),
           ('claude-sonnet-5-5', 2.00, 0.10, 2.50, 10.00, null, null, null, null, null),
           ('claude-opus-5-5', 4.00, 0.20, 5.00, 20.00, null, null, null, null, null)$$,
  'v2026-10-28 prices = mapping §2');
select results_eq($$select version, input_usd_per_mtok, cached_input_usd_per_mtok, output_usd_per_mtok
                      from public.ai_price_tables where model = 'gemini-4-argon' order by version$$,
                  $$values ('v2026-10-28', 2.00::numeric, 0.10::numeric, 10.00::numeric),
                           ('v2026-12-01', 4.00, 0.20, 20.00), ('v2027-01-01', 4.00, 0.20, 20.00)$$,
                  'gemini-4-argon price change from 2026-12-01');
select results_eq($$select version, input_usd_per_mtok, cached_input_usd_per_mtok, output_usd_per_mtok
                      from public.ai_price_tables where model = 'gemini-3.8-flash' order by version$$,
                  $$values ('v2026-10-28', 0.75::numeric, 0.075::numeric, 3.75::numeric),
                           ('v2026-12-01', 0.75, 0.075, 3.75), ('v2027-01-01', 1.50, 0.15, 7.50)$$,
                  'gemini-3.8-flash price change from 2027-01-01');
select is((select count(*)::int from public.ai_price_tables a join public.ai_price_tables b
             on a.provider = b.provider and a.model = b.model and a.version = 'v2026-10-28' and b.version <> a.version
            where a.model not in ('gemini-4-argon', 'gemini-3.8-flash')
              and (a.input_usd_per_mtok, a.cached_input_usd_per_mtok, a.cache_write_usd_per_mtok, a.output_usd_per_mtok)
                  is distinct from (b.input_usd_per_mtok, b.cached_input_usd_per_mtok, b.cache_write_usd_per_mtok,
                                    b.output_usd_per_mtok)), 0,
          'other models keep their prices across versions');
select is((select count(distinct source_checked_at)::int from public.ai_price_tables), 1, 'one source_checked_at');

-- CHECKs / uniqueness.
select throws_ok($$insert into public.ai_price_tables (version, effective_from, provider, model, input_usd_per_mtok,
                     output_usd_per_mtok, source_checked_at)
                   values ('v2026-10-28', '2026-10-28', 'openai', 'gpt-6-luna', 1, 1, '2026-10-28')$$,
                 '23505', null, 'unique (version, provider, model)');
select throws_ok($$insert into public.ai_price_tables (version, effective_from, provider, model, input_usd_per_mtok,
                     output_usd_per_mtok, source_checked_at, long_context_threshold_tokens)
                   values ('vX', '2026-10-28', 'openai', 'x', 1, 1, '2026-10-28', 1000)$$,
                 '23514', null, 'long-context tier needs its prices');
select throws_ok($$insert into public.ai_price_tables (version, effective_from, provider, model, input_usd_per_mtok,
                     output_usd_per_mtok, source_checked_at)
                   values ('vX', '2026-10-28', 'mistral', 'x', 1, 1, '2026-10-28')$$,
                 '23514', null, 'provider CHECK');

-- private.price_for
select is((private.price_for('gemini', 'gemini-4-argon', '2026-11-30')).version, 'v2026-10-28', 'before 12-01 -> v2026-10-28');
select is((private.price_for('gemini', 'gemini-4-argon', '2026-12-01')).version, 'v2026-12-01', 'on 12-01 -> v2026-12-01');
select is((private.price_for('gemini', 'gemini-4-argon', '2026-12-01')).input_usd_per_mtok, 4.0000::numeric, 'new price');
select is((private.price_for('gemini', 'gemini-3.8-flash', '2027-03-01')).version, 'v2027-01-01', 'latest version');
select is((private.price_for('gemini', 'gemini-3.8-flash', '2026-10-27')).version, null, 'before the first version -> null');
select is((private.price_for('openai', 'gpt-4o', '2026-11-01')).version, null, 'unknown model -> null');
select is((private.price_for('anthropic', 'claude-haiku-5-5')).version is not null, true, 'default p_at = KST today');

-- Privileges: authenticated / app_ai_writer read; nobody but migrations writes.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.ai_price_tables), 27, 'authenticated reads all rows');
select is((private.price_for('openai', 'gpt-6-luna', '2026-11-01')).version, 'v2026-10-28', 'authenticated can call price_for');
select throws_ok($$insert into public.ai_price_tables (version, effective_from, provider, model, input_usd_per_mtok,
                     output_usd_per_mtok, source_checked_at) values ('vX', '2026-10-28', 'openai', 'x', 1, 1, '2026-10-28')$$,
                 '42501', null, 'authenticated cannot insert');
select throws_ok($$update public.ai_price_tables set input_usd_per_mtok = 0$$, '42501', null, 'authenticated cannot update');
select throws_ok($$delete from public.ai_price_tables$$, '42501', null, 'authenticated cannot delete');
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is((select count(*)::int from public.ai_price_tables), 27, 'app_ai_writer reads all rows');
select is((private.price_for('openai', 'gpt-6-luna', '2026-11-01')).version, 'v2026-10-28', 'app_ai_writer can call price_for');
select throws_ok($$update public.ai_price_tables set input_usd_per_mtok = 0$$, '42501', null, 'app_ai_writer cannot update');
reset role;
set local role anon;
select throws_ok($$select * from public.ai_price_tables$$, '42501', null, 'anon cannot read');
reset role;

select * from finish();
rollback;
