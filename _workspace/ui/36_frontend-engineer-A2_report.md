# 36 런 — A2(커리어) 프론트엔드 보고

기준: decisions 3.18·4.12 UI 3·5·6·7·9 (+ 리더 추가 요청 R-OD-15·C-18 설명), UX v5.13, AI v4.11 AI-13, DM v4.11 7장·11.6 #11·#15.
손대지 않은 파일: `career-v45-save.ts`, `career-v45-shared.ts`의 해시 함수, `src/server/**`, `src/app/api/**`, `src/lib/contracts/**`, `supabase/**`, `doc-markdown-editor.tsx`.

## 항목별 변경

### UI 3 — OD-C3 첫 저장 토스트
- `src/components/career/new-row-notice.tsx:40` `FIRST_SAVE_TOAST`("프로젝트를 커리어에 추가했어요" / "산출물을 추가했어요"), `:51` `firstSaveToast(kind, {wasNew, fromPanel})`.
- S-10 `project-page.tsx:335`: 저장 성공 때 `wasNew`(저장 전 `projectId` **상태**가 비었는지)이고 패널 첫 메시지 저장이 아닐 때만 토스트. 패널은 `savePage: () => doSaveRef.current({ fromPanel: true })`(`:378`). 그 뒤 저장은 C-06만.
- S-44 `deliverable-page.tsx:224`: 같은 규칙(`wasNew = !id`), 패널은 `doSave(false, { fromPanel: true })`(`:273`).
- 패널 첫 메시지로 행이 생기면 기존 "대화를 시작하려고 … 저장했어요" 하나만(UX `[가정]` 그대로).
- 테스트: `new-row-notice.test.ts` "OD-C3 첫 저장 토스트"(문구, 판정, 소스 가드 — wasNew가 행 ID 상태에서 나오는지, 패널 저장이 `fromPanel`로 표시되는지).

### UI 5 — OD-P2 되돌리기 제거
- S-10 `project-page.tsx:428~430`: `"{섹션}에 채웠어요"` 정보 토스트만(여러 칸 쉼표 이음 그대로). `undo`·`undoToasts`·`saveGen` 삭제.
- S-44 `deliverable-page.tsx:315`: 교체·덧붙이기·블록 반영 모두 `"본문에 채웠어요"`만. `lastFill`·"이미 본문을 고쳐서 되돌릴 수 없어요" 삭제.
- `star-proposal-fill.ts`: `FillEntry.prev` 삭제(되돌리기용이던 값) — `{field, next, rev}`만.
- S-44 본문 교체 확인은 유지, "저장하기 전에는 되돌릴 수 있어요" 설명 삭제(R-OD-13) `deliverable-draft-card.tsx:485~486`. 본문이 바뀐 경우의 "교체하면 바뀐 내용도 사라져요"는 그대로. 설명이 없을 때 `aria-describedby={undefined}`.
- 테스트: `star-proposal-fill.test.ts`(prev 제거, "fill entry는 {field,next,rev}만"), `new-row-notice.test.ts` "OD-P2 채우기 토스트에 되돌리기 없음"(두 페이지 소스에 "되돌리기"·토스트 action 없음).

### UI 6 — OD-P6 초안 6회 고정 칩 3개
- `src/lib/data/quick-chips.ts:163` `draftLimitChips`: `draft_count ≥ 6`이면 상태와 상관없이 "빠진 부분 물어봐 줘"(첫 빈 슬롯, action 없음) · "프로젝트 내용을 바탕으로 물어봐 줘"(`requested_action = ask_from_project`) · "새 대화 시작"(`new_chat`). 이전 `withDraftLimit`(자리 바꿈) 삭제.
- 칩 타입에 `ChipRequestedAction = "compose_draft" | "ask_from_project"`. 초안 불가 행의 칩 3도 이제 `ask_from_project`를 보낸다(`:146`, AI v4.11 OD-P12 — 지금까지 action 없이 보냈음).
- 같은 타입을 `TurnRequestBody.requested_action`(`career-v45-shared.ts`), `use-ai-panel.ts` `SendOptions`·`TurnFailure`에 반영. 실제 경로는 계약 `DeliverableRequestedActionSchema`가 이미 `ask_from_project`를 받는다.
- 테스트: `quick-chips.test.ts` — 칩 3 `ask_from_project`, 6회 4가지 상태(초안 있음·가능·불가·7회)에서 고정 3개, 빠진 부분 슬롯, 5회는 행 칩 유지.

### UI 7 — OD-P11 답을 받지 못한 메시지 · 다시 보내기
- 새 모듈 `src/components/career/ai-panel/unanswered.ts`: `reopenedTurn(messages, {responding, liveFailure})`
  - 마지막이 사용자 메시지(뒤에 AI 행 없음) → `unanswered`
  - 마지막 AI 행 `failed` + 작업 `canceled`(R-OD-8 사용자 중단) → `unanswered`
  - 마지막 AI 행 `failed` + 작업 `failed` → `failed`(C-20 실패한 턴, 작업의 원인으로)
  - `failed` 행인데 작업 상태를 모름(실제 DTO) → `unanswered` `[UI-가정]`
  - 진행 중인 턴(이 패널 응답 중 또는 `streaming` 행 — 다른 탭)·이번 방문의 실패가 있으면 없음
  - `isHiddenAssistantRow`: `failed` AI 행(부분 응답)은 말풍선으로 그리지 않음(OD-P10 부분 응답 버림), `dropTrailingFailedReply`: 다시 보내기의 `turn_started`에서 재사용될 실패 행을 목록에서 뺌.
- `use-ai-panel.ts:719~` `unanswered`·`resendUnanswered`(키 없음·무효·닫힘 막힘은 일반 전송과 같음 → `runTurn(…, retry = true)`, 사용자 메시지 새로 안 만듦). 다시 연 대화의 작업 `failed`는 `failure`로 내보내 기존 C-20 + "다시 보내기"(`retry`)를 그대로 쓴다.
- `runTurn` 거절 처리(`:505~517`): 409 `turn_in_progress` → 토스트(서버 문구), 409 `nothing_to_retry` → 토스트 + 그 메시지 텍스트를 입력창에 돌려줌 `[UI-가정]` (지금 실제 라우트는 사용자 메시지로 끝난 대화를 거절하므로 이 길로 감).
- `ai-panel.tsx:366` 실패 AI 행 숨김, `:387` 해당 사용자 말풍선 아래 `UnansweredLine`(`:472`, "답을 받지 못한 메시지예요 · 다시 보내기", muted + 링크 버튼).
- 뷰 모델 `WritingChatMessageView.turn_job?: TurnJobEnd | null`(`career-v45-shared.ts:335`) — mock만 채움, 실제는 비움(`// 연결 대기 (DM v4.11 11.6 #11·#15)`).
- mock 턴(`writing-chat-turn-v45.ts` mock): 다시 보내기는 사용자 메시지를 다시 세지 않음(응답 1개만 +1). mock은 ①(실패 행 재사용)과 ②를 구분하지 못해 ①도 +1로 셈 `[UI-가정]`(미리보기 한정).
- 사용자가 이번 방문에서 중지하면(로컬 abort) 마지막이 사용자 메시지라 바로 같은 줄이 보인다 `[UI-가정]`(명세는 "다시 열었을 때"; 같은 상태라 같은 표시로 봄).
- 테스트: `unanswered.test.ts`(문구, 4가지 판정, 진행 중·실패 우선, 숨김·재사용 행 제거).

### UI 9 — OD-B4 실행 전 `key_missing` = C-18
- 실행 전(요청 단계) 거절은 이미 `ai_not_connected` 블록 → C-18 인라인 잠금("AI 연결하면 사용할 수 있어요")이었다. 문제는 반대쪽: 실제 SSE에서 `turn_started` **뒤** 온 `key_missing`도 `PRE_STREAM_CODES` 때문에 실행 전 거절로 바뀌어 C-18로 보였다.
- `writing-chat-turn-v45.ts:189·255·264·281`: `turn_started`가 온 뒤의 `error`는 `before_stream = false` → C-20 `key_missing` "키가 삭제되어 작업을 끝냈어요…"(실행 중 삭제만). 게이트의 SSE `error`(`turn_started` 전)는 그대로 C-18. S-10·S-44 공통 코어라 둘 다 적용.
- 테스트: `writing-chat-turn-v45.test.ts` 2건(게이트 전 = before_stream, 실행 중 = failed turn).

### 리더 추가 요청
- R-OD-15: 무료 등급 인사 줄은 Gemini 무료만 — `ai-panel.tsx:331`, `deliverable-draft-card.tsx:118`(`active_provider === "gemini"` 조건 추가).
- C-18 설명(v5.13): `gate-next-step.tsx:102` "질문에 답하면 AI가 STAR(상황·역할·행동·결과/성과·배운 점)에 넣을 내용을 제안해요".

## `?state=` 추가 (S-10 · S-44, `PAGE_PREVIEW_STATES`)
- `unanswered` — 열린 대화가 답 없는 사용자 메시지로 끝남
- `unanswered-canceled` — 마지막 AI 행 `failed` + 작업 `canceled`(중단) → 같은 줄
- `reopen-failed` — 마지막 AI 행 `failed` + 작업 `failed`(`provider_unavailable`) → C-20 + 다시 보내기
(`src/lib/mock/career-v45.ts:273` `previewUnanswered`, `career-v45.ts` 두 읽기 mock 분기에서 적용)

## [UI-가정]
1. 작업 상태를 모르는 `failed` AI 행(실제 경로 전부)은 "답을 받지 못한 메시지"로 본다 — DTO가 작업 상태를 내릴 때까지.
2. `failed` AI 행(부분 응답 포함)은 말풍선으로 그리지 않는다.
3. 이번 방문의 중지 직후에도 같은 줄을 보인다.
4. `nothing_to_retry` 거절 → "이 메시지는 다시 보낼 수 없어요. 입력창의 내용을 새로 보내 주세요" + 텍스트를 입력창으로. `turn_in_progress` → 서버 문구 토스트.
5. "답을 받지 못한 메시지" 줄 모양(muted 캡션 + 링크 버튼, 말풍선 아래 오른쪽 정렬) — design-system에 패턴 없음.
6. mock 다시 보내기의 메시지 수 셈(①도 +1).
7. 첫 저장이 행만 만들고 나머지가 실패한 경우(`error.created`)는 토스트 없음(저장 실패 상태), 다음 성공 저장도 행이 이미 있어 없음.

## 연결 대기 (백엔드 요청)
- DM v4.11 11.6 #11: 턴 라우트 `retryTarget`이 "마지막이 user, 뒤에 assistant 없음"을 받아야 한다 — 지금은 409 `nothing_to_retry`(화면은 위 4번으로 처리). 
- DM v4.11 11.6 #15: 대화 상세 DTO(`WritingChatMessageDto` / `services/writing-chat`)의 실패 AI 행에 작업 상태(`canceled`/`failed`)와 원인(`error_code`·`provider`·`retry_after`·`quota_resets_at`)이 필요하다. 받으면 `career-v45.ts` `messagesOf`가 `turn_job`을 채우면 된다(화면 쪽 나머지는 준비됨). 지금은 다시 연 실제 실패 턴이 C-20 대신 중립 줄로 보인다.
- 참고(변경 없음): 서버 `gateCode`가 `ai_consent_required`도 `key_missing`으로 보내 실행 전 C-18로 보인다(C-21이 아님). 기존 동작, 확인만 요청.

## 기획 확인 필요
- S-10·S-44 "답을 받지 못한 메시지" 줄의 시각 패턴(design-system) — ui-designer.
- 이번 방문에서 중지한 직후에도 줄을 보일지(명세는 "다시 열었을 때"만 씀).
- `nothing_to_retry` 거절 문구(명세 행 없음).

## 검증
- `pnpm typecheck` 통과, `pnpm lint` 통과(경고 0), `pnpm vitest run` 전체 141 파일 2336 테스트 통과(관련: career 6파일, quick-chips, writing-chat-turn-v45, mock-isolation).
- `pnpm build`·브라우저 확인: 안 함(브리프 — 브라우저 범위 밖).
