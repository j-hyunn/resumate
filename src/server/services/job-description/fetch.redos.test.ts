import { describe, expect, it } from "vitest";
import { JD_FETCH_RAW_TEXT_MAX } from "@/lib/contracts/jd-fetch";
import { bodyFrameUrl, extractJobPosting, fetchJobDescription, htmlToMarkdown, markdownTextLength, truncate } from "./fetch";
import * as r16 from "./__tests__/fetch.r16-reference";
import {
  boilerplateOpenTags,
  closeTagFinder,
  collapsePipes,
  frameSrcValues,
  ldJsonBodies,
  leadingSpaceLength,
  removeElements,
  replaceAnyTag,
  replaceComments,
  replaceNamedTags,
  replacePairedElements,
  splitAtOpenTags,
  stripCdataOpen,
  tableCells,
  tableRows,
  trailingSpaceLength,
} from "./html-scan";

/**
 * Hotfix QA-R16-02 — the JD fetch HTML pass was super-linear on attacker-chosen pages (a logged-in
 * user only needs to publish one page): 540 KB took 11.9 s, 2 MB reached the 60 s `maxDuration`,
 * and since the regexes run synchronously the 10 s deadline timer could not fire and other
 * requests on the instance stalled.
 *
 * R16 (QA-R16-01) added the Markdown conversion, whose element regexes (`<b>…</b>`, `<em>`, `<h1>`,
 * lists, tables) were O(n²) too — 140~170 s on 2 MB. It now runs on the same linear scanners.
 *
 * Two promises are pinned here:
 *   1. **Output is byte-identical** to the R16 regex implementation — each scanner against the
 *      regex it replaces, and the whole pass against the frozen R16 implementation
 *      (`__tests__/fetch.r16-reference.ts`, R15's pass + Markdown), on a realistic corpus and on
 *      fuzzed input. (NUL is the one intended difference: it is now dropped.)
 *   2. **Time is linear** — a size ladder bails out early on any super-linear regression (so this
 *      file can't hang the runner), then a 2 MB hostile page must finish within 1 s.
 */

// ---------------- deterministic fuzz ----------------

/** mulberry32 — a fixed-seed PRNG so a failure reproduces. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tokens that exercise every branch: tag names (any case), quotes, `=`, `>`, comments, CDATA, spaces. */
const TOKENS = [
  "<", ">", "</", "/", "<!--", "-->", "-", "!", "=", '"', "'", " ", "  ", "\t", "\n", " ", "﻿", " ",
  "div", "DIV", "Div", "section", "ul", "ol", "dl", "table", "TABLE", "td", "th", "tr", "p", "pre", "price", "br", "h1", "h7", "li",
  "script", "SCRIPT", "scripts", "style", "nav", "header", "head", "iframe", "IFRAME", "frame", "frames", "noscript", "svg",
  "src", "SRC", "data-src", "class", "CLASS", "id", "Id", "myid", "type", "TYPE", "application/ld+json", "APPLICATION/LD+JSON",
  // Word characters glued to an attribute name: `\bsrc` must refuse `xsrc` / `_src`, while `class`,
  // `id` and `type` have no `\b` in R15's regexes and must still match inside `myclass` / `xtype`.
  "xsrc", "_src", "Xsrc", "myclass", "xtype",
  // R16 Markdown: emphasis, headings, lists, tables, spans, Markdown characters in the text.
  "b", "B", "strong", "STRONG", "bold", "em", "EM", "i", "I", "img", "h2", "H3", "h6", "tbody", "thead", "tfoot", "span", "a",
  "colspan=2", "rowspan='3'", "colspan=99", "|", "\\|", "*", "**", "_", "#", "- ", "1. ", "---", "| --- |", "\u0001",
  "gnb", "menu", "footer", "side-bar", "related", "job", "x", "_", "&amp;", "&lt;", "&#x41;", "&#65;", "가", "공고",
  "<![CDATA[", "]]>", "//", '{"@type":"JobPosting","title":"백엔드","hiringOrganization":{"name":"에이비씨"}}',
  "view-detail?rec_idx=1", "GIReadContentFrame?gno=1", "/zf_user/jobs/relay/view-detail",
];

function fuzz(rand: () => number, maxTokens: number): string {
  const n = 1 + Math.floor(rand() * maxTokens);
  let out = "";
  for (let i = 0; i < n; i++) out += TOKENS[Math.floor(rand() * TOKENS.length)];
  return out;
}

/** Structured-ish fuzz: real tags with random attributes and bodies, sometimes unclosed. */
function fuzzHtml(rand: () => number, depth = 0): string {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
  const tags = [
    "div", "section", "ul", "li", "table", "tr", "td", "p", "script", "style", "iframe", "frame", "nav", "span", "a", "h2",
    "b", "strong", "em", "i", "h1", "h3", "ol", "th", "img", "br", "tbody", "thead", "pre", "blockquote",
  ];
  const attrs = [
    'class="gnb"', "class='job'", 'id="menu"', 'class="x related"', 'src="/zf_user/jobs/relay/view-detail?rec_idx=1"', 'type="application/ld+json"',
    "data-x=1", 'title="a>b"', 'class="a<b"', "colspan=2", 'rowspan="2"', "colspan=60 rowspan=3", 'xsrc="/zf_user/jobs/relay/view-detail?rec_idx=2"', '_src="/a"', 'myclass="gnb"', 'xtype="application/ld+json"', 'src=""', "",
  ];
  let out = "";
  const parts = 1 + Math.floor(rand() * 4);
  for (let i = 0; i < parts; i++) {
    const r = rand();
    if (r < 0.35 || depth > 3) out += pick(["공고 본문", "자격 요건", " ", "  ", "&amp; x", "<!-- c -->", "<br>", "<br/>", "]]>", '{"@type":"JobPosting","title":"t"}', "a|b", "*별*", "_밑_", "# 샵", "\n"]);
    else {
      const tag = pick(tags);
      const open = `<${rand() < 0.2 ? tag.toUpperCase() : tag}${rand() < 0.7 ? " " + pick(attrs) : ""}${rand() < 0.1 ? "" : ">"}`;
      out += open + fuzzHtml(rand, depth + 1) + (rand() < 0.8 ? `</${tag}${rand() < 0.2 ? " " : ""}>` : "");
    }
  }
  return out;
}

const CASES = 4000;

function eachFuzz(seed: number, test: (s: string) => void) {
  const rand = prng(seed);
  for (let i = 0; i < CASES; i++) {
    const s = i % 2 === 0 ? fuzz(rand, 30) : fuzzHtml(rand);
    try {
      test(s);
    } catch (err) {
      throw new Error(`seed ${seed} case ${i} input ${JSON.stringify(s)}: ${(err as Error).message}`);
    }
  }
}

// ---------------- 1. each scanner == the regex it replaces ----------------

const BLOCK = new Set([
  "p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "header", "footer", "blockquote",
  "pre", "dd", "dt", "dl", "ul", "ol", "table", "thead", "tbody", "figure", "figcaption", "hr", "address", "main",
]);
const BLOCK_RE = /<\/?(p|div|br|li|tr|h[1-6]|section|article|header|footer|blockquote|pre|dd|dt|dl|ul|ol|table|thead|tbody|figure|figcaption|hr|address|main)\b[^>]*>/gi;
const DROPPED = ["script", "style", "noscript", "template", "svg", "head", "nav", "header", "footer", "aside", "form", "button", "select", "iframe"];

describe("linear scanners reproduce the R15 regexes exactly (differential fuzz)", () => {
  it("replaceAnyTag == /<[^>]*>/g", () => eachFuzz(1, (s) => expect(replaceAnyTag(s, " ")).toBe(s.replace(/<[^>]*>/g, " "))));
  it("replaceComments == /<!--[\\s\\S]*?-->/g", () => eachFuzz(2, (s) => expect(replaceComments(s, " ")).toBe(s.replace(/<!--[\s\S]*?-->/g, " "))));
  it("replaceNamedTags(td|th) == /<(td|th)\\b[^>]*>/gi", () =>
    eachFuzz(3, (s) => expect(replaceNamedTags(s, new Set(["td", "th"]), false, "\t")).toBe(s.replace(/<(td|th)\b[^>]*>/gi, "\t"))));
  it("replaceNamedTags(BLOCK_TAGS, slash) == BLOCK_TAGS regex", () => eachFuzz(4, (s) => expect(replaceNamedTags(s, BLOCK, true, "\n")).toBe(s.replace(BLOCK_RE, "\n"))));

  it("removeElements + open-tag pass == the two stripDroppedElements regexes, per tag", () =>
    eachFuzz(5, (s) => {
      for (const tag of DROPPED) {
        expect(removeElements(s, tag, " ")).toBe(s.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}\\s*>`, "gi"), " "));
        expect(replaceNamedTags(s, new Set([tag]), false, " ")).toBe(s.replace(new RegExp(`<${tag}\\b[^>]*/?>`, "gi"), " "));
      }
    }));

  it("boilerplateOpenTags == the O(n³) open regex (index, end, name, captured attribute)", () =>
    eachFuzz(6, (s) => {
      const re = /<(div|section|ul|ol|dl|table)\b[^>]*(?:class|id)\s*=\s*["']([^"']*)["'][^>]*>/gi;
      const want: unknown[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(s)) !== null) want.push({ index: m.index, end: re.lastIndex, name: m[1]!.toLowerCase(), value: m[2]! });
      expect([...boilerplateOpenTags(s)]).toEqual(want);
    }));

  it("frameSrcValues == the O(n³) iframe regex captures", () =>
    eachFuzz(7, (s) => {
      const re = /<(?:iframe|frame)\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
      const want: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(s)) !== null) want.push(m[1]!);
      expect(frameSrcValues(s)).toEqual(want);
    }));

  it("ldJsonBodies == the JSON-LD <script> regex captures", () =>
    eachFuzz(8, (s) => {
      const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi;
      const want: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(s)) !== null) want.push(m[1]!);
      expect(ldJsonBodies(s)).toEqual(want);
    }));

  it("closeTagFinder == R15 findCloseTag from every position right after a `>`", () =>
    eachFuzz(9, (s) => {
      for (const tag of ["div", "section", "ul", "ol", "dl", "table"]) {
        const find = closeTagFinder(s, tag);
        for (let from = 0; from <= s.length; from++) {
          if (from > 0 && s[from - 1] !== ">") continue;
          const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
          re.lastIndex = from;
          let depth = 1;
          let want = -1;
          let m: RegExpExecArray | null;
          while ((m = re.exec(s)) !== null) {
            depth += m[1] === "/" ? -1 : 1;
            if (depth === 0) {
              want = re.lastIndex;
              break;
            }
          }
          expect(find(from)).toBe(want);
        }
      }
    }));

  it("stripCdataOpen == /^\\s*(?:\\/\\/)?\\s*<!\\[CDATA\\[/", () =>
    eachFuzz(10, (s) => expect(stripCdataOpen(s)).toBe(s.replace(/^\s*(?:\/\/)?\s*<!\[CDATA\[/, ""))));
});

// ---------------- 1b. the R16 Markdown scanners == the R16 regexes ----------------

/** Captures every callback argument, so a scanner and its regex must agree on each match. */
const show = (name: string, inner: string) => `[${name}|${inner}]`;

describe("R16 Markdown scanners reproduce the R16 regexes exactly (differential fuzz)", () => {
  it("emphasis: replacePairedElements(strong|b, attrs) == /<(strong|b)(?:\\s[^>]*)?>([\\s\\S]*?)<\\/\\1\\s*>/gi", () =>
    eachFuzz(21, (s) => {
      expect(replacePairedElements(s, ["strong", "b"], "attrs", false, show)).toBe(
        s.replace(/<(strong|b)(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/gi, (_m, n: string, inner: string) => show(n, inner)),
      );
      expect(replacePairedElements(s, ["em", "i"], "attrs", false, show)).toBe(
        s.replace(/<(em|i)(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/gi, (_m, n: string, inner: string) => show(n, inner)),
      );
    }));

  it("headings: replacePairedElements(h1…h6, boundary) == /<h([1-6])\\b[^>]*>([\\s\\S]*?)<\\/h\\1\\s*>/gi", () =>
    eachFuzz(22, (s) =>
      expect(replacePairedElements(s, ["h1", "h2", "h3", "h4", "h5", "h6"], "boundary", false, (n, inner) => show(n.slice(1), inner))).toBe(
        s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_m, level: string, inner: string) => show(level, inner)),
      ),
    ));

  it("lists / tables: the tempered (innermost) form == the R16 regexes", () =>
    eachFuzz(23, (s) => {
      expect(replacePairedElements(s, ["ul", "ol"], "boundary", true, show)).toBe(
        s.replace(/<(ul|ol)\b[^>]*>((?:(?!<(?:ul|ol)\b)[\s\S])*?)<\/\1\s*>/gi, (_m, n: string, inner: string) => show(n, inner)),
      );
      expect(replacePairedElements(s, ["table"], "boundary", true, show)).toBe(
        s.replace(/<table\b[^>]*>((?:(?!<table\b)[\s\S])*?)<\/table\s*>/gi, (m, inner: string) => show(m.slice(1, 6), inner)),
      );
    }));

  it("tableRows / tableCells == the R16 row and cell matchAll", () =>
    eachFuzz(24, (s) => {
      expect(tableRows(s)).toEqual([...s.matchAll(/<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/table|$)/gi)].map((m) => m[1]!));
      expect(tableCells(s)).toEqual(
        [...s.matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)(?=<(?:td|th)\b|<\/tr\s*>|$)/gi)].map((m) => ({ name: m[1]!, attrs: m[2]!, body: m[3]! })),
      );
    }));

  it("splitAtOpenTags == split(/<li\\b[^>]*>/i)", () => eachFuzz(25, (s) => expect(splitAtOpenTags(s, "li")).toEqual(s.split(/<li\b[^>]*>/i))));

  it("replaceNamedTags(R16 block / structure / list-item / img sets) == the R16 regexes", () =>
    eachFuzz(26, (s) => {
      const md = new Set(["p", "div", "section", "article", "blockquote", "pre", "dd", "dt", "dl", "figure", "figcaption", "hr", "address", "main", "header", "footer", "thead", "tbody", "tfoot"]);
      expect(replaceNamedTags(s, md, true, "\n\n")).toBe(
        s.replace(/<\/?(p|div|section|article|blockquote|pre|dd|dt|dl|figure|figcaption|hr|address|main|header|footer|thead|tbody|tfoot)\b[^>]*>/gi, "\n\n"),
      );
      expect(replaceNamedTags(s, new Set(["li", "tr", "td", "th", "table", "ul", "ol"]), true, "\n")).toBe(s.replace(/<\/?(li|tr|td|th|table|ul|ol)\b[^>]*>/gi, "\n"));
      expect(replaceNamedTags(s, new Set(["p", "div", "span", "section"]), true, " ")).toBe(s.replace(/<\/?(p|div|span|section)\b[^>]*>/gi, " "));
      expect(replaceNamedTags(s, new Set(["img"]), false, " ")).toBe(s.replace(/<img\b[^>]*>/gi, " "));
      expect(replaceNamedTags(s, new Set(["li"]), false, "\n- ")).toBe(s.replace(/<li\b[^>]*>/gi, "\n- "));
    }));

  it("leading / trailing space and pipe collapsing == /^\\s*/, /\\s*$/, /\\s*\\|\\s*/g", () =>
    eachFuzz(27, (s) => {
      expect(leadingSpaceLength(s)).toBe(/^\s*/.exec(s)![0].length);
      expect(trailingSpaceLength(s)).toBe(/\s*$/.exec(s)![0].length);
      expect(collapsePipes(s)).toBe(s.replace(/\s*\|\s*/g, " "));
    }));
});

// ---------------- 2. the whole pass == R16, byte for byte ----------------

const page = (body: string) => `<!doctype html><html><head><title>t</title><style>p{}</style></head><body>${body}</body></html>`;
const LONG = "백엔드 개발자를 모십니다. 자격 요건과 우대 사항을 확인해 주세요. ".repeat(12);
const posting = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ "@context": "https://schema.org", "@type": "JobPosting", title: "백엔드 개발자", hiringOrganization: { "@type": "Organization", name: "에이비씨페이" }, description: `<p>${LONG}</p>`, ...extra });

/** Realistic pages: chrome, boilerplate blocks, JSON-LD (plain / array / @graph / CDATA), frames, tables, lists, emphasis, entities. */
const CORPUS: Record<string, string> = {
  plain: page(`<h2>주요 업무</h2><p>API 개발 &amp; 운영</p><h2>자격 요건</h2><ul><li>Java 3년</li><li>Kafka</li></ul><p>${LONG}</p>`),
  chrome: page(
    `<header><nav class="gnb">메뉴 홈 로그인</nav></header><div class="gnb-wrap side-bar">메뉴</div><div id="content"><h2>주요 업무</h2><p>${LONG}</p>` +
      `<div class="related list"><ul><li>추천 공고</li></ul></div><section class="x"><div class="banner">광고</div>본문 계속</section></div>` +
      `<footer>회사소개 이용약관</footer><script>var x = "<div>";</script>`,
  ),
  nested_boilerplate: page(`<div class="menu"><div><div class="x">안</div></div></div><div class="job"><p>${LONG}</p></div><ul class="sns"><li>공유</li></ul>`),
  unclosed_boilerplate: page(`<div class="gnb"><p>닫히지 않은 메뉴</p><p>${LONG}</p>`),
  ldjson: page(`<script type="application/ld+json">${posting()}</script><p>짧음</p>`),
  ldjson_array_graph: page(
    `<script type='application/ld+json'>${JSON.stringify([{ "@type": "WebSite" }, JSON.parse(posting())])}</script>` +
      `<script TYPE="APPLICATION/LD+JSON">${JSON.stringify({ "@graph": [{ "@type": ["Thing", "JobPosting"], title: "가나다" }] })}</script>`,
  ),
  ldjson_cdata: page(`<script type="application/ld+json">\n  //<![CDATA[\n${posting()}\n//]]>  \n</script><script type="application/ld+json">{ oops </script>`),
  saramin_landing: `<html><body><div class="gnb">사람인 메뉴</div><iframe id="x" src="/zf_user/jobs/relay/view-detail?rec_idx=1&amp;view_type=detail" title="a>b"></iframe><iframe src="https://ads.example/x"></iframe></body></html>`,
  jobkorea_landing: `<html><body><iframe name="gib_frame" SRC='/Recruit/Content/GIReadContentFrame?gno=1'></iframe></body></html>`,
  tables: page(`<table class="info"><thead><tr><th>구분</th><th>내용</th></tr></thead><tbody><tr><td>근무지</td><td>서울 &nbsp; 강남</td></tr></tbody></table><p>${LONG}</p>`),
  table_spans_nested: page(
    `<table><tr><th colspan=2>모집 부문</th><th rowspan="2">인원</th></tr><tr><td>백엔드 | API</td><td><b>필수</b> <i>우대</i></td></tr>` +
      `<tr><td><table><tr><td>안쪽</td><td>표</td></tr></table></td><td>3</td><td>x</td></tr></table><table><tr><td></td></tr></table>`,
  ),
  lists_nested: page(`<ol><li><p>첫째</p><ul><li>안쪽 <b>굵게</b></li><li></li></ul></li><li>둘째<br>줄바꿈</li></ol><li>고아 항목</li><UL><LI>대문자</LI></UL>`),
  emphasis_headings: page(
    `<h1>제목 <b>굵게</b><br>둘째</h1><H3 class="x">소제목</H3><p><strong> 주요 </strong>업무 <b> </b><em>기울임</em> <i class="x">i</i> <b>블록<p>안</p></b></p><h2></h2><h4>x</h5>`,
  ),
  comments_entities: page(`<!-- <div class="gnb">hidden</div> --><p>&lt;b&gt; &#x41;&#65; &unknown; &amp;amp;</p><!--x--><pre>  코드\n  블록 </pre><p>${LONG}</p>`),
  attr_with_gt_lt: page(`<div title="a>b" class="job">본문 ${LONG}</div><p data-x="1<2">끝</p><img src="a.png" alt="x>y"><b title="a<b">굵게</b>`),
  uppercase: page(`<DIV CLASS="Menu">메뉴</DIV><P>${LONG}</P><BR><SCRIPT>x</SCRIPT><Table><TR><TD>a</TD></TR></Table><STRONG>S</STRONG><EM>E</EM>`),
  markdown_in_text: page(`<p>* 별표로 시작 _밑줄_ # 샵 | 파이프 1. 숫자</p><p>**이미 굵음**</p>`),
  big_realistic: page(
    "<div class='job'><h2>주요 업무</h2><ul><li><b>필수</b>: Java 3년 이상</li><li>Spring 경험</li></ul><table><tr><th>구분</th><th>내용</th></tr><tr><td>근무지</td><td>서울</td></tr></table><p>문단 <i>강조</i> 링크 <a href='https://x/y?t=1'>여기</a></p></div>".repeat(1500),
  ),
};

describe("the whole pass is byte-identical to R16 (realistic corpus)", () => {
  it.each(Object.keys(CORPUS))("htmlToMarkdown: %s", (name) => {
    expect(htmlToMarkdown(CORPUS[name]!)).toBe(r16.htmlToMarkdown(CORPUS[name]!));
  });

  it.each(Object.keys(CORPUS))("markdownTextLength: %s", (name) => {
    const md = r16.htmlToMarkdown(CORPUS[name]!);
    expect(markdownTextLength(md)).toBe(r16.markdownTextLength(md));
  });

  it.each(Object.keys(CORPUS))("extractJobPosting: %s", (name) => {
    expect(extractJobPosting(CORPUS[name]!)).toEqual(r16.extractJobPosting(CORPUS[name]!));
  });

  it.each([
    ["https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=1", "saramin_landing"],
    ["https://www.jobkorea.co.kr/Recruit/GI_Read/1", "jobkorea_landing"],
    ["https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=1", "jobkorea_landing"],
    ["https://jobs.example.test/1", "saramin_landing"],
  ])("bodyFrameUrl(%s, %s)", (pageUrl, name) => {
    expect(bodyFrameUrl(new URL(pageUrl), CORPUS[name]!)).toBe(r16.bodyFrameUrl(new URL(pageUrl), CORPUS[name]!));
  });
});

describe("the whole pass is byte-identical to R16 (fuzzed input)", () => {
  const stripNul = (s: string) => s.replace(/\u0000/g, "");
  it("htmlToMarkdown(s) == R16 htmlToMarkdown(s without NUL)", () => eachFuzz(11, (s) => expect(htmlToMarkdown(s)).toBe(r16.htmlToMarkdown(stripNul(s)))));
  it("markdownTextLength on fuzzed Markdown and on raw fuzz", () =>
    eachFuzz(14, (s) => {
      const md = r16.htmlToMarkdown(stripNul(s));
      expect(markdownTextLength(md)).toBe(r16.markdownTextLength(md));
      expect(markdownTextLength(s)).toBe(r16.markdownTextLength(s));
    }));
  it("extractJobPosting", () => eachFuzz(12, (s) => expect(extractJobPosting(s)).toEqual(r16.extractJobPosting(s))));
  it("bodyFrameUrl (사람인 / 잡코리아 / other hosts)", () =>
    eachFuzz(13, (s) => {
      for (const u of ["https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=1", "https://www.jobkorea.co.kr/x", "https://jobs.example.test/1"]) {
        expect(bodyFrameUrl(new URL(u), s)).toBe(r16.bodyFrameUrl(new URL(u), s));
      }
    }));
});

// ---------------- NUL (hotfix item 4 / QA-R16-04) ----------------

describe("NUL never reaches rawText or the JobPosting fields (Postgres refuses it)", () => {
  it("htmlToMarkdown drops NUL first — the only intended change from R16", () => {
    const html = page(`<p>공고\u0000 본문\u0000</p>`);
    // `<head>` (title, style) is a dropped element, so only the body text remains.
    expect(htmlToMarkdown(html)).toBe("공고 본문");
    expect(htmlToMarkdown(html)).not.toContain("\u0000");
  });

  it("a page can't plant a raw table token: the real table appears once (QA-R16-04)", () => {
    const md = htmlToMarkdown(page(`<p>\u0000TABLE0\u0000</p><h2>\u0000TABLE0\u0000</h2><table><tr><th>구분</th></tr><tr><td>값</td></tr></table>`));
    expect(md.match(/\| 구분 \|/g)).toHaveLength(1);
    expect(md).toContain("TABLE0");
    expect(md).not.toContain("\u0000");
  });

  it("a NUL inside a JSON-LD string (JSON escape) is dropped from title / company", () => {
    const ld = JSON.stringify({ "@type": "JobPosting", title: "백엔드\u0000 개발자", hiringOrganization: { name: "에이\u0000비씨" } });
    expect(extractJobPosting(page(`<script type="application/ld+json">${ld}</script>`))).toMatchObject({ title: "백엔드 개발자", companyName: "에이비씨" });
  });

  it("end to end: a page full of NUL gives a rawText without NUL", async () => {
    const body = page(`<p>${"가\u0000".repeat(400)}</p>`);
    const r = await fetchJobDescription(
      { url: "https://jobs.example.test/1", userId: "u" },
      { lookup: async () => [{ address: "93.184.216.34", family: 4 }], fetchImpl: (async () => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })) as unknown as typeof fetch, rateLimiter: null },
    );
    expect(r.rawText).not.toContain("\u0000");
    expect(r.rawText).toBe("가".repeat(400));
  });
});

// ---------------- 3. time is linear (hotfix item 5, QA-R16-01) ----------------

const rep = (unit: string, total: number) => unit.repeat(Math.floor(total / unit.length));
/** `open × k` then `close × k` filling `total` — deep nesting, every level closed. */
const nest = (open: string, close: string, total: number) => {
  const k = Math.floor(total / (open.length + close.length));
  return open.repeat(k) + close.repeat(k);
};

/** QA's hostile inputs (`_workspace/backend/R16/03_backend-qa_report.md`) + the ones the fix targets. */
const ATTACKS: Record<string, (size: number) => string> = {
  // hotfix QA-R16-02 (R15 pass)
  unclosed_lt: (n) => rep("<", n),
  div_open_no_gt: (n) => rep("<div ", n),
  div_class_no_gt: (n) => rep('<div class="x" ', n),
  boilerplate_unclosed: (n) => rep('<div class="gnb">', n),
  one_tag_many_attrs: (n) => "<div " + rep('class="a" ', n),
  attr_value_no_close: (n) => '<div class="' + rep("a", n),
  comment_unclosed: (n) => rep("<!--", n),
  img_no_gt: (n) => rep("<img ", n),
  ldjson_unclosed: (n) => rep('<script type="application/ld+json">', n),
  script_no_gt: (n) => rep("<script ", n),
  ldjson_leading_ws: (n) => '<script type="application/ld+json">' + rep(" ", n) + "</script>",
  iframe_src_unclosed: (n) => rep('<iframe src="', n),
  iframe_many_attrs: (n) => "<iframe " + rep('src="x" ', n),
  td_no_gt: (n) => rep("<td ", n),
  block_no_gt: (n) => rep("<p ", n),
  // QA-R16-01 (R16 Markdown pass)
  b_unclosed: (n) => rep("<b>", n),
  strong_unclosed: (n) => rep("<strong>", n),
  i_unclosed: (n) => rep("<i>", n),
  em_text_unclosed: (n) => rep("<em>x", n),
  b_attr_no_gt: (n) => rep("<b ", n),
  h1_unclosed: (n) => rep("<h1>", n),
  h1_text_unclosed: (n) => rep("<h1>x", n),
  h_mismatched: (n) => rep("<h1>x</h2>", n),
  emphasis_inner_spaces: (n) => "<b>a" + rep(" ", n) + "b</b>",
  ul_li_unclosed: (n) => rep("<ul><li>", n),
  ul_no_gt: (n) => rep("<ul ", n),
  li_no_gt_in_list: (n) => "<ul>" + rep("<li ", n) + "</ul>",
  list_block_no_gt: (n) => "<ul><li>" + rep("<p ", n) + "</ul>",
  lists_nested_closed: (n) => nest("<ul><li>x", "</li></ul>", n),
  table_unclosed: (n) => rep("<table><tr><td>", n),
  table_no_gt: (n) => rep("<table ", n),
  tr_no_gt_in_table: (n) => "<table>" + rep("<tr ", n) + "</table>",
  td_no_gt_in_table: (n) => "<table><tr>" + rep("<td ", n) + "</table>",
  tables_nested_closed: (n) => nest("<table><tr><td>x", "</td></tr></table>", n),
  td_many: (n) => "<table><tr>" + rep("<td>x", n) + "</table>",
  // QA-R16-05: one row per 7 chars → ~284k rows at 2 MB (Math.max(...rows) threw RangeError).
  tr_many: (n) => "<table>" + rep("<tr><td>x", n) + "</table>",
  colspan_big: (n) => "<table>" + rep("<tr><td colspan=50>x", n) + "</table>",
  pipes_spaces: (n) => "<p>" + rep("|   ", n) + "</p>",
};

/** Everything the fetch route runs on a downloaded page, synchronously. */
function wholePass(html: string): void {
  bodyFrameUrl(new URL("https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=1"), html);
  const posting = extractJobPosting(html);
  const md = htmlToMarkdown(html);
  const desc = posting.descriptionHtml ? htmlToMarkdown(posting.descriptionHtml) : "";
  markdownTextLength(truncate(markdownTextLength(desc) > markdownTextLength(md) ? desc : md));
}

function timed(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

describe("hostile pages: linear time (hotfix QA-R16-02, QA-R16-01)", () => {
  /**
   * A super-linear regression can't be interrupted (the code is synchronous), so the ladder bails out
   * before the 2 MB step: a quadratic one fails at 128 KB within ~1 s, a cubic one at 32 KB within
   * seconds. The linear pass takes a few ms at those sizes.
   */
  it.each(Object.keys(ATTACKS))("%s: ladder 8 KB → 32 KB → 128 KB each < 250 ms, then 2 MB < 1 s", (name) => {
    const make = ATTACKS[name]!;
    for (const size of [8_000, 32_000, 128_000]) {
      const ms = timed(() => wholePass(make(size)));
      expect(ms, `${name} at ${size} chars took ${ms.toFixed(0)} ms`).toBeLessThan(250);
    }
    // Just under the 2 MB byte cap (ASCII = 1 byte per char), the most the route ever reads.
    const ms = timed(() => wholePass(make(1_990_000)));
    expect(ms, `${name} at 2 MB took ${ms.toFixed(0)} ms`).toBeLessThan(1_000);
  }, 30_000);

  it("the hostile shapes convert exactly as R16 did, at a size the R16 regexes can still handle", () => {
    for (const name of Object.keys(ATTACKS)) expect(htmlToMarkdown(ATTACKS[name]!(3_000)), name).toBe(r16.htmlToMarkdown(ATTACKS[name]!(3_000)));
  });

  it("a 284k-row table converts instead of throwing RangeError (QA-R16-05)", () => {
    const md = htmlToMarkdown(ATTACKS.tr_many!(1_990_000));
    expect(md.startsWith("| x |\n| --- |\n| x |")).toBe(true);
  });

  it("the full route on the slowest 2 MB page fails fast with fetch_too_short, well inside the 10 s budget", async () => {
    for (const size of [8_000, 128_000]) expect(timed(() => wholePass(ATTACKS.unclosed_lt!(size)))).toBeLessThan(250);
    // Wrapped like a real response (QA's harness): the trailing `>` turns the whole `<<<…` run into
    // one tag, so nothing is left — `fetch_too_short`.
    const body = `<html><body>${ATTACKS.unclosed_lt!(1_990_000)}</body></html>`;
    // Same output as R16 on this shape (checked at a size R16 can still handle), both wrapped and bare.
    for (const small of [`<html><body>${"<".repeat(4_000)}</body></html>`, "<".repeat(4_000)]) expect(htmlToMarkdown(small)).toBe(r16.htmlToMarkdown(small));
    const t0 = performance.now();
    const code = await fetchJobDescription(
      { url: "https://jobs.example.test/1", userId: "u" },
      {
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        fetchImpl: (async () => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })) as unknown as typeof fetch,
        rateLimiter: null,
        maxBytes: 4 * 1024 * 1024,
      },
    ).then(
      () => "ok",
      (e: { code?: string }) => e.code,
    );
    expect(code).toBe("fetch_too_short");
    expect(performance.now() - t0).toBeLessThan(1_000);
  }, 30_000);

  it("the full route on a 2 MB unclosed-<b> page (QA-R16-01's 11.9 s case at 540 KB) finishes within 1 s", async () => {
    const body = `<html><body><p>${"공고 본문 ".repeat(40)}</p>${ATTACKS.b_unclosed!(1_990_000)}</body></html>`;
    const t0 = performance.now();
    const r = await fetchJobDescription(
      { url: "https://jobs.example.test/1", userId: "u" },
      {
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        fetchImpl: (async () => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })) as unknown as typeof fetch,
        rateLimiter: null,
        maxBytes: 4 * 1024 * 1024,
      },
    );
    expect(performance.now() - t0).toBeLessThan(1_000);
    expect(r.rawText.length).toBeLessThanOrEqual(JD_FETCH_RAW_TEXT_MAX);
    expect(r.rawText.startsWith("공고 본문")).toBe(true);
  }, 30_000);
});
