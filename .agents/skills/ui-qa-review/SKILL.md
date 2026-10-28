---
name: ui-qa-review
description: "Guide for verifying implemented Resumate UI against its specs by cross-comparison: screen spec (S-xx component rows, copy, states) ↔ code, data model ↔ types/db.ts ↔ component field usage, flows (FL-xx) ↔ routes and links, ?state= coverage for ST-xx states, design-token conformance, accessibility (keyboard, focus, labels, board without drag), narrow-screen behavior, plus lint/typecheck/build. Use for UI QA, screen review, spec-vs-implementation checks, UI regression checks after spec changes, and re-checking fixes. Korean triggers: UI QA, 화면 검수, 구현 검증, 스펙 대조, 화면 리뷰, UI 점검, 접근성 점검, 수정 재확인. Not for planning-document consistency (spec-consistency-review) or general code review of non-UI code (code-review)."
---

# UI QA by Cross-Comparison

The goal: find where the implementation and its sources disagree. Each author checks their own side; the bugs live at the boundaries, so always open both sides at once and compare row by row.

Read `.agents/skills/resumate-ui/references/ui-context.md` first.

## Order of work

1. **Scope:** the screens/area you were given. For a re-check, start with the open issues in the previous review.
2. **Mechanical checks first:** `pnpm lint`, `pnpm typecheck`, `pnpm build`. A failing build is a Critical issue on its own and can hide other problems; record the output.
3. **Run the boundary checks below** for each screen in scope.
4. **Write the review** and route each issue to one owner.

## Boundary checks

| ID | Left side | Right side | How |
|----|-----------|------------|-----|
| Q1 Spec rows | `02-user-flows.md` S-xx component table (+ referenced C-xx) | The screen's components | Walk every row: element present? shows the listed `entity.field`? action does what the row says? Missing row = Major (Critical if it's the screen's purpose) |
| Q2 Copy | Spec-quoted Korean text | Rendered strings | Exact match apart from interpolations. Paraphrase = Minor; changed meaning = Major |
| Q3 Types | `04-data-model.md` tables, columns, enum CHECKs | `src/types/db.ts` | Names and enum values identical; nothing extra that isn't in the model |
| Q4 Field usage | `types/db.ts` | Field access in components and `lib/data` | grep for property names not in the types, string literals for enum values that don't exist, UI-only fields leaking into db types |
| Q5 Routes | FL-xx flows, entry/exit points per S-xx | `src/app` route tree, `href`/`router.push` targets, query params (e.g. `?type=job`) | Every navigation lands on a real route with the right params; no dead links across areas |
| Q6 States | Spec states per screen + 3.0 common states | `?state=` values the screen handles | Each required state renders the right ST view and copy; AI failure copy follows `error_category`; usage-not-charged line present |
| Q7 AI mode | Screen spec's response mode + AI spec C-6 | Hook/component used | Sync/async/streaming matches; stage labels from the shared constant; stop/leave behavior as specified |
| Q8 Design system | `docs/ui/design-system.md` | Classes and components | No hard-coded colors or palette classes; common patterns reused rather than re-implemented; spacing/type from the scale |
| Q9 Accessibility | UX-8, design-system section 7 | DOM/behavior | Keyboard reachability, accessible names, dialog focus trap/restore, board moves without drag, live-region announcements |
| Q10 Narrow screens | L-01 narrow rules, T-8, UX-9 | Responsive classes/behavior | Drawer menu, board column tabs, mobile-complete tasks (viewing, interview answers, board moves, AI chat) |

Useful searches: `grep -rnE "#[0-9a-fA-F]{3,8}\b|rgb\(|bg-(red|blue|green|gray|slate|zinc)-[0-9]" src/` for raw colors; `grep -rn "\[UI-가정\]" src/` to list assumptions; collect all `href=` / `push(` targets and diff against the route tree.

When a browser tool is available to you, open the dev server and look at each `?state=` once; otherwise state checks are by reading code paths, and say so in the review.

## Severity

- **Critical:** build fails, a screen's main purpose doesn't work, data could be lost (autosave broken), AI would run without the user pressing a button, or a destructive action skips C-05.
- **Major:** a spec row/state missing, wrong field or enum, dead link, inaccessible core action.
- **Minor:** copy paraphrase, token/pattern drift, cosmetic narrow-screen issues.

## Review template (Korean)

Write to `_workspace/ui/{phase}_ui-qa_{scope}_review.md`:

```markdown
# UI QA — {범위} (라운드 {n})
## 요약 — Critical n / Major n / Minor n, 기계 검사 결과 한 줄
## 화면별 점검표 — | 화면 ID | Q1 | Q2 | Q3–4 | Q5 | Q6 | Q7 | Q8 | Q9 | Q10 | (✅ / ⚠️ / ❌ / —)
## 이슈 — | ID | 심각도 | 담당 | 화면 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
## 기획 확인 필요 — 스펙 자체의 모순·누락 (양쪽 인용)
## 재확인 결과 — | ID | 해결 / 미해결 / 재발 | 메모 |
## 기계 검사 출력 — lint / typecheck / build 요약
```

## Quality bar

- Every issue has both a spec reference and a code reference (`path:line`).
- Every screen in scope has a filled row in the checklist — "—" only where a check genuinely doesn't apply.
- Issue IDs (`UQ-n`) are never reused across rounds.
