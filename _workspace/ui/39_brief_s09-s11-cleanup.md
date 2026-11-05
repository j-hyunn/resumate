# 39 런 브리프 — S-09·S-11 옛 화면 정리 (2026-11-05)

- 요청: 38 런 수정 담당이 찾은 잔여물 정리(다른 세션이 시작). 기획 결정은 끝남(decisions.md 1장 결정 대기 0건).
- 근거: UX v5.5 S-11 폐기(CR-11)·S-09/S-34 = S-08 패널 상태, OD-C2·OD-D4 모달 공통 규칙, DM v4.4 `achievements` 폐기·`evidence_links.source_type`에서 `achievement` 삭제(R4 마이그레이션 `20261109100100`이 근거 행 삭제).
- 범위(A2·A0, 리더 직접): 옛 S-09 페이지·`ExperienceForm`·`AchievementList`·`AchievementDialog` 삭제, `routes.experienceNew`/`experience` → `careerNew`/`careerItem`, 옛 경로 redirect, C-07 G-3 삭제, C-05 상세 내용·정량 성과 대상 삭제, S-25 산출물 줄, 근거 칩 `achievement` 처리.
- 범위 밖: S-34 예전 교육 폼 페이지(`/career/educations/*`, 교육 폼은 G-3 안 씀 — G-2만), S-16 문구(38 런), mock 픽스처의 옛 모델(project_details·achievements).
- 확인: lint·typecheck·test·build. ui-qa·브라우저는 사용자가 따로.
