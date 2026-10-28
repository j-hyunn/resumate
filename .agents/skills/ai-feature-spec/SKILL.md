---
name: ai-feature-spec
description: "Guide for writing and revising Resumate AI feature specs. LLM design for career data structuring (resume parsing), JD analysis and fit insights, application direction, career chat, and AI mock interviews (question generation, follow-ups, answer evaluation and feedback) — input context, processing steps, model choice, prompt strategy, output JSON schema, evaluation criteria, cost/latency, guardrails. Use for AI feature design, prompt design direction, LLM architecture, deciding whether RAG is needed, interview evaluation rubrics, and AI spec revisions. Korean triggers: AI 기능 설계, 프롬프트 설계, LLM 구조, RAG 필요성, 면접 평가 루브릭, AI 명세 수정. Not for implementing prompt code or writing API integration code."
---

# AI Feature Specs

Write one "design card" per AI feature. An implementer should be able to build the prompt and API call from the card alone.

## Order of work

1. Pull every feature ID from the PRD that involves AI.
2. Write a design card per feature. For design decisions that need judgment, read `references/design-guide.md`.
3. Collect the cards' "input context" and send the field list to data-architect.
4. Share each card's "response mode" and "output schema" with ux-planner.
5. Pull elements shared across features (assembling user context, evidence format, guardrails) into a common section.

## Design card template

Write cards in Korean; translate the field labels below. Keep JSON keys in English.

```markdown
### AI-{number} {feature name}
- Related features: F-P2-01 / Related screens: S-07
- Purpose: what the user gets, in one sentence
- Trigger: when it is called (user action / data change / batch)
- Input context:
  | Source | entity.field | Required | Size estimate (tokens) |
- Processing: single call / chain (list steps) / tool-using agent
- Model: Codex-sonnet-5-5 etc. + reason
- Response mode: streaming / sync / async
- Prompt strategy: role, key instructions, how evidence is cited, whether few-shot is needed (do not write the full prompt)
- Output schema:
  ```json
  { "schema_version": 1, ... , "evidence": [{"source": "experiences", "id": "...", "quote": "..."}] }
  ```
- Storage: table/field, whether history is kept on regeneration
- Quality bar: what a good output looks like / how it is evaluated
- Failure modes & guardrails:
- Cost/latency estimate: N input tokens + M output tokens → about $X per call, about Y seconds
- Decisions needed:
```

## Key considerations per feature

| Feature | Easy to miss |
|---------|-------------|
| Career structuring | Don't fill in numbers or dates that aren't in the source. Leave uncertain fields empty and ask the user to confirm |
| JD analysis | Structure the JD itself first (required/preferred qualifications, role, seniority) and store it, so insights and interviews can reuse it |
| Insights & application direction | A fit score with no evidence loses trust. Output the matching evidence per requirement |
| Career chat | Which context (full profile, a specific JD, previous insights) gets injected into the conversation, and how conversation length is managed |
| Mock interview | Basis for each question (JD requirement / user's project), conditions for follow-ups, answer evaluation rubric, structure of the end-of-session report |

## Quality bar

- Every card has an output schema, and every field in it is linked to a storage location or a screen element.
- Every judgment shown to the user (score, strength, gap, evaluation) has an `evidence` field.
- Every `entity.field` in the input context exists in the data model (verified in review). Use the data model's table names (plural snake_case, e.g. `projects.role`).
- There is a cost estimate, and the per-user monthly cost is compared against the ceiling in the PRD's non-functional requirements.
