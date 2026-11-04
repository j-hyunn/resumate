# 30 런 — frontend-engineer (A0) 보고: L-02 Minor 정리 (UQ-SC-1 · 2 · 4 · 6)

대상: 29 런 QA(`29_ui-qa_l02-scroll_review.md`)의 Minor 중 foundation 몫. 커밋하지 않았다. dev 서버(3000)는 재시작하지 않았다. 백엔드 파일은 건드리지 않았다.
리더가 이미 처리한 UQ-SC-3(G-49 40% 규칙)·UQ-SC-5(`empty:hidden`)·UQ-SC-7(FOCUS_ORDER)은 다시 하지 않았다. UQ-SC-8(역량 배치)은 기획 질문이라 배치를 그대로 두었다.

## 1. 이슈별 변경

### UQ-SC-1 · 배너가 쌓이면 낮은 창에서 본문이 0까지 눌림
- 규칙(가장 단순하고 튼튼한 쪽): **본문 2단(DocBody)이 카드 높이의 50% 이상을 지킨다.** CrumbRow는 고정, 배너 자리와 머리는 남은 높이를 자기 높이 비율대로 나눠 줄어들고 각자 스크롤한다. 머리 40% 상한은 그대로라 높은 창에서는 아무것도 바뀌지 않는다. S-28 장애 배너 자리(카드 밖)는 창 높이 25%로 상한.
- 변경:
  - `src/components/common/shell/doc-body.tsx:102` DocBody `min-h-0` → `min-h-[50%]` (+ 주석 :100)
  - `src/components/common/shell/doc-body.tsx:46` DocHead `shrink-0` → `shrink`(+ `min-h-0`, OverflowScroller)
  - `src/components/common/shell/page-shell.tsx:673` ShellBanners `shrink-0` → `OverflowScroller` `shrink`(줄어들며 스크롤)
  - `src/components/common/shell/page-shell.tsx:505` 장애 배너 자리 `relative max-h-[25%] shrink-0 overflow-y-auto empty:hidden`
- 검증: WebKit(WKWebView 1400×600, 같은 CSS를 손으로 옮긴 정적 페이지) 재현 — 스크립트 `/private/tmp/claude-501/-Users-jehyun-Resumate--claude-worktrees-resumate-logo-replacement-9f2d53/2ec3b6a0-3c26-4484-8190-5838594f6a17/scratchpad/repro30/repro.swift`

| 경우 (카드 536px) | 배너 | 머리 | 본문 |
|------|------|------|------|
| 수정 전, 배너 250 + 머리 300 | 250 | 214 | **23** |
| 수정 후, 배너 250 + 머리 300 | 100 | 119 | **268** (= 50%) |
| 수정 후, 배너 0 + 머리 100 | 0 | 100 | 387 (영향 없음) |
| 수정 후, 배너 60 + 머리 300 | 37 | 183 | 268 |

  - 주의: 마지막 줄처럼 머리가 클 때 배너 하나도 비율대로 줄어 37px로 잘리고 스크롤된다(아래 페이드 + 키보드 영역이 붙음). 600px 안팎의 낮은 창에서만 생긴다.
- 실제 앱(Chrome·Safari) 미확인.

### UQ-SC-2 · DocHead 넘침 신호 없음, 마지막 글에 키보드로 못 감
- 새 공용 컴포넌트 `src/components/common/shell/overflow-scroller.tsx` — `useScrollOverflow`(ResizeObserver로 상자와 안쪽 내용 높이를 재고 scroll 이벤트로 끝 도달 판정) + `OverflowScroller`.
  - 넘칠 때만: `role="region"` + `aria-label` + `tabIndex={0}` → Tab으로 상자에 들어와 화살표·Page Down으로 마지막 입력 칸 뒤의 글(S-44 G-2 안내, S-10 저장 건너뜀 목록)까지 스크롤. 포커스 표시 `focus-visible:ring-2 ring-ring ring-inset`(카드 `overflow-clip`에 잘리지 않게 안쪽).
  - 넘치고 끝이 아닐 때만 아래 가장자리 페이드: **shadcn 기본 `scroll-fade-b`**(shadcn/tailwind.css, 패널 `MessageScroller`가 이미 쓰는 알파 마스크 — 색 토큰 없음). 스크롤 연동 애니메이션이 없는 브라우저(Safari·Firefox)에서도 끝에서 사라지도록 JS가 클래스를 뗀다.
  - 넘치지 않으면 평범한 div — 탭 정지·랜드마크가 늘지 않는다.
  - 처음엔 `globals.css`에 같은 이름의 `@utility scroll-fade-b`를 새로 만들었다가, shadcn에 같은 이름이 이미 있어 `MessageScroller` 동작을 바꿀 위험을 발견하고 되돌렸다. `globals.css`는 최종 변경 없음.
- 사용처: DocHead(`doc-body.tsx:46`), ShellBanners(`page-shell.tsx:673`, 이름 "알림").
- DocHead에 `label` prop 추가(기본 "페이지 정보"). S-10 `project-page.tsx:521` `label="프로젝트 정보"`, S-44 `deliverable-page.tsx:364` `label="산출물 정보"` — A2 파일이지만 prop 하나만 더했다(QA 기대 문구 그대로).
- DocHead의 `className`은 이제 **안쪽 내용 div**에 붙는다(`space-y-3`/`space-y-2`가 그대로 행 간격으로 작동). 바깥 상자 클래스는 DocHead가 고정.
- 검증: typecheck·eslint·vitest 통과, dev 서버 CSS에 `ring-inset` 등 클래스 생성 확인. 페이드 모양·스크린리더 낭독·Tab 진입은 **브라우저 미확인**.

### UQ-SC-4 · 로딩 스켈레톤 불일치
- `src/components/common/shell/page-shell-skeleton.tsx`
  - :10 바탕 `overflow-hidden` → `relative … overflow-clip`
  - :18 카드 `overflow-hidden` → `relative … overflow-clip`
  - 크럼 자리 `shrink-0`, 머리 자리 `relative max-h-[40%] min-h-0 shrink overflow-hidden … max-md:px-4`(스켈레톤은 스크롤할 이유가 없어 hidden), 본문 자리 :28 `min-h-[50%] flex-1`, 왼쪽 자리 `relative min-w-0 … overflow-hidden max-md:px-4`.
- 검증: typecheck·eslint 통과. 로딩 → 본문 전환 모습은 브라우저 미확인.

### UQ-SC-6 · `InlineField` dl 구조
- `src/components/common/doc-inputs.tsx:195` — `dl > div`(하나) `> dt + dd`, 오류는 `dd` 안.
  - 모양 유지 방법: 항목 div = `grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1`, `dt` = 1열 1행 `flex min-h-9 items-center`, `dd` = 1행에서 두 열을 걸친 `grid-cols-subgrid`(값은 2열 `flex min-h-9 flex-wrap items-center gap-2`, 오류는 다음 행 두 열 전체).
- 검증: WebKit 재현에서 라벨 x=0 / 값 x=80 같은 줄(y 616), 오류 x=0 다음 줄(y 656) — 이전 모양(라벨·값 나란히, 오류는 라벨 시작점 아래)과 같다.
- **달라진 점 1개**: 이전 `flex-wrap` 행은 폭이 모자라면 값 전체가 라벨 아래로 내려갔다. 이제는 값이 라벨 오른쪽 열 안에서 줄을 바꾼다(주로 <768에서 "진행 기간"). design-system 5.9에 적었다. 좁은 화면 모습은 브라우저 미확인. 이전 동작이 꼭 필요하면 `display: contents` 없이는 같은 줄바꿈을 유효한 dl로 만들기 어렵다.
- `dt` 위에 `dd`(1행 두 열)가 겹쳐 그려진다. `dd`는 바탕이 없어 라벨은 보이고, 라벨 영역 클릭은 원래 동작이 없다.

## 2. 문서

`docs/ui/design-system.md`
- 5.8: 창 스크롤 규칙 ③에 배너 자리 추가, ④ 스켈레톤 규칙(UQ-SC-4), S-28 장애 배너 자리 25% 상한 항목, "배너 자리" 줄을 `ShellBanners = OverflowScroller`로.
- 5.9: 세로 구성 표(배너 `shrink`, DocHead = OverflowScroller + 이름, 본문 `min-h-[50%]`), "본문 2단 최소 높이" 규칙(카드 50%, "약 60%" 문구 정정, 재현 수치) `[UI-가정]`, "머리·배너가 넘칠 때" 규칙 `[UI-가정]`, InlineFields 마크업(UQ-SC-6).
- 부록 G-49에 30 런 요약 덧붙임.

## 3. [UI-가정]
- 본문 2단 최소 = 카드 50%(QA 예시의 25% 배너 상한 대신 "본문 최소 + 위쪽이 줄어듦" 한 규칙). 수치 50%는 ui-designer 확인 요청.
- 장애 배너 자리 25% 상한.
- 넘칠 때만 region/tabIndex/페이드. 영역 이름 "프로젝트 정보"·"산출물 정보"·"알림"(dev 데모는 기본 "페이지 정보").

## 4. 기획 확인 필요 / 요청
- 기획 확인 필요: 없음(UQ-SC-8은 리더 지시대로 손대지 않음).
- A2(리더) 알림: `project-page.tsx`·`deliverable-page.tsx`에 DocHead `label` prop만 추가.
- 백엔드 요청: 없음.

## 5. 기계 검사
| 검사 | 결과 |
|------|------|
| `pnpm typecheck` | 통과 |
| `pnpm exec eslint` (변경 7파일) | 통과, 출력 없음 |
| `pnpm exec vitest run src/components` | 4 파일 · 34 테스트 통과 |
| `pnpm build` | 돌리지 않음(dev 서버 `.next` 공유 회피, 지시 범위 밖) |
| 브라우저 | **미확인** — WebKit 정적 재현(높이 체인·InlineField 위치)만. 실제 앱에서 낮은 창 + 배너 여러 개, DocHead 페이드·Tab 진입·VoiceOver 낭독, <768 InlineField 줄바꿈 확인 필요 |
