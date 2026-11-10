import "server-only"
/**
 * S-46 자소서 작성 대화 data layer (UX v5.20 S-46 "Resumate AI 패널", DM 2.5.0b · 11.8 #4; AI-04).
 *
 * **모두 실제 경로다** (R15 + R15 후속): 시작 `startDocumentWritingChat` · 턴 라우트
 * `POST /api/writing-chats/{id}/turns`(서류 턴 SSE) · 목록 `listDocumentWritingChats` · 열기
 * `getWritingChat`(서류 대화면 `DocumentWritingChatDto`) · 삭제 `deleteWritingChat`. 새로 고침해도 대화와
 * 반영하지 않은 제안이 돌아온다. `?state=` mock 분기는 그대로 둔다.
 *
 * **CF-S1**: 저장 요청에 근거를 싣지 않는다. 패널이 [반영]한 제안을
 * `applied_proposals: [{writingChatId, slot, rev}]`로만 넘기고, 표시용 근거 칩은 `sources_selected`
 * 이벤트의 카드에서 온다.
 */
import { AppError } from "@/lib/contracts/errors"
import { clone, mockRequest } from "@/lib/mock/store"
import { newId } from "@/lib/mock/ids"
import { startDocumentWritingChat } from "@/server/actions/application-document"
import { deleteWritingChat, getWritingChat, listDocumentWritingChats } from "@/server/actions/writing-chat"
import type { DocumentWritingChatDto, ProjectWritingChatSummary } from "@/lib/contracts/writing-chat"
import type { DocumentFormSnapshot } from "@/lib/contracts/application-document"
import {
  COVER_LETTER_MESSAGE_LIMIT,
  emptyCoverLetterDraft,
  type CoverLetterChatSummary,
  type CoverLetterChatView,
} from "./cover-letter-chat-types"
import { previewOr, unwrap } from "./source"

export * from "./cover-letter-chat-types"


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
    source_labels: {},
  }
}

/** 패널 머리 "대화 기록 목록" — 이 자기소개서의 대화(최근 활동 순, R15 후속 `listDocumentWritingChats`). */
export async function listCoverLetterChats(applicationProjectId: string): Promise<CoverLetterChatSummary[]> {
  return previewOr(
    async () => {
      const db = await mockRequest()
      return db.cover_letter_chats
        .filter((c) => c.application_project_id === applicationProjectId)
        .sort((a, b) => b.last_activity_at.localeCompare(a.last_activity_at))
        .map(({ id, title, status, message_count, last_activity_at }) => ({ id, title, status, message_count, last_activity_at }))
    },
    async () =>
      unwrap(await listDocumentWritingChats({ applicationProjectId, documentKind: "cover_letter" })).map(toSummary),
  )
}

/**
 * 연 대화(`?chat=`) 열기·새로 고침 — 메시지·제안 카드. 서류 대화면 `getWritingChat`이
 * `DocumentWritingChatDto`를 준다. **저장된 제안은 늘 이 DTO의 `structuredDraft`에서 읽는다**
 * (SSE `sources_selected`는 따로 나가는 표시 카드다). 서류 대화가 아니면 `not_found`.
 */
export async function getCoverLetterChat(chatId: string, applicationProjectId: string): Promise<CoverLetterChatView | null> {
  return previewOr(
    async () => {
      const db = await mockRequest()
      const chat = db.cover_letter_chats.find((c) => c.id === chatId)
      return chat && chat.application_project_id === applicationProjectId ? clone(chat) : null
    },
    async () => {
      const dto = unwrap(await getWritingChat({ writingChatId: chatId }))
      if (dto.target !== "application_document") throw new AppError("not_found", "요청한 대화를 찾을 수 없어요")
      // UQ-758: RLS는 다른 **사용자**만 막는다. 같은 사용자의 **다른 지원 건** 대화를 열면 그 제안이 이 화면의
      // 엉뚱한 문항에 반영될 수 있으므로 열지 않는다 (`null` = 대화 없이 화면은 정상으로)
      if (dto.applicationProjectId !== applicationProjectId) return null
      return toChatView(dto)
    },
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
    // real: 시작 → 그 대화를 읽어 서버가 정한 값(제목·상한·잠금)으로 연다
    async () => {
      const { writingChatId } = unwrap(
        await startDocumentWritingChat({ applicationProjectId, documentKind: "cover_letter", formSnapshot }),
      )
      const dto = unwrap(await getWritingChat({ writingChatId }))
      if (dto.target !== "application_document" || dto.applicationProjectId !== applicationProjectId)
        throw new AppError("not_found", "요청한 대화를 찾을 수 없어요")
      return toChatView(dto)
    },
  )
}

/** 패널 ⋯ "이 대화 삭제" (C-05 `writing_chat`) — 대화 대상과 관계없는 `deleteWritingChat` */
export async function deleteCoverLetterChat(chatId: string): Promise<void> {
  return previewOr(
    async () => {
      const db = await mockRequest(150)
      db.cover_letter_chats = db.cover_letter_chats.filter((c) => c.id !== chatId)
    },
    async () => {
      unwrap(await deleteWritingChat({ writingChatId: chatId }))
    },
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

// ---------------------------------------------------------------------------
// DTO → 화면 뷰 (R15 후속). DTO 자체 필드는 camelCase, **`structuredDraft`는 저장 jsonb 그대로 snake_case**
// (산출물 DTO와 같은 관례) — 그래서 `structuredDraft`는 바꾸지 않고 그대로 넘긴다.
// ---------------------------------------------------------------------------

export function toSummary(s: ProjectWritingChatSummary): CoverLetterChatSummary {
  return { id: s.id, title: s.title, status: s.status, message_count: s.messageCount, last_activity_at: s.lastActivityAt }
}

export function toChatView(dto: DocumentWritingChatDto): CoverLetterChatView {
  return {
    id: dto.id,
    application_project_id: dto.applicationProjectId,
    title: dto.title,
    status: dto.status,
    message_count: dto.messageCount,
    last_activity_at: dto.lastActivityAt,
    // 저장된 제안 — 그대로 (snake_case)
    structured_draft: dto.structuredDraft,
    messages: dto.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      status: m.status === "failed" ? "failed" : m.status === "streaming" ? "pending" : "ok",
      created_at: m.createdAt,
    })),
    // 초안 상한은 **턴** 6회 (`draftLimit: 6`) — 남은 횟수 = 6 − draftCount
    draft_count: dto.draftCount,
    remaining_messages: dto.remainingMessages,
    limit_reached: dto.limitReached,
    source_labels: dto.sourceLabels ?? {},
  }
}
