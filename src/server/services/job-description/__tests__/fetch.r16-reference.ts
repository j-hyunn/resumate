/**
 * TEST-ONLY — the R16 regex implementation of `fetch.ts` as committed in `df106bc` (before the
 * hotfix merge and QA-R16-01), kept verbatim except the `../ssrf` import path, so
 * `fetch.redos.test.ts` can prove the linear scanners give **byte-identical Markdown**. It contains
 * the super-linear regexes the fix removes: never import it from app code, and never feed it large
 * input (the differential test uses small strings only).
 */
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
import { assertSafeUrl, defaultLookup, type LookupFn } from "../ssrf";

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

// ---------------- HTML → Markdown (R16) ----------------
//
// The fetched posting is stored as **Markdown** so S-46's editor (TipTap + `@tiptap/markdown`,
// `TableKit` on) keeps headings, lists, emphasis and tables. Regex-based like the rest of this file
// — no DOM in the runtime, no new dependency. Markdown characters that occur in the posting's own
// text are **not** escaped `[가정]` (a stray `*` rendering oddly beats `\` littering the 원문),
// except `|` inside a table cell, which would break the table.

/** Blocks separated by a blank line (one newline is a soft break inside a paragraph in Markdown). */
const BLOCK_TAGS = /<\/?(p|div|section|article|blockquote|pre|dd|dt|dl|figure|figcaption|hr|address|main|header|footer|thead|tbody|tfoot)\b[^>]*>/gi;
/** Tags that must not appear inside a `**…**` / `_…_` run (the emphasis is dropped instead). */
const BLOCKISH_INSIDE = /<\/?(p|div|section|article|blockquote|pre|ul|ol|li|table|tr|td|th|h[1-6]|dl|dd|dt|br|hr)\b/i;

/** Placeholder for a finished table, so later passes (entities, whitespace) never touch it. */
const TABLE_TOKEN = (n: number) => `\u0000TABLE${n}\u0000`;
const TABLE_TOKEN_RE = /\u0000TABLE(\d+)\u0000/g;

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, " ");
}

/** One line of text: tags out, entities decoded, whitespace collapsed. */
function inlineText(html: string): string {
  return decodeEntities(stripTags(html)).replace(/\s+/g, " ").trim();
}

/** `<strong>/<b>` → `**…**`, `<em>/<i>` → `_…_` (never `*`: at a line start it reads as a list). */
function convertEmphasis(html: string): string {
  const wrap = (marker: string) => (_m: string, _tag: string, inner: string) => {
    // A block inside the run can't be wrapped in Markdown: keep the content, drop the emphasis.
    if (BLOCKISH_INSIDE.test(inner)) return inner;
    const lead = /^\s*/.exec(inner)![0];
    const trail = /\s*$/.exec(inner)![0];
    const core = inner.slice(lead.length, inner.length - trail.length);
    // Empty runs (`<b> </b>`) would leave a stray `** **`.
    if (inlineText(core) === "") return inner;
    // Keep the spaces outside the markers: `** 주요 **` is not bold in Markdown.
    return `${lead}${marker}${core}${marker}${trail}`;
  };
  return html
    .replace(/<(strong|b)(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/gi, wrap("**"))
    .replace(/<(em|i)(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/gi, wrap("_"));
}

/** `h1`–`h6` → atx heading on its own paragraph. Inner tags are flattened (no emphasis in a heading). */
function convertHeadings(html: string): string {
  return html.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_m, level: string, inner: string) => {
    const text = inlineText(inner.replace(/<br\s*\/?>/gi, " "));
    return text ? `\n\n${"#".repeat(Number(level))} ${text}\n\n` : "\n\n";
  });
}

/**
 * `ul > li` → `- `, `ol > li` → `1. ` (the renderer numbers them). Innermost list first, so a nested
 * list is already text when its parent is converted; nesting flattens (lines are trimmed — accepted).
 * Blocks inside an item are folded into the item's line so the marker never stands alone.
 */
function convertLists(html: string): string {
  const innermost = /<(ul|ol)\b[^>]*>((?:(?!<(?:ul|ol)\b)[\s\S])*?)<\/\1\s*>/gi;
  let out = html;
  for (let guard = 0; guard < 50; guard++) {
    const next = out.replace(innermost, (_m, tag: string, inner: string) => {
      const marker = tag.toLowerCase() === "ol" ? "1. " : "- ";
      const items = inner
        .replace(/<\/?(p|div|span|section)\b[^>]*>/gi, " ")
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<\/li\s*>/gi, "")
        .split(/<li\b[^>]*>/i)
        .slice(1)
        // An item with no text (`<li><b></b></li>`) would leave a bare "-" line: drop it.
        .filter((item) => inlineText(item) !== "")
        .map((item) => `\n${marker}${item}`)
        .join("");
      return items ? `\n\n${items}\n\n` : "\n\n";
    });
    if (next === out) break;
    out = next;
  }
  // An orphan <li> (no list around it) still reads as an item.
  return out.replace(/<\/li\s*>/gi, "").replace(/<li\b[^>]*>/gi, "\n- ");
}

type TableCell = { text: string; colspan: number; rowspan: number; header: boolean };

/** One table cell's text: emphasis kept, links as text, line breaks folded, `|` escaped. */
function cellText(inner: string, flatTables: readonly string[]): string {
  const withInner = inner.replace(TABLE_TOKEN_RE, (_m, n: string) => ` ${flatTables[Number(n)] ?? ""} `);
  return inlineText(convertEmphasis(withInner).replace(/<br\s*\/?>/gi, " ")).replace(/\|/g, "\\|");
}

function spanOf(attrs: string, name: "colspan" | "rowspan"): number {
  const m = new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, "i").exec(attrs);
  const n = m ? Number(m[1]) : 1;
  return Number.isInteger(n) && n >= 1 ? Math.min(n, 50) : 1;
}

/**
 * GFM table (R16, UI 확인 2026-11-12: the editor's `TableKit` renders it as a real table).
 * The header row is the first row with a `<th>`, else the first row (GFM needs one), followed by
 * `| --- |`. colspan → trailing empty cells, rowspan → an empty cell in the rows below, and every
 * row is padded to the widest one.
 */
function renderTable(inner: string, flatTables: readonly string[]): { markdown: string; flat: string } {
  const rows: TableCell[][] = [];
  for (const tr of inner.matchAll(/<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/table|$)/gi)) {
    const cells: TableCell[] = [];
    for (const td of tr[1]!.matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)(?=<(?:td|th)\b|<\/tr\s*>|$)/gi)) {
      cells.push({ text: cellText(td[3]!.replace(/<\/(td|th)\s*>/gi, ""), flatTables), colspan: spanOf(td[2]!, "colspan"), rowspan: spanOf(td[2]!, "rowspan"), header: td[1]!.toLowerCase() === "th" });
    }
    if (cells.length > 0) rows.push(cells);
  }
  if (rows.length === 0) return { markdown: "", flat: "" };

  // Lay the cells on a grid: rowspan reserves the column in the rows below.
  const grid: string[][] = [];
  const reserved: number[] = [];
  rows.forEach((cells, r) => {
    const line: string[] = [];
    let col = 0;
    const take = () => {
      while ((reserved[col] ?? 0) > 0) {
        reserved[col]!--;
        line.push("");
        col++;
      }
    };
    for (const cell of cells) {
      take();
      line.push(cell.text);
      if (cell.rowspan > 1) reserved[col] = Math.max(reserved[col] ?? 0, cell.rowspan - 1);
      col++;
      for (let k = 1; k < cell.colspan; k++) {
        line.push("");
        col++;
      }
    }
    take();
    grid[r] = line;
  });
  // A table with no text at all (layout scaffolding) would leave `|  |` / `| --- |`: emit nothing.
  if (grid.every((l) => l.every((c) => c === ""))) return { markdown: "", flat: "" };
  const width = Math.max(...grid.map((l) => l.length));
  for (const l of grid) while (l.length < width) l.push("");

  const headerIndex = Math.max(0, rows.findIndex((cells) => cells.some((c) => c.header)));
  const ordered = [grid[headerIndex]!, ...grid.filter((_, i) => i !== headerIndex)];
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  const markdown = [line(ordered[0]!), line(Array.from({ length: width }, () => "---")), ...ordered.slice(1).map(line)].join("\n");
  return { markdown, flat: grid.flat().filter(Boolean).join(" ") };
}

/** Innermost table first; each finished table becomes a token so nothing later rewrites it. */
function convertTables(html: string, tables: string[], flatTables: string[]): string {
  const innermost = /<table\b[^>]*>((?:(?!<table\b)[\s\S])*?)<\/table\s*>/gi;
  let out = html;
  for (let guard = 0; guard < 50; guard++) {
    const next = out.replace(innermost, (_m, inner: string) => {
      const { markdown, flat } = renderTable(inner, flatTables);
      if (!markdown) return "\n\n";
      tables.push(markdown);
      flatTables.push(flat);
      return `\n\n${TABLE_TOKEN(tables.length - 1)}\n\n`;
    });
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * HTML → Markdown (R16). Headings `#`…`######`, `- ` / `1. ` lists, `**bold**`, `_italic_`, `<br>` =
 * line break, blocks separated by a **blank line**, GFM tables, links as their text only (a posting
 * URL may carry tracking tokens — CF-A16), images / scripts / styles dropped.
 */
export function htmlToMarkdown(html: string): string {
  const tables: string[] = [];
  const flatTables: string[] = [];
  let md = stripBoilerplateBlocks(stripDroppedElements(html));
  md = md.replace(/<!--[\s\S]*?-->/g, " ");
  md = md.replace(/<img\b[^>]*>/gi, " ");
  md = convertTables(md, tables, flatTables);
  md = convertHeadings(md);
  md = convertLists(md);
  md = convertEmphasis(md);
  md = md.replace(/<br\s*\/?>/gi, "\n");
  md = md.replace(BLOCK_TAGS, "\n\n");
  md = md.replace(/<\/?(li|tr|td|th|table|ul|ol)\b[^>]*>/gi, "\n");
  // Links (and every other inline tag) keep their text only.
  md = stripTags(md);
  md = decodeEntities(md);
  md = normalizeText(md);
  // NFC like `normalizeJdRawText` (A3), so the string the screen receives is byte-identical to what
  // the preview and create paths hash and store (CF-A17) — a site serving NFD Hangul can't skew it.
  return md.replace(TABLE_TOKEN_RE, (_m, n: string) => tables[Number(n)] ?? "").normalize("NFC");
}

/**
 * Characters of the Markdown that are the posting's own text — the `fetch_too_short` floor and the
 * "which source has more" comparison must not move because of syntax (R16). Drops heading / list
 * markers at a line start, `**`, `_…_` runs, table syntax (`|`, the `| --- |` line) and **blank
 * lines** (the paragraph separators R16 adds); each remaining line break counts as one character,
 * the same as the old one-line-per-block text, so the 200 floor keeps its meaning.
 */
export function markdownTextLength(md: string): number {
  const ESC_PIPE = "\u0001";
  return md
    .replace(/\\\|/g, ESC_PIPE)
    .split("\n")
    .filter((line) => !/^\|(?:\s*:?-{3,}:?\s*\|)+$/.test(line.trim()))
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, "")
        .replace(/^(?:[-*+]|\d+\.)\s+/, "")
        .replace(/\*\*/g, "")
        .replace(/(^|[^\w])_(\S(?:[^_\n]*\S)?)_(?=[^\w]|$)/g, "$1$2")
        .replace(/\s*\|\s*/g, " ")
        .trim(),
    )
    .filter((line) => line !== "")
    .join("\n")
    .replace(new RegExp(ESC_PIPE, "g"), "|").length;
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

/**
 * `raw_text` is capped at 50,000 characters of **Markdown** (the stored string). R16: cut at a line
 * boundary so a `**…**` pair or a table row is never split; a single line longer than the cap is
 * cut hard, dropping an unmatched trailing `**`.
 */
export function truncate(text: string): string {
  if (text.length <= JD_FETCH_RAW_TEXT_MAX) return text;
  const window = text.slice(0, JD_FETCH_RAW_TEXT_MAX);
  const cut = window.lastIndexOf("\n");
  if (cut > 0) return window.slice(0, cut).trimEnd();
  const pairs = window.match(/\*\*/g)?.length ?? 0;
  return pairs % 2 === 1 ? window.slice(0, window.lastIndexOf("**")).trimEnd() : window;
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
        const frameText = htmlToMarkdown(framePage.html);
        if (markdownTextLength(frameText) >= JD_FETCH_MIN_CHARS) {
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

    const pageText = htmlToMarkdown(page.html);
    const descriptionText = posting.descriptionHtml ? htmlToMarkdown(posting.descriptionHtml) : "";
    // The JSON-LD description is the posting body when the page markup gives less (compared on the
    // text itself, so Markdown syntax never tips the choice — R16).
    const rawText = truncate(markdownTextLength(descriptionText) > markdownTextLength(pageText) ? descriptionText : pageText);
    if (markdownTextLength(rawText) < JD_FETCH_MIN_CHARS) throw jdFetchError("fetch_too_short");

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
