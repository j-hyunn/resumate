/**
 * V-3 normalization: "공백·문장부호 정규화 후 비교" (AI spec C-3).
 * NFKC folds full-width forms (＜, ，, ％, full-width digits) to ASCII; then
 * whitespace and punctuation are removed and Latin letters lower-cased.
 * Returns the normalized string plus, for each normalized char, the index of
 * the original char — so a match can be mapped back to the exact source span.
 */

// Explicit list (no \p{P}: tsconfig targets ES2017). Includes ASCII
// punctuation, Korean/CJK quotes and brackets, middle dots, dashes, ellipsis,
// bullets and arrows that users type as separators.
const PUNCTUATION = new Set(
  Array.from(
    "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~" +
      "·‧∙•◦▪▫■□●○◆◇※…‥―—–‐‑‒−" +
      "「」『』【】〔〕〈〉《》〖〗〘〙〚〛（）［］｛｝" +
      "“”‘’‚„‹›«»" +
      "、。〃〜～・ㆍ" +
      "→←↑↓⇒⇐↔",
  ),
);

export type Normalized = { text: string; map: number[] };

export function normalizeForMatch(input: string): Normalized {
  let text = "";
  const map: number[] = [];
  // Normalize per original char so the index map stays exact.
  const chars = Array.from(input);
  let offset = 0;
  for (const ch of chars) {
    const folded = ch.normalize("NFKC").toLowerCase();
    for (const c of Array.from(folded)) {
      if (/\s/.test(c) || PUNCTUATION.has(c)) continue;
      text += c;
      for (let k = 0; k < c.length; k++) map.push(offset);
    }
    offset += ch.length;
  }
  return { text, map };
}

/** Original-text slice covering normalized range [start, end). */
export function originalSpan(source: string, norm: Normalized, start: number, end: number): string {
  if (end <= start || start >= norm.map.length) return "";
  const from = norm.map[start];
  const lastOrig = norm.map[Math.min(end, norm.map.length) - 1];
  // Extend to the end of the last original code point.
  const cp = source.codePointAt(lastOrig) ?? 0;
  const to = lastOrig + (cp > 0xffff ? 2 : 1);
  return source.slice(from, to);
}
