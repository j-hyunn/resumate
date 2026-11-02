/**
 * Store → grading facts, and the session facts several data modules share. Server only, but no
 * store access of its own (no import cycle with ai.ts / ai-jobs.ts).
 */
import type { AiJob, InterviewSession } from "@/types/db"
import { buildGradingFacts, gradingDecision, isRegradeTarget, type GradingAnswer, type GradingDecision, type GradingFacts } from "@/lib/data/interview-grading"
import type { MockDb } from "./fixtures"

/** The latest session-wide grading job (per-answer jobs excluded) */
function latestGradingJob(db: MockDb, sessionId: string): AiJob | null {
  return (
    [...db.ai_jobs]
      .reverse()
      .find((j) => j.target_id === sessionId && j.job_type === "interview_evaluation" && typeof j.params?.answer_id !== "string") ?? null
  )
}

/** Submitted answers of a session in question order */
function submittedAnswers(db: MockDb, sessionId: string) {
  const sequence = (questionId: string) => db.interview_questions.find((q) => q.id === questionId)?.sequence ?? 0
  return db.interview_answers
    .filter((a) => a.session_id === sessionId && a.status === "submitted")
    .sort((a, b) => sequence(a.question_id) - sequence(b.question_id))
}

/** An answer's evaluation as the decision table reads it */
function gradingAnswerOf(db: MockDb, answerId: string): GradingAnswer {
  const e = db.answer_evaluations.find((x) => x.answer_id === answerId)
  return { evaluation_status: e?.status ?? null, error_code: e?.error_code ?? null }
}

export function gradingFactsOf(db: MockDb, session: InterviewSession): GradingFacts {
  const answers = submittedAnswers(db, session.id).map((a) => gradingAnswerOf(db, a.id))
  const job = session.status === "evaluation_failed" ? latestGradingJob(db, session.id) : null
  return buildGradingFacts(session.status, answers, job?.error_code ?? null)
}

export function gradingDecisionOf(db: MockDb, session: InterviewSession): GradingDecision {
  return gradingDecision(gradingFactsOf(db, session))
}

/** 다시 채점 대상 ids (isRegradeTarget), question order */
export function regradeTargetIds(db: MockDb, sessionId: string): string[] {
  return submittedAnswers(db, sessionId)
    .filter((a) => isRegradeTarget(gradingAnswerOf(db, a.id)))
    .map((a) => a.id)
}

export function savedQuestionCount(db: MockDb, sessionId: string): number {
  return db.interview_questions.filter((q) => q.session_id === sessionId).length
}

/** 실효 generation_status (S-20): `generating` whose question job ended or is gone counts as failed */
export function effectiveGenerationStatus(db: MockDb, s: InterviewSession): InterviewSession["generation_status"] {
  if (s.generation_status !== "generating") return s.generation_status
  const running = db.ai_jobs.some(
    (j) => j.target_id === s.id && j.job_type === "interview_questions" && (j.status === "queued" || j.status === "running"),
  )
  return running ? "generating" : "failed"
}
