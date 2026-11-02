# Resumate Backend Context (shared reference for the backend team)

Every backend agent reads this file before starting work. What is written here is **settled** for implementation; anything not here comes from the planning documents.

## Source of truth

The planning documents in `docs/planning/` are the spec. Implement what they say; don't redesign.

| Need | Read |
|------|------|
| Feature IDs, MVP scope, limits, NFRs | `docs/planning/01-prd.md` |
| Screens that call the API, states (empty / loading / error) | `docs/planning/02-user-flows.md` |
| AI inputs, output schemas, evidence validation (C-3), response modes (C-6), costs | `docs/planning/03-ai-features.md` |
| Tables, columns, CHECK values, RLS matrix, RPCs, API boundary (7장) | `docs/planning/04-data-model.md` |
| Settled decisions and open `[가정]` | `docs/planning/decisions.md` |

Read only the sections the current slice needs (use `grep -n "^#"` to find them). The documents are long.

### When the spec is wrong or silent
- **Silent on a detail** (index name, helper function shape): decide, and note it in the slice's implementation notes.
- **Contradiction, gap, or something that would change behavior the user sees**: don't edit `docs/planning/`. Append it to `_workspace/backend/spec-gaps.md` (date, slice, doc + section, what's wrong, what you did meanwhile, tagged `[가정]`) and tell the leader. The leader reports these to the user, who can fix the docs with the `resumate-planning` harness.

## Tech stack

| Area | Choice |
|------|--------|
| App | Next.js (App Router) + TypeScript (strict) on Vercel |
| Package manager | pnpm |
| DB / Auth / Storage | Supabase (Postgres, Auth, RLS). Local stack via Supabase CLI |
| Auth methods | Magic link + Google (D-09) |
| Validation | zod (request bodies, AI outputs, env) |
| LLM | Anthropic API via `@anthropic-ai/sdk`. Default `claude-sonnet-5-5`, light `claude-haiku-5-5`, heavy `claude-opus-5-5` — per-feature choice is in the AI spec |
| Async jobs | `after()` from `next/server` + `ai_jobs` rows with `heartbeat_at` (T-14, D-AI-01 (a)). One function invocation stays under 60 seconds |
| Unit / integration tests | Vitest |
| DB tests | pgTAP via `supabase test db` |

Before using a library API you are not sure about (Next.js `after()`, Route Handler streaming, Supabase SSR client, Anthropic SDK streaming/tool use), check its current docs. Load the `claude-api` skill before writing Anthropic SDK code.

## Directory layout

The backend team owns the paths below. Pages, components, and the mock data layer belong to the UI harness — see "Coexisting with the UI harness".

```
supabase/
  migrations/            YYYYMMDDHHMMSS_<slice>_<what>.sql — one concern per file
  tests/                 pgTAP: <table-or-rpc>.test.sql
  seed.sql               local dev seed only (fake users, no real data)
src/
  app/api/**/route.ts    Route Handlers — streaming (SSE) and async job kickoff only
  server/
    actions/<domain>.ts  Server Actions ('use server') — thin: auth → validate → service
    services/<domain>/   domain logic; no Next.js imports, testable with Vitest
    db/
      server.ts          user-session client (cookies, RLS applies)
      ai-writer.ts       app_ai_writer client (see "DB roles")
      database.types.ts  generated: supabase gen types — never hand-edit
    ai/
      client.ts          Anthropic client, model ids, retry/fallback
      prompts/<AI-xx>/   system blocks + prompt_version
      schemas/<AI-xx>.ts zod output schema (= model output format in the AI spec)
      context-pack/      Career Context Pack (C-1), JD context (C-2), aliases (EXP-n, DET-n, Sn)
      validation/        V-1 … V-8 evidence and number guards (C-3)
      streaming/         incremental JSON → SSE block events (C-6)
    jobs/                ai_jobs lifecycle, step runner, heartbeat, usage ledger
  lib/contracts/         zod request/response + SSE event types shared with the frontend
.env.example             every env var with a dummy value; real values only in .env.local (gitignored)
```

Test files sit next to the code as `*.test.ts`.

## Coexisting with the UI harness

The `resumate-ui` harness builds the screens in the same Next.js app against a mock data layer (`.claude/skills/resumate-ui/references/ui-context.md`). Both harnesses must be able to run without overwriting each other.

| Path | Owner | Backend may |
|------|-------|-------------|
| `src/app/(public)/`, `src/app/(dashboard)/`, `src/components/`, `docs/ui/` | UI | read only |
| `src/lib/mock/` | UI | read only (it shows what shapes the screens expect) |
| `src/lib/data/` | UI until wired; backend after the wiring step | replace function bodies in the wiring step only, keeping exported names and signatures |
| `src/types/db.ts` | UI (hand-mirrored from the data model) | in the wiring step, turn it into re-exports of the generated types (`Tables<'experiences'>` → `Experience`), keeping the names the screens import |
| `src/app/api/`, `src/app/auth/`, `middleware.ts`, `src/server/`, `src/lib/contracts/`, `supabase/` | backend | everything |
| `package.json`, `tsconfig.json`, `next.config.*`, `.env.example` | shared | add backend deps, scripts, and env keys; don't remove or change UI entries |

- **Scaffold:** whichever harness runs first creates the app. If `package.json` exists, the backend only adds its dependencies and scripts — it never re-scaffolds or runs `shadcn init`.
- **Wiring step:** the step that makes a screen use real data (slice-catalog "Wiring"). Before starting it, check `_workspace/ui/` and `docs/ui/screen-status.md` for a UI run in progress on the same area; if one is in progress, wait and tell the user. Run the UI's lint/typecheck/build after wiring, since a signature drift breaks screens, not backend tests.
- **Client hooks:** the UI's `useAiJob(jobId) → { status, progress, partial, error }` and `useAiStream(request) → { blocks, status, error, cancel }` (ui-implementation `references/patterns.md`) are the frontend side of the job and SSE contracts. Shape the job status response and SSE events so these hooks can switch from the mock to the real endpoint without changing their return shape.
- A mismatch between the UI's mock shapes and the data model is a spec question, not something to "fix" in either codebase silently — log it in `spec-gaps.md`.

## Conventions

- **Language**: code, identifiers, and code comments in English. Messages shown to users (error text in responses) in Korean. Reports in `_workspace/backend/` in Korean.
- **IDs from the spec** (`F-P1-13`, `AI-12`, `S-36`, `V-3`, `DM-13`) go in a short comment where the code implements them, so QA and future readers can trace code ↔ spec.
- **Enums**: DB uses `text + CHECK` (DM-3). Mirror each CHECK list as one TS `as const` array in `src/lib/contracts/enums.ts`; QA compares them.
- **Errors**: services throw typed errors (`AppError` with `code`); actions and handlers map them to `{ error: { code, message } }`. AI error codes follow AI spec C-6 `error_code`.
- **No secrets in code or logs.** Never print env values. Logs follow C-7: job id, feature, model, prompt_version, tokens, latency, validation stats — never prompt or response bodies, never career text.

## DB roles and write paths (DM-13)

- Career tables are written **only through the user session** (RLS as the user).
- AI work uses a dedicated role `app_ai_writer` that can read career tables and write only AI result tables, `evidence_links`, `ai_jobs`, `usage_events`, and the few `writing_chats` columns listed in data model §5.
- How the server acts as `app_ai_writer` is decided in slice S1 and recorded in `_workspace/backend/decisions.md`. Recommended: a short-lived JWT whose `role` claim is `app_ai_writer` and `sub` is the user id, with the role granted to `authenticator`, so RLS still sees `auth.uid()`. The service-role key is not used for request paths; if anything needs it (cron cleanup), keep it in one module under `src/server/jobs/` and say why.

## Safety policy

| Action | Allowed |
|--------|---------|
| Write migration files, `supabase start`, `supabase db reset`, `supabase test db` locally | Yes |
| Apply migrations to a **Supabase development branch** (Supabase MCP `apply_migration` / `execute_sql` with that branch's project ref) | Yes — confirm the target is a branch, not the main project, before every call |
| Create a Supabase branch (`create_branch`) — it has a cost | Only after the user confirms the cost in chat |
| Apply anything to the main (production) project, `merge_branch`, `reset_branch`, `delete_branch` | Never, unless the user asks for that exact action in this session |
| Deploy to Vercel, set Vercel env vars | Never, unless the user asks |
| `git commit` / push | Only when the user asks. The leader offers at the end |
| Real Anthropic API calls in tests | No — tests use recorded fixtures or a fake client. A manual smoke call is fine when the user has set `ANTHROPIC_API_KEY` locally |

## Output language

Agent reports and `_workspace/backend/` files: Korean. Code: English (see Conventions).
