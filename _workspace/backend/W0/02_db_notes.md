# W0 DB 구현 노트 (Q53-1, 2, 3, 5, 7, 10, 11)

로컬 Docker 스택에만 적용했다. 커밋, 원격 적용, 배포는 하지 않았다.

## 마이그레이션 (새 파일만, 기존 파일 수정 없음)

| 파일 | 내용 |
|------|------|
| `20261107000100_w0_create_application_project_gate.sql` | Q53-1 생성 게이트 |
| `20261107000200_w0_jd_raw_text_edit.sql` | Q53-2·11 `raw_text_edited_at`, 가드 완화, `update_failed_jd_raw_text` |
| `20261107000300_w0_answer_evaluation_error_code.sql` | Q53-3 `error_code`, 비움 트리거, `fail_answer_evaluation` 인자 |
| `20261107000400_w0_interview_grading_decision.sql` | Q53-3·5·10 판정 헬퍼, `begin_interview_evaluation`, `mark_interview_result_viewed`, `retry_ai_job` |
| `20261107000500_w0_career_description_cancel.sql` | Q53-7 CHECK, unique 인덱스, 중단 처리, `begin_career_description` |

## 컬럼·제약

- `job_descriptions.raw_text_edited_at` timestamptz null.
- `answer_evaluations.error_code` text null. CHECK 목록은 `ai_jobs.error_code`와 같고, `failed` 행에만 값을 둘 수 있다(`answer_evaluations_error_code_failed_check`). `failed`를 벗어나는 모든 update는 트리거가 null로 비운다(`save_answer_evaluation`, R-63 다시 열기 포함).
- `drafts_type_status_check`: 경력기술서에 `composing` 추가.
- `drafts_career_description_composing_key`: 프로젝트당 `composing` 경력기술서 1개.
- `job_descriptions_guard`: `application_project_id`·`user_id` 불변. 원문·해시·문장 변경은 `old.extraction_status in (failed, running, succeeded)` + `new = pending` + `raw_text_edited_at` 변경일 때만. `raw_text_edited_at`만 변경, 원문 변경 없이 `succeeded` 벗어나기는 `job_description_immutable`.

## 새 RPC

### `update_failed_jd_raw_text(p_application_project_id uuid, p_raw_text text, p_raw_text_hash text, p_sentences jsonb) returns jsonb`
- security definer, `authenticated`만 execute(`anon`·`app_ai_writer`·`service_role` 없음). 잠금 `application_projects` → `job_descriptions`.
- 반환: `{application_project_id, job_description_id, extraction_status: 'pending', raw_text_edited_at, ai_run_allowed}`
- 거부(판정 순서): `not_authenticated`(42501) → `invalid_raw_text` → `invalid_raw_text_hash` → `invalid_sentences` → `job_description_not_found` → `jd_job_in_progress` → `jd_raw_text_locked`(조건 2·3) → `jd_failure_not_input` → `jd_has_results` → `jd_raw_text_unchanged`. 전부 P0001.

### `get_interview_grading_decisions(p_session_ids uuid[]) returns table(...)`
- security definer, `authenticated`·`app_ai_writer` execute. 호출자 소유 세션만 돌려주고, 다른 사용자·없는 id는 행이 없다.
- 열: `session_id, status, decision, cause, regrade_target_count, succeeded_count, answer_input_cause, summary_error_code`
- `decision`: `regrade` | `resummarize` | `input_only` | `none`. `status`는 조회 규칙의 실효 상태(`evaluating`인데 진행 중 채점 작업 없음 → `evaluation_failed`).
- **타입 주의**: 생성 타입은 `cause`·`answer_input_cause`·`summary_error_code`를 `string`으로 내지만 실제로는 null이 온다.
- 라우트 거부 대응: `input_only` → 409 `interview_evaluation_input_only`(details에 `cause`), `none` → 409 `interview_evaluation_not_retryable`.

## 바뀐 RPC

| RPC | 시그니처 | 변경 |
|-----|----------|------|
| `create_application_project` | 그대로 | 인자 검사 → 같은 `p_id` 있으면 게이트 없이 기존 흐름 → **`key_invalid` / `ai_consent_required`** → insert. 활성 공급자 없음·`needs_check`는 통과 |
| `fail_answer_evaluation` | **`(p_answer_id uuid, p_ai_job_id uuid, p_error_code text default null)`** | 옛 2인자 함수는 삭제. 2인자 호출은 그대로 동작(원인 null). 목록 밖 값은 `invalid_error_code` |
| `begin_interview_evaluation` | 그대로 | `answers_to_evaluate`에서 입력 원인 답변 제외. 새 작업이 끝난 세션에 시작할 때 판정표 적용: **`interview_evaluation_input_only`**(`detail` = 원인), `interview_evaluation_not_needed`. 종합만 다시 정리는 `answers_to_evaluate: []`로 시작 |
| `mark_interview_result_viewed` | 그대로 | 저장된 `status`가 `completed`이거나, `evaluation_failed` + 판정 `input_only`일 때 기록. 그 밖은 `changed: false` |
| `retry_ai_job` | 그대로 | 다시 채점 대상 0개인 `interview_evaluation`은 공급자가 같아도 **`ai_job_not_retryable`**. 연결 게이트보다 먼저 본다 |
| `begin_career_description` | 그대로 | 새 초안 insert 직전에 그 프로젝트의 `composing` 경력기술서를 삭제. 트리거가 건너뛴 낡은 `generating`(작업 `canceled`)도 먼저 정리. 지워진 행을 가리키는 `p_regenerated_from_id`는 첫 생성으로 처리 |
| `fail_career_description` | 그대로 | 작업이 `canceled`이거나 `cancel_requested_at`이 있으면 중단 처리(아래). 반환은 그대로 boolean |

내부: `private.career_description_mark_failed`(이름 유지, 중단 분기 추가), `private.ai_jobs_release_drafts`(작업이 `canceled`로 끝날 때 `failed` 초안도 대상), `private.interview_grading_decision`, `private.interview_answer_is_regrade_target`, `private.interview_evaluation_begin_json`.

**중단 처리**: 다시 생성은 새 행 삭제(문항·근거 연쇄). 첫 생성은 `status = composing`, `options`·`title` 유지, 문항 삭제, `ai_job_id`·`run_generation`·AI 메타·`completed_at` null. 쓴 토큰의 `ai_usage_records`는 남는다.

## api-engineer가 고칠 곳 (DB만 했고 아래는 건드리지 않았다)

지금 타입체크와 Vitest는 통과한다. 아래는 깨진 호출이 아니라 **아직 새 동작을 쓰지 않는 곳**이다.

| 위치 | 할 일 | 결정 |
|------|-------|------|
| `src/server/db/errors.ts` | 새 코드 매핑(HTTP 409): `jd_job_in_progress`, `jd_raw_text_locked`, `jd_failure_not_input`, `jd_has_results`, `jd_raw_text_unchanged`, `interview_evaluation_input_only`. `key_invalid`·`ai_consent_required`가 `create_application_project`에서도 409로 나가는지 확인 | Q53-1·2·3 |
| `src/server/services/application/write.ts` | `update_failed_jd_raw_text` Server Action 추가(`splitJdSentences`, `sha256Hex`는 생성과 같은 코드). 생성의 두 거부 코드 처리 | Q53-1·2 |
| `src/server/services/application/extraction.ts` `ensureJdExtracted` | `begin_jd_extraction` **뒤에** 문장을 읽는다. 지금은 `deps.jds.load`의 값을 `begin` 전에 읽어 381행에서 쓴다 | Q53-2 |
| `src/server/services/application/read.ts` `getJdView` | `rawTextEditedAt`, `rawTextEditable`(조건 1~5). `tech_keywords` null 처리 | Q53-2 |
| 인사이트·면접 조회 `lastFailure` | `finished_at < raw_text_edited_at`인 실패는 내리지 않는다 | Q53-2 |
| `src/server/services/interview/job.ts:642`, `db.ts:256,347` | `failAnswerEvaluation`에 `err.code`를 넘겨 `p_error_code`로 전달 | Q53-3 |
| `src/server/services/interview/job.ts` `evaluate` 단계 | `answers_to_evaluate: []`이면 공급자 호출 없이 끝나고 종합으로 가는지 확인. 진행 표시도 건너뛰기 | Q53-5 |
| `src/server/services/interview/start.ts` `retryInterviewEvaluation` | `score_status = 'not_scored'` 판정을 `get_interview_grading_decisions`로 교체. `input_only`는 `interview_evaluation_input_only`, `none`은 `interview_evaluation_not_retryable`. 작업 만들기 전에 거부 | Q53-3·5 |
| `src/app/api/interview-sessions/[id]/evaluation/retry/route.ts` | 주석·거부 코드 갱신 | Q53-3 |
| `src/server/services/interview/read.ts:367` `getInterviewResult` | `row.status === "completed"` 검사를 없애거나 넓혀 `evaluation_failed`에서도 RPC 호출 | Q53-10 |
| `src/server/services/interview/read.ts:429` `canRetryEvaluation` | 같은 판정 사용(`regrade`·`resummarize`만 true). 414행 `evaluationFailed`는 그대로 두고 원인 표시에 `answer_evaluations.error_code` 추가 | Q53-3·10 |
| 세션 목록(S-37) | `get_interview_grading_decisions`로 메뉴 판정 | Q53-6 |
| `src/server/jobs/runner.ts:268` `retryJob` | **연결 게이트 전에** 대상 0 판정 추가. 안 하면 RPC까지 가기 전에 `key_missing` 등이 먼저 나가 2.11.7 순서가 어긋난다 | Q53-5 |
| `src/server/jobs/status.ts:75` `retryPreviewOf` | 대상 0 작업에는 다시 시도 미리보기를 주지 않는다 | Q53-5 |
| `src/server/services/drafts/read.ts:184` `effectiveDraftStatus` | `generating`인데 작업이 `canceled`면 첫 생성은 `composing`, 다시 생성은 목록에서 제외(트리거가 건너뛴 경우 대비). 경력기술서 `composing`은 블록·복사 없음 | Q53-7 |
| `src/server/services/drafts/progress.ts` | 서류 초안 수에서 경력기술서 `composing` 제외. C-05 N도 같음 | Q53-7 |
| `src/server/services/drafts/career-description.ts` | 중단으로 초안이 지워지면 늦은 `complete_career_description`이 `draft_not_found`를 낸다. `TARGET_GONE_RAISES`(`ai-run.ts`)에 있는지 확인. 첫 생성 중단 시 `options` 복원 조회 | Q53-7 |
| `src/lib/contracts/` | `update_failed_jd_raw_text` 입력·거부 코드, 판정 결과 계약 | Q53-2·3 |

실행기 순서(`fail_career_description` 뒤 작업 닫기)는 바꾸지 않아도 된다. 작업이 `canceled`로 닫히면 트리거가 `failed` 초안을 중단 처리로 옮긴다.

## 시험 결과

- `supabase db reset`: 전체 마이그레이션 적용 성공.
- `supabase test db`: **PASS, 50파일 2,335건, 실패 0**. 작업 전 기준은 46파일 2,177건 PASS.
- 새 파일: `update_failed_jd_raw_text.test.sql` 68건, `interview_grading.test.sql` 50건, `career_description_cancel.test.sql` 28건, `create_application_project_gate.test.sql` 12건.
- **기존 시험 수정 4개**(옛 동작을 단언하던 곳만, 의도된 변경):
  - `application_projects.test.sql`: 키 무효 → 대체 이름 → `key_invalid` 거부.
  - `career_description.test.sql`: 취소 → `failed` → `composing`, 같은 작업 `begin` → `invalid_ai_job`.
  - `drafts.test.sql`: "경력기술서 composing 불가" → "`partially_failed` 불가".
  - `grants.test.sql`: 함수 목록에 새 RPC 추가.
- `pnpm typecheck` 통과, `pnpm test` 90파일 1,439건 통과(서비스 코드는 수정 전 상태). `database.types.ts` 재생성 완료.

## 실행하지 않은 것

- `pnpm lint`, `pnpm build`.
- 동시성 시험. 잠금 순서와 경쟁(수정 ↔ 추출 시작, 트리거 `skip locked`)은 코드로만 맞췄고, 낡은 `generating` 행은 고정 데이터로만 확인했다.
- `update_failed_jd_raw_text` 조건 2에서 트리거가 건너뛴 `running` 행도 고정 데이터로 확인했다.
- `get_advisors`, 원격 브랜치 적용(계획상 없음).

## 스펙 차이·가정

`_workspace/backend/spec-gaps.md`의 "2026-11-02 · W0 (db)" ①~⑨.

## QA-W0-03 수정 (DB)

- **원인**: `begin_career_description`의 정리 조건이 `generating` + 작업 `canceled`뿐이었다. 조회(`read.ts`의 `isStoppedCareerDescription`)는 `failed` + 작업 `canceled`도 중단으로 읽는다. 그래서 첫 생성 행은 `composing`이 2개로 보였고, 다시 생성 행은 숨겨진 채 계속 세어졌다.
- **새 마이그레이션**: `20261107000600_w0_begin_career_description_settle_failed.sql`. `20261107000500`은 고치지 않았다. 시그니처와 거부 코드는 그대로이고, 정리 조건만 `d.status in ('generating', 'failed') and j.status = 'canceled'`로 넓혔다.
- **동작**: `private.career_description_mark_failed`를 그대로 쓴다. 다시 생성 행은 삭제하고, 첫 생성 행은 `composing`으로 돌린다. 이때 다른 `composing` 행을 먼저 지우므로 unique 인덱스에 걸리지 않는다. 이어지는 `composing` 정리가 그 행도 지운다. `failed` 작업의 `failed` 행은 실제 실패이므로 남는다.
- **pgTAP**: `career_description_cancel.test.sql`에 16건을 더했다(28건 → 44건). 첫 생성, 다시 생성, `composing` + 낡은 행 여러 개, 범위 확인(실제 실패 유지, 다른 프로젝트 유지, 지워진 원본은 첫 생성)을 다룬다.
  - 수정 전 실행: **FAIL**. 50파일 2,351건 중 7건 실패(이 파일의 30~32, 34, 37, 39, 43번). 재현을 확인했다.
  - 수정 후 `supabase db reset` + `supabase test db`: **PASS, 50파일 2,351건, 실패 0**.
- **타입**: 다시 생성한 결과가 `database.types.ts`와 같아 파일을 바꾸지 않았다.
- **그 밖의 확인**: `pnpm typecheck` 통과, `pnpm test` 92파일 1,526건 통과. `pnpm lint`, `pnpm build`, 동시성 시험은 실행하지 않았다. 낡은 행은 트리거가 돌지 않도록 이미 끝난 작업으로 넣어 만들었고, 실제 잠금 경쟁으로 만든 것은 아니다.
- **W0 이전 행에도 적용된다**: W0 전에는 취소된 작업의 초안이 늘 `failed`로 남았다. 그런 행이 있으면 그 프로젝트의 다음 경력기술서 생성 때 삭제된다. 블록은 없지만 사용자가 바꾼 제목은 함께 사라진다. 로컬 외 적용은 아직 없다.
- **남은 일 (api-engineer)**: QA 제안 중 `listDrafts`의 `sectionCount`·`badge`를 `getDraft`처럼 비우는 부분은 DB 범위가 아니라 고치지 않았다. 다음 `begin` 전까지는 낡은 행이 조회에 그대로 보인다.
