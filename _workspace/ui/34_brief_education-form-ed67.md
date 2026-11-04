# 34 런 브리프 — S-34 예전 교육 폼 ED-6·ED-7 (2026-11-04)

- 요청: 다른 세션(local_4d61a0c3) 위임. decisions.md 4.8 "UI (남음, ED-6·ED-7, R-ED-1·R-ED-6)".
- 범위: S-34 `/career/educations/new|[id]` — `src/components/career/education-form.tsx`. `src/lib/data/career-v45*.ts`는 다른 세션 작업 중이라 건드리지 않음.
- 기준 기획: PRD v4.10 / UX v5.10 / DM v4.8 (ED-6·ED-7).
- 경로 제거 검토: `/career/educations/*` 호출처는 `routes.education`을 쓰는 C-02 mock 근거 링크(`src/lib/data/evidence.ts:102`)와 폼 자신(`editHref`)뿐. 같은 형태의 S-09 예전 폼(`/career/experiences/*`)이 남아 있어 교육만 지우는 것이 분명히 낫지 않음 → 라벨·입력 수정으로 진행.
- 결과: 라벨 "교육 명"·"운영 기관 *"(모달 순서), C-24 `conflictFields` 같은 라벨·구분/상태 행 제거, 구분·상태 입력 제거. 저장 규칙은 `education-derive.ts`(모달과 공용): 구분 = 새 교육 `course`/수정 땐 유지, 상태 = 진행 중 → `enrolled`, 아니면 기존 비진행 상태 유지, 없으면 종료월 있을 때 `completed`.
- 테스트: `education-derive.test.ts`(7개). lint·typecheck·test 전체 통과. ui-qa·브라우저 확인은 하지 않음(로컬 로그인 Google 전용).
- R-ED-8: 남은 "새 교육 패널" 문구는 UX 문서(02-user-flows.md:1218·1232 등) 쪽 이슈라 UI에서 고칠 코드 없음 — 기획(ux-planner) 몫.
- 후속 후보: C-02 "원본으로 이동"은 UX v5.10에서 교육 → S-08 `?item=education:`인데 mock `evidence.ts:102`는 예전 S-34 경로로 감.
