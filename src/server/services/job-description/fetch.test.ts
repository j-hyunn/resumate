import { describe, expect, it } from "vitest";
import { JD_FETCH_MIN_CHARS, JD_FETCH_RAW_TEXT_MAX } from "@/lib/contracts/jd-fetch";
import { JdFetchRateLimiter, bodyFrameUrl, decodeHtml, extractJobPosting, fetchJobDescription, htmlToMarkdown } from "./fetch";
import type { LookupFn } from "./ssrf";

/**
 * R15 A1 — `POST /api/job-descriptions/fetch` 서비스.
 * 네트워크·DNS는 전부 주입이다(실제 호출 0건).
 */

const publicLookup: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }];
const lookupTo =
  (map: Record<string, string>): LookupFn =>
  async (host) => [{ address: map[host] ?? "93.184.216.34", family: 4 }];

type Page = { status?: number; headers?: Record<string, string>; body?: string | Uint8Array | ReadableStream<Uint8Array>; delayMs?: number };

/** A fake `fetch` over a url → page map. Unknown urls answer 404. */
function fakeFetch(pages: Record<string, Page>, seen?: string[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    seen?.push(url);
    const page = pages[url];
    if (!page) return new Response("missing", { status: 404 });
    if (page.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, page.delayMs);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    }
    const headers = { "content-type": "text/html; charset=utf-8", ...(page.headers ?? {}) };
    return new Response((page.body ?? "") as BodyInit, { status: page.status ?? 200, headers });
  }) as unknown as typeof fetch;
}

/** Deps that never rate-limit and never touch the network. */
function deps(pages: Record<string, Page>, extra: Partial<Parameters<typeof fetchJobDescription>[1]> = {}, seen?: string[]) {
  return { fetchImpl: fakeFetch(pages, seen), lookup: publicLookup, rateLimiter: null, ...extra };
}

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "ok";
  } catch (err) {
    return (err as { code?: string }).code ?? "unknown";
  }
}

const LONG_KO = "백엔드 개발자를 모십니다. 자격 요건과 우대 사항을 확인해 주세요. ".repeat(12);
const page = (bodyHtml: string) => `<!doctype html><html><head><title>t</title></head><body>${bodyHtml}</body></html>`;

describe("htmlToMarkdown", () => {
  it("drops script/style/nav/footer, keeps one line per block and decodes entities", () => {
    const text = htmlToMarkdown(
      page(
        `<nav>메뉴 홈 로그인</nav><script>var x = "지원하기";</script><style>.a{}</style>` +
          `<div class="footer">회사소개 이용약관</div>` +
          `<div class="jv_cont"><h2>주요 업무</h2><ul><li>API 개발 &amp; 운영</li><li>성능 개선</li></ul><p>자격&nbsp;요건</p></div>` +
          `<aside>추천 공고</aside>`,
      ),
    );
    expect(text).toContain("주요 업무");
    expect(text).toContain("API 개발 & 운영");
    expect(text).toContain("자격 요건");
    expect(text).not.toContain("var x");
    expect(text).not.toContain("메뉴 홈 로그인");
    expect(text).not.toContain("회사소개 이용약관");
    expect(text).not.toContain("추천 공고");
    expect(text.split("\n").length).toBeGreaterThan(2);
  });
});

describe("decodeHtml", () => {
  it("converts EUC-KR to UTF-8 from the Content-Type charset", () => {
    // "한국" in EUC-KR, repeated so the result is clearly Korean text, not mojibake.
    const unit = Uint8Array.from([0xc7, 0xd1, 0xb1, 0xb9]);
    const bytes = new Uint8Array(unit.length * 4);
    for (let i = 0; i < 4; i += 1) bytes.set(unit, i * unit.length);
    expect(decodeHtml(bytes, "text/html; charset=EUC-KR")).toBe("한국한국한국한국");
    // The same bytes read as UTF-8 would be replacement characters.
    expect(decodeHtml(bytes, "text/html; charset=utf-8")).not.toContain("한국");
  });

  it("falls back to the HTML <meta charset> when the header has none", () => {
    const head = new TextEncoder().encode(`<html><head><meta http-equiv="Content-Type" content="text/html; charset=ks_c_5601-1987"></head><body>`);
    const korean = Uint8Array.from([0xc7, 0xd1, 0xb1, 0xb9]);
    const bytes = new Uint8Array(head.length + korean.length);
    bytes.set(head);
    bytes.set(korean, head.length);
    expect(decodeHtml(bytes, "text/html")).toContain("한국");
  });
});

describe("extractJobPosting", () => {
  it("reads title and hiringOrganization from a plain JobPosting block", () => {
    const html = page(
      `<script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "JobPosting",
        title: "백엔드 개발자",
        hiringOrganization: { "@type": "Organization", name: "에이비씨페이" },
        description: "<p>주요 업무</p>",
      })}</script>`,
    );
    expect(extractJobPosting(html)).toEqual({ title: "백엔드 개발자", companyName: "에이비씨페이", descriptionHtml: "<p>주요 업무</p>" });
  });

  it("reads it from an array and from @graph", () => {
    const posting = { "@type": "JobPosting", title: "플랫폼 엔지니어", hiringOrganization: { name: "가나다" }, description: "x" };
    expect(extractJobPosting(page(`<script type="application/ld+json">${JSON.stringify([{ "@type": "WebSite" }, posting])}</script>`)).title).toBe(
      "플랫폼 엔지니어",
    );
    expect(
      extractJobPosting(page(`<script type="application/ld+json">${JSON.stringify({ "@graph": [{ "@type": "Organization" }, posting] })}</script>`))
        .companyName,
    ).toBe("가나다");
  });

  it("ignores malformed JSON and pages without a JobPosting", () => {
    expect(extractJobPosting(page(`<script type="application/ld+json">{ oops </script>`))).toEqual({
      title: null,
      companyName: null,
      descriptionHtml: null,
    });
    expect(extractJobPosting(page(`<script type="application/ld+json">{"@type":"Article","title":"x"}</script>`)).title).toBeNull();
  });
});

describe("bodyFrameUrl", () => {
  it("finds the 사람인 detail frame and the 잡코리아 content frame", () => {
    expect(
      bodyFrameUrl(
        new URL("https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=1"),
        page(`<iframe src="/zf_user/jobs/relay/view-detail?rec_idx=1&amp;view_type=detail"></iframe>`),
      ),
    ).toBe("https://www.saramin.co.kr/zf_user/jobs/relay/view-detail?rec_idx=1&view_type=detail");
    expect(
      bodyFrameUrl(new URL("https://www.jobkorea.co.kr/Recruit/GI_Read/1"), page(`<iframe id="gib_frame" src="/Recruit/Content/GIReadContentFrame?gno=1">`)),
    ).toBe("https://www.jobkorea.co.kr/Recruit/Content/GIReadContentFrame?gno=1");
  });

  it("ignores other hosts, cross-site frames and unrelated frames", () => {
    expect(bodyFrameUrl(new URL("https://example.com/x"), page(`<iframe src="/view-detail">`))).toBeNull();
    expect(bodyFrameUrl(new URL("https://www.saramin.co.kr/x"), page(`<iframe src="https://evil.test/view-detail">`))).toBeNull();
    expect(bodyFrameUrl(new URL("https://www.saramin.co.kr/x"), page(`<iframe src="/ads/banner">`))).toBeNull();
  });
});

describe("fetchJobDescription", () => {
  const url = "https://example.com/jobs/1?utm_source=x";

  it("returns the page text with the JobPosting company and title", async () => {
    const result = await fetchJobDescription(
      { url, userId: "u1" },
      deps({
        [url]: {
          body: page(
            `<script type="application/ld+json">${JSON.stringify({
              "@type": "JobPosting",
              title: "백엔드 개발자",
              hiringOrganization: { name: "에이비씨페이" },
            })}</script><div class="content"><p>${LONG_KO}</p></div>`,
          ),
        },
      }),
    );
    expect(result.companyName).toBe("에이비씨페이");
    expect(result.positionTitle).toBe("백엔드 개발자");
    expect(result.rawText.length).toBeGreaterThanOrEqual(JD_FETCH_MIN_CHARS);
    expect(result.rawText).toContain("자격 요건");
  });

  it("uses the JSON-LD description when the page markup carries less text", async () => {
    const result = await fetchJobDescription(
      { url, userId: "u1" },
      deps({
        [url]: {
          body: page(
            `<script type="application/ld+json">${JSON.stringify({
              "@type": "JobPosting",
              title: null,
              description: `<p>${LONG_KO}</p>`,
            })}</script><div>짧은 껍데기</div>`,
          ),
        },
      }),
    );
    expect(result.rawText).toContain("자격 요건");
    expect(result.companyName).toBeNull();
    expect(result.positionTitle).toBeNull();
  });

  it("truncates rawText at 50,000 characters", async () => {
    const result = await fetchJobDescription(
      { url, userId: "u1" },
      deps({ [url]: { body: page(`<p>${"가".repeat(60_000)}</p>`) } }, { maxBytes: 8 * 1024 * 1024 }),
    );
    expect(result.rawText).toHaveLength(JD_FETCH_RAW_TEXT_MAX);
  });

  it("follows the 사람인 body frame and prefers its text", async () => {
    const landing = "https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=1";
    const frame = "https://www.saramin.co.kr/zf_user/jobs/relay/view-detail?rec_idx=1";
    const seen: string[] = [];
    const result = await fetchJobDescription(
      { url: landing, userId: "u1" },
      deps(
        {
          [landing]: { body: page(`<div class="gnb">사람인 메뉴</div><iframe src="/zf_user/jobs/relay/view-detail?rec_idx=1"></iframe>`) },
          [frame]: { body: page(`<div class="user_content"><p>${LONG_KO}</p></div>`) },
        },
        { lookup: lookupTo({ "www.saramin.co.kr": "93.184.216.34" }) },
        seen,
      ),
    );
    expect(seen).toEqual([landing, frame]);
    expect(result.rawText).toContain("자격 요건");
    expect(result.rawText).not.toContain("사람인 메뉴");
  });

  it("follows the 잡코리아 frame address", async () => {
    const landing = "https://www.jobkorea.co.kr/Recruit/GI_Read/1";
    const frame = "https://www.jobkorea.co.kr/Recruit/Content/GIReadContentFrame?gno=1";
    const seen: string[] = [];
    const result = await fetchJobDescription(
      { url: landing, userId: "u1" },
      deps(
        {
          [landing]: { body: page(`<iframe id="gib_frame" src="/Recruit/Content/GIReadContentFrame?gno=1"></iframe><div>짧음</div>`) },
          [frame]: { body: page(`<p>${LONG_KO}</p>`) },
        },
        { lookup: lookupTo({ "www.jobkorea.co.kr": "93.184.216.34" }) },
        seen,
      ),
    );
    expect(seen).toEqual([landing, frame]);
    expect(result.rawText).toContain("자격 요건");
    expect(result.rawText).not.toContain("짧음");
  });

  it("follows up to 3 redirects, re-checking the guard on each hop", async () => {
    const hops = ["https://a.test/1", "https://b.test/2", "https://c.test/3", "https://d.test/4"];
    const seen: string[] = [];
    const pages: Record<string, Page> = {
      [hops[0]!]: { status: 302, headers: { location: hops[1]! } },
      [hops[1]!]: { status: 301, headers: { location: hops[2]! } },
      [hops[2]!]: { status: 307, headers: { location: hops[3]! } },
      [hops[3]!]: { body: page(`<p>${LONG_KO}</p>`) },
    };
    const result = await fetchJobDescription({ url: hops[0]!, userId: "u1" }, deps(pages, {}, seen));
    expect(seen).toEqual(hops);
    expect(result.rawText).toContain("자격 요건");
  });

  it("blocks a redirect hop that resolves to a private address (per-hop re-check)", async () => {
    const start = "https://public.test/1";
    const inner = "http://internal.test/latest/meta-data/";
    const code = await codeOf(() =>
      fetchJobDescription(
        { url: start, userId: "u1" },
        deps(
          { [start]: { status: 302, headers: { location: inner } } },
          { lookup: lookupTo({ "public.test": "93.184.216.34", "internal.test": "169.254.169.254" }) },
        ),
      ),
    );
    expect(code).toBe("fetch_blocked");
  });

  it("refuses more than 3 redirects", async () => {
    const pages: Record<string, Page> = {};
    for (let i = 0; i <= 6; i += 1) pages[`https://loop.test/${i}`] = { status: 302, headers: { location: `https://loop.test/${i + 1}` } };
    const seen: string[] = [];
    expect(await codeOf(() => fetchJobDescription({ url: "https://loop.test/0", userId: "u1" }, deps(pages, {}, seen)))).toBe("fetch_failed");
    // The original request + 3 redirects, and no 5th socket.
    expect(seen).toHaveLength(4);
  });

  it("times out the whole request", async () => {
    const code = await codeOf(() =>
      fetchJobDescription({ url, userId: "u1" }, deps({ [url]: { delayMs: 2_000, body: page(`<p>${LONG_KO}</p>`) } }, { timeoutMs: 25 })),
    );
    expect(code).toBe("fetch_timeout");
  });

  it("stops at the 2 MB body cap, from the stream and from Content-Length", async () => {
    const big = new Uint8Array(4096).fill(0x61);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(big);
      },
    });
    expect(await codeOf(() => fetchJobDescription({ url, userId: "u1" }, deps({ [url]: { body: stream } }, { maxBytes: 2048 })))).toBe("fetch_too_large");
    expect(
      await codeOf(() =>
        fetchJobDescription({ url, userId: "u1" }, deps({ [url]: { body: "x", headers: { "content-length": "9999999" } } }, { maxBytes: 2048 })),
      ),
    ).toBe("fetch_too_large");
  });

  it("fails a page whose extracted text is under 200 characters", async () => {
    expect(await codeOf(() => fetchJobDescription({ url, userId: "u1" }, deps({ [url]: { body: page("<p>마감된 공고입니다.</p>") } })))).toBe(
      "fetch_too_short",
    );
  });

  it("maps a bad URL, a blocked address and an HTTP error to their codes", async () => {
    expect(await codeOf(() => fetchJobDescription({ url: "file:///etc/passwd", userId: "u1" }, deps({})))).toBe("invalid_source_url");
    expect(await codeOf(() => fetchJobDescription({ url: "http://127.0.0.1/x", userId: "u1" }, deps({})))).toBe("fetch_blocked");
    expect(await codeOf(() => fetchJobDescription({ url, userId: "u1" }, deps({ [url]: { status: 403, body: "no" } })))).toBe("fetch_failed");
    expect(await codeOf(() => fetchJobDescription({ url, userId: "u1" }, deps({})))).toBe("fetch_failed"); // 404
  });

  it("refuses over the abuse window and keeps windows per user [가정: 수치]", async () => {
    const limiter = new JdFetchRateLimiter(2, 60_000);
    const pages = { [url]: { body: page(`<p>${LONG_KO}</p>`) } };
    const run = (userId: string) => fetchJobDescription({ url, userId }, deps(pages, { rateLimiter: limiter }));
    await run("u1");
    await run("u1");
    expect(await codeOf(() => run("u1"))).toBe("too_many_requests");
    await expect(run("u2")).resolves.toMatchObject({ companyName: null });
  });

  it("logs host, code, bytes and elapsed only — never body text, URL path or query", async () => {
    const lines: { event: string; fields: Record<string, unknown> }[] = [];
    const log = (event: string, fields: Record<string, unknown>) => lines.push({ event, fields });
    const secret = `${url}&token=super-secret-token`;
    await fetchJobDescription({ url: secret, userId: "u1" }, deps({ [secret]: { body: page(`<p>${LONG_KO}</p>`) } }, { log }));
    await codeOf(() => fetchJobDescription({ url: "http://10.0.0.1/x", userId: "u1" }, deps({}, { log })));

    expect(lines.map((l) => l.event)).toEqual(["jd_fetch.succeeded", "jd_fetch.failed"]);
    expect(lines[0]!.fields).toMatchObject({ host: "example.com", code: "ok" });
    expect(lines[1]!.fields).toMatchObject({ code: "fetch_blocked" });
    for (const line of lines) {
      expect(Object.keys(line.fields).sort()).toEqual(["bytes", "code", "elapsedMs", "host"]);
      const serialized = JSON.stringify(line);
      expect(serialized).not.toContain("super-secret-token");
      expect(serialized).not.toContain("utm_source");
      expect(serialized).not.toContain("/jobs/1");
      expect(serialized).not.toContain("자격 요건");
      expect(serialized).not.toContain("백엔드");
    }
    expect(typeof lines[0]!.fields.bytes).toBe("number");
    expect(lines[0]!.fields.bytes).toBeGreaterThan(0);
  });
});
