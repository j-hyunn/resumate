import { describe, expect, it } from "vitest";
import { buildJdContext, splitJdSentences, type JdRequirementInput } from "./jd";

const JD = `[가상테크] 백엔드 개발자 채용

주요 업무
- 결제 API를 설계하고 운영합니다. 대용량 트래픽을 다룹니다.
• Node.js 또는 Kotlin 기반 서비스 개발
1. 경력 3.5년 이상!
  2) 장애 대응 경험

우대 사항
· Kafka 운영 경험이 있으신 분?
---
`;

describe("splitJdSentences (C-2)", () => {
  const sentences = splitJdSentences(JD);

  it("splits by line and sentence end, numbering S1… in order", () => {
    expect(sentences.map((s) => s.text)).toEqual([
      "[가상테크] 백엔드 개발자 채용",
      "주요 업무",
      "결제 API를 설계하고 운영합니다.",
      "대용량 트래픽을 다룹니다.",
      "Node.js 또는 Kotlin 기반 서비스 개발",
      "경력 3.5년 이상!",
      "장애 대응 경험",
      "우대 사항",
      "Kafka 운영 경험이 있으신 분?",
    ]);
    expect(sentences.map((s) => s.sid)).toEqual(["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9"]);
  });

  it("offsets point at the exact raw text (bullets skipped)", () => {
    for (const s of sentences) expect(JD.slice(s.start, s.end)).toBe(s.text);
  });

  it("is deterministic and handles CRLF and empty input", () => {
    expect(splitJdSentences(JD)).toEqual(sentences);
    expect(splitJdSentences("a 문장입니다.\r\n둘째 줄")).toEqual([
      { sid: "S1", text: "a 문장입니다.", start: 0, end: 8 },
      { sid: "S2", text: "둘째 줄", start: 10, end: 14 },
    ]);
    expect(splitJdSentences("")).toEqual([]);
    expect(splitJdSentences("\n- \n***\n")).toEqual([]);
  });
});

describe("buildJdContext", () => {
  const sentences = splitJdSentences(JD);
  const requirements: JdRequirementInput[] = [
    { id: "r2", category: "preferred", content: "Kafka 운영 경험", importance: "normal", source_sids: ["S9"], sort_order: 2, updated_at: null },
    { id: "r1", category: "required", content: "경력 3.5년 이상", importance: "high", source_sids: ["S6"], sort_order: 1, updated_at: null },
  ];

  it("aliases requirements by sort_order and only cited sentences when asked", () => {
    const ctx = buildJdContext({ jobDescriptionId: "jd-1", sentences, requirements, includeSentences: "cited" });
    expect(ctx.aliases.get("REQ-1")?.id).toBe("r1");
    expect(ctx.aliases.get("REQ-2")?.id).toBe("r2");
    expect(ctx.aliases.get("S6")).toMatchObject({ sourceType: "jd_sentence", id: "jd-1", locator: { sid: "S6", start: sentences[5].start } });
    expect(ctx.aliases.has("S1")).toBe(false);
    expect(ctx.text).toContain("REQ-1 [자격 요건, 중요] 경력 3.5년 이상 (근거 문장: S6)");
    expect(ctx.text.startsWith("<jd>")).toBe(true);
  });

  it("omits sentences for later steps and hashes requirements independent of input order", () => {
    const a = buildJdContext({ jobDescriptionId: "jd-1", sentences, requirements, includeSentences: "none" });
    const b = buildJdContext({ jobDescriptionId: "jd-1", sentences, requirements: [...requirements].reverse(), includeSentences: "all" });
    expect(a.text).not.toContain("<sentences>");
    expect(a.requirementsHash).toBe(b.requirementsHash);
    expect(b.aliases.has("S1")).toBe(true);
  });
});
