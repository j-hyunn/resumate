import { describe, expect, it } from "vitest";
import { JD_FETCH_MIN_CHARS, JD_FETCH_RAW_TEXT_MAX } from "@/lib/contracts/jd-fetch";
import { splitJdSentences } from "@/server/ai/context-pack/jd";
import { sha256Hex } from "@/server/ai/hash";
import type { UserSupabaseClient } from "@/server/db/types";
import { normalizeJdRawText } from "@/server/services/application/raw-text";
import { createApplicationProject } from "@/server/services/application/write";
import { fakeSupabase } from "@/test/fake-supabase";
import { fetchJobDescription, htmlToMarkdown, markdownTextLength, truncate } from "./fetch";
import type { LookupFn } from "./ssrf";

/**
 * R16 — the fetched posting is Markdown (S-46's editor: TipTap + `@tiptap/markdown` + `TableKit`).
 * Network and DNS are injected (no real calls).
 */

const publicLookup: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }];
const url = "https://jobs.example.test/posting/1";
const page = (body: string) => `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;
function fetchOf(pages: Record<string, string>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const u = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const body = pages[u];
    return body === undefined ? new Response("missing", { status: 404 }) : new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  }) as unknown as typeof fetch;
}
const run = (pages: Record<string, string>, target = url) => fetchJobDescription({ url: target, userId: "u1" }, { fetchImpl: fetchOf(pages), lookup: publicLookup, rateLimiter: null });
const LONG = "백엔드 개발자를 모십니다 자격 요건과 우대 사항을 확인해 주세요 ".repeat(8);

describe("htmlToMarkdown — blocks and inline", () => {
  it("headings, lists, bold, italic, line breaks; blocks separated by exactly one blank line", () => {
    const md = htmlToMarkdown(
      `<h2>주요 업무</h2><div><div><p>결제 API를 <strong>개발</strong>하고 <em>운영</em>합니다.<br>장애 대응도 합니다.</p></div></div>` +
        `<h3>자격 요건</h3><ul><li>Java <b>3년</b> 이상</li><li><p>Kafka 경험</p></li></ul>` +
        `<h4>절차</h4><ol><li>서류</li><li>면접</li></ol><p>끝</p>`,
    );
    expect(md).toBe(
      [
        "## 주요 업무",
        "",
        "결제 API를 **개발**하고 _운영_합니다.",
        "장애 대응도 합니다.",
        "",
        "### 자격 요건",
        "",
        "- Java **3년** 이상",
        "- Kafka 경험",
        "",
        "#### 절차",
        "",
        "1. 서류",
        "1. 면접",
        "",
        "끝",
      ].join("\n"),
    );
    // Never three newlines in a row — normalizeText keeps a single blank line between blocks.
    expect(md).not.toMatch(/\n{3,}/);
  });

  it("h1–h6 map to # … ###### and flatten inner tags", () => {
    const md = htmlToMarkdown([1, 2, 3, 4, 5, 6].map((n) => `<h${n}><b>제목</b> ${n}</h${n}>`).join(""));
    expect(md.split("\n\n")).toEqual(["# 제목 1", "## 제목 2", "### 제목 3", "#### 제목 4", "##### 제목 5", "###### 제목 6"]);
  });

  it("italic uses _ (never *, which reads as a list marker at a line start)", () => {
    const md = htmlToMarkdown(`<p><i>우대</i> 사항</p>`);
    expect(md).toBe("_우대_ 사항");
    expect(md).not.toContain("*");
  });

  it("links keep their text only — no URL, no tracking token (CF-A16)", () => {
    const md = htmlToMarkdown(`<p><a href="https://x.test/apply?utm_source=job&token=secret">지원하기</a> 버튼</p>`);
    expect(md).toBe("지원하기 버튼");
    expect(md).not.toMatch(/https?:|utm_source|secret|\]\(/);
  });

  it("drops images, scripts and styles; <i> is not confused with <img> / <iframe>", () => {
    const md = htmlToMarkdown(`<p>본문<img src="a.png" alt="광고 이미지"></p><script>var x=1</script><style>p{}</style><iframe src="x"></iframe><p><i>강조</i></p>`);
    expect(md).toBe("본문\n\n_강조_");
  });

  it("emphasis edge cases: empty runs vanish, spaces stay outside the markers, a block inside drops the emphasis", () => {
    expect(htmlToMarkdown(`<p>가<b> </b>나</p>`)).toBe("가 나");
    expect(htmlToMarkdown(`<p>가<b> 주요 </b>나</p>`)).toBe("가 **주요** 나");
    expect(htmlToMarkdown(`<b><p>첫 문단</p><p>둘째 문단</p></b>`)).toBe("첫 문단\n\n둘째 문단");
  });

  it("does not escape Markdown characters in the posting's own text [가정]", () => {
    expect(htmlToMarkdown(`<p>C# 개발자 *우대* snake_case</p>`)).toBe("C# 개발자 *우대* snake_case");
  });
});

describe("htmlToMarkdown — GFM tables (R16, UI 확인 2026-11-12)", () => {
  it("<th> row is the header, followed by | --- |; blank lines around the table", () => {
    const md = htmlToMarkdown(`<p>앞</p><table><tr><th>직무</th><th>인원</th></tr><tr><td>백엔드</td><td>2명</td></tr></table><p>뒤</p>`);
    expect(md).toBe(["앞", "", "| 직무 | 인원 |", "| --- | --- |", "| 백엔드 | 2명 |", "", "뒤"].join("\n"));
  });

  it("no <th>: the first row becomes the header (GFM needs one)", () => {
    const md = htmlToMarkdown(`<table><tbody><tr><td>근무지</td><td>서울</td></tr><tr><td>형태</td><td>정규직</td></tr></tbody></table>`);
    expect(md).toBe(["| 근무지 | 서울 |", "| --- | --- |", "| 형태 | 정규직 |"].join("\n"));
  });

  it("escapes | in a cell and folds line breaks / blocks into one line", () => {
    const md = htmlToMarkdown(`<table><tr><th>항목</th><th>내용</th></tr><tr><td>A|B</td><td><p>첫 줄</p><p>둘째<br>줄</p></td></tr></table>`);
    expect(md.split("\n")[2]).toBe("| A\\|B | 첫 줄 둘째 줄 |");
    expect(md).not.toContain("<br");
  });

  it("colspan pads with empty cells; ragged rows are padded to the widest", () => {
    const md = htmlToMarkdown(`<table><tr><th>구분</th><th>조건</th><th>비고</th></tr><tr><td colspan="2">공통</td><td>필수</td></tr><tr><td>단독</td></tr></table>`);
    expect(md.split("\n")).toEqual(["| 구분 | 조건 | 비고 |", "| --- | --- | --- |", "| 공통 |  | 필수 |", "| 단독 |  |  |"]);
  });

  it("rowspan reserves the column in the rows below", () => {
    const md = htmlToMarkdown(`<table><tr><th>팀</th><th>직무</th></tr><tr><td rowspan="2">결제</td><td>백엔드</td></tr><tr><td>프론트</td></tr></table>`);
    expect(md.split("\n")).toEqual(["| 팀 | 직무 |", "| --- | --- |", "| 결제 | 백엔드 |", "|  | 프론트 |"]);
  });

  it("bold and links in a cell follow the same rules (**, text only)", () => {
    const md = htmlToMarkdown(`<table><tr><th>항목</th></tr><tr><td><b>필수</b> <a href="https://x.test/?t=1">안내</a></td></tr></table>`);
    expect(md.split("\n")[2]).toBe("| **필수** 안내 |");
  });

  it("entities in a cell are decoded once (no double decode) and the escape survives", () => {
    const md = htmlToMarkdown(`<table><tr><th>a</th></tr><tr><td>&amp;lt;b&amp;gt; &#124; x</td></tr></table>`);
    expect(md.split("\n")[2]).toBe("| &lt;b&gt; \\| x |");
  });
});

describe("markdownTextLength — syntax doesn't count (fetch_too_short, R16)", () => {
  it("drops heading / list markers, **, _…_ and table syntax", () => {
    expect(markdownTextLength("## 제목")).toBe("제목".length);
    expect(markdownTextLength("- 하나\n1. 둘")).toBe("하나\n둘".length);
    expect(markdownTextLength("**굵게** _기울임_")).toBe("굵게 기울임".length);
    expect(markdownTextLength("| 가 | 나 |\n| --- | --- |\n| 다 | 라 |")).toBe("가 나\n다 라".length);
    // An escaped pipe is content.
    expect(markdownTextLength("| A\\|B |")).toBe("A|B".length);
    // snake_case is not emphasis.
    expect(markdownTextLength("snake_case_name")).toBe("snake_case_name".length);
  });

  it("199 characters of text fails, 200 passes — however much syntax wraps them", async () => {
    const text = (n: number) => "가".repeat(n);
    const heavy = (n: number) => page(`<h1>${text(n)}</h1><ul><li><b></b></li></ul><table><tr><th></th></tr></table>`);
    expect(markdownTextLength(htmlToMarkdown(heavy(JD_FETCH_MIN_CHARS - 1)))).toBe(JD_FETCH_MIN_CHARS - 1);
    await expect(run({ [url]: heavy(JD_FETCH_MIN_CHARS - 1) })).rejects.toMatchObject({ code: "fetch_too_short" });
    await expect(run({ [url]: heavy(JD_FETCH_MIN_CHARS) })).resolves.toMatchObject({ rawText: `# ${text(JD_FETCH_MIN_CHARS)}` });
    // List + bold syntax around 199 characters still fails; 200 passes.
    const wrapped = (n: number) => page(`<ul><li><b>${text(n)}</b></li></ul>`);
    expect(htmlToMarkdown(wrapped(JD_FETCH_MIN_CHARS - 1))).toBe(`- **${text(JD_FETCH_MIN_CHARS - 1)}**`);
    await expect(run({ [url]: wrapped(JD_FETCH_MIN_CHARS - 1) })).rejects.toMatchObject({ code: "fetch_too_short" });
    await expect(run({ [url]: wrapped(JD_FETCH_MIN_CHARS) })).resolves.toBeDefined();
  });

  it("blank lines between paragraphs don't count; each line break counts once, as in the old plain text", () => {
    const md = "가가\n\n나나\n\n\n다다";
    expect(markdownTextLength(md)).toBe("가가\n나나\n다다".length);
  });
});

describe("truncate — 50,000 at a line boundary (R16)", () => {
  it("cuts at the last line break inside the cap, never splitting a ** pair", () => {
    const line = `**굵은 글씨** ${"가".repeat(980)}`;
    const md = Array.from({ length: 60 }, () => line).join("\n");
    const out = truncate(md);
    expect(out.length).toBeLessThanOrEqual(JD_FETCH_RAW_TEXT_MAX);
    expect(md.startsWith(out)).toBe(true);
    // Whole lines only: every line kept is a full original line.
    for (const l of out.split("\n")) expect(l).toBe(line);
    expect((out.match(/\*\*/g)?.length ?? 0) % 2).toBe(0);
  });

  it("a single over-long line is cut hard and an unmatched ** is dropped", () => {
    const md = `${"가".repeat(JD_FETCH_RAW_TEXT_MAX - 3)}**굵게**`;
    const out = truncate(md);
    expect(out.length).toBeLessThanOrEqual(JD_FETCH_RAW_TEXT_MAX);
    expect(out).not.toContain("**");
  });

  it("text under the cap is returned as is", () => {
    expect(truncate("## 짧음\n\n- 하나")).toBe("## 짧음\n\n- 하나");
  });

  // QA-R16-03: a line break early in the window must not throw the rest of the posting away.
  it("short title + one 60,000-character paragraph: cut hard at the cap, not back to the title", () => {
    const md = `## 제목\n\n${"가".repeat(60_000)}`;
    const out = truncate(md);
    expect(out).toBe(md.slice(0, JD_FETCH_RAW_TEXT_MAX));
    expect(markdownTextLength(out)).toBeGreaterThan(JD_FETCH_MIN_CHARS);
  });

  it("300-character intro + 60,000-character paragraph keeps 50,000 characters", () => {
    const md = `${"소개".repeat(150)}\n${"나".repeat(60_000)}`;
    expect(truncate(md)).toHaveLength(JD_FETCH_RAW_TEXT_MAX);
  });

  it("a line break in the last 10 % of the cap is still a clean cut; one just before it is not", () => {
    const at = (n: number) => `${"가".repeat(n)}\n${"나".repeat(60_000)}`;
    expect(truncate(at(JD_FETCH_RAW_TEXT_MAX * 0.9))).toBe("가".repeat(JD_FETCH_RAW_TEXT_MAX * 0.9));
    expect(truncate(at(JD_FETCH_RAW_TEXT_MAX * 0.9 - 1))).toHaveLength(JD_FETCH_RAW_TEXT_MAX);
  });

  it("a hard cut through a **…** run drops only the unpaired marker, keeping the text", () => {
    const md = `## 제목\n\n앞 **${"굵".repeat(60_000)}**`;
    const out = truncate(md);
    expect(out).toBe(`## 제목\n\n앞 ${"굵".repeat(JD_FETCH_RAW_TEXT_MAX - 11)}`);
    // A ** pair closed before the cut on the same line is kept.
    const closed = truncate(`## 제목\n\n**필수** ${"가".repeat(60_000)}`);
    expect(closed.startsWith("## 제목\n\n**필수** 가")).toBe(true);
    expect(closed).toHaveLength(JD_FETCH_RAW_TEXT_MAX);
  });

  it("end to end: a short heading over a 60,000-character paragraph is fetched, not fetch_too_short", async () => {
    const result = await run({ [url]: page(`<h1>백엔드 개발자</h1><p>${"가".repeat(60_000)}</p>`) });
    expect(result.rawText.startsWith("# 백엔드 개발자\n\n가")).toBe(true);
    expect(result.rawText).toHaveLength(JD_FETCH_RAW_TEXT_MAX);
  });
});

describe("fixtures: frames and JobPosting come out as Markdown", () => {
  it("사람인 detail frame: headings, list, bold, blank lines between paragraphs", async () => {
    const landing = "https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=1";
    const frame = "https://www.saramin.co.kr/zf_user/jobs/relay/view-detail?rec_idx=1&view_type=detail";
    const result = await run(
      {
        [landing]: page(`<div class="gnb">사람인 메뉴</div><iframe src="/zf_user/jobs/relay/view-detail?rec_idx=1&view_type=detail"></iframe>`),
        [frame]: page(`<h3>주요 업무</h3><p>${LONG}</p><h3>자격 요건</h3><ul><li><strong>Java</strong> 3년 이상</li><li>Kafka 경험</li></ul>`),
      },
      landing,
    );
    expect(result.rawText).toContain("### 주요 업무\n\n");
    expect(result.rawText).toContain("### 자격 요건\n\n- **Java** 3년 이상\n- Kafka 경험");
    expect(result.rawText).not.toContain("사람인 메뉴");
  });

  it("JobPosting.description HTML is converted the same way", async () => {
    const description = `<h2>자격 요건</h2><ol><li>${LONG}</li></ol><p><b>우대</b>: <i>Kotlin</i></p>`;
    const ld = JSON.stringify({ "@type": "JobPosting", title: "백엔드", hiringOrganization: { name: "에이비씨" }, description });
    const result = await run({ [url]: page(`<script type="application/ld+json">${ld}</script><p>짧음</p>`) });
    expect(result.rawText).toBe(`## 자격 요건\n\n1. ${LONG.trim()}\n\n**우대**: _Kotlin_`);
  });
});

/**
 * CF-A17 — "가져온 문자열 = 저장 요청 문자열" at the server boundary. The screen receives `rawText`,
 * holds it in the editor (UI: not re-exported until the user edits), and sends it to the preview
 * and to create. Both server paths run `normalizeJdRawText` first; the fetch output is already in
 * that normal form, so normalizing is a no-op and the hash / split / stored text are the bytes the
 * screen got — a second guard in case an editor round-trip ever changes nothing but whitespace.
 */
describe("CF-A17 — fetched Markdown hashes the same at the create boundary", () => {
  it("fetch output is a fixed point of normalizeJdRawText, and create hashes / splits / stores exactly it", async () => {
    // NFD Hangul from a site, CRLF in the markup, surrounding whitespace.
    const nfd = "한국 백엔드".normalize("NFD");
    const result = await run({ [url]: page(`\r\n  <h2>${nfd} 채용</h2>\r\n<p>${LONG}</p>\r\n<ul><li><b>Java</b> 3년</li></ul>  `) });
    const fetched = result.rawText;
    expect(normalizeJdRawText(fetched)).toBe(fetched);
    expect(fetched).toBe(fetched.normalize("NFC"));

    const db = fakeSupabase({}, () => ({ application_project_id: "p", job_description_id: "j", name: null, name_source: null, extraction_status: "pending", ai_run_allowed: false, created: true, preview_applied: false, preview_skip_reason: null }));
    await createApplicationProject(db.client as UserSupabaseClient, { id: "00000000-0000-4000-8000-0000000000a1", rawText: fetched });
    const args = db.rpcCalls[0]!.args as { p_raw_text: string; p_raw_text_hash: string; p_sentences: Array<{ text: string; start: number; end: number }> };
    expect(args.p_raw_text).toBe(fetched);
    // The preview computes `sha256Hex(normalizeJdRawText(rawText))` (preview.ts) — the same value.
    expect(args.p_raw_text_hash).toBe(sha256Hex(normalizeJdRawText(fetched)));
    expect(args.p_raw_text_hash).toBe(sha256Hex(fetched));
    expect(args.p_sentences).toEqual(splitJdSentences(fetched));
    for (const s of args.p_sentences) expect(fetched.slice(s.start, s.end)).toBe(s.text);
  });
});
