---
name: backend-integration-qa
description: "Checklist and method for Resumate backend integration QA: cross-checking planned data model ↔ migrations ↔ generated types ↔ service queries, RPC signatures ↔ callers, zod contracts ↔ handlers ↔ screen specs, SSE event names, AI output schema ↔ evidence_links storage, enum lists DB CHECK ↔ TS, AI job exit paths and usage records, RLS cross-user isolation, app_ai_writer limits, BYOK key isolation and masking, and log privacy; plus running typecheck, lint, Vitest, and pgTAP via a bundled script. Use for backend QA, integration checks, boundary review, verifying a slice, running backend tests, or re-checking QA issues. Korean triggers: 백엔드 QA, 통합 검증, 경계면 검사, 슬라이스 검증, 백엔드 테스트 실행, QA 이슈 재확인, RLS 검증. Not for planning document review (use spec-consistency-review) or general code review of a diff (use code-review)."
---

# Backend Integration QA

Bugs in this codebase hide at seams between layers that were written by different teammates. For each boundary, open both sides and compare them. Existence isn't the question; agreement is.

## How to run

1. Read the slice plan and teammates' `02_*` notes to get the file list.
2. As each module lands, check the boundaries it touches (incremental). Don't wait for the whole slice.
3. Run `bash .claude/skills/backend-integration-qa/scripts/run-checks.sh` from the repo root. It runs typecheck, lint, Vitest, and pgTAP, and prints `SKIP` (with the reason) for anything it can't run. Add `--build` after a wiring step so the UI's `pnpm build` runs too.
4. If the slice touched a route handler, action, or job path: run the local smoke (below).
5. Log issues, send them to owners, re-check after fixes. At most 2 rounds.
6. Write the report.

## Local smoke

Unit tests inject fakes, so a dependency that is wired wrong in the real factory passes them (`332ec0c`: the writing-chat turn passed an unbound key source, every turn ended `stalled`, all tests green). Once per slice that touches a request path:
1. Local Supabase running (`supabase status`), `pnpm dev` in the background.
2. Sign in as a seed user (local magic link via the local mail inbox), or call the service through its real dependency factory (`src/server/jobs/*` deps, not test fakes) from a Vitest integration test against the local stack.
3. Hit each changed endpoint or action once on the happy path and once on a failure path that doesn't need a provider (no key → lock state, `insufficient_data`, validation error). For AI paths without a real key, assert the job reaches the expected terminal code — not `stalled`.
4. Record what ran in the report. If the stack or dev server can't start, it's `SKIP` with the reason. Never use a preview or production URL for this — they share the production DB.

## Boundary checklist

| # | Boundary | Compare | Typical bug |
|---|----------|---------|-------------|
| Q1 | Data model doc ↔ migrations | every table/column/CHECK value/FK/index in the slice's DM sections vs the SQL | CHECK list missing a value the spec added in v3 (e.g. `writing_chat_turn`) |
| Q2 | Migrations ↔ generated types ↔ queries | `database.types.ts` regenerated after the last migration (compare column lists); every `.from('x').select('a,b')` / `.rpc()` name exists | stale types hide a renamed column until runtime |
| Q3 | RPC signature ↔ callers | arg names (`p_...`), arg types, return jsonb keys vs the TS parsing them | caller reads `readyFlag`, RPC returns `ready` |
| Q4 | RPC `raise` codes ↔ app error mapping | every `message = '...'` in SQL has a mapping; mapping has no dead codes | limit error surfaces as a generic 500 |
| Q5 | Contracts ↔ handlers ↔ screen specs | zod request/response vs what the handler actually returns; fields the screen spec shows exist in the response | screen needs `stage_changed_at`, response omits it |
| Q6 | SSE events | event names and payload shapes: spec (C-6 / AI-12 / AI-13 / DM §7) ↔ `src/lib/contracts/` (`sse.ts`, `writing-chat.ts`) ↔ emitter ↔ the UI stream client | `blockDone` vs `block_completed`; AI-13 `draft_block` payload key drift |
| Q7 | AI output ↔ storage | zod output schema keys = spec's model output format; `toStorage` strips every `evidence` array; `evidence_links` columns filled per C-3 mapping; AI-12 sources stay in `structured_draft` | evidence array left inside `insights.result` |
| Q8 | Enums DB ↔ TS | each `<table>_<col>_check` list vs `src/lib/contracts/enums.ts` (job_type, feature, status, error_code, stage …) | TS union has a value the DB rejects |
| Q9 | AI job exits & usage records (BYOK) | for each runner path — success, each C-11 cause (`rate_limited` ×4, `provider_unavailable` ×2, `schema_invalid` / `timeout` ×1, others 0), daily quota, key invalid / missing, cancel, stalled, thrown exception, client abort, stream cut after first token: job ends terminal or correctly scheduled (`next_run_at`, `waiting_retry_until`, `retry_wait_total_ms` ≤ 120 s, `retry_after` / `quota_resets_at`), and exactly one `ai_usage_records` row per provider call actually made (none for input-hash reuse); `key_invalid` marks the key; no service-side quota or charging anywhere (D-34); a test exists for each | a retry that sleeps inside the function, or a failed call with reported tokens but no usage record |
| Q10 | Security & privacy | pgTAP: user B can't read/write user A's rows for every new table; `app_ai_writer` can't write career tables (DM-13); security definer RPCs set `search_path` and check ownership; no logging of prompts, responses, or career text (grep `console.` / logger calls in `src/server/ai`, `src/server/jobs`); no secrets in code; `.env.local` not tracked | `console.log(messages)` while debugging; BYOK keys: no grant on ciphertext columns for any client or AI role, `get_provider_key_secret` refuses other users / providers / non-running jobs, the key never appears in responses, logs, errors, or job rows (NFR-KEY-01, -05, -07, -08) |

| Q11 | UI ↔ backend (only when UI screens exist) | `src/types/db.ts` names and enum unions vs generated types and CHECK lists; each `src/lib/data/` function's declared return type vs what the wired service actually returns; `useAiJob` / `useAiStream` return shapes vs the job status response and SSE events; UI `pnpm build` passes after wiring; UI-owned files touched only within "Minimal UI edits" and listed in the notes | mock returned `stage_outcome: 'pass'`, DB stores `'offer'` |
| Q12 | Real dependency wiring | every production deps factory (`src/server/jobs/*.ts`, route handlers) builds the same objects the tests fake: each `createLlm` call passes a key source bound to the job's provider; each job type has a runner registered; env values read through the env loader; local smoke result | key source passed unbound → `stalled` on every run while unit tests pass |
| Q13 | Release readiness | new migration files sort after the newest existing file (and after the remote's last applied one, via `list_migrations` when available); data-losing migrations carry `-- DESTRUCTIVE:` in their own file and are in the notes; new env vars are in `.env.example`, the env loader, and the notes | `20261105…` file added after `20261110…` files — `db push` refuses it |

Also verify every validator rule the slice's features use — common V-1 … V-8 and the feature-card rules V-9 (AI-12) and V-10 (AI-13) — has at least one test proving a bad output is caught.

## Severity

- **Critical** — data leak across users, AI can write career data, unvalidated AI output stored, secrets committed, a user's API key readable outside the decryption path or written to logs, an unmarked data-losing migration
- **Major** — contract mismatch that breaks a flow, a real-dependency wiring bug (Q12), missing usage record or wrong retry scheduling, missing failure-path handling, migration ordering that blocks `db push`, check fails
- **Minor** — missing test for an edge case, inconsistent naming that still works

## Report template (`03_backend-qa_report.md`, Korean)

```markdown
# {slice} 백엔드 QA 리포트 (라운드 {n})

## 검사 실행 결과
| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck / lint / vitest / pgTAP / 로컬 스모크 | 통과·실패·SKIP(사유) | |

## 경계면 검사
| # | 경계 | 결과 | 이슈 |
|---|------|------|------|
| Q1 … Q13 | | 통과·이슈·해당 없음 | QA-xx |

## 이슈
### QA-01 [Critical|Major|Minor] 제목
- 담당: db-engineer | api-engineer | ai-pipeline-engineer
- 근거: `path:line` ↔ `path:line` (또는 실패한 명령과 출력)
- 수정 제안:
- 상태: 열림 | 수정됨(확인 완료) | 미해결

## 스펙 차이 (spec-gaps.md로 넘긴 항목)
```

A check that didn't run is `SKIP` with the reason — never `통과`.
