# 43 런 — frontend-engineer (A1 + 설정 다이얼로그 틀) 리포트

- 날짜: 2026-11-06 · 브랜치 `claude/epic-sutherland-f2c874` (커밋 안 함)
- 기준: 원본 화면 3장(`_workspace/ui/43_design/*.webp`, Read로 직접 확인) · `43_ui-designer_notes.md` 차이 표·5절 · design-system v5.12 5.11 · UX v5.17b (동작·데이터·문구는 42 런 그대로)

## 1. 바꾼 파일

| 파일 | 내용 |
|------|------|
| `src/app/globals.css` | `--radius-control: var(--control-radius, 12px)` (조상에서 바꿀 수 있게), 새 테마 색 `--color-tint` / `--color-tint-hover` = `color-mix(primary, var(--tint-strength, 10%))` / +5% — 기본값은 지금 `bg-primary/10`·`/15`와 같은 식(oklab)이라 앱 다른 화면 모습은 그대로 |
| `src/components/common/shell/settings-visual.ts` (새) | DR-13·DR-14 **한 곳**: `SETTINGS_CONTROL_RADIUS = "12px"`, `SETTINGS_TINT_STRENGTH = "10%"` → `SETTINGS_VISUAL_STYLE`(CSS 변수). `DialogContent`와 기간 칸 `PopoverContent`가 이 style을 받는다 |
| `src/components/ui/button.tsx` | `secondary` = `bg-tint hover:bg-tint-hover` (기본 결과 동일, 다이얼로그 안에서는 `--tint-strength`를 따름) |
| `src/components/ui/select.tsx` | `SelectTrigger variant="cell"` (h-7 전 폭, 테두리·바탕·화살표 없음, `chip`과 같은 덮어쓰기 방식) |
| `src/components/ui/tabs.tsx` | `TabsList variant="pill"` + 트리거 `group-data-[variant=pill]` 클래스 (선택 = `bg-tint` + `text-primary-text`, 밑줄 없음) |
| `src/components/ui/radio-group.tsx` | `RadioGroupItem size="lg"` (원 size-5, 점 size-2.5) |
| `src/components/ui/switch.tsx` | `Switch size="lg"` (h-7 w-12, 손잡이 size-6) |
| `src/components/common/shell/settings-dialog.tsx` | 틀 재작성 (아래 2.1) |
| `src/components/account/account-tab.tsx` · `sign-out-button.tsx` | 이메일 줄 6rem 열, 위험 구역 `destructive` 채움·아이콘 삭제, 스켈레톤 |
| `src/components/account/profile-basics-form.tsx` | `SettingsFieldRow`(새), 2열 배치, 쌍 행 재배치, 최종 학력 테두리 상자 + `PeriodCell`(새), [저장] 자리 |
| `src/components/account/profile-basics-model.ts` | `FIELD_ID.period` = `pb-period` (기간 칸 버튼 — 포커스 대상) |
| `src/components/account/provider-row.tsx` | 행 프레임·`ProviderRowGroup bordered` prop |
| `src/components/account/ai-connection-panel.tsx` | 블록 ① 머리+설명 줄, 라디오 `lg`·미연결 비활성 라디오, [연결]·[다시 확인] `secondary`, ⋯ `muted-ghost`, 스켈레톤 |
| `src/components/account/ai-usage-panel.tsx` | 고지 = 머리 설명 줄, 알약 탭 + 가격 안내 + 대시보드 `ArrowUpRight`, 표 모양, 가격표 버전 줄 + link "가격표 보기", 컨테이너 쿼리 |
| `src/components/account/key-connect-flow.tsx` | S-41만 `ProviderRowGroup bordered` |
| `src/components/account/policies-tab.tsx` | 상자 없는 행, [전문 확인] `secondary` 아이콘 없음, 동의 행 grid + `Switch size="lg"`, 원칙 줄 ⓘ 모양 |
| `src/components/account/feedback-tab.tsx` | `ExternalLink` → `ArrowUpRight size-4` |

라우트·컴포넌트 이름·`?state=` 값은 바꾸지 않았다(42 런 리포트 3절 그대로).

## 2. 차이 표 항목별 반영

### 2.1 틀 (1.1) — 전부 반영
| 항목 | 반영 |
|------|------|
| 크기 `md:max-w-[760px] lg:max-w-[min(1100px,calc(100vw-4rem))]`, 높이 `md:h-[min(760px,calc(100dvh-4rem))]` / 좁은 `h-[min(640px,85svh)]` | ✅ (높이는 `DialogContent`에, `flex flex-col gap-0`, `SidebarProvider min-h-0 flex-1`로 `min-h-svh` 덮음) |
| 전체 폭 머리 `h-16 border-b px-5`(좁은 `h-14 px-4`), 보이는 `DialogTitle` "설정", 이동 경로 제거 | ✅ |
| X: `showCloseButton={false}` + 머리 안 `DialogClose > Button muted-ghost icon-sm` + `X size-5`, aria-label "닫기" | ✅ — `onOpenChange(false)` → 기존 `runGuarded` 경로라 미저장 확인 그대로 |
| 탭 목록 13rem, `SidebarGroup p-3`, 아이콘 삭제, `h-10 text-sm`, 선택 `bg-sidebar-accent` | ✅ (`SETTINGS_TABS.icon` 필드는 남김, 그리지 않음) |
| 본문 `@container/settings px-5 pt-5 pb-6`(좁은 `px-4 pb-4`), 좁은 탭 줄 `pt-3` | ✅ |
| 섹션 머리 + 설명 줄 `div.space-y-0.5` | ✅ (내 정보·블록 ①·블록 ②) |

### 2.2 계정 탭 (1.2) — 전부 반영
- 이메일 `@md/settings:grid-cols-[6rem_minmax(0,1fr)]`, 라벨 `text-base text-muted-foreground` ✅
- `SettingsFieldRow` `@md/settings:grid-cols-[6rem_13rem]`, 라벨 회색 400, 칸 `h-8 w-full`(셀렉트 `data-[size=default]:h-8`), 줄 `gap-3` ✅
- 이름 · 구직 상태 단독 줄, **관심 기업군 | 관심 산업 한 줄**(`@3xl/settings:flex-row gap-x-11`) ✅
- 쌍 행: legend `sr-only`, 열 머리 줄 삭제, 1행 라벨 "관심 직군"·"관심 직무", 2행 라벨 칸 비움(`aria-label`은 그대로 "관심 직군 2" 등), [삭제] `muted-ghost icon-sm`, [+ 관심 직무 추가] `secondary sm` + 오류 줄 `@md/settings:pl-24` ✅
- 내 정보 안내 = 섹션 머리 설명 줄(아이콘 없음) ✅
- 최종 학력: 왼쪽 "최종 학력" `@md:pt-2`, 테두리 상자 `rounded-control border-input px-2.5 py-2`, 학교 명 `InputGroupInput h-7 font-semibold placeholder:font-semibold`, 아랫줄 `@3xl/settings:grid-cols-[3fr_2fr_3fr_3fr_2fr]` + 칸 ②~⑤ `before:` 세로 구분선(`h-4.5 w-px bg-muted-foreground/70`), 그 아래는 2열(기간 두 칸 폭). 학위·졸업 상태 `SelectTrigger variant="cell"`, 기간 `PeriodCell` ✅
- 칸 placeholder 6개 `[UI-가정]` P-27 + 각 칸 `aria-label`(학교 명·학위·졸업 상태·기간·전공·학점) ✅
- 칸 오류: 칸 `aria-invalid`(기간 버튼은 `data-invalid`) → 상자 `border-destructive`, 오류 문장은 상자 아래 칸 순서대로 + `aria-describedby` ✅. 학력 안내 ⓘ 줄 상자 아래 ✅
- [저장] 학력 상자 아래 오른쪽 `h-10`, `pt-1` ✅
- 위험 구역 `variant="destructive"` 채움 기본 크기, 아이콘 삭제, `gap-2` ✅ (`destructive-outline` 정의는 `button.tsx`에 남김 — 사용처 0)
- 스켈레톤: 라벨 `w-16` + 칸 `h-8 w-52` 5줄 + 학력 `h-[4.5rem]` ✅

### 2.3 AI 연결 탭 (1.3) — 전부 반영
- 블록 ① 설명 `text-sm`, `space-y-0.5`, 문구 UX 전체 ✅
- `ProviderRowGroup` 기본 `flex flex-col gap-1`(테두리 없음), S-41만 `bordered` ✅
- 행 `min-h-11 rounded-lg px-2 py-1.5 gap-2`, 활성 `bg-primary/10`, 라디오 칸 `size-8` + `RadioGroupItem size="lg"`, **미연결 행도 비활성 라디오** ✅
- 이름 `h4.w-28 text-base font-normal`, 플랜 안내 그대로, 동작 칸 `h-8` ✅
- [연결] 모두 `secondary sm`(일시 중지 disabled도 secondary), [다시 확인] `secondary`, ⋯ `muted-ghost` ✅
- 블록 ② 고지 = 머리 설명 줄(굵게 없음, 마침표 없음) ✅
- `TabsList variant="pill"` + 같은 줄 ⓘ 가격 안내 + `ml-auto` 대시보드 링크 `ArrowUpRight size-4` ✅
- 기간·무료 등급·빈 상태 줄 표 위 `space-y-1` ✅
- 표: `rounded-lg border` 감싸개, `table-fixed`, 머리 `bg-muted` `h-10 px-4 text-sm font-medium text-foreground`, 몸 `[&_tr]:border-0`, 셀 `px-4 py-1.5`(첫 행 `pt-3`, 끝 행 `pb-3`), 글자 `text-sm`, 숫자 왼쪽 정렬, 폭 20/18/22%, 정렬 버튼 `-ml-2` + 회색 `ArrowUpDown size-3.5` ✅. 머리 글자 "(USD)" · "$0.00" 두 열 · 토큰 둘째 줄 · 0행 전체 흐림은 UX 유지 ✅
- 가격표 버전 줄 + `link` "가격표 보기" 한 줄(표 아래), 기록 없으면 버전 줄 생략 ✅
- 표 ↔ 행 목록 전환을 뷰포트 `sm:` → 컨테이너 `@lg/settings:`(본문 512)로 ✅
- 안내 2줄 `space-y-1.5` ✅, 스켈레톤 행 `h-11` 3개 + 알약 `h-8 w-56` + 표 `h-64 rounded-lg` ✅

### 2.4 약관 탭 (1.4) — 전부 반영
- 섹션 `space-y-1`, 문서 `ul` 맨 몸 + 행 `h-12`, [전문 확인] `secondary sm` 아이콘 없음(aria-label "(새 탭)" 유지) ✅
- 동의 행 `grid min-h-12 grid-cols-[minmax(0,1fr)_auto] @2xl/settings:grid-cols-[11rem_minmax(0,1fr)_auto]`, 라벨 `font-semibold`, 설명 같은 줄(좁으면 아래), `Switch size="lg"` ✅
- 원칙 줄: 상자 삭제 → `ShieldCheck text-success` ⓘ 줄 + `link` [전문 확인] `ArrowUpRight` ✅

### 2.5 개선 요청 탭 (1.5) — 반영
- `ExternalLink` → `ArrowUpRight size-4`. 버튼은 원래 `size` 기본(`h-10`)이라 그대로 ✅

## 3. 화면과 다르게 둔 곳과 이유

| 곳 | 이유 |
|----|------|
| **모서리 12px**(화면 약 6~8px) | **사용자 확정** 2026-11-06 DR-13 — 브랜드 `rounded-control` 12px 유지. `settings-visual.ts` 한 곳에서 바꿀 수 있게 둠 |
| **연한 초록 채움 10%**(화면 약 20%) | **사용자 확정** 2026-11-06 DR-14 — `secondary` 10% 유지. 같은 파일 한 곳 |
| 위험 구역 버튼 빨강 채움 | SD-A7 (화면의 초록은 자리표시자) — 모양·크기·배치만 화면 |
| 이름·셀렉트 placeholder, "구직 상태" 띄어쓰기, 블록 ① 안내 끝 문장, 고지 끝 마침표, 표 머리 "(USD)"·통화 표기, 0행 흐림, 정렬 버튼 | UX v5.17b (디자이너 노트 2절 표 그대로) |
| [저장]·쌍 [삭제]·[+ 관심 직무 추가]·학력 안내 줄·상태 줄·배지·기간 줄·가격표 버전 줄·원칙 줄 | UX에 있는 요소라 유지 (자리만 화면에 맞춤) |
| 둘째 쌍 행에 직무 셀렉트도 있음 | UX 쌍 구조 — 라벨 칸만 비워 화면 모양을 따름 |
| 공급자 행 1행을 본문 ≥ 512에서도 줄바꿈 허용 | 디자인 시스템은 `@lg/settings:flex-nowrap`이지만, 상태 배지(“Gemini · 무료 등급 · 확인 필요” 등)가 붙으면 512~700 폭에서 넘친다. `flex-wrap`만 두어 넓은 폭에서는 한 줄(화면), 모자라면 줄바꿈 `[UI-가정]` |
| S-41 공급자 선택 행 | `inButton` 행은 이전 여백(`min-h-16 px-4 py-3`)을 유지하고 이름만 `w-28 font-normal`로 — S-41은 독립 화면이라 묶음 테두리와 함께 둔다 (DS 5.11.2) |
| 기간 칸 버튼 키보드 포커스 표시 | 셀 안에 테두리 변화가 없어(DR-1) 포커스 시 밑줄(`focus-visible:underline decoration-ring`)을 줌 `[UI-가정]` |

## 4. 동작 보존 확인 (코드 경로)
- **미저장 확인**: 머리 X = `DialogClose` → `onOpenChange(false)` → `onRequestClose` → `runGuarded`. Esc·바깥 누르기·탭 전환·[회원 탈퇴] 경로는 바꾸지 않았다.
- **오류 포커스**: 칸 id 그대로(`pb-name` 등). 기간은 `FIELD_ID.period`를 팝오버 안 연도 셀렉트(`pb-start-year`)에서 **`PeriodCell` 버튼(`pb-period`)**으로 바꿨다 — 검증 오류·`invalid_period` 모두 이 버튼으로 포커스하므로 닫힌 팝오버 안으로 포커스가 갈 일이 없다(팝오버를 열 필요 없음). 팝오버 안 셀렉트 id(`pb-start-year` 등)·aria-label은 그대로.
- **`details.field` / `sortOrder`**: 쌍 행 셀렉트 id `pb-job-family-{n}` / `pb-job-role-{n}`, `too_many` id·`aria-describedby` 그대로 → `pairRowOf`·포커스 로직 변경 없음.
- 연도만 고른 기간(`errors.period === true`): 상자 테두리 강조 + 팝오버 안 셀렉트 `aria-invalid` (문구 없음, UI42-2 그대로).

## 5. [UI-가정]
- 최종 학력 상자 안 placeholder 6개(학교 명 · 학위 · 졸업 상태 · yyyy.mm - yyyy.mm · 전공 · 학점) — 디자이너 채택 P-27, 코드에 표시
- 기간 칸 값 형식 "2015.03 - 2019.02", 한쪽만 있을 때 비어 있는 쪽 회색 "yyyy.mm", 연·월 중 하나만 있으면 "2015.mm" (G-81)
- 공급자 행 줄바꿈 규칙, 기간 칸 포커스 밑줄 (3절)

## 6. 기획 확인 필요
- P-27 (디자이너 노트 3절 그대로) — 새 항목 없음
- 참고: 학위·졸업 상태 칸의 `invalid_profile_option` 칸 문구 "목록에서 내려간 값이거나 고른 직군에 없는 직무예요"는 상자 아래로 가면 어느 칸인지 글자로 드러나지 않는다(테두리 강조 + `aria-describedby`로만 이어짐). 다른 칸 문구는 칸 이름을 담고 있다. 문구는 바꾸지 않았다.

## 7. 파운데이션·공통 변경 (알림)
- `globals.css`·`ui/button.tsx`·`ui/select.tsx`·`ui/tabs.tsx`·`ui/radio-group.tsx`·`ui/switch.tsx`를 고쳤다(브리프·디자이너 지시 범위). 새 variant/size는 기본값을 바꾸지 않는다. `secondary`·`rounded-control`의 계산 결과는 기본값에서 이전과 같다(빌드 CSS 확인: `.rounded-control{border-radius:var(--control-radius,12px)}`, `.bg-tint{… color-mix(in oklab, var(--primary) var(--tint-strength,10%), transparent)}`).
- 새 테마 색 이름 `tint`/`tint-hover`는 디자인 시스템에 아직 없다 — 디자이너가 2장/1.1에 "secondary·알약 채움 = primary × `--tint-strength`" 한 줄을 적어 주면 좋다.

## 8. 백엔드 요청
- 없음(데이터 계층·계약 변경 없음).

## 9. 검사 결과
- `pnpm typecheck` 통과 · `pnpm lint` 통과(경고 0) · `pnpm vitest run` 157 파일 2505 전부 통과 · `pnpm build` 통과
- 빌드 CSS에서 `@container settings (min-width: 28/32/42/48rem)`·`before:h-4.5` 생성 확인
- **브라우저 확인: 못 함** — Claude in Chrome에 연결된 브라우저가 없다(`list_connected_browsers` 빈 목록). 화면 3장과의 시각 대조는 QA가 브라우저에서 해야 한다.

## 10. QA-43 1라운드 수정 (`_workspace/ui/43_ui-qa_review.md`)

| 이슈 | 고친 것 |
|------|---------|
| QA-43-01 비활성 라디오 | `ui/radio-group.tsx` `size="lg"`에만 `disabled:not-data-checked:bg-muted disabled:not-data-checked:opacity-100`(다크 `bg-muted`) — 회색으로 채운 원 + `border-input` 테두리, 흐리게 하지 않음. 기본 크기 라디오의 disabled 모양은 그대로. 선택된 활성 행 라디오가 "다시 확인 중"에 disabled 될 때는 기존처럼 초록 + 50%(회색으로 바뀌지 않게 `not-data-checked`) |
| QA-43-02 학위·졸업 상태 칸 오류 | `ui/select.tsx` `cell` variant에 `aria-invalid:text-destructive underline decoration-destructive underline-offset-4`(placeholder 포함) — 오류 난 칸만 빨간 글자 + 밑줄. 상자 전체 빨간 테두리는 유지. 기간 칸 버튼도 같은 모양(`aria-invalid` 시 빨간 글자·밑줄). 문구는 그대로 |
| QA-43-03 연도만 고른 기간 (회귀) | `PeriodCell` 버튼에 `aria-invalid` + `aria-describedby="pb-period-error"`. 문구가 있으면 보이는 오류 줄, 연도·월 하나만 고른 경우(보이는 문구 없음, UI42-2)는 같은 id의 **sr-only 문장 "연도와 월을 함께 골라 주세요" `[UI-가정]`**. 버튼의 `aria-invalid`는 jsx-a11y `role-supports-aria-props`에 걸려 그 줄만 이유 주석과 함께 끔(DS 2078행이 `aria-invalid`로 적었고, 포커스가 가는 유일한 컨트롤). 상자 강조는 `data-invalid` 대신 `has-[[aria-invalid=true]]` 하나로. 순수 함수 `periodErrorA11y()` + `PERIOD_PARTIAL_SR_TEXT`를 `profile-basics-model.ts`로 빼고 테스트 1건 추가(`profile-basics-model.test.ts` — 부분 기간 = invalid + 설명 id + sr 문장, 역순 기간 = 보이는 문구, `FIELD_ID.period = "pb-period"`) |
| QA-43-04 첫 포커스 | `settings-dialog.tsx` `DialogContent onOpenAutoFocus` — 보이는 쪽 탭 목록(넓은 화면 왼쪽 목록 / 좁은 화면 탭 줄)의 `aria-current="page"` 버튼으로 포커스, `preventScroll`. 앵커·공급자 지정 열기의 스크롤은 탭 본문 쪽 effect라 그대로 |
| QA-43-05 오류 줄 폭 | `SettingsFieldRow` 오류 줄을 `@md/settings:w-max` + `max-w-[calc(100cqw-6rem)]`(칸 열 시작 ~ 본문 끝). 한 줄 두 쌍(본문 ≥ 768)에서는 새 prop `pairSide`로 왼쪽 쌍 `max-w-[20rem]`(오른쪽 쌍 칸 시작 전까지), 오른쪽 쌍 `max-w-[calc(100cqw-27.75rem)]`. 칸 배치는 그대로 |
| QP-43-1 (리더 판정 UX) | 사용량 머리 설명 줄의 첫 문장 "예상치이며 공급자 청구서가 아니에요."를 `font-medium text-foreground`로. 줄 모양(회색 `text-sm` 설명 줄)은 화면대로 |
| 정리 | `SETTINGS_TABS.icon` 필드·lucide import 제거(`settings-section-list.ts`). `destructive-outline` variant 정의 삭제(`button.tsx` — `src` 안 사용처 0 확인). 포털 요소: `settings-visual.ts` 주석에 "셀렉트 목록·⋯ 메뉴·AlertDialog·C-21 동의 창은 body로 포털되어 변수를 물려받지 않는다 — 값을 바꾸면 따라가지 않는다" 명시(값은 확정이라 style 전파는 하지 않음) |

`docs/ui/`는 건드리지 않았다(QA-43-06은 리더 담당). 디자인 시스템이 아직 `destructive-outline`을 "남겨 둔다"고 적고 있으면 지운 사실을 반영해 주면 된다.

검사: `pnpm typecheck` 통과 · `pnpm lint` 통과(경고 0) · `pnpm vitest run` 157 파일 **2506** 통과(새 테스트 1) · `pnpm build` 통과. 빌드 CSS에서 `max-w-[calc(100cqw-6rem)]`·`not-data-checked:bg-muted` 생성 확인. 브라우저 확인은 여전히 못 함(연결된 Chrome 없음).
