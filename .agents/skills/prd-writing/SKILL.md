---
name: prd-writing
description: "Guide for writing and revising the Resumate PRD (product requirements document): personas, problem definition, functional requirements for the two pillars (career data / JD insights & 자기소개서), MVP scope, MoSCoW priorities, success metrics, non-functional requirements, glossary. Use for PRD writing, requirements gathering, MVP scoping, feature prioritization, persona definition, and PRD revisions. Korean triggers: PRD 작성, 요구사항 정리, MVP 범위, 기능 우선순위, 페르소나, PRD 수정·보완. For screen design use ux-flow-spec; for DB design use data-model-spec."
---

# PRD Writing

The PRD is the reference for every planning document. Other teammates must be able to read only this document and know what to build, for whom, and how far.

## Order of work

1. Read `.agents/skills/resumate-planning/references/product-context.md`, `_workspace/00_input/brief.md`, and — in a decision cycle — the cycle's `planning-decisions-{slug}.md`. The PRD already exists (v4.x); revise it, don't restart it.
2. Write personas and problems first. Features must come out of problems — if you start from a feature list, nice-to-haves slip into the MVP.
3. Write features per pillar as user stories.
4. Apply MoSCoW and draw the MVP line.
5. Fill in non-functional requirements, metrics, glossary, and the decision-needed list.

## MVP criterion

MVP = **the thinnest path that passes through each of the two pillars once**. Example: enter one experience → register one JD → view the insight → draft one 자기소개서 for that JD.
- Features not on this path are Should or lower.
- Features that reduce input friction decide drop-off at the first step of the path, so seriously consider them as Must candidates (today that is the Resumate AI writing chat; resume upload parsing is `[보류]`).

## Domain checkpoints

These are easy to miss. Each must end up in the PRD as a conclusion or a `[결정 필요]`.
- Target: new grads / experienced job changers / career switchers — which is the primary target?
- Career input: manual entry, resume (PDF/DOCX) upload parsing, external integrations such as LinkedIn
- JD input: pasted text, URL, image (screenshot)
- Outputs: insights only, or also 자기소개서 drafts? (경력기술서 was removed 2026-11-08, CF-1)
- Mock interview: removed from the MVP (2026-11-08, RM-1) — don't reintroduce it without a user decision
- Privacy: collection consent, retention period, deletion scope on account deletion, notice that data is not used for AI training
- AI cost model: BYOK — the user pays their provider. Requirements cover key connection, provider/tier data-use consent, the usage meter (tokens + estimated cost, not a bill), and per-cause error guidance. Service-side usage limits and cost ceilings were dropped (D-12, D-17); only quality/safety caps (e.g. 40 messages per chat) remain. Monetization may stay `[결정 필요]`

## PRD template

Write the PRD in Korean; translate the headings below.

```markdown
# Resumate PRD v{N}

## 1. Overview
- One-line definition / problem we solve / why now, why AI

## 2. Target users
| Persona | Situation | Core need | Current alternative and its pain |
Primary target: {persona} — reason for the choice

## 3. Core scenario
Describe the MVP path step by step

## 4. Functional requirements
### P1. Career data management
| ID | User story | Acceptance criteria | Priority | Notes |
| F-P1-01 | {user} can {do what}, {why} | {verifiable condition} | Must | |
### P2. JD insights & 자기소개서
### AI connection (F-AI: keys, active provider, consent, usage meter, error guidance)
### Common (account, settings, privacy)

## 5. MVP scope
- In / out ([보류]) / reasoning for borderline items

## 6. Non-functional requirements
- Privacy & security (incl. key storage and provider data transfer) / AI response time targets per provider tier / token efficiency (no service cost ceiling under BYOK) / availability

## 7. Success metrics
| Metric | Definition | Target | Pillar |
(e.g. career data completion rate, insight view rate per JD, 자기소개서 save/copy rate, return rate)

## 8. Glossary
## 9. Decisions needed
| ID | Question | Options | Recommendation and reason |
## 10. Change log
```

In a decision cycle, cite the decision ID on every changed requirement (`(v4.6, PA-3)`) and record replaced decisions in the notes column, so implementers can trace why a line changed.

## Quality bar

- Feature IDs (`F-P{pillar}-{number}`) never change once assigned. UX, AI, and data documents reference them.
- Acceptance criteria must be verifiable. "Easy to enter" (no) → "Uploading a resume PDF auto-fills experience and project entries, and the user can edit them" (yes).
- If a `[가정]` sits in the core of the PRD (primary target, MVP path), put it at the top of the decision-needed list.
