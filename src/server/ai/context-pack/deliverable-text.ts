/**
 * AI spec C-1.1 (v4.5, CR-8): deliverable markdown → plain text for the pack,
 * with an offset map back to the raw markdown so a validated quote can be
 * stored as `evidence_links.source_locator {start, end}` on the original
 * (DM 2.8, JS UTF-16 offsets).
 *
 * Deterministic rules (same body → same text):
 * - heading `#`, blockquote `>`, list markers (`-`, `*`, `+`, task boxes) removed;
 * - ordered list markers (`1.`, `2)`) removed only when they form a list
 *   (R9 QA-02, `isOrderedListMarker`): 1–2 digits, and the number is 1 or
 *   continues / is continued by a sibling item (n-1 before, n+1 after).
 *   Other line-leading numbers ("2024. 출시", "300) 명", a lone "7. …") are
 *   body text, so the number guard (V-9c / V-9j) still sees them;
 * - emphasis (`**`, `__`, `*`, `~~`, edge `_`) and inline-code backticks removed;
 * - `[text](url)` → text; images `![alt](url)` removed; HTML tags removed;
 * - table rows → cells joined with " / " (separator rows dropped);
 * - fenced code blocks: fences dropped, first CODE_BLOCK_MAX_LINES lines kept [가정];
 * - paragraphs (blank lines) and line structure kept; trailing spaces trimmed.
 * - (v4.10, UP-9) editor escapes undone: `\x` (x = ASCII punctuation) → `x`
 *   mapped to x's raw index; `&lt;` → `<` (no other entity is decoded);
 *   inline code spans keep their content literally (no escapes inside code);
 *   table cells split on unescaped `|` only (`\|` is a pipe inside a cell);
 *   `<br>` (multi-line table cell) → one space; a line that is only `&nbsp;`
 *   (the editor's empty paragraph) is a blank line [가정].
 *
 * The same rules give the plain text the AI-12 validators compare STAR
 * markdown on (`plainForValidation`, v4.10 UP-14) — validation only, never
 * what is stored or sent to the model.
 *
 * Pure; never logs text.
 */

/** [가정] C-1.1: lines kept per fenced code block. */
export const CODE_BLOCK_MAX_LINES = 30;
/** [가정] C-1.1: normalized chars per deliverable in the pack (cut at a paragraph boundary). */
export const DELIVERABLE_PACK_MAX_CHARS = 6000;
/** [가정] C-1.1: normalized chars of all deliverables in one pack (≈ 12k tokens). */
export const DELIVERABLE_PACK_TOTAL_CHARS = 15000;

export type NormalizedText = {
  text: string;
  /** map[i] = raw index of text[i]. Same length as `text`. */
  map: number[];
};

export type NormalizeOptions = {
  /** Lines kept per fenced code block (default CODE_BLOCK_MAX_LINES; validation keeps all). */
  codeBlockMaxLines?: number;
  /**
   * R9 QA-02: "list" (default) — `N.` / `N)` is a marker only when it forms a
   * list (`findOrderedListMarkers`). "fragment" — every 1–2 digit line-leading
   * number is a marker: for a quote / needle cut out of a list, which lost its
   * siblings. 3+ digit numbers stay body text in both.
   */
  orderedLists?: "list" | "fragment";
};

export function normalizeDeliverableMarkdown(raw: string, options: NormalizeOptions = {}): NormalizedText {
  const maxCodeLines = options.codeBlockMaxLines ?? CODE_BLOCK_MAX_LINES;
  const out = new Builder();
  const lines = splitLines(raw);
  let inFence = false;
  let fenceMarker = "";
  let codeLines = 0;
  let first = true;
  const newline = (rawIndex: number) => {
    if (!first) out.push("\n", rawIndex);
    first = false;
  };

  const orderedMarkers = findOrderedListMarkers(lines, options.orderedLists === "fragment");

  for (const [lineIndex, line] of lines.entries()) {
    const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line.text);
    if (fence && (!inFence || line.text.trim().startsWith(fenceMarker))) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[1];
        codeLines = 0;
      } else {
        inFence = false;
      }
      continue;
    }
    if (inFence) {
      if (codeLines++ < maxCodeLines) {
        newline(line.breakIndex);
        out.pushRange(line.text.replace(/\s+$/, ""), line.start);
      }
      continue;
    }
    if (TABLE_SEPARATOR.test(line.text)) continue;
    newline(line.breakIndex);
    // The editor writes an empty paragraph after another one as `&nbsp;` (TipTap paragraph renderMarkdown).
    if (EMPTY_PARAGRAPH.test(line.text)) continue;
    if (TABLE_ROW.test(line.text)) {
      renderTableRow(line.text, line.start, out);
      out.trimTrailingSpaces();
      continue;
    }
    // Block markers at the line start.
    let offset = 0;
    let rest = line.text;
    for (const re of BLOCK_PREFIXES) {
      if (re === ORDERED_ITEM && !orderedMarkers.has(lineIndex)) continue;
      const m = re.exec(rest);
      if (m) {
        offset += m[0].length;
        rest = rest.slice(m[0].length);
      }
    }
    renderInline(rest.replace(/\s+$/, ""), line.start + offset, out);
    out.trimTrailingSpaces();
  }
  return out.result();
}

/**
 * First `max` chars of a normalized text, cut at the last paragraph boundary
 * (blank line) inside the window, else the last line break, else at `max`.
 */
export function truncateNormalized(n: NormalizedText, max: number): NormalizedText & { truncated: boolean } {
  if (n.text.length <= max) return { ...n, truncated: false };
  if (max <= 0) return { text: "", map: [], truncated: n.text.length > 0 };
  const window = n.text.slice(0, max);
  const para = window.lastIndexOf("\n\n");
  const line = window.lastIndexOf("\n");
  const cut = para > 0 ? para : line > 0 ? line : max;
  const text = n.text.slice(0, cut).replace(/\s+$/, "");
  return { text, map: n.map.slice(0, text.length), truncated: true };
}

/**
 * v4.10 (UP-14, AI spec 0.v410): STAR markdown → plain text for the AI-12
 * validators (V-3 quotes on STAR, V-9c/d/e, V-9j, no-op checks). Same rules
 * as C-1.1 with no code-block cut, so list numbers / markers, emphasis and
 * escapes never count as numbers, names or content words. Stored values and
 * model input stay the raw markdown.
 */
export function plainForValidation(markdown: string, orderedLists: "list" | "fragment" = "list"): string {
  return normalizeDeliverableMarkdown(markdown, { codeBlockMaxLines: Number.POSITIVE_INFINITY, orderedLists }).text;
}

/** Raw markdown span of normalized [start, end) — `source_locator` for a deliverable body quote. */
export function rawSpan(n: NormalizedText, start: number, end: number): { start: number; end: number } | null {
  if (start < 0 || end > n.text.length || end <= start) return null;
  return { start: n.map[start], end: n.map[end - 1] + 1 };
}

// ---------------------------------------------------------------------------

type Line = { text: string; start: number; breakIndex: number };

/** Lines with raw offsets; `breakIndex` = raw index of the newline before this line (0 for the first). */
function splitLines(raw: string): Line[] {
  const out: Line[] = [];
  let start = 0;
  let breakIndex = 0;
  for (let i = 0; i <= raw.length; i++) {
    if (i === raw.length || raw[i] === "\n") {
      let text = raw.slice(start, i);
      if (text.endsWith("\r")) text = text.slice(0, -1);
      out.push({ text, start, breakIndex });
      breakIndex = i;
      start = i + 1;
    }
  }
  return out;
}

const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const EMPTY_PARAGRAPH = /^\s*&nbsp;\s*$/;
const BLOCKQUOTE = /^\s*(?:>\s?)+/;
/** Ordered list item marker; stripped only on lines `findOrderedListMarkers` accepts. */
const ORDERED_ITEM = /^\s*\d{1,9}[.)]\s+/;
const BLOCK_PREFIXES: readonly RegExp[] = [
  BLOCKQUOTE,
  /^\s{0,3}#{1,6}\s+/, // heading
  /^\s*[-*+]\s+/, // bullet list item
  ORDERED_ITEM,
  /^\[[ xX]\]\s+/, // task box
  /^\s+/, // indentation
];

/**
 * [가정] R9 QA-02 (spec-gaps R9-AI-3): most digits an ordered list number may
 * have. 3+ digit line-leading numbers (years, counts) are always body text.
 */
export const ORDERED_LIST_MAX_DIGITS = 2;

type OrderedItem = { line: number; quote: string; indent: number; num: number; digits: number };

/**
 * R9 QA-02: line indexes whose leading `N.` / `N)` is a real ordered list
 * marker (the editor's markdown list form), not a body number. Siblings =
 * items with the same blockquote prefix, indentation and delimiter, with only
 * blank lines, deeper-indented lines (continuations, nested lists) between.
 * An item is a marker when it has ≤ ORDERED_LIST_MAX_DIGITS digits and its
 * number is 1, or the previous sibling is n-1, or the next sibling is n+1.
 * Fences and table rows break a list. `fragment`: every ≤ 2 digit item.
 */
function findOrderedListMarkers(lines: readonly Line[], fragment: boolean): Set<number> {
  type Row = { kind: "blank" | "break" | "text"; quote: string; indent: number; item?: OrderedItem };
  const rows: Row[] = [];
  let inFence = false;
  let fenceMarker = "";
  for (const [i, line] of lines.entries()) {
    const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line.text);
    if (fence && (!inFence || line.text.trim().startsWith(fenceMarker))) {
      if (!inFence) fenceMarker = fence[1];
      inFence = !inFence;
      rows.push({ kind: "break", quote: "", indent: 0 });
      continue;
    }
    if (inFence || TABLE_ROW.test(line.text) || TABLE_SEPARATOR.test(line.text)) {
      rows.push({ kind: "break", quote: "", indent: 0 });
      continue;
    }
    const q = BLOCKQUOTE.exec(line.text);
    const quote = q ? q[0].replace(/\s/g, "") : "";
    const rest = q ? line.text.slice(q[0].length) : line.text;
    if (rest.trim() === "" || EMPTY_PARAGRAPH.test(rest)) {
      rows.push({ kind: "blank", quote, indent: 0 });
      continue;
    }
    const indent = rest.length - rest.trimStart().length;
    const m = /^\s*(\d{1,9})[.)]\s+/.exec(rest);
    const item = m ? { line: i, quote, indent, num: Number(m[1]), digits: m[1].length } : undefined;
    rows.push({ kind: "text", quote, indent, item });
  }

  const sibling = (from: number, step: 1 | -1): OrderedItem | undefined => {
    const self = rows[from].item!;
    for (let j = from + step; j >= 0 && j < rows.length; j += step) {
      const r = rows[j];
      if (r.kind === "break") return undefined;
      if (r.kind === "blank") continue;
      if (r.quote !== self.quote) return undefined;
      if (r.item && r.item.indent === self.indent) return r.item;
      if (r.indent > self.indent) continue;
      return undefined;
    }
    return undefined;
  };

  const markers = new Set<number>();
  for (const [i, r] of rows.entries()) {
    const item = r.item;
    if (!item || item.digits > ORDERED_LIST_MAX_DIGITS) continue;
    if (fragment) {
      markers.add(item.line);
      continue;
    }
    const prev = sibling(i, -1);
    const next = sibling(i, 1);
    if (item.num === 1 || prev?.num === item.num - 1 || next?.num === item.num + 1) markers.add(item.line);
  }
  return markers;
}

class Builder {
  private readonly chars: string[] = [];
  private readonly map: number[] = [];

  push(ch: string, rawIndex: number): void {
    this.chars.push(ch);
    this.map.push(rawIndex);
  }

  pushRange(text: string, rawStart: number): void {
    for (let i = 0; i < text.length; i++) this.push(text[i], rawStart + i);
  }

  /** Drops spaces/tabs at the end of the current line (left by removed tags or images). */
  trimTrailingSpaces(): void {
    while (this.chars.length && (this.chars[this.chars.length - 1] === " " || this.chars[this.chars.length - 1] === "\t")) {
      this.chars.pop();
      this.map.pop();
    }
  }

  result(): NormalizedText {
    return { text: this.chars.join(""), map: this.map };
  }
}

function renderTableRow(text: string, start: number, out: Builder): void {
  const lead = text.length - text.replace(/^\s*\|/, "").length;
  const body = text.slice(lead).replace(/\|\s*$/, "");
  // Cells split on unescaped pipes only: the editor writes a pipe inside a cell as `\|`.
  const cells: { text: string; start: number }[] = [];
  let cellStart = 0;
  for (let i = 0; i <= body.length; i++) {
    if (i === body.length || (body[i] === "|" && body[i - 1] !== "\\")) {
      cells.push({ text: body.slice(cellStart, i), start: start + lead + cellStart });
      cellStart = i + 1;
    }
  }
  let firstCell = true;
  for (const cell of cells) {
    const pad = cell.text.length - cell.text.trimStart().length;
    const trimmed = cell.text.trim();
    if (trimmed !== "") {
      if (!firstCell) {
        // " / " maps to the pipe before this cell.
        for (const ch of " / ") out.push(ch, cell.start - 1);
      }
      renderInline(trimmed, cell.start + pad, out, true);
      firstCell = false;
    }
  }
}

const IMAGE = /^!\[[^\]]*\]\([^)]*\)/;
const LINK = /^\[((?:\\.|[^\]\\])*)\]\([^)]*\)/;
const LINE_BREAK_TAG = /^<br\s*\/?>/i;
const HTML_TAG = /^<\/?[A-Za-z][^>]*>/;
/** CommonMark autolinks `<scheme:…>` / `<a@b.c>` keep their text (R9 QA-03); checked before HTML_TAG. */
const AUTOLINK = /^<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*|[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*)>/;
/** CommonMark: any ASCII punctuation can be backslash-escaped. */
const ESCAPABLE = /[!-\/:-@\[-`{-~]/;
const LT_ENTITY = "&lt;";

/** Inline markdown of one line segment starting at raw `start`. */
function renderInline(text: string, start: number, out: Builder, inTable = false): void {
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    // v4.10 (UP-9): editor escapes → the character itself, mapped to its raw position.
    if (ch === "\\" && i + 1 < text.length && ESCAPABLE.test(text[i + 1])) {
      out.push(text[i + 1], start + i + 1);
      i += 2;
      continue;
    }
    if (ch === "&" && text.startsWith(LT_ENTITY, i)) {
      out.push("<", start + i);
      i += LT_ENTITY.length;
      continue;
    }
    if (ch === "`") {
      const span = codeSpan(text, i);
      if (span) {
        renderCode(text, span, start, out, inTable);
        i = span.end;
        continue;
      }
      // An unmatched backtick run is dropped (as before).
      while (text[i] === "`") i++;
      continue;
    }
    const rest = text.slice(i);
    const image = IMAGE.exec(rest);
    if (image) {
      i += image[0].length;
      continue;
    }
    const link = LINK.exec(rest);
    if (link) {
      renderInline(link[1], start + i + 1, out, inTable);
      i += link[0].length;
      continue;
    }
    const br = LINE_BREAK_TAG.exec(rest);
    if (br) {
      out.push(" ", start + i);
      i += br[0].length;
      continue;
    }
    const autolink = AUTOLINK.exec(rest);
    if (autolink) {
      out.pushRange(autolink[1], start + i + 1);
      i += autolink[0].length;
      continue;
    }
    const tag = HTML_TAG.exec(rest);
    if (tag) {
      i += tag[0].length;
      continue;
    }
    if (rest.startsWith("**") || rest.startsWith("__") || rest.startsWith("~~")) {
      i += 2;
      continue;
    }
    if (ch === "*") {
      i++;
      continue;
    }
    if (ch === "_") {
      // Emphasis only at a word edge; snake_case identifiers keep their underscores.
      const before = text[i - 1];
      const after = text[i + 1];
      const edge = before === undefined || /\s/.test(before) || after === undefined || /[\s.,!?;:)]/.test(after);
      if (edge) {
        i++;
        continue;
      }
    }
    out.push(ch, start + i);
    i++;
  }
}

type CodeSpan = { contentStart: number; contentEnd: number; end: number };

/** CommonMark code span opened by the backtick run at `at`: the next run of the same length closes it. */
function codeSpan(text: string, at: number): CodeSpan | null {
  let open = at;
  while (text[open] === "`") open++;
  const fence = open - at;
  let i = open;
  while (i < text.length) {
    if (text[i] !== "`") {
      i++;
      continue;
    }
    let close = i;
    while (text[close] === "`") close++;
    if (close - i === fence) return { contentStart: open, contentEnd: i, end: close };
    i = close;
  }
  return null;
}

/** Code span content is literal (no escapes, no emphasis); one padding space on both sides is dropped. */
function renderCode(text: string, span: CodeSpan, start: number, out: Builder, inTable: boolean): void {
  let from = span.contentStart;
  let to = span.contentEnd;
  const content = text.slice(from, to);
  if (content.length >= 2 && content.startsWith(" ") && content.endsWith(" ") && content.trim() !== "") {
    from++;
    to--;
  }
  for (let i = from; i < to; i++) {
    // Inside a table cell the editor still writes a pipe as `\|` (GFM table-level escape).
    if (inTable && text[i] === "\\" && text[i + 1] === "|") continue;
    out.push(text[i], start + i);
  }
}
