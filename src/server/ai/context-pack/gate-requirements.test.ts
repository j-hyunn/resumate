import { describe, expect, it } from "vitest";
import { GATE_REQUIREMENTS_MAX, hasWeakEvidence, prepareSignals, selectGateRequirements, signalKey, type GateRequirementRow } from "./gate-requirements";

let n = 0;
const req = (partial: Partial<GateRequirementRow>): GateRequirementRow => ({
  id: `r-${String(++n).padStart(3, "0")}`,
  category: "required",
  content: "요건",
  keywords: [],
  importance: "normal",
  sort_order: n,
  ...partial,
});

const noSignals = { skillNames: [], texts: [] };

describe("signalKey", () => {
  it.each([
    ["Spring Boot", "springboot"],
    ["spring-boot", "springboot"],
    ["Node.js", "nodejs"],
    ["ＡＰＩ", "api"],
  ])("%s → %s", (raw, expected) => expect(signalKey(raw)).toBe(expected));
});

describe("hasWeakEvidence [가정 S5-7]", () => {
  const signals = prepareSignals({ skillNames: ["spring boot", "c"], texts: ["결제 승인 API 응답 시간을 개선했다", "Kafka consumer lag 알림"] });
  it.each([
    ["skill exact (normalized)", ["Spring-Boot"], false],
    ["keyword inside a project/detail text", ["결제"], false],
    ["case-insensitive text match", ["kafka"], false],
    ["one of several keywords matches", ["Redis", "API"], false],
    ["no overlap", ["Redis", "GraphQL"], true],
    ["1-char keyword only matches skills exactly", ["C"], false],
    ["1-char keyword not a skill does not match texts", ["R"], true],
    ["no keywords → weak", [], true],
  ])("%s", (_name, keywords, weak) => expect(hasWeakEvidence({ keywords: keywords as string[] }, signals)).toBe(weak));
});

describe("selectGateRequirements (R-31)", () => {
  it("takes every high first, then weak-evidence ones, max 8, shown in JD order", () => {
    n = 0;
    const rows = [
      req({ importance: "normal", keywords: ["Kotlin"] }), // 1 covered by skill → not picked
      req({ importance: "high", keywords: ["Kotlin"] }), // 2 high
      req({ importance: "normal", keywords: ["Kafka"] }), // 3 weak
      ...Array.from({ length: 7 }, () => req({ importance: "high", keywords: ["x"] })), // 4–10 high
      req({ importance: "normal", keywords: ["GraphQL"] }), // 11 weak
    ];
    const picked = selectGateRequirements(rows, { skillNames: ["kotlin"], texts: [] });
    expect(picked).toHaveLength(GATE_REQUIREMENTS_MAX);
    // 8 highs exist → no room for weak ones.
    expect(picked.every((p) => p.reason === "high")).toBe(true);
    expect(picked.map((p) => p.id)).toEqual(["r-002", "r-004", "r-005", "r-006", "r-007", "r-008", "r-009", "r-010"]);
  });

  it("fills remaining slots with weak ones in sort_order; covered ones are skipped", () => {
    n = 0;
    const rows = [
      req({ importance: "normal", keywords: ["GraphQL"], sort_order: 30 }),
      req({ importance: "high", keywords: ["결제"], sort_order: 20 }),
      req({ importance: "normal", keywords: ["결제"], sort_order: 10 }),
      req({ importance: "normal", keywords: ["Redis"], sort_order: 40 }),
    ];
    const picked = selectGateRequirements(rows, { skillNames: [], texts: ["결제 정산 배치"] }, 2);
    expect(picked.map((p) => [p.id, p.reason])).toEqual([
      ["r-002", "high"],
      ["r-001", "weak_evidence"],
    ]);
  });

  it("is deterministic regardless of input order", () => {
    n = 0;
    const rows = Array.from({ length: 12 }, (_, i) => req({ importance: i % 3 === 0 ? "high" : "normal", keywords: [`k${i}`] }));
    const a = selectGateRequirements(rows, noSignals);
    const b = selectGateRequirements([...rows].reverse(), noSignals);
    expect(a).toEqual(b);
  });

  it("returns only content, category, importance (no keywords or sids)", () => {
    n = 0;
    const [one] = selectGateRequirements([req({ importance: "high", content: "결제 API 설계", keywords: ["Kafka"] })], noSignals);
    expect(Object.keys(one).sort()).toEqual(["category", "content", "id", "importance", "reason"]);
  });

  it("empty input or max 0 → empty", () => {
    expect(selectGateRequirements([], noSignals)).toEqual([]);
    expect(selectGateRequirements([req({ importance: "high" })], noSignals, 0)).toEqual([]);
  });
});
