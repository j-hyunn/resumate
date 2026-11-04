# 32 런 브리프 — 커리어 빈 상태 레이아웃 · 교육 이름 표시 (2026-11-04)

## 요청 (사용자 원문 요지)
1. 커리어에 데이터가 없을 때 기존 레이아웃이 안 보인다. 원래는 "커리어" 칸 밑에 "커리어 추가" 버튼이 있는 형식이었다. 각 칸(왼쪽 목록 / 오른쪽 상세)에 데이터가 없을 때는 안내 문구만 칸 안 가운데에 보여 주는 형식이 좋겠다.
2. 커리어에서 교육을 추가하면 커리어 페이지에 운영 기관이 이름으로 나온다. 교육 명이 이름으로 나와야 한다.

## 범위
- A2 커리어: S-08 (`src/components/career/career-overview.tsx`), 교육 이름을 보여 주는 커리어 화면 표면(목록·상세 머리·교육 상세 브레드크럼 `src/app/(dashboard)/(gated)/career/educations/[id]/page.tsx` 등 UI 쪽).
- 백엔드 소유 파일(`src/server/`, `src/lib/contracts/`, `supabase/`)은 건드리지 않는다. 서버가 돌려주는 이름(read.ts `institution_name`)이 필요하면 백엔드 요청으로 기록.

## 기준
- 기획: 플로우 v5.6 S-08 빈 상태(02-user-flows.md:1188)는 "왼쪽은 커리어 추가만, 오른쪽 패널에 문구 + 주 버튼". 이번 요청은 사용자 결정으로 이를 바꿈 → 기획 확인 필요(문서 갱신은 resumate-planning).
- 커리어 추가 모달(add-career-dialog.tsx): 교육 명 → `program_name`, 운영 기관 → `institution_name`.
- 이전 QA: UQ-718/UQ-723 (한 화면 primary 1개) — 이번 변경으로 버튼은 목록 머리 하나만.

## 리더 선반영 (검토·보완 대상)
리더가 career-overview.tsx에 먼저 넣은 diff(`git diff`)가 있다: 목록 머리 버튼 상시 표시, 빈 목록 가운데 문구, 오른쪽 EmptyState 버튼 제거·가운데 정렬, 교육 이름 = program_name ?? institution_name, 교육 정보 행 "전공/과정명" → "운영 기관".
