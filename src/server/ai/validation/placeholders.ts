import { NUMBER_CHECK_TOKEN } from "./numbers";

/**
 * C-5 자리 표시 규칙. The six tokens are fixed (UX highlights them and warns
 * before copy). The body keeps the tokens; the block's `placeholders` array
 * lists `{token, hint}` in body order. The server checks that the counts match.
 *
 * Placeholders are not unsupported claims: validators never strip them, and
 * they contain no digits, so V-5 ignores them.
 */
export const PLACEHOLDER_TOKENS = [
  "[수치 입력 필요]",
  "[기간 입력 필요]",
  "[내용 확인 필요]",
  "[지원 동기 입력 필요]",
  "[계획 입력 필요]",
  "[사례 입력 필요]",
] as const;
export type PlaceholderToken = (typeof PLACEHOLDER_TOKENS)[number];

export type Placeholder = { token: PlaceholderToken; hint: string };

/** Fallback for unknown "[… 필요]" tokens the model invents. */
export const UNKNOWN_PLACEHOLDER_REPLACEMENT: PlaceholderToken = "[내용 확인 필요]";

/** Bracketed "… 필요" tokens (Korean placeholder shape). Excludes the server's V-5 token. */
const BRACKET_TOKEN = /\[[^[\]\n]{1,30}필요\]/g;

export function isPlaceholderToken(value: string): value is PlaceholderToken {
  return (PLACEHOLDER_TOKENS as readonly string[]).includes(value);
}

export type PlaceholderCheck = {
  text: string;
  placeholders: Placeholder[];
  mismatch: boolean;
  unknownReplaced: number;
};

/**
 * Normalizes one block:
 * 1. Unknown "[… 필요]" tokens → [내용 확인 필요] (counted).
 * 2. Rebuilds `placeholders` from the body order, reusing the model's hints
 *    for matching tokens in order; missing hints become "". `mismatch` is set
 *    when the model's list didn't match the body (count or tokens).
 */
export function checkPlaceholders(text: string, modelPlaceholders: ReadonlyArray<{ token: string; hint?: string | null }>): PlaceholderCheck {
  let unknownReplaced = 0;
  const fixed = text.replace(BRACKET_TOKEN, (token) => {
    if (isPlaceholderToken(token) || token === NUMBER_CHECK_TOKEN) return token;
    unknownReplaced++;
    return UNKNOWN_PLACEHOLDER_REPLACEMENT;
  });

  const bodyTokens = findPlaceholderTokens(fixed);
  const hintsByToken = new Map<string, string[]>();
  for (const p of modelPlaceholders) {
    const list = hintsByToken.get(p.token) ?? [];
    list.push(p.hint ?? "");
    hintsByToken.set(p.token, list);
  }
  const placeholders: Placeholder[] = bodyTokens.map((token) => ({ token, hint: hintsByToken.get(token)?.shift() ?? "" }));

  const modelTokens = modelPlaceholders.map((p) => p.token);
  const mismatch = modelTokens.length !== bodyTokens.length || modelTokens.some((t, i) => t !== bodyTokens[i]);
  return { text: fixed, placeholders, mismatch, unknownReplaced };
}

/** The C-5 tokens in body order. */
export function findPlaceholderTokens(text: string): PlaceholderToken[] {
  const found: { token: PlaceholderToken; at: number }[] = [];
  for (const token of PLACEHOLDER_TOKENS) {
    let at = text.indexOf(token);
    while (at >= 0) {
      found.push({ token, at });
      at = text.indexOf(token, at + token.length);
    }
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.token);
}

/** "자리 표시 N개가 남아 있습니다" count for the copy warning (V-5 tokens included). */
export function countRemainingPlaceholders(text: string): number {
  return findPlaceholderTokens(text).length + text.split(NUMBER_CHECK_TOKEN).length - 1;
}
