# A4 면접·보드 구현 보고 — 기획 v5.3 (브리프 4-1 … 4-5)

> 2026-10-30. 기준: 플로우 v5.3(FL-12, S-20, S-22, S-33, S-37, S-39, C-14, C-20, 5.1c) · design-system v3 `(v3)` 문단 · 파운데이션 보고 09 · 파운데이션 QA 10(UQ-411·412·413, lockEntry, S-39 F8).
> mock 데이터 계층만, 커밋 없음, 기획 문서 수정 없음. 파운데이션 파일(`components/common/`, `lib/`, `types/db.ts`)은 고치지 않았다.
> 검사: `pnpm lint` 통과 · `pnpm typecheck` 통과 (build는 지시대로 생략). 실행 중인 dev 서버(:3000) SSR로 아래 문구 확인. **브라우저 클릭 흐름(다시 채점 → 진행 → 완료, 메뉴 다시 채점, 동의 창)은 눈으로 보지 않았다.**

## 완료 화면

| 화면 ID | 라우트 | 지원 ?state= | 비고 |
|---------|--------|--------------|------|
| S-22 | `/applications/[id]/interview/[sessionId]/result` | 기존(loading·error·unauth·not-found·ai-pending·scored·empty/no-answers·ai-locked·key-invalid·key-check·key-missing·ai-failed*) + **`regrading`**(다시 채점 진행·이전 종합 흐리게) · **`no-failures`**(완료·버튼 없음) · `consent-required` · `input-failed` | 4-1 |
| S-37 | `/interviews` | 기존 그대로 | 4-2 (행 메뉴·표식은 실데이터: 세션 5 = 채점 실패) |
| S-33 | `/applications/[id]/interview/[sessionId]` | 기존 + **`abandoned`** · **`questions-partial`**(일부 생성 실패 → 남은 질문 다시 만들기) · `input-failed` · `consent-required` · `retry-other-provider` · `retry-refused-key-missing` / `-consent` / `-key-invalid` · `retry-connection-changed` · `retry-not-retryable` | 4-3 |
| S-20 | `/applications/[id]/interview` | 기존 그대로 | 4-4 |
| S-39 | `/board` | 기존 + **`interview-prompt`**(첫 카드 기준 C-14 작성 중 세션: 마지막 활동·질문 만드는 중·유형 다름, 클라이언트에서 열림) | 4-5 |

## 화면별 변경

### S-22 (4-1) — `components/interviews/result-view.tsx`, 결과 `page.tsx`
- 머리 카드 안 점수·고지 아래 `Separator` → **"실패한 답변 {n}개 다시 채점"**(`AiRunButton` default + `RotateCcw`, C-19 활성 공급자 배지, 주석 "다시 채점하면 공급자 토큰을 다시 써요"). 키 없음 → C-18 인라인, 무효 → C-20 key_invalid, 동의 필요 → C-21 뒤 실행(시작 거부는 `onRun`이 결과를 돌려줘 버튼이 처리). `rate_limited`/`provider_unavailable`이면 `retry_after`까지 카운트다운 비활성.
- **UQ-413**: 다시 채점은 `regradeFailedAnswersAction`(새 작업, 경로 ①). 같은 행 `retryAiJob`·답변 단위 `retryAnswerEvaluationAction` 호출 삭제. A4 `retryEvaluationAction`·`retryQuestionGenerationAction`·`markResultViewedAction` 삭제.
- 답변 카드 "다시 채점"은 C-17 점수 옆 `link sm`, **같은 세션 단위 동작**(배지 없음, 동의 게이트·거부 토스트).
- **UQ-412**: 상단 C-20은 원인만(같은 행 다시 시도 버튼 없음 — 명세 "이 화면에는 같은 행 다시 시도 버튼을 따로 두지 않는다") → 배지 중복 사라짐. `lockEntry="interview_submit"`, `rerunLabel` 전달.
- 진행 중: C-03(`interview_evaluation`: prepare 채점 준비 중 → evaluate n/N → summarize → score → complete는 파운데이션 `aiStageLabel`), 세션 점수 자리 `Skeleton h-8 w-24`, 버튼 줄 숨김, 채점된 답변 카드 유지.
- 종합 평가: 다시 채점 중(`session_feedbacks.status = pending` + 결과 있음)이면 이전 종합을 `aria-busy` + `text-muted-foreground`로 흐리게, 머리 오른쪽 `Loader2` "종합 평가를 다시 정리하는 중". 흐린 동안 다음 연습 링크 숨김.
- 버튼 없음: `completed` + `failed_answer_count = 0`. 표시 조건: 제출됨 + 실패 표시 중이거나 `evaluation_failed`이거나 (`completed` + 실패 답변 있음).
- 첫 열람: `markInterviewResultViewedAction` — `completed`이고 채점 중·실패 표시가 아닐 때만.

### S-37 (4-2) — `session-list.tsx`, `session-status.tsx`
- **UQ-411**: 행 C-03 축약형 `AiProgressInline jobType={job.job_type}`.
- 채점 실패 행 `⋯` 메뉴 **"실패한 답변 다시 채점"**(`RotateCcw`, 오른쪽 `DropdownMenuShortcut`에 활성 공급자 글자 "Gemini · 무료 등급"). 동작 = `regradeFailedAnswersAction` → 새로고침(행이 채점 중 + C-03). 키 없음 → C-18 팝업(로컬 Dialog + `AiLock inline`), 키 무효 → 거부 토스트, 동의 필요 → C-21 뒤 실행. S-37에서만(S-20 목록은 명세상 없음).
- **새 결과 표식(A9)**: `isNewResult` = `submitted_at` 있음 + (`completed` | `evaluation_failed`) + `result_viewed_at` null. 채점 실패 행은 점 + "채점 실패" 함께, 채점 중 행은 점 없음. 파운데이션 `has_new_result`(completed만)는 쓰지 않음 → 파운데이션 요청 1.

### S-33 (4-3) — `answer-sheet.tsx`, `actions.ts`, 답변지 `page.tsx`
- 그만둔 세션: `Alert` + `CirclePause` "그만둔 면접이에요. 답변은 볼 수만 있어요" + `Button sm` "이 기업 JD로 새 면접 시작"(→ S-20, 배지 없음). 답변은 글자 상자(`rounded-md bg-muted/50 px-4 py-3 whitespace-pre-wrap`), 빈 답변 "답변 없음", 글자 수·C-06·제출 막대 없음, 생성 진행·실패 표시 없음.
- 질문 근거 칩(C-01, owner `interview_question`)을 제출 전에도 질문 아래에 표시. 페이지와 폴링 액션(`getAnswerSheetStateAction`)이 근거를 함께 읽음. (mock 픽스처에 질문 근거가 없어 지금은 칩이 보이지 않음 → 파운데이션 요청 3)
- 생성 진행 C-03 `interview_questions`(prepare 공고 요건 정리 중 → generate "질문 만드는 중 (n/N)"). 새 작업이 도는 동안 세션 행이 `failed`여도 진행으로 보이도록 `jobRunning`을 생성 중 판정에 포함.
- 전체 실패(저장된 질문 0개) "다시 시도" = **같은 행** `retryAiJobAction`(경로 ②), `aiErrorFromJob`의 `sameRow`/`jobTier`로 "{활성 공급자}로 처음부터 다시 해요", 거부는 `refusal`로 동작 줄만 교체.
- 일부 실패(0 < 저장된 질문 < N) **"남은 질문 다시 만들기"** = 새 `interview_questions` 작업(`startRemainingQuestionsAction`, 경로 ①; 거부 `ai_not_connected`는 동작 줄 `key_missing` 잠금으로 표시). 배지·토큰 주석은 `AiErrorNotice`가 그림.
- 입력 원인 실패: 다시 시도 없음, `rerunLabel="시작하기"`, 이동 대상 S-20("면접 준비로").

### S-20 (4-4) — `interview-prep.tsx` (+ 공용 `session-list.tsx`)
- 실행 공급자 열은 기존 `providerRunLabel`이 이미 규칙대로(채점 시작 → evaluation, 아니면 question, 다르면 둘 다) — 변경 없음, 확인만.
- 새 결과 표식: S-37과 같은 `isNewResult`.
- 시작하기 거부를 `AiRunButton onRun`으로 돌려줌(C-18 / C-21 뒤 재실행 / key_invalid는 버튼이 처리). 요건 추출 실패 C-20에 `requestPath`(A14 카운트다운)·`rerunLabel="시작하기"`.
- A3와 공유 파일 없음: `applications/[id]/interview/**`와 `components/interviews/**`만 수정.

### S-39 (4-5) — `kanban-board.tsx`, `board/page.tsx`, `board/interview-prompt-preview.tsx`(신설)
- 카드 F8: `insight_status`·`interview_status`로 판정. 생성 중이면 해당 아이콘 대신 C-03 축약형 줄, 늦게 끝난 실패면 `AiFeatureFailureLine` 한 줄(버튼 없음), 그 밖은 기존 아이콘·개수.
- C-14 개정은 파운데이션 `stage-menu` 그대로. `?state=interview-prompt` 미리보기만 추가.

## [UI-가정]

| 화면 ID | 파일:줄 | 내용 |
|---------|---------|------|
| S-22 | `result-view.tsx:386` | P-11: 실패 답변 0개(종합만 실패) → 버튼 글자 "종합 평가 다시 정리" |
| S-22 | `result-view.tsx:459` | 서버가 `interview_evaluation_not_needed`(null)면 토스트 "다시 채점할 답변이 없어요" + 새로고침 |
| S-22 | `result-view.tsx:372` | 키 없음이면 답변 카드 "다시 채점" 링크 숨김(머리 줄 C-18 인라인이 대신) |
| S-22 | `result-view.tsx` 첫 열람 effect | 화면을 연 채로 다시 채점이 끝나 `completed`가 되면 그 순간을 첫 열람으로 보고 표식을 지움 |
| S-22 | `result-view.tsx` 종합 | 흐린 이전 종합에서 "다음 연습" 이동 버튼 숨김 |
| S-37 | `session-list.tsx:160` | 메뉴 항목 오른쪽 활성 공급자 글자(G-41) |
| S-37 | `session-list.tsx:305` | 키 없음 C-18 팝업형 제목 "다시 채점은 AI 연결 후 사용할 수 있어요" + `AiLock inline`(설명 "다시 채점하면 연결한 AI로 채점해요…") |
| S-37 | `session-list.tsx` | 메뉴 다시 채점은 S-37에서만, 채점 실패 행만(완료 + 실패 답변 행 제외) |
| S-33 | `answer-sheet.tsx:417` | P-12 빈 답변 "답변 없음" |
| S-33 | `answer-sheet.tsx:350` | 입력 원인 실패 이동 대상 S-20, 글자 "면접 준비로" |
| S-33 | `answer-sheet.tsx` | 전체/일부 실패 판정: 저장된 질문 0개 = 전체, 0 < n < N = 일부 |
| S-33 | `actions.ts:79` | mock에 begin RPC 없음 → 새 질문 작업 시작 뒤 세션 `generation_status`는 `failed` 그대로, 화면이 작업 상태를 따라감 |
| S-33 | `answer-sheet.tsx` | 그만둔 세션은 생성 진행·실패 표시를 숨김 |

## 기획 확인 필요

| 화면 ID | 질문 | 스펙 위치 |
|---------|------|-----------|
| S-22 | 실패 답변 0개(종합만 실패)일 때 버튼 표시·글자 (DS P-11) | 02 S-22 v5.3 "버튼" 행 |
| S-22 | 화면을 연 채로 채점이 끝난 경우도 "첫 열람"인지 | 02 S-22 "첫 열람" 행, S-37 "새 결과 표식" |
| S-37 | `completed`인데 실패 답변이 남은 행에도 메뉴 "실패한 답변 다시 채점"을 둘지(명세는 "채점 실패 행") | 02 S-37 세션 목록 행 |
| S-37 | 키 없음 C-18 팝업형 문구(G-41) | DS 6 A4 (v3) S-37 |
| S-33 | 입력 원인 실패(`not_a_jd`·`input_too_long`)의 이동 대상: S-20(DS) vs 공고 원문 S-15 | 02 S-20 v5.3, DS 6 A4 (v3) S-33 |
| L-01 | "새 채점 결과 수" 배지가 S-37 규칙(채점 실패 포함)을 따르는지 — 지금 셸은 completed만 셈 | 02 S-37 "새 결과 표식" 비고 |

## 파운데이션 요청

1. `lib/data/interviews.ts` `row().has_new_result`와 `lib/data/shell.ts` `interviews_new_results`가 `completed`만 셈 → A9 규칙(`submitted_at` 있음 + `completed`|`evaluation_failed` + `result_viewed_at` null)으로. A4는 `session-status.tsx isNewResult`로 직접 계산 중(고치면 `has_new_result`로 바꿀 수 있음).
2. "남은 질문 다시 만들기"용 데이터 함수(begin RPC 대응): 세션 `generation_status = generating`으로 다시 열고 새 `interview_questions` 작업 생성. 지금은 A4 액션이 `startAiJob`을 직접 부름.
3. mock 픽스처에 `evidence_links` owner `interview_question` 행이 없어 S-33 질문 근거 칩이 mock에서 보이지 않음 → 세션 1 질문 몇 개에 근거 추가.
4. 범용 C-18 팝업형(DS 3.18) 컴포넌트: `AiLockDialog`는 C-14 전용 문구라 S-37이 로컬 Dialog로 만듦.
5. `AiRunButton rerun` 주석 글자가 "다시 하면 …" 고정 → S-22는 `footer`로 "다시 채점하면 공급자 토큰을 다시 써요"를 넣음. 글자 prop이 있으면 정리 가능.
6. `retryAnswerEvaluationAction`(답변 단위 재채점)은 A4가 더 이상 쓰지 않음 — 정리 대상.

## 검사 결과

- `pnpm lint` → 종료 0, 출력 없음.
- `pnpm typecheck` → 종료 0.
- build: 지시대로 생략.
- SSR(dev :3000): 세션 5 결과 "실패한 답변 2개 다시 채점"·"다시 채점하면 공급자 토큰을 다시 써요"·카드 "다시 채점" 2개 / `?state=regrading` "종합 평가를 다시 정리하는 중" / `?state=no-failures` 버튼 없음 / S-33 `?state=abandoned` 안내·"이 기업 JD로 새 면접 시작"·"답변 없음" / `?state=questions-partial` "남은 질문 다시 만들기" / `?state=ai-failed` "다시 시도" / `/interviews`·`/board`·S-20 200. C-14 미리보기와 메뉴 항목은 클라이언트 렌더라 SSR HTML에 없음(정상).

## QA 1차 수정 (`12_ui-qa_v53_A4_review.md` 대응)

> 위 본문의 파일:줄 번호와 일부 항목(파운데이션 요청 1·2·4·5, S-22 `footer` 주석, S-37 로컬 Dialog)은 이 수정 전 기준이다.

| ID | 수정 | 파일 |
|----|------|------|
| UQ-550 (Major) | 질문 생성 `insufficient_data`: `AiErrorNotice`가 그리지 않으므로 `InsufficientDataNotice`(경고 Alert: 원인, 질문이 있으면 보존 줄, "면접 준비로" → S-20(거기서 C-09), "채운 뒤 시작하기로 새로 실행해 주세요"). 다시 시도 없음. `?state=insufficient` | `answer-sheet.tsx`, 답변지 `page.tsx` |
| UQ-551 | S-22 입력 원인 채점 실패는 `InputCausedGradingNotice`(톤·아이콘·제목·보존 줄 + "제출한 답변은 고칠 수 없어요. 새 면접으로 다시 연습할 수 있어요"). "고친 뒤 …", "{대상}으로 이동" 없음. `rerunLabel` 제거. 다시 채점 버튼은 그대로 둠(QA 기획 확인 5) | `result-view.tsx` |
| UQ-552 | `preview.active`(?state= 있으면 true)일 때 `markInterviewResultViewedAction` 호출 안 함 | `result-view.tsx`, 결과 `page.tsx` |
| UQ-553 | `EvaluationWatcher onFailed` → 실패로 끝나면 `router.refresh()` (세션 `evaluation_failed`, 점수 없음, 새 n) | `result-view.tsx` |
| UQ-554 | `no-failures` 미리보기: 실패 답변은 같은 세션의 성공 평가를 빌려 씀(`evaluation_error` 비움, `pending_method`), 빌릴 평가가 없으면 그 질문을 뺌. 종합 `succeeded` | 결과 `page.tsx` |
| UQ-555 | 답변 카드 링크 접근 이름 "질문 {n} 다시 채점 (실패한 답변 모두)" | `result-view.tsx` |
| UQ-556 | S-33 C-18: 일부 실패 = "남은 질문 다시 만들기", 전체 실패 = "다시 시도"(설명 "질문을 다시 만들려면 AI를 연결해 주세요"), 입력 원인 = C-18 없음 | `answer-sheet.tsx` |
| UQ-557 | 건너뜀(파운데이션 담당) | — |
| UQ-558 | S-37 페이지가 채점 실패 행의 세션 단위 채점 작업을 읽어 `retry_after`(`rate_limited`/`provider_unavailable`) 맵을 넘김 → 메뉴 항목 비활성 + "(m:ss)" | `interviews/page.tsx`, `interviews-overview.tsx`, `session-list.tsx` |
| UQ-559 | S-37 키 무효: 토스트 대신 창 안에 C-20 `key_invalid`(키 교체) | `session-list.tsx` |
| UQ-560 | C-14 미리보기가 작성 중 세션이 있는 카드의 실제 세션을 씀 → "이어서 쓰기"가 실제 S-33으로 감. 작성 중 세션이 있는 카드가 없으면 미리보기 안 뜸 | `board/page.tsx`, `interview-prompt-preview.tsx` |
| UQ-561 | `isNewResult` 삭제, `row.has_new_result` 사용 | `session-list.tsx`, `session-status.tsx` |

**파운데이션 2차 도입**: `AiLockPopup`(S-37 로컬 C-18 창 대체), `AiRunButton rerun` + `rerunNote`(S-22 `footer` 대체), `startRemainingQuestionsAction(sessionId)`(`lib/data/actions`, A4 사본 삭제).

**새 ?state=**: S-33 `insufficient`.

**새 [UI-가정]**: `InsufficientDataNotice` 제목·설명·caption 문구 / `InputCausedGradingNotice` 안내 문구 / S-33 전체 실패 C-18 설명 / S-37 키 무효 창 제목 "다시 채점하려면 키를 바꿔 주세요" / S-37 키 없음 팝업 제목·설명 / `no-failures`의 평가 빌려 쓰기(미리보기 전용).

**파운데이션 요청 (추가)**: `AiErrorNotice`에 입력 원인 caption("고친 뒤 …")을 끄는 prop이 있으면 `InputCausedGradingNotice`를 없앨 수 있음.

**기획 확인 필요 (추가)**: S-22 입력 원인 채점 실패(`input_too_long`·`safety_blocked`)에서 답변을 고칠 수 없는데 "실패한 답변 {n}개 다시 채점" 버튼을 둘지(지금은 둠).

**검사(QA 1차 수정 후)**: `pnpm lint` 통과 · `pnpm typecheck` 통과. SSR(dev :3000): S-33 `?state=insufficient` 원인·"면접 준비로"·"채운 뒤 시작하기로…" / S-22 세션 5 `?state=input-failed` "고친 뒤" 없음·"제출한 답변은 고칠 수 없어요" / `?state=no-failures` 버튼·"채점 실패"·상태 페이지 없음 / 카드 접근 이름 "질문 {n} 다시 채점 (실패한 답변 모두)" / S-33 `?state=questions-partial` 정상 / `/interviews`·`/board`·`/board?state=interview-prompt` 200. **브라우저 클릭(S-37 메뉴 비활성·팝업, 실패 뒤 새로고침, C-14 이어서 쓰기)은 눈으로 보지 않았다.** `?state=input-failed`의 답변 카드에는 픽스처 작업 원인(`provider_unavailable`) inline이 그대로 남는다(미리보기 한계).
