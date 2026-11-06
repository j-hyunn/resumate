# UI QA — 43 런 설정 다이얼로그 원본 화면 맞춤 (라운드 1)

- 날짜: 2026-11-06 · 브랜치 `claude/epic-sutherland-f2c874` (커밋 안 함, 코드 수정 없음)
- 범위: S-24 틀 · ① 계정 · ② AI 연결(S-40·S-42) · ③ 약관 · ④ 개선 요청, 공통 primitive 변경(`ui/{button,select,tabs,radio-group,switch}.tsx`, `globals.css`), S-41 공급자 선택 행
- 기준: 원본 화면 3장(`_workspace/ui/43_design/*.webp`, Read로 직접 열어 대조, 비활성 라디오는 확대 크롭으로 확인) · 브리프 원칙 표 · `43_ui-designer_notes.md` 1장 차이 표·5절 · design-system v5.12 5.11 · UX v5.17b(02-user-flows 1786~1965행) · 42 런 QA
- **브라우저 확인(Q12): 미확인** — Chrome 확장 미연결, 사용자도 이번 런은 건너뛰기로 함. 아래 판정은 모두 코드·클래스 ↔ 화면 이미지 대조다. DR-13(모서리 12px)·DR-14(틴트 10%)는 사용자 확정이라 이슈로 보지 않았다.

## 요약

- **Critical 0 / Major 0 / Minor 6**
- 디자이너 차이 표 1.1~1.5의 모든 "맞출 값" 행이 코드에 반영됐다(아래 행별 판정). 엔지니어가 화면과 다르게 둔 3곳은 모두 타당 — 다만 두 곳이 디자인 시스템 본문과 어긋난 채로 남았다(QA-43-06).
- 42 런 동작 회귀 없음: 미저장 확인 경로(머리 X 포함)·오류 포커스(기간 → `pb-period` 버튼)·쌍 `sortOrder`/`job_role` 포커스·`?state=` 미리보기·옛 섹션 ID·S-41 `bordered` 모두 코드상 그대로. 단 기간 칸이 버튼 하나로 바뀌면서 "연도만 고른" 오류가 화면 낭독기에 전달되지 않게 됐다(QA-43-03).
- 공통 컴포넌트 기본값 변화 없음: 빌드 CSS에서 `.bg-tint` = `color-mix(in oklab, var(--primary) var(--tint-strength,10%), transparent)` ↔ `.bg-primary\/10` = `color-mix(in oklab, var(--primary) 10%, transparent)`(같은 `@supports` 폴백 구조), `.rounded-control{border-radius:var(--control-radius,12px)}`. 새 variant/size는 지정한 곳에서만 쓰인다. `settings-visual.ts` 상수는 `settings-dialog.tsx:271`·`profile-basics-form.tsx:775` 두 곳에서만 쓰인다.
- 기계 검사: typecheck 통과 · lint 통과(경고 0) · vitest 157 파일 2505 통과 · build 통과

## 화면별 점검표

| 화면 | 화면 대조 | 문구 | 회귀 | 공통 파급 | 접근성 | 좁은 화면(코드) | Q12 |
|------|-----------|------|------|-----------|--------|-----------------|-----|
| S-24 틀 | ✅ | ✅ | ✅ | ✅ | ⚠️ QA-43-04 | ✅ | 미확인 |
| S-24 ① 계정 | ✅ (UX 유지 요소 제외) | ✅ (`[UI-가정]` P-27 표시) | ⚠️ QA-43-03 | ✅ | ⚠️ QA-43-02·03 | ⚠️ QA-43-05 | 미확인 |
| S-24 ② AI 연결 | ⚠️ QA-43-01 | ✅ (QP-43-1) | ✅ | ✅ | ✅ | ✅ | 미확인 |
| S-24 ③ 약관 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 미확인 |
| S-24 ④ 개선 요청 | ✅ (화면 없음) | ✅ | ✅ | ✅ | ✅ | ✅ | 미확인 |
| S-41 공급자 선택 | — | ✅ | ✅ (`bordered`, 행 여백 유지) | ✅ | ✅ | — | 미확인 |

## 이슈

| ID | 심각도 | 화면 | 무엇 | 근거 | 권고 |
|----|--------|------|------|------|------|
| QA-43-01 | Minor | S-24 ② | **미연결 공급자 행의 비활성 라디오가 화면과 다르게 거의 보이지 않는다.** 화면(GPT·Claude 행)은 연한 회색으로 **채운** 원 + 옅은 테두리. 구현은 `RadioGroupItem size="lg" disabled` = 투명 바탕(라이트) + `border-input`(#E2E2E2) + `disabled:opacity-50` → 흰 바탕 위 1px 매우 옅은 고리. 디자인 시스템 5.11.2(2125행)도 "화면처럼 회색 빈 원이 보인다"라고 적었는데 지금 클래스로는 그렇게 그려지지 않는다 | 화면 `ai-connection.webp` (595~620, 485~575 영역) ↔ `src/components/ui/radio-group.tsx:33-34`, `src/components/account/ai-connection-panel.tsx:427-433`, design-system 5.11.2 | 담당 **foundation(radio-group) + ui-designer**: `size="lg"`의 비활성 모양을 정해 primitive에 넣는다(예: `disabled:bg-muted disabled:opacity-100` + `border-input`). 사용처 색 덧씌우기 금지 규칙대로 primitive에서 |
| QA-43-02 | Minor | S-24 ① 최종 학력 | **학위·졸업 상태 칸 오류가 어느 칸인지 보이지 않는다** (엔지니어 지적 판정: 타당한 지적). `invalid_profile_option` 문구 "목록에서 내려간 값이거나 고른 직군에 없는 직무예요"는 칸 이름이 없고 상자 아래에 놓인다. 칸 자체에도 표시가 없다 — `cell` 트리거는 `border-0` + `aria-invalid:ring-0`라 상자 테두리 전체만 빨개진다. 다른 칸 문구(학교 명·전공·학점 길이)는 칸 이름을 담고 있어 문제없다. 화면 낭독기는 `aria-invalid` + `aria-describedby`로 칸과 이어져 문제없음 → **시각 사용자만** 해당 | `src/components/account/profile-basics-form.tsx:218-222, 677-700, 715-716`, `src/components/ui/select.tsx:39` ↔ UX 1810행 "문제가 된 칸으로 포커스", design-system 5.11.1 2086행 | 담당 **frontend (A1)**: 문구는 두고 칸 단위 시각 표시를 더한다(예: 오류 칸의 값·placeholder `text-destructive`, 또는 칸 밑줄). 문구에 칸 이름을 붙이려면 기획 확인(QP-43-2) |
| QA-43-03 | Minor | S-24 ① 기간 칸 | **"연도만 고른 기간" 오류가 화면 낭독기에 전달되지 않는다** (42 런 대비 회귀). 저장 시 검증이 `errors.period = true`(문구 없음, UI42-2)를 내면 포커스가 `PeriodCell` 버튼으로 가지만, 버튼에는 `data-invalid`만 있고(`aria-invalid` 없음 — jsx-a11y) 문구가 없으니 `aria-describedby`도 비어 있다. 42 런은 보이는 연월 셀렉트 자체에 `aria-invalid`가 있었다(지금은 닫힌 팝오버 안). 디자인 시스템 2078행은 버튼에 `aria-invalid`를 적었다 | `src/components/account/profile-basics-form.tsx:201` (model `validate`) · `754-761` ↔ design-system 5.11.1 2076-2085행, UX v5.17b UI42-2 | 담당 **frontend (A1)**: `error === true`일 때 sr-only 설명(예: "연도와 월을 함께 골라 주세요" `[UI-가정]` 또는 기존 문구 재사용)을 `aria-describedby`로 잇거나 접근 이름에 상태를 붙인다. 보이는 문구는 그대로 두면 UI42-2와 충돌 없음. DS 2078행의 `aria-invalid`도 실제(`data-invalid`)에 맞춰 고친다(ui-designer) |
| QA-43-04 | Minor | S-24 틀 | **다이얼로그를 열면 첫 포커스가 머리 X(닫기)로 간다.** 머리가 `DialogContent` 직속 첫 요소가 되면서 Radix 기본 `onOpenAutoFocus`(첫 tabbable)가 "닫기" 버튼을 잡는다. 42 런은 첫 탭 버튼("계정")이었다. Enter/Space 한 번이면 닫힘(미저장 없으면 즉시) — 키보드 사용자가 열자마자 닫기 쉬움. 코드상 판정, 브라우저 미확인 | `src/components/common/shell/settings-dialog.tsx:269-281` | 담당 **frontend (A1, 틀)**: `onOpenAutoFocus`에서 선택된 탭 버튼(`aria-current="page"`) 또는 `#settings-body`로 포커스(앵커·공급자 지정 열기 경로는 기존 스크롤·포커스 우선) |
| QA-43-05 | Minor | S-24 ① (본문 ≥ 448) | **칸 오류 줄이 13rem 칸 열 안에 갇혀 여러 줄로 접힌다.** `SettingsFieldRow`가 `grid-cols-[6rem_13rem]` 두 열뿐이고 오류 줄이 `col-start-2`라 폭 208px − 아이콘. 예: 관심 산업 `invalid_profile_option` 문구(약 26자)는 3줄, "이름은 50자까지 쓸 수 있어요"도 2줄 | `src/components/account/profile-basics-form.tsx:424-438` | 담당 **frontend (A1)**: 오류 줄만 칸 열 시작에서 본문 끝까지 쓰게(예: 세 번째 열 `minmax(0,1fr)` + 오류 줄 `col-span-2`, 또는 오류 줄 `w-max max-w-[…]`). 칸 배치는 그대로 |
| QA-43-06 | Minor (문서) | S-24 ② · ① | **엔지니어 편차 2건이 디자인 시스템 본문과 어긋난 채 남음** (편차 자체는 타당): ① 공급자 1행 — DS 5.11.2 2128행 `@lg/settings:flex-nowrap` ↔ 코드 `flex-wrap`만(배지가 붙으면 512~700 폭에서 넘침) ② 기간 칸 포커스 표시 — DS 2078행 버튼 클래스는 `outline-none`뿐 ↔ 코드 `focus-visible:underline decoration-ring underline-offset-4`(버튼은 DR-1 예외 대상이 아니어서 A-3상 보이는 포커스가 필요 — 밑줄은 링보다 약하지만 수용) | `src/components/account/provider-row.tsx:252`, `profile-basics-form.tsx:761` ↔ design-system 2076-2078·2128행 | 담당 **ui-designer**: DS 5.11.1·5.11.2와 8.2(G-79·G-81 또는 새 G)에 두 편차를 반영 |

### 엔지니어가 화면과 다르게 둔 3곳 판정

| 곳 | 판정 |
|----|------|
| 공급자 행 1행 줄바꿈 허용 | **타당.** UX가 남긴 상태 배지·추천 배지(화면에는 없음)가 1행에 붙으므로 nowrap이면 넘친다. 넓은 폭에서는 한 줄이라 화면과 같다. DS 반영만 필요(QA-43-06) |
| S-41 행 여백 유지(`min-h-16 px-4 py-3`) | **타당.** S-41은 독립 화면이고 DS 2160행이 "묶음 테두리는 S-41에서만 유지, 이름 열 `w-28`·보통 굵기는 같다"고만 정했다. `inButton` 분기라 S-40 행에 새지 않는다(`provider-row.tsx:226-229`). `active`는 S-41에서 넘기지 않아 색 변경(`bg-primary-subtle/40` → `bg-primary/10`)의 영향 없음 |
| 기간 칸 포커스 밑줄 | **타당**(버튼이라 보이는 포커스가 있어야 한다, A-3). 상자 안 다른 칸(글자 칸·셀 셀렉트)은 DR-1대로 포커스 표시가 없어 칸끼리 일관되지는 않지만 앱 전체 결정(DR-1)을 따른 결과다. DS 반영만 필요(QA-43-06) |

## 디자이너 차이 표 행별 판정

✅ = 맞춤 값대로 구현 / ★ = 기획 유지(맞음) / ⚠️ = 이슈

### 1.1 틀
| 행 | 판정 | 근거 |
|----|------|------|
| 다이얼로그 크기·높이 | ✅ | `settings-dialog.tsx:272` (`flex flex-col gap-0`, 좁은 `h-[min(640px,85svh)]`, `md:h-[min(760px,…)]`, `lg:max-w-[min(1100px,…)]`) |
| 모서리·그림자 | ✅ 그대로 | `DialogContent` 기본 |
| 머리 위치(전체 폭) · 내용("설정" 보이는 제목, 이동 경로 삭제) | ✅ | `:274-275`, Breadcrumb import 삭제 |
| 머리 X | ✅ | `:270` `showCloseButton={false}`, `:276-280` `DialogClose > Button muted-ghost icon-sm` + `X size-5` + "닫기" |
| 머리 높이·구분선 | ✅ | `h-14 … md:h-16 border-b px-4 md:px-5` |
| 탭 목록 폭 13rem · 바탕 · `p-3` | ✅ | `:287`, `:291` (화면 탭 목록 약 213px ≈ 13rem) |
| 탭 아이콘 삭제 · `h-10 text-sm` · 선택 = `bg-sidebar-accent` + `--primary-text` | ✅ | `:296-306`, `globals.css:95-96` |
| 본문 여백 `px-5 pt-5 pb-6` + `@container/settings` | ✅ | `:336` (좁은 화면 `pt-0` — 위 탭 줄이 `pb-3`) |
| 섹션 머리 + 설명 줄 `space-y-0.5` | ✅ | 내 정보 `profile-basics-form.tsx:278-285`, 블록 ① `ai-connection-panel.tsx:382-387`, 블록 ② `ai-usage-panel.tsx:73-80` |
| 좁은 화면 탭 줄 `pt-3` | ✅ | `:317` |

### 1.2 계정 탭
| 행 | 판정 | 근거 |
|----|------|------|
| 이메일 줄 6rem 열 · 회색 라벨 | ✅ | `account-tab.tsx` dl `@md/settings:grid-cols-[6rem_minmax(0,1fr)]` |
| 라벨-입력 배치 · 라벨 열 6rem · 칸 h-8 w-52 · 줄 gap-3 | ✅ | `SettingsFieldRow` `profile-basics-form.tsx:424-438`, `FIELD_CONTROL` `:400`, form `gap-3` `:326` (화면 셀렉트 폭 약 212px ≈ 13rem) |
| 입력 모서리 12 · 테두리 | ✅ DR-13 확정 | — |
| 2열 배치(관심 기업군 \| 관심 산업, 쌍 행 한 줄) | ✅ | `PAIR_LINE` `:402` (`@3xl gap-x-11` → 둘째 라벨 x ≈ 348px, 화면 약 351px) |
| 쌍 행 머리(legend `sr-only`, 열 머리 삭제, 1행 라벨) | ✅ | `:536`, `:546`, `:559` |
| 둘째 직군 셀렉트(쌍 구조 유지, 라벨 칸 비움) | ★ | `:546`·`:559` `label={n===1 ? … : null}`, 빈 칸 `aria-hidden` |
| [삭제] `muted-ghost icon-sm` · [+ 관심 직무 추가] `secondary sm` `pl-24` | ★ ✅ | `:572-590`, `:598-612` |
| placeholder(이름·셀렉트) · "구직 상태" | ★ | `:332`, `OptionSelect` 기본 "선택해 주세요", `LABELS.jobSearchStatus` |
| 내 정보 안내 줄(아이콘 없음) | ★ ✅ | `:282-284` |
| 최종 학력 라벨 왼쪽 열 `pt-2` | ✅ | `:665` |
| 최종 학력 테두리 상자 · 굵은 학교 명 · 다섯 칸 `3fr_2fr_3fr_3fr_2fr` · 구분선 `h-4.5 w-px bg-muted-foreground/70` · `cell` 셀렉트 · `PeriodCell` | ✅ | `:669-711`, `EDU_CELL_DIVIDER` `:629-630` (화면 칸 비율 222:139:236:236:126px ≈ 3:2:3:3:2, 구분선 뒤 글자 들여쓰기 약 11px ≈ `pl-3`) |
| 학력 칸 placeholder 칸 이름 + `aria-label` | ✅ `[UI-가정]` P-27 표시 | `:657-658`, `:680-681`, `:693-694`, `:757`, `:763` |
| 학력 안내 줄 상자 아래 | ★ ✅ | `:720-723` |
| [저장] 학력 아래 오른쪽 `h-10` `pt-1` | ★ ✅ | `:887-900` |
| 위험 구역 `destructive` 채움 기본 크기 · 아이콘 없음 · `gap-2` | ★ ✅ (색 SD-A7) | `account-tab.tsx` DangerZone, `sign-out-button.tsx:21-36`. `destructive-outline` 사용처 0(정의만 남음) |
| (칸 오류 표시) | ⚠️ QA-43-02 · QA-43-05 | — |

### 1.3 AI 연결 탭
| 행 | 판정 | 근거 |
|----|------|------|
| 블록 ① 설명 `text-sm` · 문구 UX 전체 | ✅ ★ | `ai-connection-panel.tsx:386` |
| 행 묶음 테두리 삭제 · 행 사이 4px | ✅ | `provider-row.tsx` `ProviderRowGroup` 기본 `flex flex-col gap-1` |
| 행 크기 · 모서리 · 활성 `bg-primary/10` | ✅ | `provider-row.tsx:227-229` |
| 라디오 `size="lg"` · 미연결 비활성 라디오 표시 | ✅ / ⚠️ 모양 QA-43-01 | `ai-connection-panel.tsx:427-433`, `selectable` `:413` |
| 이름 `w-28 font-normal` · 플랜 안내 | ✅ | `provider-row.tsx:252-254` (이름 열 + gap 124px vs 화면 약 115px — 차이 미미) |
| ⋯ `muted-ghost` · [연결] 모두 `secondary sm` · [다시 확인] `secondary` | ✅ | `ai-connection-panel.tsx:609-642` |
| 상태 줄·배지·추천 배지 | ★ | 유지 |
| 블록 ② 고지 = 머리 설명 줄(굵게 없음, 마침표 없음) | ✅ (굵게는 QP-43-1) | `ai-usage-panel.tsx:73-80` |
| 공급자 알약 `TabsList variant="pill"` | ✅ | `ai-usage-panel.tsx:141`, `tabs.tsx` pill (선택 = `bg-tint` + `text-primary-text`, group 선택자 특이도가 기본 `data-active:bg-background`를 이김) |
| 가격 안내 알약 줄로 · 대시보드 `ArrowUpRight` `ml-auto` | ✅ | `ai-usage-panel.tsx:148-158` |
| 기간·무료 등급·빈 상태 줄 | ★ | `:164-179` |
| 표 바깥 `rounded-lg border` · 머리 `bg-muted` · 행 구분선 없음 · `text-sm` · 숫자 왼쪽 · `table-fixed` 20/18/22% | ✅ | `:222-247`, `CostCell` `items-start` |
| 머리 글자 "(USD)" · 두 비용 열 `$0.00` · 0행 흐림 · 정렬 버튼 | ★ | `:228-230`, `TableRow muted` |
| 표 위·아래 여백(첫 행 `pt-3`, 끝 행 `pb-3`) | ✅ | `cell()` `:219-220` |
| 가격표 버전 줄 + `link` "가격표 보기" | ★ ✅ | `PriceInfo` |
| 표 ↔ 행 목록 `@lg/settings` | ✅ | (md 다이얼로그 본문 = 760−208−40 = 512 → 표) |
| 안내 2줄 `space-y-1.5` | ✅ | `:108` |

### 1.4 약관 탭
| 행 | 판정 | 근거 |
|----|------|------|
| "Resumate 약관" 머리 · 섹션 `space-y-1` | ✅ | `policies-tab.tsx` |
| 문서 행 상자 없음 `h-12` · [전문 확인] `secondary sm` 아이콘 없음 · aria-label "(새 탭)" 유지 | ✅ | 문서 `ul` |
| 동의 행 grid `@2xl:[11rem_1fr_auto]` · 라벨 `font-semibold` · 같은 줄 설명 · `Switch size="lg"` | ✅ | `OptionalConsents` (라벨 "기능 업데이트, 소식 받기" 화면 약 165px < 11rem, 설명 시작 x 화면 약 180px ≈ 176+12) |
| AI 데이터 처리 원칙 줄 상자 삭제 → ShieldCheck 줄 + link [전문 확인] ↗ | ★ ✅ | 원칙 줄 |

UX 1854행은 "각 토글 **아래** 현행 설명 한 줄"이지만 같은 줄 배치는 시각(브리프 원칙: 시각은 화면)이라 판정 ✅. 좁은 본문(< 672)에서는 설명이 라벨 아래로 내려가 UX 문장과도 맞다.

### 1.5 개선 요청 탭
| 행 | 판정 | 근거 |
|----|------|------|
| `ExternalLink` → `ArrowUpRight size-4` · 버튼 크기 그대로 | ✅ | `feedback-tab.tsx` |

### 디자이너 표가 놓친 화면 차이
- 비활성 라디오의 **채움 색**(화면 = 회색 채운 원) — 표는 "미선택 = 회색 채운 빈 원"이라고 적었지만 맞출 값이 `size="lg"` + `disabled`뿐이라 채움이 빠졌다 → QA-43-01.
- 그 밖에 틀 머리·탭 목록·라벨 격자·2열·학력 상자·위험 구역 배치·공급자 행·알약 탭·표·약관 행·동의 행에서 표에 없는 차이는 찾지 못했다(위치 환산 1.3px ≈ 1 CSS px로 주요 x 좌표 6곳 대조).

## 회귀 (42 런 동작)

| 동작 | 결과 | 근거 |
|------|------|------|
| 미저장 확인 — 머리 X | ✅ | `DialogClose` → `onOpenChange(false)` → `onRequestClose` → `runGuarded` (`settings-dialog.tsx:196, 267, 276`) |
| 미저장 확인 — Esc·바깥·탭 전환·열린 상태 `openSettings`·회원 탈퇴 | ✅ 변경 없음 | `:162-170`, `:199-205`, `account-tab.tsx` `useGuardedAction` |
| 로그아웃은 확인 없음 | ✅ | `sign-out-button.tsx` (guard 미사용) |
| 오류 포커스 6종 — 검증 첫 칸·`stale_write`·`invalid_profile_option`(칸/쌍)·`field_too_long`·`invalid_period`·`duplicate_job_interest`·`too_many` | ✅ | `profile-basics-form.tsx:175-257`. `FIELD_ID.period` = `pb-period`(`profile-basics-model.ts:51`) = `PeriodCell` 버튼 id(`:755`) — 검증 오류·`invalid_period` 모두 닫힌 팝오버가 아니라 늘 있는 버튼으로 간다 |
| 연도만 고른 기간 | ⚠️ QA-43-03 (시각 표시는 상자 테두리로 유지) | — |
| 쌍 `details.sortOrder` / `job_role` 포커스 | ✅ | `pairRowOf`·`sentPairRows` 그대로, id `pb-job-family-{n}`/`pb-job-role-{n}` 그대로 (`:52-53, 225-227, 243-245`) |
| `?state=` 미리보기 | ✅ 변경 없음 | `previewSaveResult`, 각 탭 `preview` prop 그대로 |
| 옛 섹션 ID 링크 | ✅ | `settings-section-list` 미변경, `SETTINGS_ANCHORS.dangerZone`·`aiUsage` 그대로 사용 |
| S-41 `bordered` | ✅ | `key-connect-flow.tsx:510`, `ProviderRowGroup bordered` = 이전 클래스 그대로 |

## 공통 컴포넌트 변경의 파급

| 변경 | 다른 화면 사용처 | 결과 |
|------|------------------|------|
| `button` `secondary` → `bg-tint`/`hover:bg-tint-hover` | `page-shell.tsx:503`(뒤로 버튼), `message-scroller.tsx:89`(기본 variant), 설정 좁은 탭 줄 | 계산값 동일(빌드 CSS 확인, 위 요약). 변화 없음 |
| `globals.css` `--radius-control: var(--control-radius, 12px)` | 앱 전체 `rounded-control` | `--control-radius`를 정하는 곳은 설정 다이얼로그·기간 팝오버 두 곳뿐, 값 12px → 변화 없음 |
| `select` `variant="cell"` | 학력 상자 2곳만 | 기본·`chip` 분기 그대로 |
| `tabs` `variant="pill"` | `ai-usage-panel.tsx:141`만 | 트리거 pill 클래스는 `group-data-[variant=pill]` 접두라 `default`/`line`(보드 `kanban-board.tsx:278` 등)에 적용 안 됨 |
| `radio-group` `size` | 기본 `default` → 원 `size-4`·Indicator `size-4`·점 `size-2` 그대로. `lg`는 `ai-connection-panel.tsx`만 | 다른 사용처 7곳(`add-project-dialog`, `affiliation-dialog`, `delete-confirm-dialog`, `drafts-view` ×3, `interview-prep`, `key-connect-flow`) 변화 없음 |
| `switch` `size` | 기본 `h-[1.15rem] w-8`·손잡이 `size-4` 그대로. `lg`는 `policies-tab.tsx`만 | `nav-user.tsx:82` 변화 없음. `lg` 손잡이 이동 22px = 안쪽 46 − 24 ✓ |
| `settings-visual.ts` | `settings-dialog.tsx:271`, `profile-basics-form.tsx:775`만 | 다이얼로그 밖으로 새지 않음 |

## 접근성 (코드상)

- 학력 상자: `role="group" aria-labelledby="pb-edu-label"`, 여섯 칸 모두 `aria-label`(학교 명·학위·졸업 상태·기간·전공·학점) ✓. 키보드 순서 = DOM 순서 학교 명 → 학위 → 졸업 상태 → 기간 → 전공 → 학점 ✓(DS 2087행).
- `PeriodCell`: 버튼 + Radix Popover — Enter/Space로 열림, 안의 첫 셀렉트로 포커스, Esc로 닫으면 버튼으로 복귀(Radix 기본), 팝오버 Esc는 다이얼로그를 닫지 않음(레이어 스택). 팝오버 끝에서 Tab으로 빠져나갈 때의 위치는 **브라우저로 확인 필요**(비모달 팝오버가 다이얼로그 포커스 범위를 잠시 멈춘다).
- 비활성 라디오: Radix 롤링 포커스가 건너뛴다, 각 행에 [연결] 버튼이 있어 동작 경로 있음 ✓. 조사 "Gemini를/GPT를/Claude를" ✓.
- 라벨 없는 칸의 오류 연결: 모든 칸 `aria-describedby="{id}-error"` ✓(기간은 문구가 있을 때만 → QA-43-03). 시각 식별 → QA-43-02.
- 첫 포커스 → QA-43-04.

## 문구 (UX v5.17b 대조)

- 탭 이름·섹션 머리·검증 문구·저장 오류·빈 상태·블록 ① 안내(UI42-4 정본)·블록 ② 고지(마침표 없음)·가격 안내·대시보드 "{공급자} 대시보드 ↗"·표 머리 "(USD)"·표 아래 안내 2줄·약관 문서 4개·선택 동의 라벨·원칙 줄 두 문장 — 모두 02-user-flows 1794~1863행과 글자 그대로.
- `[UI-가정]` 표시: 학력 상자 placeholder 6개(`profile-basics-form.tsx:657` "P-27" 주석, `:763`, `HighestEducationFields` 머리 주석) ✓, 기간 값 형식·"(N년 N개월)" 생략(G-81 주석 `:730-733`) ✓.
- 강조 차이는 기획 확인으로 넘김(QP-43-1).

## 기획 확인 필요

| # | 화면 | 내용 (양쪽 인용) |
|---|------|------------------|
| QP-43-1 | S-24 ② / S-42 | 상시 고지 강조: UX 1837·1956행은 "**예상치이며 공급자 청구서가 아니에요.** 실제 청구는…"으로 첫 문장을 굵게 적었다(F-AI-07 (4) 필수 고지). 43 런은 화면을 따라 `Alert` 상자 → 머리 아래 회색 `text-sm` 설명 줄로 바꾸고 굵게를 뗐다(`[UI-가정]` G-76, `ai-usage-panel.tsx:77-79`). 문구는 같지만 필수 고지의 눈에 띄는 정도가 크게 줄었다 — 굵게(UX)를 문구의 일부로 볼지, 시각(화면)으로 볼지 |
| QP-43-2 | S-24 ① | P-27(디자이너 노트 3절) 그대로 + QA-43-02 관련: 학력 상자 안 학위·졸업 상태의 `invalid_profile_option` 문구에 칸 이름을 붙일지(예: "학위: 목록에서 내려간 값이에요") — 지금 UX 문구는 직군·직무 쌍과 공용이라 칸 이름이 없다 |

## 재확인 결과

첫 라운드 — 해당 없음. (42 런 이슈 QA-42-01~07은 이 런 범위 밖. 다만 QA-42-07 처리 코드 `profile-basics-form.tsx:248-252`·`:534`·`:615`는 이번 재배치 뒤에도 그대로 남아 있음 확인)

## 기계 검사 출력

| 검사 | 결과 |
|------|------|
| `pnpm typecheck` (`next typegen && tsc --noEmit`) | 통과 (EXIT 0) |
| `pnpm lint` (`eslint`) | 통과, 경고·오류 0 (EXIT 0) |
| `pnpm vitest run` | Test Files 157 passed · Tests 2505 passed (EXIT 0) |
| `pnpm build` | 통과 (EXIT 0) |

## 참고 (이슈 아님)

- `SETTINGS_TABS[].icon` 필드는 더 이상 그리지 않는다(남겨 둔 것은 리포트대로). `button.tsx` `destructive-outline`은 사용처 0 — 정의만 남음.
- `SETTINGS_VISUAL_STYLE`은 다이얼로그 본체와 기간 팝오버에만 걸린다. 다이얼로그 안에서 포털로 여는 요소(셀렉트 목록, ⋯ 메뉴, 미저장 확인 AlertDialog의 버튼)는 받지 않는다. 지금은 값이 기본값(12px·10%)과 같아 차이가 없지만, DR-13·DR-14 값을 바꾸면 그 요소들만 옛 값으로 남는다 — 바꿀 때 함께 처리할 것(`settings-visual.ts` 주석에 한 줄 적어 두면 좋다).
- 화면 1:1 배치(한 줄 두 쌍·학력 다섯 칸)는 본문 ≥ 768, 즉 뷰포트 약 1080px 이상에서만 나온다(그 아래는 컨테이너 쿼리로 두 줄). 설계대로다.
