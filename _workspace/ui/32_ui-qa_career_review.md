# 32 런 UI QA — A2 커리어 (빈 상태 레이아웃 · 교육 이름 표시)

작성: ui-qa, 2026-11-04. 대상: 커밋 안 된 `git diff`(4파일) + 신규 `src/components/career/education-name.ts`.
기준: 사용자 요청(브리프 `32_brief_career-empty-education-name.md`)이 S-08 빈 상태 기획(02-user-flows.md:1188)보다 우선. 기획과의 차이는 `기획 확인 필요`로만 기록.
브라우저 확인: 하지 않음(리더 담당) — Q12 **미확인**. 아래 레이아웃 판단은 코드상 부모 체인 추적 결과다.

## 요약

| 항목 | 결과 |
|------|------|
| Critical | 0 |
| Major | 1 (UQ-734, 백엔드 — S-10·C-23 실제 경로 교육 이름) |
| Minor | 4 (UQ-735~UQ-738) |
| 기획 확인 필요 | 1 묶음 (UQ-739) |
| 기계 검사 | 4종 모두 통과 (lint · typecheck · test 127파일/1990개 · build) |

S-08 자체는 요청대로 구현됐다. 빈 커리어: "커리어 추가" 1개가 "커리어" 머리 밑, 왼쪽 칸 안내 가운데, 오른쪽 EmptyState 버튼 없이 가운데. 항목이 있을 때 회귀 없음. **S-08 실제 경로는 `program_name`을 받는다**(아래 3). 남은 차이는 S-08 밖의 커리어 표면(S-10 이동 경로, C-23 소속 선택, 새 프로젝트 페이지)의 실제 경로가 서버에서 `institution_name`을 이름으로 받는 것 — 미리보기(mock)와 실제가 다르게 보인다.

## 확인 결과

### 1. 빈 커리어 레이아웃 (S-08)

부모 체인 (`src/app/(dashboard)/layout.tsx:31` → `:41` → gated layout → `career/page.tsx` → `career-overview.tsx:191`):
- `SidebarInset`(`<main>` `flex flex-1 flex-col`, `h-dvh` / `lg:h-[calc(100dvh-1rem)]`, `overflow-y-auto`) → `#main`(`flex flex-1 flex-col`) → `Suspense`/`ConsentGate`(fragment `<>{children}</>`)/`ScreenSuspense`(Suspense) — DOM 없음 → `PageCrumbs`는 `null` 반환 → `CareerOverview` 루트 `flex flex-1 flex-col lg:flex-row`.
- 높이가 고정된 열 방향 flex 안에서 `flex-1`이 끝까지 이어지므로 루트는 남은 높이를 채운다. 확인.

| 경우 | 넓은 화면 (lg) | 좁은 화면 | 판정 |
|------|----------------|-----------|------|
| 빈 커리어, `?item=` 없음 | 가로 배치, 기본 `align-items: stretch`로 두 칸 모두 전체 높이. 왼쪽 nav `lg:flex-none lg:w-60`, `<p flex-1 items-center justify-center>`가 머리·버튼 아래 남은 높이 가운데. 오른쪽 section `flex-col` 안 `div.flex-1.items-center.justify-center`로 EmptyState 가운데 | nav `flex-1`(empty일 때)로 전체 높이 → 안내 가운데. section `hidden`(`!showDetailOnNarrow`) — 안내 중복 없음 | 통과 |
| 빈 커리어, `?item=…` (없는 항목) | 위와 같음 + "찾을 수 없는 항목이에요" 토스트 | `requestedItem` undefined → `showDetailOnNarrow=false` → 목록 칸만 | 통과 |
| 항목 있음, `?item=` 없음 | 기존과 같음(첫 항목 선택) | 목록만 (`hidden lg:flex` 조건이 `items.length>0`에서 무조건으로 바뀌었지만 항목이 있을 때는 결과 같음) | 통과 |
| 항목 있음, `?item=` 유효 | 기존과 같음 | 목록 숨김, 상세 + "← 커리어" | 통과 |
| 마지막 항목 삭제 | `select(null)` → 빈 레이아웃 | 목록 칸(버튼+안내)으로 돌아감 | 통과 |
| 첫 항목 추가 직후 | `justAdded`로 토스트 억제, 새로고침 전까지 빈 안내, 그 뒤 선택 | 새로고침 전 목록 칸, 뒤에 상세 | 통과 |

- 버튼: `AddCareerMenu` 하나, `default`(primary) `w-full`, 메뉴 `align="start"` (career-overview.tsx:199, :260~265). 화면의 primary 1개 — UQ-718 유지. UQ-723(빈 상태에서 목록 버튼 숨김)은 사용자 요청으로 대체됨.
- 오른쪽 EmptyState: `actions` 없음, 문구는 기획 1188행 문구 그대로(career-overview.tsx:224~229).
- `?state=empty`: `careerPreviewView`가 `empty`에 `null`을 돌려주고(screen-state.tsx:51) page.tsx:28이 트리를 비운다 → 위 빈 레이아웃이 그대로 보인다. 통과.
- `placement` prop 제거 뒤 남은 사용처·미사용 import 없음(lint 통과).

### 2. 항목이 있을 때 회귀

- 목록(`CareerList`)·선택 강조·URL 갱신·상세 패널·머리 메뉴·삭제 흐름 코드 변경 없음.
- nav에 `lg:flex-none` 추가 — 원래 `shrink-0`·grow 0이었으므로 넓은 화면 폭(w-60) 동작 같음.
- 추가 메뉴 정렬: 원래 목록 버튼은 `align="start"` → 그대로.

### 3. 교육 표시 이름 (`program_name` → `institution_name` 대체)

| 표면 | 코드 | 미리보기 | 실제 경로 | 판정 |
|------|------|----------|-----------|------|
| S-08 목록 행 | career-overview.tsx:66, :338 | 새 규칙 | `getCareerTree` → `realCareerTree` → `loadCareerData` → `loadCareerRows`가 `educations.select("*")`(src/server/services/career/rows.ts:26) → `program_name` 포함 | 통과 |
| S-08 상세 제목·⋯ 메뉴 aria-label·삭제 확인 label | career-overview.tsx:361~378 | 새 규칙 | 같은 트리 | 통과 |
| S-34 교육 편집 브레드크럼 | educations/[id]/page.tsx:30 | 새 규칙 | `getEducation` → `readCareer` → 같은 `select("*")` | 통과 |
| S-34 `EducationForm` 제목 | education-form.tsx:102 | 입력값 따라 | 같음 | 통과 |
| S-10 이동 경로(부모 이름) | lib/data/career-v45.ts:171~ / :259~ | `mockAffiliationName` 새 규칙 | `getProjectDetail` `parent.name = edu.institution_name`(server/services/career/read.ts:120, :127), 새 프로젝트 `panel.education.institutionName`(lib/data/career-v45.ts:268) | **불일치 → UQ-734** |
| S-10 소속 목록 / C-23 소속 선택 | lib/data/career-v45.ts:182, :671~690 | `mockAffiliations`·`mockAffiliationOptions` 새 규칙 | `getCareerList` `name: r.institution_name`(read.ts:59, :64) | **불일치 → UQ-734** |

- `educationName`: `trim()` 후 `||` — 공백만 있는 교육 명도 기관으로 대체. 둘 다 비면 `null` → "이름 없는 교육" / "새 교육" / "교육". 타입 `Pick<Education, "program_name" | "institution_name">` — `types/db.ts` 이름과 일치.
- 추가 모달 매핑(add-career-dialog.tsx:129~130, :173~174) 교육 명 → `program_name`, 운영 기관 → `institution_name` — 규칙과 일치.

### 4. 상세 "교육 정보" 행

- career-overview.tsx:420~433: "교육 기간"(기간 · 상태) + "운영 기관 `institution_name`". 이전 "전공/과정명 `program_name`"은 제목으로 옮겨 중복 없음. 누락: 기획 1219행 "구분 `education_type`"은 원래도 패널에 없었음(기존 차이, UQ-739에 함께 기록).
- 교육 명이 비어 제목이 기관으로 대체되면 "운영 기관" 행과 같은 값이 두 번 보인다 — 엔지니어 [UI-가정]으로 둠. 문제 삼지 않음.

### 5. 접근성 · 토큰

- 제목 구조: nav `h2 "커리어"`, 연도 `h3`, 상세 머리 `h3`, 빈 상태 EmptyState `h2`(state-views.tsx:49). 이전과 같음.
- 랜드마크: `nav aria-label="커리어 목록"`, `section aria-label="커리어 상세"` 유지. 빈 목록 안내는 `<p>`라 nav 안에서 읽힘.
- ⋯ 버튼 `aria-label={`${name} 메뉴`}`, 삭제 대상 `label: name` — 새 이름 사용. 통과.
- 색은 `text-muted-foreground`만, 직접 지정 색 없음. 공용 `EmptyState` 사용.

## 이슈

### UQ-734 [Major] S-10·C-23·새 프로젝트 실제 경로가 교육 이름으로 `institution_name`을 받음 — owner: 백엔드(api-engineer, 리더 경유 백엔드 요청)
- 요청: 커리어 화면 전체에서 교육 이름 = 교육 명(비면 운영 기관). mock(`src/lib/mock/career-v45.ts:262~263`)은 이미 새 규칙.
- 실제: `src/server/services/career/read.ts:59·64`(`getCareerList` — `program_name` select 안 함, `name: r.institution_name`), `read.ts:120·127`(`getProjectDetail` parent name), `src/lib/data/career-v45.ts:268`(새 프로젝트 페이지, wired 함수).
- 영향: 실제 데이터에서 S-08 목록은 "클라우드 백엔드 부트캠프"인데 그 교육의 S-10 프로젝트 브레드크럼·C-23 소속 선택·S-10 소속 변경 목록은 "코드스쿨"로 보인다. 미리보기와 실제가 다름.
- 기대: 세 곳 모두 `program_name`(trim) 비면 `institution_name`. 근거 칩·서류 경로(`evidence.ts`, `drafts.ts`, writing-chat)는 기획 결정 뒤(UQ-739).
- 엔지니어 보고 6절과 같음 — UI 쪽 변경 없이 백엔드 요청으로 넘김.

### UQ-735 [Minor] 교육 이름 규칙이 두 곳에 복제됨 — owner: foundation
- `src/components/career/education-name.ts:9~11`과 `src/lib/mock/career-v45.ts:262~263`(`educationDisplayName`)이 같은 식. `lib/`가 `components/`를 import하지 않으려는 복제로 보이나, 백엔드가 UQ-734를 고치고 근거 칩·서류로 넓어지면 세 번째 사본이 생길 수 있다.
- 기대: `src/lib/data/labels`(또는 비슷한 공용 위치)로 하나만 두고 컴포넌트·mock이 함께 쓴다(엔지니어 7절 제안과 같음).

### UQ-736 [Minor] `educationName` 단위 테스트 없음 — owner: A2 커리어
- `src/components/career/` 테스트는 `star-proposal-fill.test.ts`뿐이고 `CareerOverview`·`educationName` 테스트 없음.
- 기대: 교육 명 있음 / 공백만 / null → 기관 / 둘 다 비면 null 네 경우. 빈 커리어에서 "커리어 추가" 1개·EmptyState 버튼 없음을 확인하는 렌더 테스트가 있으면 UQ-723 같은 되돌림을 막는다.

### UQ-737 [Minor] 넓은 화면 빈 상태에서 두 안내의 세로 중심이 어긋날 수 있음 — owner: A2 커리어 (브라우저 확인 뒤 판단)
- 왼쪽 `<p flex-1>`(career-overview.tsx:204)는 머리·버튼(약 h2 20px + 버튼 36px + gap 32px) **아래 남은 높이**의 가운데, 오른쪽 EmptyState(:224)는 **칸 전체 높이**의 가운데 → 왼쪽 안내가 약 40~45px 아래에 온다. 또 왼쪽은 `text-sm` 한 줄, 오른쪽은 아이콘+제목+설명이라 크기가 다르다.
- 요청("각 칸 안 가운데")은 만족. 리더 브라우저 확인에서 어색하면 맞춘다. 고칠 것이 없으면 닫는다.

### UQ-738 [Minor] 디자인 시스템 ST-EMPTY 배치와 다름 (문서 갱신) — owner: ui-designer
- `docs/ui/design-system.md:1269` ST-EMPTY "콘텐츠 영역 위쪽 1/3". S-08은 사용자 요청으로 칸 세로 가운데 + 버튼 없음 + 왼쪽 칸 `text-sm` 안내 한 줄.
- 기대: P-15(design-system.md:2073, S-08 시각 규칙 미정리)에 S-08 빈 상태 예외(칸 가운데, 버튼은 목록 머리 하나)를 기록.

### UQ-739 [기획 확인 필요] S-08·S-34·C-23 문서 갱신 — owner: 기획 (리더 → resumate-planning)
- 02-user-flows.md:1188 빈 상태: 문서 "왼쪽은 커리어 추가만, 오른쪽 … + 주 버튼 '커리어 추가'" ↔ 사용자 결정(2026-11-04) "버튼은 목록 머리 하나, 각 칸 안내 문구만 가운데". 왼쪽 칸 문구("아직 추가한 커리어가 없어요", career-overview.tsx:204)도 정해야 함.
- 02-user-flows.md:1183 항목 행, :1217 S-34 제목: `educations.institution_name` → `program_name`(비면 `institution_name`).
- 02-user-flows.md:1219 교육 정보 보기: "전공/과정명 `program_name`" → "운영 기관 `institution_name`". "구분 `education_type`"은 구현 패널에 없음(기존 차이).
- 02-user-flows.md:1059 C-23 교육 목록 이름 규칙.
- S-34 편집 라벨: 문서·`EducationForm`(education-form.tsx:126·152) "기관명 *", "전공/과정명" ↔ 추가 모달 "교육 명", "운영 기관 *". 하나로 통일 필요.
- 근거 칩·서류·작성 대화에서의 교육 이름(evidence.ts:87~150, drafts.ts:135, writing-chat-view.ts:90)도 같은 규칙인지.

## 기계 검사

| 검사 | 결과 |
|------|------|
| `pnpm lint` | 통과 (exit 0, 경고 없음) |
| `pnpm typecheck` | 통과 (exit 0) |
| `pnpm test` | 통과 — Test Files 127 passed, Tests 1990 passed |
| `pnpm build` | 통과 — Compiled successfully, 정적 페이지 45/45, `/career`·`/career/educations/[id]` 부분 사전 렌더(◐) |

## 재확인 (이전 이슈)

| ID | 상태 | 메모 |
|----|------|------|
| UQ-718 | 해결 유지 | 화면 primary 1개 |
| UQ-723 | 대체(사용자 요청) | 빈 커리어에서도 목록 머리 버튼 1개, EmptyState 버튼 없음 |
