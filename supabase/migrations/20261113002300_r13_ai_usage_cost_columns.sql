-- R13 ⑨ ai_usage_records.input_cost_usd / output_cost_usd (DM v4.12 §2.9.2; SD-A10·SD-A11, AI C-13, R-SD-5).
-- The screen shows 입력 비용 / 출력 비용 as two columns and the split cannot be derived at read time
-- (long-context and cache prices are mixed in), so the recording path stores both and estimated_cost_usd
-- stays as their sum. NO CHECK ties the three together: past rows may disagree (see the backfill below).
--
-- Split (AI C-13):
--   input_cost_usd  = input_tokens × 입력 단가 + cached_input_tokens × 캐시 읽기 단가
--                     + cache_write_tokens × 캐시 쓰기 단가   (캐시 쓰기는 입력 쪽)
--   output_cost_usd = output_tokens × 출력 단가  (reasoning_tokens는 output_tokens에 이미 포함, 다시 더하지 않음)
--   장문 구간 판정은 호출 단위(캐시 포함 전체 입력 토큰) → 걸리면 네 단가를 함께 장문 단가로,
--   장문 캐시 단가가 null이면 일반 캐시 단가
--   price_table_version = 'unpriced' (또는 가격표 행 없음) → 두 값 0
--   반올림은 세 값 각각 numeric(12,6)에서, 합을 다시 반올림하지 않는다
--
-- QA-R13-04: 식의 정본은 기록 경로 `src/server/jobs/cost.ts`(`estimateCost`)다 — 같은 가격표 행에서 과거 행과
-- 새 행의 비용이 달라져서는 안 된다. 그 구현과 글자 그대로 맞춘 두 가지:
--   (1) 캐시 읽기·쓰기 단가가 null이면 **그 구간의 입력 단가**로 대체한다(장문이면 장문 입력 단가).
--       0으로 두면 캐시 토큰이 공짜가 되어 과소 추정이 된다(S3a 결정 "never under-estimate").
--       장문 캐시 단가가 null이면 먼저 일반 캐시 단가, 그것도 null이면 입력 단가.
--   (2) 장문 구간은 threshold·장문 입력·장문 출력이 **모두 non-null**이고 전체 입력이 threshold를 넘을 때만.
--       threshold만 보면 장문 단가가 빈 행에서 round(null)이 되어 not null 컬럼 update가 실패한다
--       (= 원격에서 마이그레이션 중단).
--   반올림도 cost.ts와 같은 자리에서 한다: 마이크로 USD 정수로 반올림한 뒤 1e6으로 나눈다
--   (= numeric(12,6)의 6번째 소수 자리).

alter table public.ai_usage_records
  add column input_cost_usd numeric(12, 6) not null default 0,
  add column output_cost_usd numeric(12, 6) not null default 0;

alter table public.ai_usage_records
  add constraint ai_usage_records_split_cost_check
    check (input_cost_usd >= 0 and output_cost_usd >= 0);

-- DM §2.9.2 (v4.12, SD-A10): the provider × feature cross aggregate is now the main read. The two older
-- indexes stay (monthly and per-provider totals still use them).
create index ai_usage_records_user_period_provider_feature_idx
  on public.ai_usage_records (user_id, period_month, provider, feature);

-- The recording path (app_ai_writer insert) writes both columns.
grant insert (input_cost_usd, output_cost_usd) on table public.ai_usage_records to app_ai_writer;

-- ── Backfill (확정 2026-11-05 (사용자), D-DM-15 닫힘) ──
-- Recompute from the price table row the record itself names (price_table_version + provider + model) and the
-- stored token counts. If the computed sum disagrees with the stored estimated_cost_usd, estimated_cost_usd is
-- NOT touched — the stored total was right for its moment. The version strings are already v{YYYY-MM-DD}
-- (R-SD-22, #8 ⓞ): checked, not changed.
--
-- The formula and the backfill are functions, not inline SQL, so pgTAP can pin them against cost.ts
-- (QA-R13-04: the local ai_usage_records table is empty, so this code first runs for real on the remote).
-- Re-running the backfill is harmless (it recomputes the same values from the same stored inputs).

-- One row's split, exactly as src/server/jobs/cost.ts estimateCost() computes it.
-- Returns (0, 0) for 'unpriced' and for a (version, provider, model) that has no price row.
create or replace function private.usage_split_cost(
  p_price_table_version text,
  p_provider text,
  p_model text,
  p_input_tokens integer,
  p_cached_input_tokens integer,
  p_cache_write_tokens integer,
  p_output_tokens integer,
  out input_cost_usd numeric,
  out output_cost_usd numeric
)
language plpgsql
stable
set search_path = ''
as $$
declare
  t public.ai_price_tables;
  v_prompt bigint := coalesce(p_input_tokens, 0) + coalesce(p_cached_input_tokens, 0)
                     + coalesce(p_cache_write_tokens, 0);
  v_long boolean;
  v_input numeric;
  v_output numeric;
  v_cached numeric;
  v_cache_write numeric;
begin
  input_cost_usd := 0;
  output_cost_usd := 0;
  if p_price_table_version is null or p_price_table_version = 'unpriced' then
    return;
  end if;

  select * into t
    from public.ai_price_tables
   where version = p_price_table_version and provider = p_provider and model = p_model
   limit 1;
  if not found then
    return;
  end if;

  -- (2) long context: all three must be present, and the whole prompt must exceed the threshold.
  v_long := t.long_context_threshold_tokens is not null
            and t.long_context_input_usd_per_mtok is not null
            and t.long_context_output_usd_per_mtok is not null
            and v_prompt > t.long_context_threshold_tokens;

  v_input := case when v_long then t.long_context_input_usd_per_mtok else t.input_usd_per_mtok end;
  v_output := case when v_long then t.long_context_output_usd_per_mtok else t.output_usd_per_mtok end;
  -- (1) a missing cache price falls back to the input price of the tier in use.
  v_cached := coalesce(
    case when v_long then coalesce(t.long_context_cached_input_usd_per_mtok, t.cached_input_usd_per_mtok)
         else t.cached_input_usd_per_mtok end,
    v_input);
  v_cache_write := coalesce(
    case when v_long then coalesce(t.long_context_cache_write_usd_per_mtok, t.cache_write_usd_per_mtok)
         else t.cache_write_usd_per_mtok end,
    v_input);

  -- Rounded as integer micro-USD, then scaled — the same place cost.ts rounds.
  input_cost_usd := coalesce(round(coalesce(p_input_tokens, 0) * v_input
                                   + coalesce(p_cached_input_tokens, 0) * v_cached
                                   + coalesce(p_cache_write_tokens, 0) * v_cache_write), 0) / 1000000;
  -- reasoning_tokens ⊂ output_tokens (AI C-13): counted once, here.
  output_cost_usd := coalesce(round(coalesce(p_output_tokens, 0) * v_output), 0) / 1000000;
end;
$$;

revoke all on function private.usage_split_cost(text, text, text, integer, integer, integer, integer)
  from public, anon, authenticated, app_ai_writer;

-- The backfill itself. Returns {updated, mismatch, zero} for the log and for pgTAP.
create or replace function private.backfill_usage_split_costs()
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_updated bigint;
  v_mismatch bigint;
  v_zero bigint;
begin
  with computed as (
    select r.id, r.estimated_cost_usd, c.input_cost_usd, c.output_cost_usd
      from public.ai_usage_records r
      cross join lateral private.usage_split_cost(
        r.price_table_version, r.provider, r.model,
        r.input_tokens, r.cached_input_tokens, r.cache_write_tokens, r.output_tokens) c
  ), applied as (
    update public.ai_usage_records r
       set input_cost_usd = c.input_cost_usd,
           output_cost_usd = c.output_cost_usd
      from computed c
     where r.id = c.id
       and (r.input_cost_usd, r.output_cost_usd) is distinct from (c.input_cost_usd, c.output_cost_usd)
    returning r.id, c.input_cost_usd + c.output_cost_usd <> c.estimated_cost_usd as mismatch
  )
  select count(*), count(*) filter (where mismatch) into v_updated, v_mismatch from applied;

  -- unpriced rows (and rows whose price table row is gone) keep both values at 0.
  select count(*) into v_zero
    from public.ai_usage_records r
   where r.input_cost_usd = 0 and r.output_cost_usd = 0;

  return jsonb_build_object('updated', v_updated, 'mismatch', v_mismatch, 'zero', v_zero);
end;
$$;

revoke all on function private.backfill_usage_split_costs()
  from public, anon, authenticated, app_ai_writer;

do $$
declare
  v_result jsonb := private.backfill_usage_split_costs();
begin
  raise notice 'R13 ai_usage cost backfill: % row(s) recomputed (% with a sum differing from estimated_cost_usd, left as recorded), % row(s) at 0 (unpriced or no price row)',
    v_result ->> 'updated', v_result ->> 'mismatch', v_result ->> 'zero';
end;
$$;
