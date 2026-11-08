# 44 런 브리프 — AI 모의 면접 MVP 제외 (remove-mock-interview, RM-1~RM-5)

- 작성: 2026-11-08 (리더)
- 요청: 사용자 "모의 면접은 MVP에서 빼기로 했어. 관련 코드, 관련 문서들 전부 삭제해줘."
- 기획: PRD v4.16 / 플로우 v5.19 / AI v4.14 / 데이터 모델 v4.14. **UI 후속 목록 = `docs/planning/decisions.md` 4.21 "UI" 표 1~7**, 화면별 상세는 `docs/planning/02-user-flows.md`의 `(v5.19, RM-n)` 표시와 5.1m
- 백엔드: **R14 완료(QA 진행 중)** — 면접 서버 코드·계약·데이터 계층 삭제. **입력 = `_workspace/backend/R14/02_api_notes.md` "UI 요청"**(지운·바뀐 export → 쓰는 UI 파일:줄, 통째로 지울 면접 화면 파일 목록). 바뀐 계약: `APPLICATION_STAGES` 4값(`before_apply`·`document`·`assignment`·`closed`), `INTERVIEW_STAGES` 없음, readiness `features` = {insight, draft}, `move_application_stage` 반환에 `interviewPrompt` 없음, 삭제 영향 키에서 면접 제거, 사용량 표시 5행, return_target 3값, 진행 단계 `evaluate`/`summarize`/`score`/`complete` 없음, 자리 표시 5종(`[사례 입력 필요]` 없음)
- 경과 파일: `src/lib/data/interview-grading.ts`는 `src/lib/mock/grading.ts`가 import해서 남겨 둔 것 — **이번 런에서 `lib/mock/grading.ts`와 함께 삭제**한다(데이터 계층 파일이지만 리더 허용)

## 실행 방식 (표준과 다른 점)
삭제 위주이고 공통 컴포넌트·`lib/`·페이지가 서로 얽혀 있어 영역별 병렬 엔지니어는 같은 파일을 건드린다. **frontend-engineer 1명이 A0 + A1·A3·A4의 면접 접점을 한 번에** 처리하고, ui-qa가 검수한다.

## 범위
| 영역 | 대상 |
|------|------|
| A4 | **삭제**: S-20·S-22·S-33·S-37 페이지(`/applications/[id]/interview/**`, `/interviews/**`), `src/components/interviews/*`. **S-39 보드 4열**, 보드 카드의 면접 수·면접 진입점 |
| A0 | L-01 사이드바 **메뉴 3개**(커리어 / 자기소개서 관리 / 지원 현황), 모의 면접 배지·브레드크럼 마디, C-12 단계 메뉴 4값, **C-14 면접 팝업(`board/interview-prompt-preview`)·C-16·C-17(`score-display`) 삭제**, C-01 `interview_answer` 칩, C-03 면접 단계 문구·알림·토스트, C-04 면접 스트리밍, C-05 면접 세션 삭제·면접 수, C-09 면접 분기, C-18 면접 진입점·기능 이름 2개, C-19·C-20 면접 행, C-21 "면접 답변", 자리 표시 5종(`placeholders.tsx`), `return-target`·`ai-connect-return` 면접 대상, `lib/routes.ts`, `lib/preview-state.ts`, `src/lib/mock/**`(면접 fixtures·grading·ai), `/dev/states` 갤러리 |
| A3 | S-13·S-31의 "면접 세션 수"·면접 카드, S-31 단계 칩 C-14 분기, JD 화면의 면접 진입, `applications/_lib/gate-preview.ts` |
| A1 | S-25 탈퇴 삭제 요약의 면접 세션, S-24 ②·S-40 안내의 "모의 면접", **S-42 사용량 표 5행**(`usage-rows.test.ts` 포함), 정책 mock `fixtures.ts` `policy_versions`에 2026-11-08 / 2026-11-08.1 행 |
| 옛 주소 | `/applications/{id}/interview…` → S-31(`/applications/{id}`), `/interviews…` → S-13(`/applications`) 리다이렉트, 토스트 없음 — `next.config.ts` 308(40 런 S-09·S-34 선례) `[가정]` (UX 1.2) |
| docs/ui | `screen-status.md`(면접 화면 행 → 폐기 표시, 기준 기획 줄, 연결 대기 표의 면접 행), `design-system.md`(C-14·C-16·C-17·점수 표시·면접 레이아웃 절 → 폐기 표시) |

## 금지
- 백엔드 소유(`src/server/`, `src/app/api/`, `src/lib/contracts/`, `supabase/`) 수정 금지. 백엔드 쪽에 남은 면접이 보이면 보고서 "백엔드 요청"에.
- `src/components/account/policy-content.ts`는 R14가 법무 원문과 맞췄다 — 건드리지 않는다.

## 완료 조건
`pnpm lint` · `pnpm typecheck`(`tsc --noEmit`, 기존 `RouteContext` 10건 제외 0) · `pnpm vitest run` · `pnpm build` 통과. `grep -rni "interview\|면접" src/app src/components src/lib/mock src/lib/routes.ts src/lib/preview-state.ts src/hooks` 잔존은 근거와 함께(예: 옛 주소 리다이렉트).
