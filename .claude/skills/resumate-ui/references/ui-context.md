# Resumate UI Context (shared reference for the UI team)

Every UI agent reads this file before starting work. What is written here is **settled**; change it only through the leader, and log the change in `.claude/harness/CHANGELOG.md`.

## Sources of truth

The UI team implements decisions; it does not make product decisions. When the UI needs something these documents don't settle, raise it (see "Gaps" below) instead of inventing behavior.

| Question | Source |
|----------|--------|
| Which screens exist, what each shows/accepts, states, copy | `docs/planning/02-user-flows.md` (screen IDs `S-xx`, shell `L-01`, common components `C-xx`, states `ST-xx`) |
| Field, table, enum, RPC names | `docs/planning/04-data-model.md` |
| AI response modes, progress stages, output shapes | `docs/planning/03-ai-features.md` (esp. C-6 response modes) |
| Feature IDs, MVP scope, priorities | `docs/planning/01-prd.md` |
| Settled user decisions | `docs/planning/decisions.md` |
| Visual language (tokens, components, layout) | `docs/ui/design-system.md` (owned by ui-designer) |
| Implementation progress per screen | `docs/ui/screen-status.md` (owned by the leader) |

Product context for the whole service: `.claude/skills/resumate-planning/references/product-context.md`.

## Tech stack (settled)

| Area | Choice |
|------|--------|
| Framework | Next.js (App Router, TypeScript strict), deployed to Vercel |
| Styling | Tailwind CSS + shadcn/ui (components copied into the repo, themed through CSS variables) |
| Icons | lucide-react (shadcn default) |
| Forms | react-hook-form + zod (shadcn `Form`) |
| Board drag & drop | dnd-kit (keyboard sensor required — UX-8) |
| Package manager | pnpm |
| Backend | **Not in scope yet.** Supabase and Claude calls are mocked behind a data layer (below) |

Don't add other UI libraries without the leader's approval; every new dependency is something the team must keep consistent.

## Repository layout

The app lives at the repository root, with source under `src/`:

```
src/
  app/
    (public)/            S-01 landing, S-02 sign-in, S-03 consent, S-30 policies
    (dashboard)/         L-01 shell layout + every signed-in screen
      career/            area A2
      applications/      area A3 (메뉴: 기업 JD 관리)
        [id]/interview/  area A4 (S-20, S-33, S-22 — nested under the application project, owned by A4)
      interviews/        area A4 (S-37)
      board/             area A4 (S-39)
      settings/          area A1 (S-24, S-25)
  components/
    ui/                  shadcn primitives (generated; edit only to theme)
    common/              cross-area C-xx components and ST-xx state views (foundation owns)
    career/ applications/ interviews/ board/ account/   area-specific components
  lib/
    data/                data layer interface (read/write functions per entity)
    mock/                fixtures + fake AI (streaming, async job progress, failures)
    utils.ts
  types/
    db.ts                row types mirroring 04-data-model.md table/column names exactly
docs/ui/                 design-system.md, screen-status.md
```

## Areas and ownership

Screens are built in areas. Each area has one owner per run, and an owner only edits files inside its area's folders. Cross-area files (`components/common/`, `components/ui/`, `types/db.ts`, `lib/data/`, `lib/mock/`, the shell layout) belong to the foundation; an area owner who needs a change there asks the leader (or the foundation owner in team mode) instead of editing directly. This rule is what lets areas be built in parallel without overwriting each other.

| Area | Screens | Area-specific components |
|------|---------|--------------------------|
| A0 Foundation | L-01 shell, S-28 error, common C-01~C-10, ST-* state views, usage hint, data layer, `types/db.ts` | — |
| A1 Account | S-01, S-02, S-03, S-24, S-25, S-30 | — |
| A2 Career | S-04, S-08, S-09, S-10, S-11, S-12, S-34, S-35, S-36 | C-15 source-utterance chip |
| A3 Applications | S-13, S-14, S-31, S-15, S-16, S-17, S-18, S-19 | C-11 sources used |
| A4 Interview & board | S-20, S-33, S-22, S-37, S-39 | C-12 stage menu, C-13 outcome dialog, C-14 interview popup, C-16 JD picker |

A0 must be done (and pass QA) before A1–A4 start. A1–A4 are independent of each other and can run in parallel.

## Data layer (mock-first)

There is no backend yet, but the UI must be ready to swap one in without rewriting screens:

- `src/types/db.ts` mirrors the data model **verbatim**: table names → `PascalCase` row types (`experiences` → `Experience`), column names unchanged in snake_case, enums as string-literal unions with the exact values from the data model. When `supabase gen types` exists later, this file is replaced, so don't add UI-only fields here — put view models next to the component.
- Screens read through `src/lib/data/*` functions (e.g. `getCareerTree()`, `getApplicationProject(id)`, `getDataReadiness()`) and write through server actions that call `src/lib/data/*`. Name functions after the RPCs/tables in the data model where one exists.
- `src/lib/mock/` holds fixtures and a fake AI module that simulates every response mode from the AI spec: sync, async job with `ai_jobs.progress.stage` updates, streaming, and failures by `error_category`.
- **State preview switch:** in development, any screen accepts `?state=` (`empty`, `loading`, `error`, `ai-pending`, `ai-stream`, `ai-failed`, `limit`, `insufficient`, …) so every ST-xx state can be rendered and checked without contriving data. QA and the leader rely on this.

## UI copy

All user-facing text is Korean and comes from the screen spec verbatim when the spec gives it. Keep IDs, identifiers, and code comments in English.

## Gaps

When a spec is missing, ambiguous, or contradicts another document:

1. Implement the most conservative reading and mark it in code with `// [UI-가정] <one line>` so it can be found later.
2. Record it in the run's report under "기획 확인 필요" with the screen ID.
3. The leader relays these to the user; anything that needs a planning change goes to the `resumate-planning` harness, not to the UI team.

## Output language

Agent definitions and skills are English. Reports in `_workspace/ui/` and documents in `docs/ui/` are written in **Korean**. UI copy is Korean.
