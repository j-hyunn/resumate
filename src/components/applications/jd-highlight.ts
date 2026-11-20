/**
 * S-15 문장 하이라이트 helpers (v5.21, JR-Q1 — server- and client-safe, no "use client").
 * Address shape `?tab=jd&s=S3,S4` `[가정: 주소 모양]`: a C-01 `jd_sentence` chip sends one sentence, the S-16
 * requirement row's "공고 원문" link sends all its `sids`.
 */

/** "S3,S4" → ["S3", "S4"] (`?s=`, 화면 상태 파라미터 — 문장 ID만, 개인 정보 없음) */
export function parseSentenceParam(value: string | string[] | null | undefined): string[] {
  const v = Array.isArray(value) ? value[0] : value
  if (!v) return []
  return [...new Set(v.split(",").map((s) => s.trim()).filter((s) => /^S\d+$/.test(s)))]
}

/** S-46 sends this when the 채용 공고 tab is left — the highlight is cleared `[가정]` */
export const JD_TAB_LEFT_EVENT = "resumate:jd-tab-left"

/** 가리키는 문장이 지금 원문에 없을 때 (공고 내용을 고쳐 문장이 다시 나뉨) `[가정]` */
export const SENTENCE_NOT_FOUND = "이 근거가 가리키던 문장을 찾지 못했어요"
