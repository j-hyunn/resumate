# 22 frontend-engineer (A0 foundation) — 디자인 시스템 v4 QA 수정

- 작성: frontend-engineer (A0) / 2026-11-03
- 입력: `_workspace/ui/21_ui-qa_ds-v4_review.md` (UQ-708 ~ UQ-722), 리더 결정
- 범위: 커밋 전 작업 트리. 커밋하지 않음. `docs/planning` 수정 없음.

## 요약

| UQ | 결과 |
|----|------|
| UQ-708 | 완료 |
| UQ-709 | 완료 |
| UQ-710 | 완료 (색 유지, 문서만) |
| UQ-711 | 완료 |
| UQ-712 | 완료 |
| UQ-713 | 완료 |
| UQ-714 | 완료 |
| UQ-715 | 건너뜀 (사용자 요청 디자인) |
| UQ-716 | 완료 |
| UQ-717 | 완료 |
| UQ-718 | 완료 |
| UQ-719 | 완료 |
| UQ-720 | 완료 |
| UQ-721 | 완료 |
| UQ-722 | 완료 |

## 항목별

### UQ-708 [완료] 파괴 동작 빨간색 복구
- 신설 Button variant `destructive-ghost`(빨간 글자, hover·열림 `bg-destructive/10`, 다크 `/20`): `src/components/ui/button.tsx:26`
- 신설 Button variant `destructive-link`(빨간 문장 안 링크): `src/components/ui/button.tsx:30`
- 적용(사용처 `className` 색 제거):
  - `src/components/applications/drafts-view.tsx:194` 초안 삭제
  - `src/components/career/form-parts.tsx:449` DangerZone 삭제
  - `src/components/career/achievement-dialog.tsx:290` 그래도 닫기
  - `src/components/career/achievement-dialog.tsx:302` 성과 삭제 (`text-destructive` 제거)
  - `src/components/applications/cover-letter-questions.tsx:283` 문항 삭제 (`text-destructive` 제거)
  - `src/components/common/save-status.tsx:49` "다시 시도" → `destructive-link` (빨간 문장 옆 초록 링크 제거)
  - `src/components/career/career-overview.tsx:307` DropdownMenuItem `className="text-destructive"` → `variant="destructive"`
- 문서: 2장 v4 후속 표(`docs/ui/design-system.md:421`), 인벤토리 button 행(`:501`), 3.5 C-05(`:654`), 3.6 C-06 저장 실패 행

### UQ-709 [완료] 작성 중·실패 면접 배너
- `src/components/interviews/interview-prep.tsx:250` Card → `Alert variant="warning"`(`role="status"`, 레이아웃 클래스만 전달). 쓰지 않게 된 `Card` import 제거.

### UQ-710 [완료 — 색 변경 없음]
- `#118658`은 사용자 지정 값이라 그대로 둠.
- 8장 "v4 메모 — 대비"에 측정값 표(흰색 4.59 / `#F3FBF8` 4.36 / primary 10% 4.13 / 사이드바 현재 메뉴 3.95 / secondary hover 3.92)를 넣고, 예전 "link·text-primary 약 2.9:1" 문장을 지움: `docs/ui/design-system.md:1588` 부근.

### UQ-711 [완료] 흐린 상태 배지
- 신설 Badge variant `muted`(`border-border text-muted-foreground`): `src/components/ui/badge.tsx:19`
- 적용: `src/components/common/basics.tsx:97`, `src/components/common/stage-menu.tsx:330`, `src/components/applications/insight-view.tsx:307`, `src/components/interviews/session-status.tsx:45`, `src/components/interviews/result-view.tsx:58`(`GRADE_VARIANT.not_applicable` → `muted`, 타입도 변경), `src/app/(dashboard)/(gated)/applications/[id]/page.tsx:245`, `src/components/common/placeholders.tsx:103`, `src/components/career/project-form.tsx:462`(`abandoned` → `muted`, `className` 제거)

### UQ-712 [완료] 남은 색 덧씌우기
- `src/components/career/writing-chat/draft-preview.tsx:107` → 신설 Button `warning-outline`(`src/components/ui/button.tsx:23`)
- `src/components/career/writing-chat/chat-screen.tsx:515` 단계 버튼 `text-muted-foreground` → `data-pending` 속성. ghost variant에 `data-pending:not-hover:text-muted-foreground` 추가(`src/components/ui/button.tsx:18`)
- `src/components/account/ai-usage-panel.tsx:280` → 신설 `TableRow muted`, `:342` `hover:bg-transparent` 제거(UQ-719)
- Alert 아이콘 색을 variant로 이동: `src/components/ui/alert.tsx:14`(destructive `*:[svg]:text-destructive`), `:17`(warning `*:[svg]:text-warning`). 사용처 제거: `src/components/interviews/result-view.tsx:520`, `src/components/interviews/answer-sheet.tsx:636`, `src/components/common/ai-error-notice.tsx:742`(같은 덧씌우기가 있어 함께 정리). 그 결과 다른 warning/destructive Alert의 아이콘도 DS 3.20 표대로 `text-warning`/`text-destructive`가 된다.
- `nav-user.tsx`는 코드 변경 없음. 문서 예외 목록에 추가: `docs/ui/design-system.md:415`

### UQ-713 [완료] Item `active` → `aria-current`
- `src/components/ui/item.tsx:59` `active`면 `aria-current`를 사용처 값 또는 `"true"`로 설정, `:63` `data-active={active || undefined}`. cva 선택자는 `data-active:`로 정리(`:13`).
- `src/components/career/career-overview.tsx` CareerList에서 중복 `aria-current` 전달 제거.

### UQ-714 [완료] Item props 보호 · aria-disabled
- `src/components/ui/item.tsx:58` `{...props}`를 앞으로 옮기고 `data-slot`·`data-variant`·`data-active`·`className`을 뒤에 둠(`type`은 의도적으로 덮어쓸 수 있게 props 앞).
- `src/components/ui/item.tsx:13` `aria-disabled:pointer-events-none aria-disabled:opacity-50` 추가.

### UQ-715 [건너뜀]
- 사용자가 요청한 디자인(hover·선택 모두 `bg-primary/10`). 코드는 그대로 두고, 문서에 "선택 행은 `font-medium`(+ `aria-current`)으로만 구분된다"를 적음: `docs/ui/design-system.md:444`

### UQ-716 [완료] 문서 토큰 코드 블록
- `docs/ui/design-system.md:81`(`:root --primary-text`), `:158`(`.dark --primary-text`), `:244`(`@theme --color-primary-text`)
- `src/app/globals.css:2` 머리 주석 v1.1 → v4

### UQ-717 [완료] 완료 카드 · 칸반 개수
- 신설 Card `tone="success"`(`data-[tone=success]:border-success/30`): `src/components/ui/card.tsx:24`
- 적용: `src/components/career/experience-form.tsx:300`, `src/components/career/writing-chat/chat-screen.tsx:1054`
- 신설 Badge `count-neutral`(`count` 모양 + `bg-background text-muted-foreground`, 바뀌기 전 모습과 같음): `src/components/ui/badge.tsx:21`, 적용 `src/components/board/kanban-board.tsx:364`

### UQ-718 [완료] 커리어 추가 버튼 위계
- `AddCareerMenu`의 `primary` prop을 `placement: "list" | "empty"`로 바꿈: `src/components/career/career-overview.tsx:197`
  - `list`(목록 위 주 버튼, 기본값): `default`(primary) + `w-full` — 사용자 의도대로 주 버튼은 primary
  - `empty`(빈 상태 안 반복 버튼): `secondary` — 한 화면에 primary 두 개가 나오지 않음 (`:182`, `:216`)
- `add-career-dialog.tsx` 저장 버튼 `default`는 QA 판단대로 유지.

### UQ-719 [완료] TableRow hover
- `src/components/ui/table.tsx:71` 기본 `hover:bg-muted/50`·`has-aria-expanded:bg-muted/50` 제거, hover·열림은 `interactive` 행에만. `muted` prop 추가.
- 사용처 점검: `ai-usage-panel.tsx`(6곳, `hover:bg-transparent` 제거), `insight-view.tsx:523,531`(정적 표 — 이제 hover 없음), `application-list.tsx:107,162`(162는 interactive 유지), `session-list.tsx:217,232`(232는 interactive 유지). 헤더 행은 hover가 없어짐.

### UQ-720 [완료] 직접 만든 클릭 요소
- `src/components/career/career-overview.tsx:464` "내용을 입력해주세요" 버튼에 DS 포커스 링(`outline-none focus-visible:ring-2 ring-ring ring-offset-2`) 추가. muted 자리 글자 모양이 필요해 공통 컴포넌트로 바꾸지 않고 예외로 둠.
- 채팅 말풍선 버튼(`chat-screen.tsx:1020`)은 이미 포커스 링이 있어 코드 유지, 예외 목록에 추가.
- 문서 예외 목록: 채팅 말풍선, 빈 긴 글 자리 글자, 본문 텍스트 링크 허용(`docs/ui/design-system.md:442`)

### UQ-721 [완료] ProviderPick 이중 흐림 · bg-transparent
- `src/components/account/key-connect-flow.tsx:535` 멈춘 공급자는 Item으로 감싸지 않고 카드만 렌더(카드 자체 unavailable 상태만 보임, opacity 겹침 없음). 사용 가능한 공급자만 `Item`(onClick).
- `src/components/account/provider-card.tsx:217` `inButton`이면 프레임 바탕을 `bg-transparent`, 아니면 `bg-card`. 사용처 `className="bg-transparent"` 제거.

### UQ-722 [완료] row Item 모서리 넘침
- `src/components/ui/item.tsx:22` `row`: `[li:first-child>&]:rounded-t-[calc(var(--radius-md)-1px)]`, `[li:last-child>&]:rounded-b-[...]`. 목록에 `overflow-hidden`을 넣지 않아 포커스 링이 잘리지 않음. 사용처(`experience-form.tsx:251`, `education-form.tsx:207`) 변경 없음.
- 문서 2장 표 `row` 설명에 규칙 추가.

## 문서 (docs/ui/design-system.md)
- 2장 "색 덧씌우기 금지" 아래 v4 후속 variant 표 신설(`:417`), 클릭 가능한 항목 표의 Item·TableRow 행 갱신, 예외 목록 확장
- 인벤토리: button·badge·card·alert 행에 새 variant/prop
- 3.5 C-05, 3.6 C-06 갱신
- 8장 대비 메모를 측정값으로 교체
- 9장 v4 행에 후속 변경 요약 추가(`:1604`)

## 기계 검사

| 검사 | 결과 |
|------|------|
| `pnpm lint` | 통과 (경고 0) |
| `pnpm tsc --noEmit` | 통과 (exit 0) |
| `pnpm vitest run` | 통과 — 111 files / 1772 tests (수정한 테스트 없음) |
| `NEXT_PUBLIC_SUPABASE_URL=http://localhost NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy pnpm next build --experimental-build-mode=compile` | 통과 (exit 0) |
| dev 서버(:3000) `/career?state=default` | 200, 선택 행 `aria-current="true" data-slot="item"`, Item에 `data-active="false"` 없음 |

## 남은 것 · 확인 필요
- 브라우저로 직접 보지는 않음(정적 확인만). 특히 Alert 아이콘 색이 variant로 옮겨져 다른 warning/destructive Alert 아이콘도 색이 바뀌므로 화면 확인 권장.
- 다크 `--sidebar-accent` 대비(QA 4장 참고)는 이번 범위 밖.
