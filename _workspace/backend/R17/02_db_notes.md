# R17 DB 구현 노트 (채용 공고 AI 처리 제거 — 원문 그대로)

- 작성: db-engineer, 2026-11-14
- 근거: `01_plan.md` §1·§2·§6
- 커밋 안 함. 로컬에만 적용(`supabase db reset` 통과). 원격 미반영.

## 마이그레이션 파일

- `supabase/migrations/20261113004800_r17_jd_raw_text.sql` — **비파괴**(행·컬럼·CHECK 값 삭제 없음). 함수·트리거 삭제만 포함.

## 삭제한 것

| 종류 | 이름 |
|------|------|
| RPC | `public.begin_jd_extraction(uuid, uuid)`, `public.apply_jd_extraction(uuid, uuid, integer, jsonb, text, text)`, `public.fail_jd_extraction(uuid, uuid)`, `public.purge_unused_jd_preview_outputs(timestamptz, integer)` |
| 내부 함수 | `private.jd_apply_extraction_result(...)`, `private.jd_extraction_job_matches(ai_jobs, job_descriptions)`, `private.jd_extraction_mark_failed(uuid, uuid, boolean)`, `private.jd_extraction_result_valid(jsonb, integer)` |
| 트리거 | `ai_jobs_release_jd_extraction` (on `public.ai_jobs`) + `private.ai_jobs_release_jd_extraction()` `[가정 R17-db1]` |
| 시그니처 | `public.create_application_project` 10인자판(`p_preview_job_id`) |

`[가정 R17-db1]` 트리거를 남기지 않은 이유: 트리거 함수가 삭제된 `jd_extraction_mark_failed`를 부른다. plpgsql은 호출을 실행 시점에 해석하므로, 남겨 두면 과거 `jd_extraction` 잡 행의 상태가 failed/canceled로 바뀌는 순간(스윕·취소) 오류가 난다. 트리거가 하던 일(JD의 `extraction_status`를 failed로)은 이제 아무도 읽지 않으므로 같이 삭제. 과거 잡이 끝나도 JD의 `extraction_status`는 그대로 남는다(pgTAP로 확인).

## 보존한 것 (계획 R17-2/3/7)

- `public.jd_requirements` 테이블·트리거·RLS·계정 삭제 경로·과거 근거 행
- `job_descriptions`의 `extraction*`, `requirements_hash`, `tech_keywords`, `detected_language`, `extraction_status` 컬럼과 CHECK, `job_descriptions_guard` 트리거
- `insights.requirements_hash` (v1 행용)
- `ai_jobs.job_type`·`target_type`(`jd_preview`)·`error_code`(`not_a_jd`), `ai_usage_records.feature`/`job_type`/`error_code` CHECK 값
- 근거 `source_type`(`jd_requirement`, `jd_sentence`) 허용 목록 — `insight_payload_valid`·`evidence_links` CHECK 모두 그대로
- `public.update_failed_jd_raw_text` — 삭제된 함수를 부르지 않아 **재정의하지 않음**. 동작 동일(새 공고는 `pending` → `jd_raw_text_locked`, R17-6)
- `private.writing_chat_document_greeting` — "요건 정리 전" 분기 남김(호출부가 항상 true를 넘겨 도달 불가)

## 테이블·컬럼

- `insights.jd_text_hash text` 추가, `insights_jd_text_hash_check` (null 또는 1..128자)
- `insights_ready_check` 완화: `requirements_hash is not null` → `(requirements_hash is not null or jd_text_hash is not null)`. 나머지 조건 동일
- 권한: insights는 테이블 단위 SELECT(authenticated, app_ai_writer, service_role)라 새 컬럼도 읽기 가능. 쓰기 권한 없음(RPC만)
- 컬럼 주석: `jd_text_hash`(R17, 원문 해시), `requirements_hash`(R17 이전 v1 행 전용)

## RPC 시그니처와 반환 형태

### `public.create_application_project` (security definer, authenticated + service_role 실행, anon·app_ai_writer 불가)

```
create_application_project(
  p_id uuid, p_raw_text text, p_raw_text_hash text, p_sentences jsonb,
  p_company_name text default null, p_position_title text default null,
  p_name text default null, p_deadline date default null, p_source_url text default null
) returns jsonb
```

반환: `{ application_project_id, job_description_id, name, name_source, ai_run_allowed, created }`
(삭제된 키: `extraction_status`, `preview_applied`, `preview_skip_reason`). 같은 id 재호출 = `created: false`, 같은 6키.

- 이름 규칙 `[가정 R17-8]`: `p_name`(user) → 기업명 있으면 `"{회사명} 자기소개서"`(user) → 둘 다 없으면 `application_fallback_name`(`새 자기소개서 (YYYY-MM-DD KST)`, `default`). **키 유무와 무관**. 이전에는 키가 있고 기업명이 없으면 이름이 null(추출 대기)이었다.
- 게이트 제거 `[가정 R17-9]`: `key_invalid`, `ai_consent_required`를 더 이상 던지지 않는다(공고 등록은 AI를 쓰지 않음). `ai_run_allowed`만 연결 상태를 반영.
- 오류(그대로): `not_authenticated`(42501), `invalid_id`, `invalid_raw_text`, `invalid_raw_text_hash`, `invalid_sentences`, `invalid_name`, `invalid_company_name`, `invalid_position_title`, `invalid_source_url`, `application_project_id_conflict` (모두 P0001)
- 새 JD 행의 `extraction_status`는 기본값 `pending`.

### `public.begin_insight(p_application_project_id uuid, p_ai_job_id uuid) returns uuid` (변경: 게이트만)

- `jd_not_extracted` 제거 → 프로젝트에 JD 행이 없으면 **`job_description_not_found`** (P0001). `pending` JD도 통과.
- 다른 오류 그대로: `not_authenticated`, `application_project_not_found`, `invalid_ai_job`, `insight_in_progress`.

### `public.complete_insight(p_insight_id, p_ai_job_id, p_run_generation, p_payload jsonb) returns jsonb` (반환 형태 동일)

- `p_payload.hashes` 필수 키: **`jd_text_hash`**, `career_snapshot_hash`, `input_hash` (각 문자열 1..128자, trim 후).
- `requirements_hash`만 있고 `jd_text_hash`가 없으면 `invalid_insight_payload`. 둘 다 있으면 `requirements_hash`는 무시(저장 안 함).
- 저장: `jd_text_hash = hashes.jd_text_hash`, `requirements_hash = null`. 그 외(result, match_stage_result, meta, evidence) 동일. `match_stage_result`는 여전히 object/array만 확인.
- 근거 source_type 허용 목록 동일(커리어 5종 + `jd_requirement` + `jd_sentence`).
- 반환: `{applied, insight_id, application_project_id, version_no, status, is_latest, previous_latest_id, evidence_count, completed_at}` 또는 `{applied:false, reason:'stale_run'}` — 변경 없음.

### `public.start_document_writing_chat(p_application_project_id, p_document_kind, p_form_snapshot)` (시그니처 동일)

- `v_requirements_ready` = 프로젝트에 JD 행이 있는지(공고 등록 시 항상 생성되므로 사실상 true). 인사말이 "채용 공고의 요건을 아직 정리하지 않았어요" 분기로 가지 않는다.

## RLS·권한 요약

- 새 테이블·정책 없음. `create_application_project` 9인자: `revoke all from public, anon` → `grant execute to authenticated, service_role`(이전 버전과 같은 실행 주체).
- app_ai_writer 실행 가능 public 함수에서 begin/apply/fail_jd_extraction 빠짐. service_role 전용 함수에서 `purge_unused_jd_preview_outputs` 빠짐(`grants.test.sql`·`retention_purge.test.sql` 갱신).

## 테스트 (`supabase test db`)

- **PASS — 66 파일, 2613 단정** (`supabase db reset` 후 재실행해도 동일).
- 새 파일 `supabase/tests/r17_jd_raw_text.test.sql` — 49 단정: 삭제 함수·트리거 부재, 10인자 부재/9인자 존재·단일 오버로드·실행 권한, 삭제 헬퍼를 부르는 함수 없음, 게이트가 `extraction_status`를 읽지 않음, 과거 jd_extraction 잡 failed 전환 무오류, 반환 6키, 이름 규칙 3갈래, 재호출, 키 invalid·동의 없음에도 생성, `update_failed_jd_raw_text` pending 거부 유지, `begin_insight` JD 없음/pending 통과, payload 검증(requirements_hash만 → 거부, 추가 키 무시, 빈/129자 거부), `complete_insight` jd_text_hash 저장·requirements_hash null·jd_sentence 근거, 컬럼·CHECK·권한, ready_check(v1 행 허용·해시 없음 거부), 인사말, `jd_requirements` RLS·연쇄 삭제·사용자 쓰기 불가.
- 삭제: `supabase/tests/jd_extraction.test.sql` (전부 삭제된 RPC 대상. 그중 남는 테이블 관련 단정 — B 격리, 프로젝트 삭제 연쇄 — 은 r17 파일로 옮김).
- 수정:
  - `application_projects.test.sql` — 반환 키 축소, "키 있음·기업명 없음 → null" → 기본 이름, invalid key 거부 → 생성
  - `create_application_project_gate.test.sql` — 전면 개정(게이트 없음 확인)
  - `signup_consent_ai_gate.test.sql` — 경로 ⑥ 동의 전 거부 → 생성·AI 불가
  - `insights.test.sql` — `jd_not_extracted` → JD 없는 프로젝트로 `job_description_not_found`, payload `jd_text_hash`, 저장 단정
  - `insights_retry`, `retry_ai_job`, `r13_settings_dialog`, `s6_first_call_privileges` — payload 해시 키
  - `s5_first_call_privileges`, `s6_first_call_privileges` — 추출 RPC 호출 제거
  - `s6_lock_order` — jd_extraction 경로 단정 제거, 부재 확인으로 대체
  - `r15_jd_preview_and_deadline.test.sql` — 미리 보기·apply 마감일·정리 크론 절 삭제(source_url·인덱스·jd_preview CHECK 조합 절만 남음)
  - `r15_document_writing_chat.test.sql` — "요건 추출 전" 인사말 단정 → 그 분기가 아님
  - `grants.test.sql`, `retention_purge.test.sql` — 함수 목록

## 타입

- `pnpm db:types`와 같은 방식(`supabase gen types typescript --local > src/server/db/database.types.ts`)으로 재생성.
- 차이: `insights` Row/Insert/Update에 `jd_text_hash`, `create_application_project` Args에서 `p_preview_job_id` 제거, `apply_jd_extraction`·`begin_jd_extraction`·`fail_jd_extraction`·`purge_unused_jd_preview_outputs` 제거. `jd_requirements`·추출 컬럼은 그대로 남음.
- 생성기가 R17과 무관하게 `ai_provider_keys_public` 뷰 Row의 nullability(`string | null` → `string`)도 바꿔 출력했다(로컬 CLI v2.122 추론 차이로 보임). 슬라이스 범위를 벗어나므로 **그 한 줄은 커밋돼 있던 값으로 되돌렸다**. 다음 전체 재생성 때 다시 나타날 수 있음 — 무해(더 좁은 타입).

## 파괴적 마이그레이션

- 없음(이번 마이그레이션은 비파괴).
- 2단 초안(적용 안 함): `_workspace/backend/R17/phase2-destructive-draft.sql` — `-- DESTRUCTIVE:` 표시, `begin … rollback`으로 감쌈. 내용: v1 인사이트의 요건 텍스트를 result에 스냅숏 → `insights.requirements_hash` drop(+ v1 행 `jd_text_hash` 백필), `jd_requirement` 근거 삭제·CHECK 축소, `jd_requirements` drop, `job_descriptions` 추출 컬럼 8개 drop, `ai_jobs`에서 jd_extraction 행 삭제·job_type/error_code CHECK 축소. `ai_usage_records`는 사용량 이력 때문에 유지(삭제 대안 주석). 적용 전 결정 필요 P1~P4와 같이 재정의해야 할 함수 목록(TODO) 포함.

## 원격 반영

- 미반영. 릴리스 주의(계획 §6): `create_application_project` 시그니처 변경과 추출 RPC 삭제 때문에 `db push` 직후 같은 PR의 앱 코드를 바로 배포해야 한다. 그 사이 옛 코드의 공고 추가(10인자 호출)·추출 잡은 실패한다.
- 원격에 `queued`/`running` 상태의 jd_extraction 잡이 남아 있으면 새 러너는 처리하지 않는다. 스윕으로 failed가 되어도 트리거가 없으므로 오류 없음. 릴리스 전 읽기 전용 확인 권장: `select count(*) from ai_jobs where job_type='jd_extraction' and status in ('queued','running')`.

## 스펙 차이·가정

- `[가정 R17-8]` 이름 규칙(키 무관 fallback) — 계획대로
- `[가정 R17-9]` 생성 게이트 제거 — 계획대로. 기획 DM 2.7.1 / 2.11.7 경로 ⑥(Q53-1)과 어긋남 → 기획 개정 필요(리더가 spec-gaps R17 절에 기록)
- `[가정 R17-db1]` `ai_jobs_release_jd_extraction` 트리거·함수 삭제(위 설명)
- `complete_insight`가 `hashes.requirements_hash`를 함께 받아도 거부하지 않고 무시 — 전환기 호환. 필수는 `jd_text_hash`.
- `begin_insight`의 JD 존재 확인에 `jd.user_id = v_uid` 조건 추가(definer 함수라 소유 확인을 명시).
