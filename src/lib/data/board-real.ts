import "server-only"
/** W4: the real branch of the S-39 / C-12 / C-13 writes in applications.ts (moves, outcome, S-31 deadline). */
import { isAppError } from "@/lib/contracts/errors"
import * as applicationActions from "@/server/actions/application"
import { requireConsentedUser } from "@/server/auth/session"
import { mapDbError } from "@/server/db/errors"
import type { ApplicationProject, ApplicationStage, MoveApplicationStageResult, StageOutcome } from "@/types/db"
import { unwrap } from "./source"

async function loadProject(id: string): Promise<ApplicationProject> {
  const { supabase } = await requireConsentedUser()
  const { data, error } = await supabase.from("application_projects").select("*").eq("id", id).single()
  if (error) throw mapDbError(error)
  return data as unknown as ApplicationProject
}

/** Failures throw; C-12 treats every throw as ST-MOVE-FAILED. `outcome` only with closed (the RPC checks). */
export async function realMoveApplicationStage(id: string, toStage: ApplicationStage, outcome: StageOutcome | null): Promise<MoveApplicationStageResult> {
  unwrap(await applicationActions.moveApplicationStage({ id, toStage, ...(outcome ? { outcome } : {}) }))
  return { application_project: await loadProject(id) }
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
