# education-name — ai-feature-designer → data-architect 요청 (AI v4.7)

기준: `_workspace/00_input/planning-decisions-education-name.md` ED-3·ED-4, `docs/planning/03-ai-features.md` v4.7 (C-1 "별칭의 저장 라벨"). 새 필드·테이블·출력 스키마 변경 요청은 **없다**. 아래는 DM 문서 문구를 AI 명세와 맞추기 위한 확인 요청이다.

| ID | 요청 | 근거 |
|----|------|------|
| AR-ED-1 | `evidence_links.source_label`·`draft_section_sources.source_label` 설명에 "저장 시점의 별칭 라벨이며, 교육은 교육 표시 이름(앞뒤 공백 제거한 `program_name` → 비면 `institution_name` → 둘 다 비면 라벨 없음 — 출처 라벨은 부모 부분을 빼고 프로젝트명만)"을 적어 달라. 화면 대체 문구 "이름 없는 교육"은 저장 라벨에 넣지 않는다(AI 명세 기준). | ED-3, AI v4.7 C-1·C-3·AI-04 |
| AR-ED-2 | 기존 저장 라벨 백필(마이그레이션 `20261113000200`, 헬퍼 `private.education_display_name` — JS trim과 같은 공백 집합, 원본 교육이 없는 행은 그대로, 삭제 없음)을 DM 변경 이력·삭제/라벨 정책 절에 기록해 달라. AI 쪽은 같은 `input_hash`로 재사용되는 이전 결과가 저장 당시 라벨을 갖는다고만 적었다. | ED-3 |
| AR-ED-3 | (확인) 모델 입력은 바뀌지 않으므로 `career_snapshot_hash` 계산 입력·`prompt_version`·`ai_jobs` 관련 DM 항목은 변경 불필요. AI-03 `draft_sections.heading`(교육 섹션)은 "운영 기관 교육 명" 형식 유지 — DM에 heading 형식 예시가 있으면 그대로 둔다. | ED-4 |
