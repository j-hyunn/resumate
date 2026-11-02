-- S3a: ai_price_tables (DM §2.9.3, A.16; AI C-13). Reference table, no user_id.
-- Rows are never edited: a price change is a new version (past records keep their basis).
-- Writes only through migrations (operator). authenticated / app_ai_writer read all rows.
-- [가정, spec-gaps 2026-10-28] + long_context_cached_input_usd_per_mtok / long_context_cache_write_usd_per_mtok:
-- the providers' long-context tiers also change cache-read (OpenAI, Claude Haiku) and cache-write
-- (Claude Haiku) prices (S3a/00_model-mapping.md §2); DM lists only the long-context input / output.

create table public.ai_price_tables (
  id uuid primary key default gen_random_uuid(),
  version text not null,
  effective_from date not null,
  provider text not null,
  model text not null,
  input_usd_per_mtok numeric(10, 4) not null,
  cached_input_usd_per_mtok numeric(10, 4),
  cache_write_usd_per_mtok numeric(10, 4),
  output_usd_per_mtok numeric(10, 4) not null,
  long_context_threshold_tokens integer,
  long_context_input_usd_per_mtok numeric(10, 4),
  long_context_cached_input_usd_per_mtok numeric(10, 4),
  long_context_cache_write_usd_per_mtok numeric(10, 4),
  long_context_output_usd_per_mtok numeric(10, 4),
  source_checked_at date not null,
  created_at timestamptz not null default now(),
  constraint ai_price_tables_version_provider_model_key unique (version, provider, model),
  constraint ai_price_tables_provider_check check (provider in ('openai', 'gemini', 'anthropic')),
  constraint ai_price_tables_prices_check check (
    input_usd_per_mtok >= 0 and output_usd_per_mtok >= 0
    and coalesce(cached_input_usd_per_mtok, 0) >= 0 and coalesce(cache_write_usd_per_mtok, 0) >= 0
    and coalesce(long_context_input_usd_per_mtok, 0) >= 0
    and coalesce(long_context_cached_input_usd_per_mtok, 0) >= 0
    and coalesce(long_context_cache_write_usd_per_mtok, 0) >= 0
    and coalesce(long_context_output_usd_per_mtok, 0) >= 0),
  -- A long-context tier is all-or-nothing for its threshold / input / output prices.
  constraint ai_price_tables_long_context_check check (
    (long_context_threshold_tokens is null
       and long_context_input_usd_per_mtok is null and long_context_output_usd_per_mtok is null
       and long_context_cached_input_usd_per_mtok is null and long_context_cache_write_usd_per_mtok is null)
    or (long_context_threshold_tokens > 0
       and long_context_input_usd_per_mtok is not null and long_context_output_usd_per_mtok is not null))
);

create index ai_price_tables_lookup_idx on public.ai_price_tables (provider, model, effective_from desc);

alter table public.ai_price_tables enable row level security;

create policy ai_price_tables_select_all on public.ai_price_tables
  for select to authenticated, app_ai_writer using (true);

grant select on table public.ai_price_tables to authenticated, app_ai_writer;

-- Seed: S3a/00_model-mapping.md §2 (user-confirmed, researched 2026-10-28). USD per 1M tokens.
-- Every version carries the full 9-model set in effect from its effective_from:
--   v2026-10-28  the §2 table
--   v2026-12-01  gemini-4-argon      input 4.00 / cache read 0.20 / output 20.00
--   v2027-01-01  gemini-3.8-flash    input 1.50 / cache read 0.15 / output 7.50 (argon stays at 12-01 prices)
-- Cache write = Claude 5-minute cache. Long context: OpenAI > 272K, Claude Haiku > 100K prompt tokens.
with base (provider, model, input, cached, cache_write, output,
           lc_threshold, lc_input, lc_cached, lc_cache_write, lc_output) as (
  values
    ('openai',    'gpt-6-luna',            0.10, 0.01,  null::numeric, 0.50, 272000, 0.20, 0.02, null::numeric, 0.75),
    ('openai',    'gpt-6.1-terra',         1.00, 0.05,  null,          5.00, 272000, 2.00, 0.10, null,          7.50),
    ('openai',    'gpt-6.1-sol',           2.00, 0.10,  null,         10.00, 272000, 4.00, 0.20, null,         15.00),
    ('gemini',    'gemini-3.5-flash-lite', 0.30, 0.03,  null,          2.50, null,   null, null, null,          null),
    ('gemini',    'gemini-3.8-flash',      0.75, 0.075, null,          3.75, null,   null, null, null,          null),
    ('gemini',    'gemini-4-argon',        2.00, 0.10,  null,         10.00, null,   null, null, null,          null),
    ('anthropic', 'claude-haiku-5-5',      0.10, 0.01,  0.125,         0.50, 100000, 0.50, 0.05, 0.625,         2.50),
    ('anthropic', 'claude-sonnet-5-5',     2.00, 0.10,  2.50,         10.00, null,   null, null, null,          null),
    ('anthropic', 'claude-opus-5-5',       4.00, 0.20,  5.00,         20.00, null,   null, null, null,          null)
), versions (version, effective_from) as (
  values ('v2026-10-28', date '2026-10-28'), ('v2026-12-01', date '2026-12-01'), ('v2027-01-01', date '2027-01-01')
), priced as (
  select v.version, v.effective_from, b.*,
         -- scheduled changes
         case
           when b.model = 'gemini-4-argon' and v.effective_from >= date '2026-12-01' then 4.00
           when b.model = 'gemini-3.8-flash' and v.effective_from >= date '2027-01-01' then 1.50
           else b.input
         end as v_input,
         case
           when b.model = 'gemini-4-argon' and v.effective_from >= date '2026-12-01' then 0.20
           when b.model = 'gemini-3.8-flash' and v.effective_from >= date '2027-01-01' then 0.15
           else b.cached
         end as v_cached,
         case
           when b.model = 'gemini-4-argon' and v.effective_from >= date '2026-12-01' then 20.00
           when b.model = 'gemini-3.8-flash' and v.effective_from >= date '2027-01-01' then 7.50
           else b.output
         end as v_output
    from versions v cross join base b
)
insert into public.ai_price_tables (
  version, effective_from, provider, model,
  input_usd_per_mtok, cached_input_usd_per_mtok, cache_write_usd_per_mtok, output_usd_per_mtok,
  long_context_threshold_tokens, long_context_input_usd_per_mtok, long_context_cached_input_usd_per_mtok,
  long_context_cache_write_usd_per_mtok, long_context_output_usd_per_mtok, source_checked_at)
select version, effective_from, provider, model,
       v_input, v_cached, cache_write, v_output,
       lc_threshold, lc_input, lc_cached, lc_cache_write, lc_output, date '2026-10-28'
  from priced;

-- Price row in effect for (provider, model) on p_at (KST date by default): the latest version with
-- effective_from <= p_at that has the model. Null when there is none. SQL helper (private is not
-- exposed through PostgREST; the app reads ai_price_tables with the equivalent query).
create or replace function private.price_for(p_provider text, p_model text,
                                             p_at date default (now() at time zone 'Asia/Seoul')::date)
returns public.ai_price_tables
language sql
stable
set search_path = ''
as $$
  select t.*
    from public.ai_price_tables t
   where t.provider = p_provider and t.model = p_model and t.effective_from <= p_at
   order by t.effective_from desc, t.version desc
   limit 1;
$$;

revoke all on function private.price_for(text, text, date) from public;
grant execute on function private.price_for(text, text, date) to authenticated, app_ai_writer, service_role;
