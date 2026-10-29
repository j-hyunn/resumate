# S8 API 구현 노트 (모의 면접: AI-05 · AI-06 · AI-07)

> 상태: 구현 완료. `pnpm typecheck`·`pnpm lint` 통과, `pnpm test` 84 파일 1319개 전부 통과(로컬 스택 통합 8개 포함, skip 0). 커밋하지 않음.
> 연결(wiring): UI 화면(S-20/S-33/S-22/S-37) 없음 → A4 interview "연결 대기". `src/lib/data`는 건드리지 않음.

## 엔드포인트 (계획 "계약 — API" ↔ 파일)
| 작업 | 방식 | 파일 · 함수 |
|------|------|-------------|
| 면접 시작 (AI-05 작업) | `POST /api/application-projects/[id]/interview-sessions` | `src/app/api/application-projects/[id]/interview-sessions/route.ts` → `services/interview/start.ts` `startInterviewSession` |
| 남은 질문 다시 만들기 | `POST /api/interview-sessions/[id]/questions/retry` | `.../questions/retry/route.ts` → `retryInterviewQuestions` |
| 제출 (채점 작업) | `POST /api/interview-sessions/[id]/submit` | `.../submit/route.ts` → `submitInterviewSession` |
| 다시 채점 | `POST /api/interview-sessions/[id]/evaluation/retry` | `.../evaluation/retry/route.ts` → `retryInterviewEvaluation` |
| 상태·취소 | 기존 `GET /api/ai-jobs/{id}`, `POST /api/ai-jobs/{id}/cancel` | 변경 없음(`partial`은 null — 질문은 `getAnswerSheet`가 읽음) |
| 자동 저장·그만두기·삭제·결과 확인 (키 불필요) | Server Actions | `src/server/actions/interview.ts` `saveInterviewAnswer`, `abandonInterviewSession`, `deleteInterviewSession`, `markInterviewResultViewed` → `services/interview/write.ts` |
| 조회 S-20 / S-33 / S-22 / S-37 | 서비스(Server Component용) + 같은 이름 액션 | `services/interview/read.ts` `getInterviewPrep`, `getAnswerSheet`, `getInterviewResult`, `listInterviewSessions` |
| 진행 표시 | `loadProgress` 확장 | `services/interview/progress.ts` `loadInterviewProgress` ← `services/application/read.ts` |
| 보드 팝업(C-14) | `moveApplicationStage` 매핑 | `services/application/write.ts` `toInterviewPrompt` (+ `inProgressSession`) |
| 운영 연결 | 파이프라인 어댑터·작업 등록 | `src/server/jobs/interview.ts`, `src/server/jobs/definitions.ts`, `src/server/interview-routes.ts` |

- 작업 정의: `services/interview/job.ts` (`createInterviewQuestionsJobDefinition`, `createInterviewEvaluationJobDefinition`, 파이프라인 인터페이스 `InterviewPipelines`, 입력 로더 `InterviewInputLoaders` — 테스트에서 교체). DB: `services/interview/db.ts` (입력 읽기, `InterviewStore` = app_ai_writer RPC 래퍼 9개). 표시 규칙: `services/interview/view.ts`.
- 실행기 확장(`src/server/jobs/types.ts`, `runner.ts`): `StepContext.wouldRetry(err)` — 실행기가 그 오류로 이 단계를 자동 재시도할지(C-11.3 정책, 이번 실행의 단계별 재시도 횟수, 120초 상한, 첫 토큰 뒤 스트림)를 실행기와 같은 판단으로 돌려준다. 여러 단위를 한 단계에서 하는 단계(AI-06 답변들)가 "더 재시도 없음"이면 그 단위만 실패로 닫는 데 쓴다.

## 계약 (`src/lib/contracts/interview.ts`, `enums.ts`, `application.ts`)
- enums(DM CHECK 대조용): `INTERVIEW_TYPES`, `INTERVIEW_QUESTION_COUNTS`, `INTERVIEW_SESSION_STATUSES`, `INTERVIEW_GENERATION_STATUSES`, `INTERVIEW_SOURCE_KINDS`, `INTERVIEW_ANCHORS`, `INTERVIEW_ANSWER_STATUSES`, `SESSION_SCORE_STATUSES`, `ANSWER_SCORE_STATUSES`, `INTERVIEW_RESULT_STATUSES`, `EVALUATION_CRITERIA_KEYS`, `EVALUATION_GRADES`, `NEXT_PRACTICE_TYPES`.
- 시작: 입력 `StartInterviewSessionInput { interviewType, questionCount?=5 }`(strict). 200 `{ sessionId, jobId, dataSufficiency }`. 422 `{ error: insufficient_data, readiness }`(직무만, `features.job_interview`). 409 `interview_in_progress` + `error.details.sessionId`, 409 `ai_not_connected`/`key_invalid`/`ai_consent_required`.
- 남은 질문: 200 `{ sessionId, jobId, inProgress }`, 409 `interview_generation_not_failed`.
- 제출: 200 `{ sessionId, status: evaluating|completed, jobId|null, answeredCount, unansweredCount }`(응답 0개면 `jobId: null`, AI 없음). 409 `interview_already_submitted`/`interview_not_ready`/`interview_not_in_progress`.
- 다시 채점: 200 `{ sessionId, jobId, inProgress }`, 409 `interview_evaluation_not_retryable`.
- 액션: `SaveInterviewAnswerInput { answerId, answerText ≤ 5000 }` → `{ answerId, sessionId, updatedAt, answeredCount, lastActivityAt }`. RLS가 0행으로 막으면 이유를 읽어 409 `interview_already_submitted`/`interview_not_in_progress`/`interview_not_ready`, 없거나 남의 것이면 404. `InterviewSessionIdInput { sessionId }`(그만두기·삭제·결과 확인·조회).
- 조회 모양
  - `InterviewSessionListItem`: 표시 상태(`status`, `generationStatus`), `score`(C-17 슬롯, 제출 전 `status: null`, `noAnswers`), `isNewResult`, `executionProvider`(`single{role}` / `split{question, evaluation}`), `activeJob`(C-03 축약).
  - `InterviewPrepView`(S-20): readiness(`jobInterview`, `cultureFit.dataSufficiency`), `aiConnection`, `inProgressSession`, `sessions`(작성 중 → 그 밖 최신순 → 그만둠).
  - `AnswerSheetView`(S-33): `session` 헤더, `items[{question(비공개 컬럼 없음, 근거 칩), answer}]`, `editable`, `generation{status, savedCount, remainingCount, activeJob, failure, canRetry}`, `canSubmit`.
  - `InterviewResultView`(S-22): 세션 점수, `weakRequirements[{id, content|null}]`, `items[{question + intent(공개), answer{score}, evaluation, evaluationFailed}]`, `feedback`(question_ids·requirement_ids로 변환된 값, `criteriaSummary`), `evaluationProvider`(C-19), `activeJob`, `lastFailure`, `canRetryEvaluation`, `firstView`.
  - `InterviewSessionList`(S-37): `inProgress`, `sessions`, `abandoned`, `hasApplicationProjects`(빈 상태 두 종류).
- 비공개 컬럼: 사용자 경로는 질문 컬럼을 나열해 읽는다(`USER_QUESTION_COLUMNS`). `intent`는 결과 조회에서 `get_interview_question_reveals`로만, `good_answer_signals`는 어디에도 없다. app_ai_writer만 AI-06/07 입력용으로 읽는다(`loadSessionForEvaluation`).
- `InterviewPrompt`에 `inProgressSession` 추가(기존 `inProgressSessionId` 유지).
- 오류 매핑(`src/server/db/errors.ts`): db 노트의 raise 전부. `interview_session_not_found`·`interview_answer_not_found` → 404 `not_found`, 서버가 만든 인자 오류(`invalid_interview_payload` 등) → 500 `internal_error`.

## 작업 흐름
- **interview_questions** (`target_type = interview_session`, 기본 등급)
  - `prepare`: D-30 `ensureJdExtracted`(작업의 고정 공급자, S6과 같은 추출기) → `begin_interview_questions`. 세션·프로젝트가 없어졌거나 그만둔 세션이면 `canceled`.
  - `generate`: 저장된 질문(+근거 출처)을 다시 읽어 `generateInterviewQuestions`를 **실행 1번에 1번** 부른다. 질문이 닫힐 때마다 `save_interview_question`(멱등, sequence 기준) → 진행 `{generate, 저장 수, 질문 수}`. 모자라면 `savePartial({attempts, weakRequirementIds, unsupportedNumbers})` 후 STEP_CONTINUE → 다음 실행에서 남은 개수 재생성(무료 등급 간격 적용). 2번 뒤에도 모자라면 `schema_invalid`(재시도 없음). 스트림 중 실패해도 저장된 질문은 남고, 재시도·새 작업은 남은 개수만 만든다.
  - `complete`(호출 없음): `buildCompleteInterviewQuestionsPayload` → `complete_interview_questions` → 실행기가 `complete_ai_job`. `stale_run`이면 `stalled`.
- **interview_evaluation** (기본 등급)
  - `prepare`(호출 없음): `begin_interview_evaluation(작업 공급자, 해석된 모델)` → 평가할 답변(성공 평가가 없는 submitted).
  - `evaluate`: 유료는 병렬, 성공한 답변은 그 즉시 `save_answer_evaluation`(재시도 때 다시 부르지 않음). 무료는 실행 1번에 답변 1개(STEP_CONTINUE, 6초 간격). 실패 분류: 취소·중단 → 그대로, `wouldRetry` → 단계 재시도(성공분 제외), 키·계정·한도 범주 → 작업 실패, 그 밖 → `fail_answer_evaluation`(`not_scored`) 후 진행. 진행 `{evaluate, 처리 수, 대상 수}`.
  - `summarize`: 성공 평가가 1개 이상이면 AI-07(세션 `career_snapshot_hash` 포함) → `save_session_feedback`. 0개면 호출 없이 건너뜀(무료 간격도 없음).
  - `score`: D-14 전이라 아무것도 하지 않음.
  - `complete`: `complete_interview_evaluation`. `evaluation_failed`(모든 답변 실패)면 첫 실패 원인 코드로 작업 실패.
- 사용 기록: 공급자 호출마다 1행(실패·재시도 포함, 실행기 `onCall`). callKey `interview_questions.generate[.n]`, `interview_evaluation.evaluate.<sequence>`, `interview_evaluation.summarize`.
- 키 삭제 중간(D-36): 다음 호출이 `key_missing` → 작업 실패, 저장된 질문·답변·평가 보존.
- 그만두기: `abandon_interview_session`이 생성 작업에 취소 요청 → 실행기 `canceled` → 트리거가 `generation_status = failed`.

## 조회 규칙
- 남은 작업 규칙(S6·S7): `generating`인데 진행 중 질문 작업이 없으면 `failed`, `evaluating`인데 진행 중 채점 작업이 없으면 `evaluation_failed`. 실패 정보는 그 종류의 최신 작업(성공으로 끝났는데 반영 안 됐거나 없으면 `stalled`).
- 실행 공급자: 채점 시작(`evaluation_provider` 있음) → 채점, 아니면 질문, 공급자가 다르면 둘 다.
- 목록 정렬: 작성 중 맨 위, 그만둠 아래 묶음, 각 묶음 최신순. 상태 필터는 표시 상태 기준.
- 결과를 처음 열면 `mark_interview_result_viewed`(completed일 때만 DB가 기록).

## 테스트
- `services/interview/job.test.ts`(14, 실제 실행기 + 스크립트 공급자 + 메모리 세션 DB): 질문 스트림 저장·진행·완료 / 모자람 → 1회 재생성(기존 질문 전달, 약한 요건 합침) / 재생성 후에도 모자람 → `schema_invalid`, 질문 보존 / 2개 저장 뒤 스트림 실패 → 새 작업이 남은 3개만 / 무료 등급 재생성 간격 / 그만두기 취소 / 유료 병렬 채점(미응답 제외, 사용 기록 callKey) / 답변 1개 최종 실패 → `not_scored`, 종합은 나머지로, 다시 채점은 그 답변 + 종합만 / 재시도 가능 실패 → 그 답변만 다시 호출 / 키 삭제 → `key_missing`, 평가 보존 / 무료 순차 6초 간격 / 모든 답변 실패 → 종합 호출 없음, `evaluation_failed`, 작업 실패 코드 / 종합 실패 → 다시 채점은 종합만 / `summarizeInput`.
- `services/interview/view.test.ts`(5): 실행 공급자 규칙, 남은 작업 규칙(생성·채점), C-17 점수, 목록 묶음·새 결과 표식.
- `services/interview/interview.integration.test.ts`(8, 로컬 스택, 실제 AI-01/05/06/07 파이프라인 + RPC·RLS·트리거): 직무 422(세션·작업 없음) → 컬처핏 시작(D-30 추출 + 질문 3개 + 빈 답변, `question_provider`) → 두 번째 시작 409 + 세션 id, 보드 팝업 세션 → 답변지에 비공개 내용 없음, 사용자 세션의 `intent`·`good_answer_signals` select 거부, 제출 전 reveals 거부 → 자동 저장·다른 사용자 404 → 제출(빈 답변 미응답) → 채점 작업 → 결과(intent 공개, 점수 `pending_method`/`unanswered`, 칩, 종합, firstView) → 제출 후 저장 409 → 로그에 답변·키 없음 → 목록·준비·진행 수·그만둠 묶음·삭제 → 프로젝트 삭제 연쇄.
- 실행: `pnpm vitest run src/server/services/interview`(통합은 `supabase start` 상태에서 자동).

## 스펙 차이·가정
- spec-gaps "2026-11-03 · S8 (api)" ①~⑪. 계획서 `[가정]` 1~5를 따른다.

## 다른 담당자와의 인터페이스
- db: 노트 시그니처 그대로. `create_interview_session`의 `p_session_id`(멱등)는 쓰지 않음. `interview_in_progress`의 세션 id는 오류 `details`에서 읽는다.
- ai: `generateInterviewQuestions`(attempt, unsupportedNumbers), `buildCompleteInterviewQuestionsPayload`, `buildAnswerEvaluationContext`/`evaluateAnswer`(질문 근거에 `sid`), `summarizeSession`(세션 `careerSnapshotHash`, 평가 0개면 부르지 않음)을 `src/server/jobs/interview.ts`에서 감쌌다.

## 남은 일
- UI 연결(S-20/S-33/S-22/S-37, C-14): 액션·조회 서비스·네 라우트, `useAiJob` 진행 단계 `generate`/`evaluate`/`summarize`.
- 채점 작업 진행 표시의 `score` 단계는 D-14 확정 뒤 계산을 넣는다.

## QA 1차 반영 (2026-11-03, `03_backend-qa_report.md`)
| 이슈 | 반영 |
|------|------|
| QA-S8-01 [Major] AI-06 재생성이 같은 단계 안 두 번째 호출 | 채점 파이프라인 인터페이스를 `evaluateFirst` / `regenerate` / `finalize`(호출 없음)로 나눴다(운영: ai `evaluateAnswerOnce` / `regenerateModelAnswer` / `finalizeAnswerEvaluation`, `evaluateAnswer`는 더 쓰지 않음). 답변마다 끝난 호출을 `savePartial`의 `calls[answerId] = { first, regen }`에 둔다. 첫 평가에 V-5 위반이 있으면 저장하고 재생성은 별도 단위로 한다. **무료 등급**: 실행 1번 = 호출 1번(첫 평가 또는 재생성), 사이마다 STEP_CONTINUE → 6초 간격. **유료**: 답변별 병렬은 그대로, 답변 안에서 첫 평가 → (저장) → 재생성 → finalize → `save_answer_evaluation`. 단계 재시도는 저장된 첫 평가를 다시 부르지 않는다. 재생성이 끝내 실패(재시도 없음, 키·한도 원인 아님)하면 첫 평가로 finalize(`[수치 확인 필요]` 치환)하고 `not_scored`로 두지 않는다 `[구현 결정]`. 테스트 4개: 무료 첫 평가·재생성이 별도 실행이고 모든 호출 간격 ≥ 6초, 유료 재생성 재시도 때 첫 평가 재호출 0회, 무료 재생성 재시도 때도 0회, 재생성 최종 실패 → 첫 평가로 저장 |
| QA-S8-03 [Minor] 진행 단계 `complete` | `AI_PROGRESS_STAGES`에 `complete` 추가, 중복 `synthesize` 제거. spec-gaps S8 (api) ⑫ |
| QA-S8-04 [Minor] complete 단계의 컨텍스트 재생성 | `generate`가 첫 호출의 컨텍스트에서 `QuestionsSnapshot {interviewType, insightId, careerSnapshotHash, requirementIds}`를 만들어 partial·체크포인트에 둔다(재생성 실행도 첫 값을 유지). `complete`는 커리어·인사이트를 다시 읽지 않고 이 값으로 payload를 만든다. ai의 `buildCompleteInterviewQuestionsPayload`는 컨텍스트를 받으므로 어댑터(`src/server/jobs/interview.ts` `snapshotContext`)가 그 함수가 읽는 필드만 가진 객체를 넘긴다 — ai가 스냅숏을 직접 받는 함수를 내면 교체한다. 테스트: 재생성이 있어도 첫 실행의 해시로 완료 |

- 검증: `pnpm typecheck`·`pnpm lint` 통과, `pnpm test` 84 파일 1326개 전부 통과(통합 포함, skip 0).
- 바뀐 파일: `src/server/services/interview/job.ts`, `job.test.ts`, `src/server/jobs/interview.ts`, `src/lib/contracts/enums.ts`.
