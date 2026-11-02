/**
 * AI spec C-1.1 (v4.5, CR-8): deliverable markdown → plain text for the pack,
 * with an offset map back to the raw markdown so a validated quote can be
 * stored as `evidence_links.source_locator {start, end}` on the original
 * (DM 2.8, JS UTF-16 offsets).
 *
 * Deterministic rules (same body → same text):
 * - heading `#`, blockquote `>`, list markers (`-`, `*`, `+`, `1.`, task boxes) removed;
 * - emphasis (`**`, `__`, `*`, `~~`, edge `_`) and inline-code backticks removed;
 * - `[text](url)` → text; images `![alt](url)` removed; HTML tags removed;
 * - table rows → cells joined with " / " (separator rows dropped);
 * - fenced code blocks: fences dropped, first CODE_BLOCK_MAX_LINES lines kept [가정];
 * - paragraphs (blank lines) and line structure kept; trailing spaces trimmed.
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

export function normalizeDeliverableMarkdown(raw: string): NormalizedText {
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

  for (const line of lines) {
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
      if (codeLines++ < CODE_BLOCK_MAX_LINES) {
        newline(line.breakIndex);
        out.pushRange(line.text.replace(/\s+$/, ""), line.start);
      }
      continue;
    }
    if (TABLE_SEPARATOR.test(line.text)) continue;
    newline(line.breakIndex);
    if (TABLE_ROW.test(line.text)) {
      renderTableRow(line.text, line.start, out);
      out.trimTrailingSpaces();
      continue;
    }
    // Block markers at the line start.
    let offset = 0;
    let rest = line.text;
    for (const re of BLOCK_PREFIXES) {
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
const BLOCK_PREFIXES: readonly RegExp[] = [
  /^\s*(?:>\s?)+/, // blockquote
  /^\s{0,3}#{1,6}\s+/, // heading
  /^\s*(?:[-*+]|\d{1,9}[.)])\s+/, // list item
  /^\[[ xX]\]\s+/, // task box
  /^\s+/, // indentation
];

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
  const body = text.replace(/^\s*\|/, "");
  let cellStart = start + (text.length - text.replace(/^\s*\|/, "").length);
  const cells = body.replace(/\|\s*$/, "").split("|");
  let firstCell = true;
  for (const cell of cells) {
    const lead = cell.length - cell.trimStart().length;
    const trimmed = cell.trim();
    if (trimmed !== "") {
      if (!firstCell) {
        // " / " maps to the pipe before this cell.
        for (const ch of " / ") out.push(ch, cellStart - 1);
      }
      renderInline(trimmed, cellStart + lead, out);
      firstCell = false;
    }
    cellStart += cell.length + 1;
  }
}

const IMAGE = /^!\[[^\]]*\]\([^)]*\)/;
const LINK = /^\[([^\]]*)\]\([^)]*\)/;
const HTML_TAG = /^<\/?[A-Za-z][^>]*>/;

/** Inline markdown of one line segment starting at raw `start`. */
function renderInline(text: string, start: number, out: Builder): void {
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    const image = IMAGE.exec(rest);
    if (image) {
      i += image[0].length;
      continue;
    }
    const link = LINK.exec(rest);
    if (link) {
      renderInline(link[1], start + i + 1, out);
      i += link[0].length;
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
    const ch = text[i];
    if (ch === "`" || ch === "*") {
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
