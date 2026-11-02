# UI QA — Phase 4 통합 (영역 간 경계) (라운드 1)

- 검수일: 2026-10-25 / 기준: 플로우 v4.2b · 데이터 모델 v3.2a · AI v3.2a · 디자인 시스템 v1 · A0 보고(파운데이션 배치 Phase 3 포함) · 영역 리뷰 `02_ui-qa_A0`, `03_ui-qa_A1~A4`(모두 라운드 2 통과)
- 범위: **영역을 넘는 것만** — Q5 교차 라우트·플로우(FL-09/10/13/15/16/17, FL-04/06/12), C-09 → C-10 복귀(경력 없음 경로 포함), 보드(A4) ↔ 기업 JD(A3)의 C-12/C-13/C-14, 셸(메뉴 순서·배지·이동 경로·서랍), 영역 간 일관성(공통 문구·토큰·좁은 화면 44px). 영역 리뷰에서 이미 나온 항목은 다시 올리지 않았다(아래 "이월 항목"에 상태만 적음).
- 이슈 ID: UQ-120부터.
- 확인 방법: 코드 대조 + 기계 검사 + `pnpm exec next dev -p 3700` 서버 렌더 스모크(확인 후 종료, 포트 해제 확인). **브라우저 확인 불가**: Claude in Chrome에 연결된 브라우저가 없음(`list_connected_browsers` = 빈 목록). sessionStorage를 쓰는 출발 메뉴·복귀 배너·C-14·포커스는 코드 경로를 읽어서 판단했다.

## 요약 — Critical 0 / Major 0 / Minor 8

- 기계 검사: `pnpm lint` 통과(exit 0) · `pnpm typecheck` 통과(exit 0) · `pnpm build` 통과(exit 0, 36 페이지).
- dev 스모크: 교차 경로 32개 모두 200, 개발 로그 `Error`/`⨯` 0건. 다른 지원 프로젝트의 세션 ID를 섞은 URL(`/applications/{ap2}/interview/{ap1의 세션}`)은 "찾을 수 없는 페이지예요"로 렌더(HTTP 200은 Cache Components 스트리밍 특성, 기존 판정과 같음).
- 링크: `src` 전체에서 문자열 경로로 만든 `href`/`push`/`replace`/`redirect`는 0건. 모든 화면 간 이동이 `routes.*`를 거친다. 쿼리(`?type=`, `?from=board`, `?requirement_id=`, `?achievement=`, `?focus=`, S-36의 `mode/project_id/experience_id/application_project_id/feature`)는 모두 대상 화면이 읽는다.
- 교차 흐름의 큰 골격(FL-13 게이트 → S-09/S-36 → 복귀, C-12~C-14 공통화, 출발 메뉴 이동 경로)은 일치한다. 남은 것은 **출발 메뉴 상태가 남아서 생기는 오표시(UQ-122, UQ-123)**와 **좁은 화면 44px 규칙이 영역마다 다르게 적용된 것(UQ-120, UQ-121, UQ-127)**이다.

## 점검표

### 교차 플로우 (Q5)

| 플로우 | 경로 | 결과 | 메모 |
|--------|------|------|------|
| FL-09 가입 → 커리어 | S-01 → S-02 `?next=` → S-03 `?next=` → `next` 또는 S-08 → 빈 상태 두 시작점(S-36 `mode=new_project` / S-09·S-34·S-10) | ✅ | `safeNextPath` 하나로 통일, ST-UNAUTH → `/sign-in?next=` (A1 R2 확인) |
| FL-10 기업 JD 만들기 | S-13 "+" → S-14 → S-31 / S-39 "지원 전 +" → S-14 `?from=board` → S-39 + "열기" 토스트 | ⚠️ UQ-123 | S-14 이동 경로 첫 마디도 `from`에 따라 바뀜 ✅. 토스트 "열기"가 출발 메뉴를 기록하지 않음 |
| FL-11 / FL-03 → FL-13 | S-16·S-17·S-18·S-19·S-20 → C-09 | ✅ | 다섯 곳 모두 공통 `DataInsufficientGate`, `returnHref`는 자기 화면, params 키는 `return-target.ts` 주석과 일치(`included_project_ids` / `draft_id` / `interview_type`+`question_count` / `gap_item_key`+`requirement_ids`) |
| FL-13 경력 없음 경로 | C-09 `next_action=form` → S-09(세션 대상 기억) → 저장 → `recordGateExperience` → C-10 / S-09 완료 카드 "AI와 대화하며 채우기" → S-36 `experience_id`+`application_project_id`+`feature` → 소속 미리 선택 → 저장 → "저장하고 돌아가기" → 원래 화면 consume | ✅ | DB `return_target`은 `clearReturnTargetAction`, 세션 대상은 원래 화면의 `consumeReturnParams`가 지움. S-36 안에서는 C-10 "AI와 대화하며 채우기" 숨김(UQ-24 해결 유지) |
| FL-13 다른 기기 이어 하기 | S-36 대화 열기 → DB `return_target` → 세션 대상 재생성(`featureHref`) | ⚠️ UQ-122 | `job_interview`의 대체 경로가 `?type=job`이라 S-20 진입 안내 오표시 가능 |
| FL-12 진입 3곳 | S-31 면접 카드 → S-20 / S-37 C-16 → S-20 / S-39 C-14 → S-20 `?type=` | ⚠️ UQ-122 | 세 진입 모두 존재. 진입 안내 판정이 출발 메뉴에 기대서 다른 `?type=` 링크에서도 뜸 |
| FL-15 보드 단계 이동 | 드래그 / C-12 → `useStageMove().request()` → 실패 원위치 / C-13 / C-14 / 결과 지움 확인 | ✅ | S-39·S-13·S-31 모두 같은 공통 컨트롤러(아래 표) |
| FL-16 인터뷰 전형 → S-20 | C-14 "면접 준비하기" → S-20 `?type=job|culture_fit` / 작성 중 세션 → S-33 | ✅ (오표시는 UQ-122) | 쿼리에는 유형 값만 ✅ |
| FL-17 모의 면접 → 새 면접 | S-37 → C-16 → (작성 중) 이어서 쓰기 S-33 / 그만두고 새로 → S-20, 기업 JD 0개 → S-14 | ✅ | C-16 선택 시 `setNavOrigin("interviews")` → S-20 첫 마디 "모의 면접" |
| FL-04 이어쓰기 | S-37 고정 카드 / S-31 면접 카드 / S-20 목록 / C-14 변형 → S-33 | ✅ | |
| FL-06 기업 JD 삭제 | S-13 행 메뉴 / S-31 헤더 / S-39 카드 메뉴 → C-05 | ⚠️ UQ-125 | S-31에서 지우면 항상 S-13으로 감 |
| C-02 원본으로 이동 (A3/A4 → A2) | 근거 칩 → S-10 / S-35 `?focus=` / S-35·S-09 `?achievement=` | ✅ | 이동 전에 패널 닫음 |
| S-16 보완점 → A2 | "AI와 대화" → S-36(`feature=insight`) / "직접 입력" → S-10 `?requirement_id=` + "관련 요건" | ✅ | 스모크에서 S-10 새/편집 모두 200 |

### 보드 ↔ 기업 JD: C-12 / C-13 / C-14 동작 비교

| 항목 | S-39 카드 ⋯ | S-13 행 ⋯ | S-31 단계 칩 | 결과 |
|------|-------------|-----------|---------------|------|
| 컨트롤러 | `useStageMove` (`kanban-board.tsx:76`) | `useStageMove` (`application-list.tsx:141`) | `useStageMove` (`hub-header.tsx:28`) | ✅ 같은 공통 훅 |
| 트리거 | `StageCardMenu` | `StageCardMenu` | `StageChip` | ✅ |
| 이동 후 | `router.refresh()` | `router.refresh()` | `router.refresh()` | ✅ |
| C-13 / C-14 / 결과 지움 확인 / ST-MOVE-FAILED | 공통 `dialogs` | 공통 `dialogs`(행 클릭 전파 차단 안에 렌더) | 공통 `dialogs` | ✅ |
| `?state=move-failed` | `failMove` | `failMove` | `failMove` | ✅ |
| 출발 메뉴 | `origin: "board"` → C-14 링크 클릭 때 기록 | 없음(S-13은 최상위 화면이라 출발 메뉴를 지움) | 없음(들어올 때 남은 값 유지) | ✅ / ⚠️ UQ-122 |
| 메뉴 이름 | "{카드} 카드 메뉴" | "행 메뉴"(모든 행 같음) | — | ⚠️ UQ-124 |
| 좁은 화면 44px | 감싸는 요소로 `size-11` | 32px 그대로 | 32px(`sm`) | ⚠️ UQ-120 |

### 셸 (L-01)

| 항목 | 결과 | 메모 |
|------|------|------|
| 메뉴 순서 | ✅ | `MENU_ITEMS` 커리어 · 기업 JD 관리 · 모의 면접 · 지원 현황(`routes.ts:92-97`) |
| 현재 메뉴 | ✅ | `/applications/**`(S-14~S-22, S-31, S-33) → 기업 JD 관리. S-14 `?from=board`도 기업 JD 관리 강조 + 첫 마디 "지원 현황"(명세대로) |
| 배지 | ✅ | 커리어 점(작성 중 대화) · 기업 JD 관리 진행 중 AI 작업 수(JD 추출·대화 턴 제외) · 모의 면접 작성 중 + 새 결과(합산, A0 [UI-가정]). S-22를 보면 `result_viewed_at`이 채워지고 다음 이동·10초 폴링 때 배지가 줄어든다 |
| 이동 경로 | ✅ (오표시는 UQ-122·123) | 기업 JD 하위 화면 10개 모두 첫 마디 `routes.applications()` + `applicationProjectId` 전달 → 출발 메뉴로 치환. 최상위 메뉴 화면 5개(S-08, S-13, S-37, S-39, S-24)는 1마디라 출발 메뉴를 지움. 왼쪽 메뉴 클릭도 지움 |
| 좁은 화면 서랍 | ⚠️ UQ-120 | 1024px 미만 상단 바 + 메뉴 버튼 + 현재 메뉴 이름 ✅. 서랍 안 메뉴 항목 40px, 설정 36px, 처리방침 링크 약 16px |
| 하단 | ✅ | 계정 · 설정(S-24) · 처리방침(S-30 기본 탭 privacy) |

### 영역 간 일관성

| 항목 | 결과 | 메모 |
|------|------|------|
| ST-AI-FAILED 문구 | ✅ | 모든 영역이 `AiFailed` / `AiFailedInline` + `AI_FAILED_TITLES` + `AI_NOT_CHARGED`. 중단(canceled) 문구만 영역마다 다름 → UQ-126 |
| ST-LIMIT | ✅ | 모든 영역 `LimitNotice` + `USAGE_FEATURE_LABELS`. AI 작성 대화 덧붙임 문구는 S-36·C-09·S-16 보완점에서 같음 |
| 사용량 안내 | ✅ | 모든 영역 `UsageHint`. 무차감은 "사용량 차감 없음", AI 작성 대화는 `N/10회` 형식으로 통일 |
| 저장 실패(자동 저장 아닌 제출) | ⚠️ UQ-128 | 영역마다 다른 문장 |
| 토큰 | ✅ | 원시 색은 shadcn 오버레이 `bg-black/10`(primitive)과 Google 로고뿐. 폭은 `max-w-3xl`/`max-w-6xl`/`max-w-[42rem]`로 디자인 시스템 1.4 값과 같음 |
| 좁은 화면 44px | ⚠️ UQ-120, UQ-121, UQ-127 | 768px 미만 44px 처리 개수: interviews 24 · career 18 · account 3 · applications 2 · board 1 · **common 0**(작은 버튼 22개) |

## 이슈

| ID | 심각도 | 담당 | 화면 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|----|--------|------|------|-----------|-----------|------|------|
| UQ-120 | Minor | foundation | 공통(C-10, C-12, ST-AI-FAILED, C-04, C-09, L-01 서랍) | 디자인 시스템 7 A-4 "좁은 화면 터치 대상 44×44px 이상", 2장 button "좁은 화면에서 터치 대상은 최소 44px", 리더 결정(A4 R2: 768px 미만 44px, 넓은 화면 `icon-sm` 유지) | `src/components/common/stage-menu.tsx:351`(`StageCardMenu` `icon-sm`), `:285`(`StageChip` `sm`), `src/components/common/return-banner.tsx:176, 180`(C-10 버튼 `sm`), `src/components/common/state-views.tsx:277, 282, 290`(다시 시도 `sm`), `src/components/common/streaming.tsx:183`(중단 `sm`), `src/components/common/data-gate.tsx:181`(컬처핏 전환 `sm`), `src/components/common/shell/app-sidebar.tsx:137`(메뉴 `h-10`), `:159`(설정 `h-9`), `:167`(처리방침 `text-xs` 링크) | 공통 컴포넌트 자체가 768px 미만에서 44px를 보장한다. 쓰는 화면마다 감쌀 필요가 없다 | 공통 컴포넌트에는 좁은 화면 처리가 하나도 없다. 그래서 S-39는 `max-md:[&>button]:size-11`로 감쌌지만(`kanban-board.tsx:422`), 같은 `StageCardMenu`를 쓰는 S-13 카드 목록(좁은 화면 레이아웃)과 S-31 단계 칩은 32px다. 이 차이는 영역 리뷰에서 보이지 않던 경계 문제다(A4 UQ-46 메모에서 예고됨). `StageCardMenu`/`StageChip`/C-10/ST-AI-FAILED 버튼/서랍 항목에 `max-md:size-11`·`max-md:h-11`(또는 `min-h-11`)을 넣고, 보드의 감싸는 요소는 지운다 |
| UQ-121 | Minor | A3 | S-13, S-31, S-16, S-17, S-19 | 위와 같음 | `src/components/applications/hub-header.tsx:118, 128`(이름 수정·⋯ `icon-sm`), `:98, 101`(인라인 저장/취소 `sm`), `src/components/applications/drafts-view.tsx:79`(초안 ⋯ `icon-sm`), `src/components/applications/insight-view.tsx:284-299`(보완점 동작 `sm`), `src/components/applications/application-list.tsx:44, 54`(정렬·단계 필터 `SelectTrigger size="sm"`), `src/components/applications/draft-editor.tsx:395, 401, 564, 725, 732`, `src/components/applications/sources-used.tsx:157-245` | A2·A4처럼 768px 미만에서 조작 대상 44px(`size-11 lg:size-8` 또는 `max-md:h-11`) | 기업 JD 관리 화면의 작은 버튼 28개 중 좁은 화면 처리가 된 것은 2곳(트리 행 `min-h-11`)뿐이다. 같은 앱의 커리어·면접 화면과 손 크기 기준이 다르다. A3 리뷰는 트리 행(UQ-80)만 다뤘다 |
| UQ-122 | Minor | foundation (+A4) | S-20 진입 안내 (FL-16) | 02 S-20 진입 안내 "**S-39에서 왔으면** '지원 현황에서 {직무 인터뷰 / 컬처핏} 전형으로 옮겼어요…'" | 판정: `src/components/interviews/interview-prep.tsx:106-112`(출발 메뉴 `board` + `?type=` 있으면 표시). `?type=`를 붙여 S-20으로 가는 다른 링크: `src/components/interviews/result-view.tsx:146`("새 면접 시작하기"), `:241`("면접 준비로"), `src/components/career/writing-chat/gate.tsx:15`(S-36 복귀 대체 경로 `?type=job`), S-31 단계 칩의 C-14(`src/components/common/stage-menu.tsx:458`). 출발 메뉴는 지원 프로젝트별로 sessionStorage에 남는다(`return-target.ts:91-105`) | 보드에서 C-14 "면접 준비하기"를 눌러 온 그 한 번만 안내가 보인다 | 보드에서 기업 JD에 한 번 들어간 뒤(출발 메뉴 = 지원 현황) ① S-22 "새 면접 시작하기"·"면접 준비로", ② S-31 단계 칩으로 인터뷰 열 이동 → C-14, ③ 다른 기기에서 이어 한 S-36의 "직무 면접으로 돌아가기"로 S-20에 오면 "지원 현황에서 직무 인터뷰 전형으로 옮겼어요"가 잘못 나온다. 권장: C-14의 `go()`(공통)가 "보드에서 옮김" 일회용 표시를 sessionStorage에 남기고 S-20이 읽고 지운다. 쿼리는 유형 값만이라는 규칙을 지킬 수 있다 |
| UQ-123 | Minor | A3 | S-14 → S-31 (FL-10) | 02 1.3 "S-39·S-37에서 들어오면 첫 마디가 '지원 현황'", S-39 카드 "클릭 → S-31(이동 경로 '지원 현황 › …')" | `src/components/applications/application-new-form.tsx:55`(토스트 "열기" `router.push(routes.application(id))`) | 보드에서 연 S-14로 만든 기업 JD를 토스트 "열기"로 열면 첫 마디가 "지원 현황"이다(`setNavOrigin("board", id)` 후 이동) | 출발 메뉴를 기록하지 않아 "기업 JD 관리 › …"로 나온다. 보드 카드 클릭과 다른 경로가 된다 |
| UQ-124 | Minor | A3 | S-13 | 디자인 시스템 7 A-7(접근 가능한 이름), 다른 영역의 같은 메뉴: S-39 "{카드} 카드 메뉴"(`kanban-board.tsx:424`), S-37 "{행} 메뉴"(`session-list.tsx:80`), S-17 "{초안} 메뉴"(`drafts-view.tsx:79`) | `src/components/applications/application-list.tsx:204`(`label="행 메뉴"`) | 행 메뉴 이름에 기업 JD 이름이 들어간다(예: "그린뱅크 – 결제 백엔드 엔지니어 메뉴") | 모든 행이 "행 메뉴"라서 스크린 리더에서 어느 기업 JD의 메뉴인지 구분할 수 없다. 같은 공통 `StageCardMenu`를 쓰는 보드와도 다르다 |
| UQ-125 | Minor | A3 (+기획) | S-31 삭제 (FL-06) | 02 FL-06 "확인 체크 후 삭제 → **출발 화면으로** + 토스트" | `src/components/applications/hub-header.tsx:36`(`after: () => router.push(routes.applications())`) | 보드에서 들어온 S-31(첫 마디 "지원 현황")에서 지우면 S-39로 돌아간다(이동 경로의 첫 마디와 같은 곳) | 출발 메뉴와 상관없이 항상 S-13으로 간다. 보드에서 온 사용자는 이동 경로가 가리키던 곳과 다른 목록에 떨어진다. "출발 화면"이 S-31 자신인지, S-31에 들어오기 전 화면인지는 명세가 정하지 않아 기획 확인 목록(K-29)에도 넣었다 |
| UQ-126 | Minor | A3 | S-19 (C-04 중단) ↔ S-36 | 02 3.0 ST-AI-FAILED "`canceled` 실패로 표시하지 않음 … '사용량은 차감되지 않았습니다'", 공통 상수 `AI_NOT_CHARGED`(`src/lib/data/labels.ts:72`) | `src/components/applications/draft-editor.tsx:469`("생성을 중단했어요. 사용량은 차감되지 않았어요"), 비교: `src/components/career/writing-chat/chat-screen.tsx:605`("중단했어요 · 다시 보내기") | 중단 안내의 미차감 문장은 공통 상수 그대로 쓴다 | S-19만 "…않았어요"로 어미가 다르다. 두 영역의 중단 문구가 서로 달라 같은 동작이 다른 말로 보인다(둘 다 [UI-가정]. 기획 확인 K-15와 함께 정리) |
| UQ-127 | Minor | ui-designer | 전 영역 | 디자인 시스템 2장 button `default`(h-10 = 40px) · `sm`(h-8) ↔ 같은 표 "좁은 화면에서 터치 대상은 최소 44px" ↔ 7 A-4 | 적용 차이: `src/components/interviews/answer-sheet.tsx:340`(`max-md:h-11` 주 버튼), `src/components/career/*`(아이콘만 `size-11 lg:size-8`), `src/components/applications/*`·`src/components/common/*`(없음) | 어떤 크기의 어떤 조작 요소에 768px 미만 44px를 적용하는지(기본 40px 버튼 포함 여부, 글자 링크, Select 트리거) 한 줄 규칙과 권장 클래스가 있다 | 문서가 "최소 44px"만 말하고 기본 버튼이 40px라서 영역마다 해석이 갈렸다(A4는 주 버튼까지, A2는 아이콘 버튼만, A3·공통은 거의 없음). 규칙이 정해지면 UQ-120·121 범위가 확정된다 |
| UQ-128 | Minor | ui-designer | 자동 저장이 아닌 제출 실패 (S-14, S-31, S-03, S-25, S-36 폼 전환) | 02 3.0 ST-SAVE-FAILED "v3와 같음"(원문 없음), C-06 "저장 실패 — 다시 시도" | `src/components/applications/application-new-form.tsx:152`("저장 실패 — 다시 시도해 주세요. 입력한 내용은 그대로 있어요"), `src/components/applications/hub-header.tsx:94`("저장 실패 — 다시 시도해 주세요"), `src/components/account/consent-form.tsx:188`("동의 내용을 저장하지 못했어요. 다시 시도해 주세요"), `src/components/account/withdraw-form.tsx:71`, `src/components/career/writing-chat/chat-screen.tsx:540` | 제출 실패 문장 틀 하나("{무엇}을 저장하지 못했어요. 입력한 내용은 그대로 있어요" 등)가 디자인 시스템 4장에 있다 | 영역마다 문장 구조가 다르다("저장 실패 — …" / "…하지 못했어요. …"). 기획 원문(K-1)이 없으면 ui-designer가 틀을 정하는 것이 맞다 |

## 이월 항목 (영역 리뷰에서 열린 채 넘어온 것, 다시 세지 않음)

| ID | 심각도 | 상태 | 메모 |
|----|--------|------|------|
| UQ-90 | Major | 기획 대기 | 탈퇴 시 `usage_events` 삭제 여부 — S-25·S-30 고지 문구 충돌(K-16) |
| UQ-82 | Minor | 기획 대기 | 경력 완료 조건에 종료월 포함 여부(K-22) |
| UQ-83 | Minor | 미해결 | S-36 넓은 화면의 탭 패널 의미 |
| UQ-85, UQ-86, UQ-87 | Minor | 미해결 | S-19 스트리밍 카드 role/origin 배지, 서버 거절 안내, 복귀 대상 consume 범위(UQ-87은 영역 간 문제이지만 A3 리뷰에서 이미 냄) |
| UQ-50, UQ-51 | Minor | 미해결 | C-16 확인 단계 첫 포커스, S-22 세션 다시 시도 작업 선택 |
| UQ-92 | Minor | 수용 | 탈퇴 mock이 재시드 — 공용 dev 서버에서 탈퇴 금지 안내 필요(리더) |
| UQ-5, UQ-21 | Minor | 기록 | 규칙·리더 승인 항목 |

## 기획 확인 필요 — 전체 통합 (중복 제거)

출처 표기: D = 디자인 시스템 노트 P-x · A0 = A0 보고/A0 QA · A1 = P-A1-x · A2 = A2 보고/리뷰 · A3 = P-A3-x/A3 보고 · A4 = A4 보고/리뷰 · Q4 = 이번 통합 검수.

### 문서 공백 (원문 부재)

| # | 화면 | 내용 | 출처 |
|---|------|------|------|
| K-1 | S-01~S-03, S-12, S-14~S-19, S-22, S-24, S-28, S-30, S-33, C-02, C-08, ST-EMPTY/LOADING/UNAUTH/NOTFOUND/SAVE-FAILED | 02가 "v3와 같음"이라 적은 세부 명세(문구·구성·상태)의 v3 원문이 저장소에 없음. 관련 [UI-가정] 대부분이 여기서 나옴(S-28 오류 문구, C-02 "변경됨" 설명, S-12 빈 상태, S-13 빈 상태 제목, S-14 안내·짧은/긴 공고 경고(U-6), 설정 구성, 처리방침 본문 등) | D P-6, A0, A0 QA P-QA-2, A1 P-A1-5, A2, A3 P-A3-4, A4 |

### 공통 컴포넌트·셸

| # | 화면 | 내용 | 출처 |
|---|------|------|------|
| K-2 | C-05 | 기업 JD 삭제 확인 체크 문구 | D P-1 |
| K-3 | C-05 | 초안·면접 세션 삭제의 "하위 개수" 문구, 경력·교육 삭제 시 연쇄 문구 | A0, A3 |
| K-4 | C-17 / S-22 | 항목 등급 화면 라벨, D-14 미정인 지금 항목별 등급·다음 연습을 보여도 되는지 | D P-2, A0, A4 |
| K-5 | S-15 | `importance = 'high'` 요건 라벨 | D P-3 |
| K-6 | S-39 | 빈 열 문구, 키보드 드래그 안내 문구 | D P-4, A4 |
| K-7 | S-36 | 1280px 미만 탭 전환(명세는 모바일만) | D P-5 |
| K-8 | C-03 | 인사이트·면접 질문 생성 완료 토스트 문구 | A0 |
| K-9 | L-01 | 모의 면접 배지 두 수(작성 중 / 새 결과)를 보이는 방식 | A0 |
| K-10 | C-12 / S-31·S-39 | 결과 지우기 확인 설명·"지우고 옮기기" 버튼 문구, 결과 기록 완료 알림 문구 | A0 QA R2 |
| K-11 | C-14 | 컬처핏 팝업 설명 문구(명세는 "…"로 생략) | A0 QA R2 |
| K-12 | C-12 | 키보드 경로: "카드에 포커스 후 Enter로 메뉴" ↔ 카드 본문이 S-31 링크라 Enter는 S-31로 감 | A4 |
| K-13 | C-02 | 정량 성과 "원본으로 이동"(S-11은 모달이라 라우트 없음) — 현재 S-35/S-09 `?achievement=`로 모달 자동 열기 | A0 QA P-QA-1 |

### AI 동작

| # | 화면 | 내용 | 출처 |
|---|------|------|------|
| K-14 | S-22 | 답변 하나 "다시 채점"의 작업 단위·사용량 | A4 |
| K-15 | C-04 / S-36 / S-19 / S-33 | 사용자가 중단한 턴·생성의 처리와 문구(실패로 볼지, 부분 응답 저장, 질문 생성 중단 허용과 중단 후 세션 상태) | A2 (UQ-64), A4, Q4 (UQ-126) |

### 계정 (A1)

| # | 화면 | 내용 | 출처 |
|---|------|------|------|
| K-16 | S-25, S-30 | **탈퇴 시 `usage_events` 삭제 여부**(04 DM-1 전체 연쇄 ↔ 04 §4.4 13개월 보관). 재가입으로 월 한도 우회 문제 포함 — Major UQ-90 | A1 P-A1-1 |
| K-17 | S-03 | 5개 `consent_type`의 필수/선택 구분(특히 국외 이전), 선택 항목 라벨·설명 | A1 P-A1-2 |
| K-18 | S-03 | 정책 버전 갱신 시 재동의 화면(진입 시점·문구·거부 처리) | A1 P-A1-3 |
| K-19 | S-25 | 확인 형식(입력 단어 '탈퇴' vs 체크) | A1 P-A1-4 |
| K-20 | S-30 | 국외 이전 수령자(제공자·국가·보관 기간) 고지 | A1 P-A1-6 |
| K-21 | S-24 / S-02 | 필수 동의 철회를 화면에서 허용하는지 / 매직 링크 유효 시간·재발송 간격 | A1 P-A1-7, A1 보고 |

### 커리어 (A2)

| # | 화면 | 내용 | 출처 |
|---|------|------|------|
| K-22 | S-09 | 종료월이 경력 완료 조건인지(02 S-09 필수 ↔ 04 2.2 완료 판정) — UQ-82 | A2 |
| K-23 | S-36 | 메시지 상한 40에 AI 답이 걸칠 때 처리(현재 답까지 들어갈 때만 전송) — UQ-77 | A2 |
| K-24 | S-36 | 진행 단계 "기본 정보"에 상세 내용 제목 포함 여부 / 소속 "없음"과 "대화하면서 정할게요" 구분 / 실패한 턴을 다시 보내 성공한 뒤 실패 메시지 기록 유지 | A2 |
| K-25 | S-08 | 프로젝트 행 삭제 메뉴 허용(명세는 경력·교육 머리만) | A2 |
| K-26 | S-35 / S-09 / S-11 | G-4 예시 문구·2,000자 상한 확정 / 게이트 경로 경력 저장 완료 문구 / `achievements.kind` 생성값 목록 | A2, A0 |

### 기업 JD (A3)

| # | 화면 | 내용 | 출처 |
|---|------|------|------|
| K-27 | S-19 | 경력기술서 재생성 = 새 `drafts` 행(AI-03) vs 덮어쓰기(D-DM-06), 자소서를 근거 변경 없이 다시 생성 허용(1회 차감) — UQ-64 문구가 이에 달림 | A3 P-A3-1, A3 보고 |
| K-28 | S-18 | 생성된 문항 삭제 시 확인 필요 여부(C-05 대상에 S-18 없음), 기본 3문항 글자 수·문구, 남은 횟수 < 문항 수일 때 "전체 생성" | A3 P-A3-2, A3 보고 |
| K-29 | S-31 / FL-06 | 지원 프로젝트를 S-31에서 지운 뒤 "출발 화면"이 어디인지(S-13 고정 vs 들어오기 전 메뉴) — UQ-125 | Q4 |
| K-30 | S-16 / S-31 | F-P2-07 "데이터 변경됨" 판단 기준(근거 상태 vs `career_snapshot_hash`), 기존 결과가 있을 때 C-09 표시 위치, 보완점 대응 3종 라벨 | A3 P-A3-3, A3 보고 |
| K-31 | S-17 / S-19 | "AI에게 맡기기"와 "직접 고르기"의 화면 차이, AI-11 실패 시 출처 표시, `drafts.status` 화면 라벨 | A3 보고 |
| K-32 | S-16 → 커리어 | 인사이트의 근거·프로젝트 링크로 커리어에 갈 때도 C-10 복귀 배너를 띄우는지(현재 [UI-가정]으로 띄움, 명세는 C-09 경로만 언급) | Q4 |

### 면접·보드 (A4)

| # | 화면 | 내용 | 출처 |
|---|------|------|------|
| K-33 | S-33 | 답변 5,000자 상한 표시, 제출 전 경고 문구와 "짧은 답변" 기준(현재 50자 미만) | A4 |
| K-34 | S-20 | 작성 중 세션 배너·그만두기 확인 문구, 작성 중 세션이 있을 때 "시작하기" 처리(현재 비활성) | A4 |
| K-35 | S-37 | 그만둔 세션 행을 누르면 가는 곳(현재 S-33 읽기 전용) | A4 |

**합계: 35건** (K-1~K-35). 먼저 처리할 것: K-16(Major UQ-90, 법적 고지 충돌), K-1(대부분의 [UI-가정]의 원인), K-27·K-22(데이터 동작에 영향).

## 재확인 결과

통합 라운드 1이라 새로 연 이슈의 재확인은 없음. 영역 리뷰에서 열린 항목은 "이월 항목" 표에 상태를 적었다(재발 0).

## 기계 검사 출력

- `pnpm lint` (`eslint`): 오류·경고 0, exit 0
- `pnpm typecheck` (`tsc --noEmit`): exit 0
- `pnpm build`: exit 0. `✓ Generating static pages using 11 workers (36/36)`. `/` `/_not-found` ○, 나머지 34개 라우트 ◐ Partial Prerender
- `pnpm exec next dev -p 3700`(확인 후 종료, 포트 해제 확인): `/`, `/sign-in?next=%2Fboard`, `/consent?next=%2Fboard`, `/career`, `/career?state=return-banner`, `/board`, `/board?state=empty`, `/applications`, `/applications/new?from=board`, S-31(ap1·ap6), S-16(+`insufficient`), S-17, S-19 ×2, S-18, S-20(`?type=job`, `?type=culture_fit&state=from-board`, `?state=insufficient`), S-33, S-22, 다른 지원 프로젝트 세션 섞은 S-33(→ 찾을 수 없음), `/interviews`, S-36 게이트 진입 3종(insight / job_interview + `experience_id` / cover_letter), `/career/experiences/new`, S-10 새·편집 `?requirement_id=`, `/settings`, `/policies` — 32개 모두 200, 로그 `Error`/`⨯` 0건
- 브라우저: 연결된 Chrome 없음 → 클릭·포커스·sessionStorage 흐름(출발 메뉴, C-10, C-14, 서랍)은 코드 판독만 함. 리더나 사람이 한 번 눈으로 확인하기를 권함: ① 보드 → 카드 → S-31 → S-22 → "새 면접 시작하기"에서 S-20 안내(UQ-122), ② 375px에서 S-13 카드 ⋯·S-31 단계 칩·C-10 버튼 크기(UQ-120), ③ C-09(S-18) → S-09 → S-36 → 저장하고 돌아가기 → S-18 문항 복원
