/**
 * S-36 view model (server side). Moved from components/career/writing-chat/chat-view.ts
 * (Phase 3, A2 UQ-78). Combines the chat, the augment target project, the
 * re-judged readiness and the mock's current question slot. View-model only — no new
 * columns (ui-context: UI-only fields live next to the component).
 */
import type { AiJob, DataReadiness, Education, Experience, ProjectDetail } from "@/types/db"
import { getProject, listEducations, listExperiences, type ProjectWithChildren } from "./career"
import { getDataReadiness } from "./readiness"
import { mockRequest } from "@/lib/mock/store"
import type { WritingChatDetail } from "./writing-chats"
import { askedSlot, projectedReady } from "@/lib/mock/writing-chat-turn"
import { nextOpenSlot, type ChatSlot } from "./writing-chat-slots"

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

export async function buildChatView(chat: WritingChatDetail): Promise<ChatView> {
  const [project, experiences, educations, readiness, db] = await Promise.all([
    chat.project_id ? getProject(chat.project_id) : Promise.resolve(null),
    listExperiences(),
    listEducations(),
    getDataReadiness(),
    mockRequest(0),
  ])
  const existingId = chat.structured_draft.details?.[0]?.existing_detail_id ?? null
  let existingDetail = existingId ? (project?.details.find((d) => d.id === existingId) ?? null) : null
  if (!existingDetail && chat.mode === "augment_project" && project && !(chat.structured_draft.details ?? []).length) {
    // before the first turn: the detail the chat will augment (first incomplete one)
    existingDetail = project.details.find((d) => d.status === "draft") ?? null
  }
  const mem = askedSlot(db, chat.id)
  const raw = db.writing_chats.find((c) => c.id === chat.id)
  return {
    chat,
    project,
    existingDetail,
    experiences: experiences.map((e) => ({ id: e.id, company_name: e.company_name, status: e.status })),
    educations: educations.map((e) => ({ id: e.id, institution_name: e.institution_name, status: e.status })),
    readiness,
    readyToReturn: raw ? projectedReady(db, raw) : false,
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
