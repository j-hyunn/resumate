# 38 런 브리프 — 36·37 런 UI QA (QA만)

- 요청 (2026-11-05, 사용자): 36 런(열린 결정 UI 후속)과 37 런(U36 후속)은 UI QA를 돌리지 않았다. QA를 실행하고 지적 사항을 고친다. **브라우저 확인은 제외** — 사용자가 나중에 따로 한다.
- 기준: main `5c0933a` (PR #48 od-ui, #49 R11, #50 R12 머지 뒤). 작업 브랜치 `claude/qa-36-37-r12-status`.
- 기획 버전: PRD v4.13 / UX v5.14 / AI v4.11 / DM v4.11, decisions.md 3.18·3.19·4.12·4.13.
- 백엔드 계약: R11(`20261113000500`~`001200`)·R12(`20261113001300`) 모두 main과 원격에 있음. screen-status "백엔드 연결 대기 (36 런)" 표는 1a3522d·R12로 연결됨.

## 범위
- 36 런: C-05·C-14·C-17·C-18·C-19·C-20·C-21·S-10·S-44·S-18·S-22·S-33·S-37·S-39·S-40·S-24·S-30 (보고 `36_frontend-engineer-A2_report.md`·`36_frontend-engineer-A4_report.md`, 브리프 `36_brief_od-ui-followups.md`)
- 37 런: U36-1~U36-5 — `/interviews/{sessionId}/result`, CR-23 용어 전체, 법무 "정량 성과", design-system v5.8 (보고 `37_frontend-engineer_u36_report.md`)
- 1a3522d의 R11 계약 연결(데이터 계층)
- QA 항목: Q1–Q7, Q8(바뀐 곳만), Q9·Q10, Q11, lint·typecheck·test·build. 브라우저 패스 없음.
