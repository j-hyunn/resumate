# UI32 — 교육 표시 이름 = 교육 명 (부분 수정, 2026-11-04)

## 범위
- 사용자 요청: 교육의 표시 이름은 교육 명(`program_name`), 비면 운영 기관(`institution_name`). UI(S-08·S-34)는 32 런에서 반영됨 — 규칙: `src/components/career/education-name.ts` (trim 후 `program_name || institution_name || null`).
- 수정 대상(spec-gaps UI32-1, UQ-734):
  1. `src/server/services/career/read.ts` `getCareerList` (~59·64): select에 `program_name` 추가, `name` = 규칙 적용 — C-23 소속 선택·S-10 소속 목록.
  2. 같은 파일 `getProjectDetail` (~120·127): S-10 브레드크럼 부모 교육 이름.
  3. `src/lib/data/career-v45.ts` ~268 새 프로젝트 페이지 실제 분기 (`panel.education.institutionName` 사용처) — 이름 표시가 규칙을 따르게. 
- 제외: 근거 칩(`evidence.ts`), 서류(`drafts`), 작성 대화 파이프라인, AI 컨텍스트 팩 — 기획 확인(UQ-739) 뒤.

## 계약
- DB 변경 없음(마이그레이션 없음). 계약 DTO 모양 유지 — 기존 `name` 필드의 값만 바뀜. 필드 추가가 필요하면 최소로, notes에 기록.
- 규칙은 서버 쪽에도 하나의 순수 헬퍼로(예: `src/server/services/career/` 내) 두고 테스트. UI 헬퍼(components/)는 UI 소유라 import하지 말 것.

## 담당
- api-engineer: 위 1–3 + 단위 테스트.
- backend-qa: 경계 확인(계약 ↔ 서비스 ↔ 화면 사용처), run-checks.

## 릴리스 영향
- 파괴적 마이그레이션·새 env 없음. UI 32 런 변경과 같은 머지로 나가면 화면이 일관됨.
