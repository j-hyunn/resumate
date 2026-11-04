---
name: ui-design-system
description: "Guide for writing and revising the Resumate visual design system (docs/ui/design-system.md): design tokens as shadcn/ui CSS variables (color, type, spacing, radius, elevation, motion, light/dark), the shadcn component inventory, visual patterns for common components C-xx and states ST-xx (evidence chips, AI progress, streaming, AI lock and provider errors, data-insufficient gate, Resumate AI panel and proposal cards), layout patterns (L-01 sidebar shell, L-02 full-page shell, editor, chat, kanban board, narrow-screen drawer), and per-area visual notes. Also covers user-specified brand tokens and Figma ↔ design-system sync. Use for design systems, design tokens, color palettes, typography, theme, dark mode, component styling, visual consistency, and design-system revisions. Korean triggers: 디자인 시스템, 디자인 토큰, 컬러 팔레트, 타이포그래피, 테마, 다크 모드, 컴포넌트 스타일, 시각 일관성, 디자인 수정. Not for screen structure or flows (ux-flow-spec) or for writing screen code (ui-implementation)."
---

# Resumate Design System

The goal: several engineers, building different areas in parallel, can each read only this document and produce screens that look like one product. Every rule must be concrete enough to apply without asking — a token, a class pattern, or a named shadcn variant.

## Order of work

1. Read the existing `docs/ui/design-system.md` first — it exists (v5+), and engineers already use its token and pattern names. Revisions change only what the brief asks for.
2. Read `docs/planning/02-user-flows.md` sections 0 (principles), the shell parts of section 1 (L-01, L-02), and 3.0 (common components and states) in full. These are the parts every screen shares, so they shape the system more than any single screen does.
3. Skim the screens in this run's brief and a few dense ones (S-08 career list+detail, S-10 project detail with the AI panel, S-19 draft editor, S-39 board) to learn the real density and content types.
4. Brand tokens set by the user (design system v4) are fixed inputs: map them, don't redesign them. If the user gave Figma nodes, read them (see "Figma" below) and derive values from them rather than inventing them.
5. Write or revise tokens → component inventory → common-component patterns → layout patterns → per-area notes, and add a change-log line with the planning versions each section is based on (sections can lag — say which).

## Domain design points

- **Long Korean text is the main content.** STAR fields, drafts, interview answers. Choose a Korean-first font stack (e.g. Pretendard with system fallbacks), body line-height around 1.6–1.7, comfortable measure for editors (~40–45 Korean characters per line ≈ 680–760px), and no letter-spacing tightening on Hangul.
- **AI state must be unmistakable.** Users wait seconds to tens of seconds and must know whether something is running, streaming, partially done, failed (and why — the 7 provider causes of C-20, such as rate limit, daily limit, billing, invalid key), locked because no key is connected (C-18), waiting for data-use consent (C-21), or blocked by insufficient data (C-09). Give each a distinct, consistent treatment. There are no service usage limits or "N회 남음" in this product (BYOK).
- **The Resumate AI panel** (S-10, S-44) is a chat beside an editable page: proposal cards with [반영], source-utterance chips (C-15), the conversation list, and a resizable divider. Its thread uses the shadcn Chat components; define the card and chip styles on top of them rather than a separate chat look.
- **Evidence is the trust mechanism.** C-01 evidence chips appear inside running text, tables, and cards. Design one compact chip with three statuses (정상 / 변경됨 / 원본 삭제됨) that stays readable inline, and make "회고 및 배운 점" chips distinguishable by label only (spec rule, no extra marker).
- **Review states on AI-structured data** (C-15: 출처 있음 / 직접 수정 / 검토 필요 / 아직 없음) need color + icon + text, never color alone.
- **Calm, dense, professional.** Target users are experienced job changers doing serious work. Prefer neutral surfaces, the user-specified brand colors, and semantic colors reserved for state (success/warning/destructive/info). Avoid decorative gradients and illustration-heavy empty states.
- **Desktop first, mobile complete** (UX-9): define the breakpoint where L-01 collapses to a top bar + drawer, and how the board becomes column tabs (T-8).
- **Accessibility:** WCAG 2.2 AA contrast for text and state colors in both themes, visible focus rings, 44px minimum touch targets on narrow screens.

## shadcn/ui mapping

Prefer composing shadcn primitives over custom components. For each C-xx, name the primitives and variants it is built from, e.g. C-01 evidence chip → `Badge` (custom `evidence` variant) + `Tooltip`; C-02 evidence panel → `Sheet` (side=right); C-05 delete dialog → `AlertDialog` + `RadioGroup`; C-03 AI progress → `Progress` + step list; toasts → `Sonner`. If a pattern genuinely needs a new component, define it once here so it isn't reinvented per area.

## Document template

Write the document in Korean; translate the headings below. Keep token names, class names, and component names in English.

```markdown
# Resumate 디자인 시스템 v{N}

## 0. 원칙 (3–5 lines)
## 1. 토큰
### 1.1 색 — shadcn CSS 변수 (light / dark 표: --background, --foreground, --primary, --muted, --accent, --destructive, --border, --ring, + 상태용 --success, --warning, --info, + AI 상태용 변수)
### 1.2 타이포그래피 — 폰트 스택, 스케일(이름 · 크기 · 행간 · 굵기 · 용도)
### 1.3 간격 · 반경 · 그림자 · 모션
### 1.4 브레이크포인트와 레이아웃 폭
## 2. 컴포넌트 인벤토리 — 사용하는 shadcn 컴포넌트와 커스텀 variant
## 3. 공통 컴포넌트 패턴 — 화면 명세의 모든 C-xx 각각: 구성 primitive · 시각 규칙 · 상태별 모습 · Tailwind 클래스 예시
## 4. 상태 패턴 — ST-xx 각각: 아이콘 · 색 · 레이아웃 · 문구 위치
## 5. 레이아웃 패턴 — L-01 셸·L-02 전체 페이지 셸(넓은/좁은 화면), AI 패널, 목록·상세, 편집기, 대화, 보드, 모달·시트
## 6. 영역별 메모 — A1 계정 / A2 커리어 / A3 자기소개서 관리 / A4 면접·보드
## 7. 접근성 체크 기준
## 8. [가정] · 기획 확인 필요
## 9. 변경 이력
```

Express tokens as the actual CSS variable block for `globals.css` (HSL or OKLCH, matching the shadcn version the foundation scaffolds) so the foundation engineer can copy it verbatim — a description like "soft blue" leaves room for drift.

## Figma

The user designs new screens in Figma (file `GagTxDayknEFEa6qdSqQCc` so far; the brief names the nodes). When a brief has Figma nodes, they are the source for layout and visual values:

- **Figma → design system:** load the `figma:figma-design-to-code` skill before calling `get_design_context`; also use `get_variable_defs` for variables and `get_screenshot` to see the frame. Map Figma variables to existing token names and record file/node per section.
- **Product decisions in Figma are not yours.** Where a frame differs from the screen spec in structure, fields, or copy, the planning documents win; list the difference as `기획 확인 필요` (planning settles it — earlier cycles turned such diffs into decisions like CR-x / PA-x).
- **Code → Figma:** when asked to show implemented screens in Figma, load `figma:figma-generate-design` (and `figma:figma-use`) and build from the implemented screens using the token names here.
- If Figma reads fail (rate limit, access), stop and tell the leader so they can get screenshots or values from the user. Don't fill in sizes and colors from someone's description — note what you couldn't read in your notes file.

## Quality bar

- Every C-xx and ST-xx in the screen spec has a pattern entry. A missing entry means each engineer invents one.
- Every color is a token; every token has light and dark values; every text/background pair used for state passes AA.
- No pattern requires a library outside the settled stack (`ui-context.md`).
- Token and pattern names never change once engineers use them; renames list all usages to migrate.
