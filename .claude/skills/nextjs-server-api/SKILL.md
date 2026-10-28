---
name: nextjs-server-api
description: "Guide for implementing the Resumate Next.js (App Router) server side: project bootstrap, Supabase SSR auth (magic link + Google) and clients, proxy.ts session refresh, Server Actions, Route Handlers with SSE streaming, zod contracts, domain services, the ai_jobs lifecycle with after() step runner, heartbeat, cause-based retries scheduled via next_run_at and free-tier sequential runs, BYOK key handling (envelope encryption, app_key_reader decryption at run time, key verification jobs, provider consent checks), usage records for the usage meter, Vercel Cron routes, and Vitest tests. Use whenever writing or fixing API endpoints, server actions, route handlers, auth flow, job runner, AI key settings, usage meter, or bootstrapping the backend project. Korean triggers: API 구현, 서버 액션, 라우트 핸들러, 엔드포인트 추가, 인증 구현, 로그인 콜백, 비동기 작업, 재시도, 키 등록, 키 암호화, 사용량 미터, 크론, 프로젝트 셋업. Not for UI pages/components, or for prompt, adapter, and validator code (use ai-pipeline-impl)."
---

# Next.js Server API

The data model's API boundary table (DM §7) lists every operation with its mechanism. This skill is how to build each row.

## Bootstrap (slice S0)

The UI harness may already have scaffolded the app (its foundation A0 does the same). Check `package.json` first.

1. **Only when `package.json` is missing:** `pnpm create next-app@latest . --ts --app --src-dir --eslint --tailwind --use-pnpm --import-alias "@/*"` — the same flags the UI harness uses, so its later `shadcn init` works on top. Keep `--tailwind` even though the backend doesn't need it. The repo isn't empty (`.claude/`, `docs/`, `_workspace/`): if the CLI refuses a non-empty directory, scaffold into a temp dir in the scratchpad and move the files in without overwriting existing ones. Don't run `shadcn init` — that's the UI's job.
   **When `package.json` exists:** skip scaffolding. Only add what's below, and don't remove or change existing dependencies, scripts, or config.
2. Add: `@supabase/supabase-js`, `@supabase/ssr`, `zod`, `server-only`, and the provider SDKs used by the adapters (`@anthropic-ai/sdk`, `openai`, `@google/genai`); dev: `vitest`, `supabase`. There is no service-wide LLM key — every AI call uses the user's own key (BYOK).
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

- `@supabase/ssr` server client in `src/server/db/server.ts`; refresh the session in `src/proxy.ts` (Next.js 16 renamed the `middleware.ts` convention to `proxy.ts` — check the bundled docs in `node_modules/next/dist/docs/`).
- Magic link + Google OAuth callback at `src/app/auth/callback/route.ts` (exchange code, redirect to the career screen — PRD: the default screen after login).
- `requireUser()` uses `supabase.auth.getUser()` (verifies with the auth server), not `getSession()`.

## AI job runner (`src/server/jobs/`)

AI is opt-in (BYOK): the user's own key on their **active provider**. There is no reservation, charging, or service-side quota (D-34) — only usage records for the meter and quality/safety limits.

Lifecycle for async jobs (C-6, C-11, C-12):
1. Before creating anything, check in this order: AI connection (`profiles.active_ai_provider`, key status — no key → lock state, not a job), provider consent still current (`ai_data_use_consents` vs `ai_disclosures`), readiness (`get_data_readiness`), quality/safety limits (D-34). `insufficient_data` never calls AI.
2. `input_hash` reuse (hash includes provider and model): if a succeeded result exists, return it — no job, no usage record.
3. Insert `ai_jobs` (`queued`) with `provider`, `model_tier`, `connection_tier` fixed from the active key **at start**. One in-flight job per `(user_id, job_type, target_type, target_id)`: on a unique-violation return the in-flight job. Return `{ jobId }`.
4. `after(() => runJob(jobId))`. Each step: set `running`, `progress {stage, done, total}`, `heartbeat_at = now()`; get the key for this step through `app_key_reader` → `get_provider_key_secret(ai_job_id)` → decrypt in memory → call the ai-pipeline step → drop the key; persist step output; next step. Never put the key in the job row, queue payload, step output, or logs (NFR-KEY-03, -05).
5. **Usage records**: after every provider call (each retry attempt too, failed calls included) insert one `ai_usage_records` row with the normalized tokens and the estimated cost from the current `ai_price_tables` version (C-13).
6. **Retries (C-11.3)** by cause: `rate_limited` up to 4 per call, `provider_unavailable` up to 2, `schema_invalid` / `timeout` 1, everything else 0. **Never sleep inside the function**: record `next_run_at`, `progress.waiting_retry_until`, `retry_count`, add to `retry_wait_total_ms`, and end the invocation; the job resumes when woken (status poll first, cron as a safety net). Stop retrying once the job's total wait reaches 120 s. Streaming calls retry only before the first token.
7. Keep one invocation under 60 s: if more steps remain near the budget, persist and continue in a fresh invocation instead of continuing.
8. **Free tier (C-12)**: run parallel steps sequentially and keep a minimum spacing per user and provider (named constant).
9. Final failure: `failed` + `error_code` (the DB derives `error_category` and `failure_cause`), plus `retry_after` (rate limit, outage) or `quota_resets_at` (daily quota). `key_invalid` → call `mark_provider_key_invalid`. Key deleted mid-run → `key_missing`. Completed step results stay; a manual retry resumes from the failed step.
10. Stalled: jobs `running` with `heartbeat_at` older than a threshold (named constant) → `failed / stalled`.

Every exit path — success, each failure cause, cancel, stall, thrown exception, timeout — must leave the job in a terminal or correctly scheduled state, with one usage record per provider call actually made. Write a test for each.

## BYOK keys (`src/server/keys/`)

- **Envelope encryption** (DM 2.11.2): per key a random DEK, AES-256-GCM with AAD = `user_id || provider || key row id`, DEK wrapped by the KMS key-encryption key. Put KMS behind an interface; the pre-launch implementation may use a master key from an encrypted env var (decisions.md). Plaintext and DEK are cleared right after use.
- **Decryption only at run time** through the `app_key_reader` role and `get_provider_key_secret(ai_job_id)` — never through `app_ai_writer`, the user session, or the service role.
- **Register / replace / re-check**: create a `key_verification` job, verify with the plaintext the user just sent (C-10.5), then call `save_provider_key` with `verification_result = valid | limited`, or don't save (`key_invalid`, `billing_required`, `model_not_available`). Replacement keeps the old key on failure.
- Provider consent (`ai_data_use_consents`) must exist for the provider, tier, and current disclosure version before a key is saved or used.
- The key never goes back to the browser (last 4 only), never into logs, errors, or analytics (NFR-KEY-01, -05). Test that.

## SSE (streaming mode)

- Event names come from the spec (C-6 block events; AI-12 turn: `reply_delta`, `reply_done`, `draft_patch`, `draft_flags`, `turn_done`; plus `error`). Define them once as a zod discriminated union in `src/lib/contracts/`.
- Format: `event: <name>\ndata: <json>\n\n`. Set `Content-Type: text/event-stream`, `Cache-Control: no-cache`.
- Decide success or failure from the last terminal event actually sent, not only from thrown exceptions. On client abort, stop the provider stream and record the usage it reported.

## Tests

- Services: Vitest with a fake Supabase client or the local stack (prefer local for anything RLS-related).
- Job runner: fake pipeline steps and fake adapters that succeed, throw each error cause, and hang → assert job status, scheduled retries, and usage records.
- Keys: encryption round-trip, AAD tampering fails, the key never appears in responses or logs, `get_provider_key_secret` refuses other users, other providers, and finished jobs.
- No real provider calls with any key.

## Notes template (`02_api-engineer_notes.md`, Korean)

```markdown
# {slice} API 구현 노트
## 엔드포인트 (DM §7 행 ↔ 파일)
## 계약 (요청·응답·SSE 이벤트, contracts 파일)
## 작업 흐름 (재시도 예약, 실패 원인, 사용 기록)
## 테스트
## 스펙 차이·가정
```
