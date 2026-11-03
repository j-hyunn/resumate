# 27 UI QA — v5 추가분의 v4 브랜드 토큰 적합성 검수 (Q8 + Q10)

- 검수자: ui-qa / 2026-11-03
- 범위: 커밋 9586d81(프로젝트 상세·산출물 상세, PA-1~PA-4)의 UI 변경분 — `common/shell/*`, `common/doc-inputs.tsx`, `common/source-chip.tsx`, `career/ai-panel/**`, `career/project-page/**`, `star-proposal-card.tsx`, `career/deliverable/**`, `deliverable-draft-card.tsx`, `add-project-dialog.tsx`, `career-overview.tsx`(S-43 산출물 섹션), `delete-confirm-dialog.tsx`, `ui/button.tsx` chip variant, `ui/select.tsx` chip trigger, `globals.css` `--shell`/`--panel`
- 기준: `docs/ui/design-system.md` v4 규칙(1.3 반경 · 팝오버 안쪽 여백 · "색 덧씌우기 금지 (v4)" 표 · "클릭 가능한 항목은 공통 컴포넌트로 (v4)" 표와 예외 목록) + v5 절(5.8 L-02 셸, 5.9 문서형 페이지, 5.10 AI 패널, 3.24·3.25 제안 카드, 6장 "(v5) 커리어 v5.6"). 판정 방식은 `21_ui-qa_ds-v4_review.md`·`23_ui-qa_ds-v4_recheck.md`(UQ-708~724)와 같다 — 사용처 `className`으로 색·hover를 덧씌우면 위반, 필요한 색은 variant로.
- 이슈 번호: 이번 검수 전용 `UQ-BR-n`.
- 코드는 고치지 않았다(보고만).

## 요약

| 심각도 | 건수 |
|--------|------|
| Critical | 0 |
| Major | 6 |
| Minor | 11 |
| 합계 | 17 |

| owner | 건수 |
|-------|------|
| engineer (A2 영역 / foundation 셸) | 9 (UQ-BR-1, 2, 3, 4, 6, 7, 8, 10, 11) |
| ui-designer | 8 (UQ-BR-5, 9, 12, 13, 14, 15, 16, 17 — UQ-BR-5는 결정 후 foundation 적용) |

핵심 패턴:
1. **삭제 동작을 아직 `className="text-destructive"`로 칠함** (UQ-BR-1·2) — v4가 UQ-708에서 없앤 바로 그 패턴이 v5 화면 네 곳에 다시 들어왔다. 메뉴 항목은 `focus:text-destructive`를 같이 붙인 곳과 안 붙인 곳(산출물 삭제)이 섞여 있어, 산출물 삭제는 키보드 포커스 시 초록이 된다.
2. **클릭 가능한 목록 행을 손으로 만듦** (UQ-BR-3·4) — S-43 산출물 행(`hover:bg-muted`)과 AI 패널 대화 기록 행(`hover:bg-accent`, 선택 `bg-card shadow-xs`)이 `Item`을 쓰지 않아 hover·선택이 회색이다. 같은 화면의 C-25 프로젝트 카드는 이미 `Item`이라 한 패널 안에서 hover 색이 다르다.
3. **chip variant의 hover가 회색 `bg-accent`** (UQ-BR-5) — `Button chip`/`chip-dashed`, `SelectTrigger chip`. v4 hover 규칙(`bg-primary/10` + `text-primary-text`)과 다르다. v5 문서가 v4 이전에 쓰여 그대로 옮긴 결과다.
4. **ghost 버튼에 `text-muted-foreground` 덧씌우기** (UQ-BR-6) — "산출물 추가", "AI에게 물어보기". main의 같은 `PanelSection` 동작 버튼은 덧씌우기 없는 ghost다.
5. **v5 문서가 v4와 충돌** (UQ-BR-12) — 위 1~4는 대부분 문서 5.8·5.9·5.10·6장의 클래스 문자열을 그대로 구현한 것이다. 엔지니어만 고치면 문서와 코드가 다시 어긋나므로 ui-designer가 v5 문장을 v4 variant로 바꿔야 한다.

문제없음: 포커스 링은 범위 전체가 `ring-2 ring-ring`(v4 이전의 `ring-[3px] ring-ring/50` 0건), 외곽선은 `border` 토큰만 사용(하드코딩 색 0건), `Button`·`Input`·`Textarea`·`SelectTrigger` 기본 반경 `rounded-control`, `SelectContent`·`DropdownMenuContent` `p-2` + `ring-border`, Alert 아이콘 색 덧씌우기 0건(`project-page.tsx:507` 아이콘 무색, `panel-input.tsx` Alert들은 아이콘 없음), 링크는 모두 `Button variant="link"`(= `text-primary-text`)이고 `text-primary` 글자 0건, `--shell` 값은 코드에서 `#F3FBF8`로 v4 앱 바탕과 같음.

## 1. 기계 검사

| 검사 | 결과 |
|------|------|
| `pnpm lint` | 통과 (exit 0) |
| `pnpm tsc --noEmit` | 통과 (exit 0) |
| dev 서버 `/career?state=default` | 200. S-43 산출물 행이 `class="flex min-h-11 … rounded-[10px] … hover:bg-muted …"`(Item 아님, UQ-BR-3), "산출물 추가"가 `data-variant="ghost"` + 끝에 `text-muted-foreground`(UQ-BR-6)로 렌더되는 것을 확인 |
| dev 서버 `/career/projects/{id}?state=default`, `/career/deliverables/{id}?state=default` | 둘 다 200. 다만 SSR HTML은 `PageShellSkeleton`만 담고 본문은 클라이언트에서 그리므로, S-10·S-44 본문 클래스는 소스 대조로 판정했다 |

## 2. 점검 결과표

| 점검 | 결과 | 이슈 |
|------|------|------|
| shadcn 컴포넌트에 사용처 색 덧씌우기 | 위반 있음 | UQ-BR-1, 2, 6, 7, 9, 10, 11 |
| hover·선택 = `bg-primary/10` + `text-primary-text` | 위반 있음 | UQ-BR-3, 4, 5, 7 |
| 클릭 가능한 행·카드 = `Item` / `Card interactive` | 위반 있음 | UQ-BR-3, 4 (C-25 프로젝트 카드는 `Item` — 일치) |
| 버튼·입력·드롭다운 반경 `rounded-control` | 기본값은 일치. 예외 미등록 사용처 있음 | UQ-BR-14, 15 |
| Alert 아이콘 색 | 일치 | — |
| 포커스 링 `ring-2 ring-ring` | 일치 (`ring-[3px]`·`ring-ring/50` 0건) | 접기 트리거 1곳 링 없음 UQ-BR-11 |
| 링크 색 `text-primary-text` | 일치 (`Button variant="link"`만 사용) | — |
| 외곽선 `border` 토큰 | 일치 | — |
| 메뉴·팝오버 `p-2` | 일치 (사용처에서 padding 덮어쓰기 0건) | — |
| 배지 상태 variant (`muted` 등) | 위반 1건 | UQ-BR-8 |
| 토큰 (`--shell`·`--panel`) | 코드 일치, 문서 표 1곳 옛 값 | UQ-BR-13 |
| v5 문서 ↔ v4 규칙 | 충돌 다수 | UQ-BR-12, 14, 15, 16, 17 |

## 3. 이슈

### Major

#### UQ-BR-1 [Major] 이탈 확인 "저장하지 않고 나가기"가 ghost + `text-destructive` 덧씌우기 — owner: engineer (foundation, 셸)
- 스펙: design-system.md 1.3 "색 덧씌우기 금지 (v4)" 표 — "삭제·버리기를 시작하는 ghost 버튼(삭제, 그래도 닫기) → `Button variant="destructive-ghost"`". 3.5(703행) "다이얼로그를 여는 쪽 … 저장 안 한 변경의 "그래도 닫기"는 `destructive-ghost`".
- 코드: `src/components/common/shell/page-shell.tsx:203`
  ```tsx
  <Button variant="ghost" className="text-destructive hover:text-destructive" …>저장하지 않고 나가기</Button>
  ```
- 현재: ghost의 hover 바탕 `bg-primary/10`(초록 바탕) 위에 빨간 글자. 기대: `<Button variant="destructive-ghost">` — hover `bg-destructive/10`, className 색 제거.
- 참고: 문서 5.8(1605행)이 "ghost + `text-destructive`"라고 적고 있다 → UQ-BR-12.

#### UQ-BR-2 [Major] 삭제 메뉴 항목 3곳이 `DropdownMenuItem variant="destructive"`를 쓰지 않음 — owner: engineer (A2)
- 스펙: 1.3 "색 덧씌우기 금지 (v4)" — "삭제 메뉴 항목은 `DropdownMenuItem variant="destructive"`". 3.5(703행) "메뉴 안 삭제 항목은 `DropdownMenuItem variant="destructive"`". 같은 문제를 main에서 UQ-708(`career-overview.tsx` → `variant="destructive"`)로 고쳤다.
- 코드:
  - `src/components/career/project-page/project-page.tsx:550-551` 프로젝트 삭제 — `className="text-destructive focus:text-destructive"` + 아이콘 `className="text-destructive"`
  - `src/components/career/ai-panel/ai-panel.tsx:154-155` 이 대화 삭제 — 같은 패턴
  - `src/components/career/deliverable/deliverable-page.tsx:386-387` 산출물 삭제 — `className="text-destructive"`만. `focus:` 덮어쓰기가 없어 **키보드 포커스·hover 시 메뉴 항목 기본 `focus:text-primary-text`가 이겨 초록 글자**가 된다
- 기대: 세 곳 모두 `<DropdownMenuItem variant="destructive">`, 항목과 아이콘의 `className` 색 제거(destructive variant가 아이콘 색도 정한다).

#### UQ-BR-3 [Major] S-43 산출물 행이 `Item`이 아닌 손으로 만든 `Link` (회색 hover) — owner: engineer (A2)
- 스펙: 1.3 "클릭 가능한 항목은 공통 컴포넌트로 (v4)" — "목록 행 … → `Item`", "hover·선택 색은 모두 `bg-primary/10` + `text-primary-text`이고, 화면에서 직접 지정하지 않는다". 반경 `Item ghost` = `rounded-xl`.
- 코드: `src/components/career/career-overview.tsx:525-527`
  ```tsx
  <Link href={routes.deliverable(d.id)} className="flex min-h-11 items-center gap-3 rounded-[10px] px-3 py-2.5 transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
  ```
- 현재: hover 회색(`bg-muted`), 임의 반경 `rounded-[10px]`, 포커스 링 offset 없음. 바로 위 C-25 프로젝트 카드(`career-overview.tsx:627`)는 `Item`이라 **같은 패널에서 hover 색이 초록/회색으로 갈린다**. dev 서버 렌더 HTML에서 확인.
- 기대: `<Item asChild><Link href=…>…</Link></Item>`(기본 `variant="ghost"`·`size="default"` = min-h-11·`rounded-xl`). 안쪽 `FileText`·`ChevronRight`의 `text-muted-foreground`는 지워도 된다(Item 바로 아래 svg가 기본 muted, hover 시 초록).
- 참고: 문서 6장(1823행)이 이 클래스 문자열을 지정하고 "프로젝트 카드 C-25와 같은 반경·hover"라고 하지만 C-25는 이미 `Item`이다 → UQ-BR-12.

#### UQ-BR-4 [Major] AI 패널 대화 기록 행이 손으로 만든 버튼 (hover `bg-accent`, 선택 `bg-card shadow-xs`) — owner: engineer (A2)
- 스펙: 1.3 "클릭 가능한 항목은 공통 컴포넌트로 (v4)" — 목록 행은 `Item`, 선택은 `active`(→ `data-active` + `aria-current`, `bg-primary/10` + `font-medium`). "hover와 선택은 같은 `bg-primary/10`이다(UQ-715)".
- 코드: `src/components/career/ai-panel/ai-panel.tsx:198-203`
  ```tsx
  <button aria-current={current ? "true" : undefined} className={cn("w-full rounded-lg px-3 py-2.5 text-left hover:bg-accent focus-visible:ring-2 …", current && "bg-card shadow-xs")}>
  ```
- 현재: hover 회색, 현재 대화는 흰 카드 + 그림자(v4에 없는 선택 모양). 기대: `<Item asChild active={current} className="flex-col items-start gap-0.5 px-3 py-2.5"><button type="button" onClick=…>…</button></Item>` — 색 class 제거, `aria-current`는 Item이 붙인다.
- 참고: 문서 5.10(1702행)이 `hover:bg-accent` 행을 지정 → UQ-BR-12.

#### UQ-BR-5 [Major] chip variant 3종의 hover가 회색 `hover:bg-accent` — owner: ui-designer (결정 후 foundation이 `button.tsx`·`select.tsx` 수정)
- 스펙: 1.3 "클릭 가능한 항목은 공통 컴포넌트로 (v4)" — hover는 모두 `bg-primary/10` + `text-primary-text`. v4 변경 이력(2078행) — ghost·secondary·메뉴 항목·Toggle·Item 모두 같은 초록 hover로 통일. chip은 예외 목록(근거 칩 C-01·C-15, 공급자 배지 등)에 없다.
- 코드:
  - `src/components/ui/button.tsx:32` `chip: "… bg-muted … text-foreground hover:bg-accent max-md:h-11"`
  - `src/components/ui/button.tsx:35` `"chip-dashed": "… border-dashed border-input bg-transparent … hover:bg-accent …"`
  - `src/components/ui/select.tsx:35` `SELECT_TRIGGER_CHIP = "… bg-muted … hover:bg-accent … dark:hover:bg-accent …"`
- 사용처: AI 패널 빠른 버튼 칩·슬롯 칩(`panel-input.tsx:167` 등), S-10 머리 `ChipSelect`, `CompetencyChips` 추가 트리거(`doc-inputs.tsx:278`).
- 현재: 회색 알약이 hover 시 조금 더 진한 회색. 기대(권고): 바탕은 Figma대로 `bg-muted`(chip-dashed는 투명)로 두고 hover·열림만 v4에 맞춰 `hover:bg-primary/10 hover:text-primary-text aria-expanded:bg-primary/10 aria-expanded:text-primary-text`(Select는 `data-[state=open]:` 동일). Figma 회색 hover를 지키려면 ui-designer가 chip을 1.3 예외 목록에 올리고 근거를 적어야 한다. 어느 쪽이든 문서 2장 561·562행과 코드가 같은 문자열이어야 한다.

#### UQ-BR-12 [Major] v5 문서 문장이 v4 규칙과 충돌 (위 위반 대부분의 출처) — owner: ui-designer
v5 절은 v4 브랜드 토큰보다 먼저 쓰였고, 머지 때 반경(Q-7)·셸 바탕(Q-10)만 정리됐다. 아래 문장은 v4가 금지한 사용처 색 덧씌우기·회색 hover를 지정하고 있어, 엔지니어가 문서대로 구현하면 v4 위반이 된다. v4 variant로 바꿔 적어야 한다.

| 문서 위치 | 현재 문장(요지) | v4로 바꿀 내용 | 대응 코드 이슈 |
|-----------|----------------|----------------|----------------|
| 2장 561행 `button` chip·chip-dashed | `hover:bg-accent` | UQ-BR-5 결정 반영 | UQ-BR-5 |
| 2장 562행 `SelectTrigger chip` | `hover:bg-accent` | 같음 | UQ-BR-5 |
| 5.8 1605행 이탈 확인 | "저장하지 않고 나가기(ghost + `text-destructive`)" | `destructive-ghost` | UQ-BR-1 |
| 5.9 1632행 ⋯ 메뉴 | "프로젝트 삭제 `text-destructive` `Trash2`" | `DropdownMenuItem variant="destructive"` | UQ-BR-2 |
| 5.10 1697행 머리 아이콘 버튼 | "대화 메뉴 → 이 대화 삭제 `text-destructive`", "기록 보기일 때 `aria-pressed=true` + `bg-accent`" | `variant="destructive"` 항목 / `Toggle`(aria-pressed 초록) | UQ-BR-2, UQ-BR-7 |
| 5.10 1702행 기록 행 | `button … hover:bg-accent` | `Item` + `active` | UQ-BR-4 |
| 5.9 1661행 도움 줄 | `Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground"` "AI에게 물어보기" | 덧씌우기 없는 `ghost`(또는 필요하면 muted ghost variant 신설) | UQ-BR-6 |
| 6장 1822행 산출물 추가 | `Button asChild variant="ghost" size="sm" className="text-muted-foreground"` | 덧씌우기 없는 `ghost` | UQ-BR-6 |
| 6장 1823행 산출물 행 | `Link … rounded-[10px] … hover:bg-muted`, "C-25와 같은 반경·hover" | `Item asChild`(C-25와 같은 컴포넌트) | UQ-BR-3 |
| 3.25 1231행 확인이 필요한 내용 트리거 | ghost sm + `text-warning-subtle-foreground` | UQ-BR-9 결정 반영 | UQ-BR-9 |

### Minor

#### UQ-BR-6 [Minor] ghost 버튼에 `text-muted-foreground` 덧씌우기 4곳 — owner: engineer (A2)
- 스펙: 1.3 "색 덧씌우기 금지 (v4)" — Button에 사용처 `text-*` 금지. "흐린 ghost"용 variant는 `data-pending`(아직 닿지 않은 단계) 하나뿐이고 용도가 다르다. main의 같은 `PanelSection` 동작 버튼(경력 패널 "추가" 등)은 덧씌우기 없는 `ghost sm`이다.
- 코드:
  - `src/components/career/career-overview.tsx:500` "산출물 추가"(50개 도달, disabled)
  - `src/components/career/career-overview.tsx:505` "산출물 추가" 링크 — 렌더 HTML 끝에 `text-muted-foreground` 확인
  - `src/components/career/project-page/project-page.tsx:679` "AI에게 물어보기"
  - `src/components/career/deliverable/deliverable-page.tsx:448` 본문 빈 칸 AI 버튼
- 기대: `className`에서 `text-muted-foreground` 제거(레이아웃 `-ml-2`는 유지). 흐린 모양이 꼭 필요하면 ui-designer가 variant를 만든다(UQ-BR-12 표).

#### UQ-BR-7 [Minor] AI 패널 "대화 기록" 아이콘 버튼의 눌림 상태가 `bg-accent` 덧씌우기 — owner: engineer (A2)
- 스펙: 1.3 표 "토글 선택 → `Toggle`·`ToggleGroupItem` 기본값(`data-[state=on]` 초록)". `ui/toggle.tsx:9`에 `aria-pressed:bg-primary/10 aria-pressed:text-primary-text`가 있다.
- 코드: `src/components/career/ai-panel/ai-panel.tsx:117` `<Button variant="ghost" size="icon-sm" aria-pressed={pressed} className={cn(pressed && "bg-accent")}>`
- 현재: 눌린 상태 회색, hover는 초록 — 같은 버튼에서 두 색. 기대: 토글 동작이므로 `Toggle size="sm"`(`pressed`/`onPressedChange`)로 바꾸고 className 색 제거. Toggle로 바꾸지 않으려면 foundation이 ghost에 `aria-pressed:` 스타일(= `aria-[current]`과 같은 초록)을 더하는 방법도 있다.

#### UQ-BR-8 [Minor] 종료된 대화 표식이 `Badge variant="outline"` — owner: engineer (A2)
- 스펙: 1.3 표 "없음·근거 없음·중단·해당 없음·**잠금**·편집됨처럼 흐린 상태 배지 → `Badge variant="muted"`".
- 코드: `src/components/career/ai-panel/ai-panel.tsx:208` `<Badge variant="outline" className="h-5"><Lock …/>{PANEL_COPY.closedChatBadge}</Badge>`
- 기대: `variant="muted"` (`Lock` 아이콘이 있는 잠금 상태 = main의 `applications/[id]` 잠금 표식과 같은 처리).

#### UQ-BR-9 [Minor] "확인이 필요한 내용 N개" 트리거가 ghost + `text-warning-subtle-foreground` 덧씌우기 — owner: ui-designer
- 스펙: 1.3 "색 덧씌우기 금지 (v4)". 경고색 버튼 variant는 `warning-outline`(테두리형)뿐이고 경고 글자 ghost는 없다. 문서 3.25(1231행)가 이 조합을 지정.
- 코드: `src/components/career/deliverable-draft-card.tsx:679` `<Button variant="ghost" size="sm" className="-ml-2 text-warning-subtle-foreground">` (+ 680행 아이콘 `text-warning`)
- 현재: 평소 노란 글자, hover 시 ghost hover의 `text-primary-text`가 이겨 초록 글자. 기대: ui-designer가 ① 버튼 글자는 기본 ghost로 두고 아이콘(`TriangleAlert`)만 경고색(svg 색은 아이콘 자체 클래스라 덧씌우기 아님) ② `warning-ghost` variant 신설 ③ `warning-outline sm` 중 하나를 정하고 3.25를 고친다. 정해지면 A2가 적용.

#### UQ-BR-10 [Minor] 초안 표 머리 행 `TableRow className="bg-muted/50"` — owner: engineer (A2)
- 스펙: 1.3 "색 덧씌우기 금지 (v4)". TableRow 색은 `interactive`·`muted` prop으로만.
- 코드: `src/components/career/deliverable-draft-card.tsx:631`
- 기대: 바탕 덧씌우기 제거(표 머리는 `TableHead` 기본 글자 굵기로 구분). 머리 행 바탕이 필요하면 foundation이 `TableHeader`에 넣어 모든 표가 같이 쓰게 한다.

#### UQ-BR-11 [Minor] 손으로 만든 버튼·덧씌우기 잔여 2곳 — owner: engineer (A2 / foundation 셸)
- 스펙: 1.3 "색 덧씌우기 금지 (v4)", "클릭 가능한 항목은 공통 컴포넌트로 (v4)". 6장 1804행의 같은 종류 접기 트리거("그만둔 대화 N개")는 `Button variant="ghost" size="sm"`.
- 코드:
  - `src/components/career/deliverable-draft-card.tsx:235` 이전 초안 접기 — `<CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">`. 회색 hover이고 **포커스 링 클래스가 없다**(브라우저 기본 outline만). 기대: `<CollapsibleTrigger asChild><Button variant="ghost" size="xs">…</Button></CollapsibleTrigger>`.
  - `src/components/common/shell/doc-body.tsx:107` 떠 있는 "Resumate AI" 버튼 — `variant="outline"` + `bg-card`. outline 기본 바탕이 이미 `bg-card`(v4)라 덧씌우기가 불필요하다. 기대: `bg-card` 제거. `rounded-full`·`shadow-md`는 UQ-BR-14 예외 등록 대상.
- 참고(이슈 아님): `doc-inputs.tsx:294` `DropdownMenuLabel className="text-xs font-normal text-muted-foreground"`는 기본값과 같은 색을 다시 적은 것이라 지워도 모양이 같다.

#### UQ-BR-13 [Minor] 토큰 표의 `--shell` 값이 옛 값 — owner: ui-designer
- 스펙 내부 불일치: design-system.md 1.1 토큰 표 59행 `--shell` = `oklch(0.955 0.012 165) #e9f3ee` ↔ 같은 문서 코드 블록 151행 `--shell: #F3FBF8` · G-42(1992행) "= `--sidebar` #F3FBF8 (Q-10 해소)".
- 코드: `src/app/globals.css:100` `--shell: #F3FBF8` (코드 블록·G-42와 일치).
- 기대: 59행 라이트 값을 `#F3FBF8`(= `--sidebar`)로 고친다. 같은 블록의 `globals.css:99` 주석·`@theme` 272~275행 주석은 `(v4)`, 문서는 `(v5)` — 표시만 다르니 함께 맞추면 좋다.

#### UQ-BR-14 [Minor] v5 둥근 버튼·문서형 입력이 v4 반경·hover 예외 목록에 없음 — owner: ui-designer
- 스펙: 1.3 "버튼·드롭다운·입력 `rounded-control`(12, v4)". 475행 v5 추가 반경은 본문 카드·패널·칩·대화 입력창만 적고, 1.3 v4 예외 목록에는 아래 항목이 없다.
- 코드(문서 5.8~5.10대로 구현됨 — 코드 위반 아님, 문서 규칙 공백):
  - 원형 아이콘 버튼: `page-shell.tsx:522` CrumbRow "←"(`secondary` + `rounded-full`), `panel-input.tsx:215`·`:219` 중단·보내기(`rounded-full`), `doc-body.tsx:107` 떠 있는 Resumate AI(`rounded-full`)
  - 문서형 입력: `doc-inputs.tsx:49`(`DocTitleInput`)·`:119`(`DocTextarea`) `rounded-md` + `hover:bg-accent/60`·`/50`. 입력 반경 규칙(`rounded-control`)과 hover 규칙(초록) 어느 쪽에도 속하지 않는다. A-13은 "hover 바탕"을 요구하지만 색을 정하지 않는다
  - 패널 사용자 말풍선 버튼 `ai-panel.tsx:321`(`hover:ring-1 hover:ring-border`): 예외 목록의 "채팅 사용자 말풍선 버튼(S-36)"은 폐기된 S-36 기준이다
  - 제안 카드 접기 머리 `star-proposal-card.tsx:297`·`deliverable-draft-card.tsx:159`: 전체 폭 버튼인데 hover 표시가 없다
- 기대: 위 넷을 1.3 반경 줄 또는 v4 예외 목록에 명시(예: "L-02 원형 아이콘 버튼 `rounded-full`", "문서형 입력 `rounded-md` + `hover:bg-accent/60` — A-13", "S-36 말풍선 예외는 5.10 패널 말풍선에도 적용", "제안 카드 머리는 hover 없음"). 바꾸기로 하면 해당 엔지니어 작업으로 넘긴다.

#### UQ-BR-15 [Minor] 카드형 단일 선택지(라디오 카드)의 선택 색이 `primary-subtle` — 규칙 공백 — owner: ui-designer
- 스펙: 1.3 표 "목록 행·설정 진입 줄·**카드형 선택지** → `Item`", 선택 = `bg-primary/10`. 한편 3.23(C-23)·C-05 문서는 라디오 카드를 `has-[:checked]:border-primary has-[:checked]:bg-primary-subtle`로 적고 있고, main에도 같은 모양이 남아 있다(`education-form.tsx:139`, `interview-prep.tsx:312` — 21·23 검수에서 지적되지 않음).
- 코드(이번 범위): `add-project-dialog.tsx:169`(C-23 소속 선택), `project-page/affiliation-dialog.tsx:59`(소속 변경), `delete-confirm-dialog.tsx:101`(결과 처리), `star-proposal-card.tsx:670`(분류 추천 칩, `border-primary/50 bg-primary-subtle`).
- 현재: hover 없음, 선택 시 `bg-primary-subtle`(#E3F5EE) + `border-primary`. `primary/10`과 거의 같은 밝기지만 다른 토큰이다. 기대: ui-designer가 "라디오 카드는 `Label` + `RadioGroupItem` 모양 유지(예외)"인지 "`Item variant="outline"` + `active`로 통일"인지 정해 1.3 예외 목록 또는 표에 적는다. 통일로 정하면 main 두 곳까지 같이 바꾼다.

#### UQ-BR-16 [Minor] 6장 S-43 메모의 C-25 참조가 v4 이전 모양 — owner: ui-designer
- 스펙: 6장 1823행 "프로젝트 카드 C-25와 같은 반경·hover"인데, C-25(`career-overview.tsx:627`)는 v4에서 `Item`(rounded-xl, 초록 hover)이다. 1798행은 "S-08 목록·S-09·S-34 패널의 시각 규칙은 아직 정리하지 않았다(P-15) — 지금 구현을 기준"이라고 해 둔 상태다.
- 기대: UQ-BR-12의 1823행 수정과 함께, P-15 정리 때 S-08 패널 안 클릭 요소(프로젝트 카드·산출물 행·섹션 동작 버튼)를 v4 컴포넌트 기준으로 적는다.

#### UQ-BR-17 [Minor] 5.8 로고 마크 클래스가 코드와 다른 토큰 이름 — owner: ui-designer
- 스펙: 5.8(1587행) 로고 마크 `size-7 rounded-lg bg-primary text-primary-foreground`.
- 코드: `src/components/common/shell/logo-mark.tsx:10` `bg-sidebar-primary text-sidebar-primary-foreground`(L-01 사이드바와 공용 컴포넌트). v4에서 `--sidebar-primary` = `--primary` = #15A76E라 화면 차이는 없다.
- 기대: 문서를 공용 `LogoMark`(sidebar-primary 토큰)로 고쳐 적는다. 코드 변경 불필요.

## 4. 담당별 정리

| owner | 이슈 |
|-------|------|
| engineer — foundation(셸) | UQ-BR-1, UQ-BR-11(doc-body), UQ-BR-5 적용(ui-designer 결정 후 `button.tsx`·`select.tsx`) |
| engineer — A2(S-10·S-43·S-44·AI 패널) | UQ-BR-2, 3, 4, 6, 7, 8, 10, 11(deliverable-draft-card) |
| ui-designer | UQ-BR-5(결정), 9, 12, 13, 14, 15, 16, 17 |

순서 권고: ui-designer가 UQ-BR-12 표와 UQ-BR-5·9·14·15 결정을 먼저 문서에 반영 → foundation·A2가 한 번에 고친다. UQ-BR-1~4·6~8·10은 v4에 이미 쓸 variant가 있으므로 문서 수정을 기다리지 않고 바로 고쳐도 된다.
