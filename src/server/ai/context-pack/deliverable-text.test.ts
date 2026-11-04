import { describe, expect, it } from "vitest";
import { CODE_BLOCK_MAX_LINES, normalizeDeliverableMarkdown, plainForValidation, rawSpan, truncateNormalized } from "./deliverable-text";

describe("normalizeDeliverableMarkdown (C-1.1)", () => {
  it.each([
    ["# 제목", "제목"],
    ["### 소제목 ###", "소제목 ###"],
    ["- 항목 하나\n* 항목 둘\n+ 항목 셋", "항목 하나\n항목 둘\n항목 셋"],
    ["1. 첫째\n2) 둘째", "첫째\n둘째"],
    ["- [x] 완료한 일", "완료한 일"],
    ["> 인용문", "인용문"],
    ["**굵게** 와 *기울임* 과 ~~취소~~", "굵게 와 기울임 과 취소"],
    ["`inline_code` 와 snake_case_name", "inline_code 와 snake_case_name"],
    ["_강조_ 끝", "강조 끝"],
    ["[링크 글](https://example.com/x) 뒤", "링크 글 뒤"],
    ["앞 ![그림](https://example.com/a.png) 뒤", "앞  뒤"],
    ["<b>태그</b> 제거 <br/>", "태그 제거"],
    ["| 항목 | 값 |\n|---|:---:|\n| 응답 | 120ms |", "항목 / 값\n응답 / 120ms"],
    ["문단 하나\n\n문단 둘", "문단 하나\n\n문단 둘"],
    ["줄 끝 공백   \n다음 줄", "줄 끝 공백\n다음 줄"],
    ["윈도우\r\n줄바꿈", "윈도우\n줄바꿈"],
  ])("%j → %j", (raw, expected) => {
    expect(normalizeDeliverableMarkdown(raw).text).toBe(expected);
  });

  it(`keeps the first ${CODE_BLOCK_MAX_LINES} lines of a fenced code block and drops the fences`, () => {
    const code = Array.from({ length: 40 }, (_, i) => `line${i + 1}`).join("\n");
    const out = normalizeDeliverableMarkdown(`앞\n\`\`\`ts\n${code}\n\`\`\`\n뒤`).text.split("\n");
    expect(out[0]).toBe("앞");
    expect(out).toContain("line30");
    expect(out).not.toContain("line31");
    expect(out[out.length - 1]).toBe("뒤");
    expect(out.join("\n")).not.toContain("```");
  });

  it("keeps markdown-looking text inside code blocks as written", () => {
    expect(normalizeDeliverableMarkdown("```\n# not a heading **x**\n```").text).toBe("# not a heading **x**");
  });

  it("maps every normalized char back to the raw markdown", () => {
    const raw = "## 결과\n\n- 응답 시간을 **1.2초**에서 [0.7초](https://x.y)로 줄였다\n| a | b |";
    const n = normalizeDeliverableMarkdown(raw);
    expect(n.map).toHaveLength(n.text.length);
    for (let i = 0; i < n.text.length; i++) {
      if (n.text[i] === "\n" || raw[n.map[i]] === "|") continue; // line breaks and " / " map to the separator
      expect(raw[n.map[i]]).toBe(n.text[i]);
    }
    const quote = "1.2초에서 0.7초로";
    const at = n.text.indexOf(quote);
    const span = rawSpan(n, at, at + quote.length)!;
    expect(raw.slice(span.start, span.end)).toBe("1.2초**에서 [0.7초](https://x.y)로");
  });

  // v4.10 (UP-9): what doc-markdown-editor.tsx (patchMarkdownEscaping) writes.
  describe("editor escapes and syntax (UP-9)", () => {
    it.each([
      ["2\\*3 = 6", "2*3 = 6"],
      ["\\[메모\\] 확인", "[메모] 확인"],
      ["a &lt;div> 태그", "a <div> 태그"],
      ["&lt;/b> 와 &amp; 와 &gt;", "</b> 와 &amp; 와 &gt;"],
      ["snake_case 와 \\_edge\\_", "snake_case 와 _edge_"],
      ["백슬래시 \\\\ 와 \\` 와 \\~", "백슬래시 \\ 와 ` 와 ~"],
      ["\\# 제목 아님", "# 제목 아님"],
      ["~~취소~~ 남김", "취소 남김"],
      ["> 인용 한 줄\n>\n> 인용 둘", "인용 한 줄\n\n인용 둘"],
      ["> - 인용 속 목록", "인용 속 목록"],
      ["- 바깥\n  - 안쪽\n    1. 더 안쪽", "바깥\n안쪽\n더 안쪽"],
      ["### 소제목\n\n본문", "소제목\n\n본문"],
      ["`a\\*b` 와 `` x`y `` 끝", "a\\*b 와 x`y 끝"],
      ["`**굵게 아님**`", "**굵게 아님**"],
      ["[링크 \\[1\\]](https://x.y) 뒤", "링크 [1] 뒤"],
      ["| 항목 | 값 |\n| --- | --- |\n| a\\|b | `x\\|y` |", "항목 / 값\na|b / x|y"],
      ["| 칸 |\n| --- |\n| 첫 줄<br>둘째 줄 |", "칸\n첫 줄 둘째 줄"],
      ["문단 하나\n\n&nbsp;\n\n문단 둘", "문단 하나\n\n\n\n문단 둘"],
    ])("%j → %j", (raw, expected) => {
      expect(normalizeDeliverableMarkdown(raw).text).toBe(expected);
    });

    it("keeps code block content literally (no unescaping, no entity decoding)", () => {
      expect(normalizeDeliverableMarkdown("```ts\nconst a = b\\*c; // &lt;x>\n```").text).toBe("const a = b\\*c; // &lt;x>");
    });

    it("maps an unescaped char to its raw position (source_locator stays on the stored string)", () => {
      const raw = "결과: 2\\*3 배 \\[메모\\] a &lt;div> 끝";
      const n = normalizeDeliverableMarkdown(raw);
      expect(n.text).toBe("결과: 2*3 배 [메모] a <div> 끝");
      expect(n.map).toHaveLength(n.text.length);
      expect(raw[n.map[n.text.indexOf("*")]]).toBe("*");
      expect(raw[n.map[n.text.indexOf("[")]]).toBe("[");
      expect(raw.slice(n.map[n.text.indexOf("<")], n.map[n.text.indexOf("<")] + 4)).toBe("&lt;");
      for (const quote of ["2*3 배", "[메모]", "a <div> 끝"]) {
        const at = n.text.indexOf(quote);
        const span = rawSpan(n, at, at + quote.length)!;
        expect(normalizeDeliverableMarkdown(raw.slice(span.start, span.end)).text).toBe(quote);
      }
      const at = n.text.indexOf("[메모]");
      expect(raw.slice(rawSpan(n, at, at + 4)!.start, rawSpan(n, at, at + 4)!.end)).toBe("[메모\\]");
    });

    it("maps table cells and code spans back to the raw row", () => {
      const raw = "| 지표 | 값 |\n| --- | --- |\n| p\\|q | `1\\|2`ms |";
      const n = normalizeDeliverableMarkdown(raw);
      expect(n.text).toBe("지표 / 값\np|q / 1|2ms");
      const at = n.text.indexOf("1|2ms");
      const span = rawSpan(n, at, at + 5)!;
      expect(raw.slice(span.start, span.end)).toBe("1\\|2`ms");
    });
  });

  it("is deterministic", () => {
    const raw = "# A\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n```\ncode\n```";
    expect(normalizeDeliverableMarkdown(raw)).toEqual(normalizeDeliverableMarkdown(raw));
  });
});

describe("plainForValidation (UP-14)", () => {
  it("drops list markers, numbers, headings and emphasis; keeps line structure", () => {
    expect(plainForValidation("## 결과\n1. **응답 시간** 2초 → 0.5초\n2. 오류율 *3%* 감소\n   - 세부 `p99`")).toBe(
      "결과\n응답 시간 2초 → 0.5초\n오류율 3% 감소\n세부 p99",
    );
  });

  it("keeps every code block line (no pack cut)", () => {
    const code = Array.from({ length: 40 }, (_, i) => `line${i + 1}`).join("\n");
    expect(plainForValidation(`\`\`\`\n${code}\n\`\`\``).split("\n")).toHaveLength(40);
  });

  it("leaves plain text as is", () => {
    expect(plainForValidation("API 응답을 40% 줄였음")).toBe("API 응답을 40% 줄였음");
  });
});

describe("ordered list markers vs body numbers (R9 QA-02)", () => {
  it.each([
    // real lists → markers dropped
    ["1. 첫째\n2. 둘째\n3. 셋째", "첫째\n둘째\n셋째"],
    ["1) 하나", "하나"],
    ["1. 하나\n\n2. 둘 (느슨한 목록)", "하나\n\n둘 (느슨한 목록)"],
    ["1. 하나\n   이어지는 줄\n   - 중첩\n2. 둘", "하나\n이어지는 줄\n중첩\n둘"],
    ["3. 셋\n4. 넷 (시작 번호 3)", "셋\n넷 (시작 번호 3)"],
    ["1. 하나\n1. 하나 (게으른 번호)", "하나\n하나 (게으른 번호)"],
    ["> 1. 인용 속\n> 2. 목록", "인용 속\n목록"],
    // body numbers → kept
    ["2024. 서비스를 출시함", "2024. 서비스를 출시함"],
    ["300) 명이 가입함", "300) 명이 가입함"],
    ["2023. 03 ~ 2024. 02 결제 개선", "2023. 03 ~ 2024. 02 결제 개선"],
    ["7. 혼자 있는 번호", "7. 혼자 있는 번호"],
    ["1. 하나\n2. 둘\n5. 순서 밖", "하나\n둘\n5. 순서 밖"],
    ["1. 하나\n문단이 끊음\n2. 다른 목록?", "하나\n문단이 끊음\n2. 다른 목록?"],
    ["1. 하나\n2) 구분 기호만 다름", "하나\n구분 기호만 다름"],
    ["45. 혼자\n100. 3자리", "45. 혼자\n100. 3자리"],
    ["99. 와\n100. 3자리는 이어도 본문", "와\n100. 3자리는 이어도 본문"],
  ])("%j → %j", (raw, expected) => {
    expect(plainForValidation(raw)).toBe(expected);
  });
});

describe("fragment mode (quotes, R9 QA-02)", () => {
  it.each([
    ["2. 목록에서 잘라 온 항목", "목록에서 잘라 온 항목"],
    ["7) 혼자", "혼자"],
    ["2024. 연도는 본문", "2024. 연도는 본문"],
  ])("%j → %j", (raw, expected) => {
    expect(plainForValidation(raw, "fragment")).toBe(expected);
  });
});

describe("autolinks (R9 QA-03)", () => {
  it.each([
    ["url <https://a.b/c?d=1>", "url https://a.b/c?d=1"],
    ["메일 <me@example.com> 끝", "메일 me@example.com 끝"],
    ["<b>태그</b>는 지움", "태그는 지움"],
  ])("%j → %j", (raw, expected) => {
    expect(plainForValidation(raw)).toBe(expected);
  });

  it("maps the autolink text to its raw position", () => {
    const raw = "x <https://a.b>";
    const n = normalizeDeliverableMarkdown(raw);
    const at = n.text.indexOf("https");
    const span = rawSpan(n, at, at + "https://a.b".length)!;
    expect(raw.slice(span.start, span.end)).toBe("https://a.b");
  });
});

describe("truncateNormalized", () => {
  const n = normalizeDeliverableMarkdown("가나다\n\n라마바\n사아자");

  it("keeps short text whole", () => {
    expect(truncateNormalized(n, 100)).toMatchObject({ text: n.text, truncated: false });
  });

  it("cuts at the last blank line inside the window", () => {
    expect(truncateNormalized(n, 9)).toMatchObject({ text: "가나다", truncated: true });
  });

  it("falls back to a line break, then a hard cut", () => {
    const lines = normalizeDeliverableMarkdown("가나다\n라마바사");
    expect(truncateNormalized(lines, 6).text).toBe("가나다");
    const flat = normalizeDeliverableMarkdown("가나다라마바");
    expect(truncateNormalized(flat, 4)).toMatchObject({ text: "가나다라", truncated: true });
  });

  it("returns nothing (truncated) with no room", () => {
    expect(truncateNormalized(n, 0)).toEqual({ text: "", map: [], truncated: true });
  });

  it("rawSpan rejects out-of-range spans", () => {
    expect(rawSpan(n, 0, 0)).toBeNull();
    expect(rawSpan(n, 0, n.text.length + 1)).toBeNull();
  });
});
