import type { AiJobType, UsageFeature } from "@/lib/contracts/enums";
import type { NormalizedUsage, PriceRow } from "./types";

/**
 * C-13 예상 비용 (USD):
 *   input_tokens × 입력 + cached_input_tokens × 캐시 읽기 + cache_write_tokens × 캐시 쓰기 + output_tokens × 출력
 * per 1M tokens, with the long-context prices when the prompt exceeds
 * `long_context_threshold_tokens`. Free-tier calls get the paid-equivalent
 * value too (F-AI-07 (5)).
 *
 * Decisions [가정, S3a notes]:
 * - "입력" for the threshold = the whole prompt (uncached + cache read + cache write),
 *   which is how OpenAI and Claude define their long-context tiers.
 * - A missing long-context cache-read / cache-write price falls back to the
 *   normal cache price (db notes: those two columns are a [가정] extension);
 *   a missing cache price altogether falls back to the input price of the
 *   tier in use (never under-estimate).
 * - Rounded to 6 decimals (numeric(12,6)).
 */
export function estimateCostUsd(usage: NormalizedUsage, price: PriceRow): number {
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

  const micros =
    usage.inputTokens * input +
    usage.cachedInputTokens * cached +
    usage.cacheWriteTokens * cacheWrite +
    usage.outputTokens * output;
  // tokens × USD/1M = USD × 1e-6; round to 6 decimals.
  return Math.round(micros) / 1_000_000;
}

/**
 * ai_usage_records.feature by job type (C-13, DM §2.9.2): AI-11 기본 선택 is
 * counted under career_description, AI-12 turns under writing_chat.
 */
export const USAGE_FEATURE_BY_JOB_TYPE: Record<AiJobType, UsageFeature> = {
  jd_extraction: "jd_extraction",
  insight: "insight",
  career_description: "career_description",
  draft_source_ranking: "career_description",
  cover_letter: "cover_letter",
  interview_questions: "interview_questions",
  interview_evaluation: "interview_evaluation",
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
