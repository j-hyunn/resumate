# 21 UI QA — 디자인 시스템 v4 (foundation) 검수

- 검수자: ui-qa / 2026-11-03
- 범위: 작업 트리의 커밋 전 변경 전체(`git diff` 47개 파일) + 새 파일 `src/components/ui/item.tsx`
- 기준(스펙): 사용자 요청 v4 토큰·규칙 = `docs/ui/design-system.md` v4 절(1.1.2 토큰 표, 2장 "반경 / 팝오버 안쪽 여백 / 색 덧씌우기 금지 / 클릭 가능한 항목은 공통 컴포넌트로", 8장 "v4 메모 — 대비", 변경 이력 v4 행)
- 성격: 리더가 직접 고친 foundation 변경이므로 이번 이슈의 owner는 대부분 `foundation`(공통 컴포넌트·토큰), 화면 쪽 정리는 해당 영역 담당, 규칙 공백은 `ui-designer`.
- 이슈 번호: 이전 마지막 UQ-707에 이어 UQ-708부터.

## 요약

| 심각도 | 건수 |
|--------|------|
| Critical | 0 |
| Major | 4 |
| Minor | 10 |

핵심:
1. **삭제·파괴 동작의 빨간색이 사라짐(UQ-708)** — 덧씌우기 금지 규칙을 적용하면서 ghost 삭제 버튼의 `text-destructive`를 지웠는데 대체 variant가 없다. 이제 삭제 버튼이 hover 시 초록이 된다. 한편 다른 화면 세 곳에는 `text-destructive`가 그대로 남아 있어 화면마다 삭제 버튼 색이 다르다.
2. **작성 중 면접 경고 배너가 일반 카드가 됨(UQ-709)** — `border-warning bg-warning-subtle`을 지우고 대체 variant 없이 평범한 Card로 남았다.
3. **`--primary-text` 대비가 primary/10 바탕에서 4.5:1 미달(UQ-710)** — 8장 v4 메모가 이 경우를 다루지 않고, 메모의 link 수치는 v4 이전 값이라 틀렸다.
4. **"흐린" 상태 배지 구분 소실(UQ-711)** — outline 배지의 `text-muted-foreground`를 지워 `없음`·`근거 없음`·`중단`·`해당 없음` 같은 비활성 상태가 정상 상태와 같은 진한 글자가 됐다.

기계 검사(lint·typecheck·vitest·compile 빌드)는 모두 통과했다. Item 컴포넌트 구조와 hydration 수정은 문제없음.

## 1. 기계 검사

| 검사 | 명령 | 결과 |
|------|------|------|
| lint | `pnpm lint` | 통과 (exit 0, 경고 0) |
| typecheck | `pnpm tsc --noEmit` | 통과 (exit 0, 오류 0 — 이번 실행에서는 기존 `RouteContext` 오류도 나오지 않음) |
| test | `pnpm vitest run` | 통과 — 111 files / 1772 tests |
| build | `NEXT_PUBLIC_SUPABASE_URL=http://localhost NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy pnpm next build --experimental-build-mode=compile` | 통과 (exit 0) |
| dev 서버 확인 | `curl :3000` `/career` `/applications` `/interviews` `/board` (`?state=default`) | 모두 200. `/career`의 CareerList가 `data-slot="item"`, 선택 행 `data-active="true" aria-current="true"`로 렌더됨 |

## 2. 점검 결과표

| 점검 | 결과 | 비고 |
|------|------|------|
| 토큰 값 (globals.css ↔ 문서 1.1.2 표) | 일치 | `--primary` #15A76E, `--primary-text` #118658, `--border/--input/--sidebar-border/--chip-border` #E2E2E2, `--background` #FFF, `--sidebar` #F3FBF8, `--sidebar-accent` color-mix 10%, `--radius-control` 12px |
| 문서 코드 블록 ↔ globals.css | 부분 불일치 | `--primary-text`와 `--color-primary-text`가 문서 코드 블록에 없음(UQ-716) |
| 다크 토큰 | 대체로 일치 | 다크 `--primary-text` = 다크 primary, `--sidebar-accent`가 다크 primary 기준으로 계산됨. 다크 대비는 아래 4번 참고 |
| `rounded-control` 적용 (버튼·Input·Textarea·InputGroup·SelectTrigger·DropdownMenu/Select 상자) | 일치 | Popover는 `rounded-lg`, 문서도 "팝오버 = rounded-lg"로 같음 |
| 팝오버·메뉴·Select `p-2`, `ring-border` | 일치 | SelectGroup `p-1` 제거와 함께 이중 여백 없음 |
| secondary / ghost / 메뉴 항목 초록 | 일치 | Button secondary·ghost(`aria-[current]` 포함), DropdownMenu 항목·CheckboxItem·RadioItem·SubTrigger, SelectItem, CommandItem. destructive 메뉴 항목은 빨간색 유지 |
| Toggle 선택 = 초록, outline이면 primary 테두리 | 일치 | |
| Item / Card interactive / TableRow interactive | 구현됨 | 세부 지적은 UQ-713·UQ-714·UQ-719·UQ-721 |
| hydration 수정 (`useHydratedContext`) | 문제없음 | 서버 스냅샷 false → 하이드레이션 직후 true로 다시 렌더. 하이드레이션 전에는 서버 HTML과 같은 `connection: null, hasAnyKey: false`. 하이드레이션 이후 마운트(클라이언트 이동)는 처음부터 실제 값 |
| 사용처 색 덧씌우기 제거 | 부분 | 아직 남은 곳 UQ-712, 제거로 생긴 회귀 UQ-708·709·711·717 |
| 직접 만든 클릭 요소 남은 것 | 소수 | UQ-720 |

## 3. 이슈

### Major

#### UQ-708 [Major] 삭제·파괴 버튼의 빨간색이 사라짐 + 화면마다 처리가 다름 — owner: foundation (variant 추가) → 각 영역 담당 (적용)
- 스펙: design-system.md 2장 "색 덧씌우기 금지 (v4)": "다른 색이 필요하면 variant를 쓴다(예: 삭제 메뉴 항목은 `DropdownMenuItem variant="destructive"`)". 3.5에는 확인 단계의 solid `destructive` 버튼만 있고, **삭제를 시작하는 ghost 버튼용 variant가 없다.**
- 코드 (빨간색이 사라진 곳):
  - `src/components/applications/drafts-view.tsx:194` 초안 `삭제` (ghost sm)
  - `src/components/career/form-parts.tsx:449` `DangerZone` 삭제 버튼 (경력·학력·프로젝트 등 모든 상세 폼 하단)
  - `src/components/career/achievement-dialog.tsx:290` 저장 안 한 변경 버리기 `그래도 닫기`
  - `src/components/common/save-status.tsx:49` `저장 실패 — 다시 시도`: 빨간 문장 안 링크가 초록 링크로 바뀜(바로 앞 `저장 실패 —`는 빨간색)
- 코드 (아직 덧씌우기가 남은 곳 — 같은 종류의 버튼인데 빨간색):
  - `src/components/career/achievement-dialog.tsx:301` ghost + `text-destructive` (성과 삭제)
  - `src/components/applications/cover-letter-questions.tsx:282` ghost sm + `text-destructive` (문항 삭제)
  - `src/components/career/career-overview.tsx:298` `DropdownMenuItem className="text-destructive"`. `variant="destructive"`를 쓰지 않아 focus 시 글자가 초록이 됨(focus 클래스가 이김)
- 기대: 파괴 동작은 어느 화면에서나 빨간 글자, hover는 `bg-destructive/10`. 실제: 일부는 기본 글자 + 초록 hover(파괴 동작이 "안전한 초록"으로 보임), 일부는 빨간색.
- 수정:
  1. `button.tsx`에 `"destructive-ghost": "text-destructive hover:bg-destructive/10 hover:text-destructive aria-expanded:bg-destructive/10 dark:hover:bg-destructive/20"`(이름은 ui-designer가 결정)를 추가하고 문서 3.5와 2장 규칙 표에 적는다.
  2. 위 7곳 모두 `variant="destructive-ghost"`(링크형은 `link` 대신 `destructive-link` variant 또는 문장 전체를 `AiErrorNotice`류로)로 바꾸고 `className` 색을 지운다. `career-overview.tsx:298`은 `variant="destructive"`로 바꾼다.

#### UQ-709 [Major] 작성 중 면접 배너가 경고 모양을 잃음 — owner: interview 영역 담당 (foundation 확인)
- 스펙: S-20 작성 중·실패 세션 안내(design-system.md 3.13 C-14 개정 문구와 맞춤). 바뀌기 전에는 warning 배너(`border-warning bg-warning-subtle` + `text-warning-subtle-foreground`)였다.
- 코드: `src/components/interviews/interview-prep.tsx:249-250` — 색 클래스만 지우고 `Card`로 남아 일반 흰 카드가 됐다. "질문을 만들지 못한 면접이 있어요" 같은 실패 안내가 다른 카드와 구분되지 않는다.
- 수정: 같은 파일 위쪽에서 이미 쓰는 `Alert variant="warning"`(또는 문서에 경고 배너 variant가 따로 있으면 그것)으로 바꾼다. `Card`에 색을 다시 덧씌우지 말 것.

#### UQ-710 [Major] `--primary-text` 대비가 초록 바탕에서 4.5:1 미달, 문서 메모는 그 경우가 빠지고 수치는 예전 값 — owner: ui-designer
- 스펙: design-system.md 8장 "v4 메모 — 대비". "`variant="link"`·`text-primary` 글자도 민트 바탕에서 약 2.9:1"이라고 적혀 있지만, v4에서 link·secondary·ghost·메뉴 글자는 모두 `--primary-text`(#118658)로 바뀌었다.
- 측정(WCAG 상대 휘도):

  | 글자 | 바탕 | 대비 |
  |------|------|------|
  | #118658 | 흰색 | 4.59 (통과) |
  | #118658 | #F3FBF8 (사이드바) | 4.36 (미달) |
  | #118658 | primary 10% over 흰색 = #E8F6F0 (secondary 버튼, ghost hover, 메뉴 focus, Item active) | **4.13 (미달)** |
  | #118658 | primary 10% over #F3FBF8 = #DDF3EA (사이드바 현재 메뉴) | **3.95 (미달)** |
  | #118658 | primary 15% over 흰색 (secondary hover) | 3.92 (미달) |
  | 흰 글자 | #15A76E (default 버튼) | 3.10 (문서에 있음) |
  | #E2E2E2 | 흰색 (`--input`) | 1.30 (문서에 있음) |

  대상 글자는 대부분 14~16px medium이라 큰 글자 3:1 기준이 적용되지 않는다. 가장 자주 보이는 "선택된 메뉴/행" 상태가 미달이다.
- 수정(택1, ui-designer 결정 후 foundation 반영):
  - (권장) `--primary-text`를 조금 어둡게: `#0E7A50`(이미 `--primary-subtle-foreground` 값)이면 #E3F5EE 바탕에서 4.74:1. primary/10 바탕 대부분에서 4.5:1 이상. 사용자 지정 값은 `--primary`(#15A76E)이므로 글자색 조정은 사용자 결정과 충돌하지 않는다. 다만 #118658도 사용자 지정이면 리더가 사용자에게 확인한다.
  - 그대로 둔다면 8장 메모에 위 표의 primary-text 줄을 추가하고, "link·text-primary 2.9:1" 문장을 고친다(예전 `text-primary` 기준 수치).

#### UQ-711 [Major] "흐린" 상태 배지가 정상 상태와 같은 진한 글자가 됨 — owner: foundation (Badge variant) → 각 영역 담당
- 스펙: 2장 덧씌우기 금지 규칙 + 각 상태의 의미(없음·근거 없음·중단·해당 없음은 덜 중요한 비활성 값). 바뀌기 전에는 outline + `text-muted-foreground`로 흐리게 했다.
- 코드(지운 곳): `src/components/common/basics.tsx:97` 결과 없음, `src/components/common/stage-menu.tsx:330` 결과 없음, `src/components/applications/insight-view.tsx:307` 근거 없음, `src/components/interviews/session-status.tsx:45` 중단, `src/components/interviews/result-view.tsx:696` 평가 `해당 없음`, `src/app/(dashboard)/(gated)/applications/[id]/page.tsx:245` 잠금 표식, `src/components/common/placeholders.tsx:103` 편집됨 표식
- 코드(남은 곳 — 같은 의미인데 흐림): `src/components/career/project-form.tsx:461` 작성 대화 `abandoned` 배지는 아직 `text-muted-foreground`
- 기대: 같은 의미의 배지는 어디서나 같은 모양. 실제: 결과 없음·중단이 진행 중·완료 배지와 같은 무게가 됐고, 작성 대화 `abandoned`만 흐리다.
- 수정: `badge.tsx`에 `muted: "border-border text-muted-foreground"`(이름은 ui-designer가 결정) variant를 추가해 위 8곳에 적용하고 `project-form.tsx:461`의 className을 지운다. `result-view.tsx`의 `GRADE_VARIANT.not_applicable`을 `muted`로 매핑한다.

### Minor

#### UQ-712 [Minor] 사용처 색 덧씌우기가 아직 남은 곳 — owner: 각 영역 담당
- 스펙: 2장 "색 덧씌우기 금지 (v4)"
- 코드:
  - `src/components/career/writing-chat/draft-preview.tsx:106` `Button variant="outline"` + `border-warning text-warning-subtle-foreground` ("확인 필요 n개"류 버튼). 경고 outline variant가 필요하거나 `Badge variant="warning"` + ghost 버튼으로 나눈다.
  - `src/components/career/writing-chat/chat-screen.tsx:516` 단계 버튼 `text-muted-foreground`(아직 안 채운 단계). ghost 버튼에 "흐림" 상태가 필요하면 `data-pending` 같은 상태 속성 + ghost variant 안의 규칙으로 옮긴다.
  - `src/components/account/ai-usage-panel.tsx:280` `TableRow` 호출 0건 행 `text-muted-foreground`, `:342` `TableRow className="hover:bg-transparent"`(UQ-719와 함께 처리)
  - `src/components/interviews/result-view.tsx:520`, `src/components/interviews/answer-sheet.tsx:636` `Alert`에 `*:[svg]:text-warning` / `text-destructive`. Alert의 warning/destructive variant가 아이콘 색을 정하도록 `alert.tsx`로 옮긴다(owner: foundation).
  - `src/components/common/shell/nav-user.tsx:54` `SidebarMenuButton data-[state=open]:bg-sidebar-accent ...`는 shadcn sidebar-08 블록 원래 코드이고 토큰만 쓰므로 허용으로 본다. 문서 예외 목록에 한 줄 적어 두면 다음 검사에서 다시 걸리지 않는다(owner: ui-designer).

#### UQ-713 [Minor] Item `active`가 `aria-current`를 붙이지 않음 — owner: foundation
- 스펙: 2장 표 "선택 상태는 `active`". 같은 표의 ghost 버튼은 `aria-current`로 현재 위치를 알린다.
- 코드: `src/components/ui/item.tsx:46-58` — `active`는 `data-active`만 설정한다. `career-overview.tsx:266-267`은 `active`와 `aria-current`를 따로 넘기고 있어, 다음 사용처가 `aria-current`를 빠뜨리면 화면 읽기 프로그램에 선택이 전달되지 않는다. 또 `data-active="false"`가 모든 Item에 찍힌다.
- 수정: `aria-current={active ? (props["aria-current"] ?? "true") : props["aria-current"]}`처럼 기본값을 주고 `data-active={active || undefined}`로 바꾼다. 그러면 cva의 `data-[active=true]:` 선택자는 `data-active:`로 줄일 수 있다. 문서 표에 "active는 aria-current를 함께 설정"을 적는다.

#### UQ-714 [Minor] Item: 사용자 props가 `data-slot`/`data-active`/`type`을 덮을 수 있고 링크의 disabled 처리가 없음 — owner: foundation
- 코드: `src/components/ui/item.tsx:50-57` — `{...props}`가 마지막에 펼쳐져 `data-active`·`data-slot`·`type`을 덮어쓸 수 있다(현재 덮어쓰는 사용처는 없음. `type="submit"`을 넘기려는 경우는 의도한 동작이라 괜찮다). `asChild`(Link)일 때는 `disabled:` 스타일이 적용되지 않고 비활성 링크를 막을 방법이 없다.
- 판단: 지금 문제를 일으키는 곳은 없다. `asChild`에서 `type`을 빼는 처리는 맞다(Link에 `type="button"`이 붙지 않음, dev 서버 HTML로 확인).
- 수정: `data-slot`·`data-variant`·`data-active`를 `{...props}` 뒤로 옮기거나 그대로 두고 주석으로 "덮어쓰기 허용"을 밝힌다. cva에 `aria-disabled:pointer-events-none aria-disabled:opacity-50`을 추가해 링크형 Item도 `aria-disabled`로 비활성화할 수 있게 한다.

#### UQ-715 [Minor] 선택 행과 hover 행이 같은 색 — owner: ui-designer (결정), foundation (반영)
- 스펙: 2장 "hover·선택 색은 모두 `bg-primary/10` + `text-primary-text`"(사용자 요청 그대로)
- 코드: `src/components/ui/item.tsx:12`(hover와 `data-[active=true]` 모두 `bg-primary/10`), `src/components/ui/sidebar.tsx` 메뉴(`--sidebar-accent` 하나로 hover·active), `src/components/ui/table.tsx:67`(selected·interactive hover 같음)
- 영향: 커리어 목록에서 선택 행이 아닌 다른 행에 마우스를 올리면 두 행이 같은 초록이 되고 `font-medium` 차이만 남는다. 바뀌기 전에는 `bg-muted` 선택 / `bg-muted/60` hover로 구분됐다.
- 수정: 사용자 결정이므로 코드는 그대로 두되, ui-designer가 "hover는 primary/5, 선택은 primary/10"처럼 단계를 둘지 사용자에게 확인한다. 유지한다면 문서에 "선택은 font-medium으로만 구분된다"를 적는다.

#### UQ-716 [Minor] 문서 토큰 코드 블록에 `--primary-text`가 없음 — owner: ui-designer
- 스펙/코드: design-system.md 1.1.2 표(38행)에는 있으나 `:root` 코드 블록(78~82행 부근), `.dark` 블록, `@theme inline` 블록에 `--primary-text` / `--color-primary-text` 줄이 없다. `src/app/globals.css:32`, `:115`, `:206`에는 있다.
- 수정: 세 블록에 해당 줄을 추가한다. 함께 `globals.css:2` 머리 주석이 "v1.1"이라고 돼 있으니 "v4"로 맞춘다(owner: foundation).

#### UQ-717 [Minor] 완료 카드의 success 테두리 제거, 칸반 개수 배지 색 변경 — owner: career 영역 / board 영역 담당 (ui-designer 확인)
- 코드:
  - `src/components/career/experience-form.tsx:300` `GateCompletion`, `src/components/career/writing-chat/chat-screen.tsx:1054` `CompletionCard` — `border-success/30` 제거. 초록 체크 아이콘이 있어 의미는 남지만, 완료 카드가 일반 카드와 같은 테두리가 됐다. 필요하면 `Alert variant="success"`류로 바꾼다.
  - `src/components/board/kanban-board.tsx:364` 열 개수 `Badge variant="count"` — `bg-background text-muted-foreground`를 지워 이제 `bg-primary-subtle` 초록 알약이 된다. 단계별 색(`--stage-*`)이 있는 열 머리에서 모든 열 개수가 초록이라 단계 색과 겹친다. 의도한 변경인지 ui-designer가 정하고, 회색이 맞으면 `count-neutral` variant를 추가한다.

#### UQ-718 [Minor] 버튼 위계 변경 — 보조 동작이 primary가 됨 — owner: career 영역 담당 (ui-designer 확인)
- 코드:
  - `src/components/career/career-overview.tsx:207` `AddCareerMenu`의 `primary=false`(목록 위 `w-full` 버튼)가 `secondary`에서 `default`로 바뀌어 `primary` prop이 이제 너비 말고는 아무 차이를 만들지 않는다. 빈 상태 화면에서 primary 버튼과 같이 보이면 강조 버튼이 두 개가 된다.
  - `src/components/career/add-career-dialog.tsx:375` 저장 버튼 `secondary` → `default`. 다이얼로그의 주 동작이므로 이 변경은 맞다.
- 수정: `AddCareerMenu`는 `primary`가 false일 때 `variant="secondary"`(v4 secondary = 연초록)로 되돌리거나, 의도적으로 모두 primary로 둔다면 `primary` prop 이름을 `fullWidth`로 바꾼다.

#### UQ-719 [Minor] TableRow 기본 hover(`hover:bg-muted/50`)가 클릭 안 되는 행에도 남음 — owner: foundation
- 코드: `src/components/ui/table.tsx:67` — 모든 행에 회색 hover가 있고 interactive 행만 초록 hover다. 그래서 `ai-usage-panel.tsx:342`처럼 `hover:bg-transparent`로 끄는 덧씌우기가 생긴다. 클릭 안 되는 행이 hover에 반응하는 것은 v4 규칙("클릭 가능한 것만 초록 hover")과도 맞지 않는다.
- 수정: 기본 `hover:bg-muted/50`, `has-aria-expanded:bg-muted/50`을 지우고 interactive일 때만 hover를 준 뒤, `ai-usage-panel.tsx:342`의 className을 지운다.

#### UQ-720 [Minor] 직접 만든 클릭 요소가 남음 — owner: career 영역 담당
- 코드:
  - `src/components/career/career-overview.tsx:455` `LongText` 빈 값 "내용을 입력해주세요" `<button>` — `focus-visible` 표시가 전혀 없다(키보드 사용자가 위치를 못 봄). `Button variant="link"` 또는 `Item size="sm"`로 바꾼다.
  - `src/components/career/writing-chat/chat-screen.tsx:1020` 사용자 말풍선 버튼(`bg-secondary` + `hover:ring-1`). 말풍선은 전용 모양이므로 문서 예외 목록(근거 칩·공급자 배지·초안 블록·보드 손잡이)에 "채팅 말풍선"을 추가할지 ui-designer가 정한다.
- 참고: muted→foreground로 바뀌는 텍스트 링크(`breadcrumbs.tsx:107`, `consent-settings.tsx:74`, `policies-back-link.tsx:32`, `settings-sections.tsx:100`, `consent-form.tsx:137`, `source-tree.tsx:153`, `detail-form.tsx:149`)는 줄 단위 클릭 항목이 아니라 본문 링크라 Item 대상이 아니다. 문서에 "본문 텍스트 링크는 underline + hover:text-foreground 허용"을 한 줄 적어 두면 좋다(owner: ui-designer).

#### UQ-721 [Minor] ProviderPick: 비활성 공급자 카드가 두 번 흐려지고, 공통 컴포넌트에 `bg-transparent`를 덧씌움 — owner: account 영역 담당
- 코드: `src/components/account/key-connect-flow.tsx:514` `Item size="none" disabled` → Item의 `disabled:opacity-50`이 새로 적용된다. 바뀌기 전에는 `cursor-not-allowed`만 있었고 카드 자체가 `providerCardState`로 사용 불가 상태를 표시했다. 이제 상태 문구(muted 글자)가 50% 투명도까지 겹쳐 읽기 어렵다. 또 `pointer-events-none` 때문에 `cursor-not-allowed`도 사라졌다.
- 코드: `:521` `ProviderCardFrame className="bg-transparent"` — 공통 카드의 `bg-card`를 사용처에서 지우는 색 덧씌우기다.
- 수정: `ProviderCardFrame`의 `inButton`일 때 `bg-card` 대신 `bg-transparent`를 쓰도록 `provider-card.tsx:215`에서 처리하고 사용처 className을 지운다. 비활성은 Item에 `disabled` 대신 `aria-disabled` + onClick 무시로 처리하거나, 카드 상태 표시만 남기도록 Item에 `disabled:opacity-100`이 아닌 별도 처리를 둔다(UQ-714의 aria-disabled 규칙과 함께).

#### UQ-722 [Minor] `variant="row"` Item hover가 둥근 테두리 목록 모서리를 넘침 — owner: career 영역 담당
- 코드: `src/components/career/experience-form.tsx:248`, `src/components/career/education-form.tsx:204` `<ul className="divide-y rounded-md border">`에 `overflow-hidden`이 없다. `row`는 `rounded-none`이라 첫 행·마지막 행 hover 바탕이 6px 둥근 모서리 밖으로 각지게 보인다. 반대로 `overflow-hidden`을 넣으면 Item의 `focus-visible:ring-offset-2` 링이 잘린다.
- 수정: `row` variant를 `rounded-none first:rounded-t-[inherit] last:rounded-b-[inherit]`처럼 처리하거나(li 안에 있으므로 `[li:first-child>&]` 선택자 필요), `row`의 포커스 링을 `focus-visible:ring-inset`으로 바꾸고 목록에 `overflow-hidden`을 넣는다. 문서 2장 표의 `row` 설명에 같은 규칙을 적는다.

## 4. 다크 모드 확인 (정적)

- `--primary-text` 다크 = `oklch(0.74 0.14 158)`(#4dc588 근처), 다크 바탕 #0e0f12 위 대비 약 9:1, primary/10 위에서도 충분.
- `--sidebar-accent` 다크 = 다크 primary 10%를 투명과 섞은 값. 다크 사이드바 바탕 위에서 바탕 변화가 아주 약하다(약 1.1:1). 글자색이 초록으로 바뀌어 상태는 보이지만, 선택 행 바탕이 거의 안 보일 수 있다. 실제 화면 확인이 필요하다(이번에는 브라우저 확인 안 함). 필요하면 다크만 15~20%로 올린다 — owner: ui-designer, 별도 이슈로 두지 않고 참고로 남긴다.
- 다크 `--input`은 v4에서 바꾸지 않았다(문서 표와 일치).

## 5. 문제없음으로 확인한 것

- `Item` `asChild` + `Slot.Root`: `asChild`일 때 `type`을 넣지 않고, className은 cva의 `className` 인자로 `cn`(tailwind-merge)을 거쳐 사용처 레이아웃 클래스(`w-auto`, `flex-col`, `rounded-lg`)가 기본값을 올바르게 덮는다. focus-visible 링은 버튼·Link 모두 적용된다.
- `Card interactive`, `TableRow interactive`의 data 속성은 `|| undefined`로 false일 때 속성을 남기지 않는다.
- DropdownMenu destructive 항목은 focus 시에도 빨간색 유지(`not-data-[variant=destructive]:focus:**:text-primary-text`).
- `ai-connection-panel.tsx`, `chat-screen.tsx`, `project-form.tsx`의 삭제 메뉴 항목은 `variant="destructive"`로 올바르게 바뀌었다.
- 토글 그룹(`drafts-view.tsx:574`, `sources-used.tsx:268-271`, `interview-prep.tsx:343`)은 사용처 색을 지우고 Toggle 기본 선택색(초록)을 받는다. interview-prep 문항 수 토글은 ToggleGroup이 `variant="outline"`(334행)이라 선택 시 primary 테두리도 그대로 유지된다.
- hydration 수정은 Suspense로 늦게 하이드레이션되는 사이드바에서도 서버 HTML과 첫 클라이언트 렌더가 같게 만든다.

## 6. 담당별 전달

- foundation: UQ-708(variant 추가), UQ-711(variant 추가), UQ-713, UQ-714, UQ-719, UQ-716(globals.css 머리 주석), UQ-712 중 Alert 아이콘 색
- ui-designer: UQ-710, UQ-715, UQ-716, UQ-717 결정, UQ-712·UQ-720 예외 목록 정리, 다크 sidebar-accent 확인
- career 영역: UQ-708 적용분, UQ-711 적용분(project-form), UQ-712(draft-preview·chat-screen), UQ-717, UQ-718, UQ-720, UQ-722
- applications 영역: UQ-708(drafts-view·cover-letter-questions), UQ-711(insight-view·잠금 표식)
- interview 영역: UQ-709, UQ-711(session-status·result-view), UQ-712(Alert)
- board 영역: UQ-717(개수 배지)
- account 영역: UQ-712(ai-usage-panel), UQ-721
- 기획 확인 필요: 없음
