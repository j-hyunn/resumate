# S9 API 구현 노트 (계정 탈퇴 · 보관 크론)

> 상태: 구현 완료. `pnpm typecheck`·`pnpm lint` 통과, `pnpm test` 88 파일 1363개 전부 통과(QA 1차 반영 후)(로컬 스택 통합 포함, skip 0). 커밋·배포하지 않음.
> 연결(wiring): UI 화면(S-24/S-25) 없음 → A1 settings·deletion "연결 대기". `src/lib/data`는 건드리지 않음.

## 엔드포인트 (계획 "계약 — API" ↔ 파일)
| 작업 | 방식 | 파일 · 함수 |
|------|------|-------------|
| S-25 삭제 범위 (DM §4.3) | Server Action | `src/server/actions/account.ts` `getAccountDeletionSummary()` → `src/server/services/account/index.ts` `getAccountDeletionSummary` (RPC `get_account_deletion_summary`, 사용자 세션) |
| FL-07 회원 탈퇴 | Server Action | `src/server/actions/account.ts` `deleteAccount({ confirm: true })` → `services/account` `deleteAccount` |
| 보관 크론 | `GET /api/cron/retention` (`Authorization: Bearer CRON_SECRET`) | `src/app/api/cron/retention/route.ts` → `src/server/jobs/retention.ts` `runRetentionCron` |
| 크론 등록 | `vercel.json` | `/api/cron/ai-jobs` 매일 02:00 KST(`0 17 * * *`), `/api/cron/retention` 매일 03:00 KST(`0 18 * * *`) |
| service role 클라이언트 | 공용 모듈 | `src/server/jobs/service-role.ts` `createServiceRoleClient`, `deleteAuthUser` (기존 `cron.ts`의 내부 함수를 옮김. 호출처 3곳을 파일 주석에 적음) |

- 두 액션은 `requireUser`만 쓴다(약관 동의 게이트 없음): 새 약관 미동의 상태에서도 탈퇴할 수 있어야 하고, auth 삭제 실패 후 재시도 때는 동의 행이 이미 없다.

## 계약 (`src/lib/contracts/account.ts`)
- `AccountDeletionSummary`
  - `career { experiences, educations, projects, projectDetails, achievements, skills, writingChats }`
  - `applications { applicationProjects, insights, drafts, interviewSessions, stageEvents }`
  - `aiConnection { providerKeys, dataUseConsents, usageRecords }`
  - `recommendProviderKeyRevocation: boolean` — NFR-KEY-09 안내("공급자 사이트에서도 키를 폐기하는 것을 권해요") 표시 플래그. RPC `has_provider_keys`(= 키 수 > 0). 키 값은 어디에도 없다.
  - RPC jsonb(snake_case, db 노트) → DTO 매핑은 `toAccountDeletionSummary`. 음수·누락 값은 `internal_error`.
- `DeleteAccountInput { confirm: true }`(strict). `confirm`이 없거나 false면 `invalid_input`. `[가정]` 확인 방식(spec-gaps ①).
- `DeleteAccountResult { deleted: true, canceledJobs, redirectTo: "/" }` — 화면은 `redirectTo`(S-01)로 이동. `[가정]` 경로(spec-gaps ②).
- 오류: `unauthenticated`(401), `invalid_input`, `internal_error`(비밀값 없음·RPC 실패·`invalid_subject_hash`), **`account_deletion_incomplete`(500)** = public 데이터는 지웠으나 auth 사용자 삭제 실패. 다시 시도하면 된다.

## 탈퇴 흐름 (FL-07)
1. 세션 확인(`getUser`).
2. `ACCOUNT_DELETION_HASH_SECRET`이 없으면 **아무것도 하지 않고** `internal_error`(fail closed).
3. 진행 중(`queued`/`running`) `ai_jobs`마다 `request_ai_job_cancel` — 실행기가 정상 취소 경로로 멈출 기회. 이미 끝난 작업의 오류는 무시. (db 노트: RPC가 어차피 작업 행을 지우므로 선택 단계지만 계획대로 둠.)
4. RPC `delete_account(p_subject_hash)` — `subject_hash` = HMAC-SHA256(비밀값, `"account:" + user id`) 소문자 hex 64자(`computeSubjectHash`). 한 트랜잭션: 키 hard delete(NFR-KEY-06), 비식별 로그, 모든 public 행. 실패하면 아무것도 지워지지 않는다(취소 요청만 남음 — 무해).
5. service role `auth.admin.deleteUser(id)`. 404는 "이미 지워짐"으로 성공 처리(재시도 멱등). 실패하면 `account_deletion_incomplete`, 세션은 남긴다 → 같은 세션으로 재시도하면 RPC가 멱등으로 통과(같은 hash 로그가 있으면 새 로그 없음)하고 auth 삭제를 다시 한다.
6. 로그아웃(`signOut({ scope: "local" })`, 쿠키 정리). 실패해도 탈퇴는 성공(auth 사용자가 없어 세션은 쓸 수 없음).
- 로그: `account.deleted { canceledJobs, authUserAlreadyGone }`, `account.delete_failed { step, ... }`. 사용자 id·이메일·hash·비밀값·키는 남기지 않는다(테스트로 확인).

## 보관 크론 (`/api/cron/retention`)
- `isCronAuthorized`(기존, timing-safe) → service role로 `purge_unlinked_writing_chats` → `purge_old_ai_jobs` → `purge_old_ai_usage_records` → `purge_old_account_deletion_logs` 순서, 각 `{ p_now, p_limit: 5000 }`.
- 한 번에 꽉 찬 배치(5,000)가 오면 같은 실행에서 최대 4번까지 이어 부르고, 그래도 남으면 `hasMore`에 넣어 다음 실행에 넘긴다.
- 한 정리가 실패해도 나머지를 실행하고, 끝에 `internal_error`(500)로 실패를 알린다. 로그 `cron.retention { deleted, hasMore, failed }` — 개수와 키 이름만, 오류 원문 없음.
- 응답 `{ data: { deleted: {unlinkedWritingChats, aiJobs, aiUsageRecords, accountDeletionLogs}, hasMore, failed } }`.

## 환경 변수
- 새 `ACCOUNT_DELETION_HASH_SECRET` (`src/server/env.ts`): 선택, 32자 이상, 서로 다른 문자 16개 이상(저엔트로피 거부). 오류 메시지에 값이 나오지 않는다. `.env.example`에 **빈 값**과 생성 방법(`openssl rand -base64 48`).
- `.env.example`의 `SUPABASE_SERVICE_ROLE_KEY` 설명을 세 용도(ai-jobs 크론·보관 크론·탈퇴 auth 삭제)로 고침.

## vercel.json · Hobby 플랜
- 배포하지 않았다. Hobby 플랜은 크론이 **하루 1회**만 되고 실행 시각이 최대 1시간 늦을 수 있다. 그래서 두 크론 모두 하루 1회로 등록했다. ai-jobs 크론은 B-4대로 안전망이며(주 경로는 상태 폴링), Pro로 바꾸면 `*/5 * * * *` 권장.
- 배포 시 Vercel 환경 변수에 `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `ACCOUNT_DELETION_HASH_SECRET`이 있어야 한다.

## 기타 변경
- `src/server/db/errors.ts`: `invalid_subject_hash` → `internal_error`(서버가 만드는 값이므로).
- `src/server/jobs/cron.ts`: service role 클라이언트 생성을 `service-role.ts`로 옮김(동작 같음).
- `src/test/local-supabase.ts`: `dbUrl`(supabase status `DB_URL`), `hasPsql()`, `runPsql()` 추가(S9 픽스처용).

## 테스트
- 단위
  - `src/server/services/account/account.test.ts`: 요약 매핑·NFR-KEY-09 플래그·잘못된 응답, 입력 스키마, HMAC 형식, 탈퇴 순서(취소 2 → RPC(hash 인자) → auth 삭제 → 로그아웃), 비밀값 없음(호출 0), RPC 실패(auth 삭제·로그아웃 없음), auth 실패(`account_deletion_incomplete`, 로그아웃 없음), 이미 지워진 auth(성공), 로그아웃 실패 무시, 로그에 id·hash·비밀값 없음.
  - `src/server/jobs/retention.test.ts`: 순서·인자, 꽉 찬 배치 반복과 상한·`hasMore`, 한 정리 실패 후 계속 + 500, 크론 라우트 401(헤더 없음·틀림), service role 키 없으면 500.
  - `src/server/env.test.ts`: 새 비밀값 검증.
- 로컬 DB 통합 `src/server/services/account/account.integration.test.ts` (스택·S9 테이블·psql 없으면 skip)
  - 픽스처 `__fixtures__/all-slices.sql`: S1~S8 모든 `user_id` 테이블에 행(슈퍼유저, replica 모드로 트리거 없이 넣되 참조는 실제 행). 테스트가 카탈로그로 `user_id` 테이블을 나열해 전부 1행 이상인지 먼저 확인 → 새 테이블이 생기면 픽스처를 고치라고 테스트가 깨진다.
  - 요약 개수 정확 → auth 삭제 1회 실패(public 0행 확인) → 같은 세션으로 재시도 성공 → 모든 `user_id` 테이블 + `profiles` 0행, `auth.users` 없음, 로그 1행(비식별: id·이메일 없음, `reason=user_request`, `db_deleted_at` 있음), 다른 사용자 행 수 그대로, 앱 로그에 id·이메일·hash 없음.
  - 진행 중 작업 1개에 취소 요청 후 삭제, 사용자 세션은 `purge_*` 호출 불가.
  - 보관 경계(`__fixtures__/retention.sql`, 실제 cron 함수 + service role): 미연결 대화 91일 삭제·89일 보존·연결된 대화 400일 보존, 끝난 작업 91일 삭제·89일 보존·대기 작업 200일 보존, 사용 기록 KST 13개월 전 달 삭제·12개월 전 달 보존, 탈퇴 로그 3년+1일 삭제·3년-1일 보존.

## 스펙 차이·가정 (spec-gaps "2026-11-04 · S9 (api)")
1. 탈퇴 확인은 체크 플래그 `confirm: true` `[가정]`
2. 탈퇴 후 이동 `/`(S-01) `[가정]`
3. 탈퇴·요약은 동의 게이트 없이 로그인만 확인 `[구현 결정]`
4. `subject_hash` HMAC 입력에 `account:` 접두사 `[가정]`
5. `account_deletion_incomplete`(500) 오류와 재시도 흐름 — UX 문구 추가 요청 `[구현 결정]`
6. 크론 일정(02:00·03:00 KST, Hobby 하루 1회) `[가정]`
7. 보관 크론 배치 5,000 × 최대 4회 `[구현 결정]`
- 협업 중 발견: `get_account_deletion_summary`가 invoker인데 `ai_provider_keys`를 직접 세서 사용자 세션에서 42501이 났다 → db-engineer가 `ai_provider_keys_public`으로 고침(리더 경유), 통합 테스트로 확인.

## QA 1차 반영 (03_backend-qa_report.md)
- **QA-S9-01 교착 재시도**: `delete_account`가 `40P01`(deadlock_detected)로 실패하면 같은 hash로 **한 번** 다시 부른다(트랜잭션 전체가 롤백됐고 RPC는 멱등). 두 번째도 40P01이면 새 오류 **`account_deletion_busy`(503)** "다른 작업과 겹쳐 탈퇴를 마치지 못했어요. 지운 것은 없어요. 잠시 후 다시 시도해 주세요." — auth 삭제·로그아웃은 하지 않는다. 로그 `account.delete_retry { reason: "deadlock" }`. 주석 "The RPC also marks them"을 실제 동작(작업 행 삭제)에 맞게 고쳤다. 테스트: 40P01 1회 → 성공(RPC 2회·같은 hash·auth 삭제 1회), 40P01 2회 → `account_deletion_busy`.
- **QA-S9-03 service role 미리 확인**: `DeleteAccountDeps.assertAuthAdminReady()`를 추가해 해시 비밀값 확인 바로 뒤, 작업 취소·RPC 전에 부른다. 액션은 여기서 `createServiceRoleClient`로 클라이언트를 만들고(키 없으면 throw) 그 클라이언트를 `deleteAuthUser`에 넘긴다. 설정이 빠진 배포는 아무것도 지우지 않고 `internal_error`. 테스트: 클라이언트 없음 → RPC·취소 호출 0회.
- **QA-S9-06 작업 유형 불변식**: `src/server/jobs/runner.ts`의 `REQUEST_SCOPED_JOB_TYPES`를 export하고 `writing_assist`·`chat_reply`(생산 경로 없는 예약값)를 넣었다 → 공용 재시도(`/api/ai-jobs/{id}/retry`)가 `ai_job_not_retryable`로 막는다. 새 테스트 `src/server/jobs/job-types.test.ts`가 `AI_JOB_TYPES` 11개 각각이 "등록됨(definitions.ts)" 또는 "요청 범위" 중 **정확히 하나**인지, 요청 범위 목록에 모르는 값이 없는지 확인한다.
- 참고: 전체 테스트 중 한 번 로컬 스택이 재시작되던 순간(다른 팀원의 `db reset`)에 통합 파일들이 skip·실패했고, 다시 돌리면 88 파일 전부 통과했다.
