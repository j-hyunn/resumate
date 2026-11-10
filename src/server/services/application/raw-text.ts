/**
 * A3 (R15, plan 1-C): the single normalization of a pasted / fetched JD raw text.
 *
 * Creation (`create_application_project`), the raw-text edit (DM 2.6.1
 * `update_failed_jd_raw_text`) and the requirement preview route
 * (`POST /api/job-descriptions/extract-preview`) must all produce **one** string
 * and derive the split, the hash and the stored raw text from it — otherwise the
 * preview's `raw_text_hash` / `sentence_count` can never match the creation call
 * and `create_application_project` always answers `preview_mismatch`.
 *
 * Rules (`[가정]`, R15 plan A3):
 *   1. `\r\n` and `\r` → `\n`
 *   2. Unicode NFC
 *   3. trim leading / trailing whitespace
 * Inner whitespace and blank lines are **not** collapsed: sentence offsets
 * (`{sid, text, start, end}`, DM A.6) index the stored text exactly.
 *
 * Existing `job_descriptions` rows are never recomputed.
 */
export function normalizeJdRawText(rawText: string): string {
  return rawText.replace(/\r\n?/g, "\n").normalize("NFC").trim();
}
