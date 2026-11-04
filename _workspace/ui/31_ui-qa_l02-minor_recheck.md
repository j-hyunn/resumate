# 31 런 — ui-qa 재확인: L-02 Minor 정리 (30 런 수정분)

- 검토일: 2026-11-04
- 대상: 커밋 전 변경 — `src/components/common/shell/overflow-scroller.tsx`(신규), `doc-body.tsx`, `page-shell.tsx`, `page-shell-skeleton.tsx`, `src/components/common/doc-inputs.tsx`(`InlineField`), `project-page.tsx`·`deliverable-page.tsx`(DocHead `label`), `ai-panel.tsx`(리더 `empty:hidden`), `docs/ui/design-system.md` 5.8·5.9·G-49.
- 기준: 이전 리뷰 `_workspace/ui/29_ui-qa_l02-scroll_review.md`, 엔지니어 보고 `_workspace/ui/30_frontend-engineer-A0_l02-minor_report.md`, design-system 5.8–5.10, `02-user-flows.md` S-10.
- **브라우저 미확인**: 이 런에도 브라우저 도구가 없다. 판단은 코드·CSS 규칙·빌드 CSS와, 내가 따로 돌린 WebKit(WKWebView) 정적 재현(`InlineField` 위치 측정)에 기댄다. 실제 앱에서 페이드 모양·Tab 진입·VoiceOver 낭독·낮은 창·<768 모습은 확인하지 못했다. screen-status에는 `QA 통과 (mock·브라우저 미확인)`까지만.

## 1. 요약

- **판정: 통과 (Critical 0 · Major 0 · 새 Minor 2).** 29 런 Minor 7건 중 7건 해결(UQ-SC-1~7), UQ-SC-8은 기획 질문으로 열린 채 둔다.
- 새로 생긴 것 2건, 둘 다 30 런 변경이 만든 Minor: `InlineField` 라벨이 오류 표시·값 줄바꿈 때 값과 어긋남(UQ-SC-9), 넘침 페이드가 키보드 포커스된 칸을 흐리게 덮음(UQ-SC-10).
- 회귀 점검(ResizeObserver 정리, SSR/하이드레이션, `scroll-fade-b` 재사용, DocHead `className` 위치, `min-h-[50%]`↔40%·좁은 화면, 장애 배너 25%, 스켈레톤 전환)에서는 문제를 찾지 못했다. 참고 사항만 3절 끝에 적었다.

## 2. 이전 이슈 재확인

| ID | 결과 | 근거 |
|----|------|------|
| UQ-SC-1 배너가 쌓이면 본문이 0까지 | **해결** (브라우저 미확인) | `doc-body.tsx:102` DocBody `min-h-[50%] flex-1`, DocHead `doc-body.tsx:46` `max-h-[40%] shrink`(+ OverflowScroller `min-h-0`), ShellBanners `page-shell.tsx:673` `shrink`(+ `min-h-0`). 카드는 `flex-1 min-h-0` column이라 높이가 확정되고 퍼센트 min/max가 그 높이로 풀린다. DocBody는 basis 0이라 줄지 않고 음수 여유는 배너·머리만 나눠 갖는다. 빌드 CSS `min-h-\[50\%\]{min-height:50%}` 확인. 5.9 "약 60%" 문구도 50%로 정정됨 |
| UQ-SC-2 DocHead 넘침 신호·키보드 | **해결** (브라우저 미확인) | `overflow-scroller.tsx:65-75` 넘칠 때만 `role="region"` + `aria-label` + `tabIndex=0` + `scroll-fade-b`(끝이 아닐 때). S-10 `project-page.tsx:521` "프로젝트 정보", S-44 `deliverable-page.tsx:364` "산출물 정보", 배너 "알림". 포커스 링 `ring-inset`(카드 `overflow-clip`에 안 잘림). 새 Minor UQ-SC-10 참고 |
| UQ-SC-3 G-49 옛 760px 규칙 | **해결** | `design-system.md:2025` G-49 = 40% 상한 + 30 런 요약. 5.9(1643행)와 맞음. 문서 안 다른 "760" 언급은 1643행의 "바꾼다" 설명뿐 |
| UQ-SC-4 스켈레톤 불일치 | **해결** | `page-shell-skeleton.tsx:10` 바탕, `:18` 카드 `relative … overflow-clip`, 머리 자리 `max-h-[40%] min-h-0 shrink`, 본문 자리 `min-h-[50%] flex-1`. 5.8 ④ 규칙 추가 |
| UQ-SC-5 패널 입력 위 빈 여백 | **해결** | `ai-panel.tsx:105` 래퍼에 `empty:hidden`. S-10 `renderAboveInput`(`project-page.tsx:735-742`)은 게이트가 없으면 `null` → 자식 노드 없음 → `:empty` 일치. 빌드 CSS `empty\:hidden:empty{display:none}` 확인 |
| UQ-SC-6 `InlineField` dl 구조 | **해결** (모양은 새 Minor UQ-SC-9) | `doc-inputs.tsx:196-206` `dl > div > dt + dd`, 오류는 `dd` 안. HTML 규칙(`dl` 안 `div`는 `dt`/`dd`만) 충족. `dd` 안 `div`는 흐름 콘텐츠라 유효 |
| UQ-SC-7 FOCUS_ORDER ↔ 화면 순서 | **해결** | `project-page.tsx:103` `name, project_type, experience_type, period, competencies, …STAR` = 화면 순서(`:571-610` 종류 · 경험 유형 · 기간 → 역량) = DOM Tab 순서 |
| UQ-SC-8 머리 배치(역량 아래) 명세 확인 | **미해결 (기획 대기)** | 손대지 않음(지시대로). `02-user-flows.md` S-10 v5.6 순서와 5.9 `[UI-가정]` 배치가 다름 |

## 3. 회귀 점검

| # | 항목 | 결과 | 근거 |
|---|------|------|------|
| R1 | `useScrollOverflow` ResizeObserver·scroll 정리 | 문제 없음 | `overflow-scroller.tsx:27-44` effect 하나에서 `ro.disconnect()` + `removeEventListener`. 관찰 대상은 상자와 안쪽 래퍼(항상 하나, 늘 렌더) — 내용이 늘어 상자가 상한에 묶여도 래퍼 크기 변화로 다시 잰다. 창 크기 변화는 상자 관찰로 잡힌다. ShellBanners는 항목이 0개면 `null`이라 언마운트·정리된다. `setState`는 값이 같으면 같은 객체를 돌려줘 불필요한 렌더 없음 |
| R2 | SSR/하이드레이션 불일치 | 문제 없음 | 초기 상태 `{overflowing:false, atEnd:true}`가 서버·클라이언트 첫 렌더에서 같다 → `role`·`tabIndex`·`aria-label`·`data-overflowing` 모두 미지정, 클래스도 같음. 바뀌는 건 effect 뒤 |
| R3 | shadcn `scroll-fade-b` 재사용 | 문제 없음 (모양은 UQ-SC-10) | `node_modules/shadcn/dist/tailwind.css:317` `@utility scroll-fade-b` 그대로 사용, `globals.css` 변경 없음(diff 0) → `MessageScroller`(`message-scroller.tsx:45`) 동작 변화 없음. 알파 마스크라 색 토큰 무관. scroll-timeline 지원 브라우저는 끝 96px에서 애니메이션으로, 미지원(Safari·Firefox)은 JS가 클래스를 떼서 끝에서 사라짐. 빌드 CSS에 포함 확인 |
| R4 | DocHead `className`이 안쪽 div로 이동 | 문제 없음 | 호출처 4곳 모두 간격 클래스만 넘긴다: `project-page.tsx:521` `space-y-3`, `deliverable-page.tsx:364` `space-y-2`, `dev-page-shell-demo.tsx:180, 399` `space-y-3`. 바깥 상자 클래스를 넘기는 호출처 없음 |
| R5 | `min-h-[50%]` ↔ 40% 머리 상한 · 좁은 화면 | 문제 없음 (브라우저 미확인) | 높은 창: 머리 ≤ 40% → 크럼 48 + 머리 + 구분선 1 + 본문 ≥ 50%가 늘 성립(카드 ≥ ~480px). 낮은 창에서만 배너·머리가 비율대로 줄고 각자 스크롤(엔지니어 WebKit 재현 수치와 규칙이 일치). DocBody 호출처는 `className`을 넘기지 않아(`grep <DocBody`) `min-h`를 덮지 않음 — dev 데모 `min-h-[24rem]`은 `DocTextarea` 것. <768: 카드 전체 화면, 같은 규칙. 떠 있는 버튼 `fixed`·시트 포털 영향 없음 |
| R6 | 장애 배너 자리 25% 상한 | 문제 없음 | `page-shell.tsx:505` `relative max-h-[25%] shrink-0 overflow-y-auto empty:hidden`. 바탕이 `h-dvh` column이라 25%가 확정 높이로 풀림(빌드 CSS `max-height:25%` 확인). 포털 대상이 비면 `:empty`로 숨음, SSR에서는 늘 빈 div라 불일치 없음 |
| R7 | 스켈레톤 → 본문 전환 | 문제 없음 (브라우저 미확인) | 같은 상자 규칙이라 창 스크롤·흰 띠가 생기지 않는다. 머리 높이(스켈레톤 고정 3줄 vs 실제 내용)는 원래부터 달라 전환 때 구분선 위치가 바뀌는 건 로딩 화면 특성 — 이번 변경이 늘리지 않음 |
| R8 | `InlineField` grid/subgrid 마크업 | Minor UQ-SC-9 | 구조는 유효. 아래 WebKit 측정에서 라벨 세로 위치가 값과 어긋남 |

### 3.1 WebKit 정적 재현 (`InlineField`, 31 런 QA)

스크립트: `/private/tmp/claude-501/-Users-jehyun-Resumate--claude-worktrees-resumate-logo-replacement-9f2d53/2ec3b6a0-3c26-4484-8190-5838594f6a17/scratchpad/qa31/qa.swift` (구현 클래스를 인라인 CSS로 옮긴 정적 페이지, 14px, 값 = 월 입력 2 + "진행 중" + 기간 문구)

| 경우 | 라벨 글자 중심 y | 첫 입력 중심 y | 비고 |
|------|------|------|------|
| 넓음, 오류 없음 | 18 | 18 | 맞음 |
| 넓음, 오류 있음 | **29** | 18 | 라벨이 11px 내려감 |
| 넓음, 긴 오류 | 29 | 18 | 항목 폭 421 → 551(오류 글 길이로 넓어짐 — 이전 `basis-full`과 같은 성질, 이슈 아님) |
| 343px, 오류 없음(값 2줄) | **73** | 60 | 라벨이 두 줄 값의 가운데 |
| 343px, 오류 있음 | **83** | 60 | |

## 4. 새 이슈

### Critical
없음.

### Major
없음.

### Minor

**UQ-SC-9 · `InlineField` 라벨이 오류 표시·값 줄바꿈 때 값과 같은 줄에서 벗어난다** — 담당: foundation (A0)
- 명세: design-system 5.9 "머리 — 필드 행" (30 런) "라벨·값 나란히 … 이전 모양과 같다", "`dt` = 1열 1행 `flex min-h-9 items-center`".
- 코드: `src/components/common/doc-inputs.tsx:198` `dt` = `flex min-h-9 items-center`. `dd`(`:201`)가 1행 하나에 값과 오류를 모두 담으므로 부모 1행 높이 = 값 + 오류. 그리드 기본 `align-self: stretch`로 `dt`가 그 높이까지 늘어나고 `items-center`가 라벨을 그 가운데로 보낸다.
- 실패 시나리오: S-10에서 기간 순서 오류로 저장하면 "진행 기간" 라벨이 월 입력보다 ~11px 아래로 처져 오류 줄 쪽으로 붙는다(3.1 측정). 같은 줄의 "프로젝트 종류"·"경험 유형" 라벨과도 높이가 달라진다. <768에서 값이 두 줄로 감기면 라벨이 첫 줄이 아니라 두 줄 사이에 놓인다(오류가 있으면 더 내려감). 엔지니어 재현은 상자 top만 재서 드러나지 않았다.
- 기대: `dt`에 `self-start`(1행 위에 붙이고 `min-h-9 items-center`로 첫 줄 값과 중심 맞춤). 5.9 마크업 문구에도 반영.

**UQ-SC-10 · 넘침 페이드가 키보드로 포커스된 칸과 영역 포커스 링을 흐리게 덮는다** — 담당: foundation (A0) (표현 확정은 ui-designer)
- 명세: design-system 5.9 "머리·배너가 넘칠 때"(30 런) — 페이드는 "더 있다" 신호, 접근성 원칙(포커스 대상은 또렷이 보임).
- 코드: `src/components/common/shell/overflow-scroller.tsx:72-73` — 넘치고 끝이 아니면 상자 전체에 `scroll-fade-b` 마스크(아래 `min(12%, 40px)`가 불투명 → 투명). 스크롤 여백(`scroll-padding`)이 없다.
- 실패 시나리오: 낮은 창에서 DocHead가 넘친 상태로 Tab을 누르면 브라우저는 다음 칸(칩 선택·월 입력)을 "가장 가까운" 위치, 곧 상자 아래 가장자리에 맞춰 스크롤한다. 그 칸이 페이드 띠(머리 214px이면 ~26px) 안에 들어가 아래쪽 절반이 투명하게 흐려지고, 포커스 링도 함께 흐려진다. Safari·Firefox(scroll-timeline 미지원)는 끝에 닿기 전까지 띠가 고정 크기로 늘 있다. 상자 자체에 포커스했을 때 `ring-inset` 아래 변도 같은 이유로 사라진다. 코드·CSS 판단, 브라우저 미확인.
- 기대: 스크롤 상자에 페이드 크기 이상의 `scroll-padding-bottom`(예: `scroll-pb-10`)을 줘 포커스 스크롤이 띠 밖에서 멈추게 한다. 상자 포커스 링은 마스크 밖에서 그리거나(예: `focus-visible` 때 페이드 끄기) ui-designer가 5.9에 정한다.

### 참고 (이슈 아님, 기록만)
- `grid-cols-subgrid`는 Chrome 117+ / Safari 16+ / Firefox 71+. Tailwind v4 기준선(Chrome 111+)의 111–116에서는 `subgrid`가 무효가 돼 `dd` 안 값이 0폭 암시 열 뒤(=라벨 위치)에 겹쳐 그려질 수 있다. 사용자 비중이 작아 기록만 한다.
- 넘침 상자에 포커스가 있는 채 창이 커져 넘침이 풀리면 `tabIndex`가 사라져도 포커스는 그 div에 남는다(다음 Tab은 정상 진행). 실사용 영향 없음.
- 장애 배너 자리(`page-shell.tsx:505`)는 25%에서 스크롤되지만 OverflowScroller(이름·페이드·키보드)를 쓰지 않는다. 배너 한 개 높이(~56px)가 상한(창 600px에서 150px)보다 훨씬 작아 실제로 넘칠 일은 거의 없다.

## 5. 기계 검사

격리 사본(`/private/tmp/claude-501/-Users-jehyun-Resumate--claude-worktrees-resumate-logo-replacement-9f2d53/2ec3b6a0-3c26-4484-8190-5838594f6a17/scratchpad/buildcopy`)에 worktree를 rsync(`.next`·`node_modules`·`.git`·`_workspace` 제외)한 뒤 실행. `next typegen`도 `.next`를 쓰므로 네 검사 모두 사본에서 돌렸다. dev 서버(3000)와 그 `.next`는 건드리지 않았다.

| 검사 | 결과 | 비고 |
|------|------|------|
| `pnpm typecheck` | 통과 | `next typegen && tsc --noEmit`, 오류 0 |
| `pnpm lint` | 통과 | 출력 없음, exit 0 |
| `pnpm exec vitest run src/components` | 통과 | 4 파일 · 34 테스트 |
| `pnpm build` | 통과 | exit 0, 전 경로 생성. 빌드 CSS 확인: `min-h-\[50\%\]{min-height:50%}`, `max-h-\[25\%\]{max-height:25%}`, `grid-cols-subgrid{grid-template-columns:subgrid}`, `scroll-fade-b{…}`, `focus-visible:ring-inset`, `empty:hidden:empty{display:none}` |
| 브라우저 | **미확인** | 도구 없음. WebKit 정적 재현만(3.1) |

## 6. 사용자(또는 다음 브라우저 런) 확인 요청

29 런 6절 1–5에 더해:
1. 창 높이 ~600px, S-10에 배너 2개 이상 + 칩 두 줄: 본문이 카드 절반을 지키는지, 배너·머리가 각자 스크롤되고 아래 페이드가 보이는지, 끝까지 내리면 페이드가 사라지는지(Safari 포함).
2. 같은 상태에서 Tab: 머리 영역 자체에 한 번 멈추는지(링 보임), 화살표·Page Down으로 저장 건너뜀 목록·S-44 안내까지 내려가는지, 포커스된 칸이 페이드에 덮이지 않는지(UQ-SC-10).
3. VoiceOver: 넘칠 때 "프로젝트 정보, 영역"으로 읽히고 넘치지 않을 때는 영역으로 읽히지 않는지.
4. 기간 오류를 띄운 S-10, 넓은 화면과 <768: 라벨과 값의 줄 맞춤(UQ-SC-9).
