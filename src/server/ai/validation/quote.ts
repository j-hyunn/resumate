import { normalizeForMatch, originalSpan } from "./normalize";

/**
 * V-3 quote check (AI spec C-3).
 * - Exact: the normalized quote is a substring of the normalized source.
 *   The stored quote becomes the exact source span (so escapes or spacing the
 *   model changed never reach storage); `adjusted = false`.
 * - Partial: the longest common contiguous run covers at least
 *   QUOTE_PARTIAL_MATCH_THRESHOLD of the quote → replace with the source span
 *   aligned to that run (same length as the quote), `adjusted = true`.
 * - Otherwise: no match (evidence removed).
 */

/** [가정] AI spec C-3 V-3 "부분 일치(70% 이상)". Ratio of the quote's normalized length. */
export const QUOTE_PARTIAL_MATCH_THRESHOLD = 0.7;
/** Quotes shorter than this (normalized) must match exactly — a partial 2-char run proves nothing. */
export const QUOTE_MIN_PARTIAL_LENGTH = 6;

export type QuoteMatch = { ok: true; quote: string; adjusted: boolean } | { ok: false };

export function matchQuote(quote: string, source: string): QuoteMatch {
  const q = normalizeForMatch(quote);
  const s = normalizeForMatch(source);
  if (q.text.length === 0 || s.text.length === 0) return { ok: false };

  const exact = s.text.indexOf(q.text);
  if (exact >= 0) return { ok: true, quote: originalSpan(source, s, exact, exact + q.text.length), adjusted: false };

  if (q.text.length < QUOTE_MIN_PARTIAL_LENGTH) return { ok: false };
  const run = longestCommonRun(q.text, s.text);
  if (run.length / q.text.length < QUOTE_PARTIAL_MATCH_THRESHOLD) return { ok: false };

  // Align the quote over the source around the common run; clip (don't shift) at the source edges.
  const start = Math.max(0, run.sourceStart - run.quoteStart);
  const end = Math.min(s.text.length, run.sourceStart - run.quoteStart + q.text.length);
  return { ok: true, quote: originalSpan(source, s, start, end), adjusted: true };
}

/** Longest common substring via DP over two rows. O(|a|·|b|); quotes and fields are ≤ 2,000 chars. */
function longestCommonRun(a: string, b: string): { length: number; quoteStart: number; sourceStart: number } {
  let best = { length: 0, quoteStart: 0, sourceStart: 0 };
  let prev = new Array<number>(b.length + 1).fill(0);
  let cur = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best.length) best = { length: cur[j], quoteStart: i - cur[j], sourceStart: j - cur[j] };
      } else {
        cur[j] = 0;
      }
    }
    [prev, cur] = [cur, prev];
  }
  return best;
}
