/**
 * AI 작성 대화 data layer (writing_chats, writing_chat_messages) — RPC names from 04 §2.5/§3.3:
 * append_writing_chat_message, apply_structured_draft_patch, set_writing_chat_affiliation,
 * save_writing_chat, hand_off_writing_chat. Server only.
 *
 * W2: real services + RLS; `?state=` previews stay on the mock store. The AI turn: `sendWritingChatTurn`
 * / `retryWritingChatTurn` check the gate and return `{ endpoint, body }`, the screen hands that to
 * `useChatTurnStream().start`, and the Route Handler stores the messages and the patch. In a preview
 * the same functions return the mock plan (no `endpoint`) and `completeMockAssistantTurn` stores the reply.
 */
import { randomUUID } from "node:crypto"
import { z } from "zod"
import type {
  AiErrorCode,
  ReturnTarget,
  StructuredDraft,
  StructuredField,
  WritingChat,
  WritingChatMessage,
  WritingChatMode,
} from "@/types/db"
import { clone, mockRequest } from "@/lib/mock/store"
import type { MockDb } from "@/lib/mock/fixtures"
import { newId, USER_ID } from "@/lib/mock/ids"
import { isAchievementComplete, isDetailComplete } from "./career"
import { canSendWritingChatMessage } from "./writing-chat-limits"
import { isDetailSlot, type ChatSlot } from "./writing-chat-slots"
import { applyPlannedTurn, markAsked, planMockTurn, readPlannedTurn } from "@/lib/mock/writing-chat-turn"
import { activeKey, assertAiRunnable, MockAiError, recordMockUsage } from "@/lib/mock/ai"
import { errorCategoryOf, failureCauseOf, failureTimestamps } from "./ai-errors"
import { mockMessageMeta } from "@/lib/mock/ai-meta"
import { normalizeSkillName } from "@/lib/contracts/career"
import { AppError, invalid, isAppError } from "@/lib/contracts/errors"
import {
  ApplyDraftEditInput,
  EditDraftDetailInput,
  ReviewDraftFieldInput,
  SetAffiliationInput,
  StartWritingChatInput,
  type DraftFieldPath,
  type RequestedSlot,
} from "@/lib/contracts/writing-chat"
import { requireConsentedUser } from "@/server/auth/session"
import type { UserSupabaseClient } from "@/server/db/types"
import { loadCareerRows, loadFirstDraftDetailId, loadWritingChatRows, loadWritingChatWithMessages } from "@/server/services/career/rows"
import * as chats from "@/server/services/writing-chat/chat"
import { hasRoomForTurn } from "@/server/services/writing-chat/turn"
import { previewOr, unwrap } from "./source"

export {
  WRITING_CHAT_MESSAGE_LIMIT,
  WRITING_CHAT_RETENTION_DAYS,
  canSendWritingChatMessage,
  daysUntilAutoDelete,
} from "./writing-chat-limits"

/** 시작 인사 (고정 문구, AI 없음) — // [UI-가정] copy not in spec */
const GREETING: Record<WritingChatMode, string> = {
  new_project: "안녕하세요. 어떤 프로젝트를 정리해 볼까요? 프로젝트 이름과 어떤 문제를 풀려고 했는지 알려 주세요.",
  augment_project: "이 프로젝트에 상세 내용을 더해 볼게요. 비어 있는 부분부터 여쭤볼게요.",
}

export interface WritingChatDetail extends WritingChat {
  messages: WritingChatMessage[]
  /** user messages renumbered #1..n (C-15 "내 답변 #n") */
  user_message_numbers: Record<string, number>
}

function detail(db: Pick<MockDb, "writing_chat_messages">, chat: WritingChat): WritingChatDetail {
  const messages = db.writing_chat_messages
    .filter((m) => m.writing_chat_id === chat.id)
    .sort((a, b) => a.sequence - b.sequence)
  const numbers: Record<string, number> = {}
  let n = 0
  for (const m of messages) if (m.role === "user") numbers[m.id] = ++n
  return { ...chat, messages, user_message_numbers: numbers }
}

// ---------------------------------------------------------------------------
// real path helpers
// ---------------------------------------------------------------------------

function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) unwrap(invalid(parsed.error))
  return parsed.data as z.output<S>
}

async function loadChatDetail(supabase: UserSupabaseClient, chatId: string): Promise<WritingChatDetail | null> {
  if (!z.guid().safeParse(chatId).success) return null
  const loaded = await loadWritingChatWithMessages(supabase, chatId)
  if (!loaded) return null
  // Generated types give CHECK columns and jsonb as string / Json; the DB guarantees the narrower UI types.
  return detail({ writing_chat_messages: loaded.messages as unknown as WritingChatMessage[] }, loaded.chat as unknown as WritingChat)
}

async function requireChatDetail(supabase: UserSupabaseClient, chatId: string): Promise<WritingChatDetail> {
  const chat = await loadChatDetail(supabase, chatId)
  if (!chat) throw new AppError("not_found", "요청한 대화를 찾을 수 없습니다.")
  return chat
}

export async function listActiveWritingChats(): Promise<WritingChat[]> {
  return previewOr(
    async () => {
      const db = await mockRequest()
      return clone(
        db.writing_chats.filter((c) => c.status === "active").sort((a, b) => b.last_activity_at.localeCompare(a.last_activity_at)),
      )
    },
    async () => {
      const { supabase } = await requireConsentedUser()
      return (await loadWritingChatRows(supabase, "active")) as unknown as WritingChat[]
    },
  )
}

/** v4.2 A6: S-08 "그만둔 대화 N개" — abandoned chats, latest activity first */
export async function listAbandonedWritingChats(): Promise<WritingChat[]> {
  return previewOr(
    async () => {
      const db = await mockRequest()
      return clone(
        db.writing_chats.filter((c) => c.status === "abandoned").sort((a, b) => b.last_activity_at.localeCompare(a.last_activity_at)),
      )
    },
    async () => {
      const { supabase } = await requireConsentedUser()
      return (await loadWritingChatRows(supabase, "abandoned")) as unknown as WritingChat[]
    },
  )
}

export async function getWritingChat(id: string): Promise<WritingChatDetail | null> {
  return previewOr(
    async () => {
      const db = await mockRequest()
      const chat = db.writing_chats.find((c) => c.id === id)
      return chat ? clone(detail(db, chat)) : null
    },
    async () => {
      const { supabase } = await requireConsentedUser()
      return loadChatDetail(supabase, id)
    },
  )
}

/** No active AI key (ai_connection.active_provider = null) */
export class WritingChatLockedError extends Error {
  constructor() {
    super("writing chat needs an active AI key")
  }
}

export interface StartWritingChatArgs {
  mode: WritingChatMode
  project_id?: string | null
  experience_id?: string | null
  education_id?: string | null
  return_target?: Omit<ReturnTarget, "created_at"> | null
}

/**
 * 대화 시작: insert + 고정 시작 인사 (AI 없음). v4: no monthly limit (D-34). The mock needs an active
 * provider key and throws WritingChatLockedError (screens show C-18 first); the real start doesn't
 * (PRD 3.3: only a new message needs a key, spec-gaps W2).
 */
export async function startWritingChat(input: StartWritingChatArgs): Promise<WritingChatDetail> {
  return previewOr(
    () => mockStartWritingChat(input),
    async () => {
      const { supabase } = await requireConsentedUser()
      const rt = input?.return_target
      const startInput = parseInput(StartWritingChatInput, {
        mode: input?.mode,
        ...(input?.mode === "augment_project" ? { projectId: input.project_id } : {}),
        ...(rt ? { returnTarget: { applicationProjectId: rt.application_project_id, feature: rt.feature, params: rt.params } } : {}),
      })
      // QA-W5-09: the affiliation is checked first and set atomically with the start (cleanup on failure)
      const affiliationId = startInput.mode === "new_project" ? (input.experience_id ?? input.education_id ?? null) : null
      const affiliation = affiliationId
        ? (parseInput(SetAffiliationInput.shape.affiliation, input.experience_id ? { type: "experience", id: input.experience_id } : { type: "education", id: input.education_id }) as chats.StartAffiliation)
        : null
      const { writingChatId } = affiliation ? await chats.startWritingChatWithAffiliation(supabase, startInput, affiliation) : await chats.startWritingChat(supabase, startInput)
      return requireChatDetail(supabase, writingChatId)
    },
  )
}

async function mockStartWritingChat(input: StartWritingChatArgs): Promise<WritingChatDetail> {
  const db = await mockRequest()
  const key = activeKey(db)
  if (!key) throw new WritingChatLockedError()
  // key marked invalid → C-20 key_invalid (nothing created). Starting only inserts the fixed
  // greeting (no AI call), so consent is asked before the first turn instead [UI-가정].
  if (key.status === "invalid") throw MockAiError.refuse("key_invalid")
  const now = new Date().toISOString()
  const chat: WritingChat = {
    id: newId(),
    user_id: USER_ID,
    created_at: now,
    updated_at: now,
    mode: input.mode,
    project_id: input.project_id ?? null,
    experience_id: input.experience_id ?? null,
    education_id: input.education_id ?? null,
    status: "active",
    structured_draft: { schema_version: 1, project: {}, details: [], skills: [], clarifications: [], sensitive_flags_count: 0 },
    // v4.2 A5: the fixed greeting is not counted (message_count starts at 0)
    message_count: 0,
    last_activity_at: now,
    saved_at: null,
    return_target: input.return_target ? { ...input.return_target, created_at: now } : null,
    last_extracted_sequence: 0,
  }
  db.writing_chats.push(chat)
  db.writing_chat_messages.push({
    id: newId(),
    user_id: USER_ID,
    created_at: now,
    updated_at: now,
    writing_chat_id: chat.id,
    sequence: 1,
    role: "assistant",
    content: GREETING[input.mode],
    status: "done",
    ai_job_id: null,
    ...mockMessageMeta(null),
    // [UI-가정] (A2 request 4): the greeting keeps the key tier at start, so S-36 can decide the
    // 무료 등급 line from the row instead of the current tier. Not an AI output (ai_job_id null).
    connection_tier: key.connection_tier,
  })
  return clone(detail(db, chat))
}

/**
 * RPC append_writing_chat_message (상한 검사 + message_count 증가).
 * The cap counts the AI reply too, so a message is refused when the reply would not fit (A2 UQ-77).
 */
async function appendWritingChatMessage(chatId: string, content: string): Promise<WritingChatMessage> {
  const db = await mockRequest()
  const chat = db.writing_chats.find((c) => c.id === chatId)
  if (!chat || chat.status !== "active") throw new Error("chat not active")
  if (!canSendWritingChatMessage(chat.message_count)) throw new Error("message limit")
  const now = new Date().toISOString()
  const sequence = db.writing_chat_messages.filter((m) => m.writing_chat_id === chatId).length + 1
  const message: WritingChatMessage = {
    id: newId(),
    user_id: USER_ID,
    created_at: now,
    updated_at: now,
    writing_chat_id: chatId,
    sequence,
    role: "user",
    content,
    status: "done",
    ai_job_id: null,
    ...mockMessageMeta(null),
  }
  db.writing_chat_messages.push(message)
  chat.message_count += 1
  chat.last_activity_at = now
  return clone(message)
}

/** Stores the assistant reply after a (mock) streamed turn. failed = 실패한 턴 (메시지 수 미증가 [가정]). */
async function completeMockAssistantTurn(
  chatId: string,
  content: string,
  failed = false,
  /** v4 (A2 request 9): the cause of a failed turn → stored on a writing_chat_turn ai_jobs row */
  errorCode: AiErrorCode | null = null,
  /** v5.3 (UQ-490): the stream error's retry_after / quota_resets_at, kept so a reload counts down the same */
  timing?: { retry_after?: string | null; quota_resets_at?: string | null },
): Promise<WritingChatMessage> {
  const db = await mockRequest()
  const chat = db.writing_chats.find((c) => c.id === chatId)
  if (!chat) throw new Error("not found")
  // UQ-488: no turns on abandoned / saved / handed_off chats (the real RPC refuses)
  if (chat.status !== "active") throw new Error("chat not active")
  const now = new Date().toISOString()
  const sequence = db.writing_chat_messages.filter((m) => m.writing_chat_id === chatId).length + 1
  const message: WritingChatMessage = {
    id: newId(),
    user_id: USER_ID,
    created_at: now,
    updated_at: now,
    writing_chat_id: chatId,
    sequence,
    role: "assistant",
    content: failed ? "" : content,
    status: failed ? "failed" : "done",
    ai_job_id: newId(),
    ...mockMessageMeta(activeKey(db) ? { provider: activeKey(db)!.provider, connection_tier: activeKey(db)!.connection_tier } : null),
  }
  db.writing_chat_messages.push(message)
  const code: AiErrorCode = errorCode ?? "provider_unavailable"
  if (failed && code !== "canceled") {
    // mock ai_jobs row for the failed turn so S-36 can show the real C-20 cause after reload
    const k = activeKey(db)
    db.ai_jobs.push({
      id: message.ai_job_id!,
      user_id: USER_ID,
      created_at: now,
      updated_at: now,
      job_type: "writing_chat_turn",
      application_project_id: null,
      target_type: "writing_chat",
      target_id: chatId,
      status: "failed",
      progress: null,
      params: null,
      provider: message.provider ?? k?.provider ?? "gemini",
      model_tier: message.model_tier ?? "default",
      connection_tier: message.connection_tier ?? k?.connection_tier ?? null,
      retry_count: 0,
      next_run_at: null,
      retry_wait_total_ms: 0,
      error_code: code,
      error_category: errorCategoryOf(code),
      failure_cause: failureCauseOf(code),
      ...failureTimestamps(code),
      ...(timing?.retry_after !== undefined ? { retry_after: timing.retry_after } : {}),
      ...(timing?.quota_resets_at !== undefined ? { quota_resets_at: timing.quota_resets_at } : {}),
      input_hash: null,
      prompt_version: "mock.v1",
      model: message.model,
      usage: null,
      output: null,
      step_outputs: {},
      run_generation: 1,
      heartbeat_at: now,
      cancel_requested_at: null,
      started_at: now,
      finished_at: now,
    })
  }
  if (!failed) chat.message_count += 1
  chat.last_activity_at = now
  // C-13 usage meter row for this turn (failed turns too). No reserve/charge (D-34).
  const key = activeKey(db)
  if (key)
    recordMockUsage(db, {
      job_type: "writing_chat_turn",
      ai_job_id: message.ai_job_id,
      application_project_id: null,
      provider: key.provider,
      connection_tier: key.connection_tier,
      outcome: failed ? "failed" : "succeeded",
      error_code: failed ? code : null,
    })
  return clone(message)
}

/** Path into structured_draft, e.g. "project.name" or "details.0.fields.action" */
export type StructuredDraftPath = string

function getField(draft: StructuredDraft, path: StructuredDraftPath): StructuredField<unknown> | undefined {
  let cur: unknown = draft
  for (const key of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur as StructuredField<unknown> | undefined
}

/**
 * RPC apply_structured_draft_patch — user session side: edit (→ origin user_edit),
 * accept (needs_review → accepted), reject (value null + review ok).
 */
export async function applyStructuredDraftPatch(chatId: string, patch: DraftPatchArgs): Promise<StructuredDraft> {
  return previewOr(() => mockApplyStructuredDraftPatch(chatId, patch), () => realApplyStructuredDraftPatch(chatId, patch))
}

type DraftPatchArgs = { path: StructuredDraftPath; action: "edit"; value: string | number | null } | { path: StructuredDraftPath; action: "accept" | "reject" }

/** The screen's index path → the RPC's stable address. Null when the card or item isn't in the draft. */
export function toDraftFieldPath(draft: StructuredDraft, path: StructuredDraftPath): DraftFieldPath | null {
  const [section, a, b, c, d] = path.split(".")
  if (section === "project" && a) return { section: "project", field: a } as DraftFieldPath
  if (section !== "details") return null
  const card = draft.details?.[Number(a)]
  if (!card) return null
  if (b === "fields" && c) {
    const ref = card.existing_detail_id ? { existingDetailId: card.existing_detail_id } : { detailKey: card.detail_key }
    return { section: "detail", detail: ref, field: c } as DraftFieldPath
  }
  if (b === "achievements" && c && d) {
    const key = (card.achievements[Number(c)] as { achievement_key?: string | null } | undefined)?.achievement_key
    return key ? ({ section: "achievement", achievementKey: key, field: d } as DraftFieldPath) : null
  }
  return null
}

function nextDetailKey(draft: StructuredDraft): string {
  const taken = (draft.details ?? []).map((x) => Number(x.detail_key?.slice(1) ?? 0))
  return `D${Math.max(0, ...taken) + 1}`
}

async function realApplyStructuredDraftPatch(chatId: string, patch: DraftPatchArgs): Promise<StructuredDraft> {
  const { supabase } = await requireConsentedUser()
  const chat = await requireChatDetail(supabase, chatId)
  const draft = chat.structured_draft
  const edit = async (path: unknown, value: string | number | null) =>
    (await chats.applyDraftEdit(supabase, parseInput(ApplyDraftEditInput, { writingChatId: chatId, path, value }))).structuredDraft as unknown as StructuredDraft
  const firstCardField = /^details\.0\.fields\.(\w+)$/.exec(patch.path)?.[1]
  // First edit of the first card, before the AI made one (the mock builds it on the fly). Augment: the same
  // existing detail the view shows (`buildChatView`), else a new card.
  if (patch.action === "edit" && firstCardField && !draft.details?.[0]) {
    const existingDetailId = chat.mode === "augment_project" && chat.project_id ? await loadFirstDraftDetailId(supabase, chat.project_id) : null
    if (existingDetailId) return edit({ section: "detail", detail: { existingDetailId }, field: firstCardField }, patch.value)
    const detailKey = nextDetailKey(draft)
    await chats.editDraftDetail(supabase, parseInput(EditDraftDetailInput, { writingChatId: chatId, action: "add", detailKey }))
    return edit({ section: "detail", detail: { detailKey }, field: firstCardField }, patch.value)
  }
  const path = toDraftFieldPath(draft, patch.path)
  if (!path) throw new AppError("not_found")
  if (patch.action === "edit") return edit(path, patch.value)
  const reviewed = await chats.reviewDraftField(supabase, parseInput(ReviewDraftFieldInput, { writingChatId: chatId, path }), patch.action)
  return reviewed.structuredDraft as unknown as StructuredDraft
}

async function mockApplyStructuredDraftPatch(chatId: string, patch: DraftPatchArgs): Promise<StructuredDraft> {
  const db = await mockRequest()
  const chat = db.writing_chats.find((c) => c.id === chatId)
  if (!chat || chat.status !== "active") throw new Error("chat not active")
  const now = new Date().toISOString()
  let field = getField(chat.structured_draft, patch.path)
  if (!field && patch.action === "edit") {
    // create the field object
    const keys = patch.path.split(".")
    let cur = chat.structured_draft as Record<string, unknown>
    for (const key of keys.slice(0, -1)) {
      cur[key] = (cur[key] as Record<string, unknown>) ?? {}
      cur = cur[key] as Record<string, unknown>
    }
    field = { value: null, origin: "user_edit", source_message_ids: [], source_quotes: [], review: "ok", reviewed_at: null }
    cur[keys[keys.length - 1]] = field
  }
  if (!field) throw new Error("field not found")
  if (patch.action === "edit") Object.assign(field, { value: patch.value, origin: "user_edit", review: "ok" })
  if (patch.action === "accept") Object.assign(field, { review: "accepted", reviewed_at: now })
  if (patch.action === "reject") Object.assign(field, { value: null, review: "ok", reviewed_at: now })
  chat.last_activity_at = now
  return clone(chat.structured_draft)
}

/** RPC set_writing_chat_affiliation ([연결] / [아니요] / 직접 고르기). Read-only for augment_project. */
export async function setWritingChatAffiliation(
  chatId: string,
  affiliation: { experience_id: string | null; education_id: string | null } | "dismiss_suggestion",
): Promise<WritingChat> {
  return previewOr(
    async () => {
      const db = await mockRequest()
      const chat = db.writing_chats.find((c) => c.id === chatId)
      if (!chat || chat.mode === "augment_project") throw new Error("affiliation read-only")
      if (affiliation !== "dismiss_suggestion") {
        chat.experience_id = affiliation.experience_id
        chat.education_id = affiliation.experience_id ? null : affiliation.education_id
      }
      chat.structured_draft.affiliation_suggestion = null
      return clone(chat)
    },
    async () => {
      const { supabase } = await requireConsentedUser()
      // QA-W5-07: Server Action input — anything but the two shapes is invalid_input
      if (affiliation !== "dismiss_suggestion" && (!affiliation || typeof affiliation !== "object")) throw new AppError("invalid_input")
      const target =
        affiliation === "dismiss_suggestion"
          ? { affiliation: { type: "none" }, clearSuggestionOnly: true }
          : {
              affiliation: affiliation.experience_id
                ? { type: "experience", id: affiliation.experience_id }
                : affiliation.education_id
                  ? { type: "education", id: affiliation.education_id }
                  : { type: "none" },
            }
      await chats.setWritingChatAffiliation(supabase, parseInput(SetAffiliationInput, { writingChatId: chatId, ...target }))
      const loaded = await loadWritingChatWithMessages(supabase, chatId)
      if (!loaded) throw new AppError("not_found", "요청한 대화를 찾을 수 없습니다.")
      return loaded.chat as unknown as WritingChat
    },
  )
}

/** Save-confirm dialog summary (S-36 저장) */
export interface WritingChatSaveSummary {
  project: { kind: "new" | "existing"; name: string | null }
  new_details: number
  filled_existing: Array<{ detail_id: string; title: string | null; filled: number }>
  achievements: number
  skills: number
  new_skills: number
  draft_items: string[]
  unreviewed: number
}

function countFields(draft: StructuredDraft, pred: (f: StructuredField<unknown>) => boolean): number {
  let n = 0
  for (const f of Object.values(draft.project ?? {})) if (f && pred(f as StructuredField<unknown>)) n += 1
  for (const d of draft.details ?? []) {
    for (const f of Object.values(d.fields)) if (f && pred(f as StructuredField<unknown>)) n += 1
    for (const a of d.achievements) for (const f of Object.values(a)) if (f && pred(f as StructuredField<unknown>)) n += 1
  }
  return n
}

export async function getWritingChatSaveSummary(chatId: string): Promise<WritingChatSaveSummary | null> {
  return previewOr(
    async () => {
      const db = await mockRequest()
      const chat = db.writing_chats.find((c) => c.id === chatId)
      return chat ? saveSummaryOf(db, chat, (name) => name.toLowerCase().replace(/\s+/g, "")) : null
    },
    async () => {
      const { supabase } = await requireConsentedUser()
      const db = (await loadCareerRows(supabase)) as unknown as Pick<MockDb, "projects" | "project_details" | "skills" | "writing_chats">
      const chat = db.writing_chats.find((c) => c.id === chatId)
      return chat ? saveSummaryOf(db, chat, normalizeSkillName) : null
    },
  )
}

function saveSummaryOf(
  db: Pick<MockDb, "projects" | "project_details" | "skills">,
  chat: WritingChat,
  normalize: (name: string) => string,
): WritingChatSaveSummary {
  const draft = chat.structured_draft
  const usable = (f?: StructuredField<unknown>) => Boolean(f && f.value !== null && f.value !== "" && f.review !== "needs_review")
  const existingProject = chat.project_id ? db.projects.find((p) => p.id === chat.project_id) : undefined
  const details = draft.details ?? []
  const draftItems: string[] = []
  for (const d of details.filter((x) => !x.existing_detail_id)) {
    const title = usable(d.fields.title) ? String(d.fields.title?.value) : null
    const complete = isDetailComplete({
      title,
      situation: usable(d.fields.situation) ? String(d.fields.situation?.value) : null,
      action: usable(d.fields.action) ? String(d.fields.action?.value) : null,
    })
    if (!complete) draftItems.push(`상세 내용 '${title ?? "제목 없음"}'`)
  }
  const skillNames = (draft.skills ?? []).map((s) => normalize(s.value))
  return {
    project: existingProject
      ? { kind: "existing", name: existingProject.name }
      : { kind: "new", name: usable(draft.project?.name) ? String(draft.project?.name?.value) : null },
    new_details: details.filter((d) => !d.existing_detail_id).length,
    filled_existing: details
      .filter((d) => d.existing_detail_id)
      .map((d) => ({
        detail_id: d.existing_detail_id as string,
        title: db.project_details.find((x) => x.id === d.existing_detail_id)?.title ?? null,
        filled: Object.values(d.fields).filter((f) => usable(f as StructuredField<unknown>)).length,
      })),
    achievements: details.reduce((n, d) => n + d.achievements.length, 0),
    skills: skillNames.length,
    new_skills: skillNames.filter((n) => !db.skills.some((s) => s.normalized_name === n)).length,
    draft_items: draftItems,
    unreviewed: countFields(draft, (f) => f.review === "needs_review"),
  }
}

/**
 * RPC save_writing_chat(writing_chat_id) / hand_off_writing_chat(writing_chat_id):
 * writes usable fields (review ok/accepted, value present) to career tables.
 * Mock: creates/updates the project + details; returns the project id.
 */
async function persistChat(chatId: string, finalStatus: "saved" | "handed_off", opts?: { fail?: boolean }): Promise<{ project_id: string }> {
  const db = await mockRequest(300)
  if (opts?.fail) throw new Error("save failed (mock)")
  const chat = db.writing_chats.find((c) => c.id === chatId)
  if (!chat) throw new Error("not found")
  const now = new Date().toISOString()
  const draft = chat.structured_draft
  const val = (f?: StructuredField<unknown>) =>
    f && f.review !== "needs_review" && f.value !== null && f.value !== "" ? f.value : null
  let projectId = chat.project_id
  if (!projectId) {
    projectId = newId()
    db.projects.push({
      id: projectId,
      user_id: USER_ID,
      created_at: now,
      updated_at: now,
      status: "draft",
      experience_id: chat.experience_id,
      education_id: chat.experience_id ? null : chat.education_id,
      name: (val(draft.project?.name) as string | null) ?? null,
      role: (val(draft.project?.role) as string | null) ?? null,
      summary: (val(draft.project?.summary) as string | null) ?? null,
      start_month: null,
      end_month: null,
      team_size: (val(draft.project?.team_size) as number | null) ?? null,
      source_writing_chat_id: chat.id,
    })
  }
  for (const d of draft.details ?? []) {
    let targetDetailId: string | null = null
    const fields = Object.fromEntries(Object.entries(d.fields).map(([k, f]) => [k, val(f as StructuredField<unknown>)]))
    if (d.existing_detail_id) {
      const existing = db.project_details.find((x) => x.id === d.existing_detail_id)
      if (!existing) continue
      for (const [key, value] of Object.entries(fields)) {
        const k = key as "title" | "situation" | "task" | "action" | "result" | "learnings"
        if (value !== null && !existing[k]) existing[k] = String(value)
      }
      existing.status = isDetailComplete(existing) ? "complete" : "draft"
      existing.updated_at = now
    } else {
      const sort = db.project_details.filter((x) => x.project_id === projectId).length + 1
      const row = {
        id: newId(),
        user_id: USER_ID,
        created_at: now,
        updated_at: now,
        project_id: projectId,
        status: "draft" as const,
        title: (fields.title as string | null) ?? null,
        situation: (fields.situation as string | null) ?? null,
        task: (fields.task as string | null) ?? null,
        action: (fields.action as string | null) ?? null,
        result: (fields.result as string | null) ?? null,
        learnings: (fields.learnings as string | null) ?? null,
        sort_order: sort,
        source_writing_chat_id: chat.id,
      }
      db.project_details.push({ ...row, status: isDetailComplete(row) ? "complete" : "draft" })
      targetDetailId = row.id
    }
    // 정량 성과 → achievements (A2 request 6). needs_review / empty fields are skipped.
    const detailId = d.existing_detail_id ?? targetDetailId
    for (const a of d.achievements) {
      if (!detailId) break
      const metric = val(a.metric_name) as string | null
      const before = val(a.value_before) as number | null
      const after = val(a.value_after) as number | null
      const unit = val(a.unit) as string | null
      if (metric === null && before === null && after === null) continue
      const achievement = {
        id: newId(),
        user_id: USER_ID,
        created_at: now,
        updated_at: now,
        status: "draft" as const,
        project_detail_id: detailId,
        experience_id: null,
        metric_name: metric,
        value_before: before,
        value_after: after,
        unit,
        description: null,
        kind: null,
        source_writing_chat_id: chat.id,
      }
      db.achievements.push({ ...achievement, status: isAchievementComplete(achievement) ? "complete" : "draft" })
    }
  }
  // 스킬 → skills (normalized_name로 기존 스킬에 연결) + project_skills
  for (const sk of draft.skills ?? []) {
    const name = sk.value.trim()
    if (!name) continue
    const normalized = name.toLowerCase().replace(/\s+/g, "")
    let skill = db.skills.find((x) => x.normalized_name === normalized)
    if (!skill) {
      skill = { id: newId(), user_id: USER_ID, created_at: now, updated_at: now, name, normalized_name: normalized, is_manual: false, proficiency: null }
      db.skills.push(skill)
    }
    const skillId = skill.id
    if (!db.project_skills.some((ps) => ps.project_id === projectId && ps.skill_id === skillId))
      db.project_skills.push({ project_id: projectId, skill_id: skillId, user_id: USER_ID, created_at: now })
  }
  const project = db.projects.find((p) => p.id === projectId)
  if (project) {
    const hasComplete = db.project_details.some((x) => x.project_id === projectId && x.status === "complete")
    project.status = project.name && project.role && hasComplete ? "complete" : "draft"
    project.updated_at = now
  }
  Object.assign(chat, { status: finalStatus, project_id: projectId, saved_at: finalStatus === "saved" ? now : chat.saved_at, last_activity_at: now })
  return { project_id: projectId }
}

export async function saveWritingChat(chatId: string, opts?: { fail?: boolean }): Promise<{ project_id: string }> {
  return previewOr(
    () => persistChat(chatId, "saved", opts),
    async () => {
      const { supabase } = await requireConsentedUser()
      return { project_id: (await chats.saveWritingChat(supabase, chatId)).projectId }
    },
  )
}

export async function handOffWritingChat(chatId: string, opts?: { fail?: boolean }): Promise<{ project_id: string }> {
  return previewOr(
    () => persistChat(chatId, "handed_off", opts),
    async () => {
      const { supabase } = await requireConsentedUser()
      return { project_id: (await chats.handOffWritingChat(supabase, chatId)).projectId }
    },
  )
}

/** 복귀 후 return_target 비우기 */
export async function clearReturnTarget(chatId: string): Promise<void> {
  return previewOr(
    async () => {
      const db = await mockRequest()
      const chat = db.writing_chats.find((c) => c.id === chatId)
      if (chat) chat.return_target = null
    },
    async () => {
      const { supabase } = await requireConsentedUser()
      await chats.clearReturnTarget(supabase, chatId)
    },
  )
}

/** 대화 그만두기 (`active → abandoned`). No AI call. Already saved / abandoned / gone: nothing to do, as in the mock. */
export async function abandonWritingChat(chatId: string): Promise<void> {
  return previewOr(
    async () => {
      const db = await mockRequest()
      const chat = db.writing_chats.find((c) => c.id === chatId)
      // UQ-487: status only — last_activity_at (S-08 마지막 활동, 90-day clock) is untouched
      if (chat && chat.status === "active") Object.assign(chat, { status: "abandoned", updated_at: new Date().toISOString() })
    },
    async () => {
      const { supabase } = await requireConsentedUser()
      try {
        await chats.abandonWritingChat(supabase, chatId)
      } catch (err) {
        if (!isAppError(err) || (err.code !== "writing_chat_not_active" && err.code !== "not_found")) throw err
      }
    },
  )
}

/**
 * 다시 이어 하기 (v4.2 A6, `abandoned → active`): no AI call, no usage, works without a key.
 * `last_activity_at = now()` [가정]; the message cap keeps counting. Returns null when the chat is
 * gone or not abandoned (saved / handed_off can't be reopened).
 */
export async function resumeWritingChat(chatId: string): Promise<WritingChatDetail | null> {
  return previewOr(
    async () => {
      const db = await mockRequest()
      const chat = db.writing_chats.find((c) => c.id === chatId)
      if (!chat || chat.status !== "abandoned") return null
      const now = new Date().toISOString()
      Object.assign(chat, { status: "active", last_activity_at: now, updated_at: now })
      return clone(detail(db, chat))
    },
    async () => {
      const { supabase } = await requireConsentedUser()
      try {
        await chats.resumeWritingChat(supabase, chatId)
      } catch (err) {
        if (isAppError(err) && (err.code === "writing_chat_not_resumable" || err.code === "not_found")) return null
        throw err
      }
      return loadChatDetail(supabase, chatId)
    },
  )
}

// ---------------------------------------------------------------------------
// AI turn. Four entry points used by S-36 (A2 UQ-78): plan / retry / complete / reject.
// Real path: the chat-turn Route Handler (SSE); these only gate and hand the screen the request.
// ---------------------------------------------------------------------------

export interface PlannedTurnView {
  reply: string
  patchPaths: string[]
  needsReview: string[]
  actorAmbiguous: string[]
  sensitive: number
  /** Real path: `useChatTurnStream().start` reads the SSE route when these are present. Absent in previews. */
  endpoint?: string
  body?: unknown
}

function turnView(plan: { reply: string; patchPaths: string[]; needsReview: string[]; actorAmbiguous: string[]; sensitive: number }): PlannedTurnView {
  return { reply: plan.reply, patchPaths: plan.patchPaths, needsReview: plan.needsReview, actorAmbiguous: plan.actorAmbiguous, sensitive: plan.sensitive }
}

/**
 * Path ④ gate + mock control `next_send_refusal` (UQ-493): forces the server-side refusal of the
 * next send / 다시 보내기 (key_missing — incl. the consent cause — or key_invalid), once.
 */
function sendGate(db: MockDb) {
  const forced = db.mock_controls.next_send_refusal
  if (forced) {
    db.mock_controls.next_send_refusal = null
    throw new MockAiError(forced)
  }
  assertAiRunnable(db, "request")
}

/**
 * The route answers these too, but as a failed stream after the screen has shown the message. Refusing
 * here keeps the screen's contract: `withAiGuard` → `{ rejected }`, nothing stored, the text stays in the box.
 */
async function assertTurnGate(supabase: UserSupabaseClient, userId: string): Promise<void> {
  const { lock } = await chats.readChatConnection(supabase, userId)
  if (lock) throw new AppError(lock, undefined, { status: 409 })
}

function realTurnView(endpoint: string, body: unknown): PlannedTurnView {
  return { reply: "", patchPaths: [], needsReview: [], actorAmbiguous: [], sensitive: 0, endpoint, body }
}

const TURN_ENDPOINT = (chatId: string) => `/api/writing-chats/${chatId}/turns`

/** The screen's slot → AI-12 `requested_slot` (이름·역할·제목 = 기본 정보). */
function toRequestedSlot(slot: ChatSlot | null, draft: StructuredDraft): RequestedSlot | null {
  if (!slot) return null
  if (slot === "name" || slot === "role" || slot === "title") return { slot: "basic_info", detailKey: null, existingDetailId: null }
  const card = isDetailSlot(slot) ? draft.details?.[0] : undefined
  return { slot, detailKey: card?.existing_detail_id ? null : (card?.detail_key ?? null), existingDetailId: card?.existing_detail_id ?? null }
}

export type SentWritingChatTurn = PlannedTurnView & { message: WritingChatMessage }

/** User turn: append the message (cap + usage reserve), then plan the AI turn. */
/**
 * A2 request 10 / UQ-320 rule: key checked first (key_missing / key_invalid) — on refusal the user
 * message is **not** appended. Real path: `message` is a stand-in for the row the route stores; the
 * screen re-reads the chat when the stream ends.
 */
export async function sendWritingChatTurn(chatId: string, content: string, requestedSlot: ChatSlot | null = null): Promise<SentWritingChatTurn> {
  return previewOr(
    async () => {
      // path ④ (04 §2.11.7): no key / consent → key_missing, invalid → key_invalid; message not saved
      sendGate(await mockRequest(0))
      const message = await appendWritingChatMessage(chatId, content)
      const plan = await planMockTurn(chatId, message.id, content, requestedSlot)
      return { message, ...turnView(plan) }
    },
    async () => {
      const { supabase, user } = await requireConsentedUser()
      await assertTurnGate(supabase, user.id)
      const chat = await requireChatDetail(supabase, chatId)
      if (chat.status !== "active") throw new AppError("writing_chat_not_active", "저장했거나 그만둔 대화예요. 새 대화를 시작해 주세요.", { status: 409 })
      if (!hasRoomForTurn(chat.message_count)) {
        throw new AppError("message_limit_reached", "대화가 길어져 더 보낼 수 없어요. 지금까지 내용을 저장하거나 폼으로 옮겨 이어서 써 주세요.", { status: 409 })
      }
      const now = new Date().toISOString()
      const message: WritingChatMessage = {
        id: randomUUID(),
        user_id: user.id,
        created_at: now,
        updated_at: now,
        writing_chat_id: chatId,
        sequence: (chat.messages[chat.messages.length - 1]?.sequence ?? 0) + 1,
        role: "user",
        content,
        status: "done",
        ai_job_id: null,
        provider: null,
        model: null,
        model_tier: null,
        connection_tier: null,
      }
      return { message, ...realTurnView(TURN_ENDPOINT(chatId), { content, requestedSlot: toRequestedSlot(requestedSlot, chat.structured_draft) }) }
    },
  )
}

/** 실패한 턴 다시 보내기: same plan (re-planned from the last user message if missing). */
export async function retryWritingChatTurn(chatId: string): Promise<PlannedTurnView | null> {
  return previewOr(
    async () => {
      const db = await mockRequest(0)
      sendGate(db)
      // UQ-488: only active chats take a turn
      if (db.writing_chats.find((c) => c.id === chatId)?.status !== "active") throw new Error("chat not active")
      const plan = await readPlannedTurn(chatId)
      return plan ? turnView(plan) : null
    },
    async () => {
      const { supabase, user } = await requireConsentedUser()
      await assertTurnGate(supabase, user.id)
      const chat = await requireChatDetail(supabase, chatId)
      if (chat.status !== "active") throw new AppError("writing_chat_not_active", "저장했거나 그만둔 대화예요. 새 대화를 시작해 주세요.", { status: 409 })
      const last = chat.messages[chat.messages.length - 1]
      if (!last || last.role !== "assistant" || last.status !== "failed") return null
      return realTurnView(`${TURN_ENDPOINT(chatId)}?retry=1`, {})
    },
  )
}

const CANCEL_SETTLE_TRIES = 6
const CANCEL_SETTLE_MS = 250

/** Stream finished (or failed): store the assistant message (+ usage meter row), apply the AI patch. */
export async function completeWritingChatTurn(
  chatId: string,
  failed: boolean,
  errorCode: AiErrorCode | null = null,
  timing?: { retry_after?: string | null; quota_resets_at?: string | null },
): Promise<void> {
  return previewOr(
    async () => {
      const plan = await readPlannedTurn(chatId)
      await completeMockAssistantTurn(chatId, plan?.reply ?? "", failed, errorCode, timing)
      if (!failed) await applyPlannedTurn(chatId)
    },
    async () => {
      // The route already stored everything. Only "중단" can get here first: the abort reaches the
      // route a moment later, so give the reply row a moment to leave `streaming` before the re-read.
      if (!failed) return
      const { supabase } = await requireConsentedUser()
      for (let i = 0; i < CANCEL_SETTLE_TRIES; i += 1) {
        const chat = await loadChatDetail(supabase, chatId)
        if (chat?.messages[chat.messages.length - 1]?.status !== "streaming") return
        await new Promise((resolve) => setTimeout(resolve, CANCEL_SETTLE_MS))
      }
    },
  )
}

/** After [거절(비우기)] the AI asks that slot again (AI-12). Real path: the emptied slot is what the next turn asks. */
export async function markWritingChatSlotAsked(chatId: string, slot: ChatSlot | null): Promise<void> {
  return previewOr(() => markAsked(chatId, slot), async () => {})
}
