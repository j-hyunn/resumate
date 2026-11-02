import { describe, expect, it } from "vitest";
import { careerRowsFixture } from "../__fixtures__/career-rows";
import { buildCareerPack } from "../context-pack/career-pack";
import { finalizeBlockNumbers, validateTextBlock } from "./block";
import { buildAllowedNumbers, NUMBER_CHECK_TOKEN } from "./numbers";
import { checkPlaceholders, countRemainingPlaceholders, findPlaceholderTokens } from "./placeholders";

describe("checkPlaceholders (C-5)", () => {
  it("accepts a matching list", () => {
    const r = checkPlaceholders("처리 시간 [수치 입력 필요] 단축", [{ token: "[수치 입력 필요]", hint: "개선 전후 처리 시간" }]);
    expect(r).toEqual({
      text: "처리 시간 [수치 입력 필요] 단축",
      placeholders: [{ token: "[수치 입력 필요]", hint: "개선 전후 처리 시간" }],
      mismatch: false,
      unknownReplaced: 0,
    });
  });

  it("rebuilds the list from the body when counts differ, reusing hints in order", () => {
    const r = checkPlaceholders("[기간 입력 필요] 동안 [수치 입력 필요]와 [수치 입력 필요]", [
      { token: "[수치 입력 필요]", hint: "a" },
    ]);
    expect(r.mismatch).toBe(true);
    expect(r.placeholders).toEqual([
      { token: "[기간 입력 필요]", hint: "" },
      { token: "[수치 입력 필요]", hint: "a" },
      { token: "[수치 입력 필요]", hint: "" },
    ]);
  });

  it("drops list entries without a body token", () => {
    const r = checkPlaceholders("본문", [{ token: "[계획 입력 필요]", hint: "x" }]);
    expect(r).toMatchObject({ mismatch: true, placeholders: [] });
  });

  it("replaces invented tokens with [내용 확인 필요] and leaves the V-5 token alone", () => {
    const r = checkPlaceholders(`[회사명 입력 필요]에서 ${NUMBER_CHECK_TOKEN} 개선`, []);
    expect(r.text).toBe(`[내용 확인 필요]에서 ${NUMBER_CHECK_TOKEN} 개선`);
    expect(r.unknownReplaced).toBe(1);
    expect(findPlaceholderTokens(r.text)).toEqual(["[내용 확인 필요]"]);
    expect(countRemainingPlaceholders(r.text)).toBe(2);
  });
});

describe("validateTextBlock / finalizeBlockNumbers", () => {
  const pack = buildCareerPack(careerRowsFixture(), { asOf: { year: 2026, month: 10 } });
  const allowed = buildAllowedNumbers({ texts: pack.numberSources.factualTexts, numbers: pack.numberSources.computedNumbers });
  const ctx = { aliases: pack.aliases, learnings: "forbidden" as const };

  it("a placeholder is not an unsupported claim: block with evidence and a placeholder stays clean", () => {
    const r = validateTextBlock(
      {
        key: "p2-b2",
        kind: "draft_block",
        text: "정산 배치 재설계로 처리 시간 [수치 입력 필요] 단축",
        evidence: [{ source_type: "project_detail", ref: "DET-1", field: "action", quote: "정산 배치를 청크 단위로 재설계했다" }],
        placeholders: [{ token: "[수치 입력 필요]", hint: "처리 시간 전후" }],
      },
      ctx,
      allowed,
    );
    expect(r.text).toContain("[수치 입력 필요]");
    expect(r.outcome.action).toBe("keep");
    expect(r.unsupportedNumbers).toEqual([]);
    expect(r.report).toMatchObject({ placeholder_mismatches: 0, number_violations: 0, items_flagged: 0 });
  });

  it("an invented number is detected, then replaced in the final step", () => {
    const r = validateTextBlock(
      {
        key: "p2-b1",
        kind: "draft_block",
        text: "응답 시간 41% 단축",
        evidence: [{ source_type: "achievement", ref: "ACH-2", field: "metric" }],
      },
      ctx,
      allowed,
    );
    expect(r.report.number_violations).toBe(1);
    expect(finalizeBlockNumbers(r.text, allowed)).toEqual({
      text: `응답 시간 ${NUMBER_CHECK_TOKEN} 단축`,
      flags: ["number_check_needed"],
      report: { numbers_replaced: 1 },
    });
  });
});
