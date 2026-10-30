# S9 백엔드 QA 리포트 (라운드 1)

> 범위: S9 계정·보관(HEAD 대비 미커밋 변경 전체) + 마지막 슬라이스 전체 점검.
> 실행 순서: `supabase db reset`(성공) → `run-checks.sh --build`. 코드 수정·커밋 없음.
> 요약: Critical 0 · Major 0 · Minor 6. 모두 열림이다(이번 실행에서는 수정 라운드를 돌리지 않았다).

## 검사 실행 결과
| 검사 | 결과 | 비고 |
|------|------|------|
| `supabase db reset` | 통과 | S1~S9 마이그레이션 전부 적용 |
| typecheck | 통과 | `next typegen && tsc --noEmit` |
| lint | 통과 | eslint |
| vitest | 통과 | 87파일 1348개, skip 0. S9 3파일 21개를 verbose로 다시 돌려 통합 테스트(`account.integration.test.ts` 4개)가 skip 없이 실제로 돈 것을 확인 |
| build | 통과 | `/api/cron/retention` 라우트 포함 |
| pgTAP | 통과 | 43파일 2025개 (`account_deletion` · `retention_purge` 포함) |
| 생성 타입 최신 여부 | 통과 | `supabase gen types --local` 결과가 `src/server/db/database.types.ts`와 같다 |
| 수동 확인(psql, 실제 `authenticated` 역할 + jwt claims) | 통과 | 요약 RPC가 42501 없이 동작, `delete_account` 2회(`log_written` true → false), 로그 1행, `service_role`은 purge 실행 가능, `authenticated`는 `permission denied` |

## 경계면 검사
| # | 경계 | 결과 | 이슈 |
|---|------|------|------|
| Q1 | DM ↔ 마이그레이션 | 통과. A.17 컬럼(`subject_hash`·`requested_at`·`db_deleted_at`·`storage_deleted_at`·`reason`) 일치. §4.4 보관 기간(90일·13개월·3년)과 §4.3 요약 그룹이 S-25와 일치한다 | — |
| Q2 | 마이그레이션 ↔ 타입 ↔ 쿼리 | 통과. 타입 재생성 일치. `.rpc("get_account_deletion_summary" / "delete_account" / "purge_*")` 이름과 인자(`p_subject_hash`, `p_now`, `p_limit`)가 맞다 | — |
| Q3 | RPC 반환 ↔ 호출부 | 통과. 요약 jsonb의 snake_case 키 16개가 `toAccountDeletionSummary`와 맞다. purge는 integer를 반환하고 `typeof data === "number"`로 확인한다 | — |
| Q4 | raise 코드 ↔ 오류 매핑 | 이슈. `invalid_subject_hash`·`invalid_now`·`invalid_limit`·`not_authenticated`는 매핑돼 있다. 그런데 db 노트가 요구한 40P01 재시도가 없다 | QA-S9-01 |
| Q5 | contracts ↔ 처리부 ↔ 화면 명세 | 통과. S-25 그룹(커리어 7, 기업 JD 5, AI 연결 3)과 NFR-KEY-09 플래그가 맞다. 확인 방식과 이동 경로는 `[가정]`으로 spec-gaps에 있다 | — |
| Q6 | SSE | 해당 없음 | — |
| Q7 | AI 출력 ↔ 저장 | 해당 없음(S9에는 AI가 없다). 전체 점검 항목은 아래에 있다 | — |
| Q8 | enum DB ↔ TS | 통과(`reason`은 TS에서 쓰지 않는다). `job_type` 전체 점검은 아래 QA-S9-06 | QA-S9-06 |
| Q9 | 작업 종료 경로 | 이슈(경미). 진행 중 작업은 행째 지워지므로 heartbeat 0행 → `current:false`(`supabase-store.ts:251-265`). `get_provider_key_secret`은 작업 행이 없으면 `key_not_available`을 낸다. 구조는 맞지만 이 경로를 확인하는 테스트가 없다 | QA-S9-05 |
| Q10 | 보안·개인정보 | 이슈(경미). RLS·권한 매트릭스, 로그 비식별(HMAC, FK 없음), 키 hard delete, 로그 grep은 통과다. 실행기와의 잠금 순서 주장은 일부가 틀렸고(QA-S9-02), 전역 권한 허용 목록에 빈틈이 있다(QA-S9-04) | QA-S9-02, QA-S9-04 |
| Q11 | UI ↔ 백엔드 | 해당 없음. S-24/S-25 화면과 mock이 없다(A1 연결 대기) | — |

### S9 집중 확인 결과(통과 항목 근거)
- **탈퇴 완전성**
  - 카탈로그 기준 `user_id` 테이블은 28개(`profiles`는 별도)이고, `delete_account`의 명시적 delete 대상도 28개와 `profiles`로 같다(`20261104000200:105-155`).
  - public 테이블 중 `auth.users`를 참조하는 것은 `user_id` 테이블과 `profiles`뿐이고 모두 `on delete cascade`다. 그래서 RPC와 auth 삭제 사이에 늦게 들어온 행(예: 실행기의 사용 기록)도 auth 삭제가 연쇄로 지운다.
  - `profiles`를 참조하는 FK는 없다.
  - pgTAP이 목록을 고정해 두었고, 카탈로그와 `set_eq`로 비교한다(`account_deletion.test.sql:41-63`).
- **멱등**: advisory xact lock을 쓰고, `subject_hash`가 unique이며 `on conflict do nothing`이다. psql로 두 번 호출해 확인했다.
- **로그 비식별**
  - HMAC-SHA256(서버 비밀값, `"account:"+id`)를 쓴다(`services/account/index.ts:82-84`).
  - user id·이메일 컬럼과 FK가 없다.
  - RLS는 켜져 있고 정책은 없다. service_role은 SELECT·DELETE만 가진다.
- **키**: `ai_provider_keys`를 hard delete하고, `profiles.active_ai_provider`는 set null이 된다.
- **액션 순서**
  - 순서는 비밀값 확인 → 취소 요청 → RPC → auth 삭제 → 로그아웃이다.
  - RPC가 실패하면 auth 삭제와 로그아웃을 하지 않는다.
  - auth 삭제가 실패하면 `account_deletion_incomplete`를 내고 세션을 남긴다. 404는 성공으로 본다.
  - 동의 게이트 없이 `requireUser`만 쓴다.
  - 로그는 step과 개수만 남긴다.
- **로그아웃**: auth-js `_signOut`은 404·401·403에도 `_removeSession`을 한다(`@supabase/auth-js@2.118.0 GoTrueClient.js:3440-3455`). 사용자가 지워진 뒤에도 쿠키가 지워진다.
- **purge RPC**
  - 경계: 대화 `< 90일`, 작업 `coalesce(finished_at, created_at) < 90일`, 사용 기록 KST 달 기준, 로그 3년.
  - `limit p_limit`과 `for update skip locked`를 쓴다.
  - 권한은 service_role만이다.
  - 진행 중 작업과, 진행 중 턴이 있는 대화는 남긴다.
  - `writing_chats`는 `saved`·`handed_off`이면 `project_id not null` CHECK가 있으므로, 미연결이면 active·abandoned뿐이다.
- **작업 정리가 결과 행에 주는 영향**
  - `ai_jobs`를 참조하는 FK 9개는 모두 `ON DELETE SET NULL (col)`이다.
  - 그 컬럼들은 모두 nullable이다.
  - 그 컬럼을 참조하는 CHECK나 갱신 차단 트리거가 없다(`job_descriptions_guard`는 `extraction_job_id`를 보지 않는다).
  - `ai_usage_records.ai_job_id`와 `writing_chat_messages.ai_job_id`는 soft 참조다.
- **크론**
  - 인증은 `isCronAuthorized`(timing-safe)로 한다.
  - 배치는 5,000행 × 최대 4회이고, 마지막 호출이 꽉 차 있으면 `hasMore`에 넣는다.
  - 한 정리가 실패해도 나머지를 실행하고 500을 돌려준다.
  - proxy가 보호하는 경로에 `/api`가 없다.
- **vercel.json**: 02:00·03:00 KST = `0 17`·`0 18` UTC이고 맞다.
- **env**
  - `ACCOUNT_DELETION_HASH_SECRET`은 선택이고, 32자 이상·고유 문자 16개 이상이어야 한다.
  - 빈 값은 undefined로 처리돼 fail closed한다.
  - 오류 메시지에 값이 나오지 않는다(테스트 있음).
  - `.env.example`에는 빈 값으로 들어 있다.

## 이슈

### QA-S9-01 [Minor] 40P01(교착) 한 번 재시도가 api에 없다
- 담당: api-engineer
- 근거
  - db 노트 `02_db-engineer_notes.md` "잠금 근거" 마지막 항목과 마이그레이션 주석 `supabase/migrations/20261104000200_s9_account_deletion_rpcs.sql:19-21`은 "Postgres then aborts one side with 40P01 and the API retries once"라고 한다.
  - `src/server/services/account/index.ts:142-146`은 `rpcError`를 그대로 `mapDbError`에 넘긴다.
  - `src/server/db/errors.ts:251`에서 40P01은 기본값 `internal_error`(500)가 된다.
- 영향
  - 다른 탭 편집이나 실행기(QA-S9-02)와 겹치면 탈퇴가 "일시적인 오류"로 실패한다.
  - 데이터는 롤백되므로 안전하다. 사용자가 다시 누르면 성공한다.
- 수정 제안
  - `rpcError.code === "40P01"`이면 `delete_account`를 한 번 더 부른다. 같은 hash를 쓰고, RPC가 멱등이다.
  - 단위 테스트를 추가한다: 첫 호출 40P01 → 두 번째 성공 → auth 삭제 1회.
  - 덧붙여 `index.ts:123-124`의 주석 "The RPC also marks them"은 실제 동작(행째 삭제)과 다르다. 함께 고친다.
- 상태: 열림

### QA-S9-02 [Minor] "실행기와는 교착이 없다"는 잠금 순서 주장이 S4 `begin_assistant_message`와 맞지 않는다
- 담당: db-engineer
- 근거
  - `supabase/migrations/20261104000200_s9_account_deletion_rpcs.sql:18-19` 주석: "The AI runner (app_ai_writer) never waits on a lock in the reverse direction".
  - 같은 파일 `:130-132`는 "S4 runner locks message -> chat"이라 하고, 메시지를 지운 뒤 대화를 지운다.
  - 실제 S4 `begin_assistant_message`(`20261030000300_s4_writing_chat_message_rpcs.sql:261-263`)는 `writing_chats … for update`로 대화를 먼저 잠근다. 그 다음 `:295`(실패 메시지 재사용)·`:311`(죽은 streaming 정리)에서 메시지를 update한다. 즉 대화 → 메시지 순서이고, 탈퇴와 반대 방향이다.
  - `append_writing_chat_message`(`:182-184`)도 대화를 먼저 잠근다. `finish_assistant_message`(`:362-364`)는 메시지 → 대화 순서다. S4 안에 두 순서가 다 있으므로 어느 쪽을 골라도 한쪽과는 반대가 된다.
- 영향
  - 다음 순서로 겹치면 40P01이 난다.
    1. 탈퇴가 메시지를 지운다.
    2. 실행기가 턴 시작에서 대화를 잠그고 재사용 메시지를 update한다.
    3. 탈퇴가 대화를 지운다.
  - 창이 짧고 데이터는 롤백되므로 Minor다.
  - 노트·spec-gaps ④의 "AI 실행기와는 같은 잠금 순서라 교착이 없다"는 설명이 틀렸다.
- 수정 제안
  - 주석, 노트, spec-gaps S9(db) ④를 "S4 대화 RPC와도 40P01 가능 → api 재시도(QA-S9-01)"로 고친다.
  - 원하면 메시지 삭제 전에 `writing_chats`를 id 순서로 `for update`해서 begin·append와 순서를 맞춘다. 남는 `finish_assistant_message` 방향은 재시도로 처리한다.
- 상태: 열림

### QA-S9-03 [Minor] service role 키가 없으면 public 데이터를 지운 뒤에야 실패한다
- 담당: api-engineer
- 근거
  - `src/server/jobs/service-role.ts:43`은 `deleteAuthUser`의 기본 인자에서 `createServiceRoleClient(...)`를 만든다. `SUPABASE_SERVICE_ROLE_KEY`가 없으면 `:26-28`에서 throw한다.
  - 이 호출은 `src/server/services/account/index.ts:151`, 즉 RPC(`:142`) 뒤에 있다.
  - 해시 비밀값은 `:117-120`에서 미리 확인해 fail closed하지만, service role 키는 그렇지 않다.
- 영향
  - 설정이 빠진 배포에서는 모든 탈퇴가 데이터만 지우고 `account_deletion_incomplete`로 끝난다.
  - 설정을 고칠 때까지 재시도도 계속 실패하고, auth 계정과 세션이 남는다.
- 수정 제안
  - 1단계 전에 service role 클라이언트를 만들거나 env를 확인한다. 예: `DeleteAccountDeps`에 `assertAuthAdminReady()`를 두거나, 액션에서 클라이언트를 먼저 만들어 주입한다.
  - 없으면 아무것도 지우지 않고 `internal_error`를 낸다.
  - 단위 테스트를 추가한다: 키가 없으면 RPC 호출 0회.
- 상태: 열림

### QA-S9-04 [Minor] `grants.test.sql`에 전역 허용 목록 세 가지가 없다
- 담당: db-engineer
- 근거
  - (a) "public의 모든 테이블에 RLS가 켜져 있다"는 카탈로그 전역 단정이 없다. 테이블별 단정만 있고(`grep relrowsecurity supabase/tests/*.sql`), 새 테이블이 테스트 없이 들어오면 잡지 못한다.
  - (b) `authenticated`가 실행할 수 있는 public 함수의 전역 허용 목록이 없다. `anon`(`:27-33`)과 `app_ai_writer`(`:122-136`)만 있다.
  - (c) service_role 전용 함수 단정(`grants.test.sql:316-323`)은 `p.proname in ('sweep_stalled_ai_jobs','claim_due_ai_jobs')`로 미리 걸러서 새 함수를 잡지 못한다. S9 `purge_*` 4개도 이 목록에 없다(`retention_purge.test.sql`에서만 확인).
- 현재 상태(수동 카탈로그 조회)
  - RLS가 꺼진 public 테이블은 0개다.
  - `anon`이 실행할 수 있는 public 함수는 0개다.
  - PUBLIC에 EXECUTE가 남은 public·private 함수는 0개다.
  - `search_path`가 없는 definer 함수는 0개다.
  - service_role 전용 함수는 정확히 sweep·claim·purge 4개다.
  - `authenticated`가 실행할 수 있는 public 함수는 33개다.
  - 지금은 새는 곳이 없다. 회귀를 막는 장치가 없을 뿐이다.
- 수정 제안
  - `grants.test.sql`에 세 가지를 추가한다.
    - `is_empty`(RLS 꺼진 public 테이블)
    - `set_eq`(authenticated 실행 가능 함수 전체 목록)
    - `set_eq`(service_role 전용 함수 전체 목록, 이름 필터 없이, purge 4개 포함)
- 상태: 열림

### QA-S9-05 [Minor] 탈퇴·정리의 경계 동작 중 테스트가 없는 두 가지
- 담당: db-engineer
- 근거
  - (a) 탈퇴 뒤 실행기 동작을 확인하는 테스트가 없다. 확인할 것은 다음 두 가지다.
    - `ai_jobs` heartbeat update가 0행이 되는 것
    - `get_provider_key_secret(job)`가 `key_not_available`을 내는 것
  - `account_deletion.test.sql`·`account.integration.test.ts:148-161`은 작업 행이 0개인지만 본다. 계획의 핵심 요구("in-flight jobs: runner ends as lost; no key fetch after")가 구조 설명으로만 남아 있다.
  - (b) `retention_purge.test.sql:65-96`의 작업 정리 set null 확인은 `insights.ai_job_id`만 본다. 나머지 8개 FK는 확인하지 않는다: `drafts`, `draft_sections`, `interview_questions`, `answer_evaluations`, `session_feedbacks`, `interview_sessions.question_job_id`·`evaluation_job_id`, `job_descriptions.extraction_job_id`.
  - 카탈로그로 확인한 바로는 막는 CHECK나 트리거가 없다. 다만 나중에 그런 것이 생기면 정리 한 배치 전체가 매일 실패하는데, 이를 잡을 테스트가 없다.
- 수정 제안
  - pgTAP에 다음을 추가한다.
    - running 작업이 있는 사용자를 탈퇴시킨 뒤 `app_ai_writer` 클레임으로 `get_provider_key_secret`을 불러 `throws_ok … 'key_not_available'`인지 확인
    - 작업 정리 픽스처에 위 FK마다 결과 행 1개씩 넣고, 정리 뒤 행이 남아 있고 해당 컬럼이 null인지 확인
- 상태: 열림

### QA-S9-06 [Minor] `writing_assist`·`chat_reply` 작업 유형은 등록도, 요청 범위 목록도 아니다
- 담당: api-engineer
- 근거
  - DB CHECK `ai_jobs_job_type_check`와 `src/lib/contracts/enums.ts:81-92`에는 11개 값이 있다.
  - 실행기에 등록된 유형은 3개다: `insight`, `interview_questions`, `interview_evaluation`(`src/server/jobs/definitions.ts:11-13`).
  - 요청 범위 유형은 6개다(`src/server/jobs/runner.ts:58-65`).
  - `writing_assist`·`chat_reply`는 어디에도 없고, 지금은 만드는 코드도 없다(grep 결과 `cost.ts:54-55` 매핑뿐).
  - "모든 작업 유형은 등록됐거나 요청 범위다"라는 불변식을 확인하는 테스트가 없다.
- 영향: 지금은 도달할 수 없다. 나중에 누가 이 유형으로 작업을 만들면 재시도·크론 이어 실행이 정의 없이 돌아간다.
- 수정 제안
  - `AI_JOB_TYPES`의 각 값이 셋 중 하나인지 확인하는 단위 테스트를 둔다: 등록됨, `REQUEST_SCOPED_JOB_TYPES`, 명시적 `UNUSED_JOB_TYPES`(Should 기능용 예약).
  - `REQUEST_SCOPED_JOB_TYPES`를 export하거나 판정 함수를 노출한다.
- 상태: 열림

## 전체 점검 (S0~S9, 마지막 슬라이스)

| 항목 | 결과 | 근거 |
|------|------|------|
| 모든 public 테이블에 RLS | 통과(현재) / 회귀 장치 없음 | 카탈로그 조회 결과 RLS가 꺼진 테이블은 0개다. 전역 테스트가 없다 → QA-S9-04 |
| anon·PUBLIC 실행 가능 함수 | 통과 | anon이 실행할 수 있는 public 함수는 0개다(`grants.test.sql:27-33` 단정 + 수동 확인). PUBLIC grantee EXECUTE는 public·private 모두 0개다. `private` 스키마는 anon·app_key_reader에 USAGE가 없다 |
| definer 함수 `search_path` | 통과 | public·private의 definer 함수 중 `search_path`가 없는 것은 0개다 |
| `app_ai_writer` 쓰기 경로 | 통과(조건부) | 테이블 단위 INSERT·UPDATE·DELETE는 0개다. 컬럼 단위는 `ai_jobs`(작업 수명주기), `ai_usage_records` INSERT, `evidence_links` INSERT만 있다(DM §5, `grants.test.sql:69-110` 고정). 커리어 7개 테이블과 S5~S8 결과 테이블은 SELECT만 가능하다. 결과 쓰기 RPC는 모두 definer + `current_uid` 소유 확인이다. complete·save 계열은 모두 `run_generation`을 받는다. begin·fail 계열 일부(`begin_jd_extraction`, `fail_*`)는 세대 인자 없이 running 여부나 행 소유를 확인한다(S5~S7 QA에서 확인됨). `evidence_links` 직접 INSERT는 앱이 쓰지 않는 경로라 축소를 제안했다 → spec-gaps S9(QA) ② |
| 커리어 테이블 쓰기 금지(DM-13) | 통과 | `app_ai_writer`에는 커리어 테이블 INSERT·UPDATE 컬럼 권한이 없다(`information_schema.column_privileges` 조회) |
| 작업 유형 ↔ 실행기 | 이슈(Minor) | 9/11은 맞다. `writing_assist`·`chat_reply`는 생성 경로가 없는 예약값이다 → QA-S9-06 |
| 결과 소유자별 `evidence_links` 삭제 | 통과 | 각 소유 유형마다 삭제 트리거가 있다: `insight`(`insights_delete_evidence`), `draft_section`(`draft_sections_delete_evidence`), `interview_question`·`answer_evaluation`·`session_feedback`(`interview_delete_owner_evidence`). `chat_message`는 생산 경로가 없다(`evidence-links.ts`: AI-12 근거는 `structured_draft`에 있다). 모든 행이 `application_project_id`(not null, cascade)에 묶여 있어 고아가 생기지 않는다. 출처 쪽 9개 테이블은 `evidence_mark_source_deleted`를 쓴다 |
| 삭제 영향 범위(`get_deletion_impact`) | 통과 | 프로젝트별 `insights`, `drafts`, `draft_sections`, `interview_sessions`(S8) 집계가 함수 본문에 있다 |
| 로그 개인정보(grep) | 통과 | `src/server`·`src/app`·`src/lib`의 `console.*`는 5곳뿐이고 모두 `JSON.stringify({event,…})`다. `ai/log.ts`는 닫힌 타입이다(본문·키 필드 없음). `jobs/log.ts`는 원시값 필드만 받는다. `log(` 호출 94곳 중 민감어 패턴에 걸린 것은 모두 jobId·code·개수였다. `console.error(err)`는 없다(알 수 없는 오류의 원문은 남지 않는다). 탈퇴 로그에는 id·hash·비밀값이 없다(테스트 있음) |
| 비밀값·키 | 통과 | `.env.example`은 더미이거나 빈 값이다. 키 복호화는 `get_provider_key_secret`(app_key_reader) 한 경로뿐이고, 탈퇴 뒤에는 작업과 키가 없어 거절한다 |

## 스펙 차이 (spec-gaps.md로 넘긴 항목)
`_workspace/backend/spec-gaps.md` "2026-11-04 · S9 (QA)"
- ① `account_deletion_incomplete` 뒤 화면을 떠나면 동의 게이트(`session.ts:42-54`) 때문에 S-25에 다시 닿으려면 약관 재동의가 필요하다. UX가 진입 경로를 정해야 한다(A1 연결 때 반영).
- ② `app_ai_writer`의 `evidence_links` 직접 INSERT 권한은 쓰는 곳이 없다. DM §5에서 축소할지 검토해야 한다.

## 담당별 요약
| 담당 | 이슈 |
|------|------|
| api-engineer | QA-S9-01(40P01 재시도), QA-S9-03(service role 키 사전 확인), QA-S9-06(작업 유형 불변식 테스트) |
| db-engineer | QA-S9-02(잠금 순서 주석·노트 정정), QA-S9-04(전역 권한 테스트), QA-S9-05(탈퇴 후 키 거절·작업 정리 set null 테스트) |

---

# S9 백엔드 QA 리포트 (라운드 2, 최종)

> 범위: QA-S9-01~06 재확인과, 수정이 닿은 경계 점검. 근거는 각 담당 노트의 "QA 1차 반영" 절이다.
> 실행 순서: `supabase db reset`(성공) → `run-checks.sh --build`. 코드 수정·커밋 없음.
> 요약: 6건 중 5건은 수정 확인 완료다. QA-S9-05는 (b)만 확인됐고 (a)가 남아 **미해결**로 리더에게 넘긴다(2라운드 상한).

## 검사 실행 결과
| 검사 | 결과 | 비고 |
|------|------|------|
| `supabase db reset` | 통과 | |
| typecheck / lint | 통과 | |
| vitest | 통과 | 88파일 1363개, skip 0. S9 관련 4파일 36개(`job-types.test.ts` 포함)를 따로 다시 돌려 통과를 확인했다 |
| build | 통과 | |
| pgTAP | 통과 | 43파일 2035개 (`grants` plan 41) |
| 생성 타입 | 통과 | `supabase gen types --local`과 `database.types.ts`가 같다 |

## 이슈 재확인
| 이슈 | 결과 | 근거 |
|------|------|------|
| QA-S9-01 40P01 재시도 | 수정됨(확인 완료) | `services/account/index.ts`: 같은 hash로 RPC를 한 번 더 부르고, 두 번째도 40P01이면 `account_deletion_busy`(503)를 낸다. 이때 auth 삭제와 로그아웃은 하지 않는다. 로그는 `{step, reason}`만 남긴다. 단위 테스트 2개: 40P01 1회 → RPC 2회·같은 hash·auth 1회, 40P01 2회 → busy. 주석의 "The RPC also marks them"도 실제 동작에 맞게 고쳤다 |
| QA-S9-02 잠금 순서 | 수정됨(확인 완료) | `20261104000200:131-133`: `writing_chats … order by id for update` → chats 삭제(메시지 연쇄) → 남은 메시지 정리. S4 `begin_assistant_message`·`append_writing_chat_message`(대화 → 메시지)와 같은 방향이다. 주석(`:10-22`), 노트, spec-gaps가 남은 반대 방향(`finish_assistant_message`, 다른 탭 편집)과 재시도 대응을 정확히 적고 있다 |
| QA-S9-03 service role 키 사전 확인 | 수정됨(확인 완료) | `assertAuthAdminReady()`를 해시 비밀값 확인 직후, 취소·RPC 전에 부른다. 액션은 여기서 만든 클라이언트를 `deleteAuthUser(id, admin)`에 넘긴다. 테스트: 준비 실패 시 호출 목록이 `["assertAuthAdminReady"]`뿐이다 |
| QA-S9-04 전역 권한 테스트 | 수정됨(확인 완료) | `grants.test.sql`에 세 가지가 추가됐다: RLS 카탈로그 전역 `is_empty`, authenticated 실행 가능 함수 33개 `set_eq`, service_role 전용 카탈로그 전역 6개(시그니처 단위, anon·app_key_reader도 제외). 1라운드의 수동 카탈로그 결과(33개, 6개)와 같다. 참고: (b)는 `distinct proname`으로 비교하므로 같은 이름의 새 오버로드는 잡지 못한다. 차단 사유는 아니다 |
| QA-S9-05 (b) 작업 정리 set null | 수정됨(확인 완료) | `retention_purge.test.sql:96-`: `ai_jobs`를 참조하는 FK 9개를 카탈로그로 나열하고, 모두 정리 대상 작업을 가리키게 한다. 정리 뒤 null이 되는지, 결과 행이 남는지 확인한다 |
| QA-S9-05 (a) 탈퇴 후 키 거절 | **미해결** | 아래 QA-S9-07 |
| QA-S9-06 작업 유형 불변식 | 수정됨(확인 완료) | `REQUEST_SCOPED_JOB_TYPES`를 export했고 `writing_assist`·`chat_reply`가 들어갔다(`runner.ts:58-72`). `job-types.test.ts`는 11개 각각이 "등록됨 XOR 요청 범위"인지, 목록에 모르는 값이 없는지 확인한다. 공용 재시도는 `ai_job_not_retryable`로 막힌다 |

## 수정이 닿은 경계
- **오류 코드**
  - `account_deletion_busy`(503)와 `account_deletion_incomplete`(500)는 `ErrorCode`의 자유 문자열 영역이다(`contracts/errors.ts:47`). 기존 S-slice 관례와 같다.
  - 화면 문구가 필요하다. busy 문구는 "지운 것은 없어요"이고 incomplete 문구와 구분된다. A1 연결 때 S-25에서 두 코드를 따로 처리해야 한다.
  - spec-gaps S9(api) ⑤에 busy를 덧붙이기를 권한다(비차단).
- **PostgREST 오류 코드**: SQLSTATE가 `error.code`로 그대로 오므로 `"40P01"` 비교가 맞다.
- **잠금 변경의 부수 효과**
  - 대화 삭제 → 커리어 행의 `source_writing_chat_id` set null → `profiles` touch가 생긴다.
  - 1라운드 순서(메시지 → 대화 → 커리어)에서도 같았으므로 새 위험은 없다.
  - pgTAP 탈퇴 완전성 테스트는 그대로 통과한다.

## 이슈

### QA-S9-07 [Minor] 탈퇴 후 키 거절 테스트가 탈퇴 없이도 통과한다(QA-S9-05 (a) 미완)
- 담당: db-engineer
- 근거
  - `supabase/tests/account_deletion.test.sql:292-297`은 작업 `…0002`(running)와 `…0003`(queued)에 `get_provider_key_secret`을 불러 `key_not_available`을 기대한다.
  - 그런데 픽스처(`:109-118`)가 작업을 넣을 때 `heartbeat_at`을 넣지 않는다(null). `get_provider_key_secret`은 `status = 'running' and heartbeat_at >= now() - 2분`일 때만 키를 준다. queued 작업은 상태 때문에 항상 거절된다.
  - 수동 재현(psql, 롤백): 키와 running 작업이 있고 heartbeat가 없는 사용자는 **탈퇴 전에도** `ERROR: key_not_available`이다. 같은 작업에 `heartbeat_at = now()`를 넣으면 키 1행을 받는다.
  - 즉 두 단정은 `delete_account`가 키나 작업을 지우지 않아도 통과한다.
  - heartbeat 0행 단정(`:283-290`)은 조건(id, 세대 1, 진행 중 상태)이 탈퇴 전에는 맞으므로 의미가 있다. 다만 대조 단정이 없다.
- 수정 제안
  - 픽스처에서 running 작업 `…0002`에 `heartbeat_at = now()`를 넣는다.
  - 탈퇴 **전에** app_key_reader로 같은 호출이 키 1행을 돌려주는지 대조 단정을 추가한다.
  - queued 작업 단정은 빼거나, 대조가 불가능하다고 주석을 단다.
  - heartbeat에도 "탈퇴 전 update 1행"(savepoint 후 롤백) 대조를 추가하기를 권한다.
- 영향
  - 테스트 신뢰도 문제이고 동작 결함은 아니다.
  - 동작 자체는 1라운드 수동 조회로 확인했다: 작업 행이 없으면 key_not_available이다.
- 상태: 미해결(2라운드 상한, 리더에게 넘김)

## 최종 상태
| 심각도 | 열림·미해결 |
|--------|-------------|
| Critical | 0 |
| Major | 0 |
| Minor | 1 (QA-S9-07, db-engineer, 테스트 보강) |

- 1라운드 "전체 점검" 결론은 그대로다. 이번 수정으로 RLS·authenticated·service_role 허용 목록이 테스트로 고정되면서 회귀 장치가 생겼다.
- spec-gaps S9(QA) ①·②는 기획·UX 확인 대기다.
