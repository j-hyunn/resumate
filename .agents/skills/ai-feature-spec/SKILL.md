---
name: ai-feature-spec
description: "Guide for writing and revising Resumate AI feature specs. LLM design for the Resumate AI writing chat (STAR and deliverable drafting), JD fit insights (JD used as raw text — AI-01 requirement extraction retired 2026-11-14), the 자기소개서 drafting chat, and career chat — input context, processing steps, provider-neutral model tier (BYOK: OpenAI / Gemini / Claude), prompt strategy, canonical output JSON schema, evidence validation, evaluation criteria, token/latency estimates, provider error causes, guardrails. Use for AI feature design, prompt design direction, LLM architecture, deciding whether RAG is needed (planned, CL-Q1), and AI spec revisions. Korean triggers: AI 기능 설계, 프롬프트 설계, LLM 구조, RAG 필요성, 자기소개서 작성 대화, AI 명세 수정. Not for implementing prompt code or writing API integration code."
---

# AI Feature Specs

Write one "design card" per AI feature. An implementer should be able to build the prompt and API call from the card alone.

## Order of work

1. Pull every feature ID from the PRD that involves AI.
2. Write a design card per feature (or revise the existing card — the AI spec is at v4.x with common sections C-1 … C-14 that every card relies on). For design decisions that need judgment, read `references/design-guide.md`.
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
- Model tier: `light` / `default` / `heavy` + reason (per-provider model IDs come from the C-10.1 mapping, not from the card)
- Response mode: streaming / sync / async
- Prompt strategy: role, key instructions, how evidence is cited, whether few-shot is needed (do not write the full prompt)
- Output schema:
  ```json
  { "schema_version": 1, ... , "evidence": [{"source": "experiences", "id": "...", "quote": "..."}] }
  ```
- Storage: table/field, whether history is kept on regeneration
- Quality bar: what a good output looks like / how it is evaluated
- Failure modes & guardrails:
- Token/latency estimate: N input tokens + M output tokens per call (feeds the usage meter estimate, section 7), latency per provider tier, and whether it fits the Gemini free tier's rate limits
- Decisions needed:
```

## Key considerations per feature

| Feature | Easy to miss |
|---------|-------------|
| Career structuring | Don't fill in numbers or dates that aren't in the source. Leave uncertain fields empty and ask the user to confirm |
| JD analysis | Structure the JD itself first (required/preferred qualifications, role, seniority) and store it, so insights and 자기소개서 drafting can reuse it |
| Insights & application direction | A fit score with no evidence loses trust. Output the matching evidence per requirement |
| Career chat | Which context (full profile, a specific JD, previous insights) gets injected into the conversation, and how conversation length is managed |
| 자기소개서 drafting chat | At most 3 questions per draft turn (CL-10), the user's char limit per question, answer titles (CF-6), evidence per question; keep career-context assembly one swappable point with per-item source aliases so RAG can replace it (CL-Q1) |

## Quality bar

- Every card has an output schema, and every field in it is linked to a storage location or a screen element.
- Every judgment shown to the user (score, strength, gap, evaluation) has an `evidence` field.
- Every `entity.field` in the input context exists in the data model (verified in review). Use the data model's table names (plural snake_case, e.g. `projects.role`).
- There is a token estimate per call and per typical month, the feature works on all three providers (structured output within the canonical-schema rules of C-10.2), and failures map to the 7 causes of C-11. There is no service cost ceiling to compare against (BYOK); token efficiency is the user's cost, so justify large contexts.
- Revisions in a decision cycle cite the decision ID next to changed text and in the change log; a changed output schema bumps `schema_version` and is announced to data-architect and ux-planner.
