/**
 * RPC get_data_readiness() (04 §6). `computeReadiness` is the mock store's version, for previews. Server only.
 * Screens decide gate vs action only from `features.{feature}.ready / missing / next_action`.
 */
import type { DataReadiness, ReadinessFeature } from "@/types/db"
import { mockRequest } from "@/lib/mock/store"
import type { MockDb } from "@/lib/mock/fixtures"
import { computeAiConnection } from "./ai-connection"
import { IDS } from "@/lib/mock/ids"
import { previewOr } from "./source"
import { requireUser } from "@/server/auth/session"
import { loadDataReadiness } from "@/server/services/shell"

/** `?state=insufficient-project-fields`: fixture project 8 really lacks its role (UQ-489) */
const PREVIEW_PROJECT_ID = IDS.prj(8)

export function computeReadiness(db: MockDb): DataReadiness {
  // pack inclusion: complete rows only; children of draft parents are excluded (04 §2.2)
  const completeExperiences = db.experiences.filter((e) => e.status === "complete")
  const completeEducations = db.educations.filter((e) => e.status === "complete")
  const parentOk = (p: MockDb["projects"][number]) => {
    if (p.experience_id) return completeExperiences.some((e) => e.id === p.experience_id)
    if (p.education_id) return completeEducations.some((e) => e.id === p.education_id)
    return true
  }
  const completeProjects = db.projects.filter((p) => p.status === "complete" && parentOk(p))
  const completeDetails = db.project_details.filter(
    (d) => d.status === "complete" && db.projects.some((p) => p.id === d.project_id && p.name && p.role),
  )
  const projectsWithoutCompleteDetail = db.projects.filter(
    (p) => !db.project_details.some((d) => d.project_id === p.id && d.status === "complete"),
  )
  const profile = db.profiles[0]
  // v4.2: desired_job_title (non-blank) / total_years_of_experience / interested_industries
  const profileFilled = Boolean(
    profile?.desired_job_title?.trim() || profile?.total_years_of_experience != null || profile?.interested_industries?.length,
  )
  // v4.2 A18: complete detail but the draft project lacks name or role (latest updated first)
  const projectFieldsTarget = db.projects
    .filter((p) => p.status === "draft" && (!p.name?.trim() || !p.role?.trim()) && parentOk(p))
    .filter((p) => db.project_details.some((d) => d.project_id === p.id && d.status === "complete"))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]

  const missing: Array<"complete_experience" | "complete_project"> = []
  if (completeExperiences.length < 1) missing.push("complete_experience")
  if (completeProjects.length < 1) missing.push("complete_project")
  const ready = missing.length === 0

  // v4: no active provider or an invalid key → next_action = 'form' (키 없으면 폼 입력 안내, 04 §6)
  const aiConnection = computeAiConnection(db)
  const aiUsable = aiConnection.active_provider !== null && aiConnection.key_status !== "invalid"

  /** next_action order (04 §6 v4.2): no experience → project_fields → no usable key → augment → new */
  const gated = (): ReadinessFeature => {
    if (ready) return { ready: true, missing: [], hints: profileFilled ? [] : ["profile"] }
    const hints: NonNullable<ReadinessFeature["hints"]> = []
    if (projectsWithoutCompleteDetail.length > 0) hints.push("complete_project_detail")
    if (projectFieldsTarget) hints.push("project_fields")
    if (!profileFilled) hints.push("profile")
    if (missing.includes("complete_experience")) return { ready: false, missing, hints, next_action: "form" }
    if (projectFieldsTarget)
      return { ready: false, missing, hints, next_action: "form", suggested_project_id: projectFieldsTarget.id }
    if (!aiUsable) return { ready: false, missing, hints, next_action: "form" }
    const augmentTarget = projectsWithoutCompleteDetail.find((p) => p.name && p.role) ?? projectsWithoutCompleteDetail[0]
    return augmentTarget
      ? { ready: false, missing, hints, next_action: "writing_chat", suggested_mode: "augment_project", suggested_project_id: augmentTarget.id }
      : { ready: false, missing, hints, next_action: "writing_chat", suggested_mode: "new_project" }
  }

  const dataSufficiency = ready
    ? "ok"
    : profileFilled || completeExperiences.length || completeEducations.length || completeDetails.length
      ? "thin"
      : "none"

  return {
    counts: {
      complete_experiences: completeExperiences.length,
      complete_educations: completeEducations.length,
      complete_projects: completeProjects.length,
      projects_without_complete_detail: projectsWithoutCompleteDetail.length,
      complete_project_details: completeDetails.length,
      draft_project_details: db.project_details.filter((d) => d.status === "draft").length,
      draft_experiences: db.experiences.filter((e) => e.status === "draft").length,
      draft_educations: db.educations.filter((e) => e.status === "draft").length,
      draft_projects: db.projects.filter((p) => p.status === "draft").length,
      profile_filled: profileFilled,
    },
    draft_item_ids: {
      experiences: db.experiences.filter((e) => e.status === "draft").map((e) => e.id),
      educations: db.educations.filter((e) => e.status === "draft").map((e) => e.id),
      projects: db.projects.filter((p) => p.status === "draft").map((p) => p.id),
      project_details: db.project_details.filter((d) => d.status === "draft").map((d) => d.id),
    },
    ai_connection: aiConnection,
    features: {
      insight: gated(),
      draft: gated(),
      job_interview: gated(),
      // 컬처핏 예외 [가정] (U-5): always ready
      culture_fit_interview: { ready: true, data_sufficiency: dataSufficiency },
    },
  }
}

export async function getDataReadiness(): Promise<DataReadiness> {
  return previewOr(
    async () => computeReadiness(await mockRequest()),
    // The RPC's jsonb is the same DM §6 shape the mock computes; screens read it as is.
    async () => (await loadDataReadiness((await requireUser()).supabase)) as DataReadiness,
  )
}

/**
 * Preview fixture for `?state=insufficient` (no complete project, augment suggestion) so
 * screens can render C-09 without editing data.
 */
export function insufficientReadinessPreview(
  base: DataReadiness,
  opts?: { noExperience?: boolean; projectFields?: boolean },
): DataReadiness {
  const missing: Array<"complete_experience" | "complete_project"> = opts?.noExperience
    ? ["complete_experience", "complete_project"]
    : ["complete_project"]
  const feature: ReadinessFeature = opts?.noExperience
    ? { ready: false, missing, hints: ["complete_project_detail"], next_action: "form" }
    : opts?.projectFields
      ? // v4.2 A18 `?state=insufficient-project-fields`: the first draft project stands in
        { ready: false, missing, hints: ["project_fields"], next_action: "form", suggested_project_id: PREVIEW_PROJECT_ID }
      : {
        ready: false,
        missing,
        hints: ["complete_project_detail"],
        next_action: "writing_chat",
        suggested_mode: "augment_project",
        suggested_project_id: base.draft_item_ids.projects[0],
      }
  return {
    ...base,
    counts: {
      ...base.counts,
      complete_projects: 0,
      complete_experiences: opts?.noExperience ? 0 : base.counts.complete_experiences,
      projects_without_complete_detail: Math.max(1, base.counts.projects_without_complete_detail),
    },
    features: {
      insight: feature,
      draft: feature,
      job_interview: feature,
      culture_fit_interview: { ready: true, data_sufficiency: "thin" },
    },
  }
}
