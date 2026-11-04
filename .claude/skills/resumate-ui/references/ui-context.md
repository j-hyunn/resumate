# Resumate UI Context (shared reference for the UI team)

Every UI agent reads this file before starting work. What is written here is **settled**; change it only through the leader, and log the change in `.claude/harness/CHANGELOG.md`.

## Sources of truth

The UI team implements decisions; it does not make product decisions. When the UI needs something these documents don't settle, raise it (see "Gaps" below) instead of inventing behavior.

| Question | Source |
|----------|--------|
| Which screens exist, what each shows/accepts, states, copy | `docs/planning/02-user-flows.md` (screen IDs `S-xx`, shells `L-01`/`L-02`, common components `C-xx`, states `ST-xx`). Section 1 lists screens; many old IDs are marked 폐기 — never build a 폐기 screen, only its redirect |
| Field, table, enum, RPC names | `docs/planning/04-data-model.md` (for what the code actually has: `src/server/db/database.types.ts`, generated) |
| AI response modes, progress stages, output shapes, provider rules | `docs/planning/03-ai-features.md` (esp. C-6 response modes, C-10 providers, C-11 error causes) |
| Feature IDs, MVP scope, priorities | `docs/planning/01-prd.md` |
| Settled user decisions, and UI follow-ups owed after each planning cycle | `docs/planning/decisions.md` (section 4 lists "백엔드·UI 후속" per cycle) |
| Visual language (tokens, components, layout) | `docs/ui/design-system.md` (owned by ui-designer) |
| Implementation progress per screen | `docs/ui/screen-status.md` (owned by the leader) |
| Server contracts the screens call (actions, SSE events, error codes) | `src/lib/contracts/` and `src/server/actions/` (backend-owned, read only for the UI team) |

Product context for the whole service: `.claude/skills/resumate-planning/references/product-context.md`.

## Product shape the UI must know

- **BYOK.** AI runs on the user's own key for one active provider (OpenAI / Gemini / Claude). There are no service usage limits, no "N회 남음", no "사용량이 차감되지 않았습니다". Failures are shown by the 7 provider error causes (AI spec C-11, UX C-20); the usage meter (S-42) shows tokens and estimated cost only.
- **Menu (L-01, fixed order):** 커리어 / 자기소개서 관리 / 모의 면접 / 지원 현황. Sign-in lands on 커리어. Inside 자기소개서 관리, an application project is called **"자기소개서"** on screen (CR-23). Code folders still use `applications/` — routes don't follow menu labels.
- **Career (v5.5+):** S-08 is a two-column list (by start year) + detail. Project detail (S-10) and deliverable detail (S-44) are full pages in the L-02 shell with a "Resumate AI" side panel and page-level "저장하기" — [반영] only fills the form. S-11 정량 성과, S-35 상세 내용, S-36 AI 작성 대화 are 폐기 (redirects only).
- **Settings (S-24)** is a dialog only (shadcn sidebar-13), opened from the shell or by URL `?settings={section}[&provider=]`. There is no settings page except `/settings/withdraw` (S-25) and the focus screen `/settings/ai/connect` (S-41).

## Tech stack (settled)

| Area | Choice |
|------|--------|
| Framework | Next.js 16 (App Router, TypeScript strict, React 19), deployed to Vercel. Session refresh lives in `src/proxy.ts` (not `middleware.ts`) |
| Styling | Tailwind CSS v4 + shadcn/ui (components copied into `src/components/ui/`, themed through CSS variables in `globals.css`) |
| Icons | lucide-react |
| Forms | react-hook-form + zod 4 (shadcn `Field`) |
| AI chat threads | shadcn Chat components (`@shadcn/react` + `components/ui/message*.tsx`, `bubble.tsx`) — the Resumate AI panel thread is built on these, not hand-rolled |
| Toasts / command menu | sonner / cmdk |
| Board drag & drop | dnd-kit (keyboard sensor required — UX-8) |
| Package manager | pnpm (`pnpm dev`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (Vitest), `pnpm build`) |
| Backend | **Wired.** Supabase, Server Actions, Route Handlers (SSE), and AI provider calls exist and are owned by the backend harness (`resumate-backend`). Screens reach them only through `src/lib/data/*` (below) |

Don't add other UI libraries without the leader's approval; every new dependency is something the team must keep consistent.

## Repository layout

The app lives at the repository root, with source under `src/`. Route groups decide the shell:

```
src/
  app/
    (public)/              S-01 landing, S-02 sign-in, S-03 consent, S-30 policies, withdraw finalize
    (dashboard)/           L-01 sidebar shell (sidebar-08 inset, icon rail when collapsed)
      (gated)/             signed-in screens behind the consent gate
        career/            A2 — S-08 list+detail, S-04, S-09, S-34, S-12 (+ redirects of 폐기 screens)
        applications/      A3 (menu 자기소개서 관리) — S-13, S-14, S-31, S-15, S-16, S-17~S-19
          [id]/interview/  A4 — S-20, S-33, S-22 (nested under the application project)
        interviews/        A4 — S-37
        board/             A4 — S-39
      settings/withdraw/   A1 — S-25
      dev/states           state gallery (development only)
    (page)/                L-02 full-page shell (logo · [Resumate AI] · 저장하기 · account; no sidebar)
      (gated)/career/projects/**      A2 — S-10 project detail, new deliverable
      (gated)/career/deliverables/**  A2 — S-44 deliverable detail
      dev/page-shell       L-02 demo (development only)
    (focus)/               focus screens outside any shell — S-41 AI connect (`settings/ai/connect`)
    api/, auth/            backend-owned (Route Handlers, auth callback)
  components/
    ui/                    shadcn primitives (generated; edit only to theme)
    common/                cross-area C-xx components and ST-xx state views (foundation owns)
      shell/               L-01 / L-02 parts, settings dialog (foundation owns)
    career/ applications/ interviews/ board/ account/   area-specific components
  lib/
    data/                  data layer: the only module screens import for reads/writes (see "Data layer")
    mock/                  fixtures + fake AI, used by previews and tests only
    contracts/             backend-owned zod contracts, SSE event types, error codes (read only)
    routes.ts              route builders — every href goes through these
  server/                  backend-owned (actions, services, ai, jobs, keys, db)
  types/
    db.ts                  row types screens import (built on the generated types, see below)
docs/ui/                   design-system.md, screen-status.md
```

File ownership between the UI and backend harnesses: `.claude/skills/resumate-backend/references/backend-context.md` → "Coexisting with the UI harness".

## Areas and ownership

Screens are built in areas. Each area has one owner per run, and an owner only edits files inside its area's folders. Cross-area files (`components/common/` incl. `shell/`, `components/ui/`, `types/db.ts`, `lib/data/` shared helpers such as `source.ts`, `lib/mock/`, `lib/routes.ts`, the shell layouts) belong to the foundation; an area owner who needs a change there asks the leader (or the foundation owner in team mode) instead of editing directly. This rule is what lets areas be built in parallel without overwriting each other.

| Area | Screens | Area-specific components |
|------|---------|--------------------------|
| A0 Foundation | L-01 shell, L-02 page shell, S-28 error, settings dialog frame, common C-01~C-10, C-12~C-14 (board stage menu, outcome dialog, interview popup), C-17 score display, C-18~C-21 (AI lock, provider badge, AI error notice, data-use consent), the AI run button, ST-* state views, data layer helpers, `types/db.ts`, `lib/routes.ts` | — |
| A1 Account | S-01, S-02, S-03, S-24 (dialog sections), S-25, S-30, S-40~S-42 (AI connection, connect focus screen, usage meter) | — |
| A2 Career | S-04, S-08, S-09, S-34, S-10, S-12, S-43 (독립 프로젝트), S-44 | C-15 source-utterance chip, C-22~C-25 career add/edit pieces, Resumate AI panel |
| A3 Applications (자기소개서 관리) | S-13, S-14, S-31, S-15, S-16, S-17, S-18, S-19 | C-11 sources used |
| A4 Interview & board | S-20, S-33, S-22, S-37, S-39 | C-16 자기소개서 picker dialog |

The screen list grows with the planning documents; when `02-user-flows.md` adds an ID, the leader assigns it to an area in the run brief and updates this table. A0 must be done (and pass QA) before A1–A4 start. A1–A4 are independent of each other and can run in parallel.

## Data layer (wired, preview-safe)

The data layer is connected to the real backend. Screens never call Server Actions, Supabase, or `fetch` to `/api` directly; they go through `src/lib/data/*`, which keeps two branches per function:

```ts
export async function getThing(id: string): Promise<Thing> {
  return previewOr(
    async () => { const db = await mockRequest(); return clone(db.things.find(...)) }, // preview / tests: mock store
    async () => toThing(unwrap(await thingActions.get({ id }))),                       // real: Server Action
  )
}
```

- `previewOr`, `unwrap`, `refusalOf` live in `src/lib/data/source.ts`. A `?state=` or `/dev/` request takes the mock branch for reads **and writes**; real rows are never touched by previews. `mock-isolation.test.ts` fails if a mock store call escapes `previewOr` — keep it green.
- **New or changed data function:** write both branches. The real branch calls an existing Server Action from `src/server/actions/` (or the SSE/job client in `lib/data/ai-*`). Map 409 refusal codes with `refusalOf`; never swallow an error code the screen spec handles.
- **Backend contract missing** (the planning docs changed but the backend slice hasn't landed): implement the mock branch, make the real branch throw or return the documented "not supported" result, mark it `// 연결 대기 (<doc section>)`, and list it in your report under "백엔드 요청". The leader forwards these to `_workspace/backend/spec-gaps.md` / the backend harness. Don't edit `src/server/`, `src/app/api/`, or `src/lib/contracts/` — that's backend code.
- **`src/types/db.ts`** is built on the generated `database.types.ts` via `Row<table, overrides, hidden>`: table name → singular `PascalCase`, column names unchanged in snake_case, overrides only where generated types can't express the spec (CHECK enums as string-literal unions, jsonb shapes). Don't add UI-only fields to row types — put view models below them or next to the component. When the data model adds a column that the generated types don't have yet, that's a backend contract gap (above), not a hand-written field.
- `src/lib/mock/` holds fixtures and a fake AI module that simulates every response mode from the AI spec (sync, async job with `ai_jobs.progress.stage`, streaming, failures by the 7 error causes). It serves previews, the state gallery, and tests; it must stay in step with the real shapes.
- **State preview switch:** in development, any screen accepts `?state=` (`empty`, `loading`, `error`, `ai-pending`, `ai-stream`, `ai-failed`, `insufficient`, `locked`, `key-missing`, …, plus screen-specific values recorded at the top of `screen-status.md`) so every ST-xx state can be rendered without contriving data. It is disabled in production builds.

## UI copy

All user-facing text is Korean and comes from the screen spec verbatim when the spec gives it. Keep IDs, identifiers, and code comments in English.

## Gaps

When a spec is missing, ambiguous, or contradicts another document:

1. Implement the most conservative reading and mark it in code with `// [UI-가정] <one line>` so it can be found later.
2. Record it in the run's report under "기획 확인 필요" with the screen ID.
3. The leader relays these to the user; anything that needs a planning change goes to the `resumate-planning` harness, not to the UI team.

Backend gaps (a contract the screen needs doesn't exist or returns a different shape) are not planning gaps: they go under "백엔드 요청" (see "Data layer").

## Verification standard

"QA 통과" means checked against the spec **and** seen working: lint, typecheck, test, build, plus opening the screen in a browser against the real backend (and `?state=` previews for states that real data can't easily produce). A screen checked only by reading code or by mock SSR is recorded as `QA 통과 (mock·브라우저 미확인)`, never as plain `QA 통과`, so the gap stays visible in `screen-status.md`.

## Output language

Agent definitions and skills are English. Reports in `_workspace/ui/` and documents in `docs/ui/` are written in **Korean**. UI copy is Korean.
