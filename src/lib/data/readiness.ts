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
import { DataReadiness as DataReadinessSchema, type DataReadiness as DataReadinessV44 } from "@/lib/contracts/career"
import { AppError } from "@/lib/contracts/errors"

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
    async () => toLegacyReadiness(await getDataReadinessV44()),
  )
}

/**
 * DM §6 v4.4 readiness (counts `projects_without_complete_star` / `standalone_projects_without_description`,
 * hints `project_star` / `project_fields` / `profile`, next_action `writing_chat` / `form` / `create_project`,
 * no `suggested_mode`). 연결 대기: the reworked C-09 / C-10 read this shape.
 */
export async function getDataReadinessV44(): Promise<DataReadinessV44> {
  const parsed = DataReadinessSchema.safeParse(await loadDataReadiness((await requireUser()).supabase))
  if (!parsed.success) throw new AppError("internal_error", undefined, { status: 500, cause: parsed.error })
  return parsed.data
}

/**
 * @deprecated R4 shim: v4.4 readiness → the v4.3b shape the current gate screens read.
 * `project_star` → `complete_project_detail`; `writing_chat` → augment the suggested project (a chat now
 * always needs a project); `create_project` → `form` (no "new project" chat any more).
 */
export function toLegacyReadiness(r: DataReadinessV44): DataReadiness {
  const feature = (f: DataReadinessV44["features"]["insight"]): ReadinessFeature => {
    const hints = (f.hints ?? []).map((h) => (h === "project_star" ? "complete_project_detail" : h))
    if (f.ready) return { ready: true, missing: f.missing ?? [], hints }
    if (f.next_action === "writing_chat" && f.suggested_project_id) {
      return { ready: false, missing: f.missing, hints, next_action: "writing_chat", suggested_mode: "augment_project", suggested_project_id: f.suggested_project_id }
    }
    return { ready: false, missing: f.missing, hints, next_action: "form", ...(f.suggested_project_id ? { suggested_project_id: f.suggested_project_id } : {}) }
  }
  return {
    counts: {
      complete_experiences: r.counts.complete_experiences,
      complete_educations: r.counts.complete_educations,
      complete_projects: r.counts.complete_projects,
      projects_without_complete_detail: r.counts.projects_without_complete_star,
      complete_project_details: 0,
      draft_project_details: 0,
      draft_experiences: r.counts.draft_experiences,
      draft_educations: r.counts.draft_educations,
      draft_projects: r.counts.draft_projects,
      profile_filled: r.counts.profile_filled,
    },
    draft_item_ids: { ...r.draft_item_ids, project_details: [] },
    features: {
      insight: feature(r.features.insight),
      draft: feature(r.features.draft),
      job_interview: feature(r.features.job_interview),
      culture_fit_interview: r.features.culture_fit_interview,
    },
    ai_connection: r.ai_connection as DataReadiness["ai_connection"],
  }
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
