import { describe, expect, it } from "vitest";
import { estimateCost, UNPRICED_COST } from "./cost";
import type { NormalizedUsage, PriceRow } from "./types";

/**
 * R13 / QA-R13-04 — 비용 분할 식의 **골든 표**.
 *
 * `cost.ts`가 정본이고 `ai_usage_records` 과거 행 백필 SQL
 * (`supabase/migrations/20261113002300_r13_ai_usage_cost_columns.sql`)이 같은 값을 내야 한다.
 * 로컬에는 사용 기록이 0행이라 백필이 **원격에서 처음 돈다** — 그래서 기대값을 여기에 박아 두고
 * 같은 표를 pgTAP에서도 쓸 수 있게 한다(표는 `_workspace/backend/R13/02_api_notes.md` §3에도 있다).
 *
 * 두 규칙이 갈라지기 쉬운 지점(QA-R13-04):
 *  (a) 캐시 읽기 / 캐시 쓰기 단가가 null → **그 구간의 입력 단가**로 대체한다(0이 아니다, S3a "과소 추정 금지").
 *  (b) 장문 구간 → threshold가 있고 **장문 입력·출력 단가가 둘 다 non-null**일 때만 적용한다
 *      (threshold만 보고 장문 단가가 null이면 null 비용이 나온다).
 */

const u = (inputTokens: number, cachedInputTokens: number, cacheWriteTokens: number, outputTokens: number): NormalizedUsage => ({
  inputTokens,
  cachedInputTokens,
  cacheWriteTokens,
  outputTokens,
  reasoningTokens: null,
  usageSource: "provider_reported",
});

/** 대표 usage 3조합. */
const USAGES = {
  // 캐시 없음
  U1: u(10_000, 0, 0, 2_000),
  // 캐시 읽기 + 캐시 쓰기 (쓰기 단가 null인 공급자는 (a) 대체 규칙에 걸린다)
  U2: u(10_000, 50_000, 4_000, 2_000),
  // 전체 입력 325,000 → OpenAI(272K)·Claude Haiku(100K)는 장문, 나머지는 일반
  U3: u(300_000, 20_000, 5_000, 10_000),
} as const;

type Seed = {
  key: string;
  version: string;
  input: number;
  cached: number | null;
  cacheWrite: number | null;
  output: number;
  thr: number | null;
  lcIn: number | null;
  lcCached: number | null;
  lcCacheWrite: number | null;
  lcOut: number | null;
};

/** `ai_price_tables` 시드 (20261028000400) — 9모델 × 3버전 중 값이 다른 11행. */
const SEED: Seed[] = [
  { key: "openai/gpt-6-luna", version: "v2026-10-28", input: 0.1, cached: 0.01, cacheWrite: null, output: 0.5, thr: 272_000, lcIn: 0.2, lcCached: 0.02, lcCacheWrite: null, lcOut: 0.75 },
  { key: "openai/gpt-6.1-terra", version: "v2026-10-28", input: 1, cached: 0.05, cacheWrite: null, output: 5, thr: 272_000, lcIn: 2, lcCached: 0.1, lcCacheWrite: null, lcOut: 7.5 },
  { key: "openai/gpt-6.1-sol", version: "v2026-10-28", input: 2, cached: 0.1, cacheWrite: null, output: 10, thr: 272_000, lcIn: 4, lcCached: 0.2, lcCacheWrite: null, lcOut: 15 },
  { key: "gemini/gemini-3.5-flash-lite", version: "v2026-10-28", input: 0.3, cached: 0.03, cacheWrite: null, output: 2.5, thr: null, lcIn: null, lcCached: null, lcCacheWrite: null, lcOut: null },
  { key: "gemini/gemini-3.8-flash", version: "v2026-10-28", input: 0.75, cached: 0.075, cacheWrite: null, output: 3.75, thr: null, lcIn: null, lcCached: null, lcCacheWrite: null, lcOut: null },
  { key: "gemini/gemini-4-argon", version: "v2026-10-28", input: 2, cached: 0.1, cacheWrite: null, output: 10, thr: null, lcIn: null, lcCached: null, lcCacheWrite: null, lcOut: null },
  { key: "anthropic/claude-haiku-5-5", version: "v2026-10-28", input: 0.1, cached: 0.01, cacheWrite: 0.125, output: 0.5, thr: 100_000, lcIn: 0.5, lcCached: 0.05, lcCacheWrite: 0.625, lcOut: 2.5 },
  { key: "anthropic/claude-sonnet-5-5", version: "v2026-10-28", input: 2, cached: 0.1, cacheWrite: 2.5, output: 10, thr: null, lcIn: null, lcCached: null, lcCacheWrite: null, lcOut: null },
  { key: "anthropic/claude-opus-5-5", version: "v2026-10-28", input: 4, cached: 0.2, cacheWrite: 5, output: 20, thr: null, lcIn: null, lcCached: null, lcCacheWrite: null, lcOut: null },
  // 예정된 가격 변경 (같은 모델, 다음 버전)
  { key: "gemini/gemini-4-argon", version: "v2026-12-01", input: 4, cached: 0.2, cacheWrite: null, output: 20, thr: null, lcIn: null, lcCached: null, lcCacheWrite: null, lcOut: null },
  { key: "gemini/gemini-3.8-flash", version: "v2027-01-01", input: 1.5, cached: 0.15, cacheWrite: null, output: 7.5, thr: null, lcIn: null, lcCached: null, lcCacheWrite: null, lcOut: null },
];

function priceRow(s: Seed): PriceRow {
  return {
    version: s.version,
    inputUsdPerMtok: s.input,
    cachedInputUsdPerMtok: s.cached,
    cacheWriteUsdPerMtok: s.cacheWrite,
    outputUsdPerMtok: s.output,
    longContextThresholdTokens: s.thr,
    longContextInputUsdPerMtok: s.lcIn,
    longContextCachedInputUsdPerMtok: s.lcCached,
    longContextCacheWriteUsdPerMtok: s.lcCacheWrite,
    longContextOutputUsdPerMtok: s.lcOut,
  };
}

/** `[inputCostUsd, outputCostUsd, estimatedCostUsd]` per `${key}|${version}|${usage}`. */
const EXPECTED: Record<string, [number, number, number]> = {
  "openai/gpt-6-luna|v2026-10-28|U1": [0.001, 0.001, 0.002],
  "openai/gpt-6-luna|v2026-10-28|U2": [0.0019, 0.001, 0.0029],
  "openai/gpt-6-luna|v2026-10-28|U3": [0.0614, 0.0075, 0.0689],
  "openai/gpt-6.1-terra|v2026-10-28|U1": [0.01, 0.01, 0.02],
  "openai/gpt-6.1-terra|v2026-10-28|U2": [0.0165, 0.01, 0.0265],
  "openai/gpt-6.1-terra|v2026-10-28|U3": [0.612, 0.075, 0.687],
  "openai/gpt-6.1-sol|v2026-10-28|U1": [0.02, 0.02, 0.04],
  "openai/gpt-6.1-sol|v2026-10-28|U2": [0.033, 0.02, 0.053],
  "openai/gpt-6.1-sol|v2026-10-28|U3": [1.224, 0.15, 1.374],
  "gemini/gemini-3.5-flash-lite|v2026-10-28|U1": [0.003, 0.005, 0.008],
  "gemini/gemini-3.5-flash-lite|v2026-10-28|U2": [0.0057, 0.005, 0.0107],
  "gemini/gemini-3.5-flash-lite|v2026-10-28|U3": [0.0921, 0.025, 0.1171],
  "gemini/gemini-3.8-flash|v2026-10-28|U1": [0.0075, 0.0075, 0.015],
  "gemini/gemini-3.8-flash|v2026-10-28|U2": [0.01425, 0.0075, 0.02175],
  "gemini/gemini-3.8-flash|v2026-10-28|U3": [0.23025, 0.0375, 0.26775],
  "gemini/gemini-4-argon|v2026-10-28|U1": [0.02, 0.02, 0.04],
  "gemini/gemini-4-argon|v2026-10-28|U2": [0.033, 0.02, 0.053],
  "gemini/gemini-4-argon|v2026-10-28|U3": [0.612, 0.1, 0.712],
  "anthropic/claude-haiku-5-5|v2026-10-28|U1": [0.001, 0.001, 0.002],
  "anthropic/claude-haiku-5-5|v2026-10-28|U2": [0.002, 0.001, 0.003],
  "anthropic/claude-haiku-5-5|v2026-10-28|U3": [0.154125, 0.025, 0.179125],
  "anthropic/claude-sonnet-5-5|v2026-10-28|U1": [0.02, 0.02, 0.04],
  "anthropic/claude-sonnet-5-5|v2026-10-28|U2": [0.035, 0.02, 0.055],
  "anthropic/claude-sonnet-5-5|v2026-10-28|U3": [0.6145, 0.1, 0.7145],
  "anthropic/claude-opus-5-5|v2026-10-28|U1": [0.04, 0.04, 0.08],
  "anthropic/claude-opus-5-5|v2026-10-28|U2": [0.07, 0.04, 0.11],
  "anthropic/claude-opus-5-5|v2026-10-28|U3": [1.229, 0.2, 1.429],
  "gemini/gemini-4-argon|v2026-12-01|U1": [0.04, 0.04, 0.08],
  "gemini/gemini-4-argon|v2026-12-01|U2": [0.066, 0.04, 0.106],
  "gemini/gemini-4-argon|v2026-12-01|U3": [1.224, 0.2, 1.424],
  "gemini/gemini-3.8-flash|v2027-01-01|U1": [0.015, 0.015, 0.03],
  "gemini/gemini-3.8-flash|v2027-01-01|U2": [0.0285, 0.015, 0.0435],
  "gemini/gemini-3.8-flash|v2027-01-01|U3": [0.4605, 0.075, 0.5355],
};

describe("cost split golden table (백필 SQL이 맞춰야 하는 값, QA-R13-04)", () => {
  for (const seed of SEED) {
    for (const [name, usage] of Object.entries(USAGES)) {
      const key = `${seed.key}|${seed.version}|${name}`;
      it(key, () => {
        const expected = EXPECTED[key];
        expect(expected, `missing expectation for ${key}`).toBeDefined();
        const c = estimateCost(usage, priceRow(seed));
        expect([c.inputCostUsd, c.outputCostUsd, c.estimatedCostUsd]).toEqual(expected);
        // 합계는 반올림된 두 값의 합 (numeric(12,6) 자리수, 합 재반올림 없음)
        expect(c.estimatedCostUsd).toBe(Math.round((c.inputCostUsd + c.outputCostUsd) * 1e6) / 1e6);
      });
    }
  }

  // (a) 캐시 단가 null → 0이 아니라 그 구간의 입력 단가로 대체한다
  it("(a) 캐시 쓰기 단가 null → 일반 구간 입력 단가 (0 취급이 아니다)", () => {
    const luna = priceRow(SEED[0]!);
    // 10,000×0.10 + 50,000×0.01 + 4,000×**0.10** = 1,000 + 500 + 400 micro-USD
    expect(estimateCost(USAGES.U2, luna).inputCostUsd).toBe(0.0019);
    expect(estimateCost(USAGES.U2, { ...luna, cacheWriteUsdPerMtok: 0 }).inputCostUsd).toBe(0.0015);
  });

  it("(a) 장문 구간에서 캐시 단가 null → 장문 입력 단가로 대체", () => {
    const luna = priceRow(SEED[0]!);
    // U3은 장문: 300,000×0.20 + 20,000×0.02 + 5,000×**0.20** = 60,000 + 400 + 1,000 micro-USD
    expect(estimateCost(USAGES.U3, luna).inputCostUsd).toBe(0.0614);
  });

  // (b) threshold가 있어도 장문 입력·출력 단가가 둘 다 있어야 장문으로 본다
  it("(b) threshold만 있고 장문 단가가 null이면 일반 단가 (null 비용이 생기지 않는다)", () => {
    const halfLong = { ...priceRow(SEED[7]!), longContextThresholdTokens: 100_000 }; // sonnet + threshold, 장문 단가 없음
    const c = estimateCost(USAGES.U3, halfLong);
    expect(c).toEqual(estimateCost(USAGES.U3, priceRow(SEED[7]!)));
    expect(Number.isFinite(c.estimatedCostUsd)).toBe(true);
    // 장문 입력 단가만 있고 출력 단가가 없는 행도 일반 단가 (한쪽만 장문이 되는 경로는 없다)
    expect(estimateCost(USAGES.U3, { ...halfLong, longContextInputUsdPerMtok: 9 })).toEqual(c);
  });

  it("가격표 행이 없으면 세 값 모두 0 (unpriced)", () => {
    expect(UNPRICED_COST).toEqual({ inputCostUsd: 0, outputCostUsd: 0, estimatedCostUsd: 0 });
  });
});
