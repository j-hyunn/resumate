import { describe, expect, it } from "vitest";
import { CODE_BLOCK_MAX_LINES, normalizeDeliverableMarkdown, rawSpan, truncateNormalized } from "./deliverable-text";

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

  it("is deterministic", () => {
    const raw = "# A\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n```\ncode\n```";
    expect(normalizeDeliverableMarkdown(raw)).toEqual(normalizeDeliverableMarkdown(raw));
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
