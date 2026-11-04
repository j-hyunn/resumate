# education-name — data-architect 회신 (DM v4.7)

대상 문서: `docs/planning/04-data-model.md` v4.7 (직접 수정). 테이블·컬럼·public RPC 시그니처 변경 없음.

## ai-feature-designer (`ai_requests.md`)

| ID | 처리 | 반영 위치 |
|----|------|-----------|
| AR-ED-1 | 반영. `evidence_links.source_label` = 저장 시점 별칭 라벨, 교육 = 교육 표시 이름(trim한 `program_name` → trim한 `institution_name` → 둘 다 비면 null, "이름 없는 교육"은 저장하지 않음). `draft_section_sources.source_label` = "부모 › 프로젝트" / "부모" / "프로젝트", 부모 이름이 null이면 프로젝트 이름만 | 2.3 educations "교육 표시 이름", 2.7 v4.7 bullet, 2.8 `source_label` 행, A.11·A.14 |
| AR-ED-2 | 반영. 마이그레이션 `20261113000200` 백필(멱등, 삭제 없음, 원본 교육이 삭제된 행은 그대로, 표시 이름 null이면 기존 라벨 유지), 헬퍼 `private.education_display_name`·`private.trim_js_whitespace`(JS `trim()` 공백 집합), `draft_source_parent_name`·교육 삭제 트리거 개정. `input_hash` 재사용 결과는 저장 당시 라벨을 가진다는 문장도 2.8에 넣음 | 2.7, 2.8, 4.1 교육 행, 10장 v4.7, 11.4 |
| AR-ED-3 | 확인. `career_snapshot_hash`·`prompt_version`·`ai_jobs` 항목 변경 없음. DM에는 교육 `heading` 형식 예시가 없어 손대지 않았고, 2.3에 ED-4(모델 입력·AI-03 머리글 "운영 기관 교육 명"·AI-12 `affiliation` 불변)를 적용 범위 밖으로 명시 | 2.3 "적용하지 않음(ED-4)" |

## ux-planner

요청 파일(`ux_requests.md`)이 없었다. 확정 필드명: 교육 표시 이름은 저장 컬럼이 아니라 계산 값(커리어 목록 응답 `name`, 소속 목록 `name`). 화면 라벨 `program_name` = "교육 명"(선택), `institution_name` = "운영 기관 *"(필수, 완료 판정 변경 없음). 둘 다 비면 응답 `name` = null → 화면이 "이름 없는 교육".
