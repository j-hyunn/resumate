# 29 런 — ui-qa 리뷰: L-02 창 스크롤 정비 (28 런 수정분)

- 검토일: 2026-11-04
- 대상: 커밋 전 변경 — `src/components/common/shell/page-shell.tsx`, `src/components/common/shell/doc-body.tsx`, `src/components/career/project-page/project-page.tsx`, `src/components/career/deliverable/deliverable-page.tsx`, `src/components/career/ai-panel/ai-panel.tsx`, `src/components/common/dev-page-shell-demo.tsx`, `docs/ui/design-system.md` 5.8–5.10. 같은 트리의 로고·아바타·`InlineFields` 변경은 L-02 높이·접근성에 닿는 곳만 봤다.
- 기준: 브리프 `_workspace/ui/28_brief_l02-scroll-fix.md`(사용자 스크린샷 포함), 엔지니어 보고 `_workspace/ui/28_frontend-engineer-A0_l02-scroll_report.md`, design-system 5.8 / 5.9 / 5.10, `02-user-flows.md` S-10 (v5.6 PA-4).
- **브라우저 미확인**: 이 런에는 브라우저 도구가 없다. 아래 판단은 코드와 CSS 규칙, 빌드 산출 CSS, 엔지니어의 WebKit 재현 수치에 기댄다. 실제 앱(localhost:3000, 로그인 필요)에서 창 스크롤·낮은 창 높이·좁은 화면·스크린리더 낭독은 확인하지 못했다. screen-status에는 `QA 통과 (mock·브라우저 미확인)`까지만 쓸 수 있다.

## 1. 요약

- **판정: 통과 (Critical 0 · Major 0 · Minor 8).** 원인 진단(STAR 목록 끝 `sr-only` 낭독 영역 `project-page.tsx:704`의 기준 상자가 화면이라 스크롤 상자에 잘리지 않고 문서 높이를 늘림)은 CSS 규칙과 스크린샷(카드 아래 body 흰 바탕, 패널 위쪽이 화면 밖으로 밀림, 칩 줄 위 빈 구분선)에 맞는다. 수정이 그 원인을 막는다.
- 바탕과 카드의 `relative` + `overflow-clip`, 왼쪽 스크롤 영역과 DocHead의 `relative`로 PageShell 안 `absolute` 자손은 모두 PageShell 안 기준 상자를 갖는다. `fixed`(떠 있는 버튼, 미리보기 전환, 탈퇴 가드)와 포털(시트, 다이얼로그, 드롭다운, 툴팁, 토스터)은 원래 문서 높이에 더하지 않는다. 바탕과 카드는 이제 스크롤 상자가 아니라서 `focus()`·`scrollIntoView()`는 왼쪽 영역·DocHead·메시지 목록 같은 진짜 스크롤 상자만 움직인다. 코드로 본 범위에서는 창이 스크롤될 경로를 더 찾지 못했다.
- 남은 것은 모두 Minor다. 낮은 창에서 배너가 상한 없이 쌓이는 경우, DocHead가 넘칠 때 신호와 키보드 경로, 문서 잔재(G-49), 스켈레톤 불일치, 패널 입력 위 빈 여백, `InlineField` dl 구조, 머리 필드 순서 가정.

## 2. 점검 결과

| # | 항목 | 결과 | 근거 |
|---|------|------|------|
| 1 | 창 스크롤 차단: `absolute` 자손 | 통과 (브라우저 미확인) | 바탕 `page-shell.tsx:500` `relative … overflow-clip`, 카드 `:504` `relative … overflow-clip`, 왼쪽 `doc-body.tsx:98` `relative`, DocHead `doc-body.tsx:42` `relative`, 패널 `ai-panel.tsx:76` `relative`. `sr-only`·저장 점(`page-shell.tsx:300`, 이미 `span.relative` 안)·MonthField 라벨 `sr-only`는 모두 셸 안 기준 상자를 갖는다 |
| 2 | 창 스크롤 차단: 셸 밖 형제 | 통과 | `(page)/layout.tsx`: OutageSlot·UserSlot은 포털이나 null, `AiJobWatcher` null, `PreviewStateSwitcher` `fixed`(`preview-state-client.tsx:44`), `DeletionIncompleteGuard` `fixed inset-0`, `ResponsiveToaster`는 루트 `body` 안 `fixed`. 루트 `body`는 `min-h-dvh`라 PageShell(`h-dvh`)보다 키우지 않는다 |
| 3 | 프로그램 스크롤 | 통과 (브라우저 미확인) | `project-page.tsx:116`(오류 칸 focus), `:239-240`(초기 STAR focus + `scrollIntoView`), `:441`(본문에서 보기), `doc-inputs.tsx:146-147`(`highlightRange`, `preventScroll` + `scrollIntoView`), `deliverable-page.tsx:297/329/336`, `ai-panel.tsx:280`(`scrollToMessage`). `overflow:clip`은 스크롤 상자가 아니라서 건너뛰고, 문서는 넘치지 않으므로 화면도 움직이지 않는다. 머리 칸(`head-*`, `p-start-year`, `project-title`)은 이제 DocHead 안에서 보이게 스크롤된다. `flashElement`(`doc-inputs.tsx:154`)는 클래스만 붙이고 스크롤하지 않는다 |
| 4 | 높이 체인 ShellBar → CrumbRow → 배너 → DocHead → DocBody | 통과 (주의 UQ-SC-1) | 카드 `flex-1 min-h-0`(column, 높이 확정) → DocHead `shrink-0 max-h-[40%]`(퍼센트는 flex 뒤 확정 높이 기준, 빌드 CSS에 `max-height:40%` 확인) → `Separator` → DocBody `flex min-h-0 flex-1`. CrumbRow(`h-12 shrink-0`)·ShellBanners(`page-shell.tsx:666` `shrink-0`)는 상한이 없다 |
| 5 | AI 패널이 높이를 채우고 메시지 목록만 스크롤, 입력 바닥 고정 | 통과 (브라우저 미확인) | 래퍼 `doc-body.tsx:103-107` 두 겹은 row flex stretch로 DocBody 높이를 받는다(`min-h-0`은 교차축이라 영향 없음). `aside flex-1 flex-col overflow-hidden` → 머리 `shrink-0` → `MessageScroller h-auto flex-1 min-h-0`(`message-scroller.tsx:28`) → 뷰포트 `overflow-y-auto overscroll-contain` → 제안 독 `max-h-[55%] shrink-0` → 입력 `panel-input.tsx` `shrink-0`. 엔지니어 재현: 입력 바닥 680 / 카드 바닥 692(`my-3` 12px) |
| 6 | `overflow-hidden` → `overflow-clip`으로 깨지는 것 | 문제 없음 | `sticky`는 L-02 아래에 하나도 없다(grep). 둥근 모서리는 `clip`도 `border-radius`로 자른다. Tailwind v4 기준 브라우저(Safari 16.4+, Chrome 111+, Firefox 128+)는 모두 `overflow: clip`을 지원한다. 드롭다운·Select·Popover·툴팁은 Radix 포털이라 DocHead `overflow-y-auto`에 잘리지 않는다. DocHead는 `overflow-x`도 `auto`가 되지만 안의 음수 여백(`DocTitleInput`·`-mx-2`)·포커스 링 2px·`flashElement` 링 2px는 `px-6`/`max-md:px-4`, `pt-2` 안에 들어간다 |
| 7 | 빈 제안 독 | 통과 | `ai-panel.tsx:430` `empty:hidden`. `StarProposalCard`가 `null`이면 React는 자식 노드를 만들지 않으므로 `:empty`가 맞는다. 스크린샷의 칩 줄 위 빈 구분선이 이것이다. 같은 모양의 빈 여백이 입력 위에도 남는다(UQ-SC-5) |
| 8 | 좁은 화면 <1024 / <768 | 통과 (브라우저 미확인) | DocBody narrow 분기(`doc-body.tsx:112-143`)는 바뀌지 않았다: `fixed` 떠 있는 버튼은 조상 `overflow-clip`·`relative`의 영향을 받지 않는다(transform·filter·contain 없음). 시트는 포털. 왼쪽 `pb-24` 그대로. DocHead `max-md:px-4`, 카드 `max-md:m-0 rounded-none` 그대로. iOS Safari에서 가상 키보드가 뜰 때 시각 뷰포트를 미는 동작은 확인 못 함 |
| 9 | 낭독 영역 | 통과 (스크린리더 미확인) | `project-page.tsx:704` `role="status" aria-live="polite" sr-only`는 DOM과 접근성 트리에 그대로 있다. `display:none`이 아니고 기준 상자만 바뀌었다 |
| 10 | DocHead 스크롤 영역 키보드 | Minor (UQ-SC-2) | 넘칠 때 안의 입력으로 Tab하면 따라 스크롤된다. 마지막 포커스 대상 뒤의 글(S-44 `NOTICE`, S-10 저장 건너뜀 목록)은 키보드만으로 볼 길이 없다 |
| 11 | design-system 5.8–5.10 갱신 | 통과 (주의 UQ-SC-3) | 5.8 바탕·카드 클래스와 "창이 스크롤되지 않게 하는 규칙" ①–③, 5.9 머리 = `DocHead` + 40% 규칙 `[UI-가정]`, 왼쪽 `relative`, 5.10 래퍼·aside 체인, 제안 독 `empty:hidden`이 코드와 같다. 부록 G-49(2022행)는 옛 760px 규칙 그대로 |
| 12 | dev 데모(`/dev/page-shell`) | 통과 | `dev-page-shell-demo.tsx:180, 399`에서 두 데모 머리도 `DocHead`로 바뀌었다 |
| Q12 | 브라우저 확인 | **미확인** | 브라우저 도구 없음. 2절 끝 "사용자 확인 요청" 참고 |

## 3. 이슈

ID는 이번 범위에 새 접두사 `UQ-SC-n`을 쓴다(기존 UQ-PA·S10·S44·BR·INT와 겹치지 않음).

### Critical
없음.

### Major
없음.

### Minor

**UQ-SC-1 · 배너가 쌓이면 낮은 창에서 본문이 여전히 0까지 눌린다** — 담당: foundation (A0)
- 명세: design-system 5.9 "2단은 카드의 약 60% 이상을 지킨다", 브리프 "본문 영역 최소 높이 확보를 우선".
- 코드: `page-shell.tsx:666` `ShellBanners` = `shrink-0`, 상한 없음. `doc-body.tsx:42` DocHead의 40%는 카드 전체 높이 기준이라 CrumbRow(48px)·배너는 계산에 들어가지 않는다.
- 실패 시나리오: S-10, 창 높이 ~600px(카드 ~536px)에서 ReturnBanner + requirementNotice + InputRestoreBanner + 저장 오류 Alert가 함께 뜨면(각 ~56–72px) 크럼 48 + 배너 ~250 + 머리 상한 214 → DocBody가 ~20px 이하. 창은 스크롤되지 않지만 STAR와 AI 패널이 거의 사라지고, 넘친 부분은 `overflow-clip`이라 닿을 길도 없다. 수정 전과 같은 종류의 문제가 남은 것이다(발생 조건은 좁다).
- 기대: 배너 묶음도 상한을 두거나(`max-h-[25%] overflow-y-auto`), 배너와 머리를 묶은 한 상자에 40% 상한을 건다. 5.9 문구의 "카드의 60%"도 실제 보장 범위(크럼·배너 제외)에 맞게 고친다.

**UQ-SC-2 · DocHead가 넘칠 때 신호가 없고, 마지막 글은 키보드로 볼 수 없다** — 담당: foundation (A0)
- 명세: design-system 5.9 머리 규칙(28 런 추가), 접근성 원칙(키보드로 모든 내용에 닿기).
- 코드: `doc-body.tsx:42-44` — 스크롤되는 머리인데 `tabIndex`·`role="region"`·이름·스크롤 그림자(`scroll-fade-b` 같은 표시)가 없다. 마지막 요소가 글뿐이다: S-44 `deliverable-page.tsx:421` `NOTICE`, S-10 `project-page.tsx:613` 저장 건너뜀 목록.
- 실패 시나리오: 1366×768 노트북에서 S-10 역량 칩이 두 줄로 감기고 오류 문구가 두세 개 붙으면 머리가 상한(~234px)을 넘는다. 아래쪽 건너뜀 안내가 접힌 채 남는데, 시각적으로 더 있다는 표시가 없다. Chrome은 포커스 가능한 자식이 있는 스크롤 상자를 키보드 포커스 대상으로 만들지 않고 Safari는 원래 만들지 않으므로, 키보드 사용자는 마지막 포커스 칸 아래의 글로 스크롤할 수 없다.
- 기대: 넘칠 때만(ResizeObserver) `tabIndex={0}` + `role="region"` + `aria-label="프로젝트 정보"`(S-44 "산출물 정보") `[UI-가정]`, 아래쪽 페이드 같은 넘침 표시. 디자인 표현은 ui-designer가 5.9에 정한다.

**UQ-SC-3 · 부록 G-49가 폐기된 760px 규칙을 그대로 적고 있다** — 담당: ui-designer
- 문서: `docs/ui/design-system.md:2022` "창 높이 760 미만이면 머리를 왼쪽 스크롤 안으로" vs 같은 문서 5.9(1642행) "머리 최대 40%, 넘치면 머리만 스크롤".
- 기대: G-49를 5.9와 맞춘다. 40% 규칙 자체가 `[UI-가정]`이라 ui-designer 확인도 함께 필요하다(엔지니어 요청과 같음).

**UQ-SC-4 · 로딩 스켈레톤이 새 셸 규칙과 다르다** — 담당: foundation (A0)
- 명세: design-system 5.8 "창이 스크롤되지 않게 하는 규칙" ①.
- 코드: `page-shell-skeleton.tsx:8, 16` 바탕·카드가 `overflow-hidden`이고 `relative`가 없다. 머리 자리(`:22`)는 상한이 없다.
- 실패 시나리오: 지금은 `sr-only`가 맨 위에 있어 문서 높이를 늘리지 않으므로 증상은 없다. 나중에 아래쪽에 낭독 영역이나 `absolute` 요소를 넣으면 같은 버그가 되살아난다. 로딩 → 본문 전환 때 머리 높이가 달라 낮은 창에서 화면이 튈 수 있다.
- 기대: 바탕·카드 클래스를 PageShell과 같게(`relative … overflow-clip`), 머리 자리도 `max-h-[40%]`.

**UQ-SC-5 · 패널 입력 위에 빈 여백 상자가 남는다 (제안 독과 같은 종류)** — 담당: A2 (Resumate AI 패널)
- 명세: design-system 5.10 제안 독 `empty:hidden`(28 런)과 같은 원칙.
- 코드: `ai-panel.tsx:105` `{renderAboveInput ? <div className="shrink-0 px-3 pt-2">{renderAboveInput(panel)}</div> : null}`. S-10은 `renderAboveInput`을 늘 넘기고(`project-page.tsx` 돌아가기 버튼), 게이트가 없으면 `null`을 돌려준다.
- 실패 시나리오: S-10에서 돌아가기 대상이 없는 보통 경우, 칩 줄 위·입력 위에 8px 빈 띠가 남는다.
- 기대: 같은 `empty:hidden`을 붙인다.

**UQ-SC-6 · `InlineField`의 dl 구조가 HTML 규칙에 맞지 않는다** — 담당: foundation (A0)
- 명세: design-system 5.9 "머리 — 필드 행" `InlineFields`(`dl` + 항목마다 `dt`/`dd`).
- 코드: `doc-inputs.tsx:189-201` — `dl > div > (div > dt, dd) + div(error)`. `dl`의 `div` 묶음 안에는 `dt`/`dd`가 바로 와야 하는데, 두 겹 div와 오류 div가 끼었다. 기존 `FieldRow`(`:170-181`)는 오류를 `dd` 안에 둔다.
- 실패 시나리오: 일부 스크린리더(VoiceOver 목록 탐색)에서 "프로젝트 종류 / 경험 유형 / 진행 기간"의 용어–값 묶음이 드러나지 않는다. 오류 문구는 `aria-describedby`로 이어져 있어 기능 손실은 작다.
- 기대: `dl > div.flex-col > dt + dd`, 오류는 `dd` 안(`basis-full`)으로. 시각은 같게 유지할 수 있다.

**UQ-SC-7 · 머리 필드 화면 순서와 오류 포커스 순서가 다르다** — 담당: A2 (S-10)
- 명세: `02-user-flows.md` S-10 v5.6(PA-4) 머리 = 프로젝트 종류 · 경험 유형 · 역량 · 진행 기간 · 진행 중. design-system 5.9는 역량을 아래로 내린 배치를 `[UI-가정]`으로 적었다.
- 코드: `project-page.tsx:103` `FOCUS_ORDER = [name, project_type, experience_type, competencies, period, …]` vs 화면 순서(`:571-610`) 종류 · 경험 유형 · 기간 → 역량.
- 실패 시나리오: 기간 순서 오류와 역량 오류가 함께 있을 때 저장하면, 화면에서 아래에 있는 역량으로 포커스가 가고 위의 기간 오류를 지나친다. Tab 순서(DOM)와 첫 오류 이동 순서도 서로 다르다.
- 기대: `FOCUS_ORDER`를 화면 순서(…, `period`, `competencies`)로 맞춘다. 배치 자체는 아래 UQ-SC-8에서 확인.

**UQ-SC-8 · 머리 배치 변경(역량을 아래로)이 명세 순서와 다르다 — 확인 요청** — 담당: `기획` (ui-designer 경유)
- 명세: `02-user-flows.md` 154행(S-10 v5.6), 2019행(PA-4) "프로젝트 종류 · 경험 유형 · 역량 · 진행 기간 · 진행 중".
- 문서·코드: design-system 5.9 "화면 순서: (한 줄) 프로젝트 종류 · 경험 유형 · 진행 기간(+ 진행 중) → 역량 … `[UI-가정]`", `project-page.tsx:571-610`.
- 이번 런 범위 밖의 앞선 변경(`InlineFields`)이지만 L-02 머리 높이와 순서에 닿아 적는다. 나열 순서가 명세 의도인지, 표시 순서는 자유인지 기획 확인이 필요하다.

## 4. 수정 범위·소유권 메모

- `ai-panel.tsx`는 영역표상 A2(Resumate AI 패널) 파일인데 A0 엔지니어가 고쳤다. 변경이 `relative`·`empty:hidden` 두 클래스뿐이고 리더 브리프 범위에 명시돼 있어 문제 삼지 않는다. 상태표에는 A2 파일 변경으로 남겨 둔다.
- L-01(`SidebarInset`) 화면도 같은 원리(스크롤 상자 안 `sr-only` + 기준 상자 없음)로 창이 늘어날 수 있는지는 이번 범위가 아니다. 다음 L-01 점검 때 같은 grep(`sr-only`·`absolute` 조상에 `relative` 없는 스크롤 상자)을 돌릴 것을 권한다.

## 5. 기계 검사

| 검사 | 결과 | 비고 |
|------|------|------|
| `pnpm typecheck` | 통과 | `next typegen && tsc --noEmit`, 오류 0 |
| `pnpm lint` | 통과 | 출력 없음, exit 0 |
| `pnpm exec vitest run src/components` | 통과 | 4 파일 · 34 테스트 |
| `pnpm build` | 통과 (격리 사본) | dev 서버와 `.next`를 나누지 않으려고 worktree를 scratchpad로 복사(`.next`·`node_modules`·`.git` 제외)하고 `pnpm install --offline --frozen-lockfile` 뒤 빌드. 전 경로 생성 성공. 빌드 CSS에 `.overflow-clip{overflow:clip}`, `max-h-[40%]{max-height:40%}` 확인. 사본: `/private/tmp/claude-501/-Users-jehyun-Resumate--claude-worktrees-resumate-logo-replacement-9f2d53/2ec3b6a0-3c26-4484-8190-5838594f6a17/scratchpad/buildcopy` |
| 브라우저 | 미확인 | 도구 없음 |

## 6. 사용자(또는 다음 브라우저 런) 확인 요청

브라우저에서만 확정할 수 있는 항목이다. S-10과 S-44 각각.
1. 넓은 화면(≥1024)에서 STAR 끝까지 스크롤: 창은 그대로이고 ShellBar·머리가 고정되는지, 카드 아래 흰 영역이 없는지, AI 패널 입력창이 패널 바닥에 붙는지.
2. "AI에게 물어보기"·[반영] 깜박임·"본문에서 보기"·`?focus=` 진입: 왼쪽 영역 안에서만 움직이는지.
3. 창 높이를 600px 안팎으로 줄였을 때: 머리가 40%에서 멈추고 자체 스크롤, 본문이 남는지. 배너 여러 개가 겹칠 때(UQ-SC-1).
4. <1024 / <768: 떠 있는 버튼·시트·`pb-24`, iOS Safari에서 STAR 입력 시 가상 키보드가 뜰 때 화면이 밀리지 않는지.
5. VoiceOver: [반영] 후 "…에 채웠어요. 저장하기를 눌러야 저장돼요" 낭독.
