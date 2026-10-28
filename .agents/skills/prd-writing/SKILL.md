---
name: prd-writing
description: "Guide for writing and revising the Resumate PRD (product requirements document): personas, problem definition, functional requirements for the three pillars (career data / JD insights & chat / mock interview), MVP scope, MoSCoW priorities, success metrics, non-functional requirements, glossary. Use for PRD writing, requirements gathering, MVP scoping, feature prioritization, persona definition, and PRD revisions. Korean triggers: PRD 작성, 요구사항 정리, MVP 범위, 기능 우선순위, 페르소나, PRD 수정·보완. For screen design use ux-flow-spec; for DB design use data-model-spec."
---

# PRD Writing

The PRD is the reference for every planning document. Other teammates must be able to read only this document and know what to build, for whom, and how far.

## Order of work

1. Read `.Codex/skills/resumate-planning/references/product-context.md` and `_workspace/00_input/brief.md`.
2. Write personas and problems first. Features must come out of problems — if you start from a feature list, nice-to-haves slip into the MVP.
3. Write features per pillar as user stories.
4. Apply MoSCoW and draw the MVP line.
5. Fill in non-functional requirements, metrics, glossary, and the decision-needed list.

## MVP criterion

MVP = **the thinnest path that passes through each of the three pillars once**. Example: enter one experience → register one JD → view the insight → run one mock interview for that JD.
- Features not on this path are Should or lower.
- Features that reduce input friction (e.g. auto-fill from resume upload) decide drop-off at the first step of the path, so seriously consider them as Must candidates.

## Domain checkpoints

These are easy to miss. Each must end up in the PRD as a conclusion or a `[결정 필요]`.
- Target: new grads / experienced job changers / career switchers — which is the primary target?
- Career input: manual entry, resume (PDF/DOCX) upload parsing, external integrations such as LinkedIn
- JD input: pasted text, URL, image (screenshot)
- Outputs: insights only, or also drafts of 자기소개서 / 경력기술서?
- Mock interview format: text / voice, number of questions, follow-up questions, interview type (직무/인성)
- Privacy: collection consent, retention period, deletion scope on account deletion, notice that data is not used for AI training
- Cost model: free usage limits, monetization — may be left as `[결정 필요]`

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
### P2. JD insights & chat
### P3. AI mock interview
### Common (account, settings, privacy)

## 5. MVP scope
- In / out ([보류]) / reasoning for borderline items

## 6. Non-functional requirements
- Privacy & security / AI response time targets / per-user AI cost ceiling / availability

## 7. Success metrics
| Metric | Definition | Target | Pillar |
(e.g. career data completion rate, insight view rate per JD, mock interview completion rate, return rate)

## 8. Glossary
## 9. Decisions needed
| ID | Question | Options | Recommendation and reason |
## 10. Change log
```

## Quality bar

- Feature IDs (`F-P{pillar}-{number}`) never change once assigned. UX, AI, and data documents reference them.
- Acceptance criteria must be verifiable. "Easy to enter" (no) → "Uploading a resume PDF auto-fills experience and project entries, and the user can edit them" (yes).
- If a `[가정]` sits in the core of the PRD (primary target, MVP path), put it at the top of the decision-needed list.
