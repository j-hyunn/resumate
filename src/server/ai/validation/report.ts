/**
 * validation_report (AI spec C-3): counts only, never text. Stored with each
 * result and logged (C-7). Source of the "근거 없는 주장 비율" metric (7장).
 */
export type ValidationReport = {
  /** Judgment items / blocks checked (V-4 scope). */
  items_total: number;
  /** Removed items (V-4 drop). */
  items_dropped: number;
  /** met/partial → no_evidence (V-4 downgrade). */
  items_downgraded: number;
  /** Blocks marked evidence_check_needed (V-4 / V-7 / C-9 표현 검사). */
  items_flagged: number;
  evidence_total: number;
  evidence_kept: number;
  /** Removed evidence by rule. */
  evidence_removed_v1_ref: number;
  evidence_removed_v2_field: number;
  evidence_removed_v3_quote: number;
  evidence_removed_v7_scope: number;
  evidence_removed_v8_learnings: number;
  /** V-3 partial matches replaced by the closest source span. */
  quotes_adjusted: number;
  /** V-5 numbers not found in the sources (before regeneration). */
  number_violations: number;
  /** V-5 numbers replaced with [수치 확인 필요] after the retry. */
  numbers_replaced: number;
  /** C-5 body token count ≠ placeholders length (fixed by rebuilding the list). */
  placeholder_mismatches: number;
  /** Bracket tokens outside the 6 C-5 tokens (replaced with [내용 확인 필요]). */
  unknown_placeholders: number;
};

export function emptyReport(): ValidationReport {
  return {
    items_total: 0,
    items_dropped: 0,
    items_downgraded: 0,
    items_flagged: 0,
    evidence_total: 0,
    evidence_kept: 0,
    evidence_removed_v1_ref: 0,
    evidence_removed_v2_field: 0,
    evidence_removed_v3_quote: 0,
    evidence_removed_v7_scope: 0,
    evidence_removed_v8_learnings: 0,
    quotes_adjusted: 0,
    number_violations: 0,
    numbers_replaced: 0,
    placeholder_mismatches: 0,
    unknown_placeholders: 0,
  };
}

export function mergeReports(...reports: ReadonlyArray<Partial<ValidationReport>>): ValidationReport {
  const out = emptyReport();
  for (const report of reports) {
    for (const key of Object.keys(out) as (keyof ValidationReport)[]) out[key] += report[key] ?? 0;
  }
  return out;
}
