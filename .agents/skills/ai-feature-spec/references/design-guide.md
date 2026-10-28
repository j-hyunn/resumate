# AI Design Decision Guide

Read this when a design card calls for a judgment call.

## 1. Context injection vs. RAG

| Situation | Choice |
|-----------|--------|
| One user's full experience and project data is at most tens of thousands of tokens | **Full injection.** No retrieval misses and simple to build. Most personal career data falls here |
| Attachments (portfolios, long 경력기술서) pile up to hundreds of thousands of tokens or more | Consider a summary layer first (store per-item summaries); if still too large, pgvector retrieval |
| Searching across users or public data (e.g. a bank of interview questions per role) | RAG fits |

Write the conclusion on the card along with why. If you choose RAG, ask data-architect for an embedding storage structure.

## 2. Single call vs. chain

- Split into a chain when a step's result needs to be stored and reused, or when the user needs to confirm in between. Example: structure JD → (store) → match analysis → application direction.
- Single-shot generations (one question, one piece of feedback) are a single call.
- Splitting steps leaves intermediate results as evidence, which makes debugging and evaluation easier.

## 3. Model choice

| Task | Default |
|------|---------|
| Parsing, classification, short extraction | claude-haiku-5-5 |
| Insights, chat, question generation, feedback | claude-sonnet-5-5 |
| Deep reasoning with low call frequency, such as a comprehensive report | consider claude-opus-5-5 |

Compute per-user cost as call frequency × unit price and compare it against the PRD ceiling. Leave a note that exact prices get confirmed at implementation time via the `claude-api` skill.

## 4. Structured output

Outputs that are rendered on screen or stored are received as a JSON schema (structured output via tool use). Include `schema_version` in the schema so past results stay readable after the schema changes.

## 5. Guardrail checklist

- **Hallucination**: instruct not to generate experience or numbers absent from user data + make `evidence` mandatory + output unsupported items as "needs confirmation"
- **Prompt injection**: JDs and resumes are external text. Inject user data separately from instructions so directives inside them are not followed
- **Privacy**: how much raw text is kept in logs; handling third-party info (e.g. interviewer names)
- **Tone**: feedback is specific and actionable; no personal attacks
- **Failure**: on timeout or schema mismatch, retry once → show the user a retry button

## 6. Mock interview design elements

- Question sources: JD required qualifications, the user's projects (verification questions), general role questions, 인성 questions — decide the mix
- Follow-ups: when an answer is vague or missing numbers/role. Set a maximum depth
- Example rubric: structure (STAR), specificity (numbers, role), job relevance, delivery — score per criterion + quoted evidence + improved example
- Format: text MVP first, voice later is the common path. Voice adds STT/TTS cost and latency, so present trade-offs as `[결정 필요]`
- Session report: feedback per question + overall strengths/improvements + recommended next practice
