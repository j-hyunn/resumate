import {
  JD_FETCH_MAX_BYTES,
  JD_FETCH_MAX_REDIRECTS,
  JD_FETCH_MIN_CHARS,
  JD_FETCH_RATE_LIMIT,
  JD_FETCH_RAW_TEXT_MAX,
  JD_FETCH_TIMEOUT_MS,
  jdFetchError,
  jdFetchTooManyRequests,
  type FetchJobDescriptionResult,
  type JdFetchErrorCode,
} from "@/lib/contracts/jd-fetch";
import { isAppError } from "@/lib/contracts/errors";
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
import { assertSafeUrl, defaultLookup, type LookupFn } from "./ssrf";

/**
 * R15 A1 — 공고 URL 가져오기 (CF-10). Fetches a job posting page and turns it
 * into `{rawText, companyName, positionTitle}` for S-14 단계 1.
 *
 * Reads, in order: ① schema.org `JobPosting` JSON-LD (title / hiringOrganization
 * / description) ② the page's own body frame on 사람인·잡코리아 ③ generic main
 * content text. **No model call** (CF-A15) and **no DB write** (CF-A16).
 *
 * Boundaries this file owns: the SSRF guard on every hop (./ssrf), the 10 s
 * budget, the 2 MB body cap, the 200-char floor, the 50,000-char truncation, and
 * the in-process abuse limiter.
 *
 * NFR-PRV-09 / CF-A16 logging: **host, result code, byte count, elapsed ms only**.
 * A posting URL carries tracking tokens, so the path and query never reach a log
 * line, and neither does any page text.
 */

export type JdFetchLog = (event: string, fields: Record<string, string | number | boolean | null>) => void;

/** Sliding-window counter per user. Injectable so tests are deterministic. */
export class JdFetchRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number = JD_FETCH_RATE_LIMIT.max,
    private readonly windowMs: number = JD_FETCH_RATE_LIMIT.windowMs,
  ) {}

  /** Records one attempt; false = over the window's budget. */
  take(userId: string, now: number): boolean {
    const since = now - this.windowMs;
    const kept = (this.hits.get(userId) ?? []).filter((t) => t > since);
    if (kept.length >= this.max) {
      this.hits.set(userId, kept);
      return false;
    }
    kept.push(now);
    this.hits.set(userId, kept);
    return true;
  }
}

/** One limiter per server instance (per-user windows live inside it). */
const sharedLimiter = new JdFetchRateLimiter();

export type JdFetchDeps = {
  fetchImpl?: typeof fetch;
  lookup?: LookupFn;
  /** Monotonic-enough clock in ms (deadline + rate limit window). */
  now?: () => number;
  log?: JdFetchLog;
  /** null disables the abuse limiter (tests). */
  rateLimiter?: JdFetchRateLimiter | null;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
};

type Resolved = Required<Pick<JdFetchDeps, "fetchImpl" | "lookup" | "now" | "log" | "timeoutMs" | "maxBytes" | "maxRedirects">> & {
  rateLimiter: JdFetchRateLimiter | null;
};

function resolveDeps(deps: JdFetchDeps): Resolved {
  return {
    fetchImpl: deps.fetchImpl ?? ((input, init) => globalThis.fetch(input as RequestInfo, init)),
    lookup: deps.lookup ?? defaultLookup,
    now: deps.now ?? (() => Date.now()),
    log: deps.log ?? (() => {}),
    rateLimiter: deps.rateLimiter === undefined ? sharedLimiter : deps.rateLimiter,
    timeoutMs: deps.timeoutMs ?? JD_FETCH_TIMEOUT_MS,
    maxBytes: deps.maxBytes ?? JD_FETCH_MAX_BYTES,
    maxRedirects: deps.maxRedirects ?? JD_FETCH_MAX_REDIRECTS,
  };
}

// ---------------- charset ----------------

const CHARSET_ALIASES: Record<string, string> = {
  "euc-kr": "euc-kr",
  euckr: "euc-kr",
  "ks_c_5601-1987": "euc-kr",
  ksc5601: "euc-kr",
  "cp949": "euc-kr",
  "x-windows-949": "euc-kr",
  "windows-949": "euc-kr",
  "utf-8": "utf-8",
  utf8: "utf-8",
  "iso-8859-1": "windows-1252",
  "windows-1252": "windows-1252",
};

function normalizeCharset(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = value.trim().toLowerCase().replace(/^["']|["']$/g, "");
  return CHARSET_ALIASES[key] ?? (key === "" ? null : key);
}

function charsetFromContentType(contentType: string | null): string | null {
  if (!contentType) return null;
  const m = /charset\s*=\s*([^;\s]+)/i.exec(contentType);
  return normalizeCharset(m?.[1] ?? null);
}

/** `<meta charset>` / `<meta http-equiv="content-type">` sniff over the first bytes. */
function charsetFromMeta(bytes: Uint8Array): string | null {
  // The declaration must be in the first 1024 bytes per the HTML spec; read a little more.
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
  const direct = /<meta[^>]+charset\s*=\s*["']?([a-zA-Z0-9_\-]+)/i.exec(head);
  if (direct) return normalizeCharset(direct[1]!);
  const equiv = /<meta[^>]+http-equiv\s*=\s*["']?content-type["']?[^>]*content\s*=\s*["'][^"']*charset\s*=\s*([a-zA-Z0-9_\-]+)/i.exec(head);
  return equiv ? normalizeCharset(equiv[1]!) : null;
}

/** EUC-KR → UTF-8 and friends. Unknown labels fall back to UTF-8. */
export function decodeHtml(bytes: Uint8Array, contentType: string | null): string {
  const label = charsetFromContentType(contentType) ?? charsetFromMeta(bytes) ?? "utf-8";
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

// ---------------- html → text ----------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  middot: "·",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  bull: "·",
  laquo: "«",
  raquo: "»",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  times: "×",
  reg: "®",
  copy: "©",
  trade: "™",
  deg: "°",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const hex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Elements whose content is never page text. */
const DROPPED_ELEMENTS = ["script", "style", "noscript", "template", "svg", "head", "nav", "header", "footer", "aside", "form", "button", "select", "iframe"];

/** Chrome around the posting: menus, banners, related lists, share bars, footers. */
const BOILERPLATE_ATTR =
  /(^|[\s_-])(gnb|lnb|snb|nav|navi|menu|breadcrumb|banner|advert|adsense|ad[_-]?(area|wrap|box)|cookie|popup|layer[_-]?pop|sidebar|side[_-]?bar|related|recomm|recommend|share|sns|copyright|footer|header|pagination|paging|search[_-]?form|login)([\s_-]|$)/i;

/**
 * Hotfix QA-R16-02: the same two passes per tag as R15's
 * `<tag\b[^>]*>[\s\S]*?</tag\s*>` then `<tag\b[^>]*\/?>` regexes, run by linear scanners with
 * identical match semantics (`html-scan.ts`) — the regexes were O(n²) on unclosed tags.
 */
function stripDroppedElements(html: string): string {
  let out = html;
  let lower = out.toLowerCase();
  for (const tag of DROPPED_ELEMENTS) {
    // Both passes need a `<tag`; skip the two full scans when the document has none. `toLowerCase`
    // can only add false positives (a non-ASCII character lowering to ASCII), which just fall back
    // to the exact scan — never a false negative, so the output can't change.
    if (!lower.includes(`<${tag}`)) continue;
    const before = out;
    out = removeElements(out, tag, " ");
    out = replaceNamedTags(out, new Set([tag]), false, " ");
    if (out !== before) lower = out.toLowerCase();
  }
  return out;
}

/**
 * Drops `div`/`section`/`ul` blocks whose class or id reads as page chrome.
 * Regex-only (no DOM in the Node runtime), so it removes the element's opening
 * tag's shallowest matching close — good enough for boilerplate trimming, and a
 * miss only leaves extra text, never wrong text.
 */
function stripBoilerplateBlocks(html: string): string {
  // Hotfix QA-R16-02: R15's `open` regex (`<(div|…)\b[^>]*(?:class|id)\s*=\s*["']([^"']*)["'][^>]*>`)
  // was O(n³), and its close-tag search re-scanned to the end for every unclosed block (O(n²)).
  // Same matches, same resume points, in O(n): `boilerplateOpenTags` + a per-tag close finder.
  const closeFinders = new Map<string, (from: number) => number>();
  const closeOf = (tag: string, from: number) => {
    let finder = closeFinders.get(tag);
    if (!finder) {
      finder = closeTagFinder(html, tag);
      closeFinders.set(tag, finder);
    }
    return finder(from);
  };
  let out = "";
  let cursor = 0;
  const opens = boilerplateOpenTags(html);
  let step = opens.next();
  while (!step.done) {
    const match = step.value;
    let resume: number | undefined;
    if (match.index >= cursor && BOILERPLATE_ATTR.test(match.value)) {
      const end = closeOf(match.name, match.end);
      if (end !== -1) {
        out += html.slice(cursor, match.index);
        cursor = end;
        resume = end;
      }
    }
    step = opens.next(resume);
  }
  return out + html.slice(cursor);
}

/** R15's `BLOCK_TAGS` regex names (`<\/?(…)\b[^>]*>`), matched by `replaceNamedTags`. */
const BLOCK_TAGS = new Set([
  "p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "header", "footer", "blockquote",
  "pre", "dd", "dt", "dl", "ul", "ol", "table", "thead", "tbody", "figure", "figcaption", "hr", "address", "main",
]);
const CELL_TAGS = new Set(["td", "th"]);

/**
 * HTML → plain text with one line per block element, entities decoded.
 *
 * Hotfix QA-R16-02: every step is the R15 regex's exact semantics run by a linear scanner
 * (`html-scan.ts`), so normal pages come out byte-identical and a 2 MB hostile page can't pin the
 * CPU (the regexes were O(n²)–O(n³) and, being synchronous, also blocked the 10 s deadline timer).
 */
export function htmlToText(html: string): string {
  // NUL passed through to rawText and Postgres refused it ("null character not permitted"), so
  // the fetch succeeded and the create / preview failed. Never part of a posting.
  let text = stripBoilerplateBlocks(stripDroppedElements(html.replace(/\u0000/g, "")));
  text = replaceComments(text, " ");
  text = replaceNamedTags(text, CELL_TAGS, false, "\t");
  text = replaceNamedTags(text, BLOCK_TAGS, true, "\n");
  text = replaceAnyTag(text, " ");
  text = decodeEntities(text);
  return normalizeText(text);
}

/** Collapses runs of spaces / blank lines and trims each line. */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ ​﻿]/g, " ")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .filter((line, i, all) => line !== "" || (i > 0 && all[i - 1] !== ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------- schema.org JobPosting ----------------

type JobPostingFields = { title: string | null; companyName: string | null; descriptionHtml: string | null };

function collectNodes(value: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const v of value) collectNodes(v, out);
    return;
  }
  if (value === null || typeof value !== "object") return;
  const node = value as Record<string, unknown>;
  out.push(node);
  if ("@graph" in node) collectNodes(node["@graph"], out);
}

function hasType(node: Record<string, unknown>, type: string): boolean {
  const raw = node["@type"];
  if (typeof raw === "string") return raw.toLowerCase() === type;
  if (Array.isArray(raw)) return raw.some((t) => typeof t === "string" && t.toLowerCase() === type);
  return false;
}

function asText(value: unknown): string | null {
  if (typeof value === "string") {
    // NUL never reaches company_name / position_title (Postgres refuses it — hotfix QA-R16-02).
    const trimmed = decodeEntities(value.replace(/\u0000/g, "")).replace(/\s+/g, " ").trim();
    return trimmed === "" ? null : trimmed;
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const t = asText(v);
      if (t) return t;
    }
    return null;
  }
  if (value !== null && typeof value === "object") return asText((value as Record<string, unknown>).name);
  return null;
}

/** schema.org `JobPosting` from any `<script type="application/ld+json">` block. */
export function extractJobPosting(html: string): JobPostingFields {
  const empty: JobPostingFields = { title: null, companyName: null, descriptionHtml: null };
  // Hotfix QA-R16-02: R15's `<script\b[^>]*type…[^>]*>([\s\S]*?)<\/script\s*>` regex was O(n²) on
  // unclosed scripts, and its CDATA prefix `^\s*(?:\/\/)?\s*` O(k²) on leading whitespace.
  for (const body of ldJsonBodies(html)) {
    let parsed: unknown;
    try {
      // Some pages wrap the JSON in a CDATA section.
      parsed = JSON.parse(stripCdataOpen(body).replace(/\]\]>\s*$/, ""));
    } catch {
      continue;
    }
    const nodes: Record<string, unknown>[] = [];
    collectNodes(parsed, nodes);
    const posting = nodes.find((n) => hasType(n, "jobposting"));
    if (!posting) continue;
    return {
      title: asText(posting.title),
      companyName: asText(posting.hiringOrganization) ?? asText(posting.organizationName),
      descriptionHtml: typeof posting.description === "string" ? posting.description : null,
    };
  }
  return empty;
}

// ---------------- site-specific body frames ----------------

function hostMatches(host: string, domain: string): boolean {
  const h = host.toLowerCase();
  return h === domain || h.endsWith(`.${domain}`);
}

/** All `<iframe src>` / `<frame src>` values on the page, in document order. */
function frameSources(html: string): string[] {
  // Hotfix QA-R16-02: R15's `<(?:iframe|frame)\b[^>]*\bsrc…[^>]*>` regex was O(n³) — and it runs on
  // every fetched page, before the 사람인 / 잡코리아 host check.
  return frameSrcValues(html).map(decodeEntities);
}

/**
 * 사람인·잡코리아 keep the posting body in a separate frame document, so the
 * landing page has only chrome. Returns that document's absolute URL.
 *
 * 사람인: `/zf_user/jobs/relay/view-detail?rec_idx=…` (the detail frame).
 * 잡코리아: `/Recruit/Content/GIReadContentFrame?…` / `GI_Read_Comp_Details` (`#gib_frame`).
 */
export function bodyFrameUrl(pageUrl: URL, html: string): string | null {
  const host = pageUrl.hostname;
  const frames = frameSources(html);
  const pick = (test: RegExp) => frames.find((src) => test.test(src));

  let found: string | undefined;
  if (hostMatches(host, "saramin.co.kr")) {
    found = pick(/view-detail|relay\/view|jobs\/relay/i);
  } else if (hostMatches(host, "jobkorea.co.kr")) {
    found = pick(/ReadContentFrame|GI_Read|GIReadContent|Read_Comp_Details/i);
  } else {
    return null;
  }
  if (!found) return null;
  try {
    const abs = new URL(found, pageUrl);
    // Same site only: a frame pointing elsewhere is not the posting body.
    if (!hostMatches(abs.hostname, hostMatches(host, "saramin.co.kr") ? "saramin.co.kr" : "jobkorea.co.kr")) return null;
    return abs.toString();
  } catch {
    return null;
  }
}

// ---------------- fetch ----------------

type Downloaded = { html: string; bytes: number; finalUrl: URL };

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) throw jdFetchError("fetch_too_large");
  const body = response.body;
  if (!body) {
    const buf = new Uint8Array(await response.arrayBuffer());
    if (buf.byteLength > maxBytes) throw jdFetchError("fetch_too_large");
    return buf;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        // Stop pulling bytes right away instead of buffering the rest.
        await reader.cancel().catch(() => {});
        throw jdFetchError("fetch_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/** One document: guard → request → manual redirects (each re-guarded) → capped body. */
async function download(start: string, deps: Resolved, signal: AbortSignal, deadlineAt: number): Promise<Downloaded> {
  let target = start;
  for (let hop = 0; ; hop += 1) {
    if (hop > deps.maxRedirects) throw jdFetchError("fetch_failed");
    if (deps.now() >= deadlineAt) throw jdFetchError("fetch_timeout");
    // SSRF: re-run the full guard on EVERY hop — a public first hop may redirect to 169.254.169.254.
    const safe = await assertSafeUrl(target, deps.lookup);
    let response: Response;
    try {
      response = await deps.fetchImpl(safe.url.toString(), {
        signal,
        redirect: "manual",
        headers: {
          // A plain browser-ish UA: some posting sites answer an empty UA with a chrome-only page.
          "user-agent": "Mozilla/5.0 (compatible; ResumateBot/1.0)",
          accept: "text/html,application/xhtml+xml",
          "accept-language": "ko-KR,ko;q=0.9",
        },
      });
    } catch (err) {
      if (deps.now() >= deadlineAt || signal.aborted) throw jdFetchError("fetch_timeout");
      if (isAppError(err)) throw err;
      throw jdFetchError("fetch_failed");
    }
    if (isRedirect(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => {});
      if (!location) throw jdFetchError("fetch_failed");
      try {
        target = new URL(location, safe.url).toString();
      } catch {
        throw jdFetchError("invalid_source_url");
      }
      continue;
    }
    if (response.status >= 400 || response.status < 200) {
      await response.body?.cancel().catch(() => {});
      throw jdFetchError("fetch_failed");
    }
    const bytes = await readCapped(response, deps.maxBytes);
    const html = decodeHtml(bytes, response.headers.get("content-type"));
    return { html, bytes: bytes.byteLength, finalUrl: safe.url };
  }
}

function truncate(text: string): string {
  return text.length > JD_FETCH_RAW_TEXT_MAX ? text.slice(0, JD_FETCH_RAW_TEXT_MAX) : text;
}

function codeOf(err: unknown): string {
  return isAppError(err) ? err.code : "fetch_failed";
}

/**
 * Fetches `input.url` and returns the posting text.
 *
 * Throws `AppError` with one of `JD_FETCH_ERROR_CODES` (plus `too_many_requests`
 * from the abuse limiter). Writes nothing.
 */
export async function fetchJobDescription(
  input: { url: string; userId: string },
  deps: JdFetchDeps = {},
): Promise<FetchJobDescriptionResult> {
  const d = resolveDeps(deps);
  const startedAt = d.now();

  if (d.rateLimiter && !d.rateLimiter.take(input.userId, startedAt)) throw jdFetchTooManyRequests();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), d.timeoutMs);
  const deadlineAt = startedAt + d.timeoutMs;
  let host = "";
  let bytes = 0;

  try {
    // Parse + guard once up front so a bad URL is `invalid_source_url` before any socket.
    const first = await assertSafeUrl(input.url, d.lookup);
    host = first.url.hostname;

    let page = await download(first.url.toString(), d, controller.signal, deadlineAt);
    bytes = page.bytes;

    // 사람인 / 잡코리아: the landing page is chrome; the posting lives in a frame document.
    const frame = bodyFrameUrl(page.finalUrl, page.html);
    let posting = extractJobPosting(page.html);
    if (frame) {
      try {
        const framePage = await download(frame, d, controller.signal, deadlineAt);
        bytes += framePage.bytes;
        const frameText = htmlToText(framePage.html);
        if (frameText.length >= JD_FETCH_MIN_CHARS) {
          const framePosting = extractJobPosting(framePage.html);
          posting = {
            title: posting.title ?? framePosting.title,
            companyName: posting.companyName ?? framePosting.companyName,
            descriptionHtml: posting.descriptionHtml ?? framePosting.descriptionHtml,
          };
          page = framePage;
        }
      } catch (err) {
        // A frame that times out ends the request; anything else falls back to the landing page.
        if (isAppError(err) && err.code === "fetch_timeout") throw err;
      }
    }

    const pageText = htmlToText(page.html);
    const descriptionText = posting.descriptionHtml ? htmlToText(posting.descriptionHtml) : "";
    // The JSON-LD description is the posting body when the page markup gives less.
    const rawText = truncate(descriptionText.length > pageText.length ? descriptionText : pageText);
    if (rawText.length < JD_FETCH_MIN_CHARS) throw jdFetchError("fetch_too_short");

    d.log("jd_fetch.succeeded", { host, code: "ok", bytes, elapsedMs: d.now() - startedAt });
    return { rawText, companyName: posting.companyName, positionTitle: posting.title };
  } catch (err) {
    // Host, code, bytes, elapsed only — never the path, the query, or any page text (CF-A16).
    d.log("jd_fetch.failed", { host, code: codeOf(err), bytes, elapsedMs: d.now() - startedAt });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export type { JdFetchErrorCode };
