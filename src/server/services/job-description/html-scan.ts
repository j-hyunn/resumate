/**
 * Linear-time HTML scanners for the JD fetch (hotfix QA-R16-02).
 *
 * Every function here reproduces the **exact match semantics** of the regex it replaces in R15's
 * `fetch.ts` (leftmost match, non-overlapping, resume after the match end, the same greedy / lazy
 * choices) — so the output is byte-identical — but runs in O(n). The regexes were super-linear on
 * attacker-chosen input: `[^>]*` re-scans to the same `>` from every `<` (O(n²)), and a greedy
 * `[^>]*` in front of an attribute pattern backtracks over every position of the tag for every
 * candidate (O(n³)). A synchronous regex also blocks the 10 s deadline timer and every other
 * request on the instance.
 *
 * The trick throughout: an unmatched `<` has no `>` after it, and then **no later `<` has one
 * either** — so a scan can stop instead of trying each remaining start. Equivalence is pinned by
 * a differential fuzz test against the original regexes (`fetch.redos.test.ts`).
 *
 * Pure: no Next.js or DB imports.
 */

/** `\w` in a non-unicode JS regex (the `\b` definition): `[A-Za-z0-9_]`. */
export function isWordChar(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
}

/**
 * `\s` in a JS regex: WhiteSpace + LineTerminator (ECMA-262) — TAB, VT, FF, SP, NBSP, ZWNBSP,
 * the Zs category, LF, CR, LS, PS.
 */
export function isJsSpace(code: number): boolean {
  return (
    (code >= 9 && code <= 13) ||
    code === 32 ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

/**
 * ASCII case-insensitive `s.startsWith(word, at)`; `word` is lowercase ASCII. Exact for the `i`
 * flag on ASCII patterns: a non-unicode `/i` never folds a non-ASCII character onto an ASCII
 * letter (Canonicalize keeps ≥ 128 characters whose upper case would be < 128).
 */
export function startsWithCI(s: string, at: number, word: string): boolean {
  if (at < 0 || at + word.length > s.length) return false;
  for (let k = 0; k < word.length; k++) {
    let c = s.charCodeAt(at + k);
    if (c >= 65 && c <= 90) c += 32;
    if (c !== word.charCodeAt(k)) return false;
  }
  return true;
}

/** End of the maximal `\w` run starting at `i`. */
function wordEnd(s: string, i: number): number {
  let j = i;
  while (j < s.length && isWordChar(s.charCodeAt(j))) j++;
  return j;
}

/** The lowercase tag name right at `i` if it is one of `names` (a maximal `\w` run = the `\b` rule). */
function nameAt(s: string, i: number, names: ReadonlySet<string>, maxLen: number): { name: string; end: number } | null {
  const end = wordEnd(s, i);
  const len = end - i;
  if (len === 0 || len > maxLen) return null;
  const name = s.slice(i, end).toLowerCase();
  return names.has(name) ? { name, end } : null;
}

function maxLength(names: ReadonlySet<string>): number {
  let m = 0;
  for (const n of names) m = Math.max(m, n.length);
  return m;
}

/** `s.replace(/<[^>]*>/g, rep)`. */
export function replaceAnyTag(s: string, rep: string): string {
  let out = "";
  let p = 0;
  for (;;) {
    const lt = s.indexOf("<", p);
    if (lt === -1) break;
    // `[^>]*>` from `<`: the first `>` after it. None → no later `<` has one either.
    const gt = s.indexOf(">", lt + 1);
    if (gt === -1) break;
    out += s.slice(p, lt) + rep;
    p = gt + 1;
  }
  return out + s.slice(p);
}

/** `s.replace(/<!--[\s\S]*?-->/g, rep)`. */
export function replaceComments(s: string, rep: string): string {
  let out = "";
  let p = 0;
  for (;;) {
    const start = s.indexOf("<!--", p);
    if (start === -1) break;
    const end = s.indexOf("-->", start + 4);
    // No `-->` after this `<!--` → none after any later one.
    if (end === -1) break;
    out += s.slice(p, start) + rep;
    p = end + 3;
  }
  return out + s.slice(p);
}

/**
 * `s.replace(/<\/?(name1|name2|…)\b[^>]*>/gi, rep)` (or without `\/?` when `allowSlash` is false).
 * The names are lowercase ASCII words.
 */
export function replaceNamedTags(s: string, names: ReadonlySet<string>, allowSlash: boolean, rep: string): string {
  const maxLen = maxLength(names);
  let out = "";
  let p = 0;
  let i = 0;
  for (;;) {
    const lt = s.indexOf("<", i);
    if (lt === -1) break;
    let j = lt + 1;
    if (allowSlash && s.charCodeAt(j) === 47 /* / */) j++;
    const hit = nameAt(s, j, names, maxLen);
    if (!hit) {
      i = lt + 1;
      continue;
    }
    const gt = s.indexOf(">", hit.end);
    if (gt === -1) break;
    out += s.slice(p, lt) + rep;
    p = gt + 1;
    i = gt + 1;
  }
  return out + s.slice(p);
}

/** Index just past the first `</tag\s*>` (case-insensitive) at or after `from`, or -1. */
function findCloseElement(s: string, tag: string, from: number): number {
  let k = from;
  for (;;) {
    const at = s.indexOf("</", k);
    if (at === -1) return -1;
    if (startsWithCI(s, at + 2, tag)) {
      let q = at + 2 + tag.length;
      while (q < s.length && isJsSpace(s.charCodeAt(q))) q++;
      if (s.charCodeAt(q) === 62 /* > */) return q + 1;
    }
    k = at + 1;
  }
}

/**
 * `s.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}\\s*>`, "gi"), rep)`: an element and its
 * content, up to the **first** close tag after the open tag (lazy).
 */
export function removeElements(s: string, tag: string, rep: string): string {
  const names = new Set([tag]);
  let out = "";
  let p = 0;
  let i = 0;
  for (;;) {
    const lt = s.indexOf("<", i);
    if (lt === -1) break;
    const hit = nameAt(s, lt + 1, names, tag.length);
    if (!hit) {
      i = lt + 1;
      continue;
    }
    const gt = s.indexOf(">", hit.end);
    // A later open tag's `>` is no earlier, so its close search range is a subset: stop.
    if (gt === -1) break;
    const end = findCloseElement(s, tag, gt + 1);
    if (end === -1) break;
    out += s.slice(p, lt) + rep;
    p = end;
    i = end;
  }
  return out + s.slice(p);
}

// ---------------- greedy `[^>]*` + attribute pattern (the O(n³) ones) ----------------
//
// For a candidate open tag whose name ends at `a`, a greedy `[^>]*` before an attribute pattern X
// picks the **largest** start k in [a, g) where X (and the rest) matches, g = the first `>` at or
// after `a`. X is deterministic at a fixed k (no internal backtracking choices), so the regex
// result is "the last valid k before g". A prefix table of "last valid k before p" answers that in
// O(1), built once in O(n).

type Tables = {
  /** First `>` at or after i (-1 = none). */
  nextGt: Int32Array;
  /** First non-`\s` at or after i (n = none). */
  nextNonSpace: Int32Array;
  /** First `"` or `'` at or after i (-1 = none). */
  nextQuote: Int32Array;
};

function buildTables(s: string): Tables {
  const n = s.length;
  const nextGt = new Int32Array(n + 1);
  const nextNonSpace = new Int32Array(n + 1);
  const nextQuote = new Int32Array(n + 1);
  nextGt[n] = -1;
  nextNonSpace[n] = n;
  nextQuote[n] = -1;
  for (let i = n - 1; i >= 0; i--) {
    const c = s.charCodeAt(i);
    nextGt[i] = c === 62 ? i : nextGt[i + 1]!;
    nextNonSpace[i] = isJsSpace(c) ? nextNonSpace[i + 1]! : i;
    nextQuote[i] = c === 34 || c === 39 ? i : nextQuote[i + 1]!;
  }
  return { nextGt, nextNonSpace, nextQuote };
}

/**
 * `name\s*=\s*["']` + value + `["']` starting at k. `minValue` = 0 for `[^"']*`, 1 for `[^"']+`.
 * Returns the value span and the index just after the closing quote, or null.
 */
function quotedAttrAt(s: string, t: Tables, k: number, nameLen: number, minValue: 0 | 1): { valueStart: number; valueEnd: number; after: number } | null {
  const eq = t.nextNonSpace[k + nameLen]!;
  if (s.charCodeAt(eq) !== 61 /* = */) return null;
  const quote = t.nextNonSpace[eq + 1]!;
  const qc = s.charCodeAt(quote);
  if (qc !== 34 && qc !== 39) return null;
  const close = t.nextQuote[quote + 1]!;
  if (close === -1 || close - (quote + 1) < minValue) return null;
  return { valueStart: quote + 1, valueEnd: close, after: close + 1 };
}

/** Prefix table: `last[p]` = largest valid k < p, or -1. */
function lastValidTable(n: number, valid: (k: number) => boolean): Int32Array {
  const last = new Int32Array(n + 1);
  last[0] = -1;
  for (let k = 0; k < n; k++) last[k + 1] = valid(k) ? k : last[k]!;
  return last;
}

export type OpenTagMatch = { index: number; end: number; name: string; value: string };

/**
 * Every match of `/<(name…)\b[^>]*<X>[^>]*>/gi` in order, where X =
 * `(?:attr1|attr2)\s*=\s*["']([^"']*|+)["']` — leftmost, non-overlapping, each search resuming at
 * `resumeAt(match)` (the regex's `lastIndex`, which the caller may move forward).
 */
function* openTagsWithAttr(
  s: string,
  names: ReadonlySet<string>,
  attrNames: readonly string[],
  opts: { boundaryBeforeAttr: boolean; minValue: 0 | 1 },
): Generator<OpenTagMatch, void, number | undefined> {
  const n = s.length;
  const t = buildTables(s);
  const attrAt = (k: number): { valueStart: number; valueEnd: number; after: number } | null => {
    if (opts.boundaryBeforeAttr && k > 0 && isWordChar(s.charCodeAt(k - 1))) return null;
    for (const attr of attrNames) {
      if (!startsWithCI(s, k, attr)) continue;
      // Alternatives start with different letters, so at most one can match at k.
      return quotedAttrAt(s, t, k, attr.length, opts.minValue);
    }
    return null;
  };
  // Valid k: X matches at k AND a `>` follows the closing quote (the trailing `[^>]*>`).
  const valid = (k: number): boolean => {
    const x = attrAt(k);
    return x !== null && t.nextGt[x.after]! !== -1;
  };
  const last = lastValidTable(n, valid);
  const maxLen = maxLength(names);

  let i = 0;
  for (;;) {
    const lt = s.indexOf("<", i);
    if (lt === -1) return;
    const hit = nameAt(s, lt + 1, names, maxLen);
    if (!hit) {
      i = lt + 1;
      continue;
    }
    const g = t.nextGt[hit.end]!;
    if (g === -1) return; // no `>` after this name → none after any later one
    const k = last[g]!;
    if (k < hit.end) {
      i = lt + 1;
      continue;
    }
    const x = attrAt(k)!;
    const end = t.nextGt[x.after]! + 1;
    const resume = yield { index: lt, end, name: hit.name, value: s.slice(x.valueStart, x.valueEnd) };
    i = resume ?? end;
  }
}

/**
 * `/<(div|section|ul|ol|dl|table)\b[^>]*(?:class|id)\s*=\s*["']([^"']*)["'][^>]*>/gi` matches.
 * The consumer passes the next search start back through `next(resumeAt)`.
 */
export function boilerplateOpenTags(s: string): Generator<OpenTagMatch, void, number | undefined> {
  return openTagsWithAttr(s, new Set(["div", "section", "ul", "ol", "dl", "table"]), ["class", "id"], { boundaryBeforeAttr: false, minValue: 0 });
}

/** `/<(?:iframe|frame)\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi` capture values, in order. */
export function frameSrcValues(s: string): string[] {
  const out: string[] = [];
  for (const m of openTagsWithAttr(s, new Set(["iframe", "frame"]), ["src"], { boundaryBeforeAttr: true, minValue: 1 })) out.push(m.value);
  return out;
}

/**
 * `findCloseTag(html, from, tag)` of R15: from `from`, count `/<(\/?)tag\b[^>]*>/gi` matches as
 * +1 / -1 starting at depth 1, and return the index after the match that brings it to 0.
 *
 * Built once per tag for the whole string: every call site passes a `from` right after a `>`, and
 * no `<…>` match can straddle such a position (a match ends at the first `>` after its name), so
 * the matches found from `from` are exactly the global matches starting at or after `from`. The
 * first return to depth 0 is a "next smaller prefix sum" query — a monotonic stack answers all of
 * them in O(m).
 */
export function closeTagFinder(s: string, tag: string): (from: number) => number {
  const starts: number[] = [];
  const ends: number[] = [];
  const deltas: number[] = [];
  const names = new Set([tag]);
  let i = 0;
  for (;;) {
    const lt = s.indexOf("<", i);
    if (lt === -1) break;
    const slash = s.charCodeAt(lt + 1) === 47;
    const hit = nameAt(s, lt + (slash ? 2 : 1), names, tag.length);
    if (!hit) {
      i = lt + 1;
      continue;
    }
    const gt = s.indexOf(">", hit.end);
    if (gt === -1) break;
    starts.push(lt);
    ends.push(gt + 1);
    deltas.push(slash ? -1 : 1);
    i = gt + 1;
  }
  const m = deltas.length;
  // prefix[t] = sum of deltas[0..t-1]; nextLower[t] = first t' > t with prefix[t'] < prefix[t].
  const prefix = new Int32Array(m + 1);
  for (let t = 0; t < m; t++) prefix[t + 1] = prefix[t]! + deltas[t]!;
  const nextLower = new Int32Array(m + 1).fill(-1);
  const stack: number[] = [];
  for (let t = 0; t <= m; t++) {
    while (stack.length > 0 && prefix[t]! < prefix[stack[stack.length - 1]!]!) nextLower[stack.pop()!] = t;
    stack.push(t);
  }
  return (from: number) => {
    // First match starting at or after `from`.
    let lo = 0;
    let hi = m;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid]! < from) lo = mid + 1;
      else hi = mid;
    }
    // Depth 1 + (prefix[t] - prefix[lo]) hits 0 at the first t > lo with prefix[t] = prefix[lo] - 1
    // (steps are ±1, so the first prefix below prefix[lo] is exactly that).
    const t = nextLower[lo]!;
    return t === -1 ? -1 : ends[t - 1]!;
  };
}

/**
 * `/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi` capture
 * bodies, in order. The `type=…` literal holds no `>`, so the open tag always ends at the first `>`
 * after `<script`; only whether such a `type` occurs before that `>` matters.
 */
export function ldJsonBodies(s: string): string[] {
  const n = s.length;
  const t = buildTables(s);
  const LIT = "application/ld+json";
  const typeAt = (k: number): boolean => {
    if (!startsWithCI(s, k, "type")) return false;
    const eq = t.nextNonSpace[k + 4]!;
    if (s.charCodeAt(eq) !== 61) return false;
    const q1 = t.nextNonSpace[eq + 1]!;
    const c1 = s.charCodeAt(q1);
    if (c1 !== 34 && c1 !== 39) return false;
    if (!startsWithCI(s, q1 + 1, LIT)) return false;
    const c2 = s.charCodeAt(q1 + 1 + LIT.length);
    return c2 === 34 || c2 === 39;
  };
  const last = lastValidTable(n, typeAt);
  const names = new Set(["script"]);
  const out: string[] = [];
  let i = 0;
  for (;;) {
    const lt = s.indexOf("<", i);
    if (lt === -1) break;
    const hit = nameAt(s, lt + 1, names, 6);
    if (!hit) {
      i = lt + 1;
      continue;
    }
    const g = t.nextGt[hit.end]!;
    if (g === -1) break;
    if (last[g]! < hit.end) {
      i = lt + 1;
      continue;
    }
    const closeEnd = findCloseElement(s, "script", g + 1);
    if (closeEnd === -1) break; // a later `<script>`'s body range is a subset: none
    const closeStart = s.lastIndexOf("</", closeEnd - 1);
    out.push(s.slice(g + 1, closeStart));
    i = closeEnd;
  }
  return out;
}

/** `body.replace(/^\s*(?:\/\/)?\s*<!\[CDATA\[/, "")` without the O(k²) `\s*\s*` backtracking. */
export function stripCdataOpen(body: string): string {
  let p = 0;
  while (p < body.length && isJsSpace(body.charCodeAt(p))) p++;
  if (body.startsWith("<![CDATA[", p)) return body.slice(p + 9);
  if (body.startsWith("//", p)) {
    let q = p + 2;
    while (q < body.length && isJsSpace(body.charCodeAt(q))) q++;
    if (body.startsWith("<![CDATA[", q)) return body.slice(q + 9);
  }
  return body;
}

// ---------------- R16 Markdown conversion (QA-R16-01) ----------------
//
// R16's element regexes pair an open tag with its close through a lazy `[\s\S]*?` — from every
// unclosed open tag the regex searched to the end of the string (O(n²)). The scanners below find
// the same matches from precomputed, sorted position lists: candidate starts come from a literal
// regex scan (native, linear, the same `/i` folding as the original), the open tag ends at the
// first `>` after its name (a cached `indexOf`, monotonic so amortised O(n)), and the lazy body ends
// at the first matching close at or after it (binary search).

/** Ascending start positions of the literal `lit` (lowercase ASCII), matched like a non-unicode `/i`. */
const literalRegexes = new Map<string, RegExp>();

function positionsCI(s: string, lit: string): number[] {
  // Cached per literal: table rows / cells call this once per row, ~280k times on a hostile table.
  let re = literalRegexes.get(lit);
  if (!re) {
    re = new RegExp(lit.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"), "gi");
    literalRegexes.set(lit, re);
  }
  re.lastIndex = 0;
  const out: number[] = [];
  // `test` + `lastIndex` allocates nothing per match; non-unicode `/i` maps each character to one
  // character, so a match is always `lit.length` long.
  while (re.test(s)) out.push(re.lastIndex - lit.length);
  return out;
}

/** First index `i` with `xs[i] >= x` (`xs.length` when none). */
function lowerBound(xs: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Positions of `<name\b` (CI). */
function boundaryStarts(s: string, name: string): number[] {
  return positionsCI(s, `<${name}`).filter((p) => {
    const c = p + 1 + name.length;
    return c >= s.length || !isWordChar(s.charCodeAt(c));
  });
}

/** `/<\/name\s*>/gi` matches as `{pos, end}` (CI). */
function closeTags(s: string, name: string): { pos: number[]; end: number[] } {
  const pos: number[] = [];
  const end: number[] = [];
  for (const p of positionsCI(s, `</${name}`)) {
    let j = p + 2 + name.length;
    while (j < s.length && isJsSpace(s.charCodeAt(j))) j++;
    if (s.charCodeAt(j) === 62 /* > */) {
      pos.push(p);
      end.push(j + 1);
    }
  }
  return { pos, end };
}

/** Merges per-name ascending position lists into one ascending `[pos, nameIndex]` stream. */
function mergeStarts(lists: readonly number[][]): { pos: number[]; name: number[] } {
  const pos: number[] = [];
  const name: number[] = [];
  const at = lists.map(() => 0);
  for (;;) {
    let best = -1;
    for (let k = 0; k < lists.length; k++) {
      if (at[k]! < lists[k]!.length && (best === -1 || lists[k]![at[k]!]! < lists[best]![at[best]!]!)) best = k;
    }
    if (best === -1) break;
    pos.push(lists[best]![at[best]!]!);
    name.push(best);
    at[best]!++;
  }
  return { pos, name };
}

/** Where a candidate open tag's name is followed by what the regex needs after it. */
export type OpenTagRule =
  /** `(?:\s[^>]*)?>` — a JS space or `>` right after the name (`<b>`, `<b class=x>`, not `<br>`). */
  | "attrs"
  /** `\b[^>]*>` — a non-word character (or the end) right after the name. */
  | "boundary";

function openStarts(s: string, names: readonly string[], rule: OpenTagRule): { pos: number[]; name: number[] } {
  return mergeStarts(
    names.map((n) =>
      rule === "boundary"
        ? boundaryStarts(s, n)
        : positionsCI(s, `<${n}`).filter((p) => {
            const c = s.charCodeAt(p + 1 + n.length);
            return c === 62 || isJsSpace(c);
          }),
    ),
  );
}

/**
 * `s.replace(/<(n1|n2|…)OPEN(BODY)<\/\1\s*>/gi, (_, name, inner) => rep(name, inner))` where OPEN is
 * the `rule` and BODY is `[\s\S]*?`, or with `tempered` the "stop at the next open of the family"
 * body `(?:(?!<(?:n1|n2|…)\b)[\s\S])*?` (R16 tables and lists; `rule` must then be "boundary").
 * `rep` gets the tag name **as written** (the `\1` backreference compares case-insensitively).
 *
 * Names are lowercase ASCII and no name can match where another does (`strong`/`b`, `em`/`i`,
 * `ul`/`ol`, `h1`…`h6`, `table`), so the alternation order never matters.
 */
export function replacePairedElements(
  s: string,
  names: readonly string[],
  rule: OpenTagRule,
  tempered: boolean,
  rep: (name: string, inner: string) => string,
): string {
  // Most calls are on one table cell's text with no tag at all.
  if (s.indexOf("<") === -1) return s;
  const opens = openStarts(s, names, rule);
  if (opens.pos.length === 0) return s;
  const closes = names.map((n) => closeTags(s, n));
  // The tempered body may not cross `<name\b` of any family name — exactly the open candidates.
  const blockers = tempered ? opens.pos : null;
  let out = "";
  let cursor = 0;
  let gt = -1;
  for (let t = 0; t < opens.pos.length; t++) {
    const pos = opens.pos[t]!;
    if (pos < cursor) continue;
    const ni = opens.name[t]!;
    const from = pos + 1 + names[ni]!.length;
    // `[^>]*>`: the first `>` after the name. Cached — candidates only move right. None → no later
    // open tag can end either.
    if (gt < from) {
      gt = s.indexOf(">", from);
      if (gt === -1) break;
    }
    const q = gt + 1;
    const c = closes[ni]!;
    const k = lowerBound(c.pos, q);
    if (k === c.pos.length) continue;
    const closePos = c.pos[k]!;
    if (blockers) {
      const b = lowerBound(blockers, q);
      if (b < blockers.length && blockers[b]! < closePos) continue;
    }
    out += s.slice(cursor, pos) + rep(s.slice(pos + 1, from), s.slice(q, closePos));
    cursor = c.end[k]!;
  }
  return cursor === 0 ? s : out + s.slice(cursor);
}

/** One `<name …>` segment of {@link openSegments}. */
export type OpenSegment = { name: string; attrs: string; body: string };

/**
 * `[...s.matchAll(/<(n1|n2|…)\b([^>]*)>([\s\S]*?)(?=STOP|$)/gi)]` as `{name, attrs, body}`, where
 * `stops` are the ascending positions at which STOP matches (the lookahead).
 */
function openSegments(s: string, names: readonly string[], stops: readonly number[]): OpenSegment[] {
  const opens = openStarts(s, names, "boundary");
  const out: OpenSegment[] = [];
  let cursor = 0;
  let gt = -1;
  for (let t = 0; t < opens.pos.length; t++) {
    const pos = opens.pos[t]!;
    if (pos < cursor) continue;
    const from = pos + 1 + names[opens.name[t]!]!.length;
    if (gt < from) {
      gt = s.indexOf(">", from);
      if (gt === -1) break;
    }
    const q = gt + 1;
    const k = lowerBound(stops, q);
    const end = k < stops.length ? stops[k]! : s.length;
    out.push({ name: s.slice(pos + 1, from), attrs: s.slice(from, gt), body: s.slice(q, end) });
    cursor = end;
  }
  return out;
}

function mergedPositions(lists: readonly number[][]): number[] {
  return mergeStarts(lists).pos;
}

/** R16 table rows: `inner.matchAll(/<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/table|$)/gi)` → bodies. */
export function tableRows(inner: string): string[] {
  const stops = mergedPositions([boundaryStarts(inner, "tr"), positionsCI(inner, "</table")]);
  return openSegments(inner, ["tr"], stops).map((seg) => seg.body);
}

/** R16 cells: `row.matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)(?=<(?:td|th)\b|<\/tr\s*>|$)/gi)`. */
export function tableCells(row: string): OpenSegment[] {
  const stops = mergedPositions([boundaryStarts(row, "td"), boundaryStarts(row, "th"), closeTags(row, "tr").pos]);
  return openSegments(row, ["td", "th"], stops);
}

/** `s.split(/<name\b[^>]*>/i)` (split matches like a global regex: leftmost, non-overlapping). */
export function splitAtOpenTags(s: string, name: string): string[] {
  const out: string[] = [];
  let cursor = 0;
  let gt = -1;
  for (const pos of boundaryStarts(s, name)) {
    if (pos < cursor) continue;
    const from = pos + 1 + name.length;
    if (gt < from) {
      gt = s.indexOf(">", from);
      if (gt === -1) break;
    }
    out.push(s.slice(cursor, pos));
    cursor = gt + 1;
  }
  out.push(s.slice(cursor));
  return out;
}

/** Length of the leading JS-space run (what a leading-`\s*` regex captures). */
export function leadingSpaceLength(s: string): number {
  let i = 0;
  while (i < s.length && isJsSpace(s.charCodeAt(i))) i++;
  return i;
}

/** Length of `/\s*$/.exec(s)[0]` — the regex is O(k²) on a long inner run of spaces. */
export function trailingSpaceLength(s: string): number {
  let i = s.length;
  while (i > 0 && isJsSpace(s.charCodeAt(i - 1))) i--;
  return s.length - i;
}

/**
 * R16 `markdownTextLength`'s pipe-collapsing replace (`\s*`, `|`, `\s*` → one space, global) —
 * the regex is O(k²) on a long run of spaces without a `|`.
 */
export function collapsePipes(s: string): string {
  let out = "";
  let p = 0; // start of the text not yet copied
  for (let i = s.indexOf("|"); i !== -1; i = s.indexOf("|", i)) {
    // Leading `\s*`: back over spaces, but never into the previous match.
    let a = i;
    while (a > p && isJsSpace(s.charCodeAt(a - 1))) a--;
    let b = i + 1;
    while (b < s.length && isJsSpace(s.charCodeAt(b))) b++;
    out += s.slice(p, a) + " ";
    p = b;
    i = b;
  }
  return out + s.slice(p);
}
