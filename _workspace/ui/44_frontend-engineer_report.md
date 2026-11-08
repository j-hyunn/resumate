# 44 런 frontend-engineer 보고 — AI 모의 면접 MVP 제외 (A0 + A1·A3·A4 면접 접점)

- 작성: 2026-11-08 · 기준: PRD v4.16 / 플로우 v5.19 / AI v4.14 / DM v4.14, decisions 4.21 UI 1~7, R14 `02_api_notes.md` "UI 요청"
- 작업 트리: `.claude/worktrees/remove-mock-interview-8577ac` (커밋 안 함)

## 지운 파일 (`git rm`, 22개)
- 화면: `src/app/(dashboard)/(gated)/applications/[id]/interview/{page,[sessionId]/page,[sessionId]/result/page}.tsx`, `src/app/(dashboard)/(gated)/interviews/{page,[sessionId]/result/page}.tsx` (S-20·S-33·S-22·S-37)
- `src/components/interviews/*` 10개 (actions, answer-sheet, interview-prep, interviews-overview, jd-picker-dialog(C-16), result-screen, result-view, session-list, session-status(+test))
- `src/components/board/interview-prompt-preview.tsx`(C-14), `src/components/common/score-display.tsx`(C-17)
- `src/lib/mock/grading.ts`·`grading.test.ts`, `src/lib/data/interview-grading.ts`(경과 파일, 리더 허용)

## 고친 파일 (화면 ID별)
- **L-01** `lib/routes.ts`(면접 route 5개·`MenuKey` `interviews` 삭제, 메뉴 3개), `shell/app-sidebar.tsx`(메뉴·배지), `shell/breadcrumbs.tsx`(모의 면접 마디), `return-target.ts`(`NavOrigin = "board"`, `markBoardStageMove`/`consumeBoardStageMove` 삭제 — S-20 전용), `routes.test.ts`(메뉴 3개 테스트로 교체)
- **S-39** `board/page.tsx`(`interview-prompt` 미리보기), `kanban-board.tsx`(면접 수·"작성 중" 배지·면접 상태 줄, 4열 주석)
- **C-12/C-14** `stage-menu.tsx`(C-14 팝업·`InterviewPromptState`·`getInProgressSessionAction`·`origin` 인자 삭제, 4단계)
- **C-18** `ai-lock.tsx`(`interview_new`/`interview_submit` 진입점, `AiLockDialog` 삭제; 범용 `AiLockPopup` 유지)
- **C-03** `ai-progress.tsx`(면접 단계 목록·`complete`·질문 n/N 분기), `applications/shared.tsx` 주석
- **C-05** `delete-confirm-dialog.tsx`(면접 세션 삭제 대상, `detached_interview_sessions`, 자기소개서 영향 줄 → 명세 문구 "JD·요건, 인사이트 {N}, 서류 {N}, 전형 이력이 함께 삭제돼요. 커리어 데이터는 그대로예요", `delete_results` 설명에서 면접 범위, 자기소개서별 "면접 {n}")
- **C-08** `placeholders.tsx`(5종, `[사례 입력 필요]` 삭제)
- **C-09** `data-gate.tsx`(컬처핏 대안·`culture_fit_interview` 제외 타입), `applications/_lib/gate-preview.ts`
- **C-10** `return-banner.tsx`(`job_interview`), `ai-connect-return.ts` 주석
- **C-19** `provider-badge.tsx`(`providerRunLabel` 삭제) · **C-20** `ai-error-notice.tsx` 주석 · **C-21** `lib/ai-disclosures.ts` `SENT_DATA_ITEMS`("면접 답변" 삭제)
- 단계 점: `common/basics.tsx`, `app/globals.css`(`--stage-job-interview`·`--stage-culture-fit-interview` 토큰 삭제)
- **S-13** `applications/page.tsx`(AutoRefresh 조건), `application-list.tsx`(면접 세션 수·작성 중·면접 진행 칸)
- **S-31** `applications/[id]/page.tsx`(면접 카드·세션 조회 삭제), `hub-header.tsx` 주석
- **S-15** `applications/[id]/jd/page.tsx`(`from=interview` 돌아가기), `jd-raw-edit.tsx` 주석, `lib/routes.ts` `from` 타입
- **S-16** `insight-view.tsx`: "인사이트 없이도 서류는 바로 쓸 수 있어요" `[UI-가정]`
- **S-14** `applications/new/page.tsx` 설명 문구 `[UI-가정]`
- **S-25** `deletion-summary.tsx`, `settings/withdraw/page.tsx`(면접 세션 줄·빈 요약 키)
- **S-24 ②/S-40** `ai-connection-panel.tsx` 안내(명세 문구), 활성 변경 확인 문구 "다시 시도·다시 생성도 …"(명세 문구)
- **S-42** `usage-rows.test.ts` 5행, `usage-rows.ts`·`ai-usage-panel.tsx` 주석
- **S-01** `(public)/page.tsx` "원하면 내 AI 키를 연결해 인사이트·서류까지"(명세), 본문 "내 커리어를 근거로 강점·보완점과 서류 초안을 준비해요" `[UI-가정]`, `app/layout.tsx` metadata
- **S-08/S-44** `career-overview.tsx`(+test) 빈 상태 문구(명세), `deliverable-page.tsx` 안내 1줄(명세)
- **mock/preview** `lib/mock/fixtures.ts`(면접 5개 테이블·행·작업 8개·근거 4개·사용량 3개·`GRADED_*` 삭제, AP1 `job_interview`→`assignment`, wc3 복귀 대상 `job_interview`→`insight`, **`policy_versions` 4행 추가**: terms·cross_border `2026-11-08`, privacy·ai_data_use `2026-11-08.1`, 시행 2026-11-08 KST), `mock/ids.ts`(ses·q·ans·ev·fb), `mock/ai.ts`(면접 단계·재시도·사용량), `mock/writing-chat-turn.ts`, `lib/preview-state.ts`(`interview-prompt`·`generation-canceled`), `/dev/states`(`dev/states/page.tsx`, `dev-state-gallery.tsx`, `dev-state-gallery-v53.tsx` 면접 섹션·Q53 면접 링크)
- 기타 주석: `state-views.tsx`, `ai-run-button.tsx`, `od-copy.test.ts`(예시 "다시 채점" → "다시 생성"), `types/db.ts` 절 제목 주석 1줄

## 리다이렉트 (`next.config.ts` ← `src/lib/legacy-redirects.ts` `INTERVIEW_LEGACY_REDIRECTS`, 308, 토스트 없음)
- `/applications/:id/interview/:rest*` → `/applications/:id` (S-31; 없는/남의 id는 S-31의 ST-NOTFOUND)
- `/interviews/:rest*` → `/applications` (S-13)
- `legacy-redirects.test.ts`에 5건 추가. `next start`로 curl 확인: 4개 주소 모두 308 + 위 목적지

## docs/ui
- `screen-status.md`: 44 런 기준 기획 줄, S-20·S-33·S-22·S-37 행 → "폐기 (RM-1, 2026-11-08)" + redirect 목적지, C 행(C-14·C-16·C-17 폐기), L-01(메뉴 3개)·S-39(4열)·S-42(5행), `?state=` 목록, 연결 대기 표의 면접 행 폐기 표시
- `design-system.md` v5.13: 머리에 폐기 안내(남은 사용처 언급은 이력), 3.13 C-14·3.15 C-16·3.16 C-17·3.19 목록 열·6장 A4 면접 부분 → 폐기 표시, 1.1.4 면접 단계 2행·토큰 삭제, 3.3 면접 단계 문구·`complete`, 3.8 컬처핏 대안, 3.11 4단계, 3.18 팝업형, 5.1 메뉴 3개, 5.5 카드 면접 수, 9장 변경 이력

## 검사 결과
- `pnpm lint`: 0 errors, 0 warnings
- `pnpm tsc --noEmit`: 10건, 모두 기존 `src/app/api/**/route.ts` `Cannot find name 'RouteContext'` → 그 외 0 (오래된 `.next/types`는 지우고 다시 확인)
- `pnpm vitest run`: 144 파일 / 2343건 모두 통과 (R14 때 146 파일 — 지운 테스트 2개)
- `pnpm build`: 통과(exit 0), 면접 라우트 없음
- 브라우저 확인: **안 함**. `next start` + curl로 redirect 4건만 확인

## grep 잔존 (`grep -rni "interview\|면접" src/app src/components src/lib/mock src/lib/routes.ts src/lib/preview-state.ts src/hooks`)
- `src/components/applications/labels.ts:74` `prepare_answer: "면접 대비"` — AI-02 인사이트 대응 방안 종류(실제 채용 면접 대비), AI 명세 v4.14가 유지(`[가정]`)
- `src/app/(dashboard)/(gated)/board/page.tsx`·`stage-menu.tsx`·`routes.ts`·`legacy-redirects(.test).ts` — 폐기 이력 주석과 옛 주소 리다이렉트 규칙·테스트
- `src/components/account/policy-content.ts:30` — 손대지 않음(금지 파일, R14 주석)
- 범위 밖(백엔드·데이터 계층 소유, 손대지 않음): `src/lib/data/actions.ts:229` 주석 "C-12 / C-13 / C-14", `applications.ts:148·152`·`ai-jobs.ts:265` 주석의 "면접"·"S-20", `w3.integration.test.ts:564` 음성 단정

## [UI-가정]
- 옛 주소 redirect는 Next 설정 redirect라 **요청 쿼리가 목적지에 붙는다**(`?type=job` → `/applications/{id}?type=job`). 명세 "쿼리(`?type=` 등)는 버린다"와 다름. S-31·S-13은 모르는 키를 무시해 화면은 같다. 완전히 버리려면 `src/proxy.ts`(백엔드 소유)에서 처리해야 함
- S-01 가치 제안 3번째 본문, S-14 설명, S-16 빈 상태 문구 — 명세에 행이 없어 "면접"만 뺀 문구
- mock AP1을 `assignment` 단계로 옮김(과제 전형 열에 카드가 있도록)
- `AiLockPopup`(범용 C-18 팝업형)은 지금 쓰는 곳이 없지만 공통 컴포넌트라 남김

## 기획 확인 필요
- C-05 `delete_results` 범위 설명: 명세(v5.18 CL-3)는 "경력기술서는 그 커리어 항목을 쓴 섹션, 자소서 문항 답변은 해당 문항의 답변 본문만(문항·글자 수 제한·메모는 남음)"인데 코드는 v5.17 문구("경력기술서는 문서 전체, …생성 결과만") — 이번 런은 면접 범위만 뺐다. v5.18 서류 후속 런에서 처리할지 확인
- 보드 카드 `sr-only` "서류 초안 {n}개", S-31 카드 제목 "서류 초안" 등 v5.18 CL-A6("서류") 미반영 자리 — 이번 범위 밖

## 백엔드 요청
- (선택) 옛 면접 주소의 쿼리를 버리려면 `src/proxy.ts`에서 `/applications/{id}/interview…`·`/interviews…`를 쿼리 없이 308 — 또는 기획이 "쿼리 유지"로 바꾸기
- `src/lib/data/labels.ts` `AI_FEATURE_NAMES.draft_source_ranking`("AI 근거 선택")은 v5.18 CL-2로 폐기 대상(명세 C-18 "구현 상수에서도 빼야 한다") — 데이터 계층 파일이라 손대지 않음
- `src/lib/data/actions.ts:229`·`applications.ts:148·152`·`ai-jobs.ts:265`의 면접 언급 주석 정리

## 라운드 2 (UI QA `44_ui-qa_review.md` 반영)
- **UQ-44-1**: `return-target.ts` `readNavOrigin` — `origin === "board"`만 돌려주고, 그 밖의 값(옛 `"interviews"`)·깨진 JSON은 저장값을 지우고 null. `breadcrumbs.tsx`: `ORIGIN_CRUMB` 조회가 undefined면 첫 마디를 바꾸지 않음 + `CrumbTrail`이 label 없는 마디를 거름. 테스트 3건(`return-target.test.ts`)
- **UQ-44-3**: `design-system.md` 남은 화면 규칙의 면접 문장 정리 — 5.11.2 안내 문구, 3.5 C-05(자기소개서별 "· 면접 1", "끝난 모의 면접" 줄 → 명세 영향 줄), 5.2 목록(S-37·고정 묶음)·허브(면접 카드), 3.4 error 행, 3.20 실행 버튼 예, 3.22 대상 목록. 사용처 목록(1장 폭·타이포, 2장 인벤토리, 3.22 품질 제한, 4장 ST-EMPTY 아이콘, 5.3·5.6)은 `~~…~~(폐기)` 표시
- **UQ-44-4**: S-31 기능 카드 격자 `md:grid-cols-2 lg:grid-cols-3`, 서류 초안 카드 `md:col-span-2 lg:col-span-1`(`FeatureCard`에 `className`). 규칙은 design-system 5.2 허브 "카드 격자 규칙"(홀수 마지막 카드 md 전체 폭, lg 3열)
- **UQ-44-2**: 그대로(`[UI-가정]` 위 절)
- 검사: `pnpm lint` 0 · `pnpm tsc --noEmit` 0건(이번엔 `.next` 타입이 생성된 상태라 `RouteContext` 10건도 안 나옴) · `pnpm vitest run` 144 파일 / 2346건 통과 · `pnpm build` 통과 · 브라우저 미확인
