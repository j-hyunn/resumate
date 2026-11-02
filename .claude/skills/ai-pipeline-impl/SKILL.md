---
name: ai-pipeline-impl
description: "Guide for implementing Resumate AI features in code on the BYOK provider adapter layer (OpenAI / Gemini / Claude with the user's own key): tier → model mapping, canonical JSON schema → per-provider structured output, stream/usage/error normalization to the 7 failure causes, prompts with prompt_version, Career Context Pack and JD context builders with aliases (EXP-n, PRJ-n, DET-n, Sn, REQ-n), evidence validation V-1 … V-9 and number guard, placeholder rules, evidence_links storage mapping, input_hash reuse, prompt caching, streaming JSON → SSE block events, key verification calls, and fixture-based tests. Use whenever implementing or fixing AI-01 … AI-12 pipelines, provider adapters, prompts, validators, or LLM output parsing. Korean triggers: AI 기능 구현, 공급자 어댑터, 프롬프트 구현, 근거 검증 구현, LLM 호출 코드, 구조화 출력, 스트리밍 파싱, AI 작성 대화 구현, 면접 평가 구현, 키 검증 호출. Not for planning-stage AI feature design (use ai-feature-spec)."
---

# AI Pipeline Implementation

The AI spec (`docs/planning/03-ai-features.md`) defines each feature's input, output, and checks; C-10 … C-13 define the BYOK provider layer. This skill is how to implement them so the checks can't be bypassed. Before writing SDK code, read the current docs of the provider SDK you touch (load the `claude-api` skill for the Anthropic adapter).

## Module shape (per feature `AI-xx`)

```
src/server/ai/
  prompts/AI-xx/index.ts      export const PROMPT_VERSION = 'AI-xx.v1'; system blocks; buildMessages(pack, input)
  schemas/AI-xx.ts            zod schema of the model output (exactly the spec's JSON keys) + canonical JSON schema
  pipelines/AI-xx.ts          run(input, deps) → ValidatedResult   (or async generator of events for streaming)
  providers/                  adapters: anthropic.ts, openai.ts, gemini.ts + shared types (C-10)
```

`deps` = `{ llm, now }` so tests inject a fake. `llm` is the provider-neutral client the job runner builds for the job's fixed provider, tier, and decrypted key. Pipelines never see the key, never pick a provider, and don't import Next.js or Supabase; the job runner (api-engineer) loads data, calls `run`, and persists.

## Context builders (C-1, C-2)

- Build the pack from **complete** rows only, following the pack inclusion rules (a draft parent excludes its children). Exclude name and contact info (C-7).
- Assign aliases in a stable order (`EXP-1`, `PRJ-1`, `DET-1`, …; JD sentences `S1` …). Return `{ text, aliases: Map<alias, {sourceType, id, fields}> }` — validators and storage need the map.
- `career_snapshot_hash` = hash of the pack content; `input_hash` per C-6. Same inputs ⇒ same hash, so ordering must be deterministic.

## Calling the model (provider adapters, C-10)

Every feature runs on the user's **active provider** with the user's own key (BYOK). Feature code builds one provider-neutral request; the adapter for the job's fixed provider does the rest.

- **Common request**: `{ tier, systemBlocks, userBlocks, outputSchema | null, stream, maxOutputTokens, reasoningLevel }`. Feature cards give the tier (`light` / `default` / `heavy`), never a model ID.
- **Model mapping (C-10.1)**: one fixed table tier → model per provider in `providers/models.ts`. **No automatic fallback to another model or provider (D-31)** — not on outage, not on refusal.
- **Structured output (C-10.2)**: write one canonical JSON schema per feature (no top-level `oneOf`, discriminators as string enums, optional values as explicit `null`, depth ≤ 5). Each adapter converts it: OpenAI strict JSON Schema, Gemini `responseSchema` (OpenAPI subset, `propertyOrdering`), Claude `output_config.format`. Don't use a forced `tool_choice` (current Claude models reject it). Always re-validate the response with the zod schema (V-6): mismatch → one retry on the same provider and model, then `schema_invalid`.
- **Errors (C-11)**: each adapter maps its provider's responses (C-11.2 table) to one `error_code` and its failure cause: `rate_limited`, `daily_quota_exhausted`, `billing_required`, `key_invalid`, `model_not_available`, `provider_unavailable`, `input_too_long`, `safety_blocked` (refusal / safety block). Also extract `Retry-After` and, for Gemini daily quota, the next reset time (computed with the tz database, never hard-coded). Retrying is the job runner's decision (C-11.3), not the adapter's — the adapter returns a typed error and never sleeps.
- **Streaming (C-10.3)**: normalize provider stream events to common `delta` / `done` / `error`. An error after the first token is not retried (keep the partial output).
- **Usage (C-13)**: normalize provider usage to `{ inputTokens, cachedInputTokens, cacheWriteTokens, outputTokens, reasoningTokens, usageSource }` for every call, including failed calls that report tokens. The runner writes one `ai_usage_records` row per attempt.
- **Caching (C-8, C-10.3)**: keep the order common system → feature system → career pack → JD → variable input for every provider. Only the Claude adapter adds cache breakpoints, and only Claude gets a cache warm-up call before parallel calls.
- **Free tier (C-12)**: the adapter itself is the same; the runner switches to sequential steps and spacing. Pipelines that run parallel calls on paid tier must also have a sequential form.
- **Key verification (C-10.5)**: each adapter implements the two-step check (model lookup, then a 1–5 token generation on the `default` tier model) and returns the cause; no retries.
- **Secrets**: the decrypted key exists only inside the adapter call. Never log it, put it in errors, or return it (NFR-KEY-05). Log only C-7 fields plus provider and tier.

## Validation (C-3) — pure functions in `src/server/ai/validation/`

Run in this order, after parsing and before anything is stored or streamed as final:

| Step | Rule | Implementation notes |
|------|------|----------------------|
| V-1 | `ref` exists in this call's alias map | drop evidence |
| V-2 | `field` allowed for its `source_type` | table from C-3 as a typed constant |
| V-3 | `quote` is a substring of the source field after normalization | normalize whitespace + punctuation; partial-match threshold is a named constant (`[가정]` 70%); on adjust set `quote_adjusted: true` |
| V-8 | `learnings` evidence only in C-9 allowed uses, never the sole evidence | runs before V-4 so the count is right |
| V-7 | evidence within the selected sources (AI-03/AI-04) | needs the selection set as input |
| V-4 | items with 0 evidence: drop / downgrade to `no_evidence` / mark `evidence_check_needed` per item kind | item kind decides the action |
| V-5 | every number in generated text exists in pack/JD/answers or the server-computed allowed list | one regeneration request per block, then replace with `[수치 확인 필요]`; numbers only in `learnings` don't count |

- Feature cards can add their own rules (e.g. AI-12 defines V-9 for writing-chat field sources). Read the card and implement those next to the common ones.
- Each validator returns `{ value, stats }`; combine stats into `validation_report` (counts only, no text).
- Placeholders (C-5) are produced by the prompt and preserved by validators — test that a placeholder isn't stripped as an unsupported claim.

## Storage mapping (C-3)

`toStorage(validated, aliases) → { resultJson, evidenceLinks[] }`: remove every `evidence` array, give each item its `item_key` (`block_id` for drafts; path keys like `strengths.0` otherwise), convert aliases to UUIDs (`ref` → `source_id`, `field` → `source_field`), and fill `source_snapshot_at`. AI-12 is the exception: field sources stay inside `writing_chats.structured_draft`, not `evidence_links` (DM-15).

## Streaming (C-6)

- Stream the structured-output JSON text, parse incrementally, and emit `block_started` / `block_delta` / `block_completed` as blocks close; run block-level validation on `block_completed`, full validation before `validated` / `done`.
- Never emit unvalidated numbers or evidence as final. Deltas are provisional text; the `validated` event carries the authoritative content.

## Tests

- Validators: table-driven, one case per rule branch, plus Korean-specific cases (full-width punctuation, spacing variants, numbers like `30%`, `3배`, `1,200명`, `2년 6개월`).
- Pipelines: fake `llm` returning recorded outputs (`__fixtures__/AI-xx/*.json`), including invalid outputs (bad ref, invented number, missing evidence) to prove they're caught.
- Adapters: a fake SDK / fetch per provider with recorded responses for success, streaming, usage, and every C-11.2 error row. No real provider calls with any key.
- Fixtures are synthetic. No real résumé text, no real keys.

## Notes template (`02_ai-pipeline-engineer_notes.md`, Korean)

```markdown
# {slice} AI 파이프라인 구현 노트
## 기능별 모델 등급·prompt_version (공급자별 변형이 있으면 접미사)
## 출력 스키마 ↔ 저장 매핑
## 검증 규칙 적용 범위 (V-1~V-8, 기능별)
## 이벤트·진행 단계·오류 코드 (api-engineer와 합의한 내용)
## 테스트·픽스처
## 스펙 차이·가정 (임계값 등 상수)
```
