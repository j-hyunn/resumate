import "server-only"
/**
 * S-46 자소서 작성 대화 data layer (UX v5.20 S-46 "Resumate AI 패널", DM 2.5.0b · 11.8 #4; AI-04).
 *
 * **R15가 들여온 것과 아직 없는 것**
 * - **있다**: 대화 시작 `start_document_writing_chat`(server action `startDocumentWritingChat`) ·
 *   턴 라우트 `POST /api/writing-chats/{id}/turns`(서류 턴 SSE, `DocumentTurnEvent`) ·
 *   저장 `save_application_document`.
 * - **없다**: 서류 대화를 **읽는** 계약 — `AnyWritingChatDto`는 `project` · `project_deliverable`
 *   두 값뿐이고 `getWritingChat`·대화 기록 목록에 서류 분기가 없다. 그래서 `listCoverLetterChats`·
 *   `getCoverLetterChat`의 real 분기는 **연결 대기**다(보고서 "백엔드 요청"). 시작한 대화는 방금 만든
 *   것이라 빈 뷰를 화면이 그대로 들고 쓸 수 있어, **이번 방문 안에서는 real 경로로도 대화가 돈다** —
 *   새로 고침한 뒤 기록을 다시 여는 길만 막혀 있다.
 *
 * **CF-S1**: 저장 요청에 근거를 싣지 않는다. 패널이 [반영]한 제안을
 * `applied_proposals: [{writingChatId, slot, rev}]`로만 넘기고, 표시용 근거 칩은 `sources_selected`
 * 이벤트의 카드에서 온다.
 */
import { AppError } from "@/lib/contracts/errors"
import { clone, mockRequest } from "@/lib/mock/store"
import { newId } from "@/lib/mock/ids"
import { startDocumentWritingChat } from "@/server/actions/application-document"
import type { DocumentFormSnapshot } from "@/lib/contracts/application-document"
import {
  COVER_LETTER_MESSAGE_LIMIT,
  emptyCoverLetterDraft,
  type CoverLetterChatSummary,
  type CoverLetterChatView,
} from "./cover-letter-chat-types"
import { previewOr, unwrap } from "./source"

export * from "./cover-letter-chat-types"

function notWired(what: string): never {
  throw new AppError("wiring_pending", `${what}은(는) 아직 백엔드에 연결되지 않았어요`, { status: 503, details: { what } })
}

function newChatView(id: string, applicationProjectId: string): CoverLetterChatView {
  const now = new Date().toISOString()
  return {
    id,
    application_project_id: applicationProjectId,
    title: null,
    status: "active",
    message_count: 0,
    last_activity_at: now,
    structured_draft: emptyCoverLetterDraft(),
    messages: [],
    draft_count: 0,
    remaining_messages: COVER_LETTER_MESSAGE_LIMIT,
    limit_reached: false,
  }
}

/**
 * 패널 머리 "대화 기록 목록" — 이 자기소개서의 대화(최근 활동 순).
 * 연결 대기: 서류 대화를 읽는 계약이 없다 (`AnyWritingChatDto`에 서류 분기 없음).
 */
export async function listCoverLetterChats(applicationProjectId: string): Promise<CoverLetterChatSummary[]> {
  return previewOr(
    async () => {
      const db = await mockRequest()
      return db.cover_letter_chats
        .filter((c) => c.application_project_id === applicationProjectId)
        .sort((a, b) => b.last_activity_at.localeCompare(a.last_activity_at))
        .map(({ id, title, status, message_count, last_activity_at }) => ({ id, title, status, message_count, last_activity_at }))
    },
    // 연결 대기 (DM 2.5.0b — 서류 대화 목록 읽기 계약 없음)
    async () => [],
  )
}

/**
 * 연 대화(`?chat=`) 열기 — 메시지·제안 카드.
 * 연결 대기: 같은 이유로 real 분기가 없다. 이번 방문에 시작한 대화는 화면이 들고 있다.
 */
export async function getCoverLetterChat(chatId: string): Promise<CoverLetterChatView | null> {
  return previewOr(
    async () => {
      const db = await mockRequest()
      const chat = db.cover_letter_chats.find((c) => c.id === chatId)
      return chat ? clone(chat) : null
    },
    // 연결 대기 (DM 2.5.0b — `getWritingChat`에 서류 분기 없음)
    async () => notWired("자소서 대화 열기"),
  )
}

/**
 * 패널 "+ 새 대화" / 첫 메시지 — `start_document_writing_chat(p_application_project_id,
 * p_document_kind, p_form_snapshot)`. **정본 행을 만들지 않고**(CF-S3) 복귀 대상도 받지 않는다.
 */
export async function startCoverLetterChat(applicationProjectId: string, formSnapshot?: DocumentFormSnapshot): Promise<CoverLetterChatView> {
  return previewOr(
    async () => {
      const db = await mockRequest(200)
      const chat = newChatView(newId(), applicationProjectId)
      db.cover_letter_chats.push(chat)
      return clone(chat)
    },
    // real: 시작은 연결됐다. 방금 만든 대화라 메시지·제안이 없어 빈 뷰가 곧 그 대화다
    async () => {
      const { writingChatId } = unwrap(
        await startDocumentWritingChat({ applicationProjectId, documentKind: "cover_letter", formSnapshot }),
      )
      return newChatView(writingChatId, applicationProjectId)
    },
  )
}

/** 패널 ⋯ "이 대화 삭제" (C-05 `writing_chat`). 연결 대기: 서류 대화 삭제 계약이 없다 */
export async function deleteCoverLetterChat(chatId: string): Promise<void> {
  return previewOr(
    async () => {
      const db = await mockRequest(150)
      db.cover_letter_chats = db.cover_letter_chats.filter((c) => c.id !== chatId)
    },
    // 연결 대기 (DM 2.5 — 서류 대화 삭제)
    async () => notWired("자소서 대화 삭제"),
  )
}

/**
 * 한 턴의 SSE 요청 — 화면(클라이언트)이 그대로 `fetch`한다. `retry = true`면 "다시 보내기"다.
 * 이벤트 모양은 계약 `DocumentTurnEvent`이고, **`sources_selected.sources[]`만 camelCase**다.
 */
export function coverLetterTurnRequest(
  chatId: string,
  body: { content: string; requestedSlot?: string | null; style?: "fit_length" | "shorter" | null; formSnapshot?: DocumentFormSnapshot } | null,
): { endpoint: string; body: unknown } {
  const base = `/api/writing-chats/${chatId}/turns`
  if (body === null) return { endpoint: `${base}?retry=1`, body: {} }
  return {
    endpoint: base,
    body: {
      content: body.content,
      requestedSlot: body.requestedSlot ? { slot: body.requestedSlot } : null,
      requestedAction: null,
      style: body.style ?? null,
      formSnapshot: body.formSnapshot,
    },
  }
}
