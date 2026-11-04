---
name: resumate-backend
description: "Orchestrator for the Resumate backend implementation team. Coordinates a four-member team — db-engineer (Supabase migrations, RLS, RPC), api-engineer (Next.js Server Actions, Route Handlers, auth, ai_jobs runner, BYOK key handling, usage records), ai-pipeline-engineer (OpenAI / Gemini / Claude provider adapters, prompts, evidence validation), backend-qa (boundary cross-checks, tests) — to build the backend slice by slice from docs/planning/. Always use when starting backend work, bootstrapping the project, implementing a feature's server side, building DB schema/API/AI pipelines, or asking 'what's next' on the backend. Follow-ups: always use for backend fixes, re-runs, QA re-checks, continuing to the next slice, re-implementing a slice after planning changes, connecting UI screens' mock data layer to the real backend, revision slices (R-n) after planning changes, preparing a release to the remote Supabase project and Vercel (migration push checklist, deploy order), and improving previous backend output. Korean triggers: 백엔드 작업, 백엔드 구현, 서버 개발, API 개발, DB 구축, 프로젝트 셋업, 다음 슬라이스, 기능 구현(커리어·AI 작성 대화·산출물 AI 대화·JD·인사이트·서류·모의 면접), 백엔드 수정, 다시 실행, QA 다시, 기획 변경 반영해서 구현 수정, 백엔드 연결, mock을 실제 데이터로 교체, 원격 반영, 운영 배포 준비, 마이그레이션 원격 적용. Not for planning documents (use resumate-planning) or UI pages, components, and design (use resumate-ui)."
---

# Resumate Backend Orchestrator

Coordinate the four-member backend team to implement Resumate's server side one vertical slice at a time. You (the main session) are the leader.

## Execution mode: agent team (hybrid fallback when team tools are missing)

- **Default:** `TeamCreate` + `TaskCreate` + `SendMessage`. db-engineer publishes signatures directly to the others; QA reviews each module as it lands.
- **Fallback:** if the session has no `TeamCreate`, run the same flow with the `Agent` tool + file-based handoff. Each phase lists its fallback path. Agents read each other's `02_*_notes.md` instead of messages.

## Team

| Teammate | Agent definition | Skill | Owns |
|----------|------------------|-------|------|
| db-engineer | `.codex/agents/db-engineer.toml` | supabase-migration | `supabase/`, `src/server/db/database.types.ts` |
| api-engineer | `.codex/agents/api-engineer.toml` | nextjs-server-api | `src/app/api/`, `src/app/auth/`, `src/proxy.ts`, `src/server/{actions,services,jobs,keys,db/*.ts}`, `src/lib/contracts/`; backend additions to shared config; `src/lib/data/` + `src/types/db.ts` in the wiring step only |
| ai-pipeline-engineer | `.codex/agents/ai-pipeline-engineer.toml` | ai-pipeline-impl (+ claude-api for the Claude adapter) | `src/server/ai/` (incl. `providers/`) |
| backend-qa | `.codex/agents/backend-qa.toml` (`subagent_type: general-purpose`) | backend-integration-qa | `_workspace/backend/{slice}/03_*` |

Spawn every teammate with `model: "opus"`. Every teammate reads `.agents/skills/resumate-backend/references/backend-context.md` first. File ownership doesn't overlap, so parallel teammates never edit the same file; if one needs a change in another's area, it asks the owner. UI-owned paths (pages, components, `src/lib/mock/`, `docs/ui/`) are read-only for the whole team.

Paths are relative to the repository root. **Language:** skills and agent definitions are English; code is English; `_workspace/backend/` files and everything you say to the user are Korean.

## Workflow

### Phase 0: Context check

1. Read `_workspace/backend/slices.md` (slice status) and `references/slice-catalog.md`. Check whether `package.json` and `supabase/` exist. Check `docs/ui/screen-status.md` and `_workspace/ui/` to see which UI areas have screens and whether a UI run is in progress (backend-context.md "Coexisting with the UI harness"). Read `_workspace/backend/decisions.md` "원격 연동" for what is deployed.
2. Branch:
   - **No `_workspace/backend/`** → initial run. Create it with `slices.md` (all slices `todo`), empty `spec-gaps.md` and `decisions.md`. Start at S0.
   - **User names a slice or feature** ("AI 작성 대화 구현해줘") → map it to a slice. If an earlier slice it depends on isn't `done`, tell the user and propose doing that first. If the feature's slice is already `done`, this is a revision (next bullet).
   - **Planning docs changed** (user says "기획 변경 반영", or `git log docs/planning/` is newer than the last `done` slice) → a **revision slice**: the next free `R-n` (slice-catalog "Revision slices"). Read the planning README's change log and the decision file it names, list what changes in DB / API / AI, and run it through Phases 1–5 like any slice.
   - **User asks to connect the screens to the backend** ("백엔드 연결해줘", "mock을 실제 데이터로") → run only the wiring step for every slice marked "연결 대기" in `slices.md` whose UI screens now exist, plus every `// 연결 대기` function in `src/lib/data/`.
   - **User asks to release** ("원격 반영", "운영 배포 준비", "마이그레이션 올려줘") → Phase 4 only, for every `done` slice not yet marked "원격 반영" in `slices.md`.
   - **User says "next" / "continue"** → the first slice that isn't `done`; if all are done, check for unreflected planning changes, then `연결 대기`, then unreleased slices, and propose the first one found.
   - **User asks to fix or re-check** a slice → partial re-run: re-invoke only the owners of the affected files, then QA on those boundaries.
3. Tell the user in one or two lines which slice you're about to run and why.

### Phase 1: Slice plan (leader)

Write `_workspace/backend/{slice}/01_plan.md` (Korean) from the catalog row and the spec sections it points to:
- Scope: tables, RPCs, endpoints (DM §7 rows), AI features (AI-xx), feature IDs
- Contract sketch: RPC signatures, endpoint inputs/outputs, SSE events, job types and progress stages — enough that three people can start in parallel
- Per-teammate task list, and which tasks depend on db-engineer's migration
- Release impact: destructive migrations expected (what data is lost), new env vars, and whether the change must ship together with a UI change (then main can't take the backend alone)
- Open `[가정]` from `decisions.md` that this slice touches
- Wiring: whether the UI area for this slice has screens (slice-catalog "Wiring"). If yes, list the `src/lib/data/` functions to wire or update; if no, note "연결 대기". If screens need changes beyond "Minimal UI edits", list them as "UI 요청"

Ask the user only if a `[결정 필요]` item blocks the slice (e.g. D-14 for scoring in S8 — the spec already has a placeholder, so usually it doesn't). Otherwise proceed.

### Phase 2: Build

**Team mode:**
```
TeamCreate(team_name: "resumate-backend", members: [4 teammates with their agent definition files, model "opus"])
TaskCreate(tasks from 01_plan.md, with depends_on:
  DB migration + types (db-engineer)
  contracts + services + endpoints (api-engineer, contracts can start immediately; wiring depends on types)
  pipelines + validators (ai-pipeline-engineer, starts immediately on pure code; storage mapping depends on types)
  incremental QA per module (backend-qa, depends on each module)
)
```
api-engineer and ai-pipeline-engineer agree on pipeline signatures and SSE events by message before writing code.

**Fallback:**
1. Call db-engineer (and, for S0, api-engineer first — the project must exist before `supabase init` matters). Wait for the migration and types.
2. In one message, call api-engineer and ai-pipeline-engineer in parallel with `run_in_background: true`, `model: "opus"`, each with the plan, db notes path, and the instruction to put agreed interfaces in their notes. If the slice has no AI feature, skip ai-pipeline-engineer.
3. After each finishes, call backend-qa on that module (incremental). Don't wait for both.

S0 has no AI and no QA boundaries beyond "checks run"; QA just runs the script.

### Phase 3: QA rounds

1. backend-qa runs the full checklist and `run-checks.sh`, writes `03_backend-qa_report.md`. If the slice touched a route handler, action, or job path, it also runs the local smoke check (backend-integration-qa "Local smoke") — fakes in unit tests have hidden real-dependency bugs before (`332ec0c`: every writing-chat turn ended `stalled`).
2. Issues go to owners (SendMessage in team mode; in fallback, re-invoke each owner with its issue list — in parallel when independent).
3. QA re-checks. **At most 2 rounds.** Anything left stays open in the report.
4. A Critical issue still open blocks marking the slice `done`. Report it at the top.

### Phase 3.5: Wiring (only if the plan lists functions to wire)

api-engineer wires the listed `src/lib/data/` functions to the real services (nextjs-server-api "Wiring the UI's mock data layer"), then backend-qa runs Q11 and the UI's `pnpm build`. Re-check right before starting that no UI run has started on the area since Phase 0. If one has, skip wiring, mark the slice "연결 대기", and tell the user. UI-owned file edits follow backend-context.md "Minimal UI edits"; "UI 요청" items go to the user for a `resumate-ui` run.

### Phase 4: Release to remote (only when the user asks)

The remote Supabase project is production and merging to main deploys (backend-context.md "Remote environments"). The leader prepares; the user executes the writes.

1. Find what's missing remotely: Supabase MCP `list_migrations` (read-only) vs `supabase/migrations/`. Check that every local-only file sorts after the remote's last applied one; if not, stop and have db-engineer rename it before anything is pushed.
2. Write `_workspace/backend/{slice or release-date}/05_release.md` (Korean): migrations to push in order, each `-- DESTRUCTIVE:` one with what it deletes, new env vars (name, purpose, production + preview), whether a UI change must ship in the same merge, and the commands for the user (`supabase db push`, then the merge).
3. Ask the user to confirm each destructive migration and to run `db push` (run it yourself only if the user asks for exactly that).
4. After the push: `list_migrations` again, `get_advisors` (security + performance), and record results in `05_release.md`. Advisor items already accepted in `decisions.md` don't need re-reporting.
5. Once the user has merged: check the Vercel deployment status and runtime errors (read-only) and record them. Mark the slices "원격 반영 {date}" in `slices.md`.

### Phase 5: Wrap-up

1. Update `slices.md` (status, date, open issues). Write `_workspace/backend/{slice}/04_summary.md` (Korean): what was built, files, check results, open issues, new spec gaps, `[가정]` used.
2. In team mode, shut teammates down and `TeamDelete`.
3. Report to the user: what was built, check results (say plainly which checks were skipped and why), open issues, new entries in `spec-gaps.md` (these need a planning fix via `resumate-planning`), UI edits made under "Minimal UI edits" and open "UI 요청" items, release impact (destructive migrations, new env vars), and the next slice.
4. Offer to commit. Don't commit unless the user says so. Remind the user that merging to main deploys production, so the slice's migrations must be pushed first (Phase 4).
5. Ask for feedback on the output and the team flow. If it's about the harness, update the agent/skill and log it in `.claude/harness/CHANGELOG.md`. AGENTS.md only holds pointers, so don't edit it for this.

## Data flow

```
docs/planning/* + slice-catalog ─→ [leader] ─→ {slice}/01_plan.md
                                                  │
                         ┌────────────────────────┼─────────────────────────┐
                         ↓                        ↓                         ↓
                  [db-engineer] ──types/RPC──→ [api-engineer] ←─signatures─→ [ai-pipeline-engineer]
                   migrations, pgTAP            actions, handlers, jobs        prompts, validators
                         │                        │                         │
                  02_db notes               02_api notes              02_ai notes
                         └──────── module ready ──┼─────────────────────────┘
                                                  ↓
                                            [backend-qa] ─issues→ owners (≤2 rounds)
                                                  ↓
                               03_report → 04_summary, slices.md, spec-gaps.md
```

## Error handling

| Situation | Response |
|-----------|----------|
| A teammate fails | Re-invoke once with the error. If it fails again, stop the slice, keep finished work, mark the slice `in_progress` with the reason, report |
| db-engineer fails | Everything else depends on the schema — don't start api/ai wiring. Pure code (validators, contracts) may continue |
| Local Supabase or Docker unavailable | Continue with code; pgTAP is `SKIP`. The slice can't be `done` until pgTAP has run once — say so |
| Spec contradiction found | Log in `spec-gaps.md`, follow the data model doc as tie-breaker, tag `[가정]`, report to the user |
| Teammates disagree on an interface | Leader decides using the spec; record it in `decisions.md` |
| A teammate wants to write to the remote Supabase project, deploy, set Vercel env vars, commit, or merge | Stop it. Those need the user's explicit request |
| A migration file sorts before the remote's last applied migration | Rename it (it hasn't been pushed) to sort after; never edit or rename a pushed one |
| A teammate edits a UI-owned file (page, component, mock) beyond "Minimal UI edits" | Stop it and revert that edit. Record it as "UI 요청" and ask the user to route it through `resumate-ui` |
| UI build breaks after wiring | Revert the wiring for the breaking functions, mark them "연결 대기" with the reason, and report |
| Unresolved after 2 QA rounds | Leave open in the report; Critical blocks `done`, others don't |

## Test scenarios

### Normal flow
1. User: "백엔드 작업 시작하자"
2. Phase 0: no `_workspace/backend/` → initial run, create status files, slice S0
3. Phase 1–2: api-engineer scaffolds Next.js + pnpm scripts; db-engineer runs `supabase init`
4. Phase 3: QA runs `run-checks.sh` → typecheck / lint / vitest pass, pgTAP `SKIP` (no tests yet)
5. Phase 5: S0 `done`; report proposes S1 and offers to commit

### Feature slice flow
1. User: "AI 작성 대화 구현해줘"
2. Phase 0: maps to S4; S3b not `done` → propose S3a/S3b first; user agrees, run them, then S4
3. S4: db-engineer builds `writing_chats` + 5 RPCs + pgTAP; api-engineer builds the turn SSE handler and usage records; ai-pipeline-engineer builds AI-12 extract/reply with V-9 checks
4. QA round 1: Q6 mismatch (`draft_patch` payload key) + Q9 (stream cut after the first token is retried, double-recording usage) → fixed → round 2 clean

### Revision flow
1. User: "기획 변경된 거 백엔드에 반영해줘"
2. Phase 0: all S slices `done`; planning README shows a new revision since R5 → R6
3. Phase 1: plan lists the DM/AI/API deltas, one destructive migration (column drop with data), one new env var, and two `// 연결 대기` functions to wire
4. Phases 2–3.5 as usual; local smoke passes; report flags the destructive migration and env var
5. Later the user says "원격 반영해줘" → Phase 4: `05_release.md`, user confirms the drop and runs `db push`, advisors clean, user merges, deployment checked, R6 "원격 반영"

### Error flow
1. Docker isn't running in S2
2. db-engineer writes migrations but can't `db reset`; reports to leader
3. Leader lets api-engineer continue only pure code (contracts, services tested with a fake client); wiring to generated types waits. QA marks pgTAP `SKIP`
4. S2 stays `qa` with "pgTAP 미실행"; report tells the user to start Docker and say "S2 QA 다시"
