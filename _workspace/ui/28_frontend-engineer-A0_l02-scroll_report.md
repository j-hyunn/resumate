# 28 런 — frontend-engineer (A0) 보고: L-02 창 스크롤 정비

대상: L-02 셸(PageShell · DocBody), S-10 프로젝트 상세, S-44 산출물 상세, AI 패널. 커밋하지 않았다. dev 서버는 건드리지 않았다.

## 1. 원인

### 원인 1 (핵심): `absolute` 자손이 화면 기준으로 빠져나와 문서 높이를 늘림
- `src/components/career/project-page/project-page.tsx:704` — STAR 목록 맨 끝의 낭독 영역 `<div role="status" aria-live="polite" className="sr-only">`. `sr-only`는 `position:absolute`다.
- 이 요소에서 위로 올라가면 `position`이 있는 조상이 하나도 없었다: DocBody 왼쪽 스크롤 영역 `min-w-0 flex-1 overflow-y-auto`(`doc-body.tsx` 원래 87행), 카드 `main … overflow-hidden`(`page-shell.tsx` 원래 501행), 바탕 `div.flex h-dvh … overflow-hidden`(원래 497행) 모두 `relative`가 아니었다.
- CSS 규칙상 기준 상자(containing block)가 화면(초기 기준 상자)인 `absolute` 요소는 그 사이 `overflow` 상자에 잘리지 않는다. 그래서 STAR 본문 끝 위치(1px 상자)가 문서의 스크롤 높이에 그대로 더해진다 → 창 자체가 스크롤되고, 카드(h-dvh) 아래로 body의 흰 바탕이 보였다. 스크린샷과 같다(카드 아래 흰 영역, 셸 민트 바탕이 아님 = 바탕 div 바깥까지 문서가 내려감).
- 이 요소는 처음 구현(커밋 `9586d81`, PA-1~PA-4)부터 있었다. 직전 변경(`InlineFields` 한 줄 배치, ShellBar 아바타)은 원인이 아니다. 형제 요소(PageShellOutageSlot·PageShellUserSlot·AiJobWatcher는 `null`이나 포털, PreviewStateSwitcher·떠 있는 버튼·Toaster·DeletionIncompleteGuard는 `fixed`)도 문서 높이에 더하지 않는다(가설 1 기각).

### 원인 2 (가설 3, 일부 맞음): 프로그램 스크롤
- 문서가 길어진 상태에서 `scrollIntoView`(`project-page.tsx:240`, `:441`, `doc-inputs.tsx:147`, `deliverable-page.tsx:329/336`)와 `focus()`가 창까지 스크롤했다. 원인 1을 없애면 창은 더 늘어나지 않지만, 머리가 카드보다 길어지는 낮은 창에서는 `overflow-hidden`인 `main`이 스크롤 가능한 상자라 프로그램 스크롤로 밀려 올라간다(재현 결과 `main.scrollTop = 14`). → `overflow-clip`으로 바꿨다.

### 원인 3: 낮은 창에서 머리가 본문을 0으로 눌러 버림
- 머리는 `shrink-0`이고 DocBody는 `min-h-0 flex-1`이라 머리가 길어지면 본문 높이가 0까지 줄어든다(재현: 머리 600px → 왼쪽 높이 0). design-system 5.9의 "760px 미만이면 머리를 왼쪽 스크롤 안으로" 규칙은 코드에 없었다(`max-height` 분기 grep 결과 없음).

### AI 패널 "빈 회색 영역"
- 위쪽 빈 회색: 창이 스크롤되어 패널 머리와 인사 메시지가 화면 위로 밀려난 결과다. 메시지 목록 자체의 높이 체인(`MessageScroller relative flex size-full min-h-0 … flex-1`, 입력 영역 `shrink-0`)은 문제가 없었다(가설 4는 기각, 다만 래퍼에 `min-h-0`을 보강).
- 칩 줄 위의 가는 구분선 + 12px 빈칸: `ProposalDock`(`ai-panel.tsx`)은 `renderProposal`이 요소를 넘기면 항상 그려지는데, `StarProposalCard`는 제안이 없으면 `null`을 돌려준다(`star-proposal-card.tsx:211`). 그래서 내용 없는 `border-t px-3 pt-3` 상자가 남았다. → `empty:hidden`.

## 2. 바꾼 것 (파일별)

| 파일 | 변경 |
|------|------|
| `src/components/common/shell/page-shell.tsx` | 바탕 div `overflow-hidden` → `relative … overflow-clip`, 카드 `main` `overflow-hidden` → `relative … overflow-clip`. 이유 주석 |
| `src/components/common/shell/doc-body.tsx` | 새 `DocHead`(`relative max-h-[40%] shrink-0 overflow-y-auto px-6 pt-2 pb-4 max-md:px-4`) 추가. 왼쪽 스크롤 영역에 `relative`. 패널 래퍼 두 겹에 `min-h-0` |
| `src/components/career/project-page/project-page.tsx` | 머리 div → `<DocHead className="space-y-3">` (내용 변경 없음) |
| `src/components/career/deliverable/deliverable-page.tsx` | 머리 div → `<DocHead className="space-y-2">` |
| `src/components/career/ai-panel/ai-panel.tsx` | `aside`에 `relative`. `ProposalDock`에 `relative … empty:hidden` |
| `src/components/common/dev-page-shell-demo.tsx` | 개발용 데모의 머리 두 곳도 `DocHead`로(같은 셸 규칙) |
| `docs/ui/design-system.md` | 5.8: 바탕·카드 클래스 `relative overflow-clip`, "창이 스크롤되지 않게 하는 규칙" 항목 추가. 5.9: 머리 = `DocHead`, 760px 규칙을 "머리 최대 40%, 넘치면 머리만 스크롤"로 교체 `[UI-가정]`, 왼쪽 컨테이너 `relative`. 5.10: 패널 래퍼·aside 높이 체인 명시, 제안 독 `empty:hidden` |

좁은 화면(시트 패널, 떠 있는 버튼, `pb-24`)은 손대지 않았다. 떠 있는 버튼은 `fixed`라 바탕의 `relative`/`overflow-clip` 영향을 받지 않는다(조상에 transform·contain 없음).

## 3. 검증

- 통과: `pnpm typecheck`, `pnpm exec eslint`(변경 파일 6개, 출력 없음), `pnpm exec vitest run src/components`(4 파일 34 테스트).
- dev 서버(재시작 안 함)가 내보내는 CSS에 `.overflow-clip`, `.max-h-[40%]`, `.empty:hidden`이 들어 있음을 curl로 확인.
- **레이아웃 재현 (WebKit, 설치 없이)**: 시스템 Swift + `WKWebView`(1400×700)에 L-02 높이 체인을 같은 CSS로 옮긴 정적 페이지를 띄워 측정했다. 스크립트: `/private/tmp/claude-501/-Users-jehyun-Resumate--claude-worktrees-resumate-logo-replacement-9f2d53/2ec3b6a0-3c26-4484-8190-5838594f6a17/scratchpad/repro/repro.swift`

| 경우 | 문서 높이 | scrollIntoView 후 창 Y | main.scrollTop | 왼쪽 높이 | 패널 입력 바닥 / 카드 바닥 |
|------|-----------|------------------------|----------------|-----------|---------------------------|
| 수정 전, 머리 150px | 1793 | 322 | 0 | 436 | 358 / 370 (창이 밀림) |
| 수정 후, 머리 150px | 700 | 0 | 0 | 436 | 680 / 692 |
| 수정 전, 머리 600px | 2243 | 342 | 14 | 0 | 490 / 350 |
| 수정 후, 머리 600px | 700 | 0 | 0 | 332 | 680 / 692 (머리 254px로 제한) |

  수정 전 수치가 스크린샷(카드 아래 빈 영역)을 재현하고, 수정 후에는 창이 움직이지 않으며 입력창이 패널 바닥에 붙는다.
- **브라우저 미확인**: 실제 앱(localhost:3000, 로그인 필요)을 Chrome·Safari에서 열어 보지 못했다. 위 재현은 Tailwind가 아닌 손으로 옮긴 CSS이고 WebKit만이다. 사용자가 S-10·S-44에서 스크롤·"AI에게 물어보기"·[반영] 깜박임·낮은 창 높이를 한번 확인해 주면 좋다.

## 4. 기획 확인 필요 / UI-가정

- `[UI-가정]` design-system 5.9의 "창 높이 760px 미만이면 머리를 왼쪽 스크롤 안으로 옮김"을 "머리 최대 카드 높이 40%, 넘치면 머리만 스크롤"로 바꿨다. 이유: 브리프 기준(본문 최소 높이 확보 우선)에 맞고, 머리를 두 곳에 그리거나 옮기지 않아도 되며 포커스·`id` 대상(`head-*`)이 한 곳에 남는다. ui-designer 확인 요청.
- `기획 확인 필요` 없음(명세 동작 변경 없음).
- 백엔드 요청 없음.
