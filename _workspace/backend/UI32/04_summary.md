# UI32 요약 (2026-11-04)
- 교육 표시 이름 = 교육 명(`program_name`), 비면 운영 기관. 서버 헬퍼 `src/server/services/career/education-name.ts`(+ 단위 테스트), `read.ts` `getCareerList`·`getProjectDetail`, `src/lib/data/career-v45.ts` 새 프로젝트 실제 분기, 통합 테스트 1건.
- 마이그레이션·env 없음. DTO 모양 유지.
- 검사: typecheck·lint·vitest 1995 통과(통합 포함), build 통과. pgTAP 5파일 실패 — 로컬 DB에 최근 마이그레이션 3개 미적용(UI32 무관, 공유 스택이라 reset 안 함).
- 열린 Minor: QA-01(근거 라벨 스냅샷 → UQ-739), QA-02(새 프로젝트 교육 부모 테스트 없음). QA-03은 리더가 mock 주석 수정.
- 원격: 미반영(배포는 main 머지로, UI 32 런과 같은 머지 권장).

## UI32-2 근거·출처 라벨 (2026-11-04)
- 사용자 결정: 근거 칩·서류 출처 라벨도 교육 명 규칙, 기존 저장 라벨도 수정.
- DB: 마이그레이션 `20261113000200_ui32_education_display_labels.sql` — `private.trim_js_whitespace`, `private.education_display_name`, `draft_source_parent_name`·교육 삭제 트리거 갱신, `private.backfill_education_display_labels()`로 `evidence_links`·`draft_section_sources` 기존 라벨 백필(삭제 없음, 값 변경, 멱등). pgTAP 추가 + `ai_provider_keys`·`drafts_qa1` 테스트 사용자 범위로 한정.
- AI: `career-pack.ts` 교육 별칭 라벨 = 표시 이름, AI-03·summary-pack은 원본 필드 사용 — 모델 입력 동일, prompt_version 유지.
- API: `drafts/read.ts`, `lib/data/evidence.ts`·`drafts.ts`(출처 트리 보조 줄 "운영 기관 · 기간"). 작성 대화 AI-12 입력은 기관명 유지(리더 결정: 표시 규칙은 사용자 화면만).
- QA 2라운드: Critical·Major 0, QA-01~04 해결. typecheck·lint·vitest 2008·build·pgTAP 2676 통과.
- 원격: 미반영. **main 머지 전에 `supabase db push` 필요**(이 브랜치의 미반영 마이그레이션 포함 확인 — Phase 4).
- 후속 후보: pgTAP의 전체 테이블 집계 정리(공유 스택 불안정), 출처 트리 보조 줄 문구 UI 확인.
