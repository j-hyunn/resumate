# 35 런 — 32 런 남은 이슈(UQ-734~738) 정리

- 요청: 32 런 QA(`32_ui-qa_career_review.md`)의 UQ-734 Major, UQ-735~738 Minor 처리 (decisions 4.8)
- 기준 기획: PRD v4.10 / UX v5.10 / DM v4.8 (education-name ED-1~ED-7)
- 범위: S-08(A2), S-10·C-23 실제 경로 확인. 열린 PR #38(`education-form.tsx`)·#39(`career-v45*.ts`) 파일은 건드리지 않음

## 결과
| 이슈 | 처리 |
|------|------|
| UQ-734 | 이미 해결(PR #29 `86edf30`). `server/services/career/read.ts` `getCareerList`(:60·:65)·`getProjectDetail`(:121·:128), `lib/data/career-v45.ts` `getNewProjectPage`(:269)가 `educationDisplayName`. C-23 `listProjectAffiliations`·S-10 소속 목록은 `getCareerList`를 거침. 로컬 스택에서 `src/server/services/career/career.integration.test.ts`, `src/lib/data/career.integration.test.ts` 통과(파일 전체 실행 — `-t`로 걸러 돌리면 동의 준비 테스트가 빠져 consent 오류가 난다) |
| UQ-735 | 규칙은 `src/server/services/career/education-name.ts` 하나(순수 함수). `components/career/education-name.ts`는 행 모양 어댑터로 위임만, mock 복제 제거. 컴포넌트 파일을 남긴 이유: PR #38이 그 import를 쓴다 |
| UQ-736 | `src/components/career/career-overview.test.ts` — `educationName` 경우 4가지, 빈 커리어 "커리어 추가" 1개·두 안내·상세 칸 버튼 없음, 교육 행 이름(교육 명 / 이름 없는 교육) |
| UQ-737 | `lg`에서 두 안내를 칸 전체 높이 기준 가운데(`relative` 칸 + `lg:absolute lg:inset-0`). 좁은 화면은 그대로 |
| UQ-738 | design-system.md 4장 ST-EMPTY 예외 S-08, P-15 표시, 변경 이력 |

- 검사: `pnpm lint`·`pnpm typecheck`·`pnpm test`(131 파일 2253개) 통과. 빌드는 돌리지 않음
- 브라우저 확인 없음(로컬 로그인이 Google 전용) — UQ-737 시각 결과는 브라우저에서 한 번 봐야 한다
