---
name: spec-consistency-review
description: "Guide for cross-checking consistency between Resumate planning documents. Compares PRD features ↔ screen specs, screen fields ↔ data model, AI input context ↔ data model, AI output schema ↔ storage ↔ screens, and term/MVP scope consistency, and logs issues. Use for planning reviews, document consistency checks, spec cross-validation, gap checks, and planning document audits. Korean triggers: 기획 리뷰, 문서 정합성 검사, 명세 교차 검증, 누락 확인, 기획 문서 점검. Not for code review (use code-review)."
---

# Planning Consistency Review

The core is **cross-checking boundaries**. Look at the connections between documents rather than how complete each one is on its own. Open the two documents being compared together and check whether each item on one side exists on the other and means the same thing.

## Boundary checklist

Review boundaries as they become comparable, as deliverables land.

| # | Boundary | How to check | When possible |
|---|----------|--------------|---------------|
| B1 | PRD Must features → screens | Does the UX matrix include every Must feature ID? | PRD + UX |
| B2 | Screen fields → data model | Does every `entity.field` in the screen specs exist in the table definitions, with a type that fits the screen's use? | UX + data |
| B3 | AI input → data model | Does every `entity.field` in the AI cards' input context exist? | AI + data |
| B4 | AI output → storage | Is there a defined table/jsonb for each output schema, with `schema_version`? | AI + data |
| B5 | AI output → screens | Is there a screen element showing each output schema field (especially evidence)? | AI + UX |
| B6 | Response mode match | Does the AI card's streaming/async match the screen spec's response mode? | AI + UX |
| B7 | Features → data | Does the data model matrix include every Must feature? | PRD + data |
| B8 | Terms | Is the same concept called different names across documents? (glossary is the reference) | All |
| B9 | MVP scope | Is a PRD `[보류]` feature designed as MVP in another document, or vice versa? | All |
| B10 | Privacy & deletion | Are the PRD's privacy requirements reflected in the data model's RLS and deletion policy? | PRD + data |
| B11 | Cost | Is the sum of AI cost estimates within the PRD's per-user cost ceiling? | PRD + AI |

## Severity

- **Critical** — not implementable, or a security problem (missing field, missing RLS, Must feature with no screen)
- **Major** — implementable but causes rework (name mismatch, response mode mismatch, scope contradiction)
- **Minor** — clarity problem (vague acceptance criteria, missing edge state)

## Review report template

Write the report in Korean; translate the headings below.

```markdown
# Resumate Planning Consistency Review (round {N})

## Summary
- Documents reviewed: (with versions)
- Issues: Critical N / Major N / Minor N, resolved N / unresolved N

## Results by boundary
| Boundary | Result | Issue IDs |

## Issues
### R-{number} [{severity}] {title}
- Boundary: B2
- Evidence: `02_ux-planner_flows.md` S-07 "experiences.role_title" ↔ `02_data-architect_data-model.md` experiences table has no such column (only `title` exists)
- Owner: data-architect or ux-planner
- Suggested fix:
- Status: open / fixed (verified) / unresolved

## Consolidated decisions needed
(All `[결정 필요]` items from every document, de-duplicated, with source document)
```

## Principles

- Assign exactly one owner. If either side could fix it, the "reference document" wins (data model for field names, PRD for scope) and the other side becomes the owner.
- At most 2 fix rounds. Anything left is handed over as unresolved.
- Never edit documents directly.
