/**
 * JD requirement state for the AI screens (S-16~S-19), v4 BYOK (D-30). Pure, server/client-safe.
 * - waitJd: AI-01 is running → ST-WAIT-JD (run buttons disabled)
 * - jdFailed: AI-01 failed (kept for display; v5.3 UQ-510: also covered by extractFirst)
 * - extractFirst: "요건이 없는" JD — registered without a key (`pending`, no job) **or extraction failed** →
 *   A13: 서류 실행 버튼은 요건 추출(별도 요청)을 먼저 끝낸 뒤 생성 (S-17·S-18·S-19). 인사이트는 `prepare`에서 추출
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
  if (state === "wait-jd") return { waitJd: true, jdFailed: false, extractFirst: false }
  const status = jd?.extraction_status
  const notStarted = status === "pending" && !jd?.extraction_job_id
  const extractFirst = notStarted || status === "failed"
  return {
    waitJd: status === "running" || (status === "pending" && !notStarted),
    jdFailed: status === "failed",
    extractFirst,
  }
}

/** "요건 추출 먼저" 안내 (FL-11 / FL-03, D-30) — // [UI-가정] 문구 */
export const EXTRACT_FIRST_NOTE = "요건이 아직 정리되지 않아, 공고 요건을 먼저 정리한 뒤 시작해요"


/** v5.3 A13 `?state=` previews of the requirements-first extraction failure (S-17 / S-18) */
export function extractFirstPreviewFail(state: string | null): AiErrorCode | null {
  if (state === "extract-failed") return "provider_unavailable"
  if (state === "extract-failed-input") return "not_a_jd"
  if (state === "extract-failed-wait") return "rate_limited"
  return null
}
