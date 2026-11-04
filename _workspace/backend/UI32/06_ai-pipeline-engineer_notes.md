# UI32-2 ai-pipeline-engineer notes — 교육 표시 이름을 AI 근거·출처 라벨에 적용

근거: `05_plan_evidence-labels.md` ai-pipeline-engineer 항목, `03_backend-qa_report.md` QA-01, 사용자 결정(교육 표시 이름 = trim한 `program_name` → 없으면 trim한 `institution_name` → 없으면 null).

## 바꾼 것 (`src/server/ai/` 안만)

| 파일 | 변경 |
|---|---|
| `context-pack/career-pack.ts` | `EDU-n` 별칭 항목의 `label`을 `e.institution_name` 대신 `educationDisplayName(e.program_name, e.institution_name)`로 둔다(서버 헬퍼 `src/server/services/career/education-name.ts` import). `fields`(`institution_name`, `program_name` …)와 팩 텍스트는 그대로다. |
| `context-pack/summary-pack.ts` | AI-11 요약 팩의 교육 줄이 `e.label`을 쓰고 있었다. 라벨이 교육 명이 되면 "교육 명 교육 명"으로 겹치므로 `f.institution_name`으로 바꿨다. 모델이 보는 텍스트는 이전과 같다. |
| `pipelines/AI-03.ts:141` | 교육 섹션 `heading`이 `[e.label, program_name]`이었다. `[fields.institution_name, fields.program_name]`로 바꿔 이전 값("운영 기관 교육 명")을 유지한다. |
| `pipelines/AI-03.ts:558` | 교육 머리글 `institution_name: entry.label` → `entry.fields.institution_name`. 머리글 텍스트("가상대학교 컴퓨터공학 \| 기간 \| 졸업")가 그대로다. |

라벨이 바뀌어 자동으로 따라오는 곳(코드 변경 없음):
- `storage/evidence-links.ts:66` `evidence_links.source_label` (근거 칩)
- `validation/draft-blocks.ts:169` 서류 블록 근거 `source_label`
- `context-pack/selection.ts` `sourceLabel` "부모 › 프로젝트" (AI-04 `draft_section_sources.source_label`, 출처 표시). 프로젝트 별칭의 label은 원래 프로젝트 이름뿐이고, 부모 부분은 `sourceLabel`이 부모 별칭 label에서 가져오므로 `career-pack.ts` 한 곳만 바꾸면 된다.
- `validation/alias-text.ts` `aliasDisplayLabel` 기본 분기: 출력 문장에 남은 `EDU-n` 토큰을 사람이 읽는 이름으로 바꿀 때 이제 교육 표시 이름이 들어간다(화면 문구이므로 규칙과 맞다). 둘 다 비면 null → 토큰 제거(기존 null 처리 그대로).

확인만 하고 둔 곳:
- `context-pack/interview.ts:103–104` 이미 `fields.institution_name`·`fields.program_name`을 쓴다. 변경 없음.
- `AI-04.ts:216`, `AI-05.ts:527` 프롬프트에 넣는 label은 프로젝트 별칭만 쓴다. 교육 라벨이 들어가지 않는다.
- `evidence-rules.ts:44` 교육 인용 가능 필드 목록. 변경 없음.

## prompt_version / input_hash
- 모델에 보내는 텍스트(Career Context Pack, 요약 팩, AI-03 섹션 heading)는 바이트 단위로 같다. `careerSnapshotHash`도 원본 필드로 계산하므로 같다. 그래서 `prompt_version`은 올리지 않았다.
- 바뀌는 것은 저장되는 라벨(`source_label`)뿐이다. 같은 `input_hash`로 재사용되는 이전 결과는 이전 라벨 스냅샷을 그대로 가진다. 기존 행 백필은 db-engineer 범위다.

## 테스트
- `context-pack/career-pack.test.ts` 새 블록 "education label = display name": 교육 명 / 앞뒤 공백 trim / 교육 명 null → 운영 기관 / 교육 명 공백 → trim한 운영 기관 / 둘 다 공백 → null(표 기반 5건), 원본 필드·팩 텍스트 유지, `sourceLabel` 부모 부분("컴퓨터공학 › 캡스톤 분산 캐시", 기관 fallback, 둘 다 비면 프로젝트 이름만), 요약 팩 교육 줄에 교육 명이 한 번만 나오는지.
- `pipelines/AI-03.test.ts`: 교육 머리글 `header`가 `institution_name: "가상대학교"`, `program_name: "컴퓨터공학"`인지 추가. 기존 heading("가상대학교 컴퓨터공학")·머리글 텍스트 단언은 수정 전 코드에 라벨만 바꾸면 실패한다(회귀 보호).
- fixture(`__fixtures__/career-rows.ts`)는 바꾸지 않았다. 테스트 안에서 교육 행을 덮어쓴다.

## 실행 결과
- `npx vitest run src/server/ai`: 46 files, 966 tests 통과
- `npx eslint src/server/ai`: 통과
- `npx tsc --noEmit`: 첫 실행 통과. 두 번째 실행에서 `src/lib/data/drafts.ts(136,13) Cannot find name 'educationDisplayName'` — api-engineer가 동시에 고치는 파일(import 누락으로 보임)이고 `src/server/ai`와 무관하다. api-engineer 작업이 끝난 뒤 다시 확인이 필요하다.

## 리더 확인 요청
- AI-03 교육 섹션 `heading`(draft_sections에 저장)과 머리글 텍스트는 "운영 기관 교육 명"을 그대로 둔다. 서류 본문 머리글은 둘 다 보여 주는 형식이라 표시 이름 규칙 대상이 아니라고 판단했다. 이것도 표시 이름으로 바꿔야 하면 기획(UQ-739) 결정이 필요하고, 그때는 prompt/출력 형식 변경이므로 AI-03 `prompt_version`을 올린다.
