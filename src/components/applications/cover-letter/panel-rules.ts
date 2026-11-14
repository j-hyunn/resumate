import { COVER_LETTER_MESSAGE_LIMIT, PANEL_COPY as CL_COPY } from "@/lib/data/cover-letter-chat-types"
import type { QuickChip } from "@/lib/data/quick-chips"
/** S-46 패널의 순수 규칙 — 테스트하려고 컨트롤러(클라이언트 훅·서버 액션 import)에서 떼어 냈다. */
/**
 * 늦게 도착한 대화 읽기 응답을 반영해도 되는가 (UQ-760) — 지금 기대하는 대화가 그 요청의 대화이고, 응답도
 * 그 대화일 때만. 그 사이 기록에서 다른 대화를 열었거나 "+ 새 대화"로 비웠으면 버린다.
 * (R15 후속 3에서 턴 뒤 보정용 다시 읽기는 걷었다 — 남은 길은 "기록에서 열기"다.)
 */
export function shouldAdoptReread(openChatId: string | null, turnChatId: string, responseChatId: string): boolean {
  return openChatId === turnChatId && responseChatId === turnChatId
}

// ---------------------------------------------------------------------------
// 공통 패널 어댑터의 상한 규칙 (59 QA UQ-764 · UQ-770)
// ---------------------------------------------------------------------------


/**
 * 서류 대화의 메시지 상한 — **39개에서 막는다**(다음 턴은 사용자 1 + AI 1 = 2개라 40을 넘지 않게). 기존
 * `useCoverLetterPanel` 규칙 그대로다.
 */
export function coverLetterMessageLimitReached(messageCount: number): boolean {
  return messageCount >= COVER_LETTER_MESSAGE_LIMIT - 1
}

/**
 * 공통 패널 "끝난 대화" 상자의 문구 — 공통 상자는 40개 이상일 때만 상한 문구를 고르므로, 서류 대화가 39에서 막을 때
 * "이 대화는 끝났어요"가 나오던 회귀(UQ-764)를 막는다. 메시지 상한이면 **이전 S-46 문구**, 아니면(대화가 `closed`)
 * `undefined` = 공통 기본 문구.
 */
export function coverLetterClosedCopy(messageCount: number): string | undefined {
  return coverLetterMessageLimitReached(messageCount) ? CL_COPY.messageLimitReached : undefined
}

/** 초안 턴을 돌리는 칩 (상한 6회에 걸린다) */
export function isDraftChip(chip: string): boolean {
  return chip.includes("초안 만들기") || chip === "글자 수 맞춰 줘" || chip === "더 간결하게"
}

/** 칩 → 서류 대화 턴 옵션 (옛 `cover-letter-panel.tsx` 규칙 그대로) */
export function chipTurnOptions(chip: string): { draftTurn: boolean; style?: "fit_length" | "shorter" } {
  return { draftTurn: isDraftChip(chip), style: chip === "더 간결하게" ? "shorter" : chip === "글자 수 맞춰 줘" ? "fit_length" : undefined }
}

/** 초안 6회 도달 때 칩 문구 (AI-04 "빠른 버튼 칩" 표 아래 줄 · S-44 OD-P6 고정 칩과 같은 문구) */
export const DRAFT_LIMIT_CHIP_LABELS = { askMissing: "빠진 부분 물어봐 줘", newChat: "새 대화 시작" } as const

/**
 * 서류 대화 칩 줄 (59 QA UQ-770). 초안 6회 전에는 서류 대화 칩 그대로. **6회에 닿으면** 초안 칩이 빠지고
 * AI-04 표("`compose_draft` 칩이 사라지고 '빠진 부분 물어봐 줘' / '새 대화 시작'으로 바뀐다")대로 바뀐다 —
 * "새 대화 시작"은 S-44 OD-P6과 같은 `new_chat` 칩(메시지를 보내지 않고 새 대화를 연다)이다.
 */
export function coverLetterPanelChips(chips: readonly string[], draftLimitReached: boolean): QuickChip[] {
  if (draftLimitReached) {
    return [
      { kind: "message", label: DRAFT_LIMIT_CHIP_LABELS.askMissing, requested_slot: null, requested_action: null, style: null },
      { kind: "new_chat", label: DRAFT_LIMIT_CHIP_LABELS.newChat },
    ]
  }
  return chips.map((label) => ({ kind: "message", label, requested_slot: null, requested_action: null, style: null }))
}
