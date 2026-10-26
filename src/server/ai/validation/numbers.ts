/**
 * V-5 수치 가드 (AI spec C-3): every number in generated text (drafts,
 * directions, improved answers, question text) must exist with the same value
 * in the pack, JD, answers, or the server-computed list (durations from dates).
 * Numbers that appear only in `learnings` are not facts (C-9) — the pack
 * builder leaves them out of `factualTexts`.
 *
 * Flow per block: findUnsupportedNumbers → (pipeline) one regeneration request
 * → still unsupported → replaceUnsupportedNumbers with NUMBER_CHECK_TOKEN.
 */

export const NUMBER_CHECK_TOKEN = "[수치 확인 필요]";

/** Aliases look like numbers to a regex; blank them before extraction. */
const ALIAS_PATTERN = /\b(?:PROFILE|EXP|EDU|PRJ|DET|ACH|SKL|REQ|ANS|NOTE|M)-\d+\b|\bS\d+\b/g;

const NUMBER_PATTERN = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;

/** Korean magnitude suffixes directly after a number ("1.2만", "3억"). */
const MULTIPLIERS: Record<string, number> = { 천: 1e3, 만: 1e4, 억: 1e8, 조: 1e12 };

/**
 * Units consumed together with the number so a replacement covers "30%" or
 * "1,200명" as a whole. Longest first.
 */
const UNIT_PATTERN =
  /^\s?(?:퍼센트|개월|시간|주간|년간|%|배|명|원|건|개|년|월|일|주|회|분|초|위|점|차|만|억|천|조|ms|tps|qps|rps|kb|mb|gb|tb|x|k)/i;

/** ASCII letter runs that may follow a number as a unit (else "K8s", "EC2", "B2B" are names, not quantities). */
const ASCII_UNITS = new Set(["ms", "x", "k", "tps", "qps", "rps", "kb", "mb", "gb", "tb", "s", "m", "h"]);

export type NumberMention = {
  /** Original text of the number + unit (e.g. "1,200명"). */
  raw: string;
  start: number;
  end: number;
  /** Canonical value as stated ("1.2만" → 12000). Output mentions must match this. */
  value: string;
  /**
   * Values a source mention contributes to the allowed set: the scaled and the
   * bare figure ("1.2만" allows 12000 and 1.2), so a source written either way is found.
   */
  sourceValues: string[];
};

export function extractNumbers(text: string): NumberMention[] {
  const blanked = text.replace(ALIAS_PATTERN, (m) => " ".repeat(m.length));
  const mentions: NumberMention[] = [];
  NUMBER_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = NUMBER_PATTERN.exec(blanked)) !== null) {
    const start = match.index;
    let end = start + match[0].length;
    const before = blanked[start - 1] ?? "";
    if (/[A-Za-z]/.test(before)) continue; // EC2, OAuth2, B2B
    const letters = /^[A-Za-z]+/.exec(blanked.slice(end))?.[0];
    if (letters && !ASCII_UNITS.has(letters.toLowerCase())) continue; // K8s-like names, 3D
    const value = Number(match[0].replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    const unit = UNIT_PATTERN.exec(blanked.slice(end))?.[0] ?? "";
    const multiplier = MULTIPLIERS[unit.trim()];
    end += unit.length;
    mentions.push({
      raw: text.slice(start, end),
      start,
      end,
      value: canonical(multiplier ? value * multiplier : value),
      sourceValues: multiplier ? [canonical(value * multiplier), canonical(value)] : [canonical(value)],
    });
  }
  return mentions;
}

/** Allowed set from source texts (pack factual text, JD, answers) and computed numbers. */
export function buildAllowedNumbers(sources: { texts?: readonly string[]; numbers?: readonly number[] }): Set<string> {
  const allowed = new Set<string>();
  for (const text of sources.texts ?? []) for (const m of extractNumbers(text)) for (const v of m.sourceValues) allowed.add(v);
  for (const n of sources.numbers ?? []) allowed.add(canonical(n));
  return allowed;
}

export function findUnsupportedNumbers(text: string, allowed: ReadonlySet<string>): NumberMention[] {
  return extractNumbers(text).filter((m) => !allowed.has(m.value));
}

/** Replaces each unsupported mention (number + unit) with [수치 확인 필요]. */
export function replaceUnsupportedNumbers(text: string, mentions: readonly NumberMention[]): string {
  let out = text;
  for (const m of [...mentions].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, m.start) + NUMBER_CHECK_TOKEN + out.slice(m.end);
  }
  return out;
}

/** Applies the final V-5 step to one text; returns the new text and the replaced count. */
export function guardNumbers(text: string, allowed: ReadonlySet<string>): { text: string; replaced: number } {
  const bad = findUnsupportedNumbers(text, allowed);
  return { text: bad.length ? replaceUnsupportedNumbers(text, bad) : text, replaced: bad.length };
}

function canonical(n: number): string {
  return String(Math.round(n * 1e6) / 1e6);
}
