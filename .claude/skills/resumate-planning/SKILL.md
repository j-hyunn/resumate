---
name: resumate-planning
description: "Orchestrator for the Resumate (AI career management service) planning team. Coordinates a five-member team — product planner, UX, AI feature, data, consistency reviewer — to produce the PRD, user flows & screen specs, AI feature specs, data model, and decision log under docs/planning/. Always use when starting or refining planning, gathering requirements, defining the MVP, writing feature specs, or planning career data, application projects (JD insights, documents), the Resumate AI writing chat, BYOK AI connection, or mock interviews. Follow-ups: always use for planning revisions, applying user decisions (decision cycles such as CR-x / PA-x), turning a Figma design into planning decisions, applying backend spec gaps or UI QA questions to the documents, partial re-runs (e.g. only the AI interview part, only the data model), re-reviews, and improving previous planning output. Korean triggers: 기획 시작, 기획 구체화, 요구사항 정리, 서비스 설계, MVP 정의, 기능 명세, 기획 수정, 보완, 업데이트, 다시 실행, 결정 사항 반영, 피그마 기획 반영, spec-gaps 반영, UI 기획 질문 반영, 기획 재검토, 'AI 면접 부분만 다시', '데이터 모델만 수정'. Not for implementation (writing code, DB migrations, deployment — resumate-ui / resumate-backend)."
---

# Resumate Planning Orchestrator

Coordinate the five-member planning team to produce and update Resumate's planning document set. You (the main session) are the leader.

## Execution mode: agent team (hybrid fallback when team tools are missing)

- **Default:** build the team with `TeamCreate` + `TaskCreate` + `SendMessage`. Teammates align field names and response modes directly with each other.
- **Fallback:** if the session has no `TeamCreate`, run the same flow with the `Agent` tool (sub-agents) + file-based requests. Instead of teammate messages, the leader passes each document's "requests to other teammates" section into the next step as input. Each phase below lists its fallback path.

## Team

| Teammate | Agent definition | Skill | Output |
|----------|------------------|-------|--------|
| product-planner | `.claude/agents/product-planner.md` | prd-writing | `_workspace/01_product-planner_prd.md` |
| ux-planner | `.claude/agents/ux-planner.md` | ux-flow-spec | `_workspace/02_ux-planner_flows.md` |
| ai-feature-designer | `.claude/agents/ai-feature-designer.md` | ai-feature-spec | `_workspace/02_ai-feature-designer_ai-spec.md` |
| data-architect | `.claude/agents/data-architect.md` | data-model-spec | `_workspace/02_data-architect_data-model.md` |
| spec-reviewer | `.claude/agents/spec-reviewer.md` | spec-consistency-review | `_workspace/03_spec-reviewer_review.md` (decision cycle: `_workspace/03_spec-reviewer_review_{cycle}.md`) |

The `_workspace/01_*` / `02_*` files are the working originals of the four documents and stay the edit target in every run; a decision cycle adds a cycle folder for its request/reply files (below).

Spawn every teammate with `model: "opus"`. Every teammate reads `.claude/skills/resumate-planning/references/product-context.md` before working.

All paths are relative to the repository root (`/Users/jehyun/Resumate`).

**Language:** this skill and the agent definitions are in English, but all deliverables and everything you say to the user are in Korean.

## Workflow

### Phase 0: Context check

1. Check whether `_workspace/` and `docs/planning/` exist. Read `docs/planning/README.md` (versions, open review issues, remaining decisions) and the latest cycle in `decisions.md`.
2. Branch:
   - **Neither exists** → initial run. Start at Phase 1.
   - **Exists + a set of decisions or design input to apply** (the user settled questions, gave a Figma design, or asked to apply backend `spec-gaps.md` / UI 기획 확인 필요) → **decision cycle** (below). This is the usual case now.
   - **Exists + partial revision request** (e.g. "only redo the mock interview part") → partial re-run. Use the table below to pick who to re-invoke; run only that part of Phase 3 + Phase 4 (relevant boundaries only).
   - **Exists + re-review only** ("기획 재검토") → Phase 4 alone on the named documents/boundaries, with a new cycle slug for the review file.
   - **Exists + new planning direction altogether** → new run. Move the planning files in `_workspace/` (everything except `_workspace/backend/` and `_workspace/ui/`, which belong to the backend and UI harnesses) to `_workspace_{YYYYMMDD_HHMMSS}/`, then start at Phase 1. Before overwriting `docs/planning/` with new results, confirm git is tracking the changes.

| Revision scope | Re-invoke | Then update |
|----------------|-----------|-------------|
| Target, MVP scope, priorities | product-planner | every affected teammate → reviewer |
| Screens, flows | ux-planner | reviewer (B1, B2, B5, B6) |
| AI features (chat, insights, interview, providers, etc.) | ai-feature-designer | data-architect if fields change → reviewer (B3–B6, B11) |
| Data structure | data-architect | reviewer (B2–B4, B7, B10) |
| User answered a `[결정 필요]` | owner of the document the answer affects | reviewer (affected boundaries + B12) |

On a partial re-run, include the existing deliverable paths and the user's feedback verbatim in the prompt.

### Decision cycle

**Mode:** sub-agents (or team if available), same owners as the table above. Pick a short cycle slug (e.g. `career-redesign`, `project-add-figma`).

1. **Settle the input first.** Write `_workspace/00_input/planning-decisions-{slug}.md`: source (user message, Figma file/nodes, spec-gaps items, UI question IDs), base document versions, and a table `| ID | 결정 | 바뀌는 기존 결정 | 영향(PRD/UX/AI/DM) |` with stable IDs (`{PREFIX}-n`). Anything that is a real choice and not yet answered goes to the user via `AskUserQuestion` (recommendation first) **before** owners start — owners apply decisions; they don't make them.
   - Figma input: read the frames (load `figma:figma-design-to-code` before `get_design_context`, or use `get_screenshot`), list every difference from the current UX spec, and turn each into a decision row or "Figma 자리표시자 — 기획 유지". If Figma can't be read, ask the user for screenshots.
   - Backend / UI input: quote the gap or question ID (`spec-gaps` ⑰, `UQ-n`, `Q53-n`) so the cycle can be traced back.
2. **Requests by document.** Owners of upstream documents write requests for the others into `_workspace/{slug}/{prd|ux|ai}_requests.md`; data-architect replies in `_workspace/{slug}/dm_replies.md` (the same hub pattern as Phase 3 fallback). Order: product-planner → ux-planner + ai-feature-designer in parallel → data-architect → re-align if names changed.
3. **Versions.** Each changed document gets a minor version bump and a change-log entry that cites the decision IDs; text changed by the cycle carries `(v{N}, {ID})` markers so implementers can grep it.
4. **Review.** spec-reviewer reviews only the boundaries the cycle touched, into `_workspace/03_spec-reviewer_review_{slug}.md`, with issue IDs `R-{SLUG-PREFIX}-n`. Same 2-round limit as Phase 4. Decisions the review raises go to the user, then back to step 1 as follow-up rows in the same decisions file.
5. **Consolidate** (Phase 5) and add to `decisions.md`: a "사용자 확정" section for the cycle and a **"백엔드·UI 후속"** section in section 4 listing, per decision, what the backend (tables, RPCs, contracts, marked ★ when already-built code must change) and the UI (screens, components, copy) now owe. This list is what `resumate-ui` and `resumate-backend` read in their Phase 0 — be concrete.

### Phase 1: Brief & interview

1. Create `_workspace/00_input/`.
2. Summarize the user's idea and prior conversation context into `_workspace/00_input/brief.md`.
3. Ask the questions that most change the planning direction via `AskUserQuestion` (at most 4, in Korean; skip any already answered):
   - Primary target (new grads / experienced job changers / career switchers)
   - Career input method (manual entry / resume upload parsing / both)
   - Mock interview format (text / voice / text first)
   - Output scope (insights only / also 자기소개서 and 경력기술서 drafts)
   If the user says "you decide", record the recommendation as `[가정]` and proceed.
4. Append the answers to brief.md.

### Phase 2: Team setup & PRD

**Team mode:**
```
TeamCreate(team_name: "resumate-planning", members: [5 teammates, each with its agent definition file + model "opus"])
TaskCreate(tasks: [
  T1 Write PRD (product-planner),
  T2 User flows & screen specs (ux-planner, depends_on T1),
  T3 AI feature specs (ai-feature-designer, depends_on T1),
  T4 Data model (data-architect, depends_on T1),
  T5 Incremental review (spec-reviewer, depends_on T1),
  T6 Final review & consolidated decisions (spec-reviewer, depends_on T2 T3 T4)
])
```
product-planner writes the PRD and notifies the three teammates.

**Fallback:** one call to `Agent(subagent_type: "product-planner", model: "opus")`, with the brief path and output path in the prompt.

When the PRD is ready, share the MVP scope and the top decision-needed items with the user in one paragraph (don't stop).

### Phase 3: Parallel detailed design

**Team mode:** ux-planner, ai-feature-designer, and data-architect work in parallel.
- ux → data: confirm screen field names / ai → data: request input fields and output storage
- ai → ux: share response modes and output structures
- Scope questions go to product-planner
- spec-reviewer reviews boundaries as soon as deliverables land (incremental review)

**Fallback (order matters — data-architect is the hub that collects requests):**
1. In one message, call ux-planner and ai-feature-designer in parallel with `run_in_background: true`, `model: "opus"`. Instruct each to add a `## 다른 팀원에게 요청` (requests to other teammates) section at the end of its document (field/confirmation requests per recipient).
2. When both finish, call data-architect with the PRD + both request sections as input. Have it write the confirmed field names in a `## 요청 회신` (request replies) section.
3. If data-architect's replies rename any field, call the owner of that document once more to align.

### Phase 4: Consistency review

1. spec-reviewer checks all of B1–B11 and writes `03_spec-reviewer_review.md`.
2. Issues go to their owners — via SendMessage in team mode; in fallback, the leader re-invokes each agent with its issue list (in parallel when independent).
3. After fixes, the reviewer re-checks. **At most 2 rounds.** Anything left stays unresolved.
4. If a Critical issue is unresolved, put it at the top of the Phase 6 report.

### Phase 5: Consolidated deliverables

Write the final documents to `docs/planning/` (drop the working request/reply sections when moving them from `_workspace`):

| File | Source |
|------|--------|
| `docs/planning/README.md` | written by the leader — document list, versions, one-paragraph MVP, a dated 개정 line per cycle, review status per cycle, unresolved issue count, remaining decisions |
| `docs/planning/01-prd.md` | product-planner |
| `docs/planning/02-user-flows.md` | ux-planner |
| `docs/planning/03-ai-features.md` | ai-feature-designer |
| `docs/planning/04-data-model.md` | data-architect |
| `docs/planning/decisions.md` | reviewer's consolidated decision-needed list + log of settled decisions (date, decision, rationale) |

`decisions.md` accumulates across runs. Move decisions the user answered into "settled" with a date, and keep the per-cycle "백엔드·UI 후속" lists current (mark items done only when the other harness reports them done).

Rewrite the MVP paragraph in the README when a cycle changes what a menu or pillar does — UI and backend agents read it as their summary.

### Phase 6: Cleanup & report

1. In team mode, tell teammates to shut down and run `TeamDelete`.
2. Don't delete `_workspace/` (kept for audit trail).
3. Report to the user: documents produced (with new versions), MVP summary or what the cycle changed, unresolved issues, **the top 3–5 decisions the user needs to answer**, and the downstream work this created (counts from the "백엔드·UI 후속" list) with the next step: `resumate-ui` / `resumate-backend` to apply it.
4. Ask for feedback: what to fix in the output, what to change in team composition or flow. If the feedback is about the harness itself, update the relevant agent/skill and log it in `.claude/harness/CHANGELOG.md`. CLAUDE.md only holds a pointer, so don't edit it.

## Data flow

```
brief.md ─→ [product-planner] ─→ 01_prd
                                   │
            ┌──────────────────────┼──────────────────────┐
            ↓                      ↓                      ↓
      [ux-planner] ←─fields─→ [data-architect] ←─fields─→ [ai-feature-designer]
            │       ←─────────── response mode ──────────→     │
            ↓                      ↓                      ↓
        02_flows             02_data-model            02_ai-spec
            └──────────────────────┼──────────────────────┘
                                   ↓
                           [spec-reviewer] ─issues→ owners (≤2 rounds)
                                   ↓
                            docs/planning/*
```

## Error handling

| Situation | Response |
|-----------|----------|
| One teammate fails | Re-invoke once. If it fails again, proceed without that document and state "not written" and the affected boundaries in the README and report |
| PRD fails | Everything else depends on the PRD, so don't proceed. If it still fails after a retry, tell the user |
| Teammates reach conflicting conclusions | Don't delete either. Record both options side by side and raise it as `[결정 필요]` |
| Unresolved after 2 review rounds | Leave it as unresolved in the review report and README, then finish |
| A teammate tries to write code or migrations | Stop it and redirect to document writing. This team is planning-only |

## Test scenarios

### Normal flow
1. User: "Resumate 기획 시작하자"
2. Phase 0: no `_workspace/` → initial run
3. Phase 1: 4 interview questions; user answers only the target and says "you decide" for the rest → recommendations recorded as `[가정]`
4. Phase 2: PRD produced (F-P1/P2/P3 feature IDs, MVP path included)
5. Phase 3: UX, AI, and data documents produced; field names agreed
6. Phase 4: review round 1 finds 6 issues → fixed → round 2 leaves 1 Minor unresolved
7. Phase 5: 6 files created in `docs/planning/`
8. Phase 6: report with the top decision-needed items

### Partial re-run flow
1. User: "모의 면접은 음성으로 하기로 했어, 반영해줘"
2. Phase 0: existing output + partial revision → re-invoke ai-feature-designer (existing ai-spec path + the decision)
3. Audio storage fields needed → re-invoke data-architect; interview screens change → re-invoke ux-planner
4. Reviewer re-checks only B2–B6 and B11
5. Record "mock interview format: voice — settled (date)" in `decisions.md`

### Decision cycle flow
1. User: "피그마에 산출물 상세 화면 그렸어, 기획에 반영해줘" + Figma URL
2. Phase 0: documents exist + design input → decision cycle, slug `project-add-figma`
3. Leader reads the frames, lists 9 differences; 4 need the user (asked with recommendations → PA-1~PA-4), 5 are Figma placeholders (기획 유지)
4. Requests/replies under `_workspace/project-add-figma/`; PRD, UX, AI, DM each bump a minor version citing PA-n
5. Review `03_spec-reviewer_review_project-add-figma.md`: 15 issues → fixed in 2 rounds
6. `decisions.md` gets 3.x 사용자 확정 + 4.x 백엔드·UI 후속 (new RPCs ★, S-10/S-44/L-02 screens); report points to resumate-backend then resumate-ui

### Error flow
1. ai-feature-designer fails in Phase 3
2. Re-invoke once → fails again
3. Proceed to Phase 4 with the UX and data documents; B3–B6 and B11 marked "not reviewable"
4. Report states "AI feature specs not written — can be filled in next time with 'AI 기능 명세만 다시'"
