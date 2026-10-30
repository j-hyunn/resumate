# R3 백엔드 QA 리포트 (라운드 1)

대상: R-67 readiness `ai_connection.consent_required`
- 마이그레이션 `supabase/migrations/20261106000200_r3_readiness_consent_required.sql`
- pgTAP `supabase/tests/readiness_consent_required.test.sql`(새), `supabase/tests/get_data_readiness.test.sql`(기대값 갱신)
- zod `src/lib/contracts/ai-connection.ts`, 테스트 4개 파일
- 기준 문서(읽기 전용, main): `/Users/jehyun/Resumate/docs/planning/04-data-model.md` 2.11.7 마지막 항목(687행), 6장(925–926행) / `02-user-flows.md` C-18(799행), C-20(844–845행), FL-20(613행), S-40(1299·1305행)

## 검사 실행 결과
`bash .claude/skills/backend-integration-qa/scripts/run-checks.sh --build` (로컬 스택, 마이그레이션 20261106000200 적용 확인 뒤)

| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck | 통과 | |
| lint | 통과 | |
| vitest | 통과 | 90 파일, 1439 테스트, 건너뜀 0(통합 테스트 포함 실행됨) |
| build (`pnpm build`) | 통과 | |
| pgTAP | 통과 | 46 파일, 2177 테스트. `readiness_consent_required.test.sql`, `get_data_readiness.test.sql` 모두 ok |

## 경계면 검사
| # | 경계 | 결과 | 이슈 |
|---|------|------|------|
| Q1 | DM 6장·2.11.7 ↔ 마이그레이션 | 통과 — 이름 `consent_required`, 타입 boolean\|null, 활성 공급자 없음 → null, `key_status`와 따로 계산(invalid 키도 값 계산), DM 예시 JSON과 모양 같음 | — |
| Q2 | 마이그레이션 ↔ 생성 타입 ↔ 쿼리 | 통과 — `get_data_readiness` 반환이 `Json`이라 `database.types.ts` 변화 없음(db-engineer 재생성 확인). 앱은 zod `DataReadiness`로 파싱 | — |
| Q3 | RPC 반환 ↔ 호출처 | 통과 — 아래 "판정 규칙 동일성", "소비처" 참고 | — |
| Q4 | raise 코드 ↔ 오류 매핑 | 해당 없음(새 코드 없음, 거부 경로 ③④⑤ 그대로 `key_missing`) | — |
| Q5 | 계약 ↔ 서비스 ↔ 화면 명세 | 통과 — zod 필드명 = DB 키 = UX C-18/S-40 표기 | — |
| Q6 | SSE | 해당 없음 | — |
| Q7 | AI 출력 ↔ 저장 | 해당 없음 | — |
| Q8 | 열거값 DB ↔ TS | 해당 없음(새 열거값 없음) | — |
| Q9 | 작업 종료·사용 기록 | 해당 없음(서버 거부 동작 변경 없음 확인) | — |
| Q10 | 보안·권한 | 통과 — 아래 "보안" 참고 | — |
| Q11 | UI ↔ 백엔드 | 해당 없음 — `src/lib/mock`, `src/lib/data`, `src/types/db.ts` 없음. 연결 대기 | — |
| 추가 | 회귀(`next_action`·힌트) | 통과 | — |
| 추가 | 판정 규칙 동일성 테스트 | 이슈(경미) | QA-01 |

### 판정 규칙 동일성 (check_ai_run_allowed / retry_ai_job)
- 새 정의 `20261106000200_r3_readiness_consent_required.sql:25-28`: 활성 공급자·키가 있으면 `not private.ai_consent_allows_run(p.id, k.provider, k.connection_tier)`. 키는 `k.provider = p.active_ai_provider` 조인(31행)이라 `k.provider` = 활성 공급자, `k.connection_tier` = 활성 키의 현재 등급.
- `retry_ai_job` `20261106000100_r2_retry_ai_job.sql:116-126`: 활성 공급자 `v_active` + 그 키의 `connection_tier` `v_key_tier`로 같은 헬퍼 호출 → 인자 동일.
- `check_ai_run_allowed` `20261029000700_s3b_check_ai_run_allowed.sql:61-73`: 작업의 provider + 그 키의 현재 등급으로 같은 헬퍼 호출. 작업 공급자 = 활성 공급자일 때 인자 동일(A1 변경으로 실행·재시도는 활성 공급자로 돌므로 화면 판단 기준과 맞음).
- `private.user_ai_run_allowed`(S5, `20261031000400:57-66`)와 `save_provider_key`(R1 `20261105000500:76`)도 같은 헬퍼. `ai_consent_allows_run` 자체는 R3에서 바뀌지 않았다(재정의 없음 — 정의는 S3b 1곳뿐).
- 경로 ④(AI 작성 대화 턴)와 S-40 `needsConsent`는 TS 미러 `mayRunWithConsent`(`src/server/services/ai-connection/consent.ts:93-107`)를 쓴다. 규칙(철회 안 된 최신 동의 → 그 버전이 시행 중 → 그 뒤 시행된 `requires_reconsent` 없음)은 SQL 헬퍼와 같음을 대조했다. R3 이전부터 있던 구조라 이슈로 올리지 않는다.

### null 의미
- `p.active_ai_provider is null or k.id is null` → null(25-26행). 다른 세 필드도 같은 left join에서 null이 되므로 네 필드가 함께 null.
- 로그인 사용자 프로필 행이 없을 때(이론상)도 네 필드 모두 null — 기존 동작과 같음.
- pgTAP: 키 삭제(FK로 활성 공급자 해제) → 모두 null, 키는 있지만 활성 공급자 없음 → 모두 null. Vitest `career.integration.test.ts:230` 키 없는 사용자 → 네 필드 null(zod 경유).

### 보안·권한
- `security definer`, `set search_path = ''`, `revoke all ... from public`, `grant execute ... to authenticated, app_ai_writer` — S3b 원래 정의(`20261029000600:6-23`)와 같다. `create or replace`라 소유자 유지.
- `ai_consent_allows_run`은 invoker·소유자 전용 그대로. definer 함수 안에서 `p.id = auth.uid()`로만 부르므로 다른 사용자의 동의 상태는 나오지 않는다(pgTAP: B의 동의가 A에 반영되지 않음 확인).
- 새로 드러나는 정보는 본인 동의 상태 boolean 하나. 암호 컬럼·동의 행 내용은 나가지 않는다. `app_ai_writer`는 동의 테이블을 직접 못 읽지만 이 boolean은 받는다 — 기존 세 필드와 같은 경로이고 DM 6장이 readiness 필드로 정한 값이라 문제 없음.
- pgTAP가 권한을 고정: definer 유지, authenticated·app_ai_writer 실행 가능, anon 불가, `ai_consent_allows_run`은 authenticated 실행 불가.

### 소비처 (current_ai_connection / readiness `ai_connection`)
- DB: `private.current_ai_connection()` 호출처는 `public.get_data_readiness()`뿐(최신 정의 R1 `20261105000400:116`). 앱 코드 직접 호출 없음. `get_account_deletion_summary`의 `ai_connection`은 이름만 같은 별개 객체(개수 집계, `20261104000200:65`, `src/server/services/account/index.ts:39`) — 영향 없음.
- zod: `ReadinessAiConnection`(`src/lib/contracts/ai-connection.ts:198-211`)에 `consent_required: z.boolean().nullable()` 필수. `DataReadiness.ai_connection`(`career.ts:373`)이 이 스키마를 그대로 씀.
- `getDataReadiness`(`src/server/services/career/rpc.ts:29`) 호출처 전부 이 zod로 파싱: actions/career.ts, writing-chat/pipelines.ts(app_ai_writer 세션 — pgTAP로 같은 값 확인), drafts(ranking·career-description·cover-letter), insight/start.ts, interview/start.ts, interview/read.ts.
- `InterviewPrepView.aiConnection`(`src/lib/contracts/interview.ts:271`)은 `ReadinessAiConnection` 타입이고 `interview/read.ts:215`가 파싱된 readiness 값을 그대로 넘김 → 필드 자동 포함. 이 타입을 품는 다른 뷰는 없다(grep `ReadinessAiConnection|ai_connection|aiConnection`).
- 테스트 가짜(`src/test/draft-fakes.ts:206`, `insight/start.test.ts:72`)는 `features`만 만들고 `as never` — `ai_connection`을 읽지 않으므로 영향 없음.
- `isAiLocked`는 그대로이며 `consent_required = true`여도 잠그지 않음(UX C-18 "실행 버튼은 잠그지 않되 C-21을 먼저 연다"와 일치). 테스트로 고정됨.

### 회귀 (`next_action`·힌트)
- `get_data_readiness()`는 재정의되지 않았다. 판정은 `v_ai_connection->>'active_provider'`·`->>'key_status'`만 본다(`20261105000400:128`) → 새 키가 판정에 끼지 않음.
- `get_data_readiness.test.sql` 변경은 `ai_connection` 전체 비교 4곳의 기대 객체에 키를 더한 것뿐이고 `next_action`·`hints`·`missing` 기대값은 그대로. 전체 통과.

## 이슈

### QA-01 [Minor] readiness ↔ 실행 게이트 일치를 같은 상태에서 함께 보는 테스트가 없음
- 담당: db-engineer
- 근거: `supabase/tests/readiness_consent_required.test.sql` 전체 — `consent_required` 값만 단정한다. 같은 상태에서 `check_ai_run_allowed(job)` / `retry_ai_job`이 `consent_required` / `ai_consent_required`를 내는지 나란히 보지 않는다. 지금은 세 곳이 같은 헬퍼를 같은 인자로 부르는 것(코드 대조)으로만 보장된다.
- 수정 제안(선택): 이 파일에 활성 공급자의 `failed`/`running` 작업 하나를 두고, 동의 없음·재동의 고지·등급 불일치 각 상태에서 `consent_required = true` ⇔ `check_ai_run_allowed(job) = 'consent_required'`를 함께 단정. 나중에 어느 한쪽이 헬퍼를 안 쓰게 바뀌면 바로 잡힌다.
- 상태: 열림 (막는 이슈 아님 — 머지 판단에 영향 없음)

## 참고 (이슈 아님)
- 같은 "동의 필요" 사실을 세 곳이 계산한다: readiness(SQL 헬퍼), S-36 `readChatConnection().lock`(`writing-chat/chat.ts:77`, TS 미러), S-40 `consentStateOf().needsConsent`(TS 미러). 규칙은 같다. 차이는 (1) 대화 lock은 `key_status = invalid`면 `key_invalid`를 먼저 보이고 동의를 보지 않는다(잠금 우선순위상 맞음), (2) TS 미러의 동률 정렬이 ms 단위(SQL은 µs)라 같은 ms 안에 동의 행 두 개가 생긴 극단적 경우만 이론상 다를 수 있다. R3 이전부터의 구조.

## 스펙 차이 (spec-gaps.md로 넘긴 항목)
- 없음. DM 6장은 "활성 공급자가 없으면 null"만 적었고 구현은 "활성 키 없음"도 null로 했다. `profiles(id, active_ai_provider)` → 키 FK로 두 상태가 같아 차이가 아니다.

## 라운드 요약
- 막는 이슈 0, Minor 1(선택). 모든 검사 통과(typecheck·lint·Vitest 1439·build·pgTAP 2177). 커밋 안 함, 원격 적용 없음.
