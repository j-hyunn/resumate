---
name: ui-design-system
description: "Guide for writing and revising the Resumate visual design system (docs/ui/design-system.md): design tokens as shadcn/ui CSS variables (color, type, spacing, radius, elevation, motion, light/dark), the shadcn component inventory, visual patterns for common components C-01~C-16 and states ST-xx (evidence chips, AI progress, streaming, data-insufficient gate), layout patterns (L-01 dashboard shell, editor, chat, kanban board, narrow-screen drawer), and per-area visual notes. Also covers Figma ↔ design-system sync. Use for design systems, design tokens, color palettes, typography, theme, dark mode, component styling, visual consistency, and design-system revisions. Korean triggers: 디자인 시스템, 디자인 토큰, 컬러 팔레트, 타이포그래피, 테마, 다크 모드, 컴포넌트 스타일, 시각 일관성, 디자인 수정. Not for screen structure or flows (ux-flow-spec) or for writing screen code (ui-implementation)."
---

# Resumate Design System

The goal: several engineers, building different areas in parallel, can each read only this document and produce screens that look like one product. Every rule must be concrete enough to apply without asking — a token, a class pattern, or a named shadcn variant.

## Order of work

1. Read `docs/planning/02-user-flows.md` sections 0 (principles), 1.3 (L-01 shell), and 3.0 (common components and states) in full. These are the parts every screen shares, so they shape the system more than any single screen does.
2. Skim the screen list (1.2) and a few dense screens (S-08 career tree, S-19 draft editor, S-36 AI chat, S-39 board) to learn the real density and content types.
3. If the user gave a Figma URL, read it first (see "Figma" below) and derive tokens from it rather than inventing them.
4. Write tokens → component inventory → common-component patterns → layout patterns → per-area notes.

## Domain design points

- **Long Korean text is the main content.** STAR fields, drafts, interview answers. Choose a Korean-first font stack (e.g. Pretendard with system fallbacks), body line-height around 1.6–1.7, comfortable measure for editors (~40–45 Korean characters per line ≈ 680–760px), and no letter-spacing tightening on Hangul.
- **AI state must be unmistakable.** Users wait seconds to tens of seconds and must know whether something is running, streaming, partially done, failed (and that usage wasn't charged), or blocked by limits. Give ST-AI-PENDING / STREAM / FAILED, ST-LIMIT, and ST-INSUFFICIENT distinct, consistent treatments.
- **Evidence is the trust mechanism.** C-01 evidence chips appear inside running text, tables, and cards. Design one compact chip with three statuses (정상 / 변경됨 / 원본 삭제됨) that stays readable inline, and make "회고 및 배운 점" chips distinguishable by label only (spec rule, no extra marker).
- **Review states on AI-structured data** (C-15: 출처 있음 / 직접 수정 / 검토 필요 / 아직 없음) need color + icon + text, never color alone.
- **Calm, dense, professional.** Target users are experienced job changers doing serious work. Prefer neutral surfaces, one accent color, and semantic colors reserved for state (success/warning/destructive/info). Avoid decorative gradients and illustration-heavy empty states.
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
## 3. 공통 컴포넌트 패턴 — C-01 ~ C-16 각각: 구성 primitive · 시각 규칙 · 상태별 모습 · Tailwind 클래스 예시
## 4. 상태 패턴 — ST-xx 각각: 아이콘 · 색 · 레이아웃 · 문구 위치
## 5. 레이아웃 패턴 — L-01 셸(넓은/좁은 화면), 목록·상세, 편집기, 대화, 보드, 모달·시트
## 6. 영역별 메모 — A1 계정 / A2 커리어 / A3 기업 JD / A4 면접·보드
## 7. 접근성 체크 기준
## 8. [가정] · 기획 확인 필요
## 9. 변경 이력
```

Express tokens as the actual CSS variable block for `globals.css` (HSL or OKLCH, matching the shadcn version the foundation scaffolds) so the foundation engineer can copy it verbatim — a description like "soft blue" leaves room for drift.

## Figma (optional)

Figma is used only when the user provides a file or asks for it:

- **Figma → design system:** with a figma.com URL, load the `figma:figma-design-to-code` skill before calling `get_design_context`; also use `get_variable_defs` for variables. Map Figma variables to the token names above and record the file/node in section 8.
- **Code → Figma:** when asked to show implemented screens in Figma, load `figma:figma-generate-design` (and `figma:figma-use`) and build from the implemented screens using the token names here.
- If Figma tools are unavailable, continue from the spec and say so in `_workspace/ui/01_ui-designer_notes.md`.

## Quality bar

- Every C-xx and ST-xx in the screen spec has a pattern entry. A missing entry means each engineer invents one.
- Every color is a token; every token has light and dark values; every text/background pair used for state passes AA.
- No pattern requires a library outside the settled stack (`ui-context.md`).
- Token and pattern names never change once engineers use them; renames list all usages to migrate.
