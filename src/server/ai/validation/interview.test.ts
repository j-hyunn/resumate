import { describe, expect, it } from "vitest";
import { canAccept, citesReflection, compositionRule, findCareerTerms, findForbiddenTopics, missingKinds } from "./interview";

describe("C-7 forbidden topics", () => {
  it.each([
    ["나이가 어떻게 되시나요?", ["age"]],
    ["결혼 계획이 있으신가요?", ["marriage_childbirth"]],
    ["출산 후에도 일하실 건가요?", ["marriage_childbirth"]],
    ["부모님은 무슨 일을 하시나요?", ["family"]],
    ["종교가 있으신가요?", ["religion"]],
    ["고향이 어디세요?", ["origin"]],
    ["지지하는 정당이 있나요?", ["politics"]],
    ["건강 상태는 괜찮으신가요?", ["health"]],
  ])("%s → %j", (text, topics) => {
    expect(findForbiddenTopics(text)).toEqual(topics);
  });

  it.each([
    "야간 장애 대응 체계를 어떻게 만드셨나요?",
    "서비스 건강성 지표를 무엇으로 보셨나요?",
    "팀의 우선순위를 정할 때 무엇을 먼저 보시나요?",
    "그 가정이 틀렸다면 어떻게 하셨을까요?",
  ])("job words are not flagged: %s", (text) => {
    expect(findForbiddenTopics(text)).toEqual([]);
  });
});

describe("4.1 composition", () => {
  it("job 5: pdd ≥ 2, rf ≥ 1, gap ≥ 1 — a 4th pdd blocks the minimum", () => {
    const rule = compositionRule("job", 5);
    expect(canAccept(rule, {}, 5, "project_deep_dive")).toEqual({ ok: true });
    expect(canAccept(rule, { project_deep_dive: 3 }, 5, "project_deep_dive")).toEqual({ ok: false, reason: "blocks_minimum" });
    expect(canAccept(rule, { project_deep_dive: 2, requirement_fit: 1 }, 5, "gap_probe")).toEqual({ ok: true });
    expect(canAccept(rule, {}, 5, "values")).toEqual({ ok: false, reason: "kind_not_allowed" });
    expect(missingKinds(rule, { project_deep_dive: 1 })).toEqual({ project_deep_dive: 1, requirement_fit: 1, gap_probe: 1 });
  });

  it("job 3: gap_probe exactly 1", () => {
    const rule = compositionRule("job", 3);
    expect(canAccept(rule, { gap_probe: 1 }, 3, "gap_probe")).toEqual({ ok: false, reason: "kind_over_max" });
  });

  it("job 7: pdd ≥ 3, rf ≥ 2", () => {
    expect(compositionRule("job", 7).min).toEqual({ project_deep_dive: 3, requirement_fit: 2, gap_probe: 1 });
  });

  it("culture: topics differ (7: max 2), motivation_career reserved at 5/7", () => {
    const five = compositionRule("culture_fit", 5);
    expect(canAccept(five, { values: 1 }, 5, "values")).toEqual({ ok: false, reason: "kind_over_max" });
    expect(canAccept(five, { values: 1, conflict: 1, collaboration: 1, failure_growth: 1 }, 5, "org_adaptation")).toEqual({ ok: false, reason: "blocks_minimum" });
    expect(canAccept(compositionRule("culture_fit", 7), { values: 1 }, 7, "values")).toEqual({ ok: true });
    expect(compositionRule("culture_fit", 3).min).toEqual({});
  });
});

describe("culture helpers", () => {
  it("career terms are matched after normalization", () => {
    expect(findCareerTerms("예시 페이에서 일하실 때", ["예시페이", "파트장"])).toEqual(["예시페이"]);
  });

  it("reflection citation wording", () => {
    expect(citesReflection("측정이 중요하다고 배웠다고 정리하셨는데")).toBe(true);
    expect(citesReflection("측정이 중요한가요?")).toBe(false);
  });
});
