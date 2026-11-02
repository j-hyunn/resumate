# A0 파운데이션 구현 보고 — 기획 v5.3 (F1–F12)

> 2026-10-30. 기준: 플로우 v5.3 · 데이터 모델 v4.2 · design-system v3. mock 데이터 계층만, 커밋 없음.
> 검사: `pnpm lint` 통과 · `pnpm typecheck` 통과 · `pnpm build` 통과. 실행 중인 dev 서버(:3000)에서 `/dev/states`(+`?state=consent-required`, `finalizing`), `/applications`, `/interviews`, `/career`, `/board`, S-22(세션 5) SSR 200 확인. **브라우저 클릭 흐름(동의 창 → 실행 이어짐, 카운트다운 등)은 눈으로 확인하지 못했다** → ui-qa가 `/dev/states`에서 확인 필요.

## 1. 바뀐 것 (브리프 항목별)

| # | 내용 | 파일 |
|---|------|------|
| F1 | `AiConnection.consent_required` (A20 재동의 규칙: 살아 있는 동의 없음, 또는 동의 뒤 시행된 `requires_reconsent` 고지). `AiRunButton`·`AiErrorNotice` 다시 시도가 실행 전에 C-21 동의 창을 열고 동의 뒤 누른 실행을 이어 보냄. `ProviderBadge` 동의 필요형(ScrollText, "{공급자} · {등급} · 동의 필요", G-33) | `types/db.ts`, `lib/mock/consent.ts`(신설), `lib/data/ai-connection.ts`, `common/consent-gate.tsx`(신설), `common/data-use-consent.tsx`, `common/ai-run-button.tsx`, `common/provider-badge.tsx`, `common/ai-connection-context.tsx` |
| F2 | C-20 `key_missing`: 먼저 연결 상태를 다시 읽고(읽는 동안 동작 줄 `Skeleton h-8 w-40`), 동의 원인이면 제목 "{공급자}({등급}) 사용 동의가 필요해 작업을 멈췄어요. 입력은 저장돼 있어요" + "동의하기" → C-21 → 다시 시도 | `common/ai-error-notice.tsx` |
| F3 | 다시 시도 버튼 바로 뒤 C-19 배지(누르는 시점의 활성 공급자). 같은 행 다시 시도에서 작업의 공급자·등급과 다르면 "{활성 공급자}로 처음부터 다시 해요"(ArrowLeftRight). mock: 다르면 `prepare`부터, 결과 행 다시 엶(R-63), 같으면 실패 단계부터 | `ai-error-notice.tsx`, `lib/mock/ai.ts` `retryMockJob`, `lib/data/ai-jobs.ts` `retryAiJob` |
| F4 | 다시 시도 거부 409(경로 ②) 판정 순서대로 mock 구현: `ai_job_not_retryable` → `key_missing` → `key_invalid` → `ai_consent_required` → `ai_connection_changed`. 화면은 동작 줄만 교체(G-34). 새 작업 시작 경로 ①은 `ai_not_connected`/`ai_consent_required`/`key_invalid`, 경로 ④⑤는 동의를 `key_missing`으로 합침 | `lib/mock/ai.ts` (`assertAiRunnable(db, path)`, `retryGate`), `lib/data/ai-errors.ts`, `ai-guard.ts`, `ai-error-notice.tsx`, `ai-rejection.ts` |
| F5 | 입력 원인 실패(`input_too_long`·`safety_blocked`·`not_a_jd`)는 다시 시도·배지·토큰 주석 없음 → "{대상}으로 이동" + caption "고친 뒤 {rerunLabel}로 새로 실행해 주세요". `safety_blocked` 문구를 명세대로 "표현을 바꾼 뒤 다시 실행해 주세요" | `ai-error-notice.tsx` |
| F6 | 요청 안 경로(`requestPath`): "{N}초 뒤 다시 보낼 수 있어요"(60초 이상 "{M}분 {S}초 뒤") + `retry_after`까지 "(0:12)" 카운트다운, 0이면 줄 사라짐. mock 스트림·대화 턴 실패의 `retry_after`는 기본 20초 | `ai-error-notice.tsx`, `lib/mock/ai-stream.ts` |
| F7 | 단계 `prepare`·`synthesize_regen`·`complete`. `aiStageLabel(jobType, progress)`: 채점 prepare "채점 준비 중", 면접 질문 "질문 만드는 중 (n/N)", `synthesize_regen` = synthesize 행 재활성, `complete` = 행 없음·직전 문구·막대 100%. mock 단계 계획도 같은 순서 | `lib/data/labels.ts`, `common/ai-progress.tsx`, `lib/mock/ai.ts` `stagePlan`, `ai-jobs.ts` 부분 결과 동기화 |
| F8 | `AiFeatureStatus` + 순수 판정 `resolveAiFeatureStatus` (생성 중 > 있음 > 없음, 늦게 끝난 실패 한 줄, `stalled`, 취소는 표시 없음). `ApplicationSummary.insight_status`·`interview_status` 추가 | `lib/data/ai-feature-status.ts`(신설), `common/ai-feature-status.tsx`(신설), `lib/data/applications.ts` |
| F9 | 서류 스트림 이벤트 v5.3: `validated`가 문항(경력기술서는 전체)의 확정 블록 묶음 + `notes`를 실어 **통째 교체**. 훅에 `phase`(sources/streaming/adjusting/finalizing/done), `adjusting`, `notes`, `validatedSections`, `start({discardOnError})`(경력기술서 실패 = 블록 없음). `StreamingHeader phase/adjusting` → "마무리 중…"(Loader2)·"글자 수 맞추는 중 (현재 n자 / 제한 m자)" | `lib/mock/ai-stream.ts`, `common/streaming.tsx` |
| F10 | readiness 판정 순서 v4.2(경력 없음 → `project_fields` → 키 없음/무효 → 보강 → 새 프로젝트), `profile_filled` v4.2 정의, ready여도 `missing: []`·`hints`. C-09: hint 줄 "'{프로젝트명}'에 이름이나 역할이 비어 있어요. 채우면 바로 쓸 수 있어요" + 주 버튼 "'{프로젝트명}' 마저 채우기"(PenLine, 배지 없음, 대화 버튼 숨김) → `routes.project(id, { focus: "fields", application_project_id })` + 복귀 대상 기억 | `lib/data/readiness.ts`, `common/data-gate.tsx`, `lib/routes.ts` |
| F11 | C-14: 마지막 활동(상대 시각), `generation_status` 줄("질문을 만드는 중이에요" / "질문 생성이 끝나지 않았어요"), 유형 불일치 안내. `move_application_stage` 반환에 `interview_prompt.in_progress_session` | `common/stage-menu.tsx`, `lib/data/applications.ts` |
| F12 | `types/db.ts` v4.2: `DraftTone`·`DraftOptions.tone`, `Draft.completed_at`, `WritingChat.last_extracted_sequence`, `InterviewSession.question_validation_report`·`question_usage`, `AiProgressStage` +3, `ReadinessHint` +`project_fields`, `AiConnection.consent_required`, 거부 코드 타입 `AiStartRefusalCode`·`AiRetryRefusalCode`·`AiGateRefusalCode`, `InterviewPromptSession`, `AccountDeletionState`, `AccountDeletionErrorCode` | `types/db.ts` |
| 셸 | A7: `get_account_deletion_state() = deletion_incomplete`면 대시보드 어디서든 S-25(`/settings/withdraw`)로 보냄(`/dev/*` 제외) | `common/shell/deletion-guard.tsx`(신설), `app/(dashboard)/layout.tsx` |

## 2. 영역별 새 API · 훅 · 액션

공통: 모든 신규 서버 액션은 `@/lib/data/actions`.

### 공통 컴포넌트 (모든 영역)
- `useAiConsentGate(connection?)` → `{ required, guard(run), open(then?), dialog }` (`common/consent-gate.tsx`). AiRunButton을 쓰지 않는 실행 버튼(S-36 보내기, S-15 요건 정리하기 등)은 `onClick={() => consent.guard(run)}` + `{consent.dialog}`.
- `DataUseConsentDialog { open, onOpenChange, provider, tier, onConsented, confirmLabel?, reconsent? }` — 동의 창형. S-40 "동의하기"는 `confirmLabel="동의하기"`. 재동의 Alert는 서버에서 자동 판정.
- `AiRunButton.onRun`이 이제 결과를 돌려줄 수 있음(`() => unknown`). **액션 결과를 그대로 return 하면** 시작 거부(①)를 버튼이 처리(잠금/동의 창/키 무효). 기존처럼 안에서 `notifyAiRejected` 해도 됨(토스트 문구가 거부 코드별로 바뀜).
- `AiErrorNotice` 새 props: `refusal`, `rerunLabel`, `requestPath`, `sameRow`·`jobTier`(`aiErrorFromJob(job)`가 채움), `lockEntry`, `hideRetryBadge`. **다시 시도 옆 배지는 기본 표시**(이미 옆에 배지가 있으면 `hideRetryBadge`).
- `useAiJob` 결과에 `refusal`, `retrying` 추가 → `<AiErrorNotice {...aiErrorFromJob(job.job)} refusal={job.refusal} retrying={job.retrying} onRetry={job.retry} />`. (예전처럼 거부 시 `error`가 key_missing으로 바뀌지 않음 — `refusal`을 넘겨야 보임.)
- `AiProgressInline jobType={…}`, `stageText(progress, jobType)`, `aiStageLabel(jobType, progress)`.
- `AiFeatureStatus { status, emptyLabel?, children }`, `AiFeatureFailureLine`.
- `StreamingHeader { phase, adjusting }`, `useAiStream()` → `phase`·`adjusting`·`notes`·`validatedSections`, `start({ …, adjustLength, notes, discardOnError, retryAfterSeconds })`. 편집·복사는 `block.state === "validated"`일 때만.
- `AiLock title`(+ `AI_LOCK_RETRY_TITLE`), `ProviderBadge`는 `consent_required` 없는 연결 객체도 받음.
- `aiRejectedMessage(r)`, `isInputCausedFailure`, `isRequestPathWait`, `SAME_ROW_RETRY_JOB_TYPES`, `formatWaitSeconds`, `RETRY_REFUSAL_COPY`.

### A1 계정·설정
- `deleteAccountConfirmedAction({ confirm: true }, { simulate? })` → `{ ok: true } | { ok: false, error: "account_deletion_busy" | "account_deletion_incomplete" | "failed" }` (같은 요청 다시 = 탈퇴 마무리하기, 멱등).
- `getAccountDeletionStateAction()` → `active | deletion_incomplete | profile_missing`. `completeSignIn` 결과에 `deletion_incomplete?: true`.
- 셸 가드가 이미 `/settings/withdraw`로 보냄. S-25 "셸 밖 탈퇴 마무리 카드"(G-38)는 페이지 위치를 A1이 정할 것(가드는 `pathname.startsWith("/settings/withdraw")`면 통과).
- S-40: `DataUseConsentDialog confirmLabel="동의하기"`, 연결 상태 `consent_required`로 카드 "동의 필요". `getDataUseConsentStateAction(provider, tier)` → `{ required, reconsent }`.

### A2 커리어
- `abandonWritingChatAction`, `resumeWritingChatAction`(AI 없음, 키 없이 가능, null이면 그만둔 상태 아님), `listAbandonedWritingChatsAction`. 자동 삭제 D-day는 기존 `daysUntilAutoDelete`.
- `startWritingChat` 이제 `message_count = 0`(시작 인사 제외, A5). `canSendWritingChatMessage`는 ≤ 38 그대로.
- 턴 전송·다시 보내기 거부: 키 없음·동의 필요 → `rejected: "key_missing"`(사용자 메시지 저장 안 함), 키 무효 → `key_invalid`. 동의 원인 구분은 `useAiConsentGate` + 연결 상태. 대화 턴 실패 표시는 `requestPath` + `retryLabel="다시 보내기"`.
- S-10: `?focus=fields`(+ `application_project_id`)로 들어오면 이름·역할 강조.

### A3 기업 JD
- `ApplicationSummary.insight_status` / `interview_status` → `AiFeatureStatus`.
- 스트림 `validated` 교체·`notes`(GenerationNotes 입력)·`adjustLength`·`discardOnError`(경력기술서 실패).
- `rankDraftSources`·서류 생성 준비는 경로 ⑤(동의 필요 = `key_missing` / `generationAllowed` false).
- 인사이트 같은 행 다시 시도: `useAiJob.retry` + `refusal`. 입력 원인은 `rerunLabel="다시 생성"`.

### A4 면접·보드
- `regradeFailedAnswersAction(sessionId)` → 새 채점 작업(실패 답변만, 종합은 항상 다시, 이전 종합은 `pending`으로 남음), 세션 `score_status`·`completed_at`·`result_viewed_at` 비움. null = 할 것 없음.
- `markInterviewResultViewedAction` — `completed`일 때만 기록(A9).
- `InterviewSessionRow.failed_answer_count`, `has_new_result`.
- `saveInterviewAnswer`는 `in_progress`가 아니면 거부(A8).
- C-14는 파운데이션이 처리 완료(보드는 바뀐 것 없음).

## 3. mock 데이터로 재현 가능한 상태

| 상태 | 방법 |
|------|------|
| consent_required (실데이터) | `/dev/states?state=mock-controls` → "재동의 필요한 고지 게시" (`publishMockReconsentDisclosureAction`). 동의하면 풀림 |
| 다시 시도 거부 5종 (실데이터) | 같은 곳 "다음 다시 시도 거부: {code}" (`setMockControlsAction({ next_retry_refusal })`, 한 번 소비) |
| 처음부터 다시 | 픽스처 세션 5(ap 3, `evaluation_failed`, 작업 13 = OpenAI 유료 실패) → 활성 Gemini 무료와 다름 |
| 실패한 답변 다시 채점 | 세션 5: 답변 3개 중 2개 평가 실패, 종합 실패 |
| 그만둔 대화 | 대화 4(`abandoned`, 프로젝트 미연결, 20일 전 활동) |
| 실패 경력기술서 초안 | 초안 3(ap 2, `failed`, 블록 없음, `tone: detailed`, 작업 14 `schema_invalid`) |
| 그만둔 면접 | 기존 세션 4 |
| 탈퇴 busy / incomplete / 미완료 재진입 | mock 제어 버튼 3종 (`account_deletion_failure`, `account_deletion_state`) |
| project_fields | `insufficientReadinessPreview(base, { projectFields: true })` / `?state=insufficient-project-fields` |

## 4. 새 `?state=` 값

`consent-required`, `retry-other-provider`, `retry-refused-key-missing`, `retry-refused-consent`, `retry-refused-key-invalid`, `retry-connection-changed`, `retry-not-retryable`, `input-failed`, `request-wait`, `finalizing`, `insufficient-project-fields`, `interview-prompt`, `deletion-busy`, `deletion-incomplete`. 헬퍼: `previewRetryRefusal(state)`; `previewErrorCode`가 새 값에 맞는 원인을 돌려줌. `consent-required`는 클라이언트 연결 컨텍스트와 서버 `previewAiConnection` 둘 다 적용(동의하면 이 페이지 세션에서 풀림). 갤러리 전용 섹션 id: `ai-stages`, `feature-status`, `mock-controls`.

## 5. 바꾼 영역 호출부 (기계적 수정)

| 파일 | 수정 |
|------|------|
| `app/(dashboard)/applications/_lib/gate-preview.ts` | `ai_connection` 리터럴에 `consent_required: false` |
| `components/account/ai-connection-panel.tsx` (2곳) | `consent_required: null` 추가 |

그 밖 영역 파일은 수정하지 않음(타입 완화로 `ai-status-line.tsx`, `key-connect-flow.tsx`는 그대로 컴파일).

**동작이 바뀌어 영역이 확인할 곳**: ① 입력 원인 실패에 `onRetry`를 넘겨도 다시 시도가 안 보임. ② `useAiJob.error`가 거부 코드를 더 이상 담지 않음(`refusal` 사용). ③ 다시 시도 옆에 배지가 새로 붙음. ④ 단계 문구·행 수 변경(prepare 행 추가). ⑤ `retryAiJob`가 취소된 작업·요청 범위 작업을 `ai_job_not_retryable`로 거부. ⑥ 대화 `message_count`가 1 줄어듦(인사 제외).

## 6. [UI-가정]

| 위치 | 내용 |
|------|------|
| `ai-error-notice.tsx` | 입력 원인 caption "고친 뒤 {rerunLabel}로 새로 실행해 주세요"(G-35), 없으면 "고친 뒤 다시 실행해 주세요" |
| `ai-error-notice.tsx` | 요청 안 경로 `rate_limited` 제목은 "요청이 몰려 잠시 쉬어야 해요."(분 단위는 카운트다운 줄로) |
| `data-use-consent.tsx` | 동의 창 제목 "{공급자}({등급}) 데이터 사용 동의", 확인 "동의하고 계속", 동의 뒤 토스트 없음(G-36, P-14) |
| `provider-badge.tsx` | 동의 필요형 배지 상태·툴팁(G-33) |
| `ai-rejection.ts` | 서버 `ai_consent_required` 토스트 "AI 사용 동의가 필요해요. 다시 눌러 동의해 주세요"(readiness가 낡은 경우만) |
| `writing-chats.ts` | 대화 시작은 동의 확인 없이(인사만 넣음), 첫 턴에서 동의 창 |
| `stage-menu.tsx` | C-14 유형 불일치 문장의 "S-20에서" → "면접 준비에서" |
| `ai-feature-status.ts` | 실패 판정: 실패 작업이 결과보다 늦으면 원인, 결과가 생성 중인데 작업 없음/성공이면 `stalled` |
| `ai-jobs.ts` | 같은 공급자 다시 시도는 실패 평가만 다시 엶, 다른 공급자는 그 작업 평가 전부. 질문 재시작 시 빈 답변 질문 삭제(DM [가정]) |
| `ai-progress.tsx` | `prepare` 300ms 미만 즉시 체크(G-29)는 구현 안 함 — mock의 prepare가 항상 한 구간을 차지 |
| `data-gate.tsx` | 프로젝트 이름은 서버 액션으로 따로 읽음(readiness에 이름 없음), 읽는 동안 Skeleton |
| `deletion-guard.tsx` | 탈퇴 미완료면 `/dev/*`를 뺀 모든 대시보드 경로를 S-25로 돌림 |

## 7. 기획 확인 필요

| 화면 | 질문 | 스펙 위치 |
|------|------|-----------|
| C-21 | 실행 전 동의 창 제목·확인 버튼 글자 (P-14 그대로) | 02 C-21 |
| C-20 | 입력 원인 실패 안내 문구, 요청 안 경로에서 `rate_limited` 제목(분 vs 초) | 02 C-20 "요청 안에서 끝나는 경로의 대기" |
| C-14 | "S-20에서 그만두고"의 화면 표현 | 02 C-14 |
| S-36 | 대화 시작(인사 삽입) 때도 동의를 먼저 받아야 하는지 | 02 C-18 R-67 |
| DM | 픽스처 인사이트 작업의 `target_type`이 `insight`(DM v4.2는 `application_project`). 영역 코드가 `getLatestJobFor("insight", …)`를 써서 바꾸지 않았음 — 백엔드 연결 시 정리 필요 | 04 §2.9.1 `target_type` |

## 8. 파운데이션 후속 메모
- 브라우저 클릭 흐름(동의 창 → 실행 이어짐, 거부별 동작 줄, 카운트다운, 마무리 중 → 통째 교체)은 ui-qa가 `/dev/states`에서 확인 필요.
- 셸 하단 AI 상태 줄은 `connectionStatusText`를 써서 동의 필요 시 "· 동의 필요"가 자동으로 붙음.

## QA 1차 수정 (`10_ui-qa_v53_foundation_review.md` 대응)

| ID | 수정 | 파일 |
|----|------|------|
| UQ-400 (Major) | `AiErrorNotice aiRetry` prop 추가(기본 true). `false`면 동의 게이트·활성 공급자 배지·"처음부터 다시" 줄을 모두 뺀다. S-40 카드 키 "다시 확인" 실패 줄에 `aiRetry={false}` 적용 → **UQ-410도 같이 해소** | `common/ai-error-notice.tsx`, `account/ai-connection-panel.tsx`(1줄, 지시대로) |
| UQ-401 (Major) | 스트림 실패 때 `validated`로 확정된 블록만 남기고 임시(`streaming`/`completed`) 블록은 버림 → 실패 문항은 C-20만 | `common/streaming.tsx` |
| UQ-402 (Major) | `retryJdExtraction`/`runJdExtraction`이 경로 ⑤ 게이트(`assertAiRunnable(db, "request")`)를 먼저 거침. 거부는 `{ rejected, refusal }`로 돌려줌(키 없음·동의 필요 = `key_missing`, 무효 = `key_invalid`, 아무것도 안 바뀜). 실행은 매번 **새** `jd_extraction` 작업(DM 2.9.1 (2)), 이미 진행 중이면 그 작업을 따라감. 반환 타입 `boolean \| AiRejected` — A3 `jd-view.tsx`는 지금 결과를 무시하므로 컴파일은 그대로, **A3가 결과를 보고 C-20/동의 창을 띄워야 함**(AiRunButton `onRun`에서 return 하면 버튼이 처리) | `lib/data/drafts.ts` |
| UQ-403 | `useAiConnectionRefresh(startPending)` — `key_missing`이면 첫 프레임부터 Skeleton. Provider 밖에서는 서버 액션으로 직접 읽어 `fresh`로 씀 | `common/ai-connection-context.tsx`, `ai-error-notice.tsx` |
| UQ-404 | `key_missing`에서 쓸 수 있는 키가 있고 동의도 필요 없는데 `onRetry`가 없으면 "AI 연결하기" 대신 "입력으로 돌아가기"만 보임(반복 방지) | `ai-error-notice.tsx` |
| UQ-405 | mock 경로 ③: 진행 중 작업이 단계마다 키 삭제·**동의 필요**(→ `key_missing`)·**키 무효**(→ `key_invalid`)를 확인. "재동의 필요한 고지 게시" 뒤 진행 중 작업이 `key_missing`으로 끝나 F2 동의 원인을 실데이터로 재현 가능 | `lib/mock/ai.ts` |
| UQ-406 | `AiJob.step_outputs`(jsonb, 화면은 읽지 않음)·`run_generation` 추가. 같은 행 다시 시도 때 `run_generation + 1`, 공급자·등급이 바뀌면 `step_outputs` 비움. 결과 테이블(insights·drafts·draft_sections …)의 내부 `run_generation`은 아직 미반영 — 화면 미사용 내부 컬럼이라 백엔드 연결 때 생성 타입으로 교체 | `types/db.ts`, `lib/mock/ai.ts`, `lib/mock/fixtures.ts`, `lib/data/writing-chats.ts` |
| UQ-407 | 탈퇴 미완료 가드가 첫 판정 전까지 불투명 덮개로 화면을 가림(원래 화면이 비치거나 눌리지 않음). 한 번 `active`로 확인되면 이후 이동에서는 덮개 없이 다시 확인. `(public)` 레이아웃에도 `/consent`(S-03) 한정으로 설치. S-02 콜백의 `deletion_incomplete` 처리는 A1 몫 | `common/shell/deletion-guard.tsx`, `app/(public)/layout.tsx` |
| UQ-408 | mock `rateWaitSeconds`, `useAiStream`/`useChatTurnStream`의 `waitSec`를 `@deprecated`로 표시(A14: 요청 안 경로는 대기 없이 바로 실패). 제거는 S-36이 `?state=ai-waiting`을 쓰므로 A2 정리 뒤로 미룸 | `lib/mock/ai-stream.ts`, `common/streaming.tsx` |

손대지 않음(영역 담당): UQ-409(A3), UQ-411·412·413(A4). UQ-410은 UQ-400과 함께 해소.

새 [UI-가정]: UQ-407 덮개(첫 판정 동안 화면 전체를 배경색으로 가림, 문구 없음 — 스크린 리더용 "계정 상태 확인 중").

검사: `pnpm lint` 통과 · `pnpm typecheck` 통과 · `pnpm build` 통과(39/39).

## QA 2차 / 영역 요청 반영

> 새 픽스처(프로젝트 8, 대화 5, 질문 근거 등)는 mock 저장소가 새로 만들어질 때 들어간다 — 실행 중인 dev 서버는 **재시작**해야 보인다(`mock_controls`는 기존 저장소에도 자동 보충).

### A1
| 항목 | 수정 | 파일 |
|------|------|------|
| 요청 1·2 / UQ-451 | `routes.withdrawFinalize(previewState?)` 추가. 탈퇴 미완료 가드가 셸을 거치지 않고 바로 `/settings/withdraw/finalize`로 보냄. A1 `withdraw-routes.ts` 삭제, 호출부를 `routes.withdrawFinalize`로 교체(기계적) | `lib/routes.ts`, `common/shell/deletion-guard.tsx`, A1: `components/account/withdraw-form.tsx`, `components/account/actions.ts`, `app/(dashboard)/settings/withdraw/page.tsx` (+ `withdraw-routes.ts` 삭제) |
| 요청 3 | 쓰이지 않던 `deleteAccount`(data)와 `deleteAccountAction`(A1 actions) 삭제 | `lib/data/account.ts`, `components/account/actions.ts` |
| UQ-450 | `directionParticle`: 라틴 글자가 모음·l·r·y로 끝나면 "로"(Gemini로·Claude로·OpenAI로), 숫자는 한국어 읽기(0·3·6 → 으로), 그 밖 라틴은 "(으)로" 유지. A1 호출부는 그대로 맞게 나옴 | `lib/data/labels.ts` |

### A2
| 항목 | 수정 | 파일 |
|------|------|------|
| UQ-487 | 그만두기는 `status`(+`updated_at`)만 바꿈, `last_activity_at` 그대로 | `lib/data/writing-chats.ts` |
| UQ-488 | `retryWritingChatTurn`·`completeMockAssistantTurn`이 `active`가 아닌 대화를 거부(`chat not active`) | `writing-chats.ts` |
| UQ-489 | 픽스처: 프로젝트 8 "결제 알림 재처리 개선"(경력 1 소속, `role` 비어 있음 + 완료 상세 내용 7) — `?state=insufficient-project-fields`가 이 프로젝트를 가리킴. 대화 5: 프로젝트 6에 묶인 그만둔 보강 대화(S-10 대화 기록 "그만둠") | `lib/mock/fixtures.ts`, `lib/data/readiness.ts` |
| UQ-490 / 요청 2 | 턴 완료에 `timing { retry_after, quota_resets_at }` 추가 → 실패 턴의 `ai_jobs`에 스트림 값 저장(새로고침 뒤에도 같은 카운트다운). A2 호출부 기계적 수정(`completeWritingChatTurnAction` 4번째 인자, `finishTurn`이 오류 이벤트 값 전달) | `writing-chats.ts`, A2: `components/career/actions.ts`, `components/career/writing-chat/chat-screen.tsx` |
| UQ-491 | 대화 3 인사를 고정 문구(`GREETING.augment_project`)로 | `fixtures.ts` |
| UQ-492 | 토큰 주석이 버튼 동사를 따름: `retryTokenNote(label)` — "다시 보내면 / 다시 채점하면 / 다시 생성하면 토큰을 다시 써요"(다시 시도는 명세 문구 그대로) [UI-가정] | `common/ai-error-notice.tsx` |
| UQ-493 | mock 제어 `next_send_refusal`(`key_missing`/`key_invalid`, 한 번): 다음 보내기·다시 보내기를 서버가 경로 ④로 거부. `/dev/states?state=mock-controls` 버튼 | `fixtures.ts`, `writing-chats.ts` (`sendGate`), `dev-state-gallery-v53.tsx` |
| UQ-408 | 스트림 `rate_wait` 이벤트, `rateWaitSeconds`, `useAiStream`/`useChatTurnStream`의 `waitSec` **삭제**. (비동기 작업의 C-03 대기 줄 `rate_wait`·`?state=ai-waiting`은 그대로 — A14 대상 아님) | `lib/mock/ai-stream.ts`, `common/streaming.tsx` |
| 요청 3 | `WRITING_CHAT_FIELD_LIMITS { name: 100, role: 100, metric_name: 200, unit: 50 }` export (A2 `draft-preview.tsx` 로컬 상수 교체는 A2 몫) | `lib/data/writing-chat-limits.ts` |
| 요청 4 | 새 대화의 시작 인사 행에 시작 당시 키 등급(`connection_tier`) 기록 [UI-가정] — S-36은 `messages[0].connection_tier === "free"`로 무료 등급 줄 판정 가능 | `writing-chats.ts` |

### A3
| 요청 | 수정 | 파일 |
|------|------|------|
| 1 | `createApplicationProject` 이름 규칙: 입력 이름 → 둘 다 있으면 "회사명 – 포지션명"(user, 100자) → 키 없음 기본 이름 / 키 있음 null. 추출 실패(`failJdExtraction`)도 같은 규칙으로 이름 채움. A3 `createApplicationAction`의 "" 우회 삭제(기계적) | `lib/data/applications.ts`, A3: `app/(dashboard)/applications/_lib/actions.ts` |
| 2 | `retryJdExtraction`이 진행 중이면 `"already"` 반환(A3 액션은 `{ already: true }`로 매핑 — 먼저 읽던 우회 삭제, 기계적). mock 제어 `next_jd_extraction_failure`(한 번) → 생성·요건 정리하기 추출이 그 원인으로 실패(요청 안 경로 대기 20초) | `lib/data/drafts.ts`, `applications.ts`, `fixtures.ts`, A3 `_lib/actions.ts` |
| 3 | `AiFeatureStatusView.failure.job`(id·job_type·error_code·provider·connection_tier·retry_after·quota_resets_at) → `aiErrorFromJob(failure.job)` + `retryAiJobAction(failure.job.id)`로 같은 행 다시 시도 | `lib/data/ai-feature-status.ts` |
| 4 | 준비 함수가 `notes`(경력기술서: `omitted` 최대 3 "항목 — 이유", 자리 표시 개수 안내 / 자소서: `char_adjust_needed`, 자리 표시 안내)와 자소서 `adjust_length`를 돌려줌 → `stream.start({ notes, adjustLength })`. 자소서 완료 시 `validation_report.char_adjust_needed` 저장. `omitted`는 `string[]` 유지(형태는 기획 확인) — A3 `mockNotes`를 이 값으로 바꾸는 것은 A3 몫 | `drafts.ts` |
| 5 | `AiErrorNotice lead` prop(블록형 설명 첫 줄, `font-medium`) | `ai-error-notice.tsx` |
| 6 | 자소서 문항 완료 시 초안의 `provider`·`model`·`model_tier`·`connection_tier`·`completed_at`을 그 문항 값으로 | `drafts.ts` |
| 7 | `GenerationResult.canceled`·`error_code`·`retry_after`·`quota_resets_at`. 경력기술서: 실패·중단 모두 블록을 남기지 않음(A4), 중단은 실패가 아님(이전 상태로), 실패는 `career_description` 작업 행(`target_type = "draft"`, 원인·대기 저장) + `drafts.ai_job_id`. 중단은 사용량 기록 없음. A3 `draft-editor.tsx`가 결과에 새 필드를 넣도록 기계적 수정 | `drafts.ts`, A3 `components/applications/draft-editor.tsx` |
| 8 | `prepareCareerDescription`/`prepareCoverLetterSection` 안의 같은 요청 추출 제거(A13) | `drafts.ts` |

### A4
| 요청 | 수정 | 파일 |
|------|------|------|
| 1 | `hasNewResult()` = 제출됨 + (`completed`·`evaluation_failed`) + `result_viewed_at` null → `InterviewSessionRow.has_new_result`, 셸 `interviews_new_results` 같은 규칙. A4 `session-status.tsx isNewResult`는 같은 규칙이라 그대로 둠(교체는 A4 몫, 기계적이 아님 — 행 타입이 섞임) | `lib/data/interviews.ts`, `lib/data/shell.ts` |
| 2 | `startRemainingQuestions(sessionId)` / `startRemainingQuestionsAction` — 세션 `generating`으로 다시 열고 남은 개수로 새 작업(이미 저장된 질문 뒤에 이어 만듦) | `lib/data/ai-jobs.ts`, `actions.ts` |
| 3 | 세션 1 질문 1·3에 `interview_question` 근거 3행 | `fixtures.ts` |
| 4 | 범용 C-18 팝업형 `AiLockPopup { open, onOpenChange, title?, description?, entry, feature?, returnHref?, returnParams?, onConnect?, children? }` | `common/ai-lock.tsx` |
| 5 | `AiRunButton rerunNote` | `common/ai-run-button.tsx` |
| 6 | `retryAnswerEvaluationAction`·`retryAnswerEvaluation` 삭제 | `actions.ts`, `ai-jobs.ts` |

### 기계적으로 바꾼 영역 파일 (이번 차수)
- A1: `components/account/withdraw-form.tsx`, `components/account/actions.ts`, `app/(dashboard)/settings/withdraw/page.tsx`, `components/account/withdraw-routes.ts`(삭제)
- A2: `components/career/actions.ts`, `components/career/writing-chat/chat-screen.tsx`
- A3: `app/(dashboard)/applications/_lib/actions.ts`, `components/applications/draft-editor.tsx`
- A4: 없음

### 새 [UI-가정]
- `retryTokenNote` 동사별 토큰 주석, 시작 인사 행의 `connection_tier`, 경력기술서 `omitted` 문구 "포함할 항목에서 빠져 이번 초안에 넣지 않았어요", 자소서 `notes_for_user` "확인이 필요한 자리 표시를 남겼어요. 제출 전에 채워 주세요", 추출 실패 대기 20초, 질문 근거 `item_key`("question" / "target_requirements").

### 기획 확인 필요 (추가)
| 화면 | 질문 |
|------|------|
| S-19 | `omitted`가 "항목 + 이유"로 나뉜 구조인지(지금 `string[]`, "항목 — 이유") |
| C-20 | "다시 보내기"·"다시 채점" 버튼 아래 토큰 주석 문구(명세는 "다시 시도하면…"만) |

검사: `pnpm lint` 통과 · `pnpm typecheck` 통과 · `pnpm build` 통과(`/settings/withdraw/finalize` 포함). dev :3000 SSR `/dev/states`, `/career`, 프로젝트 8 `?focus=fields`, 프로젝트 6, `/interviews`, 세션 1 답변지, `/applications/new` 200(오류 페이지 없음). 클릭 흐름은 눈으로 보지 않았다.

## QA 3차 (`12_ui-qa_v53_A3_review.md` A0 몫)

| ID | 수정 | 파일 |
|----|------|------|
| UQ-512 (Major) | `settleAbandonedGeneration`: plan 없는 `generating` 경력기술서는 마지막 갱신 뒤 20초가 지났을 때만 버려진 것으로 정리(`ready`/`failed`). 막 만든 초안(S-17 → S-19 자동 시작)은 `generating` 그대로라 "생성 실패"·C-20이 비치지 않음. `prepareCareerDescription`의 `previous_status`는 새 초안(`generating`)·`failed`면 `composing` → 중단이 `failed`로 끝나지 않음 | `lib/data/drafts.ts` |
| UQ-515 | 입력 원인 caption 조사를 받침에 맞춤: `고친 뒤 ${rerunLabel}${directionParticle(rerunLabel)} 새로 실행해 주세요` ("다시 생성으로", "초안 생성으로", "요건 정리하기로", "시작하기로"). 코디네이터가 바꾼 `retryTokenNote`(UQ-557)는 그대로 둠 | `common/ai-error-notice.tsx` |
| UQ-522 | 데이터 계층은 2차에서 이미 반영: `finalizeCoverLetterSection`이 **생성 성공 시에만** `drafts.provider`·`model`·`model_tier`·`connection_tier`·`completed_at`을 그 문항 값으로 갱신하고, 편집 저장(`saveDraftSection`)은 이 값을 건드리지 않음 → A3는 섹션 `updated_at` 대신 `draft.provider`·`model_tier`·`model`을 쓰면 됨(A3 몫). 실패·부분 실패·중단은 갱신하지 않음 | `lib/data/drafts.ts` (변경 없음, 확인) |

검사: `pnpm lint` 통과 · `pnpm typecheck` 통과 · `pnpm build` 통과(40/40). 영역 폴더는 건드리지 않음.
