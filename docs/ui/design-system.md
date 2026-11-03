# Resumate 디자인 시스템 v5

> 작성: ui-designer / 2026-10-24 (v2: 2026-10-28, BYOK 반영 / v3: 2026-10-30, 기획 v5.3 반영 / v4: 2026-11-03, 사용자 지정 브랜드 토큰 / v5: 2026-11-03, 프로젝트 상세·산출물 상세 반영)
> 기준 기획: **v5 추가분은 PRD v4.6 · 플로우 v5.6 · AI v4.6 · 데이터 모델 v4.5**(L-02, S-10, S-43 산출물 섹션, S-44, C-15, C-23, AI-12·AI-13 패널). 그 밖의 장은 **PRD v4.3 · 플로우 v5.3 · AI v4.3 · 데이터 모델 v4.2** 기준이다(v5.5 커리어 재설계 중 이번 범위 밖 화면 — S-08 목록·S-09·S-34·C-22·C-24·C-25 — 의 시각 규칙은 아직 이 문서에 없다, 8.4 P-15) (v2는 PRD v4.2 · 플로우 v5.2, v1은 PRD v3.2a · 플로우 v4.2b 기준). v3에서 더하거나 바꾼 규칙은 본문에 `(v3)`, v4는 `(v4)`로 표시했다.
> Figma: v3까지는 없음. (v5) 파일 `GagTxDayknEFEa6qdSqQCc` 노드 `1034:8565`(근무 › 프로젝트 추가) · `1041:8783`(교육 › 프로젝트 상세) · `1041:8904`(산출물 상세)를 기준으로 했다. 단, Figma MCP가 호출 한도에 걸려 화면을 직접 읽지 못했고, 리더가 브리프(`_workspace/ui/21_brief_project-add.md`)에 적은 관찰값(크기·반경·색 인상)을 따랐다. 그 밖의 장은 기획 문서만으로 작성했다. 문서가 정하지 않은 시각적 선택은 `[가정]`으로 표시하고 8장에 모았다.
> 독자: frontend-engineer(파운데이션 A0, 영역 A1~A4), ui-qa. 이 문서만 읽고 같은 모양의 화면을 만들 수 있어야 한다. 토큰·패턴 이름은 엔지니어가 코드에서 그대로 참조하므로, 바꿀 때는 9장에 사용처 이전 목록을 함께 남긴다.

---

## 0. 원칙

1. **차분하고 촘촘한 업무 도구.** 경력직 이직자가 긴 한국어 글을 읽고 고치는 화면이다. 앱 기본 바탕(사이드바·바깥 영역 `--sidebar`)은 연한 민트 `#F3FBF8`, 콘텐츠 패널(sidebar-inset)·카드·팝오버는 흰색(사용자 결정 2026-11-03), 강조색은 초록 `#15A76E` 하나(사용자 결정 2026-10-24 · 2026-11-03), 의미 색은 상태 표시에만 쓴다. 장식 그라데이션·일러스트·큰 그림자는 쓰지 않는다.
2. **긴 한국어 본문이 주인공이다.** 본문 16px(사용자 결정 2026-10-24), 행간 1.75, 편집 폭 최대 42rem(약 42자). 한글에 자간을 좁히지 않는다.
3. **AI 상태는 헷갈리지 않는다.** AI 미연결(잠금)·실행 중·스트리밍·공급자 한도·오류·데이터 부족은 각각 정해진 하나의 모양을 쓴다(4장). AI는 사용자가 연결한 본인 키로만 돈다(BYOK). 그래서 화면에 서비스 횟수나 차감은 없고, 대신 어느 공급자로 도는지(C-19)를 늘 보인다. AI 활동에는 전용 보라색 `--ai`를 쓰고, 다른 용도로 쓰지 않는다.
4. **근거가 신뢰를 만든다.** 근거 칩(C-01)·출처 발화 칩(C-15)은 하나의 작은 칩 모양으로 통일한다. 상태는 색 + 아이콘 + 글자, 색만으로 구분하지 않는다.
5. **데스크톱 우선, 모바일 완결.** 1024px 미만에서 셸이 상단 바 + 서랍으로, 768px 미만에서 보드가 열 탭으로 바뀐다.
6. **(v5) 문서처럼 쓰고, 저장은 한 번.** L-02 화면(S-10·S-44)은 입력 칸을 테두리 없는 본문처럼 보이고, 저장 상태는 상단 바 "저장하기" 한 곳에 모은다. AI 패널은 제안만 하고, 무엇이 폼에 채워졌고 무엇이 저장됐는지를 카드마다 글자로 구분한다(제안 → 폼에 채움 → 반영됨).

---

## 1. 토큰

### 1.1 색 — shadcn CSS 변수

- 형식: **OKLCH**. 파운데이션은 shadcn/ui 최신판(Tailwind CSS v4, `@theme inline`)으로 스캐폴드한다고 보고 작성했다 `[가정]`. Tailwind v3 + HSL 판으로 스캐폴드하면 같은 값을 HSL로 바꿔 쓰되 이름은 그대로 둔다.
- 다크 모드: `.dark` 클래스 방식(shadcn 기본). 설정 › 화면에서 시스템 설정/라이트/다크를 고른다(8장 Q-2, 2026-10-29 결정).
- 아래 블록을 `src/app/globals.css`에 **그대로** 복사한다. 표의 hex는 확인용 근사값이다.

#### 1.1.1 역할별 토큰 표

| 토큰 | 용도 | Light (≈hex) | Dark (≈hex) |
|------|------|--------------|-------------|
| `--background` | 콘텐츠 패널(sidebar-inset) 바탕 = 흰색 (v4) | `#FFFFFF` | `oklch(0.17 0.006 260)` #0e0f12 |
| `--foreground` | 기본 글자 | `oklch(0.21 0.01 260)` #16181d | `oklch(0.95 0.004 260)` #edeef1 |
| `--card` / `--card-foreground` | 카드·패널·표 바탕 | `oklch(1 0 0)` #ffffff / = foreground | `oklch(0.205 0.007 260)` #15171a / = foreground |
| `--popover` / `--popover-foreground` | 메뉴·팝오버·다이얼로그 | `oklch(1 0 0)` / = foreground | `oklch(0.23 0.008 260)` / = foreground |
| `--primary` | **강조색(초록, 사용자 결정)**: 주 버튼, 현재 메뉴, 선택, 링크 | `#15A76E` (v4) | `oklch(0.74 0.14 158)` #4dc588 |
| `--primary-foreground` | primary 위 글자 | `oklch(0.99 0 0)` | `oklch(0.18 0.03 158)` #05160c |
| `--primary-text` | **초록 글자** (v4): 링크, secondary 버튼, ghost·메뉴 항목 hover, 초록 아이콘. `text-primary` 대신 `text-primary-text` | `#118658` | `oklch(0.74 0.14 158)` |
| `--primary-subtle` / `--primary-subtle-foreground` | 선택된 행, 현재 메뉴 바탕, 메뉴 배지 | `#E3F5EE` / `#0E7A50` (v4) | `oklch(0.26 0.045 158)` / `oklch(0.86 0.09 158)` |
| `--secondary` / `--secondary-foreground` | 보조 버튼, 사용자 말풍선 | `oklch(0.955 0.005 260)` / `oklch(0.25 0.01 260)` | `oklch(0.25 0.008 260)` / `oklch(0.95 0.004 260)` |
| `--muted` / `--muted-foreground` | 비활성 바탕 / 보조 글자(메타, 설명) | `oklch(0.955 0.005 260)` / `oklch(0.50 0.015 260)` #5e646c | `oklch(0.25 0.008 260)` / `oklch(0.72 0.012 260)` #a0a5ac |
| `--accent` / `--accent-foreground` | hover·포커스 행 바탕(shadcn 관례상 이름은 accent지만 **강조색이 아니다**) | `oklch(0.945 0.008 260)` / = foreground | `oklch(0.27 0.01 260)` / = foreground |
| `--destructive` / `--destructive-foreground` | 삭제·실패 | `oklch(0.54 0.20 27)` #c92324 / `oklch(0.99 0 0)` | `oklch(0.68 0.18 25)` #f3625d / `oklch(0.17 0.03 25)` |
| `--destructive-subtle` / `-subtle-foreground` | 실패 알림 바탕 / 글자 | `oklch(0.965 0.02 25)` / `oklch(0.45 0.17 27)` | `oklch(0.26 0.05 25)` / `oklch(0.84 0.09 25)` |
| `--success` / `--success-foreground` | 완료·충족·합격 **아이콘/글자** (채운 버튼 금지, 1.1.3) | `oklch(0.50 0.13 140)` #357426 / `oklch(0.99 0 0)` | `oklch(0.74 0.15 140)` #74c163 / `oklch(0.17 0.03 140)` |
| `--success-subtle` / `-subtle-foreground` | 완료 배지 바탕 / 글자 | `oklch(0.965 0.035 135)` / `oklch(0.40 0.10 140)` | `oklch(0.25 0.045 140)` / `oklch(0.86 0.11 140)` |
| `--warning` / `--warning-foreground` | 주의 아이콘·채운 배지 (흰 바탕 글자로 쓰지 않음) | `oklch(0.75 0.15 75)` #e49e22 / `oklch(0.25 0.05 60)` | `oklch(0.80 0.14 80)` / `oklch(0.22 0.05 60)` |
| `--warning-subtle` / `-subtle-foreground` | 변경됨·검토 필요·자리 표시·한도·작성 중 | `oklch(0.97 0.04 85)` / `oklch(0.45 0.10 60)` #7d460b | `oklch(0.27 0.045 75)` / `oklch(0.87 0.11 85)` |
| `--info` / `--info-foreground` | 안내 아이콘 | `oklch(0.55 0.13 240)` #0079b5 / `oklch(0.99 0 0)` | `oklch(0.72 0.11 240)` / `oklch(0.17 0.03 240)` |
| `--info-subtle` / `-subtle-foreground` | 복귀 배너, 진입 안내, 본인 역할 확인 중 | `oklch(0.965 0.02 240)` / `oklch(0.42 0.11 245)` | `oklch(0.26 0.04 240)` / `oklch(0.85 0.07 240)` |
| `--ai` / `--ai-foreground` | **AI 활동 전용**: 진행 중 아이콘, 스트리밍 커서, 진행 막대 | `oklch(0.53 0.19 295)` #774bcb / `oklch(0.99 0 0)` | `oklch(0.72 0.15 295)` #ac8ff8 / `oklch(0.17 0.03 295)` |
| `--ai-subtle` / `-subtle-foreground` | AI 진행 카드 바탕, 갱신 강조, 인용 구간 강조 | `oklch(0.965 0.02 295)` / `oklch(0.44 0.17 295)` | `oklch(0.27 0.05 295)` / `oklch(0.86 0.08 295)` |
| `--chip` / `--chip-foreground` / `--chip-border` | 근거 칩(C-01)·출처 발화 칩(C-15) | `oklch(0.955 0.006 260)` / = foreground / `#E2E2E2` (v4) | `oklch(0.26 0.008 260)` / = foreground / `oklch(0.36 0.01 260)` |
| `--border` | **외곽선(stroke) 기본색**: 구분선·카드·팝오버·메뉴 테두리 (v4) | `#E2E2E2` | `oklch(0.30 0.008 260)` |
| `--input` | 입력란·outline 버튼 테두리 = 외곽선 기본색 (v4, 1.4.11 3:1 미충족 — 8장 v4 메모) | `#E2E2E2` | `oklch(0.54 0.01 260)` #6b6f75 |
| `--ring` | 포커스 링 = primary (v4) | `#15A76E` | `oklch(0.66 0.12 158)` |
| `--sidebar` 외 | 셸 왼쪽 메뉴 | 아래 블록 | 아래 블록 |
| (v5) `--shell` / `--shell-foreground` | **L-02 전체 페이지 셸 바탕**(상단 바와 흰 본문 카드 바깥). Figma의 연한 민트 그레이 | `oklch(0.955 0.012 165)` #e9f3ee / = foreground | `oklch(0.165 0.006 165)` #0c0f0e / = foreground |
| (v5) `--panel` / `--panel-foreground` | **Resumate AI 패널 바탕**(L-02 본문 카드 안의 오른쪽 패널). 패널 안 빠른 버튼 칩은 `bg-muted`, 입력창은 `bg-card`라서 패널은 그 사이 밝기 | `oklch(0.972 0.003 260)` #f4f6f8 / = foreground | `oklch(0.235 0.007 260)` #1c1e21 / = foreground |
| `--stage-*` | 보드 단계 점(장식, 글자 없이 쓰지 않음) | 1.1.4 | 1.1.4 |
| `--chart-1..5` | 차트(현재 MVP 화면에 차트 없음, shadcn 기본 이름 유지) | 아래 블록 | 아래 블록 |

#### 1.1.2 `globals.css` 블록

```css
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

:root {
  --radius: 0.5rem;

  --background: #FFFFFF;
  --foreground: oklch(0.21 0.01 260);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.21 0.01 260);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.21 0.01 260);

  --primary: #15A76E;
  --primary-foreground: oklch(0.99 0 0);
  --primary-text: #118658; /* 초록 글자(링크·secondary/ghost·메뉴 hover) (v4) */
  --primary-subtle: #E3F5EE;
  --primary-subtle-foreground: #0E7A50;

  --secondary: oklch(0.955 0.005 260);
  --secondary-foreground: oklch(0.25 0.01 260);
  --muted: oklch(0.955 0.005 260);
  --muted-foreground: oklch(0.50 0.015 260);
  --accent: oklch(0.945 0.008 260);
  --accent-foreground: oklch(0.21 0.01 260);

  --destructive: oklch(0.54 0.20 27);
  --destructive-foreground: oklch(0.99 0 0);
  --destructive-subtle: oklch(0.965 0.02 25);
  --destructive-subtle-foreground: oklch(0.45 0.17 27);

  --success: oklch(0.50 0.13 140);
  --success-foreground: oklch(0.99 0 0);
  --success-subtle: oklch(0.965 0.035 135);
  --success-subtle-foreground: oklch(0.40 0.10 140);

  --warning: oklch(0.75 0.15 75);
  --warning-foreground: oklch(0.25 0.05 60);
  --warning-subtle: oklch(0.97 0.04 85);
  --warning-subtle-foreground: oklch(0.45 0.10 60);

  --info: oklch(0.55 0.13 240);
  --info-foreground: oklch(0.99 0 0);
  --info-subtle: oklch(0.965 0.02 240);
  --info-subtle-foreground: oklch(0.42 0.11 245);

  --ai: oklch(0.53 0.19 295);
  --ai-foreground: oklch(0.99 0 0);
  --ai-subtle: oklch(0.965 0.02 295);
  --ai-subtle-foreground: oklch(0.44 0.17 295);

  --chip: oklch(0.955 0.006 260);
  --chip-foreground: oklch(0.21 0.01 260);
  --chip-border: #E2E2E2;

  --border: #E2E2E2;
  --input: #E2E2E2;
  --ring: #15A76E;

  --stage-before-apply: oklch(0.62 0.01 260);
  --stage-document: oklch(0.60 0.13 240);
  --stage-assignment: oklch(0.62 0.12 200);
  --stage-job-interview: oklch(0.55 0.16 275);
  --stage-culture-fit-interview: oklch(0.62 0.15 350);
  --stage-closed: oklch(0.35 0.01 260);

  --chart-1: #15A76E;
  --chart-2: oklch(0.60 0.13 240);
  --chart-3: oklch(0.75 0.15 75);
  --chart-4: oklch(0.62 0.15 350);
  --chart-5: oklch(0.55 0.16 275);

  --sidebar: #F3FBF8; /* 앱 기본 바탕(사이드바·바깥 영역). 흰 --background 패널(sidebar-inset)을 감싼다 */
  --sidebar-foreground: oklch(0.21 0.01 260);
  --sidebar-primary: #15A76E;
  --sidebar-primary-foreground: oklch(0.99 0 0);
  --sidebar-accent: color-mix(in srgb, var(--primary) 10%, transparent); /* 메뉴 hover·선택 = ghost 버튼 */
  --sidebar-accent-foreground: var(--primary-text);
  --sidebar-border: #E2E2E2;
  --sidebar-ring: #15A76E;

  /* (v5) L-02 전체 페이지 셸 · Resumate AI 패널 — 셸 바탕은 L-01 앱 바탕(#F3FBF8)과 같다 */
  --shell: #F3FBF8;
  --shell-foreground: oklch(0.21 0.01 260);
  --panel: oklch(0.972 0.003 260);
  --panel-foreground: oklch(0.21 0.01 260);
}

.dark {
  --background: oklch(0.17 0.006 260);
  --foreground: oklch(0.95 0.004 260);
  --card: oklch(0.205 0.007 260);
  --card-foreground: oklch(0.95 0.004 260);
  --popover: oklch(0.23 0.008 260);
  --popover-foreground: oklch(0.95 0.004 260);

  --primary: oklch(0.74 0.14 158);
  --primary-foreground: oklch(0.18 0.03 158);
  --primary-text: oklch(0.74 0.14 158);
  --primary-subtle: oklch(0.26 0.045 158);
  --primary-subtle-foreground: oklch(0.86 0.09 158);

  --secondary: oklch(0.25 0.008 260);
  --secondary-foreground: oklch(0.95 0.004 260);
  --muted: oklch(0.25 0.008 260);
  --muted-foreground: oklch(0.72 0.012 260);
  --accent: oklch(0.27 0.01 260);
  --accent-foreground: oklch(0.95 0.004 260);

  --destructive: oklch(0.68 0.18 25);
  --destructive-foreground: oklch(0.17 0.03 25);
  --destructive-subtle: oklch(0.26 0.05 25);
  --destructive-subtle-foreground: oklch(0.84 0.09 25);

  --success: oklch(0.74 0.15 140);
  --success-foreground: oklch(0.17 0.03 140);
  --success-subtle: oklch(0.25 0.045 140);
  --success-subtle-foreground: oklch(0.86 0.11 140);

  --warning: oklch(0.80 0.14 80);
  --warning-foreground: oklch(0.22 0.05 60);
  --warning-subtle: oklch(0.27 0.045 75);
  --warning-subtle-foreground: oklch(0.87 0.11 85);

  --info: oklch(0.72 0.11 240);
  --info-foreground: oklch(0.17 0.03 240);
  --info-subtle: oklch(0.26 0.04 240);
  --info-subtle-foreground: oklch(0.85 0.07 240);

  --ai: oklch(0.72 0.15 295);
  --ai-foreground: oklch(0.17 0.03 295);
  --ai-subtle: oklch(0.27 0.05 295);
  --ai-subtle-foreground: oklch(0.86 0.08 295);

  --chip: oklch(0.26 0.008 260);
  --chip-foreground: oklch(0.95 0.004 260);
  --chip-border: oklch(0.36 0.01 260);

  --border: oklch(0.30 0.008 260);
  --input: oklch(0.54 0.01 260);
  --ring: oklch(0.66 0.12 158);

  --stage-before-apply: oklch(0.62 0.01 260);
  --stage-document: oklch(0.70 0.11 240);
  --stage-assignment: oklch(0.72 0.10 200);
  --stage-job-interview: oklch(0.70 0.13 275);
  --stage-culture-fit-interview: oklch(0.72 0.13 350);
  --stage-closed: oklch(0.80 0.01 260);

  --chart-1: oklch(0.74 0.14 158);
  --chart-2: oklch(0.70 0.11 240);
  --chart-3: oklch(0.80 0.14 80);
  --chart-4: oklch(0.72 0.13 350);
  --chart-5: oklch(0.70 0.13 275);

  --sidebar: oklch(0.235 0.008 260); /* sidebar-08 inset 바탕(다크): shadcn처럼 --background 패널보다 한 단계 밝게 */
  --sidebar-foreground: oklch(0.95 0.004 260);
  --sidebar-primary: oklch(0.74 0.14 158);
  --sidebar-primary-foreground: oklch(0.18 0.03 158);
  --sidebar-accent: color-mix(in srgb, var(--primary) 10%, transparent);
  --sidebar-accent-foreground: var(--primary-text);
  --sidebar-border: oklch(0.33 0.008 260);
  --sidebar-ring: oklch(0.66 0.12 158);

  /* (v5) L-02 전체 페이지 셸 · Resumate AI 패널 (다크: 셸은 카드보다 어둡게, 패널은 카드보다 밝게) */
  --shell: oklch(0.165 0.006 165);
  --shell-foreground: oklch(0.95 0.004 260);
  --panel: oklch(0.235 0.007 260);
  --panel-foreground: oklch(0.95 0.004 260);
}

@theme inline {
  --font-sans: "Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont,
    system-ui, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

  --radius-sm: calc(var(--radius) - 4px);  /* 4px  칩·작은 배지 */
  --radius-md: calc(var(--radius) - 2px);  /* 6px  보드 카드·메뉴 항목 */
  --radius-lg: var(--radius);              /* 8px  카드·패널·다이얼로그·팝오버 */
  --radius-xl: calc(var(--radius) + 4px);  /* 12px 보드 열 */
  --radius-control: 12px;                 /* 12px 버튼·드롭다운·입력 (v4) */

  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-primary-text: var(--primary-text);
  --color-primary-subtle: var(--primary-subtle);
  --color-primary-subtle-foreground: var(--primary-subtle-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-destructive-subtle: var(--destructive-subtle);
  --color-destructive-subtle-foreground: var(--destructive-subtle-foreground);
  --color-success: var(--success);
  --color-success-foreground: var(--success-foreground);
  --color-success-subtle: var(--success-subtle);
  --color-success-subtle-foreground: var(--success-subtle-foreground);
  --color-warning: var(--warning);
  --color-warning-foreground: var(--warning-foreground);
  --color-warning-subtle: var(--warning-subtle);
  --color-warning-subtle-foreground: var(--warning-subtle-foreground);
  --color-info: var(--info);
  --color-info-foreground: var(--info-foreground);
  --color-info-subtle: var(--info-subtle);
  --color-info-subtle-foreground: var(--info-subtle-foreground);
  --color-ai: var(--ai);
  --color-ai-foreground: var(--ai-foreground);
  --color-ai-subtle: var(--ai-subtle);
  --color-ai-subtle-foreground: var(--ai-subtle-foreground);
  --color-chip: var(--chip);
  --color-chip-foreground: var(--chip-foreground);
  --color-chip-border: var(--chip-border);
  --color-shell: var(--shell);                       /* (v5) */
  --color-shell-foreground: var(--shell-foreground); /* (v5) */
  --color-panel: var(--panel);                       /* (v5) */
  --color-panel-foreground: var(--panel-foreground); /* (v5) */
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-stage-before-apply: var(--stage-before-apply);
  --color-stage-document: var(--stage-document);
  --color-stage-assignment: var(--stage-assignment);
  --color-stage-job-interview: var(--stage-job-interview);
  --color-stage-culture-fit-interview: var(--stage-culture-fit-interview);
  --color-stage-closed: var(--stage-closed);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);

  --animate-field-flash: field-flash 1.2s ease-out;
  --animate-caret-blink: caret-blink 1s steps(2, start) infinite;
}

@keyframes field-flash {
  0%   { background-color: var(--ai-subtle); }
  100% { background-color: transparent; }
}
@keyframes caret-blink {
  to { visibility: hidden; }
}

@layer base {
  * { @apply border-border outline-ring/50; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    @apply bg-background text-foreground font-sans text-base antialiased;
    line-height: 1.6;
    word-break: keep-all;          /* 한국어 어절 단위 줄바꿈 */
    overflow-wrap: anywhere;       /* 긴 URL·영문 토큰 넘침 방지 */
    font-feature-settings: "ss06"; /* Pretendard: 숫자·영문 가독 */
  }
  .tabular { font-variant-numeric: tabular-nums; }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
  }
}
```

#### 1.1.3 색 사용 규칙

| 규칙 | 내용 |
|------|------|
| R-C1 강조색은 초록 하나 | `primary`는 주 버튼(화면당 1개), 현재 메뉴, 선택 상태, 링크, 포커스 링에만. 넓은 면을 칠하지 않는다(배경은 `primary-subtle`까지만) |
| R-C2 **primary ↔ success 구분** | 둘 다 초록 계열이므로 역할을 나눈다: `primary`(청록 쪽 158°)는 **조작할 수 있는 것**(버튼·선택·링크), `success`(연두 쪽 140°)는 **결과 상태**(완료·충족·합격·저장됨). `success`는 채운 버튼·채운 큰 면에 쓰지 않고, 항상 `success-subtle` 배지 또는 아이콘 + 글자(`CircleCheck` 등)로만 쓴다. 성공 배지 옆에 primary 버튼이 와도 아이콘·글자로 구분된다 |
| R-C3 AI 보라는 AI 활동 전용 | `ai`·`ai-subtle`은 AI가 지금 무언가 하는 중이거나(진행·스트리밍·정리 갱신) AI가 만든 결과의 출처 표시("AI 선택")에만. 일반 강조·장식에 쓰지 않는다. AI 실행 **버튼**은 primary(보라 아님) |
| R-C4 경고 노랑 | `warning` 자체는 흰 바탕 글자로 쓰지 않는다(대비 2.3:1). 글자는 `warning-subtle-foreground`, 아이콘은 `text-warning`(아이콘 옆에 반드시 글자) |
| R-C5 단계 점 | `--stage-*`는 8px 점으로만 쓰고, 단계 이름 글자를 항상 함께 둔다. 단계 색에 초록을 쓰지 않는다(primary·success와 겹침 방지). 전형 종료의 합격/불합격은 단계 색이 아니라 결과 배지(success / destructive subtle)로 |
| R-C6 상태 3요소 | 모든 상태 표시는 색 + 아이콘(lucide) + 글자. 색만 다른 표시는 금지 |
| R-C7 대비 | 아래 확인표 외의 조합을 새로 쓰면 AA(글자 4.5:1, 18.66px bold/24px 이상·아이콘·테두리 3:1) 확인 후 이 표에 추가 |
| R-C8 (v5) 주 버튼 예외 — 대화 보내기 | L-02 화면의 주 버튼은 상단 바 "저장하기" 하나다. Resumate AI 패널의 **보내기 원형 버튼**(`ArrowUp`)만 예외로 `default`(초록 채움)를 쓴다(Figma). 패널 안 다른 버튼(반영·수락·모두 반영·새 대화·본문 교체 등)은 `outline`·`ghost`·`secondary`만 쓴다. 그래서 화면에 초록 채움은 "저장하기"와 보내기 둘뿐이다 |
| R-C9 (v5) AI 패널 식별 아이콘 | `Sparkles size-4 text-ai`는 R-C3의 "AI 활동"에 더해 **Resumate AI 패널의 식별 표식**(패널 머리, 상단 바 [Resumate AI] 다시 열기 버튼, 좁은 화면의 "Resumate AI" 버튼, AI 메시지 아바타)에 쓸 수 있다. 버튼 바탕·글자는 보라로 칠하지 않는다 |

**대비 확인표** (계산값, OKLCH → sRGB)

| 조합 | Light | Dark |
|------|-------|------|
| foreground / background | 16.97 | 16.52 |
| muted-foreground / card · background · muted | 6.00 · 5.74 · 5.26 | 7.22 · 7.71 · 6.45 |
| muted-foreground / chip | 5.26 | 6.26 |
| primary-foreground / primary | 6.15 | 8.60 |
| primary / card (링크 글자) | 6.15 | 8.24 |
| primary-subtle-foreground / primary-subtle | 8.04 | 10.34 |
| success / card · success-subtle-fg / subtle | 5.70 · 8.08 | 8.18 · 10.69 |
| warning-subtle-fg / warning-subtle | 7.00 | 10.18 |
| warning-foreground / warning | 7.10 | 9.22 |
| info-subtle-fg / info-subtle | 7.58 | 9.88 |
| ai / card · ai-subtle-fg / ai-subtle | 5.76 · 7.57 | 6.88 · 9.77 |
| destructive / card · destructive-subtle-fg / subtle | 5.61 · 7.27 | 5.73 · 9.32 |
| input(테두리) / card | 3.36 | 3.54 |
| ring / card | 5.19 | 6.08 |
| (v5) foreground / shell · muted-foreground / shell | 15.61 · 5.28 | 16.63 · 7.76 |
| (v5) primary / shell (상단 바 저장하기 바탕 대비 — 버튼 경계) | 5.42 | 8.86 |
| (v5) foreground / panel · muted-foreground / panel | 16.34 · 5.53 | 14.41 · 6.72 |
| (v5) ai / panel (패널 식별 아이콘) · primary / panel (보내기 버튼 경계) | 5.31 · 5.67 | 6.40 · 7.67 |
| (v5) input(테두리) / panel (대화 입력창 테두리) | 3.10 | 3.29 |
| (v5) foreground / muted (빠른 버튼 칩·분류 칩 글자) · muted-foreground / muted (칩의 "미선택") | 15.54 · 5.26 | 13.83 · 6.45 |

#### 1.1.4 단계·결과 표시 매핑 (`application_projects.stage` / `stage_outcome`)

| 값 | 라벨 | 점 토큰 |
|----|------|---------|
| `before_apply` | 지원 전 | `bg-stage-before-apply` |
| `document` | 서류 전형 | `bg-stage-document` |
| `assignment` | 과제 전형 | `bg-stage-assignment` |
| `job_interview` | 직무 인터뷰 전형 | `bg-stage-job-interview` |
| `culture_fit_interview` | 컬처핏 전형 | `bg-stage-culture-fit-interview` |
| `closed` | 전형 종료 | `bg-stage-closed` |
| outcome `passed` | 최종 합격 | `Badge variant="success"` + `Trophy` |
| outcome `failed` | 불합격 | `Badge variant="destructive-subtle"` + `CircleX` |
| outcome null (closed일 때) | 결과 미기록 | `Badge variant="outline"` + `CircleHelp`, `text-muted-foreground` |

### 1.2 타이포그래피

- **폰트**: Pretendard Variable(한국어 우선). 자가 호스팅: `next/font/local`로 `PretendardVariable.woff2`(서브셋 아님, 약 2MB → dynamic-subset 판 권장)을 `src/app/fonts/`에 두고 `--font-sans` 앞자리로 연결한다 `[가정]`(8장 Q-1). 폴백은 1.1.2의 `--font-sans` 순서.
- **기준: 본문 16px**(사용자 결정 2026-10-24). 루트 `font-size`는 브라우저 기본(16px)을 바꾸지 않는다. Tailwind `text-base` = 16px가 기본 글자다.
- 한글 자간: 모든 크기에서 `tracking-normal`. `tracking-tight`는 숫자 전용 큰 글자(점수)에만 허용.
- 숫자: 개수·D-day·점수·글자 수·`n/40`·날짜는 `tabular-nums`(`.tabular` 또는 Tailwind `tabular-nums`).
- 줄바꿈: `word-break: keep-all`(base에 설정). 표 셀·칩처럼 좁은 곳은 `truncate` + `title`/Tooltip.

| 이름 | Tailwind | 크기 / 행간 | 굵기 | 용도 |
|------|----------|-------------|------|------|
| `display` | `text-[1.75rem] leading-9` | 28 / 36 | 700 | S-01 랜딩 제목만 |
| `page-title` | `text-2xl leading-8` | 24 / 32 | 700 (`font-bold`) | 화면 제목(H1) 1개 |
| `section-title` | `text-lg leading-7` | 18 / 28 | 600 | 카드·섹션 제목(H2), 다이얼로그 제목 |
| `subsection` | `text-base leading-6` | 16 / 24 | 600 | 연도 머리, 경력 머리, 필드 그룹 이름(H3) |
| `body` | `text-base leading-[1.6]` | 16 / 25.6 | 400 | **기본 UI 글자**: 목록 행, 폼 값, 버튼 글자(500) |
| `prose` | `text-base leading-[1.75]` | 16 / 28 | 400 | **긴 본문**: STAR 필드, 초안 편집기, 면접 질문·답변, AI 대화 메시지, 인사이트 서술 |
| `label` | `text-sm leading-5 font-medium` | 14 / 20 | 500 | 폼 라벨, 표 머리, 탭 |
| `meta` | `text-sm leading-5` | 14 / 20 | 400 | 보조 정보(기간, 마지막 활동, 사용량 안내, 저장 상태), `text-muted-foreground`와 함께 |
| `caption` | `text-xs leading-4` | 12 / 16 | 500 | 칩 라벨, 카운트 배지, 글자 수 표시. **12px 미만 금지** |
| `score` | `text-3xl leading-9 font-semibold tracking-tight tabular-nums` | 30 / 36 | 600 | S-22 세션 점수 |
| (v5) `doc-title` | `text-xl leading-8 font-bold` | 20 / 32 | 700 | **L-02 머리 제목 입력 칸**(S-10 프로젝트명, S-44 산출물 제목). Figma 20px bold. 입력 칸이라 `page-title`(24) 대신 쓴다. L-02 화면에는 `page-title`이 없다 |
| (v5) `star-heading` | `text-base leading-6 font-medium` + 영문 `font-normal text-muted-foreground` | 16 / 24 | 500 | S-10 STAR 칸 제목 "상황 Situation"(Figma 16px medium). 한글과 영문 사이는 공백 2칸 대신 `gap-2` |

- 버튼 글자: 기본 `text-sm font-medium`(shadcn 기본) 대신 **`size=default`는 `text-base`(16px)**, `size=sm`은 `text-sm`. 파운데이션이 `button.tsx`의 size variant에 반영한다.
- 입력란 글자: `text-base`(16px). iOS 확대 방지에도 필요(16px 미만이면 포커스 시 확대).

### 1.3 간격 · 반경 · 그림자 · 모션

**간격** (4px 격자, Tailwind 기본 단위 사용)

| 이름 | 값 | 용도 |
|------|----|------|
| `gutter-page` | `px-6 py-6` (24) / 좁은 화면 `px-4 py-4` (16) | 콘텐츠 영역 바깥 여백 |
| `gap-section` | `space-y-8` (32) | 화면 안 큰 섹션 사이 |
| `gap-block` | `space-y-4` (16) | 카드 안 블록, 폼 필드 사이 |
| `gap-field` | `space-y-1.5` (6) | 라벨 ↔ 입력 ↔ 도움말 |
| `pad-card` | `p-5` (20) / 촘촘한 카드 `p-4` (16) | 카드 안쪽 |
| `pad-row` | `px-3 py-2.5` | 목록 행, 트리 행(최소 높이 44px) |
| `gap-inline` | `gap-2` (8) / 칩 묶음 `gap-1` (4) | 아이콘-글자, 버튼 묶음 / 칩 사이 |

**반경**: `--radius: 0.5rem`. 칩·작은 배지 `rounded-sm`(4) · **버튼·드롭다운(Select 트리거·메뉴 상자)·입력(Input·Textarea·InputGroup) `rounded-control`(12, v4)** · 보드 카드·메뉴 항목 `rounded-md`(6) · 카드·패널·다이얼로그 `rounded-lg`(8) · 보드 열 `rounded-xl`(12) · 카운트 배지·아바타·단계 점 `rounded-full`. `[가정]`

**팝오버 안쪽 여백 (v4)**: Popover·DropdownMenu·Select 상자는 기본 `p-2`(8px). 외곽선은 `ring-1 ring-border`.

**색 덧씌우기 금지 (v4)**: shadcn 컴포넌트(Button·Badge·Card·Input·DropdownMenuItem·ToggleGroupItem 등)에 사용처에서 `className`으로 색(`text-*`·`bg-*`·`border-*`·`hover:bg-*`)을 덧씌우지 않는다. 다른 색이 필요하면 variant를 쓴다(예: 삭제 메뉴 항목은 `DropdownMenuItem variant="destructive"`). 예외: sticky 탭 바처럼 불투명 바탕이 기능상 필요한 경우의 `bg-background`, shadcn sidebar-08 블록 원본 코드인 `nav-user.tsx`의 `SidebarMenuButton data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground`(토큰만 쓴다).

v4 후속(UQ-708~722)으로 더한 variant·prop — 색이 필요하면 아래를 쓴다:

| 필요 | 쓰는 것 |
|------|---------|
| 삭제·버리기를 시작하는 ghost 버튼(삭제, 그래도 닫기) | `Button variant="destructive-ghost"` — `text-destructive`, hover·열림 `bg-destructive/10`(다크 `/20`). 확인 단계의 solid 버튼은 그대로 `destructive` |
| 빨간 오류 문장 안 링크(저장 실패 — 다시 시도) | `Button variant="destructive-link"` |
| 검토가 필요한 항목으로 보내는 경고 버튼 | `Button variant="warning-outline"` — `border-warning text-warning-subtle-foreground`, hover `bg-warning-subtle` |
| 아직 닿지 않은 단계(ghost 단계 버튼) | `Button variant="ghost"` + `data-pending` — hover 전까지 `text-muted-foreground` |
| 없음·근거 없음·중단·해당 없음·잠금·편집됨처럼 흐린 상태 배지 | `Badge variant="muted"` — `border-border text-muted-foreground` |
| 단계 색 옆의 중립 개수 알약(보드 열 머리) | `Badge variant="count-neutral"` — `bg-background text-muted-foreground` |
| 완료 카드(저장 완료 등) | `Card tone="success"` — `border-success/30` |
| 흐린 표 행(호출 0건 등) | `TableRow muted` |
| 경고·오류 Alert의 아이콘 색 | `Alert variant="warning"`(아이콘 `text-warning`) · `variant="destructive"`(아이콘 `text-destructive`) — variant가 정한다. 사용처에서 `*:[svg]:text-*`를 붙이지 않는다 |
| 경고 배너(작성 중·실패 세션 안내 등) | `Alert variant="warning"`. Card에 경고색을 덧씌우지 않는다 |

**클릭 가능한 항목은 공통 컴포넌트로 (v4)**: hover·선택 색은 모두 `bg-primary/10` + `text-primary-text`(초록)이고, 화면에서 직접 지정하지 않는다.

| 대상 | 쓰는 것 |
|------|---------|
| 목록 행·설정 진입 줄·카드형 선택지 | `Item` (`components/ui/item.tsx`). `variant`: `ghost`(기본, `rounded-xl`) / `row`(`divide-y rounded-md border` 목록 안 행. 각지지만 첫 행·마지막 행은 목록 모서리를 따라 둥글다 — 목록에 `overflow-hidden`을 넣지 않아 포커스 링이 잘리지 않는다) / `outline`(테두리 카드). `size`: `default`(min-h-11) / `sm` / `lg`(p-4) / `none`. 선택 상태는 `active` — `data-active`와 함께 `aria-current="true"`를 붙인다(사용처가 넘긴 값이 있으면 그것). 링크는 `asChild`이고, 링크형을 막을 때는 `aria-disabled`(흐림 + 클릭 막음). `data-slot`·`data-variant`·`data-active`는 사용처 props로 덮이지 않는다. 바로 아래 svg는 기본 muted, hover·선택 시 초록. 클릭할 수 없는 선택지(멈춘 공급자 등)는 Item으로 감싸지 않고 카드 자체 상태로만 보인다 |
| 링크가 덮는 카드 전체 | `Card interactive` |
| 클릭하면 상세로 가는 표 행 | `TableRow interactive` (cursor-pointer + 초록 hover). **hover는 interactive 행에만** 있다 — 일반 행은 hover에 반응하지 않는다 |
| 단계·탭처럼 현재 위치를 가진 ghost 버튼 | `Button variant="ghost"` + `aria-current` |
| 토글 선택 | `Toggle`·`ToggleGroupItem` 기본값(`data-[state=on]` 초록, outline이면 테두리도 primary) |

예외(전용 모양 유지): 근거 칩(C-01·C-15), 공급자 배지(C-19), 초안 편집기 블록 hover, 보드 카드 손잡이, 채팅 사용자 말풍선 버튼(S-36, `focus-visible:ring-2` 있음), 빈 긴 글 자리 글자 "내용을 입력해주세요"(C-24, muted 글자 + 포커스 링). 본문 텍스트 링크(브레드크럼·동의·정책 뒤로 가기 등)는 줄 단위 항목이 아니므로 `underline` + `hover:text-foreground`를 허용한다.

hover와 선택은 같은 `bg-primary/10`이다(사용자 결정, UQ-715). 선택 행은 `font-medium`(+ `aria-current`)으로만 구분된다.

(v5) L-02에서 더하는 반경(Figma): **본문 카드 `rounded-2xl`**(16, Tailwind 기본값 — `@theme`이 2xl을 덮어쓰지 않음) · **Resumate AI 패널 `rounded-xl`**(12) · 머리 분류 칩·빠른 버튼 칩·역량 칩 `rounded-full` · 대화 입력창 `rounded-3xl`(24, 여러 줄이 돼도 알약 모양 유지). 버튼·입력·드롭다운은 v4 브랜드 토큰 `rounded-control`(12)을 따른다(머지 2026-11-03, Q-7 해소).

**그림자(높이)** — 기본은 테두리로 구분하고 그림자는 떠 있는 것에만.

| 단계 | 클래스 | 용도 |
|------|--------|------|
| e0 | `border` (그림자 없음) | 카드, 패널, 표, 보드 카드(정지) |
| e1 | `shadow-sm` | 고정 상단 바(스크롤 시), 보드 카드 hover |
| e2 | `shadow-md` | DropdownMenu, Popover, Tooltip, Select 목록 |
| e3 | `shadow-lg` | Dialog, AlertDialog, Sheet, **드래그 중 보드 카드** |

다크 모드에서도 같은 클래스를 쓰되 떠 있는 면은 `--popover`(바탕보다 밝음)로 구분된다.

**모션**

| 이름 | 값 | 용도 |
|------|----|------|
| `motion-fast` | `transition-colors duration-150 ease-out` | hover, press, 포커스 |
| `motion-overlay` | shadcn 기본(`tw-animate-css` fade/zoom/slide, 약 200ms) | Dialog, Sheet, Dropdown |
| `motion-layout` | `transition-[height,opacity] duration-200 ease-out` | Collapsible 펼침(트리, 근거 펼치기) |
| `animate-field-flash` | 1.2s, `--ai-subtle` → 투명 | S-36 정리 결과 필드 갱신 강조, C-15 칩 클릭 시 대상 강조 |
| `animate-caret-blink` | 1s 깜빡임 | C-04 스트리밍 커서 |
| `animate-spin` | lucide `Loader2` | 진행 중 아이콘 |
| 지연 표시 | 로딩 표시는 **300ms 뒤**부터 | 빠른 응답에서 깜빡임 방지 |

`prefers-reduced-motion: reduce`에서는 모든 애니메이션을 끈다(1.1.2 base). 스트리밍 커서는 정지된 `▍`로, field-flash는 1회 배경 표시 없이 왼쪽 2px `ai` 테두리 2초로 대체한다.

### 1.4 브레이크포인트와 레이아웃 폭

Tailwind 기본 브레이크포인트를 그대로 쓴다.

| 폭 | 이름 | 바뀌는 것 |
|----|------|-----------|
| < 768 | 좁은 화면(모바일) | 보드 → 열 탭(T-8), 표 → 카드 목록, Sheet 전체 폭, 버튼 묶음 세로 쌓기 |
| 768~1023 | `md` | 셸은 아직 서랍(상단 바), 보드는 가로 열(보드 영역 안 가로 스크롤) |
| ≥ 1024 | `lg` | **셸 왼쪽 메뉴 고정 표시**(shadcn Sidebar의 모바일 기준을 1024로: `use-mobile.ts`의 `MOBILE_BREAKPOINT = 1024`) |
| ≥ 1280 | `xl` | S-36 2단(대화 / 정리 결과), S-19 오른쪽 패널 고정 |

| 폭 토큰 | 값 | 용도 |
|---------|----|------|
| `w-sidebar` | 16rem (256px), 아이콘 레일 3.5rem | 왼쪽 메뉴 (`--sidebar-width: 16rem`, 5.1 메뉴 크기) |
| `h-topbar` | `h-16` (64px) | 상단 바(사이드바 토글 · 이동 경로), 본문 패널 안에서 `sticky top-0` |
| `max-w-prose-edit` | `max-w-[42rem]` (672px, 16px 한글 약 42자) | 긴 글 편집·읽기 열 (S-35 필드, S-19 문서, S-33 답변, 대화 메시지 열) |
| `max-w-form` | `max-w-3xl` (768px) | 일반 폼 화면(S-04, S-09, S-10, S-34, S-14, S-20, S-24) |
| `max-w-page` | `max-w-6xl` (1152px) | 목록·허브 화면(S-08, S-13, S-31, S-37) |
| 전체 폭 | 제한 없음 | S-39 보드, S-36 대화(2단) |
| `w-side-panel` | `w-80` (320px) / `2xl:w-96` | S-19 오른쪽 패널 |
| `w-sheet` | `sm:max-w-md` (448px) | C-02 근거 패널 등 오른쪽 Sheet |
| (v5) `h-shellbar` | `h-14` (56px) | L-02 상단 바 |
| (v5) `w-ai-panel` | 기본 `26.25rem`(420px, Figma) · 최소 `22.5rem`(360) · 최대 `40rem`(640) 그리고 본문 카드 폭의 50% 이하 | L-02 Resumate AI 패널. 사용자가 손잡이로 바꾼 값은 브라우저에 기억(5.8) |
| (v5) `min-w-doc-left` | `28rem`(448px) | L-02 왼쪽 입력 영역의 최소 폭. 패널이 최대 폭이어도 이 폭은 남긴다 |
| (v5) `max-w-doc` | `max-w-prose-edit`(42rem)과 같음 | L-02 왼쪽 STAR·본문 글 폭. 왼쪽 영역이 넓어도 글 줄은 42rem에서 멈추고 왼쪽 정렬(제목 시작선과 맞춤) |

(v5) **L-02 폭 기준**: ≥ 1024에서 본문 2단(왼쪽 입력 | 손잡이 | 패널). 1024 미만은 한 단이고 패널은 시트로 연다(5.8 좁은 화면). 768 미만은 본문 카드의 바깥 여백과 둥근 모서리를 없앤다.

---

## 2. 컴포넌트 인벤토리

`npx shadcn add`로 가져오는 primitive와 이 문서가 정한 커스텀 variant. **새 primitive가 필요하면 ui-designer에게 먼저 묻는다.**

| shadcn 컴포넌트 | 쓰는 곳 | 커스텀 variant / 규칙 |
|-----------------|---------|----------------------|
| `button` | 전부 | variant: `default`(primary, 화면당 주 버튼 1개) · `secondary` · `outline` · `ghost`(`aria-current` 선택, `data-pending` 흐림) · `link` · `destructive` · (v4) `destructive-ghost`(삭제를 시작하는 ghost, 빨간 글자 + `bg-destructive/10` hover) · (v4) `destructive-link`(빨간 오류 문장 안 링크) · (v4) `warning-outline`(경고 테두리 버튼). size: `sm`(h-8, text-sm) · `default`(h-10, text-base) · `lg`(h-11) · `icon`(size-9) · `icon-sm`(size-8). 좁은 화면에서 터치 대상은 최소 44px(`h-11` 또는 `min-h-11` 감싸기). 로딩: `disabled` + 왼쪽 `Loader2 animate-spin` + 글자 유지 |
| `badge` | 상태·카운트·칩 | 추가 variant: `success` · `warning` · `info` · `ai` · `destructive-subtle` (모두 `bg-{x}-subtle text-{x}-subtle-foreground border-transparent`) · `draft`(= warning, 아이콘 `CircleDashed`) · `count`(rounded-full, `min-w-5 h-5 px-1.5 text-xs tabular-nums bg-primary-subtle text-primary-subtle-foreground`) · `evidence`(3.1) · (v2) `recommend`(`bg-primary-subtle text-primary-subtle-foreground border-transparent`, S-40 "추천: 무료로 시작") · (v4) `muted`(`border-border text-muted-foreground`, 없음·근거 없음·중단·해당 없음 같은 흐린 상태) · (v4) `count-neutral`(`count` 모양 + `bg-background text-muted-foreground`, 보드 열 머리 개수) |
| `card` | 카드·패널 | 기본 `rounded-lg border bg-card`, 그림자 없음(shadcn 기본 `shadow-sm` 제거). (v4) `interactive`(전체 클릭 카드 초록 hover) · `tone="success"`(완료 카드 `border-success/30`) |
| `sidebar` | L-01 | `collapsible="offcanvas"`, 모바일 기준 1024 |
| `breadcrumb` | L-01 상단 이동 경로 | |
| `sheet` | C-02, 좁은 화면 서랍, S-19/S-36 보조 패널 | side `right`(패널), `left`(메뉴 서랍), `bottom`(좁은 화면의 짧은 선택) |
| `dialog` | S-11, C-13, C-14, C-16, 저장 확인(S-36) | `sm:max-w-lg`(기본) / `sm:max-w-md`(C-14). 본문 길면 `max-h-[85dvh] overflow-y-auto` |
| `alert-dialog` | C-05, 되돌릴 수 없는 확인(다시 생성 덮어쓰기, 결과 지우기) | 확인 버튼 `variant="destructive"`(삭제) 또는 `default`(덮어쓰기) |
| `alert` | C-20 한도·오류 안내, 공급자 장애 배너, S-42 상시 고지, 안내 | 추가 variant: `info` · `warning` · `destructive`(subtle 바탕) · `ai`. (v4) `warning`·`destructive`는 아이콘 색(`text-warning`·`text-destructive`)도 정한다 |
| `dropdown-menu` | 행·카드 메뉴(⋯), C-12 | C-12는 `DropdownMenuRadioGroup` |
| `popover` | 칩 미리보기 없음 — 사용하지 않음(칩은 Sheet로) | 필터 묶음에만 |
| `tooltip` | 아이콘 버튼 이름, 잘린 칩 라벨 | 지연 500ms. 정보를 Tooltip에만 두지 않는다 |
| `tabs` | S-31 하위 탐색 보조, 좁은 화면 보드 열 탭, S-36 좁은 화면 전환, S-20 유형 | |
| `toggle-group` | S-20 질문 수 3/5/7 | |
| `radio-group` | C-05 선택지, S-20 면접 유형(카드형) | 카드형 옵션: `rounded-lg border p-4 has-[:checked]:border-primary has-[:checked]:bg-primary-subtle` |
| `checkbox` | C-11 체크 트리, C-05 확인 체크 | |
| `input` · `textarea` · `label` · `form` · `select` | 모든 폼 | Textarea: `field-sizing-content min-h-24 max-h-[60vh]`(지원하지 않는 브라우저는 `min-h`로 고정 + 세로 크기 조절) |
| `collapsible` | S-08 트리, 근거 펼치기, 점수 근거 펼치기 | |
| `command` | C-16 검색 목록 | |
| `table` | S-13(넓은 화면), S-37, S-22 항목 표 | 행 높이 `h-12`, 머리 `text-sm font-medium text-muted-foreground` |
| `progress` | C-03 | 막대 색 `bg-ai`, 트랙 `bg-ai-subtle`, 높이 `h-1.5` |
| `skeleton` | ST-LOADING | |
| `sonner` | 토스트 | 넓은 화면 `bottom-right`, 좁은 화면 `top-center`. `richColors` 끔(중립 토스트 + 아이콘). (v5) L-02에서는 넓은 화면도 `bottom-left`로 띄운다 — 오른쪽 아래가 Resumate AI 입력창이라 가리지 않게 `[가정]` |
| (v5) `button` 추가 variant | L-02·AI 패널 | `chip`: `h-8 rounded-full border-transparent bg-muted px-3 text-sm font-normal text-foreground hover:bg-accent` (빠른 버튼 칩, Figma 회색 채움 알약) · `chip-dashed`: `chip`과 같되 `border border-dashed border-input bg-transparent hover:bg-accent` (`missing_slots` 슬롯 묻기). 두 variant 모두 `max-md:h-11`(A-4) |
| (v5) `select` 추가 trigger variant | S-10 머리 분류 | `SelectTrigger variant="chip"`: `h-8 w-auto gap-1 rounded-full border-transparent bg-muted px-3 text-sm hover:bg-accent data-[placeholder]:text-muted-foreground [&>svg]:size-3.5`. 기존 테두리형은 `variant="default"`(기본값) |
| `separator` · `scroll-area` | 구분선, 보드·대화 스크롤 | |

쓰지 않는 것: `drawer`(vaul 추가 의존성 → `sheet side="bottom"`으로 대체), `calendar`/date picker(react-day-picker 의존 → 날짜는 `Input type="date"`, 월은 1.2의 "연·월 선택" 패턴) `[가정]`, `hover-card`, `carousel`, 차트 라이브러리.

**공통 커스텀 패턴** (`components/common/`, 파운데이션 소유)

| 이름 | 구성 | 설명 |
|------|------|------|
| `MonthField` | `Select`(연) + `Select`(월) 가로 배치, `gap-2` | `start_month`/`end_month`. "재직 중"·"재학 중"은 옆 `Checkbox`, 체크 시 종료월 `disabled` |
| ~~`UsageHint`~~ | **v2 삭제** | 서비스 횟수 안내가 없어졌다(D-34). 대체: `AiRunButton`(3.22) |
| `AiRunButton` | 실행 `Button` + `ProviderBadge` (+ 다시 하기 주석) | 모든 AI 실행 버튼(3.22) |
| `ProviderBadge` · `ProviderResultTag` | `Badge` / `caption` 글자 + `Tooltip` | C-19 (3.19) |
| `AiLock` | `Card` 영역형 / 점선 줄 인라인형 / `Dialog` 팝업형 | C-18 (3.18) |
| `AiErrorNotice` · `RetryButton` | `Alert` block / inline / field | C-20 (3.20) |
| `DataUseConsent` · `FreeTierNotice` | `Checkbox` + 강조 상자 | C-21 (3.21) |
| `ProviderCard` · `StepIndicator` | `RadioGroup` 카드 / 단계 원 | S-40·S-41 (5.7) |
| `StatusDot` | `span.size-2 rounded-full bg-stage-*` | 단계 점 |
| `DDay` | `caption`/`meta`, `tabular-nums` | `D-12`, 3일 이내 `Badge warning` "D-2" + `Clock`, 지남 `text-muted-foreground` "마감" |
| `PageHeader` | `page-title` + 오른쪽 동작 묶음 + 아래 `meta` 설명 | 모든 화면 맨 위 |
| `EmptyState` · `ErrorState` · `AiProgress` | 4장 | v2: `AiFailed` → `AiErrorNotice`(C-20), `LimitNotice` 삭제(ST-LIMIT 폐기) |
| (v5) `PageShell` (`shell/page-shell.tsx`) | `--shell` 바탕 + `ShellBar` + 본문 카드 | **L-02** 전체 페이지 셸(5.8). `(dashboard)` 레이아웃의 사이드바 없이 그린다 |
| (v5) `ShellBar` · `SaveButton` | 로고 · [Resumate AI] · `SaveButton` + C-06 · 계정 메뉴 | L-02 상단 바(5.8). `SaveButton`은 저장하기 6상태(5.8 표) |
| (v5) `CrumbRow` | `Button size="icon-sm" variant="secondary" rounded-full`(←) + `Breadcrumb` | L-02 이동 줄 |
| (v5) `LeaveGuard` | `AlertDialog` 3동작 + `beforeunload` | L-02 이탈 확인(5.8) |
| (v5) `DocTitleInput` · `DocTextarea` | 테두리 없는 `input` / `Textarea` | L-02 문서형 입력(5.9, A-13 예외) |
| (v5) `FieldRows` · `ChipSelect` · `CompetencyChips` | `dl` 2열 + `Select variant="chip"` / `DropdownMenu` 체크 항목 + 칩 | S-10 머리 필드(5.9) |
| (v5) `ResizeHandle` | `div role="separator"` | L-02 2단 너비 조절(5.9, A-14) |
| (v5) `AiPanel` (`components/career/ai-panel/`, A2 소유 — 지금은 S-10·S-44만 쓴다) | 머리 · 기록 목록 · 메시지 · 제안 독 · 칩 줄 · 입력창 | S-10·S-44가 **같은 컴포넌트**를 쓰고, 제안 카드와 칩 계산만 넘긴다(5.10) |
| (v5) `StarProposalCard` · `DraftProposalCard` | `Card` 변형 + C-15 칩 | S-10(3.24) / S-44(3.25). 영역 소유(`components/career/`) |
| (v5) `SourceChip` | C-01 칩 모양 | C-15 출처 칩 4종 라벨(3.14 v4) — 기존 C-15 칩을 이 이름으로 공통화 |

---

## 3. 공통 컴포넌트 패턴 (C-01 ~ C-21, (v5) C-23 · S-10/S-44 제안 카드)

### 3.1 C-01 근거 칩

- 구성: `<button>` + `Badge variant="evidence"` + (상태 아이콘) + `Tooltip`(라벨이 잘렸을 때 전체 라벨).
- **하나의 칩 모양**(C-15와 공유):

```
inline-flex items-center gap-1 h-6 max-w-[16rem] rounded-sm border border-chip-border bg-chip px-1.5
text-xs font-medium text-chip-foreground align-middle
hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1
```

- 라벨: `{종류}` + 가운데점 + `{source_label}`. 종류 부분은 `text-muted-foreground`, `source_label`은 기본 색 + `truncate`. 예: `상세 내용 · 행동 · 결제 API 응답 속도 개선`.
- **종류 아이콘을 두지 않는다.** "회고 및 배운 점" 칩을 라벨로만 구분해야 하므로(명세 규칙), 어떤 종류에도 종류별 아이콘·색을 붙이지 않는다.
- 상태:

| 상태 | 모습 |
|------|------|
| 정상 | 위 기본 |
| 변경됨 | `border-warning bg-warning-subtle text-warning-subtle-foreground` + 앞에 `RefreshCw size-3` + 라벨 끝에 " · 변경됨" |
| 원본 삭제됨 | `border-dashed bg-transparent text-muted-foreground` + 앞에 `Unlink size-3` + 라벨 끝에 " · 원본 삭제됨". 클릭은 가능(C-02에서 삭제 안내) |

- 배치: 본문 안에서는 문장 끝 뒤 `ml-1`, 여러 개면 블록 아래 `mt-2 flex flex-wrap gap-1`. 표 셀에서는 최대 2개 + "+N"(`Badge variant="outline"` 같은 높이) → 클릭 시 C-02에서 전부.
- 접근성: `aria-label="근거: {전체 라벨}{, 변경됨}"`, 클릭 → C-02 열고 포커스 이동.

### 3.2 C-02 근거 패널

- 구성: `Sheet side="right"` `sm:max-w-md`(좁은 화면 전체 폭). 머리 `section-title` "근거" + 닫기.
- 고지 "입력된 데이터 기준 판단입니다"는 머리 아래 `meta text-muted-foreground` + `Info size-4`.
- 근거 카드(목록, `space-y-3`): `Card p-4`
  - 1행: 칩과 같은 라벨(칩 모양 그대로, 클릭 동작 없음).
  - 2행: 경로 `meta text-muted-foreground`, 구분자 `›`, `truncate`는 쓰지 않고 줄바꿈.
  - 3행: `quote` 있으면 `blockquote border-l-2 border-chip-border pl-3 prose`(16px/1.75). 없으면 "원본 현재 값" `caption` 라벨 + 값.
  - 4행: `Button variant="link" size="sm"` "원본으로 이동" + `ArrowUpRight`.
  - 변경됨: 카드 위쪽에 `Badge warning` "변경됨" + `meta` 설명. 원본 삭제됨: `Alert` 없이 카드 안 `text-muted-foreground` + `Unlink` "원본 삭제됨 — 이 근거의 원본과 인용문은 삭제되었습니다", 인용·이동 없음.

### 3.3 C-03 AI 작업 상태 (비동기)

- 구성: `AiProgress` = `Card` + `Progress` + 단계 목록.

```
Card: rounded-lg border border-ai/30 bg-ai-subtle p-4
머리: flex items-center gap-2 — Loader2 size-4 animate-spin text-ai + "{작업 이름} 진행 중" (subsection, text-ai-subtle-foreground)
      오른쪽: "{done}/{total}" caption tabular-nums
Progress: h-1.5 bg-ai/15 [&>div]:bg-ai  (total 없으면 indeterminate: 막대 대신 단계 목록만)
단계 목록: ol space-y-1 text-sm — 완료 Check text-success / 현재 Loader2 animate-spin text-ai + font-medium / 대기 Circle text-muted-foreground
안내(meta): "화면을 나가도 계속 진행돼요. 끝나면 알려 드릴게요"  [가정: 문구 위치만, 문구는 명세 토스트와 짝]
```

- 단계 문구는 명세 키 그대로(`match` 요건 대조 중 …). 작업별 단계 목록은 03-ai-features C-6 순서.
- **부분 결과**: 진행 카드 아래에 이미 끝난 결과(인사이트 판정 표, 채점 끝난 답변 카드)를 정상 모습으로 그리고, 아직 없는 부분은 `Skeleton`.
- **축약형**(S-37 행, S-13 기능 진행 칸, 메뉴): `inline-flex items-center gap-1.5 text-sm text-ai-subtle-foreground` + `Loader2 size-3.5 animate-spin text-ai` + 단계 문구 + `2/5`.
- **완료 토스트**: Sonner 기본 + 왼쪽 `CircleCheck text-success` + 문구 + 액션 버튼 "보기". 메뉴 배지는 5.1.
- **(v2) 공급자 배지**: 진행 카드 머리 오른쪽, `{done}/{total}` 앞에 C-19 연결 배지를 둔다. 축약형에는 두지 않는다(행이 좁아서) `[가정]`.
- **(v2) 무료 등급 순차 모드** (활성 등급이 `free`일 때, D-37):
  - 현재 단계 글자에 처리 단위를 붙인다: "요건 대조 중 (2/6)", "답변 채점 중 (3/5)".
  - 머리 아래 `meta text-ai-subtle-foreground` 한 줄: "무료 등급이라 하나씩 처리해요 · {예상 시간} 정도 걸려요". 예상 시간은 유료 기준의 2배다(명세 문구).
  - **요청 한도 대기**(자동 재시도 중): 현재 단계 행의 아이콘을 `Loader2`에서 `Hourglass size-4 text-ai`로 바꾸고, 글자를 "공급자 요청 한도로 잠시 기다리는 중 (12초)"(`tabular-nums`, 1초마다 줄어듦)로 바꾼다. 진행 막대·카드 색은 그대로다. 오류색·경고색을 쓰지 않는 것은 실패가 아니기 때문이다. 축약형은 단계 문구 뒤에 " · 대기 12초"만 붙인다.
  - 남은 한도·남은 요청 수는 보이지 않는다(R-44). 대기 상한을 넘어 끝나면 C-20으로 바뀐다.
- **(v3) 단계 추가** (명세 C-03, AI v4.3 C-6):
  - `prepare`는 단계 목록 맨 앞 행이다. 글자는 작업마다 다르다. 인사이트·면접 질문 생성은 "공고 요건 정리 중", 채점(다시 채점 포함)은 "채점 준비 중"이다. 요건이 이미 있으면 바로 지나간다. 300ms 안에 끝나면 회전 아이콘 없이 바로 완료 체크로 그려 깜빡이지 않게 한다 `[가정]`.
  - `synthesize_regen`이 와도 **새 행을 더하지 않는다.** `synthesize` 행을 다시 현재 상태(`Loader2` + `font-medium`)로 되돌린다. 글자는 같은 "강점·지원 방향 정리 중"이다. 실행 도중 행 수가 바뀌지 않게 하려는 것이다 `[가정]`.
  - `complete`는 문구가 없고 행도 없다. 마지막 행의 글자를 그대로 둔다(면접 질문은 "질문 만드는 중 (N/N)", 채점은 "점수 계산 중"). 모든 행을 완료 체크로 바꾸고 막대를 100%로 채운다. 곧 결과 화면으로 바뀐다.
  - 면접 질문 `generate`의 글자에는 개수를 넣는다: "질문 만드는 중 (n/N)"(`tabular-nums`). 검사에 걸린 질문을 다시 만드는 동안 n이 멈춰도 따로 표시하지 않는다.
  - 작업별 단계 목록은 다음과 같다. 인사이트는 `prepare → match → synthesize → validate`, 면접 질문 생성은 `prepare → generate`, 채점은 `prepare → evaluate → summarize → score`이다.
- **(v3) 목록·카드의 기능 상태** (`AiFeatureStatus`, 명세 C-03 "진행 표시 우선순위"): S-13 기능 진행 칸, S-31 기능 카드, S-39 카드, S-16 머리에 쓴다. 아래 순서로 판정해 **한 모양만** 그린다.

| 순서 | 조건 | 모습 |
|------|------|------|
| ① 생성 중 | 그 기능의 작업이 대기·실행 중이다(이전 결과가 있어도) | C-03 축약형. 이전 결과의 요약·개수는 숨긴다 |
| ② 있음 | 진행 중인 작업이 없고 최신 결과가 있다 | 화면의 원래 모양(S-13 아이콘 + 숫자, S-31 상태 배지 + 요약) |
| ③ 없음 | 결과가 없다 | `text-sm text-muted-foreground` "없음"(화면 명세에 빈 문구가 있으면 그 문구) |
| 실패 | 결과는 "생성 중"인데 그 작업이 끝났거나 없다 | 아래 실패 한 줄. 지금 보이는 결과보다 **늦게** 끝난 실패만 보인다. 결과가 있으면 ② 모양 아래에 이 한 줄을 붙인다 |

- 실패 한 줄: `inline-flex items-center gap-1.5 text-sm` + C-20 톤 색 아이콘 `size-3.5` + 원인 제목 문장(톤의 subtle-foreground 색, `line-clamp-1`, 전체 문장은 `title`). 작업이 끝났는데 결과가 없거나 작업 자체가 없으면 `stalled`로 다룬다: broken 톤 `TimerOff` "시간이 오래 걸려 중단됐어요". 사용자가 취소한 작업은 아무것도 더 그리지 않는다(②·③ 그대로).
- 목록·카드의 실패 한 줄에는 버튼을 두지 않는다. 행이나 카드를 누르면 그 기능 화면으로 가고, 거기서 C-20 전체를 보인다 `[가정]`.

### 3.4 C-04 스트리밍 출력

- 생성 중 영역 머리: `Sparkles size-4 text-ai` + "작성 중…"(`text-ai-subtle-foreground text-sm font-medium`) + 오른쪽 `Button variant="outline" size="sm"` "중단"(`Square size-3.5`).
- 블록 상태:

| 이벤트 | 모습 |
|--------|------|
| (v3) `sources_selected` | 서류만 해당한다. C-11 카드가 먼저 나타난다(넓은 화면은 오른쪽 패널, 좁은 화면은 문항 카드 아래 `Collapsible`). 본문 블록 자리는 아직 `Skeleton`이다 |
| `block_started` / `block_delta` | 블록 왼쪽 `border-l-2 border-ai pl-3`, 글자 끝에 커서 `span.inline-block w-[0.5ch] animate-caret-blink text-ai` "▍". (v3) 이 블록은 **임시 블록**이라 hover 바탕·편집·복사가 없다 |
| `block_completed` | 왼쪽 테두리 사라짐(`border-transparent`), 근거 칩 자리에 `Skeleton h-6 w-24` 1개 |
| (v3) `adjusting_length` | 머리 글자를 C-03 축약형 "글자 수 맞추는 중 (현재 {n}자 / 제한 {limit}자)"(`tabular-nums`)로 바꾼다. 블록은 그대로 두고 커서는 지운다 |
| (v3) **마무리 중** (마지막 `block_completed` 또는 `adjusting_length` 뒤, `validated` 전) | 머리 글자를 `Loader2 size-4 animate-spin text-ai` + "마무리 중…"으로 바꾼다. 블록 글자는 그대로 읽힌다(`text-foreground`, 흐리게 하지 않음). 편집·복사 버튼은 `disabled`이고 블록 hover 바탕은 없다. 글자 선택은 막지 않는다 `[가정]`. "중단" 버튼은 `done`까지 남긴다 `[가정]` |
| `validated` | (v3) **그 문항의 블록을 통째로 교체**한다(경력기술서는 초안 전체). 임시 블록을 지우고 확정 블록을 한 번에 그린다. 교체 애니메이션은 없다. 교체 전에 화면 맨 위에 보이던 블록의 순번을 기억해 두었다가 교체 뒤 같은 자리로 맞춰 스크롤이 튀지 않게 한다. 이때 근거 칩·자리 표시·검증 배지(C-08)·생성 직후 안내 상자(6장 A3 S-19)가 붙고 편집·복사가 풀린다. `aria-busy`도 이때 푼다 |
| `done` | 머리 사라지고 C-06 저장 상태로 교체 |
| `error` | 자기소개서·면접 질문·대화는 마지막 블록 아래에 C-20 inline형(3.20)을 둔다. 이미 완료된 문항·질문·턴은 그대로 둔다. (v3) **경력기술서는 예외**다. 임시 블록을 모두 지우고 본문 자리에 C-20 block형을 둔다(6장 A3 "S-19 경력기술서 실패") |

- 아직 시작 안 된 블록(자소서 문항 등)은 `Skeleton` 3줄. 자소서의 "근거 선택 먼저" 단계는 C-03 축약형 "쓸 경력·프로젝트 고르는 중"을 먼저 보인다.
- 스크롤: 사용자가 위로 스크롤하지 않았을 때만 자동으로 따라 내려간다.
- 스크린 리더: 생성 영역 `aria-busy="true"`, 완료 시 `aria-live="polite"`로 "작성이 끝났어요" 한 번(글자 단위 낭독 금지).

### 3.5 C-05 삭제 확인 다이얼로그

- 구성: `AlertDialog` `sm:max-w-lg`.
- 제목: `section-title` "{대상} 삭제". 첫 줄 설명 `body`.
- 영향 요약: `rounded-md bg-muted p-3 text-sm space-y-1` — 연쇄 개수 목록(`ul list-disc pl-4`), 기업 JD별 영향은 `기업 JD 이름 — 인사이트 1 · 초안 2 · 면접 1` 형식, 숫자 `tabular-nums`.
- 선택지: `RadioGroup` 카드형(2장 radio-group 규칙), 기본값 선택된 상태, 설명 `meta`. 두 묶음(결과 처리 / 소속 프로젝트 처리)이면 각 묶음 위 `label`.
- 공통 안내: 선택지 아래 `meta text-muted-foreground` + `Info`.
- 기업 JD 삭제: 확인 `Checkbox` "삭제된 내용은 되돌릴 수 없어요를 확인했어요" `[가정: 체크 문구는 명세에 없음 → 기획 확인 필요 P-1]`, 체크 전 확인 버튼 `disabled`.
- 버튼: 오른쪽 정렬 `취소`(outline) · `삭제`(destructive). 좁은 화면 세로 쌓기, 삭제가 위.
- (v4) 다이얼로그를 여는 쪽(폼 하단 위험 영역, 초안·문항·성과 삭제, 저장 안 한 변경의 "그래도 닫기")은 `Button variant="destructive-ghost"`다. 메뉴 안 삭제 항목은 `DropdownMenuItem variant="destructive"`. 어느 화면에서나 파괴 동작은 빨간 글자다.
- 영향 조회 중: 요약 자리에 `Skeleton` 3줄, 삭제 버튼 `disabled`.

### 3.6 C-06 저장 상태 · C-07 입력 가이드

**C-06** — 화면 머리 오른쪽(또는 편집기 상단) `meta`, `aria-live="polite"`.

| 상태 | 모습 |
|------|------|
| 저장 중… | `Loader2 size-3.5 animate-spin` + `text-muted-foreground` |
| 저장됨 HH:MM | `Check size-3.5 text-success` + `text-muted-foreground` |
| 저장 실패 — 다시 시도 | `CircleAlert size-3.5 text-destructive` + `text-destructive` + `Button variant="destructive-link" size="sm"` "다시 시도" (v4: 빨간 문장 안 초록 링크 금지) |
| `status = 'draft'` | 위와 별도로 제목 옆 `Badge variant="draft"` "작성 중" + 아래 `Alert variant="warning"` 한 줄 "작성 중 — 필수 항목을 채우면 AI 분석에 반영돼요" |

- (v5) **L-02 화면**(S-10·S-44)에서는 C-06 글자가 상단 바 `SaveButton` 바로 왼쪽에 있고, 버튼 상태와 짝을 이룬다(5.8 표). `status = 'draft'` 배지·Alert는 L-02에 두지 않는다(명세 CR-11: 완료·작성 중 표시 없음).

**C-07** — 필드 아래 도움말 줄(`gap-field` 안), `meta text-muted-foreground` + 아이콘 `size-4 shrink-0 mt-0.5`. 경고처럼 보이지 않게 한다.

| 가이드 | 아이콘 | 비고 |
|--------|--------|------|
| G-1 본인 행동 | `UserRound` | |
| G-2 민감정보·기밀 | `ShieldAlert` | S-36 입력창 아래도 같은 모양 |
| G-3 정량 성과 권유 | `Lightbulb` | 끝에 `Button variant="link" size="sm"` "+ 정량 성과" |
| G-4 STAR 권유 | `Lightbulb` | 필드 placeholder가 아니라 도움말 줄에 예시 |

- 글자 수: 필드 오른쪽 아래 `caption tabular-nums text-muted-foreground` "1,240 / 2,000", 90% 넘으면 `text-warning-subtle-foreground`, 넘으면 `text-destructive`.

### 3.7 C-08 자리 표시·검증 배지

- **자리 표시 토큰**(`[수치 입력 필요]` 등 6종): 본문 안 `mark` 스타일 —
  `rounded-sm bg-warning-subtle px-0.5 text-warning-subtle-foreground underline decoration-dashed decoration-warning underline-offset-4`. 클릭/포커스 시 `Tooltip`에 `hint`. 토큰 글자는 그대로 보인다(색만으로 구분하지 않음).
- **블록 검증 배지**(블록 아래 칩 줄 맨 앞, `Badge` h-6 text-xs):

| 플래그 | 모습 |
|--------|------|
| `evidence_check_needed` "근거 확인 필요" | `Badge warning` + `SearchCheck` |
| `number_check_needed` "수치 확인 필요" | `Badge warning` + `Hash` |
| `user_modified` "편집됨 — 근거 재확인 권장" | `Badge variant="outline"` + `PenLine`, `text-muted-foreground` |
| "커리어에 추가하기" | `Button variant="link" size="sm"` + `Plus` |

- 복사 전 경고: `AlertDialog` "자리 표시 N개가 남아 있습니다" + `계속 복사`(default) / `취소`.

### 3.8 C-09 데이터 부족 게이트

- 막는 화면이 아니라 **안내 카드**로 그린다. 오류색 쓰지 않음.
- 구성: 실행 영역 자리에 `Card max-w-xl p-6 space-y-4`(가운데가 아니라 그 기능 화면의 본문 시작 위치).

```
아이콘: div.size-10 rounded-full bg-primary-subtle grid place-items-center > ClipboardList size-5 text-primary
제목: section-title (명세 문구)
부족 항목: ul space-y-2 — 각 행 flex gap-2: Circle size-4 text-muted-foreground (충족이면 CircleCheck text-success) + 문구 + 오른쪽 caption "현재 {n}건" tabular-nums
보조 안내(hints): meta text-muted-foreground + Info
주 버튼: AiRunButton — "AI와 대화하며 채우기"(Sparkles 아이콘은 붙이지 않음: AI 실행 버튼도 primary 규칙) + C-19 배지 / "경력 먼저 입력하기"(배지 없음)
보조 링크: Button variant="link" "직접 입력"
대안(S-20): Separator + meta "컬처핏 면접은 지금 바로 연습할 수 있어요" + Button variant="outline" size="sm"
안내: meta text-muted-foreground — "AI 분석은 실행하지 않았어요(토큰을 쓰지 않았어요)…" (명세 v5 문구)
```

- ~~한도 소진 분기~~: **v2 삭제**(U-8 월 10회 폐기). 대신 아래 분기를 쓴다.
- **(v2) 키 무효·대화 시작 실패**: 서버가 `next_action = 'form'`을 주거나 대화 첫 턴이 공급자 오류로 실패하면, 주 버튼을 "직접 입력하기"(default)로 바꾼다. 주 버튼 위에는 C-20 inline 한 줄(원인 문구)과 `Button variant="link" size="sm"` "AI 연결 확인"(→ S-40)을 둔다. 이미 진행 중인 대화가 있으면 "이어서 대화하기"(outline)를 그대로 남긴다.
- (v2) 키가 없을 때는 보통 이 카드 대신 C-18이 나온다. 데이터 부족만 알리는 경우에는 주 버튼을 "직접 입력하기"로 한다.
- **(v3) 이름·역할만 빠졌을 때** (hint `project_fields`, `next_action = 'form'` + `suggested_project_id`):
  - 보조 안내 줄은 다른 hint와 같은 `meta text-muted-foreground` + `Info`이고 명세 문구를 그대로 쓴다. 따옴표 안의 프로젝트 이름만 `font-medium text-foreground`로 둔다. 이름이 비어 있으면 "이름 없는 프로젝트"를 쓴다.
  - 주 버튼은 `Button default` "'{프로젝트명}' 마저 채우기"이고 앞에 `PenLine size-4`를 둔다. AI 실행이 아니므로 C-19 배지를 붙이지 않는다. 이름이 길면 이름 부분만 `max-w-[14em] truncate`로 줄이고, 전체 글자는 `aria-label`에 넣는다 `[가정]`.
  - 이 경우 "AI와 대화하며 채우기"는 보이지 않는다(명세: AI 작성 대화로 보내지 않음). "직접 입력" 보조 링크는 그대로 둔다.
  - 도착한 S-10의 강조 규칙은 6장 A2 "S-10"에 있다.

### 3.9 C-10 복귀 배너

- 위치: 커리어 영역 화면에서 상단 바 바로 아래, 콘텐츠 위 전체 폭, `sticky top-16 z-10`(상단 바 바로 아래).
- 모습: `flex items-center gap-3 border-b border-info/20 bg-info-subtle px-6 py-2.5 text-sm text-info-subtle-foreground` (좁은 화면 `px-4`, 두 줄 허용)
  - 왼쪽 `CornerUpLeft size-4` + "{회사명 – 포지션명} · {기능}으로 돌아가기"(`font-medium`)
  - 준비 상태: 충족 `Badge success` "준비됨" / 미충족 `Badge variant="outline"` "아직 필요 {n}개"
  - 오른쪽 `Button size="sm"`: 충족이면 `default` "돌아가기", 미충족이면 `outline` "돌아가기"
- 재판정 중: 준비 상태 배지 자리 `Loader2 size-3.5 animate-spin`.

### 3.10 C-11 사용한 경력·프로젝트

- 위치: S-19 오른쪽 패널(넓은 화면) / 문항 카드 아래 `Collapsible`(좁은 화면).
- 목록 행: `py-2 space-y-1 border-b last:border-0`
  - 1행 경로 `text-sm font-medium` "회사명 › 프로젝트명 › 상세 내용 제목" (원본 삭제 시 `source_label` + C-01 삭제 스타일 아이콘 `Unlink`, `text-muted-foreground`)
  - 2행 배지: `role` primary "주 근거" `Badge variant="secondary"` / supporting "보조" `Badge variant="outline"`; `origin` ai "AI 선택" `Badge variant="ai"` + `Sparkles size-3` / user "내가 추가" `Badge variant="outline"` + `UserRound size-3`
  - 3행 `rationale`·관련 요건·`reuse_reason`: `meta text-muted-foreground`
- 변경 트리: `Checkbox` 트리(`pl-6` 들여쓰기 단계), 변경되면 패널 아래 `Alert variant="info"` "근거를 바꿨어요" + `AiRunButton` "변경 사항으로 다시 생성"(다시 하기 주석 "다시 하면 공급자 토큰을 다시 써요" 포함, 3.22). 다시 생성 → `AlertDialog`(덮어쓰기 확인).
- 모두 제외: `Alert variant="warning"` 문구.
- 경력기술서 출처 `selection_origin`: 트리 위 `Badge`(insight "인사이트 우선순위" info / ai_ranking "AI가 고름" ai / user "직접 고름" outline).

### 3.11 C-12 단계 이동 메뉴

- 트리거: 보드 카드 `⋯`(`Button variant="ghost" size="icon-sm"` + `MoreHorizontal`, `aria-label="카드 메뉴"`) 안의 하위 메뉴 "단계 이동", 또는 S-31 헤더 **단계 칩**(`Button variant="outline" size="sm"` + `StatusDot` + 단계 이름 + `ChevronDown`).
- 내용: `DropdownMenuLabel` "단계 이동" → `DropdownMenuRadioGroup` 6단계(각 항목 앞 `StatusDot`, 현재 단계 체크) → `DropdownMenuSeparator` → "다음 단계로"(`ArrowRight`, 현재가 `closed`면 숨김).
- 이동 완료: `aria-live` 알림(시각 표시 없음) + 낙관적 반영.

### 3.12 C-13 전형 결과 선택 창

- `Dialog sm:max-w-md`. 제목 `section-title` "전형 결과를 기록할까요?".
- 선택지: 2열 큰 버튼 `grid grid-cols-2 gap-3`, 각 `Button variant="outline" className="h-auto flex-col gap-2 py-5"`:
  - 최종 합격: `Trophy size-6 text-success` + "최종 합격"
  - 불합격: `CircleX size-6 text-destructive` + "불합격"
- 아래 `Button variant="ghost"` "나중에 기록"(= 닫기). 닫으면 카드에 "결과 미기록" 배지(1.1.4).

### 3.13 C-14 인터뷰 전형 팝업

- `Dialog sm:max-w-md`. 아이콘 줄 없음. 제목 `section-title`, 설명 `body text-muted-foreground`.
- 버튼(오른쪽 정렬): `나중에`(ghost) · `면접 준비하기` 또는 `이어서 쓰기`(default).
- 작성 중 세션 안내: 설명 아래 `rounded-md bg-muted p-3 text-sm space-y-1.5`.
  - 1행 `font-medium` "이 기업 JD에 작성 중인 면접이 있어요"
  - 2행 `flex flex-wrap items-center gap-x-2 gap-y-1`: 유형 `Badge variant="outline"` + "n/N 작성" `tabular-nums` + (v3) `text-muted-foreground` "· 마지막 활동 {상대 시각}"
  - (v3) 3행 `generation_status`가 있을 때만 그린다. `generating`이면 `Loader2 size-3.5 animate-spin text-ai` + `text-ai-subtle-foreground` "질문을 만드는 중이에요"이다. `failed`면 `CircleAlert size-3.5 text-warning` + `text-warning-subtle-foreground` "질문 생성이 끝나지 않았어요"이다.
- (v3) **세션 유형이 옮긴 열과 다를 때**: 안내 상자 아래 `flex gap-2 text-sm text-muted-foreground` + `Info size-4 shrink-0 mt-0.5`에 명세 문장을 쓴다. 두 유형 이름만 `font-medium text-foreground`로 둔다. 버튼은 그대로다("이어서 쓰기" default).
- 사용량 안내 없음(명세).
- (v2) **키 없음 변형**: C-18 팝업형(3.18)을 쓴다. 활성 공급자 키가 없으면 위 팝업 대신 이것이 뜬다.

### 3.14 C-15 출처 발화 칩 · 필드 상태

- 칩: C-01과 **같은 클래스**. 라벨 "내 답변 #n". 상태 아이콘 없음. 클릭 → 대화의 해당 메시지로 스크롤 + 메시지에 `animate-field-flash`, `source_quotes` 구간은 `mark.bg-ai-subtle.rounded-sm`로 2초 강조 후 해제.
- **필드 상태 줄**: 미리보기 각 필드의 라벨 줄 오른쪽(`flex items-center justify-between`).

| 상태 | 표시 |
|------|------|
| ① 출처 있음 | 출처 칩들(`flex gap-1`) |
| ② 직접 수정 | `caption text-muted-foreground` + `PenLine size-3` "직접 수정" |
| ③ 검토 필요 | 필드 전체를 `rounded-md border border-warning bg-warning-subtle p-3`로 감싸고, 위에 `TriangleAlert size-4 text-warning` + `text-sm text-warning-subtle-foreground` 명세 문구, 값, 출처 칩, 버튼 줄 `Button size="sm"` "수락" + `Button size="sm" variant="outline"` "거절(비우기)" |
| 수락함 | `caption text-success-subtle-foreground` + `Check size-3` "수락함" + 출처 칩 |
| ④ 아직 없음 | 값 자리 `text-muted-foreground` "아직 없음" + `CircleDashed size-3.5`; 필수 필드면 그 옆 `Button variant="link" size="sm"` "AI에게 물어봐 줘" / 클릭하면 직접 입력 |
| 보조: 본인 역할 확인 중 | 라벨 옆 `Badge variant="info"` + `MessageCircleQuestion size-3` "본인 역할 확인 중"(클릭 가능, 툴팁에 명세 문구) |

- 이탤릭은 한글에서 쓰지 않는다(위 "아직 없음"도 정자체).

**(v5) Resumate AI 패널의 C-15** (플로우 v5.6 C-15). 위 S-36 표는 폐기된 화면 것이고, 패널에서는 아래를 쓴다. 칩 모양은 그대로 C-01 클래스이며 이름은 `SourceChip`으로 공통화한다.

| 칩 종류 | 라벨 | 클릭 | 쓰는 곳 |
|---------|------|------|---------|
| 발화 | "내 답변 #n" | 대화의 그 사용자 메시지로 스크롤 + `animate-field-flash`, `source_quotes` 구간 `mark.rounded-sm.bg-ai-subtle` 2초 | S-10 STAR 섹션·분류 추천 |
| 사실 (S-44) | "이 말에서 정리했어요 · #n"(`#n`은 첫 출처 발화 번호, 발화가 여럿이면 "#3 외 1") `[가정]` | 첫 발화로 스크롤 + 그 사실의 모든 출처 발화를 강조 | S-44 블록, "확인이 필요한 내용" |
| 지금 본문 (S-44) | "지금 본문에서" | 왼쪽 본문 칸에 포커스하고 그 구간을 **선택 상태**로 만든 뒤 칸에 `ring-2 ring-ring` + `animate-field-flash` 1회. textarea 안에는 `mark`를 칠할 수 없어서 선택으로 대신한다 `[가정]`. 구간을 못 찾으면(본문이 바뀜) 칸만 강조하고 토스트 "지금 본문에서 그 문장을 찾지 못했어요" `[가정]` | S-44 블록 |
| 프로젝트 내용 (S-44) | "프로젝트 내용에서" + `Tooltip`에 항목 이름("프로젝트 내용", "담당 업무", "사용 기술", "프로젝트명", "프로젝트 기간") | 이동 없음(툴팁만). `<button>`이 아니라 `span tabIndex=0` | S-44 블록 |

- 칩 묶음: 섹션·블록 아래 `mt-1.5 flex flex-wrap gap-1`. 종류 아이콘은 두지 않는다(3.1 규칙 유지, 라벨로만 구분).
- 상태 표시(①~⑤)와 [수락]·[거절]·[빼기] 버튼은 카드 쪽 규칙(3.24·3.25)을 따른다. 위 S-36 표의 "③ 검토 필요" 상자 모양은 그대로 쓰되, **패널 카드 안에서는 [수락]도 `outline`**이다(R-C8, v3까지는 `default`).
- "본인 역할 확인 중" 보조 배지는 위 표 모양 그대로(섹션 라벨 옆).

### 3.15 C-16 기업 JD 선택 다이얼로그

- `Dialog sm:max-w-lg` + `Command`(검색 `CommandInput` placeholder "회사명 또는 포지션 검색").
- 행(`CommandItem`, `py-3`): 1행 `font-medium` 이름 / 2행 `meta`: `StatusDot` + 단계 · `DDay` · 작성 중 세션 있으면 `Badge variant="draft"` "작성 중 면접".
- 빈 상태: `CommandEmpty` 대신 EmptyState 축약형 + `Button` "기업 JD 추가".

### 3.16 C-17 점수 표시

- 세션 점수: `score` 글자 "72" + `text-lg text-muted-foreground` " / 100", 아래 "반영 질문 {n}개" `meta`, `Collapsible` "산정 근거 보기".
- 고정 고지(점수 바로 아래, 항상): `meta text-muted-foreground` + `Info size-4` "입력한 답변 기준 연습 점수예요. 합격 가능성을 뜻하지 않아요".
- `pending_method`: `Badge variant="outline"` + `Hourglass` "점수 산정 방식 준비 중". `unanswered`: `Badge variant="outline"` "미응답". `not_scored`(질문): `Badge destructive-subtle` "채점 실패" + `Button variant="link" size="sm"` "다시 채점".
- 항목 등급 `grade` (D-14 결과에 따라 노출): excellent "매우 좋음" `success` / good "좋음" `info` / fair "보통" `warning` / poor "부족" `destructive-subtle` / not_applicable "해당 없음" `outline` — 라벨 문구는 `[가정]`(기획 확인 필요 P-2).
- 점수는 색으로 좋고 나쁨을 칠하지 않는다(숫자는 항상 `text-foreground`).

### 3.17 인사이트 판정 표시 (S-16, 공통 성격이라 여기 둠)

| `status` | 라벨 | 모습 |
|----------|------|------|
| `met` | 충족 | `Badge success` + `CircleCheck` |
| `partial` | 부분 충족 | `Badge warning` + `CircleDot` |
| `no_evidence` | 근거 없음 | `Badge variant="outline"` + `Circle`, `text-muted-foreground` (실패가 아니므로 빨강 금지) |

요건 `importance = 'high'`: 요건 글 앞 `Badge variant="secondary"` "핵심" `[가정: 라벨 문구, P-3]`. `category`는 `meta` 글자.

### 3.18 C-18 AI 잠금 상태 (v2 신설)

- 판정은 `get_data_readiness().ai_connection` 하나로 한다:

| `ai_connection` | 화면 |
|-----------------|------|
| `active_provider = null` | **C-18** (ST-AI-LOCKED) |
| `key_status = 'invalid'` | 같은 자리에 C-20 `key_invalid`(3.20). 실행 버튼은 보이되 누르면 C-20 |
| `key_status = 'needs_check'` | 잠그지 않음. 실행 허용 + C-19 주의 배지(ST-AI-KEY-CHECK) |
| (v3) `consent_required = true` | 잠그지 않는다. 실행 버튼은 정상이고 배지는 동의 필요형(3.19)이다. 누르면 요청을 보내지 않고 C-21 동의 창(3.21)을 먼저 연다. 동의하면 누른 실행을 이어서 보내고, 닫으면 아무것도 보내지 않는다. 키 없음·키 무효가 이 행보다 먼저다 |
| `key_status = 'valid'` | 정상 |

- 두 크기를 쓴다. **기존 결과가 없으면 영역형, 있으면 실행 버튼 자리에만 인라인형**(D-UX-15). 결과 본문·편집·복사는 키 없이도 그대로다(D-36). 잠금을 결과 위에 덮지 않는다.
- 아이콘: `PlugZap`. 색은 C-09와 같은 안내 카드 계열(`primary-subtle` 아이콘 원)을 쓴다. 오류색·경고색·AI 보라는 쓰지 않는다. 잠금은 실패가 아니라 "아직 연결 안 함"이라서다 `[가정]`.

**영역형** (`AiLock size="area"`: S-15 요건, S-16 인사이트, S-42 빈 상태). S-31 허브 카드는 영역형을 쓰지 않고 명세(02 S-31 v5)대로 카드에 표식만 붙인다 — 결과 없음 "AI 연결 필요", 결과 있음 "새로 만들려면 AI 연결", 요약은 그대로 (리더 결정 2026-10-28, UQ-354)

```
Card max-w-xl p-6 space-y-4 (그 기능 본문의 시작 위치, 가운데 정렬 아님)
아이콘: div.size-10 rounded-full bg-primary-subtle grid place-items-center > PlugZap size-5 text-primary
제목: section-title "AI 연결하면 사용할 수 있어요"
설명: body text-muted-foreground — 진입점별 기능 설명 1줄(명세 C-18 표)
주 버튼: Button default "AI 연결하기"
추천: meta — Gift size-4 text-muted-foreground + Button variant="link" size="sm" "Gemini 무료 키로 결제 없이 시작할 수 있어요" (→ S-41 Gemini)
대안: Separator + meta text-muted-foreground 문구 + Button variant="link" size="sm" (예: "직접 입력", "커리어 정리하기"). 대안이 없는 진입점(S-42)은 이 줄 생략
```

**인라인형** (`AiLock size="inline"`: 실행 버튼 하나를 대신함 — AI 작성 대화 시작, 서류 생성, 새 면접, 면접 제출, S-31 면접 카드)

```
div.flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-dashed border-input bg-card px-3 py-2.5
  Lock size-4 text-muted-foreground
  div.min-w-0 flex-1:
    p.text-sm font-medium "AI 연결하면 사용할 수 있어요"
    p.meta text-muted-foreground 기능 설명 1줄 (md 미만에서는 line-clamp-2)
  Button variant="outline" size="sm" "AI 연결하기"
  (대안이 있으면) Button variant="link" size="sm" 대안
```

- 인라인형의 "AI 연결하기"는 `outline`이다. 그 화면의 주 버튼(예: 자소서 문항 저장)과 다투지 않게 하려는 것이다. 영역형은 화면에 다른 주 동작이 없으므로 `default`를 쓴다 `[가정]`.
- **팝업형**(C-14 키 없음 변형, 3.13): `Dialog sm:max-w-md`. 제목은 명세 문구("면접 연습은 AI 연결 후 사용할 수 있어요")이고, 그 아래 기능 설명 `body text-muted-foreground`와 위 추천 줄을 둔다. 버튼은 `닫기`(ghost)와 `AI 연결하기`(default). 닫아도 카드 이동은 유지된다.
- **AI 연결하기의 목적지**: 연결된 공급자가 하나도 없으면 S-41 공급자 선택(`/settings/ai/connect`)으로, 있으면 S-40 페이지(`/settings/ai`)로 간다. 둘 다 복귀 대상을 기억한다. 설정 다이얼로그가 아니라 **라우트 페이지**로 간다. 복귀 흐름(FL-19)이 주소를 가져야 하기 때문이다(리더 결정).
- **복귀 후(D-UX-16, 자동 실행 없음)**: 원래 화면에서 잠금이 풀린 실행 버튼에 `ring-2 ring-primary ring-offset-2 ring-offset-background`를 4초 두고, `animate-field-flash` 바탕은 쓰지 않는다. 동시에 Sonner 토스트를 띄운다: `CircleCheck text-success` + "AI를 연결했어요" + C-19 배지 글자. `prefers-reduced-motion`이어도 링은 남긴다(애니메이션이 아니므로) `[가정]`.
- 접근성: 영역형 카드는 `role="region"`에 `aria-label="{기능} 잠김"`을 단다. 인라인형은 버튼 자리를 차지하므로 원래 버튼의 이름을 `sr-only`로 앞에 둔다("인사이트 생성 — AI 연결하면 사용할 수 있어요").

### 3.19 C-19 공급자·등급 배지 (v2 신설)

세 가지 모양이 있다. **연결 배지**는 지금 연결된 키를 보여 주고 누르면 S-40으로 간다. **결과 배지**는 결과를 만든 공급자를 보여 주는 글자다. **목록 열**은 세션 목록에 쓴다. 공급자 로고와 브랜드 색은 쓰지 않고 글자로만 구분한다(차분한 화면, 로고 사용 규정 회피) `[가정]`.

**연결 배지** (`ProviderBadge`): 실행 버튼 옆, C-03 진행 카드 머리 오른쪽, S-36 대화 상단, L-01 하단 줄, S-40 활성 카드

```
<button> Badge 높이 h-6 rounded-full px-2 gap-1 text-xs font-medium, focus-visible:ring-2 ring-ring
```

| `key_status` | variant | 앞 아이콘 | 글자 | 툴팁 |
|--------------|---------|-----------|------|------|
| `valid` | `outline` (`text-muted-foreground hover:bg-accent`) | `KeyRound size-3` | "Gemini · 무료 등급" / "Claude · 유료" / "OpenAI · 유료" | 무료 등급이면 명세의 무료 등급 고지 요약. 유료면 "연결한 {공급자} 키로 실행돼요" `[가정]` |
| `needs_check` | `warning` | `CircleHelp size-3` | "{공급자} · {등급} · 확인 필요" | "키 상태를 확인하지 못했어요(한도 또는 일시 오류)" — 실행은 허용 |
| `invalid` | `warning` | `TriangleAlert size-3` | "{공급자} · 키를 확인해 주세요" | 같은 문구 + "눌러서 키를 교체하세요" |
| (v3) 동의 필요 (`consent_required = true`, 키가 `valid`·`needs_check`일 때) | `warning` | `ScrollText size-3` | "{공급자} · {등급} · 동의 필요" | "데이터 사용 고지에 동의해야 실행할 수 있어요" `[가정: 배지 상태와 문구 모두]` |

- 두 경고 상태는 같은 `warning` 색을 쓰고 **아이콘과 글자로 구분**한다(R-C6). 차이는 동작에 있다. `invalid`는 실행이 C-20으로 이어지고, `needs_check`는 그대로 실행된다.
- 좁은 화면: 실행 버튼 옆에 둘 자리가 없으면 버튼 아래 줄로 내린다(`flex-wrap`). 등급 글자는 줄이지 않는다.
- `aria-label`: "AI 연결: {전체 글자}. AI 연결 설정 열기".

**결과 배지** (`ProviderResultTag`): S-16·S-19·S-22 결과 머리 오른쪽

- `caption text-muted-foreground inline-flex items-center gap-1` + `Cpu size-3.5` + 명세 문구 "Gemini · 기본로 만든 결과"(`provider` + `model_tier` → 경량 / 기본 / 고성능). 버튼 모양이 아니다(누르면 S-40으로 가지 않음).
- 모델 원래 ID(`model`)는 이 글자에 건 `Tooltip`(키보드 포커스 가능 `tabIndex=0`)과 결과 상세 정보에만 보인다.
- 결과가 지금 활성 공급자와 달라도 경고하지 않는다. 사실 표시일 뿐이다.

**목록 열 "실행 공급자"** (S-20·S-37 세션 목록, S-22 머리): `text-sm text-muted-foreground`, 글자는 "Gemini · 기본"이다. 질문과 채점 공급자가 다르면 "질문 Gemini · 채점 Claude"처럼 한 줄로 쓰고, 좁은 화면에서는 두 줄로 나눈다. 아직 질문이 없으면 "—"로 둔다.

### 3.20 C-20 한도·오류 안내 (v2 신설 — ST-AI-FAILED 대체)

v1의 `AiFailed`(ST-AI-FAILED)를 대신한다. 원인은 `ai_jobs.failure_cause`(7값)이고, 그 밖의 경우는 `error_category` + `error_code`로 문구를 고른다(명세 C-20 표의 문구를 그대로 쓴다).

**톤 두 가지** `[가정]`

| 톤 | 언제 | 모습 |
|----|------|------|
| `wait-or-act` (기다리거나 사용자가 조치) | 한도·계정·키·입력 문제 — 고장이 아니라 사용자가 기다리거나 손볼 일 | `Alert variant="warning"` (`border-warning/40 bg-warning-subtle text-warning-subtle-foreground`), 아이콘 `text-warning` |
| `broken` (일시 장애) | 공급자 장애, 시스템 오류 — 사용자 잘못이 아니고 다시 시도로 풀릴 일 | `Alert variant="destructive"` (`border-destructive/30 bg-destructive-subtle text-destructive-subtle-foreground`) |

**원인별 시각 규칙**

| 원인 | 톤 | 아이콘 | 동작(왼쪽부터, 주 동작이 앞) |
|------|----|--------|------------------------------|
| `rate_limited` (상한 초과 뒤) | wait-or-act | `Hourglass` | `RetryButton`(`retry_after`까지 카운트다운) · 공급자 대시보드 링크 |
| `daily_quota_exhausted` | wait-or-act | `CalendarClock` | "유료 등급·다른 공급자 연결"(`outline sm` → S-40) · 공급자 대시보드 링크. 다시 시도 버튼 없음 |
| `billing_required` | wait-or-act | `CreditCard` | 결제 페이지 링크(공급자별) · `RetryButton` |
| `key_invalid` | wait-or-act | `KeyRound` | **"키 교체"**(`default sm` → S-41 ③) · 공급자 대시보드 링크 |
| `model_not_available` | wait-or-act | `Ban` | "등급 업그레이드 안내" 링크 · "다른 공급자 연결"(`outline sm` → S-40) |
| `provider_unavailable` | broken | `CloudAlert` | `RetryButton` · 공급자 상태 페이지 링크 |
| `input_rejected` (`input_too_long` / `safety_blocked`) | wait-or-act | `TextCursorInput` / `ShieldAlert` | "{대상}으로 이동"(`outline sm`, 해당 입력에 포커스). (v3) **`RetryButton` 없음**(R-69). 아래 "입력 원인 실패" 규칙 |
| `key_missing` (ST-AI-KEY-MISSING) | wait-or-act | `KeyRound` | **"AI 연결하기"**(`default sm`, C-18 목적지 규칙) · "입력으로 돌아가기"(link). (v3) 먼저 readiness를 다시 읽는다. 읽는 동안 동작 줄 자리는 `Skeleton h-8 w-40`이다(잘못된 "AI 연결하기"가 잠깐 보이지 않게). 활성 공급자가 있고 `consent_required`면 **동의 원인**으로 바꾼다. 제목은 "{공급자}({등급}) 사용 동의가 필요해 작업을 멈췄어요. 입력은 저장돼 있어요", 아이콘은 `ScrollText`, 동작은 "동의하기"(`default sm` → C-21 동의 창)이다. 동의하면 동작 줄이 `RetryButton` + 활성 공급자 배지로 바뀐다 |
| system `timeout`·`stalled` / `schema_invalid` | broken | `TimerOff` / `CircleAlert` | `RetryButton` |
| input `not_a_jd` | wait-or-act | `FileWarning` | "입력 화면으로"(link). (v3) 다시 시도 없음. `insufficient_data`는 C-20이 아니라 C-09 |
| `canceled` | — | — | 표시하지 않음 |

**문구 자리** (block형 기준)

```
Alert (톤별) p-4 grid grid-cols-[auto_1fr] gap-x-3
  아이콘 size-5 (톤 색)
  AlertTitle  text-base font-semibold — 명세 문구 첫 문장. {공급자} 이름이 들어간다 (예: "오늘 Gemini 무료 한도를 다 썼어요.")
  AlertDescription text-sm space-y-2
    ① 시각 줄(있을 때): "오후 4:00 (KST)에 다시 채워져요 · 약 3시간 뒤" — 시각은 font-medium tabular-nums
    ② 보존 줄(항상): "입력과 지금까지 만든 결과는 그대로 있어요" (부분 결과가 있으면 그 아래에 그대로 그린다) [가정: 문구]
    ③ 동작 줄: flex flex-wrap gap-2 — 위 표 순서
    ④ 다시 시도 주석(RetryButton이 있을 때): caption text-muted-foreground "다시 시도하면 토큰을 다시 써요"
```

- **`RetryButton`**: `Button variant="outline" size="sm"` + `RotateCcw`, 글자 "다시 시도"이다. `retry_after`가 미래 시각이면 `disabled`로 두고 글자를 "다시 시도 (2:41)"(`tabular-nums`, 1초마다 갱신)로 바꾼다. 시각이 지나면 활성으로 돌린다. 스크린 리더에는 카운트다운을 읽히지 않고 `aria-describedby`로 "{시각}부터 다시 시도할 수 있어요"를 한 번 준다.
- **(v3) 다시 시도 옆 공급자 배지**: 다시 시도·다시 생성·다시 채점·남은 질문 다시 만들기·AI에게 다시 맡기기 버튼은 모두 바로 옆에 C-19 연결 배지를 둔다. 배지는 **누르는 시점의 활성 공급자**다. 작업을 만든 공급자가 아니다. block형은 동작 줄 안에서 `RetryButton` 바로 뒤에, inline형은 "다시 시도"/"다시 보내기" 링크 바로 뒤에 둔다.
- **(v3) "처음부터 다시" 줄**: 같은 작업 행 다시 시도에서 활성 공급자·등급이 작업 행의 `provider`·`connection_tier`와 다를 때 보인다. 동작 줄 아래, 다시 시도 주석 위에 한 줄을 둔다.
  `p.flex items-center gap-1.5 text-sm` + `ArrowLeftRight size-3.5` + "{활성 공급자}로 처음부터 다시 해요"
  글자색은 감싼 Alert의 글자색을 그대로 쓰고, 경고색으로 바꾸지 않는다. 오류가 아니라 동작 설명이기 때문이다. 버튼 글자는 "다시 시도" 그대로다. readiness가 바뀌면(특히 `ai_connection_changed` 뒤) 배지와 이 줄을 함께 다시 그린다.
- **(v3) 입력 원인 실패에는 다시 시도가 없다** (`input_too_long`·`safety_blocked`·`not_a_jd`·`insufficient_data`, R-69): `RetryButton`, 공급자 배지, ④ 주석을 그리지 않는다. 동작은 "{대상}으로 이동" 하나다. 그 아래 `caption`으로 "고친 뒤 {실행 버튼 글자}로 새로 실행해 주세요"를 둔다 `[가정: 문구]`. 실행 버튼 글자는 화면마다 다르다. 인사이트는 "다시 생성", 면접 질문 생성은 S-20 "시작하기", 요건 추출은 "요건 정리하기"이고, 서류 3종과 대화는 각 화면의 실행 버튼이다.
- **(v3) 요청 안에서 끝나는 경로의 대기** (AI 작성 대화 턴, 서류 스트리밍, 요건 추출 — A14): 분당 한도·공급자 장애는 C-03 대기 줄로 보이지 않고 **바로 C-20**이 된다. 대화 턴과 자소서 문항은 그 자리의 inline형, 요건 추출과 경력기술서 시작은 실행 버튼 아래 inline형이다.
  - 제목 문장 다음 줄에 `text-sm tabular-nums` "{N}초 뒤 다시 보낼 수 있어요"를 둔다. 1초마다 줄어든다. 60초 이상이면 "{M}분 {S}초 뒤"로 쓴다 `[가정: 60초 이상 표기]`.
  - "다시 보내기"(대화)와 "다시 시도"(서류·요건)는 `RetryButton`처럼 `retry_after`까지 `disabled`이고 글자 뒤에 "(0:12)"를 붙인다. 0이 되면 안내 줄을 지우고 버튼을 활성으로 돌린다.
  - 아이콘과 톤은 원인 표를 따른다(`rate_limited`는 wait-or-act `Hourglass`, `provider_unavailable`은 broken `CloudAlert`). 3.3의 AI 보라 대기 줄은 쓰지 않는다. 자동 재시도가 아니라 사용자가 다시 눌러야 하기 때문이다.
  - 카운트다운 낭독은 A-11을 따른다.

**(v3) 다시 시도 거부** (같은 행 다시 시도 요청의 HTTP 409. 작업 행의 오류가 아니다): 이미 보이는 C-20 실패 안내는 그대로 두고 **동작 줄만** 바꾼다. Alert를 하나 더 쌓지 않는다 `[가정]`. 아래 글자는 감싼 Alert의 글자색을 쓰고, 아이콘만 표의 색을 쓴다.

| 거부 코드 | 동작 줄 자리의 모습 |
|-----------|---------------------|
| `key_missing` | `RetryButton`과 배지 자리가 C-18 인라인형(3.18)으로 바뀐다. 인라인형 제목만 "AI 연결이 필요해요. 작성한 내용은 저장돼 있어요"로 바꾼다 |
| `ai_consent_required` | 동작 줄은 그대로 두고 C-21 동의 창(3.21)을 바로 연다. 동의하면 같은 다시 시도를 이어서 보내고 버튼이 로딩 상태가 된다. 닫으면 아무 일도 없다 |
| `key_invalid` | 동작 줄 아래에 C-20 `key_invalid` inline형("키 교체")을 둔다 |
| `ai_connection_changed` | `RetryButton`은 활성 그대로다. 동작 줄 아래에 `text-sm` + `RefreshCw size-3.5 text-info` "AI 연결이 방금 바뀌었어요. 다시 시도해 주세요."를 둔다. 동시에 배지와 "처음부터 다시" 줄을 새 readiness로 다시 그린다 |
| `ai_job_not_retryable` | `RetryButton`, 배지, 주석을 지운다. 그 자리에 `text-sm` + `CircleAlert size-3.5 text-warning` "이 작업은 다시 시도할 수 없어요. 입력을 확인한 뒤 새로 실행해 주세요"와 "{대상}으로 이동"(`link sm`)을 둔다 |

- 새 작업 시작 요청의 409(`ai_not_connected`, `ai_consent_required`, `key_invalid`)는 3.22 `AiRunButton` 규칙을 따른다.
- 거부 문장은 `aria-live="polite"`로 한 번 알린다.
- **시각 표기**: 항상 KST로 쓰고 `오후 4:00 (KST)` 형식을 쓴다. 오늘이 아니면 앞에 "내일 "을 붙인다. 남은 시간은 "약 N시간 뒤" 또는 "약 N분 뒤"로 쓰고, 1분 미만이면 "곧"으로 쓴다 `[가정]`.
- **외부 링크**(공급자 대시보드·결제·상태 페이지): `Button variant="link" size="sm"` + 글자 뒤 `ExternalLink size-3.5`, `target="_blank" rel="noopener noreferrer"`, `aria-label`에 "(새 탭)"을 붙인다. 링크 글자는 "{공급자} 대시보드", "{공급자} 결제 설정", "{공급자} 상태 페이지"이다 `[가정: 링크 글자]`.
- 결제 유도·충전 버튼·"업그레이드" 강조 버튼은 만들지 않는다. 공급자 쪽 동작은 모두 링크다.

**크기 세 가지**

| 형 | 쓰는 곳 | 모습 |
|----|---------|------|
| block | S-16 결과 영역 상단, S-22 상단, S-15 요건 영역, S-33 생성 영역 | 위 구조 전체 |
| inline | S-36 실패한 턴 자리, S-19 실패한 섹션, S-22 실패한 답변 카드 | `flex flex-wrap items-center gap-x-2 gap-y-1 text-sm` + 톤 색 아이콘 `size-4` + 제목 문장(톤의 subtle-foreground 색) + 동작 1~2개(`link sm`). 시각 줄과 주석은 다음 줄에 `caption`으로 둔다. 대화 턴의 다시 보내기는 "다시 보내기"로 쓴다 |
| field | S-41 ③ 키 입력란 아래 | 폼 오류 규칙(A-10)과 같다: `text-sm` + 아이콘 `size-4`. 키 형식 오류·`key_invalid`는 `text-destructive`(입력 오류로 다룸)이고, 확인 보류(`needs_check`)는 오류가 아니므로 C-20 대신 5.7 S-41 "확인 보류" 패널로 보인다 |

- 실행 중 자동 재시도(분당 한도 대기)는 C-20이 아니라 C-03의 대기 줄(3.3)로 보인다. 실패처럼 보이지 않게 한다.
- `aria-live="polite"`로 제목 문장을 한 번 알린다(A-6).

### 3.21 C-21 데이터 사용 고지·동의 (v2 신설)

S-41 ② 단계의 본문이다. S-40 카드 메뉴의 "데이터 사용 고지 다시 보기"는 같은 내용을 읽기 전용 `Dialog`로 보인다. 이때 체크박스 대신 "동의함 · {agreed_at}"를 `meta`로 둔다.

```
div.space-y-5 max-w-prose-edit
① 전송되는 데이터: subsection "{공급자}로 보내는 내용" + ul list-disc pl-5 text-base (명세 5개 항목)
② 공급자·처리 국가: dl grid grid-cols-[7rem_1fr] gap-y-2 text-sm — dt text-muted-foreground / dd
③ 학습·사람 검토·보관 기간: Collapsible "공급자 정책 자세히" (기본 접힘) → 같은 dl 형식 + {공급자} 약관 링크(외부 링크 규칙)
④ [Gemini 무료 등급만] 강조 상자 (아래)
⑤ Resumate 원칙: meta text-muted-foreground + ShieldCheck size-4 (명세 문구)
Separator
⑥ 필수 동의: Checkbox + label text-base "위 내용을 확인했고 {공급자}({등급})로 데이터를 보내는 데 동의해요"
하단: [이전] ghost · [다음] default — 필수 체크(와 ④ 체크)가 모두 되어야 활성
```

**Gemini 무료 등급 강조 상자** (`FreeTierNotice`)

```
div.rounded-lg border-2 border-warning bg-warning-subtle p-4 space-y-3
  div.flex gap-3: TriangleAlert size-5 text-warning shrink-0
    p.text-base font-semibold text-warning-subtle-foreground "무료 등급에서는 입력한 내용이 Google 제품 개선에 쓰이고 사람이 검토할 수 있어요"
    p.text-sm text-warning-subtle-foreground 민감정보·회사 기밀 주의 문구
  별도 Checkbox (상자 안, 테두리 border-warning-subtle-foreground/40) + label text-sm font-medium "무료 등급의 데이터 사용 방식을 이해했어요"
```

- 상자는 접을 수 없고 ③ Collapsible 안에 넣지 않는다. 체크박스 두 개는 서로 묶지 않는다("모두 동의" 없음) `[가정]`.
- 다음 버튼이 비활성일 때는 이유를 버튼 위 `meta`로 보인다: "동의 항목을 모두 체크해 주세요".
- 재동의(공급자·등급·고지 버전이 바뀐 경우): 상단에 `Alert variant="info"` "데이터 사용 고지가 바뀌어 다시 동의가 필요해요" `[가정: 문구]`. 나머지는 같다.

**(v3) 동의 창형** (`DataUseConsent mode="dialog"`): 실행 전에 동의가 필요할 때 쓴다. 여는 곳은 C-18 `consent_required`, 다시 시도 거부 `ai_consent_required`, C-20 `key_missing`의 동의 원인, S-40 활성 카드 "동의하기"다.

```
Dialog sm:max-w-lg (좁은 화면 max-w-[calc(100%-2rem)])
  DialogHeader: DialogTitle section-title "{공급자}({등급}) 데이터 사용 동의"  [가정: 제목]
  본문 div.max-h-[70dvh] overflow-y-auto space-y-5
    (재동의일 때) 위 재동의 Alert info
    ①~⑥ 위와 같다 (Gemini 무료 등급이면 FreeTierNotice 포함)
  DialogFooter: [닫기] ghost · [동의하고 계속] default  [가정: 버튼 글자. S-40에서 열면 "동의하기"]
                좁은 화면은 세로로 쌓고 동의 버튼이 위
```

- 확인 버튼은 필수 체크(와 무료 등급 체크)가 모두 되어야 활성이다. 비활성 이유 `meta`는 위 규칙과 같다.
- 동의를 저장하는 동안 확인 버튼은 `Loader2` 로딩이다. 저장되면 창을 닫고 readiness를 다시 읽은 뒤, 원래 누른 실행을 이어서 보낸다. 그 실행 버튼이 바로 로딩 상태가 된다. 토스트는 띄우지 않는다 `[가정]`.
- 닫으면 아무 요청도 보내지 않는다. 실행 버튼은 원래 상태로 돌아온다.
- 저장 실패는 창 하단, 버튼 위에 ST-SAVE-FAILED 제출형으로 보인다.

### 3.22 AI 실행 버튼 묶음 (v2 신설 — `UsageHint` 대체)

명세의 "실행 버튼 공통 규칙"을 하나의 공통 컴포넌트 `AiRunButton`으로 만든다. 모든 AI 실행 버튼이 이것을 쓴다. 대상은 인사이트 생성, 요건 정리하기, 경력기술서 생성, 자소서 생성·다시 생성, 면접 시작·제출, 다시 채점, AI 작성 대화 시작이다.

```
div.flex flex-wrap items-center gap-2
  Button (default 또는 화면이 정한 variant) — 실행 글자
  ProviderBadge (3.19 연결 배지)
(다시 하는 버튼이면) p.caption text-muted-foreground mt-1 "다시 하면 공급자 토큰을 다시 써요"
```

| 상태 | 모습 |
|------|------|
| 키 없음 | 묶음 전체가 C-18 인라인형으로 바뀐다 |
| 키 무효 | 버튼은 활성이고 배지는 경고형이다. 누르면 버튼 아래에 C-20 `key_invalid` inline이 뜬다 |
| 확인 필요 | 정상 실행된다. 배지만 주의형이다 |
| 같은 대상에 같은 작업이 진행 중 | 버튼 `disabled` + 아래 `meta` "이미 만들고 있어요" + C-03 축약형 |
| 동일 입력 결과 있음 | 정상 버튼. 누르면 새 호출 없이 기존 결과로 이동한다(따로 표시하지 않음) |
| 실행 중(동기) | ST-AI-SYNC 버튼 로딩 |
| (v3) 동의 필요 (`consent_required`) | 버튼은 정상 활성이고 배지는 동의 필요형(3.19)이다. 누르면 요청 전에 C-21 동의 창을 연다. 동의하면 실행이 그대로 이어진다 |
| (v3) 새 작업 시작이 409로 거부됨 | `ai_not_connected`면 묶음이 C-18 인라인형이 된다. `ai_consent_required`면 C-21 동의 창을 연다. `key_invalid`면 버튼 아래에 C-20 `key_invalid` inline을 둔다 |
| (v3) 다시 하는 버튼 | 배지는 누르는 시점의 활성 공급자다. "처음부터 다시" 줄과 입력 원인 실패 규칙은 3.20을 따른다 |

- 횟수, 남은 사용량, "N회 사용" 같은 글자는 어디에도 두지 않는다(D-34).
- 품질 제한은 "한도"라는 말 없이 보인다. AI 작성 대화 `n / 40`(5.4), 입력 길이 상한(C-07 글자 수), 작성 중 면접 1개(S-20 배너)가 여기에 해당한다. 서버 남용 방지에 걸리면 C-20 `broken` inline "잠시 후 다시 시도해 주세요"로 보인다.

### 3.23 C-23 프로젝트 추가 — 소속 선택 · 독립 이름 입력 (v5 신설)

플로우 v5.6에서 범위가 줄었다. 경력·교육의 "+ 프로젝트 추가"는 이 다이얼로그 없이 S-10 새 페이지로 바로 간다. 남은 두 경우(① C-22 "프로젝트" → 독립 프로젝트 이름, ② C-09·S-16에서 소속 고르기)는 한 컴포넌트(`AddProjectDialog`)로 그린다.

```
Dialog sm:max-w-md (좁은 화면은 Sheet side="bottom", C-22와 같게)
  DialogTitle section-title: ① "새 독립 프로젝트" / ② "어디에 프로젝트를 추가할까요?"
  ② 소속 목록: RadioGroup 카드형(2장 radio-group 규칙), 묶음 머리 label "경력" / "교육" (text-sm text-muted-foreground),
     항목 = 이름(font-medium) + meta 기간. 맨 아래 "소속 없음(독립 프로젝트)" 항목은 Separator 아래에 따로.
     목록이 6개를 넘으면 목록 영역만 max-h-72 overflow-y-auto
  독립을 골랐을 때(②)만: 안내 meta text-muted-foreground + Info size-4 (명세 문구)
  프로젝트명 * (①, ②-독립만): Label + Input (≤100자, C-07 글자 수). 경력·교육을 고르면 이 칸을 숨긴다(motion-layout)
  DialogFooter: 취소(outline) · 주 버튼(default) "만들기"(① · ②-독립) / "계속"(②-경력·교육)
```

- "만들기"는 이름이 비면 `disabled`. 요청 중 `Loader2` 로딩. 실패는 버튼 위 ST-SAVE-FAILED 제출형 한 줄(명세 문구), 입력 유지.
- "계속"은 요청이 없으므로 로딩 표시가 없다. 누르면 다이얼로그를 닫고 S-10 새 페이지로 간다.
- 시각 규칙은 v3까지의 다이얼로그 규칙(5.6)과 같다. 새 토큰·variant는 없다.

### 3.24 S-10 STAR 제안 카드 (`StarProposalCard`, v4 신설)

Resumate AI 패널의 **제안 독**(5.10)에 놓이는 대화당 1개 카드. 원천: 플로우 S-10 "STAR 제안 카드"·"반영 규칙"·"분류 추천", AI-12 "카드 상태 3단계".

**틀**

```
Card: rounded-xl border bg-card (그림자 없음)
머리 (button, 접기 토글): flex items-center gap-2 px-4 py-3
  ListChecks size-4 text-muted-foreground + "STAR 제안" text-sm font-semibold
  요약 caption text-muted-foreground tabular-nums: "반영할 수 있는 섹션 3 · 검토 필요 1"
  (정리 중이면 요약 자리에 C-03 축약형 "정리 중")
  오른쪽 ChevronDown size-4 (펼침 시 rotate-180)
본문 (펼침): divide-y border-t — 섹션 5개 → 분류 추천 묶음
바닥 (sticky bottom-0 bg-card border-t px-4 py-3 space-y-2): 건너뜀·검토 안내 줄 → [모두 반영 (n)]
```

- 섹션 순서·라벨: 상황 / 역할 / 행동 / 결과·성과 / 배운 점(명세 라벨). 값이 없는 섹션(제안 없음)은 그리지 않는다. 다섯 개 모두 없으면 카드 대신 독에 아무것도 두지 않는다.
- 섹션 = `px-4 py-3 space-y-2`. 1행 `flex items-center gap-2`: 라벨 `text-sm font-medium` + (보조 배지) + 오른쪽 동작·상태(아래 표). 2행 값. 3행 C-15 칩 줄.
- 값 글자는 패널 밀도에 맞춰 `text-sm leading-6`(14/24)로 쓴다. 대화 메시지(16px `prose`)보다 작게 해서 "정리된 결과"와 "대화"가 구분되게 한다 `[가정]`.

**값의 두 모양** (명세: 빈 칸 = 새 값 / 내용 있는 칸 = 뒤에 덧붙임)

| 경우 | 모양 |
|------|------|
| 폼 칸이 비어 있음 → 새 값 | 머리 오른쪽 `caption text-muted-foreground` "새 값". 값은 그대로 `text-sm leading-6` |
| 폼 칸에 내용 있음 → 덧붙임 | 위에 `caption text-muted-foreground` + `CornerDownRight size-3.5` "현재 내용 뒤에 붙어요". 그 아래 현재 폼 값의 마지막 줄을 `line-clamp-2 text-sm text-muted-foreground`로 보이고, 이어서 덧붙일 문장을 `rounded-md bg-ai-subtle px-2 py-1.5 text-sm leading-6 text-ai-subtle-foreground`로 강조한다. 덧붙임 여부는 **지금 폼 값**으로 판정하므로, 사용자가 왼쪽 칸을 비우거나 채우면 바로 모양이 바뀐다 |

**섹션 상태** (C-15 ①~⑤ + 카드 규칙)

| 상태 | 1행 오른쪽 | 섹션 모양 |
|------|-----------|-----------|
| ① 제안 (`ok`/`accepted`, 미반영) | `Button variant="outline" size="sm"` "반영" + `Button variant="ghost" size="icon-sm"` `Pencil`(`aria-label="{섹션} 직접 고치기"`) | 기본 |
| 검토 필요 (`needs_review`) | 없음 | 섹션 전체를 3.14 "③ 검토 필요" 상자로 감싼다(`rounded-md border border-warning bg-warning-subtle p-3`, 명세 문구). 상자 안 버튼: [수락] `outline sm` · [거절(비우기)] `ghost sm`. 수락하면 ① 모양 + `caption text-success-subtle-foreground` `Check` "수락함" |
| 직접 고치는 중 | 없음 | 값 자리가 `Textarea text-sm min-h-20 field-sizing-content`로 바뀌고 아래 `저장`(outline sm) · `취소`(ghost sm). 여기서 "저장"은 제안 고치기(`apply_structured_draft_patch`)이고 커리어 저장이 아니다 `[가정: 버튼 글자 — 명세 없음, "고치기 완료"도 후보]` |
| 직접 수정 (`user_edit`) | ①과 같은 버튼 | 칩 줄 대신 `caption text-muted-foreground` `PenLine size-3` "직접 수정" |
| ④ 폼에 채움 · 저장 전 | `Badge variant="info"` + `ArrowLeftToLine size-3` "폼에 채움" | 값 아래 `caption text-info-subtle-foreground` "저장하기를 눌러야 저장돼요". 반영·직접 고치기 버튼 없음. 섹션 바탕은 그대로(흐리게 하지 않음). 좁은 화면 시트에서는 그 옆에 `Button variant="link" size="sm"` "STAR에서 보기" |
| ⑤ 반영됨 | `Badge variant="success"` + `Check size-3` "반영됨" | 값은 `line-clamp-2 text-muted-foreground`로 접고 칩 줄은 남긴다. 섹션을 누르면 펼친다 |
| 새 제안 있음 (`proposal_changed`) | `Badge variant="ai"` + `Sparkles size-3` "새 제안이 있어요" + ① 버튼 | ① 모양 |
| 갱신됨 (턴 뒤 값이 바뀜) | — | 섹션에 `animate-field-flash` 1회 |

- 막힌 동작의 안내: ④·⑤ 섹션에서 직접 고치기를 시도할 길은 없지만, 다른 탭 등으로 `field_already_applied`가 오면 섹션 아래 `text-sm text-muted-foreground` "이미 반영했어요. 왼쪽 칸에서 고쳐 주세요".
- 2,000자 초과로 채우지 못한 섹션: 섹션 아래 `text-sm text-warning-subtle-foreground` + `TriangleAlert size-3.5 text-warning` 명세 문구. 섹션은 ① 그대로.

**분류 추천 묶음** (STAR 섹션 아래, 추천이 있을 때만)

```
div.px-4 py-3 space-y-3 bg-muted/40
  머리: text-sm font-medium "분류 추천" + caption text-muted-foreground "이 대화를 보고 추천했어요" + (출처 칩이 있으면) C-15 칩
  행(단일 — 프로젝트 종류·경험 유형): grid grid-cols-[6.25rem_minmax(0,1fr)_auto] items-center gap-2
    라벨 text-sm text-muted-foreground · "추천: {값}" (값은 Badge variant="secondary" h-7 rounded-full px-2.5 text-sm) · [반영] outline sm
    reason이 있으면 아래 줄 caption text-muted-foreground
  행(역량, 최대 3): 라벨 + 체크 칩 줄 flex flex-wrap gap-1.5 + [반영]
    체크 칩 = label.inline-flex h-7 items-center gap-1.5 rounded-full border border-input px-2.5 text-sm
              has-[:checked]:border-primary/50 has-[:checked]:bg-primary-subtle has-[:checked]:text-primary-subtle-foreground
              안에 Checkbox size-3.5 (기본 모두 체크)
```

- 반영한 분류 행은 ④/⑤ 배지로 바뀌고 [반영]이 사라진다. 이미 폼에서 고른 값이 있어 건너뛰면(`classification_already_set`) 행 아래 `text-sm text-muted-foreground` "이미 고른 값이 있어요".

**바닥 (모두 반영 · 안내)**

- 안내 줄은 `caption text-muted-foreground`이고 `ul space-y-0.5`로 모은다: "검토하지 않은 섹션 N개는 반영되지 않아요"(검토 필요가 있을 때), 채우기 단계 건너뜀 문구들, 저장 응답의 `skipped` 문구들(명세 S-10 "반영 규칙"). 각 줄 앞 `Info size-3.5`. 저장 응답 건너뜀은 다음 [반영]이나 새 턴이 오면 지운다 `[가정]`.
- `[모두 반영 (n)]`: `Button variant="outline" size="sm"` + `CheckCheck`, 오른쪽 정렬. n = 지금 반영할 수 있는 섹션·분류 수(`tabular-nums`). 0이면 `disabled`. R-C8에 따라 `default`를 쓰지 않는다.
- **[반영] 직후**: 왼쪽 칸에 `animate-field-flash`(1.3, 줄인 모션이면 왼쪽 2px `ai` 테두리 2초) + 칸이 화면 밖이면 그 칸으로 스크롤하지 **않는다**(대화를 읽던 흐름을 끊지 않음) `[가정]` + Sonner "{섹션}에 채웠어요" 액션 "되돌리기"(8초, `[가정]`) + `aria-live` 명세 문구.
- 상태 "AI 응답 중"·"정리 중"에는 모든 [반영]·[모두 반영]·[수락]이 `disabled`다(명세 "AI 응답 중"과 같음 — 카드가 바뀌는 도중 누르는 일을 막음).

### 3.25 S-44 본문 초안 제안 카드 (`DraftProposalCard`, v4 신설)

S-44 패널 제안 독의 대화당 1개 카드. **블록 단위**다. 원천: 플로우 S-44 "본문 초안 제안 카드 구성"·"반영 규칙"·"AI 응답 방식", AI-13.

**틀**

```
Card: rounded-xl border bg-card
머리 (button, 접기 토글): flex items-center gap-2 px-4 py-3
  FileText size-4 text-muted-foreground + "본문 초안" text-sm font-semibold
  상태 배지 (아래 표) · 오른쪽 caption tabular-nums "초안 남은 횟수 4 / 6" (0이면 text-warning-subtle-foreground)
  ChevronDown
본문 (펼침): px-4 py-3 — 블록 목록 → 확인이 필요한 내용 → 아직 비어 있는 부분 → 뺀 문장
바닥 (sticky bottom-0 bg-card border-t px-4 py-3 space-y-2): 안내 줄 → 반영 버튼 묶음
```

- 초안이 없고 확인이 필요한 사실도 없으면 카드를 그리지 않는다. 사실만 있으면 머리 + "확인이 필요한 내용" 묶음만 그린다(대화 중에도 보임, 명세).
- 블록 목록은 기본 `max-h-[28rem] overflow-hidden`이고, 넘치면 아래 `bg-gradient-to-t from-card` 높이 12 덮개 + `Button variant="ghost" size="sm"` "펼치기"(`ChevronsUpDown`) / 펼치면 "접기". 그라데이션은 잘림 표시용이라 장식 금지 규칙(0장)의 예외다 `[가정]`.

**블록 렌더링** (카드 안 축약 문서 모양, 왼쪽 본문 칸의 입력 글자와 구분되게 14px)

| `type` | 클래스 |
|--------|--------|
| `heading` level 2 / 3 | `text-sm font-semibold mt-3 first:mt-0` / `text-sm font-semibold text-muted-foreground mt-2`. 출처 칩 없음 |
| `paragraph` | `text-sm leading-6` |
| `bullet_list` / `numbered_list` | `list-disc` / `list-decimal` + `pl-5 space-y-1 text-sm leading-6`. 항목마다 출처가 있으면 칩은 목록 블록 아래에 모아 한 줄 |
| `table` | `overflow-x-auto` 안 shadcn `Table` 작은 형(`text-sm`, 셀 `px-2 py-1.5`, 머리 행 `font-medium bg-muted/50`) |
| `quote` | `border-l-2 border-border pl-3 text-sm leading-6 text-muted-foreground` |
| `code` | `rounded-md bg-muted px-3 py-2 font-mono text-sm overflow-x-auto whitespace-pre` |

- 블록 감싸개: `relative rounded-md px-2 py-1.5 -mx-2`, 블록 사이 `space-y-2`.
- **"새 내용" 표식** (`basis = 'new'`): 블록 왼쪽 안쪽에 `border-l-2 border-ai/60`(감싸개 `pl-3`) + 칩 줄 맨 앞 `Badge variant="ai" h-5 px-1.5 text-xs` "새 내용". `current_body` 블록은 표식 없음. 색만으로 구분하지 않도록 배지 글자가 함께 있다(R-C6).
- **덧붙이기 미리보기**: [뒤에 덧붙이기]에 hover 또는 focus하면 붙을 블록(`new` + 바로 앞 제목)의 감싸개에 `bg-ai-subtle ring-1 ring-ai/30`, 나머지 블록에 `opacity-40`. 떼면 원래대로(`motion-fast`). 키보드 포커스로도 같게 보이므로 마우스 전용이 아니다. 스크린 리더에는 버튼 `aria-describedby`로 "새 내용 블록 N개를 지금 본문 끝에 붙여요" `[가정]`.
- **검토 필요 블록** (`needs_review`): 감싸개가 `rounded-md border border-warning bg-warning-subtle p-2.5`로 바뀌고, 맨 위 `flex gap-1.5 text-sm text-warning-subtle-foreground` + `TriangleAlert size-4 text-warning shrink-0` 명세 문구, 블록 아래 버튼 `[수락]`(outline sm) · `[빼기]`(ghost sm + `Minus`). 수락하면 일반 블록 + `caption text-success-subtle-foreground` `Check size-3` "수락함". 빼면 블록이 사라진다(`motion-layout`). 되돌리기 없음(명세: 사용자 패치) — 그래서 [빼기]는 `ghost`로 약하게 둔다 `[가정]`.
- 출처 칩: 블록 아래 3.14 (v5) 표의 세 종류.

**카드 상태** (머리 배지 + 본문 + 바닥)

| 상태 | 머리 배지 | 본문 | 바닥 |
|------|-----------|------|------|
| 초안 없음 (사실만) | 없음 | "확인이 필요한 내용"만 | 없음 |
| **초안 작성 중** (`draft_started` ~ `draft_done`) | C-03 축약형 `Loader2 animate-spin text-ai` "초안 작성 중"(`compose` 단계 문구). 무료 등급이면 `meta` 한 줄 C-03 무료 등급 문구 | 이전 초안이 있으면 맨 위 `Collapsible` 접힘 "이전 초안"(`caption` 트리거). 그 아래 받은 `draft_block`을 C-04 임시 블록(`border-l-2 border-ai pl-3`, 마지막 블록 끝 커서)으로 차례로 쌓는다. 칩·검토 표시·버튼 없음. 첫 블록 전 자리는 `Skeleton` 3줄. 첫 블록 전 15초가 지나면 `meta text-muted-foreground` "긴 글이라 조금 더 걸려요" | 반영 버튼 모두 `disabled`. 마지막 블록 뒤 `draft_done` 전에는 머리 글자를 "마무리 중…"(C-04)으로 (리더 판정 2026-11-03, P-3: S-44에는 C-04 "마무리 중" 단계를 두지 않는다 — `draft_block`에 마지막 블록 표시가 없으므로 `draft_done`까지 "초안 작성 중" `[가정]`) |
| 제안 (`draft_done` 뒤) | 없음 | 확정 블록으로 **통째로 교체**(C-04 `validated` 규칙, 스크롤 위치 유지) + 검토 강조 + 아래 부가 정보 | 반영 버튼(아래) |
| **폼에 채움 · 저장 전** | `Badge variant="info"` + `ArrowLeftToLine size-3` "폼에 채움" | 블록 [수락]·[빼기] `disabled`(블록은 그대로 읽힘). 사실 [수락]·[거절]은 계속 가능 | 버튼 자리에 `caption text-info-subtle-foreground` "저장하기를 눌러야 저장돼요" |
| 반영됨 | `Badge variant="success"` + `Check size-3` "반영됨 · 교체" / "반영됨 · 덧붙임"(`applied_mode`) `[가정: 방식 글자]` | 블록 목록 기본 접힘(머리만). 펼치면 읽기 전용 | 없음 |
| 초안 실패 | 없음(이전 초안 상태 그대로) | 카드 맨 위에 C-20 inline형 — 제목 줄은 명세 "초안을 만들지 못했어요. 이전 초안은 그대로예요" + 원인 문구 + `RetryButton` "다시 시도" | 이전 상태 그대로 |
| 초안 상한 (`draft_count = 6`) | 남은 횟수 `0 / 6` 경고색 | 그대로 | 반영 버튼 위 `Alert variant="info"` 작은 형 명세 문구 + `Button variant="outline" size="sm"` "새 대화" |

**부가 정보** (블록 목록 아래, `mt-3 space-y-2`, 있을 때만)

- **확인이 필요한 내용 N개**: `Collapsible` 기본 접힘. 트리거 `Button variant="ghost" size="sm"` + `TriangleAlert size-4 text-warning` + `text-sm text-warning-subtle-foreground` "확인이 필요한 내용 N개" + `ChevronRight`(펼침 `rotate-90`). 펼친 행 = `rounded-md border border-warning/40 p-2.5 space-y-1.5`: 사실 문장 `text-sm` + 사실 칩 + `[수락]` outline sm · `[거절]` ghost sm.
- **아직 비어 있는 부분**: `flex flex-wrap items-center gap-1.5` — `caption text-muted-foreground` "아직 비어 있는 부분:" + 슬롯마다 `Button variant="chip-dashed"` (`h-7`, `MessageCircleQuestion size-3.5` + 슬롯 표시명). 누르면 그 슬롯 묻기 메시지를 보낸다(칩과 같음). 응답 중·상한이면 `disabled`.
- **뺀 문장**: `caption text-muted-foreground` + `EyeOff size-3.5` "확인되지 않은 문장 N개는 뺐어요".
- **교체 불가**: `meta text-muted-foreground` + `Info size-4` 명세 문구(`replace_allowed = false`).

**반영 버튼 묶음** (바닥, `flex flex-wrap justify-end gap-2`, 모두 `outline size="sm"`)

| 폼 본문 | 버튼 |
|---------|------|
| 비어 있음 | `[본문에 넣기]` + `ArrowLeftToLine` 하나 |
| 있음 | `[본문 교체]` + `Replace` · `[뒤에 덧붙이기]` + `ListPlus`. `replace_allowed = false`면 [본문 교체]를 그리지 않는다 |

- 비활성 이유는 버튼 위 안내 줄(`caption text-muted-foreground`, `Info size-3.5`)로 보인다. 툴팁만 두지 않는다(A-7, 비활성 버튼은 포커스가 안 된다): [뒤에 덧붙이기] 비활성 → "덧붙일 새 내용이 없어요(지금 본문을 다시 정리한 초안이에요)" / 모두 비활성 → "검토가 필요한 문장을 수락하거나 빼 주세요" / 검토 안 한 블록이 남음 → "검토하지 않은 문장 N개는 넣지 않아요".
- 20,000자 초과로 못 채움: 안내 줄 자리에 `text-sm text-warning-subtle-foreground` + `TriangleAlert` 명세 문구.
- **교체 확인** `AlertDialog sm:max-w-md`:
  - 기본: 제목 "지금 본문을 AI 초안으로 바꿀까요?", 설명 `body text-muted-foreground` "저장하기 전에는 되돌릴 수 있어요", 버튼 `취소`(outline) · `바꾸기`(default — 덮어쓰기 규칙, 2장).
  - **기준 본문이 바뀜**(`base_body_hash` 불일치): 제목 앞 `TriangleAlert size-5 text-warning`, 제목 "초안을 만든 뒤 본문이 바뀌었어요", 설명 "교체하면 바뀐 내용도 사라져요", 버튼 `취소`(outline) · `그래도 바꾸기`(default). 기본형과 아이콘·제목이 달라 한눈에 구분된다. destructive는 쓰지 않는다(삭제가 아니고 저장 전 되돌릴 수 있음) `[가정]`.
- **채운 직후**: 왼쪽 본문 칸 `animate-field-flash` + 바뀐 부분 맨 앞으로 커서를 두지 않고 스크롤만(덧붙이기는 끝, 교체·넣기는 처음) `[가정]` + Sonner 중립 토스트 "본문에 채웠어요" 액션 "되돌리기"(8초 `[가정]`, 되돌리기는 다음 본문 입력 전까지만 유효 — 그 뒤 누르면 토스트가 "이미 본문을 고쳐서 되돌릴 수 없어요"로 바뀐다 `[가정]`).
- 초안 턴 중(질문 턴 포함 AI 응답 중)에는 반영 버튼·블록 버튼 모두 `disabled`.

---

## 4. 상태 패턴 (ST-xx)

| 상태 | 컴포넌트 | 아이콘 · 색 | 레이아웃 · 문구 위치 |
|------|----------|-------------|---------------------|
| **ST-EMPTY** | `EmptyState` | `div.size-10 rounded-full bg-muted` 안 lucide 아이콘 `size-5 text-muted-foreground`(화면별: 커리어 `Layers`, 기업 JD `Briefcase`, 면접 `MessagesSquare`, 보드 `KanbanSquare`) | 콘텐츠 영역 위쪽 1/3, `mx-auto max-w-md text-center py-16 space-y-3`. 제목 `subsection`, 설명 `body text-muted-foreground`, 버튼 묶음 `flex justify-center gap-2`(주 1 + 보조 1). 일러스트 금지 |
| **ST-LOADING** | `Skeleton` | `bg-muted animate-pulse` | 실제 레이아웃 모양대로(목록 행 3~5개, 카드 2개). 300ms 지연. 화면 전체 스피너 금지 |
| **ST-AI-SYNC** | 버튼 로딩 | `Loader2 animate-spin` | 실행 버튼 안(`disabled`, 글자 유지) + 결과 자리 `Skeleton`. 15초 넘으면 버튼 아래 `meta` "조금 더 걸리고 있어요" `[가정]` |
| **ST-AI-PENDING** | `AiProgress` (C-03) | `ai` | 결과가 나올 자리 맨 위 |
| **ST-AI-STREAM** | C-04 | `ai` | 결과 자리 안에서 블록 단위 |
| ~~**ST-AI-FAILED**~~ | **v2: C-20으로 대체** | — | `AiFailed`를 `AiErrorNotice`(3.20)로 바꾼다. "사용량은 차감되지 않았습니다" 줄은 삭제하고, 그 자리를 "입력과 지금까지 만든 결과는 그대로 있어요" 보존 줄이 대신한다 |
| **ST-AI-LOCKED** (v2) | C-18 `AiLock` | `PlugZap` · primary-subtle | 3.18. 기존 결과가 없으면 영역형, 있으면 인라인형 |
| **ST-AI-KEY-MISSING** (v2) | C-20 `key_missing` | `KeyRound` · warning | 실행 중 키가 삭제된 경우다. 결과 자리 맨 위에 block형을 두고, 입력은 그대로 남긴다. 동작은 "AI 연결하기" / "입력으로 돌아가기" |
| **ST-AI-KEY-CHECK** (v2) | C-19 주의형 | `CircleHelp` · warning | 잠그지 않는다. 실행 버튼은 정상이고, 옆 배지만 주의형이다. S-40의 해당 카드는 "다시 확인"을 강조한다(5.7) |
| ~~**ST-LIMIT**~~ | **v2 폐기** | — | 서비스 월간 한도가 없어졌다(D-34). `LimitNotice`·실행 버튼 `disabled` 처리도 삭제한다. 공급자 쪽 한도(분당·일일)는 C-20 `rate_limited`·`daily_quota_exhausted`가 맡는다 |
| **ST-INSUFFICIENT** | C-09 | primary-subtle 아이콘 원 | 3.8 |
| **ST-WAIT-JD** | 인라인 | `Loader2 animate-spin text-ai` + `text-sm text-muted-foreground` | 실행 버튼 아래, 버튼 `disabled` |
| **ST-MOVE-FAILED** | 보드 | 카드 원위치 애니메이션 200ms + Sonner 토스트 `CircleAlert text-destructive` "이동하지 못했어요" + 액션 "다시 시도" | |
| **ST-SAVE-FAILED** | C-06 실패형 | `text-destructive` | 저장 상태 자리. 입력 값은 그대로 둔다. **제출형 실패**(자동 저장이 아닌 버튼 제출: 폼 저장, 동의, 탈퇴, 대화 저장 등)는 문장 틀 하나로 통일: "{대상}을(를) 저장하지 못했어요. 입력한 내용은 그대로 있어요" + 동작 "다시 시도". 대상 없는 동작(탈퇴·로그아웃)은 "{동작}하지 못했어요. 잠시 후 다시 시도해 주세요". 공통 상수로 두고 화면은 대상만 넘긴다 `[가정]` (리더 결정 2026-10-25, UQ-128) |
| **ST-UNAUTH / NOTFOUND** (S-28) | `ErrorState` | EmptyState와 같은 배치, 아이콘 `LockKeyhole` / `FileQuestion` | 셸 안이면 콘텐츠 영역, 밖이면 화면 가운데. 버튼 "커리어로 가기" / "로그인" |
| **공급자 장애 배너** (S-28, v2: 공급자별) | `Alert variant="warning"` 전체 폭, `rounded-none border-x-0 border-t-0` | `CloudAlert` | 셸 상단 바 바로 아래, 모든 화면. **활성 공급자가 영향을 받을 때만** 보인다. 문구는 "{공급자}에 일시적인 문제가 있어요. 커리어 입력과 열람, 기업 JD, 지원 현황 보드는 정상이에요"이고, 오른쪽에 "{공급자} 상태 페이지" 외부 링크와 닫기(`X`, 세션 동안 숨김) `[가정]`을 둔다. 공급자가 둘 이상 영향을 받아도 활성 공급자 하나만 보인다 |

---

## 5. 레이아웃 패턴

### 5.1 L-01 대시보드 셸

shadcn **sidebar-08** 블록(inset 사이드바 + 보조 메뉴)을 기반으로 한다 (사용자 결정 2026-10-25). 블록과 다른 점은 접었을 때 아이콘 레일이 남는 것(`collapsible="icon"`)뿐이다.
파일: `components/common/shell/` — `app-sidebar.tsx`, `nav-main.tsx`, `nav-secondary.tsx`, `nav-user.tsx`(블록 파일 구성과 같음), 상단 바 `shell-parts.tsx`.

**넓은 화면(≥1024) — 펼친 상태**

```
 bg-sidebar (전체 바탕)
┌────────────────┐ ╭──────────────────────────────────────────╮
│ [◆] Resumate   │ │ 상단 바 h-16 (패널 안 sticky): [⊟] │ Breadcrumb · 동작 │
│     AI 커리어…  │ │ [C-10 복귀 배너 / AI 장애 배너]             │
│ 메뉴            │ │ main: flex-col gap-4 p-4 pt-0,             │
│ ▤ 커리어      • │ │       폭 토큰은 화면 종류별(1.4)            │
│ ▣ 기업 JD 관리 2│ │                                           │
│ ▢ 모의 면접   1 │ │   SidebarInset: m-2 ml-0 rounded-xl        │
│ ▥ 지원 현황     │ │   shadow-sm bg-background                  │
│                │ │                                           │
│ ⌁ Gemini·무료 ● │ │                                           │
│ ⚙ 설정          │ │                                           │
│ ▯ 개인정보 처리방침│ │                                           │
│ [J] 이름  ⇅     │ │                                           │
│     이메일       │ ╰──────────────────────────────────────────╯
└────────────────┘
```

**넓은 화면 — 접은 상태(아이콘 레일)**

```
┌────┐ ╭─────────────────────────────────────────────────────╮
│[◆] │ │ 상단 바 h-16: [⊟] │ Breadcrumb                        │
│ ▤• │ │                                                     │
│ ▣• │ │ main                                                │
│ ▢• │ │                                                     │
│ ▥  │ │                                                     │
│ ⌁● │ │                                                     │
│ ⚙  │ │                                                     │
│ ▯  │ │                                                     │
│[J] │ │                                                     │
└────┘ ╰─────────────────────────────────────────────────────╯
```

- 구조: `SidebarProvider` > `AppSidebar`(`variant="inset" collapsible="icon"`) + `SidebarInset`(넓은 화면(≥1024, 서랍 기준과 같게 `lg:`로 바꿈)에서 `m-2 ml-0 rounded-xl shadow-sm`, 바탕 `bg-sidebar` 위에 뜬 패널) > 상단 바 + 콘텐츠.
- 사이드바 머리(`SidebarHeader`): `SidebarMenuButton size="lg"` 안에 로고 사각형(`size-8 rounded-lg bg-sidebar-primary text-sidebar-primary-foreground`, 아이콘 `Sparkles size-4` `[UI-가정]`) + 두 줄 글자("Resumate" `font-medium` / "AI 커리어 관리" `text-xs` `[UI-가정]`).
- 주 메뉴(`NavMain`): `SidebarGroupLabel` "메뉴" `[UI-가정]` + `SidebarMenuButton`(아래 "메뉴 크기", 툴팁): 커리어 `Layers`, 기업 JD 관리 `Briefcase`, 모의 면접 `MessagesSquare`, 지원 현황 `KanbanSquare` `[가정]`. 현재 메뉴는 기본 `data-active`(`bg-sidebar-accent font-medium`). v4부터 `--sidebar-accent`는 primary 10%, 글자는 `--primary-text`라 hover·선택이 ghost 버튼과 같은 초록이다. 블록의 하위 메뉴(접이식 `SidebarMenuSub`)는 지원하지만 지금 쓰는 메뉴는 없다. 블록의 Projects 묶음은 쓰지 않는다.
- **메뉴 크기**(사용자 결정 2026-10-26: shadcn 기본 h-8 / `text-sm`이 작아서 primitive `components/ui/sidebar.tsx` 자체를 키움 — 메인 사이드바·설정 다이얼로그·서랍에 모두 적용):
  | 요소 | 값 |
  |------|-----|
  | `SidebarMenuButton` default | `h-10 text-base`(16px, 본문과 같음), `px-2.5 gap-2.5`, 아이콘 `size-5` |
  | `SidebarMenuButton` sm (보조 메뉴) | `h-9 text-sm`, 아이콘 `size-4` |
  | `SidebarMenuButton` lg (로고·사용자) | `h-12 text-sm` |
  | `SidebarMenuSubButton` | `h-9`, md `text-base` / sm `text-sm` |
  | `SidebarMenuBadge` · `SidebarMenuAction` | `h-6 min-w-6` / `w-6`, 버튼 크기별 세로 위치(default `top-2`, sm `top-1.5`, lg `top-3`) |
  | 사이드바 폭 | 펼침 `16rem`(256px), 아이콘 레일 `3.5rem`(56px = 버튼 40 + 여백 16; inset은 +16) |
  | 아이콘 레일 버튼 | `size-10 p-2.5`(lg는 `p-1`로 32px 로고·아바타 가운데) |
  | 서랍(<1024) | 메뉴 터치 대상 `h-11` |
- 메뉴 배지: 기본 `SidebarMenuBadge`(숫자). 커리어는 숫자 대신 점(`size-2 rounded-full bg-primary`) + `sr-only` "작성 중인 AI 대화 있음". 진행 중 AI 작업은 숫자만.
- 보조 메뉴(`NavSecondary`, `mt-auto`로 메뉴 맨 아래, `size="sm"`): (v2) **AI 연결 상태 한 줄** · 설정(`Settings`, 페이지 이동 대신 **설정 다이얼로그**를 연다) · 개인정보 처리방침(`FileText`, S-30 링크).
- **(v2) AI 연결 상태 한 줄** (`NavAiStatus`, F-AI-09). 위치는 `NavSecondary`의 첫 항목, 곧 설정 바로 위다. NavUser 위에 두지 않은 이유는 상태 줄이 "설정으로 가는 입구"라서 설정과 같은 묶음이 맞기 때문이다(리더 위임 → 디자이너 결정). 메뉴 4개와는 `mt-auto`로 떨어져 있다.
  | 상태 (`ai_connection`) | 펼침: `SidebarMenuButton size="sm"` | 접힌 레일: 아이콘 + 상태 점 |
  |------------------------|-----------------------------------|----------------------------|
  | 연결 안 됨 | `PlugZap` + "AI 연결 안 됨" (`text-muted-foreground`) | `PlugZap`. 점 없음 |
  | `valid` | `PlugZap` + C-19 연결 배지 글자 "Gemini · 무료 등급"(배지 테두리 없이 글자만, `truncate`) + 오른쪽 점 `size-2 rounded-full bg-success` | `PlugZap` + 오른쪽 위 점 `bg-success` |
  | `needs_check` | `CircleHelp text-warning` + "{공급자} · 확인 필요" | `CircleHelp` + 점 `bg-warning` |
  | `invalid` | `TriangleAlert text-warning` + "{공급자} · 키를 확인해 주세요" | `TriangleAlert` + 점 `bg-warning` |
  - 점 모양은 메뉴 배지 점과 같다(`size-2 ring-2 ring-sidebar`). 점에 색만 쓰지 않도록 아이콘이 상태마다 바뀌고, 툴팁(레일)과 `sr-only`(펼침)가 전체 글자를 준다(R-C6).
  - 누르면 **설정 다이얼로그를 "AI 연결" 섹션으로 연다**. 설정 버튼과 동작을 맞춘 것이다. 서랍(<1024)에서도 같고, 터치 대상은 `h-11`이다 `[가정]`.
- 하단(`NavUser`): `SidebarMenuButton size="lg"`에 `Avatar`(`h-8 w-8 rounded-lg`, 이니셜) + 이메일 앞부분 / 이메일 두 줄 + `ChevronsUpDown`. 누르면 `DropdownMenu`(넓은 화면 오른쪽, 서랍에서는 아래, 트리거 폭): 계정 표시 · 설정(설정 다이얼로그) · 로그아웃(S-24와 같은 동작).
- **설정 다이얼로그**(S-24, shadcn **sidebar-13** 기반, 사용자 결정 2026-10-26, `shell/settings-dialog.tsx`): `DialogContent overflow-hidden p-0 md:max-h-[500px] md:max-w-[700px] lg:max-w-[800px]` 안에 별도 `SidebarProvider` → 왼쪽 `Sidebar collapsible="none"`(md 이상) 섹션 목록(계정 `UserRound` · **(v2) AI 연결 `PlugZap` · AI 사용량 `Gauge`** · 동의 관리 `ShieldCheck` · AI 데이터 처리 `Sparkles` · 처리방침·약관 `FileText` · 회원 탈퇴 `UserX`. 새 두 섹션은 계정 바로 아래에 둔다 `[가정]`. "AI 연결" 항목은 `invalid`·`needs_check`일 때 이름 오른쪽에 `size-2 bg-warning` 점과 `sr-only` 상태를 단다), 오른쪽 `h-16` 머리에 이동 경로 "설정 › {섹션}"(md 미만은 섹션만), 본문은 `overflow-y-auto p-4 pt-0`, 높이 `h-[480px]`. 열 때마다 계정·동의 데이터를 다시 읽고(로딩 `Skeleton`, 실패 시 "설정을 불러오지 못했어요" + 다시 시도 `[UI-가정]`), 다이얼로그 밖으로 가는 링크(기본 프로필 편집, 약관, 회원 탈퇴)는 다이얼로그를 닫고 이동한다. 블록은 md 미만에서 섹션 목록을 숨기므로, 좁은 화면에서는 머리 아래 가로 섹션 버튼 줄(`Button size="sm"`, 현재 `secondary`)로 대신한다 `[UI-가정]`. 섹션 내용은 `/settings` 페이지와 같은 컴포넌트(`account/settings-sections.tsx`)를 쓴다.
- 접기: 상단 바 `SidebarTrigger`(`aria-label` 펼침 "메뉴 접기" / 접힘 "메뉴 펼치기" / 서랍 "메뉴 열기"), `SidebarRail`, `⌘/Ctrl+B`. 접으면 **완전히 숨기지 않고** 아이콘 레일로 남는다: 로고 사각형·메뉴 아이콘·보조 메뉴 아이콘·아바타만, 이름은 툴팁, 배지 숫자 대신 아이콘 오른쪽 위 점(`size-2 bg-primary ring-2 ring-sidebar`). 펼침 상태는 `sidebar_state` 쿠키에 쓰인다(첫 렌더 복원은 아직 하지 않음 `[UI-가정]`).
- 상단 바: 블록과 같이 `flex h-16 shrink-0 items-center gap-2` · `SidebarTrigger -ml-1` · `Separator orientation="vertical" mr-2 h-4` · `Breadcrumb`. **상단 고정**(사용자 결정 2026-10-26): `SidebarInset`이 스크롤 영역(`h-dvh overflow-y-auto`, lg `h-[calc(100dvh-1rem)]` — inset 여백만큼 뺌)이고 상단 바는 그 안에서 `sticky top-0 z-20 bg-background`. 창(body)은 스크롤하지 않는다. 오른쪽에 화면 동작(`PageTopActions`). 상단 바 아래에 붙는 sticky 요소(C-10 배너, 커리어 연도 머리)는 `top-16`. 화면 높이를 쓰는 레이아웃(S-36 대화)은 `100dvh - 4rem`(lg는 inset 여백 1rem 더 뺌).
- 이동 경로: 마지막 마디 `font-medium text-foreground`, 앞 마디 `text-muted-foreground hover:text-foreground`, 긴 이름 `max-w-[16rem] truncate`. 화면이 경로를 선언하지 않으면 현재 메뉴 이름을 보인다.

**좁은 화면**

- `<1024`: 사이드바는 shadcn 모바일 모드 서랍(`Sheet side="left"`), 내용은 펼친 메뉴와 같고 메뉴 터치 대상 `h-11`. 메뉴 선택 시 닫힘. `SidebarInset`은 여백·둥근 모서리 없이 전체 폭(inset은 `lg:` 이상에서만 — 블록의 `md:`를 서랍 기준 1024에 맞춤).
- `<768`(md): 이동 경로는 마지막 마디만(블록과 같음). 상단 바 오른쪽 동작은 1개까지(나머지는 `⋯` 메뉴).

### 5.2 목록 · 상세

- **목록 화면**(S-13, S-37): `PageHeader`(제목 + 주 버튼 "+ 기업 JD 추가"/"새 면접" + 보조 "보드로 보기") → 필터 줄(`flex flex-wrap gap-2`, `Select size sm`/검색 `Input h-9 w-64`) → 넓은 화면 `Table`, 좁은 화면 카드 목록(`Card p-4 space-y-2`, 행의 열을 위아래로).
  - 행 전체가 링크(`cursor-pointer hover:bg-accent`), 행 메뉴 `⋯`는 행 끝, 클릭 전파 막음.
  - 고정 묶음(S-37 "작성 중")은 목록 위 별도 `Card`, 아래 묶음("그만둔 면접")은 `Collapsible` 접힘 기본 + `meta` 개수.
- **허브**(S-31): 헤더 카드(이름 `page-title` + 인라인 수정 `Button variant="ghost" size="icon-sm"` `Pencil`, 회사·포지션 `meta`, 단계 칩(C-12), `DDay`) → 기능 카드 그리드 `grid gap-4 md:grid-cols-2`: JD·요건 / 인사이트 / 서류 초안 / 면접. 각 카드 `Card p-5`: 제목 `section-title` + 상태 배지 + 요약 `meta` + 하단 `Button variant="outline" size="sm"` "열기". 진행 중이면 C-03 축약형.
- **트리**(S-08 커리어): 5.6 영역 메모 참고.

### 5.3 편집기

- **폼 화면**(S-04, S-14. (v5) S-10은 L-02 문서형 페이지 5.9로 옮겼다. S-09·S-34는 v5.5에서 S-08 오른쪽 패널이 됐다 — 8.4 P-15): `max-w-form` 한 열. 상단 `PageHeader`(제목 + 오른쪽 C-06) → 섹션 카드(`Card p-5 space-y-4`, 섹션 제목 `subsection`) → 맨 아래 위험 영역(삭제, `Button variant="ghost" className="text-destructive"`). 자동 저장이므로 "저장" 버튼은 두지 않는다(명세 C-06). 필수 표시: 라벨 뒤 `text-destructive` "*" + `sr-only` "필수".
  - 필드 2열: 넓은 화면에서 짧은 값(기간, 고용 형태)만 `grid sm:grid-cols-2 gap-4`. 긴 글은 항상 한 열.
- **긴 글 편집**(S-33 답변. (v5) S-35는 폐기 — S-10 STAR는 5.9 `DocTextarea`): 본문 열 `max-w-prose-edit`. 필드마다 `label`(예: "행동 (A) *") + 안내 `meta` + `Textarea prose`(16px/1.75, `min-h-32`) + C-07 + 글자 수. 필드 사이 `space-y-6`. 포커스 이동(C-02 "원본으로 이동")된 필드는 `ring-2 ring-ring` + `animate-field-flash` 1회.
- **초안 편집기**(S-19): 넓은 화면(≥1280) `grid grid-cols-[minmax(0,1fr)_20rem] gap-8`: 왼쪽 문서(`max-w-prose-edit mx-auto`, 블록마다 hover 시 `bg-accent/50 rounded-md`, 블록 아래 칩 줄 C-01·C-08), 오른쪽 `sticky top-20` 패널(C-11, 자리 표시 목록, 글자 수). 1280 미만은 패널을 머리의 `Button variant="outline" size="sm"` "근거·출처"로 여는 `Sheet side="right"`.
  - 자소서 문항 머리: `section-title` 문항 + `caption` 글자 수. (v3) 글자 수 글자와 초과 표시는 6장 A3 "S-19 글자 수 표시"를 따른다.

### 5.4 대화 (S-36)

> **(v5) S-36은 플로우 v5.5에서 폐기됐다.** AI 작성 대화는 S-10·S-44의 Resumate AI 패널(5.10)로 옮겼다. 이 절은 이력과, 5.10이 가져다 쓰는 규칙(시작 인사·무료 등급 문장·전송 차단·실패한 턴 대기)의 원본으로만 남긴다. 새 화면에 이 절의 2단·탭·정리 결과 패널·하단 동작을 쓰지 않는다.


**넓은 화면(≥1280)**: `grid h-[calc(100dvh-3.5rem)] grid-cols-[minmax(0,1fr)_minmax(24rem,32rem)]` — 페이지 전체가 아니라 두 열이 각각 스크롤.

```
┌ 왼쪽: 대화 ───────────────────────────┬ 오른쪽: 정리 결과 (bg-card border-l) ─┐
│ [게이트 배너 info-subtle]             │ 머리: "정리 결과" + 검토 필요 N개 배지  │
│ 진행 단계 스텝: 기본 정보›상황›과제…    │ 소속 칸                               │
│ ─ 메시지 목록 (max-w-prose-edit mx-auto)│ 프로젝트 기본 정보                     │
│   AI: 아바타 + 본문(prose)             │ 상세 내용 카드 …                       │
│            사용자 말풍선 #n →          │                                       │
│ ─ 입력창 (sticky bottom)              │ 하단 sticky: [폼으로 전환] [저장]      │
└──────────────────────────────────────┴───────────────────────────────────────┘
```

- 진행 단계 스텝: `ol flex gap-1 overflow-x-auto text-sm`, 각 단계 `Button variant="ghost" size="sm"` — 채움 `Check size-3.5 text-success` + 글자, 현재 `bg-primary-subtle text-primary-subtle-foreground font-medium`, 대기 `text-muted-foreground`. 사이 `ChevronRight size-3.5 text-muted-foreground`.
- AI 메시지: 말풍선 없음. `flex gap-3`: 아바타 `size-7 rounded-full bg-ai-subtle grid place-items-center` + `Sparkles size-4 text-ai`, 본문 `prose`. 스트리밍 중 C-04 커서.
- 사용자 메시지: 오른쪽 정렬 `ml-auto max-w-[85%] rounded-lg rounded-br-sm bg-secondary px-4 py-3 prose`, 위에 `caption text-muted-foreground` "내 답변 #n". 클릭 가능(출처 필드 강조) → `cursor-pointer hover:ring-1 hover:ring-border`.
- 메시지 간격 `space-y-6`. 민감정보 안내는 해당 AI 메시지 아래 `Alert variant="info"` 작은 형(`text-sm`).
- 실패한 턴: AI 메시지 자리에 C-20 inline형(3.20). 원인 문구 + "다시 보내기". 대화 상단(진행 단계 스텝 오른쪽)에는 C-19 연결 배지를 둔다(v2).
- 입력창: `sticky bottom-0 border-t bg-background p-4`, 안쪽 `max-w-prose-edit mx-auto`: 빠른 응답 `Button variant="outline" size="sm"` 2개 → `Textarea` (`field-sizing-content min-h-12 max-h-48 text-base`) + 보내기 `Button size="icon"` (`ArrowUp`, `aria-label="보내기"`) → 아래 줄 G-2(`meta`) 왼쪽, `n / 40` 오른쪽(`caption tabular-nums`, 36 이상 `text-warning-subtle-foreground`). 응답 중 입력 `disabled` + 보내기 자리에 C-04 "중단".
- **(v3) 시작 인사** (서버가 넣는 고정 AI 메시지, 메시지 목록 맨 위): AI 메시지와 같은 배치(아바타 + `prose`)다. 번호, 출처 칩, 클릭 강조가 없다. 스트리밍 커서 없이 처음부터 전부 보인다. 메시지 수에 세지 않으므로 `n / 40`이 바뀌지 않는다. 무료 등급 문장은 본문 아래에 따로 둔다: `mt-3 flex gap-2 rounded-md bg-warning-subtle px-3 py-2 text-sm text-warning-subtle-foreground` + `TriangleAlert size-4 text-warning shrink-0 mt-0.5`. C-21 `FreeTierNotice`의 작은 형이다.
- **(v3) 메시지 상한**: 사용자 메시지는 `message_count` ≤ 38일 때만 보낼 수 있다. 39는 AI 응답 중이라 응답 중 규칙대로 비활성이다. 40이 되면 `Textarea`, 보내기, 빠른 응답을 `disabled`로 둔다. G-2 줄 자리는 `text-sm text-muted-foreground` "저장하거나 폼으로 옮겨 이어서 써 주세요"로 바꾸고, 카운터 `40 / 40`은 `text-warning-subtle-foreground`로 둔다. 마지막 AI 메시지 아래에는 `Alert variant="info"`로 명세의 상한 문구를 두고 [저장] default · [폼으로 전환] outline · [새 보강 대화] outline을 단다.
- **(v3) 실패한 턴의 대기**: 분당 한도·공급자 장애는 3.20 "요청 안에서 끝나는 경로의 대기"를 따른다. "{N}초 뒤 다시 보낼 수 있어요" 줄, "다시 보내기 (0:12)", 활성 공급자 배지가 보인다.
- **(v3) 전송이 막힐 때** (`key_missing`, `key_invalid`): 보낸 메시지를 목록에 넣지 않고 입력창 글자를 그대로 둔다. 입력 영역(`sticky` 막대) 안, `Textarea` 바로 위에 C-20 inline형을 둔다. 키 없음이면 "AI 연결하기", 키 무효면 "키 교체"이다. 다시 읽은 readiness가 동의 원인이면 C-20 대신 C-21 동의 창을 열고, 동의하면 그 글자를 그대로 보낸다. 실행 전에 `consent_required`를 알면 보내기를 누를 때 바로 동의 창을 연다. 안내는 다음 전송까지 남는다 `[가정]`.
- **(v3) 정리 결과 입력 길이**: 미리보기 직접 수정 칸의 글자 수는 C-07 글자 수 규칙(90% 넘으면 경고색, 넘으면 `text-destructive`)을 따른다. 상한은 명세의 구현 값(이름·역할 100자 등)이다.
- **(v3) 대화 그만두기**: 대화 머리 오른쪽에 `⋯`(`Button variant="ghost" size="icon-sm"`, `aria-label="대화 메뉴"`)를 둔다. 메뉴는 "대화 그만두기"(`PauseCircle`, `status = 'active'`일 때만) · 구분선 · "대화 삭제"(`text-destructive`, C-05) 순서다. 확인은 `AlertDialog`로 명세 문구를 보이고, 확인 버튼은 `default` "그만두기"이다 `[가정: 버튼 글자]`. 삭제가 아니므로 destructive를 쓰지 않는다. 확인하면 S-08로 간다. S-08은 "그만둔 대화" 묶음을 펼친 채 그 행에 `animate-field-flash`를 한 번 준다 `[가정]`.
- **(v3) 그만둔 대화 열기** (`status = 'abandoned'`): 대화와 정리 결과는 `saved`·`handed_off`처럼 읽기 전용이다 `[가정: 미리보기 읽기 전용]`. 입력창 자리에는 `sticky bottom-0 border-t bg-background p-4` 막대를 둔다. 왼쪽은 `PauseCircle size-4 text-muted-foreground` + `text-sm text-muted-foreground` "그만둔 대화예요" `[가정: 문구]`, 오른쪽은 `Button size="sm"` default "다시 이어 하기"이다. AI 호출이 없으므로 C-19 배지를 붙이지 않고, 키가 없어도 활성이다. 누르면 버튼이 로딩 상태가 되고, `active`로 바뀌면 입력창이 돌아오며 `Textarea`에 포커스를 둔다.
- 정리 결과 패널: 필드 블록 `space-y-5`, 필드 = 라벨 줄(라벨 `label` + C-15 상태) + 값(`prose`, 편집 시 `Textarea` 인라인). 상세 내용 카드 `Card p-4`, 기존 상세 내용(보강 모드) 채워진 필드는 `text-muted-foreground` + `Lock size-3` "기존 내용" `caption`. 갱신된 필드 `animate-field-flash`. "정리 중" 상태: 패널 머리에 C-03 축약형 "정리 중".
- 하단 동작: `sticky bottom-0 border-t bg-card p-4 flex gap-2 justify-end`: `Button variant="outline"` "폼으로 전환" · 주 버튼 "저장" 또는 "저장하고 돌아가기"(`ready_to_return`일 때만 default, 아니면 "저장"도 default — 화면에 주 버튼 하나).
- **1280 미만**: `Tabs` "대화 / 정리 결과 (검토 N)" 두 탭, 탭 목록은 진행 스텝 위 `sticky`. 정리 결과 탭 배지에 갱신 점(`size-2 bg-ai rounded-full`)으로 새 내용 알림. `[가정]` (명세는 모바일만 탭 → 태블릿 폭까지 확장, 8장)

### 5.5 보드 (S-39)

**넓은 화면(≥768)**

- 보드 영역: `flex gap-3 overflow-x-auto pb-4` (페이지가 아니라 보드 영역만 가로 스크롤, `px-6`), 높이 `h-[calc(100dvh-3.5rem-HeaderH)]`.
- 열: `flex w-72 shrink-0 flex-col rounded-xl bg-muted/60 p-2` — 머리 `flex items-center gap-2 px-2 py-1.5`: `StatusDot` + `label` 단계 이름 + `Badge variant="count"`(카드 수, 여기선 `bg-background text-muted-foreground`) + (지원 전 열만) 오른쪽 `Button variant="ghost" size="icon-sm"` `Plus` `aria-label="기업 JD 추가"`. 카드 목록 `flex-1 space-y-2 overflow-y-auto` (`ul`).
- 카드(`li`): `group rounded-md border bg-card p-3 space-y-2 transition-colors hover:border-foreground/20 hover:shadow-sm focus-within:ring-2 focus-within:ring-ring`
  - 1행: 회사명 `font-semibold text-base truncate` + 오른쪽 `⋯`(C-12)
  - 2행: 포지션 `text-sm text-muted-foreground line-clamp-2`
  - 3행 `flex flex-wrap items-center gap-2 caption`: `DDay` · 인사이트 `Lightbulb size-3.5`(있을 때 `text-foreground`, 없으면 `text-muted-foreground/60`) · 초안 `FileText` n · 면접 `MessagesSquare` n(작성 중이면 `Badge variant="draft"` "작성 중") — 아이콘 옆 숫자, 각 `sr-only` 라벨
  - 전형 종료 카드: 3행 앞에 결과 배지(1.1.4)
  - 드래그 손잡이: 카드 왼쪽 위 `GripVertical size-4 text-muted-foreground`, 정지 시 `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100`(키보드 포커스 시 보임). 카드 본문 클릭 = S-31 이동, 손잡이 = 드래그.
- 드래그 중: 원래 자리 `border-dashed bg-transparent opacity-50`, 끌리는 카드 `shadow-lg ring-1 ring-border rotate-[1deg]`(reduced-motion이면 회전 없음), 놓을 수 있는 열 `ring-2 ring-primary/40 bg-primary-subtle/60`.
- 마감 임박(D-3 이내): 카드 테두리는 바꾸지 않고 `DDay`의 warning 배지만(카드 전체 강조는 보드를 시끄럽게 함) `[가정]`.
- 빈 열: 열 안 `rounded-md border border-dashed p-4 text-center caption text-muted-foreground` "카드 없음" `[가정: 문구, P-4]`.

**좁은 화면(<768)**: 보드 영역 대신 `Tabs` — `TabsList` 가로 스크롤(`overflow-x-auto`, 각 탭 `StatusDot` + 단계 이름 + 카드 수), 한 번에 한 열의 카드 목록(전체 폭, 같은 카드 모양). 드래그 손잡이 숨김, 이동은 `⋯` → C-12(T-8). "+"는 지원 전 탭 위 `Button variant="outline" className="w-full"` "기업 JD 추가".

### 5.6 모달 · 시트 사용 기준

| 상황 | 쓰는 것 |
|------|---------|
| 되돌릴 수 없는 결정(삭제, 덮어쓰기, 결과 지우기) | `AlertDialog` |
| 짧은 선택·작은 폼(정량 성과 S-11, C-13, C-14, C-16, 저장 확인) | `Dialog` |
| 참고 정보를 보면서 원래 화면을 유지(C-02, S-19/S-36 보조 패널, 좁은 화면 필터) | `Sheet side="right"` (좁은 화면 필터는 `side="bottom"`) |
| 다른 화면으로 가는 일 | 페이지 이동(모달로 화면을 대신하지 않음) |

- 모달 안 주 버튼은 오른쪽 끝, 좁은 화면에서 `flex-col-reverse` 전체 폭.
- 다이얼로그 위에 다이얼로그 금지(C-11 다시 생성 확인은 패널 위 AlertDialog — 패널은 Sheet라 허용).

### 5.7 AI 연결 화면 (S-40 · S-41 · S-42, v2 신설)

**놓이는 곳** (리더 결정 2026-10-28)

| 화면 | 설정 다이얼로그 안 | 라우트 페이지 |
|------|-------------------|---------------|
| S-40 AI 연결 | 섹션 "AI 연결" | `/settings/ai`. C-18 복귀 흐름, L-01 하단 줄을 직접 주소로 열 때 |
| S-42 AI 사용량 | 섹션 "AI 사용량" | `/settings/ai/usage` |
| S-41 키 연결 단계 | 없음. 다이얼로그에서 연결을 시작하면 다이얼로그를 닫고 이동한다 | `/settings/ai/connect?provider=` (복귀 대상 유지) |

- 섹션과 페이지는 **같은 내용 컴포넌트**를 쓴다(`account/` 영역). 다이얼로그 안에서는 본문 폭이 약 560px이므로 카드를 세로 목록으로만 배치하고, 페이지도 같은 세로 목록(`max-w-form`)으로 맞춘다. 두 곳의 모양이 갈라지지 않게 하려는 것이다.
- 다이얼로그 안에서 S-40의 "사용량 입구"를 누르면 섹션만 바꾼다(페이지 이동 없음). 페이지에서는 `/settings/ai/usage`로 이동한다.

**S-40 AI 연결**

```
(C-18에서 왔으면) 복귀 배너 — C-10과 같은 모양(info-subtle, CornerUpLeft), 연결 성공 후 "돌아가기" 버튼이 default로 바뀜
안내: body text-muted-foreground (명세 문구)
(활성 공급자 없음) Alert variant="warning" + TriangleAlert — 명세 문구
RadioGroup(활성 공급자) 안에 공급자 카드 3개, space-y-3, 순서 고정 Gemini → Claude → OpenAI
사용량 입구: Card p-4 flex items-center justify-between hover:bg-accent — Gauge size-4 + "이번 달 Resumate에서 약 $0.42 (예상치)" tabular-nums + ChevronRight
Resumate 원칙: meta text-muted-foreground + ShieldCheck size-4
```

공급자 카드 (`ProviderCard`):

```
div.rounded-lg border bg-card p-4 grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-2
  [1열] RadioGroupItem (연결됨·확인 필요 상태에서만 보임, aria-label "{공급자}를 활성 공급자로"), 그 밖은 같은 폭 빈 칸
  [2열] 1행: 공급자 이름 text-base font-semibold + (Gemini) Badge variant="recommend" "추천: 무료로 시작"
        2행: meta text-muted-foreground 설명 ("결제 등록 없이 무료 키 발급" / "유료 결제 필요")
        3행: 상태 줄 (아래 표)
  [3열] 미연결: Button variant="outline" size="sm" "연결하기" / 연결된 상태: ⋯ 카드 메뉴(DropdownMenu)
```

| 상태 | 카드 테두리·바탕 | 상태 줄 (`text-sm`, 아이콘 `size-4`) | 강조 동작 |
|------|------------------|--------------------------------------|-----------|
| 미연결 | 기본 | `Circle text-muted-foreground` "연결 안 됨" | "연결하기" (Gemini 카드만 `default`, 나머지 `outline`) `[가정]` |
| 연결됨 | 기본 | `CircleCheck text-success` "연결됨 · ••••1a2b · 무료 등급 · 마지막 확인 10월 28일 14:02" (`tabular-nums`, 마스킹 글자는 `font-mono`) | — |
| **활성** (연결됨 중 선택된 것) | `border-primary bg-primary-subtle/40` | 위 상태 줄 + 1행 이름 옆 연결 배지(C-19) | — |
| 무효 (`invalid`) | `border-warning` | `TriangleAlert text-warning` + 원인 문구(`last_failure_cause`) + `meta` `last_failure_at` | 3열 앞에 Button `default sm` "키 교체" |
| 확인 필요 (`needs_check`) | `border-warning/60` | `CircleHelp text-warning` + 명세 문구 | Button `outline sm` "다시 확인" (카드 메뉴에도 있음) |
| 다시 확인 중 | 그대로 | `Loader2 animate-spin text-ai` "다시 확인 중… 최대 10초 정도"(유료 "최대 5초") | 카드 메뉴 `disabled` |
| 일시 중지 (`is_available = false`) | `bg-muted/50` | `PauseCircle text-muted-foreground` + 명세 문구 | 라디오·"연결하기" `disabled`. 카드 메뉴의 삭제는 남긴다 `[가정]` |
| (v3) **동의 필요** (활성 카드, `consent_required = true`) | 활성 카드 모양 그대로 | 키 상태 줄은 그대로 두고, 그 아래 둘째 줄에 `ScrollText text-warning` + 명세 문구를 둔다. 1행의 C-19 배지는 동의 필요형이다 | 3열 앞에 Button `default sm` "동의하기"(→ C-21 동의 창). 동의하면 둘째 줄이 사라진다. 복귀 대상이 있으면 복귀 배너의 "돌아가기"가 default가 된다 |

- 카드 메뉴: 키 교체 · 다시 확인 · 등급 변경 · 데이터 사용 고지 다시 보기 / `DropdownMenuSeparator` / 키 삭제(`text-destructive`). 키 삭제는 C-05 "API 키 삭제" 문구를 `AlertDialog`로 보이고, 공급자 대시보드 링크는 외부 링크 규칙(3.20)을 따른다.
- 활성 전환: 다른 라디오를 고르면 바로 바꾸지 않고 `AlertDialog`(확인 버튼 `default`)에 명세 문구를 보인다. 재동의가 필요하면 확인 뒤에 S-41 ②로 간다. 저장되기 전까지 라디오는 원래 값을 유지한다.
- 확인 실패(다시 확인 결과)는 카드 상태 줄을 바꾸고, 카드 아래에 C-20 inline을 붙인다.
- 로딩: 카드 3개 높이의 `Skeleton`. 저장 실패: ST-SAVE-FAILED 제출형.

**S-41 키 연결 단계** (`/settings/ai/connect`)

- **넓은 화면(≥1024): 집중 화면**이다. 셸 사이드바 없이 전체 화면을 쓴다(명세 "S-40 위 전체 화면 단계"). 라우트 레이아웃이 `SidebarInset` 대신 이 화면을 그린다 `[가정]`.
  ```
  상단 바 h-16 border-b px-6 flex items-center gap-4
    Button variant="ghost" size="icon" X  aria-label="연결 그만두기"  → S-40(또는 복귀 대상)
    section-title "{공급자} 연결" (공급자 선택 전이면 "AI 연결")
    가운데(md 이상): 단계 표시
  본문 mx-auto max-w-2xl px-6 py-10 space-y-6
  하단 동작 줄: 본문 끝 flex justify-between — [이전] ghost · [다음]/[키 확인] default
  ```
- **좁은 화면(<1024)**: 넓은 화면과 같은 집중 화면 레이아웃(`(focus)` 라우트 그룹, 사이드바 없음)을 쓴다(리더 결정 2026-10-28 — 명세 "좁은 화면은 페이지"와 어긋나지 않음). 단계 표시는 상단 바 아래에 둔다. 하단 동작 줄은 `sticky bottom-0 border-t bg-background p-4`에 두고 버튼을 전체 폭으로 쌓는다.
- **단계 표시** (`StepIndicator`): `ol flex items-center gap-2`. 각 단계는 원 `size-7 rounded-full grid place-items-center text-sm font-semibold`과 이름 `text-sm`으로 그리고, 단계 사이는 `h-px w-8 bg-border`로 잇는다.
  - 현재: `bg-primary text-primary-foreground` + 이름 `font-medium`, `aria-current="step"`
  - 완료: `bg-primary-subtle text-primary-subtle-foreground` + `Check size-4`
  - 남음: `border border-input text-muted-foreground`
  - 768 미만은 원을 숨기고 `meta` "2 / 3 · 데이터 사용 동의"만 보인다. 교체(③만)·등급 변경(①②만)일 때는 해당 단계만 그리고 번호를 다시 매긴다 `[가정]`.
- **공급자 선택**(공급자가 아직 정해지지 않았을 때): S-40의 `ProviderCard`를 상태 줄·메뉴 없이 그린다. 카드 전체가 선택 버튼이고, Gemini 카드에 추천 배지를 단다.
- **① 등급**: `RadioGroup` 카드형 2개(무료 `Gift` / 유료 `CreditCard`). 각 카드에 설명 `meta` 두 줄을 넣는다. 기본값이 미리 선택된다(Gemini 무료, 그 밖 유료).
- **② 동의**: C-21(3.21).
- **③ 가이드·입력·검증**:
  ```
  가이드 Card p-5 space-y-4
    subsection "{공급자} 키 만들기"
    ol space-y-3 — 각 단계: 번호 원 size-6 rounded-full bg-muted text-xs font-semibold + body 문구
    Button variant="outline" size="sm" "{공급자} 키 발급 페이지 열기" + ExternalLink (새 탭)
    (Gemini 무료) Alert variant="info" 무료 등급 제약 요약 (일일 한도 초기화 시각 포함)
    (Claude·OpenAI) Alert variant="info" "결제 수단 등록이 필요해요"
    caption text-muted-foreground "가이드 v{n} · 최종 확인 {날짜}"
  키 입력
    Label "API 키" + Input type="password" autoComplete="off" spellCheck={false} font-mono text-base
    meta LockKeyhole size-4 "키는 서버에 암호화해 저장하고 다시 보여 주지 않아요"
    field형 C-20 자리 (입력란 바로 아래)
  [키 확인] default — 검증 중: ST-AI-SYNC 버튼 로딩 + 아래 meta "키를 확인하고 있어요 · 최대 10초 정도" (유료 "최대 5초")
  ```
- **③ 성공** (단계 본문을 바꿈):
  ```
  div.text-center space-y-4 py-6
    div.mx-auto size-12 rounded-full bg-success-subtle grid place-items-center > CircleCheck size-6 text-success
    section-title "연결됐어요 · ••••1a2b" (마스킹 font-mono)
    meta "활성 공급자로 지정했어요" (첫 키일 때) + ProviderBadge
    주 버튼: 복귀 대상이 있으면 "{원래 기능}으로 돌아가기", 없으면 "AI 연결로 돌아가기"
  ```
- **③ 확인 보류**(저장됨, `needs_check`): 성공과 같은 배치를 쓰되 아이콘 원은 `bg-warning-subtle` + `CircleHelp text-warning`이다. 제목은 명세 문구 "키는 연결됐어요. 지금은 {공급자} 사정으로 확인을 끝내지 못했어요"이고, 일일 한도면 시각 줄(3.20 시각 표기)을 둔다. 주 버튼은 "확인"(→ 복귀 대상 또는 S-40)이다.
- **③ 실패**(저장 안 함): 입력란을 비우지 않고 그대로 두며 field형 C-20을 띄운다. `billing_required`면 결제 페이지 링크를 같은 줄에 둔다. 교체 중 실패면 그 위에 `meta` "기존 키는 그대로 쓰여요" `[가정: 문구]`.
- **그만두기**: 키 입력란에 값이 있으면 `AlertDialog` "연결을 그만둘까요? 입력한 키는 저장되지 않아요"(확인 `default` "그만두기")를 띄우고, 없으면 바로 나간다 `[가정]`.

**S-42 AI 사용량**

```
상시 고지 (sticky: 다이얼로그 본문 top-0 / 페이지 top-16, z-10)
  Alert variant="info" 닫기 버튼 없음 — Info + font-semibold "예상치이며 공급자 청구서가 아니에요." + 나머지 문구
  + 공급자별 대시보드 링크들 (flex flex-wrap gap-x-3, 외부 링크 규칙)
기간: meta "2026년 10월 1일 ~ 오늘 (KST)"
합계 Card p-5 grid grid-cols-3 gap-4 (md 미만 grid-cols-1)
  각 칸: caption text-muted-foreground 라벨 ("예상 비용" / "입력 토큰" / "출력 토큰")
        값 text-2xl font-semibold tabular-nums ("$0.42" / "182,340" / "24,105")
기능별 표 Card: section-title "기능별" + Table
  열: 기능 | 입력 토큰 | 출력 토큰 | 예상 비용 | 호출 수 — 숫자 열 text-right tabular-nums
  머리 정렬 버튼: TableHead 안 Button variant="ghost" size="sm" + ArrowUpDown size-3.5, aria-sort
  0인 행: text-muted-foreground (행 자체는 남김, 8행 고정 순서가 기본)
공급자별 표 Card: section-title "공급자별" + Table
  열: 공급자 | 등급(Badge outline) | 토큰(입력+출력) | 예상 비용
  무료 등급 행: 행 아래 붙는 caption 줄 (Info size-3.5) "무료 등급: 청구되지 않을 수 있어요(유료 단가로 환산한 예상치)"
가격표 정보: meta + Collapsible "가격표 보기" → 작은 Table (모델 · 입력/출력 $/MTok)
포함 범위·반영 지연: ul space-y-1 meta text-muted-foreground, 각 줄 Info size-4
```

- 금액 표기: `$` + 소수 2자리이다. 0보다 크고 0.01보다 작으면 "< $0.01"로 쓴다. 토큰은 `ko-KR` 천 단위 구분이다 `[가정]`.
- 좁은 화면(<768) 표는 행마다 두 줄로 바꾼다. 1행은 기능 이름(왼쪽)과 예상 비용(오른쪽 `font-medium tabular-nums`), 2행은 `meta` "입력 182,340 · 출력 24,105 · 호출 12회"이다. 정렬은 머리의 `Select`("정렬: 예상 비용 순")로 한다.
- 차트는 쓰지 않는다(차트 라이브러리 없음, 2장).
- 상태: 연결 전 = C-18 영역형(상시 고지는 그대로 위에 둠) / 이번 달 기록 없음 = EmptyState 작은 형(`Gauge`, 명세 문구) / 로딩 = 합계·표 `Skeleton` / 오류 = 본문 자리 `ErrorState` 작은 형 "사용량을 불러오지 못했어요" + "다시 불러오기" `[가정: 문구]`. 키를 지워도 기록은 그대로 보인다.

### 5.8 L-02 전체 페이지 셸 (S-10 · S-44, v4 신설)

왼쪽 메뉴 없이 한 대상을 한 페이지에서 쓰는 셸이다(플로우 1.3a, Figma `1034:8565`·`1041:8783`·`1041:8904`). 파일: `components/common/shell/page-shell.tsx`(`PageShell`, `ShellBar`, `SaveButton`, `CrumbRow`, `LeaveGuard`). 라우트는 `(dashboard)` 사이드바 레이아웃을 쓰지 않는 그룹에 둔다(8.3 Q-8).

**넓은 화면(≥1024)**

```
 bg-shell (창 전체, h-dvh overflow-hidden)
┌──────────────────────────────────────────────────────────────────────────────┐
│ [◆] Resumate                     [✦ Resumate AI]  저장됨 14:02 [● 저장하기] (👤) │  ShellBar h-14 px-4
│ ╭──────────────────────────────────────────────────────────────────────────╮ │
│ │ (←)  ○○전자 › 결제 개선 › 프로젝트 상세                                     │ │  CrumbRow
│ │ [C-10 복귀 배너 · 입력 보존 배너]                                           │ │
│ │ 결제 개선 프로젝트                                                    [⋯]   │ │  머리 (5.9)
│ │ 프로젝트 종류  (신규 구축 ⌄)   …                                           │ │
│ │ ─────────────────────────────────────────────────────────────────────────  │ │  Separator
│ │ STAR / 본문 (스크롤)                  ┃ ╭ Resumate AI 패널 ─────────────╮  │ │  5.9 · 5.10
│ │                                     ┃ │                               │  │ │
│ │                                     ┃ ╰───────────────────────────────╯  │ │
│ ╰──────────────────────────────────────────────────────────────────────────╯ │  본문 카드 mx-2 mb-2 rounded-2xl
└──────────────────────────────────────────────────────────────────────────────┘
```

- 바탕: `div.flex h-dvh flex-col overflow-hidden bg-shell text-shell-foreground`. 창(body)은 스크롤하지 않는다(L-01과 같은 원칙).
- **본문 카드**: `mx-2 mb-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-card shadow-sm`(L-01 inset 패널처럼 테두리 없이 `shadow-sm`) `[가정]`. 카드 안 스크롤은 5.9 규칙(왼쪽 영역과 패널이 따로 스크롤).
- **ShellBar**: `flex h-14 shrink-0 items-center gap-2 px-4`(바탕은 셸과 같은 `bg-shell`, 테두리 없음).
  - 왼쪽 로고: `Link`(`aria-label="Resumate 커리어로 가기"`) 안에 L-01 사이드바 머리와 **같은 로고 마크**(`size-7 rounded-lg bg-primary text-primary-foreground` + 아이콘) + `text-base font-semibold` "Resumate". Figma 워드마크 "ResuMate"의 대소문자는 서비스 표기 "Resumate"로 맞춘다 `[가정]`(8.3 Q-9). 누르면 S-08(이탈 확인 대상).
  - 오른쪽 묶음 `ml-auto flex items-center gap-2` — 순서 고정: ① **[Resumate AI]**(패널이 닫혔을 때만) `Button variant="outline" size="sm"` + `Sparkles size-4 text-ai`(R-C9) + "Resumate AI". 다시 열면 패널 입력창에 포커스 ② **C-06 저장 상태 글자**(`SaveButton` 바로 왼쪽, `meta`, `aria-live="polite"`) ③ **`SaveButton`** ④ 계정: `Button variant="ghost" size="icon"` + `CircleUserRound size-5`(`aria-label="계정 메뉴"`) → `DropdownMenu align="end"`, 항목은 L-01 `NavUser` 메뉴와 같은 목록·순서(명세: 기본 프로필 · 설정 · AI 연결 · 처리방침 · 로그아웃). 앱 안으로 가는 항목은 이탈 확인 대상.
- **`SaveButton`** = `Button size="default"`(primary, L-02의 유일한 주 버튼 — R-C8) `min-w-[6.5rem]`(글자가 바뀌어도 폭 고정). 단축키 Ctrl/⌘+S, 툴팁 "저장하기 (⌘S)"(Windows는 Ctrl+S) `[가정]`.

| 상태 | 버튼 | 왼쪽 C-06 글자 |
|------|------|----------------|
| 변경 없음(idle) | `disabled` "저장하기" | 이번 방문에 저장한 적이 있으면 "저장됨 HH:MM", 없으면 비움 |
| 변경 있음(dirty) | 활성 "저장하기" + **표식 점**: 버튼 오른쪽 위 `absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-warning ring-2 ring-shell` + 버튼 안 `sr-only` "저장하지 않은 변경 있음" `[가정]` | 비움(이전 "저장됨"을 지움) |
| 저장 중 | `disabled` + `Loader2 animate-spin` + "저장 중…" | 비움 |
| 저장됨 | `disabled` "저장하기" | `Check size-3.5 text-success` + "저장됨 HH:MM"(C-06) |
| 저장 실패 | 활성 "저장하기" + 표식 점 유지 | `CircleAlert size-3.5 text-destructive` + `text-destructive` "저장하지 못했어요" + `Button variant="link" size="sm"` "다시 시도"(ST-SAVE-FAILED). 좁은 화면은 글자 대신 토스트 |
| 검증 오류 | 활성 유지(누르면 다시 검사) | 비움. 첫 오류 칸으로 포커스, 칸 아래 A-10 오류 |
| 다른 곳에서 바뀜(`stale_write`) | 활성 유지 | 비움. 아래 **변경 충돌 확인**을 연다 |

- 표식 점의 `warning`은 "아직 저장 안 됨"이라는 상태라서 쓴다(R-C4: 점 = 아이콘 자리, 글자는 `sr-only`와 버튼 활성 상태가 함께 알린다).
- **변경 충돌 확인**(`stale_write`): `AlertDialog sm:max-w-md`. 제목 "다른 곳에서 이 {프로젝트/산출물}이(가) 바뀌었어요", 설명 `body text-muted-foreground` — "새로 불러오면 저장하지 않은 변경과 AI 반영 표시가 사라져요"(명세 "버린다고 함께 알림"의 글자, `[가정]`). 버튼 `새로 불러오기`(outline) · `내 내용으로 저장`(default). Esc·바깥 누름은 닫기만 하고 편집 상태를 그대로 둔다 `[가정]`.
- **CrumbRow**: 카드 맨 위 `flex h-12 shrink-0 items-center gap-2 px-6`. "←" = `Button variant="secondary" size="icon-sm" className="rounded-full"` + `ArrowLeft size-4`(`aria-label="뒤로"`, Figma 둥근 회색 버튼). 이동 경로 = `Breadcrumb`(14px). 누를 수 있는 마디(S-10 회사명/기관명, S-44 프로젝트명)는 `text-muted-foreground hover:text-foreground hover:underline`, 누를 수 없는 이름 마디는 `text-muted-foreground`, 마지막 마디("프로젝트 상세"/"산출물 상세")는 `font-medium text-foreground` + `aria-current="page"`. 이름 마디는 `max-w-[16rem] truncate` + `title`. 입력 중인 이름을 따라가며, 비면 "새 프로젝트"·"새 산출물"을 `text-muted-foreground`로.
- **배너 자리**: CrumbRow 바로 아래 `px-6 pb-2 space-y-2`. C-10 복귀 배너(3.9)와 **입력 보존 배너**: `Alert variant="info"` 작은 형 + `History size-4` "저장하지 않은 수정이 있어요" + 오른쪽 `Button variant="outline" size="sm"` "이어서 편집" · `Button variant="ghost" size="sm"` "버리기" `[가정: 배너형 — 다이얼로그로 막지 않음]`. 고르기 전에는 저장된 값을 보인다. 둘 다 있으면 C-10이 위.
- **이탈 확인**(`LeaveGuard`): `AlertDialog sm:max-w-md`. 제목 "저장하지 않은 변경이 있어요". 버튼 3개를 오른쪽 정렬 `계속 편집`(outline) · `저장하지 않고 나가기`(ghost + `text-destructive`) · `저장하고 나가기`(default, 요청 중 `Loader2`). 좁은 화면은 `flex-col-reverse` 전체 폭(저장하고 나가기가 맨 위). "저장하고 나가기"가 실패·검증 오류로 끝나면 다이얼로그를 닫고 SaveButton 실패·오류 모양으로 남는다. 브라우저 닫기·새로 고침은 `beforeunload` 기본 확인(문구 지정 불가).
- 토스트 위치: L-02에서는 `bottom-left`(2장 sonner).

**좁은 화면(<1024)**

- ShellBar: 로고 · `SaveButton` · 계정. [Resumate AI] 다시 열기는 상단 바에 두지 않는다(아래 떠 있는 버튼이 대신). C-06 글자는 `md` 이상에서만 상단 바에 보이고, 그보다 좁으면 저장 성공은 버튼 왼쪽 `Check text-success` 아이콘(`sr-only` "저장됨 HH:MM")만, 실패는 토스트 + 버튼 표식 점 `[가정]`.
- CrumbRow: 이동 경로 대신 "← {상위 이름}" 한 마디(`Button variant="ghost" size="sm"` + `ArrowLeft`, `max-w-[60vw] truncate`).
- `<768`: 본문 카드 `m-0 rounded-none shadow-none`(셸 바탕이 안 보이게 전체 폭), ShellBar 아래 `border-b`. 머리 필드 행은 한 열(5.9).
- 본문은 한 단. 패널은 화면 아래 **떠 있는 "Resumate AI" 버튼**(`fixed bottom-4 right-4 z-30`, `Button variant="outline" className="h-11 rounded-full bg-card px-4 shadow-md"` + `Sparkles text-ai`)으로 연다. 열면 `Sheet side="right"`: `<768`은 `w-full max-w-none`(전체 화면), 768~1023은 `sm:max-w-md` `[가정]`. 시트 머리는 패널 머리(5.10)와 같고, "×" 앞에 `Button variant="ghost" size="sm"` "STAR 보기"(S-44는 "본문 보기" `[가정]`)를 둔다 — 누르면 시트를 닫는다. 손잡이는 없다.
- 터치 대상은 A-4.

### 5.9 L-02 문서형 페이지 — S-10 · S-44 본문 배치 (v5 신설)

**세로 구성** (본문 카드 안, `flex flex-col min-h-0`)

| 순서 | 영역 | 클래스 |
|------|------|--------|
| 1 | CrumbRow + 배너 | 5.8. `shrink-0` |
| 2 | 머리 | `shrink-0 px-6 pt-2 pb-4 space-y-3` |
| 3 | 구분선 | `Separator` (카드 전체 폭, `shrink-0`) |
| 4 | 본문 2단 | `flex min-h-0 flex-1` — 왼쪽 입력 영역 · 손잡이 · 패널 |

- 머리는 스크롤되지 않고 2단만 각자 스크롤한다(Figma: 구분선 위 머리, 아래 2단). 창 높이가 `760px` 미만이면 머리를 왼쪽 입력 영역 스크롤 안으로 옮겨 2단 높이를 확보한다(`[@media(max-height:759px)]` 분기) `[가정]`.

**머리 — 제목 줄**

- `DocTitleInput`: `flex items-start gap-2` 안 `input`(S-44도 한 줄) — `doc-title` 글자 + `w-full min-w-0 rounded-md bg-transparent px-2 -mx-2 py-0.5 outline-none placeholder:text-muted-foreground hover:bg-accent/60 focus-visible:bg-transparent focus-visible:ring-2 focus-visible:ring-ring`. 자리 표시는 명세 문구("프로젝트명을 입력해 주세요" / "산출물 제목을 입력해 주세요"). `aria-label`은 "프로젝트명"·"산출물 제목", 필수는 `aria-required`. 오른쪽 아래 글자 수는 90% 넘을 때만 C-07 규칙으로 보인다 `[가정]`.
- 오른쪽 `⋯`: `Button variant="ghost" size="icon-sm"` `MoreHorizontal`(`aria-label="{프로젝트/산출물} 메뉴"`) → `DropdownMenu align="end"`. 항목은 명세(S-10: 소속 변경 `ArrowRightLeft` · 구분선 · 프로젝트 삭제 `text-destructive` `Trash2` / S-44: 산출물 삭제). 보일 항목이 없으면(새 산출물) 버튼을 그리지 않는다.
- 제목 아래 메시지 줄(있을 때만, `pl-0 text-sm`): 저장 검증 오류는 A-10(`text-destructive` + `CircleAlert`). **대화 시작 전 이름 필요**("대화를 시작하려면 … 먼저 입력해 주세요")는 오류가 아니라 남은 할 일이라 `text-warning-subtle-foreground` + `TriangleAlert size-4 text-warning`이고, 동시에 입력 칸에 `ring-2 ring-primary ring-offset-2 ring-offset-card`를 이름이 들어갈 때까지 둔다(3.8 v3 `project_fields`와 같은 원칙) `[가정]`.
- S-44만: 제목 아래 G-2 안내 1줄(C-07 모양, `ShieldAlert`, 명세 문구).

**머리 — 필드 행** (S-10만, `FieldRows`)

```
dl.grid grid-cols-[6.25rem_minmax(0,1fr)] items-center gap-x-4 gap-y-2
  dt: text-sm text-muted-foreground (Figma 13px 회색 → 스케일 최소 규칙상 14px) [가정]
  dd: flex min-h-9 flex-wrap items-center gap-2
```

| 행 | 값 컨트롤 |
|----|-----------|
| 프로젝트 종류 · 경험 유형 (단일) | `ChipSelect` = `Select` + `SelectTrigger variant="chip"`(2장). 빈 값은 `SelectValue placeholder="미선택"`(흐림 = `data-[placeholder]:text-muted-foreground`). 목록 맨 위에 "선택 안 함" 항목으로 비울 수 있다 `[가정]`. 목록은 shadcn 기본 `SelectContent` |
| 역량 (최대 3) | `CompetencyChips`: 고른 역량 칩 `inline-flex h-8 items-center gap-1 rounded-full bg-primary-subtle pl-3 pr-1 text-sm text-primary-subtle-foreground` + 빼기 `button.size-6 rounded-full grid place-items-center hover:bg-primary/10` `X size-3.5`(`aria-label="{역량} 빼기"`). 뒤에 추가 트리거 = `chip` 모양 `Button variant="chip"` + `Plus size-3.5` "역량 추가"(아무것도 없으면 글자 "미선택" `text-muted-foreground`) → `DropdownMenu`의 `DropdownMenuCheckboxItem` 10개. 3개를 고르면 안 고른 항목 `disabled` + 목록 맨 위 `DropdownMenuLabel` `caption text-muted-foreground` "최대 3개까지 고를 수 있어요". 메뉴는 고를 때마다 닫지 않는다(`onSelect` preventDefault) |
| 진행 기간 · 진행 중 | 기존 `MonthField` 두 개 + `~` + `Checkbox` "진행 중" + 개월 수. 배치 `flex flex-wrap items-center gap-2`: `[연도 ⌄][월 ⌄]` `~` `[연도 ⌄][월 ⌄]` · `label.flex items-center gap-2 text-sm` 체크 · `meta tabular-nums text-muted-foreground` "(1년 11개월)". 셀렉트는 테두리형 `SelectTrigger size="sm"`(h-8) 연 `w-[6.5rem]` / 월 `w-[5rem]`(Figma 테두리 셀렉트). 진행 중이면 종료 두 칸 `disabled`. 기간 오류는 행 아래 A-10 |

- 명세 행 순서: 프로젝트 종류 → 경험 유형 → 역량 → 진행 기간(+ 진행 중). 행 라벨은 명세 라벨 그대로.
- AI [반영]으로 채운 칸은 `animate-field-flash` 1회(3.24).
- 좁은 화면(<768): `grid-cols-1 gap-y-1`, 행 사이 `pb-2`. 라벨이 값 위로 간다.

**왼쪽 입력 영역**

- 컨테이너 `min-w-doc-left flex-1 overflow-y-auto px-6 py-6`, 내용 `max-w-doc`(왼쪽 정렬). 패널이 닫히면 왼쪽이 카드 전체 폭을 쓰되 글 폭은 그대로 42rem.
- **S-10 STAR 다섯 칸**: `space-y-10`(Figma 섹션 간격 약 90px = 제목 24 + 입력 최소 높이 + 여백) `[가정]`. 맨 위 AI 근거 도움말(명세 CR-21)은 `meta text-muted-foreground` + `Lightbulb size-4` 한 줄(Alert 아님).
  - 칸 = `section.space-y-1.5` (`aria-labelledby` 칸 제목)
    - 제목 줄 `flex items-center gap-2`: `star-heading` "상황" + `span.font-normal.text-muted-foreground` "Situation" · (반영 안 한 제안이 있으면) `Badge variant="ai"` 단추형 `h-5 gap-1 px-1.5` + `Sparkles size-3` "AI 제안 있음"(누르면 패널 카드의 그 섹션으로, R-C3 "AI 결과 출처 표시")
    - `DocTextarea`(아래)
    - 도움 줄 `flex min-h-6 items-start justify-between gap-3`: 왼쪽 C-07 가이드(행동 G-1, 역할이 비었을 때 G-4) 또는 (칸이 비고 키 있음) `Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground"` + `MessageCircleQuestion size-4` "AI에게 물어보기" / 오른쪽 글자 수 `caption tabular-nums text-muted-foreground` "1,240 / 2,000" — **칸에 포커스가 있거나 1,800자(90%)를 넘을 때만** 보인다 `[가정]`. 색 규칙은 C-07.
    - 오류는 도움 줄 대신 A-10.
- **S-44 본문 한 칸**: 위에 (반영 안 한 초안이 있으면) `Badge variant="ai"` 단추형 "AI 초안 있음". `DocTextarea` `min-h-[24rem]`. 비어 있고 키가 있으면 자리 표시 아래가 아니라 도움 줄 왼쪽에 `Button variant="outline" size="sm"` + `Sparkles size-4 text-ai` "AI와 초안 쓰기"(패널 열고 입력창 포커스) `[가정]`. 글자 수 "n / 20,000"는 항상 보인다(긴 글이라 상한이 중요) `[가정]`.
- **`DocTextarea`** (문서형 마크다운 입력, A-13 예외):
  `w-full resize-none bg-transparent rounded-md -mx-2 px-2 py-1.5 prose(text-base leading-[1.75]) field-sizing-content min-h-[5.25rem](3줄) outline-none placeholder:text-muted-foreground hover:bg-accent/50 focus-visible:bg-transparent focus-visible:ring-2 focus-visible:ring-ring aria-invalid:ring-2 aria-invalid:ring-destructive`.
  - 테두리 없이 본문 글처럼 보인다. 입력임은 칸 제목(라벨)·자리 표시·hover 바탕·포커스 링으로 알린다.
  - 마크다운은 **원문 그대로** 보인다(입력 중 서식 미리보기·렌더링 없음, 새 의존성 없음) `[가정]`. 다만 편의 동작 두 가지: 목록 줄(`- `, `* `, `1. `)에서 Enter를 누르면 같은 기호로 다음 줄을 시작하고(빈 목록 줄에서 Enter는 기호를 지움), 목록 줄에서 Tab / Shift+Tab은 2칸 들여쓰기 / 내어쓰기 `[가정]`. 목록이 아닌 줄의 Tab은 기본(포커스 이동)으로 둔다(키보드 함정 방지).
  - (v5, UQ-PA-5) **키보드 함정 방지**: Tab·Shift+Tab은 실제로 들여쓰거나 내어쓸 것이 있을 때만 가로챈다. 내어쓸 공백이 없거나 들여쓰기 깊이 상한(공백 6칸)에 닿으면 원래대로 포커스가 이동한다. Esc를 누른 뒤의 Tab은 항상 칸을 빠져나간다 `[가정]`.
  - 근거 구간 강조(C-02에서 옴, S-44 "근거 구간 강조")·"지금 본문에서" 칩: 그 구간을 선택 상태로 + 칸 `ring-2 ring-ring` + `animate-field-flash` 1회(3.14 v4).
  - 자리 표시 글자는 Figma(15px)와 달리 16px로 둔다(A-8).

**손잡이 (`ResizeHandle`)**

- `div role="separator" aria-orientation="vertical" aria-label="Resumate AI 패널 너비" aria-valuenow={패널 px} aria-valuemin aria-valuemax tabIndex=0`.
- 모양: 누르는 자리 `w-3 shrink-0 cursor-col-resize flex items-center justify-center`, 그 안 막대 `h-10 w-1 rounded-full bg-border`(Figma 회색 막대). hover·드래그 중 막대 `bg-muted-foreground/50`, 포커스 `focus-visible:ring-2 ring-ring rounded-full`. 드래그 중에는 `select-none`과 `cursor-col-resize`를 문서 전체에 건다.
- 키보드: ←/→ 16px, Shift+←/→ 64px, Home = 최소, End = 최대, Enter = 기본 폭(420) `[가정]`. 폭이 바뀌어도 매번 낭독하지 않는다(`aria-valuetext` "패널 420픽셀"만 갱신).
- 폭 규칙: `w-ai-panel`(1.4) 안에서, 왼쪽 `min-w-doc-left`를 지킨다. 창이 줄어 둘을 모두 지킬 수 없으면 패널이 최소 폭까지 먼저 줄고, 그래도 안 되면(카드 폭 < 약 820px) 1024 미만 규칙(시트)과 같게 그린다. 기억한 폭(`localStorage`, try/catch)이 범위 밖이면 범위 안으로 자른다.
- 패널이 닫히면 손잡이도 없다.

### 5.10 Resumate AI 패널 (`AiPanel`, S-10 · S-44 공통, v4 신설)

S-36 대화 화면(5.4, 폐기)의 메시지·입력 규칙을 좁은 패널에 맞춰 다시 쓴 것이다. S-10과 S-44는 같은 컴포넌트를 쓰고, 다른 것은 **제안 카드**(3.24 / 3.25)와 **칩 계산**(`quickChips(state)` — 화면이 넘김)뿐이다.

**틀**

```
aside(aria-label="Resumate AI") — 넓은 화면: my-3 mr-3 flex w-[var(--ai-panel-w)] shrink-0 flex-col overflow-hidden rounded-xl bg-panel text-panel-foreground
├ 머리 h-12 shrink-0 flex items-center gap-1 px-3
├ 본문 (보기 둘 중 하나)
│   ├ 대화 보기: 메시지 목록(flex-1 overflow-y-auto) → 제안 독 → 칩 줄 → 입력 영역
│   └ 기록 보기: 대화 기록 목록(flex-1 overflow-y-auto)
```

**머리**

- 왼쪽 `Sparkles size-4 text-ai`(R-C9) + `text-base font-semibold` "Resumate AI" + C-19 연결 배지(작은 형, `truncate max-w-[10rem]`). 패널 폭이 `24rem` 미만이면 배지는 아이콘형(점 + 툴팁)으로 줄인다 `[가정]`.
- 오른쪽 `ml-auto` 아이콘 버튼 4개(`Button variant="ghost" size="icon-sm"`, 모두 `Tooltip` + `aria-label`): `History`("대화 기록", 기록 보기일 때 `aria-pressed=true` + `bg-accent`) · `Plus`("새 대화") · `MoreHorizontal`("대화 메뉴" → "이 대화 삭제" `text-destructive` `Trash2` → C-05) · `X`("패널 닫기"). 열린 대화가 없으면 ⋯를 `disabled`로 둔다. 키가 없으면 "새 대화"는 `disabled`가 아니라 누르면 C-18 인라인형으로 안내한다(3.18 규칙) `[가정]`.

**기록 보기** (대화 기록 목록)

- 목록 위 `px-3 pt-1 pb-2`: `Button variant="ghost" size="sm"` + `ArrowLeft` "대화로 돌아가기"(열린 대화가 있을 때) `[가정]`.
- 행 = `button.w-full rounded-lg px-3 py-2.5 text-left hover:bg-accent focus-visible:ring-2 ring-ring`, 목록 `px-2 space-y-0.5`. 1행 `text-sm font-medium truncate` 제목(없으면 "새 대화" `text-muted-foreground`). 2행 `caption text-muted-foreground tabular-nums` "{상대 시각} · {n}/40" + 상한 도달이면 `Badge variant="outline" h-5` + `Lock size-3` "끝난 대화". 지금 연 대화 행은 `bg-card shadow-xs` + `aria-current="true"`.
- 빈 목록(새 페이지 포함): `py-10 text-center meta text-muted-foreground` "아직 대화가 없어요" `[가정]`.
- 로딩: 행 모양 `Skeleton` 3개.

**대화 보기 — 메시지 목록** (`px-4 py-4 space-y-5`, `aria-live`는 완료 때만 — A-6)

- AI 메시지: `flex gap-2.5` — 아바타 `size-6 shrink-0 rounded-full bg-ai-subtle grid place-items-center` + `Sparkles size-3.5 text-ai`, 본문 `prose min-w-0`(16/1.75). 스트리밍은 C-04 커서.
- 사용자 메시지: `ml-auto max-w-[85%]` 위 `caption text-muted-foreground text-right` "내 답변 #n", 말풍선 `rounded-2xl rounded-br-md border bg-card px-3.5 py-2.5 prose`. 패널 바탕(`panel`) 위라 v3의 `bg-secondary` 대신 `bg-card` + 테두리로 바꿨다(5.4는 폐기 화면이라 그대로 둔다). 누르면 그 발화를 출처로 가진 카드 섹션·블록에 `animate-field-flash` → `cursor-pointer hover:ring-1 hover:ring-border`.
- 시작 영역(대화가 없거나 새 대화, 새 페이지): 시작 인사 = AI 메시지 모양(번호·칩 없음, 커서 없음) → 고정 안내 `meta text-muted-foreground` + `Info size-4`(명세 문구) → 무료 등급이면 5.4 (v3) `FreeTierNotice` 작은 형. 칩은 칩 줄에 있다(시작 영역 안에 따로 두지 않는다 — Figma는 입력창 위 한 줄) `[가정]`.
- 민감정보 안내: 해당 AI 메시지 아래 `Alert variant="info"` 작은 형(`text-sm`) + 끝에 `Button variant="link" size="sm"` "대화 삭제".
- AI 되묻기("본인이 직접 한 부분은…")는 일반 AI 메시지. 배지는 카드 쪽(C-15).
- 실패한 턴: 실패한 AI 메시지 자리에 C-20 inline형 + `RetryButton` "다시 보내기"(대기 카운트다운 3.20).
- 질문 턴 응답 중: 마지막 AI 메시지가 C-04 스트리밍. 답이 끝나고 카드가 바뀌는 동안 카드 머리에 "정리 중".
- 자동 스크롤: 사용자가 위로 올리지 않았을 때만 따라 내려간다(C-04).

**제안 독** (메시지 목록과 칩 줄 사이)

- `shrink-0 border-t border-border/60 px-3 pt-3` 안에 카드 하나(3.24 / 3.25). 펼친 카드는 `max-h-[55%]`(패널 높이 기준)까지 크고 그 안에서 스크롤한다. 접으면 카드 머리 한 줄만 남는다. 접힘 상태는 대화마다 기억하지 않고, 새 제안이 오면 펼친다 `[가정]`.
- 명세 "대화 목록 아래 고정"을 이렇게 읽었다: 메시지가 길어져도 카드는 입력창 바로 위에 붙어 있고, 메시지 목록만 스크롤된다 `[가정]`(8.4 P-16).
- 왼쪽의 "AI 제안 있음"·"AI 초안 있음"을 누르면 패널을 열고 독을 펼친 뒤 해당 섹션으로 `scrollIntoView` + `animate-field-flash`.

**칩 줄** (Figma: 입력창 위 회색 알약 3개)

- `flex flex-wrap gap-1.5 px-3 pt-3`. 칩 = `Button variant="chip"`(2장), 글자는 AI-12/AI-13 표 문구 그대로, 길면 `max-w-full truncate` + `title`.
- 숨김: `message_count` ≥ 36, `closed` 대화, 키 없음(입력 영역이 C-18일 때). 응답 중에는 `disabled`(사라지지 않음 — 줄 높이가 튀지 않게).
- 칩 문구가 바뀌면(턴 뒤 다시 계산) 애니메이션 없이 바꾼다.

**입력 영역** (`shrink-0 px-3 pb-3 pt-2 space-y-1.5`)

```
form.flex items-end gap-2 rounded-3xl border border-input bg-card py-1.5 pl-4 pr-1.5
     focus-within:ring-2 focus-within:ring-ring
  Textarea: flex-1 resize-none border-0 bg-transparent p-0 py-1.5 text-base leading-6 shadow-none
            field-sizing-content min-h-9 max-h-40 focus-visible:ring-0
            placeholder "Resumate AI에게 물어보세요"
  보내기: Button size="icon-sm" className="size-8 rounded-full" (default — R-C8) ArrowUp, aria-label="보내기"
          글자가 없으면 disabled. 응답 중에는 같은 자리 Button variant="outline" size="icon-sm" rounded-full Square size-3.5 "중단"
아래 줄 flex items-start justify-between gap-3 px-2:
  왼쪽 G-2 (C-07 모양, ShieldAlert size-3.5, text-xs leading-4 — 패널이 좁아 caption 크기) [가정]
  오른쪽 caption tabular-nums "{n} / 40" (36 이상 text-warning-subtle-foreground)
```

- Enter = 보내기, Shift+Enter = 줄바꿈. 한글 조합 중(`isComposing`) Enter는 보내지 않는다.
- 빠른 응답("잘 모르겠어요"·"건너뛸게요")은 AI가 질문 중일 때 칩 줄 맨 앞에 `Button variant="chip"` 모양이 아니라 `Button variant="ghost" size="sm"`로 붙인다 — 칩 3개(다음 행동)와 대답(이 질문에 대한 답)을 구분한다 `[가정]`.
- **보내기 전 막힘** — 모두 입력 글자는 그대로 둔다:
  - 새 페이지 + 이름 없음: 보내지 않고 머리 제목에 포커스 + 5.9 "대화 시작 전 이름 필요" 줄. 패널 쪽에는 따로 표시하지 않는다(시선을 제목으로 보냄).
  - 키 없음·키 무효: 입력 영역 바로 위에 C-20 inline형(5.4 v3 "전송이 막힐 때"와 같음). 동의 필요는 C-21 창.
  - `invalid_form_snapshot`: 입력 영역 위 `Alert variant="warning"` 작은 형 명세 문구.
  - `writing_chat_closed`·초안 상한(409): 입력 영역 위 `Alert variant="info"` 작은 형 명세 문구 + `Button variant="outline" size="sm"` "새 대화".
- **새 페이지 첫 메시지 처리 중**(이름 확인 → AI 확인 → 저장 → 대화 시작): 보내기 버튼 자리 `Loader2 animate-spin`, 입력 `disabled`. ShellBar `SaveButton`은 저장 중 모양을 함께 보인다. 끝나면 토스트(명세 문구, `CircleCheck text-success`).

**잠금 · 끝난 대화 · 닫힘**

| 상태 | 모습 |
|------|------|
| 키 없음 + 대화 없음 | 본문 전체를 C-18 영역형으로(3.18). 패널 안이라 `Card` 대신 `div.m-4 rounded-lg border bg-card p-5 space-y-3`, `max-w-xl` 없음. 주 버튼은 R-C8에 따라 `outline` "AI 연결하기" `[가정]` |
| 키 없음 + 대화 있음 | 기록·메시지·카드는 그대로. 칩 줄과 입력 영역 자리에 C-18 인라인형. 카드의 [반영]·[수락] 등은 그대로 활성(키 불필요) |
| 키 무효 · 동의 필요 | 평소 모양. 보낼 때 C-20 / C-21 |
| 메시지 상한(40) · `closed` | 칩 줄 숨김. 입력 영역 대신 `div.rounded-2xl border border-dashed border-input bg-card p-3 space-y-2`: `Lock size-4 text-muted-foreground` + `text-sm` 명세 문구 + `flex gap-2` (S-10) `[모두 반영]` outline sm · `[새 대화]` outline sm + `Plus` / (S-44) 반영할 초안이 있으면 카드 바닥 버튼을 쓰고 여기는 `[새 대화]`만 `[가정]`. 카운터 `40 / 40` 경고색 |
| 패널 닫힘 | 패널·손잡이 없음, 왼쪽이 전체 폭. ShellBar에 [Resumate AI]. 닫을 때 포커스는 [Resumate AI] 버튼으로 |
| 로딩(대화 열기) | 메시지 모양 `Skeleton` 3개(AI 2·사용자 1) |

- 공급자가 바뀌면 머리 배지만 바뀐다(애니메이션 없음).

---

## 6. 영역별 메모

### A1 계정 (S-01, S-02, S-03, S-24, S-25, S-30)

- 셸 밖 화면(S-01~S-03, S-30): 상단 `h-14 border-b` 로고만, 본문 가운데 정렬. S-02·S-03은 `Card max-w-md mx-auto mt-16 p-8`.
- S-01 랜딩: `display` 제목 + `body` 가치 제안 3줄(아이콘 `Layers`/`Briefcase`/`KanbanSquare` + 문구, `grid md:grid-cols-3`) + 주 버튼 "시작하기". 일러스트·스크린샷 없음 `[가정]`.
- S-02: 이메일 `Input` + "로그인 링크 받기"(default, 전체 폭) / 구분선 "또는" / "Google로 계속하기"(outline, 전체 폭, Google 로고는 공식 가이드 아이콘 SVG — 브랜드 색 허용 예외). 재발송 후 `Alert variant="info"`.
- S-03: 동의 항목 `Checkbox` 목록과 필수 표시. (v2) AI 공급자 동의는 여기서 받지 않는다(C-21로 옮김). AI 고지는 한 줄 `meta text-muted-foreground` + `Info`로 줄인다.
- (v2) S-40·S-41·S-42: 5.7.
- S-24 설정: 사이드바에서는 설정 다이얼로그(5.1)로 열린다. (v2) "AI 연결"·"AI 사용량" 섹션은 5.7. 계정 섹션의 "AI 연결" 한 줄은 "연결 안 됨" 또는 C-19 배지 + `font-mono` "••••1a2b"로 쓰고, 누르면 섹션을 바꾼다. "AI 데이터 처리" 섹션은 명세 v5 문구로 바꾸고 "고지 다시 보기" 링크(→ AI 연결 섹션)를 단다. `/settings` 페이지(직접 주소·S-25 취소/이동 경로용)는 `max-w-form`, 같은 섹션을 카드로. "화면" 섹션(AI 사용량 다음): `ToggleGroup variant="outline" spacing={0}` 시스템 설정 · 라이트 · 다크, 기본 시스템 설정, 이 브라우저(localStorage)에만 저장.
- S-25 탈퇴: (v2) 삭제 범위에 "AI 연결" 묶음(키 N개 · 토큰 사용 기록 · 동의 이력)을 더하고, 그 아래 `Alert variant="info"` "공급자 사이트에서도 키를 폐기하는 것을 권해요"와 공급자 대시보드 외부 링크를 둔다. 삭제 범위를 C-05의 영향 요약 스타일로, 확인 입력/체크 후 `destructive` 버튼. 위험 강조는 버튼에만(화면 전체를 빨갛게 하지 않음).
- **(v3) S-25 탈퇴** (약관 동의 게이트 밖 경로):
  - 정상 상태는 `max-w-form` 한 열이다. 순서는 삭제 범위 요약(C-05 영향 요약 스타일) → AI 연결 묶음과 `Alert variant="info"`(위 v2) → **확인 체크** → 버튼이다. 확인 체크는 `rounded-md border border-input p-4 flex items-start gap-3` 안에 `Checkbox`와 `label text-base` 명세 문구를 둔다. 문구 입력란은 없다. "탈퇴하기"는 오른쪽 정렬 `destructive`이고, 체크 전에는 `disabled`, 요청 중에는 `Loader2` 로딩이다.
  - `account_deletion_busy`: 버튼 위에 `Alert variant="warning"` + `Hourglass`로 명세 문구를 보이고, "지운 것은 없어요."만 `font-semibold`로 둔다. 요약과 체크 상태는 그대로 남긴다. 다시 시도는 "탈퇴하기"를 다시 누르는 것이고, Alert 안에 버튼을 따로 두지 않는다 `[가정]`.
  - 그 밖 오류는 ST-SAVE-FAILED 제출형 "탈퇴를 처리하지 못했어요. 잠시 후 다시 시도해 주세요"이다.
  - **탈퇴 마무리 상태** (`account_deletion_incomplete`를 받았거나 그 상태로 로그인한 경우): 요약, 체크, AI 연결 안내를 그리지 않고 아래 카드 하나만 둔다. 셸 사이드바와 메뉴 없이 S-02·S-03과 같은 셸 밖 배치(상단 `h-14 border-b` 로고만)로 그린다. 다른 메뉴로 이동할 수 없다는 명세에 맞춘 것이다 `[가정]`.

```
Card max-w-md mx-auto mt-16 p-8 space-y-5
  div.size-10 rounded-full bg-warning-subtle grid place-items-center > CircleAlert size-5 text-warning
  p.section-title "데이터는 모두 지웠지만 계정 정보 삭제를 마치지 못했어요."
  p.body text-muted-foreground "잠시 후 다시 시도해 주세요."
  div.flex flex-col gap-2: Button destructive w-full "탈퇴 마무리하기" (요청 중 Loader2) · Button ghost w-full "로그아웃"
```

  - 마무리 요청이 또 실패하면 카드는 그대로 두고 버튼 위에 ST-SAVE-FAILED 제출형 한 줄을 둔다. 성공하면 로그아웃하고 `/`로 간다. 토스트는 없다 `[가정]`.
- (v3) S-40 "동의 필요" 상태는 5.7 공급자 카드 표, 동의 창은 3.21에 있다.

### A2 커리어 (S-04, S-08~S-12, S-34~S-36)

> **(v5) 읽는 순서**: 플로우 v5.5·v5.6으로 S-08 트리, S-35, S-36, S-11, v3 S-10 메모는 **폐기**됐다(아래 v3 이하 메모는 이력). 지금 기준은 이 절 맨 끝 "(v5) 커리어 v5.6" 메모다. S-08 목록·S-09·S-34 패널의 시각 규칙은 아직 정리하지 않았다(8.4 P-15) — 지금 구현(`career-overview.tsx`)을 기준으로 두고, 새 패널 섹션은 그 `PanelSection` 모양을 따른다.

- **S-08 트리**: `max-w-page`.
  - 상단 요약 카드: 프로필 한 줄(`subsection`) + 완료 개수 `caption` 배지 4개 + 규칙 안내 1줄 `Alert variant="info"` 작은 형. 시작 버튼 줄: 주 버튼 "AI와 대화하며 프로젝트 정리하기"(AiRunButton) + `outline` "+ 경력" "+ 교육" "+ 프로젝트". (v2) 키가 없으면 AI 버튼 자리가 C-18 인라인형이 되고, 빈 상태의 기본 시작점은 "직접 입력"(default)이다(명세 v5). 좁은 화면은 주 버튼 전체 폭 + 나머지 `⋯` 아닌 3열 작은 버튼.
  - 작성 중인 AI 대화: 요약 아래 `Card` 목록, 각 행 `Sparkles size-4 text-ai` + 대상 + `meta` 마지막 활동·`n/40` + "N일 뒤 자동 삭제"(`Badge warning`) + "이어서" `outline sm`.
  - (v3) 작성 중 대화 행 끝에 `⋯` 메뉴를 둔다: "대화 그만두기"(`PauseCircle`) · 구분선 · "대화 삭제"(`text-destructive`, C-05).
  - (v3) **그만둔 대화 묶음**: 작성 중 대화 카드 바로 아래에 둔다(작성 중 대화가 없으면 그 자리). `Collapsible`이고 기본은 접힘이다. 트리거는 `Button variant="ghost" size="sm"` + `ChevronRight size-4`(펼치면 `rotate-90`) + `text-sm text-muted-foreground` "그만둔 대화 N개"(`tabular-nums`)이다. 0개면 묶음을 그리지 않는다. 행 배치는 작성 중 행과 같다. 다만 아이콘은 `PauseCircle size-4 text-muted-foreground`로 바꾼다(AI 보라는 진행 중일 때만 쓴다). `meta`에 마지막 활동과 `n/40`을 두고, 프로젝트와 연결되지 않은 대화에는 "N일 뒤 자동 삭제" `Badge warning`을 단다. 동작은 "다시 이어 하기" `outline sm`(C-19 배지 없음, 키 없이 활성)과 `⋯` "대화 삭제"(C-05)이다.
  - 연도 묶음: 연도 머리 `sticky top-16 bg-background/95 py-2 text-lg font-bold tabular-nums` + `ChevronDown` 접기 버튼. 그 아래 경력/교육 머리 → 프로젝트 행 → 상세 내용 행을 **들여쓰기 + 세로 안내선**(`border-l pl-4 ml-2`)으로. 행 높이 최소 44px.
  - 경력 머리: `Briefcase size-4`(교육 `GraduationCap`) + 회사명 `font-semibold` + `meta` 직급·기간. 접힌 머리(그 해 프로젝트 없음)는 `text-muted-foreground`.
  - 프로젝트 행: 이름 `font-medium` + 역할 `meta` + 한 줄 요약 `text-sm text-muted-foreground line-clamp-1` + 스킬 `Badge variant="secondary"` 최대 3 + 상세 내용 수 `caption`. 행 hover 시 오른쪽에 "+ 상세 내용" `ghost sm`, "AI와 상세 내용 추가" `ghost sm`.
  - **STAR 채움 표시**(상세 내용 행): 5칸 글자 배지 `S T A R 회고` — 채움 `bg-primary-subtle text-primary-subtle-foreground`, 빔 `border border-dashed text-muted-foreground`, 각 `size-6 rounded-sm caption grid place-items-center`, `aria-label="상황 채움, 과제 비어 있음, …"`. "회고"는 글자 2개라 `w-auto px-1`.
  - 작성 중 배지: `Badge variant="draft"` "작성 중 — AI 미반영".
- S-35: 5.3 긴 글 편집. 각 STAR 필드 라벨에 영문 약자 `(S)` 등은 `text-muted-foreground`. 결과(R) 아래 정량 성과 목록 = 작은 표(`metric_name` · `before → after unit` tabular) + `outline sm` "+ 정량 성과". "회고 및 배운 점" 필드는 다른 필드와 **같은 모양**(구분은 라벨·안내 문구로만).
- S-11 정량 성과: `Dialog`, 전후 값은 `grid grid-cols-[1fr_auto_1fr_6rem]`에 `ArrowRight` 가운데.
- S-12 스킬: 칩 목록 `flex flex-wrap gap-2`, `Badge variant="secondary" h-8 px-3 text-sm` + 연결 수 `caption`.
- S-36: 5.4. 게이트 배너는 `info-subtle`(C-10과 같은 모양, 버튼 대신 남은 항목 목록). (v3) 시작 인사, 상한, 전송 차단, 그만두기·다시 이어 하기는 5.4.
- **(v3) S-10**:
  - AI 작성 대화 기록 행: `abandoned`는 `Badge variant="outline"` + `text-muted-foreground` "그만둠"(S-37 그만둠과 같은 모양)이고, 동작은 "다시 이어 하기" `outline sm`(배지 없음)이다.
  - **C-09 `project_fields`에서 열었을 때**: 비어 있는 이름·역할 입력란에 `ring-2 ring-primary ring-offset-2 ring-offset-background`를 둔다. 값이 들어가면 그 칸의 링만 해제한다. 첫 빈 칸에 포커스를 두고 `animate-field-flash`를 한 번 준다. 기본 정보 섹션 카드 맨 위에는 `Alert variant="info"` 작은 형(`text-sm`, `Info`)으로 "이름과 역할을 채우면 {기능}에 바로 쓸 수 있어요"를 둔다. 오류 표시(`aria-invalid`, destructive 테두리)는 쓰지 않는다. 실수가 아니라 남은 할 일이기 때문이다. 필수 표시 "*"는 원래대로 두고, 복귀 배너(C-10)는 위에 그대로 둔다.

- **(v5) 커리어 v5.6** (플로우 v5.6, Figma `1034:8565`·`1041:8783`·`1041:8904`):
  - **S-10 프로젝트 상세**: L-02(5.8) + 문서형 페이지(5.9) + Resumate AI 패널(5.10) + STAR 제안 카드(3.24). 새 프로젝트(`/career/projects/new?…`)는 같은 화면의 빈 상태다 — 제목 입력에 포커스, ⋯에는 "소속 변경"만, 패널은 시작 영역(행 없음)이고 기록 목록은 비어 있다. 로딩은 머리 제목 `Skeleton h-8 w-64` + 필드 행 4개 `Skeleton h-8 w-40` + STAR 칸 5개(제목 `h-5 w-32` + 본문 `h-20`) + 패널 기록 행 3개.
  - **S-44 산출물 상세**: S-10과 같은 셸·패널. 머리는 제목 + ⋯ + G-2 한 줄뿐(분류 없음, PA-2 — Figma의 분류 드롭다운은 그리지 않는다). 왼쪽은 본문 한 칸(5.9). 카드는 3.25.
  - **S-43 독립 프로젝트 패널 — 산출물 섹션**: 기존 `PanelSection`(제목 `text-base font-medium` + 오른쪽 동작) 모양을 그대로 쓴다.
    - 동작: `Button asChild variant="ghost" size="sm" className="text-muted-foreground"` + `Plus` "산출물 추가"(→ S-44 새 산출물). 50개면 `disabled`이고, 제목 줄 아래 `meta text-muted-foreground` + `Info size-4` 명세 문구를 둔다(비활성 이유를 툴팁에만 두지 않음).
    - 목록: `ul.flex flex-col gap-0.5`. 행 = `Link` `flex min-h-11 items-center gap-3 rounded-[10px] px-3 py-2.5 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring`(프로젝트 카드 C-25와 같은 반경·hover) 안에 `FileText size-4 shrink-0 text-muted-foreground` + 제목 `min-w-0 flex-1 truncate text-base`(+ `title`) + `ChevronRight size-4 text-muted-foreground`. 분류·날짜·글자 수는 보이지 않는다(PA-2, 명세에 없음). 제목이 빈 행은 없다(제목 필수).
    - 빈 상태: 프로젝트 섹션의 빈 문구와 같은 모양 `p.py-2.5 text-sm text-muted-foreground` 명세 문구. 버튼·일러스트를 더하지 않는다(동작은 제목 줄의 "산출물 추가").
    - 로딩: 행 모양 `Skeleton h-11` 2개.
  - **C-23**: 3.23. C-22에서 "프로젝트"를 고른 뒤, C-09·S-16의 소속 선택에서만 연다.
  - **폐기 경로 정리**: `projects/[id]/details/*`, `writing-chats/*`(S-36)의 화면 규칙은 이 문서에서 더 쓰지 않는다. 남은 링크는 S-10으로 옮긴다(브리프 범위).

### A3 기업 JD (S-13, S-14, S-31, S-15~S-19)

- S-13: 5.2 목록. 단계 열은 `StatusDot` + 단계 이름(+ 종료 시 결과 배지). 기능 진행 칸은 아이콘 3개(`Lightbulb`/`FileText`/`MessagesSquare`) + 숫자, 생성 중이면 C-03 축약형.
- S-14: (v2) 키가 없으면 C-18 인라인 안내 한 줄과 함께 회사명·포지션명 입력란을 펼쳐 두고(비우면 기본 이름, 요건 추출 없음), 키가 있으면 입력란을 접어 둔다(구현·명세 기준, UQ-240). AI 연결을 다녀와도 입력은 브라우저 세션에서 복원한다(UQ-230). 공고 원문 `Textarea` `min-h-80 font-sans text-base`(붙여넣기 대량 텍스트), 오른쪽 아래 글자 수. 추출 대기 이름 "새 기업 JD"는 `text-muted-foreground`, AI가 채운 이름은 옆 `Badge variant="ai"` "AI 추출".
- S-15 JD·요건: 넓은 화면 2열 `grid xl:grid-cols-2 gap-6` — 왼쪽 "공고 원문"(`Card`, `prose`, 문장 하이라이트 = `mark.bg-ai-subtle`), 오른쪽 요건 목록(`category`별 묶음, 행: 요건 글 + `importance` 배지 + 사용자 수정 표시 `PenLine`). JD 판별 경고 `Alert variant="warning"`. (v2) 요건이 없고 키도 없으면 요건 쪽이 C-18 영역형이 된다(공고 원문은 그대로). 키가 있으면 "요건 정리하기" AiRunButton을 둔다.
- S-16 인사이트: 섹션 순서대로 카드. 요건 판정 표 = `Table`(요건 · 판정 3.17 · 근거 칩) — 좁은 화면 카드형. 강점·보완점은 `Card` 목록(제목 `subsection` + `prose` + 칩 줄). 보완점의 두 선택지 = `outline sm` "AI와 대화하며 추가" + `ghost sm` "직접 입력". "데이터 변경됨" 상태: 카드 머리 `Badge warning` + `RefreshCw` "커리어가 바뀌었어요" + "다시 생성"(AiRunButton, 다시 하기 주석). (v2) 결과 머리 오른쪽에 C-19 결과 배지를 둔다. 키가 없으면 결과는 그대로 보이고 실행 버튼만 C-18 인라인형이 된다.
- S-17/S-18: 경력기술서 포함 항목 = C-11 체크 트리. 자소서 문항 카드 = `Card p-5`(문항 `Input`, 글자 수 `Input type=number w-28`, 공백 기준 `Select`, 메모 `Textarea` 300자).
- S-19: 5.3 초안 편집기. 자리 표시 토큰(C-08)은 편집 중에도 강조 유지.
- **(v3) S-17 초안 목록 상태** (`drafts.status`, 행 배지). 행 오른쪽 결과 배지는 C-19 결과 배지이고, 자소서는 마지막으로 생성이 완료된 문항의 값이다.

| 상태 | 배지 |
|------|------|
| `composing` | `draft` "작성 중" |
| `generating` | `ai` + `Loader2 size-3 animate-spin` "생성 중" |
| `ready` | `success` "완료" |
| `partially_failed` | `warning` + `TriangleAlert size-3` "{n}개 문항 생성 실패" |
| `failed` | `destructive-subtle` + `CircleX size-3` "생성 실패" |

- **(v3) S-17 실패 초안 행** (경력기술서 `failed`): 열 수 없는 행이다. 행 링크와 hover 바탕을 빼고 제목은 `text-muted-foreground`로 둔다. 행 끝 동작 묶음은 `flex items-center gap-2`로 "다시 시도"(`outline sm` + `RotateCcw`) + C-19 연결 배지(활성 공급자) · "삭제"(`ghost sm text-destructive`, C-05)이다. 행 아래에 `caption` "다시 시도하면 토큰을 다시 써요"를 둔다. 좁은 화면에서는 동작 묶음을 행 아래 줄로 내린다. 다시 시도하면 목록 맨 위에 새 초안 행이 `generating`으로 생기고 실패 행은 그대로 남는다.
- **(v3) S-17·S-18 요건 선행 추출**: 요건이 없는 기업 JD에서 "새 경력기술서"나 생성 버튼을 누르면 그 버튼이 ST-WAIT-JD가 된다(버튼 `disabled` + 아래 `Loader2 text-ai` "공고 요건 정리 중"). 실패하면 같은 자리에 C-20 inline형을 두고(3.20 요청 안 경로 대기 규칙 포함) 초안 행은 생기지 않는다.
- **(v3) S-17 문체 선택**: 경력기술서 설정에서 포함 항목 트리 위에 둔다 `[가정: 위치]`. `label` "문체" + `ToggleGroup type="single" variant="outline"` 두 항목 "간결" · "상세"(각 `h-9 px-4 text-sm`, 선택된 항목 `data-[state=on]:bg-primary-subtle data-[state=on]:text-primary-subtle-foreground`). 기본은 "간결"이고, 선택을 해제할 수 없다(선택된 항목을 다시 눌러도 무시). 값이 null인 이전 초안은 "간결"이 선택된 모습으로 그린다. 생성된 초안에서 문체를 바꾸면 C-11 근거 변경과 같은 모양(`Alert variant="info"` + "변경 사항으로 다시 생성" `AiRunButton`)을 보인다 `[가정]`.
- **(v3) S-17 AI 기본 선택 실패** (AI-11, C-11): 트리 위에 `Alert variant="warning"` + `ListChecks`를 둔다.
  - AlertTitle: "AI가 포함할 항목을 고르지 못했어요. 직접 골라 주세요"
  - AlertDescription 첫 줄: C-20 원인 제목 문장 한 줄(`text-sm`)
  - 동작: "AI에게 다시 맡기기"(`outline sm`) + C-19 연결 배지(활성 공급자)
  - 트리는 모두 체크 해제된 상태로 평소처럼 그린다(흐리게 하지 않음). 출처 배지는 처음부터 "직접 고름" `outline`이다.
  - 생성 버튼은 1개 이상 체크하기 전까지 `disabled`이고, 버튼 위 `meta`로 "포함할 항목을 1개 이상 골라 주세요"를 보인다 `[가정: 문구]`.
- **(v3) 선택 개수 상한**: 경력기술서 프로젝트는 8개까지다. 8개를 고르면 체크되지 않은 프로젝트 체크박스를 `disabled`로 두고 트리 위 `meta`로 "프로젝트는 8개까지 고를 수 있어요"를 보인다 `[가정: 문구]`. 자소서 문항당 근거 5개도 같은 자리, 같은 모양으로 명세 문구 "한 문항에 5개까지 고를 수 있어요"를 보인다.
- **(v3) S-18 글자 수 안내**: 글자 수 제한 `Input` 줄 바로 아래에 `meta text-muted-foreground` + `Info size-3.5`로 명세 문구를 둔다. "최대 10%까지 넘을 수 있으니"만 `font-medium text-foreground`로 둔다. 문항이 10개면 "+ 문항 추가"를 `disabled`로 두고 옆에 `meta` "문항은 10개까지 추가할 수 있어요"를 둔다 `[가정: 문구]`. 문항 문장 1,000자는 C-07 글자 수 규칙을 따른다.
- **(v3) S-19 생성 직후 안내 상자** (`GenerationNotes`): `validated` 뒤 왼쪽 문서 열 맨 위에 둔다. 자소서는 문항 목록 맨 위에 하나를 두고 문항별로 묶는다.

```
Collapsible (기본 펼침) rounded-lg border border-info/30 bg-info-subtle
  트리거 줄 px-4 py-3 flex items-center gap-2:
    Info size-4 text-info + text-sm font-semibold text-info-subtle-foreground "생성 직후 안내" [가정: 제목]
    + Badge variant="count" 항목 수 + ml-auto ChevronDown size-4
  본문 px-4 pb-4 space-y-4 text-sm text-info-subtle-foreground
    묶음마다 p.font-medium 머리 + ul list-disc pl-5 space-y-1.5
      "포함하지 않은 항목" (경력기술서 omitted): 항목 이름 font-medium + " — " + 이유
      "확인해 주세요" (notes_for_user)
      "글자 수를 맞추지 못했어요" (자소서 char_adjust_needed)
    자소서는 묶음 위에 caption "문항 {n}"
  하단 줄 border-t border-info/20 pt-3 caption: Clock size-3.5 + "이 안내는 지금만 보여요. 필요하면 메모해 두세요"
```

  - 닫기(X)는 두지 않고 접을 수만 있다. 저장되지 않으므로 화면을 다시 열면 상자가 없다. 안내할 내용이 하나도 없으면 상자를 그리지 않는다.
- **(v3) S-19 글자 수 표시** (자소서 문항 머리):
  - 기본: `caption tabular-nums text-muted-foreground` "현재 1,180자 / 제한 1,200자(공백 포함)"
  - 제한을 넘었지만 110% 이내: 같은 글자를 `text-warning-subtle-foreground`로 바꾸고 앞에 `TriangleAlert size-3.5 text-warning`를 둔다. 문항 머리 아래에 `meta text-warning-subtle-foreground`로 명세 문구 "제한보다 {n − limit}자 많아요. AI 보정 범위(최대 10% 초과) 안이라 그대로 두었어요. 제출처 제한을 확인해 주세요"를 둔다.
  - 편집해서 110%를 넘은 경우: 같은 경고 모양이고 아래 줄은 "제한보다 {n − limit}자 많아요"만 둔다 `[가정]`.
  - 편집본 기준으로 실시간 다시 센다. 생성 직후 안내 상자가 사라져도 이 경고는 남는다(`validation_report`).
- **(v3) S-19 스트리밍**: "마무리 중"과 블록 통째 교체는 3.4 C-04 표를 따른다.
- **(v3) S-19 경력기술서 실패**: 편집기 문서 열 자리에 C-20 block형을 둔다. AlertTitle은 원인 문장이다. AlertDescription 첫 줄은 `font-medium` "생성에 실패했어요. 다시 시도하면 새 초안으로 처음부터 만들어요"이다. **② 보존 줄은 넣지 않는다**(남는 블록이 없다). 동작 줄은 `RetryButton` + C-19 연결 배지(활성 공급자)이다. 항상 새 초안이므로 "처음부터 다시" 줄은 두지 않는다. 오른쪽 패널(C-11)은 비운다. 입력 원인 실패면 3.20 규칙대로 다시 시도가 없다.
- (v3) S-19 자소서 실패 문항: 그 문항 자리에만 C-20 inline형을 두고, 완료된 문항은 그대로 둔다.
- (v3) S-13·S-31 기능 상태는 3.3 `AiFeatureStatus`를 따른다.

### A4 면접 · 보드 (S-20, S-33, S-22, S-37, S-39)

- S-20: `max-w-form`. 진입 안내 `Alert variant="info"`. 작성 중 세션 배너 `Card border-warning bg-warning-subtle` 한 줄 + "이어서 쓰기"(default) "그만두기"(ghost). ① 유형 = `RadioGroup` 카드형 2개(`job` `Briefcase` 직무 면접 / `culture_fit` `Users` 컬처핏 면접, 각 한 줄 설명), ② 질문 수 = `ToggleGroup` 3/5/7. 데이터 상태 = C-09 또는 `Alert variant="info"` "입력된 커리어가 적어…". 시작하기(AiRunButton). (v2) 무료 등급이면 시작하기 위에 `Alert variant="info"`로 순차 안내를 두고(문구는 명세 S-20), 지난 세션 목록에 "실행 공급자" 열(3.19)을 더한다. 지난 세션 목록 = S-37 행과 같은 모양.
- S-33 답변지: 질문 카드 목록 `max-w-prose-edit mx-auto space-y-6`. 카드 `Card p-5`: 머리 `caption` "질문 {n}/{N}" + 유형 `Badge outline` → 질문 `prose font-medium` → 답변 `Textarea prose min-h-40` + C-06(답변별 아님, 화면 머리 하나) + 글자 수. 생성 중 질문 자리 C-04(차례로 채움), 답변란은 전부 생성될 때까지 `disabled` + "질문을 준비하고 있어요"(T-9). 하단 `sticky bottom-0` 바: `meta` "답변 {a}/{N}" + 주 버튼 "제출"(AiRunButton). (v2) 키가 없으면 제출 자리가 C-18 인라인형이 되고, 답변 편집과 자동 저장은 그대로다. 미응답 경고 = `AlertDialog`.
- S-22: 머리 카드(C-17 점수 + 고지 + `unanswered_count` + 다룬 보완 요건 칩 `Badge secondary`) → 답변별 카드(질문 · 내 답변 `prose text-muted-foreground` 접기 · 평가 항목 등급 · 개선점 · 모범 답변 예시 + C-01). 채점 중이면 C-03(부분 결과: 끝난 카드부터).
- S-37: 5.2 목록. (v2) "실행 공급자" 열(3.19 목록 열)과 "새 면접" 자리(키 없으면 C-18 인라인형). 상태 배지: in_progress "작성 중" `draft` / evaluating "채점 중" `ai` + `Loader2` / completed "완료" `success` / evaluation_failed "채점 실패" `destructive-subtle` / abandoned "그만둠" `outline muted`. 새 결과 = 행 앞 `size-2 rounded-full bg-primary` + `sr-only` "새 결과".
- S-39: 5.5. C-12~C-14는 3장. (v3) C-14 작성 중 세션 안내 개정은 3.13, 카드 기능 상태는 3.3 `AiFeatureStatus`.
- **(v3) S-22 다시 채점**:
  - 버튼 줄은 머리 카드 안, 점수·고지 아래 `Separator` 다음에 둔다. `AiRunButton`의 글자는 "실패한 답변 {n}개 다시 채점"(`default`, `RotateCcw`)이고, C-19 연결 배지(활성 공급자)와 주석 "다시 채점하면 공급자 토큰을 다시 써요"를 둔다. `completed`이고 실패한 답변이 없으면 줄 전체를 그리지 않는다.
  - 답변 카드의 "다시 채점"은 C-17 "채점 실패" 옆 `Button variant="link" size="sm"`이고 같은 동작이다. 배지는 머리 버튼 줄에만 둔다.
  - 진행 중(`evaluating`): 머리 카드 위에 C-03 진행 카드(채점 단계)를 둔다. 세션 점수 자리(C-17)는 `Skeleton h-8 w-24`이고 다시 채점 버튼 줄은 사라진다. 이미 채점된 답변 카드는 그대로 보인다.
  - **이전 종합 평가는 흐리게** 둔다. 종합 카드에 `aria-busy="true"`를 달고, 본문 글자를 `text-muted-foreground`로 낮추고, 칩과 등급 배지에는 `opacity-60`을 준다. 글자에는 `opacity`를 걸지 않아 4.5:1 대비를 지킨다. 카드 머리 오른쪽에는 `inline-flex items-center gap-1.5 text-sm text-ai-subtle-foreground` + `Loader2 size-3.5 animate-spin text-ai` "종합 평가를 다시 정리하는 중"을 둔다.
  - 첫 열람으로 "새 결과" 표식이 지워져도 S-22 화면에는 바뀌는 모습이 없다.
- **(v3) S-37**:
  - 채점 실패 행의 `⋯` 메뉴에 "실패한 답변 다시 채점"(`RotateCcw`)을 둔다. 메뉴 안에는 배지 버튼을 넣지 않는다. 대신 항목 오른쪽 끝(`DropdownMenuShortcut` 자리)에 `caption`으로 활성 공급자 글자 "Gemini · 무료 등급"을 둔다 `[가정]`. 키가 없으면 이 항목을 눌렀을 때 C-18 팝업형(3.18)을 띄운다 `[가정]`.
  - 새 결과 표식: 채점 실패 행에는 점과 "채점 실패" 배지를 함께 둔다. 채점 중 행에는 점이 없고 C-03 축약형("채점 준비 중" → "답변 채점 중 (n/N)" → …)을 둔다.
- **(v3) S-33 그만둔 세션** (`status = 'abandoned'`, 읽기 전용):
  - 질문 목록 위에 `Alert`(기본 variant) + `PauseCircle`을 둔다. 제목은 "그만둔 면접이에요. 답변은 볼 수만 있어요"이고, 동작은 `Button size="sm"` default "이 기업 JD로 새 면접 시작"(→ S-20)이다. AI 실행이 아니므로 배지를 붙이지 않는다.
  - 답변란은 `Textarea` 대신 글자만 보이는 상자(`prose rounded-md bg-muted/50 px-4 py-3 whitespace-pre-wrap`)로 그린다. 빈 답변은 `text-muted-foreground` "답변 없음"이다 `[가정: 문구]`. 글자 수, C-06, 하단 제출 막대는 그리지 않는다.
- **(v3) S-33 질문 근거 칩**: 질문 아래 C-01 칩 줄을 제출 전에도 보인다(작성 중 세션과 그만둔 세션 모두). 질문 의도와 좋은 답 신호는 이 화면에 두지 않는다.
- **(v3) S-33 생성 진행과 다시 만들기**: 생성 영역의 C-03은 `prepare` → `generate` "질문 만드는 중 (n/N)" 순서다. 전체 실패의 "다시 시도"와 "남은 질문 다시 만들기"(`outline`, `RotateCcw`)는 3.20의 배지, "처음부터 다시" 줄, 거부 규칙을 따른다. 입력 원인 실패는 다시 시도 없이 S-20으로 가는 동작 하나만 둔다.

---

## 7. 접근성 체크 기준

| # | 기준 | 확인 방법 |
|---|------|-----------|
| A-1 | 글자 대비 4.5:1, 큰 글자·아이콘·입력 테두리·포커스 링 3:1 (양 테마) | 1.1.3 확인표 밖 조합 사용 금지 |
| A-2 | 상태는 색 + 아이콘 + 글자 (R-C6) | 회색조로 캡처해도 구분되는지 |
| A-3 | 모든 조작 요소에 보이는 포커스: `focus-visible:ring-2 ring-ring ring-offset-2 ring-offset-background`(shadcn 기본 `ring-[3px] ring-ring/50`을 쓰면 `ring-ring` 불투명으로 바꿈) | 키보드 Tab 순회 |
| A-4 | 좁은 화면(768px 미만) 터치 대상 44×44px 이상. **모든 조작 요소**에 적용: 버튼 전 크기(`default` 40px·`sm`·주 버튼 포함), 아이콘 버튼, `⋯` 메뉴, 탭, Select 트리거, 단독 글자 링크(본문 안 인라인 링크 제외). 데스크톱은 원래 크기 유지 (리더 결정 2026-10-25, UQ-45·UQ-127) | 버튼 `max-md:h-11`(+`max-md:px-4`), 아이콘 버튼 `max-md:size-11`, 글자 링크 `max-md:min-h-11 inline-flex items-center`. 공통 컴포넌트가 직접 보장하고 화면이 감쌀 필요 없게 한다 |
| A-5 | 보드: 드래그 없이 C-12로 전부 가능, dnd-kit 키보드 센서(Space 집기 / 화살표 / Space 놓기 / Esc), 열 = `ul` + `aria-label="{단계} {n}개"`, 이동 결과 `aria-live` | 키보드만으로 카드 이동 |
| A-6 | AI 진행·완료·실패는 `aria-live="polite"`로 한 번씩 알림, 스트리밍 글자 단위 낭독 금지 | 스크린 리더 |
| A-7 | 아이콘만 있는 버튼은 `aria-label`, 칩은 전체 라벨 `aria-label` | |
| A-8 | 16px 미만 입력 글자 금지(iOS 확대), 12px 미만 글자 금지 | |
| A-9 | `prefers-reduced-motion` 존중(1.3) | OS 설정 |
| A-10 | 폼 오류: 필드 아래 `text-sm text-destructive` + `CircleAlert`, `aria-invalid` + `aria-describedby` (shadcn `FormMessage`) | |
| A-11 | (v2) 카운트다운(`RetryButton`, 한도 대기 줄)은 매초 낭독하지 않는다. 시각을 `aria-describedby`로 한 번만 준다. 외부 링크는 `aria-label`에 "(새 탭)"을 넣고 `ExternalLink` 아이콘을 보인다 | 스크린 리더 |
| A-12 | (v2) S-41 단계 표시는 `ol` + `aria-current="step"`이다. 단계가 바뀌면 새 단계 제목으로 포커스를 옮긴다. API 키 입력란은 `type="password"`, `autoComplete="off"`이고, 보기 토글은 두지 않는다(명세) | 키보드·스크린 리더 |
| A-13 | (v5) **문서형 입력 예외**: L-02의 `DocTitleInput`·`DocTextarea`는 테두리 없이 그린다(1.4.11 입력 테두리 3:1 대신). 대신 반드시 ① 보이는 라벨(칸 제목, 제목 칸은 `aria-label`) ② 자리 표시 ③ hover 바탕 ④ 포커스 링 `ring-2 ring-ring`을 모두 둔다. 이 예외는 L-02 머리 제목·STAR·산출물 본문에만 쓰고, 대화 입력창·다이얼로그·패널 폼은 `border-input`을 그대로 쓴다 | Tab으로 칸을 지날 때 링이 보이는지, 빈 칸이 입력임을 알 수 있는지 |
| A-14 | (v5) **손잡이**: `ResizeHandle`은 `role="separator"` + 값 속성 + 키보드(←/→·Shift·Home/End·Enter)로 드래그 없이 조절된다(5.9). 패널 닫기 → 포커스는 [Resumate AI] 버튼, 다시 열기 → 패널 입력창. 좁은 화면 시트는 shadcn `Sheet`의 포커스 가둠을 쓴다 | 키보드만으로 폭 조절·열고 닫기 |
| A-15 | (v5) **반영 알림**: 제안 카드 [반영]·본문 채우기는 왼쪽 칸을 바꾸므로 `aria-live="polite"`로 명세 문구("{섹션}에 채웠어요. 저장하기를 눌러야 저장돼요")를 한 번 알린다. `SaveButton`의 상태 변화(저장 중 → 저장됨/실패)는 C-06 글자의 `aria-live`가 알린다. 한글 조합 중 Enter로 보내지 않는다 | 스크린 리더 · 한글 입력 |

---

## 8. 결정 · [가정] · 기획 확인 필요

### 8.1 사용자 결정 (2026-10-24)

| # | 결정 | 반영 |
|---|------|------|
| UD-1 | 강조색(primary)은 **초록 계열** | `--primary` 158° 초록, `--ring`·`--sidebar-primary`·`--chart-1` 초록. 파생 조정: success를 140°로 옮기고 역할 분리(R-C2), 단계 점에서 초록 제외(R-C5), AI 보라·info 파랑은 그대로 |
| UD-2 | 기본 본문 글자 **16px** | 1.2 스케일 기준 `text-base`, 버튼 default·입력 16px, 편집 폭 42rem 재계산 |

### 8.1a 리더 결정 (2026-10-28, BYOK)

| # | 결정 | 반영 |
|---|------|------|
| LD-1 | S-40·S-42는 설정 다이얼로그의 섹션이고, 같은 내용 컴포넌트로 라우트 페이지 `/settings/ai`, `/settings/ai/usage`도 둔다. S-41은 페이지 `/settings/ai/connect` | 5.7 |
| LD-2 | L-01 하단 AI 연결 상태 줄의 위치는 디자이너가 정한다 → `NavSecondary` 첫 항목(설정 위)으로 정했다 | 5.1 |

### 8.2 [가정] (문서가 정하지 않은 시각 선택 — 바꿔도 이름은 유지)

| # | 가정 | 위치 |
|---|------|------|
| G-1 | shadcn 최신판(Tailwind v4, OKLCH, `@theme inline`)으로 스캐폴드 | 1.1 |
| G-2 | 폰트 Pretendard Variable, `next/font/local` 자가 호스팅 | 1.2 |
| G-3 | 중립색은 약간 푸른 회색(260°), 페이지 바탕 회색 + 카드 흰색 | 1.1 |
| G-4 | AI 활동 전용 보라색 `--ai` 도입 | 1.1, R-C3 |
| G-5 | 반경 8px 기준, 그림자는 떠 있는 것에만 | 1.3 |
| G-6 | 셸 접힘 기준 1024px, S-36 2단·S-19 패널 기준 1280px, 보드 탭 기준 768px | 1.4 |
| G-7 | 메뉴 아이콘(Layers/Briefcase/MessagesSquare/KanbanSquare) | 5.1 |
| G-8 | 날짜는 네이티브 `Input type="date"`, 월은 Select 두 개(추가 의존성 회피) | 2 |
| G-9 | 마감 임박은 D-day 배지만 강조(카드 전체 강조 안 함) | 5.5 |
| G-10 | 단계 점 색 6종 | 1.1.4 |
| G-11 | AI 실행 버튼도 primary(보라 아님) | R-C3 |
| G-12 | 랜딩에 일러스트·스크린샷 없음 | 6 A1 |
| G-13 | ST-AI-SYNC 15초 경과 안내 문구 | 4 |
| G-14 | (v2) C-18 잠금은 안내 카드 계열(`primary-subtle` 아이콘 원)로 그리고 경고색·AI 보라를 쓰지 않는다 | 3.18 |
| G-15 | (v2) C-18 "AI 연결하기"는 영역형에서 `default`, 인라인형에서 `outline`. S-40 미연결 카드의 "연결하기"는 Gemini만 `default` | 3.18, 5.7 |
| G-16 | (v2) AI 연결 후 복귀하면 풀린 버튼에 4초 `ring-primary`와 토스트를 띄운다 | 3.18 |
| G-17 | (v2) 공급자 로고·브랜드 색 없이 글자로만 표시 | 3.19 |
| G-18 | (v2) C-19 유료 등급 툴팁 문구 | 3.19 |
| G-19 | (v2) C-20 톤 두 가지: 기다림·조치는 warning, 공급자 장애·시스템은 destructive | 3.20 |
| G-20 | (v2) KST 시각 형식("오후 4:00 (KST)", "내일", "곧")과 외부 링크 글자 | 3.20 |
| G-21 | (v2) C-20 보존 줄 문구 "입력과 지금까지 만든 결과는 그대로 있어요" | 3.20 |
| G-22 | (v2) 무료 등급 요청 한도 대기는 AI 보라 `Hourglass`로 보이고 경고색을 쓰지 않는다. 진행 카드의 공급자 배지는 축약형에 두지 않는다 | 3.3 |
| G-23 | (v2) L-01 AI 상태 줄은 `NavSecondary` 첫 항목이고, 누르면 설정 다이얼로그 "AI 연결" 섹션이 열린다. 레일에서는 아이콘 + 상태 점 | 5.1 |
| G-24 | (v2) 설정 다이얼로그 섹션 순서(계정 다음에 AI 연결·AI 사용량)와 경고 점 | 5.1 |
| G-25 | (v2) S-41은 넓은 화면에서 사이드바 없는 집중 화면이다. 일부 단계만 하는 흐름은 번호를 다시 매기고, 키를 입력한 상태에서 그만두면 확인을 받는다 | 5.7 |
| G-26 | (v2) C-21은 "모두 동의"가 없고, 다음 버튼이 비활성인 이유와 재동의 알림 문구를 보인다 | 3.21 |
| G-27 | (v2) S-42의 금액·토큰 표기, 좁은 화면 두 줄 행, 오류 문구. 차트는 없다 | 5.7 |
| G-28 | (v2) 일시 중지 카드에서도 키 삭제는 남긴다. 공급자 장애 배너는 세션 동안 닫을 수 있다 | 5.7, 4 |
| G-29 | (v3) C-03 `prepare`가 300ms 안에 끝나면 바로 완료 체크, `synthesize_regen`은 새 행 없이 `synthesize` 행을 다시 현재로 | 3.3 |
| G-30 | (v3) 목록·카드의 실패 한 줄에는 버튼을 두지 않는다 | 3.3 |
| G-31 | (v3) C-04 "마무리 중"에도 글자 선택은 허용, "중단"은 `done`까지 | 3.4 |
| G-32 | (v3) C-09 `project_fields` 주 버튼의 긴 이름 자르기 | 3.8 |
| G-33 | (v3) C-19 동의 필요형 배지(상태·아이콘·툴팁 문구). 명세는 배지 상태에 동의를 넣지 않았다 | 3.19, 5.7 |
| G-34 | (v3) 다시 시도 거부는 새 Alert를 쌓지 않고 동작 줄만 바꾼다 | 3.20 |
| G-35 | (v3) 입력 원인 실패 아래 "고친 뒤 {실행 버튼}로 새로 실행해 주세요" 문구, 60초 이상 대기 표기 | 3.20 |
| G-36 | (v3) C-21 동의 창의 제목·버튼 글자, 동의 뒤 토스트 없음 | 3.21 |
| G-37 | (v3) S-36 전송 차단 안내는 다음 전송까지 남음, 그만두기 확인 버튼 글자 "그만두기", 그만둔 뒤 S-08 묶음 펼침·강조, 그만둔 대화 막대 문구 "그만둔 대화예요", 그만둔 대화의 미리보기 읽기 전용 | 5.4 |
| G-38 | (v3) S-25 busy 오류는 Alert 안에 버튼 없이 "탈퇴하기"를 다시 누름, 탈퇴 마무리 상태는 셸 밖 배치, 성공 뒤 토스트 없음 | 6 A1 |
| G-39 | (v3) S-17 문체 선택 위치와 변경 후 다시 생성 안내, 생성 버튼 비활성 이유 문구, 프로젝트 8개 문구, S-18 10개 문구 | 6 A3 |
| G-40 | (v3) S-19 생성 직후 안내 상자 제목 "생성 직후 안내", 편집으로 110%를 넘었을 때의 표시 | 6 A3 |
| G-41 | (v3) S-37 메뉴 항목의 공급자 글자와 키 없음 시 C-18 팝업형, S-33 빈 답변 "답변 없음" | 6 A4 |
| G-42 | (v5) L-02 셸 바탕 `--shell` = L-01 앱 바탕 `--sidebar`와 같은 #F3FBF8(v4 브랜드 토큰, 머지 2026-11-03 — Q-10 해소) | 1.1, 5.8 |
| G-43 | (v5) AI 패널 바탕 `--panel`(카드와 칩 사이 밝기). 다크에서는 카드보다 밝다 | 1.1, 5.10 |
| G-44 | (v5) 본문 카드 `rounded-2xl` + `shadow-sm`(테두리 없음), 패널 `rounded-xl`, 상단 바 `h-14`, 패널 기본 420 / 최소 360 / 최대 640(카드 50% 이하), 왼쪽 최소 448 | 1.3, 1.4, 5.8, 5.9 |
| ~~G-45~~ | (v5) 버튼 반경 — v4 `rounded-control`(12)로 해소 | 1.3 |
| G-46 | (v5) `doc-title` 20px, 머리 라벨 14px(Figma 13px), STAR·본문 자리 표시 16px(Figma 15px) — 12px·16px 하한 규칙(A-8) 우선 | 1.2, 5.9 |
| G-47 | (v5) 저장하지 않은 변경 표식 = 버튼 오른쪽 위 `warning` 점, `SaveButton` 폭 고정, ⌘S 툴팁 글자, 좁은 화면에서 저장 상태 글자 대신 아이콘·토스트 | 5.8 |
| G-48 | (v5) 변경 충돌(`stale_write`)은 AlertDialog, 입력 보존 복원은 배너형, 이탈 확인 버튼 순서·모양 | 5.8 |
| G-49 | (v5) 창 높이 760 미만이면 머리를 왼쪽 스크롤 안으로, STAR 칸 간격 `space-y-10`, 글자 수는 포커스·90% 이상일 때만(S-44 본문은 항상) | 5.9 |
| G-50 | (v5) 마크다운은 원문 그대로 입력(서식 미리보기 없음), 목록 줄 Enter 이어쓰기·Tab 들여쓰기 | 5.9 |
| G-51 | (v5) "지금 본문에서" 칩·C-02 근거 구간 강조는 textarea 선택 상태 + 칸 링으로 대신, 못 찾으면 토스트 | 3.14, 5.9 |
| G-52 | (v5) 패널 안 버튼은 모두 outline/ghost/secondary, 보내기만 default(R-C8). C-18 영역형도 패널 안에서는 outline | 1.1.3, 5.10 |
| G-53 | (v5) `Sparkles text-ai`를 AI 패널 식별 아이콘으로 허용(R-C9) | 1.1.3 |
| G-54 | (v5) 제안 독 = 입력창 바로 위 고정, 펼침 최대 55%, 새 제안이 오면 펼침. 칩은 시작 영역에 따로 두지 않고 칩 줄 한 곳 | 5.10 |
| G-55 | (v5) 빠른 응답("잘 모르겠어요"·"건너뛸게요")은 칩이 아니라 ghost 버튼, 패널 G-2 줄은 12px | 5.10 |
| G-56 | (v5) 제안 카드 값 글자 14px, 덧붙일 문장은 `ai-subtle` 상자, ④ "폼에 채움"은 info 배지, ⑤ 반영됨 섹션은 접음, [반영] 직후 왼쪽 칸으로 스크롤하지 않음, 되돌리기 토스트 8초 | 3.24, 3.25 |
| G-57 | (v5) S-44 블록: "새 내용" = `ai` 왼쪽 선 + 배지, 덧붙이기 미리보기 = 붙을 블록 강조 + 나머지 흐림, [빼기] ghost, 블록 목록 28rem에서 접기(그라데이션 덮개), 교체 확인은 hash 불일치여도 default 버튼 | 3.25 |
| G-58 | (v5) S-10 직접 고치기 완료 버튼 글자 "저장", 반영됨 배지의 방식 글자("반영됨 · 교체/덧붙임"), 사실 칩 라벨에 "#n" 붙임 | 3.24, 3.25, 3.14 |
| G-59 | (v5) 좁은 화면 패널 = 떠 있는 둥근 버튼 → 시트(768 미만 전체 화면, 768~1023 `max-w-md`), 시트 머리 "STAR 보기"/"본문 보기" | 5.8 |
| G-60 | (v5) L-02 토스트 위치 `bottom-left`, 로고 표기 "Resumate" | 2, 5.8 |
| G-61 | (v5) S-43 산출물 행 = 아이콘 + 제목 + `ChevronRight`, 50개 안내는 제목 줄 아래 | 6 A2 |

### 8.3 열린 질문 (리더 경유)

| # | 질문 | 대상 |
|---|------|------|
| Q-1 | Pretendard 폰트 파일을 저장소에 넣어도 되는지(라이선스 OFL, 용량 약 2MB 또는 dynamic-subset) — 아니면 시스템 폰트만 | 리더 |
| Q-2 | 다크 모드 전환 → **결정(2026-10-29, 사용자)**: 설정에서 시스템 설정/라이트/다크 선택. `next-themes` 없이 루트 레이아웃 인라인 스크립트(`components/common/theme.ts`)가 첫 화면 전에 `.dark`를 붙임 | 리더 |
| Q-3 | `cmdk`(shadcn `command`) 의존성 사용 승인 — C-16 검색 | 리더 |
| Q-4 | (v2) 공급자 로고(Gemini·Claude·OpenAI)를 S-40 카드에 쓸지. 쓰려면 각 브랜드 가이드 확인이 필요하다. 지금은 글자만 쓴다 | 리더 |
| Q-5 | (v2) S-41 집중 화면(사이드바 없음)을 `(dashboard)` 아래 라우트에서 셸 레이아웃을 빼고 그릴 수 있는지(라우트 그룹 분리). 어렵다면 셸 안 페이지로 두고, 넓은 화면에서는 본문을 가운데 `max-w-2xl`로 둔다 | 리더 · 파운데이션 |
| Q-6 | (v2) 공급자 대시보드·결제·상태 페이지·키 발급 페이지 URL을 어디서 관리하는지(mock 상수 / `ai_providers` 테이블) | 리더 · 백엔드 |
| Q-7 | (v5) Figma 버튼 반경(약 8px)을 전체 버튼에 맞출지. 지금은 6px 유지(G-45). 바꾸면 `--radius-md` 하나만 고치면 되지만 모든 화면이 함께 바뀐다 | 리더 · 사용자 |
| Q-8 | (v5) L-02 화면(`/career/projects/*`, `/career/deliverables/*`)을 `(dashboard)` 사이드바 레이아웃 밖 라우트 그룹으로 옮길 수 있는지(Q-5와 같은 문제). 어렵다면 레이아웃에서 경로로 사이드바를 끄는 방식 | 리더 · 파운데이션 |
| Q-9 | (v5) 로고 워드마크 표기 — Figma "ResuMate" / 서비스 문서 "Resumate". 지금은 "Resumate" | 리더 |
| Q-10 | (v5) L-01 셸 바탕(`--sidebar`, 무채색 회색)도 Figma L-02처럼 민트 회색(`--shell`)으로 맞출지. 지금은 L-02만 바꿨다 | 리더 · 사용자 |

### 8.4 기획 확인 필요

| # | 화면 | 내용 |
|---|------|------|
| P-1 | C-05 기업 JD 삭제 | "확인 체크"의 문구가 명세에 없음. 임시 "삭제된 내용은 되돌릴 수 없어요를 확인했어요" |
| P-2 | S-22 / C-17 | 항목 등급 `grade`의 화면 라벨(매우 좋음/좋음/보통/부족/해당 없음)이 명세에 없음 |
| P-3 | S-15 / S-16 | `importance = 'high'` 요건의 화면 라벨 없음. 임시 "핵심" |
| P-4 | S-39 | 빈 열 문구 없음. 임시 "카드 없음" |
| P-5 | S-36 | 2단 → 탭 전환을 모바일뿐 아니라 1280px 미만까지 적용(명세는 "모바일 탭" `[가정]`). 구조가 아닌 배치 판단이나 확인 요청 |
| P-7 | C-19 결과 배지 (v2) | 명세 예시 "Gemini · 기본로 만든 결과"는 조사가 어색하다("기본으로"). 단계 이름 뒤 조사 규칙을 확인해야 한다(경량으로 / 기본으로 / 고성능으로) |
| P-8 | C-20 (v2) | "입력·부분 결과 보존"이 규칙으로만 있고 화면 문구가 없다. 임시 "입력과 지금까지 만든 결과는 그대로 있어요" |
| P-9 | S-41 ③ (v2) | 교체 중 실패 시 "기존 키 유지" 안내 문구가 없다. 임시 "기존 키는 그대로 쓰여요" |
| P-10 | S-42 · S-40 (v2) | 사용량 불러오기 오류 문구, 유료 등급 C-19 툴팁 문구, C-21 재동의 알림 문구가 없다 |
| P-6 | 여러 화면 | 명세가 "v3와 같음"으로 적은 S-15~S-19·S-22·S-24·C-08의 v3 세부 명세가 저장소에 없음. 이 문서는 v4 명세와 AI 명세에서 보이는 요소로만 패턴을 정했다 |
| P-11 | S-22 (v3) | 종합 평가만 실패한 `evaluation_failed` 세션(실패한 답변 0개)에서 버튼 글자가 "실패한 답변 0개 다시 채점"이 된다. 이 경우 버튼을 보일지, 글자를 무엇으로 할지 명세에 없다. 임시로 n이 0이면 "종합 평가 다시 정리"로 쓴다 `[가정]` |
| P-12 | S-36 · S-33 (v3) | 그만둔 대화를 열었을 때의 안내 문구, 그만둔 면접의 빈 답변 표시 문구가 없다. 임시 "그만둔 대화예요", "답변 없음" |
| P-13 | S-17 · S-18 (v3) | 선택 상한(프로젝트 8개, 문항 10개)과 1개 이상 선택 조건의 안내 문구가 없다(자소서 근거 5개만 있음). 임시 문구는 G-39 |
| P-14 | C-21 (v3) | 실행 전에 여는 동의 창의 제목과 확인 버튼 글자가 없다. 임시 "{공급자}({등급}) 데이터 사용 동의" / "동의하고 계속" |
| P-15 | S-08 · S-09 · S-34 · C-22 · C-24 · C-25 (v5) | v5.5 커리어 재설계 화면의 시각 규칙이 이 문서에 아직 없다(이번 범위 밖). 구현은 앞서 진행됐으므로 다음 디자인 시스템 개정에서 구현을 기준으로 정리할지 리더 판단 필요 |
| P-16 | S-10 · S-44 패널 (v5) | 명세 "제안 카드 — 대화 목록 아래 고정, 접기 가능"의 "대화 목록"이 메시지 목록인지 대화 기록 목록인지 모호하다. 메시지 목록 아래(= 입력창 위) 독으로 읽었다(5.10) |
| P-17 | S-10 (v5) | 제안 카드의 "직접 고치기" 완료·취소 버튼 글자가 없다. 임시 "저장" / "취소"(G-58). 상단 바 "저장하기"와 헷갈릴 수 있어 "고치기 완료"도 후보 |
| P-18 | S-44 (v5) | 블록 [빼기]에 되돌리기가 없다(명세상 `rev` + 1 사용자 패치). 실수로 뺀 블록을 살릴 길이 새 초안뿐인데 맞는지 |
| P-19 | L-02 (v5) | `stale_write` "새로 불러오기"의 "버린다고 함께 알림" 문구가 없다. 임시 "새로 불러오면 저장하지 않은 변경과 AI 반영 표시가 사라져요" |
| P-20 | S-44 (v5) | 반영됨 상태에 방식("교체"/"덧붙임")을 보일지 명세에 없다(`applied_mode`는 저장됨). 임시로 보인다(G-58) |

### v4 메모 — 대비 (사용자 결정 2026-11-03에 따름)

- `#15A76E` 위 흰 글자(`--primary-foreground`) 대비는 약 3.1:1로 WCAG 1.4.3 본문 4.5:1에 못 미친다(큰 글자·굵은 UI 글자 3:1은 충족).
- 초록 글자 `--primary-text` `#118658`(사용자 지정, 바꾸지 않음 — UQ-710)의 측정 대비(WCAG 상대 휘도, 2026-11-03 UI QA):

  | 바탕 | 쓰이는 곳 | 대비 |
  |------|-----------|------|
  | 흰색 | link 글자, 초록 아이콘 | 4.59 (4.5:1 충족) |
  | `#F3FBF8` (`--sidebar`) | 사이드바 위 초록 글자 | 4.36 (미달) |
  | primary 10% over 흰색 ≈ `#E8F6F0` | secondary 버튼, ghost hover, 메뉴 focus, Item 선택 | 4.13 (미달) |
  | primary 10% over `#F3FBF8` ≈ `#DDF3EA` | 사이드바 현재 메뉴 | 3.95 (미달) |
  | primary 15% over 흰색 | secondary hover | 3.92 (미달) |

  대상 글자는 대부분 14~16px medium이라 큰 글자 3:1 기준이 적용되지 않는다. 사용자 지정 값이라 그대로 둔다.
- `--input` `#E2E2E2`는 흰 바탕에서 약 1.3:1로 1.4.11(UI 컴포넌트 3:1)에 못 미친다. 포커스 시 `--ring`으로 구분된다.
- 사용자 지정 값이므로 그대로 둔다. 보완이 필요해지면 초록 바탕 위 글자만 더 어두운 `--primary-subtle-foreground`(`#0E7A50`)로 바꾸는 방법이 있다(사용자 확인 후).

---

## 9. 변경 이력

| 버전 | 날짜 | 내용 |
|------|------|------|
| v1 | 2026-10-24 | 최초 작성. 사용자 결정 UD-1(초록 강조색)·UD-2(본문 16px) 반영 |
| v2 | 2026-10-28 | **BYOK 반영**(PRD v4.2 · 플로우 v5.2 · AI v4.2 · 데이터 모델 v4.1a). 이후 반영된 5.1 sidebar-08 셸과 S-24 sidebar-13 설정 다이얼로그는 그대로 두었다. 신설: C-18 `AiLock`(3.18), C-19 `ProviderBadge`·`ProviderResultTag`(3.19), C-20 `AiErrorNotice`·`RetryButton`(3.20), C-21 `DataUseConsent`·`FreeTierNotice`(3.21), `AiRunButton`(3.22), C-03 무료 등급 순차·대기 줄, ST-AI-LOCKED / ST-AI-KEY-MISSING / ST-AI-KEY-CHECK, 공급자별 장애 배너, L-01 `NavAiStatus`, 설정 다이얼로그 섹션 2개, 5.7 S-40/S-41/S-42(`ProviderCard`, `StepIndicator`), badge `recommend` variant, A-11·A-12. **삭제와 이전**: `UsageHint` → `AiRunButton`(사용처: C-09, C-11 다시 생성, S-16 다시 생성, S-20 시작하기, S-08 시작 버튼, S-33 제출) / `AiFailed`·ST-AI-FAILED → `AiErrorNotice`(사용처: C-04 error, S-36 실패한 턴, S-16·S-19·S-22·S-15·S-33 결과 영역) / `LimitNotice`·ST-LIMIT → 삭제(대체 없음, 공급자 한도는 C-20) / C-09 10회 소진 분기 → 키 무효·대화 실패 분기 / "사용량은 차감되지 않았습니다"·"이번 달 N회 남음"·"{N}/10회" 문구 → 삭제. 토큰 추가 없음(기존 상태 토큰 재사용) |
| v4 | 2026-11-03 | **사용자 지정 브랜드 토큰**. `--primary`·`--ring`·`--sidebar-primary`·`--chart-1` = `#15A76E`, `--primary-subtle` `#E3F5EE` / `-foreground` `#0E7A50`, 기본 바탕 `--sidebar` = `#F3FBF8`, 콘텐츠 패널 `--background` = `#FFFFFF`(`--sidebar-accent` = primary 10%, `-foreground` = `--primary-text`: 사이드바 메뉴 hover·선택도 ghost와 같은 초록), `--border`·`--input`·`--chip-border`·`--sidebar-border` = `#E2E2E2`. 신설 `--radius-control: 12px`(버튼·드롭다운·입력). 팝오버·메뉴·Select 상자 `p-2`, 외곽선 `ring-border`. outline 버튼 바탕 `bg-card`. secondary 버튼은 `bg-primary/10 text-primary-text`(hover `bg-primary/15`). ghost 버튼은 hover·열림 시 `bg-primary/10 text-primary-text`. 초록 글자는 `--primary-text` `#118658`. 팝오버 메뉴 항목(DropdownMenu·Select·Command)도 hover·포커스 시 같은 색(삭제 항목은 destructive 유지). 사용처의 색 덧씌우기 제거 규칙 추가. 공통 컴포넌트 `Item` 신설, `Card`·`TableRow`에 `interactive`, ghost 버튼 `aria-current` 선택 상태, Toggle 선택 색 초록. 다크 토큰은 `--sidebar-accent`만 같은 방식으로 바꾸고 나머지는 그대로. **후속(UQ-708~722)**: 신설 Button `destructive-ghost`·`destructive-link`·`warning-outline`, ghost `data-pending`, Badge `muted`·`count-neutral`, Card `tone="success"`, TableRow `muted`(+ hover는 `interactive` 행에만), Alert `warning`·`destructive` 아이콘 색을 variant로 이동, Item `active` → `aria-current` 자동·`aria-disabled` 지원·data 속성 보호·`row` 첫/마지막 행 모서리. 문서 토큰 코드 블록에 `--primary-text`·`--color-primary-text` 추가, 8장 대비 메모를 측정값으로 교체, 예외 목록에 `nav-user`·채팅 말풍선·빈 긴 글 자리 글자 추가. 사용처: 삭제 버튼(drafts-view·form-parts DangerZone·achievement-dialog·cover-letter-questions), 저장 실패 링크(save-status), 흐린 배지(basics·stage-menu·insight-view·session-status·result-view·applications/[id]·placeholders·project-form), 작성 중 면접 배너(interview-prep), 커리어 추가 버튼(빈 상태 쪽 secondary) |
| v3 | 2026-10-30 | **기획 v5.3 반영**(PRD v4.3 · 플로우 v5.3 · AI v4.3 · 데이터 모델 v4.2). 새 시각 규칙만 더했다. 토큰·shadcn 컴포넌트·의존성 추가 없음, 기존 토큰·패턴 이름 변경 없음. 추가: C-03 단계 `prepare`·`synthesize_regen`·`complete`와 `AiFeatureStatus`(진행 표시 우선순위, 3.3) / C-04 `sources_selected`·`adjusting_length`·"마무리 중"·`validated` 통째 교체·경력기술서 실패(3.4) / C-09 `project_fields`(3.8) / C-14 마지막 활동·생성 상태·유형 불일치(3.13) / C-18 `consent_required` 행(3.18) / C-19 동의 필요형 배지(3.19) / C-20 다시 시도 배지 = 활성 공급자, "처음부터 다시" 줄, 입력 원인 실패 다시 시도 없음, 요청 안 경로 대기 카운트다운, 다시 시도 거부 표, `key_missing` 동의 원인(3.20) / C-21 동의 창형(3.21) / `AiRunButton` 상태 3행(3.22) / S-36 시작 인사·상한·전송 차단·그만두기·그만둔 대화(5.4) / S-40 동의 필요 카드(5.7) / S-25 확인 체크·오류 2종·탈퇴 마무리 상태, S-08 그만둔 대화 묶음, S-10 그만둠·필드 강조, S-17 상태 배지·실패 초안 행·선행 추출·문체·AI 선택 실패, S-18 글자 수 안내, S-19 생성 직후 안내 상자(`GenerationNotes`)·글자 수 표시·경력기술서 실패, S-22 다시 채점·흐린 종합, S-37 메뉴·표식, S-33 그만둔 세션·근거 칩(6장). **바뀐 것**: 5.3 자소서 문항 머리의 글자 수 글자("1,180 / 1,200자" → "현재 1,180자 / 제한 1,200자", 사용처: S-19 문항 머리) / C-20 `input_rejected` 행에서 `RetryButton` 삭제(사용처: S-16·S-19·S-33·S-36·S-15의 입력 원인 실패) |
| v4 | 2026-11-03 | **프로젝트 상세·산출물 상세 반영**(PRD v4.6 · 플로우 v5.6 · AI v4.6 · 데이터 모델 v4.5, Figma `1034:8565`·`1041:8783`·`1041:8904` — MCP 한도로 리더 관찰값 사용). **토큰 추가**: `--shell`·`--shell-foreground`·`--panel`·`--panel-foreground`(+ `@theme` `--color-*`), 타입 `doc-title`·`star-heading`, 폭 `h-shellbar`·`w-ai-panel`·`min-w-doc-left`·`max-w-doc`, 반경 사용처 `rounded-2xl`·`rounded-3xl`. **variant 추가**: `button` `chip`·`chip-dashed`, `SelectTrigger variant="chip"`. **규칙 추가**: R-C8(보내기만 default), R-C9(AI 패널 식별 아이콘), A-13(문서형 입력 테두리 예외), A-14(손잡이), A-15(반영 알림). **신설 패턴**: 5.8 L-02 셸(`PageShell`·`ShellBar`·`SaveButton`·`CrumbRow`·`LeaveGuard`), 5.9 문서형 페이지(`DocTitleInput`·`DocTextarea`·`FieldRows`·`ChipSelect`·`CompetencyChips`·`ResizeHandle`), 5.10 `AiPanel`, 3.23 C-23, 3.24 `StarProposalCard`, 3.25 `DraftProposalCard`, 3.14 C-15 패널 칩 4종(`SourceChip`), 6장 A2 S-43 산출물 섹션. **이름 변경 없음**. **폐기 표시(코드 이전 대상)**: 5.4 S-36 대화 배치(→ 5.10. 사용처: `components/career/writing-chat/*`, `career/writing-chats/*` 화면), 5.3 "폼 화면"의 S-10과 "긴 글 편집"의 S-35(→ 5.9. 사용처: `project-form.tsx`, `detail-form.tsx`, `projects/[id]/details/*`), 6장 A2 v3 이하 S-08 트리·S-35·S-36·S-11·S-10 메모(→ "(v5) 커리어 v5.6"). **바뀐 규칙**: 패널 제안 카드 안의 C-15 [수락]은 `default` → `outline`(3.14 v4, 사용처: 새 카드만 — 기존 S-36 코드는 폐기 대상이라 고치지 않는다), 사용자 말풍선 바탕 `bg-secondary` → 패널 안에서는 `bg-card` + 테두리(5.10) |
