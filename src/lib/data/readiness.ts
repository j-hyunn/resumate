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

/** `?state=insufficient-project-fields`: standalone fixture project 6 stands in (S-43 프로젝트 내용, DM §6 v4.4) */
const PREVIEW_PROJECT_ID = IDS.prj(6)

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
  // DM §6 v4.4 (mock: a v4.3b project's STAR = its complete detail; a standalone's 내용 = description ?? summary)
  const affiliated = (p: MockDb["projects"][number]) => Boolean(p.experience_id || p.education_id)
  const byRecent = (a: { updated_at: string }, b: { updated_at: string }) => b.updated_at.localeCompare(a.updated_at)
  const projectsWithoutCompleteStar = db.projects
    .filter((p) => affiliated(p) && parentOk(p) && !db.project_details.some((d) => d.project_id === p.id && d.status === "complete"))
    .sort(byRecent)
  const standaloneWithoutDescription = db.projects
    .filter((p) => !affiliated(p) && p.status === "draft" && !(p.description ?? p.summary)?.trim())
    .sort(byRecent)
  const missing: Array<"complete_experience" | "complete_project"> = []
  if (completeExperiences.length < 1) missing.push("complete_experience")
  if (completeProjects.length < 1) missing.push("complete_project")
  const ready = missing.length === 0

  // v4: no active provider or an invalid key → AI unusable (04 §6)
  const aiConnection = computeAiConnection(db)
  const aiUsable = aiConnection.active_provider !== null && aiConnection.key_status !== "invalid"

  /** next_action order (DM §6 v4.4): ① no experience → form ② STAR 미완 소속 → writing_chat / form ③ 내용 빈 독립 → form ④ create_project / form */
  const gated = (): ReadinessFeature => {
    // (v4.12, SD-A18) ready면 hints는 빈 배열 — `profile` 힌트는 없어졌다 (DM 6-A)
    if (ready) return { ready: true, missing: [], hints: [] }
    const hints: NonNullable<ReadinessFeature["hints"]> = []
    if (projectsWithoutCompleteStar.length > 0) hints.push("project_star")
    if (missing.includes("complete_experience")) return { ready: false, missing, hints, next_action: "form" }
    const star = projectsWithoutCompleteStar[0]
    if (star)
      return aiUsable
        ? { ready: false, missing, hints, next_action: "writing_chat", suggested_mode: "augment_project", suggested_project_id: star.id }
        : { ready: false, missing, hints, next_action: "form", suggested_project_id: star.id }
    const fields = standaloneWithoutDescription[0]
    if (fields) return { ready: false, missing, hints: [...hints, "project_fields"], next_action: "form", suggested_project_id: fields.id }
    return { ready: false, missing, hints, next_action: aiUsable ? "create_project" : "form" }
  }

  // (v4.12, SD-6) `thin` = complete 경력·교육·프로젝트가 하나라도 있음 ("프로필 또는" 삭제, DM 6-A)
  const dataSufficiency = ready
    ? "ok"
    : completeExperiences.length || completeEducations.length || completeProjects.length
      ? "thin"
      : "none"

  return {
    counts: {
      complete_experiences: completeExperiences.length,
      complete_educations: completeEducations.length,
      complete_projects: completeProjects.length,
      projects_without_complete_star: projectsWithoutCompleteStar.length,
      standalone_projects_without_description: standaloneWithoutDescription.length,
      projects_without_complete_detail: projectsWithoutCompleteStar.length,
      complete_project_details: db.project_details.filter((d) => d.status === "complete").length,
      draft_project_details: db.project_details.filter((d) => d.status === "draft").length,
      draft_experiences: db.experiences.filter((e) => e.status === "draft").length,
      draft_educations: db.educations.filter((e) => e.status === "draft").length,
      draft_projects: db.projects.filter((p) => p.status === "draft").length,
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
 * hints `project_star` / `project_fields`, next_action `writing_chat` / `form` / `create_project`,
 * no `suggested_mode`). 연결 대기: the reworked C-09 / C-10 read this shape.
 */
export async function getDataReadinessV44(): Promise<DataReadinessV44> {
  const parsed = DataReadinessSchema.safeParse(await loadDataReadiness((await requireUser()).supabase))
  if (!parsed.success) throw new AppError("internal_error", undefined, { status: 500, cause: parsed.error })
  return parsed.data
}

/**
 * v4.4 readiness → the screen type (`DataReadiness`, same names since UQ-INT-4): hints / next_action / counts pass
 * through (`project_star`, `create_project`, `projects_without_complete_star`). `suggested_mode` is filled only for
 * old readers (writing_chat → augment); `project_details` counts are 0 (the table is gone).
 */
export function toLegacyReadiness(r: DataReadinessV44): DataReadiness {
  const feature = (f: DataReadinessV44["features"]["insight"]): ReadinessFeature => {
    const hints = (f.hints ?? []) as NonNullable<ReadinessFeature["hints"]>
    if (f.ready) return { ready: true, missing: f.missing ?? [], hints }
    return {
      ready: false,
      missing: f.missing,
      hints,
      next_action: f.next_action,
      ...(f.next_action === "writing_chat" ? { suggested_mode: "augment_project" as const } : {}),
      ...(f.suggested_project_id ? { suggested_project_id: f.suggested_project_id } : {}),
    }
  }
  return {
    counts: {
      complete_experiences: r.counts.complete_experiences,
      complete_educations: r.counts.complete_educations,
      complete_projects: r.counts.complete_projects,
      projects_without_complete_star: r.counts.projects_without_complete_star,
      standalone_projects_without_description: r.counts.standalone_projects_without_description,
      projects_without_complete_detail: r.counts.projects_without_complete_star,
      complete_project_details: 0,
      draft_project_details: 0,
      draft_experiences: r.counts.draft_experiences,
      draft_educations: r.counts.draft_educations,
      draft_projects: r.counts.draft_projects,
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
  opts?: { noExperience?: boolean; projectFields?: boolean; createProject?: boolean; starForm?: boolean },
): DataReadiness {
  const missing: Array<"complete_experience" | "complete_project"> = opts?.noExperience
    ? ["complete_experience", "complete_project"]
    : ["complete_project"]
  const star = base.draft_item_ids.projects[0]
  const feature: ReadinessFeature = opts?.noExperience
    ? { ready: false, missing, hints: ["project_star"], next_action: "form" }
    : opts?.projectFields
      ? // `?state=insufficient-project-fields`: a standalone project with an empty 프로젝트 내용 (→ S-43 내용 편집)
        { ready: false, missing, hints: ["project_fields"], next_action: "form", suggested_project_id: PREVIEW_PROJECT_ID }
      : opts?.createProject
        ? { ready: false, missing, hints: [], next_action: "create_project" }
        : opts?.starForm
          ? { ready: false, missing, hints: ["project_star"], next_action: "form", suggested_project_id: star }
          : { ready: false, missing, hints: ["project_star"], next_action: "writing_chat", suggested_mode: "augment_project", suggested_project_id: star }
  return {
    ...base,
    counts: {
      ...base.counts,
      complete_projects: 0,
      complete_experiences: opts?.noExperience ? 0 : base.counts.complete_experiences,
      projects_without_complete_star: Math.max(1, base.counts.projects_without_complete_star),
      projects_without_complete_detail: Math.max(1, base.counts.projects_without_complete_star),
    },
    features: {
      insight: feature,
      draft: feature,
      job_interview: feature,
      culture_fit_interview: { ready: true, data_sufficiency: "thin" },
    },
  }
}
