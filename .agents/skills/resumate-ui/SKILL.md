---
name: resumate-ui
description: "Orchestrator for the Resumate UI team. Coordinates ui-designer, frontend-engineer (foundation + one per screen area), and ui-qa to turn the planning documents (docs/planning/) into a design system (docs/ui/design-system.md) and working Next.js + Tailwind + shadcn/ui screens that reach the backend through the data layer (with mock-backed ?state= previews), tracked in docs/ui/screen-status.md. Always use when starting UI work, building or designing screens, implementing the career/자기소개서 관리/지원 현황 screens, the Resumate AI panel, or applying a Figma design or brand tokens. Follow-ups: always use for UI revisions, re-runs, next screen batches, 'continue the UI', partial re-runs (e.g. only the career screens, only the board, only the design system), applying planning-cycle changes (decisions.md UI 후속) to code, browser checks of built screens, and fixing QA issues. Korean triggers: UI 작업, 화면 구현 시작, 디자인 시스템 만들기, 화면 만들어줘, 커리어 화면 구현, 피그마 반영, 보드 화면만 다시, UI 이어서, 다음 화면, UI 수정, 기획 변경 반영해서 화면 수정, 디자인 다시, QA 이슈 수정, 화면 브라우저 확인. Not for planning documents (resumate-planning) or backend work (Supabase migrations, Server Actions, Route Handlers, AI provider adapters — resumate-backend)."
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
2. Check the planning versions in `docs/planning/README.md` against the versions recorded at the top of `screen-status.md`. A newer planning version means some screens may be stale — list the changed screens before doing anything else. The fastest source is `docs/planning/decisions.md` section 4 ("백엔드·UI 후속" per planning cycle) plus the README's 개정 lines; fall back to the documents' change logs.
3. Check the backend side: `_workspace/backend/slices.md` and `spec-gaps.md` tell you which contracts exist. A screen whose planning version is ahead of the backend gets the "연결 대기" treatment (ui-context.md → "Data layer"), not a hand-made contract.
4. Branch:
   - **Nothing exists** → initial run: Phase 1 → 2 → 3 → 4 → 5.
   - **Design system + foundation exist, user asks for more screens / "이어서"** → run Phase 3 for the next areas or screens not yet `QA 통과` in screen-status, then 4 → 5.
   - **Partial revision** (feedback on specific screens, a planning change, a Figma design for one area) → re-invoke only the owners in the table below, then QA only the affected screens.
   - **Restart from scratch** (user explicitly asks) → move `_workspace/ui/` to `_workspace/ui_{YYYYMMDD_HHMMSS}/`, confirm with the user before deleting any code, then initial run.

| Revision scope | Re-invoke | Then |
|----------------|-----------|------|
| Visual language, tokens, Figma provided | ui-designer → foundation engineer (apply tokens) | ui-qa Q8 on all built screens |
| Common components, shell (L-01/L-02), types, data layer helpers | foundation engineer | ui-qa on foundation + affected areas |
| Specific screens | that area's engineer (existing report + feedback verbatim in the prompt) | ui-qa on those screens |
| Planning cycle landed (new UX/DM version, decisions.md UI 후속) | owners of the changed screens; foundation first if shared components, `types/db.ts`, or routes change | ui-qa Q1–Q7 + Q11 on changed screens |
| Backend wired a contract that was 연결 대기 | that area's engineer (switch the real branch, remove the marker) | ui-qa Q11 + browser check on those screens |
| Browser check only ("화면 확인해줘") | nobody — go straight to Phase 4 browser pass for the named screens | issues routed as usual |

**Run brief:** every run (not only the first) writes `_workspace/ui/{nn}_brief_{run}.md` — request, scope (screen IDs per area), Figma file/nodes, planning versions, backend contracts available. Number `{nn}` continues from the highest prefix in `_workspace/ui/`; agents number their outputs from the brief's prefix. This is what keeps the audit trail readable across runs.

### Phase 1: Design system

**Mode: sub-agent.** Skip if `docs/ui/design-system.md` exists and no visual feedback was given.

1. Write the run brief (above). If the user gave a Figma file, record file key + node IDs per screen in it.
2. `Agent(subagent_type: "ui-designer", model: "opus")` with the brief path and the Figma file/nodes. If Figma reads fail (MCP rate limit, access), ask the user for screenshots or exported values before letting the designer work from descriptions — guessed sizes and colors became QA churn last time.
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

**Mode: sub-agent + leader browser pass.**

1. `Agent(subagent_type: "ui-qa", model: "opus")` across everything built in this run: Q5 cross-area routes (find the cross-area flows in `02-user-flows.md` section 2 — e.g. data gate → career → return, L-02 ↔ L-01 navigation), C-09 → C-10 return paths, shell badges/breadcrumbs, Q11 data layer, a full build.
2. **Browser pass (required, by you):** start the dev server in the background (`pnpm dev`; the local backend must be running — `supabase start` if the backend harness set it up), open it with the available browser tool (built-in browser or Claude in Chrome — load its skill first; the `run` skill knows how to launch this app), sign in with a local test account (seed or one you create in local Supabase — never a real account), and click through every screen changed in this run against real data: the main task of the screen, one save, one AI action if a test key is configured, then desktop and narrow widths. Use `?state=` only for states real data can't produce. Record what you saw per screen.
3. Route remaining issues once (QA findings and browser findings together); whatever is left after that is reported, not looped.

If no browser tool is available or sign-in isn't possible, say so to the user, mark the screens `QA 통과 (mock·브라우저 미확인)` in screen-status, and list them — don't let "not clicked" disappear into a plain `QA 통과`.

### Phase 5: Status and report

1. Update `docs/ui/screen-status.md`.
2. In team mode, shut down members and `TeamDelete`. Keep `_workspace/ui/` (audit trail).
3. Report to the user in Korean: what was built (screens per area, how to run: `pnpm dev`, `?state=` preview), QA result (open issues by severity), what was and wasn't checked in a browser, `[UI-가정]` count, the **기획 확인 필요** list — those questions go to the user, and answering them is planning work (`resumate-planning`), not UI work — and the **백엔드 요청** list (`연결 대기` functions), which you also append to `_workspace/backend/spec-gaps.md` so the backend harness picks them up.
4. Ask for feedback on the result and on the team setup. Harness-level feedback → update the relevant agent/skill and log it in `.claude/harness/CHANGELOG.md` (AGENTS.md only holds a pointer).

## docs/ui/screen-status.md template (Korean)

```markdown
# 화면 구현 현황
- 기준 기획: PRD vX / 플로우 vX / AI vX / 데이터 모델 vX
- 디자인 시스템: vX · 최종 갱신: YYYY-MM-DD
| 화면 ID | 화면명 | 영역 | 라우트 | 상태 (미착수 / 구현 중 / 구현 완료 / QA 통과 (mock·브라우저 미확인) / QA 통과) | 열린 이슈 | 마지막 QA |
## 기획 확인 필요 (누적)
## 백엔드 연결 대기 — | 화면 ID | 데이터 함수 | 필요한 계약 (문서 위치) |
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
| An engineer edits backend-owned files (`src/server/`, `src/app/api/`, `src/lib/contracts/`, `supabase/`) or calls Supabase/actions from a component | Stop it; the change goes through `src/lib/data/*`, and a missing contract becomes `연결 대기` + 백엔드 요청 |
| Dev server or local backend won't start for the browser pass | Report the command and output, mark screens `QA 통과 (mock·브라우저 미확인)`; don't fake the check with SSR HTML |

## Test scenarios

### Normal flow
1. User: "UI 작업 시작하자"
2. Phase 0: no `docs/ui/`, no `package.json` → initial run
3. Phase 1: design system written (Pretendard, one accent, AI state patterns); `[가정]` brand color reported
4. Phase 2: tokens + shells + common components + data helpers; QA round 1 finds 3 Major (enum mismatch in `types/db.ts`, missing `?state=key-missing`, drawer without focus trap) → fixed → round 2 clean
5. Phase 3: A2, A3, A4 in parallel, then A1; per-screen QA; foundation requests batched once
6. Phase 4: integration QA finds a dead link from S-39 card to S-31 → fixed; browser pass signs in with a local test account and finds the S-14 save toast missing on narrow width → fixed
7. Phase 5: screen-status shows all Must screens `QA 통과`; report lists 4 기획 확인 필요 items and 1 백엔드 요청

### Partial re-run flow (planning cycle)
1. User: "산출물 상세 기획 바뀐 거 화면에 반영해줘"
2. Phase 0: UX v5.6 / DM v4.5 newer than screen-status; decisions.md 4.4 lists S-10, S-44, L-02, C-23 as UI 후속; `slices.md` shows the page-save RPC isn't built yet
3. Foundation engineer adds L-02 → A2 engineer updates S-10/S-44; page-save functions get a mock branch + `// 연결 대기 (DM v4.5 11.3)` → ui-qa Q1–Q7 + Q11 on those screens
4. Browser pass covers the parts backed by real data; screen-status updated with the new planning version and the 연결 대기 rows; 백엔드 요청 appended to spec-gaps

### Error flow
1. Phase 3: the A4 engineer fails twice (dnd-kit build error)
2. A2/A3 continue; A4 marked `미착수 — 빌드 오류` with the error output
3. Integration QA skips A4 routes and notes it
4. Report suggests "보드 화면만 다시" as the next step
