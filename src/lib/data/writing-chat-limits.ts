/**
 * AI 작성 대화 limits (client-safe). Moved here so client components can import them
 * (A2 request 5). writing-chats.ts re-exports.
 */

/** 메시지 상한: 사용자 + AI 합계, 시작 인사 제외 (04 §2.5 v4.2 A5) */
export const WRITING_CHAT_MESSAGE_LIMIT = 40
/**
 * v5.3 (02 S-36 정리 결과 입력 길이, DM 4.5 구현 값 [가정]): S-36 preview field length caps,
 * shared so the preview and the save RPC agree.
 */
export const WRITING_CHAT_FIELD_LIMITS = {
  name: 100,
  role: 100,
  metric_name: 200,
  unit: 50,
} as const

/** 저장 전(프로젝트와 연결 안 된) 대화 자동 삭제 [가정] U-9 */
export const WRITING_CHAT_RETENTION_DAYS = 90

/**
 * v4.2 A5: a user message is accepted only while `message_count ≤ 38` (the reply needs a slot), so
 * the last user message is the 39th, its reply the 40th. The greeting is not counted.
 */
export function canSendWritingChatMessage(messageCount: number): boolean {
  return messageCount + 2 <= WRITING_CHAT_MESSAGE_LIMIT
}

/** Days left before auto-deletion for chats not linked to a project (S-08) */
export function daysUntilAutoDelete(chat: { project_id: string | null; last_activity_at: string }, now = Date.now()): number | null {
  if (chat.project_id) return null
  const deadline = Date.parse(chat.last_activity_at) + WRITING_CHAT_RETENTION_DAYS * 86_400_000
  return Math.max(0, Math.ceil((deadline - now) / 86_400_000))
}
