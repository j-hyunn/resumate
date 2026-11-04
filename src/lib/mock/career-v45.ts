/**
 * v4.5 mock for S-10 / S-44 (DM v4.5 2.5 · 2.5.0 · 2.5.1) — server only, previews only.
 *
 * The v4.3b mock store has no v4.5 rows (affiliated STAR on `projects`, deliverables, deliverable chats,
 * `rev`), so this module keeps its own rows on globalThis, seeded from the store's experiences /
 * educations / projects / project_details. Every exported function reads the store, so the data layer
 * calls them only inside the preview branch of `previewOr` (mock-isolation.test.ts).
 */
import { connection } from "next/server"
import { educationDisplayName as displayName } from "@/server/services/career/education-name"
import type {
  CareerItemStatus,
  DeliverableFact,
  DeliverableStructuredDraft,
  DraftStarFieldObject,
  ProjectStructuredDraft,
} from "@/types/db"
import {
  PAGE_LIMITS,
  deliverableGreeting,
  guessWritingKind,
  projectGreeting,
  type AppliedDeliverableProposal,
  type AppliedProjectProposal,
  type DeliverableChatView,
  type DeliverableFormSnapshot,
  type ProjectChatView,
  type ProjectFormSnapshot,
  type ProjectPageValues,
  type WritingChatMessageView,
  type WritingChatView,
} from "@/lib/data/career-v45-shared"
import { DELIVERABLE_SLOTS_BY_KIND, WRITING_KIND_LABELS } from "@/lib/data/labels"
import { getMockDb } from "./store"
import { daysAgo, nowIso } from "./time"

// ---------------------------------------------------------------------------
// rows
// ---------------------------------------------------------------------------

export interface MockV45Project {
  id: string
  values: ProjectPageValues
  status: CareerItemStatus
  updated_at: string
  source_writing_chat_id: string | null
}

export interface MockV45Deliverable {
  id: string
  project_id: string
  title: string
  body: string
  sort_order: number
  updated_at: string
}

interface MockV45Db {
  seeded: boolean
  projects: Map<string, MockV45Project>
  deliverables: Map<string, MockV45Deliverable>
  chats: Map<string, WritingChatView>
}

const KEY = "__resumateMockV45" as const
type G = typeof globalThis & { [KEY]?: MockV45Db }

function uid(table: string, n: number): string {
  return `00000000-0000-4${table}-8000-${String(n).padStart(12, "0")}`
}
export const V45_IDS = {
  dlv: (n: number) => uid("e07", n),
  chat: (n: number) => uid("c03", n),
  msg: (n: number) => uid("c04", n),
}

/** Standalone project the S-44 fixtures hang off (store prj(6) "오픈소스 결제 SDK 기여"). */
const STANDALONE_PROJECT = "00000000-0000-4e03-8000-000000000006"
const AFFILIATED_PROJECT = "00000000-0000-4e03-8000-000000000001"

async function db(): Promise<MockV45Db> {
  await connection()
  await new Promise((r) => setTimeout(r, 120))
  const g = globalThis as G
  if (!g[KEY]) g[KEY] = { seeded: false, projects: new Map(), deliverables: new Map(), chats: new Map() }
  const v = g[KEY]
  if (!v.seeded) seed(v)
  return v
}

/** Store lookups (names, affiliations). */
function store() {
  return getMockDb()
}

function seed(v: MockV45Db): void {
  v.seeded = true
  const s = store()
  for (const p of s.projects) {
    if (!p.experience_id && !p.education_id) continue
    const detail = s.project_details.filter((d) => d.project_id === p.id).sort((a, b) => a.sort_order - b.sort_order)[0]
    v.projects.set(p.id, {
      id: p.id,
      status: p.status,
      updated_at: p.updated_at,
      source_writing_chat_id: null,
      values: {
        name: p.name ?? "",
        experience_id: p.experience_id,
        education_id: p.education_id,
        start_month: p.start_month,
        end_month: p.end_month,
        is_current: p.is_current ?? false,
        project_type: p.id === AFFILIATED_PROJECT ? "improvement" : null,
        experience_type: null,
        competencies: [],
        situation: detail?.situation ?? null,
        task: detail?.task ?? null,
        action: detail?.action ?? null,
        result: p.id === AFFILIATED_PROJECT ? null : detail?.result ?? null,
        learnings: p.id === AFFILIATED_PROJECT ? null : detail?.learnings ?? null,
      },
    })
  }
  v.deliverables.set(V45_IDS.dlv(1), {
    id: V45_IDS.dlv(1),
    project_id: STANDALONE_PROJECT,
    title: "결제 SDK 기여 회고",
    body: "",
    sort_order: 1,
    updated_at: daysAgo(3),
  })
  v.deliverables.set(V45_IDS.dlv(2), {
    id: V45_IDS.dlv(2),
    project_id: STANDALONE_PROJECT,
    title: "재시도 모듈 설계 문서",
    body: "## 해결할 문제\n\n결제 승인 요청이 네트워크 오류로 실패하면 SDK 사용자가 직접 재시도를 구현해야 했다.\n\n## 구조\n\n- 재시도 정책(지수 백오프)\n- 멱등 키 생성기",
    sort_order: 2,
    updated_at: daysAgo(10),
  })
  // S-10 chats: one active with proposals, one closed (40 messages)
  v.chats.set(V45_IDS.chat(1), projectChatFixture(V45_IDS.chat(1), AFFILIATED_PROJECT, "active"))
  v.chats.set(V45_IDS.chat(2), projectChatFixture(V45_IDS.chat(2), AFFILIATED_PROJECT, "closed"))
  // S-44 chat on dlv(1): facts, no draft yet
  v.chats.set(V45_IDS.chat(3), deliverableChatFixture(V45_IDS.chat(3), V45_IDS.dlv(1)))
}

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

let msgSeq = 1000
export function mockMessage(role: "user" | "assistant", content: string, sequence: number, userNumber: number | null, opts?: { greeting?: boolean; created_at?: string }): WritingChatMessageView {
  msgSeq += 1
  return {
    id: V45_IDS.msg(msgSeq),
    sequence,
    role,
    content,
    status: "done",
    provider: role === "assistant" && !opts?.greeting ? "gemini" : null,
    created_at: opts?.created_at ?? nowIso(),
    user_number: userNumber,
    is_greeting: opts?.greeting ?? false,
  }
}

function star(value: string, msgId: string, quote: string, extra?: Partial<DraftStarFieldObject>): DraftStarFieldObject {
  return { value, op: "set", origin: "ai", source_message_ids: [msgId], source_quotes: [quote], review: "ok", reviewed_at: null, applied_at: null, rev: 1, ...extra }
}

export function emptyProjectDraft(): ProjectStructuredDraft {
  return { schema_version: 3, project: {}, star: {}, classification: {}, clarifications: [], sensitive_flags_count: 0 }
}

export function emptyDeliverableDraft(kind: DeliverableStructuredDraft["writing_kind"] = null): DeliverableStructuredDraft {
  return { schema_version: 1, target: "project_deliverable", writing_kind: kind, facts: [], deliverable: {}, clarifications: [], sensitive_flags_count: 0, draft_count: 0 }
}

function projectChatFixture(id: string, projectId: string, status: "active" | "closed"): ProjectChatView {
  const greeting = mockMessage("assistant", "'결제 승인 API 성능 개선'에서 비어 있는 결과/성과부터 여쭤볼게요. 결과는 어땠나요? 수치로 알고 있는 게 있다면 함께 말해 주세요\n회사 기밀이나 민감정보는 쓰지 말아 주세요.", 0, null, { greeting: true, created_at: daysAgo(2) })
  const u1 = mockMessage("user", "p95 응답 시간이 1.2초에서 0.7초로 줄었어요. 가맹점 문의도 거의 없어졌고요.", 1, 1, { created_at: daysAgo(2) })
  const a1 = mockMessage("assistant", "수치까지 알려 주셔서 정리하기 좋아요. 이 경험에서 배운 점이나 다음에 다르게 할 점이 있나요?", 2, null, { created_at: daysAgo(2) })
  const u2 = mockMessage("user", "추측 말고 측정부터 해야 한다는 걸 배웠어요. 그리고 캐시 무효화는 제가 직접 설계했어요.", 3, 2, { created_at: daysAgo(2) })
  const a2 = mockMessage("assistant", "좋아요. 캐시 무효화 설계를 기존 행동 내용과 합쳐 정리해 두었어요. 제안 카드에서 기존 내용과 비교해 보세요.", 4, null, { created_at: daysAgo(2) })
  const messages = [greeting, u1, a1, u2, a2]
  const draft: ProjectStructuredDraft = {
    ...emptyProjectDraft(),
    star: {
      result: star("p95 응답 시간이 1.2초에서 0.7초로 줄었고 가맹점 문의가 거의 사라짐.", u1.id, "p95 응답 시간이 1.2초에서 0.7초로 줄었어요"),
      learnings: star("성능 문제는 추측보다 측정에서 시작해야 한다는 것을 배움.", u2.id, "추측 말고 측정부터 해야 한다는 걸 배웠어요"),
      // RQ-5: 값이 있는 '행동'에 합친 제안(op "set") — 기존 폼 문장의 사실을 모두 남기고 새 내용을 합침
      action: star(
        "APM으로 병목 쿼리를 찾아 결제 승인 테이블 인덱스를 재설계하고, 가맹점 설정 조회에 Redis 캐시를 도입함. 캐시 무효화 규칙을 직접 설계함",
        u2.id,
        "캐시 무효화는 제가 직접 설계했어요",
      ),
    },
    classification: {
      experience_type: { value: "problem_solving", origin: "ai", source_message_ids: [u1.id], review: "ok", reviewed_at: null, applied_at: null, rev: 1, reason: "응답 지연 원인을 찾아 해결한 과정이 중심이에요" },
      competencies: { value: ["analysis", "execution"], origin: "ai", source_message_ids: [u2.id], review: "ok", reviewed_at: null, applied_at: null, rev: 1, reason: null },
    },
  }
  if (status === "closed") {
    for (let i = 5; i <= 40; i += 1) messages.push(mockMessage(i % 2 ? "user" : "assistant", i % 2 ? `추가 답변 ${i}` : `추가 질문 ${i}`, i, i % 2 ? Math.ceil(i / 2) : null, { created_at: daysAgo(5) }))
  }
  return {
    id,
    project_id: projectId,
    project_deliverable_id: null,
    title: status === "closed" ? "정산 배치 이야기를 먼저 해 볼게요" : "p95 응답 시간이 1.2초에서 0.7초로 줄었어",
    status,
    message_count: status === "closed" ? PAGE_LIMITS.messageLimit : 4,
    last_activity_at: status === "closed" ? daysAgo(5) : daysAgo(2),
    last_applied_at: null,
    return_target: null,
    structured_draft: draft,
    messages,
  }
}

function fact(id: number, slot: string, text: string, msgId: string, quote: string, extra?: Partial<DeliverableFact>): DeliverableFact {
  return { id: uid("c05", id), slot, text, actor: "self", source_message_ids: [msgId], source_quotes: [quote], review: "ok", reviewed_at: null, origin: "ai", ...extra }
}

function deliverableChatFixture(id: string, deliverableId: string): DeliverableChatView {
  const greeting = mockMessage("assistant", "'결제 SDK 기여 회고'을 회고로 정리해 볼게요. 이번에 무엇을 했는지, 범위부터 알려 주세요.\n회사 기밀, 민감정보, 다른 사람의 개인정보는 쓰지 말아 주세요.", 0, null, { greeting: true, created_at: daysAgo(1) })
  const u1 = mockMessage("user", "결제 SDK에 재시도 모듈을 넣는 작업이었어요. 지수 백오프 정책은 제가 직접 구현했어요.", 1, 1, { created_at: daysAgo(1) })
  const a1 = mockMessage("assistant", "좋아요. 잘된 점이나 아쉬웠던 점이 있었나요?", 2, null, { created_at: daysAgo(1) })
  const u2 = mockMessage("user", "리뷰어들이 멱등 키 설계를 좋게 봤어요. 우리 팀은 문서화가 늦었고요.", 3, 2, { created_at: daysAgo(1) })
  const a2 = mockMessage("assistant", "정리해 둘게요. 지금까지 내용으로 초안을 만들어 볼까요?", 4, null, { created_at: daysAgo(1) })
  return {
    id,
    project_id: STANDALONE_PROJECT,
    project_deliverable_id: deliverableId,
    title: "결제 SDK에 재시도 모듈을 넣는 작업이었어요",
    status: "active",
    message_count: 4,
    last_activity_at: daysAgo(1),
    last_applied_at: null,
    return_target: null,
    structured_draft: {
      ...emptyDeliverableDraft("retrospective"),
      facts: [
        fact(1, "scope", "결제 SDK에 재시도 모듈을 넣었다", u1.id, "결제 SDK에 재시도 모듈을 넣는 작업이었어요"),
        fact(2, "contribution", "지수 백오프 정책을 직접 구현했다", u1.id, "지수 백오프 정책은 제가 직접 구현했어요"),
        fact(3, "went_well", "리뷰어들이 멱등 키 설계를 좋게 평가했다", u2.id, "리뷰어들이 멱등 키 설계를 좋게 봤어요"),
        fact(4, "went_wrong", "팀의 문서화가 늦었다", u2.id, "우리 팀은 문서화가 늦었고요", { actor: "team" }),
      ],
    },
    messages: [greeting, u1, a1, u2, a2],
  }
}

// ---------------------------------------------------------------------------
// reads
// ---------------------------------------------------------------------------

export function previewStarDraft(chat: ProjectChatView, state: string | null): ProjectChatView {
  if (state !== "needs-review") return chat
  const d = structuredClone(chat.structured_draft)
  if (d.star.result) d.star.result = { ...d.star.result, review: "needs_review", review_reason: "content_unverified" }
  // V-9j: the merged 'action' proposal may have dropped part of the existing text
  if (d.star.action) d.star.action = { ...d.star.action, review: "needs_review", review_reason: "existing_missing" }
  return { ...chat, structured_draft: d }
}

/** 교육 이름 = 교육 명(program_name), 비면 운영 기관 — the one shared rule (ED-2, UQ-735). */
const educationDisplayName = (e: { program_name: string | null; institution_name: string | null }) =>
  displayName(e.program_name, e.institution_name)

export async function mockAffiliationName(type: "experience" | "education", id: string): Promise<string | null | undefined> {
  await db()
  const s = store()
  if (type === "experience") {
    const e = s.experiences.find((x) => x.id === id)
    return e ? e.company_name : undefined
  }
  const e = s.educations.find((x) => x.id === id)
  return e ? educationDisplayName(e) : undefined
}

export async function mockAffiliations(): Promise<Array<{ type: "experience" | "education"; id: string; name: string | null }>> {
  await db()
  const s = store()
  return [
    ...s.experiences.map((e) => ({ type: "experience" as const, id: e.id, name: e.company_name })),
    ...s.educations.map((e) => ({ type: "education" as const, id: e.id, name: educationDisplayName(e) })),
  ]
}

export async function mockProject(id: string): Promise<MockV45Project | "standalone" | null> {
  const v = await db()
  const row = v.projects.get(id)
  if (row) return structuredClone(row)
  const s = store().projects.find((p) => p.id === id)
  return s ? "standalone" : null
}

export async function mockStandaloneProject(id: string): Promise<{ id: string; name: string; count: number } | "affiliated" | null> {
  const v = await db()
  if (v.projects.has(id)) return "affiliated"
  const s = store().projects.find((p) => p.id === id)
  if (!s) return null
  const count = [...v.deliverables.values()].filter((d) => d.project_id === id).length
  return { id, name: s.name ?? "", count }
}

/** S-43 산출물 목록 (sort_order 순). 독립 프로젝트가 아니면 null. */
export async function mockProjectDeliverables(projectId: string): Promise<Array<{ id: string; title: string; sort_order: number }> | null> {
  const v = await db()
  if (v.projects.has(projectId)) return null
  if (!store().projects.some((p) => p.id === projectId)) return null
  return [...v.deliverables.values()]
    .filter((d) => d.project_id === projectId)
    .sort((x, y) => x.sort_order - y.sort_order)
    .map((d) => ({ id: d.id, title: d.title, sort_order: d.sort_order }))
}

export async function mockDeliverable(id: string): Promise<(MockV45Deliverable & { project_name: string }) | null> {
  const v = await db()
  const row = v.deliverables.get(id)
  if (!row) return null
  const parent = store().projects.find((p) => p.id === row.project_id)
  return { ...structuredClone(row), project_name: parent?.name ?? "" }
}

export async function mockChats(target: { project_id: string } | { project_deliverable_id: string }): Promise<WritingChatView[]> {
  const v = await db()
  return [...v.chats.values()]
    .filter((c) => ("project_deliverable_id" in target ? c.project_deliverable_id === target.project_deliverable_id : c.project_id === target.project_id && c.project_deliverable_id === null))
    .sort((a, b) => b.last_activity_at.localeCompare(a.last_activity_at))
    .map((c) => structuredClone(c))
}

export async function mockChat(id: string): Promise<WritingChatView | null> {
  const v = await db()
  const c = v.chats.get(id)
  return c ? structuredClone(c) : null
}

// ---------------------------------------------------------------------------
// writes (DM 2.5.1 판정 순서: not_found → already_applied → proposal_changed → needs_review)
// ---------------------------------------------------------------------------

export async function mockSaveProject(projectId: string | null, values: ProjectPageValues, applied: AppliedProjectProposal[]) {
  const v = await db()
  const id = projectId ?? crypto.randomUUID()
  const prev = v.projects.get(id)
  const complete = Boolean(values.name.trim() && values.situation?.trim() && values.action?.trim())
  const now = nowIso()
  const row: MockV45Project = { id, values: structuredClone(values), status: complete ? "complete" : "draft", updated_at: now, source_writing_chat_id: prev?.source_writing_chat_id ?? null }
  v.projects.set(id, row)
  const ok: Array<{ writing_chat_id: string; field: AppliedProjectProposal["field"] }> = []
  const skipped: Array<{ writing_chat_id: string; field: AppliedProjectProposal["field"]; reason: "not_found" | "already_applied" | "proposal_changed" | "needs_review" }> = []
  for (const a of applied) {
    const chat = v.chats.get(a.writing_chat_id)
    const draft = chat && chat.project_deliverable_id === null && chat.project_id === id ? (chat.structured_draft as ProjectStructuredDraft) : null
    const obj = draft
      ? a.field === "start_month" || a.field === "end_month"
        ? draft.project[a.field]
        : a.field === "project_type" || a.field === "experience_type" || a.field === "competencies"
          ? draft.classification[a.field]
          : draft.star[a.field]
      : undefined
    if (!chat || !obj) skipped.push({ ...a, reason: "not_found" })
    else if (obj.applied_at) skipped.push({ ...a, reason: "already_applied" })
    else if ((obj.rev ?? 1) !== a.rev) skipped.push({ ...a, reason: "proposal_changed" })
    else if (obj.review === "needs_review") skipped.push({ ...a, reason: "needs_review" })
    else {
      obj.applied_at = now
      chat.last_applied_at = now
      chat.last_activity_at = now
      row.source_writing_chat_id = chat.id
      ok.push({ writing_chat_id: a.writing_chat_id, field: a.field })
    }
  }
  return { project_id: id, status: row.status, updated_at: now, applied: ok, skipped: skipped.map(({ writing_chat_id, field, reason }) => ({ writing_chat_id, field, reason })) }
}

export async function mockProjectUpdatedAt(id: string): Promise<string | null> {
  const v = await db()
  return v.projects.get(id)?.updated_at ?? null
}

export async function mockSaveDeliverable(input: { id: string | null; project_id: string; title: string; body: string }, applied: AppliedDeliverableProposal[]) {
  const v = await db()
  const prev = input.id ? v.deliverables.get(input.id) : undefined
  const siblings = [...v.deliverables.values()].filter((d) => d.project_id === input.project_id)
  if (!prev && siblings.length >= PAGE_LIMITS.maxDeliverables) return { refused: "deliverable_limit_reached" as const }
  const id = input.id ?? crypto.randomUUID()
  const now = nowIso()
  const row: MockV45Deliverable = { id, project_id: input.project_id, title: input.title.trim(), body: input.body, sort_order: prev?.sort_order ?? siblings.length + 1, updated_at: now }
  v.deliverables.set(id, row)
  const ok: Array<{ writing_chat_id: string }> = []
  const skipped: Array<{ writing_chat_id: string; reason: "not_found" | "already_applied" | "proposal_changed" | "needs_review" }> = []
  for (const a of applied) {
    const chat = v.chats.get(a.writing_chat_id)
    const body = chat && chat.project_deliverable_id === id ? (chat.structured_draft as DeliverableStructuredDraft).deliverable.body : undefined
    if (!chat || !body) skipped.push({ writing_chat_id: a.writing_chat_id, reason: "not_found" })
    else if (body.applied_at) skipped.push({ writing_chat_id: a.writing_chat_id, reason: "already_applied" })
    else if (body.rev !== a.rev) skipped.push({ writing_chat_id: a.writing_chat_id, reason: "proposal_changed" })
    else if (!body.blocks.some((b) => b.type !== "heading" && (b.review === "ok" || b.review === "accepted"))) skipped.push({ writing_chat_id: a.writing_chat_id, reason: "needs_review" })
    else {
      body.applied_at = now
      body.applied_mode = a.mode
      body.applied_rev = a.rev
      chat.last_applied_at = now
      chat.last_activity_at = now
      ok.push({ writing_chat_id: a.writing_chat_id })
    }
  }
  return { project_deliverable_id: id, project_id: input.project_id, sort_order: row.sort_order, updated_at: now, applied: ok, skipped }
}

export async function mockDeliverableUpdatedAt(id: string): Promise<string | null> {
  const v = await db()
  return v.deliverables.get(id)?.updated_at ?? null
}

/** start_writing_chat / start_deliverable_writing_chat: row + fixed greeting (snapshot picks the branch). */
export async function mockStartChat(target: { project_id: string; snapshot: ProjectFormSnapshot } | { project_deliverable_id: string; snapshot: DeliverableFormSnapshot }): Promise<WritingChatView | null> {
  const v = await db()
  const id = crypto.randomUUID()
  const now = nowIso()
  if ("project_deliverable_id" in target) {
    const d = v.deliverables.get(target.project_deliverable_id)
    if (!d) return null
    const kind = guessWritingKind(target.snapshot.title)
    const first = kind ? DELIVERABLE_SLOTS_BY_KIND[kind][0].label : undefined
    const text = deliverableGreeting(target.snapshot, kind, kind ? WRITING_KIND_LABELS[kind] : undefined, first ? `${first}부터 알려 주세요.` : undefined)
    const chat: DeliverableChatView = {
      id,
      project_id: d.project_id,
      project_deliverable_id: d.id,
      title: null,
      status: "active",
      message_count: 0,
      last_activity_at: now,
      last_applied_at: null,
      return_target: null,
      structured_draft: emptyDeliverableDraft(kind),
      messages: [mockMessage("assistant", text, 0, null, { greeting: true })],
    }
    v.chats.set(id, chat)
    return structuredClone(chat)
  }
  if (!v.projects.has(target.project_id)) return null
  const chat: ProjectChatView = {
    id,
    project_id: target.project_id,
    project_deliverable_id: null,
    title: null,
    status: "active",
    message_count: 0,
    last_activity_at: now,
    last_applied_at: null,
    return_target: null,
    structured_draft: emptyProjectDraft(),
    messages: [mockMessage("assistant", projectGreeting(target.snapshot), 0, null, { greeting: true })],
  }
  v.chats.set(id, chat)
  return structuredClone(chat)
}

export async function mockDeleteChat(id: string): Promise<boolean> {
  const v = await db()
  for (const p of v.projects.values()) if (p.source_writing_chat_id === id) p.source_writing_chat_id = null
  return v.chats.delete(id)
}

/** Persists what a client-side mock turn produced, so a later save / reopen sees the same draft and rev. */
export async function mockRecordTurn(id: string, turn: { messages: WritingChatMessageView[]; structured_draft: WritingChatView["structured_draft"]; message_count: number; closed: boolean; title: string | null }): Promise<void> {
  const v = await db()
  const c = v.chats.get(id)
  if (!c) return
  c.messages = structuredClone(turn.messages)
  c.structured_draft = structuredClone(turn.structured_draft)
  c.message_count = turn.message_count
  c.status = turn.closed ? "closed" : c.status
  c.title = c.title ?? turn.title
  c.last_activity_at = nowIso()
}

/** apply_structured_draft_patch (user session) on the mock row. Returns the new draft or an error code. */
export async function mockPatchDraft(id: string, apply: (draft: WritingChatView["structured_draft"]) => string | null): Promise<{ draft: WritingChatView["structured_draft"] } | { error: string }> {
  const v = await db()
  const c = v.chats.get(id)
  if (!c) return { error: "not_found" }
  const draft = structuredClone(c.structured_draft)
  const err = apply(draft)
  if (err) return { error: err }
  c.structured_draft = draft
  return { draft: structuredClone(draft) }
}


// ---------------------------------------------------------------------------
// C-05 (DM v4.5 §4.2 / UX v5.6 C-05): v4.5 rows in deletion impact and delete
// ---------------------------------------------------------------------------

/** What the v4.5 mock rows add to `get_deletion_impact` for this target. */
export async function mockV45DeletionImpact(
  entityType: string,
  entityId: string,
  projectIds: string[],
): Promise<{ project_deliverables: number; writing_chats: number; message_count: number | null; last_applied_at: string | null; found: boolean }> {
  const v = await db()
  const chats = [...v.chats.values()]
  if (entityType === "project_deliverable") {
    const found = v.deliverables.has(entityId)
    return { project_deliverables: 0, writing_chats: chats.filter((c) => c.project_deliverable_id === entityId).length, message_count: null, last_applied_at: null, found }
  }
  if (entityType === "writing_chat") {
    const c = v.chats.get(entityId)
    return { project_deliverables: 0, writing_chats: 0, message_count: c ? c.message_count : null, last_applied_at: c?.last_applied_at ?? null, found: Boolean(c) }
  }
  // project / experience / education: their v4.5 deliverables and chats (projectIds = the cascade set)
  const deliverables = [...v.deliverables.values()].filter((d) => projectIds.includes(d.project_id))
  return {
    project_deliverables: deliverables.length,
    writing_chats: chats.filter((c) => projectIds.includes(c.project_id)).length,
    message_count: null,
    last_applied_at: null,
    found: true,
  }
}

/** delete_career_item on the v4.5 mock rows: deliverables (+ their chats), chats, projects' rows (FK cascade). */
export async function mockV45Delete(entityType: string, entityId: string, projectIds: string[]): Promise<void> {
  const v = await db()
  const dropChats = (pred: (c: WritingChatView) => boolean) => {
    for (const c of [...v.chats.values()]) if (pred(c)) v.chats.delete(c.id)
  }
  if (entityType === "project_deliverable") {
    v.deliverables.delete(entityId)
    dropChats((c) => c.project_deliverable_id === entityId)
    return
  }
  if (entityType === "writing_chat") {
    for (const p of v.projects.values()) if (p.source_writing_chat_id === entityId) p.source_writing_chat_id = null
    v.chats.delete(entityId)
    return
  }
  for (const id of projectIds) v.projects.delete(id)
  for (const d of [...v.deliverables.values()]) if (projectIds.includes(d.project_id)) v.deliverables.delete(d.id)
  dropChats((c) => projectIds.includes(c.project_id))
}

/** C-23 "choose": experiences / educations with period + status (latest start first). */
export async function mockAffiliationOptions(): Promise<Array<{ type: "experience" | "education"; id: string; name: string | null; start_month: string | null; end_month: string | null; is_current: boolean; status: string }>> {
  await db()
  const s = store()
  return [
    ...s.experiences.map((e) => ({ type: "experience" as const, id: e.id, name: e.company_name, start_month: e.start_month, end_month: e.end_month, is_current: e.is_current, status: e.status })),
    ...s.educations.map((e) => ({ type: "education" as const, id: e.id, name: educationDisplayName(e), start_month: e.start_month, end_month: e.end_month, is_current: e.enrollment_status === "enrolled", status: e.status })),
  ].sort((a, b) => (b.start_month ?? "").localeCompare(a.start_month ?? ""))
}
