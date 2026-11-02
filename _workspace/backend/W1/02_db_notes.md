# W1 DB 노트: 가입 필수 동의에서 `cross_border_transfer` 제외 (spec-gaps ⑲)

2026-11-02. 커밋 없음. 로컬 스택만 썼고 `supabase migration up`으로 적용했다(`db reset` 안 함).

## 바꾼 것
- 마이그레이션 `20261108000100_w1_signup_consent_required_set.sql`: `get_consent_status`, `record_consents`, `private.consents_before_insert`의 필수 목록을 `terms`, `privacy_required`로 줄였다. 시그니처와 권한은 그대로다. 생성 타입 차이 없음(`database.types.ts` 변경 없음).
- `cross_border_transfer`는 `consent_type`·`policy_type` 값으로 남는다. `get_consent_status`에는 5행 그대로 나오고 이 행은 `required = false`, `needs_consent = false`다. 새 버전이 시행돼도 S-03으로 돌려보내지 않는다.
- 필수가 아니므로 `agreed = false`로도 기록할 수 있다(RPC, 직접 insert).
- `REQUIRED_CONSENT_TYPES`는 2개. 시험 수정: `s1-contracts.test.ts`, `consent.test.ts`, `consent.integration.test.ts`, `consents.test.sql`, `common_functions.test.sql`.
- 새 시험 `supabase/tests/signup_consent_ai_gate.test.sql`.
- 문서: DM A.2 `consents` 행과 "필수 동의" 줄, 변경 이력 v4.3b. spec-gaps ⑲ 해소 표시.

## AI 게이트 확인
`consents`의 `cross_border_transfer`를 읽는 AI 게이트는 없다. `check_ai_run_allowed`, `retry_ai_job`, `save_provider_key`, `create_application_project`, `get_data_readiness`는 모두 `private.ai_consent_allows_run`을 쓰고, 이 함수는 `ai_data_use_consents`와 `ai_disclosures`만 읽는다.

| 경로 (DM 2.11.7) | `terms` + `privacy_required`만 있는 사용자 | 확인 방법 |
|------|------|------|
| S-03 게이트 | 통과 | pgTAP |
| 키 저장 `save_provider_key` | `consent_required`, 키 행 없음 | pgTAP |
| ② 같은 행 다시 시도 | 키 없음 `key_missing`, 키 있고 C-21 없음 `ai_consent_required` | pgTAP |
| ③ 실행 중 단계 확인 | 키 없음 `key_missing`, 키 있고 C-21 없음 `consent_required`(실행기가 `key_missing`으로 끝냄, `mapRunGate`) | pgTAP(RPC 값), 코드 읽음(변환) |
| ⑥ 지원 프로젝트 생성 | 키 없음은 AI 없이 저장(`ai_run_allowed: false`), 키 있고 C-21 없음 `ai_consent_required` | pgTAP |
| readiness | 키 없음 `null`, 키 있고 C-21 없음 `true` | pgTAP |
| ①·④·⑤ | 서비스 계층 판정. 이번 시험으로 돌리지 않았다 | 코드만 읽음 |

`cross_border_transfer`에 동의해도 ②·③·readiness는 그대로 거부한다. C-21 뒤에는 ②·③·⑥·readiness가 모두 풀린다(pgTAP).

## 결과
- `supabase test db`: 51개 파일, 2383개 전부 통과. 이 중 `consents` 51, `signup_consent_ai_gate` 22, `common_functions` 5.
- `pnpm typecheck`: 통과.
- Vitest(인증·동의만): 9개 파일, 94개 통과, 건너뜀 없음. 로컬 스택 통합 시험(`consent.integration`, `magic-link.integration`) 포함.
- Vitest 전체는 돌리지 않았다.

## 남은 것
- **사용자 보고 필요**: ⑲ 원문은 "동의 범위는 법무에 닿아 사용자가 정한다"고 적었다. 이번 변경은 리더 결정(`decisions.md`)이고, 사용자가 확정한 것은 D-39다. D-39의 법무 확인은 아직 열려 있다.
- **바꾸지 않음**: `consents_withdrawn_at_check`와 update 정책은 선택 동의만 철회를 허용한다. 예전에 받은 `cross_border_transfer` 행은 계속 철회할 수 없다. 지시 범위(필수 목록) 밖이라 두었다.
- **기존 동작, 이번 변경과 무관**: `AI_DEV_PROVIDER`·`AI_DEV_API_KEY`를 설정한 비운영 환경은 실행 게이트를 건너뛴다(`jobs/connections.ts`, `NODE_ENV=production`이면 꺼짐).
- **옛 상태로 남은 글**: `W1/02_api_notes.md`의 "차단 1건" 부분(api 소유, 고치지 않음). DM 머리말의 버전·상태 줄도 v4.3a 그대로다(지시 범위 밖).
