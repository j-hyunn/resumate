# 23 UI QA — 디자인 시스템 v4 재검수 (1회차)

- 검수자: ui-qa / 2026-11-03
- 입력: `_workspace/ui/21_ui-qa_ds-v4_review.md`(UQ-708 ~ UQ-722), `_workspace/ui/22_frontend-engineer_ds-v4_fixes.md`, 작업 트리(커밋 전)
- 리더 결정: UQ-710 색 유지(사용자 지정 #118658, 문서에 측정값 기록), UQ-715 건너뜀(사용자 요청 디자인)

## 요약

| 구분 | 건수 |
|------|------|
| 해결 | 13 (UQ-708, 709, 711, 712, 713, 714, 716, 717, 718, 719, 720, 721, 722) |
| 리더 결정으로 종결 | 2 (UQ-710 문서화, UQ-715 유지·문서화) |
| 미해결 / 재발 | 0 |
| 새 이슈 | 2 (Minor: UQ-723, UQ-724) |

**남은 이슈: Critical 0 / Major 0 / Minor 2.** 둘 다 이번 수정에서 생긴 작은 회귀이고 커밋을 막을 정도는 아니다.

## 1. 기계 검사

| 검사 | 결과 |
|------|------|
| `pnpm lint` | 통과 (exit 0) |
| `pnpm tsc --noEmit` | 통과 (exit 0, 오류 0) |
| `pnpm vitest run` | 통과 — 111 files / 1772 tests |
| `NEXT_PUBLIC_SUPABASE_URL=http://localhost NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy pnpm next build --experimental-build-mode=compile` | 통과 (exit 0) |
| dev 서버 `/career?state=default` | 200. 선택 행 `aria-current="true" data-active="true"`, 선택 안 된 행에는 `data-active` 없음 |
| 빌드 CSS 확인 (`.next/static/chunks/*.css`) | `data-pending:not-hover` → `[data-pending]:not(:hover)`, `[li:first-child>&]:rounded-t-…` → `li:first-child>.…`, `data-muted`, `data-[tone=success]` 모두 의도대로 생성됨 |

참고: 빌드 CSS에 `.\[li\:first-child\>\&\]{li:first-child>&}`라는 잘못된 규칙이 하나 더 생긴다. Tailwind가 `[li:first-child>&]` 부분 문자열을 임의 속성으로도 읽은 것이고, 그 클래스를 쓰는 요소가 없으며 브라우저가 무시하는 선언이라 영향은 없다. 이슈로 올리지 않는다.

## 2. 이전 이슈 재확인

| ID | 심각도 | 결과 | 확인 내용 |
|----|--------|------|-----------|
| UQ-708 | Major | **해결** | `button.tsx:26` `destructive-ghost`, `:30` `destructive-link` 추가. 7곳 모두 적용 확인(drafts-view:194, form-parts:449, achievement-dialog:290·302, cover-letter-questions:283, save-status:49, career-overview:307 `DropdownMenuItem variant="destructive"`). 사용처 색 덧씌우기 다시 검사 결과 0건(아래 4절) |
| UQ-709 | Major | **해결** | `interview-prep.tsx:250` `Alert variant="warning"`. `className="flex …"`가 Alert 기본 `grid`를 tailwind-merge로 대체하고, 아이콘이 없어 grid 열 규칙과 충돌하지 않는다. 단, `role="status"`는 새 이슈 UQ-724 |
| UQ-710 | Major | **종결(리더 결정)** | 색 유지. 문서 8장 표(1588행 부근)에 측정값 4.59 / 4.36 / 4.13 / 3.95 / 3.92가 들어갔고, 예전 "2.9:1" 문장은 지워졌다. 내 측정값과 같다 |
| UQ-711 | Major | **해결** | `badge.tsx:19` `muted`. 8곳 적용(basics, stage-menu, insight-view, session-status, result-view `GRADE_VARIANT.not_applicable`, applications/[id] 잠금 표식, placeholders, project-form `abandoned`) |
| UQ-712 | Minor | **해결** | draft-preview → `warning-outline`, chat-screen 단계 → `data-pending`(515행), ai-usage-panel → `TableRow muted`, `hover:bg-transparent` 제거, Alert 아이콘 색은 variant로 이동(result-view, answer-sheet, ai-error-notice의 덧씌우기 제거). nav-user는 문서 예외 목록에 추가됨 |
| UQ-713 | Minor | **해결** | `item.tsx` `active`면 `aria-current`(호출 쪽 값 또는 `"true"`), `data-active={active \|\| undefined}`, 선택자 `data-active:`. CareerList의 중복 `aria-current` 전달 제거 |
| UQ-714 | Minor | **해결** | `{...props}`를 앞으로, `data-slot`·`data-variant`·`data-active`·`className`을 뒤로 옮김. `type`은 props보다 앞이라 `type="submit"`으로 덮어쓸 수 있다(의도대로). `aria-disabled:pointer-events-none aria-disabled:opacity-50` 추가 |
| UQ-715 | Minor | **종결(리더 결정)** | 코드 유지. 문서 444행 부근에 "선택은 font-medium(+aria-current)으로만 구분" 기록 |
| UQ-716 | Minor | **해결** | 문서 81·158·244행에 `--primary-text` / `--color-primary-text`. `globals.css:2` 머리 주석 v4 |
| UQ-717 | Minor | **해결** | `Card tone="success"`(card.tsx:24) → experience-form:300, chat-screen:1054. `Badge count-neutral`(badge.tsx:21) → kanban-board:364. 바뀌기 전과 같은 모양 |
| UQ-718 | Minor | **해결** | `placement: "list" \| "empty"`(career-overview.tsx:197). 한 화면에 primary는 1개. 단, 위계 방향이 v4 이전과 반대가 됨 → 새 이슈 UQ-723 |
| UQ-719 | Minor | **해결** | `table.tsx:71` hover·열림 배경은 `data-interactive`일 때만. 모든 TableRow 사용처 확인(아래 3절) |
| UQ-720 | Minor | **해결** | `LongText` 빈 값 버튼에 DS 포커스 링 추가(career-overview.tsx:464). 채팅 말풍선·빈 긴 글 자리·본문 텍스트 링크를 문서 예외 목록에 추가 |
| UQ-721 | Minor | **해결** | 멈춘 공급자는 Item으로 감싸지 않음(key-connect-flow.tsx:535). 이중 흐림 없음. `ProviderCardFrame`이 `inButton`일 때 스스로 `bg-transparent`(provider-card.tsx:217), 사용처 className 제거. 멈춘 공급자는 예전에도 disabled 버튼이라 포커스되지 않았으므로 키보드 동작 변화 없음 |
| UQ-722 | Minor | **해결** | `row` variant가 첫 행·마지막 행에서 목록 모서리를 따름(item.tsx:22). 목록에 `overflow-hidden`이 없어 포커스 링이 잘리지 않음. 빌드 CSS에서 선택자 확인 |

## 3. 회귀 점검 (요청 항목별)

### 3.1 새 Button variant
- `destructive-ghost`: 빨간 글자, hover·`aria-expanded` 시 `bg-destructive/10`(다크 `/20`). 대비는 destructive 글자 기준 흰 바탕에서 기존 값과 같다. 문제없음.
- `destructive-link`: save-status의 빨간 문장 안에서 색이 이어진다. 문제없음.
- `warning-outline`: `border-warning bg-card text-warning-subtle-foreground`, 바뀌기 전 사용처 클래스와 같은 모양. 테두리 `--warning`은 흰 바탕에서 2.27:1이지만 글자(`warning-subtle-foreground`)가 상태를 전달하고, 문서 R-C4(경고 노랑은 글자와 함께)와 맞는다. 문제없음.
- `ghost` + `data-pending`: `[data-pending]:not(:hover)`일 때만 muted. 현재 단계(`aria-current`)에는 `data-pending`이 붙지 않으므로(chat-screen.tsx:515 조건 `!s.current && !s.filled`) 두 규칙이 겹치지 않는다. hover 시 초록으로 바뀌는 것은 바뀌기 전 동작(hover:text-primary-text가 text-muted-foreground를 이김)과 같다. 키보드 포커스 시에는 muted가 유지되지만 포커스 링이 있으므로 문제 아님.

### 3.2 새 Badge variant
- `muted`: outline과 같은 테두리 + muted 글자. 8곳 모두 같은 의미(없음·근거 없음·중단·해당 없음·잠금·편집됨·abandoned)에만 쓰였다.
- `count-neutral`: 칸반 열 머리 1곳. 바뀌기 전 `count` + `bg-background text-muted-foreground`와 같다.

### 3.3 Card `tone="success"`
- `data-tone`은 default일 때 속성을 남기지 않는다. 빌드 CSS에서 `border-success/30`(color-mix) 생성 확인. 두 사용처 모두 `role="status"` 완료 카드. 문제없음.

### 3.4 TableRow (hover는 interactive만 + `muted`)

| 사용처 | 종류 | 동작 |
|--------|------|------|
| application-list.tsx:107 | 헤더 행 | hover 없음 (의도) |
| application-list.tsx:162 | 상세로 가는 행, `interactive` | 초록 hover + 포인터 유지 |
| session-list.tsx:217 | 헤더 행 | hover 없음 |
| session-list.tsx:232 | `interactive`, 행 안 메뉴 트리거 | 초록 hover, 메뉴 열림 시 `data-interactive:has-aria-expanded:bg-primary/10`로 바뀌기 전(`has-aria-expanded:bg-muted/50`)과 같은 "열린 행" 표시 유지 |
| insight-view.tsx:523, 531 | 정적 요건 표 | hover 없음. 클릭 동작이 없는 표라 맞다 |
| ai-usage-panel.tsx:270, 323, 401 | 헤더 행 | hover 없음 |
| ai-usage-panel.tsx:280 | 기능별 사용량, `muted={calls === 0}` | 0건 행만 흐림. 바뀌기 전과 같음 |
| ai-usage-panel.tsx:333, 342 | 공급자별 행 + 무료 등급 보조 행 | hover 없음. 342행의 `hover:bg-transparent`가 필요 없어졌고 제거됨 |
| ai-usage-panel.tsx:409 | 요금 행 | hover 없음 |

`aria-expanded`를 가진 요소가 있는 비-interactive 행은 없다. 회귀 없음.

### 3.5 Alert variant가 아이콘 색을 정함
- 바뀐 점: `warning`은 `*:[svg]:text-warning`, `destructive`는 `*:[svg]:text-destructive`. 이 규칙의 명시도(클래스+요소)가 단일 유틸리티 클래스보다 높아, 사용처에서 아이콘에 준 색 클래스는 무시된다.
- warning/destructive Alert 전 사용처(form-parts 361·369·378, save-status 77, state-views 304, achievement-dialog 268, jd-raw-edit 153·341·347, sources-used 188·205, drafts-view 623, ai-connection-panel 356, interview-prep 250, application-new-form 206·213, sign-in-form 124, withdraw-form 109, result-view 520, answer-sheet 636, ai-error-notice 740, applications/[id]/jd/page 137)에서 바로 아래 아이콘에 자체 색 클래스(`text-*`, 스피너)를 준 곳은 **없다**. 따라서 사용처 의도를 덮어쓴 곳은 없다.
- 시각 변화: 아이콘이 예전 `text-current`(진한 subtle-foreground)에서 `text-warning`/`text-destructive`로 바뀐다. destructive 아이콘은 destructive-subtle 바탕에서 5.01:1. warning 아이콘은 warning-subtle 바탕에서 2.07:1로 1.4.11(3:1)에 못 미치지만, 문서 R-C4가 "아이콘은 `text-warning`, 반드시 글자와 함께"로 정한 규칙이고 모든 사용처에 제목 글자가 있다. 문서에 이미 정해진 결정이라 이슈로 올리지 않는다.
- 다크: `--warning` 다크 아이콘은 다크 warning-subtle에서 8.0:1. 문제없음.
- `info`·`ai`·default Alert는 바뀌지 않았다(예: jd-raw-edit.tsx:189 default Alert의 `CircleCheck text-success`는 그대로 초록).

### 3.6 Item `aria-current` / 속성 순서 / row 모서리
- `aria-current`: `active`가 아니면 호출 쪽 값만 전달되므로, `active` 없이 `aria-current="page"`를 직접 주는 사용도 막지 않는다. dev 서버 HTML에서 확인.
- 속성 순서: `data-*`와 `className`이 props 뒤라 덮어쓸 수 없다. `className`은 구조 분해로 빠지므로 props에 다시 들어가지 않는다. `onClick`·`disabled`·`aria-label` 등은 정상 전달.
- row 모서리: `li:first-child > [item]` / `li:last-child > [item]`에 `calc(var(--radius-md) - 1px)`. 목록 테두리 `rounded-md` 안쪽 반경과 맞다. 항목이 1개면 위·아래 모두 둥글다. 문제없음.

### 3.7 AddCareerMenu `placement`
- 위치별 동작은 리포트대로다. 다만 v4 이전(HEAD)은 목록 위 = secondary, 빈 상태 = primary였는데, 지금은 반대(목록 위 = primary, 빈 상태 = secondary)다 → UQ-723.

## 4. 사용처 색 덧씌우기 재검사

검사 스크립트(DS 컴포넌트 태그의 `className` 안 색 유틸리티)를 다시 돌린 결과 남은 것은 `src/components/common/shell/nav-user.tsx:54` 한 곳뿐이다. 이곳은 shadcn sidebar-08 블록 원래 코드이고 문서 예외 목록에 들어갔다. 0건.

## 5. 새 이슈

#### UQ-723 [Minor] 빈 커리어 화면의 주 버튼 위계가 바뀜 — owner: career 영역 담당 (ui-designer 확인)
- 스펙: `docs/planning/02-user-flows.md` FL-09(229·259행) "v5.5: 빈 커리어 시작점 = '커리어 추가' 1개", 빈 상태 → C-22. design-system 인벤토리 button 행 "default(primary, 화면당 주 버튼 1개)".
- 코드: `src/components/career/career-overview.tsx:160`(목록 위, `placement="list"` = primary), `:182`(빈 상태, `placement="empty"` = secondary), `:216`.
- 기대 vs 실제: 커리어가 0개이면 두 버튼이 함께 보인다(목록 nav와 상세 section 모두 표시). v4 이전에는 빈 상태 안 버튼이 primary라 처음 쓰는 사용자의 시작점이 강조됐는데, 지금은 빈 상태 안 버튼이 연초록 secondary이고 강조는 목록 위 버튼으로 옮겨졌다. "주 버튼 1개" 규칙은 지켜지지만, 스펙이 말하는 시작점(빈 상태 C-22)의 강조가 약해졌다.
- 수정(택1): (a) 커리어가 0개일 때는 목록 위 버튼을 secondary로 두고 빈 상태 버튼을 primary로(`placement="list"`에 `items.length === 0`이면 secondary), (b) 커리어가 0개일 때 목록 위 버튼을 숨겨 시작점을 하나로. 어느 쪽이든 ui-designer가 정하고 문서 C-22 항목에 적는다.

#### UQ-724 [Minor] 작성 중 면접 배너에 `role="status"`가 새로 붙음 — owner: interview 영역 담당
- 스펙: S-20 작성 중·실패 세션 안내는 화면에 처음부터 있는 고정 배너이고 동작 결과 알림이 아니다. 다른 고정 warning Alert(jd-raw-edit 153, sources-used 188 등)는 따로 role을 주지 않는다.
- 코드: `src/components/interviews/interview-prep.tsx:250` `<Alert variant="warning" role="status" …>`. 바뀌기 전 Card에는 role이 없었다.
- 영향: 버튼 3개("그만두고 새로 시작"/"그만두기"/"이어서 쓰기")가 든 영역이 live region이 되어, 내용(상대 시간 "마지막 활동 n분 전" 포함)이 바뀔 때마다 화면 읽기 프로그램이 배너 전체를 다시 읽을 수 있다.
- 수정: `role={undefined}`로 바꾼다(ai-error-notice.tsx:743과 같은 방식). 그냥 지우면 `alert.tsx`의 기본 `role="alert"`가 붙어 더 공격적으로 읽힌다. 참고: 다른 고정 warning Alert도 기본 `role="alert"`를 받고 있는데, 이는 v4 이전부터 있던 동작이라 이번 범위 밖으로 둔다.

## 6. 담당별 전달
- career 영역: UQ-723 (ui-designer 결정 필요)
- interview 영역: UQ-724
- foundation: 남은 이슈 없음
- 기획 확인 필요: 없음
