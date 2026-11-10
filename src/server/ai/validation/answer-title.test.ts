import { describe, expect, it } from "vitest";
import { coverLetterContext } from "../__fixtures__/S7/cover-letter-chat";
import { droppedTitleNotice, normalizeAnswerTitle, validateAnswerTitle, type AnswerTitleEnv } from "./answer-title";

/** (v4.15, CF-6) 답변 제목 검증 — 걸리면 제목만 버린다 (본문은 산다). */
describe("validateAnswerTitle", () => {
  const ctx = coverLetterContext();
  const env = (paragraphTexts: string[], evidenceTexts: string[] = []): AnswerTitleEnv => ({
    paragraphTexts,
    evidenceTexts,
    computedNumbers: ctx.pack.numberSources.computedNumbers,
    aliases: ctx.aliases,
    literalAliasTokens: ctx.env.literalAliasTokens,
  });

  const BODY = "결제 승인 API의 응답 시간을 1.2초에서 0.7초로 줄였습니다. 병목 쿼리를 분석해 인덱스를 재설계했습니다.";

  it("keeps a title whose numbers and names are in the final body", () => {
    const out = validateAnswerTitle("응답 시간을 0.7초로 줄인 병목 분석", env([BODY]));
    expect(out).toMatchObject({ title: "응답 시간을 0.7초로 줄인 병목 분석", rejected: null });
  });

  it("drops a title with a number the body does not support (①)", () => {
    const out = validateAnswerTitle("응답 시간 40% 단축", env([BODY]));
    expect(out.title).toBeNull();
    expect(out.rejected).toBe("numbers");
  });

  it("drops a title with a tech name that is nowhere in the sources (②)", () => {
    const out = validateAnswerTitle("Kubernetes 기반 결제 안정화", env([BODY]));
    expect(out.title).toBeNull();
    expect(out.rejected).toBe("names");
  });

  it("drops a title that carries sensitive information (③)", () => {
    const out = validateAnswerTitle("연락처 010-1234-5678 로 문의", env([BODY, "연락처 010-1234-5678"]));
    expect(out.title).toBeNull();
    expect(out.rejected).toBe("sensitive");
  });

  it("drops a title that still holds a placeholder token or is too long (⑤)", () => {
    expect(validateAnswerTitle("[수치 확인 필요] 개선 경험", env([BODY])).rejected).toBe("placeholder");
    expect(validateAnswerTitle("가".repeat(101), env(["가".repeat(300)])).rejected).toBe("length");
    expect(validateAnswerTitle("가".repeat(100), env(["가".repeat(300)])).title).toHaveLength(100);
  });

  it("makes a one-line title out of a multi-line one instead of dropping it", () => {
    expect(normalizeAnswerTitle("병목을 찾아\n응답 시간을  줄인 경험")).toBe("병목을 찾아 응답 시간을 줄인 경험");
    expect(validateAnswerTitle("병목을 찾아\n응답 시간을 줄인 경험", env([BODY])).title).toBe("병목을 찾아 응답 시간을 줄인 경험");
  });

  it("replaces a leftover alias instead of dropping the title (④)", () => {
    const prj = ctx.aliases.get("PRJ-1");
    const out = validateAnswerTitle("PRJ-1 에서 쌓은 결제 경험", env([BODY, prj?.label ?? ""]));
    expect(out.title).not.toContain("PRJ-1");
    expect(out.rejected).toBeNull();
    expect(out.aliasesReplaced + 0).toBeGreaterThanOrEqual(0);
  });

  it("treats no proposal and an empty proposal as 'no title'", () => {
    expect(validateAnswerTitle(null, env([BODY]))).toMatchObject({ title: null, rejected: null });
    expect(validateAnswerTitle("   ", env([BODY]))).toMatchObject({ title: null, rejected: "empty" });
  });

  it("names the question in the notice it leaves in the AI message", () => {
    expect(droppedTitleNotice(2)).toContain("2번 문항");
  });
});
