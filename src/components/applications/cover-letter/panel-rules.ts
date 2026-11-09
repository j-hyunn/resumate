/** S-46 패널의 순수 규칙 — 테스트하려고 컨트롤러(클라이언트 훅·서버 액션 import)에서 떼어 냈다. */
/**
 * 늦게 도착한 대화 읽기 응답을 반영해도 되는가 (UQ-760) — 지금 기대하는 대화가 그 요청의 대화이고, 응답도
 * 그 대화일 때만. 그 사이 기록에서 다른 대화를 열었거나 "+ 새 대화"로 비웠으면 버린다.
 * (R15 후속 3에서 턴 뒤 보정용 다시 읽기는 걷었다 — 남은 길은 "기록에서 열기"다.)
 */
export function shouldAdoptReread(openChatId: string | null, turnChatId: string, responseChatId: string): boolean {
  return openChatId === turnChatId && responseChatId === turnChatId
}
