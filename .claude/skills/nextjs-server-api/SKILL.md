---
name: nextjs-server-api
description: "Guide for implementing the Resumate Next.js (App Router) server side: project bootstrap, Supabase SSR auth (magic link + Google) and clients, Server Actions, Route Handlers with SSE streaming, zod contracts, domain services, the ai_jobs lifecycle with after() step runner and heartbeat, the usage ledger (reserve → charge / release), Vercel Cron routes, and Vitest tests. Use whenever writing or fixing API endpoints, server actions, route handlers, auth flow, job runner, usage limits, or bootstrapping the backend project. Korean triggers: API 구현, 서버 액션, 라우트 핸들러, 엔드포인트 추가, 인증 구현, 로그인 콜백, 비동기 작업, 사용량 차감, 크론, 프로젝트 셋업. Not for UI pages/components, or for prompt and validator code (use ai-pipeline-impl)."
---

# Next.js Server API

The data model's API boundary table (DM §7) lists every operation with its mechanism. This skill is how to build each row.

## Bootstrap (slice S0)

The UI harness may already have scaffolded the app (its foundation A0 does the same). Check `package.json` first.

1. **Only when `package.json` is missing:** `pnpm create next-app@latest . --ts --app --src-dir --eslint --tailwind --use-pnpm --import-alias "@/*"` — the same flags the UI harness uses, so its later `shadcn init` works on top. Keep `--tailwind` even though the backend doesn't need it. The repo isn't empty (`.claude/`, `docs/`, `_workspace/`): if the CLI refuses a non-empty directory, scaffold into a temp dir in the scratchpad and move the files in without overwriting existing ones. Don't run `shadcn init` — that's the UI's job.
   **When `package.json` exists:** skip scaffolding. Only add what's below, and don't remove or change existing dependencies, scripts, or config.
2. Add: `@supabase/supabase-js`, `@supabase/ssr`, `zod`, `@anthropic-ai/sdk`; dev: `vitest`, `supabase`.
3. Scripts: `typecheck` (`tsc --noEmit`), `lint`, `test` (`vitest run`), `db:reset`, `db:test`, `db:types`.
4. `tsconfig` strict. Create the directory layout from backend-context.md with an `index.ts` only where something exports.
5. `src/server/env.ts`: zod-parse `process.env` once; import env only from here. Mirror every key in `.env.example` with dummy values. Make sure `.env*.local` is in `.gitignore`.
6. Verify: `pnpm typecheck && pnpm lint && pnpm test` pass (and `pnpm build`, if UI screens already exist).

## Wiring the UI's mock data layer

When a slice's services exist and the UI has screens for that area, the slice ends with a wiring step (backend-context.md "Coexisting with the UI harness"):

1. Confirm no UI run is in progress on that area (`_workspace/ui/`, `docs/ui/screen-status.md`). If one is, stop and tell the leader.
2. For each `src/lib/data/<entity>.ts` function in the slice's area, keep the exported name, parameters, and return type, and replace the body with a call to the real service / action / RPC. If the real data can't produce the declared return type, that's a contract mismatch: log it in `spec-gaps.md` and leave that function on the mock.
3. Point `useAiJob` / `useAiStream` at the real job status endpoint and SSE route, keeping their return shapes.
4. Rewrite `src/types/db.ts` as re-exports of the generated types under the names screens already import (once per table, the first time that table is wired).
5. Leave `src/lib/mock/` in place — the UI's `?state=` previews still use it.
6. Run the UI's `pnpm lint`, `pnpm typecheck`, `pnpm build`.

## Choosing the mechanism

| Spec says | Build | Why |
|-----------|-------|-----|
| Server Component (read) | a service function the page calls | No HTTP hop; the frontend team wires the page |
| Server Action | `src/server/actions/<domain>.ts` | Form/mutation from the UI, returns a typed result |
| Route Handler + SSE | `src/app/api/.../route.ts` returning a `ReadableStream` | Actions can't stream events |
| Async job | Route Handler or Action that creates `ai_jobs`, returns `{ jobId }`, then `after(() => runJob(jobId))` | Must outlive the response (C-6) |
| Vercel Cron | `src/app/api/cron/<name>/route.ts`, checks `CRON_SECRET` header | Scheduled cleanup (S9) |

## Action / handler shape

```ts
'use server';
export async function saveProjectDetail(input: unknown): Promise<ActionResult<ProjectDetailDto>> {
  const user = await requireUser();                       // 401 → { error: { code: 'unauthenticated' } }
  const parsed = SaveProjectDetailInput.safeParse(input); // contracts in src/lib/contracts
  if (!parsed.success) return invalid(parsed.error);
  return run(() => projectDetails.save(user, parsed.data)); // maps AppError → { error }
}
```

- `ActionResult<T> = { data: T } | { error: { code: string; message: string } }`. `message` is Korean, user-facing; `code` is stable for the frontend.
- Services receive the user-session client and user; they never read cookies.
- Map Postgres errors from RPC `raise` (`message_limit_reached`, etc.) to `AppError` codes in one place.

## Auth

- `@supabase/ssr` server client in `src/server/db/server.ts`; refresh the session in `middleware.ts`.
- Magic link + Google OAuth callback at `src/app/auth/callback/route.ts` (exchange code, redirect to the career screen — PRD: the default screen after login).
- `requireUser()` uses `supabase.auth.getUser()` (verifies with the auth server), not `getSession()`.

## AI job runner (`src/server/jobs/`)

Lifecycle for async jobs (C-6):
1. Check readiness (`get_data_readiness`) and limits **before** creating anything. `insufficient_data` never calls AI.
2. `input_hash` reuse: if a succeeded result with the same hash exists, return it — no job, no usage.
3. Insert `ai_jobs` (`queued`) + reserve `usage_events` (`reserved`) per the D-17 table. Return `{ jobId }`.
4. `after(() => runJob(jobId))`. Each step: set `running`, `progress {stage, done, total}`, `heartbeat_at = now()`; call the ai-pipeline step; persist step output; next step.
5. Keep one invocation under 60 s: if more steps remain near the budget, persist and re-trigger the next step (self-invoke or next request) instead of continuing.
6. Success → `succeeded`, usage `charged`. Failure → retry once (C-6), then `failed` + `error_code`, usage `released`. Completed step results stay; a retry resumes from the failed step.
7. Stalled: jobs `running` with `heartbeat_at` older than a threshold (named constant) → `failed / stalled`, usage `released`.

The ledger rule is simple and must hold on **every** exit path, including thrown exceptions and timeouts: a reservation ends as exactly one of `charged` or `released`. Write a test for each failure path.

## SSE (streaming mode)

- Event names come from the spec (C-6 block events; AI-12 turn: `reply_delta`, `reply_done`, `draft_patch`, `draft_flags`, `turn_done`; plus `error`). Define them once as a zod discriminated union in `src/lib/contracts/sse.ts`.
- Format: `event: <name>\ndata: <json>\n\n`. Set `Content-Type: text/event-stream`, `Cache-Control: no-cache`.
- On client abort, stop the model stream and settle the ledger.

## Tests

- Services: Vitest with a fake Supabase client or the local stack (prefer local for anything RLS-related).
- Job runner: fake pipeline steps that succeed, throw, and hang → assert job status and ledger outcome.
- No real Anthropic calls.

## Notes template (`02_api-engineer_notes.md`, Korean)

```markdown
# {slice} API 구현 노트
## 엔드포인트 (DM §7 행 ↔ 파일)
## 계약 (요청·응답·SSE 이벤트, contracts 파일)
## 사용량·작업 흐름 (예약 → 확정/해제 경로)
## 테스트
## 스펙 차이·가정
```
