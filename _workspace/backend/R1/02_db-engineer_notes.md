# R1 DB 구현 노트

## 바뀐 시그니처·반환 형태 (api-engineer 먼저 보기)

> 상태: 완료(로컬 `supabase db reset` + `supabase test db` PASS, 타입 재생성). 시그니처는 확정이다.

### A19·A20 키 RPC — 서버 전용 역할(service_role)만 실행
- `authenticated`·`anon`·`app_ai_writer`·`app_key_reader`는 execute 없음. 서버가 세션 확인 후 **service_role 클라이언트**로 부른다.
- 이름 인자(PostgREST named args)로 부르면 순서는 상관없다.

```sql
public.save_provider_key(
  p_user_id uuid,              -- 신규: 세션에서 확인한 사용자 id
  p_provider text, p_connection_tier text,
  p_key_ciphertext bytea, p_key_nonce bytea, p_wrapped_dek bytea, p_kek_id text,
  p_key_last4 text, p_disclosure_version text, p_verification_result text,
  p_key_id uuid,
  p_failure_cause text default null,
  p_encryption_version smallint default 1
) returns jsonb   -- 반환은 그대로: provider_key_meta + replaced

public.record_provider_key_check(
  p_user_id uuid,              -- 신규
  p_provider text, p_result_status text, p_failure_cause text default null
) returns jsonb   -- 반환은 그대로: provider_key_meta
```
- 새 오류: `p_user_id` null → 42501 `not_authenticated`(기존 매핑 그대로), 프로필 없음 → P0001 `user_not_found`.
- A20 재동의 규칙: `consent_required` 판정이 `check_ai_run_allowed`와 같은 헬퍼 `private.ai_consent_allows_run(user, provider, tier)`로 바뀌었다. 최신 미철회 동의 행이 있고, 그 뒤 시행된 `requires_reconsent = true` 고지가 없으면 통과. "현재 버전과 정확히 일치" 검사는 없앴다.
- `p_disclosure_version`: 형식상 인자로 남긴다(DM 2.11.3 시그니처). null이거나 `ai_disclosures`에 없는 (provider, tier, version)이면 `consent_required`. 값이 현재 버전이든 사용자가 동의한 버전이든 통과한다(판정은 동의 행 기준).

### A7 탈퇴 미완료 판정 — service_role만 실행

```sql
public.get_account_deletion_state(p_user_id uuid, p_subject_hash text) returns text
  -- 'active' | 'deletion_incomplete' | 'profile_missing'
```
- **`p_subject_hash`를 받는다(DM 6.1 `get_account_deletion_state(p_user_id)`와 다름)**: hash는 서버 HMAC 비밀값으로 서버가 만들고 DB는 비밀값을 모른다(S9 `delete_account(p_subject_hash)`와 같음). 서버가 `delete_account`에 넘기는 것과 같은 함수로 계산해 넘긴다.
- 판정: `profiles` 있음 → `active` / 없음 + `account_deletion_logs.subject_hash = p_subject_hash` 행 있음 → `deletion_incomplete` / 둘 다 없음 → `profile_missing`.
- 오류: `p_user_id` null → P0001 `invalid_user_id`, hash 형식(64자 소문자 hex) 아님 → P0001 `invalid_subject_hash`(프로필이 있어도 검사한다).

### A18 `get_data_readiness()` — 시그니처 그대로, 값 추가
- `hints`에 `project_fields` 추가. 대상 프로젝트(포함 규칙 적용, complete 상세 내용은 있는데 `name`/`role`이 비어 draft)가 있고 `complete_projects = 0`이면 넣는다.
- `next_action` 판정 순서(DM 6장 v4.2): ① `complete_experience` 누락 → `form` ② `project_fields` 대상 → `form` + `suggested_project_id`(최근 수정 1건, `suggested_mode` 없음) ③ 활성 공급자 없음 / 키 `invalid` → `form` ④ 완료 상세 없는 프로젝트 → `writing_chat` + `augment_project` + id ⑤ `writing_chat` + `new_project`.
- 바뀐 동작: 예전에는 키가 없으면 경력 누락보다 먼저 `form`이었다(결과 값은 같은 `form`이라 화면 영향 없음). ②는 AI 연결이 없어도 같은 값.

### A22 `complete_interview_questions` — 시그니처 그대로, payload 키 추가
- `p_payload.validation_report`(object 또는 null/생략), `p_payload.usage`(object 또는 null/생략). object가 아니면 `invalid_interview_payload`.
- `interview_sessions.question_validation_report jsonb null`, `question_usage jsonb null` 신설. 세트 완료 때 덮어쓴다(생략하면 null). 사용자 세션도 select 가능(테이블 단위 select grant).

### A5 메시지 수 — RPC 시그니처 그대로, 값 의미 변경
- `start_writing_chat`은 `message_count = 0`으로 시작(시작 인사 미포함). 기존 행은 인사 행(`sequence = 1`, assistant, `ai_job_id` null)이 있으면 1을 뺐다.
- `append_writing_chat_message` 반환 `message_count`: 첫 사용자 메시지 후 1(예전 2). 수락 조건 `message_count ≤ 38` 그대로. 실제 최대 40.
- `begin_assistant_message.is_final`: `message_count > 38`(즉 이 답이 40번째) 그대로.

### A6 재개
- 사용자 세션 `update writing_chats set status = 'active' where id = …` 가 `abandoned`일 때만 통과. 트리거가 `last_activity_at = now()`를 넣는다. `saved`·`handed_off`는 여전히 `invalid_writing_chat_transition`.

### A24
- `app_ai_writer`의 `evidence_links` INSERT 컬럼 grant와 insert 정책을 없앴다. 근거는 결과 RPC 안에서만 쓴다.

## 마이그레이션 파일
| 파일 | 항목 | 내용 |
|------|------|------|
| `supabase/migrations/20261105000100_r1_writing_chat_message_count.sql` | A5 | `start_writing_chat` 재정의(`message_count` 0 시작), 기존 행 보정(인사 행 있으면 −1, `updated_at` 트리거를 잠시 끄고 갱신) |
| `supabase/migrations/20261105000200_r1_writing_chat_resume.sql` | A6 | `private.writing_chats_guard` 재정의: `abandoned → active`만 허용 + `last_activity_at = now()` |
| `supabase/migrations/20261105000300_r1_account_deletion_state.sql` | A7 | `get_account_deletion_state(uuid, text)` definer, service_role만 |
| `supabase/migrations/20261105000400_r1_get_data_readiness_project_fields.sql` | A18 | `get_data_readiness()` 재정의: `project_fields` hint, 판정 순서 ①~⑤ |
| `supabase/migrations/20261105000500_r1_provider_key_rpcs_server_role.sql` | A19·A20 | 옛 두 함수 drop → `p_user_id` 판 생성, service_role만 execute, `ai_consent_allows_run` 사용, `has_current_ai_consent` drop |
| `supabase/migrations/20261105000600_r1_interview_question_set_report.sql` | A22 | 세션 컬럼 2개(+ object CHECK), `complete_interview_questions` 재정의 |
| `supabase/migrations/20261105000700_r1_evidence_links_no_ai_writer_insert.sql` | A24 | `evidence_links_insert_ai_writer` 정책 drop, `app_ai_writer` INSERT(테이블·컬럼) revoke |

## 테이블·컬럼 (스펙 대비 차이 포함)
- `interview_sessions.question_validation_report jsonb null`, `question_usage jsonb null` — 둘 다 object만 허용(CHECK `interview_sessions_question_validation_report_check` / `_question_usage_check`). DM 2.7 그대로.
- `writing_chats.message_count` CHECK(0~40)는 그대로. 의미만 "인사 제외"로 바뀜.

## RPC 시그니처와 반환 형태
- 맨 위 절 참고. 바뀐 시그니처는 `save_provider_key`, `record_provider_key_check`(둘 다 `p_user_id` 추가), 새 함수는 `get_account_deletion_state`. 나머지(A5·A6·A18·A22)는 시그니처 그대로, 값·동작만 변경.

## RLS·권한 요약 (DM §5 대비)
- service_role 전용 public 함수: 기존 크론 6개 + `save_provider_key`, `record_provider_key_check`, `get_account_deletion_state`(grants 테스트 목록 갱신).
- authenticated 실행 가능 RPC 목록에서 `save_provider_key`·`record_provider_key_check` 제거.
- `app_ai_writer` 컬럼 단위 쓰기 허용 목록 = `ai_jobs` insert/update + `ai_usage_records` insert(`evidence_links` 제거). select는 그대로.
- `writing_chats` 사용자 직접 update 컬럼은 그대로 `status`, `return_target`(재개 시 `last_activity_at`은 트리거가 씀).

## 테스트 (`supabase test db` 결과)
- 전체 PASS(로컬, 2026-10-30 실행).
- 새 파일 `supabase/tests/r1_planning_decisions.test.sql`: A7(세 상태·오류·권한), A18(경력 누락 우선, 키 없음/있음 같은 값, 최신 후보, draft 경력 소속 제외, 역할 채우면 ready), A20(비재동의 새 버전 통과·재동의 버전 거부·재동의 후 통과를 `save_provider_key`와 `check_ai_run_allowed` 양쪽으로 확인).
- 고친 파일
  - `writing_chats.test.sql`: A5 수치(0 시작, 첫 사용자 메시지 1 등), A6 재개(저장·전환 거부, 재개 후 `last_activity_at`·수 유지·메시지 수락, B는 재개 불가).
  - `writing_chat_save.test.sql`: `handed_off → active` 거부 추가.
  - `interviews.test.sql`: A22 payload 형식 오류 2건, 저장값 확인, 생략 시 null.
  - `evidence_links.test.sql`: 정책 목록, `app_ai_writer` 직접 insert 거부(A24). 트리거·CHECK 검증은 결과 RPC와 같은 owner 경로로 옮김.
  - `insights.test.sql`(JD 근거 가드), `s3_first_call_privileges.test.sql`: 직접 insert를 owner 경로 / 거부 검사로 바꿈.
  - `ai_provider_keys.test.sql`, `s3b_first_call_privileges.test.sql`, `get_provider_key_secret.test.sql`: 키 RPC를 service_role + `p_user_id`로 호출, `user_not_found`·null id·authenticated 거부, execute 매트릭스 갱신.
  - `ai_data_use_consents.test.sql`: 지운 헬퍼 대신 `ai_consent_allows_run`.
  - `grants.test.sql`: 위 권한 목록 3곳.
- A5 데이터 보정은 빈 DB에서 테스트할 수 없어 로컬에서 수동으로 확인했다(인사 있는 행 3 → 2, 인사 없는 행 0 유지, `updated_at` 유지, 롤백).

## 원격 브랜치 적용 여부
- 적용하지 않음(계획대로).

## 스펙 차이·가정 (spec-gaps.md "2026-11-05 · R1 (db)")
- ① `get_account_deletion_state`가 `p_subject_hash`도 받음(DB가 HMAC 비밀값을 모름).
- ② `save_provider_key.p_disclosure_version`은 알려진 고지 버전이기만 하면 됨(판정은 동의 행 기준).
- ③ 키 RPC 소유 검사 = `p_user_id`의 `profiles` 행 존재.
- ④ `project_fields` hint는 `complete_projects = 0`일 때만.

## api-engineer에게
- 키 등록·교체·다시 확인·등급 변경: 세션 확인 후 service_role 클라이언트(`src/server/jobs/service-role.ts` 등)로 `save_provider_key({ p_user_id, ... })`, `record_provider_key_check({ p_user_id, ... })`.
- 실행 시점 재동의(api `mayRunWithConsent`)와 등록 시점(`consentStateOf().needsConsent`, 지금은 "현재 버전과 일치")을 같은 규칙으로 맞춰야 한다(A20). DB는 둘 다 `ai_consent_allows_run`.
- 탈퇴 미완료: `profiles`가 없을 때만 `get_account_deletion_state({ p_user_id, p_subject_hash })`(service_role). hash는 `delete_account`와 같은 함수.
- 메시지 남은 수: `40 - message_count`(인사 제외). 사용자 입력 가능 `message_count ≤ 38`.
- 재개: 사용자 세션으로 `update writing_chats set status = 'active'`(abandoned일 때만 통과, 아니면 `invalid_writing_chat_transition`).
