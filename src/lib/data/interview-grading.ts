/**
 * The one grading decision table (04 §2.7.1 판정표, Q53-3 · 5 · 6 · 10). Client-safe, pure.
 * Used by S-22, S-37, regradeFailedAnswers, markResultViewed, the same-row retry gate, hasNewResult
 * and the L-01 badge — none of them re-derive these rules.
 *
 *   status             | 조건                                      | decision
 *   evaluation_failed  | 다시 채점 대상 ≥ 1                         | regrade
 *   evaluation_failed  | 대상 0, 평가 성공 ≥ 1, 종합 실패 입력 원인 아님 | resummarize ("종합 평가 다시 정리")
 *   evaluation_failed  | 대상 0, 평가 성공 ≥ 1, 종합 실패 입력 원인     | input_only (서버 input_only)
 *   evaluation_failed  | 대상 0, 평가 성공 0                        | input_only (서버 input_only)
 *   completed          | 다시 채점 대상 ≥ 1                         | regrade
 *   completed          | 대상 0, 입력 원인 답변 ≥ 1                  | input_only (답변 카드에만 원인)
 *   그 밖              |                                          | none
 */
import type { AiErrorCode, EvaluationStatus, InterviewEvaluationRefusalCode, InterviewSession, InterviewSessionStatus } from "@/types/db"

/** Grading failures that fail again on the same answer (제출 뒤 답변은 고칠 수 없다) */
export function isInputCausedGrading(code: AiErrorCode | null | undefined): boolean {
  return code === "input_too_long" || code === "safety_blocked"
}

export interface GradingAnswer {
  evaluation_status: EvaluationStatus | null
  error_code: AiErrorCode | null
}

export interface GradingFacts {
  status: InterviewSessionStatus
  /** 다시 채점 대상: 제출 답변 중 평가 성공이 없고 입력 원인도 아닌 답변 (pending 포함) */
  regrade_target_count: number
  succeeded_count: number
  /** the first input-caused answer's cause, in question order */
  answer_input_cause: AiErrorCode | null
  /** evaluation_failed: the grading job's error_code = the summary's cause; gone job → null (입력 원인 아님) */
  summary_error_code: AiErrorCode | null
}

export type GradingDecision =
  | { kind: "regrade"; count: number }
  | { kind: "resummarize" }
  | { kind: "input_only"; cause: AiErrorCode | null }
  | { kind: "none" }

/** A failed evaluation that would fail again on the same answer: stays out of every grading run */
export function isInputCausedAnswer(a: GradingAnswer): boolean {
  return a.evaluation_status === "failed" && isInputCausedGrading(a.error_code)
}

/** 다시 채점 대상 (04 §2.7.1): 평가 성공 없음 + 입력 원인 아님. `pending`, 행 없음, `error_code` null 포함 */
export function isRegradeTarget(a: GradingAnswer): boolean {
  return a.evaluation_status !== "succeeded" && !isInputCausedAnswer(a)
}

/** `answers`: the session's submitted answers only, in question order */
export function buildGradingFacts(
  status: InterviewSessionStatus,
  answers: GradingAnswer[],
  summaryErrorCode: AiErrorCode | null,
): GradingFacts {
  const inputCaused = answers.filter(isInputCausedAnswer)
  const succeeded = answers.filter((a) => a.evaluation_status === "succeeded")
  return {
    status,
    regrade_target_count: answers.filter(isRegradeTarget).length,
    succeeded_count: succeeded.length,
    answer_input_cause: inputCaused[0]?.error_code ?? null,
    summary_error_code: summaryErrorCode,
  }
}

export function gradingDecision(f: GradingFacts): GradingDecision {
  if (f.status !== "evaluation_failed" && f.status !== "completed") return { kind: "none" }
  if (f.regrade_target_count > 0) return { kind: "regrade", count: f.regrade_target_count }
  if (f.status === "completed") return f.answer_input_cause ? { kind: "input_only", cause: f.answer_input_cause } : { kind: "none" }
  if (f.succeeded_count > 0) {
    return isInputCausedGrading(f.summary_error_code) ? { kind: "input_only", cause: f.summary_error_code } : { kind: "resummarize" }
  }
  return { kind: "input_only", cause: f.answer_input_cause }
}

/** Why the 다시 채점 route refuses (HTTP 409, 04 §2.7.1); null = it starts a job */
export function gradingRefusal(d: GradingDecision): InterviewEvaluationRefusalCode | null {
  if (d.kind === "input_only") return "interview_evaluation_input_only"
  return d.kind === "none" ? "interview_evaluation_not_retryable" : null
}

/**
 * mark_interview_result_viewed (Q53-10): completed, or evaluation_failed with nothing left to do.
 * Failures the user can still act on keep the 새 결과 표식 (A9).
 */
export function clearsNewResultOnView(status: InterviewSessionStatus, d: GradingDecision): boolean {
  return status === "completed" || (status === "evaluation_failed" && d.kind === "input_only")
}

/**
 * A9 새 결과 표식 (S-37 / S-20 행, L-01 배지): grading ended and not opened. Which sessions get
 * result_viewed_at is decided by clearsNewResultOnView above, so this stays a read of the column.
 */
export function hasNewResult(s: Pick<InterviewSession, "status" | "submitted_at" | "result_viewed_at">): boolean {
  return Boolean(s.submitted_at) && (s.status === "completed" || s.status === "evaluation_failed") && !s.result_viewed_at
}

/** S-22 입력 원인 문구 (Q53-3) [가정 명세]. `cause` unknown → [UI-가정] */
export function gradingInputCauseCopy(cause: AiErrorCode | null): { title: string; body: string } {
  const body = "제출한 답변은 고칠 수 없으니 새 면접에서 다시 답해 주세요"
  if (cause === "input_too_long") return { title: "채점할 내용이 공급자 한도보다 길어요.", body }
  if (cause === "safety_blocked") return { title: "공급자의 안전 정책으로 채점 결과를 받지 못했어요.", body }
  return { title: "채점을 마치지 못했어요.", body } // [UI-가정] 원인을 알 수 없는 입력 원인 행
}
