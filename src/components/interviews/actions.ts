"use server"

/**
 * A4 server actions (S-20, S-33, S-22, S-37). Thin wrappers over src/lib/data/* so the
 * screens never import server-only modules directly.
 */
import type { AiErrorCode, InterviewType, QuestionCount } from "@/types/db"
import {
  abandonInterviewSession,
  getInterviewSession,
  restartInterviewSession,
  saveInterviewAnswer,
  startInterviewSession,
  submitInterviewSession,
} from "@/lib/data/interviews"
import { getLatestJobFor } from "@/lib/data/ai-jobs"
import { getEvidenceForOwners } from "@/lib/data/evidence"
import { deleteInterviewSession } from "@/lib/data/deletion"
import { withAiGuard } from "@/lib/data/ai-guard"
import type { AiRejected } from "@/lib/data/ai-errors"
import { isAppError } from "@/lib/contracts/errors"

/**
 * `{ rejected }` (isAiRejected) when the key is missing / invalid — no session is created.
 * D-30 / UQ-322: startInterviewSession itself extracts the JD requirements first (server-side
 * ensureJdRequirementsInDb) and only then creates the question job, in one call. A failed extraction
 * fails the question job with the same cause (S-33 → C-20, Q53-9).
 */
export async function startInterviewSessionAction(input: {
  application_project_id: string
  interview_type: InterviewType
  question_count: QuestionCount
}): Promise<{ session_id: string; job_id: string } | AiRejected> {
  return withAiGuard(() => startInterviewSession(input))
}

/**
 * S-20 "그만두고 새로 시작": `{ rejected }` / `{ insufficient }` leave the failed session as it is
 * (C-18 · C-21 · C-20 key_invalid · C-09 come before 그만두기).
 */
export async function restartInterviewSessionAction(
  sessionId: string,
  input: { application_project_id: string; interview_type: InterviewType; question_count: QuestionCount },
) {
  return withAiGuard(() => restartInterviewSession(sessionId, input))
}

/**
 * S-33 polling while questions are generated: advances the AI-05 job (which writes the
 * questions it has produced so far) and returns the fresh session + job + question evidence.
 */
export async function getAnswerSheetStateAction(applicationProjectId: string, sessionId: string) {
  const job = await getLatestJobFor("interview_session", sessionId)
  const session = await getInterviewSession(applicationProjectId, sessionId)
  const evidence = session ? await getEvidenceForOwners("interview_question", session.questions.map((q) => q.id)) : {}
  return { session, job, evidence }
}

export async function saveInterviewAnswerAction(answerId: string, answerText: string, opts?: { fail?: boolean }) {
  return saveInterviewAnswer(answerId, answerText, opts)
}

/**
 * UQ-320: validate first — `{ rejected: key_missing | key_invalid }` leaves answers and session
 * untouched (still in_progress). `rate_wait` (mock) previews the S-22 wait line.
 */
export async function submitInterviewSessionAction(sessionId: string, opts?: { rate_wait?: boolean; fail?: AiErrorCode | null }) {
  return withAiGuard(() => submitInterviewSession(sessionId, opts))
}

export async function abandonInterviewSessionAction(sessionId: string) {
  return abandonInterviewSession(sessionId)
}

/** ㉛: `gone` = another tab deleted it first. What the user asked for is done, so it isn't a failure. */
export async function deleteInterviewSessionAction(sessionId: string): Promise<{ gone: boolean }> {
  try {
    await deleteInterviewSession(sessionId)
    return { gone: false }
  } catch (e) {
    if (isAppError(e) && e.code === "not_found") return { gone: true }
    throw e
  }
}
