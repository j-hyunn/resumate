# UI QA — A2 커리어 (Phase 3, 라운드 1)

기준: 플로우 v4.2b(S-04, S-08~S-12, S-34~S-36, C-09/C-10/C-15, FL-05/09/13/14) · 데이터 모델 v3.2a(2.2~2.5, 부록 A) · AI v3.2a · 디자인 시스템 v1 · A0 보고 영역 규칙 · A2 구현 보고.
범위: `src/app/(dashboard)/career/**`, `src/components/career/**`. A2가 쓰는 파운데이션 파일(`return-banner.tsx`, `return-target.ts`, `data-gate.tsx`, `lib/data/writing-chats.ts`, `save-status.tsx`)은 A2 흐름에 걸리는 부분만 봤다.
이슈 ID: A3 리뷰가 병렬로 진행 중이고 A4가 UQ-40~49를 썼으므로, 충돌을 피하려고 A2는 **UQ-60부터** 쓴다(UQ-26~39는 A3 몫으로 비워 둠).
상태(`?state=`) 확인 방법: 브라우저 도구 없이 **코드 경로를 읽어서** 확인함. 클라이언트 상호작용(대화 턴, 저장, 폼 전환, 자동 저장)은 브라우저에서 한 번 더 봐야 함.

## 요약

- **Critical 0 / Major 3 / Minor 20** (A2 15 · foundation 4 · 기획 1. 기존 UQ-24 미해결은 따로 셈)
- 기계 검사: `pnpm lint` 통과 · `pnpm typecheck` 통과 · `pnpm build` 통과(36페이지, 커리어 13개 라우트 Partial Prerender)
- 재확인: UQ-4 **해결**(A2 부분), UQ-5 **해결**(작은 빈틈은 UQ-66으로 따로 냄), UQ-24 **미해결**(foundation)
- 타입(Q3): `types/db.ts`의 커리어·AI 작성 대화 행 타입과 enum(`CareerItemStatus`, `EmploymentType`, `EducationType`, `EnrollmentStatus`, `WritingChatMode/Status`, 메시지 role/status, `StructuredFieldReview` ok/needs_review/accepted, `ReturnTargetFeature`)이 04와 같음. `structured_draft.project`에 소속 키 없음(R-28) 확인. A2 컴포넌트에서 타입에 없는 필드 접근이나 없는 enum 문자열은 찾지 못함. 뷰 모델(`ChatView`, `CareerTree`)은 db.ts 밖에 있음.
- 디자인 토큰(Q8): 원시 색(hex/rgb/팔레트 클래스) 0건. `leading-[1.75]`는 DS 1.2 `prose` 토큰 그대로.

## 화면별 점검표

| 화면 ID | Q1 스펙 행 | Q2 문구 | Q3–4 타입·필드 | Q5 라우트 | Q6 상태 | Q7 AI 방식 | Q8 DS | Q9 접근성 | Q10 좁은 화면 |
|---------|-----------|---------|---------------|-----------|---------|-----------|-------|-----------|---------------|
| S-08 커리어 | ✅ | ✅ | ✅ | ✅ | ✅ empty/loading/error/unauth/not-found | — | ⚠️ UQ-81 | ⚠️ UQ-72 | ✅ (3열 작은 버튼) |
| S-04 프로필 | ✅ | ✅ | ⚠️ UQ-73 | ✅ | ✅ (+save-failed) | — | ✅ | ✅ | ✅ |
| S-09 경력 | ✅ (UQ-4 연결 포함) | ✅ | ✅ | ✅ | ✅ | — | ✅ | ⚠️ UQ-76 | ✅ |
| S-34 교육 | ✅ | ✅ | ✅ (enrolled → end_month null) | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| S-10 프로젝트 | ⚠️ UQ-79 | ✅ | ✅ | ✅ | ✅ | — | ✅ | ⚠️ UQ-72 | ✅ |
| S-35 상세 내용 | ⚠️ UQ-67, UQ-68 | ✅ | ✅ | ✅ (`?focus=`) | ✅ | — | ✅ | ✅ | ✅ |
| S-11 정량 성과 | ⚠️ UQ-62, UQ-79 | ✅ | ✅ | — (모달) | ❌ UQ-62 | — | ✅ | ✅ | ✅ |
| S-12 스킬 | ✅ | ✅ (빈 상태는 [UI-가정]) | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| S-36 AI 작성 대화 | ⚠️ UQ-61, UQ-74, UQ-75 | ⚠️ UQ-80 | ✅ | ✅ (UQ-5) | ❌ UQ-60, ⚠️ UQ-64, UQ-65 | ✅ 스트리밍 + 중단 | ⚠️ UQ-70, UQ-71 | ⚠️ UQ-69, UQ-70 | ⚠️ UQ-70 |
| C-15 출처 발화 칩 | ⚠️ UQ-61 | ✅ | ✅ | — | ✅ 4가지 상태 + 배지 | — | ✅ (CHIP_CLASS 재사용) | ⚠️ UQ-69 | ✅ |

## 이슈

### Major

| ID | 심각도 | 담당 | 화면 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|----|--------|------|------|-----------|-----------|------|------|
| UQ-60 | Major | A2 | S-36 | 02 S-36 상태 "응답 실패: 해당 턴만 다시 보내기. 문구는 `error_category`" · 3.0 ST-AI-FAILED(`transient`/`input`/`timeout` 문구 + "사용량은 차감되지 않았습니다") | `src/components/career/writing-chat/chat-screen.tsx:330-333` (`AiFailedInline`을 기본 문구로만 그림) | 실패한 턴 자리에 "답을 받지 못했어요 · 다시 보내기"를 보이고, `turn.error`(error_category)에 맞는 문구와 "사용량은 차감되지 않았습니다"도 함께 보인다 | `?state=ai-failed` / `ai-failed-input` / `ai-failed-timeout` 셋 다 "답을 받지 못했어요 · 다시 보내기"만 나온다. 분류별 문구와 미차감 안내가 없다(`useChatTurnStream().error`는 있는데 쓰지 않음) |
| UQ-61 | Major | A2 | S-36 / C-15 | 02 C-15 데이터 "`structured_draft.details[].achievements[].{field}`, `structured_draft.skills[]`" · 상태 ③ 검토 필요 [수락]/[거절] · S-36 "검토 필요 요약 → 첫 항목으로 이동" | `draft-preview.tsx:38-50`(정량 성과의 `needs_review`도 셈), `draft-preview.tsx:182-200`(정량 성과는 표시만 하고 상태·버튼 없음), `draft-preview.tsx:98-101`(`[data-needs-review]`로 이동) | 정량 성과 필드도 C-15 네 상태로 보인다. `needs_review`면 수락/거절할 수 있고, "검토가 필요한 항목 N개"를 누르면 그 항목으로 간다 | AI가 정량 성과를 `needs_review`로 내면 개수에는 잡히지만 수락할 UI가 없다. 요약 버튼을 눌러도 갈 곳이 없고(`data-needs-review` 없음), 그 값은 저장할 때 소리 없이 빠진다. 지금 목은 이 경우를 만들지 않아서 화면에서는 안 보이지만 실제 AI-12에서는 생긴다. 보고서의 "표시만" 부분 구현과 같은 내용 |
| UQ-62 | Major | A2 | S-11 | 02 3.0 ST-SAVE-FAILED("v3와 같음": 입력 유지 + 다시 시도) · C-06 "저장 실패 — 다시 시도" | `src/components/career/achievement-dialog.tsx:218-224`("완료"), `:205-212`("삭제"), `:76`(바깥 클릭·Esc로 닫기) | 저장이 실패한 상태에서는 모달을 닫지 않거나, 닫기 전에 "저장하지 못한 내용이 있어요"로 확인한다 | `flush()`가 실패해도 그대로 `onClose()`한다. 폼이 언마운트되면 실패한 값(`last`)이 버려져 입력이 사라진다(`?state=save-failed`에서 재현 가능). 일반 폼은 화면에 남아 다시 시도할 수 있지만 모달은 닫히면서 데이터가 사라진다 |

### Minor

| ID | 심각도 | 담당 | 화면 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|----|--------|------|------|-----------|-----------|------|------|
| UQ-64 | Minor | A2 (+기획) | S-36 | 3.0 ST-AI-FAILED "`canceled` 실패로 표시하지 않음" · C-04 중단 | `chat-screen.tsx:168-172` | 사용자가 "중단"한 턴은 실패 문구로 보이지 않는다 | 중단하면 `finishTurn(true)` → "답을 받지 못했어요 · 다시 보내기"가 나온다. 이미 [UI-가정]으로 표시했고 기획 질문(중단 처리)도 올라가 있다. 기획 답이 나오기 전이라도 실패 문구 대신 "중단했어요 · 다시 보내기"처럼 다른 문구가 맞음 |
| UQ-65 | Minor | A2 | S-36 / C-10 | FL-13 "돌아가면 지운다", 04 2.5 `return_target` "복귀하면 null로 비움" | `chat-screen.tsx:97-110` | `saved`/`handed_off` 대화에서는 세션 복귀 대상을 다시 만들지 않는다(또는 C-10 "돌아가기"로 돌아간 경우에도 DB 값을 비운다) | 셸 C-10 배너의 "돌아가기"로 복귀하면 세션 대상만 지워지고 DB `return_target`은 남는다. 나중에 그 대화를 열면 이 effect가 세션 대상을 다시 만들어, 커리어 화면 전체에 이미 끝난 복귀 배너가 다시 나온다 |
| UQ-66 | Minor | A2 | S-36 시작 | A0 영역 규칙 4(UQ-5) | `chat-start.tsx:64` | 세션 대상이 `application_project_id`와 `feature` 둘 다 같을 때만 params를 넘긴다 | `application_project_id`만 비교한다. 같은 기업 JD에서 다른 기능(예: 자소서 → 직무 면접) 게이트로 들어오면 앞 기능의 params(문항 ID 등)가 새 return_target에 들어간다 |
| UQ-67 | Minor | A2 | S-35 | 02 S-35 "필드마다 글자 수 상한(각 2,000자 [가정])" · 04 project_details `title ≤ 100`, STAR `≤ 2,000` | `form-parts.tsx:170-179`(초과 시 `aria-invalid`만), `detail-form.tsx:139-148`(제목에 `maxLength` 없음) | 상한을 넘기면 저장을 막거나 잘라 내고, 그 사실을 알린다 | 2,000자를 넘겨도, 제목이 100자를 넘어도 그대로 자동 저장을 보낸다. 실제 DB CHECK와 붙으면 저장이 계속 실패한다. 목에서는 통과됨 |
| UQ-68 | Minor | A2 | S-35 | 02 C-07 G-3 "[+ 정량 성과]" · S-35 결과 "+ 정량 성과 → S-11" | `detail-form.tsx:161-167` | G-3의 "+ 정량 성과"를 누르면 S-11 모달이 열린다 | `#det-achievements` 앵커로 스크롤만 한다 |
| UQ-69 | Minor | A2 | S-36 / C-15 | DS 7 A-7, A-10(폼 라벨) | `draft-preview.tsx:292, 294`(직접 수정 Textarea/Input에 라벨 연결 없음), `source-chip.tsx:126-131`("수락"/"거절(비우기)") | 편집 입력에는 필드 이름이 접근 가능한 이름으로 붙는다(`aria-label={label}` 또는 `<Label htmlFor>`). 수락·거절 버튼은 "상황 수락"처럼 대상 필드를 포함한다 | 편집 입력에 이름이 없다(라벨은 `span`). 검토 필요 항목이 여러 개면 스크린 리더에서 "수락" 버튼들을 구분할 수 없다 |
| UQ-70 | Minor | A2 | S-36 좁은 화면 | DS 5.4 "1280 미만: `Tabs` '대화 / 정리 결과 (검토 N)', 탭 목록은 진행 스텝 위 `sticky`" · DS 2 인벤토리(shadcn Tabs) | `chat-screen.tsx:485-499, 574-589`, `:497`(점에 `aria-label`) | shadcn `Tabs` 사용(tabpanel·aria-controls·화살표 키), 탭 목록 sticky, 새 내용 점은 sr-only 텍스트 | `role="tab"` 버튼을 직접 만들었다. tabpanel·aria-controls·화살표 이동이 없고, 탭 목록이 sticky가 아니며, `span`의 `aria-label`은 읽히지 않는다 |
| UQ-71 | Minor | A2 | S-36 | DS 5.4 "'정리 중' 상태: 패널 머리에 C-03 축약형 '정리 중'" | `chat-screen.tsx:442-447` | `AiProgressInline`(C-03 축약형)을 재사용한다 | `Loader2` + 문단을 따로 만들었다(모양은 비슷함) |
| UQ-72 | Minor | A2 | S-08, S-10, S-36 | DS 7 A-4 "좁은 화면 터치 대상 44×44px 이상" | `career-tree.tsx:76, 244, 328`(`size="icon-sm"`), `project-form.tsx:291-302`(순서 변경), `chat-screen.tsx:280`(대화 메뉴) | 좁은 화면에서 아이콘 버튼이 44px 이상(`size-11` 또는 터치 영역 확장)이다 | 32px(`icon-sm`) 그대로다. 행 높이는 44px이지만 버튼 자체는 작다 |
| UQ-73 | Minor | A2 | S-04 | 04 A.1 `total_years_of_experience smallint 0..50` | `profile-form.tsx:79`(소수점 허용), `:43` | 0~50 사이 정수만 받는다 | "3.5"를 그대로 보낸다. 범위 검사도 없다 |
| UQ-74 | Minor | A2 | S-36 보강 모드 | 02 S-36 프로젝트 기본 정보 "보강 모드는 기존 프로젝트 값 표시(읽기 전용)"(이름, 역할, 기간, 팀 규모, 한 줄 요약, 사용 기술) | `draft-preview.tsx:113-118, 131-145` | 기존 프로젝트의 기간·팀 규모·사용 기술도 읽기 전용으로 보인다 | 이름·역할·한 줄 요약만 보인다. 사용 기술에는 이번 대화에서 나온 스킬만 나온다 |
| UQ-75 | Minor | A2 | S-36 폼 전환 | 02 S-36 저장 실패 "정리 결과 유지, 다시 저장"(폼 전환도 같은 성격) | `chat-screen.tsx:235-244` | 전환에 실패하면 다이얼로그에 실패 안내 + 다시 시도 | `try/finally`만 있고 `catch`가 없다. 실패해도 알림 없이 버튼만 다시 켜진다(처리하지 않은 예외) |
| UQ-76 | Minor | A2 | S-09 | DS 7 A-10(필드 아래 `text-destructive` + `CircleAlert`, `aria-invalid` + `aria-describedby`) | `experience-form.tsx:142-149` | 오류 문구에 아이콘을 붙이고, 직급·직책 입력의 `aria-describedby`가 그 문구를 가리킨다 | 문구만 있고 입력과 연결되어 있지 않다(`role="status"`만 있음) |
| UQ-80 | Minor | A2 | S-36 게이트 | 02 S-36 게이트 배너 "예상 충족 여부 갱신" · C-10 "원래 화면의 진행 중 설정 복원" | `writing-chat/gate.tsx:60-66`, `gate.tsx:13-17` | 이미 충족된 경우에는 "필요한 내용이 모두 채워졌어요"만 보인다. 자기소개서 복귀는 `params.draft_id`가 있으면 S-18로 간다 | `f.ready`(이미 충족)인데도 "저장하면 충족돼요" 배지가 함께 나온다. 세션 대상이 없을 때 `cover_letter` 복귀 링크는 항상 S-17 목록으로 간다 |
| UQ-81 | Minor | A2 | S-08 | DS A2 "연도 머리 `sticky top-14`" · DS 3.9 C-10 | `career-tree.tsx:267`, (참고) `common/return-banner.tsx:156` | 복귀 배너가 있을 때 연도 머리가 그 아래에 붙는다 | 둘 다 `sticky top-14`라서, 복귀 배너가 있으면 스크롤할 때 연도 머리가 배너 밑에 가려진다 |
| UQ-63 | Minor | foundation | S-36 | 02 3.0 "실행 버튼 사용량 안내 — 첫 턴 성공 시 차감" · S-36 시작 "첫 턴 성공 시 차감(`usage_event_id` 채움)" | `src/lib/data/writing-chats.ts:144-158` | 첫 AI 턴이 성공했을 때 `usage_events`를 만든다 | 사용자 첫 메시지를 추가할 때 바로 `charged`를 만든다. `?state=ai-failed`로 첫 턴이 실패해도 차감되어, "차감되지 않았습니다" 안내(UQ-60 수정 후)와 남은 횟수가 맞지 않게 된다. mock-turn 이전 작업(파운데이션 요청 1) 때 같이 고치는 것을 권장 |
| UQ-77 | Minor | foundation (+기획) | S-36 | 04 2.5 `message_count` "상한 40은 `append_writing_chat_message`에서 검사 … 확정되면 `CHECK (message_count <= 40)`" · 02 S-36 입력창 | `writing-chats.ts:183`(AI 응답은 검사 없이 +1), `chat-screen.tsx:91, 141`(39에서 보내기 허용) | 합계가 40을 넘지 않는다 | 39에서 사용자 메시지(40)를 보내면 AI 답이 41이 된다. 앞으로 둘 CHECK와 충돌한다. 39에서 보내기를 막을지, AI 답은 상한에서 빼고 셀지는 기획 확인이 필요함 |
| UQ-78 | Minor | foundation | S-36 (목) | ui-context "Data layer: 화면은 `lib/data/*`로만 읽고 쓴다" · A2 파운데이션 요청 1 | `writing-chat/mock-turn.ts:16, 163, 272`, **`writing-chat/chat-view.ts:9, 35, 43-55`**, `career/actions.ts:51, 140-168` | 목 저장소 접근은 `lib/mock`·`lib/data` 안에만 있다 | 이전 작업 때 놓치기 쉬운 지점: ① `chat-view.ts`도 `mockRequest`를 직접 부르고 mock-turn 메모리(`askedSlot`, `projectedReady`)로 `currentSlot`·`readyToReturn`을 만든다. ② `retryWritingChatTurnAction`·`completeWritingChatTurnAction`은 `readPlannedTurn`(globalThis 메모리)에 기대고, 서버를 재시작하면 이 메모리가 사라져 `다시 보내기`가 아무 일도 하지 않는다(`return null`). ③ `applyDraftPatchAction`의 거절 → `markAsked`. 파일을 옮길 때 이 4개 진입점(plan / read / apply / asked·projected)을 같이 옮겨야 깨지지 않는다. 지금 동작은 정상 |
| UQ-79 | Minor | foundation (+A3) | S-10, S-11 | 02 S-10 "S-16 보완점에서 열면 '관련 요건: {요건 content}'" · C-02 "정량 성과 → S-11" | `src/lib/routes.ts:39`(`project(id)`에 요건 파라미터 없음), `common/evidence.tsx`(achievement href) / A2 `achievement-list.tsx:36-43`(`openId` 준비됨, 페이지에서 연결 안 함) | 두 이동 경로가 해당 화면 상태까지 이어진다 | A2 보고서 파운데이션 요청 3·4와 같다. 라우트·근거 href가 생기면 A2가 쿼리를 연결해야 함 |
| UQ-82 | Minor | 기획 | S-09 | 02 S-09 필수 "`start_month`, `end_month`/`is_current`" ↔ 04 2.2 완료 판정 "experiences: `company_name`, `start_month`, (`job_rank` 또는 `job_position`)"(종료월 없음) | `experience-form.tsx:109`("회사명·기간·직급 또는 직책을 채우면 완료돼요"), `:130`(종료 필수 표시) | 두 문서 중 하나로 맞춘다 | 화면은 종료월(또는 재직 중)을 필수로 표시하는데, 데이터 계층은 04 기준이라 종료월이 없어도 complete가 된다. 사용자가 보는 안내와 실제 판정이 다름 |

## 기획 확인 필요

| 화면 | 내용 | 양쪽 인용 |
|------|------|-----------|
| S-09 | 종료월이 경력 완료 조건인지 (UQ-82) | 02 S-09 "필수 … `end_month`/`is_current`" ↔ 04 2.2 "experiences complete = `company_name`, `start_month`, (`job_rank` 또는 `job_position`)" |
| S-36 | 메시지 상한 40에 AI 답이 걸칠 때 처리 (UQ-77) | 02 S-36 "`message_count` / 40(사용자 + AI 합계)" ↔ 04 2.5 "`message_count < 40`일 때만 insert"(사용자 메시지 RPC 기준) |
| S-36 | 사용자가 중단한 턴의 표시 (UQ-64) | 3.0 "`canceled` 실패로 표시하지 않음" ↔ S-36에 중단 뒤 다음 동작이 없음 |
| (A2 보고서 그대로) | 진행 단계 "기본 정보"에 상세 내용 제목 포함 여부 · 소속 "없음"과 "대화하면서 정할게요" 구분 · 실패 메시지 기록 유지 · S-08 프로젝트 행 삭제 메뉴 · G-4 예시·2,000자 확정 · S-09 게이트 완료 문구 · S-12 빈 상태 | A2 보고서 "기획 확인 필요" 표 |

## 재확인 결과

| ID | 결과 | 메모 |
|----|------|------|
| UQ-4 | 해결 (A2 부분) | S-09: `experience-form.tsx:83-90`. 복귀 대상이 있으면 저장 후 `recordGateExperience(id)` → `notifyCareerSaved()` → `recheck()`. 완료(`status = complete`) 상태에서 `GateCompletion`(`:114-121, 237-277`)이 준비됐으면 "{기능}으로 돌아가기", 아니면 `continueHref`("AI와 대화하며 채우기")를 보인다. `continueHref`(return-banner `gateContinuationHref`)는 `experience_id` + `application_project_id` + `feature`를 넘기고, S-36 시작(`writing-chats/new/page.tsx:60-72`, `chat-start.tsx:51-53`)은 그 경력을 소속 기본값으로 고른다. S-36 저장 완료 카드(`chat-screen.tsx:668-678`)도 같은 분기. 셸 C-10은 `recordGateExperience`가 보내는 `resumate:return-target` 이벤트로 대상을 다시 읽는다. 클라이언트에서 실제로 이어지는지는 브라우저로 확인하지 못함 |
| UQ-5 | 해결 | `chat-start.tsx:62-75`: 게이트 진입(쿼리 `application_project_id` + `feature`, `data-gate.tsx:88-93`과 `return-banner.tsx:58-64` 둘 다 넘김)이면 `return_target = { application_project_id, feature, params: readCareerReturn()?.params ?? {} }`로 `startWritingChat`을 부른다. 세션 대상이 없으면 `markCareerReturn`으로 채운다. 대화 화면에서는 DB → 세션으로 맞춘다(`chat-screen.tsx:97-110`). 남은 빈틈은 feature를 비교하지 않는 것(UQ-66)과 끝난 대화에서 대상을 다시 만드는 것(UQ-65) |
| UQ-24 | 미해결 (foundation) | `common/return-banner.tsx:152, 174-178`: S-36(`/career/writing-chats/*`)에서도 C-10이 "AI와 대화하며 채우기"(새 대화)를 보인다. 대화 중에 눌러서 새 대화를 시작하면 1회가 더 차감될 수 있다. A2 파운데이션 요청 2(`hideContinue` 또는 경로 조건)로 고쳐야 함 |

## 기계 검사 출력

- `pnpm lint` (eslint): 오류·경고 0
- `pnpm typecheck` (tsc --noEmit): 오류 0
- `pnpm build`: `✓ Compiled successfully`, `✓ Generating static pages (36/36)`. 커리어 라우트 13개 모두 ◐(Partial Prerender): `/career`, `/career/profile`, `/career/skills`, `/career/experiences/new|[id]`, `/career/educations/new|[id]`, `/career/projects/new|[id]`, `/career/projects/[id]/details/new|[detailId]`, `/career/writing-chats/new|[id]`
- dev 서버: 이번 리뷰에서는 띄우지 않음(포트 3999·3457에 떠 있는 node 서버는 다른 에이전트 것이라 건드리지 않음)

## 참고 — 확인했고 문제없던 항목

- 페이지 규칙(UQ-3): 13개 페이지 모두 기본 export는 `ScreenSuspense`만 두고, `Screen`에서 `await`한다. 링크는 모두 `routes.*`로 만든다(문자열 경로 0건).
- 자동 저장: `useRowAutosave`가 첫 저장에서 행을 만든 뒤 `history.replaceState`로 수정 라우트로 바꾼다. `useAutosave`가 요청을 하나씩 처리해서 중복 행이 생기지 않는다. 저장 성공마다 `notifyCareerSaved()`를 부른다(영역 규칙 5).
- S-36 문구: 시작 안내·보관 안내, 시작 버튼 "대화 시작(1회 사용, 이번 달 {N}/10회 남음)", ST-LIMIT의 AI 작성 대화 덧붙임, 민감정보 안내, 상한 도달 문구, 저장 확인 요약, 폼 전환 확인, C-15 검토 필요·본인 역할 확인 중 문구가 명세와 같음.
- S-36 저장 경로: 저장 전에는 커리어 테이블에 쓰지 않는다. `save_writing_chat` 뒤 다시 판정하고, "저장하고 돌아가기"는 충족일 때만 `clearReturnTarget` 후 원래 화면으로 이동한다. 보강 모드에서 이미 채워진 필드는 잠기고(V-9h), 목도 기존 필드와 `user_edit`·`accepted` 필드를 덮어쓰지 않는다.
- C-05: 경력·교육(소속 처리 + 결과 처리), 프로젝트, 상세 내용, 정량 성과(S-11 모달을 닫은 뒤 C-05), 대화만 삭제(`writing_chat`)가 모두 `DeleteConfirmDialog`를 거친다.
- 스트리밍 접근성: 생성 중에는 `aria-busy`, 완료·실패는 `aria-live="polite"`로 한 번만 알리고 글자 단위로 읽지 않는다. 응답 중에는 입력을 막고, 보내기 자리에 "중단"이 나온다.

---

# 라운드 2 (최종, 2026-10-25)

기준: A2 보고 "라운드 1 수정", A0 보고 "파운데이션 배치 (Phase 3)". 확인 방법: 코드 대조 + `next dev -p 3521` 서버 렌더 스모크(확인 후 종료). 클릭 상호작용(모달 닫기 확인, 탭 키보드, 실패 문구 전환, 정량 성과 수락/거절)은 여전히 브라우저로 확인하지 않음.

## 요약

- **판정: 통과.** 라운드 1의 Major 3건이 모두 해결됐고, 새 Critical·Major는 없음.
- 재확인: UQ-60~81(UQ-82 제외)과 UQ-24 **해결**. UQ-82는 **기획 대기**. 재발 0.
- 새 이슈: Minor 1건(UQ-83).
- 기계 검사: lint 통과 · typecheck 통과 · build 통과(36페이지, 커리어 13개 라우트 ◐). dev 스모크 26개 요청 모두 200, 개발 로그 오류 0.

## 재확인 결과 (라운드 2)

| ID | 결과 | 확인 근거 |
|----|------|-----------|
| UQ-60 | 해결 | `chat-screen.tsx` `FailedTurn`(600~): "답을 받지 못했어요 · 다시 보내기" 아래에 `AI_FAILED_TITLES[error_category]`와 `AI_NOT_CHARGED`를 보인다. 스트림 `error` 이벤트의 `error_category`를 기억해 쓴다(`finishTurn(..., ev.error_category)`) |
| UQ-61 | 해결 | `draft-preview.tsx:186-208`: 정량 성과 필드마다 `DraftField`(C-15 네 상태, `data-needs-review`, 수락/거절, 직접 수정)를 그린다. 경로 `details.0.achievements.{i}.{field}`는 `applyStructuredDraftPatch`의 점 경로로 처리된다. 목 `persistChat`도 이제 정량 성과·스킬을 저장하고 `needs_review`는 건너뛴다 |
| UQ-62 | 해결 | `achievement-dialog.tsx:76-99, 159-166, 235-265`: Esc·바깥 클릭·완료가 모두 `tryClose`를 거친다. 저장이 실패했으면 닫지 않고 "저장하지 못한 내용이 있어요" + [다시 시도]/[계속 편집]/[그래도 닫기]를 보이며, 값은 폼에 남는다 |
| UQ-63 | 해결 | `writing-chats.ts:146-161, 186-209`: 첫 사용자 메시지에서 `reserved` → 첫 턴이 성공하면 `charged`, 실패하면 `released`(+ `usage_event_id` 비움). 다시 보내기는 다시 예약한다(`retryWritingChatTurn`) |
| UQ-64 | 해결 (기획 질문은 유지) | `FailedTurn` `kind === "canceled"`: muted 색 "중단했어요 · 다시 보내기"로, 실패로 표시하지 않는다 |
| UQ-65 | 해결 | `chat-screen.tsx:103-117`: `chat.status !== "active"`이면 세션 복귀 대상을 다시 만들지 않는다 |
| UQ-66 | 해결 | `chat-start.tsx:64-67`: `application_project_id`와 `feature`가 둘 다 같을 때만 params를 넘긴다 |
| UQ-67 | 해결 | `form-parts.tsx:177`(STAR `maxLength`), `detail-form.tsx:22-25, 73-78, 151-152`(제목 100자 + 글자 수 표시, 저장 값도 잘라서 보냄) |
| UQ-68 | 해결 | `detail-form.tsx:172`: G-3 "+ 정량 성과"가 `achievementControl.openNew()`로 S-11을 연다 |
| UQ-69 | 해결 | `draft-preview.tsx:304, 306`(편집 입력 `aria-label={label}`), `source-chip.tsx:129, 132`("{필드} 수락" / "{필드} 거절(비우기)") |
| UQ-70 | 해결 | `chat-screen.tsx:497-524`: shadcn `Tabs`(tablist/tab/tabpanel, 화살표 키), `TabsList` `sticky top-0 h-11 xl:hidden`, 새 내용 점은 `aria-hidden` + sr-only. 서버 HTML에서 `role="tabpanel"` 2개, "보기 전환" 확인 |
| UQ-71 | 해결 | `chat-screen.tsx:459`: `AiProgressInline label="정리 중"` |
| UQ-72 | 해결 | 아이콘 버튼에 `size-11 lg:size-8`(`career-tree.tsx:78, 262, 346`, `project-form.tsx:220, 291, 296, 347`, `chat-screen.tsx:293`, `draft-preview.tsx:337`) |
| UQ-73 | 해결 | `profile-form.tsx:43, 79-84`: 숫자만 받고 50으로 자르며, 0~50 정수만 저장한다 + 도움말 |
| UQ-74 | 해결 | `draft-preview.tsx:118-136`: 보강 모드에서 기간·팀 규모·기존 사용 기술을 읽기 전용으로 보이고, 이번 대화의 스킬은 따로 표시한다 |
| UQ-75 | 해결 | `chat-screen.tsx` `confirmHandoff`: `catch`에서 `handoffError` → 다이얼로그를 유지하고 다시 시도하게 한다 |
| UQ-76 | 해결 | `experience-form.tsx:149-155` + `form-parts.tsx:115`: `CircleAlert` + `id="exp-rank-error"`, 두 입력의 `aria-describedby`가 그 문구를 가리킨다 |
| UQ-77 | 해결 (기획 확인 유지) | `writing-chat-limits.ts` `canSendWritingChatMessage(count) = count + 2 ≤ 40`. RPC 목(`appendWritingChatMessage`)과 S-36 입력 비활성(`chat-screen.tsx` `atLimit`)이 같은 함수를 쓴다 |
| UQ-78 | 해결 | `mock-turn.ts`·`chat-view.ts`·`slots.ts`가 `lib/mock/writing-chat-turn.ts`, `lib/data/writing-chat-view.ts`, `lib/data/writing-chat-slots.ts`로 옮겨졌다. A2 폴더의 목 저장소 직접 접근은 0건(`grep mockRequest\|lib/mock` → 없음). 진입점 4개는 `writing-chats.ts` 쪽으로 옮겨졌다. 턴 기억은 `db.mock_chat_turns`에 두고, 대기 계획이 없으면 마지막 사용자 메시지로 다시 계획한다(서버를 재시작해도 다시 보내기 동작) |
| UQ-79 | 해결 | `routes.project/projectNew({ requirement_id })` + `RelatedRequirement`(S-10 새/편집). 스모크에서 "관련 요건: 대규모 결제 승인 API 설계·운영" 렌더 확인. `?achievement=`: `evidence.ts:141-143` → S-35 / S-09 페이지 → `AchievementList openId` |
| UQ-80 | 해결 | `gate.tsx:16-17, 53-67`: 이미 충족이면 "필요한 내용이 모두 채워졌어요"만 보이고, 배지는 미충족 + 충족 예상일 때만 나온다. `cover_letter` + `params.draft_id`면 S-18로 간다(키는 파운데이션이 `draft_id`로 확정) |
| UQ-81 | 해결 | `career-tree.tsx:102-118, 285`: 복귀 대상이 있으면 연도 머리 sticky를 푼다 [UI-가정] |
| UQ-82 | 기획 대기 | 변경 없음(02 S-09 ↔ 04 2.2 종료월 완료 조건) |
| UQ-24 | 해결 | `return-banner.tsx:153`: `/career/writing-chats` 경로에서 `continueHref = null` |

## 옮긴 뒤 회귀 점검

- `components/career/actions.ts`: 액션 이름은 그대로 두고 `sendWritingChatTurn` / `retryWritingChatTurn` / `completeWritingChatTurn` / `markWritingChatSlotAsked` / `buildChatView`를 부르는 얇은 래퍼가 됐다. 거절 → 그 칸 다시 묻기 흐름도 유지된다.
- 정량 성과 경로(`…achievements.{i}.unit` 등)를 거절하면 `slotFromPath`가 null을 돌려줘 다시 물을 칸은 지정되지 않는다(의도대로 무해함).
- S-08 `n/40`·자동 삭제 일수는 `writing-chat-limits` 상수를 쓴다(`career-tree.tsx:39-43`). `daysLeft`는 같은 계산을 로컬에 한 번 더 두고 있다(동작은 같음, 정리 대상일 뿐 이슈 아님).
- 서버 렌더 확인(`next dev -p 3521`, 26개 요청 전부 200, 로그 오류 0):
  - S-08(`?state=empty/loading/unauth`), S-04, S-12, S-09 새/편집(`?achievement=`), S-34 새/편집, S-10 새(`experience_id` + `requirement_id`)/편집(`requirement_id`), S-35 새/편집(`?focus=result&achievement=`), S-36 새(기본 / `?state=limit` / 보강 / 게이트 + `experience_id`), S-36 대화(active · saved · 게이트 · `?state=ai-failed` · `?state=message-limit`).
  - 없는 ID와 `?state=not-found`는 Cache Components 스트리밍 특성상 HTTP 200이지만 "찾을 수 없는 페이지예요" 화면이 렌더됐다.
  - 내용: 저장된 대화 "커리어에 저장했어요 · 읽기 전용 · 이 프로젝트에 상세 내용 더 추가하기", 게이트 대화 "…위해 필요한 내용 / 저장하고 돌아가기", 한도 "진행 중인 대화는 이어서 쓰고 저장할 수 있어요", 대화 "본인 역할 확인 중".

## 새 이슈 (라운드 2)

| ID | 심각도 | 담당 | 화면 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|----|--------|------|------|-----------|-----------|------|------|
| UQ-83 | Minor | A2 | S-36 (≥1280px) | DS 5.4 "1280 미만만 탭", DS 7 접근성 | `chat-screen.tsx:307, 453-457, 506` | 두 열이 함께 보이는 넓은 화면에서는 탭 의미가 없다(일반 영역으로 읽힘) | `TabsList`는 `xl:hidden`인데, 두 열은 여전히 `role="tabpanel"`이고 숨은 탭을 `aria-labelledby`로 가리킨다. 선택되지 않은 쪽은 `data-state=inactive`라서, 스크린 리더가 화면에 보이는 열을 "비활성 탭 패널"로 읽을 수 있다. 시각·키보드 동작에는 영향 없음 |

## 기계 검사 출력 (라운드 2)

- `pnpm lint`: 오류·경고 0
- `pnpm typecheck`: 오류 0
- `pnpm build`: `✓ Compiled successfully`, `✓ Generating static pages (36/36)`, 커리어 13개 라우트 ◐
- dev 스모크: `pnpm exec next dev -p 3521` → 확인 후 종료(포트 해제 확인). 다른 에이전트의 서버(3999, 3457)는 건드리지 않음
