# 28 런 브리프 — L-02 풀페이지 스크롤 레이아웃 정비 (2026-11-04)

## 요청 (사용자 원문)
> 화면을 하단으로 내리면 레이아웃이 이상하게 적용돼. UI 하네스 불러다가 다시 정비해. 프로젝트 정보 밑으로는 내용과 ai 챗만 보여져야해.

스크린샷: `_workspace/ui/28_user-screenshot_l02-scroll.webp` (S-10 프로젝트 상세, 넓은 화면)
- 아래로 스크롤하면 **창(document) 자체가 스크롤**되어 ShellBar·프로젝트 머리(제목·필드)가 화면 밖으로 밀려나고, 흰 카드의 아래 모서리 밑으로 빈 흰 영역이 보인다.
- AI 패널 위쪽도 빈 회색 영역으로 남는다.

## 기대 동작
- L-02는 창이 스크롤되지 않는다 (design-system 5.8: `h-dvh`, "the window never scrolls").
- 위에서부터 고정: ShellBar → CrumbRow → 프로젝트 머리(제목 + 프로젝트 종류·경험 유형·진행 기간 한 줄 + 역량) → 구분선.
- 그 아래 남은 높이 전부를 DocBody가 차지: 왼쪽 본문(STAR)만 자체 스크롤, 오른쪽 AI 패널은 카드 높이에 맞춰 메시지 영역만 자체 스크롤, 입력창은 패널 바닥에 붙는다.
- 머리가 너무 길어지는 좁은 높이에서도 창이 스크롤되면 안 된다 (필요하면 머리 + 본문을 함께 스크롤하는 쪽보다 본문 영역 최소 높이 확보를 우선 — 판단은 엔지니어, 근거 기록).

## 범위
- 파운데이션: `src/components/common/shell/page-shell.tsx`(PageShell), `src/components/common/shell/doc-body.tsx`(DocBody), 필요하면 `src/app/(page)/layout.tsx`·전역 CSS.
- 화면: S-10 `src/components/career/project-page/project-page.tsx`, S-44 `src/components/career/deliverable/deliverable-page.tsx` (같은 셸이므로 둘 다 확인), AI 패널 `src/components/career/ai-panel/ai-panel.tsx`의 높이 체인.

## 리더 관찰 (가설, 검증 필요)
- PageShell 루트는 `flex h-dvh flex-col overflow-hidden`, main은 `min-h-0 flex-1 overflow-hidden`, DocBody는 `flex min-h-0 flex-1`이라 겉보기엔 맞다. 그런데도 창이 스크롤된다면:
  1. PageShell 바깥(레이아웃 형제: PageShellOutageSlot·AiJobWatcher·PreviewStateSwitcher·DeletionIncompleteGuard·Toaster·포털 등)이나 body/html 쪽에 높이를 더하는 요소가 있거나,
  2. project-page에서 PageShell 안의 머리 블록과 DocBody 사이 높이 체인 어딘가가 `min-h-0`/`flex-1` 없이 내용 높이로 늘어나 main을 넘치게 하거나,
  3. `overflow-hidden` 컨테이너(main 등)가 focus/scrollIntoView/flashElement로 프로그램 스크롤되고 있을 수 있다 (overflow:hidden도 스크립트로는 스크롤된다 → `overflow-clip` 검토).
  4. AI 패널 쪽 높이 체인(`my-3 mr-3 flex` 래퍼 → 패널 루트)이 `h-full`/`min-h-0` 없이 메시지 내용 높이만큼 늘어날 수 있다.
- 이번 런 직전 변경: 프로젝트 머리 필드를 한 줄 배치로 바꿈(`InlineFields`, `doc-inputs.tsx`), ShellBar 아바타 추가. 이것들이 원인인지도 확인.

## 환경
- dev 서버: 이 worktree에서 `localhost:3000` 실행 중 (재시작 금지 — 사용자가 보고 있음). 로컬 Supabase 사용.
- 브라우저 도구: Claude in Chrome 미연결. 브라우저 확인이 안 되면 코드 근거로 판단하고 "브라우저 미확인"으로 기록.

## 기준 문서
- `docs/ui/design-system.md` 5.8 (L-02 셸), 5.9 (문서형 페이지 · 본문 2단), 5.10 (AI 패널)
- 플랜 버전: 화면 상태표 상단과 동일 (PRD v4.6 / 플로우 v5.6 / AI v4.6 / DM v4.5)
