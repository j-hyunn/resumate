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

---

## 정렬 (2026-11-16)

- 근거: `01b_plan-align.md` §1·§2, 기획 PR #77(`origin/claude/jd-raw-text-planning-6b673b`) decisions 3.29·4.24, DM v4.16 11.11·2.6·2.6.1·2.6.2·2.7.0·2.8·A.8
- 위 1차 절(2026-11-14)의 `jd_text_hash`·9인자 6키 반환·게이트 유지·`update_failed_jd_raw_text` 유지·비파괴 구성은 **모두 이 절로 대체**된다.
- 커밋 안 함. 로컬만(`supabase db reset` + `supabase test db` 통과). 원격 미반영.

### 파일

| 파일 | 상태 |
|------|------|
| `supabase/migrations/20261113004800_r17_jd_raw_text.sql` | **삭제**(원격 미반영이라 고쳐 씀 — `git rm`) |
| `supabase/migrations/20261113004800_r17_jd_raw_text_cleanup.sql` | A, `-- DESTRUCTIVE:` |
| `supabase/migrations/20261113004810_r17_jd_raw_text_rpcs.sql` | B, `-- DESTRUCTIVE:`(public RPC drop — 데이터 손실 없음, 되돌릴 수 없음) |
| `supabase/migrations/20261113004820_r17_drop_jd_extraction.sql` | C, `-- DESTRUCTIVE:` + 최종 단언 |
| `_workspace/backend/R17/phase2-destructive-draft.sql` | **삭제**(A·C로 흡수) |
| `_workspace/backend/R17/release-counts.md` | 신설 — push 전 읽기 전용 집계 10항목 + push 뒤 확인 SQL |
| `src/server/db/database.types.ts` | `pnpm db:types`로 재생성. 차이는 R17분만(무관한 생성기 차이 없음 — 되돌릴 줄 없었음) |

### A — `…004800_r17_jd_raw_text_cleanup` (DESTRUCTIVE)

0. 집계 10항목 `raise notice 'r17 cleanup ①~⑩'`(release-counts.md와 같은 SQL)
1. 트리거 `ai_jobs_release_jd_extraction` + `private.ai_jobs_release_jd_extraction()` drop
2. `private.r17_jd_raw_text_cleanup()` 실행(결과 jsonb를 notice로): ① `queued`/`running` `jd_extraction` → `canceled`/`error_code canceled`/`finished_at now()` ② `target_type = 'jd_preview'` 작업 `output = null`, `step_outputs = '{}'` ③ `name is null` → `application_default_name(created_at)`, `default` ④ `evidence_links` `source_type = 'jd_requirement'` 전부 + `owner_type = 'application_document' and source_type = 'jd_sentence'` 전부 삭제 ⑤ 서류 대화(`document_kind is not null`) `structured_draft` 안의 `source_type in (jd_requirement, jd_sentence)` 객체 원소를 깊이 무관하게 제거(`private.r17_strip_jd_sources`). `schema_version` 그대로
3. `insights.requirements_hash` → `raw_text_hash` rename, CHECK `insights_requirements_hash_check` → `insights_raw_text_hash_check` rename, 값 = 그 지원 건 JD의 현재 `raw_text_hash`(모든 행, `updated_at` 트리거 잠시 끔), `insights_ready_check` 다시 만듦(`raw_text_hash is not null`)
- 남김: `schema_version = 1` 인사이트와 그 나머지 근거(커리어·`jd_sentence`), 과거 CHECK 값(#8)

### B — `…004810_r17_jd_raw_text_rpcs`

- drop: `begin_jd_extraction`, `apply_jd_extraction`, `fail_jd_extraction`, `update_failed_jd_raw_text`, `purge_unused_jd_preview_outputs`, `private.jd_apply_extraction_result`·`jd_extraction_mark_failed`·`jd_extraction_job_matches`·`jd_extraction_result_valid`·`jd_sids_exist`, 10인자 `create_application_project`, 4인자 `private.writing_chat_document_greeting`
- 교체·신설: 아래 RPC 전부, `private.job_descriptions_guard`(C의 컬럼 drop 전), `private.evidence_allowed_sources`, `private.evidence_links_check_source`, `private.insight_payload_valid`, `private.delete_account_data`(`jd_requirements` 줄 삭제, 나머지 본문 그대로)

### C — `…004820_r17_drop_jd_extraction` (DESTRUCTIVE)

- `drop table public.jd_requirements`(트리거 2개·정책·grant 함께), `private.jd_sids_valid(text[])` drop(마지막 사용처가 그 테이블 CHECK)
- `job_descriptions` 8컬럼 drop(CHECK 7개·FK `job_descriptions_extraction_job_fkey`·인덱스·컬럼 grant 함께)
- `evidence_links_source_type_check` = `profile, experience, education, project, project_deliverable, skill, jd_sentence, user_note`
- 최종 단언 `private.r17_jd_raw_text_assert()`: `jd_requirement` 근거 0 · 자소서 `jd_sentence` 근거 0 · 서류 대화 JD 출처 0 · `name is null` 0 · `queued`/`running` `jd_extraction` 0. 하나라도 아니면 `P0001 r17_assert_failed`(detail에 건수) → C 롤백

### RPC 최종 시그니처·반환·오류 (api-engineer·ai-pipeline-engineer 계약)

**`public.create_application_project(p_id uuid, p_raw_text text, p_raw_text_hash text, p_sentences jsonb, p_company_name text = null, p_position_title text = null, p_name text = null, p_deadline date = null, p_source_url text = null) → jsonb`** — definer, `authenticated`·`service_role` 실행
- 반환 `{application_project_id, job_description_id, created, name, name_source}` (**`ai_run_allowed` 삭제**). 같은 `p_id` 재호출 = 저장된 값 + `created: false`
- 이름: `p_name`(trim) 있음 → `user` / 아니면 늘 `private.application_fallback_name(company, position, now())` → 기업명 있으면 "{기업명 앞 94자} 자기소개서"(`user`), 없으면 "새 자기소개서 (YYYY-MM-DD KST)"(`default`). 키·동의 무관(게이트 없음)
- 오류(P0001): `invalid_id`, `invalid_raw_text`, `invalid_raw_text_hash`, `invalid_sentences`, **`jd_no_sentences`**(문장 0개, 행 없음), `invalid_name`, `invalid_company_name`, `invalid_position_title`, `invalid_source_url`, `application_project_id_conflict` / `not_authenticated`(42501). **`key_invalid`·`ai_consent_required` 없음**

**`public.update_jd_raw_text(p_application_project_id uuid, p_raw_text text, p_raw_text_hash text, p_sentences jsonb) → jsonb`** — 신설, definer, **`authenticated`만**(anon·app_ai_writer·service_role 불가)
- 반환 `{application_project_id, job_description_id, raw_text_edited_at}`
- 판정 순서: `not_authenticated`(42501) → `invalid_raw_text` / `invalid_raw_text_hash` / `invalid_sentences` / **`jd_no_sentences`** → `job_description_not_found`(없음·남의 것) → **`jd_job_in_progress`**(같은 지원 건 `job_type = 'insight'` `queued`/`running`만. 자소서 턴·실패·취소 작업은 막지 않음) → **`jd_raw_text_unchanged`**(앞뒤 공백 무시 비교)
- 쓰는 값: `raw_text`·`raw_text_hash`(trim)·`sentences`·`raw_text_edited_at = clock_timestamp()`, `application_projects.last_activity_at`. 인사이트·근거·이름·마감일 그대로
- 잠금 순서: `application_projects` → `job_descriptions`
- 폐기 코드: `jd_has_results`, `jd_raw_text_locked`, `jd_failure_not_input`, `jd_not_extracted`

**`public.begin_insight(p_application_project_id uuid, p_ai_job_id uuid) → uuid`** (시그니처·권한 그대로, app_ai_writer)
- `jd_not_extracted` 삭제. JD 행 없음 → `job_description_not_found`, **문장 0개 → `jd_no_sentences`**(P0001 — HTTP 409 매핑은 앱). 나머지 오류 그대로(`application_project_not_found`, `invalid_ai_job`, `insight_in_progress`)

**`public.complete_insight(p_insight_id, p_ai_job_id, p_run_generation, p_payload jsonb) → jsonb`** (시그니처·반환 그대로)
- `p_payload.hashes` = **`{raw_text_hash, career_snapshot_hash, input_hash}`**(각 1..128자). `jd_text_hash`·`requirements_hash`만 있으면 `invalid_insight_payload`
- **`meta.schema_version`은 숫자 2만**(1·3 → `invalid_insight_payload`). 저장 `schema_version = 2`
- 근거 `source_type` = `evidence_allowed_sources('insight')` = 커리어 5종 + `jd_sentence`. `jd_sentence` 근거는 **선택**(빈 배열·커리어만 OK — ai-pipeline 정렬안과 맞음). `jd_requirement`·`user_note` → `invalid_insight_payload`
- **JD 경합**: payload·meta 검사 뒤 JD 행을 `for update`로 잠그고 `hashes.raw_text_hash ≠ job_descriptions.raw_text_hash`면 `{applied:false, reason:'stale_run'}`(아무것도 저장 안 함 → 실행기는 작업 `canceled`). 잠금 순서 `application_projects` → `insights` → `job_descriptions`
- 저장 `raw_text_hash = hashes.raw_text_hash`. `match_stage_result`는 object/array 검사만(`{prompt_version, items}` 그대로 저장)

**`public.start_writing_chat(p_project_id uuid, p_return_target jsonb = null, p_form_snapshot jsonb = null) → uuid`** (시그니처 그대로)
- `return_target.params`에 `insight_id` 또는 `insight_item_key`가 있으면: `insight_id` = uuid 문자열 필수, `insight_item_key`(있으면) = `^gaps\.[0-9]{1,2}$` 문자열, 그 인사이트가 **내 것이고 `return_target.application_project_id`의 것**이어야 함. 어기면 `invalid_return_target`. params는 그대로 `return_target.params`에 저장

**`public.start_document_writing_chat(...)`** (시그니처 그대로) — 인사 3종(본문 없음 / 일부 / 전부). `private.writing_chat_document_greeting(p_slot_count, p_filled_count, p_free_tier)` 3인자

**근거 허용 목록 (#12)** — `private.evidence_allowed_sources`: `insight` = `experience, education, project, project_deliverable, skill, jd_sentence` / `application_document` = `experience, education, project, project_deliverable, skill, user_note`. `save_application_document`·`doc_evidence_row`·`wc_patch_document`(→ `wc_doc_sources`·`wc_document_block` → `wc_doc_evidence`)가 모두 이 함수에서 목록을 받으므로 자소서 저장·제안 패치에 JD 출처가 오면 `invalid_evidence_source`(저장) / `invalid_patch`(패치)

### 4.24 대조

| # | 내용 | 상태 |
|---|------|------|
| 1 | `jd_requirements` drop(트리거·정책·grant) | 완료 (C) |
| 2 | JD 8컬럼 + CHECK 7·FK·인덱스 drop | 완료 (C) |
| 3 | public RPC 5개·private 헬퍼(+ `jd_sids_valid`) drop | 완료 (B, `jd_sids_valid`는 C) |
| 4 | `jd_requirement` 근거·자소서 `jd_sentence` 근거·대화 JD 출처 삭제 | 완료 (A) |
| 5 | `evidence_links_source_type_check`에서 `jd_requirement` 제거 | 완료 (C) |
| 8 | 과거 CHECK 값·옛 인사이트(`schema_version = 1`)와 나머지 근거 보존 | 완료 (손대지 않음, pgTAP 확인) |
| 9 | 생성 RPC 9인자·게이트 삭제·이름 결정·`jd_no_sentences`·5키 반환 | 완료 (B) |
| 11 | `update_jd_raw_text` 신설·가드 트리거 교체 | 완료 (B). JD 조회 `rawTextEditable`·`rawTextLockedReason`은 api-engineer |
| 12 | 근거 허용 목록(트리거·저장·패치) | 완료 (B) |
| 13 | `raw_text_hash` rename·payload·`schema_version = 2`·`stale_run`·`jd_no_sentences` | 완료 (A rename, B 함수). 조회 `schemaVersion`·`staleReasons`는 api-engineer |
| 14 | `start_writing_chat` params 검사·인사 3종·`delete_account_data` | 완료 (B) |
| 16 | A·B·C 구성·집계 10항목·최종 단언 | 완료. 원격 push는 사용자 |
| 17 | `get_data_readiness`·`get_ai_usage_summary`·`get_deletion_impact` 변경 없음, `insights` 읽기 grant 변경 없음 | 확인 (세 함수 본문에 JD 추출·요건 참조 없음, 손대지 않음) |

### 가정

- `[가정 R17b-db-1]` A의 1~4단계·C의 단언을 운영자 전용 함수(`private.r17_jd_raw_text_cleanup()`, `private.r17_strip_jd_sources(jsonb)`, `private.r17_jd_raw_text_assert()`)로 두고 남긴다 — pgTAP이 같은 코드를 시드 행에 돌리기 위해. 어떤 역할에도 execute 없음(postgres만). 선례: `private.backfill_education_display_labels`
- `[가정 R17b-db-2]` 가드 트리거가 `source_url` 변경도 막는다(DM "불변 그대로" — 이전 가드는 실제로 막지 않았다. 쓰는 경로가 없어 동작 변화 없음)
- `[가정 R17b-db-3]` `jd_raw_text_unchanged` 비교는 이전 RPC처럼 앞뒤 공백 무시
- `[가정 R17b-db-4]` `start_writing_chat`: `insight_item_key`는 `insight_id`가 있어야 함, `insight_id`만은 허용(AI가 그 인사이트 `gaps[]` 전부), `feature` 값·인사이트 상태/`schema_version`은 보지 않음
- `[가정 R17b-db-5]` `evidence_links_check_source`의 CF-S1 예외(locator 없는 `{slot}.sources.{n}` `jd_sentence`)를 삭제 — 자소서 전용이었고 자소서는 더 이상 공고를 인용하지 않음. 인사이트 `jd_sentence`는 늘 locator 필요
- `[가정 R17b-db-6]` `update_jd_raw_text`는 `clock_timestamp()`(한 트랜잭션 안 두 번 수정도 가드 통과), `service_role` execute도 회수(DM "authenticated만")
- `[가정 R17b-db-7]` `complete_insight`의 JD 해시 비교는 payload·meta 검사 뒤(잘못된 payload는 여전히 예외가 먼저)
- `[가정 R17b-db-8]` `begin_insight`는 JD 행 없음을 `job_description_not_found`로 유지(RPC로는 생기지 않는 상태)
- `[가정 R17b-db-9]` `raw_text_hash` 백필은 상태 무관 모든 인사이트 행, `updated_at`은 보존
- `[가정 R17b-db-10]` A와 B 사이(같은 push 안, 수 초) 옛 `complete_insight`가 없는 컬럼을 참조해 실패할 수 있다 — release-counts.md "주의"
- `[가정 R17b-db-11]` `private.user_ai_run_allowed`는 이제 호출자가 없지만 DM 목록에 없어 남김
- `[가정 R17b-db-12]` DM 예시의 `R16`/`…_r16_…` 대신 이 슬라이스 이름 `R17`/`…_r17_…`

### 파괴적 마이그레이션

- A `20261113004800_r17_jd_raw_text_cleanup.sql`: `evidence_links` 행 삭제(`jd_requirement` 전부, 자소서 `jd_sentence` 전부), 서류 대화 제안의 JD 출처 원소 삭제, `jd_preview` 작업 출력 비우기, 진행 중 추출 작업 취소, `insights.requirements_hash` 값 덮어씀(rename)
- B `20261113004810_r17_jd_raw_text_rpcs.sql`: public RPC drop(데이터 손실 없음, 옛 코드 호출 실패)
- C `20261113004820_r17_drop_jd_extraction.sql`: `jd_requirements` 전체, JD 추출 컬럼 8개 값
- push 전 사용자 확인 필요. 집계는 `release-counts.md`

### 테스트

- `supabase db reset` + `supabase test db`: **PASS — 65 파일, 2648 단정**
- 끝-끝 확인(파일 밖, 일회): `supabase db reset --version 20261113004700` → 옛 모양 레거시 행 시드(요건·`jd_requirement` 근거·자소서 `jd_sentence` 근거·JD 출처 대화·running 추출·미리 보기 출력·이름 null·0문장 JD·v1 인사이트) → `supabase migration up --local`로 A·B·C 적용 성공(단언 통과), v1 인사이트 `raw_text_hash` = JD 해시·`updated_at` 보존, 근거는 인사이트의 커리어·`jd_sentence`만 남음 확인. 그 뒤 `db reset`으로 되돌림
- `r17_jd_raw_text.test.sql` 전면 재작성 — 135 단정: 스키마 끝 상태(#1·#2·#3·#5·#8·#13, 죽은 참조 없음), A 정리 함수를 시드 레거시 행에 실행(취소·출력 비우기·이름·근거 삭제·대화 출처 제거·v1 보존·비대화 채팅 불변·멱등), C 단언(정리 전 실패, 후 통과, 조건별 실패 4종), 생성 RPC, `update_jd_raw_text`(인사이트 queued/running 거부·자소서 턴 허용·같은 원문·0문장·인자·남의 것·anon/app_ai_writer), 가드, 허용 목록(트리거·저장 RPC), `begin_insight` 0문장·JD 없음, `complete_insight` 해시 불일치 `stale_run`·schema 2·옛 해시 키 거부·근거 선택, `start_writing_chat` params 14종, 인사 3종, 계정 삭제
- 삭제: `update_failed_jd_raw_text.test.sql`
- 수정: `account_deletion`, `application_projects`(0문장 → `jd_no_sentences`, 반환 5키), `create_application_project_gate`, `evidence_links`, `grants`(`update_jd_raw_text`), `insights`(JD 해시 = payload, `stale_run` 추가, `jd_requirement` 거부), `insights_retry`, `retry_ai_job`, `insights_career_deletion`, `r13_settings_dialog`, `r14_remove_mock_interview`, `r15_document_deletion`, `r15_document_sources`(`jd_sentence` 출처 → `invalid_patch`), `r15_document_writing_chat`(인사 3인자), `retention_purge`, `s5_first_call_privileges`, `s6_first_call_privileges`, `signup_consent_ai_gate`

### 원격 반영

- 미반영. 원격 마지막 `20261113004700`, 새 파일 3개 모두 그 뒤. push = A·B·C 연속 → 바로 같은 PR 코드 배포
