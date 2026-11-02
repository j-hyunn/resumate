import { describe, expect, it } from "vitest";
import { normalizeForMatch } from "./normalize";
import { matchQuote, QUOTE_PARTIAL_MATCH_THRESHOLD } from "./quote";

const SOURCE = "결제 승인 API의 병목 쿼리를 찾아, 인덱스를 재설계했다.";

describe("normalizeForMatch", () => {
  it("removes whitespace and punctuation, folds full-width and case", () => {
    expect(normalizeForMatch("  결제，승인 「API」！ ").text).toBe("결제승인api");
    expect(normalizeForMatch("ＡＰＩ ３０％").text).toBe("api30");
    expect(normalizeForMatch("1,200명 · 3배").text).toBe("1200명3배");
  });
});

describe("matchQuote (V-3)", () => {
  it.each([
    ["exact substring", "병목 쿼리를 찾아, 인덱스를 재설계했다", "병목 쿼리를 찾아, 인덱스를 재설계했다", false],
    ["spacing variant", "병목쿼리를 찾아 인덱스를  재설계했다", "병목 쿼리를 찾아, 인덱스를 재설계했다", false],
    ["full-width punctuation", "API의 병목 쿼리를 찾아，인덱스를", "API의 병목 쿼리를 찾아, 인덱스를", false],
    ["case-insensitive Latin", "결제 승인 api의 병목", "결제 승인 API의 병목", false],
  ])("%s → stores the exact source span", (_, quote, stored, adjusted) => {
    expect(matchQuote(quote, SOURCE)).toEqual({ ok: true, quote: stored, adjusted });
  });

  it("partial match at or above the threshold is replaced by the closest source span", () => {
    // 10 of 12 normalized chars in one run (83%) — the model changed the ending.
    const result = matchQuote("인덱스를 재설계했습니", SOURCE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.adjusted).toBe(true);
      expect(SOURCE).toContain(result.quote);
      expect(result.quote.startsWith("인덱스를 재설계")).toBe(true);
    }
  });

  it("below the threshold → rejected", () => {
    expect(QUOTE_PARTIAL_MATCH_THRESHOLD).toBe(0.7);
    expect(matchQuote("인덱스를 전부 새로 만들어 성능을 열 배 높였다", SOURCE)).toEqual({ ok: false });
  });

  it("invented text and too-short partials are rejected", () => {
    expect(matchQuote("Kafka 클러스터를 운영했다", SOURCE)).toEqual({ ok: false });
    expect(matchQuote("병목 쿼리X", SOURCE)).toEqual({ ok: false });
    expect(matchQuote("", SOURCE)).toEqual({ ok: false });
    expect(matchQuote("…", SOURCE)).toEqual({ ok: false });
  });
});
