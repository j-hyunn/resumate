/**
 * MOCK ONLY — fake AI-12 turn (extraction + reply) for S-36, server side.
 * Moved from components/career/writing-chat/mock-turn.ts (Phase 3, A2 UQ-78). The real
 * backend runs this inside the chat-turn Route Handler as `app_ai_writer`
 * (apply_structured_draft_patch with origin = 'ai'). Called only through
 * lib/data/writing-chats.ts (planWritingChatTurn / completeWritingChatTurn / …).
 *
 * Turn memory (asked slot, skipped slots, pending plan) lives in the mock store
 * (`db.mock_chat_turns`), so it resets with the fixtures. If a pending plan is missing
 * (e.g. after a server restart), retry re-plans from the last user message.
 *
 * Rules mirrored from AI-12: only user utterances are sources, user_edit / accepted fields
 * are never overwritten, "잘 모르겠어요"/"건너뛸게요" leave the field empty, sensitive
 * content is not copied (sensitive_flags_count++), team/self ambiguity → actor_ambiguous.
 */
import type { StructuredDraft, StructuredDraftDetail, StructuredField, WritingChat } from "@/types/db"
import { mockRequest } from "./store"
import type { MockDb } from "./fixtures"
import { computeReadiness } from "@/lib/data/readiness"
import { isDetailComplete } from "@/lib/data/career"
import { isDetailSlot, nextOpenSlot, SLOT_LABELS, slotField, slotPath, type ChatSlot } from "@/lib/data/writing-chat-slots"

export type { ChatSlot } from "@/lib/data/writing-chat-slots"

interface PatchOp {
  slot: ChatSlot
  value: string
  quote: string
  review: "ok" | "needs_review"
}

export interface PlannedTurn {
  reply: string
  userMessageId: string
  ops: PatchOp[]
  skills: string[]
  affiliationSuggestion: { type: "experience" | "education"; id: string } | null
  actorAmbiguous: string[]
  resolveAmbiguous: boolean
  sensitive: number
  skip: ChatSlot | null
  asked: ChatSlot | null
  patchPaths: string[]
  needsReview: string[]
}

export interface ChatMemory {
  asked: ChatSlot | null
  skipped: ChatSlot[]
  pending: PlannedTurn | null
}

function memoryIn(db: MockDb, chatId: string): ChatMemory {
  let m = db.mock_chat_turns[chatId]
  if (!m) {
    m = { asked: null, skipped: [], pending: null }
    db.mock_chat_turns[chatId] = m
  }
  return m
}

const SKILL_WORDS = ["Java", "Spring Boot", "Spring", "Kotlin", "MySQL", "PostgreSQL", "Redis", "AWS", "Kafka", "React", "TypeScript", "Python", "Go", "Docker", "Kubernetes"]
const SENSITIVE = /건강|병원|진단|종교|노조|주민번호/
const SUMMARIZE_AT = 160

const QUESTIONS: Record<ChatSlot, string> = {
  name: "어떤 프로젝트였는지 이름을 붙여 주세요.",
  role: "그 프로젝트에서 본인은 어떤 역할을 맡았나요?",
  title: "이 프로젝트에서 정리하고 싶은 에피소드 하나를 한 줄 제목으로 붙인다면 무엇일까요?",
  situation: "그때 어떤 배경이나 문제 상황이 있었나요? 팀 구성도 함께 알려 주세요.",
  task: "본인이 맡은 목표나 책임은 무엇이었나요?",
  action: "그 목표를 위해 본인이 직접 한 일은 무엇인가요?",
  result: "그 결과 무엇이 달라졌나요? 숫자로 말할 수 있는 변화가 있으면 함께 알려 주세요.",
  learnings: "이 경험에서 얻은 교훈이나 배운 점이 있다면 본인 말로 알려 주세요.",
}

function existingDetail(db: MockDb, chat: WritingChat) {
  const id = chat.structured_draft.details?.[0]?.existing_detail_id
  return id ? (db.project_details.find((d) => d.id === id) ?? null) : null
}

/** augment mode: the draft detail targets the first incomplete existing detail, else a new one */
function ensureDetail(db: MockDb, chat: WritingChat): StructuredDraftDetail {
  const draft = chat.structured_draft
  draft.details = draft.details ?? []
  if (!draft.details[0]) {
    const target =
      chat.mode === "augment_project" && chat.project_id
        ? db.project_details
            .filter((d) => d.project_id === chat.project_id && d.status === "draft")
            .sort((a, b) => a.sort_order - b.sort_order)[0]
        : undefined
    draft.details.push({ detail_key: "D1", existing_detail_id: target?.id ?? null, fields: {}, achievements: [] })
  }
  return draft.details[0]
}

function firstClause(text: string, max: number): string {
  const clause = text.split(/[.!?\n]|(?:이에요|예요|입니다)/)[0]?.trim() ?? text
  return clause.length > max ? `${clause.slice(0, max).trim()}…` : clause
}

function summarize(text: string): string {
  const sentences = text.split(/(?<=[.!?다요])\s+/).filter(Boolean)
  return sentences.slice(0, 2).join(" ")
}

function valueFor(slot: ChatSlot, text: string): { value: string; review: "ok" | "needs_review" } {
  if (slot === "name") return { value: firstClause(text, 40), review: "ok" }
  if (slot === "title") return { value: firstClause(text, 60), review: "ok" }
  if (slot === "role") return { value: firstClause(text, 60), review: "ok" }
  // long answers are condensed → V-9e "표현이 원래 말과 달라요" (needs_review)
  if (text.length > SUMMARIZE_AT) return { value: summarize(text), review: "needs_review" }
  return { value: text.trim(), review: "ok" }
}

function locked(f?: StructuredField<unknown>): boolean {
  return Boolean(f && (f.origin === "user_edit" || f.review === "accepted"))
}

/** Projected readiness if the current draft were saved (AI 명세 AI-12 ready_to_return) */
export function projectedReady(db: MockDb, chat: WritingChat): boolean {
  const readiness = computeReadiness(db)
  const key = chat.return_target ? (chat.return_target.feature === "job_interview" ? "job_interview" : chat.return_target.feature === "insight" ? "insight" : "draft") : "insight"
  const f = readiness.features[key]
  if (f.ready) return true
  if (f.missing?.includes("complete_experience")) return false
  const draft = chat.structured_draft
  const usable = (field?: StructuredField<unknown>) =>
    field && field.review !== "needs_review" && field.value !== null && field.value !== "" ? String(field.value) : null
  const project = chat.project_id ? db.projects.find((p) => p.id === chat.project_id) : undefined
  const name = project?.name ?? usable(draft.project?.name)
  const role = project?.role ?? usable(draft.project?.role)
  const d = draft.details?.[0]
  const existing = existingDetail(db, chat)
  const detailOk = d
    ? isDetailComplete({
        title: existing?.title ?? usable(d.fields.title),
        situation: existing?.situation ?? usable(d.fields.situation),
        action: existing?.action ?? usable(d.fields.action),
      })
    : false
  const parentExp = project?.experience_id ?? chat.experience_id
  const parentEdu = project?.education_id ?? chat.education_id
  const parentOk = parentExp
    ? db.experiences.some((e) => e.id === parentExp && e.status === "complete")
    : parentEdu
      ? db.educations.some((e) => e.id === parentEdu && e.status === "complete")
      : true
  return Boolean(name && role && detailOk && parentOk)
}

const FEATURE_LABEL = { insight: "인사이트", career_description: "경력기술서", cover_letter: "자기소개서", job_interview: "직무 면접" } as const

export async function planMockTurn(
  chatId: string,
  userMessageId: string,
  content: string,
  requestedSlot: ChatSlot | null,
): Promise<PlannedTurn> {
  const db = await mockRequest(0)
  const chat = db.writing_chats.find((c) => c.id === chatId)
  if (!chat) throw new Error("not found")
  const mem = memoryIn(db, chatId)
  const draft = chat.structured_draft
  ensureDetail(db, chat)
  const existing = existingDetail(db, chat)
  const gate = Boolean(chat.return_target)
  const text = content.trim()
  const plan: PlannedTurn = {
    reply: "",
    userMessageId,
    ops: [],
    skills: [],
    affiliationSuggestion: null,
    actorAmbiguous: [],
    resolveAmbiguous: false,
    sensitive: 0,
    skip: null,
    asked: null,
    patchPaths: [],
    needsReview: [],
  }
  const asked = mem.asked ?? nextOpenSlot(draft, chat.mode, existing, mem.skipped, gate)

  if (requestedSlot) {
    const filled = isDetailSlot(requestedSlot) && existing?.[requestedSlot] ? true : Boolean(slotField(draft, requestedSlot)?.value)
    plan.asked = requestedSlot
    plan.reply = filled ? `${SLOT_LABELS[requestedSlot]}에 보강할 내용이 있나요?` : QUESTIONS[requestedSlot]
  } else if (/^(잘 모르겠어요|건너뛸게요)$/.test(text)) {
    plan.skip = asked
    const next = nextOpenSlot(draft, chat.mode, existing, [...mem.skipped, ...(asked ? [asked] : [])], gate)
    plan.asked = next
    plan.reply = next ? `괜찮아요. 그 부분은 비워 둘게요. ${QUESTIONS[next]}` : "괜찮아요. 그 부분은 비워 둘게요. 정리 결과를 확인하고 저장해 주세요."
  } else if (SENSITIVE.test(text)) {
    plan.sensitive = 1
    plan.asked = asked
    plan.reply = `그 부분은 정리 결과에 옮기지 않을게요. ${asked ? QUESTIONS[asked] : ""}`.trim()
  } else {
    const slot = asked
    const detail = draft.details?.[0]
    const ambiguousOpen = draft.clarifications?.some((c) => c.kind === "actor_ambiguous" && c.field === "action") ?? false
    if (slot && !(isDetailSlot(slot) && existing?.[slot]) && !locked(slotField(draft, slot))) {
      const v = valueFor(slot, text)
      plan.ops.push({ slot, value: v.value, quote: text.slice(0, 60), review: v.review })
      plan.patchPaths.push(slotPath(slot))
      if (v.review === "needs_review") plan.needsReview.push(slotPath(slot))
    }
    if (slot === "action") {
      const teamOnly = /우리|팀/.test(text) && !/저는|제가|내가/.test(text)
      if (teamOnly) plan.actorAmbiguous.push(slotPath("action"))
      else if (ambiguousOpen) plan.resolveAmbiguous = true
    }
    for (const word of SKILL_WORDS) {
      if (text.toLowerCase().includes(word.toLowerCase()) && !(draft.skills ?? []).some((s) => s.value === word)) plan.skills.push(word)
    }
    if (chat.mode === "new_project" && !chat.experience_id && !chat.education_id && !draft.affiliation_suggestion) {
      const exp = db.experiences.find((e) => e.company_name && text.includes(e.company_name))
      const edu = db.educations.find((e) => e.institution_name && text.includes(e.institution_name))
      if (exp) plan.affiliationSuggestion = { type: "experience", id: exp.id }
      else if (edu) plan.affiliationSuggestion = { type: "education", id: edu.id }
    }
    void detail
    if (plan.actorAmbiguous.length > 0) {
      plan.asked = "action"
      plan.reply = "그중 본인이 직접 한 부분은 무엇인가요? 팀이 함께 한 일과 나눠서 알려 주세요."
    } else {
      // simulate the patch to find the next question
      const simulated: StructuredDraft = structuredClone(draft)
      for (const op of plan.ops) setField(simulated, op.slot, op)
      const next = nextOpenSlot(simulated, chat.mode, existing, mem.skipped, gate)
      plan.asked = next
      const ack = "알려 주셔서 고마워요."
      plan.reply = next ? `${ack} ${QUESTIONS[next]}` : `${ack} 필요한 내용이 모두 정리됐어요. 오른쪽 정리 결과를 확인하고 저장해 주세요.`
      if (chat.return_target) {
        const simChat = { ...chat, structured_draft: simulated }
        if (projectedReady(db, simChat)) plan.reply += ` 이제 저장하면 ${FEATURE_LABEL[chat.return_target.feature]}${FEATURE_LABEL[chat.return_target.feature] === "인사이트" ? "로" : "으로"} 돌아갈 수 있어요.`
      }
    }
  }
  mem.pending = plan
  return plan
}

function setField(draft: StructuredDraft, slot: ChatSlot, op: { value: string; quote: string; review: "ok" | "needs_review" }, messageId = "") {
  const field: StructuredField = {
    value: op.value,
    origin: "ai",
    source_message_ids: messageId ? [messageId] : [],
    source_quotes: [op.quote],
    review: op.review,
    reviewed_at: null,
  }
  if (isDetailSlot(slot)) {
    draft.details = draft.details ?? []
    if (!draft.details[0]) draft.details.push({ detail_key: "D1", existing_detail_id: null, fields: {}, achievements: [] })
    draft.details[0].fields[slot] = field
  } else {
    draft.project = draft.project ?? {}
    draft.project[slot] = field
  }
}

/**
 * Pending plan for the chat. Falls back to re-planning from the last user message when the
 * plan is gone (server restart / fixtures reset) so "다시 보내기" still works.
 */
export async function readPlannedTurn(chatId: string): Promise<PlannedTurn | null> {
  const db = await mockRequest(0)
  const pending = memoryIn(db, chatId).pending
  if (pending) return pending
  const last = db.writing_chat_messages
    .filter((x) => x.writing_chat_id === chatId)
    .sort((a, b) => b.sequence - a.sequence)[0]
  if (!last || last.role !== "user") return null
  return planMockTurn(chatId, last.id, last.content, null)
}

/** Apply the pending plan after the reply stream finished (draft_patch / draft_flags). */
export async function applyPlannedTurn(chatId: string): Promise<void> {
  const db = await mockRequest(0)
  const chat = db.writing_chats.find((c) => c.id === chatId)
  const mem = memoryIn(db, chatId)
  const plan = mem.pending
  if (!chat || !plan) return
  const draft = chat.structured_draft
  for (const op of plan.ops) {
    if (locked(slotField(draft, op.slot))) continue // AI never overwrites user_edit / accepted
    setField(draft, op.slot, op, plan.userMessageId)
  }
  // 정량 성과: "A에서 B로" pattern in a result answer
  const resultOp = plan.ops.find((o) => o.slot === "result")
  if (resultOp) {
    const m = resultOp.value.match(/(\d+(?:\.\d+)?)\s*([^\s\d]*)에서\s*(\d+(?:\.\d+)?)\s*([^\s\d]*?)(?:로|으로)/)
    const detail = draft.details?.[0]
    if (m && detail) {
      const src = { origin: "ai" as const, source_message_ids: [plan.userMessageId], source_quotes: [m[0]], review: "ok" as const, reviewed_at: null }
      detail.achievements.push({
        metric_name: { ...src, value: m[0] },
        value_before: { ...src, value: Number(m[1]) },
        value_after: { ...src, value: Number(m[3]) },
        unit: { ...src, value: m[4] || m[2] || null },
      })
    }
  }
  for (const word of plan.skills) {
    draft.skills = draft.skills ?? []
    draft.skills.push({ value: word, source_message_ids: [plan.userMessageId], source_quotes: [word] })
  }
  if (plan.affiliationSuggestion) draft.affiliation_suggestion = { ...plan.affiliationSuggestion, source_message_ids: [plan.userMessageId] }
  draft.clarifications = draft.clarifications ?? []
  if (plan.actorAmbiguous.length > 0 && !draft.clarifications.some((c) => c.field === "action"))
    draft.clarifications.push({ kind: "actor_ambiguous", field: "action", detail_key: draft.details?.[0]?.detail_key ?? "D1" })
  if (plan.resolveAmbiguous) draft.clarifications = draft.clarifications.filter((c) => c.field !== "action")
  if (plan.sensitive) draft.sensitive_flags_count = (draft.sensitive_flags_count ?? 0) + plan.sensitive
  if (plan.skip && !mem.skipped.includes(plan.skip)) mem.skipped.push(plan.skip)
  mem.asked = plan.asked
  mem.pending = null
  chat.updated_at = new Date().toISOString()
}

/** After [거절(비우기)] the AI asks that slot again (AI-12: 빈 필드가 되므로 다시 질문). */
export async function markAsked(chatId: string, slot: ChatSlot | null): Promise<void> {
  const db = await mockRequest(0)
  if (slot) memoryIn(db, chatId).asked = slot
}

/** Current question slot (for the progress step highlight). */
export function askedSlot(db: MockDb, chatId: string): { asked: ChatSlot | null; skipped: ChatSlot[] } {
  const m = memoryIn(db, chatId)
  return { asked: m.asked, skipped: [...m.skipped] }
}
