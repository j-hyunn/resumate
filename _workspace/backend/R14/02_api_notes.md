# R14 API 구현 노트 — AI 모의 면접 MVP 제외 (api-engineer, 2026-11-08)

## 삭제한 파일
- `src/server/services/interview/**`(13), `src/server/actions/interview.ts`, `src/server/interview-routes.ts`, `src/server/jobs/interview.ts`
- `src/app/api/interview-sessions/**`(3 route), `src/app/api/application-projects/[id]/interview-sessions/route.ts`
- `src/lib/contracts/interview.ts`
- `src/lib/data/interviews.ts`·`interviews.integration.test.ts`·`interviews.deleted.test.ts`·`interview-rows.ts`·`interview-session-view.ts`·`interview-session-view.test.ts`
- **남긴 것 1개 `[가정]`**: `src/lib/data/interview-grading.ts` — 경과 파일. UI 소유 `src/lib/mock/grading.ts`가 import하고, 그 파일을 `src/lib/mock/ai.ts`가 런타임에 불러서, 지우면 mock 저장소를 쓰는 데이터 계층 모듈 전부(테스트 포함)가 import 단계에서 깨진다. 지워진 타입 대신 로컬 타입을 쓰고, 머리 주석에 "다음 UI 런에서 같이 삭제"를 적었다.

## 바꾼 파일 (백엔드 소유)
- 계약: `enums.ts`(아래), `account.ts`(`interviewSessions` 삭제), `application.ts`(`InterviewPrompt` 삭제, `MoveApplicationStageResult = StageChangeResult`, `ApplicationProgress`에서 `interviewCount`·`interviewInProgress` 삭제), `career.ts`(readiness `features` = `{insight, draft}`, `AffectedApplicationProject.interview_sessions`·`affected_results.detached_interview_sessions` 삭제, `ApplicationProjectDeletionImpact` = `{cascade:{insights, drafts, stage_events}}`), `evidence.ts`(`interview_answer` 라벨), `ai.ts`(주석), `routes.ts`(`PROTECTED_PREFIXES`에서 `/interviews` 삭제)
- 서비스: `application/write.ts`(`interview_prompt` 매핑 삭제), `application/read.ts`(진행 표시에서 면접 수 삭제, 원문 수정 조건 5에서 면접 질문 검사 삭제 — 교체된 RPC와 같음), `account/index.ts`, `shell/index.ts`(면접 세션 조회 삭제 + **정책 버전 2차 정렬**, 아래), `writing-chat/pipelines.ts`(복귀 대상 `job_interview` 분기), `career/rpc.ts`·`evidence/index.ts`·`application/extraction.ts`(주석)
- 작업: `jobs/definitions.ts`(면접 2종 등록 삭제), `jobs/cost.ts`(사용량 매핑 9행), `jobs/status.ts`(`loadRetryBlocked` 삭제 — 면접 전용이었음), `app/api/ai-jobs/[id]/route.ts`(그 호출 삭제)
- 오류: `db/errors.ts` 면접 raise 21개와 면접 전용 4개(`session_id_conflict`·`invalid_question_count`·`invalid_data_sufficiency`·`answer_not_evaluable` — 마이그레이션에서 면접 RPC에만 있음) 삭제, `interview_evaluation_input_only` details 분기 삭제
- 데이터 계층: `actions.ts`(면접 액션 5개 삭제), `ai-jobs.ts`(면접 mock 효과·다시 채점·남은 질문·`RegradeRefused`·`getLatestJobFor`의 `sessionWide` 삭제), `ai-errors.ts`(`SAME_ROW_RETRY_JOB_TYPES = ["insight"]`), `applications.ts`·`applications-real.ts`·`board-real.ts`(면접 필드·`toUiInterviewPrompt`·`interviewFeatureStatus` 삭제), `deletion.ts`(면접 세션 삭제·영향, detached 계산, 보존 세션 처리 삭제), `evidence.ts`·`evidence-real.ts`(`interview_answer`), `labels.ts`(아래), `readiness.ts`(2키, `data_sufficiency` 계산 삭제), `shell.ts`(면접 배지 2개), `usage-display.ts`(**5행**), `writing-chat-view.ts`, `account.ts`(탈퇴 요약 키, mock `currentVersion` 2차 정렬)
- `src/types/db.ts`: `ApplicationStage` 4값, `AiJobType` 9, `AiUsageFeature` 8, `AiProgressStage`에서 `evaluate`·`summarize`·`score`·`complete` 삭제, `EvidenceOwnerType` 3, `EvidenceSourceType`에서 `interview_answer`, `ReturnTargetFeature` 3, `PlaceholderToken`에서 `[사례 입력 필요]`, `ReadinessFeatureKey` = `insight | draft`, `ReadinessFeature.data_sufficiency` 삭제, 면접 타입 전부(`InterviewSession`·`InterviewQuestion`·`InterviewAnswer`·`AnswerEvaluation`·`SessionFeedback`·결과 타입·`InterviewType`·`QuestionCount`·`DataSufficiency`·상태·점수·출처 타입·`CriterionKey/Grade`·`InterviewEvaluationRefusalCode`·`InterviewPromptSession`) 삭제, `DeletionImpact`·`AccountDeletionSummary` 면접 키 삭제, `MoveApplicationStageResult` = `{application_project}`
- 테스트: `career.test`, `errors.test`, `support.test`(면접 재시도 차단 묶음 → 일반 1건), `account.test`·`account.integration.test`·`__fixtures__/all-slices.sql`(S8 행 삭제), `application.integration.test`(4단계 이동, 면접 단계 입력 거부, 4열 보드, 삭제 영향 키), `career.integration.test`, `insight.integration.test`, `insight/job.test`·`src/test/draft-fakes.ts`(`emptyCareerRows` → `context-pack/career-rows`), `lib/data` 테스트 6개, **신규 `src/server/services/shell/index.test.ts`**(정책 버전 정렬)

## 계약 변경 요약
- `enums.ts` = DB CHECK: `APPLICATION_STAGES` 4, `AI_JOB_TYPES` 9, `USAGE_FEATURES` 8, `EVIDENCE_OWNER_TYPES` {insight, draft_section, chat_message}, `EVIDENCE_SOURCE_TYPES` 9(`interview_answer` 없음), `RETURN_TARGET_FEATURES` 3. `INTERVIEW_STAGES`·`DATA_SUFFICIENCIES`·S8 enum 블록 전부 삭제. `AI_PROGRESS_STAGES`에서 면접 전용 4값 삭제(CHECK 없음, AI 명세 C-6 기준).
- `moveApplicationStage` 응답: `{applicationProjectId, stage, stageOutcome, stageChangedAt, changed}`만.
- `get_data_readiness` 파싱: `features` 2키(옛 키가 오면 zod가 무시).
- 사용량 표시 5행: 프로젝트/산출물 작성 AI 채팅 · 요건 추출 · 인사이트 · 자기소개서 작성 AI 채팅 · 연결 확인.
- `labels.ts`: `STAGE_ORDER`/`STAGE_LABELS` 4단계, `AI_STAGE_LABELS` 면접 단계 삭제, `aiStageLabel`은 단계 값만 본다(시그니처 유지), `AI_USAGE_FEATURE_LABELS`·`AI_FEATURE_NAMES`·근거 라벨의 면접 항목, `INTERVIEW_TYPE_LABELS`·`SESSION_STATUS_LABELS`·`INTERVIEW_READ_ONLY_MESSAGE`·`GRADE_LABELS`·`countsAsInterview` 삭제.

## 정책 버전 2차 정렬 (R14-DB-6, 리더 추가 지시)
- `loadPolicyVersions`: `.order("effective_at", desc)` 뒤에 `.order("version", desc)` — `private.current_policy_version`과 같은 순서. `lib/data/account.ts`의 `rows.find`가 고르는 첫 행이 같은 날 두 판 중 `2026-11-08.1`이 된다(새 테스트 2건으로 확인: 정렬 호출 순서, privacy·ai_data_use = `2026-11-08.1`, terms = `2026-11-08`).
- `lib/data/account.ts`의 미리보기용 `currentVersion`(백엔드 소유 파일 안에 있음)도 같은 2차 정렬로 바꿨다. `src/lib/mock/`에는 `currentVersion`이 없다 — UI 몫은 fixtures 행 추가(아래 UI 요청).

## UI 소유 파일 수정
- `src/components/account/policy-content.ts` (Minimal UI edits 예외, 리더 허용): `docs/legal/` 개정분과 같은 자리만 고쳤다.
  - terms: 정의 "AI 결과물"의 "모의 면접 질문·평가", 서비스 목록 "AI 모의 면접과 답변 평가"(목록이 1칸 줄어 번호 자동 조정 — 앱 본문은 호 번호를 문장에 쓰지 않음), 안내문 "(…, 모의 면접)", AI 결과물 3항(면접 점수 면책) 삭제
  - privacy: 1번 지원 관리 데이터 "모의 면접 질문·답변·평가", 6번 이전 항목(`CROSS_BORDER_ITEMS`의 "면접 답변"), 7번 삭제 "면접 세션", 8번 로그 최소화 "면접 답변" 삭제
  - cross_border_transfer: 이전 항목(같은 `CROSS_BORDER_ITEMS`), 목적 "(…, 모의 면접)" 삭제
  - `AI_DATA_USE_SECTIONS`: 1번 기능 목록, 3번 지원 관리 데이터 "모의 면접 질문과 답변", 6번 "면접 평가" 삭제, 머리 주석의 원문 판을 `2026-11-08.1`로
  - 버전·시행일은 이 파일에 없다(화면은 `policy_versions` 행을 읽음) — terms·cross_border `2026-11-08`, privacy·ai_data_use `2026-11-08.1`은 DB 행(`20261113002950`)과 위 정렬로 맞는다.
  - 검증: 수정 전 사본과 `diff` → 면접 문장 13곳 + 주석 2곳만 다름. `docs/legal` git diff의 면접 삭제 지점과 1:1. `AI_DATA_USE_SECTIONS`는 원문 문장 단위 대조 → 다른 5곳은 모두 기존 의도적 차이(5번 표를 `ai_disclosures` 안내로 대체, 링크 텍스트, 따옴표 이스케이프)로 R14와 무관.
  - 남은 기존 차이(R14와 무관, 손대지 않음): privacy 2번 "서비스 제공" 문장이 원문의 "지원 프로젝트·" 와 "AI 기능(인사이트, 서류 초안, AI 작성 대화)" 괄호 없이 줄여 적혀 있다 → UI 요청.

## UI 요청 (지운·바뀐 export → 그 export를 쓰는 UI 파일:줄)
**통째로 지울 면접 화면 파일**(내부 참조는 표에서 뺐다):
- src/app/(dashboard)/(gated)/applications/[id]/interview/[sessionId]/page.tsx
- src/app/(dashboard)/(gated)/applications/[id]/interview/[sessionId]/result/page.tsx
- src/app/(dashboard)/(gated)/applications/[id]/interview/page.tsx
- src/app/(dashboard)/(gated)/interviews/[sessionId]/result/page.tsx
- src/app/(dashboard)/(gated)/interviews/page.tsx
- src/components/interviews/actions.ts
- src/components/interviews/answer-sheet.tsx
- src/components/interviews/interview-prep.tsx
- src/components/interviews/interviews-overview.tsx
- src/components/interviews/jd-picker-dialog.tsx
- src/components/interviews/result-screen.tsx
- src/components/interviews/result-view.tsx
- src/components/interviews/session-list.tsx
- src/components/interviews/session-status.test.ts
- src/components/interviews/session-status.tsx

| export / 값 | UI 파일:줄 |
|---|---|
| `@/lib/data/interviews"` | `src/app/(dashboard)/(gated)/applications/[id]/page.tsx`:17 |
| `@/lib/data/interview-session-view` | `src/components/common/score-display.tsx`:12 |
| `@/lib/data/interview-grading` | `src/lib/mock/grading.ts`:6 |
| `getInterviewSessionDeletionImpactAction` | `src/components/common/delete-confirm-dialog.tsx`:32,153 |
| `getInProgressSessionAction` | `src/components/common/stage-menu.tsx`:59,162 |
| `interviews_in_progress` | `src/components/common/shell/app-sidebar.tsx`:71,93,99 |
| `interviews_new_results` | `src/components/common/shell/app-sidebar.tsx`:71,93,99 |
| `interview_session_count` | `src/components/applications/application-list.tsx`:304; `src/components/board/kanban-board.tsx`:499,500 |
| `in_progress_session` | `src/app/(dashboard)/(gated)/board/page.tsx`:108,109,114; `src/components/applications/application-list.tsx`:305; `src/components/board/interview-prompt-preview.tsx`:8; `src/components/board/kanban-board.tsx`:457; `src/components/common/stage-menu.tsx`:78,158,161 |
| `interview_status` | `src/app/(dashboard)/(gated)/applications/[id]/page.tsx`:71; `src/app/(dashboard)/(gated)/applications/page.tsx`:88; `src/components/applications/application-list.tsx`:278; `src/components/board/kanban-board.tsx`:460 |
| `interview_prompt` | `src/components/board/interview-prompt-preview.tsx`:8; `src/components/common/stage-menu.tsx`:78,157,158,161,164 |
| `kept_interview_sessions` | `src/components/common/delete-confirm-dialog.tsx`:332 |
| `INTERVIEW_TYPE_LABELS` | `src/app/(dashboard)/(gated)/applications/[id]/page.tsx`:20,214,222; `src/components/common/stage-menu.tsx`:50,505,531,533,534 |
| `SESSION_STATUS_LABELS` | `src/app/(dashboard)/(gated)/applications/[id]/page.tsx`:20,222 |
| `countsAsInterview` | `src/app/(dashboard)/(gated)/applications/[id]/page.tsx`:20,60 |
| `detached_interview_sessions` | `src/components/common/delete-confirm-dialog.tsx`:318 |
| `job_interview` | `src/app/(dashboard)/(gated)/applications/_lib/gate-preview.ts`:28; `src/app/(dashboard)/dev/states/page.tsx`:33,45; `src/components/common/basics.tsx`:61; `src/components/common/dev-state-gallery.tsx`:64,258,260; `src/components/common/return-banner.tsx`:24,31; `src/components/common/return-target.ts`:19; `src/lib/mock/fixtures.ts`:578,695,729; `src/lib/mock/writing-chat-turn.ts`:124,153 |
| `culture_fit_interview` | `src/components/common/basics.tsx`:62; `src/components/common/data-gate.tsx`:46; `src/components/common/return-banner.tsx`:27 |
| `InterviewType` | `src/components/common/stage-menu.tsx`:48,77,81; `src/lib/routes.ts`:8,87 |
| `InterviewSession` | `src/app/(dashboard)/(gated)/applications/[id]/page.tsx`:17,55; `src/components/board/interview-prompt-preview.tsx`:12,21; `src/components/common/delete-confirm-dialog.tsx`:32,153; `src/components/common/dev-state-gallery.tsx`:14,65; `src/components/common/provider-badge.tsx`:15,143,144; `src/components/common/score-display.tsx`:11,27; `src/lib/mock/fixtures.ts`:30,88,1209,1210,1211,1212,1247,1261; `src/lib/mock/grading.ts`:5,32,38,54 |
| `InterviewQuestion` | `src/lib/mock/fixtures.ts`:29,89,1329,1344 |
| `InterviewAnswer` | `src/lib/mock/fixtures.ts`:28,90,1373,1387 |
| `AnswerEvaluation` | `src/lib/mock/fixtures.ts`:18,91,1418,1442,1449,1459,1463; `src/lib/mock/grading.ts`:5,72 |
| `SessionFeedback` | `src/lib/mock/fixtures.ts`:37,92,1469,1493 |
| `QuestionCount` | `src/lib/mock/grading.ts`:49 |
| `AnswerScoreStatus` | `src/components/common/score-display.tsx`:11,116 |
| `InterviewGenerationStatus` | `src/components/common/stage-menu.tsx`:48,84 |
| `interview_questions` | `src/components/common/ai-lock.tsx`:59,230; `src/components/common/ai-progress.tsx`:118,153,207,282,303; `src/components/common/dev-state-gallery-v53.tsx`:242; `src/lib/mock/ai.ts`:87,114,171,388,400; `src/lib/mock/fixtures.ts`:89,925,928,1344,1638,1723; `src/lib/mock/grading.ts`:20,50,57 |
| `interview_evaluation` | `src/components/common/ai-lock.tsx`:60; `src/components/common/ai-progress.tsx`:119,154; `src/components/common/dev-state-gallery-v53.tsx`:243,244; `src/lib/mock/ai.ts`:88,116,171,177,389,401; `src/lib/mock/fixtures.ts`:902,907,930,931,932,933,1639,1640; `src/lib/mock/grading.test.ts`:6; `src/lib/mock/grading.ts`:14,63 |
| `interview_answer` | `src/lib/mock/fixtures.ts`:90,1385,1387,1724; `src/lib/mock/grading.ts`:21 |
| `"evaluate"` | `src/components/common/ai-progress.tsx`:119; `src/components/common/dev-state-gallery.tsx`:93,103; `src/lib/mock/ai.ts`:119; `src/lib/mock/fixtures.ts`:902,907 |
| `"summarize"` | `src/components/common/ai-progress.tsx`:119; `src/lib/mock/ai.ts`:118,119 |
| `"score"` | `src/components/common/ai-progress.tsx`:119; `src/lib/mock/ai.ts`:118,119 |
| `[사례 입력 필요]` | `src/components/common/placeholders.tsx`:31; `src/lib/mock/fixtures.ts`:1436 |
| `interviewSession(` | `src/app/(dashboard)/(gated)/applications/[id]/page.tsx`:202; `src/components/common/dev-state-gallery-v53.tsx`:66,67,69,70; `src/components/common/stage-menu.tsx`:546 |
| `interviewResult(` | `src/components/common/dev-state-gallery-v53.tsx`:55,56,60,61,63 |
| `"/interviews"` | `src/components/common/dev-state-gallery.tsx`:208; `src/lib/routes.ts`:92,141 |

추가:
- `src/components/account/usage-rows.test.ts`:30~45 — 7행 기대값 → 5행 (`usage-display.ts`)
- `src/components/common/shell/app-sidebar.tsx`·`src/lib/routes.ts`:87~98·128~141 — 모의 면접 메뉴·경로, `routes.ts`:8 `InterviewType` import (tsc 오류)
- `src/lib/mock/fixtures.ts`:1684~ `policy_versions` — privacy·ai_data_use `2026-11-08.1`, terms·cross_border `2026-11-08` 행 추가(R14-DB-6). mock 전체의 면접 테이블·행 삭제
- `src/lib/mock/grading.ts`·`grading.test.ts` 삭제 → 그다음 `src/lib/data/interview-grading.ts`(경과 파일)를 함께 삭제
- `src/components/common/placeholders.tsx`:31 `[사례 입력 필요]`
- `src/components/applications/insight-view.tsx`의 `data_sufficiency`는 AI-02 인사이트 결과 필드라 **그대로 둔다**

## 확인 결과
- `pnpm vitest run`: 146 파일 중 144 통과, 2345 중 2344 통과. 실패 2개 모두 UI 소유: `src/components/account/usage-rows.test.ts`(7행 기대), `src/components/interviews/session-status.test.ts`(지운 `interview-session-view` import). 로컬 스택 통합 테스트(w3·application·account·career 등) 실제 실행·통과.
- `pnpm tsc --noEmit`: **백엔드 소유 파일 오류 0**. 남은 오류 259건 = UI 소유 파일 249건(위 UI 요청 파일들 — `src/app/(dashboard)/**` 35, `src/components/**` 160여, `src/lib/mock/**` 47, `src/lib/routes.ts` 1) + `src/app/api/**/route.ts` 10건 `Cannot find name 'RouteContext'`(Next 타입 생성 전 상태, R14 이전부터 있음).
- eslint(바꾼 백엔드 파일): 0.
- `grep -rni interview src/server src/app/api src/lib/contracts src/lib/data src/types`: 남은 것
  - `src/server/ai/**` 9건 — ai-pipeline 소유, 삭제 이력 주석·음성 테스트(손대지 않음)
  - 음성 단정 4건: `career.integration.test.ts`:314(`detached_interview_sessions` 없음), `application.integration.test.ts`:203~204(`job_interview` 입력 거부), `w3.integration.test.ts`:564(`interview_sessions` 없음)
  - `src/lib/data/interview-grading.ts` — 위 경과 파일
  - AI-12 "면접 코치"·AI-02 `prepare_answer`는 한국어/다른 이름이라 grep에 안 걸림(그대로 유지)

## [가정]
- `interview-grading.ts` 경과 유지(위 사유). UI 런이 `lib/mock/grading.ts`와 함께 지운다.
- `AI_PROGRESS_STAGES`의 `complete`도 면접 전용으로 보고 지웠다(enums 주석 "last step of both interview jobs", AI 명세 C-6 표에 인사이트 쓰임 없음).
- `toAiJobStatusResponse`의 4번째 인자 `retryBlocked`는 호출자가 없어졌지만 시그니처 유지(다른 작업 종류에서 다시 쓸 수 있음).
- `PROTECTED_PREFIXES`에서 `/interviews`를 뺐다. UI 런 전까지 남은 `/interviews` 화면은 `(gated)` 레이아웃 가드만으로 막힌다(같은 배포로 화면이 사라짐).
