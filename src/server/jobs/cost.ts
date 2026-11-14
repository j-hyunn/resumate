import type { AiJobType, UsageFeature } from "@/lib/contracts/enums";
import type { NormalizedUsage, PriceRow } from "./types";

/**
 * tokens × USD/1M = USD × 1e-6, so rounding the micro-USD sum to an integer IS
 * the 6th decimal of the stored numeric(12,6). The two sides are rounded as
 * integer micros and the total is their integer sum — never a float sum of two
 * already-rounded decimals, which could land on 0.055000000000000004.
 */
function micros(usd: number): number {
  return Math.round(usd);
}

/**
 * C-13 예상 비용 (USD), **입력 쪽·출력 쪽으로 나눠** 계산한다 (v4.12, SD-A11 / R-SD-5 —
 * DM 2.9.2 `input_cost_usd` · `output_cost_usd` · `estimated_cost_usd`):
 *
 *   input_cost_usd  = input_tokens × 입력 + cached_input_tokens × 캐시 읽기
 *                     + cache_write_tokens × 캐시 쓰기   (캐시 쓰기는 입력 쪽)
 *   output_cost_usd = output_tokens × 출력                (reasoning_tokens는 이미 포함 — 다시 더하지 않는다)
 *   estimated_cost_usd = 두 값의 합
 *
 * 반올림은 **세 값 모두 저장 자리수 numeric(12,6)에서** 하고, 두 값을 더한 뒤 다시
 * 반올림하지 않는다 — 그래야 화면의 두 열과 합계 열이 어긋나지 않는다.
 *
 * 장문 구간 판정은 **호출 단위**(캐시 포함 전체 입력 토큰)이고, 걸리면 네 단가를
 * **함께** 장문 단가로 바꾼다 (입력만 또는 출력만 바꾸는 경우는 없다).
 *
 * **이 식이 정본이다 (리더 판정, QA-R13-04)**: `ai_usage_records` 과거 행 백필 SQL
 * (`20261113002300_r13_ai_usage_cost_columns.sql`)이 이 식을 그대로 베껴 간다 — 같은 가격표 행에서
 * 과거 행과 새 행의 비용이 달라지면 안 된다. 기대값 골든 표는
 * `cost-backfill-parity.test.ts`(= `_workspace/backend/R13/02_api_notes.md` §3)에 있고 pgTAP가
 * 같은 표를 쓸 수 있다. 아래 두 규칙을 바꾸면 **백필 SQL과 그 표도 함께** 바꿔야 한다.
 *
 * Decisions [가정, S3a notes]:
 * - "입력" for the threshold = the whole prompt (uncached + cache read + cache write),
 *   which is how OpenAI and Claude define their long-context tiers.
 * - **규칙 (a) 단가 null 대체**: 장문 캐시 읽기 / 캐시 쓰기 단가가 null이면 **일반 캐시 단가**로,
 *   캐시 단가 자체가 null이면 **그 구간(일반 또는 장문)의 입력 단가**로 내려간다. **0으로 취급하지
 *   않는다** — 공짜가 아닌 토큰을 공짜로 적지 않는다(과소 추정 금지, S3a 결정).
 * - **규칙 (b) 장문 판정**: `long_context_threshold_tokens`가 있고 **장문 입력·출력 단가가 둘 다
 *   non-null**일 때만 장문 구간이다. threshold만 보고 장문 단가가 null인 행을 장문으로 처리하면
 *   null(SQL에서는 not null 컬럼 update 실패)이 나온다. 걸리면 네 단가를 함께 바꾸고, 입력만 또는
 *   출력만 장문이 되는 경로는 없다.
 */
export type CostBreakdown = {
  /** DM 2.9.2 `input_cost_usd` (화면 "입력 비용" 열). */
  inputCostUsd: number;
  /** DM 2.9.2 `output_cost_usd` (화면 "출력 비용" 열). */
  outputCostUsd: number;
  /** DM 2.9.2 `estimated_cost_usd` = inputCostUsd + outputCostUsd. */
  estimatedCostUsd: number;
};

/** 가격표에 없는 모델: 세 값 모두 0 (`price_table_version = 'unpriced'`, AI C-13). */
export const UNPRICED_COST: CostBreakdown = { inputCostUsd: 0, outputCostUsd: 0, estimatedCostUsd: 0 };

export function estimateCost(usage: NormalizedUsage, price: PriceRow): CostBreakdown {
  const prompt = usage.inputTokens + usage.cachedInputTokens + usage.cacheWriteTokens;
  const long =
    price.longContextThresholdTokens !== null &&
    price.longContextInputUsdPerMtok !== null &&
    price.longContextOutputUsdPerMtok !== null &&
    prompt > price.longContextThresholdTokens;

  const input = long ? price.longContextInputUsdPerMtok! : price.inputUsdPerMtok;
  const output = long ? price.longContextOutputUsdPerMtok! : price.outputUsdPerMtok;
  const cached = (long ? (price.longContextCachedInputUsdPerMtok ?? price.cachedInputUsdPerMtok) : price.cachedInputUsdPerMtok) ?? input;
  const cacheWrite = (long ? (price.longContextCacheWriteUsdPerMtok ?? price.cacheWriteUsdPerMtok) : price.cacheWriteUsdPerMtok) ?? input;

  const inputMicros = micros(usage.inputTokens * input + usage.cachedInputTokens * cached + usage.cacheWriteTokens * cacheWrite);
  // reasoning_tokens ⊂ output_tokens (AI C-13): counted once, here.
  const outputMicros = micros(usage.outputTokens * output);
  return {
    inputCostUsd: inputMicros / 1_000_000,
    outputCostUsd: outputMicros / 1_000_000,
    estimatedCostUsd: (inputMicros + outputMicros) / 1_000_000,
  };
}

/** Sum only (kept for callers that need the single number). */
export function estimateCostUsd(usage: NormalizedUsage, price: PriceRow): number {
  return estimateCost(usage, price).estimatedCostUsd;
}

/**
 * ai_usage_records.feature by job type (C-13, DM §2.9.2): AI-11 기본 선택 is
 * counted under career_description, AI-12 turns under writing_chat.
 * R17: `jd_extraction` no longer runs, so nothing records the legacy `jd_extraction` feature.
 */
export const USAGE_FEATURE_BY_JOB_TYPE: Record<AiJobType, UsageFeature> = {
  insight: "insight",
  career_description: "career_description",
  draft_source_ranking: "career_description",
  cover_letter: "cover_letter",
  writing_assist: "writing_assist",
  chat_reply: "chat_reply",
  writing_chat_turn: "writing_chat",
  key_verification: "key_verification",
};

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** KST calendar date `YYYY-MM-DD` (price table effective_from is a date; the service runs on KST). */
export function kstDate(now: Date): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** KST month start `YYYY-MM-01` (same rule as ai_usage_records.period_month). */
export function kstPeriodMonth(now: Date): string {
  return `${kstDate(now).slice(0, 7)}-01`;
}
