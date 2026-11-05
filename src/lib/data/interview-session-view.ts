/**
 * Pure view rules for interview sessions (S-20 / S-22 / S-33 / S-37). Client- and server-safe.
 *
 * - C-17 점수 표시 (02 v5.13, OD-I1 · OD-I2 · R-OD-3): `sessionScoreView` / `answerScoreView` decide what the
 *   score slot shows from the stored score_* columns only — the screens never recompute a score.
 * - OD-I6 "자기소개서 삭제됨" (02 S-37 · S-22 · S-33, DM v4.11 11.6 #1~#6): a session whose application
 *   project was deleted keeps the company / position snapshot, is read-only and has no link back.
 */
import type { AnswerScoreStatus, InterviewSession, SessionScoreStatus } from "@/types/db"

// --- C-17 ------------------------------------------------------------------------------------------

/** C-17 점수 만점 (d14.v1). Used when a stored row has no score_max. */
export const SCORE_MAX_DEFAULT = 100

/** C-17 "모든 질문이 미응답" 안내 (OD-I1 / R-OD-3) */
export const ALL_UNANSWERED_COPY = "답변이 없어 0점이에요"

export type SessionScoreView =
  /** score_status null: 제출 전 → 표시 안 함 */
  | { kind: "hidden" }
  /** "점수 산정 방식 준비 중" (산식 구현·백필 전까지만) */
  | { kind: "pending" }
  /** "점수를 계산하지 못했어요" — 응답이 있는데 하나도 채점하지 못했을 때만 */
  | { kind: "not_scored" }
  | {
      kind: "scored"
      value: number
      max: number
      /** 반영 질문 수 (score_counted_count) */
      counted: number
      unanswered: number
      /** 모든 질문이 미응답 → "0점" / 100 + "미응답 {N}개" + "답변이 없어 0점이에요" + 새 면접 시작하기 */
      allUnanswered: boolean
    }

type SessionScoreFields = Pick<
  InterviewSession,
  "score_status" | "score_value" | "score_max" | "score_counted_count" | "unanswered_count" | "question_count"
>

export function isAllUnanswered(s: Pick<InterviewSession, "unanswered_count" | "question_count">): boolean {
  return s.question_count > 0 && s.unanswered_count >= s.question_count
}

export function sessionScoreView(s: SessionScoreFields): SessionScoreView {
  const status: SessionScoreStatus | null = s.score_status
  if (!status) return { kind: "hidden" }
  if (status === "pending_method") return { kind: "pending" }
  const allUnanswered = isAllUnanswered(s)
  // [UI-가정] OD-I1 이전에 저장된 "응답 0개 = not_scored" 행(백필 전)은 산식대로 0점으로 보인다 (R-OD-3:
  // 응답 0개 세션은 not_scored가 아니다). 응답이 있는 not_scored만 "점수를 계산하지 못했어요".
  if (status === "not_scored" && !allUnanswered) return { kind: "not_scored" }
  const max = s.score_max ?? SCORE_MAX_DEFAULT
  return {
    kind: "scored",
    value: allUnanswered ? 0 : (s.score_value ?? 0),
    max,
    counted: s.score_counted_count ?? 0,
    unanswered: s.unanswered_count,
    allUnanswered,
  }
}

export type AnswerScoreView =
  | { kind: "hidden" }
  /** "점수 준비 중" */
  | { kind: "pending" }
  /** "미응답 · 0점" (세션 점수에 0점으로 들어간다) */
  | { kind: "unanswered" }
  /** "채점 실패" (+ 다시 채점, 입력 원인이면 없음) */
  | { kind: "not_scored" }
  | { kind: "scored"; value: number; max: number }

export function answerScoreView(status: AnswerScoreStatus | null, value: number | null, max: number | null): AnswerScoreView {
  if (!status) return { kind: "hidden" }
  if (status === "pending_method") return { kind: "pending" }
  if (status === "unanswered") return { kind: "unanswered" }
  if (status === "not_scored") return { kind: "not_scored" }
  return { kind: "scored", value: value ?? 0, max: max ?? SCORE_MAX_DEFAULT }
}

/** "{n}점" — C-17 scored 표기의 앞부분 ("{n}점 / 100") */
export function scorePoints(value: number): string {
  return `${value}점`
}

/**
 * OD-I2: 항목별 등급(criteria)은 그 질문 점수와 함께만 — `scored`일 때만 보이고 `pending_method` 동안 숨긴다.
 */
export function showsCriterionGrades(answerStatus: AnswerScoreStatus | null): boolean {
  return answerStatus === "scored"
}

/** OD-I2: 다음 연습은 세션 점수와 함께만 (`pending_method` 동안 숨김) */
export function showsNextPractice(sessionStatus: SessionScoreStatus | null): boolean {
  return sessionStatus === "scored"
}

// --- OD-I6 자기소개서 삭제됨 --------------------------------------------------------------------------

/** 표식 (S-37 행, S-22 머리, S-33 이동 경로) */
export const APPLICATION_DELETED_BADGE = "자기소개서 삭제됨"
/** 회사명·포지션명이 둘 다 비었을 때 이름 [가정] + S-37 필터 항목 [가정] */
export const DELETED_APPLICATION_NAME = "삭제된 자기소개서"

/**
 * Data-layer key (not a URL segment): `listInterviewSessions({ application_project_id: "deleted" })` and
 * `getInterviewSession("deleted", id)` read sessions whose 자기소개서 was deleted. Their S-22 is
 * `routes.interviewDeletedResult(sessionId)` (U36-1).
 */
export const DELETED_APPLICATION_SEGMENT = "deleted"

export function isDeletedApplicationSegment(id: string): boolean {
  return id === DELETED_APPLICATION_SEGMENT
}

/**
 * R-OD-12 이름 규칙 (S-37 행 = S-22 머리): "{company_name_snapshot} – {position_title_snapshot}", 한쪽만 있으면
 * 그 값, 둘 다 비면 "삭제된 자기소개서".
 */
export function deletedApplicationName(company: string | null | undefined, position: string | null | undefined): string {
  const c = company?.trim() ?? ""
  const p = position?.trim() ?? ""
  if (c && p) return `${c} – ${p}`
  return c || p || DELETED_APPLICATION_NAME
}

/** The view-model fields OD-I6 adds (optional: rows built before the snapshot existed default to "not deleted"). */
export interface DeletedApplicationFields {
  /** application_project_id is null (DM v4.11 11.6 #1) */
  application_deleted?: boolean
  /** 삭제 시점의 회사명 (interview_sessions.company_name_snapshot) */
  company_name_snapshot?: string | null
  /** 삭제 시점의 포지션명 (interview_sessions.position_title_snapshot) */
  position_title_snapshot?: string | null
}

export function isApplicationDeleted(s: DeletedApplicationFields): boolean {
  return s.application_deleted === true
}
