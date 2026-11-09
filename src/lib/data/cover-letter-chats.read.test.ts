import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * R15 후속: 서류 대화 목록·열기를 실제 경로로 붙였다. DTO 자체 필드는 camelCase, **`structuredDraft`는
 * 저장 jsonb 그대로 snake_case**다 — 화면은 바꾸지 않고 그대로 쓴다(저장된 제안은 늘 여기서 읽는다).
 */
const chatActions = vi.hoisted(() => ({ getWritingChat: vi.fn(), listDocumentWritingChats: vi.fn(), deleteWritingChat: vi.fn() }))
const docActions = vi.hoisted(() => ({ startDocumentWritingChat: vi.fn() }))
vi.mock("./source", async () => {
  const real = await vi.importActual<typeof import("./source")>("./source")
  return { ...real, previewOr: <T,>(_p: () => Promise<T>, realFn: () => Promise<T>) => realFn() }
})
vi.mock("@/server/actions/writing-chat", () => chatActions)
vi.mock("@/server/actions/application-document", () => docActions)

const { getCoverLetterChat, listCoverLetterChats, startCoverLetterChat } = await import("./cover-letter-chats")

const AP = "00000000-0000-4000-8000-0000000000a1"
const CHAT = "00000000-0000-4000-8000-0000000000c1"
const storedDraft = {
  schema_version: 1,
  target: "cover_letter",
  facts: [],
  document: {
    questions: [
      {
        slot: "q_3",
        question_id: "qid",
        draft: { answer_title: "제목", value: "본문", blocks: [{ block_id: "b1", source_fact_ids: [] }], sources: [{ source_type: "project", source_id: "p", role: "primary" }], rev: 2 },
      },
    ],
    question_edit_proposal: [],
  },
  meta: { tone_requested: null, tone_requested_at: null },
  clarifications: [],
  sensitive_flags_count: 0,
  draft_count: 2,
}
const dto = {
  id: CHAT,
  target: "application_document",
  applicationProjectId: AP,
  documentKind: "cover_letter",
  title: "첫 메시지",
  status: "active",
  structuredDraft: storedDraft,
  draftCount: 2,
  draftLimit: 6,
  messageCount: 4,
  messageLimit: 40,
  remainingMessages: 36,
  limitReached: false,
  lastActivityAt: "2026-11-09T05:00:00.000Z",
  lastAppliedAt: null,
  createdAt: "2026-11-09T04:00:00.000Z",
  messages: [{ id: "m1", role: "user", content: "안녕", status: "done", createdAt: "2026-11-09T04:00:00.000Z" }],
  connection: {},
  needsReviewCount: 0,
  canSend: true,
}

beforeEach(() => vi.clearAllMocks())

describe("서류 대화 읽기 (R15 후속)", () => {
  it("열기: structuredDraft를 snake_case 그대로 쓰고, 초안 상한은 턴 수(draftCount)를 그대로 받는다", async () => {
    chatActions.getWritingChat.mockResolvedValue({ data: dto })
    const view = await getCoverLetterChat(CHAT)
    expect(view?.structured_draft).toBe(storedDraft)
    expect(view?.structured_draft.document.questions[0].draft.sources[0]).toEqual({ source_type: "project", source_id: "p", role: "primary" })
    expect(view?.draft_count).toBe(2)
    expect(view?.messages[0]).toMatchObject({ id: "m1", role: "user", status: "ok" })
  })

  it("서류 대화가 아니면 not_found — 다른 패널의 대화를 열지 않는다", async () => {
    chatActions.getWritingChat.mockResolvedValue({ data: { ...dto, target: "project" } })
    await expect(getCoverLetterChat(CHAT)).rejects.toMatchObject({ code: "not_found" })
  })

  it("목록: camelCase 요약을 화면 요약으로", async () => {
    chatActions.listDocumentWritingChats.mockResolvedValue({
      data: [{ id: CHAT, title: null, status: "closed", lastActivityAt: "2026-11-09T05:00:00.000Z", lastAppliedAt: null, messageCount: 7, messageLimit: 40 }],
    })
    await expect(listCoverLetterChats(AP)).resolves.toEqual([{ id: CHAT, title: null, status: "closed", message_count: 7, last_activity_at: "2026-11-09T05:00:00.000Z" }])
    expect(chatActions.listDocumentWritingChats).toHaveBeenCalledWith({ applicationProjectId: AP, documentKind: "cover_letter" })
  })

  it("시작: 시작 RPC 뒤 그 대화를 읽어 연다 (복귀 대상을 보내지 않는다)", async () => {
    docActions.startDocumentWritingChat.mockResolvedValue({ data: { writingChatId: CHAT } })
    chatActions.getWritingChat.mockResolvedValue({ data: dto })
    const view = await startCoverLetterChat(AP)
    expect(docActions.startDocumentWritingChat).toHaveBeenCalledWith({ applicationProjectId: AP, documentKind: "cover_letter", formSnapshot: undefined })
    expect(view.id).toBe(CHAT)
  })
})
