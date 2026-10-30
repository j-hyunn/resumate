# S9 DB 구현 노트 (db-engineer)

> 상태: **구현 완료 + QA 1차 반영**. `supabase db reset` 통과, `supabase test db` 43파일 2035개 모두 통과, `database.types.ts` 재생성(QA 1차 반영 뒤 바뀐 것 없음). 커밋·원격 적용 없음.
> 아래 시그니처·반환 모양은 먼저 공개한 내용과 같다. 바뀐 점은 요약 RPC의 권한 문제 수정 하나뿐이다(아래 "수정 이력").

## RPC 시그니처와 반환 형태 (api 먼저 볼 것)

공통
- 오류는 `errcode = 'P0001'`, `message` = 소문자 코드. 미인증은 `42501 not_authenticated`.

### 1. `get_account_deletion_summary()` — authenticated, security invoker (RLS로 본인 행만)

```sql
get_account_deletion_summary() returns jsonb
-- {
--   "career":       {"experiences":n, "educations":n, "projects":n, "project_details":n,
--                    "achievements":n, "skills":n, "writing_chats":n},
--   "applications": {"application_projects":n, "insights":n, "drafts":n,
--                    "interview_sessions":n, "application_stage_events":n},
--   "ai_connection":{"provider_keys":n, "ai_data_use_consents":n, "usage_records":n,
--                    "has_provider_keys":boolean}
-- }
```
- 모든 값은 정수(0 포함). 행 수 그대로 센다: 인사이트는 모든 버전, 초안은 `drafts` 행(경력기술서·자소서 문서), 동의는 이력 행 전체, 사용 기록은 `ai_usage_records` 행 수.
- `has_provider_keys` = `provider_keys > 0`. 화면 안내 "공급자 사이트에서도 키를 폐기하는 것을 권해요"(NFR-KEY-09) 표시 플래그.

### 2. `delete_account(p_subject_hash text)` — authenticated 전용, security definer + `auth.uid()`

```sql
delete_account(p_subject_hash text) returns jsonb
-- {"deleted": true, "log_written": boolean, "in_flight_jobs": n, "deleted_provider_keys": n,
--  "db_deleted_at": timestamptz}
```
- `p_subject_hash`: **소문자 hex 64자**(HMAC-SHA256(user id, `ACCOUNT_DELETION_HASH_SECRET`)의 hex). 형식이 다르면 `invalid_subject_hash`. 서버가 계산해 넘긴다. DB는 user id·이메일을 로그에 남기지 않는다.
- 한 트랜잭션에서 본인의 public 데이터를 **전부** 지운다(`profiles` 포함, 28개 `user_id` 테이블 + `profiles`). `auth.users`는 지우지 않는다 → 서버가 이어서 service role로 `auth.admin.deleteUser`.
- 진행 중 작업(`queued`/`running`)은 행째 지워진다(취소 요청보다 강한 신호). 실행기는 다음 heartbeat에서 `current:false`(lost)로 멈추고, `get_provider_key_secret`은 작업·키가 없어 거절한다. `in_flight_jobs` = 지운 진행 중 작업 수(로그용 숫자).
- **멱등**: 다시 불러도 오류 없이 통과한다(남은 행만 지움). 같은 `subject_hash` 로그가 이미 있으면 새 로그를 만들지 않고 `log_written:false`. → auth 삭제가 실패하면 같은 hash로 RPC부터 다시 불러도 된다.
- 오류: `not_authenticated`(42501), `invalid_subject_hash`.
- api 쪽 "진행 중 AI 작업 취소 요청"(계획 API 2단계)은 **선택**이다. 하려면 기존 `request_ai_job_cancel(job_id)`를 작업마다 부르면 되고(별도 커밋 → 실행기가 정상 취소 경로로 끝날 기회), 안 해도 이 RPC가 작업 행을 지우므로 결과는 같다.

### 3. 보관 정리 RPC — **service_role 전용**, security definer

```sql
purge_unlinked_writing_chats(p_now timestamptz default now(), p_limit integer default 5000) returns integer
purge_old_ai_jobs(p_now timestamptz default now(), p_limit integer default 5000) returns integer
purge_old_ai_usage_records(p_now timestamptz default now(), p_limit integer default 5000) returns integer
purge_old_account_deletion_logs(p_now timestamptz default now(), p_limit integer default 5000) returns integer
```
- 반환 = 이번 호출에서 지운 행 수. **반환값 = `p_limit`이면 남은 행이 있을 수 있다**(다음 실행에 넘기거나 같은 실행에서 한 번 더 호출).
- `p_limit` 1~50000, 밖이면 `invalid_limit`. `p_now` null이면 `invalid_now`.
- 기준
  - 대화: `project_id is null and status in ('active','abandoned') and last_activity_at < p_now - 90 days`, 진행 중 작업이 그 대화를 대상으로 하면 제외. 메시지는 연쇄 삭제.
  - 작업: `status in ('succeeded','failed','canceled') and coalesce(finished_at, created_at) < p_now - 90 days`. 진행 중(`queued`/`running`)은 지우지 않는다.
  - 사용 기록: `period_month < (p_now의 KST 달 1일) - 12개월` = 이번 달 포함 13개월보다 오래된 KST 달 `[가정]`.
  - 탈퇴 로그: `requested_at < p_now - 3 years`.
- 다른 행이 잠근 행은 건너뛴다(`skip locked`) → 다음 실행에서 지운다.

## 마이그레이션 파일

| 파일 | 내용 |
|------|------|
| `supabase/migrations/20261104000100_s9_account_deletion_logs.sql` | `account_deletion_logs`: 컬럼, CHECK(hash 형식, `reason`, 시각 순서), `subject_hash` unique, `requested_at` 인덱스, `updated_at` 트리거, RLS(정책 없음), 권한 회수 |
| `supabase/migrations/20261104000200_s9_account_deletion_rpcs.sql` | `get_account_deletion_summary`(invoker), `delete_account`(definer) |
| `supabase/migrations/20261104000300_s9_retention_purge_rpcs.sql` | 정리용 인덱스 3개, `private.purge_check_args`, 정리 RPC 4개 |

## 테이블·컬럼 (스펙 대비 차이 포함)
- `account_deletion_logs`(A.17): `id`, `subject_hash`, `requested_at`, `db_deleted_at`, `storage_deleted_at`, `reason`(`user_request`/`inactivity`)에 공통 컬럼 `created_at`·`updated_at`을 더했다.
- user id·이메일 컬럼과 FK가 없다. `subject_hash`는 `^[0-9a-f]{64}$`이고 unique다.
- 새 인덱스
  - `writing_chats (last_activity_at) where project_id is null and status in ('active','abandoned')`
  - `ai_jobs ((coalesce(finished_at, created_at))) where status in (끝난 3값)`
  - `ai_usage_records (period_month)`
  - `account_deletion_logs (requested_at)`

## `delete_account` 삭제 순서와 잠금 순서 근거
1. 사용자별 advisory xact lock을 잡는다. 같은 사용자의 중복 호출을 직렬화한다.
2. 진행 중 작업 수를 센다(반환값에 쓴다).
3. `ai_usage_records`를 지운다. 먼저 지우면 지원 프로젝트 연쇄가 만드는 set null update가 생기지 않는다. 다른 쪽이 기존 행을 잠그는 경로도 없다.
4. `application_projects`를 id 순서로 `for update` 잠근 뒤 지운다. JD·요건·인사이트·초안·섹션·근거 출처·면접 5종·전형 이력·`evidence_links`·프로젝트 소속 작업이 함께 연쇄로 지워진다. 그 다음 같은 영역의 테이블을 `user_id`로 한 번 더 지워 남은 행을 쓸어 낸다.
5. `writing_chats`를 id 순서로 `for update` 잠그고 지운 뒤(메시지는 연쇄 삭제), 남은 `writing_chat_messages`를 쓸어 낸다. S4 턴 시작·발화 추가의 대화 → 메시지 순서와 같다(QA-S9-02).
6. 커리어 7개 테이블을 하위부터 지운다.
7. 남은 `ai_jobs`를 지운다(대화 턴, 키 확인).
8. `ai_provider_keys`를 hard delete한다. `profiles.active_ai_provider`는 set null이 된다.
9. `ai_data_use_consents`, `consents`를 지운다.
10. `profiles`를 지운다.
11. 로그를 insert한다(on conflict do nothing).

잠금 근거
- S5~S8 RPC는 지원 프로젝트 → 결과 행 → `ai_jobs` 순서로 잠근다. 작업 종료 트리거는 `ai_jobs` 갱신 뒤 프로젝트를 `skip locked`로 잡아 기다리지 않는다.
- 이 함수도 지원 프로젝트를 가장 먼저(사용 기록 다음) 잡고 작업은 마지막에 지운다. 그래서 S5~S8 실행기와는 반대 방향 대기가 생기지 않는다. 대화도 대화 → 메시지 순서로 잡아 S4 턴 시작·발화 추가와 같은 방향이다.
- 커리어보다 지원 프로젝트를 먼저 지우는 이유: 커리어 삭제 트리거(근거 출처 삭제 표시, 초안 출처 표시)가 근거 행을 먼저 잠그면 "근거 → 프로젝트" 순서가 되어 실행기와 교착할 수 있다. 근거가 이미 연쇄로 사라진 뒤라 트리거는 아무 행도 건드리지 않는다.
- 진행 중 작업 "취소 먼저 커밋" 안을 검토했고 채택하지 않았다. 같은 트랜잭션에서 작업 행이 지워지면 실행기는 heartbeat에서 `current:false`(lost)로 멈춘다. `get_provider_key_secret`도 작업과 키가 없어 거절한다. 늦게 도착한 결과 쓰기는 부모 행이 없어 FK로 실패한다. 부모 없는 사용 기록 insert만 남을 수 있는데, 이것은 이어지는 `auth.users` 삭제의 연쇄가 지운다(실패하면 RPC를 다시 불러 지운다). api가 원하면 기존 `request_ai_job_cancel`로 미리 취소할 수 있다(선택).
- 남는 위험은 두 경우다.
  - S4 `finish_assistant_message`(메시지 → 대화)와 겹치는 경우. S4 안에 두 순서가 모두 있어 피할 수 없다.
  - 다른 탭의 사용자 편집과 겹치는 경우(커리어 행 → `profiles` touch).
  - 이때는 40P01이 날 수 있으므로 **api는 40P01이면 한 번 재시도**한다(멱등).
- 두 연결 실제 재현은 pgTAP으로 할 수 없어(dblink 없음) 하지 않았다. 구조는 코드 주석과 이 노트로 고정한다.

## RLS·권한 요약 (DM §5 대비)
- `account_deletion_logs`
  - RLS는 켜져 있고 정책은 없다.
  - anon·authenticated·app_ai_writer·app_key_reader·authenticator에는 아무 권한도 없다.
  - service_role은 SELECT·DELETE만 가진다(운영 조회).
- `get_account_deletion_summary`, `delete_account`
  - authenticated만 실행할 수 있다(service_role 포함 다른 역할은 회수).
  - 요약은 invoker, 탈퇴는 definer이고 `search_path = ''`다.
- 정리 RPC 4개
  - service_role만 실행할 수 있고 definer다.
  - authenticated·app_ai_writer·app_key_reader·anon은 실행할 수 없다.

## 테스트 (`supabase test db`: 43파일, 2035개 모두 통과)
- `supabase/tests/account_deletion.test.sql`(37)
  - **누락 검사(카탈로그 기반)**: `user_id` 테이블 목록을 고정해 두어 새 테이블이 생기면 실패한다. `auth.users`를 참조하는 public 테이블 = `user_id` 테이블 + `profiles`. 픽스처가 모든 테이블에 행을 갖는지 확인한다. 탈퇴 뒤 모든 테이블에서 A의 행이 0개다.
  - 요약: A·B 정확한 개수. 실제 `authenticated` 세션에서 키 2개가 있는 상태로 호출한다.
  - 오류: 미인증 2종, hash 형식 4종(실패 호출은 아무것도 지우지 않음).
  - 반환 모양, 멱등 재호출(`log_written:false`), `auth.users`는 남음, B의 행은 그대로.
  - 로그: 1행, 컬럼 목록 고정, FK 없음, user id·이메일이 들어 있지 않음, `auth.users` 삭제 뒤에도 유지.
  - 권한 매트릭스, invoker/definer 여부, `search_path`.
- `supabase/tests/retention_purge.test.sql`(30)
  - 대화: 89일·정확히 90일 남김, 91일 active·abandoned 삭제, 연결된 대화(saved 포함) 남김, 진행 중 턴 남김, 메시지 연쇄 삭제.
  - 작업: 91일 지난 끝난 작업 삭제, 89일 남김, `finished_at` null이면 `created_at`으로 판정, running·queued는 오래돼도 남김. 인사이트는 남고 `ai_job_id`만 null이 된다. 사용 기록의 soft id는 그대로다.
  - 사용 기록: KST 10월 말과 11월 1일 00:00(UTC로는 10월 31일) 경계.
  - 로그: 3년 ±1초, 상한 2로 나눠 지우기.
  - 인자 오류 4종, 권한(사용자 42501, service_role 실행 가능).
- 공용 로컬 DB에 통합 테스트가 남긴 행이 있을 수 있다. 그래서 단정문은 테스트 사용자와 테스트 hash로 거른다.

## 원격 브랜치 적용 여부
적용하지 않았다(계획).

## 수정 이력
- api-engineer 보고: authenticated는 `ai_provider_keys.user_id`에 SELECT 권한이 없어 요약 RPC가 42501로 실패했다.
- 키 개수는 이제 `ai_provider_keys_public` 뷰(invoker, RLS로 본인 행만)로 센다.
- `20261104000200`은 커밋 전 같은 슬라이스 파일이라 그대로 고쳤다. 로컬은 `db reset`이 필요하다.
- 같은 수정에서 두 RPC의 service_role 실행 권한도 회수했다.

## 스펙 차이·가정 (spec-gaps.md "2026-11-04 · S9 (db)")
① 탈퇴는 auth 연쇄가 아니라 RPC가 명시적으로 지운다. ② 로그는 마지막에 한 번 쓰고 hash는 unique·멱등이다. ③ 진행 중 작업은 취소 표시 없이 삭제한다. ④ 다른 탭 편집과의 교착은 재시도로 처리한다. ⑤ 작업 정리 때 결과 행의 `updated_at`이 바뀐다. ⑥ 진행 중 턴이 있는 대화는 정리하지 않는다. ⑦ 13개월은 KST 달 기준이다. ⑧ 정리 RPC에 호출당 상한이 있다.

## QA 1차 반영 (`03_backend-qa_report.md`)
- **QA-S9-02**: 잠금 순서를 고쳤다.
  - 탈퇴는 이제 `writing_chats`를 id 순서로 `for update` 잠그고 지운 뒤 메시지를 쓸어 낸다(대화 → 메시지).
  - 마이그레이션 주석, 이 노트, spec-gaps ④를 함께 고쳤다. 남은 반대 방향(`finish_assistant_message`, 다른 탭 편집)은 api의 40P01 1회 재시도가 받는다.
  - `20261104000200`을 그대로 수정했다(커밋 전).
- **QA-S9-04**: `grants.test.sql`에 세 가지를 추가했다(plan 39 → 41).
  - (a) public의 모든 테이블에 RLS가 켜져 있는지 카탈로그 전체로 확인한다.
  - (b) `authenticated`가 실행할 수 있는 public 함수 33개를 허용 목록으로 고정했다.
  - (c) 이름으로 미리 거르던 service_role 전용 확인을 카탈로그 전체 조회로 바꿨다. 기준은 "service_role은 실행할 수 있고, anon·authenticated·app_ai_writer·app_key_reader는 못 하는 함수"이고, 결과는 sweep·claim과 purge 4개, 모두 6개다.
- **QA-S9-05**
  - (a) `account_deletion.test.sql`: 탈퇴 뒤 app_ai_writer의 heartbeat update(실행기와 같은 조건: id + 실행 세대 + 진행 중 상태)가 0행인지 확인한다. 진행 중 작업 2개에 대해 app_key_reader의 `get_provider_key_secret`이 `key_not_available`인지도 확인한다.
  - (b) `retention_purge.test.sql`: `ai_jobs`를 참조하는 FK 9개(카탈로그 목록 고정)가 모두 정리 대상 작업을 가리키는 픽스처를 만들었다. 정리 뒤 모든 참조 컬럼이 null이고 결과 행 수가 그대로인지 확인한다. 모든 FK가 작업 컬럼 하나만 `on delete set null`인지도 확인한다.
