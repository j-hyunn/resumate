/**
 * 프로젝트 상세(S-10) · 산출물 상세(S-44) data layer v4.5 — server only (Server Components / actions).
 * Contracts and copy: `./career-v45-shared` (client-safe). Names follow DM v4.5 2.5.1 / 2.5 / 7.
 *
 * Real path (DM v4.5, R5 wired 2026-11-04):
 * - reads: S-10 `getProjectDetail` + STAR chats, S-44 `getDeliverable` + its deliverable chats
 * - saveProjectPage / saveProjectDeliverable: `save_project_page` / `save_project_deliverable` (records
 *   `p_applied_proposals`; mapping in `./career-v45-save`)
 * - startWritingChat (`p_form_snapshot`) / startDeliverableWritingChat: `start_writing_chat` /
 *   `start_deliverable_writing_chat`; card patches: `apply_structured_draft_patch` (STAR and deliverable ops)
 * - turns: `POST /api/writing-chats/{id}/turns` (AI-12 or AI-13 by the chat's target, `formSnapshot` on every turn)
 * Previews (`?state=` / `/dev/`) always take the mock branch (`previewOr`).
 */
import "server-only"
import type { AiConnection, AiErrorCode, DeliverableStructuredDraft, ProjectStructuredDraft, ReturnTarget } from "@/types/db"
import { isAppError } from "@/lib/contracts/errors"
import type { ProjectDto } from "@/lib/contracts/career"
import type { DeliverableWritingChatDto, ProjectWritingChatSummary, WritingChatDto, WritingChatMessageDto } from "@/lib/contracts/writing-chat"
import { previewErrorCode } from "@/lib/preview-state"
import * as mock from "@/lib/mock/career-v45"
import { mockDeliverableDraft } from "@/lib/mock/writing-chat-turn-v45"
import { getAiConnection } from "./ai-connection"
import * as v44 from "./career-v44"
import * as chats44 from "./writing-chats-v44"
import { previewOr } from "./source"
import { educationDisplayName } from "@/server/services/career/education-name"
import { formatRange } from "./labels"
import * as v45 from "./page-save-v45"
import {
  fromSaveProjectDeliverableResult,
  fromSaveProjectPageResult,
  saveErrorOf,
  toSaveProjectDeliverableInput,
  toSaveProjectPageInput,
} from "./career-v45-save"
import {
  blankProjectValues,
  bodyHash,
  type DeliverableChatView,
  type DeliverableFormSnapshot,
  type DeliverablePageData,
  type PageLoad,
  type PagePreviewHints,
  type PatchDraftResult,
  type ProjectChatView,
  type ProjectFormSnapshot,
  type ProjectPageData,
  type ProjectPageValues,
  type SaveProjectDeliverableInput,
  type SaveProjectDeliverableResult,
  type SaveProjectPageInput,
  type SaveProjectPageResult,
  type StartChatResult,
  type StructuredDraftUserPatch,
  type TurnRequest,
  type TurnRequestBody,
  type WritingChatMessageView,
  type WritingChatSummary,
  type WritingChatView,
} from "./career-v45-shared"
import { normalizeDeliverableDraft, normalizeProjectDraft } from "./writing-chat-turn-v45"

// ---------------------------------------------------------------------------
// preview hints
// ---------------------------------------------------------------------------

/** `?state=` values S-10 / S-44 support (area reports list them; /dev/page-shell links them). */
export const PAGE_PREVIEW_STATES = [
  "new",
  "dirty",
  "saving",
  "save-failed",
  "first-save-failed",
  "stale",
  "skipped",
  "ai-locked",
  "chat-closed",
  "chat-closed-other-tab",
  "invalid-form-snapshot",
  "start-failed",
  "ai-stream",
  "draft-streaming",
  "draft-failed",
  "draft-ready",
  "draft-limit",
  "needs-review",
  "deliverable-limit",
  "standalone",
  "affiliated-parent",
  "empty",
  "not-found",
] as const

export function pagePreviewHints(state: string | null): PagePreviewHints | null {
  if (!state) return null
  const turnError: PagePreviewHints["turnError"] =
    state === "invalid-form-snapshot" ? "invalid_form_snapshot" : state === "chat-closed-other-tab" ? "writing_chat_closed" : (previewErrorCode(state) as AiErrorCode | null)
  return {
    state,
    dirty: state === "dirty",
    save: state === "saving" ? "slow" : state === "save-failed" ? "fail" : state === "stale" ? "stale" : state === "first-save-failed" ? "first-fail" : null,
    skip: state === "skipped",
    startFail: state === "start-failed",
    autoplay: state === "ai-stream" ? "question" : state === "draft-streaming" || state === "draft-failed" ? "draft" : null,
    turnError,
  }
}

// ---------------------------------------------------------------------------
// service DTO → v4.5 view
// ---------------------------------------------------------------------------

const toDate = (ym: string | null) => (ym ? `${ym}-01` : null)

function valuesOf(p: ProjectDto): ProjectPageValues {
  return {
    name: p.name,
    experience_id: p.experienceId,
    education_id: p.educationId,
    start_month: toDate(p.startMonth),
    end_month: toDate(p.endMonth),
    is_current: p.isCurrent,
    project_type: p.projectType,
    experience_type: p.experienceType,
    competencies: p.competencies,
    situation: p.situation,
    task: p.task,
    action: p.action,
    result: p.result,
    learnings: p.learnings,
  }
}

function summaryOf(c: ProjectWritingChatSummary): WritingChatSummary {
  return { id: c.id, title: c.title, status: c.status === "closed" ? "closed" : "active", message_count: c.messageCount, last_activity_at: c.lastActivityAt, last_applied_at: c.lastAppliedAt }
}

function messagesOf(list: WritingChatMessageDto[]): WritingChatMessageView[] {
  return list.map((m) => ({
    id: m.id,
    sequence: m.sequence,
    role: m.role,
    content: m.content,
    status: m.status,
    provider: m.provider,
    created_at: m.createdAt,
    user_number: m.userNumber,
    is_greeting: m.role === "assistant" && m.aiJobId === null && m.sequence === 0,
  }))
}

function deliverableChatOf(c: DeliverableWritingChatDto): DeliverableChatView {
  return {
    id: c.id,
    project_id: c.projectId,
    project_deliverable_id: c.projectDeliverableId,
    title: c.title,
    status: c.status === "closed" ? "closed" : "active",
    message_count: c.messageCount,
    last_activity_at: c.lastActivityAt,
    last_applied_at: c.lastAppliedAt,
    return_target: null,
    structured_draft: normalizeDeliverableDraft(c.structuredDraft),
    messages: messagesOf(c.messages),
  }
}

function chatOf(c: WritingChatDto): ProjectChatView {
  const messages = messagesOf(c.messages)
  return {
    id: c.id,
    project_id: c.projectId,
    project_deliverable_id: null,
    title: c.title,
    status: c.status === "closed" ? "closed" : "active",
    message_count: c.messageCount,
    last_activity_at: c.lastActivityAt,
    last_applied_at: c.lastAppliedAt,
    return_target: c.returnTarget as ReturnTarget | null,
    structured_draft: normalizeProjectDraft(c.structuredDraft),
    messages,
  }
}

function summaryOfView(c: WritingChatView): WritingChatSummary {
  return { id: c.id, title: c.title, status: c.status, message_count: c.message_count, last_activity_at: c.last_activity_at, last_applied_at: c.last_applied_at }
}

// ---------------------------------------------------------------------------
// reads
// ---------------------------------------------------------------------------

type ReadOpts = { chatId?: string | null; previewState?: string | null }

/** S-10 기존 프로젝트 (`/career/projects/{id}`). Standalone id → `standalone` (S-08 `?item=project:`). */
export async function getProjectPage(id: string, opts: ReadOpts = {}): Promise<PageLoad<ProjectPageData>> {
  const preview = pagePreviewHints(opts.previewState ?? null)
  return previewOr<PageLoad<ProjectPageData>>(
    async () => {
      if (opts.previewState === "not-found") return { kind: "not_found" } as const
      if (opts.previewState === "standalone") return { kind: "standalone", project_id: id } as const
      const row = await mock.mockProject(id)
      if (row === "standalone") return { kind: "standalone", project_id: id } as const
      if (!row) return { kind: "not_found" } as const
      const parentType = row.values.experience_id ? "experience" : "education"
      const parentId = (row.values.experience_id ?? row.values.education_id) as string
      const [parentName, affiliations, chatRows] = await Promise.all([
        mock.mockAffiliationName(parentType, parentId),
        mock.mockAffiliations(),
        mock.mockChats({ project_id: id }),
      ])
      const list = opts.previewState === "empty" ? [] : chatRows
      const pick = opts.chatId
        ? list.find((c) => c.id === opts.chatId)
        : opts.previewState === "chat-closed"
          ? list.find((c) => c.status === "closed")
          : list.find((c) => c.status === "active") ?? list[0]
      const open = pick ? mock.previewStarDraft(pick as ProjectChatView, opts.previewState ?? null) : null
      return {
        kind: "ok",
        data: {
          kind: "project",
          project_id: id,
          status: row.status,
          updated_at: row.updated_at,
          values: row.values,
          parent: { type: parentType, id: parentId, name: parentName ?? null },
          affiliations,
          chats: list.map(summaryOfView),
          open_chat: open,
          preview,
        },
      } as const
    },
    async () => {
      const detail = await v44.getProjectPage(id)
      if (!detail) {
        const standalone = await v44.getStandaloneProject(id).catch(() => null)
        return standalone ? ({ kind: "standalone", project_id: id } as const) : ({ kind: "not_found" } as const)
      }
      const list = await v44.getCareerList()
      const affiliations = list.years.flatMap((y) => y.items).filter((i) => i.entityType !== "project").map((i) => ({ type: i.entityType as "experience" | "education", id: i.id, name: i.name }))
      const summaries = detail.writingChats.map(summaryOf)
      const openId = opts.chatId ?? summaries.find((c) => c.status === "active")?.id ?? summaries[0]?.id ?? null
      const open = openId ? chatOf(await chats44.getProjectChat(openId)) : null
      return {
        kind: "ok",
        data: {
          kind: "project",
          project_id: detail.project.id,
          status: detail.project.status,
          updated_at: detail.project.updatedAt,
          values: valuesOf(detail.project),
          parent: detail.parent,
          affiliations,
          chats: summaries,
          open_chat: open,
          preview: null,
        },
      } as const
    },
  )
}

/** S-10 새 프로젝트 (`/career/projects/new?experience=|education=`): no row; unknown affiliation → not_found. */
export async function getNewProjectPage(aff: { experience?: string | null; education?: string | null }, opts: ReadOpts = {}): Promise<PageLoad<ProjectPageData>> {
  const type = aff.experience ? "experience" : aff.education ? "education" : null
  const parentId = aff.experience ?? aff.education ?? null
  if (!type || !parentId) return { kind: "not_found" }
  const preview = pagePreviewHints(opts.previewState ?? null)
  const build = (name: string | null, affiliations: ProjectPageData["affiliations"]): PageLoad<ProjectPageData> => ({
    kind: "ok",
    data: {
      kind: "project",
      project_id: null,
      status: null,
      updated_at: null,
      values: blankProjectValues(type === "experience" ? { experience_id: parentId } : { education_id: parentId }),
      parent: { type, id: parentId, name },
      affiliations,
      chats: [],
      open_chat: null,
      preview,
    },
  })
  return previewOr<PageLoad<ProjectPageData>>(
    async () => {
      const name = await mock.mockAffiliationName(type, parentId)
      if (name === undefined) return { kind: "not_found" } as const
      return build(name, await mock.mockAffiliations())
    },
    async () => {
      const panel = type === "experience" ? await v44.getExperiencePanel(parentId) : await v44.getEducationPanel(parentId)
      if (!panel) return { kind: "not_found" } as const
      const name = "experience" in panel ? panel.experience.companyName : educationDisplayName(panel.education.programName, panel.education.institutionName)
      const list = await v44.getCareerList()
      const affiliations = list.years.flatMap((y) => y.items).filter((i) => i.entityType !== "project").map((i) => ({ type: i.entityType as "experience" | "education", id: i.id, name: i.name }))
      return build(name, affiliations)
    },
  )
}

/** S-44 기존 산출물 (`/career/deliverables/{id}`). */
export async function getDeliverablePage(id: string, opts: ReadOpts = {}): Promise<PageLoad<DeliverablePageData>> {
  const preview = pagePreviewHints(opts.previewState ?? null)
  return previewOr<PageLoad<DeliverablePageData>>(
    async () => {
      if (opts.previewState === "not-found") return { kind: "not_found" } as const
      const row = await mock.mockDeliverable(id)
      if (!row) return { kind: "not_found" } as const
      if (opts.previewState === "affiliated-parent") return { kind: "affiliated", project_id: row.project_id } as const
      const list = opts.previewState === "empty" ? [] : ((await mock.mockChats({ project_deliverable_id: id })) as DeliverableChatView[])
      let open = (opts.chatId ? list.find((c) => c.id === opts.chatId) : list.find((c) => c.status === "active") ?? list[0]) ?? null
      if (open && (opts.previewState === "draft-ready" || opts.previewState === "needs-review" || opts.previewState === "draft-limit" || opts.previewState === "draft-failed")) {
        const d = structuredClone(open.structured_draft)
        d.deliverable = { body: mockDeliverableDraft(open, { needsReview: opts.previewState === "needs-review", bodyHash: await bodyHash(row.body), currentBody: row.body }) }
        d.draft_count = opts.previewState === "draft-limit" ? 6 : Math.max(d.draft_count, 1)
        if (opts.previewState === "needs-review") d.facts = d.facts.map((f, i) => (i === 2 ? { ...f, review: "needs_review" } : f))
        open = { ...open, structured_draft: d }
      }
      if (open && opts.previewState === "chat-closed") open = { ...open, status: "closed", message_count: 40 }
      return {
        kind: "ok",
        data: {
          kind: "deliverable",
          project_deliverable_id: id,
          updated_at: row.updated_at,
          title: row.title,
          body: row.body,
          project: { id: row.project_id, name: row.project_name },
          limit_reached: false,
          chats: list.map(summaryOfView),
          open_chat: open,
          preview,
        },
      } as const
    },
    async () => {
      const detail = await v44.getDeliverable(id)
      if (!detail) return { kind: "not_found" } as const
      const summaries = detail.writingChats.map(summaryOf)
      const openId = opts.chatId ?? summaries.find((c) => c.status === "active")?.id ?? summaries[0]?.id ?? null
      const open = openId ? await openDeliverableChat(openId) : null
      return {
        kind: "ok",
        data: {
          kind: "deliverable",
          project_deliverable_id: detail.deliverable.id,
          updated_at: detail.deliverable.updatedAt,
          title: detail.deliverable.title,
          body: detail.deliverable.body,
          project: detail.project,
          limit_reached: false,
          chats: summaries,
          open_chat: open,
          preview: null,
        },
      } as const
    },
  )
}

/** S-44 새 산출물 (`/career/projects/{project_id}/deliverables/new`). Affiliated parent → `affiliated`. */
export async function getNewDeliverablePage(projectId: string, opts: ReadOpts = {}): Promise<PageLoad<DeliverablePageData>> {
  const preview = pagePreviewHints(opts.previewState ?? null)
  const build = (name: string, count: number): PageLoad<DeliverablePageData> => ({
    kind: "ok",
    data: {
      kind: "deliverable",
      project_deliverable_id: null,
      updated_at: null,
      title: "",
      body: "",
      project: { id: projectId, name },
      limit_reached: count >= 50,
      chats: [],
      open_chat: null,
      preview,
    },
  })
  return previewOr<PageLoad<DeliverablePageData>>(
    async () => {
      if (opts.previewState === "affiliated-parent") return { kind: "affiliated", project_id: projectId } as const
      const p = await mock.mockStandaloneProject(projectId)
      if (p === "affiliated") return { kind: "affiliated", project_id: projectId } as const
      if (!p) return { kind: "not_found" } as const
      return build(p.name, opts.previewState === "deliverable-limit" ? 50 : p.count)
    },
    async () => {
      const p = await v44.getStandaloneProject(projectId)
      if (!p) {
        const affiliated = await v44.getProjectPage(projectId).catch(() => null)
        return affiliated ? ({ kind: "affiliated", project_id: projectId } as const) : ({ kind: "not_found" } as const)
      }
      return build(p.project.name, p.deliverableLimitReached ? 50 : p.deliverables.length)
    },
  )
}

/** S-43 산출물 섹션 (E2 요청): 독립 프로젝트의 산출물 행. 소속 프로젝트·없음 = null. */
export async function listProjectDeliverables(
  projectId: string,
  opts: { previewState?: string | null } = {},
): Promise<{ deliverables: Array<{ id: string; title: string; sort_order: number }>; limit_reached: boolean } | null> {
  return previewOr(
    async () => {
      const rows = await mock.mockProjectDeliverables(projectId)
      if (!rows) return null
      if (opts.previewState === "empty") return { deliverables: [], limit_reached: false }
      return { deliverables: rows, limit_reached: opts.previewState === "deliverable-limit" || rows.length >= 50 }
    },
    async () => {
      const p = await v44.getStandaloneProject(projectId)
      if (!p) return null
      return {
        deliverables: p.deliverables.map((d) => ({ id: d.id, title: d.title, sort_order: d.sortOrder })),
        limit_reached: p.deliverableLimitReached,
      }
    },
  )
}

/** A deliverable chat of `?chat=` / the latest one; a gone or STAR id → null (the page opens without a chat). */
async function openDeliverableChat(chatId: string): Promise<DeliverableChatView | null> {
  try {
    return deliverableChatOf(await v45.getDeliverableChat(chatId))
  } catch (err) {
    if (isAppError(err) && err.code === "not_found") return null
    throw err
  }
}

/** Open one chat of either target (대화 기록 → 열기). null = gone. */
export async function getWritingChat(chatId: string): Promise<WritingChatView | null> {
  return previewOr<WritingChatView | null>(
    async () => mock.mockChat(chatId),
    async () => {
      try {
        const dto = await v45.getAnyChat(chatId)
        return dto.target === "project_deliverable" ? deliverableChatOf(dto) : chatOf(dto)
      } catch (err) {
        if (isAppError(err) && err.code === "not_found") return null
        throw err
      }
    },
  )
}

// ---------------------------------------------------------------------------
// page saves (DM 2.5.1)
// ---------------------------------------------------------------------------

/**
 * S-10 "저장하기" → `save_project_page(p_project_id, p_values, p_expected_updated_at, p_applied_proposals)`.
 * Never throws for a refusal: `{ ok: false, error }` (nothing written).
 */
export async function saveProjectPage(input: SaveProjectPageInput, previewState?: string | null): Promise<SaveProjectPageResult> {
  const hints = pagePreviewHints(previewState ?? null)
  return previewOr<SaveProjectPageResult>(
    async () => {
      if (hints?.save === "slow") await new Promise((r) => setTimeout(r, 20_000))
      if (hints?.save === "fail" || (hints?.save === "first-fail" && !input.project_id)) return { ok: false, error: { code: "save_failed" } } as const
      if (input.project_id && input.expected_updated_at) {
        const current = await mock.mockProjectUpdatedAt(input.project_id)
        if (hints?.save === "stale" || (current && current !== input.expected_updated_at)) return { ok: false, error: { code: "stale_write", current_updated_at: current } } as const
      }
      const r = await mock.mockSaveProject(input.project_id ?? input.client_id ?? null, input.values, input.applied_proposals)
      if (hints?.skip) {
        const skipped = [...r.applied.map((a) => ({ ...a, reason: "proposal_changed" as const })), ...r.skipped]
        return { ok: true, ...r, applied: [], skipped: skipped.length ? skipped : [{ writing_chat_id: "preview", field: "result" as const, reason: "proposal_changed" as const }] } as const
      }
      return { ok: true, ...r } as const
    },
    async () => {
      try {
        return fromSaveProjectPageResult(await v45.saveProjectPage(toSaveProjectPageInput(input)))
      } catch (err) {
        return { ok: false, error: saveErrorOf(err) } as const
      }
    },
  )
}

/** S-44 "저장하기" → `save_project_deliverable(…)`. */
export async function saveProjectDeliverable(input: SaveProjectDeliverableInput, previewState?: string | null): Promise<SaveProjectDeliverableResult> {
  const hints = pagePreviewHints(previewState ?? null)
  return previewOr<SaveProjectDeliverableResult>(
    async () => {
      if (hints?.save === "slow") await new Promise((r) => setTimeout(r, 20_000))
      if (hints?.save === "fail" || (hints?.save === "first-fail" && !input.project_deliverable_id)) return { ok: false, error: { code: "save_failed" } } as const
      // `?state=deliverable-limit` (UQ-S44-7): the create is refused like the trigger would (nothing written)
      if (previewState === "deliverable-limit" && !input.project_deliverable_id) return { ok: false, error: { code: "deliverable_limit_reached" } } as const
      if (input.project_deliverable_id && input.expected_updated_at) {
        const current = await mock.mockDeliverableUpdatedAt(input.project_deliverable_id)
        if (hints?.save === "stale" || (current && current !== input.expected_updated_at)) return { ok: false, error: { code: "stale_write", current_updated_at: current } } as const
      }
      const r = await mock.mockSaveDeliverable(
        { id: input.project_deliverable_id ?? input.client_id ?? null, project_id: input.project_id, title: input.title, body: input.body },
        input.applied_proposals,
      )
      if ("refused" in r && r.refused) return { ok: false, error: { code: r.refused } } as const
      if (!("project_deliverable_id" in r) || !r.project_deliverable_id) return { ok: false, error: { code: "save_failed" } } as const
      return { ok: true, project_deliverable_id: r.project_deliverable_id, project_id: r.project_id, sort_order: r.sort_order, updated_at: r.updated_at, applied: r.applied, skipped: r.skipped } as const
    },
    async () => {
      try {
        return fromSaveProjectDeliverableResult(await v45.saveDeliverablePage(toSaveProjectDeliverableInput(input)))
      } catch (err) {
        return { ok: false, error: saveErrorOf(err) } as const
      }
    },
  )
}

// ---------------------------------------------------------------------------
// panel (DM 2.5 / 3.3 / 7)
// ---------------------------------------------------------------------------

/** FL 첫 메시지 ② AI 사용 가능 확인 = `get_data_readiness().ai_connection` (the client applies `?state=`). */
export async function checkAiConnection(): Promise<AiConnection> {
  return getAiConnection()
}

/** `start_writing_chat(p_project_id, p_return_target, p_form_snapshot)` → the opened chat. */
export async function startWritingChat(
  projectId: string,
  returnTarget: { application_project_id: string; feature: ReturnTarget["feature"]; params?: Record<string, unknown> } | null,
  formSnapshot: ProjectFormSnapshot | null,
  previewState?: string | null,
): Promise<StartChatResult<ProjectChatView>> {
  return previewOr<StartChatResult<ProjectChatView>>(
    async () => {
      if (pagePreviewHints(previewState ?? null)?.startFail) return { ok: false, error: { code: "failed" } } as const
      const chat = await mock.mockStartChat({ project_id: projectId, snapshot: formSnapshot ?? emptyProjectSnapshot() })
      return chat ? ({ ok: true, chat: chat as ProjectChatView } as const) : ({ ok: false, error: { code: "not_found" } } as const)
    },
    async () => {
      try {
        // p_form_snapshot only picks the greeting (never stored, DM 2.5.1)
        const dto = await v45.startProjectChatWithSnapshot({
          projectId,
          returnTarget: returnTarget ? { applicationProjectId: returnTarget.application_project_id, feature: returnTarget.feature, params: returnTarget.params ?? {} } : undefined,
          ...(formSnapshot ? { formSnapshot } : {}),
        })
        return { ok: true, chat: chatOf(dto) } as const
      } catch (err) {
        return { ok: false, error: { code: panelErrorCode(err) } } as const
      }
    },
  )
}

/** `start_deliverable_writing_chat(p_project_deliverable_id, p_form_snapshot)` → the opened chat. */
export async function startDeliverableWritingChat(deliverableId: string, formSnapshot: DeliverableFormSnapshot | null, previewState?: string | null): Promise<StartChatResult<DeliverableChatView>> {
  return previewOr<StartChatResult<DeliverableChatView>>(
    async () => {
      if (pagePreviewHints(previewState ?? null)?.startFail) return { ok: false, error: { code: "failed" } } as const
      const chat = await mock.mockStartChat({ project_deliverable_id: deliverableId, snapshot: formSnapshot ?? { title: "", body: "" } })
      return chat ? ({ ok: true, chat: chat as DeliverableChatView } as const) : ({ ok: false, error: { code: "not_found" } } as const)
    },
    async () => {
      try {
        const dto = await v45.startDeliverableChat({ projectDeliverableId: deliverableId, ...(formSnapshot ? { formSnapshot } : {}) })
        return { ok: true, chat: deliverableChatOf(dto) } as const
      } catch (err) {
        return { ok: false, error: { code: panelErrorCode(err) } } as const
      }
    },
  )
}

/** 패널 ⋯ "이 대화 삭제" (C-05 confirmed). */
export async function deleteWritingChat(chatId: string): Promise<{ ok: boolean }> {
  return previewOr<{ ok: boolean }>(
    async () => ({ ok: await mock.mockDeleteChat(chatId) }),
    async () => {
      await chats44.deleteProjectChat(chatId)
      return { ok: true }
    },
  )
}

/**
 * `apply_structured_draft_patch` (사용자 세션): card edits and reviews — STAR field edit / review, deliverable
 * fact accept · reject and block accept · drop. A patch on an applied field / draft → `field_already_applied`.
 */
export async function applyStructuredDraftPatch<D extends ProjectStructuredDraft | DeliverableStructuredDraft>(chatId: string, patch: StructuredDraftUserPatch): Promise<PatchDraftResult<D>> {
  return previewOr<PatchDraftResult<D>>(
    async () => {
      const r = await mock.mockPatchDraft(chatId, (draft) => applyUserPatch(draft, patch))
      return "error" in r ? ({ ok: false, error: { code: r.error as "not_found" } } as const) : ({ ok: true, structured_draft: r.draft as D } as const)
    },
    async () => {
      try {
        if (patch.kind === "fact_review" || patch.kind === "block_review") {
          const r = await v45.editDeliverableDraft(
            patch.kind === "fact_review"
              ? { writingChatId: chatId, op: patch.decision === "accept" ? "accept_fact" : "reject_fact", factId: patch.fact_id }
              : { writingChatId: chatId, op: patch.decision === "accept" ? "accept_block" : "remove_block", blockId: patch.block_id },
          )
          return { ok: true, structured_draft: normalizeDeliverableDraft(r.structuredDraft) as D } as const
        }
        const path = { section: patch.section, field: patch.field } as Parameters<typeof chats44.editProposalField>[0]["path"]
        const r =
          patch.kind === "edit"
            ? await chats44.editProposalField({ writingChatId: chatId, path, value: patch.value })
            : await chats44.reviewProposalField({ writingChatId: chatId, path }, patch.decision)
        return { ok: true, structured_draft: normalizeProjectDraft(r.structuredDraft) as D } as const
      } catch (err) {
        return { ok: false, error: { code: panelErrorCode(err) } } as const
      }
    },
  )
}

/**
 * Prepares one turn (`POST /api/writing-chats/{id}/turns` body `{content, requested_slot?, requested_action?,
 * style?, form_snapshot}`). The client streams it with `streamTurn`.
 */
export async function prepareWritingChatTurn(input: {
  chat_id: string
  target: "project" | "deliverable"
  body: TurnRequestBody
  retry: boolean
  /** the client's current view (mock turns build on it) */
  structured_draft: ProjectStructuredDraft | DeliverableStructuredDraft
  message_count: number
  next_sequence: number
  preview_state: string | null
}): Promise<TurnRequest> {
  return previewOr<TurnRequest>(
    async () => ({
      kind: "mock",
      target: input.target,
      chat_id: input.chat_id,
      body: input.body,
      retry: input.retry,
      structured_draft: input.structured_draft,
      message_count: input.message_count,
      next_sequence: input.next_sequence,
      turn_error: pagePreviewHints(input.preview_state)?.turnError ?? null,
      preview_state: input.preview_state,
    }) as const,
    async () => {
      const base = `/api/writing-chats/${input.chat_id}/turns`
      const slot = input.body.requested_slot
      // route body (contracts WritingChatTurnInput / WritingChatRetryInput): AI-13 options only on deliverable chats
      const options = {
        requestedSlot: slot ? { slot } : null,
        ...(input.target === "deliverable" ? { requestedAction: input.body.requested_action, style: input.body.style } : {}),
        formSnapshot: input.body.form_snapshot,
      }
      return {
        kind: "real",
        target: input.target,
        endpoint: input.retry ? `${base}?retry=1` : base,
        body: input.retry ? options : { content: input.body.content, ...options },
      } as const
    },
  )
}

/** Mock only: keep the mock row in step with a client-side mock turn (no-op on the real path). */
export async function recordMockTurn(
  chatId: string,
  turn: { messages: WritingChatMessageView[]; structured_draft: WritingChatView["structured_draft"]; message_count: number; closed: boolean; title: string | null },
): Promise<void> {
  return previewOr<void>(
    async () => mock.mockRecordTurn(chatId, turn),
    async () => undefined,
  )
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function emptyProjectSnapshot(): ProjectFormSnapshot {
  return { name: "", start_month: null, end_month: null, is_current: false, project_type: null, experience_type: null, competencies: [], star: { situation: null, task: null, action: null, result: null, learnings: null } }
}

function panelErrorCode(
  err: unknown,
): "not_found" | "writing_chat_closed" | "ai_not_connected" | "ai_consent_required" | "key_invalid" | "field_already_applied" | "invalid_form_snapshot" | "failed" {
  if (!isAppError(err)) return "failed"
  const known = ["not_found", "writing_chat_closed", "ai_not_connected", "ai_consent_required", "key_invalid", "field_already_applied", "invalid_form_snapshot"] as const
  return (known as readonly string[]).includes(err.code) ? (err.code as (typeof known)[number]) : "failed"
}

/** DM 2.5 / 2.5.0 user patch rules on a draft (mock). Returns an error code or null. */
function applyUserPatch(draft: ProjectStructuredDraft | DeliverableStructuredDraft, patch: StructuredDraftUserPatch): string | null {
  const now = new Date().toISOString()
  if (patch.kind === "fact_review" || patch.kind === "block_review") {
    if (!("target" in draft)) return "invalid_patch"
    if (patch.kind === "fact_review") {
      const i = draft.facts.findIndex((f) => f.id === patch.fact_id)
      if (i < 0) return "not_found"
      if (patch.decision === "accept") draft.facts[i] = { ...draft.facts[i], review: "accepted", reviewed_at: now }
      else draft.facts.splice(i, 1)
      return null
    }
    const body = draft.deliverable.body
    if (!body) return "not_found"
    if (body.applied_at) return "field_already_applied"
    const i = body.blocks.findIndex((b) => b.block_id === patch.block_id)
    if (i < 0) return "not_found"
    if (patch.decision === "accept") body.blocks[i] = { ...body.blocks[i], review: "accepted" }
    else {
      body.blocks.splice(i, 1)
      body.rev += 1
    }
    return null
  }
  if ("target" in draft) return "invalid_patch"
  const section = draft[patch.section] as Record<string, { value: unknown; review: string; reviewed_at: string | null; applied_at: string | null; origin: string; rev?: number } | undefined>
  const obj = section[patch.field]
  if (!obj) return "not_found"
  if (obj.applied_at) return "field_already_applied"
  if (patch.kind === "edit") {
    section[patch.field] = { ...obj, value: patch.value, origin: "user_edit", review: "ok", rev: (obj.rev ?? 1) + 1 }
  } else if (patch.decision === "accept") {
    section[patch.field] = { ...obj, review: "accepted", reviewed_at: now }
  } else {
    section[patch.field] = { ...obj, value: null, review: "ok", reviewed_at: now, rev: (obj.rev ?? 1) + 1 }
  }
  return null
}

// ---------------------------------------------------------------------------
// C-23 소속 선택 (mode "choose": C-09 create_project · S-16 보완점)
// ---------------------------------------------------------------------------

export interface ProjectAffiliationChoices {
  affiliations: Array<{ type: "experience" | "education"; id: string; name: string | null; period: string | null }>
  /** [가정] C-23: 완료 경력이 있으면 가장 최근 경력 */
  default_id: string | null
}

export async function listProjectAffiliations(): Promise<ProjectAffiliationChoices> {
  return previewOr<ProjectAffiliationChoices>(
    async () => {
      const rows = await mock.mockAffiliationOptions()
      return {
        affiliations: rows.map((r) => ({ type: r.type, id: r.id, name: r.name, period: formatRange(r.start_month, r.end_month, r.is_current) || null })),
        default_id: rows.find((r) => r.type === "experience" && r.status === "complete")?.id ?? null,
      }
    },
    async () => {
      const list = await v44.getCareerList()
      const items = list.years
        .flatMap((y) => y.items)
        .filter((i) => i.entityType !== "project")
        .sort((a, b) => (b.startMonth ?? "").localeCompare(a.startMonth ?? ""))
      return {
        // v4.4 list has no end month → no period line on the real path (연결 대기 nothing: S-08 data shape)
        affiliations: items.map((i) => ({ type: i.entityType as "experience" | "education", id: i.id, name: i.name, period: null })),
        default_id: items.find((i) => i.entityType === "experience" && i.status === "complete")?.id ?? null,
      }
    },
  )
}
