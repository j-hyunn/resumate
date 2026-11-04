---
name: ui-implementation
description: "Guide for implementing Resumate screens in code: Next.js App Router + TypeScript + Tailwind + shadcn/ui, reading and writing through the src/lib/data layer (real Server Actions, mock branch for ?state= previews). Covers the foundation (design tokens in globals.css, L-01 sidebar shell, L-02 full-page shell, settings dialog, common C-xx components, ST-xx state views, types/db.ts on generated types, data-layer helpers, ?state= preview switch) and area screens (account S-01~S-03/S-24/S-25/S-40~S-42, career S-04/S-08/S-09/S-10/S-12/S-34/S-43/S-44, 자기소개서 관리 S-13~S-19/S-31, interview & board S-20/S-22/S-33/S-37/S-39). Use when building, coding, or fixing UI screens, pages, components, layouts, forms, the kanban board, the Resumate AI panel, AI chat/streaming/progress UI, or when applying screen-spec changes to code. Korean triggers: 화면 구현, UI 구현, 퍼블리싱, 컴포넌트 만들기, 페이지 만들기, 화면 코드, 프론트엔드 작업, UI 수정, 화면 버그 수정, AI 패널 구현. Not for backend work (migrations, Server Actions, Route Handlers, AI provider calls — resumate-backend) or for visual-system decisions (ui-design-system)."
---

# Implementing Resumate Screens

The goal: a screen whose every spec row is present, uses the data model's names, renders every state, works against the real backend, and looks like the design system.

Read `.agents/skills/resumate-ui/references/ui-context.md` first (stack, layout, area ownership, data layer, verification standard). For recurring UI mechanics (AI response modes, autosave, evidence chips, gates, the board), read `references/patterns.md` when your screens use them.

## Order of work (per area)

1. **Read the spec for your screens in full** — the S-xx sections, every C-xx they reference in 3.0, the flows (FL-xx) that pass through them, and the relevant rows of the feature ↔ screen matrix. List each screen's component rows; this list is your checklist and QA's.
2. **Check the types and contracts.** Every `entity.field` in those rows must exist in `src/types/db.ts`; every write the screen does needs a data function whose real branch calls an existing Server Action (`src/server/actions/`) or job/SSE client. Missing type field → request it from the foundation. Missing backend contract → `연결 대기` (ui-context.md → "Data layer"), listed under 백엔드 요청.
3. **Routes first.** Add the route files in the right route group (`(dashboard)/(gated)`, `(page)/(gated)`, `(focus)`, `(public)`), add builders to `src/lib/routes.ts` (via the foundation), and link through them, so navigation works end to end before screens are filled in. Broken links between areas are the most common integration bug. A 폐기 screen keeps only a redirect.
4. **Build each screen:** Server Component page that loads through `src/lib/data/*` → client components only where interaction needs them → states → copy.
5. **States:** wire the `?state=` preview values your screens support (see ui-context.md) and make each render the right ST-xx / C-20 view.
6. **Tell QA** each screen is ready as soon as it is (team mode), not at the end.
7. **Checks:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` must pass (`mock-isolation.test.ts` included). Then open your screens in the dev server against the local backend if you have a browser tool, and write your report — say plainly whether you clicked through or not.

## Foundation (A0) specifics

The app, tokens, shells, and data layer already exist. A foundation run changes them; it doesn't rebuild them. Do the parts the brief asks for, in this order, since areas depend on them:

1. **Tokens:** when the design system's token block changes, copy it into `src/app/globals.css` verbatim (brand tokens are user-specified — don't "improve" them). No component should need a raw color.
2. **Types:** `src/types/db.ts` re-exports generated rows (`src/server/db/database.types.ts`) through `Row<table, overrides, hidden>`. When the data model changes, check whether the backend has regenerated the types; if not, the new fields are a backend contract gap, not something to hand-write.
3. **Data layer helpers:** shared pieces in `src/lib/data/` (`source.ts`, AI stream/job clients, readiness, guards) and `src/lib/mock/` fixtures that cover a realistic user (experiences across years, an education, projects with and without STAR, an independent project with deliverables, application projects at different board stages, an interview in progress). Keep the fake AI module (patterns.md → "Fake AI") in step with the real SSE events in `src/lib/contracts/`.
4. **Shells:** L-01 (sidebar-08, menu 커리어 / 자기소개서 관리 / 모의 면접 / 지원 현황, NavAiStatus, account footer, settings dialog, narrow-screen drawer, toast region) and L-02 (full page: logo, [Resumate AI] toggle, 저장하기, account, breadcrumb line, leave confirmation and input preservation, outage banner).
5. **Common components:** the C-xx and ST-xx assigned to A0 in ui-context.md, S-28 error page. AI buttons show the provider badge and lock state, never a usage count. Area-specific components are built by their areas.
6. **Routes and preview:** `src/lib/routes.ts` builders for every new route; the `?state=` helper stays development-only.

## Domain implementation points

- **Copy is spec copy.** When the spec quotes Korean text, use it verbatim (placeholders like `{회사명 – 포지션명}` become interpolations). Paraphrasing breaks QA's comparison and the planning team's tone decisions.
- **Never auto-run AI.** Only JD requirement extraction runs automatically (UX-6). Everything else starts from a button; with no usable key the button shows the C-18 lock instead of running.
- **Draft vs complete.** Career items with missing required fields save as `status = 'draft'` and show C-06's draft note; drafts are excluded from AI evidence — reflect that wherever readiness or evidence is shown.
- **Saving follows the screen's model** (check the spec, it differs per screen): S-10 and S-44 save the whole page with "저장하기" and AI [반영] only fills the form; S-08 detail sections save per section (C-24) or via the career add/edit modal; other forms autosave with C-06 status. Input is never lost (UX-7): leaving a dirty page asks first, and AI chats resume from the conversation list.
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
## 파운데이션 요청 — (공통 컴포넌트·타입·데이터 계층·라우트 변경 요청)
## 백엔드 요청 — | 화면 ID | 데이터 함수 | 필요한 계약 (문서 위치) | (연결 대기로 둔 것)
## 검사 결과 — lint / typecheck / test / build 결과와 실패 시 출력 요약, 브라우저 확인 여부(확인한 화면·동작)
```

## Quality bar

- Every component row of every assigned S-xx is implemented or listed under 미완료 with a reason.
- No column name, enum value, or route appears in code that isn't in `types/db.ts` / the route tree.
- No hard-coded colors (`#hex`, `rgb()`, Tailwind palette classes like `bg-blue-500`); tokens only.
- Every interactive element is reachable and operable by keyboard and has an accessible name.
- Screens import data only from `src/lib/data/*`; every data function has a preview branch and a real (or explicitly `연결 대기`) branch.
- lint, typecheck, test, and build pass.
