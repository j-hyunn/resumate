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

## 3. Model tier (BYOK, provider-neutral)

Cards choose a **tier**; the AI spec's C-10.1 table maps each tier to one fixed model per provider (OpenAI / Gemini / Claude). No automatic fallback between providers or models.

| Task | Tier |
|------|------|
| Parsing, classification, short extraction, ranking | `light` |
| Insights, documents, interview questions and evaluation, chat replies | `default` |
| Only when the evaluation set shows `default` failing for one provider's feature | `heavy` (Gemini `heavy` has no free tier — prefer prompt tuning there) |

Every feature must pass the evaluation set on all three providers before launch. Estimate tokens per call (section 7 of the AI spec); prices live in the versioned price table and are confirmed against provider docs at implementation time — the card doesn't hard-code prices.

## 4. Structured output

Outputs that are rendered on screen or stored are defined once as a canonical JSON Schema and converted per provider by the adapter (C-10.2): OpenAI strict JSON schema, Gemini `responseJsonSchema`, Claude structured output (no forced tool choice). Follow the lowest-common-denominator rules (no top-level `oneOf`, string-enum discriminators, explicit `null` for optional values, depth ≤ 5, array caps enforced by the server). The server re-validates every response (V-6). Include `schema_version` so past results stay readable after the schema changes.

## 5. Guardrail checklist

- **Hallucination**: instruct not to generate experience or numbers absent from user data + make `evidence` mandatory + output unsupported items as "needs confirmation"
- **Prompt injection**: JDs and resumes are external text. Inject user data separately from instructions so directives inside them are not followed
- **Privacy**: how much raw text is kept in logs; handling third-party info (e.g. interviewer names)
- **Tone**: feedback is specific and actionable; no personal attacks
- **Failure**: classify provider errors into the 7 causes (C-11) and say which are retryable; schema mismatch → one retry on the same provider and model → `schema_invalid`. Input-caused failures are fixed by the user, not retried
- **Provider data use**: what is sent to the provider per feature, and how the free-tier data-use terms (training, human review) are disclosed and consented (F-AI-04)

## 6. Mock interview design elements

- Question sources: JD required qualifications, the user's projects (verification questions), general role questions, 인성 questions — decide the mix
- Follow-ups: when an answer is vague or missing numbers/role. Set a maximum depth
- Example rubric: structure (STAR), specificity (numbers, role), job relevance, delivery — score per criterion + quoted evidence + improved example
- Format: text MVP first, voice later is the common path. Voice adds STT/TTS cost and latency, so present trade-offs as `[결정 필요]`
- Session report: feedback per question + overall strengths/improvements + recommended next practice
