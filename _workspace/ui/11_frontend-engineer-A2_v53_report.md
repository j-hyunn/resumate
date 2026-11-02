# A2 커리어 구현 보고 — 기획 v5.3 (브리프 2-1 ~ 2-5)

> 2026-10-30. 기준: 플로우 v5.3(FL-13·FL-14·S-08·S-10·S-36·C-09·C-20 A14·5.1c) · design-system v3 `(v3)` 문단(5.4, 6장 A2, 3.8) · A0 보고 09(+QA 1차 수정) · 파운데이션 QA 10의 A2 메모. mock 데이터 계층만, 커밋 없음, 기획 문서 수정 없음.
> 검사: `pnpm lint` 통과(경고 0) · `pnpm typecheck` 통과. build는 지시대로 생략. dev 서버(:3000) SSR 200 확인(아래 7절). **브라우저 클릭 흐름(동의 창 → 보내기 이어짐, 카운트다운, 그만두기 → S-08 펼침·강조, 다시 이어 하기 → 입력창 복귀·포커스)은 눈으로 보지 않았다.**

## 1. 완료 화면

| 화면 ID | 라우트 | 지원 ?state= | 비고 |
|---------|--------|--------------|------|
| S-36 | `/career/writing-chats/[id]` | 기존(loading·error·not-found·ai-failed*·save-failed·message-limit·ai-locked·key-invalid·key-check·key-missing) + **`request-wait`**, **`consent-required`**, `ai-waiting`(= `request-wait` 별칭) | 그만둔 대화는 픽스처 대화 4(`00000000-0000-4c01-8000-000000000004`) |
| S-08 | `/career` | empty · loading · error · unauth · not-found | "그만둔 대화 1개"(픽스처 대화 4) |
| S-10 | `/career/projects/[id]` | 기존 + 쿼리 `?focus=fields&application_project_id=` | C-09 `project_fields` 도착 |

## 2. 화면별 변경

### S-36 AI 작성 대화 (`components/career/writing-chat/chat-screen.tsx`, `draft-preview.tsx`, 신설 `abandon.tsx`)
- **2-1 시작 인사**: 첫 메시지(`assistant`, `ai_job_id = null`)를 시작 인사로 그림 — 번호·출처 칩·클릭 강조·스트리밍 커서 없음, `n / 40`에 영향 없음(`message_count`는 A0가 인사 제외로 이미 0부터). 활성 연결이 무료 등급이면 본문 아래 경고 상자(`bg-warning-subtle` + `TriangleAlert`) "무료 등급에서는 입력한 내용이 {공급자} 제품 개선에 쓰이고 사람이 검토할 수 있어요. 민감정보·회사 기밀은 쓰지 마세요".
- **2-1 상한**: 보내기는 `message_count ≤ 38`일 때만(`canSendWritingChatMessage`). 39·40은 `Textarea`·보내기·빠른 응답·진행 단계 버튼 비활성, G-2 자리 "저장하거나 폼으로 옮겨 이어서 써 주세요". 40이면 마지막 AI 메시지 아래 `Alert info` 상한 문구 + [저장] default · [폼으로 전환] outline · [새 보강 대화] outline(입력 영역의 예전 경고 상자 대체). 카운터 36 이상 경고색.
- **2-3 동의 게이트**: 보내기·빠른 응답·"이 부분부터 다시 물어봐 줘"·"AI에게 물어봐 줘" 모두 `useAiConsentGate().guard` → `consent_required`면 요청 전에 C-21, 동의하면 그 글자를 그대로 보냄. 실패한 턴 "다시 보내기"는 `AiErrorNotice`가 게이트(취소·원인 불명 줄은 직접 게이트).
- **2-3 전송이 막힐 때**: 서버 거부(`key_missing`/`key_invalid`)면 메시지를 목록에 넣지 않고 입력창 글자 유지. `key_missing`이면 `getAiConnectionStateAction`으로 다시 읽어 동의 원인이면 C-20 대신 **C-21을 바로 열고 동의 뒤 같은 글자 재전송**, 아니면 `Textarea` 바로 위 C-20 inline("AI 연결하기"/"키 교체"). 안내는 **다음 전송까지 남음**(입력 중에 지우던 동작 제거).
- **2-3 실패한 턴**: `AiErrorNotice requestPath retryLabel="다시 보내기"` → "{N}초 뒤 다시 보낼 수 있어요" + 카운트다운, 활성 공급자 배지. `retry_after`는 방금 실패한 턴이면 스트림 오류 이벤트 값, 새로고침 뒤에는 턴의 `ai_jobs` 값.
- **UQ-408**: `rateWaitSeconds`·`turn.waitSec`·"공급자 요청 한도로 잠시 기다리는 중" 줄을 S-36에서 모두 제거. `?state=ai-waiting`은 `request-wait`과 같은 값(바로 `rate_limited` 실패)으로 처리 → **A0가 mock `rateWaitSeconds` / `useChatTurnStream().waitSec` / `rate_wait` 이벤트를 지워도 됨**(A2 쪽 사용처 0).
- **2-3 입력 길이**: 정리 결과 직접 수정 칸에 C-07 글자 수(`CharCount`, 90% 경고색·초과 destructive) — 이름·역할 100자, 지표 이름 200자, 단위 50자. 초과면 "{N}자 이내로 줄여 주세요" + [적용] 비활성. AI 값이 상한을 넘으면 표시 상태에서도 글자 수 경고.
- **2-2 대화 그만두기**: 머리 `⋯`(aria-label "대화 메뉴") = "대화 그만두기"(`PauseCircle`, active만) · 구분선 · "대화 삭제". 확인 `AlertDialog` 명세 문구(프로젝트 미연결이면 "(마지막 활동 후 90일 뒤 자동 삭제)" 덧붙임), 확인 버튼 default "그만두기" → `abandonWritingChatAction` → S-08.
- **2-2 그만둔 대화 열기**: 대화·정리 결과 읽기 전용, 입력창 자리에 sticky 막대 `PauseCircle` "그만둔 대화예요" + `Button sm` "다시 이어 하기"(C-19 배지 없음, 키 없이 활성). 누르면 로딩 → `resumeWritingChatAction`(AI 호출 없음) → `active` 뷰로 바뀌고 `Textarea` 포커스. 예전 상단 "그만둔 대화예요 / 대화 기록만 볼 수 있어요" 카드는 제거.

### S-08 커리어 (`career-tree.tsx`, 신설 `writing-chat-list.tsx`, `app/(dashboard)/career/page.tsx`)
- 작성 중 대화 행 `⋯` = "대화 그만두기"(`PauseCircle`, 확인 창 공용) · 구분선 · "대화 삭제"(C-05). 그만두면 `router.refresh()`.
- **그만둔 대화 묶음**: 작성 중 대화 아래(없으면 그 자리) `Collapsible` 기본 접힘, 트리거 ghost sm `ChevronRight`(+`rotate-90`) "그만둔 대화 N개". 0개면 없음. 행 = `PauseCircle` + 대상 + 마지막 활동 · `n/40` + 미연결이면 "N일 뒤 자동 삭제" `Badge warning` + "다시 이어 하기" outline sm(→ `active` → S-36) + `⋯` "대화 삭제"(C-05).
- 그만둔 직후(S-08 메뉴 또는 S-36) 묶음을 펼치고 그 행에 `animate-field-flash` 한 번(세션 저장소에 대화 id만).
- 페이지가 `listAbandonedWritingChats()`를 함께 읽음. `?state=empty`면 비움.
- 커리어 항목이 하나도 없을 때(빈 상태)도 대화 목록·묶음을 빈 상태 아래에 보임(예전엔 작성 중 대화도 숨겨졌음).

### S-10 프로젝트 편집 (`project-form.tsx`, `form-parts.tsx`, `app/(dashboard)/career/projects/[id]/page.tsx`)
- **2-5 대화 기록**: `abandoned` 행 = `PauseCircle` + `Badge outline text-muted-foreground` "그만둠" + "다시 이어 하기" outline sm(배지 없음) → S-36. active "이어서", saved·handed_off "열기"(읽기 전용) 그대로.
- **2-5 `?focus=fields`**: 비어 있는 이름·역할 입력에 `ring-2 ring-primary ring-offset-2 ring-offset-background`, 값이 들어가면 그 칸만 해제. 첫 빈 칸 포커스 + `animate-field-flash` 한 번. 기본 정보 카드 맨 위 `Alert info` 작은 형 "이름과 역할을 채우면 {기능}에 바로 쓸 수 있어요"({기능} = C-09가 기억한 복귀 대상의 기능 이름). 오류 표시(`aria-invalid`) 안 씀. `TextField`에 `inputClassName` prop 추가(영역 파일).
- **C-09 → S-10 → 복귀**: C-09(`data-gate.tsx`)가 `routes.project(id, { focus: "fields", application_project_id })` + `markCareerReturn` → S-10 도착(SSR 200 확인) → 자동 저장마다 `notifyCareerSaved()`(form-parts) → C-10 배너(`/career*` 셸 슬롯) 재판정 → "{기능}으로 돌아가기". 코드 경로로 확인, 클릭 흐름은 미확인.

## 3. [UI-가정]

| 화면 ID | 파일:줄 | 내용 |
|---------|---------|------|
| S-36 | `writing-chat/chat-screen.tsx` (시작 인사 렌더) | 무료 등급 문장은 **지금 활성 연결의 등급**으로 판단(인사 행에 등급 없음). 문구 확정은 D-10 |
| S-36 | `writing-chat/chat-screen.tsx` `onRefused` | 서버 `key_missing` 뒤 연결을 다시 읽어 동의 원인이면 C-21을 바로 열고 같은 글자 재전송 |
| S-36 | `writing-chat/chat-screen.tsx` 입력 영역 | 전송 차단 안내는 다음 전송까지 남음(G-37) |
| S-36 | `writing-chat/chat-screen.tsx` 그만둔 막대 | "그만둔 대화예요"(P-12/G-37), 다시 이어 하면 같은 화면에서 입력창 복귀 |
| S-36 | `writing-chat/draft-preview.tsx` `FIELD_CHAR_LIMITS` | 상한 값(100/100/200/50)을 화면 상수로 둠. 초과 시 [적용] 비활성(명세는 "경고") |
| S-36 | `writing-chat/chat-screen.tsx` 상한 Alert | [새 보강 대화]는 프로젝트가 정해진 대화에서만(기존 가정 유지) |
| S-36 | `writing-chat/chat-start.tsx` | "대화 시작"은 `AiRunButton`이라 `consent_required`면 시작 때 C-21이 열림(A0 가정 "첫 턴에서 동의"보다 앞섬, 아래 기획 확인) |
| S-08/S-36 | `writing-chat/abandon.tsx` | 확인 버튼 "그만두기"(default), 그만둔 뒤 S-08 묶음 펼침·행 강조(G-37), 다시 이어 하기 경합 시 토스트 "이 대화는 다시 이어 할 수 없어요" |
| S-08 | `writing-chat-list.tsx` | 묶음 이름 "그만둔 대화 N개"(명세 `[가정]`), 빈 상태에서도 대화 목록 표시 |
| S-10 | `project-form.tsx` (`focusFields`) | 안내 Alert는 이름·역할 중 하나라도 비어 있는 동안만. 복귀 대상이 없으면(새 탭 등) {기능} = "AI 기능" |

## 4. 기획 확인 필요

| 화면 ID | 질문 | 스펙 위치 |
|---------|------|-----------|
| S-36 | 시작 인사 무료 등급 문장의 판단 시점 — 대화 시작 때 등급(서버가 인사에 넣음) vs 지금 등급. 현재 구현은 지금 등급 | 02 S-36 "시작 인사" |
| S-36 | 대화 시작에도 동의(C-21)를 받는지 — 실행 버튼 공통 규칙엔 "AI 작성 대화 시작"이 있고 R-67 목록엔 "턴"만 있음. 현재: 시작 버튼(AiRunButton)과 턴 둘 다 게이트 | 02 C-18 R-67, "실행 버튼 공통 규칙" |
| S-36 | 정리 결과 입력 길이 초과 시 "경고"만인지 적용 차단인지 | 02 S-36 "입력 길이" |
| S-36 | 39(마지막 답 실패 상태)에서 입력 비활성 + "다시 보내기"만 가능 — 이때 G-2 자리 문구 | 02 S-36 입력창 |

## 5. 파운데이션 요청

1. **UQ-408 정리 가능**: A2는 `rateWaitSeconds`·`waitSec`·`rate_wait`를 더 이상 쓰지 않음 → `lib/mock/ai-stream.ts`, `common/streaming.tsx`에서 제거해도 됨. `?state=ai-waiting`을 `PREVIEW_STATES`에서 빼려면 S-36의 별칭 줄(`chat-screen.tsx` `failCategory`)도 같이 지우면 됨.
2. `completeWritingChatTurnAction`/`completeMockAssistantTurn`이 스트림 오류의 `retry_after`를 받아 턴 `ai_jobs`에 저장하게 해 주세요. 지금은 실시간 실패(스트림 기본 20초)와 새로고침 뒤(`failureTimestamps` 150초)의 카운트다운이 다름.
3. 정리 결과 필드 길이 상한(이름·역할 100, 지표명 200, 단위 50)을 `lib/data/writing-chat-limits.ts`에 상수로 내보내 주세요(지금은 `draft-preview.tsx` 로컬 상수).
4. (선택) 시작 인사 행에 시작 당시 등급을 남기거나(`connection_tier`) 서버가 무료 등급 문장을 인사 본문에 붙이면 화면 가정(지금 등급)을 없앨 수 있음.

## 6. 바꾼 파일

- `src/components/career/writing-chat/chat-screen.tsx` (수정)
- `src/components/career/writing-chat/draft-preview.tsx` (수정)
- `src/components/career/writing-chat/abandon.tsx` (신설: 그만두기 확인 창, 다시 이어 하기 훅, S-08 강조 표식)
- `src/components/career/writing-chat-list.tsx` (신설: S-08 작성 중·그만둔 대화)
- `src/components/career/career-tree.tsx` (수정: 대화 섹션을 위 컴포넌트로 교체, 빈 상태에도 표시)
- `src/components/career/project-form.tsx`, `src/components/career/form-parts.tsx` (수정)
- `src/app/(dashboard)/career/page.tsx`, `.../projects/[id]/page.tsx`, `.../writing-chats/[id]/page.tsx` (수정)

파운데이션·다른 영역 파일은 수정하지 않음.

## 7. 검사 결과

- `pnpm typecheck` → `tsc --noEmit` 종료 코드 0.
- `pnpm lint` → `eslint` 종료 코드 0, 경고 0.
- `pnpm build` → 지시대로 생략.
- SSR(dev :3000): `/career` 200("그만둔 대화 1"), `/career/writing-chats/{대화 4}` 200("그만둔 대화예요", "다시 이어 하기"), `/career/writing-chats/{대화 1}?state=` request-wait · ai-waiting · message-limit · consent-required · key-missing 모두 200, message-limit에서 상한 문구·"저장하거나 폼으로 옮겨 이어서 써 주세요" 확인, 시작 인사 렌더 확인. `/career/projects/{프로젝트 4}?focus=fields` 200.

## QA 1차 수정 (`12_ui-qa_v53_A2_review.md` 대응)

| ID | 수정 | 파일 |
|----|------|------|
| UQ-480 (Major) | `doSend`·`retry`·`finishTurn`에 try/catch. 거부가 아닌 오류(대화가 다른 곳에서 그만둬짐, 다른 탭에서 상한 도달, 네트워크)면 `recoverFromError()`: 보내는 중·정리 중 상태 해제 → 입력 글자(세션 초안 포함) 되돌림 → 대화를 다시 읽어 화면 갱신(그만둔 막대·상한 상태가 보임) → 입력창 위 오류 한 줄 "보내지 못했어요. 입력한 내용은 그대로 있어요. 잠시 후 다시 시도해 주세요"(`role="alert"`, 다음 전송 때 지움) | `writing-chat/chat-screen.tsx` |
| UQ-481 (Major) | 읽기 전용 대화(abandoned·saved·handed_off)의 실패한 턴은 동작 없이 "답을 받지 못한 턴이에요" 한 줄만. `retry()`는 `active`가 아니면 아무것도 안 함. 서버 쪽 방어(UQ-488)는 A0 몫 | `writing-chat/chat-screen.tsx` |
| UQ-482 | 중단한 턴·원인 불명 턴의 "다시 보내기" 옆에도 C-19 배지(활성 공급자). 두 갈래를 한 줄 구성으로 합침(`AiFailedInline` 사용 안 함) | `writing-chat/chat-screen.tsx` |
| UQ-483 | "AI에게 물어봐 줘"가 응답 중·상한(39·40)·보내는 중에는 비활성(`PreviewHandlers.askDisabled`) | `writing-chat/draft-preview.tsx`, `chat-screen.tsx` |
| UQ-484 | S-10 안내는 복귀 대상을 읽은 뒤에만 그림(첫 그림부터 실제 기능 이름, "AI 기능" 깜빡임 없음). 안내에 `id="prj-fields-note"`, 이름·역할 입력의 `aria-describedby`로 연결, 포커스는 안내가 생긴 뒤에 이동 | `project-form.tsx` |
| UQ-485 | 그만둔 직후 S-08: 묶음 펼침 + 그 행 "다시 이어 하기"로 포커스 이동 + `role="status"` 알림 "대화를 그만뒀어요. 그만둔 대화 묶음에서 다시 이어 할 수 있어요"(한 번) | `writing-chat-list.tsx` |
| UQ-486 | S-08 그만둔 대화 카드 `role="group"` + `aria-label`. S-10 대화 기록 행 메뉴 이름을 행마다 구분("'{모드}' 대화({상태}, {마지막 활동}) 메뉴") | `writing-chat-list.tsx`, `project-form.tsx` |

새 [UI-가정]: UQ-480 오류 문구, UQ-481 읽기 전용 실패 턴 문구 "답을 받지 못한 턴이에요", UQ-485 알림 문구.

파운데이션 의존: UQ-481의 서버 거부는 UQ-488(A0, `retryWritingChatTurn`·`completeMockAssistantTurn` 상태 검사). 화면은 그 전에도 버튼을 숨겨 막는다.

검사: `pnpm lint` 통과(경고 0) · `pnpm typecheck` 통과(지금은 다른 영역 오류도 없음). SSR(dev :3000) `/career`, 대화 4, 대화 1 `?state=request-wait`, 프로젝트 4 `?focus=fields` 모두 200. 클릭 흐름은 여전히 눈으로 보지 않았다.
