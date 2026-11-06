# 42 런 — ui-designer 노트 (설정 다이얼로그 탭 4개, settings-dialog SD-*)

- 날짜: 2026-11-05
- 산출물: `docs/ui/design-system.md` **v5.10 → v5.11**
- 기준: PRD v4.14 · UX v5.17a(S-24 ①~④, S-40, S-42, S-30, C-01·C-02) · AI v4.12a · DM v4.12a · decisions 3.22·3.23·4.16
- Figma: **없음**(브리프대로). S-24 ①~④ 컴포넌트 표를 정본으로 썼다. 읽지 못한 디자인 입력 없음.
- 코드는 읽기만 했다(`settings-dialog.tsx`, `account/*`, `nav-user.tsx`, `theme.ts`, `ui/button.tsx`·`tabs.tsx`, `lib/contracts/feedback.ts`, `lib/data/profile.ts`).

## 1. 바꾼 절

| 절 | 바뀐 것 |
|----|---------|
| 머리글 | 판 v5.11, 기준 기획 줄 |
| 1.1 다크 모드 줄 | "설정 › 화면" → 계정 메뉴 "다크 모드" 스위치 |
| 1.4 `max-w-form` | S-04·S-24 사용처 제거, S-25 추가 |
| 2 인벤토리 | `button` `destructive-outline` 추가, `switch` 행 추가, `tabs`·`table` 쓰는 곳, `ProviderCard` → `ProviderRow`(이전 목록), 새 패턴 4행(`UnsavedChangesConfirm`, `SectionSaveBar`·`JobInterestRows`·`HighestEducationFields`, `AiUsageByProvider`) |
| 3.1 C-01 / 3.2 C-02 | `profile` 근거: 칩은 정상 모양 그대로, C-02 이동 버튼 자리에 "이 근거의 원본 화면은 더 이상 없어요" 한 줄 |
| 3.18 C-18 | AI 연결하기 목적지 "섹션" → "탭" |
| 5.1 L-01 | AI 상태 줄 "탭", NavUser 메뉴에 다크 모드, 설정 다이얼로그 단락 → 5.11 포인터 |
| 5.2 폼 화면 | S-04 제거 |
| 5.6 | 다이얼로그 겹침 예외(설정 다이얼로그 위 AlertDialog 한 겹 + C-21) |
| 5.7 | 놓이는 곳 표(블록 ①·②), S-40 카드 블록·S-42 블록을 5.11.2 포인터로 대체, S-41 공급자 선택 = `ProviderRow` |
| **5.11 신설** | 설정 다이얼로그 전체(아래 2장) |
| 6 A1 | S-24 메모 → 5.11, S-30 문서 4개 + AI 데이터 처리 페이지 모양, S-40·S-42 위치 |
| 6 A2 | 머리에서 ~~S-04~~ |
| 8.2 | G-23 고침, **G-62~G-74** 추가 |
| 8.3 | Q-2(다크 모드) 바뀜 기록 |
| 8.4 | **P-22~P-26** 추가 |
| 9 | v5.11 행(이름 이전 목록 포함) |

## 2. 새 패턴 요약 (5.11)

- **틀**: 탭 4개 `account`·`ai-connection`·`policies`·`feedback`, 아이콘 `UserRound`·`PlugZap`·`FileText`·`MessageSquarePlus`. 옛 섹션 ID 호환(`withdraw`→`account`+위험 구역 스크롤, `ai-usage`→`ai-connection`+블록 ② 스크롤, `consents`·`ai-data`→`policies`). 크기 `md:max-w-[760px] lg:max-w-[880px]`, 본문 높이 `min(640px, 100dvh−4rem)` 고정, 탭 목록 `--sidebar-width: 12rem`, 본문 `px-6`. 머리 `h-16` 이동 경로 "설정 › {탭}". 좁은 화면 = `grid-cols-4` 탭 줄.
  - 크기 판단: 계정 탭 높이 약 900~1,000px, 사용량 표 4열 + 토큰 둘째 줄 → v5.10 `h-[480px]`·본문 폭 약 544px로는 부족.
- **AI 연결 경고 점**: 유지(`invalid`·`needs_check`). 동의 필요는 점 없음(지금과 같음).
- **화면 테마**: UX가 자리를 정했다(SD-A16 — 계정 메뉴 "다크 모드" 스위치, 이미 구현됨). 설정 "화면" 섹션은 없앴다. 시스템 설정으로 돌아가는 길이 없어진 점은 P-23.
- **미저장 확인 `UnsavedChangesConfirm`**: 닫기·탭 전환·회원 탈퇴 때. `LeaveGuard`와 같은 AlertDialog 모양, 버튼 "저장하지 않고 닫기"(muted-ghost) / "저장하고 닫기"(default), X = 계속 편집. 커리어 모달(OD-C1, 확인 없이 버림)과 다른 규칙임을 명시. 로그아웃은 확인 없음.
- **섹션 단위 저장 `SectionSaveBar`**: 섹션 끝 오른쪽 C-06 + [저장](변경 없음 disabled / 저장 중 Loader2 "저장 중…"), 실패 줄은 섹션 머리 아래, `stale_write`는 warning Alert + 내가 고친 값 목록, 오류 6종은 칸 아래 + 포커스.
- **쌍 행 `JobInterestRows`**: `grid [1fr_1fr_2rem]`, 열 머리 한 번, 직무 셀렉트는 직군 전 disabled + "직군을 먼저 골라 주세요", 삭제 ghost icon, [+ 관심 직무 추가] outline sm 2쌍에서 disabled + 옆 글자, 중복 오류는 행 아래.
- **최종 학력 `HighestEducationFields`**: `legend` 묶음 + 안내 한 줄(Info), `sm:grid-cols-2`에 학교 명(2칸)·학위·졸업 상태·기간(2칸, PeriodField에서 체크 뺀 모양)·전공·학점.
- **위험 구역**: 새 variant `destructive-outline` 두 버튼(LogOut / UserX). 섹션 상자 없음.
- **`ProviderRow`**: 묶음 테두리 + `divide-y` 3줄, 순서 Gemini → GPT → Claude, 1행 이름 + 플랜 안내 + 상태 배지(C-19 글자 재사용, 눌리지 않는 Badge), 2행 상태 줄(••••last4 font-mono), 오른쪽 [연결] / ⋯. 상태 8종 표.
- **`AiUsageByProvider`**: 고지 Alert(sticky 아님) → `Tabs variant="line"` 3개 + 고른 공급자 대시보드 링크 → 기간 → 무료 등급 줄 → 표(기능 / 입력 비용 / 호출 수 / 출력 비용, 비용 칸 둘째 줄 `caption` 토큰 수, 숫자 오른쪽 `tabular-nums`, 0행 흐림, 합계 없음) → 가격표 줄 → 하단 안내 2줄. 좁은 화면(<640) 행 목록.
- **약관 탭**: 문서 4행 `[전문 확인]`(outline sm, 새 탭) · 선택 동의 `Switch` 2행 · 원칙 줄 `bg-muted/50` 상자. 필수 동의 기록 없음.
- **개선 요청 탭**: 링크 상태 = default 버튼(새 창) + 전달 고지 / 준비 중 = disabled 버튼 + `Badge outline "준비 중"` + 안내 줄.
- **근거 칩 `profile`**: 3.1·3.2. 브리프는 "툴팁·aria-disabled"를 예로 들었지만 UX C-02가 "이동 버튼 자리에 한 줄"로 정해 그대로 따랐다(비활성 버튼 + 툴팁은 빈 탭 정지 — DR-8과 같은 문제). 칩 자체는 바꾸지 않음.

## 3. [UI-가정] (8.2 G-62~G-74)

G-62 다이얼로그 크기 · G-63 좁은 화면 탭 줄 · G-64 경고 점 범위 · G-65 "선택 안 함" 항목 · G-66 저장 줄 위치·토스트 없음·Enter 제출 막음 · G-67 마지막 쌍 행 삭제 = 비우기 · G-68 `destructive-outline` · G-69 고지 sticky 해제·대시보드 링크 하나·열 폭 · G-70 좁은 화면 사용량 목록 · G-71 개선 요청 준비 중 모양 · G-72 `stale_write` 값 목록 · G-73 Switch·원칙 줄 상자 · G-74 S-30 AI 데이터 처리 공급자 요약 = 소제목 + 단락. 그 밖에 5.11 본문의 `[UI-가정]` 표시(320px 미만 가로 스크롤, 행 열 폭 등).

## 4. 기획 확인 필요 (리더 → resumate-planning)

| # | 화면 | 내용 |
|---|------|------|
| P-22 | S-24 ① 미저장 확인 | 버튼 글자가 "…닫기"뿐인데 탭 전환·[회원 탈퇴]에서도 뜬다. 상황별 글자가 필요한지 |
| P-23 | 계정 메뉴 다크 모드 | "시스템 설정 따르기"로 돌아갈 길이 없어졌다(v5.10 "화면" 섹션 삭제). 유지 / 셋째 상태 |
| P-24 | S-24 ① | 계정 탭 불러오기 실패 문구 없음(임시 v5.10 문구) |
| P-25 | S-24 ① 내 정보 | 셀렉트 값 비우기 방법·문구 없음(임시 "선택 안 함" — **새 문구**), 기간 연도만 고른 경우 검증 문구 없음 |
| P-26 | S-24 ① `stale_write` | "고친 값을 덮어쓰기 전에 보여 준다"의 방법 미정(임시 Alert 안 목록) |

## 5. 엔지니어에게 넘길 주의점

1. **새 variant**: `components/ui/button.tsx`에 `destructive-outline` 추가(클래스는 2장 `button` 행). 사용처에서 색 덧씌우기 금지.
2. **탭 ID**: `SettingsSectionId` → 4개(`account`·`ai-connection`·`policies`·`feedback`). 이름은 `SettingsTabId`로 바꿔도 되지만 `"ai-connection"` 값은 유지 — C-19·C-20·C-09·`ai-connect-link`·`app-sidebar`·`ai-status-line`·S-41이 그대로 쓴다. **옮길 것**: `routes.settings("withdraw")` 2곳(`app/(dashboard)/settings/withdraw/page.tsx`, `account/withdraw-form.tsx`) → `"account"`; `openSettings("ai-usage")`(사용량 입구)는 입구째 삭제. `SettingsUrlOpener`는 옛 ID를 호환표대로 바꿔 열고 스크롤 앵커(`#settings-danger-zone`, `#settings-ai-usage`)로 보낸다.
3. **`ProviderCard` → `ProviderRow`**: `provider-card.tsx`(`ProviderCardFrame`, `providerCardId` → 앵커 `provider-row-{p}`), 사용처 `ai-connection-panel.tsx`·`key-connect-flow.tsx`(S-41 선택, `inButton` 규칙 유지)·`ai-status-line.tsx`(계정 탭에서 빠지므로 쓰는 곳이 남는지 확인). 행 순서 Gemini → GPT → Claude, 화면 이름 "GPT".
4. **다이얼로그 `onOpenChange` 가로채기**: Radix Dialog의 Esc·바깥 누르기를 막고 미저장 확인을 띄운다(`onEscapeKeyDown`·`onPointerDownOutside`에서 `preventDefault` 또는 `onOpenChange` 래핑). 탭 버튼(넓은 화면 사이드바·좁은 화면 격자 둘 다)과 [회원 탈퇴]도 같은 가드를 거친다. 확인 창은 설정 다이얼로그 위 AlertDialog 한 겹(5.6 예외).
5. **내 정보 dirty 판정**: 마지막 저장값(조회 또는 저장 응답) 대비. "저장하지 않고 닫기"는 폼을 마지막 저장값으로 리셋. 다시 열면 늘 다시 읽는다(임시 보존 없음, L-02 입력 보존 대상 아님).
6. **`Select` 비우기**: shadcn/Radix `Select`는 빈 문자열 값을 못 쓴다 — "선택 안 함"은 sentinel 값(예 `"__none"`)을 `null`로 바꿔 저장(G-65, P-25 확인 대기).
7. **사용량 표 7행**: `USAGE_FEATURE_DISPLAY_GROUPS`로 접고, 입력 토큰 = `input_tokens + cached_input_tokens + cache_write_tokens`. 합계 행 없음. 레거시 `getAiUsageSummary()`·옛 `AiUsageSummary` 정리는 브리프대로.
8. **약관 탭 링크는 새 탭** — 다이얼로그를 닫지 않는다(v5.10 "처리방침·약관" 링크는 닫고 이동했음 — 바뀜). `POLICY_TYPES` 3 → 4종.
9. **테마**: 설정에 테마 UI를 만들지 않는다. `nav-user.tsx` `ThemeToggleItem` 주석의 "설정 › 화면" 언급은 정리 대상.
10. **근거 칩 `profile`**: 칩은 손대지 않고, C-02 카드에서 `source_type === "profile"`이면 이동 버튼 대신 한 줄(3.2).
11. 큰 그림자·새 색 토큰 없음. 새 토큰 0개, 새 variant 1개.
