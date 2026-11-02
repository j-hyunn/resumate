# UI QA — 기획 v5.3 A2 커리어 (라운드 1)

> 2026-10-30. 범위: 브리프 `08_brief_v53.md` 2-1~2-5 (S-36 · S-08 · S-10 · C-09 `project_fields` → S-10 → C-10).
> 기준: `02-user-flows.md` v5.3 (FL-13 · FL-14 · S-08 · S-10 · S-36 · C-09 · C-20 A14), `04-data-model.md` v4.2 2.5, `design-system.md` v3 5.4 · 6장 A2, A2 보고 `11_frontend-engineer-A2_v53_report.md`, 파운데이션 QA `10_ui-qa_v53_foundation_review.md`의 A2 메모.
> 방법: 코드 정적 대조 + dev 서버(:3000) curl SSR 확인. **브라우저 클릭 흐름(동의 창 → 이어 보내기, 카운트다운, 그만두기 → S-08 펼침, 다시 이어 하기 포커스)은 코드 경로로만 확인했다.** 코드 수정 없음.

## 요약 — Critical 0 / Major 2 / Minor 12

- 기계 검사: `pnpm lint` 오류 0(경고 1, A3 파일) · `pnpm typecheck` 실패 3건 **모두 applications(A3 작업 중)**, career 0건 · build 생략(지시).
- 브리프 2-1~2-5의 화면 요소·문구는 모두 들어가 있다. 시작 인사(번호·카운트 제외, 무료 등급 문장 명세 그대로), ≤38 보내기 / 40 비활성, 보내기·빠른 응답·단계 버튼·"AI에게 물어봐 줘"의 동의 게이트, 서버 거부 시 메시지 미저장 + 입력 유지, 실패한 턴 "{N}초 뒤 다시 보낼 수 있어요" + "다시 보내기 (0:20)" + 활성 공급자 배지, 정리 결과 글자 수 경고, 그만두기 확인 문구(명세 그대로), S-08 "그만둔 대화 N개" 묶음, S-10 "그만둠" + 다시 이어 하기, `?focus=fields` 링·포커스·안내 문구가 맞다.
- **Major 2건은 모두 S-36의 예외 경로**: (1) 보내기·다시 보내기 요청이 AI 거부가 아닌 오류(다른 탭에서 그만둔 대화 등)로 실패하면 입력 글자가 지워진 채 "보내는 중"에서 멈춘다. (2) 그만둔(그리고 저장 완료) 대화의 읽기 전용 화면에서도 실패한 턴의 "다시 보내기"가 살아 있어, 다시 이어 하기 없이 AI 턴이 돈다.
- Minor는 A2 5건(배지 누락, 상한에서 "AI에게 물어봐 줘", S-10 안내의 첫 화면 문구·접근성, S-08 그만둔 뒤 포커스, 접근 이름), A0 7건(mock 데이터·픽스처·공통 문구).

## 화면별 점검표

| 화면 ID | Q1 | Q2 | Q3–4 | Q5 | Q6 | Q7 | Q8 | Q9 | Q10 | 메모 |
|---------|----|----|------|----|----|----|----|----|-----|------|
| S-36 AI 작성 대화 | ⚠️ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | ⚠️ | ✅ | UQ-480·481(Major), 482·483. `?state=` request-wait·ai-waiting·message-limit·consent-required·key-missing·key-invalid·ai-locked·ai-failed*·save-failed·loading·error·not-found 모두 200 |
| S-08 커리어 | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ⚠️ | ✅ | UQ-485·486. `/career` "그만둔 대화 1개", `?state=empty`면 묶음 없음 |
| S-10 프로젝트 편집 | ✅ | ⚠️ | ✅ | ✅ | ⚠️ | — | ✅ | ⚠️ | ✅ | UQ-484·486, 픽스처 부족 UQ-489 |
| C-09 `project_fields` → S-10 → C-10 | ✅ | ✅ | ✅ | ✅ | ⚠️ | — | ✅ | ✅ | ✅ | `routes.project(id, { focus: "fields", application_project_id })` + `markCareerReturn` → 자동 저장마다 `notifyCareerSaved()` → C-10 재판정. 픽스처로는 도착 상태 재현 불가(UQ-489) |

세부 대조 (✅ 항목 근거):

- **2-1 시작 인사** — `chat-screen.tsx:521-534`: 첫 메시지·`assistant`·`ai_job_id = null`이면 번호·출처 칩·강조·커서 없이 렌더. `message_count`는 0부터(`writing-chats.ts:115`), 픽스처 대화 1·3·4의 카운트가 인사 제외 값(5·1·3). 무료 등급 문장 = 명세 S-36 "시작 인사" 문장 그대로, 모양 = design-system 5.4 (v3). 연결 정보는 클라이언트에서 읽혀 SSR에는 없고 하이드레이션 뒤 보인다(정상).
- **2-1 상한** — `writing-chat-limits.ts:15-17` `count + 2 ≤ 40` = "≤ 38". `chat-screen.tsx:153,465,621,649,664` 입력·단계·빠른 응답·보내기 비활성, `:670-676` G-2 자리 문구, `:572-594` 40에서 상한 Alert(명세 문구 그대로, 버튼 3종), `:679` 36 이상 경고색. `?state=message-limit` SSR에서 `40 / 40`·문구·`disabled` 확인. 서버 `appendWritingChatMessage`도 같은 판정.
- **2-3 동의 게이트** — `send()`(`:226-237`)가 `consent.guard` 뒤에서 `doSend`. 단계 버튼(`:472`)·빠른 응답(`:621`)·"AI에게 물어봐 줘"(`:727-731`) 모두 `send` 경유. 실패한 턴 "다시 보내기"는 `AiErrorNotice` 내부 게이트(`ai-error-notice.tsx:420`), 취소·원인 불명 줄은 `onGuardedRetry`(`:502`). `?state=consent-required` SSR 배지 "동의 필요" 확인.
- **2-3 전송이 막힐 때** — `doSend`(`:239-250`): `isAiRejected`면 목록에 추가하지 않고 `setInput(text)` 복구, `onRefused`(`:209-224`)가 `key_missing`이면 연결을 다시 읽어 동의 원인 → C-21 → 같은 글자 재전송, 아니면 `Textarea` 위 C-20 inline(`:627-635`). `key_invalid`는 클라이언트 판정(`:231-234`)도 같은 자리.
- **2-3 실패한 턴** — `FailedTurn`(`:902-919`) `requestPath retryLabel="다시 보내기"` → 제목 "요청이 몰려 잠시 쉬어야 해요." + "{N}초 뒤 다시 보낼 수 있어요"(`ai-error-notice.tsx:459-462`) + `RetryButton` 카운트다운 + `ProviderBadge`(활성 공급자). 입력 원인은 다시 시도 없음 + "고친 뒤 보내기로 새로 실행해 주세요". 실패 턴은 `message_count`를 늘리지 않음(`writing-chats.ts` `completeMockAssistantTurn`).
- **2-3 입력 길이** — `draft-preview.tsx:40,132-133,202,206,311-337`: 이름·역할 100 / 지표 200 / 단위 50, C-07 `CharCount`, 초과 문구 + [적용] 비활성(가정), AI 값 초과 시 표시 상태에서도 글자 수.
- **2-2 그만두기** — `abandon.tsx:51-53` 명세 문구 그대로(미연결이면 "(마지막 활동 후 90일 뒤 자동 삭제)"), 확인 버튼 default "그만두기"(G-37), 머리 `⋯` "대화 그만두기"(active만) · 구분선 · "대화 삭제"(`chat-screen.tsx:422-443`) = design-system 5.4. 확인 → `router.push(/career)`, S-08 묶음 펼침 + 행 flash(`writing-chat-list.tsx:48-57`).
- **2-2 그만둔 대화 열기** — `chat-screen.tsx:686-701` sticky 막대 "그만둔 대화예요" + "다시 이어 하기"(배지 없음, 키 없이 활성), 미리보기 `readOnly`, 진행 단계·배지 숨김. 다시 이어 하기 → `resumeWritingChatAction`(AI 호출 없음) → `loadChatView` → `Textarea` 포커스(`:286-294`). SSR `/career/writing-chats/{대화 4}` 확인.
- **2-4 S-08** — `writing-chat-list.tsx`: 작성 중 행 `⋯` "대화 그만두기" · 구분선 · "대화 삭제"(C-05), 묶음 `Collapsible` 기본 접힘 + `ChevronRight rotate-90` + "그만둔 대화 N개"(`tabular-nums`), 0개면 없음, 행 = `PauseCircle` + 대상 + 마지막 활동 · `n/40` + 미연결이면 "N일 뒤 자동 삭제" `Badge warning` + "다시 이어 하기" outline sm + `⋯` "대화 삭제". design-system 6장 A2 (v3)와 같음.
- **2-5 S-10** — `project-form.tsx:397-423` `abandoned` = `PauseCircle` + `Badge outline text-muted-foreground` "그만둠"(`labels.ts:199`) + "다시 이어 하기". `?focus=fields`: `:126-151,187-194,235,244` 빈 칸 링(`ring-2 ring-primary ring-offset-2`)·첫 빈 칸 포커스·flash, 안내 `Alert info` "이름과 역할을 채우면 {기능}에 바로 쓸 수 있어요", `aria-invalid` 안 씀 = design-system 6장 A2.
- **Q3–4** — `WritingChatStatus` 4값, `WRITING_CHAT_STATUS_LABELS` `Record` 타입으로 누락 불가. 새 필드 없음.
- **Q8** — A2 파일 원색·팔레트 클래스 0건(`grep`), 토큰(`bg-warning-subtle`, `text-warning-subtle-foreground`, `ring-primary`)만.
- **Q10** — S-36 1280 미만 탭, 그만둔 막대는 "대화" 탭 안 `flex-wrap`. S-08 행 `flex-wrap`, `⋯` 모바일 `size-11`. S-10 링은 폭과 무관.

## 이슈

| ID | 심각도 | 담당 | 화면 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|----|--------|------|------|-----------|-----------|------|------|
| UQ-480 | Major | A2 | S-36 | 02 S-36 "전송이 막힐 때"(사용자 메시지는 저장하지 않고 입력창 내용을 그대로) · FL-14 A6(S-08에서도 그만두기 가능) | `src/components/career/writing-chat/chat-screen.tsx:239-264`(`doSend`), `:267-284`(`retry`), `:187-195`(`finishTurn`) | 요청이 AI 거부(`{ rejected }`)가 아닌 오류로 끝나도 보내는 중 상태가 풀리고, 입력 글자(세션 초안 포함)가 남고, 오류 한 줄이 보인다 | `doSend`가 `setInput("")`(세션 초안도 삭제) 뒤 `await sendWritingChatMessageAction` — `try/catch` 없음. 서버가 `Error("chat not active")`(다른 탭/S-08에서 그만둔 대화), `Error("message limit")`(다른 탭에서 상한 도달), 네트워크 오류를 던지면 `sending`이 `true`로 남아 입력·보내기·메뉴가 계속 비활성이고 쓴 답이 사라진다. `retry`·`finishTurn`도 같음. v5.3에서 S-08 "대화 그만두기"가 생겨 재현이 쉬워짐 |
| UQ-481 | Major | A2 | S-36 | 02 S-36 상태 "그만둔 대화 재개"(사용자가 "다시 이어 하기"를 누르면 `active`) · FL-14 A6 · design-system 5.4 (v3) "그만둔 대화 열기 … 읽기 전용" | `chat-screen.tsx:387`(`showFailed`에 `active` 조건 없음), `:489-504`, `:267-284`(`retry`에 `active` 검사 없음) | 그만둔·저장 완료·폼 전환 대화(읽기 전용)에서는 실패한 턴 자리에 동작 버튼이 없다(또는 원인만 표시). AI 턴은 다시 이어 하기 뒤에만 | 마지막 AI 메시지가 `failed`인 채로 그만둔 대화를 열면 C-20 + "다시 보내기"(활성 공급자 배지 포함)가 그대로 나오고, 누르면 `retryWritingChatTurnAction`이 상태 확인 없이 턴을 돌려 `abandoned` 대화에 AI 메시지가 붙는다(사용량도 기록). 재현: 턴 실패 → 메뉴 "대화 그만두기" → 다시 열기. 서버 쪽 막기는 UQ-488 |
| UQ-482 | Minor | A2 | S-36 | 02 C-20 "다시 시도의 공급자"(모든 재실행 버튼 옆 C-19 배지 = 활성 공급자) · 브리프 F3 | `chat-screen.tsx:890-901`(`kind === null` → `AiFailedInline`, `canceled` → 링크만) | 중단한 턴·원인 불명 턴의 "다시 보내기" 옆에도 활성 공급자 C-19 배지 | 두 갈래에는 배지가 없음(`AiErrorNotice` 갈래에만 있음). 다시 보내기는 공급자 토큰을 쓰는 재실행 |
| UQ-483 | Minor | A2 | S-36 | 02 S-36 입력창(40에 닿으면 입력 비활성) · 자리 표시("AI에게 물어봐 줘", 메시지 상한에 포함) | `src/components/career/writing-chat/draft-preview.tsx:349-354`, `chat-screen.tsx:727-731`, `:228` | 상한(39·40)·응답 중에는 "AI에게 물어봐 줘"도 단계 버튼·빠른 응답처럼 비활성 | 링크가 항상 활성이고, 누르면 탭만 "대화"로 바뀌고 `send()`가 조용히 반환(아무 일 없음) |
| UQ-484 | Minor | A2 | S-10 | 02 S-10 상태 "C-09 `project_fields`에서 열면 … 포커스·강조 + '이름과 역할을 채우면 {기능}에 바로 쓸 수 있어요'" · design-system 7장(라벨·설명 연결) | `src/components/career/project-form.tsx:129,137-142`(기능 이름을 effect에서 읽음), `:187-193`(안내), `:230-247`(입력에 설명 연결 없음) | 첫 화면부터 실제 기능 이름, 포커스가 들어간 입력이 안내 문장을 읽어 줌 | SSR·첫 그림은 "AI 기능에 바로 쓸 수 있어요"였다가 effect 뒤 "인사이트에…" 등으로 바뀜(문구 깜빡임). 포커스는 이름 칸으로 바로 가지만 안내 Alert와 `aria-describedby`로 묶이지 않아 화면 낭독기 사용자는 왜 여기로 왔는지 듣지 못함 |
| UQ-485 | Minor | A2 | S-08 | design-system 6장 A2 (v3) 그만둔 뒤 행 강조 · 7장 접근성(대화 상자 닫힌 뒤 포커스 복귀, 상태 변화 알림) | `src/components/career/writing-chat-list.tsx:154`, `src/components/career/writing-chat/abandon.tsx:67-80` | 그만두기 확인 뒤 포커스가 의미 있는 곳(펼친 묶음의 그 행 "다시 이어 하기" 또는 묶음 트리거)으로 가고, "대화를 그만뒀어요" 같은 알림이 한 번 나감 | 행이 작성 중 목록에서 사라져 메뉴 트리거가 없어지므로 포커스가 `body`로 떨어짐. 강조는 `animate-field-flash` 시각 효과뿐이고 알림 없음 |
| UQ-486 | Minor | A2 | S-08 · S-10 | design-system 7장(아이콘 버튼·영역의 접근 이름) | `writing-chat-list.tsx:120`(`Card aria-label="그만둔 대화"`, role 없음), `project-form.tsx:426`(모든 행 `aria-label="대화 메뉴"`) | 이름이 읽히는 영역, 행마다 구분되는 메뉴 이름(S-08처럼 "'{대상}' 대화 메뉴") | role 없는 `div`의 `aria-label`은 무시됨. S-10 대화 기록 행 메뉴가 모두 같은 이름 |
| UQ-487 | Minor | A0 | S-08 · S-36 | 04 2.5 상태 전이 표(`active → abandoned` 사용자, 부수효과 없음 / 재개만 `last_activity_at = now()` [가정]), 5장 권한(`last_activity_at`은 definer RPC만) | `src/lib/data/writing-chats.ts:508-512` | 그만두기는 `status`만 바꿈 → S-08 "마지막 활동"·"N일 뒤 자동 삭제"는 그대로 | mock이 그만둘 때 `last_activity_at = now`로 갱신 → 그만두기만으로 90일 기준이 다시 시작되고 "방금"으로 보임 |
| UQ-488 | Minor | A0 | S-36 | 04 2.5 상태 전이(`abandoned`·`saved`·`handed_off` 대화에 턴 없음) | `writing-chats.ts:559-563`(`retryWritingChatTurn`), `:179-`(`completeMockAssistantTurn`, 상태 검사 없음) | 활성 아닌 대화의 다시 보내기·턴 완료는 거부(실제 백엔드처럼) | 상태 검사 없이 계획된 턴을 돌려 메시지를 붙임. UQ-481의 서버 쪽 방어선 |
| UQ-489 | Minor | A0 | S-10 · C-09 | 02 S-10 상태(C-09 `project_fields` 도착), S-10 대화 기록 `abandoned` 행 · ui-context "?state= 로 모든 상태 확인" | `src/lib/data/readiness.ts:12,123`(`suggested_project_id` = `prj(6)`), `src/lib/mock/fixtures.ts:267-278`(이름·역할 채워짐), `:531-560`(그만둔 대화는 `project_id = null`뿐) | `?state=insufficient-project-fields` → "마저 채우기" → S-10에서 링·포커스·안내가 보이는 픽스처, 프로젝트에 묶인 그만둔 대화 1건 | C-09는 "'오픈소스 결제 SDK 기여'에 이름이나 역할이 비어 있어요"라고 하는데 그 프로젝트는 둘 다 채워져 있어 S-10 도착 화면이 평소와 같음. S-10 "그만둠" 행을 볼 데이터가 없음(2-5 두 항목 모두 눈으로 확인 불가) |
| UQ-490 | Minor | A0 | S-36 | 02 C-20 A14("{N}초 뒤 다시 보낼 수 있어요", `retry_after` 기준) | `src/lib/mock/ai-stream.ts:49-56`(스트림 오류 기본 20초), `src/lib/data/ai-errors.ts:73`(작업 행 150초), `writing-chats.ts` `completeMockAssistantTurn`(스트림 값을 저장하지 않음) | 실패 직후와 새로고침 뒤 같은 `retry_after` | 실패 직후 "20초 뒤", 새로고침하면 같은 턴이 "2분 30초 뒤". A2 보고 파운데이션 요청 2 |
| UQ-491 | Minor | A0 | S-36 | 02 S-36 "시작 인사"(서버가 넣는 **고정 문구**, 모드별 2종) | `fixtures.ts:591`(대화 3 인사 "'오픈소스 결제 SDK 기여' 프로젝트에…") vs `writing-chats.ts:37-40`(`GREETING.augment_project`) | 픽스처 인사 = 새 대화가 넣는 고정 문구 | 보강 대화 픽스처만 프로젝트명이 들어간 다른 문장 → 고정 문구 여부를 화면에서 확인할 수 없음 |
| UQ-492 | Minor | A0 | S-36 (C-20 공통) | 02 C-20 공통("다시 시도 버튼 아래 작은 글씨로 '다시 시도하면 토큰을 다시 써요'"), S-36 실패한 턴("다시 보내기") | `src/components/common/ai-error-notice.tsx:328,705,731` | 버튼 이름을 따른 안내("다시 보내면 토큰을 다시 써요") 또는 명세 확인 | "다시 보내기 (0:20)" 바로 아래에 "다시 시도하면 토큰을 다시 써요" — 버튼과 안내의 동사가 다름(`retryLabel`을 쓰지 않음). S-22 "다시 채점"도 같은 모양 |
| UQ-493 | Minor | A0 | S-36 | 02 S-36 "전송이 막힐 때"(키 없음·동의 필요 `key_missing`), C-20 경로 ④ · ui-context "?state= 미리보기" | `src/lib/mock/fixtures.ts:110-117`(`MockControls`에 경로 ④ 거부 강제 없음), `src/lib/mock/ai.ts:144-151` | 서버가 보내기를 `key_missing`(동의 원인 포함)으로 거부하는 화면을 `?state=`나 mock 제어로 재현 | `?state=consent-required`는 보내기 **전** 게이트만, `?state=key-invalid`는 클라이언트 판정만 보여 줌. 서버 거부 → 연결 다시 읽기 → C-21/C-20 경로(`onRefused`)는 실제 mock DB 동의 상태를 바꿔야만 볼 수 있음 |

## 기획 확인 필요

| 화면 ID | 내용 | 양쪽 인용 |
|---------|------|-----------|
| S-36 | **메시지 39(마지막 답 실패)일 때 입력창 안내**. 구현은 39에서 입력을 막고 G-2 자리에 40 문구를 보임(실제 길은 실패한 턴의 "다시 보내기") | 02 S-36 입력창 "40에 닿으면 입력 비활성 + '저장하거나 폼으로 옮겨 이어서 써 주세요'" ↔ design-system 5.4 "39는 AI 응답 중이라 응답 중 규칙대로 비활성" — 39가 실패로 끝난 경우가 둘 다 없음 (A2 보고 4절과 같음) |
| S-36 | **전송 차단 `key_missing`의 문구**. "C-20 해당 행"을 그대로 쓰면 "키가 삭제되어 작업을 끝냈어요. 입력은 저장돼 있어요" — 보내기는 시작되지 않았고 메시지는 저장되지 않음(입력창에만 남음) | 02 S-36 "전송이 막힐 때 … 사용자 메시지는 **저장하지 않고** … + C-20 해당 행" ↔ 02 C-20 `key_missing` 행 "키가 삭제되어 작업을 끝냈어요. 입력은 저장돼 있어요". 실제로는 활성 공급자가 없으면 C-18 잠금이 먼저 보여 드물게만 나옴 |
| S-36 | 시작 인사의 무료 등급 문장 판단 시점(시작 때 등급 vs 지금 등급), 읽기 전용 대화(저장·그만둔 대화)에도 보일지 | 02 S-36 "활성 키가 무료 등급이면 한 줄을 덧붙인다" — 서버가 넣는 고정 메시지인데 등급이 행에 없음 (A2 보고 4절) |
| S-36 | 대화 시작에도 C-21 동의를 받는지(구현: 시작 버튼 + 턴 둘 다 게이트). 파운데이션 QA 10 "기획 확인"과 같은 항목 | 02 C-18 R-67 목록 "AI 작성 대화 턴" ↔ "실행 버튼 공통 규칙"의 "AI 작성 대화 시작" |
| S-36 | 정리 결과 입력 길이 초과 시 "경고"만인지, [적용]까지 막는지(구현: 막음) | 02 S-36 "입력 길이 … 넘으면 직접 수정 칸에서 글자 수 경고" |
| S-36 | 그만둔 대화 픽스처(대화 4)처럼 마지막 메시지가 답 없는 사용자 메시지인 채로 재개되면, AI 질문 없이 입력창만 돌아옴 — 재개 직후 안내가 필요한지 | 02 S-36 상태 "그만둔 대화 재개 … 위 이어 하기와 같이 복원" — 미응답 사용자 메시지 처리 없음 |

## 재확인 결과

| ID | 결과 | 메모 |
|----|------|------|
| UQ-408 (A0, 파운데이션 QA 10) | A2 쪽 해결 / A0 쪽 미해결 | S-36은 `rateWaitSeconds`·`turn.waitSec`·"한도로 잠시 기다리는 중" 줄을 모두 지움, `?state=ai-waiting` = `request-wait` 별칭(`chat-screen.tsx:81`). `lib/mock/ai-stream.ts:77-83,134,174,239,249`·`common/streaming.tsx:83,99,172`의 `rate_wait` 경로는 아직 남음 → A0가 지울 수 있음 |
| 파운데이션 QA 10 A2 메모(S-36 보내기·다시 보내기 동의 게이트 없음, 실패 턴 `requestPath` 없음) | 해결 | 위 "2-3 동의 게이트"·"2-3 실패한 턴" 근거 |
| 이전 A2 사이클(03·06·07) 열린 이슈 | 없음 | 07 통합 리뷰의 미해결은 UQ-240/354(ui-designer)뿐 |

## 기계 검사 출력

- `pnpm lint` — 종료 0. 경고 1: `src/components/applications/insight-view.tsx:46:33 'plain' is defined but never used` → **A3** 소유.
- `pnpm typecheck` — 종료 2. 오류 3건, 모두 A3 작업 중 파일(career 0건):
  - `src/app/(dashboard)/applications/[id]/insight/page.tsx(90,8)` TS2741 `lateFailure` 누락 (`InsightViewProps`) → A3
  - `src/components/applications/drafts-view.tsx(212,59)` TS2339 `project_ids`가 `RankDraftSourcesResult`(`AiRejected` 갈래)에 없음 → A3
  - `src/components/applications/drafts-view.tsx(212,76)` TS7006 `i` 암시적 any → A3
- `pnpm build` — 지시대로 생략.
- dev 서버(:3000) curl, 모두 HTTP 200: `/career`(+`?state=` empty·loading·error), `/career/writing-chats/{대화 1}`(+`?state=` request-wait·ai-waiting·message-limit·consent-required·key-missing·key-invalid·ai-locked·ai-failed·ai-failed-input·save-failed·loading·error·not-found), `/career/writing-chats/{대화 4}`(그만둔 대화: "그만둔 대화예요"·"다시 이어 하기", 사용자 번호 #1·#2만), `/career/projects/{프로젝트 4}`(± `?focus=fields&application_project_id=`). 확인 문구: "그만둔 대화 1개", "N일 뒤 자동 삭제", "작성 중인 AI 대화", message-limit의 `40 / 40`·상한 Alert·"저장하거나 폼으로 옮겨 이어서 써 주세요"·`Textarea disabled`, consent-required의 배지 "Gemini · 무료 등급 · 동의 필요", ai-locked의 C-18 인라인.
