# 결정 사이클 education-name — 커리어 빈 상태 · 교육 표시 이름 (2026-11-04)

- 출처: 사용자 요청(2026-11-04, UI 32 런·백엔드 UI32/UI32-2) + 이 사이클 AskUserQuestion 답. UI 질문 UQ-739(`_workspace/ui/32_ui-qa_career_review.md`), 백엔드 QA-01/QA-02(`_workspace/backend/UI32/03_backend-qa_report.md`, `07_backend-qa_report.md`).
- 기준 버전: PRD v4.8 · UX v5.8 · AI v4.6 · DM v4.6 (`docs/planning/README.md`).
- 이미 구현·배포 준비됨: PR j-hyunn/resumate#29, 원격 마이그레이션 `20261113000100`·`20261113000200` 적용(2026-11-04). 이 사이클은 문서를 구현에 맞추는 것이다.
- 주의: `_workspace/02_*` 작업 원본은 최근 사이클들에서 갱신되지 않아 `docs/planning/*`보다 오래됐다 → 이번 사이클은 **`docs/planning/*`를 직접 고친다**.

| ID | 결정 | 바뀌는 기존 결정 | 영향 |
|----|------|-----------------|------|
| ED-1 | S-08 빈 상태(항목 0개): "커리어 추가" 주 버튼(→ C-22)은 왼쪽 목록 머리에 항상 둔다(항목 유무 무관). 데이터 없는 칸은 칸 안 가운데 안내 문구만: 왼쪽 "아직 추가한 커리어가 없어요", 오른쪽 기존 문구("커리어를 정리해 두면…" + 한 줄 설명), 오른쪽에 버튼 없음. 한 화면 주 버튼 1개. 좁은 화면 항목 0개면 목록 칸만. | UX S-08 빈 상태(02-user-flows.md:1188 "왼쪽은 커리어 추가만, 오른쪽 패널에 문구 + 주 버튼") | UX |
| ED-2 | 교육 표시 이름 = 앞뒤 공백 제거한 교육 명(`program_name`), 비면 운영 기관(`institution_name`), 둘 다 비면 "이름 없는 교육". 적용: S-08 목록 행·상세 제목·메뉴/삭제 확인 라벨, S-34 제목·브레드크럼, C-23 소속 목록, S-10/S-43 소속 목록·브레드크럼, 커리어 목록 응답 `name`. | UX 1183·1217·1059, DM 265·1395 (`name` = `institution_name`) | UX, DM |
| ED-3 | 근거 칩·서류 출처 라벨(`evidence_links.source_label`, `draft_section_sources.source_label`, "부모 › 프로젝트")의 교육 이름도 ED-2. 기존 저장 라벨은 마이그레이션 `20261113000200`이 백필(삭제 없음, 원본 교육이 없는 행은 그대로). DB 헬퍼 `private.education_display_name`(JS trim과 같은 공백 집합). | DM source_label 설명(저장 시점 라벨), AI 별칭 label | DM, AI |
| ED-4 | AI 모델 입력은 바꾸지 않는다: 컨텍스트 팩의 원본 필드(`institution_name`, `program_name`) 유지, AI-03 교육 섹션 제목·머리글은 "운영 기관 교육 명" 형식 유지, AI-12 작성 대화 `affiliation`은 기관명 유지. `prompt_version` 변경 없음. 교육 별칭(`EDU-n`)의 **저장 라벨**만 ED-2. | — (명시) | AI |
| ED-5 | 상세 패널 교육 정보 섹션 보기 행 "전공/과정명 `program_name`" → "운영 기관 `institution_name`"(교육 명은 제목으로). 출처 트리(S-17/S-31) 교육 소속 보조 줄 = "운영 기관 · 기간"(교육 명이 있을 때), 없으면 "기간". | UX 1219 교육 정보 보기, 출처 트리 meta | UX |
| ED-6 | 교육 입력 라벨 통일(사용자 답 "추가 모달 기준"): 추가 모달·S-34 편집 모두 "교육 명"(`program_name`, 선택) · "운영 기관 *"(`institution_name`, 필수). 완료 판정(기관명·구분·시작 월)은 그대로. | UX S-34 편집 라벨 "기관명 *·전공/과정명" | UX (UI 후속: `education-form.tsx` 라벨) |

## 후속 결정 (리뷰 R-ED-5, 사용자 2026-11-04)

| ID | 결정 | 바뀌는 기존 결정 | 영향 |
|----|------|-----------------|------|
| ED-7 | 교육 추가·수정은 구현(S-08 커리어 추가·수정 모달, `add-career-dialog.tsx`) 기준으로 기획을 고친다: 입력은 교육 명 · 운영 기관 * · 교육 기간(진행 중 체크) · 교육 내용. **구분(`education_type`)은 입력받지 않는다** — 새 교육은 `course`(교육 과정), 수정 때는 기존 값 유지. **상태(`enrollment_status`)는 입력받지 않고 기간에서 정한다** — 진행 중 체크면 `enrolled`, 아니면 기존 값이 `enrolled`가 아닌 값(graduated·completed·dropped_out·on_leave)이면 유지, 없으면 종료 월이 있을 때 `completed`, 없으면 null (`add-career-dialog.tsx:175–178`). 학위 과정(`degree`)은 화면에서 만들 수 없다(기존 데이터·컬럼·CHECK는 유지). 상세 보기에서 구분은 숨김(구현 그대로). | PRD F-P1-14(구분·상태 입력, 구분 필수), UX C-22·S-34 편집(구분 *, 상태), 완료 판정 문구 | PRD, UX, DM(설명만). AI는 동작 차이 없음(R-ED-9: 영향 칸에서 뺌) |
