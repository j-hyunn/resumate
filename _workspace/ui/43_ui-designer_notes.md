# 43 런 — ui-designer 노트 (설정 다이얼로그를 원본 화면 3장에 맞추기)

- 날짜: 2026-11-06
- 산출물: `docs/ui/design-system.md` **v5.11 → v5.12** (5.11 시각 재작성, 2장 인벤토리, 8.2 G-75~G-81, 8.4 P-22~P-26 해소 표시 + P-27, 8.5 DR-13·DR-14, 9 변경 이력)
- 입력: 브리프 `_workspace/ui/43_brief_settings-dialog-design.md`, 원본 화면 `_workspace/ui/43_design/{account,ai-connection,policies}.webp`(Read로 직접 열어 봄 + PIL로 픽셀 측정), 디자인 시스템 v5.11 5.11, `_workspace/ui/42_ui-designer_notes.md`, 구현 `settings-dialog.tsx`·`account/*`(읽기만), UX v5.17b S-24 ①~④·S-40·S-42, decisions UI42-1~8
- Figma: 노드 없음(브리프대로). 이미지 3장만 시각 원천이다. **읽지 못한 것**: 위험 구역 버튼 안 흰 글자 크기(초록 위 흰 글자라 측정이 흐림 — 너비로 `text-sm`~`text-base` 추정), 다크 모드 모습(화면은 라이트만).

## 0. 측정 방법과 환산

- 이미지 2000×1444, 다이얼로그 1444×1000px. 같은 문자열의 폭(한글 2자 ≈ 35px, 이메일 값 218px)과 Latin 대문자 높이로 글자 크기를 역산했다. 라벨·이메일 값 = 본문 16px로 두면 **화면 1.3px ≈ 1 CSS px**(1.26~1.33 범위). 모든 크기는 이 환산 뒤 **가장 가까운 기존 토큰**으로 옮겼다.
- 글자 크기는 세 단계로 갈린다: ① 16px — 라벨·값·문서 이름·공급자 이름·섹션 머리(굵게)·제목(굵게)·동의 라벨(굵게) ② 14px — 탭 이름·표 글자·알약·플랜 안내·설명 줄·안내 줄·버튼 글자 ③ 12px — (화면에 없음, 토큰 수 보조 표기에만 씀).
- 색(sRGB 표본): 탭 목록 바탕 `#F3FAF8`(= `--sidebar`), 선택 탭 알약 = primary 10% over sidebar(= `--sidebar-accent`), 활성 공급자 행 = primary 10% over 흰색(`bg-primary/10`), [연결]·[전문 확인]·사용량 알약 ≈ primary 20%(DR-14), 초록 글자 ≈ `#187E57`(≈ `--primary-text`), 회색 글자 `#727272`(≈ `--muted-foreground`), 테두리 `#E2E2E2`(= `--border`/`--input`), 표 머리 `#F2F2F2`(≈ `--muted`), 학력 칸 구분선 ≈ `#969696`(→ `bg-muted-foreground/70`), 스위치·라디오 = `#15A76E`(= `--primary`).
- 모서리(반지름, CSS): 다이얼로그 ≈ 8 · 입력/셀렉트/버튼/알약 ≈ 6~8 · 공급자 행 ≈ 10 · 표 ≈ 9 · 탭 알약 ≈ 6.

## 1. 차이 표 — 화면 ↔ 현재 구현(42 런) ↔ 맞출 값

"맞출 값"은 design-system v5.12 5.11의 값이다. ★ = 기획(UX)이 화면과 달라 기획을 따른 곳.

### 1.1 틀 (공통)

| 영역 | 화면 | 지금 (42 런) | 맞출 값 |
|------|------|--------------|---------|
| 다이얼로그 크기 | 약 1110×770 CSS | `md:max-w-[760px] lg:max-w-[880px]`, 본문 높이 640 | `md:max-w-[760px] lg:max-w-[min(1100px,calc(100vw-4rem))]`, `md:h-[min(760px,calc(100dvh-4rem))]`, 좁은 화면 `h-[min(640px,85svh)]` |
| 모서리 · 그림자 | 약 8px, 그림자 | `rounded-lg` `shadow-lg` | 그대로 |
| 머리 위치 | **다이얼로그 전체 폭**(탭 목록 위까지) | 오른쪽 본문 칸 안에만(`main > header`) | `DialogContent` 바로 아래 `header` — 탭 목록과 본문을 덮는다 |
| 머리 내용 | 보이는 제목 "설정"(굵게, 섹션 머리와 같은 크기) | `Breadcrumb` "설정 › {탭}", 제목은 `sr-only` | `DialogTitle.text-base leading-6 font-semibold "설정"`, 이동 경로 삭제 |
| 머리 X | 오른쪽 회색 X | `DialogContent` 기본 X(`absolute top-2 right-2`) | `showCloseButton={false}` + 머리 안 `DialogClose > Button variant="muted-ghost" size="icon-sm"` + `X size-5`, aria-label "닫기" |
| 머리 높이 · 구분선 | 약 69, 아래 1px 회색 선 | `h-16`, 선 없음 | `h-16 border-b px-5`(좁은 화면 `h-14 px-4`) |
| 탭 목록 폭 | 약 214 | `--sidebar-width: 12rem` | `13rem` |
| 탭 목록 바탕 | 연한 민트 `#F3FAF8`, 오른쪽 선 없음 | `Sidebar` 기본(`bg-sidebar`) | 그대로 `bg-sidebar`, 오른쪽 border 없음 확인 |
| 탭 목록 안쪽 여백 | 알약이 가장자리에서 약 11 | `SidebarGroup` 기본 `p-2` | `SidebarGroup.p-3` |
| 탭 아이콘 | **없음**(글자만) | `UserRound`·`PlugZap`·`FileText`·`MessageSquarePlus` `size-5` | 아이콘 삭제 |
| 탭 글자 | 약 14px | `text-base` | `h-10 text-sm` |
| 선택 탭 | 연초록 알약(primary 10%) + 초록 글자, 모서리 약 6 | `isActive` = `bg-sidebar-accent`(같은 색) | 그대로(`rounded-md`) — 색은 이미 맞음 |
| 탭 사이 | 알약이 붙어 있음(간격 0) | `SidebarMenu gap-0` | 그대로 |
| 본문 여백 | 좌우 약 21, 위 약 20 | `px-6 pb-6`, 위 0(머리가 위에 있음) | `px-5 pt-5 pb-6`(좁은 화면 `px-4 pt-4 pb-4`) + `@container/settings` |
| 섹션 사이 | 약 32 | `gap-8` | 그대로 |
| 섹션 머리 | 16px 굵게, 진한 글자 | `text-base font-semibold` | 그대로. 설명 줄이 있으면 `div.space-y-0.5` 안 `p.text-sm text-muted-foreground` |
| 좁은 화면 탭 줄 | (화면 없음) | `grid-cols-4` 글자 버튼 | 그대로 + 머리가 `border-b`라 탭 줄에 `pt-3` |

### 1.2 계정 탭

| 영역 | 화면 | 지금 | 맞출 값 |
|------|------|------|---------|
| 이메일 줄 | 라벨 "이메일" 회색 왼쪽 · 값 진한 글자 | `dl sm:grid-cols-[8rem_1fr]`, 라벨 `text-sm font-medium` 회색 | `@md/settings:grid-cols-[6rem_minmax(0,1fr)]`, 라벨 `text-base text-muted-foreground`(400). 화면은 값 시작이 입력 칸보다 약 20px 오른쪽 — Figma 오차로 보고 라벨 열을 하나(6rem)로 맞춤 |
| 라벨-입력 배치 | **라벨 왼쪽(회색) · 칸 오른쪽 한 줄 격자** | 라벨이 칸 위(`flex-col gap-2`), 라벨 `text-sm font-medium` 진한 글자 | `SettingsFieldRow`: `@md/settings:grid-cols-[6rem_13rem] items-center`, 라벨 `text-base font-normal text-muted-foreground` |
| 라벨 열 폭 | 약 95 | — | `6rem` |
| 입력·셀렉트 높이 | 약 32 | `h-10`(40) | `h-8`(이 다이얼로그 전용) |
| 입력·셀렉트 폭 | 약 212(고정) | 본문 폭 전체 / 반 | `w-52`(13rem 열). 본문 < 448이면 전체 폭 |
| 입력 모서리 | 약 6~8 | `rounded-control`(12) | **그대로 12**(v4 브랜드 토큰, DR-13 — 사용자 확인 후보) |
| 입력 테두리 | `#E2E2E2` 1px | `border-input` | 그대로 |
| 칸 줄 간격 | 줄 높이 약 44 | `gap-4` | `gap-3`(32 + 12) |
| 2열 배치 | 관심 기업군 \| 관심 산업 한 줄, 관심 직군 \| 관심 직무 한 줄 | 구직 상태 \| 관심 기업군 한 줄, 관심 산업 반 폭 단독 | 이름 · 구직 상태 단독 줄, **관심 기업군 \| 관심 산업 한 줄**, 쌍 행 한 줄 — `@3xl/settings:flex-row gap-x-11`(본문 ≥ 768) |
| 쌍 행 머리 | 없음(행 안 라벨) | 보이는 legend "관심 직군 · 관심 직무" + 열 머리 줄 | legend `sr-only`, 열 머리 줄 삭제, 1행에 라벨 "관심 직군"·"관심 직무" |
| 둘째 직군 셀렉트 | 라벨 없이 직군 열 아래 한 줄 | 쌍 행 2행(직군 · 직무 · 삭제) | ★ 쌍 구조 유지(UX), 2행은 라벨 칸만 비움(화면 모양) |
| [삭제] · [+ 관심 직무 추가] | 없음 | ghost icon / `outline sm` | ★ 유지(UX). [삭제] `muted-ghost icon-sm`, [+ 관심 직무 추가] `secondary sm`을 칸 열 시작(`pl-24`)에 |
| placeholder | 이름 "직책 입력", 셀렉트 "고용 형태 선택" | "이름을 입력해 주세요" / "선택해 주세요" | ★ 지금 그대로(UX) |
| 라벨 "구직상태" | 붙여 씀 | "구직 상태" | ★ "구직 상태"(UX) |
| 내 정보 안내 줄 | 없음 | `Info` 아이콘 줄 | ★ 유지(UX), 모양은 섹션 머리 설명 줄(`p.text-sm text-muted-foreground`, 아이콘 없음 — AI 탭 머리와 같은 모양) |
| 최종 학력 라벨 | "최종 학력" 회색, 상자 첫 줄과 높이 맞춤 | `legend` `text-sm font-medium` + 안내 줄 + 2열 격자 칸 6개(각 칸 라벨) | `span.text-base text-muted-foreground @md:pt-2` 왼쪽 열 |
| 최종 학력 칸 | **테두리 상자 하나**(약 72 높이, 모서리 약 6): 윗줄 "학교 명" **굵게**, 아랫줄 학위 \| 졸업 상태 \| yyyy.mm - yyyy.mm \| 전공 \| 학점 **세로 구분선 인라인 칸**(비율 약 3:2:3:3:2, 구분선 약 18 높이·회색 `#969696`) | 칸 6개가 각각 라벨 + 테두리 칸, 기간은 연·월 셀렉트 4개 한 줄 | `div.rounded-control border border-input px-2.5 py-2` + 1줄 `InputGroupInput h-7 font-semibold placeholder:font-semibold` + 2줄 `grid @3xl:grid-cols-[3fr_2fr_3fr_3fr_2fr]`, 칸 ②~⑤ `before:` 구분선 `h-4.5 w-px bg-muted-foreground/70`, 셀렉트 칸 `SelectTrigger variant="cell"`(새), 기간 `PeriodCell`(새, 팝오버 안 연월 셀렉트 4개) |
| 학력 칸 placeholder | 칸 이름 | 없음(학점 "") | 칸 이름(`[UI-가정]`, P-27) + `aria-label` |
| 학력 안내 줄 | 없음 | 상자 위 `Info` 줄 | ★ 유지(UX), 상자 아래 ⓘ 줄 |
| [저장] | **없음** | 섹션 끝 오른쪽 `default`(h-10) + C-06 | ★ 유지(UX 섹션 저장), 학력 상자 아래 **오른쪽 정렬 `h-10`**(상자 오른쪽 끝과 맞춤), `pt-1` |
| 위험 구역 버튼 | 초록 **채움** 버튼 둘 나란히, 약 78×39, 모서리 약 7, 아이콘 없음, 사이 약 9 | `destructive-outline` + 아이콘(`LogOut`·`UserX`) | ★ 색은 파괴적(SD-A7) → **`variant="destructive"` 채움 `size="default"`**, 아이콘 없음, `gap-2` |
| 위험 구역 머리 | "위험 구역" 굵게 | 같음 | 그대로 |

### 1.3 AI 연결 탭

| 영역 | 화면 | 지금 | 맞출 값 |
|------|------|------|---------|
| 블록 ① 머리 | "모델 공급자 설정" 굵게 + 바로 아래 회색 설명 한 줄(작게) | 머리 + `text-base text-muted-foreground` 설명 | 설명 `text-sm`, 머리와 `space-y-0.5`로 붙임. 문구 ★ UX 전체("…비용은 연결한 공급자에 직접 내요") |
| 공급자 행 묶음 | **테두리·구분선 없음**, 행 사이 약 4 | `divide-y rounded-lg border bg-card` | `RadioGroup.gap-1`, 묶음 테두리 삭제(S-41만 `bordered`) |
| 행 크기 | 약 44 높이, 모서리 약 10 | `min-h-16 px-4 py-3` | `min-h-11 rounded-lg px-2 py-1.5` |
| 활성 행 | 연초록 틴트(primary 10%) | `bg-primary-subtle/40` | `bg-primary/10` |
| 라디오 | 지름 약 21, 선택 = 굵은 초록 고리 + 흰 가운데, 미선택 = 회색 채운 빈 원 | `size-4`, 미연결 행은 라디오 없음(빈 칸) | `RadioGroupItem size="lg"`(새: `size-5`, 점 `size-2.5`), **미연결 행도 비활성 라디오 표시** |
| 이름 | 16px 보통 굵기, 이름 열 고정(플랜 안내가 같은 x) | `font-semibold`, 이름 뒤에 바로 이어짐 | `h4.w-28 text-base font-normal` |
| 플랜 안내 | 회색 14px | `text-sm text-muted-foreground` | 그대로 |
| ⋯ | 회색, 오른쪽 끝 | `ghost icon-sm` | `muted-ghost icon-sm` |
| [연결] | **연초록 틴트 채움 + 초록 글자**, 약 64×31 | Gemini `default` / GPT·Claude `outline` sm | 모두 `secondary sm` |
| 상태 줄·배지·추천 배지 | 없음(Figma) | 있음 | ★ 유지(UX S-40), 행이 그만큼 자람 |
| 블록 ② 머리 | "모델 공급자 별 사용량 확인" + 회색 설명 "예상치이며…확인하세요." | 머리 + `Alert variant="info"`(첫 문장 굵게) | 고지 = **머리 설명 줄**(`text-sm text-muted-foreground`, 굵게 없음). 문구 ★ UX(끝 마침표 없음) |
| 공급자 탭 | **알약**: 선택 = 연초록 채움 + 초록 글자, 나머지 회색 글자, 약 h-8, 사이 간격 | `TabsList variant="line"`(밑줄 + `border-b`) | `TabsList variant="pill"`(새) |
| 가격 안내 | 알약 오른쪽 같은 줄 ⓘ "공급자 가격이 바뀌면 갱신해요. 지난 기록은 당시 가격표로 계산돼요" | 표 아래 줄 | 알약 줄 ⓘ 줄로 옮김 |
| 대시보드 링크 | 줄 오른쪽 끝 "Gemini 대시보드 ↗", 초록 글자, 밑줄 없음 | 같은 자리, `ExternalLink` 아이콘 | `ArrowUpRight size-4` |
| 기간 줄 · 무료 등급 줄 | 없음 | 표 위 | ★ 유지(UX), 표 위 `space-y-1` |
| 표 바깥 | **둥근 테두리**(약 9) | 테두리 없음 | `div.overflow-hidden rounded-lg border` |
| 표 머리 | **회색 바탕**, 진한 글자, 머리 아래 선 하나 | 바탕 없음, 정렬 버튼 | `TableHeader.bg-muted`, `TableHead.h-10 px-4 text-sm font-medium text-foreground` |
| 머리 글자 | "입력 비용" · "호출 수" · "출력비용" | "입력 비용(USD)" · "호출 수" · "출력 비용(USD)" | ★ 지금 그대로(UX) |
| 행 구분선 | **없음** | 행마다 `border-b` | `TableBody [&_tr]:border-0` |
| 행 글자 | 14px | 기능 `text-base` | `text-sm` |
| 숫자 정렬 | **왼쪽**(머리와 같은 x) | 오른쪽 | 왼쪽, `tabular-nums` 유지 |
| 열 폭 | 기능 약 36~40%, 나머지 약 20%씩 | `w-32`·`w-20`·`w-32` | `table-fixed`, `w-[20%]`·`w-[18%]`·`w-[22%]` |
| 입력 비용 칸 | "0"(통화 없음) | "$0.00" + 토큰 둘째 줄 | ★ "$0.00" 형식(두 비용 열 같게) + 토큰 둘째 줄 `text-xs` |
| 0인 행 | 기능 이름 진한 글자, 숫자만 회색 | 행 전체 흐림 | ★ 행 전체 흐림(UX "0인 행은 흐리게") |
| 정렬 표시 | 없음 | 머리 ghost 버튼 + 화살표 | ★ 유지(UX "정렬"), 화살표만 회색 `size-3.5` |
| 표 위·아래 여백 | 머리 아래 약 17, 끝 약 19 | `py-2` | 셀 `py-1.5`, 첫 행 `pt-3`, 마지막 행 `pb-3` |
| 가격표 버전 줄 · 가격표 보기 | 없음 | 표 아래 | ★ 유지(UX), 표 바로 아래 한 줄 + `link` 트리거 |
| 표 아래 안내 2줄 | ⓘ 회색 두 줄 | ⓘ 두 줄 `space-y-1` | 그대로 + `space-y-1.5` |

### 1.4 약관 탭

| 영역 | 화면 | 지금 | 맞출 값 |
|------|------|------|---------|
| "Resumate 약관" 머리 | 굵게 | 같음 | 그대로, 섹션 `space-y-1` |
| 문서 행 묶음 | **테두리·구분선 없음** | `divide-y rounded-lg border bg-card`, 행 `px-4 py-3` | `ul` 맨 몸, 행 `h-12 flex items-center justify-between`(좌우 안쪽 여백 0) |
| 문서 이름 | 16px 보통 | `text-base` | 그대로 |
| [전문 확인] | **연초록 틴트 채움 + 초록 글자, 아이콘 없음**, 약 77×31 | `outline sm` + `ExternalLink` | `secondary sm`, 아이콘 삭제, aria-label "(새 탭)" 유지 |
| "선택 동의" 머리 | 굵게 | 같음 | 그대로 |
| 동의 행 | **굵은 라벨 + 같은 줄 회색 설명**(설명 시작 x가 두 행에서 같음) + 오른쪽 Switch, 테두리 없음 | 라벨 `font-medium` 위 · 설명 아래, 테두리 묶음 | `grid @2xl:grid-cols-[11rem_minmax(0,1fr)_auto]`, 라벨 `text-base font-semibold`, 설명 `text-sm text-muted-foreground`, 행 `min-h-12` |
| Switch | 약 52×31, 초록 | shadcn 기본 32×18 | `Switch size="lg"`(새: `h-7 w-12`, 손잡이 `size-6`) |
| 동의 라벨·설명 문구 | "이용 패턴 기록 활용" / "기능 업데이트, 소식 받기" + 설명 | 같음 | 그대로(UX = 화면) |
| AI 데이터 처리 원칙 줄 | 없음 | `bg-muted/50` 상자 | ★ 유지(UX), 상자 삭제 → ⓘ 줄 모양(`ShieldCheck text-success`) + `link` [전문 확인] ↗ |

### 1.5 개선 요청 탭 (화면 없음)

| 영역 | 지금 | 맞출 값 |
|------|------|---------|
| 새 창 아이콘 | `ExternalLink` | `ArrowUpRight`(UX 문구 "↗", 다른 탭과 같게) |
| 버튼 크기 | `default` | 그대로(섹션 끝 버튼 `h-10` 규칙) |
| 그 밖 | — | 바꾸지 않음 |

## 2. 문구 — 채택한 것과 출처

| 자리 | 화면 문구 | UX v5.17b | 채택 |
|------|-----------|-----------|------|
| 다이얼로그 제목 | 설정 | 설정 | UX(= 화면) |
| 탭 이름 | 계정 · AI 연결 · 약관 · 개선 요청 | 같음 | UX |
| 계정 탭 머리 | 계정 · 내 정보 · 위험 구역 | 같음 | UX |
| 구직 상태 라벨 | 구직상태 | 구직 상태 | **UX** |
| 이름 placeholder | 직책 입력 | 이름을 입력해 주세요 | **UX** |
| 셀렉트 placeholder | 고용 형태 선택 | 선택해 주세요 / 직군을 먼저 골라 주세요 | **UX** |
| 학력 칸 placeholder | 학교 명 · 학위 · 졸업 상태 · yyyy.mm - yyyy.mm · 전공 · 학점 | 학교 명·전공·학점은 placeholder 없음, 셀렉트는 "선택해 주세요" | **화면 `[UI-가정]`**(칸에 라벨이 없어 "선택해 주세요"로는 칸을 구분할 수 없다) → 기획 확인 P-27 |
| 블록 ① 머리 | 모델 공급자 설정 | 같음 | UX |
| 블록 ① 안내 | "…AI 작성 대화를 쓸 수 있어요." | "…쓸 수 있어요. 비용은 연결한 공급자에 직접 내요" | **UX**(UI42-4 정본) |
| 플랜 안내 3개 | 무료/유료 가능 · GPT Pro 플랜 이상만 가능 · Claude MAX 플랜 이상만 가능 | 같음 | UX |
| 블록 ② 머리 | 모델 공급자 별 사용량 확인 | 같음 | UX |
| 상시 고지 | "예상치이며 공급자 청구서가 아니에요. 실제 청구는 공급자 대시보드에서 확인하세요." | 끝 마침표 없음 | **UX**(마침표 없음) |
| 가격 안내 | "공급자 가격이 바뀌면 갱신해요. 지난 기록은 당시 가격표로 계산돼요" | 같음(가격표 정보) | UX — 자리만 알약 줄로 |
| 대시보드 링크 | "Gemini 대시보드 ↗" | "{공급자} 대시보드 ↗"(S-24 ② 공급자 탭 행) | UX — **새 기능 아님**(UX·5.11·구현에 이미 있음). 기획 확인 불필요 |
| 표 머리 | 기능 · 입력 비용 · 호출 수 · 출력비용 | 기능 · 입력 비용(USD) · 호출 수 · 출력 비용(USD) | **UX** |
| 표 행 7개 | 프로젝트/산출물 작성 AI 채팅 … 연결 확인 | 같음 | UX |
| 표 아래 안내 2줄 | "Resumate 밖에서 같은 키로…" / "AI 사용 후 1분 안에 반영돼요" | 같음 | UX |
| 약관 머리 | Resumate 약관 | "Resumate 약관"(컴포넌트 이름) | UX(= 화면) |
| 문서 이름 4개 | 개인정보 처리방침 · 이용 약관 · 국외 이전 약관 · AI 데이터 처리 | 같음 | UX |
| [전문 확인] | 전문 확인 | 같음 | UX |
| 선택 동의 라벨·설명 | 이용 패턴 기록 활용 / 기능 업데이트, 소식 받기 + 설명 2개 | 라벨 같음, 설명 "현행 설명 한 줄 유지"(현행 = 화면 문구) | UX(= 화면) |

화면에만 있고 UX가 비어 있는 문구는 **학력 칸 placeholder 6개뿐**이다. 브리프가 예로 든 "모델 공급자 설정"·"모델 공급자 별 사용량 확인"·"예상치이며…"·"{공급자} 대시보드 ↗"·"Resumate 약관"·표 아래 안내 두 줄은 모두 UX v5.17b에 같은 자리 문구가 이미 있다(UX를 따름).

## 3. 기획 확인 필요 (리더 → resumate-planning)

| # | 화면 | 내용 | 임시 처리 | 구현해도 되나 |
|---|------|------|-----------|---------------|
| P-27 | S-24 ① 최종 학력 | 원본 화면은 학력 상자 안에 라벨이 없고 칸 이름을 placeholder로 쓴다. UX 셀렉트 placeholder 공통 규칙("선택해 주세요")과 부딪힌다. 함께: 기간 칸 placeholder "yyyy.mm - yyyy.mm" 표기, 기간 칸에서 C-25 "(N년 N개월)" 생략 | 상자 안 칸만 칸 이름 placeholder + `aria-label` `[UI-가정]` | **예** — 문구 한 줄 차이이고 되돌리기 쉽다 |

그 밖에 **새로 생기는 기능은 없다**(대시보드 링크는 기존 기능). 브리프의 원칙 표 항목(위험 구역 색·placeholder·통화 표기·[저장])은 기획이 이미 정했으므로 질문하지 않았다.

### 디자인 결정 후보 (사용자, 기획 아님 — 8.5)

| # | 내용 | 임시 |
|---|------|------|
| DR-13 | 조작 요소 모서리: 화면 약 6~8px vs v4 브랜드 `rounded-control` 12px | v4 유지(이 다이얼로그만 바꾸면 앱 안에서 버튼 모서리가 두 종류가 된다) |
| DR-14 | 연한 초록 채움 농도: 화면 약 20% vs `secondary` 10% | 10% 유지(20%에서는 초록 글자 대비가 약 3.7:1로 더 낮아짐) |

## 4. [UI-가정] (design-system 8.2)

G-75 크기·환산 · G-76 상시 고지 = 머리 설명 줄 · G-77 원칙 줄 상자 삭제 · G-78 표(왼쪽 정렬·비율 폭·진한 머리·작은 정렬 화살표·안내 줄 재배치) · G-79 미연결 행 비활성 라디오·Gemini [연결] secondary·S-41 테두리 유지 · G-80 [저장] 자리·쌍 행 2행 빈 라벨 칸·[+ 관심 직무 추가] secondary · G-81 기간 칸 팝오버·기간 길이 생략. 고친 것: G-62(→ G-75), G-68(destructive 채움), G-69, G-70(컨테이너 기준), G-73.

## 5. 엔지니어 주의점

1. **새 variant·size 4개**를 primitive에 더한다(사용처에서 색 덧씌우기 금지):
   - `components/ui/select.tsx` — `SelectTrigger variant="cell"`: `h-7 w-full justify-start gap-1 border-0 bg-transparent px-0 text-base shadow-none data-[placeholder]:text-muted-foreground [&>svg]:hidden dark:bg-transparent dark:hover:bg-transparent` + `chip`처럼 `data-[size=default]:h-7 data-[size=sm]:h-7 max-md:data-[size=default]:h-7 max-md:data-[size=sm]:h-7`로 기본 높이 규칙을 덮는다.
   - `components/ui/tabs.tsx` — `TabsList variant="pill"`(목록 `h-auto gap-2 rounded-none bg-transparent p-0`) + 트리거 그룹 클래스 `group-data-[variant=pill]/tabs-list:` 접두로 `h-8 flex-none rounded-control px-3 text-sm font-normal text-muted-foreground hover:text-foreground data-active:bg-primary/10 data-active:font-medium data-active:text-primary-text data-active:shadow-none`, `after:` 밑줄은 `line`에서만 보이므로 그대로.
   - `components/ui/radio-group.tsx` — `RadioGroupItem size="lg"`: 루트 `size-5`, `Indicator` `size-5`, 점 `size-2.5`.
   - `components/ui/switch.tsx` — `size="lg"`: 루트 `h-7 w-12`, 손잡이 `size-6`, 켜짐 이동은 기존 `translate-x-[calc(100%-2px)]` 그대로.
2. **틀**(`settings-dialog.tsx`): `Breadcrumb` 제거, 머리를 `DialogContent` 직속 전체 폭으로(제목 보이게 + `DialogClose` X), `showCloseButton={false}`, 탭 아이콘 제거 + `text-sm`, `--sidebar-width: 13rem`, `SidebarGroup.p-3`, 크기 클래스, `#settings-body`에 `@container/settings` + `px-5 pt-5 pb-6`. `DialogContent`를 `flex flex-col gap-0`으로 바꾸면 `SidebarProvider`가 `flex-1 min-h-0`로 남은 높이를 채운다(기본 `min-h-svh`를 꼭 덮을 것).
3. **X는 기존 가드 경로**: `DialogClose`는 `onOpenChange(false)`를 부르므로 지금의 `onRequestClose → runGuarded` 그대로 미저장 확인이 뜬다. 따로 처리하지 않는다.
4. **컨테이너 쿼리**: 폼 배치는 `@md/settings:`(라벨 왼쪽 열) · `@3xl/settings:`(한 줄 두 쌍, 학력 다섯 칸) · `@2xl/settings:`(동의 설명 같은 줄) · `@lg/settings:`(표 ↔ 행 목록, 공급자 행 줄바꿈)로만 바꾼다. 뷰포트 `sm:`/`md:` 폼 배치 클래스는 걷어낸다.
5. **`SettingsFieldRow`**(새 패턴)로 이름·구직 상태·관심 기업군·관심 산업·쌍 행 칸을 통일. `SelectTrigger`는 `className="h-8 w-full data-[size=default]:h-8"`(기본 `h-10`을 이기도록).
6. **학력 상자**: 학교 명·전공·학점은 `InputGroupInput`(이미 테두리·바탕 없음)을 `h-7 px-0`으로. 학위·졸업 상태는 `SelectTrigger variant="cell"`. 기간은 `PeriodCell` = `PopoverTrigger` 버튼 + `PopoverContent align="start" className="w-auto p-3"` 안에 지금의 `YearMonthSelect` 두 벌(시작/종료). 오류가 있는 칸은 `aria-invalid` → 상자 `has-[[aria-invalid=true]]:border-destructive`, 오류 문장은 상자 아래. 포커스 이동 대상: 기간 오류 → `PeriodCell` 버튼.
7. **위험 구역**: `account-tab.tsx`(회원 탈퇴)·`sign-out-button.tsx`(로그아웃)의 `variant="destructive-outline"` → `"destructive"`, 아이콘 삭제, `size` 기본. `destructive-outline` 정의는 `button.tsx`에 남긴다.
8. **`ProviderRow`/`ProviderRowGroup`**: 그룹 기본을 테두리 없는 `flex flex-col gap-1`로, S-41(`key-connect-flow.tsx`)만 `bordered`. 행 프레임 `flex min-h-11 items-start gap-2 rounded-lg px-2 py-1.5`, 활성 `bg-primary/10`. 라디오 칸 `size-8` 가운데 + `size="lg"`, 미연결·무효 행 `disabled` 라디오. 이름 `h4.w-28 shrink-0 text-base font-normal`. [연결] `secondary sm`, ⋯ `muted-ghost icon-sm`, "다시 확인" `secondary sm`.
9. **사용량**(`ai-usage-panel.tsx`): `Alert` 고지 → 머리 설명 줄, `TabsList variant="pill"`, 가격 안내 문장을 알약 줄로, 대시보드 아이콘 `ArrowUpRight`, 표 감싸개 `rounded-lg border` + 머리 `bg-muted` + 몸 `[&_tr]:border-0` + 숫자 왼쪽 정렬 + `text-sm` + `table-fixed` 폭. 정렬 버튼은 `-ml-2`(왼쪽 정렬이므로 지금의 `-mr-2`에서 바뀜). 0인 행 `muted` 유지.
10. **약관 탭**: 문서·동의 `ul`의 `divide-y rounded-lg border bg-card` 제거, [전문 확인] `secondary sm` 아이콘 삭제, 동의 행 grid + `Switch size="lg"` + 라벨 `font-semibold`, 원칙 줄 상자 제거.
11. **새 탭 아이콘**: 이 다이얼로그 안의 `ExternalLink`는 모두 `ArrowUpRight size-4`로(대시보드·원칙 줄 [전문 확인]·개선 요청). 문서 행 [전문 확인]은 아이콘 없음.
12. **스켈레톤**: 계정 `h-8` 칸 줄 + 학력 `h-[4.5rem]`, AI 연결 행 `h-11` + 알약 `h-8 w-56` + 표 `h-64 rounded-lg`, 약관 `h-12`.
13. 새 색 토큰 0개, 토큰·패턴 이름 변경 0개. 다크 모드는 토큰(`bg-primary/10`·`bg-muted`·`bg-sidebar`)으로 자동 — 원본 화면이 라이트뿐이라 다크는 화면 확인 대상이 아니다(QA는 깨짐만 본다).
