# R3 실행 전 동의 확인 (R-67) 요약

- 상태: done (2026-11-06). QA 1라운드에서 막는 이슈가 없었다. Minor 1건은 선택 사항이라 열어 둔다.
- 근거: R-67 (a)안. 사용자가 2026-11-06에 확정했고, 기획 커밋은 main `6ece0b1`이다.
- 연결: UI 없음 → "연결 대기"

## 바뀐 것
- `get_data_readiness().ai_connection`에 `consent_required`(boolean | null)를 더했다.
  - `true`: 활성 공급자와 활성 키 등급으로 보면 (재)동의가 필요하다.
  - `false`: 동의가 필요 없다.
  - `null`: 활성 키가 없다. 이때는 네 필드가 모두 null이다.
  - 판정은 `private.ai_consent_allows_run`이다. `check_ai_run_allowed`·`retry_ai_job`와 같은 헬퍼다.
- 마이그레이션 `20261106000200_r3_readiness_consent_required.sql`은 `private.current_ai_connection()`을 다시 정의한다. 보안과 권한은 그대로다.
- zod `ReadinessAiConnection.consent_required`는 필수이고 nullable이다. `isAiLocked`는 바꾸지 않았다(동의가 필요해도 잠그지 않고, 화면이 C-21을 먼저 연다).
- 서버의 거부 코드와 `next_action`·힌트는 바꾸지 않았다.

## 검사
| 검사 | 결과 |
|------|------|
| typecheck · lint · build | 통과 |
| Vitest | 통과 (90파일, 1439개, 통합 포함) |
| pgTAP | 통과 (46파일, 2177개) |

## 열린 이슈
- QA-R3-01 [Minor, db, 선택]: 같은 상태에서 readiness `consent_required`와 `check_ai_run_allowed`/`retry_ai_job` 판정이 같은지 직접 비교하는 pgTAP가 없다. 지금은 세 곳이 같은 헬퍼를 쓴다는 코드 대조로만 보장한다.
