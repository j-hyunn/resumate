# UI QA — 기획 v5.3 A4 면접·보드 (라운드 1)

> 2026-10-30. 범위: 브리프 `08_brief_v53.md` 4-1~4-5 (S-22 · S-37 · S-33 · S-20 · S-39/C-14) + 파운데이션 QA `10_ui-qa_v53_foundation_review.md`의 A4 이슈 UQ-411·412·413 재확인.
> 기준: `02-user-flows.md` v5.3 (FL-12, S-20, S-22, S-33, S-37, S-39, C-03, C-14, C-19, C-20, 5.1c A1·A8·A9), `design-system.md` v3 6장 A4 (v3)·3.20·3.3, A4 보고 `11_frontend-engineer-A4_v53_report.md`, 파운데이션 보고 `09_…`.
> 방법: 코드 정적 대조 + dev 서버(:3000) curl SSR 확인(세션 1·2·4·5, `?state=` 별). **브라우저 클릭 흐름(다시 채점 → 진행 → 완료, S-37 메뉴 다시 채점, 동의 창, C-14 팝업)은 코드 경로로만 확인했다.** 클라이언트에서만 그려지는 것(AiErrorNotice 안 C-19 배지, "처음부터 다시" 줄, C-14 팝업)은 SSR에 없어 코드로만 봤다. 코드 수정 없음.

## 요약 — Critical 0 / Major 1 / Minor 12

- 기계 검사: `pnpm lint` 통과(출력 없음). `pnpm typecheck` 첫 실행은 `src/lib/data/applications.ts` 5건 실패(파운데이션 병렬 수정 중, A4 무관) → 재실행 통과. build 생략(지시).
- 브리프 4-1~4-5의 핵심은 들어가 있다. S-22 "실패한 답변 {n}개 다시 채점" + 활성 공급자 C-19 + "다시 채점하면 공급자 토큰을 다시 써요", 새 작업(`regradeFailedAnswersAction`), 종합 흐리게 + "종합 평가를 다시 정리하는 중", 단계 `prepare` 채점 준비 중 → … → `score`, 실패 없는 `completed`면 버튼 없음, `completed`만 첫 열람 시 표식 해제. S-37 채점 실패 행 메뉴·새 결과 표식(A9)·행 C-03 `jobType`. S-33 그만둔 세션 읽기 전용·문구·"이 기업 JD로 새 면접 시작", 질문 근거 칩(제출 전), `prepare` → "질문 만드는 중 (n/N)", 전체 실패 = 같은 행 다시 시도 / 일부 실패 = "남은 질문 다시 만들기"(새 작업), 거부 5종 동작 줄 교체, 입력 원인은 다시 시도 없음. S-20 실행 공급자 규칙·시작 거부 처리. S-39 카드 F8, C-14 작성 중 세션 상세.
- **Major 1건**: S-33 질문 생성이 `insufficient_data`로 실패하면 `AiErrorNotice`가 `null`을 돌려 생성 영역에 아무것도 보이지 않는다(C-09·이동 없음, 답변란은 비활성).
- Minor는 A4 10건(입력 원인 문구·미리보기 부작용·재채점 실패 뒤 화면 갱신·메뉴 대기 시간 등), 파운데이션 1건(토큰 주석 문구), 그리고 UQ-561(A4, 중복 판정 정리).
- 재확인: UQ-411·412·413 모두 **해결**.

## 화면별 점검표

| 화면 ID | Q1 | Q2 | Q3–4 | Q5 | Q6 | Q7 | Q8 | Q9 | Q10 | 메모 |
|---------|----|----|------|----|----|----|----|----|-----|------|
| S-22 면접 결과 | ✅ | ⚠️ | ✅ | ✅ | ⚠️ | ✅ | ✅ | ⚠️ | ✅ | UQ-551·552·553·554·555. `?state=` regrading·no-failures·consent-required·input-failed·ai-failed* 200 |
| S-37 모의 면접 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | UQ-558·559·561. 세션 5 행 "새 결과" 점 + "채점 실패" + "질문 Gemini · 채점 OpenAI" |
| S-33 면접 답변지 | ⚠️ | ⚠️ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | UQ-550(Major)·556·557. `?state=` abandoned·questions-partial·input-failed·retry-*·ai-pending 200 |
| S-20 면접 준비 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 실행 공급자·새 결과 표식은 S-37과 같은 `SessionList` |
| S-39 보드 (+C-14) | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | UQ-560. 세션 5의 기업 JD 카드에 F8 실패 한 줄 확인 |

세부 대조 (✅ 근거):

- **4-1 S-22 버튼** — `result-view.tsx:299-312,397-445`: 머리 카드 `Separator` 뒤 `AiRunButton`(default, `RotateCcw`) "실패한 답변 {n}개 다시 채점"(`failed_answer_count`, 데이터 계층 `failedAnswerIds` = 제출됨 + 성공 평가 없음), `ProviderBadge`는 `connection`(활성 공급자), footer "다시 채점하면 공급자 토큰을 다시 써요". 키 없음 → C-18 inline(`lock` entry interview_submit), `rate_limited`/`provider_unavailable` → `retry_after`까지 카운트다운·고정 접근 이름. SSR 세션 5: 버튼·"Gemini · 무료 등급"·주석·카드 "다시 채점" 2개, `?state=consent-required`에서 배지 "동의 필요".
- **4-1 새 작업** — `runRegrade`(`:142-165`) → `regradeFailedAnswersAction` → `ai-jobs.ts regradeFailedAnswers`: 새 `interview_evaluation` 작업, 세션 `evaluating`·점수·완료 시각·`result_viewed_at` 비움, `evaluation_provider` 덮어씀, 종합 `pending`. 카드 링크도 같은 함수(`regradeFromCard`). 같은 행 `retryAiJob` 호출 없음.
- **4-1 종합·진행** — `:189-193,316-355`: 다시 채점 중 이전 종합 `aria-busy` + `text-muted-foreground` + "종합 평가를 다시 정리하는 중"(`Loader2`), 다음 연습 링크 숨김. `:246-253` C-03 `jobType="interview_evaluation"` → `prepare` "채점 준비 중"·`evaluate`·`summarize`·`score`(`ai-progress.tsx` 단계 표, `labels.ts:95` `complete`→`score` 유지). 점수 자리 `Skeleton h-8 w-24`, 버튼 줄 숨김. SSR 세션 2 `?state=regrading` 확인.
- **4-1 버튼 없음·첫 열람** — `:130-135` `completed` + 실패 0이면 줄 없음(SSR `?state=no-failures` 확인). `:121-124` `completed`이고 채점 중·실패 표시가 아닐 때만 `markInterviewResultViewedAction`.
- **UQ-412** — 상단 C-20(`:236-244`)에 `onRetry` 없음 → RetryButton·배지 없음, 배지는 머리 버튼 줄 하나. 명세 "이 화면에는 같은 행 다시 시도 버튼을 따로 두지 않는다"와 같음.
- **4-2 S-37** — `session-list.tsx:154-163` `evaluation_failed` 행만 "실패한 답변 다시 채점" + `DropdownMenuShortcut` 활성 공급자 글자(DS G-41), 키 없음 C-18 팝업(`:301-318`), 동의 필요 → `consent.guard`. `session-status.tsx:60-62` A9 표식(제출 + 완료|채점 실패 + 미열람), 채점 중 점 없음. `:44-50` 행 축약형 `jobType` 전달(UQ-411).
- **4-3 S-33 그만둔 세션** — `answer-sheet.tsx:317-328,408-419`: `Alert` + `CirclePause` 문구 명세 그대로, `Button sm` → S-20, 글자 상자·"답변 없음", 글자 수·C-06·제출 막대·생성 진행·실패 표시 없음(`:147-161`). SSR 세션 4(실제 abandoned)·세션 1 `?state=abandoned` 확인.
- **4-3 근거 칩** — `:406-407` 질문 아래 `EvidenceChips`(owner `interview_question`, 페이지·폴링 액션 모두 읽음). 픽스처에 근거 3건이 생겼지만(`fixtures.ts:1359-1361`) mock 저장소가 서버 시작 때 만들어져(`store.ts`) 지금 서버에서는 보이지 않음 → **런타임 미확인**, 코드 경로만 확인.
- **4-3 진행·다시 시도** — `:367-380` C-03 `interview_questions`(SSR `?state=ai-pending` "공고 요건 정리 중" → "질문 만드는 중 (3/5)"). 전체 실패 → `retryAiJobAction`(같은 행, 경로 ②, `sameRow` → "{활성}로 처음부터 다시 해요"), 일부 실패 → `startRemainingQuestionsAction`(새 작업, 경로 ①, "처음부터" 줄 없음). 거부 → `refusal`로 동작 줄만 교체(SSR `retry-refused-key-missing` "AI 연결이 필요해요. 작성한 내용은 저장돼 있어요", `retry-connection-changed` 문구, `retry-not-retryable` 문구 + "면접 준비로"). 입력 원인(`input-failed`) → 다시 시도 없음 + "면접 준비로" + "고친 뒤 시작하기로 새로 실행해 주세요".
- **4-4 S-20** — `providerRunLabel`(`provider-badge.tsx:140-154`) = 채점 시작 → evaluation, 아니면 question, 다르면 둘 다. SSR 세션 5 행 "질문 Gemini · 채점 OpenAI" + "새 결과". 시작 거부는 `onRun`이 결과를 돌려줘 `AiRunButton`이 C-18 / C-21 뒤 재실행 / key_invalid 처리(`interview-prep.tsx:141-173,319-330`).
- **4-5 S-39** — `kanban-board.tsx:457-529` F8: 생성 중이면 아이콘 대신 C-03 축약형(`jobType`), 늦게 끝난 실패면 `AiFeatureFailureLine`. C-14(`stage-menu.tsx`)는 작성 중 세션 유형·n/N 작성·마지막 활동·`generation_status` 두 문구·유형 다름 문구가 명세 C-14 행과 같다(문구 "S-20에서" → "면접 준비에서"는 화면 이름 치환).
- **Q3–4** — A4가 쓰는 새 값(`failed_answer_count`, `result_viewed_at`, `generation_status`, `AiRetryRefusalCode`)은 `types/db.ts`·`InterviewSessionRow`와 일치. UI 전용 필드가 db 타입에 새지 않음.
- **Q8** — A4 파일 원색·팔레트 클래스 0건(`grep`). 토큰(`text-ai-subtle-foreground`, `bg-muted/50`, `text-warning-subtle-foreground`)만.
- **Q10** — S-22 버튼 `max-md:h-11`, 카드 링크 `max-md:min-h-11`, S-37 `⋯` `max-md:size-11`, S-33 그만둔 안내 버튼 `max-md:h-11`. 가로 넘침 요소 없음.

## 이슈

| ID | 심각도 | 담당 | 화면 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|----|--------|------|------|-----------|-----------|------|------|
| UQ-550 | Major | A4 | S-33 | 02 C-20 "(입력) `not_a_jd`·`insufficient_data` → C-09 / 입력 화면으로 → 고친 뒤 새로 실행", S-20 v5.3 "입력 원인 실패 `not_a_jd`·`insufficient_data`·… 다시 시도 없이 C-20대로 — S-20 시작하기로 새 세션"(R-76) | `src/components/interviews/answer-sheet.tsx:330-365` (`<AiErrorNotice code={failedCategory} …>`), 공통 `src/components/common/ai-error-notice.tsx:429` (`if (code === "canceled" \|\| code === "insufficient_data") return null`) | 질문 생성이 `insufficient_data`로 끝나면 생성 영역에 원인(C-09 형태 또는 입력 원인 안내) + "면접 준비로" 이동 | `AiErrorNotice`가 아무것도 그리지 않음 → 생성 영역 비어 있음, 저장된 질문의 답변란은 `disabled`, 제출 막대 없음. 사용자는 왜 멈췄는지, 어디로 가야 하는지 알 수 없다(경로가 이동 경로 링크뿐). 공통 컴포넌트는 "호출 측이 C-09를 그린다"는 설계이므로 A4가 이 코드를 따로 처리해야 함 |
| UQ-551 | Minor | A4 | S-22 | 02 C-20 `input_rejected` 행 "입력을 고친 뒤 새로 실행", S-22 v5.3 표(입력 원인 경우 없음), DS 3.20 (v3) "고친 뒤 {실행 버튼 글자}로 새로 실행해 주세요" | `src/components/interviews/result-view.tsx:243` (`rerunLabel={regradeLabel(failedCount)}`), `:130-133` (`canRegrade`에 입력 원인 포함) | 채점 입력 원인 실패의 안내 문구가 말이 되고, 다시 채점 버튼 표시 여부가 명세와 맞음(기획 확인 필요 5) | SSR `?state=input-failed`: "고친 뒤 실패한 답변 2개 다시 채점**로** 새로 실행해 주세요" — 조사 오류("으로")이고, 제출한 답변은 고칠 수 없어 뜻도 맞지 않음. 같은 화면에 "실패한 답변 2개 다시 채점" 버튼은 그대로 있음 |
| UQ-552 | Minor | A4 | S-22 | 02 S-22 "첫 열람: `completed` 세션을 처음 열면 표식을 지운다. 채점 실패 화면을 열어도 지우지 않는다", ui-context "?state= 미리보기" | `src/app/(dashboard)/applications/[id]/interview/[sessionId]/result/page.tsx:38-97` (`scored`·`empty`·`no-answers`·`no-failures`가 `status: "completed"`로 덮음) + `result-view.tsx:121-124` | 미리보기는 실제 데이터를 바꾸지 않음 | 채점 실패 세션(세션 5)을 `?state=scored`/`no-failures`로 열면 클라이언트 effect가 실제 `result_viewed_at`을 기록 → S-37·L-01에서 그 채점 실패 세션의 "새 결과" 표식이 사라짐(개발 미리보기 부작용) |
| UQ-553 | Minor | A4 | S-22 | 02 S-22 "다시 채점: 점수·완료 시각을 비우고… 종합이 실패하면 `evaluation_failed`(저장된 답변 평가는 보존)" | `result-view.tsx:225-231` (`EvaluationWatcher onDone={() => router.refresh()}`), `ai-progress.tsx` `useAiJob` (onDone은 `succeeded`에서만) | 다시 채점 작업이 실패로 끝나면 화면을 새로 읽어 세션 상태(`evaluation_failed`, 점수 없음, 새 실패 답변 수)를 보임 | 실패로 끝나면 새로고침이 없어 시작 전 세션 값이 그대로 보임: `completed`(실패 답변 있음)에서 시작했다면 이전 점수 블록·종합이 다시 나타나고 버튼 글자의 n도 옛 값. 상단 C-20만 새 원인 |
| UQ-554 | Minor | A4 | S-22 | 02 S-22 "버튼이 없을 때 = `completed`이고 실패한 답변이 없으면" | `result/page.tsx:96-97` (`no-failures` → `{ status: "completed", failed_answer_count: 0 }`만 덮음) | 미리보기가 "실패 없는 완료" 화면을 보여 줌 | 세션 5로 열면 머리는 완료·버튼 없음인데 답변 카드 2개는 C-17 "채점 실패" + C-20 inline "OpenAI에 일시적인 문제가 있어요" + "OpenAI 상태 페이지"가 남음(SSR 확인). 질문 평가도 성공으로 덮거나 실패 없는 세션으로만 보이게 |
| UQ-555 | Minor | A4 | S-22 | DS 7 접근성(같은 이름의 동작은 대상을 구분), S-22 v5.3 "답변 카드의 다시 채점" | `result-view.tsx:553-558` | 카드마다 접근 이름이 대상을 구분(예: "질문 2 다시 채점" 또는 `aria-describedby`로 질문 번호), 세션 단위 동작임을 알 수 있게 | 카드마다 같은 이름 "다시 채점" 버튼이 여러 개 — 스크린 리더 버튼 목록에서 구분 불가 |
| UQ-556 | Minor | A4 | S-33 | 02 C-20 "다시 시도의 공급자" 표 "키가 없을 때 → C-18", `input_rejected` 행 "다시 시도 없음", DS 6 A4 (v3) S-33 | `answer-sheet.tsx:344,355-363` | 키가 없을 때의 C-18이 실제로 막힌 동작을 가리킴: 전체 실패면 "다시 시도", 일부 실패면 "남은 질문 다시 만들기", 입력 원인이면 C-18 없음 | 키가 없으면 실패 종류와 상관없이 C-18 actionName "남은 질문 다시 만들기"·설명 "남은 질문을 만들려면 AI를 연결해 주세요…"를 보임. 전체 실패(질문 0개)와 입력 원인 실패(다시 실행 자리가 S-20)에도 같은 문구 |
| UQ-557 | Minor | 파운데이션 | S-33 (공통) | 02 S-33 v5.3 "남은 질문 다시 만들기 … 공급자 토큰을 다시 쓴다는 한 줄" | `src/components/common/ai-error-notice.tsx:334-340` (`retryTokenNote`) | "남은 질문을 다시 만들면 토큰을 다시 써요"처럼 자연스러운 한 줄 | SSR `?state=questions-partial`: "남은 질문 다시 만들기**하면** 토큰을 다시 써요" — "…하기"/"…보내기"만 처리해 "만들기"가 그대로 붙음(UQ-492 처리의 빈틈) |
| UQ-558 | Minor | A4 | S-37 | 02 S-37 "실패한 답변 다시 채점(S-22와 같은 동작…)", C-20 `rate_limited` "다시 시도(`retry_after`까지 비활성)" | `src/components/interviews/session-list.tsx:154-163` | 채점 실패 원인이 `rate_limited`/`provider_unavailable`이고 `retry_after`가 남았으면 메뉴 항목도 S-22처럼 비활성(남은 시간 표시) | 메뉴 항목은 늘 활성 — S-22에서는 막힌 재채점을 S-37에서는 바로 보낼 수 있음. 행 데이터에 실패 작업의 `retry_after`가 없음(필요하면 파운데이션에 필드 요청) |
| UQ-559 | Minor | A4 | S-37 | 02 C-19/C-20 `key_invalid` "키 교체 → S-41 ③", C-20 "다시 시도의 공급자" 표 "무효면 C-20 `key_invalid`" | `session-list.tsx:128-131` | 키 무효면 C-20 `key_invalid`(키 교체 동작 포함) — 팝업 또는 토스트 동작 버튼 | 오류 토스트 "{공급자} 키가 더 이상 작동하지 않아요. 새 키로 바꿔 주세요"만, 키 교체로 가는 동작 없음 |
| UQ-560 | Minor | A4 | S-39 | 02 C-14 "이어서 쓰기 → S-33", ui-context `?state=` 미리보기 | `src/components/board/interview-prompt-preview.tsx:16` (`id: "preview"`) | 미리보기 팝업의 "이어서 쓰기"가 실제 S-33으로 감(픽스처의 작성 중 세션 id 사용 등) | `/applications/{id}/interview/preview` → 404 |
| UQ-561 | Minor | A4 | S-37 · S-20 | 02 S-37 "새 결과 표식"(L-01·S-20 같은 규칙) | `src/components/interviews/session-status.tsx:53-62` (`isNewResult`) vs `src/lib/data/interviews.ts:44-47,65` (`hasNewResult`, `has_new_result`) | 한 곳의 판정만 사용 | 파운데이션 요청 1이 이미 반영돼 `has_new_result`가 A9 규칙이 됨. A4 사본은 같은 규칙이지만 따로 있어 이후 어긋날 수 있음 → `row.has_new_result`로 교체 |

## 기획 확인 필요

| # | 화면 | 질문 | 양쪽 인용 |
|---|------|------|-----------|
| 1 | S-22 | 종합 평가만 실패한 `evaluation_failed`(실패 답변 0개)일 때 버튼 표시·글자 (DS P-11, 지금 "종합 평가 다시 정리") | 02 S-22 버튼 행 "실패한 답변 {n}개 다시 채점" / 같은 표 결과 행 "종합이 실패하면 `evaluation_failed`" |
| 2 | S-22 | 화면을 연 채로 다시 채점이 끝나 `completed`가 되면 그 순간도 "첫 열람"인지(지금 즉시 표식 해제) | 02 S-22 "`completed` 세션을 처음 열면 … 지운다" / FL-12 "끝나면 '새 결과'로 보인다" |
| 3 | S-37 | `completed`인데 실패 답변이 남은 행에도 메뉴 "실패한 답변 다시 채점"을 둘지(지금 채점 실패 행만) | 02 S-37 "채점 실패 행은 '실패한 답변 다시 채점'" / S-22 "`completed`이고 실패한 답변이 없으면 버튼을 보이지 않는다"(= completed + 실패 있음이면 S-22에는 버튼) |
| 4 | S-33 · S-20 | 질문 생성 입력 원인 실패(`not_a_jd`·`input_too_long`)의 이동 대상 — S-20(지금 S-33) vs 공고 원문 S-15(지금 S-20 요건 추출 실패). 같은 원인이 A4 안에서 두 곳으로 감. `input_too_long` 제목은 "공고 원문을 줄여 주세요"인데 버튼은 "면접 준비로" | 02 C-20 `input_rejected` "해당 입력으로 이동 → … 면접 질문 생성은 S-20 '시작하기'(새 세션)" / DS 6 A4 (v3) "입력 원인 실패는 … S-20으로 가는 동작 하나만" |
| 5 | S-22 | 채점(AI-06/07)의 입력 원인 실패(`input_too_long`·`safety_blocked`) 처리 — 제출한 답변은 고칠 수 없으므로 "입력을 고친 뒤 새로 실행"이 성립하지 않음. 다시 채점 버튼을 둘지, 어떤 안내를 할지(UQ-551) | 02 C-20 `input_rejected` "입력을 고친 뒤 새로 실행 … '다시 시도' 버튼은 두지 않는다" / S-33 "제출 후 … 읽기 전용" / S-22 다시 채점 표(원인 구분 없음) |

> A4 보고의 "L-01 새 채점 결과 수 배지가 S-37 규칙을 따르는지"는 명세에 이미 있음(02 S-37 비고 "L-01 '새 채점 결과 수' 배지·S-20 목록도 같은 규칙"). 파운데이션이 `shell.ts:40-41`에 반영해 해소 — 기획 질문에서 뺐다.

## 재확인 결과

| ID | 결과 | 메모 |
|----|------|------|
| UQ-411 | 해결 | `session-list.tsx:44-50` `AiProgressInline jobType={job?.job_type}` → 채점 `prepare` "채점 준비 중", 질문 `generate` "질문 만드는 중 (n/N)", `complete` 직전 문구(`labels.ts COMPLETE_AS`) |
| UQ-412 | 해결 | S-22 상단 C-20에 `onRetry`가 없어 RetryButton·배지가 안 그려짐. 배지는 머리 버튼 줄 하나(SSR 세션 5에서 "Gemini · 무료 등급" 1회) |
| UQ-413 | 해결 | 다시 채점(S-22 머리·카드, S-37 메뉴) = `regradeFailedAnswersAction`(새 작업), "남은 질문 다시 만들기" = `startRemainingQuestionsAction`(새 작업). `retryEvaluationAction`·`retryQuestionGenerationAction` 삭제 확인(grep 0건). 전체 실패 "다시 시도"만 같은 행 `retryAiJobAction`(명세 경로 ②) |
| (파운데이션 메모) S-22 `lockEntry` | 해결 | `result-view.tsx:242` `lockEntry="interview_submit"` (지금은 같은 행 다시 시도가 없어 실제로 쓰이지 않음) |
| (파운데이션 메모) S-39 카드 F8 | 해결 | `kanban-board.tsx:457-529` `insight_status`·`interview_status` + `FeatureStatusLines` |
| (A4 파운데이션 요청 1) `has_new_result` | 해결(파운데이션) | `interviews.ts:44-47`, `shell.ts:40-41` A9 규칙 → UQ-561로 A4 사본 정리 |
| (A4 파운데이션 요청 3) 질문 근거 픽스처 | 반영됨·런타임 미확인 | `fixtures.ts:1359-1361` 근거 3건 추가. 실행 중인 dev 서버의 mock 저장소는 그 전에 만들어져 SSR에 칩 없음 — 서버 재시작 뒤 세션 1 질문 1·3 확인 필요 |

## 기계 검사 출력

- `pnpm lint` → `$ eslint` 출력 없음, 종료 0.
- `pnpm typecheck` 1차 → 종료 2:
  ```
  src/lib/data/applications.ts(73,21): error TS2304: Cannot find name 'errorCategoryOf'.
  src/lib/data/applications.ts(74,20): error TS2304: Cannot find name 'failureCauseOf'.
  src/lib/data/applications.ts(75,8): error TS2304: Cannot find name 'failureTimestamps'.
  src/lib/data/applications.ts(305,37): error TS2339: Property 'next_jd_extraction_failure' does not exist on type 'MockControls'.
  src/lib/data/applications.ts(306,44): error TS2339: Property 'next_jd_extraction_failure' does not exist on type 'MockControls'.
  ```
  모두 `lib/data/applications.ts`(파운데이션 병렬 수정 중) — interview·board 0건. 2차 실행 → 종료 0.
- build: 지시대로 생략.
- SSR(curl, dev :3000): S-22 세션 5 기본·`regrading`·`no-failures`·`input-failed`·`consent-required`·`ai-failed-rate-limited`, 세션 2 `regrading`(흐린 종합), S-33 세션 1 `abandoned`·`questions-partial`·`input-failed`·`ai-failed`·`retry-other-provider`·`retry-refused-key-missing`·`retry-connection-changed`·`retry-not-retryable`·`ai-pending`, 세션 4(실제 그만둠), S-37, S-20(기업 JD 3), S-39 기본·`interview-prompt` 모두 200.
