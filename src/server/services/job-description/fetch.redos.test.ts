import { describe, expect, it } from "vitest";
import { bodyFrameUrl, extractJobPosting, fetchJobDescription, htmlToText } from "./fetch";
import * as r15 from "./__tests__/fetch.r15-reference";
import {
  boilerplateOpenTags,
  closeTagFinder,
  frameSrcValues,
  ldJsonBodies,
  removeElements,
  replaceAnyTag,
  replaceComments,
  replaceNamedTags,
  stripCdataOpen,
} from "./html-scan";

/**
 * Hotfix QA-R16-02 — the JD fetch HTML pass was super-linear on attacker-chosen pages (a logged-in
 * user only needs to publish one page): 540 KB took 11.9 s, 2 MB reached the 60 s `maxDuration`,
 * and since the regexes run synchronously the 10 s deadline timer could not fire and other
 * requests on the instance stalled.
 *
 * Two promises are pinned here:
 *   1. **Output is byte-identical** to R15 — each scanner against the regex it replaces, and the
 *      whole pass against the frozen R15 implementation (`fetch.r15-reference.ts`), on a realistic
 *      corpus and on fuzzed input. (NUL is the one intended difference: it is now dropped.)
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
  const tags = ["div", "section", "ul", "li", "table", "tr", "td", "p", "script", "style", "iframe", "frame", "nav", "span", "a", "h2"];
  const attrs = [
    'class="gnb"', "class='job'", 'id="menu"', 'class="x related"', 'src="/zf_user/jobs/relay/view-detail?rec_idx=1"', 'type="application/ld+json"',
    "data-x=1", 'title="a>b"', 'class="a<b"', 'xsrc="/zf_user/jobs/relay/view-detail?rec_idx=2"', '_src="/a"', 'myclass="gnb"', 'xtype="application/ld+json"', 'src=""', "",
  ];
  let out = "";
  const parts = 1 + Math.floor(rand() * 4);
  for (let i = 0; i < parts; i++) {
    const r = rand();
    if (r < 0.35 || depth > 3) out += pick(["공고 본문", "자격 요건", " ", "&amp; x", "<!-- c -->", "<br>", "]]>", '{"@type":"JobPosting","title":"t"}']);
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

// ---------------- 2. the whole pass == R15, byte for byte ----------------

const page = (body: string) => `<!doctype html><html><head><title>t</title><style>p{}</style></head><body>${body}</body></html>`;
const LONG = "백엔드 개발자를 모십니다. 자격 요건과 우대 사항을 확인해 주세요. ".repeat(12);
const posting = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ "@context": "https://schema.org", "@type": "JobPosting", title: "백엔드 개발자", hiringOrganization: { "@type": "Organization", name: "에이비씨페이" }, description: `<p>${LONG}</p>`, ...extra });

/** Realistic pages: chrome, boilerplate blocks, JSON-LD (plain / array / @graph / CDATA), frames, tables, entities. */
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
  comments_entities: page(`<!-- <div class="gnb">hidden</div> --><p>&lt;b&gt; &#x41;&#65; &unknown; &amp;amp;</p><!--x--><pre>  코드\n  블록 </pre><p>${LONG}</p>`),
  attr_with_gt_lt: page(`<div title="a>b" class="job">본문 ${LONG}</div><p data-x="1<2">끝</p><img src="a.png" alt="x>y">`),
  uppercase: page(`<DIV CLASS="Menu">메뉴</DIV><P>${LONG}</P><BR><SCRIPT>x</SCRIPT><Table><TR><TD>a</TD></TR></Table>`),
  big_realistic: page(
    "<div class='job'><h2>주요 업무</h2><ul><li><b>필수</b>: Java 3년 이상</li><li>Spring 경험</li></ul><table><tr><th>구분</th><th>내용</th></tr><tr><td>근무지</td><td>서울</td></tr></table><p>문단 <i>강조</i> 링크 <a href='https://x/y?t=1'>여기</a></p></div>".repeat(1500),
  ),
};

describe("the whole pass is byte-identical to R15 (realistic corpus)", () => {
  it.each(Object.keys(CORPUS))("htmlToText: %s", (name) => {
    expect(htmlToText(CORPUS[name]!)).toBe(r15.htmlToText(CORPUS[name]!));
  });

  it.each(Object.keys(CORPUS))("extractJobPosting: %s", (name) => {
    expect(extractJobPosting(CORPUS[name]!)).toEqual(r15.extractJobPosting(CORPUS[name]!));
  });

  it.each([
    ["https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=1", "saramin_landing"],
    ["https://www.jobkorea.co.kr/Recruit/GI_Read/1", "jobkorea_landing"],
    ["https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=1", "jobkorea_landing"],
    ["https://jobs.example.test/1", "saramin_landing"],
  ])("bodyFrameUrl(%s, %s)", (pageUrl, name) => {
    expect(bodyFrameUrl(new URL(pageUrl), CORPUS[name]!)).toBe(r15.bodyFrameUrl(new URL(pageUrl), CORPUS[name]!));
  });
});

describe("the whole pass is byte-identical to R15 (fuzzed input)", () => {
  const stripNul = (s: string) => s.replace(/\u0000/g, "");
  it("htmlToText(s) == R15 htmlToText(s without NUL)", () => eachFuzz(11, (s) => expect(htmlToText(s)).toBe(r15.htmlToText(stripNul(s)))));
  it("extractJobPosting", () => eachFuzz(12, (s) => expect(extractJobPosting(s)).toEqual(r15.extractJobPosting(s))));
  it("bodyFrameUrl (사람인 / 잡코리아 / other hosts)", () =>
    eachFuzz(13, (s) => {
      for (const u of ["https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=1", "https://www.jobkorea.co.kr/x", "https://jobs.example.test/1"]) {
        expect(bodyFrameUrl(new URL(u), s)).toBe(r15.bodyFrameUrl(new URL(u), s));
      }
    }));
});

// ---------------- NUL (hotfix item 4) ----------------

describe("NUL never reaches rawText or the JobPosting fields (Postgres refuses it)", () => {
  it("htmlToText drops NUL — the only intended change from R15", () => {
    const html = page(`<p>공고\u0000 본문\u0000</p>`);
    // `<head>` (title, style) is a dropped element, so only the body text remains.
    expect(htmlToText(html)).toBe("공고 본문");
    expect(htmlToText(html)).not.toContain("\u0000");
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

// ---------------- 2. time is linear (hotfix item 5) ----------------

const rep = (unit: string, total: number) => unit.repeat(Math.floor(total / unit.length));

/** QA's hostile inputs (`_workspace/backend/R16/03_backend-qa_report.md`) + the ones the fix targets. */
const ATTACKS: Record<string, (size: number) => string> = {
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
};

/** Everything the fetch route runs on a downloaded page, synchronously. */
function wholePass(html: string): void {
  bodyFrameUrl(new URL("https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=1"), html);
  const posting = extractJobPosting(html);
  htmlToText(html);
  if (posting.descriptionHtml) htmlToText(posting.descriptionHtml);
}

function timed(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

describe("hostile pages: linear time (hotfix QA-R16-02)", () => {
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

  it("the full route on the slowest 2 MB page fails fast with fetch_too_short, well inside the 10 s budget", async () => {
    for (const size of [8_000, 128_000]) expect(timed(() => wholePass(ATTACKS.unclosed_lt!(size)))).toBeLessThan(250);
    // Wrapped like a real response (QA's harness): the trailing `>` turns the whole `<<<…` run into
    // one tag, so nothing is left — `fetch_too_short`. Bare, R15 keeps it as text (same output now).
    const body = `<html><body>${ATTACKS.unclosed_lt!(1_990_000)}</body></html>`;
    // Same output as R15 on this shape (checked at a size R15 can still handle), both wrapped and bare.
    for (const small of [`<html><body>${"<".repeat(4_000)}</body></html>`, "<".repeat(4_000)]) expect(htmlToText(small)).toBe(r15.htmlToText(small));
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
});
