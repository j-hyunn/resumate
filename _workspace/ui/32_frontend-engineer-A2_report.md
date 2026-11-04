# 32 런 — A2 커리어 보고 (빈 상태 레이아웃 · 교육 이름 표시)

작성: frontend-engineer (A2), 2026-11-04. 커밋 안 함.

## 1. 바꾼 것

### 요청 1 — 빈 커리어 레이아웃 (S-08)
리더 선반영 diff를 검토하고 아래를 고쳤다.
- "커리어 추가"(C-22)는 데이터 유무와 상관없이 왼쪽 "커리어" 목록 머리 아래 하나만. 오른쪽 EmptyState는 버튼 없이 제목·설명만 (리더 반영 그대로 유지). 화면의 primary 버튼은 1개 (UQ-718 유지, UQ-723 대체).
- `AddCareerMenu`의 `placement` prop 제거는 맞음 — 호출처가 하나뿐이라 불필요. 남는 미사용 import 없음 (lint 통과).
- **세로 가운데 정렬 확인:** 부모 체인 `SidebarInset(flex-col, h-dvh)` → `#main(flex-1 flex-col)` → `ScreenSuspense`/`ConsentGate`(fragment) → `CareerOverview` 루트(`flex-1`)가 끝까지 늘어나므로, 넓은 화면(lg 가로 배치, stretch)에서는 왼쪽 `<p flex-1>`와 오른쪽 `<div flex-1>`가 각 칸 높이 가운데에 온다.
- **좁은 화면 수정 (리더 diff의 문제):** 기존 조건 `!showDetailOnNarrow && items.length > 0`이면 빈 커리어일 때 좁은 화면에서 목록 칸(버튼 + 안내)과 상세 칸(EmptyState)이 위아래로 둘 다 보여 안내가 겹쳤다. 이제 버튼이 목록에 있으므로 상세 칸은 URL에 항목이 있을 때만 좁은 화면에 보인다(`!showDetailOnNarrow && "hidden lg:flex"`).
- 빈 커리어일 때 좁은 화면에서 목록 칸에 `flex-1`을 줘서(넓은 화면은 `lg:flex-none`, 폭 w-60 유지) 안내 문구가 남은 높이 가운데에 오게 했다.

### 요청 2 — 교육 이름 = 교육 명 (`program_name`), 비면 운영 기관 (`institution_name`)
- 새 헬퍼 `educationName()` — `program_name`(trim) → `institution_name`(trim) → null. 빈 문자열도 대체되도록 `??` 대신 `||`.
- 적용 표면:
  - S-08 목록 행, 상세 패널 제목, 머리 메뉴/삭제 확인에 쓰는 이름 (`itemName`)
  - S-08 교육 상세 "교육 정보" 행: "전공/과정명 program_name" → "운영 기관 institution_name" (리더 반영 유지 — 제목이 교육 명이 됐으니 행에는 기관을 보인다)
  - S-34 교육 편집 페이지 브레드크럼 (`career/educations/[id]/page.tsx`)
  - S-34 `EducationForm` 페이지 제목 (값이 바뀌는 대로)
  - mock: `mockAffiliationName` / `mockAffiliations` / `mockAffiliationOptions` (S-10 이동 경로 이름, S-10 소속 목록, C-23 소속 선택 — 미리보기 경로)
- 추가 모달(add-career-dialog.tsx) 매핑은 이미 교육 명→`program_name`, 운영 기관→`institution_name`이라 변경 없음.

## 2. 파일
- `/Users/jehyun/Resumate/.claude/worktrees/career-layout-education-display-322aba/src/components/career/career-overview.tsx` (수정)
- `/Users/jehyun/Resumate/.claude/worktrees/career-layout-education-display-322aba/src/components/career/education-name.ts` (신규)
- `/Users/jehyun/Resumate/.claude/worktrees/career-layout-education-display-322aba/src/components/career/education-form.tsx` (제목)
- `/Users/jehyun/Resumate/.claude/worktrees/career-layout-education-display-322aba/src/app/(dashboard)/(gated)/career/educations/[id]/page.tsx` (브레드크럼)
- `/Users/jehyun/Resumate/.claude/worktrees/career-layout-education-display-322aba/src/lib/mock/career-v45.ts` (이름 목록 3곳 — 리더 지시로 foundation 파일 수정)

## 3. 검사
| 검사 | 결과 |
|------|------|
| `pnpm lint` | 통과 (출력 없음) |
| `pnpm typecheck` | 통과 |
| `pnpm vitest run src/lib/data src/components/career` | 16 파일 / 150 테스트 통과 |
| `pnpm test` (전체) | 127 파일 / 1990 테스트 통과 |
| `pnpm build` | 실행 안 함 |
| 브라우저 확인 | **안 함** (mock·브라우저 미확인). `/career?state=empty`를 넓은·좁은 화면에서, 교육 1건 있는 실제 데이터로 목록 행·패널 제목·S-34 브레드크럼을 확인해야 함 |

## 4. [UI-가정]
- S-08 빈 목록 칸 안내 문구 "아직 추가한 커리어가 없어요" (리더 문구 유지, 기획에 문구 없음).
- 좁은 화면 빈 커리어: 목록 칸(커리어 추가 + 안내)만 보이고 상세 칸 EmptyState는 숨김.
- 교육 이름이 기관으로 대체될 때(교육 명 비어 있음) 상세 "운영 기관" 행에도 같은 값이 한 번 더 보인다 — 그대로 둠.
- S-34 `EducationForm` 필드 라벨("기관명" 필수, "전공/과정명")은 기획 S-34 편집 문구대로 두고 제목만 바꿈. 모달 라벨(교육 명 / 운영 기관, 운영 기관 필수)과 다르다.

## 5. 기획 확인 필요 (resumate-planning)
- **S-08 빈 상태 (02-user-flows.md:1188):** 문서는 "왼쪽은 커리어 추가만, 오른쪽 패널에 문구 + 주 버튼 '커리어 추가'". 사용자 결정(2026-11-04)으로 버튼은 왼쪽 목록 머리 하나, 각 칸에 안내 문구만 가운데 → 문서 갱신 필요. 왼쪽 칸 안내 문구도 정해야 함.
- **S-08 항목 행 (02-user-flows.md:1183)** 교육 이름 `educations.institution_name` → `program_name`(비면 `institution_name`)으로.
- **S-34 제목 (02-user-flows.md:1217)** `institution_name` → 같은 규칙. **교육 정보 행 (1219)** "전공/과정명 `program_name`" → "운영 기관 `institution_name`" (구분 `education_type`은 지금 UI 패널에 없음 — 기존 차이).
- **C-23 소속 선택 (02-user-flows.md:1059)** 교육 목록 `educations.institution_name` → 같은 규칙 적용 여부.
- S-34 편집 필드 라벨/필수 항목: 모달(교육 명, 운영 기관*)과 S-34 문서(기관명*, 전공/과정명) 중 하나로 통일 필요.

## 6. 백엔드 요청 (서버가 주는 교육 이름)
실제 경로에서는 아래가 아직 `institution_name`을 교육 이름으로 준다 → 같은 규칙(`program_name` 비면 `institution_name`)으로 바꿔 달라는 요청. mock은 이미 새 규칙이라 그 전까지 미리보기와 실제가 다르다.
1. `src/server/services/career/read.ts` `getCareerList` (59·64행) — 교육 `name: r.institution_name`. `program_name`도 select 필요. 영향: C-23 소속 선택(`listProjectAffiliations` 실제 경로), S-10 새 프로젝트의 소속 목록.
2. `src/server/services/career/read.ts` `getProjectDetail` (120·127행) — `parent.name = edu.institution_name`. 영향: S-10 이동 경로(브레드크럼) 교육 이름.
3. `src/lib/data/career-v45.ts` 새 프로젝트 페이지 실제 경로 (`const name = ... panel.education.institutionName`, 약 266행) — wired 함수라 백엔드 소유로 보고 건드리지 않음. `panel.education.programName || institutionName`으로.
4. 참고(커리어 화면 밖, 판단 요청): `src/server/services/writing-chat/pipelines.ts:44·67`, `src/server/services/drafts/read.ts:334·340`, `src/lib/data/drafts.ts:135`, `src/lib/data/evidence.ts:87·89·98·131·150`(근거 칩 경로·라벨)도 교육을 `institution_name`으로 부른다. 같은 규칙으로 맞출지 기획 결정과 함께 정해야 함.

## 7. foundation 요청
- 없음 (mock 수정은 리더 지시 범위). `educationName`이 커리어 밖(근거 칩·서류)에서도 필요해지면 `lib/data/labels` 등 공용으로 옮기는 것을 제안.
