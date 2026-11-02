# S9 계정·보관 계획

## 범위와 근거
- 기획 근거
  - DM: §4.3 `get_account_deletion_summary`, §4.4 보유 기간, A.17 `account_deletion_logs`, §2.9 `ai_jobs` 90일·`ai_usage_records` 13개월, §2.11 키 즉시 파기, §3.4 미연결 AI 작성 대화 90일, §7 정기 배치
  - PRD: F-COM-05, NFR-PRV-06, NFR-KEY-06·09, D-11(즉시 파기), D-DM-02(파기 증빙은 비식별만), D-DM-08, D-DM-09
  - UX: FL-07, S-25(삭제 범위·안내), S-08(남은 기간 안내는 S4에서 이미 함)
- 앞 슬라이스 위에 쌓는다
  - S1: `profiles`(auth.users cascade), 동의
  - S3a: 크론 `/api/cron/ai-jobs`, `CRON_SECRET`
  - S3b: 키·동의
  - S4: 대화 남은 일수
  - S5~S8: 모든 사용자 테이블, 진행 중 작업 취소 방식
- 연결: UI 없음 → A1 settings·deletion "연결 대기"
- **이번에 함께 하는 것**: `vercel.json` 크론 등록(배포는 하지 않고 파일만 둔다), 잔여 메모 정리

## 계약 — DB (새 마이그레이션 `20261104xxxxxx_s9_*`)

1. **`account_deletion_logs`** (A.17)
   - 컬럼: `id`, `subject_hash`, `requested_at`, `db_deleted_at`, `storage_deleted_at`(MVP 버킷이 없으므로 null), `reason`(`user_request`/`inactivity`)
   - 비식별이다. `subject_hash`는 서버 비밀값 기반 HMAC(user id)이고 DB에는 해시만 남긴다. 사용자 id FK는 두지 않는다.
   - 권한
     - 사용자와 app_ai_writer는 권한이 없다.
     - 쓰기는 탈퇴 RPC(definer) 안에서만 한다.
     - 보관 3년이 지난 행은 정리 RPC가 지운다.

2. **`get_account_deletion_summary()`** (§4.3, 사용자 세션, invoker)
   - 커리어: 경력·교육·프로젝트·상세 내용·정량 성과·스킬·AI 작성 대화 수
   - 기업 JD: 지원 프로젝트·인사이트·초안·면접 세션·전형 이력 수
   - AI 연결: 등록 키·데이터 사용 동의·토큰 사용 기록 수
   - 반환 모양은 api와 합의하고 노트에 적는다.

3. **탈퇴 RPC `delete_account(p_subject_hash text)`** (사용자 세션, definer, `auth.uid()`)
   - 한 트랜잭션에서 다음 순서로 한다.
     1. 진행 중 `ai_jobs`에 취소를 요청한다.
     2. 키 행을 hard delete한다(NFR-KEY-06).
     3. `account_deletion_logs`에 insert한다.
     4. 사용자의 모든 public 데이터를 삭제한다(`profiles` 삭제로 연쇄되는지 테이블별로 확인한다. 연쇄가 없는 테이블은 명시적으로 지운다: `ai_usage_records`, `ai_jobs`, `consents`, `ai_data_use_consents`, `evidence_links` 등).
     5. `db_deleted_at` 기록
   - `auth.users` 삭제는 서버가 service role로 `auth.admin.deleteUser`를 호출해서 한다(아래 API). 이 RPC는 public 데이터만 책임진다.
   - 그 뒤 `auth.users` 삭제가 실패해도 public 데이터는 이미 사라져 있다. 다시 로그인하면 빈 계정이 되므로 재시도할 수 있게 한다(멱등).
   - **잠금 순서**: S5~S8의 작업 종료 트리거와 교착이 나지 않게 한다. 진행 중 작업 취소를 먼저 커밋하는 방안도 검토하고, 근거를 노트에 남긴다.
   - **누락 검사 pgTAP**: 모든 public 테이블 중 `user_id` 컬럼이 있는 테이블을 시스템 카탈로그로 나열하고, 탈퇴 후 해당 사용자 행이 0개인지 확인한다. 새 테이블이 생기면 테스트가 깨지게 한다.

4. **보관 정리 RPC** (cron 전용 역할 또는 service role, definer. `authenticated`·`app_ai_writer`에는 grant하지 않는다)
   - `purge_unlinked_writing_chats(p_now timestamptz default now())`: `project_id is null`이고 `status in ('active','abandoned')`이고 `last_activity_at < now - 90일`. 메시지는 연쇄로 지운다. 반환은 삭제 수다.
   - `purge_old_ai_jobs(p_now)`: `finished_at`(없으면 `created_at`)이 90일 지난 끝난 작업만 지운다. 진행 중은 제외한다. 참조하는 결과 테이블의 `ai_job_id`는 set null이나 soft라 영향이 없는지 확인한다.
   - `purge_old_ai_usage_records(p_now)`: `occurred_at` 기준 13개월이다. 월 경계는 KST `period_month` 기준 `[가정]`.
   - `purge_old_account_deletion_logs(p_now)`: 3년
   - 모두 한 번에 지우는 행 수에 상한을 둔다(배치, 예: 5,000행). 남은 행이 있으면 다음 실행에 넘긴다.
   - 실행 역할 결정: 크론은 서버에서 service role 클라이언트로 RPC를 부른다. 함수는 `service_role`에만 grant한다.

5. **grants·pgTAP**: 허용 목록, 요약 개수 정확성, 탈퇴 후 누락 검사, 로그 비식별(사용자 id·이메일 없음), 정리 경계값(89일과 91일, 13개월 경계, 진행 중 작업 보존, 연결된 대화 보존), 권한(사용자가 정리 RPC를 부를 수 없음)

## 계약 — API

1. **contracts** `src/lib/contracts/account.ts`: 요약 응답, 탈퇴 입력(확인 문구 `[가정]` "탈퇴합니다" 같은 고정 문자열 또는 체크 플래그는 UX S-25 기준으로 api가 정함)
2. **Server Actions** `src/server/actions/account.ts`
   - `getAccountDeletionSummary()`
   - `deleteAccount({ confirm })` 순서
     1. 세션 확인
     2. 진행 중 AI 작업 취소 요청
     3. `delete_account` RPC (`subject_hash`는 서버가 `ACCOUNT_DELETION_HASH_SECRET`(새 환경 변수, `.env.example`에 빈 값)으로 HMAC 계산)
     4. service role로 `auth.admin.deleteUser`
     5. 로그아웃(쿠키 정리)
     6. 결과 반환(화면은 S-01로 이동)
   - 실패 지점별 동작을 정의한다. RPC가 실패하면 아무것도 지워지지 않는다. auth 삭제가 실패하면 로그와 함께 오류를 내고, 다시 시도하면 RPC는 멱등으로 통과한다.
   - 키 원문이나 개인정보를 로그에 남기지 않는다.
   - 안내 문구 데이터 "공급자 사이트에서도 키를 폐기하는 것을 권해요"(NFR-KEY-09)는 요약 응답에 플래그로 둔다(키가 있었는지).
3. **보관 크론** `GET /api/cron/retention` (`CRON_SECRET`)
   - 네 정리 RPC를 차례로 부르고 개수를 로그로 남긴다(id·내용 없음).
   - 배치 상한 때문에 남은 행이 있으면 다음 실행에 넘긴다.
4. **`vercel.json`**
   - `/api/cron/ai-jobs`(S3a, 기존)와 `/api/cron/retention`(매일 1회, KST 새벽 `[가정]`)을 등록한다.
   - Hobby 플랜은 크론이 하루 1회라는 제약을 노트에 남긴다. 배포는 하지 않는다.
5. **테스트**
   - 단위: 탈퇴 순서와 실패 지점, 크론 인증
   - 로컬 DB 통합: 모든 슬라이스의 데이터를 가진 사용자를 만들고 → 요약 개수를 확인하고 → 탈퇴한다. 그 뒤 다음을 확인한다.
     - public 행 0개
     - `auth.users` 없음
     - 다른 사용자 데이터 그대로
     - 로그 1행이 비식별
   - 보관 크론 경계값

## AI 담당
이번 슬라이스는 AI 기능이 없다. ai-pipeline-engineer는 띄우지 않는다.

## 팀 작업과 의존
| 담당 | 작업 | 의존 |
|------|------|------|
| db-engineer | 마이그레이션 1~5, pgTAP, 타입, 노트(시그니처·반환 모양 먼저) | 없음 |
| api-engineer | contracts, 액션, 크론 라우트, `vercel.json`, env, 테스트 | db 노트·타입 |
| backend-qa | 전체 검사(최대 2라운드) + **전 슬라이스 통합 점검**(마지막 슬라이스) | 각 모듈 |

## 원격 브랜치
적용하지 않는다.

## `[가정]` (spec-gaps에 기록)
1. `ai_usage_records` 13개월은 KST 월 기준이다(이번 달 포함 13개월보다 오래된 행 삭제).
2. 보관 크론은 매일 1회 KST 새벽에 돈다.
3. `subject_hash`는 서버 비밀값으로 만든 HMAC이다. 같은 사람의 재가입 여부를 추적하는 데는 쓰지 않는다.
4. 탈퇴 확인 방식(문구 입력 / 체크)은 UX S-25를 따르고, 없으면 체크 플래그로 한다.
5. auth 사용자 삭제가 실패해도 public 데이터는 이미 지워진 상태다. 재시도는 멱등이다.
