"use client"

/**
 * Browser-session state shared across areas (client only):
 * - C-10 return target for form paths (FL-13: "폼(S-09 등)으로만 넘어간 경우는 브라우저 세션 저장").
 *   AI writing chats store theirs in writing_chats.return_target instead.
 * - Navigation origin for breadcrumbs (L-01: S-39 / S-37 에서 들어오면 첫 마디가 출발 메뉴).
 * Nothing personal goes into URLs; ids + feature names only.
 */
import type { ReturnTargetFeature } from "@/types/db"

export interface ReturnTargetInput {
  application_project_id: string
  feature: ReturnTargetFeature
  /**
   * 진행 중 설정 restored on return. Settled keys (A2 request 7):
   * - cover_letter: `{ draft_id }` (S-18 문항 설정 화면의 초안)
   * - career_description: `{ included_project_ids }`
   * - job_interview: `{ interview_type, question_count }`
   * - insight (보완점): `{ gap_item_key, requirement_ids }`
   */
  params?: Record<string, unknown>
  /** display name "{회사명 – 포지션명}" (kept in session storage only) */
  application_name: string
  /** where "돌아가기" goes */
  href: string
  /**
   * C-09 "경력이 없을 때" path (S-08 새 경력 → S-10 새 프로젝트 → 복귀, FL-13 D0 → D1): the experience saved on the way,
   * pre-selected as affiliation of the next AI writing chat. Set via recordGateExperience().
   */
  experience_id?: string
}

export interface StoredReturnTarget extends ReturnTargetInput {
  created_at: string
}

const RETURN_KEY = "resumate.return-target"
const ORIGIN_KEY = "resumate.nav-origin"

function safeSession(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage
  } catch {
    return null
  }
}

export function markCareerReturn(target: ReturnTargetInput): void {
  safeSession()?.setItem(RETURN_KEY, JSON.stringify({ ...target, created_at: new Date().toISOString() }))
  window.dispatchEvent(new Event("resumate:return-target"))
}

export function readCareerReturn(): StoredReturnTarget | null {
  const raw = safeSession()?.getItem(RETURN_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as StoredReturnTarget
  } catch {
    return null
  }
}

/**
 * UQ-4 / UQ-420: the S-08 추가 모달 calls this (via afterCareerItemSaved) after adding an experience while a return target exists, so the
 * C-10 banner (and useGateContinuation) can offer S-36 new_project with this affiliation.
 */
export function recordGateExperience(experienceId: string): void {
  const t = readCareerReturn()
  if (!t) return
  safeSession()?.setItem(RETURN_KEY, JSON.stringify({ ...t, experience_id: experienceId }))
  window.dispatchEvent(new Event("resumate:return-target"))
}

export const CAREER_SAVED_EVENT = "resumate:career-saved"

/** Call after any successful career save so C-10 re-judges readiness. */
export function notifyCareerSaved(): void {
  window.dispatchEvent(new Event(CAREER_SAVED_EVENT))
}

/**
 * S-08 추가·수정 모달 저장 성공 뒤 (UQ-420, FL-13 D0 → D1): an experience added while a return target exists is
 * recorded first (the C-10 banner's next step = S-10 새 프로젝트 under it), then C-10 re-judges readiness.
 */
export function afterCareerItemSaved(item: { kind: string; id: string; created: boolean }): void {
  if (item.created && item.kind === "experience" && readCareerReturn()) recordGateExperience(item.id)
  notifyCareerSaved()
}

export function clearCareerReturn(): void {
  safeSession()?.removeItem(RETURN_KEY)
  window.dispatchEvent(new Event("resumate:return-target"))
}

/** Restore helper for the original feature screen: returns params once, then clears. */
export function consumeReturnParams(applicationProjectId: string, feature: ReturnTargetFeature): Record<string, unknown> | null {
  const t = readCareerReturn()
  if (!t || t.application_project_id !== applicationProjectId || t.feature !== feature) return null
  // A3 UQ-87: only the screen the target points to consumes it (S-17 / another S-19 must not
  // swallow an S-18 target). Compared by pathname; query strings are ignored.
  if (t.href && typeof window !== "undefined" && t.href.split(/[?#]/)[0] !== window.location.pathname) return null
  clearCareerReturn()
  return t.params ?? {}
}

export type NavOrigin = "board" | "interviews"

/** Call when leaving S-39 / S-37 toward an application sub-screen. */
export function setNavOrigin(origin: NavOrigin, applicationProjectId: string): void {
  safeSession()?.setItem(ORIGIN_KEY, JSON.stringify({ origin, application_project_id: applicationProjectId }))
}

export function readNavOrigin(applicationProjectId: string | undefined): NavOrigin | null {
  if (!applicationProjectId) return null
  const raw = safeSession()?.getItem(ORIGIN_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { origin: NavOrigin; application_project_id: string }
    return parsed.application_project_id === applicationProjectId ? parsed.origin : null
  } catch {
    return null
  }
}

const STAGE_MOVE_KEY = "resumate.board-stage-move"

/**
 * One-time marker: the user moved this card into an interview stage on S-39 and chose
 * "면접 준비하기" in C-14 (UQ-122). S-20 consumes it for its 진입 안내, so later visits
 * (S-22 links, S-31 chip, S-36 return) don't show "지원 현황에서 … 옮겼어요".
 */
export function markBoardStageMove(applicationProjectId: string): void {
  safeSession()?.setItem(STAGE_MOVE_KEY, applicationProjectId)
}

export function consumeBoardStageMove(applicationProjectId: string): boolean {
  const s = safeSession()
  if (s?.getItem(STAGE_MOVE_KEY) !== applicationProjectId) return false
  s.removeItem(STAGE_MOVE_KEY)
  return true
}

export function clearNavOrigin(): void {
  safeSession()?.removeItem(ORIGIN_KEY)
}
