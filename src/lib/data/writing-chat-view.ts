/**
 * S-36 view model (server side). Moved from components/career/writing-chat/chat-view.ts
 * (Phase 3, A2 UQ-78). Combines the chat, the augment target project, the
 * re-judged readiness and the current question slot. View-model only — no new
 * columns (ui-context: UI-only fields live next to the component). Previews read the
 * mock's turn memory; the real path has none (the AI decides each turn from the draft).
 */
import type { AiJob, DataReadiness, Education, Experience, ProjectDetail, StructuredField } from "@/types/db"
import { getProject, listEducations, listExperiences, type ProjectWithChildren } from "./career"
import { getDataReadiness } from "./readiness"
import { mockRequest } from "@/lib/mock/store"
import type { WritingChatDetail } from "./writing-chats"
import { askedSlot, projectedReady as mockProjectedReady } from "@/lib/mock/writing-chat-turn"
import { nextOpenSlot, type ChatSlot } from "./writing-chat-slots"
import { isDetailComplete } from "./career"
import { isPreviewRequest } from "./source"
import { requireConsentedUser } from "@/server/auth/session"
import { loadTurnFailureJobs } from "@/server/services/career/rows"

export interface ChatView {
  chat: WritingChatDetail
  /** augment target, or the project created by save / hand-off */
  project: ProjectWithChildren | null
  /** structured_draft.details[0].existing_detail_id row (보강 모드 기존 상세 내용) */
  existingDetail: ProjectDetail | null
  experiences: Pick<Experience, "id" | "company_name" | "status">[]
  educations: Pick<Education, "id" | "institution_name" | "status">[]
  readiness: DataReadiness
  /** 지금 저장하면 D-01 충족 예상 (R-32 ready_to_return) */
  readyToReturn: boolean
  currentSlot: ChatSlot | null
  skippedSlots: ChatSlot[]
  /**
   * v4 (A2 request 9 / UQ-239): real cause of each failed assistant turn, keyed by message id
   * (from the turn's ai_jobs row) → <AiErrorNotice {...aiErrorFromJob(turnFailures[id])} />.
   */
  turnFailures: Record<string, Pick<AiJob, "error_code" | "provider" | "retry_after" | "quota_resets_at">>
}

/** R-32 ready_to_return: would saving now satisfy D-01? Same rule as the mock's, on real rows. */
function projectedReady(
  chat: WritingChatDetail,
  project: ProjectWithChildren | null,
  existing: ProjectDetail | null,
  experiences: Pick<Experience, "id" | "status">[],
  educations: Pick<Education, "id" | "status">[],
  readiness: DataReadiness,
): boolean {
  const key = chat.return_target && chat.return_target.feature !== "insight" ? "draft" : "insight"
  const feature = readiness.features[key]
  if (feature.ready) return true
  if (feature.missing?.includes("complete_experience")) return false
  const draft = chat.structured_draft
  const usable = (field?: StructuredField<unknown>) => (field && field.review !== "needs_review" && field.value !== null && field.value !== "" ? String(field.value) : null)
  // W2-⑨: any card can be the complete detail. `existing` covers the first card, also before the AI made one
  const detailOk = (draft.details ?? []).some((card, i) => {
    const base = card.existing_detail_id ? (project?.details.find((d) => d.id === card.existing_detail_id) ?? (i === 0 ? existing : null)) : null
    return isDetailComplete({
      title: base?.title ?? usable(card.fields.title),
      situation: base?.situation ?? usable(card.fields.situation),
      action: base?.action ?? usable(card.fields.action),
    })
  })
  const parentExperience = project?.experience_id ?? chat.experience_id
  const parentEducation = project?.education_id ?? chat.education_id
  const parentOk = parentExperience
    ? experiences.some((e) => e.id === parentExperience && e.status === "complete")
    : parentEducation
      ? educations.some((e) => e.id === parentEducation && e.status === "complete")
      : true
  return Boolean((project?.name ?? usable(draft.project?.name)) && (project?.role ?? usable(draft.project?.role)) && detailOk && parentOk)
}

export async function buildChatView(chat: WritingChatDetail): Promise<ChatView> {
  const preview = await isPreviewRequest()
  const [project, experiences, educations, readiness] = await Promise.all([
    chat.project_id ? getProject(chat.project_id) : Promise.resolve(null),
    listExperiences(),
    listEducations(),
    getDataReadiness(),
  ])
  const existingId = chat.structured_draft.details?.[0]?.existing_detail_id ?? null
  let existingDetail = existingId ? (project?.details.find((d) => d.id === existingId) ?? null) : null
  if (!existingDetail && chat.mode === "augment_project" && project && !(chat.structured_draft.details ?? []).length) {
    // before the first turn: the detail the chat will augment (first incomplete one)
    existingDetail = project.details.find((d) => d.status === "draft") ?? null
  }
  const lists = {
    experiences: experiences.map((e) => ({ id: e.id, company_name: e.company_name, status: e.status })),
    educations: educations.map((e) => ({ id: e.id, institution_name: e.institution_name, status: e.status })),
  }
  if (!preview) {
    const failedJobs = chat.messages.filter((m) => m.role === "assistant" && m.status === "failed" && m.ai_job_id).map((m) => m.ai_job_id as string)
    const jobs = failedJobs.length === 0 ? [] : await loadTurnFailureJobs((await requireConsentedUser()).supabase, failedJobs)
    return {
      chat,
      project,
      existingDetail,
      ...lists,
      readiness,
      readyToReturn: projectedReady(chat, project, existingDetail, experiences, educations, readiness),
      currentSlot: nextOpenSlot(chat.structured_draft, chat.mode, existingDetail, [], Boolean(chat.return_target)),
      skippedSlots: [],
      turnFailures: Object.fromEntries(
        chat.messages.flatMap((m) => {
          const job = jobs.find((j) => j.id === m.ai_job_id)
          // 중단 is the user's own stop: the mock keeps no failure row for it either, so a reload shows the neutral retry.
          return job?.error_code && job.error_code !== "canceled" && m.status === "failed"
            ? [[m.id, { error_code: job.error_code as AiJob["error_code"], provider: job.provider as AiJob["provider"], retry_after: job.retry_after, quota_resets_at: job.quota_resets_at }]]
            : []
        }),
      ),
    }
  }
  const db = await mockRequest(0)
  const mem = askedSlot(db, chat.id)
  const raw = db.writing_chats.find((c) => c.id === chat.id)
  return {
    chat,
    project,
    existingDetail,
    ...lists,
    readiness,
    readyToReturn: raw ? mockProjectedReady(db, raw) : false,
    currentSlot:
      mem.asked ??
      nextOpenSlot(chat.structured_draft, chat.mode, existingDetail, mem.skipped, Boolean(chat.return_target)),
    skippedSlots: mem.skipped,
    turnFailures: Object.fromEntries(
      chat.messages
        .filter((m) => m.role === "assistant" && m.status === "failed" && m.ai_job_id)
        .flatMap((m) => {
          const job = db.ai_jobs.find((j) => j.id === m.ai_job_id)
          return job?.error_code
            ? [[m.id, { error_code: job.error_code, provider: job.provider, retry_after: job.retry_after, quota_resets_at: job.quota_resets_at }]]
            : []
        }),
    ),
  }
}
