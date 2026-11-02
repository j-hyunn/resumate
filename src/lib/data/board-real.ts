import "server-only"
/** W4: the real branch of the S-39 / C-12 / C-13 writes in applications.ts (moves, outcome, S-31 deadline). */
import { isAppError } from "@/lib/contracts/errors"
import type { InterviewPrompt } from "@/lib/contracts/application"
import * as applicationActions from "@/server/actions/application"
import { requireConsentedUser } from "@/server/auth/session"
import { mapDbError } from "@/server/db/errors"
import type { ApplicationProject, ApplicationStage, MoveApplicationStageResult, QuestionCount, StageOutcome } from "@/types/db"
import { unwrap } from "./source"

async function loadProject(id: string): Promise<ApplicationProject> {
  const { supabase } = await requireConsentedUser()
  const { data, error } = await supabase.from("application_projects").select("*").eq("id", id).single()
  if (error) throw mapDbError(error)
  return data as unknown as ApplicationProject
}

export function toUiInterviewPrompt(p: InterviewPrompt | null): MoveApplicationStageResult["interview_prompt"] {
  if (!p) return null
  const s = p.inProgressSession
  return {
    interview_type: p.interviewType,
    in_progress_session_id: p.inProgressSessionId,
    in_progress_session: s
      ? {
          session_id: s.sessionId,
          interview_type: s.interviewType,
          answered_count: s.answeredCount,
          question_count: s.questionCount as QuestionCount,
          generation_status: s.generationStatus,
          last_activity_at: s.lastActivityAt ?? "",
        }
      : null,
  }
}

/** Failures throw; C-12 treats every throw as ST-MOVE-FAILED. `outcome` only with closed (the RPC checks). */
export async function realMoveApplicationStage(id: string, toStage: ApplicationStage, outcome: StageOutcome | null): Promise<MoveApplicationStageResult> {
  const moved = unwrap(await applicationActions.moveApplicationStage({ id, toStage, ...(outcome ? { outcome } : {}) }))
  return { application_project: await loadProject(id), interview_prompt: toUiInterviewPrompt(moved.interviewPrompt) }
}

/** Null when the project is gone or no longer closed (`not_closed`), like the mock. */
export async function realSetApplicationOutcome(id: string, outcome: StageOutcome | null): Promise<ApplicationProject | null> {
  try {
    unwrap(await applicationActions.setApplicationOutcome({ id, outcome }))
  } catch (err) {
    if (isAppError(err) && (err.code === "not_found" || err.code === "not_closed")) return null
    throw err
  }
  return loadProject(id)
}

export async function realUpdateApplicationProject(id: string, patch: Partial<Pick<ApplicationProject, "name" | "deadline" | "memo">>): Promise<ApplicationProject | null> {
  try {
    unwrap(await applicationActions.updateApplicationProject({ id, ...patch }))
  } catch (err) {
    if (isAppError(err) && err.code === "not_found") return null
    throw err
  }
  return loadProject(id)
}
