# UI32 — api-engineer 노트 (2026-11-04)

## 변경
규칙(UI32-1, UQ-734): 교육 표시 이름 = `program_name.trim()` → 비면 `institution_name.trim()` → 둘 다 비면 `null`(화면 "이름 없는 교육"). UI 헬퍼(`src/components/career/education-name.ts`)와 같은 규칙. 서버 코드는 UI 헬퍼를 import하지 않고 서버 쪽 순수 헬퍼를 쓴다.

| 위치 | 화면 | 변경 |
|------|------|------|
| `src/server/services/career/education-name.ts` (새 파일) | — | `educationDisplayName(programName, institutionName): string \| null`. import 없는 순수 함수 |
| `src/server/services/career/read.ts` `getCareerList` | S-08 목록 · C-23 소속 선택 · S-10/S-43 소속 목록(`career-v45.ts` 215·270·687이 이 목록의 `name`을 씀) | select에 `program_name` 추가, 교육 항목 `name` = 규칙 |
| 같은 파일 `getProjectDetail` | S-10 브레드크럼 부모 이름 | select에 `program_name` 추가, `parent.name` = 규칙 |
| `src/lib/data/career-v45.ts` 새 프로젝트 페이지 실제 분기(~269) | S-10 새 프로젝트 부모 이름 | `panel.education.institutionName` → `educationDisplayName(panel.education.programName, panel.education.institutionName)` (패널 DTO에 이미 `programName`이 있음) |
| `src/lib/contracts/career.ts` `CareerListItem.name` | — | 주석만 고침(값의 뜻). DTO 모양 그대로, 필드 추가 없음 |

- DB 변경·마이그레이션 없음. 새 환경 변수 없음. 계약 DTO 모양 유지(기존 `name` 값만 바뀜).
- UI 소유 파일 수정 없음(페이지·컴포넌트·`src/lib/mock/`·`docs/ui/` 손대지 않음).

## 테스트
- 새 단위 테스트 `src/server/services/career/education-name.test.ts`: program 우선, trim, null/빈 문자열/공백 → 기관, 둘 다 빔 → null.
- `src/server/services/career/career.integration.test.ts`에 로컬 스택 케이스 추가: 새 사용자(carol)로 교육 2개(교육 명 있음 / 공백만) + 교육 소속 프로젝트 → `getCareerList` 이름, `getProjectDetail` `parent.name` 확인. 기존 alice/bob 데이터(준비도 카운트)는 건드리지 않음.

## 확인 결과
- `pnpm typecheck` 통과
- `pnpm lint` 통과
- `pnpm test` 128 파일 / 1995 테스트 통과(로컬 스택 통합 테스트 실제 실행, 스킵 아님)
- `pnpm build` 통과

## 남은 것 — 교육 이름을 기관명으로 쓰는 다른 실제 경로 (지시대로 미수정, UQ-739 기획 확인 대기)
- `src/lib/data/evidence.ts:87·89·98·131·150` — 근거 칩 `source_label`·경로·부모 이름이 `institution_name`.
- `src/lib/data/drafts.ts:135` — 서류 출처 트리 소속 이름 `name: e.institution_name` (meta에 `program_name`).
- `src/server/services/drafts/read.ts:334·340` — 서류 쪽 교육 id → `institution_name` 맵.
- `src/server/services/writing-chat/pipelines.ts:44·67` — 작성 대화 파이프라인 부모 `name`이 `institution_name`.
- `src/server/ai/context-pack/career-pack.ts:296·302·305`, `src/server/ai/pipelines/AI-03.ts:558·587`, `src/server/ai/context-pack/interview.ts:103` — AI 컨텍스트 팩·서류 생성 라벨. 둘 다 필드로 넘기므로 표시 규칙과는 별개(바꿀지 기획 판단).
- `src/lib/data/writing-chat-view.ts:27·90` — 작성 대화 화면에 교육 행(`id, institution_name, status`)을 원본 그대로 넘긴다. 화면이 이것을 이름으로 보여 주면 `program_name`도 넘겨야 함 — 작성 대화 범위라 손대지 않음(필요하면 UI 요청 + 이 함수에 필드 추가).
