/**
 * S-46 저장의 **기대 버전**(`expected_updated_at`) 고르기 — 순수 함수라 따로 테스트한다.
 *
 * 규칙 (R15 후속 · CF-S7 확정 2026-11-09 (사용자)):
 * - 정본 행을 **읽었으면** 그 행의 `updated_at`이 다음 저장의 기대 버전이다. 읽기가 생겨도 이 값을 쓰지
 *   않으면 덮어쓰기 경로가 남는다.
 * - 행이 **없을 때**(문항 설정 상태의 첫 저장 = [자기소개서 작성 시작])만 `null`이다 — 덮을 정본이 없다.
 *   그사이 다른 탭이 행을 만들었으면 서버가 "행 있음 + 기대 버전 null"을 `stale_write`로 거부한다(CF-S7).
 * - `stale_write`를 받았으면 그 `details.current_updated_at`을 기억했다가 **"내 내용으로 저장"이 그 값을**
 *   보낸다 — 문항 설정 상태의 [작성 시작]도 **같은 충돌 다이얼로그**를 거친다(CF-S7: "다시 읽어 작성
 *   상태로 열기"가 아니다). 정본이 있는 상태에서 null을 보내는 길은 없다.
 */
export function expectedVersion(input: {
  /** 지금 알고 있는 정본 행의 `updated_at` (읽은 값 또는 마지막 저장 응답). 행이 없으면 null */
  rowUpdatedAt: string | null
  /** "내 내용으로 저장"인가 */
  overwrite: boolean
  /** 직전 `stale_write`가 알려 준 지금 버전 */
  staleVersion: string | null
}): string | null {
  if (input.overwrite) return input.staleVersion ?? input.rowUpdatedAt
  return input.rowUpdatedAt
}
