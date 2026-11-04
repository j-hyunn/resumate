# UI32-2 — 근거·출처 라벨의 교육 이름 (2026-11-04)

## 사용자 결정
교육 이름 = 교육 명(`program_name`), 비면 운영 기관(`institution_name`) — 근거 칩·서류 출처 라벨에도 같은 규칙. 이미 저장된 라벨도 고친다. (UQ-739 중 "근거 칩·서류 교육 이름" 항목은 사용자가 결정함)

## 현재 경로
- AI 저장: `src/server/ai/context-pack/career-pack.ts:302` education 별칭 `label` = `institution_name` → `evidence_links.source_label`(`ai/storage/evidence-links.ts:66`), `draft_section_sources.source_label`(`ai/validation/draft-blocks.ts:169`, `context-pack/selection.ts:101` "부모 › 프로젝트"). 교육 소속 프로젝트 라벨의 부모 부분도 같은 문제.
- 주의: `ai/pipelines/AI-03.ts:558`은 `entry.label`을 `institution_name`으로 쓴다 — 라벨을 바꾸면 여기 의미가 깨지므로 원본 필드에서 읽게 바꿀 것.
- DB: `private.draft_source_parent_name` / `private.draft_source_label`(마이그레이션 20261102000200) 및 삭제 트리거가 교육 부모 이름을 만든다(기관명 기준이면 규칙 적용).
- 읽기/표시: `src/server/services/drafts/read.ts:334·340`, `src/lib/data/evidence.ts` 87·89·98·131·150(mock/실제 공통 경로 여부 확인), `src/lib/data/drafts.ts:135`.
- 작성 대화: `src/server/services/writing-chat/pipelines.ts:44·67` 부모 이름, `src/lib/data/writing-chat-view.ts` 27·90.

## 담당 (파일 소유 겹치지 않음)
- **db-engineer**: 새 마이그레이션(가장 최근 `20261113000100` 뒤 번호) — SQL 헬퍼(예: `private.education_display_name(program_name, institution_name)` = `coalesce(nullif(btrim(program),''), nullif(btrim(institution),''))`), `draft_source_parent_name` 등 교육 이름 쓰는 함수 갱신, **기존 행 백필**: `evidence_links`(source_type='education'은 해당 교육의 표시 이름, 교육 소속 프로젝트 라벨에 부모 이름이 들어가면 그 부분도), `draft_section_sources.source_label`(education_id 있는 행, 삭제되지 않은 원본 기준; `source_deleted_at` 있는 행은 원본이 없으면 그대로). 기관명→교육명 치환은 라벨 형식("부모 › 프로젝트")을 확인하고 정확히. pgTAP 추가. 로컬 적용은 `supabase migration up`(공유 스택이라 `db reset` 금지). 비파괴(데이터 삭제 없음)지만 라벨 값 변경이므로 05_release에 명시할 것.
- **ai-pipeline-engineer**: `career-pack.ts` 교육 별칭 label = 표시 이름 규칙(`src/server/services/career/education-name.ts`의 `educationDisplayName` 재사용 가능), 교육 소속 프로젝트 라벨 부모 이름, `selection.ts`, AI-03이 label 대신 원본 필드를 쓰도록. fixture 테스트 갱신.
- **api-engineer**: `drafts/read.ts`, `writing-chat/pipelines.ts`, `src/lib/data/evidence.ts`·`drafts.ts`·`writing-chat-view.ts`(실제 분기/배선 — UI 소유 mock 파일은 건드리지 말고 필요하면 UI 요청), 테스트.
- **backend-qa**: 경계 검사, run-checks(pgTAP 포함), 백필 검증 쿼리.
