---
name: resumate-backend
description: "Orchestrator for the Resumate backend implementation team. Coordinates a four-member team — db-engineer (Supabase migrations, RLS, RPC), api-engineer (Next.js Server Actions, Route Handlers, auth, ai_jobs, usage ledger), ai-pipeline-engineer (Codex calls, prompts, evidence validation), backend-qa (boundary cross-checks, tests) — to build the backend slice by slice from docs/planning/. Always use when starting backend work, bootstrapping the project, implementing a feature's server side, building DB schema/API/AI pipelines, or asking 'what's next' on the backend. Follow-ups: always use for backend fixes, re-runs, QA re-checks, continuing to the next slice, re-implementing a slice after planning changes, connecting UI screens' mock data layer to the real backend, and improving previous backend output. Korean triggers: 백엔드 작업, 백엔드 구현, 서버 개발, API 개발, DB 구축, 프로젝트 셋업, 다음 슬라이스, 기능 구현(커리어·AI 작성 대화·JD·인사이트·서류·모의 면접), 백엔드 수정, 다시 실행, QA 다시, 기획 변경 반영해서 구현 수정, 백엔드 연결, mock을 실제 데이터로 교체. Not for planning documents (use resumate-planning) or UI pages, components, and design (use resumate-ui)."
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
| api-engineer | `.codex/agents/api-engineer.toml` | nextjs-server-api | `src/app/api/`, `src/app/auth/`, `middleware.ts`, `src/server/{actions,services,jobs,db/*.ts}`, `src/lib/contracts/`; backend additions to shared config; `src/lib/data/` + `src/types/db.ts` in the wiring step only |
| ai-pipeline-engineer | `.codex/agents/ai-pipeline-engineer.toml` | ai-pipeline-impl (+ Codex-api) | `src/server/ai/` |
| backend-qa | `.codex/agents/backend-qa.toml` (`subagent_type: general-purpose`) | backend-integration-qa | `_workspace/backend/{slice}/03_*` |

Spawn every teammate with `model: "opus"`. Every teammate reads `.agents/skills/resumate-backend/references/backend-context.md` first. File ownership doesn't overlap, so parallel teammates never edit the same file; if one needs a change in another's area, it asks the owner. UI-owned paths (pages, components, `src/lib/mock/`, `docs/ui/`) are read-only for the whole team.

Paths are relative to the repository root. **Language:** skills and agent definitions are English; code is English; `_workspace/backend/` files and everything you say to the user are Korean.

## Workflow

### Phase 0: Context check

1. Read `_workspace/backend/slices.md` (slice status) and `references/slice-catalog.md`. Check whether `package.json` and `supabase/` exist. Check `docs/ui/screen-status.md` and `_workspace/ui/` to see which UI areas have screens and whether a UI run is in progress (backend-context.md "Coexisting with the UI harness").
2. Branch:
   - **No `_workspace/backend/`** → initial run. Create it with `slices.md` (all slices `todo`), empty `spec-gaps.md` and `decisions.md`. Start at S0.
   - **User names a slice or feature** ("AI 작성 대화 구현해줘") → map it to a slice. If an earlier slice it depends on isn't `done`, tell the user and propose doing that first.
   - **User asks to connect the screens to the backend** ("백엔드 연결해줘", "mock을 실제 데이터로") → run only the wiring step for every slice marked "연결 대기" in `slices.md` whose UI screens now exist.
   - **User says "next" / "continue"** → the first slice that isn't `done`.
   - **User asks to fix or re-check** a slice → partial re-run: re-invoke only the owners of the affected files, then QA on those boundaries.
   - **Planning docs changed since a slice was built** (`git log docs/planning/` newer than the slice's `done` date) → list the affected slices and ask whether to update them before new work.
3. Tell the user in one or two lines which slice you're about to run and why.

### Phase 1: Slice plan (leader)

Write `_workspace/backend/{slice}/01_plan.md` (Korean) from the catalog row and the spec sections it points to:
- Scope: tables, RPCs, endpoints (DM §7 rows), AI features (AI-xx), feature IDs
- Contract sketch: RPC signatures, endpoint inputs/outputs, SSE events, job types and progress stages — enough that three people can start in parallel
- Per-teammate task list, and which tasks depend on db-engineer's migration
- Whether to apply to the Supabase development branch at the end (default: no; yes only if the user asked or said earlier to keep the branch in sync — record the branch's project ref in `decisions.md`)
- Open `[가정]` from `decisions.md` that this slice touches
- Wiring: whether the UI area for this slice has screens (slice-catalog "Wiring"). If yes, list the `src/lib/data/` functions to wire; if no, note "연결 대기"

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

1. backend-qa runs the full checklist and `run-checks.sh`, writes `03_backend-qa_report.md`.
2. Issues go to owners (SendMessage in team mode; in fallback, re-invoke each owner with its issue list — in parallel when independent).
3. QA re-checks. **At most 2 rounds.** Anything left stays open in the report.
4. A Critical issue still open blocks marking the slice `done`. Report it at the top.

### Phase 3.5: Wiring (only if the plan lists functions to wire)

api-engineer wires the listed `src/lib/data/` functions to the real services (nextjs-server-api "Wiring the UI's mock data layer"), then backend-qa runs Q11 and the UI's `pnpm build`. Re-check right before starting that no UI run has started on the area since Phase 0. If one has, skip wiring, mark the slice "연결 대기", and tell the user.

### Phase 4: Remote branch (only if the plan says so)

db-engineer applies the slice's migrations to the development branch per the `supabase-migration` skill, runs advisors, and adds results to its notes. Never the main project.

### Phase 5: Wrap-up

1. Update `slices.md` (status, date, open issues). Write `_workspace/backend/{slice}/04_summary.md` (Korean): what was built, files, check results, open issues, new spec gaps, `[가정]` used.
2. In team mode, shut teammates down and `TeamDelete`.
3. Report to the user: what was built, check results (say plainly which checks were skipped and why), open issues, new entries in `spec-gaps.md` (these need a planning fix via `resumate-planning`), and the next slice.
4. Offer to commit. Don't commit unless the user says so.
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
| A teammate wants to apply to the main Supabase project, deploy, or commit | Stop it. Those need the user's explicit request |
| A teammate edits a UI-owned file (page, component, mock) | Stop it and revert that edit. Ask the user to route the change through `resumate-ui` |
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
2. Phase 0: maps to S4; S3 not `done` → propose S3 first; user agrees, run S3 then S4
3. S4: db-engineer builds `writing_chats` + 5 RPCs + pgTAP; api-engineer builds the turn SSE handler and ledger; ai-pipeline-engineer builds AI-12 extract/reply with V-9 checks
4. QA round 1: Q6 mismatch (`draft_patch` payload key) + Q9 (abort leaves `reserved`) → fixed → round 2 clean

### Error flow
1. Docker isn't running in S2
2. db-engineer writes migrations but can't `db reset`; reports to leader
3. Leader lets api-engineer continue only pure code (contracts, services tested with a fake client); wiring to generated types waits. QA marks pgTAP `SKIP`
4. S2 stays `qa` with "pgTAP 미실행"; report tells the user to start Docker and say "S2 QA 다시"
