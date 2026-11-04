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
| LLM | **BYOK**: the user's own API key for one active provider — OpenAI, Google Gemini, or Anthropic Claude (D-28). Feature code is provider-neutral; adapters in `src/server/ai/providers/` map tier (`light` / `default` / `heavy`) → model per AI spec C-10.1, with no automatic fallback (D-31). There is no service-wide LLM key and no service-side usage quota (D-34) |
| Key storage | App-level envelope encryption (AES-256-GCM, per-key DEK wrapped by an external KMS key), decrypted only at run time via the `app_key_reader` role (DM-16, NFR-KEY-01…09) |
| Async jobs | `after()` from `next/server` + `ai_jobs` rows with `heartbeat_at` (T-14, D-AI-01 (a)). One function invocation stays under 60 seconds |
| Unit / integration tests | Vitest |
| DB tests | pgTAP via `supabase test db` |

Before using a library API you are not sure about (Next.js `after()`, `proxy.ts`, Route Handler streaming, Supabase SSR client, each provider SDK's streaming / structured output / errors), check its current docs. Next.js 16 ships its docs in `node_modules/next/dist/docs/`. Load the `claude-api` skill before writing Anthropic SDK code.

## Directory layout

The backend team owns the paths below. Pages, components, and the mock data layer belong to the UI harness — see "Coexisting with the UI harness".

```
supabase/
  migrations/            YYYYMMDDHHMMSS_<slice>_<what>.sql — one concern per file (naming rule below)
  tests/                 pgTAP: <table-or-rpc>.test.sql
  seed.sql               local dev seed only (fake users, no real data)
src/
  app/api/**/route.ts    Route Handlers — streaming (SSE) and async job kickoff only
  server/
    actions/<domain>.ts  Server Actions ('use server') — thin: auth → validate → service
    services/<domain>/   domain logic; no Next.js imports, testable with Vitest
    auth/                session helpers, consent gate, preview marker, site URL (used by proxy.ts and the auth callback)
    db/
      server.ts          user-session client (cookies, RLS applies)
      ai-writer.ts       app_ai_writer client (see "DB roles")
      key-reader.ts      app_key_reader client — only calls get_provider_key_secret
      database.types.ts  generated: supabase gen types — never hand-edit
    ai/
      providers/         provider adapters (anthropic, openai, gemini): tier → model, structured output, stream/usage/error normalization (C-10, C-11)
      prompts/<AI-xx>/   system blocks + prompt_version
      schemas/<AI-xx>.ts zod output schema (= model output format in the AI spec)
      context-pack/      Career Context Pack (C-1), JD context (C-2), aliases (EXP-n, DET-n, Sn)
      validation/        V-1 … V-8 common evidence and number guards (C-3); feature-card rules V-9 (AI-12 utterance tracing) and V-10 (AI-13 deliverable draft)
      streaming/         incremental JSON → SSE block events (C-6)
    jobs/                ai_jobs lifecycle, step runner, heartbeat, cause-based retry scheduling, usage records
    keys/                envelope encryption, KMS adapter, key verification, provider consent checks
  lib/contracts/         zod request/response + SSE event types shared with the frontend
.env.example             every env var with a dummy value; real values only in .env.local (gitignored)
```

Test files sit next to the code as `*.test.ts`.

## Coexisting with the UI harness

The `resumate-ui` harness builds the screens in the same Next.js app through the `src/lib/data` layer (`.claude/skills/resumate-ui/references/ui-context.md`). The data layer is wired (W0–W5); since then a function the UI adds for a new or changed screen is written with `previewOr`, mock-backed and marked `// 연결 대기` — those arrive in `spec-gaps.md` as UI requests and are wired in a later slice (table below). Both harnesses must be able to run without overwriting each other.

| Path | Owner | Backend may |
|------|-------|-------------|
| `src/app/(public)/`, `src/app/(dashboard)/`, `src/app/(focus)/`, `src/app/(page)/`, `src/components/`, `src/hooks/`, `docs/ui/` | UI | read only (see "Minimal UI edits" below) |
| `src/lib/mock/` | UI | read only (it shows what shapes the screens expect; `?state=` previews still use it) |
| `src/lib/data/` | Backend for functions already wired (W0–W5, 2026-11-02). A function the UI added for a new or changed screen stays UI-owned and mock-backed — marked `// 연결 대기` — until a wiring step | in a wiring step, replace `// 연결 대기` bodies with real calls, keeping exported names and signatures; edit already-wired functions when a slice changes their service |
| `src/types/db.ts` | Backend after wiring (re-exports of the generated types under the names screens import) | keep the exported names; add re-exports when a slice adds tables |
| `src/app/api/`, `src/app/auth/`, `src/proxy.ts`, `src/server/`, `src/lib/contracts/`, `supabase/` | backend | everything |
| `package.json`, `tsconfig.json`, `next.config.*`, `.env.example` | shared | add backend deps, scripts, and env keys; don't remove or change UI entries |

- **Scaffold:** whichever harness runs first creates the app. If `package.json` exists, the backend only adds its dependencies and scripts — it never re-scaffolds or runs `shadcn init`.
- **Wiring step:** the step that makes a screen use real data (slice-catalog "Wiring"). The initial wiring (W0–W5) is done; later wiring happens inside revision slices when the UI has built screens against a newer contract (find them with `grep -rn "연결 대기" src/lib/data docs/ui/screen-status.md`). Before starting it, check `_workspace/ui/` and `docs/ui/screen-status.md` for a UI run in progress on the same area; if one is in progress, wait and tell the user. Run the UI's lint/typecheck/build after wiring, since a signature drift breaks screens, not backend tests.
- **Minimal UI edits** (leader decision W1, 2026-11-02): wiring may touch a UI-owned file only for changes it can't work without — moving a page in or out of a gated route group, a redirect target, showing a server error code the page already has a slot for, a preview/mock switch. Keep each such edit minimal, list it in the slice notes under "UI 소유 파일 수정", and report it to the user. Anything else (copy, layout, new states, component changes) goes in the notes as "UI 요청" and is done through `resumate-ui` (frontend-engineer).
- **Client hooks:** the UI's `useAiJob(jobId) → { status, progress, partial, error }` and `useAiStream(request) → { blocks, status, error, cancel }` (ui-implementation `references/patterns.md`) are the frontend side of the job and SSE contracts. Shape the job status response and SSE events so these hooks can switch from the mock to the real endpoint without changing their return shape.
- A mismatch between the UI's mock shapes and the data model is a spec question, not something to "fix" in either codebase silently — log it in `spec-gaps.md`.

## Conventions

- **Language**: code, identifiers, and code comments in English. Messages shown to users (error text in responses) in Korean. Reports in `_workspace/backend/` in Korean.
- **IDs from the spec** (`F-P1-13`, `AI-12`, `S-36`, `V-3`, `DM-13`) go in a short comment where the code implements them, so QA and future readers can trace code ↔ spec.
- **Enums**: DB uses `text + CHECK` (DM-3). Mirror each CHECK list as one TS `as const` array in `src/lib/contracts/enums.ts`; QA compares them.
- **Errors**: services throw typed errors (`AppError` with `code`); actions and handlers map them to `{ error: { code, message } }`. AI error codes follow AI spec C-11 (`error_code`, with `error_category` and `failure_cause` derived in the DB).
- **Migration file names** must sort after every existing file *and* every migration already applied remotely. Some existing files carry timestamps ahead of the real date (e.g. `20261110…` written on 2026-11-03), so don't use the clock blindly: take `max(now, latest file in supabase/migrations/ + 1 second)` in `YYYYMMDDHHMMSS`. A file that sorts before the remote's last applied migration makes `supabase db push` refuse or need `--include-all`.
- **Dates** in `_workspace/backend/` files, notes, and decision entries: today's real date (`date +%F`), not a date implied by a slice name or a planning revision label.
- **New env vars**: add the key with a dummy value to `.env.example` and to the zod env loader, and list it in the slice notes under "새 환경 변수" — the leader reports it so the user can set it on Vercel (production and preview) before the code reaches main.
- **No secrets in code or logs.** Never print env values. Logs follow C-7: job id, feature, provider, tier, model, prompt_version, tokens, latency, validation stats — never prompt or response bodies, never career text, **never a user's API key or any part of it beyond the last 4 characters** (NFR-KEY-05).

## DB roles and write paths (DM-13)

- Career tables are written **only through the user session** (RLS as the user).
- AI work uses a dedicated role `app_ai_writer` that can read career tables and write only AI result tables, `evidence_links`, `ai_jobs`, `ai_usage_records` (insert), and the few `writing_chats` columns listed in data model §5. It has **no** access to `ai_provider_keys`.
- **`app_key_reader`** (DM 2.11.2) can only execute `get_provider_key_secret(ai_job_id)`, which returns a key's ciphertext for a running job of the same user and provider. No other role — user session, `app_ai_writer`, service role, operators — gets the ciphertext columns.
- How the server acts as `app_ai_writer` is decided in slice S1 and recorded in `_workspace/backend/decisions.md`. Recommended: a short-lived JWT whose `role` claim is `app_ai_writer` and `sub` is the user id, with the role granted to `authenticator`, so RLS still sees `auth.uid()`. `app_key_reader` uses the same mechanism with its own role claim. The service-role key is not used for request paths; if anything needs it (cron cleanup), keep it in one module under `src/server/jobs/` and say why.
- **Role token signing (implemented):** `signRoleToken` in `src/server/db/ai-writer.ts` / `key-reader.ts` signs HS256 with the project's legacy JWT secret. This works only while the remote project's legacy JWT keys stay enabled. Before anyone disables them, switch signing to an imported asymmetric key (e.g. ES256) — otherwise every AI job fails. Don't change the signing scheme without the user's go-ahead; it affects production.

## Remote environments (since 2026-11-04)

Details and refs are in `_workspace/backend/decisions.md` "2026-11-04 원격 연동". The shape that matters for every slice:

| Piece | Reality | Consequence |
|-------|---------|-------------|
| Supabase | One remote project (`resumate`, Seoul, Free plan) that **is production**. No development branch | There is no safe remote place to try migrations. Local stack is the only test DB |
| Migrations | Applied by the user with `supabase db push` (linked project; the user types the DB password). Auth settings via `supabase config push` from a copy, not by editing the local `config.toml` | Agents prepare migrations and a release checklist; they don't push |
| Vercel | Project `resumate` linked to GitHub; **merging to main deploys production**. Functions pinned to `icn1` | A merge is a release. Code that needs a new migration must not reach main before `db push` |
| Preview deploys | Use the **same production DB and KEK** | Never run destructive manual tests on a preview URL |
| Email | Supabase default sender (English templates, low hourly limit) until custom SMTP is set up — pre-launch requirement | Don't build flows that assume custom templates are live remotely |

**Release order** (Phase 4 of the orchestrator): migrations pushed remotely → advisors and `list_migrations` checked → new env vars set on Vercel → merge to main → deployment checked.

**Destructive migrations** — any migration that deletes or truncates rows, drops a table or column with data, or rewrites data irreversibly — start with a `-- DESTRUCTIVE: <what is lost>` header line, are listed in the slice notes, and need the user's explicit confirmation before `db push`. Example: `20261109100100_r4_clear_career_chat_data`.

## Safety policy

| Action | Allowed |
|--------|---------|
| Write migration files, `supabase start`, `supabase db reset`, `supabase test db` locally | Yes |
| Read-only inspection of the remote project (Supabase MCP `list_migrations`, `list_tables`, `get_advisors`, `get_logs`; Vercel MCP deployment status and runtime logs) | Yes |
| Write to the remote (production) project in any way — `supabase db push`, MCP `apply_migration`, writing `execute_sql`, `supabase config push` | Never, unless the user asks for that exact action in this session. Default: the user runs `db push` from the release checklist |
| A destructive migration (`-- DESTRUCTIVE:`) reaching the remote | Only after the user confirms that specific data loss |
| Create a Supabase branch (`create_branch`) — it has a cost | Only after the user confirms the cost in chat. If a development branch exists later, migrations may be applied there after confirming the target ref is that branch |
| `merge_branch`, `reset_branch`, `delete_branch` | Never, unless the user asks for that exact action |
| Deploy to Vercel, set or change Vercel env vars | Never, unless the user asks |
| `git commit` / push / open a PR | Only when the user asks. The leader offers at the end |
| Merge to main (= production deploy) | Only when the user asks, and only after the slice's migrations are on the remote and its new env vars are set |
| Real provider API calls in tests (OpenAI, Gemini, Claude) | No — tests use recorded fixtures or a fake SDK. A manual smoke call is fine only with a key the user provides locally for that purpose; never commit or log it |
| Store, print, or copy a user's API key outside the encryption path | Never |

## Output language

Agent reports and `_workspace/backend/` files: Korean. Code: English (see Conventions).
