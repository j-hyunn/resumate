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

function stripDroppedElements(html: string): string {
  let out = html;
  for (const tag of DROPPED_ELEMENTS) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}\\s*>`, "gi"), " ");
    out = out.replace(new RegExp(`<${tag}\\b[^>]*/?>`, "gi"), " ");
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
  const open = /<(div|section|ul|ol|dl|table)\b[^>]*(?:class|id)\s*=\s*["']([^"']*)["'][^>]*>/gi;
  let out = "";
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = open.exec(html)) !== null) {
    if (match.index < cursor) continue;
    const [whole, tagRaw, attr] = [match[0], match[1]!, match[2]!];
    if (!BOILERPLATE_ATTR.test(attr)) continue;
    const tag = tagRaw.toLowerCase();
    const end = findCloseTag(html, open.lastIndex, tag);
    if (end === -1) continue;
    out += html.slice(cursor, match.index);
    cursor = end;
    open.lastIndex = end;
    void whole;
  }
  return out + html.slice(cursor);
}

/** Index just past the matching close tag of an already-open element. */
function findCloseTag(html: string, from: number, tag: string): number {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  re.lastIndex = from;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    depth += m[1] === "/" ? -1 : 1;
    if (depth === 0) return re.lastIndex;
  }
  return -1;
}

const BLOCK_TAGS = /<\/?(p|div|br|li|tr|h[1-6]|section|article|header|footer|blockquote|pre|dd|dt|dl|ul|ol|table|thead|tbody|figure|figcaption|hr|address|main)\b[^>]*>/gi;

/** HTML → plain text with one line per block element, entities decoded. */
export function htmlToText(html: string): string {
  let text = stripBoilerplateBlocks(stripDroppedElements(html));
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(/<(td|th)\b[^>]*>/gi, "\t");
  text = text.replace(BLOCK_TAGS, "\n");
  text = text.replace(/<[^>]*>/g, " ");
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
    const trimmed = decodeEntities(value).replace(/\s+/g, " ").trim();
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
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    let parsed: unknown;
    try {
      // Some pages wrap the JSON in a CDATA section.
      parsed = JSON.parse(m[1]!.replace(/^\s*(?:\/\/)?\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, ""));
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
  const out: string[] = [];
  const re = /<(?:iframe|frame)\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(decodeEntities(m[1]!));
  return out;
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
