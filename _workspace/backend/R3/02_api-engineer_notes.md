# R3 api-engineer 노트 — readiness `ai_connection.consent_required` (R-67)

## 바꾼 것
- `src/lib/contracts/ai-connection.ts` — `ReadinessAiConnection`에 `consent_required: z.boolean().nullable()`를 더했다. `DataReadiness`(career.ts)는 이 스키마를 그대로 쓰므로 자동 반영된다. 이 타입을 쓰는 `InterviewPrepView.aiConnection`(interview.ts)도 같이 넓어진다(서비스 `interview/read.ts`는 readiness 값을 그대로 넘기므로 코드 변경 없음).
- `isAiLocked`는 그대로 둔다. `consent_required = true`는 잠금이 아니다 — 화면이 실행 전에 C-21을 연다(DM 6장). 테스트로 고정했다.

## 결정: 필수 + nullable
- `.optional()`을 쓰지 않았다. db-engineer 마이그레이션 `20261106000200_r3_readiness_consent_required.sql` 뒤로 `get_data_readiness()`는 항상 이 키를 보낸다. 키가 빠지면 마이그레이션 누락이므로 `parseRpc`가 실패하는 편이 맞다(다른 세 필드와 같은 규칙).
- 값: `true` / `false` / `null`(활성 공급자·활성 키 없음). 판정은 DB(`private.ai_consent_allows_run`)가 하고 서버는 계산하지 않는다.

## 테스트
- `src/lib/contracts/career.test.ts` — 샘플에 필드 추가, 넷 다 null 허용, 필드 누락 → 실패, 문자열 → 실패.
- `src/server/services/ai-connection/ai-connection.test.ts` — `isAiLocked` 입력에 필드 추가, `consent_required: true`여도 잠그지 않음.
- `src/server/services/ai-connection/ai-connection.integration.test.ts` — readiness RPC 원본이 `consent_required: false`, 활성 등급 동의 철회 → `getDataReadiness()`(zod 경유)에서 `true`, 다시 동의 → `false`.
- `src/server/services/career/career.integration.test.ts` — 키 없는 사용자: `ai_connection`이 네 필드 모두 null.
- 재동의 고지(`requires_reconsent`)·등급별 판정은 db-engineer pgTAP 범위라 여기서 반복하지 않았다.

## 확인할 곳이 없던 것
- `src/lib/mock`, `src/lib/data`, dev/fake 공급자, 작성 대화·파이프라인 어디에도 readiness `ai_connection` 객체를 만드는 코드가 없다(`connection_tier` 쓰는 곳은 job·키 쪽 별도 타입). UI 연결은 "연결 대기".

## 서버 동작
- 거부 경로(③·④·⑤ `key_missing`)와 `next_action` 판정은 바꾸지 않았다.

## 점검 결과
- db-engineer 마이그레이션 적용(로컬 `db reset`) 뒤 실행.
- 통합: `career.integration.test.ts` + `ai-connection.integration.test.ts` 38개 통과(건너뜀 없음).
- `pnpm typecheck` 통과, `pnpm lint` 통과, `pnpm test` 90 파일 1439개 전부 통과.
- 참고: 마이그레이션 적용 전(db reset 진행 중)에 돌린 전체 테스트는 통합 테스트가 깨졌다. 적용 뒤 다시 돌려 전부 통과를 확인했다.
- 커밋하지 않았다.
