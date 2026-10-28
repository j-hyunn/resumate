---
name: ui-implementation
description: "Guide for implementing Resumate screens in code: Next.js App Router + TypeScript + Tailwind + shadcn/ui, against a mock data layer typed from the data model. Covers the foundation (scaffold, design tokens in globals.css, L-01 dashboard shell, common components C-01~C-10, ST-xx state views, types/db.ts, lib/data + lib/mock, ?state= preview switch) and area screens (account S-01~S-03/S-24/S-25, career S-04/S-08~S-12/S-34~S-36, 기업 JD S-13~S-19/S-31, interview & board S-20/S-22/S-33/S-37/S-39). Use when building, coding, or fixing UI screens, pages, components, layouts, forms, the kanban board, AI chat/streaming/progress UI, or when applying screen-spec changes to code. Korean triggers: 화면 구현, UI 구현, 퍼블리싱, 컴포넌트 만들기, 페이지 만들기, 화면 코드, 프론트엔드 작업, UI 수정, 화면 버그 수정. Not for backend work (Supabase migrations, real Codex API calls) or for visual-system decisions (ui-design-system)."
---

# Implementing Resumate Screens

The goal: a screen whose every spec row is present, uses the data model's names, renders every state, and looks like the design system — so that wiring a real backend later changes the data layer, not the screens.

Read `.agents/skills/resumate-ui/references/ui-context.md` first (stack, layout, area ownership, data layer). For recurring UI mechanics (AI response modes, autosave, evidence chips, gates, the board), read `references/patterns.md` when your screens use them.

## Order of work (per area)

1. **Read the spec for your screens in full** — the S-xx sections, every C-xx they reference in 3.0, the flows (FL-xx) that pass through them, and the relevant rows of the feature ↔ screen matrix. List each screen's component rows; this list is your checklist and QA's.
2. **Check the types.** Every `entity.field` in those rows must exist in `src/types/db.ts`. Missing → request it from the foundation (don't add it locally).
3. **Routes first.** Create the route files and links for all your screens so navigation works end to end, then fill in screens. Broken links between areas are the most common integration bug.
4. **Build each screen:** Server Component page that loads through `src/lib/data/*` → client components only where interaction needs them → states → copy.
5. **States:** wire the `?state=` preview values your screens support (see ui-context.md) and make each render the right ST-xx view.
6. **Tell QA** each screen is ready as soon as it is (team mode), not at the end.
7. **Mechanical checks:** `pnpm lint && pnpm typecheck && pnpm build` must pass. Then write your report.

## Foundation (A0) specifics

Do these in order; A1–A4 can't start until the foundation passes QA.

1. **Scaffold** only if `package.json` doesn't exist: `pnpm create next-app@latest . --ts --tailwind --eslint --app --src-dir --import-alias "@/*"`, then `pnpm dlx shadcn@latest init`. Add a `typecheck` script (`tsc --noEmit`). The repository root already contains `docs/`, `_workspace/`, `.claude/`, `.codex/`, `.agents/` — the scaffold must not delete or move them; if the generator refuses a non-empty directory, scaffold into a temp folder and move the generated files in.
2. **Tokens:** copy the CSS variable block from `docs/ui/design-system.md` into `src/app/globals.css`; set fonts in the root layout. No component should need a raw color after this.
3. **Types:** write `src/types/db.ts` from `04-data-model.md` (section 2 + appendix A + enum CHECKs). Same table/column names, enum values as literal unions.
4. **Data layer + mocks:** `src/lib/data/` functions per entity/RPC, backed by `src/lib/mock/` fixtures that cover a realistic user (several experiences across years, an education, projects with complete and draft details, two or three application projects at different board stages, one interview session in progress). Include the fake AI module (patterns.md → "Fake AI").
5. **Shell (L-01):** left menu in the fixed order, active-menu rules, breadcrumb rules, badges, account/settings footer, narrow-screen top bar + drawer, global toast region.
6. **Common components:** C-01~C-10, ST-xx state views, usage hint ("이번 달 N회 남음 · 이 작업으로 k회 사용"), S-28 error page. Area-specific C-11~C-16 are built by their areas.
7. **`?state=` preview switch** as a small helper that pages call, active only in development.

## Domain implementation points

- **Copy is spec copy.** When the spec quotes Korean text, use it verbatim (placeholders like `{회사명 – 포지션명}` become interpolations). Paraphrasing breaks QA's comparison and the planning team's tone decisions.
- **Never auto-run AI.** Only JD requirement extraction runs automatically (UX-6). Everything else starts from a button that shows the usage hint beside it.
- **Draft vs complete.** Career items with missing required fields save as `status = 'draft'` and show C-06's draft note; drafts are excluded from AI evidence — reflect that wherever readiness or evidence is shown.
- **Input is never lost** (UX-7): forms, STAR details, cover-letter questions, and interview answer sheets autosave with C-06 status; AI chats resume where they left off.
- **Everything works without drag** (UX-8): every board move has a menu path (C-12) with keyboard support and a screen-reader announcement.
- **Return paths:** screens reached from the C-09 gate keep the return target and show the C-10 banner; returning restores the original screen's in-progress settings.

## Report template (Korean)

Write to `_workspace/ui/{phase}_frontend-engineer-{area}_report.md`:

```markdown
# {영역} 구현 보고
## 완료 화면 — | 화면 ID | 라우트 | 지원 ?state= | 비고 |
## 미완료 / 부분 구현 — 이유 포함
## [UI-가정] — | 화면 ID | 파일:줄 | 내용 |
## 기획 확인 필요 — | 화면 ID | 질문 | 스펙 위치 |
## 파운데이션 요청 — (공통 컴포넌트·타입·데이터 계층 변경 요청)
## 검사 결과 — lint / typecheck / build 결과와 실패 시 출력 요약
```

## Quality bar

- Every component row of every assigned S-xx is implemented or listed under 미완료 with a reason.
- No column name, enum value, or route appears in code that isn't in `types/db.ts` / the route tree.
- No hard-coded colors (`#hex`, `rgb()`, Tailwind palette classes like `bg-blue-500`); tokens only.
- Every interactive element is reachable and operable by keyboard and has an accessible name.
- lint, typecheck, and build pass.
