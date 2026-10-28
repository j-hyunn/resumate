---
name: resumate-ui
description: "Orchestrator for the Resumate UI team. Coordinates ui-designer, frontend-engineer (foundation + one per screen area), and ui-qa to turn the planning documents (docs/planning/) into a design system (docs/ui/design-system.md) and working Next.js + Tailwind + shadcn/ui screens backed by a mock data layer, tracked in docs/ui/screen-status.md. Always use when starting UI work, building or designing screens, setting up the frontend, implementing the dashboard/career/기업 JD/interview/board screens, or applying a Figma design. Follow-ups: always use for UI revisions, re-runs, next screen batches, 'continue the UI', partial re-runs (e.g. only the career screens, only the board, only the design system), applying screen-spec changes to code, and fixing QA issues. Korean triggers: UI 작업, 화면 구현 시작, 프론트엔드 구축, 디자인 시스템 만들기, 화면 만들어줘, 커리어 화면 구현, 보드 화면만 다시, UI 이어서, 다음 화면, UI 수정, 기획 변경 반영해서 화면 수정, 디자인 다시, QA 이슈 수정. Not for planning documents (resumate-planning) or backend work (Supabase migrations, real Claude API integration)."
---

# Resumate UI Orchestrator

Coordinate the UI team to turn the settled planning documents into a design system and working screens. You (the main session) are the leader. Everyone reads `.agents/skills/resumate-ui/references/ui-context.md` first — it holds the stack, repository layout, area ownership, and data-layer rules this workflow depends on.

All paths are relative to the repository root. **Language:** skills and agent definitions are English; reports, `docs/ui/`, UI copy, and everything you say to the user are Korean.

## Execution mode: hybrid

| Phase | Mode | Why |
|-------|------|-----|
| 1 Design system | sub-agent (ui-designer alone) | One author, nothing to coordinate |
| 2 Foundation | sub-agent (frontend-engineer A0) → ui-qa | Everything else depends on it; must be stable before parallel work |
| 3 Areas | **agent team** (engineers per area + ui-qa + ui-designer on call) | Parallel engineers need live visual answers and per-screen QA |
| 4 Integration QA | sub-agent (ui-qa) | Independent final check across areas |

If the session has no `TeamCreate`, run Phase 3 with background sub-agents instead (fallback path given there).

## Team

| Member | Agent definition | Skill | Output |
|--------|------------------|-------|--------|
| ui-designer | `.codex/agents/ui-designer.toml` | ui-design-system | `docs/ui/design-system.md`, `_workspace/ui/01_ui-designer_notes.md` |
| frontend-engineer (one per area) | `.codex/agents/frontend-engineer.toml` | ui-implementation | code in the area's folders, `_workspace/ui/{phase}_frontend-engineer-{area}_report.md` |
| ui-qa | `.codex/agents/ui-qa.toml` | ui-qa-review | `_workspace/ui/{phase}_ui-qa_{scope}_review.md` |

Spawn every member with `model: "opus"` and `subagent_type` set to the agent name. Give each engineer instance an explicit area and screen list; the area table in ui-context.md is the default split.

## Workflow

### Phase 0: Context check

1. Read `docs/ui/screen-status.md`, `docs/ui/design-system.md`, and `_workspace/ui/` if they exist; check whether `package.json` exists.
2. Check the planning versions in `docs/planning/README.md` against the versions recorded at the top of `screen-status.md`. A newer planning version means some screens may be stale — list the changed screens (from the planning docs' change logs) before doing anything else.
3. Branch:
   - **Nothing exists** → initial run: Phase 1 → 2 → 3 → 4 → 5.
   - **Design system + foundation exist, user asks for more screens / "이어서"** → run Phase 3 for the next areas or screens not yet `QA 통과` in screen-status, then 4 → 5.
   - **Partial revision** (feedback on specific screens, a planning change, a Figma design for one area) → re-invoke only the owners in the table below, then QA only the affected screens.
   - **Restart from scratch** (user explicitly asks) → move `_workspace/ui/` to `_workspace/ui_{YYYYMMDD_HHMMSS}/`, confirm with the user before deleting any code, then initial run.

| Revision scope | Re-invoke | Then |
|----------------|-----------|------|
| Visual language, tokens, Figma provided | ui-designer → foundation engineer (apply tokens) | ui-qa Q8 on all built screens |
| Common components, shell, types, data layer | foundation engineer | ui-qa on foundation + affected areas |
| Specific screens | that area's engineer (existing report + feedback verbatim in the prompt) | ui-qa on those screens |
| Planning document changed | owners of the changed screens; foundation first if `types/db.ts` changes | ui-qa Q1–Q6 on changed screens |

### Phase 1: Design system

**Mode: sub-agent.** Skip if `docs/ui/design-system.md` exists and no visual feedback was given.

1. Create `_workspace/ui/`. Write `_workspace/ui/00_brief.md`: the user's request, scope for this run (areas/screens), Figma URL if any, planning versions.
2. `Agent(subagent_type: "ui-designer", model: "opus")` with the brief path and the Figma URL.
3. Show the user a short summary of the visual direction (font, accent color, density, key patterns) and any `[가정]`. Don't stop unless the user wanted to approve visuals first.

### Phase 2: Foundation (A0)

**Mode: sub-agent.** Skip if screen-status shows A0 as `QA 통과` and nothing in Phase 0 invalidated it.

1. `Agent(subagent_type: "frontend-engineer", model: "opus")` — area A0, with the design-system path. Expect it to take a while; run it in the foreground since everything waits on it.
2. `Agent(subagent_type: "ui-qa", model: "opus")` on A0 (Q3, Q4, Q6, Q8, Q9, Q10 for common components and shell + mechanical checks).
3. Critical/Major issues → re-invoke the foundation engineer with the issue list → QA re-check. **At most 2 rounds.** If a Critical remains, stop and report to the user — parallel areas on a broken foundation multiply the damage.
4. Create or update `docs/ui/screen-status.md` (template below).

### Phase 3: Areas (A1–A4)

**Mode: agent team.** Pick this run's areas from the brief (default: all four; A2 Career first if the user wants a smaller run, since every other pillar depends on career data).

**Team mode:**
```
TeamCreate(team_name: "resumate-ui", members: [
  frontend-engineer ×(number of areas, max 3 at once), ui-qa, ui-designer — each with its agent definition + model "opus"])
TaskCreate(tasks: [
  per area: "Implement {area}: {screen IDs}" (engineer),
  per area: "QA {area} incrementally" (ui-qa, starts on first 'S-xx ready' message),
  "Answer visual questions" (ui-designer)])
```
- Engineers message ui-qa per screen as it lands; ui-qa sends issues straight back.
- Requests for foundation changes come to you (leader). Apply small ones yourself or batch them into a foundation re-invoke between areas — never let two engineers edit `components/common/`, `types/db.ts`, or `lib/` concurrently.
- With four areas, run three in parallel and start the fourth when one finishes.

**Fallback (no team tools):**
1. In one message, call up to three area engineers with `run_in_background: true`, `model: "opus"`, each with its area and screen list. Each writes its report, including "파운데이션 요청".
2. As each finishes, call ui-qa on that area right away (don't wait for the others).
3. Collect foundation requests from all reports, apply them via one foundation re-invoke, then re-invoke area engineers with their QA issues (in parallel when independent). At most 2 QA rounds per area.

### Phase 4: Integration QA

**Mode: sub-agent.** `Agent(subagent_type: "ui-qa", model: "opus")` across everything built: Q5 cross-area routes (flows FL-09, FL-10, FL-13, FL-15, FL-16, FL-17 span areas), C-09 → C-10 return paths, shell badges/breadcrumbs, a full build. Route remaining issues once; whatever is left after that is reported, not looped.

If a browser tool is available, also open the dev server yourself (`pnpm dev`, run in the background) and look at L-01 plus one screen per area at desktop and narrow widths; note anything visibly broken.

### Phase 5: Status and report

1. Update `docs/ui/screen-status.md`.
2. In team mode, shut down members and `TeamDelete`. Keep `_workspace/ui/` (audit trail).
3. Report to the user in Korean: what was built (screens per area, how to run: `pnpm dev`, `?state=` preview), QA result (open issues by severity), `[UI-가정]` count, and the **기획 확인 필요** list — those questions go to the user, and answering them is planning work (`resumate-planning`), not UI work.
4. Ask for feedback on the result and on the team setup. Harness-level feedback → update the relevant agent/skill and log it in `.claude/harness/CHANGELOG.md` (AGENTS.md only holds a pointer).

## docs/ui/screen-status.md template (Korean)

```markdown
# 화면 구현 현황
- 기준 기획: PRD vX / 플로우 vX / AI vX / 데이터 모델 vX
- 디자인 시스템: vX · 최종 갱신: YYYY-MM-DD
| 화면 ID | 화면명 | 영역 | 라우트 | 상태 (미착수 / 구현 중 / 구현 완료 / QA 통과) | 열린 이슈 | 마지막 QA |
## 기획 확인 필요 (누적)
## [UI-가정] 요약
```

## Data flow

```
docs/planning/* ─→ [ui-designer] ─→ docs/ui/design-system.md
                                          │
                  [frontend-engineer A0] ←┘ ─→ tokens, shell, common, types, data layer
                          │                         ↑ requests
                          ↓                         │
        ┌──────── [engineer A1..A4 in parallel] ────┘
        │   'S-xx ready' ↓        ↑ issues
        │            [ui-qa] ─────┘
        ↓
  [ui-qa integration] ─→ docs/ui/screen-status.md ─→ report (+ 기획 확인 필요 → user / resumate-planning)
```

## Error handling

| Situation | Response |
|-----------|----------|
| A member fails | Re-invoke once with the same inputs. If it fails again, continue without that area/screen and mark it `미착수` with the reason in screen-status and the report |
| Foundation still has a Critical after 2 rounds | Stop before Phase 3; report the issue and ask the user how to proceed |
| Scaffold or install fails (network, Node version) | Report the exact command and output; don't switch package manager or libraries silently |
| Two areas need conflicting changes to a common component | Don't pick silently — ask ui-designer (visual) or record it as `기획 확인 필요` (behavior), keep both callers working meanwhile |
| Spec gap or contradiction | Conservative implementation + `[UI-가정]` + 기획 확인 필요. Never edit `docs/planning/` from this harness |
| An engineer starts wiring real Supabase or Claude calls | Stop it and redirect to the mock data layer; backend is out of scope |

## Test scenarios

### Normal flow
1. User: "UI 작업 시작하자"
2. Phase 0: no `docs/ui/`, no `package.json` → initial run
3. Phase 1: design system written (Pretendard, one accent, AI state patterns); `[가정]` brand color reported
4. Phase 2: scaffold + tokens + shell + C-01~C-10 + mocks; QA round 1 finds 3 Major (enum mismatch in `types/db.ts`, missing `?state=limit`, drawer without focus trap) → fixed → round 2 clean
5. Phase 3: A2, A3, A4 in parallel, then A1; per-screen QA; foundation requests batched once
6. Phase 4: integration QA finds a dead link from S-39 card to S-31 → fixed
7. Phase 5: screen-status shows all Must screens `QA 통과`; report lists 4 기획 확인 필요 items

### Partial re-run flow
1. User: "기획에서 상세 내용 편집 화면이 바뀌었어, 반영해줘"
2. Phase 0: planning flows version is newer than screen-status → changed screens S-35, S-36 (and `types/db.ts` field change)
3. Foundation engineer updates `types/db.ts` → A2 engineer updates S-35/S-36 → ui-qa Q1–Q6 on those screens
4. screen-status updated with the new planning version

### Error flow
1. Phase 3: the A4 engineer fails twice (dnd-kit build error)
2. A2/A3 continue; A4 marked `미착수 — 빌드 오류` with the error output
3. Integration QA skips A4 routes and notes it
4. Report suggests "보드 화면만 다시" as the next step
