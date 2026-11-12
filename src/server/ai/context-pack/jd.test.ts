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

  it("QA-S5-01: any Unicode letter or number counts as content (Cyrillic, Arabic, Thai)", () => {
    const ru = "Разработчик бэкенда\nОпыт работы с базами данных";
    expect(splitJdSentences(ru).map((s) => s.text)).toEqual(["Разработчик бэкенда", "Опыт работы с базами данных"]);
    const ar = "مطور برمجيات";
    expect(splitJdSentences(ar)).toEqual([{ sid: "S1", text: ar, start: 0, end: ar.length }]);
    expect(splitJdSentences("นักพัฒนาซอฟต์แวร์").map((s) => s.sid)).toEqual(["S1"]);
    expect(splitJdSentences("Ⅲ").map((s) => s.sid)).toEqual(["S1"]); // Unicode number
  });

  it("QA-S5-01: symbol-only text still yields no sentences", () => {
    expect(splitJdSentences("----")).toEqual([]);
    expect(splitJdSentences("• • •")).toEqual([]);
    expect(splitJdSentences("★☆★\n!!! ???\n→ ← ↑")).toEqual([]);
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

/**
 * (R16) The URL fetch returns markdown. Only the edges move (heading `#`,
 * single-star / dash / number markers, a segment wrapped whole in `**…**` /
 * `__…__`); the text stays an exact substring of raw.
 */
describe("splitJdSentences — markdown edges (R16)", () => {
  const texts = (raw: string) => splitJdSentences(raw).map((s) => s.text);
  const exact = (raw: string) => {
    for (const s of splitJdSentences(raw)) expect(raw.slice(s.start, s.end)).toBe(s.text);
  };

  it("drops an ATX heading marker at the line start", () => {
    expect(texts("## 자격 요건")).toEqual(["자격 요건"]);
    expect(texts("# 회사 소개\n###### 복지")).toEqual(["회사 소개", "복지"]);
    // `#` with no space, or not at the line start, is text.
    expect(texts("#해시태그 채용")).toEqual(["#해시태그 채용"]);
    expect(texts("C# 개발 경험")).toEqual(["C# 개발 경험"]);
  });

  it("drops only the list marker before inline bold (the substring rule)", () => {
    expect(texts("- **필수**: Java 3년")).toEqual(["**필수**: Java 3년"]);
    exact("- **필수**: Java 3년");
  });

  it("drops a bold wrapper that covers the whole segment", () => {
    expect(texts("**주요 업무**")).toEqual(["주요 업무"]);
    expect(texts("__우대 사항__")).toEqual(["우대 사항"]);
    expect(texts("- **주요 업무**")).toEqual(["주요 업무"]);
    expect(texts("## **자격 요건**")).toEqual(["자격 요건"]);
    // Not a whole wrapper: kept as written.
    expect(texts("**필수** 와 **우대**")).toEqual(["**필수** 와 **우대**"]);
    expect(texts("Java **필수**")).toEqual(["Java **필수**"]);
  });

  it("does not take `**` for a list marker; a single star still is one", () => {
    expect(texts("**주요 업무")).toEqual(["**주요 업무"]);
    expect(texts("* 배치 작업 성능 개선")).toEqual(["배치 작업 성능 개선"]);
    expect(texts("*우대 경험")).toEqual(["우대 경험"]); // as before R16 [가정]
  });

  it("keeps the existing markers (numbers, dash, quote)", () => {
    expect(texts("1. 백엔드 개발")).toEqual(["백엔드 개발"]);
    expect(texts("2) 장애 대응")).toEqual(["장애 대응"]);
    expect(texts("> 인용 문장")).toEqual(["인용 문장"]);
    expect(texts("- 결제 API 운영")).toEqual(["결제 API 운영"]);
  });

  it("every sentence of a markdown posting is an exact raw substring", () => {
    const raw = "# 제목\n\n## 주요 업무\n- **필수**: Java 3년. 그 밖의 업무!\n**우대**\n### 1. 마감: 2026.12.20";
    exact(raw);
    expect(texts(raw)).toEqual(["제목", "주요 업무", "**필수**: Java 3년.", "그 밖의 업무!", "우대", "마감: 2026.12.20"]);
  });
});

/** (R16) GFM table rows (the fetch exports tables as markdown). */
describe("splitJdSentences — GFM table rows (R16)", () => {
  const texts = (raw: string) => splitJdSentences(raw).map((s) => s.text);
  const TABLE = ["| 구분 | 내용 |", "| --- | :---: |", "| 경력 | 3년 이상 |", "| 근무지 | 서울. 판교 |", "| 기술 | C\\|C++ 경험 \\| |"].join("\n");

  it("drops only the outer pipes, keeps the inner ones, skips the separator row", () => {
    expect(texts(TABLE)).toEqual(["구분 | 내용", "경력 | 3년 이상", "근무지 | 서울. 판교", "기술 | C\\|C++ 경험 \\|"]);
    for (const s of splitJdSentences(TABLE)) expect(TABLE.slice(s.start, s.end)).toBe(s.text);
  });

  it("keeps a row whole (no split at a sentence end inside a cell) [가정]", () => {
    expect(texts("| 업무 | API 설계. 운영 |")).toEqual(["업무 | API 설계. 운영"]);
  });

  it("an escaped trailing pipe is not a delimiter (no closing pipe → not a row, kept as written)", () => {
    expect(texts("| 기호 | a \\|")).toEqual(["| 기호 | a \\|"]);
  });

  it("a line with only inner pipes is ordinary text", () => {
    expect(texts("경력 | 3년 이상")).toEqual(["경력 | 3년 이상"]);
  });
});

/**
 * Regression: text without markdown splits exactly as before R16. The pre-R16
 * splitter is kept here verbatim as the reference.
 */
describe("splitJdSentences — plain text unchanged (R16 regression)", () => {
  const OLD_BULLET = /^(?:[-*•·▪■□○●◦✓✔☑➢▶►※>]+|\(?\d{1,2}[.)]|\(?[a-zA-Z가-힣][.)](?=\s))\s*/;
  function oldSplit(raw: string) {
    const out: Array<{ sid: string; text: string; start: number; end: number }> = [];
    const push = (from: number, to: number) => {
      let start = from;
      let end = to;
      while (start < end && /\s/.test(raw[start])) start++;
      while (end > start && /\s/.test(raw[end - 1])) end--;
      const b = OLD_BULLET.exec(raw.slice(start, end));
      if (b) start += b[0].length;
      while (start < end && /\s/.test(raw[start])) start++;
      if (end <= start) return;
      const text = raw.slice(start, end);
      if (!/[\p{L}\p{N}]/u.test(text)) return;
      out.push({ sid: `S${out.length + 1}`, text, start, end });
    };
    let lineStart = 0;
    for (let i = 0; i <= raw.length; i++) {
      if (i === raw.length || raw[i] === "\n" || raw[i] === "\r") {
        let seg = lineStart;
        for (let j = lineStart; j < i; j++) {
          if ((raw[j] === "." || raw[j] === "!" || raw[j] === "?" || raw[j] === "。") && (j + 1 >= i || /\s/.test(raw[j + 1]))) {
            push(seg, j + 1);
            seg = j + 1;
          }
        }
        push(seg, i);
        lineStart = i + 1;
      }
    }
    return out;
  }

  it.each([
    ["the C-2 fixture", JD],
    ["single-star markers", "* 항목 하나\n*항목 둘\n- 셋\n※ 넷"],
    ["numbers and letters", "1. 첫째\n(2) 둘째\na. 셋째\n가) 넷째"],
    ["CRLF + sentence ends", "첫 문장입니다. 둘째 문장!\r\n셋째 줄? 넷째。"],
    ["inline symbols", "C# 및 F# 경험\nNode.js 3.5년 이상"],
    ["inner pipes", "경력 | 3년 이상\n연봉 | 협의. 면접 후 결정"],
  ])("%s", (_, raw) => {
    expect(splitJdSentences(raw)).toEqual(oldSplit(raw));
  });
});
