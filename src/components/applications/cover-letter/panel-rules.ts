/** S-46 패널의 순수 규칙 — 테스트하려고 컨트롤러(클라이언트 훅·서버 액션 import)에서 떼어 냈다. */
/**
 * 턴 뒤 다시 읽은 대화를 반영해도 되는가 (UQ-760) — 지금 열린 대화가 그 턴의 대화이고, 응답도 그 대화일 때만.
 * 그 사이 기록에서 다른 대화를 열었거나 "+ 새 대화"로 비웠으면 버린다.
 */
export function shouldAdoptReread(openChatId: string | null, turnChatId: string, responseChatId: string): boolean {
  return openChatId === turnChatId && responseChatId === turnChatId
}
