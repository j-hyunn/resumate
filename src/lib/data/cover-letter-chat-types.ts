/**
 * S-46 자소서 작성 대화의 **클라이언트 안전 뷰 타입·문구** (server-only 아님).
 *
 * 저장 모양(`structured_draft`)의 정본은 `src/server/ai/schemas/cover-letter-draft.ts`이고 SSE
 * 이벤트의 정본은 `src/lib/contracts/writing-chat.ts`의 `DocumentTurnEvent`다. 여기 타입은 패널이
 * 그리는 데 필요한 부분만 **그 모양 그대로** 옮긴 것이고, 두 곳의 대소문자 규칙 차이를 지킨다:
 *
 * - **`sources_selected.sources[]`는 camelCase**(`sortOrder`·`experienceId`·`projectId`·`reuseReason` …)
 * - **`draft_block.block`은 저장 모양이라 snake_case**(`block_id`·`source_fact_ids` …)
 *
 * 둘을 같은 규칙으로 다루면 깨진다(백엔드가 한 번 결함을 냈던 자리다).
 */
import type { AiErrorCode, AiProviderName, ConnectionTier, ModelTier } from "@/types/db"

/** 대화 전체 초안 **턴** 상한 — DM 2.9.4 "6 per chat, not per slot". 한 턴이 3문항을 써도 1회다 */
export const COVER_LETTER_DRAFT_LIMIT = 6
/** 메시지 상한 (S-10·S-44와 같다) */
export const COVER_LETTER_MESSAGE_LIMIT = 40
/** 한 초안 턴이 쓰는 문항 수 상한 (CL-10) */
export const COVER_LETTER_DRAFT_SLOTS_PER_TURN = 3

// ---------------------------------------------------------------------------
// 저장된 제안 (structured_draft.document.questions[])
// ---------------------------------------------------------------------------

/** `blocks[]` 원소 — 저장 모양이라 **snake_case**다 */
export interface CoverLetterProposalBlock {
  block_id: string
  type: "paragraph"
  text: string
  basis: "new" | "current_body" | null
  source_fact_ids: string[]
  source_body_quotes: string[]
  requirement_ids: string[]
  placeholders: Array<{ token: string; hint: string | null }>
  flags: string[]
  review: "ok" | "accepted" | "needs_review" | "rejected"
  review_reason: string | null
  /** 저장 때 `{slot}.blocks.{block_id}` 근거가 되는 값 (화면은 출처 칩으로만 쓴다) */
  evidence: Array<{ source_type: string; source_id: string; source_field?: string | null; label?: string | null; quote?: string | null }>
}

/** 한 문항의 제안 (`document.questions[].draft`) */
export interface CoverLetterProposalDraft {
  /** CF-6 — 글자 수·보정 대상이 아니다. null = 제목 제안 없음 */
  answer_title: string | null
  value: string
  blocks: CoverLetterProposalBlock[]
  char_count: number
  char_limit_at_generation: number | null
  char_adjust_needed: boolean
  correction_applied: boolean
  rev: number
  base_body_hash: string | null
  replace_allowed: boolean
  missing_slots: string[]
  dropped_block_count: number
  applied_at: string | null
  applied_rev: number | null
}

export interface CoverLetterProposalQuestion {
  slot: string
  question_id: string
  draft: CoverLetterProposalDraft
}

/** `facts[]` 가운데 화면이 쓰는 부분 */
export interface CoverLetterFactView {
  fact_id: string
  text: string
  review: "ok" | "accepted" | "needs_review" | "rejected"
}

export interface CoverLetterStructuredDraft {
  schema_version: number
  target: "cover_letter"
  facts: CoverLetterFactView[]
  document: { questions: CoverLetterProposalQuestion[] }
  meta: { tone_requested: string | null }
  clarifications: Array<{ kind: string; slot: string | null; note: string | null }>
  sensitive_flags_count: number
  /** 쓴 초안 **턴** 수 — 남은 횟수 = 6 − `draft_count` */
  draft_count: number
}

/** 빈 `structured_draft` — 방금 시작한 대화 (AI-04 schema 4). 순수하므로 여기 둔다 */
export function emptyCoverLetterDraft(): CoverLetterStructuredDraft {
  return {
    schema_version: 4,
    target: "cover_letter",
    facts: [],
    document: { questions: [] },
    meta: { tone_requested: null },
    clarifications: [],
    sensitive_flags_count: 0,
    draft_count: 0,
  }
}

// ---------------------------------------------------------------------------
// 대화 뷰
// ---------------------------------------------------------------------------

export interface CoverLetterChatMessageView {
  id: string
  role: "user" | "assistant"
  content: string
  status: "ok" | "failed" | "pending"
  created_at: string
}

export interface CoverLetterChatSummary {
  id: string
  /** 첫 사용자 메시지 앞 30자, 없으면 "새 대화" */
  title: string | null
  status: "active" | "closed"
  message_count: number
  last_activity_at: string
}

export interface CoverLetterChatView extends CoverLetterChatSummary {
  application_project_id: string
  structured_draft: CoverLetterStructuredDraft
  messages: CoverLetterChatMessageView[]
  /** `structured_draft.draft_count` 그대로 (턴 기준) */
  draft_count: number
  remaining_messages: number
  limit_reached: boolean
}

// ---------------------------------------------------------------------------
// 턴 이벤트 (화면이 받는 모양 — 계약 `DocumentTurnEvent`와 같은 이름·칸)
// ---------------------------------------------------------------------------

/** `sources_selected.sources[]` 원소 — **camelCase** (계약 그대로) */
export interface CoverLetterSourceCard {
  sortOrder: number
  role: "primary" | "supporting"
  experienceId: string | null
  educationId: string | null
  projectId: string | null
  /** 서버가 행에서 만든 "회사명 › 프로젝트명" */
  label: string
  rationale: string
  reuseReason: string | null
  requirementIds: string[]
}

export type CoverLetterTurnEvent =
  | { type: "turn_started"; provider: AiProviderName | null; modelTier: ModelTier | null; connectionTier: ConnectionTier | null }
  | { type: "reply_delta"; text: string }
  | { type: "reply_done"; text: string }
  | { type: "draft_patch"; structuredDraft: CoverLetterStructuredDraft; added: string[] }
  | { type: "draft_flags"; needsReview: string[]; sensitiveAdded: number; sensitiveFlagsCount: number }
  | { type: "sources_selected"; slot: string; questionNo: number; questionClass: string; sources: CoverLetterSourceCard[] }
  | { type: "draft_started"; attempt: number; reason: "initial" | "schema_retry"; slots: string[] }
  | { type: "draft_block"; slot: string; questionNo: number; attempt: number; block: CoverLetterProposalBlock }
  | { type: "adjusting_length"; questions: Array<{ slot: string; questionNo: number; charCount: number; charLimit: number }> }
  | {
      type: "draft_done"
      slot: string
      questionNo: number
      answerTitle: string | null
      charCount: number
      charLimit: number | null
      charAdjustNeeded: boolean
      correctionApplied: boolean
      needsReviewBlockIds: string[]
      droppedBlockCount: number
      rev: number
      draftCount: number
    }
  | { type: "turn_done"; messageCount: number; remainingMessages: number; limitReached: boolean; draftStatus: "updated" | "unchanged" | "failed"; draftCount: number }
  | { type: "error"; errorCode: AiErrorCode; provider: AiProviderName | null; retryAfter: string | null; quotaResetsAt: string | null }

// ---------------------------------------------------------------------------
// 문구 (UX v5.20 S-46 패널 · AI-04)
// ---------------------------------------------------------------------------

export const PANEL_NAME = "Resumate AI"

/** 고정 안내 `[UI-가정]` (UX S-46 시작 영역) */
export const PANEL_FIXED_NOTE = "AI는 모아 둔 커리어와 공고 요건으로 문항 초안을 제안하고, 반영은 내가 정해요"

/** 시작 인사 — `form_snapshot`으로 분기한다 (UX S-46 시작 영역 ①~④) */
export function coverLetterGreeting(state: { answered: number; total: number; requirementsPending: boolean }): string {
  if (state.requirementsPending) return "공고 요건을 먼저 정리하고 있어요. 끝나면 초안을 만들어 드릴게요"
  if (state.answered === 0) return "자기소개서 문항을 함께 채워 볼까요? 모아 둔 커리어와 공고 요건으로 초안을 제안해 드려요"
  if (state.answered < state.total) return "쓰던 답변을 이어서 채워 볼게요. 비어 있는 문항부터 초안을 제안해 드릴까요?"
  return "지금 답변을 바탕으로 더 다듬어 볼게요"
}

/** 첫 턴 제안 (v5.20, R-CF-8 확정 문구) */
export function firstTurnOffer(total: number): string {
  return total <= COVER_LETTER_DRAFT_SLOTS_PER_TURN
    ? "모아 둔 커리어로 바로 초안을 만들어 드릴까요?"
    : "모아 둔 커리어로 바로 초안을 만들어 드릴까요? 먼저 1~3번 문항을 써 볼게요"
}

/** 빠른 버튼 칩 — 대화 중에도 유지한다 (S-44 방식) `[UI-가정]` */
export function coverLetterChips(state: { total: number; firstDraftDone: boolean }): string[] {
  const chips = ["지금까지 내용으로 초안 만들기", "더 간결하게", "글자 수 맞춰 줘"]
  if (state.firstDraftDone && state.total > COVER_LETTER_DRAFT_SLOTS_PER_TURN) {
    const rest = state.total === 5 ? "4~5번" : "4번"
    chips.unshift(`남은 ${rest} 문항 초안 만들기`)
  }
  return chips
}

export const PANEL_COPY = {
  /** 초안 턴 상한 (대화 전체 6회, 턴 기준) */
  draftLimitReached: "이 대화에서는 초안을 더 만들 수 없어요. 새 대화에서 이어 가세요",
  messageLimitReached: "이 대화는 메시지 한도에 닿았어요. 새 대화에서 이어 가세요",
  draftFailed: "초안을 만들지 못했어요. 지금 본문은 그대로예요",
  /** 첫 블록 전 15초가 지나면 `[UI-가정]` */
  slowDraft: "긴 글이라 조금 더 걸려요",
  drafting: "초안 작성 중",
  adjusting: "글자 수 맞추는 중",
  requirementsFirst: "공고 요건 정리 중",
  sensitive: "민감정보·회사 기밀·다른 사람의 개인정보는 쓰지 마세요",
  needsReviewBlock: "본인이 한 일이 맞는지, 원래 말과 같은지 확인해 주세요",
} as const
