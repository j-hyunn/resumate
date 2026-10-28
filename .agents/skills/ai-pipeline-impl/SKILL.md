---
name: ai-pipeline-impl
description: "Guide for implementing Resumate AI features in code with the Anthropic SDK: model routing, prompts with prompt_version, Career Context Pack and JD context builders with aliases (EXP-n, PRJ-n, DET-n, Sn, REQ-n), structured output via tool use and zod, evidence validation V-1 … V-8 and number guard, placeholder rules, evidence_links storage mapping, input_hash reuse, prompt caching, streaming JSON → SSE block events, and fixture-based tests. Use whenever implementing or fixing AI-01 … AI-12 pipelines (JD extraction, insights, career description, cover letter, interview questions, answer evaluation, writing chat), prompts, validators, or LLM output parsing. Korean triggers: AI 기능 구현, 프롬프트 구현, 근거 검증 구현, LLM 호출 코드, 구조화 출력, 스트리밍 파싱, AI 작성 대화 구현, 면접 평가 구현. Not for planning-stage AI feature design (use ai-feature-spec)."
---

# AI Pipeline Implementation

The AI spec (`docs/planning/03-ai-features.md`) defines each feature's input, output, and checks. This skill is how to implement them so the checks can't be bypassed. Load the `Codex-api` skill before writing SDK code.

## Module shape (per feature `AI-xx`)

```
src/server/ai/
  prompts/AI-xx/index.ts      export const PROMPT_VERSION = 'AI-xx.v1'; system blocks; buildMessages(pack, input)
  schemas/AI-xx.ts            zod schema of the model output (exactly the spec's JSON keys) + JSON schema for the tool
  pipelines/AI-xx.ts          run(input, deps) → ValidatedResult   (or async generator of events for streaming)
```

`deps` = `{ llm, now }` so tests inject a fake. Pipelines don't import Next.js or Supabase; the job runner (api-engineer) loads data, calls `run`, and persists.

## Context builders (C-1, C-2)

- Build the pack from **complete** rows only, following the pack inclusion rules (a draft parent excludes its children). Exclude name and contact info (C-7).
- Assign aliases in a stable order (`EXP-1`, `PRJ-1`, `DET-1`, …; JD sentences `S1` …). Return `{ text, aliases: Map<alias, {sourceType, id, fields}> }` — validators and storage need the map.
- `career_snapshot_hash` = hash of the pack content; `input_hash` per C-6. Same inputs ⇒ same hash, so ordering must be deterministic.

## Calling the model

- Structured output via a single forced tool whose `input_schema` is the feature's JSON schema. Parse the tool input with the zod schema. Schema mismatch (V-6) → one retry, then fail with `schema_invalid`.
- Model per feature from the AI spec (Sonnet default; T-15: evaluation and chat start on Sonnet).
- Message order for caching (C-8): common system → feature system → career pack → JD → variable input. Put cache breakpoints after the pack and after the JD. Before parallel calls (AI-06 answers, AI-04 questions), send one first to warm the cache.
- Map SDK errors to C-6 `error_code`s: overloaded/5xx → `model_unavailable`, 429 → `rate_limited`, refusal stop reason → `refused`, abort → `timeout`.
- Record `usage` (input/output/cache tokens) and latency for the result meta. Log only C-7 fields.

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

- Stream the tool-input JSON, parse incrementally, and emit `block_started` / `block_delta` / `block_completed` as blocks close; run block-level validation on `block_completed`, full validation before `validated` / `done`.
- Never emit unvalidated numbers or evidence as final. Deltas are provisional text; the `validated` event carries the authoritative content.

## Tests

- Validators: table-driven, one case per rule branch, plus Korean-specific cases (full-width punctuation, spacing variants, numbers like `30%`, `3배`, `1,200명`, `2년 6개월`).
- Pipelines: fake `llm` returning recorded tool inputs (`__fixtures__/AI-xx/*.json`), including invalid outputs (bad ref, invented number, missing evidence) to prove they're caught.
- Fixtures are synthetic. No real résumé text.

## Notes template (`02_ai-pipeline-engineer_notes.md`, Korean)

```markdown
# {slice} AI 파이프라인 구현 노트
## 기능별 모델·prompt_version
## 출력 스키마 ↔ 저장 매핑
## 검증 규칙 적용 범위 (V-1~V-8, 기능별)
## 이벤트·진행 단계·오류 코드 (api-engineer와 합의한 내용)
## 테스트·픽스처
## 스펙 차이·가정 (임계값 등 상수)
```
