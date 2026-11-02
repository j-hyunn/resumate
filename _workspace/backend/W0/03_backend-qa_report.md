# W0 백엔드 QA 리포트 (라운드 1)

대상: 커밋되지 않은 작업 트리(Q53-1, 2, 3, 5, 6, 7, 10, 11 + 주소 계약). 코드는 고치지 않았다.

**결론: Critical 0, Major 2, Minor 3.** W0에서 만든 DB·서비스 경계는 실제 행으로 돌려 봐도 맞았다. Major 2건은 모두 페이지가 얽힌 주소 계약이고, 지금 동작을 깨기보다 W1 연결 때 터지는 항목이다. W1 전에 처리 방법을 정해야 한다.

## 검사 실행 결과

`supabase db reset` 뒤 `run-checks.sh --build`로 실행했다.

| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck | 통과 | |
| lint | 통과 | 출력 없음 |
| vitest | 통과 | 92파일, 1,526건, 건너뜀 0. 로컬 스택 통합 시험 포함 |
| build | 통과 | 정적 페이지 43개 |
| pgTAP | 통과 | 50파일, 2,335건 |
| 생성 타입 | 차이 없음 | `supabase gen types` 결과와 `database.types.ts` diff 0 |

### QA가 따로 돌린 시험 (저장소 밖, 16건 + 판정 비교 + 입력 검사 + 다른 사용자)

노트가 "실행하지 않았다"고 한 경계를 실제 행으로 돌렸다. 파일은 스크래치 `/private/tmp/claude-501/-Users-jehyun-Resumate--claude-worktrees-ui-work-a25919/9210b571-1278-40e3-934e-71c9c27ff730/scratchpad/qa/`에 있다. 끝난 뒤 `supabase db reset`으로 시험 행을 지웠다.

| 시험 | 방법 | 결과 |
|------|------|------|
| Q53-11 실제 행 | superuser로 `succeeded` + 요건 0개 행을 만들고 실제 `getJdView`·`updateFailedJdRawText`(user session) 호출 | 통과 |
| `jd_has_results` 긍정 경로 | 결과 4종 + 근거 2종(`insights` ready, `interview_questions`, `draft_sections.ai_content`, `evidence_links` `jd_sentence`·`jd_requirement`)을 넣고 `getJdView.rawTextLock`과 RPC를 비교. 지우면 풀리는 것도 확인 | 5종 모두 양쪽 `jd_has_results`, RPC 409 |
| 음성 대조 | `failed` 인사이트, 질문 0개 세션, `ai_content` 없는 문항 | 잠기지 않음, 저장 성공 |
| 가드 트리거 | `raw_text`만, `succeeded→pending`, `succeeded→failed`, 도장만, 원문+도장(상태 유지) | 5건 모두 `job_description_immutable` |
| 지난 실패 규칙 | 실제 조회 `getJdView`, `getInsight`, `getAnswerSheet`, `listInterviewSessions`, `getInterviewPrep`, `getApplicationHub` | 통과. 수정 뒤 끝난 새 실패는 다시 나타남 |
| `gradingDecision` 대조 | 세션 상태 6 × 종합 원인 5 × 답변 상태 8² = **1,920개 실제 세션**. `get_interview_grading_decisions` ↔ `buildGradingFacts` + `gradingDecision` | 불일치 **0** (판정, 원인, 대상 수, 성공 수) |
| `begin` 평가 대상 | 같은 1,920개에서 `answers_to_evaluate` 길이 ↔ `regrade_target_count` | 불일치 0 |
| Q53-7 실행기 | 실제 `runCareerDescription`·`AiRun`·RPC·트리거, 스트림만 가짜 | 통과 (아래 표) |
| 원문 입력 검사 | zod를 통과하는 이상한 입력 11종(`​`, 기호만, BOM, NEL, 25,000 이모지, 20,000문장 등) | 모두 저장 성공, 500 없음 |
| 다른 사용자 | 판정 RPC, 수정 RPC, 열람 RPC, 컬럼 직접 update | 빈 결과 / `job_description_not_found` / `interview_session_not_found` / 42501 |

## 경계면 검사

| # | 경계 | 결과 | 이슈 |
|---|------|------|------|
| Q1 | DM ↔ 마이그레이션 | 통과 | 2.6.1 바꾸는 값, 2.7.1 표, 2.11.7 경로 ⑥을 RPC 본문과 비교 |
| Q2 | 마이그레이션 ↔ 타입 ↔ 쿼리 | 통과 | diff 0 |
| Q3 | RPC ↔ 호출자 | 통과 | 인자·반환 키. 판정 RPC의 null은 `RawRow`가 처리 |
| Q4 | raise ↔ 오류 매핑 | 이슈 | QA-W0-05 |
| Q5 | 계약 ↔ 처리기 ↔ 화면 명세 | 이슈 | QA-W0-01, QA-W0-02 |
| Q6 | SSE | 통과 | 중단 시 `generation_started` → `error(canceled)`. 이벤트 이름 변경 없음 |
| Q7 | AI 출력 ↔ 저장 | 해당 없음 | `src/server/ai/` 변경 없음 |
| Q8 | enum DB ↔ TS | 통과 | `answer_evaluations_error_code_check` = `ai_jobs_error_code_check` = `AI_ERROR_CODES` 15개, 순서까지 같음 |
| Q9 | 작업 종료 경로 | 이슈 | QA-W0-03, QA-W0-04. 나머지 경로는 통과 |
| Q10 | 보안·개인정보 | 통과 | 아래 |
| Q11 | UI ↔ 백엔드 | 부분 | 판정 대조 통과. 연결은 W1~W4 범위. `?error=`는 QA-W0-01 |

## 요청 항목별 결과

### Q53-11: `succeeded` + 요건 0개
RPC, 가드 트리거, `getJdView` 세 곳의 판단이 같았다. 흐름: 수정 가능 → `begin_jd_extraction`은 `already_extracted`로 거부 → 공백만 다른 저장은 `jd_raw_text_unchanged`(409) → 저장하면 `pending`, `tech_keywords` null, `extraction_job_id` null → `techKeywords: []`로 읽힘 → 다시 `jd_raw_text_locked`. `hasRowsFromThisText`의 사용자 세션 조회가 RLS·컬럼 권한에 막혀 0건으로 읽히는 일은 없었다.

한계: 행은 superuser로 넣었다. AI-01 정상 경로에서는 이 상태가 생기지 않으므로(DM 2.6.1) 다른 방법이 없다.

### `gradingDecision` 대조
DM 2.7.1 표의 6행과 "그 밖"이 모두 1,920개 안에 있다(`regrade`, `resummarize`, `input_only`, `none` 각각 등장). 원인은 질문 순서 기준으로도 같다(`input_too_long`·`safety_blocked`를 양쪽 순서로 넣었다).

`clearsNewResultOnView` ↔ `mark_interview_result_viewed`: 저장된 `status`를 넘기면 불일치 0이다. 실효 상태를 넘기면 작업 없는 `evaluating` 59개 조합이 어긋난다(TS는 지움, SQL은 유지). DM 문구와 db 노트 ⑦대로라서 이슈로 올리지 않았다. W4에서 RPC 결과만 믿으면 문제가 없다.

### 거부 코드 순서, HTTP, 2.11.7
- `update_failed_jd_raw_text` 순서: DM 2.6.1과 같다. `jdRawTextLockOf`의 1~5도 같은 순서이고, `running` + 작업 `canceled`도 양쪽 모두 `jd_raw_text_locked`다.
- HTTP: `jd_*` 5개와 `interview_evaluation_input_only`는 409(`details.cause` 포함), `job_description_not_found`는 404 `not_found`, `invalid_raw_text`는 400, `key_invalid`·`ai_consent_required`는 409. 예외는 "스펙 차이" 첫 항목.
- 경로 ②: `not_found` → 진행 중 따라감 → `ai_job_not_retryable`(입력 원인, 요청 범위, 대상 0) → `key_missing` → `key_invalid` → `ai_consent_required` → `ai_connection_changed`. 실행기(`runner.ts:268~281`)와 `retry_ai_job` 모두 대상 0을 연결 게이트 앞에서 본다. pgTAP `interview_grading.test.sql:235~241`이 이를 단언한다.
- 세션이 없어진 경우 실행기 판정은 통과하지만 `ai_jobs_application_project_fkey`가 cascade라 작업도 함께 사라져 실제로 나오지 않는다.
- 상태 응답: `toAiJobStatusResponse`를 쓰는 곳은 `GET /api/ai-jobs/{id}` 하나이고 `retryBlocked`를 넘긴다. 다른 경로로 미리보기가 새지 않는다.

### Q53-7 중단 경로 (실행기 전체)

| 경우 | 초안 | 작업 | SSE |
|------|------|------|-----|
| 첫 생성 중단 | `composing`, `options`·제목 유지, 문항 0, `ai_job_id` null | `canceled` | `error(canceled)` |
| 다음 생성 시작 | 이전 `composing` 삭제, 지워진 행을 가리킨 `regeneratedFromId`는 첫 생성으로 | | |
| 다시 중단 | `composing` 1개 | `canceled` | |
| `[삭제]` | 행 삭제 | | |
| 다시 생성 중단 | 새 행 삭제, 원본 행은 `to_jsonb` 동일, `getDraft` 404, 목록에는 원본만 | `canceled` | `error(canceled)` |
| 중단 뒤 늦은 complete, 첫 생성 | `invalid_ai_job` → `targetGone`, `composing` 유지, 문항 0 | `canceled` | `error(canceled)` |
| 중단 뒤 늦은 complete, 다시 생성 | `draft_not_found` → `targetGone`, 행 없음 | `canceled` | `error(canceled)` |
| 취소 요청 뒤 `validated` 먼저 | `ready` | `succeeded` | `validated`, `done` |
| 공급자 실패 | `failed`, 문항 `failed` | `failed` | `error` |

`loadDraftCounts`는 중단된 첫 생성을 세지 않는다. C-05 N은 `progress.draftCount`에서 오므로 같은 규칙이다.

`validated` 뒤 `done` 전에 중단이 끼어드는 경우(초안 `ready` + 작업 `canceled` + `error`)는 가짜 스트림에서만 재현됐다. 실제 AI-03은 `persist` 뒤 신호를 기다리는 지점이 없어(`AI-03.ts:351`) 이슈로 올리지 않았다.

### 지난 실패 규칙

| 화면 | 수정 전 | 수정 후 |
|------|---------|---------|
| S-15 `getJdView` | `lastFailure: not_a_jd`, 잠김 없음 | `pending`, `lastFailure: null`, `jd_raw_text_locked` |
| S-16 `getInsight` | | `lastFailure: null`, `rawTextEditedAt` 있음. 수정 뒤 끝난 `provider_unavailable`은 표시 |
| S-33 `getAnswerSheet` | `failure: not_a_jd` | `failure: null`, `failureHidden: raw_text_edited`, `canRetry: false` |
| S-33 작업 정리 뒤 | | `failureHidden: job_gone` |
| S-37·S-20 | | 응답에 실패 원인 필드가 없음(`not_a_jd` 문자열 자체가 응답에 없음) |

### 주소 계약
- 대상 페이지: `/sign-in`, `/consent`, `/career`, `/settings/withdraw`, `/settings/withdraw/finalize`, `/auth/callback` 모두 존재한다. 옛 경로(`/login`, `/onboarding/consent`, `/settings/account/delete`)는 "이제 보호 경로가 아님"을 단언하는 시험 1줄에만 남았다.
- `PROTECTED_PREFIXES`는 `/dev/states`를 뺀 모든 셸 페이지를 덮는다. `/dev/states`는 운영에서 `notFound()`다(`isPreviewEnabled`). api 노트 "UI 요청 3"보다 위험이 작다.
- 고리 없음: 미완료 → finalize(게이트 없음, 끝) / finalize + 활성 → withdraw / withdraw + 미완료 → finalize. 두 페이지가 같은 상태 함수를 보므로 왕복이 생기지 않는다.
- `next`: `/consent?next=%2Fconsent`는 UI `safeNextPath`가 거른다. 계약 쪽이 `/consent`를 허용해도 고리는 없다(spec-gaps ⑱).
- `accountDeletionFinalize` 추가는 타당하다. `requireConsentedUserOrRedirect`, `requireUserForConsentPage`, `completeAuthCallback` 세 곳이 모두 동의 게이트보다 먼저 보내고, 뒤로 돌아갈 `next`를 일부러 붙이지 않는다(A7 "원래 URL보다 먼저"). `accountDeletion`만 쓰면 레이아웃 가드에서 고리가 생긴다는 근거도 맞다.
- A7, 미완료 계정: finalize가 `(public)` 안이고 프록시에 동의 게이트가 없어 충족한다. A7, 활성 계정의 S-25: QA-W0-02.

### RLS, 권한, `app_ai_writer`
| 대상 | 실제 ACL·권한 |
|------|---------------|
| `update_failed_jd_raw_text` | `authenticated`만. `service_role`, `app_ai_writer`, `anon` 없음 (DM과 같음) |
| `get_interview_grading_decisions` | `authenticated`, `app_ai_writer` |
| `fail_answer_evaluation(uuid,uuid,text)` | `app_ai_writer`만. 옛 2인자 함수 없음 |
| `private.interview_grading_decision` 등 새 private 함수 | owner만 |
| `job_descriptions.raw_text_edited_at`, `answer_evaluations.error_code` | `authenticated`·`app_ai_writer`·`service_role` SELECT만. 사용자 세션 update는 42501로 확인 |

security definer 함수는 모두 `search_path = ''`이고 소유자를 확인한다. `app_ai_writer`에는 커리어 테이블 쓰기가 늘지 않았다. W0 서버 코드에 새로 생긴 로그는 `jd_extraction.reload_failed { jobId }` 1줄이고 `details.cause`는 코드값뿐이다. 프롬프트, 원문, 키 노출 없음.

## 이슈

### QA-W0-01 [Major] 콜백 실패 안내가 나오지 않음 (`/sign-in?error=auth_callback`)
- 담당: api-engineer(W1 연결), 페이지가 UI 소유라 리더 조율
- 근거: `src/server/services/auth/index.ts:85` (`LOGIN_CALLBACK_ERROR`) ↔ `src/app/(public)/sign-in/page.tsx:40-42` (`getPreviewState(sp)`만 읽음), `SignInForm`의 `link-expired`는 `?state=` 미리보기 전용. 운영에서는 `isPreviewEnabled`가 false라 미리보기도 없다.
- 실패 시나리오: 만료된 매직 링크를 누른다 → 콜백이 `/sign-in?error=auth_callback`으로 보낸다 → 평범한 로그인 폼만 보이고 왜 실패했는지 알 수 없다. `LOGIN_ERRORS` 계약의 유일한 값이 받는 쪽 없는 코드다.
- 확인 방법: 코드 양쪽 비교. api 노트 "UI 요청 1"과 같은 내용이고 `spec-gaps.md`에는 없다.
- 수정 제안: W1에서 `?error=auth_callback`을 `link-expired` 표시로 연결한다.
- 상태: 열림

### QA-W0-02 [Major] 활성 계정의 S-25가 W1 레이아웃 게이트에 걸림 (A7)
- 담당: api-engineer(W1), 리더 결정 필요
- 근거: `src/app/(dashboard)/settings/withdraw/page.tsx`가 `(dashboard)` 안 ↔ `src/server/auth/session.ts:75` 주석 "the UI's dashboard layout calls this at wiring time" ↔ `src/lib/contracts/routes.ts`의 `accountDeletion` 주석 "OUTSIDE the consent gate". `spec-gaps.md` ⑪이 `[미해결, W1]`로 적었다.
- 실패 시나리오: 약관 개정으로 재동의가 필요한 활성 사용자가 탈퇴하려고 `/settings/withdraw`를 연다 → 주석대로 레이아웃에 `requireConsentedUserOrRedirect`를 넣으면 `/consent?next=/settings/withdraw`로 간다 → 탈퇴하려면 먼저 약관에 동의해야 한다. A7 위반이다. 레이아웃은 현재 경로를 몰라 예외 처리도 간단하지 않다.
- 확인 방법: 레이아웃을 읽어 지금은 게이트가 없음을 확인했다(`layout.tsx`). 아직 재현되는 버그가 아니라 W1 지시대로 하면 생기는 결함이다. `deleteAccount`와 `getAccountDeletionSummary`는 이미 `requireUser`라 서버 쪽 막힘은 없다.
- 수정 제안: W1 시작 전에 정한다. (a) S-25를 게이트 없는 경로 그룹으로 옮긴다(UI 변경, 셸 필요 여부 판단) (b) 동의 게이트를 레이아웃이 아닌 페이지 또는 하위 그룹 레이아웃에 둔다. `session.ts:75` 주석도 함께 고친다.
- 상태: 열림 (W1 선행 조건)

### QA-W0-03 [Minor] `begin_career_description`이 낡은 `failed` + `canceled` 행을 정리하지 않음
- 담당: db-engineer
- 근거: `supabase/migrations/20261107000500_w0_career_description_cancel.sql:213-217` (`d.status = 'generating'`만) ↔ `src/server/services/drafts/read.ts:193-194` (`generating`·`failed` 모두 중단으로 읽음) ↔ spec-gaps ④·⑬
- 실패 시나리오: 실행기가 취소 표시 없이 `failed`로 쓴 직후 작업이 `canceled`로 닫히고, 트리거가 잠금으로 건너뛴다. 이 행은 조회에서 `composing`으로 읽히지만 저장값은 `failed`라 `begin`이 지우지 않는다. 다음 생성을 중단하면 목록에 `composing` 2개가 나온다(UX S-17 "프로젝트당 1개" 위반, unique 인덱스는 저장값만 본다). 다시 생성 행이었다면 목록에서 숨겨진 채 영구히 남고 `loadDraftCounts`에는 계속 세어진다.
- 확인 방법: 고정 데이터로 재현했다. 출력 `list [["new","composing"],["stale","composing"]]`. 저장 상태 `failed`와 `composing`. 트리거를 잠시 꺼서 낡은 모양을 만들었으므로 실제 발생 빈도는 낮다(취소 표시 없이 끝나는 창 + 프로젝트 잠금).
- 같은 행의 표시 문제: `listDrafts`는 이 행에 `sectionCount`와 `badge`를 그대로 준다(`read.ts:280,288`). `getDraft`는 비운다.
- 수정 제안: `begin`의 정리 조건을 `d.status in ('generating', 'failed')`로 넓힌다(`j.status = 'canceled'` 유지). `career_description_mark_failed`는 이미 이 모양을 처리한다. 목록도 `getDraft`와 맞춘다.
- 상태: 열림

### QA-W0-04 [Minor] Q53-11 JD의 질문 작업 같은 행 다시 시도는 수정 뒤 항상 `stalled`
- 담당: api-engineer (기획 문구 포함)
- 근거: `docs/planning/04-data-model.md` 2.6.1 "이미 묶인 행" ("추출 실패로 끝난 작업에는 `prepare` 출력이 없어 다시 돌면 새 원문으로 추출한다") ↔ `src/server/services/interview/job.ts:382-396` (`prepare` 체크포인트 저장, 질문 맥락에 원문 없음) ↔ `job.ts:369-370` (`if (!jd) throw systemFailure()`) ↔ `src/server/services/interview/db.ts:63` (`extractionStatus !== "succeeded"`면 null)
- 실패 시나리오: 요건 0개 `succeeded` JD에서 질문 작업이 `generate` 단계의 `provider_unavailable`로 실패한다. 질문이 없어 원문 수정이 허용되고 JD는 `pending`이 된다. 같은 공급자로 `POST /api/ai-jobs/{id}/retry`를 부르면 `prepare`가 건너뛰어져 추출 없이 `generate`로 가고 `stalled`로 끝난다. 잘못된 데이터는 남지 않고 S-33 버튼은 `failureHidden`으로 꺼지지만, `GET /api/ai-jobs/{id}`는 `canRetry: true`를 준다. DM 문구는 실패 JD만 고려했고 Q53-11을 넣으며 가정이 깨졌다.
- 인사이트는 해당 없다. `prepare`가 요건 0개면 `not_a_jd`로 끝나 체크포인트를 남기지 않는다(`insight/job.ts:200`).
- 확인 방법: 코드 경로 추적. **실제 실행은 하지 않았다.**
- 수정 제안: `retryBlocked`와 같은 방식으로 "JD가 `succeeded`가 아닌데 `prepare` 체크포인트가 있으면 `ai_job_not_retryable`"로 막거나, `prepare`를 다시 돌린다. 안전망 경로라 우선순위는 낮다.
- 상태: 열림

### QA-W0-05 [Minor] 매핑 없는 raise 2개
- 담당: api-engineer
- 근거: `supabase/migrations/20261107000300_w0_answer_evaluation_error_code.sql:62` `invalid_error_code`, `20261107000200_w0_jd_raw_text_edit.sql:23,30` `job_description_immutable` ↔ `src/server/db/errors.ts` `RAISE_MESSAGES`에 없음. W0 마이그레이션의 나머지 36개 코드는 모두 매핑된다.
- 실패 시나리오: 일반 앱 경로로는 닿지 않는다(`job.ts`가 `AiErrorCode`만 넘기고, 사용자 세션은 JD update 권한이 없어 42501). 닿으면 일반 500이 되어 원인이 코드로 드러나지 않는다.
- 수정 제안: 둘 다 `internal_error`(500)로 명시해 Q4 목록을 닫는다.
- 상태: 열림

## 실행하지 못한 것

- **동시성**: 수정 ↔ 추출 시작 경쟁, 트리거 `skip locked`의 실제 잠금 경합. 코드 순서만 읽었다(잠금 순서 `application_projects` → `job_descriptions` 일치, `ensureJdExtracted`의 `begin` 뒤 재조회 확인).
- **브라우저, 실제 페이지 이동**: 주소 표의 고리 분석은 코드 기준이다. 페이지는 아직 mock 계층이라 게이트 동작을 실제로 볼 수 없다. `next build`의 경로 생성까지만 확인했다.
- **공급자 호출이 있는 중단**: Q53-7 시험의 스트림은 가짜다. "쓴 토큰의 `ai_usage_records`가 남는다"는 FK 확인(`drafts`·`ai_jobs` 삭제가 사용 기록에 닿지 않음)까지이고, 실제 사용 기록 행으로는 보지 않았다.
- **실제 공급자, 실제 키**: 계획상 없음.
- **원격 브랜치, `get_advisors`**: 계획상 없음.
- `jd_requirement`·`interview_questions` 등 고정 행은 superuser로 넣어 일부 트리거 경로를 거치지 않았다(판정 대조 1,920개는 `session_replication_role = replica`로 생성). CHECK는 그대로 적용됐다.

## 스펙 차이 (`spec-gaps.md`에 옮길 항목, QA는 파일을 고치지 않았다)

- **DM 2.6.1 HTTP 표**: `invalid_raw_text_hash`·`invalid_sentences`를 400 `[가정]`이라 적었지만 구현은 500 `internal_error`다(`errors.ts:117-118, 241-242`). 해시와 문장은 서버가 만들고, 입력 검사 11종에서도 닿지 않아 500이 더 맞아 보인다. 문서를 고치는 쪽을 제안한다.
- **DM 2.6.1 "이미 묶인 행"**: QA-W0-04의 가정 깨짐.
- **api 노트 "UI 요청 3"**: `/dev/states`는 운영에서 `notFound()`다. 남은 결정은 빌드 포함 여부뿐이다.
- 이미 기록되어 있고 실제로 확인한 항목: ⑦(작업 없는 `evaluating`의 표식), ⑭(S-16 작업 없음은 `stalled`), ⑱(`safeNextPath` 두 벌, 고리 없음).
