/**
 * JD requirement state for the AI screens (S-16~S-19), v4 BYOK (D-30).
 *
 * R17 (2026-11-14): the JD is used as raw text — there is no requirement extraction (AI-01) to wait
 * for, fail, or run first. Every flag is false; only the `?state=wait-jd` preview still shows the
 * waiting state. The type and the call sites stay until the UI revision removes them (UI 요청).
 */
import type { AiErrorCode, JobDescription } from "@/types/db"

export interface JdRunState {
  waitJd: boolean
  jdFailed: boolean
  extractFirst: boolean
}

export function jdRunState(
  jd: Pick<JobDescription, "extraction_status" | "extraction_job_id"> | null | undefined,
  state: string | null,
): JdRunState {
  void jd
  if (state === "wait-jd") return { waitJd: true, jdFailed: false, extractFirst: false }
  return { waitJd: false, jdFailed: false, extractFirst: false }
}

/** "요건 추출 먼저" 안내 (FL-11 / FL-03, D-30) — // [UI-가정] 문구. R17: never shown (extractFirst is always false). */
export const EXTRACT_FIRST_NOTE = "요건이 아직 정리되지 않아, 공고 요건을 먼저 정리한 뒤 시작해요"

/** v5.3 A13 `?state=` previews of the requirements-first extraction failure. R17: no extraction → always null. */
export function extractFirstPreviewFail(state: string | null): AiErrorCode | null {
  void state
  return null
}
