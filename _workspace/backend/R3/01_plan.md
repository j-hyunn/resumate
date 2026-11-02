# R3 실행 전 동의 확인 (R-67) 계획

## 범위와 근거
- R-67: 사용자가 확정했다(2026-11-06). 기획 리더가 임시로 정한 (a)안이다.
- 근거 문서: `main`의 `docs/planning/04-data-model.md`(커밋 dfcba80). 이 백엔드 브랜치에는 아직 병합하지 않았으므로 아래 경로에서 읽기만 한다.
  - 경로: `/Users/jehyun/Resumate/docs/planning/`
  - 볼 곳: DM 2.11.7 마지막 항목 "화면이 동의 필요를 미리 아는 방법", DM 6장 `ai_connection.consent_required`(925행 근처)
- 연결: UI 없음, "연결 대기"
- 원격 브랜치: 적용하지 않는다.

## 내용
- `get_data_readiness().ai_connection`에 `consent_required`(boolean | null)를 더한다.
  - `true`: 활성 공급자의 `(provider, 활성 키 connection_tier)`에 2.11.5 재동의 규칙으로 동의가 필요하다. 동의 행이 없거나, 동의 뒤에 `requires_reconsent = true` 고지가 시행된 경우다.
  - `false`: 동의가 필요 없다.
  - `null`: 활성 공급자나 활성 키가 없다. 다른 세 필드와 같다.
  - 판정은 `private.ai_consent_allows_run`을 그대로 쓴다. `check_ai_run_allowed`·`retry_ai_job`와 같은 기준이다.
- 서버의 거부 동작은 바꾸지 않는다(경로 ③·④·⑤는 그대로 `key_missing`).
- 다른 필드와 판정 순서(`next_action`, 힌트)는 바꾸지 않는다.

## 팀
| 담당 | 할 일 |
|------|-------|
| db-engineer | `private.current_ai_connection()`에 필드를 더한다(새 마이그레이션 `20261106000200_r3_*`). pgTAP: 동의 있음, 동의 없음, 재동의 필요 고지 시행, 등급별 동의, 활성 키 없음 → null. 타입 생성 |
| api-engineer | `src/lib/contracts/ai-connection.ts`의 readiness `ai_connection` zod에 `consent_required`(boolean, nullable)를 더한다. 이 값을 쓰거나 고정값으로 만드는 서비스·테스트 픽스처를 갱신한다(dev/mock 경로 포함) |
| backend-qa | DB ↔ zod ↔ 서비스 확인, 회귀(최대 2라운드) |
