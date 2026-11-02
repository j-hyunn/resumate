"use server"

/** S-39 server actions. Stage moves go through the foundation's C-12 (moveApplicationStageAction). */
import { deleteApplicationProject } from "@/lib/data/deletion"

export async function deleteApplicationProjectAction(applicationProjectId: string) {
  return deleteApplicationProject(applicationProjectId)
}
