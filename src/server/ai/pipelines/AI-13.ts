import { buildDeliverableChatContext, type DeliverableChatContext, type DeliverableChatTurnInput } from "../context-pack/deliverable-chat";
import type { ComposeStyle } from "../context-pack/deliverable-slots";
import { AiError, ProviderError, isAiError } from "../errors";
import type { Llm } from "../llm";
import { silentAiLogger, type AiLogger } from "../log";
import {
  AI13_COMPOSE_PROMPT_VERSION,
  AI13_EXTRACT_PROMPT_VERSION,
  AI13_REPLY_PROMPT_VERSION,
  composeSystemBlocks,
  composeUserBlocks,
  extractSystemBlocks,
  extractUserBlocks,
  replyNotices,
  replySystemBlocks,
  replyUserBlocks,
  type ReplyNotice,
} from "../prompts/AI-13";
import { toCanonicalJsonSchema } from "../providers/schema";
import type { AiCallResult } from "../providers/types";
import { Ai13BlockOutputSchema, Ai13ComposeOutputSchema, Ai13ExtractOutputSchema, type Ai13ComposeOutput } from "../schemas/AI-13";
import type { StoredBlock } from "../schemas/deliverable-draft";
import { draftPatch, factsPatch, type DeliverablePatch } from "../storage/deliverable-patch";
import { IncrementalJsonParser, JsonStreamError } from "../streaming/json-incremental";
import { generateStructured } from "../structured";
import {
  FACT_CHECKS,
  composeValidationContext,
  validateComposeOutput,
  validateDraftBlock,
  validateFactsOutput,
  violationSummary,
  type ComposeValidation,
  type FactCheck,
  type FactsReport,
  type FactRejection,
} from "../validation/v10";

/**
 * AI-13 산출물 AI 작성 대화 (AI spec v4.6 AI-13) — plain async functions the
 * writing-chat runner (api-engineer) calls; no request, DB, or after() here.
 *
 * 질문 턴 (plan "question"): `extract` ∥ `reply` (paid; free tier: reply then
 * extract, C-12), like AI-12. The runner applies `extract().patch` with
 * apply_structured_draft_patch.
 *
 * 초안 턴 (plan "compose"): `extract` → apply its patch (facts get UUIDs) →
 * rebuild the context from the returned structured_draft → `composeDecision`
 * → `compose` (stream of `draft_started` / `draft_block`, returns the RPC
 * patch and a fixed assistant message; no reply call) — or, when the draft is
 * not possible, `reply` with the decision's notices.
 *
 * Errors are thrown (ProviderError / AiError, C-11 codes); retry policy is the
 * runner's (C-11.3). Nothing here writes project_deliverables (NFR-AI-05).
 */

export const AI13_EXTRACT_TIER = "light" as const;
export const AI13_REPLY_TIER = "default" as const;
export const AI13_COMPOSE_TIER = "default" as const;
export const AI13_EXTRACT_CALL_KEY = "writing_chat.extract";
export const AI13_REPLY_CALL_KEY = "writing_chat.reply";
/** DM 11.3 / C-13: `call_key` …compose. */
export const AI13_COMPOSE_CALL_KEY = "writing_chat.compose";
export const AI13_EXTRACT_MAX_OUTPUT_TOKENS = 4096;
export const AI13_REPLY_MAX_OUTPUT_TOKENS = 2048;
/** 8,000-char draft + per-block source metadata (~20%) + JSON keys; Korean ≈ 0.7–1.0 token/char. */
export const AI13_COMPOSE_MAX_OUTPUT_TOKENS = 16000;
/** [가정] At most one extra compose call per turn — the V-6 schema retry or the V-10 regeneration (60 s budget, C-6). */
export const AI13_COMPOSE_MAX_CALLS = 2;

/** Fixed assistant messages of a draft turn (AI-13 "초안 턴", [가정] wording — ux-planner). */
export const DRAFT_READY_MESSAGE = "초안을 만들었어요. 확인하고 반영 방식을 골라 주세요.";
export const draftDroppedSuffix = (n: number) => ` 확인되지 않은 문장 ${n}개는 뺐어요.`;
export const DRAFT_EMPTY_MESSAGE = "초안을 만들 내용이 아직 부족해요.";

export type Ai13Deps = {
  llm: Llm;
  /** ai_usage_records.call_key from the runner (C-13); defaults to the constants above. */
  callKey?: string;
  signal?: AbortSignal;
  logger?: AiLogger;
  jobId?: string | null;
};

export { buildDeliverableChatContext, type DeliverableChatContext, type DeliverableChatTurnInput };

// ---------------------------------------------------------------------------
// turn plan
// ---------------------------------------------------------------------------

export type DeliverableTurnPlan =
  /** extract ∥ reply. */
  | { kind: "question" }
  /** extract first, then composeDecision. `text` = a free-text request the extract must confirm (intent). */
  | { kind: "compose"; source: "requested_action" | "text" }
  /** requested_action = compose_draft at draft_count ≥ 6: refuse before saving the user message (writing_chat_draft_limit_reached, 409). */
  | { kind: "reject_draft_limit" };

export function planDeliverableTurn(ctx: DeliverableChatContext): DeliverableTurnPlan {
  if (ctx.composeRequested === "requested_action") return ctx.draftLimitReached ? { kind: "reject_draft_limit" } : { kind: "compose", source: "requested_action" };
  if (ctx.composeRequested === "text") return { kind: "compose", source: "text" };
  return { kind: "question" };
}

// ---------------------------------------------------------------------------
// extract (정리)
// ---------------------------------------------------------------------------

export type DeliverableExtractResult = {
  /** Nothing pending (no new user message since last_extracted_sequence): no call made. */
  skipped: boolean;
  /** p_patch for apply_structured_draft_patch (skip the RPC when it has no ops). */
  patch: DeliverablePatch;
  intent: "compose_draft" | null;
  style: ComposeStyle | null;
  /** mark_writing_chat_extracted(p_sequence) after the patch is applied. */
  processedThroughSequence: number | null;
  /** For SSE draft_flags (deliverableDraftFlags(stored, sensitiveAdded)). */
  sensitiveAdded: number;
  report: FactsReport;
  rejections: FactRejection[];
  promptVersion: string;
  meta: AiCallResult | null;
  attempts: number;
};

function emptyFactsReport(): FactsReport {
  return {
    proposed: 0,
    added: 0,
    needs_review: 0,
    rejected: 0,
    team_marked: 0,
    unchanged: 0,
    sensitive_added: 0,
    by_check: Object.fromEntries(FACT_CHECKS.map((c) => [c, 0])) as Record<FactCheck, number>,
  };
}

export async function extract(ctx: DeliverableChatContext, deps: Ai13Deps): Promise<DeliverableExtractResult> {
  if (ctx.processThroughSequence === null) {
    return {
      skipped: true,
      patch: { ops: [] },
      intent: null,
      style: null,
      processedThroughSequence: null,
      sensitiveAdded: 0,
      report: emptyFactsReport(),
      rejections: [],
      promptVersion: AI13_EXTRACT_PROMPT_VERSION,
      meta: null,
      attempts: 0,
    };
  }
  const { value, meta, attempts } = await generateStructured(
    deps.llm,
    {
      feature: "AI-13.extract",
      promptVersion: AI13_EXTRACT_PROMPT_VERSION,
      callKey: deps.callKey ?? AI13_EXTRACT_CALL_KEY,
      tier: AI13_EXTRACT_TIER,
      systemBlocks: extractSystemBlocks(),
      userBlocks: extractUserBlocks(ctx),
      maxOutputTokens: AI13_EXTRACT_MAX_OUTPUT_TOKENS,
      reasoningLevel: "low",
      signal: deps.signal,
    },
    Ai13ExtractOutputSchema,
  );
  const result = validateFactsOutput(value, ctx);
  (deps.logger ?? silentAiLogger)({
    event: "ai_validation",
    jobId: deps.jobId ?? null,
    feature: "AI-13.extract",
    promptVersion: AI13_EXTRACT_PROMPT_VERSION,
    stats: flattenFactsReport(result.report),
  });
  return {
    skipped: false,
    patch: factsPatch(result),
    intent: result.intent,
    style: result.style,
    processedThroughSequence: ctx.processThroughSequence,
    sensitiveAdded: result.sensitiveAdd,
    report: result.report,
    rejections: result.rejections,
    promptVersion: AI13_EXTRACT_PROMPT_VERSION,
    meta,
    attempts,
  };
}

export function flattenFactsReport(r: FactsReport): Record<string, number> {
  const out: Record<string, number> = {
    proposed: r.proposed,
    added: r.added,
    needs_review: r.needs_review,
    rejected: r.rejected,
    team_marked: r.team_marked,
    unchanged: r.unchanged,
    sensitive_added: r.sensitive_added,
  };
  for (const [check, n] of Object.entries(r.by_check)) if (n > 0) out[`rejected_${check}`] = n;
  return out;
}

// ---------------------------------------------------------------------------
// compose decision (after the extract patch is stored)
// ---------------------------------------------------------------------------

export type ComposeDecision = { action: "compose"; style: ComposeStyle | null } | { action: "reply"; notices: ReplyNotice[] };

/**
 * `ctx` must be rebuilt from the structured_draft the extract RPC returned (the
 * new facts count). Order: free-text request not confirmed by the extract →
 * plain question turn; draft_count ≥ 6 → reply "draft_limit"; < 2 usable facts
 * and an empty body → reply "compose_insufficient" ("조금만 더 여쭤볼게요").
 */
export function composeDecision(ctx: DeliverableChatContext, plan: DeliverableTurnPlan, extracted: Pick<DeliverableExtractResult, "intent" | "style"> | null): ComposeDecision {
  if (plan.kind !== "compose") return { action: "reply", notices: [] };
  if (plan.source === "text" && extracted?.intent !== "compose_draft") return { action: "reply", notices: [] };
  if (ctx.draftLimitReached) return { action: "reply", notices: ["draft_limit"] };
  if (!ctx.canComposeByContent) return { action: "reply", notices: ["compose_insufficient"] };
  return { action: "compose", style: ctx.input.style ?? extracted?.style ?? null };
}

// ---------------------------------------------------------------------------
// reply (응답) — text stream, same contract as AI-12
// ---------------------------------------------------------------------------

export type ReplyEvent =
  | { type: "delta"; text: string }
  | { type: "done"; text: string; result: AiCallResult }
  | { type: "error"; error: ProviderError; partialText: string };

export async function* reply(
  ctx: DeliverableChatContext,
  deps: Pick<Ai13Deps, "llm" | "signal" | "callKey">,
  extraNotices: readonly ReplyNotice[] = [],
): AsyncGenerator<ReplyEvent> {
  let text = "";
  for await (const event of deps.llm.stream({
    feature: "AI-13.reply",
    promptVersion: AI13_REPLY_PROMPT_VERSION,
    callKey: deps.callKey ?? AI13_REPLY_CALL_KEY,
    tier: AI13_REPLY_TIER,
    systemBlocks: replySystemBlocks(),
    userBlocks: replyUserBlocks(ctx, replyNotices(ctx, extraNotices)),
    outputSchema: null,
    maxOutputTokens: AI13_REPLY_MAX_OUTPUT_TOKENS,
    reasoningLevel: "low",
    signal: deps.signal,
  })) {
    if (event.type === "delta") {
      text += event.text;
      yield { type: "delta", text: event.text };
    } else if (event.type === "done") {
      yield { type: "done", text: event.result.text || text, result: event.result };
      return;
    } else {
      yield { type: "error", error: event.error, partialText: text };
      return;
    }
  }
  yield { type: "error", error: new ProviderError("provider_unavailable", { provider: deps.llm.provider, beforeFirstToken: text.length === 0 }), partialText: text };
}

// ---------------------------------------------------------------------------
// compose (초안) — streamed structured blocks + V-10
// ---------------------------------------------------------------------------

export type ComposeEvent =
  /** A compose call starts. attempt 2 = the V-6 retry or the V-10 regeneration: discard blocks of attempt 1. */
  | { type: "draft_started"; attempt: number; reason: "initial" | "schema_retry" | "regenerate" }
  /** One block that passed V-10a–g (provisional: the final pass may still drop an empty heading or a trailing block over 8,000 chars). */
  | { type: "draft_block"; attempt: number; block: StoredBlock };

export type ComposeResult = {
  /** "draft" = replace_draft patch; "empty" = no content left → count_draft only. */
  outcome: "draft" | "empty";
  /** p_patch for apply_structured_draft_patch. The RPC returns rev / draft_count for `draft_done`. */
  patch: DeliverablePatch;
  validation: ComposeValidation;
  /** Fixed assistant message to store (finish_assistant_message) and send as `reply_done`. */
  assistantMessage: string;
  /** Compose calls made (1–2). */
  attempts: number;
  regenerated: boolean;
  promptVersion: string;
  /** Last successful call (usage per call is recorded by the Llm's onCall). */
  meta: AiCallResult | null;
};

type Attempt = { ok: true; output: Ai13ComposeOutput; validation: ComposeValidation; meta: AiCallResult } | { ok: false };

const BLOCK_PATH_DEPTH = 2;

export async function* compose(
  ctx: DeliverableChatContext,
  deps: Ai13Deps,
  options: { style: ComposeStyle | null },
): AsyncGenerator<ComposeEvent, ComposeResult, void> {
  const vctx = composeValidationContext(ctx);
  const outputSchema = toCanonicalJsonSchema(Ai13ComposeOutputSchema);
  let tokensShown = false;
  let accepted: Extract<Attempt, { ok: true }> | null = null;
  let regenerated = false;
  let retry: string | null = null;
  let reason: "initial" | "schema_retry" | "regenerate" = "initial";
  let calls = 0;

  while (calls < AI13_COMPOSE_MAX_CALLS) {
    calls++;
    yield { type: "draft_started", attempt: calls, reason };
    const parser = new IncrementalJsonParser();
    let meta: AiCallResult | null = null;
    let parseFailed = false;
    // Headings wait for the next shown content block (an empty section's heading is never shown).
    let heldHeadings: StoredBlock[] = [];

    try {
      for await (const chunk of deps.llm.stream({
        feature: "AI-13.compose",
        promptVersion: AI13_COMPOSE_PROMPT_VERSION,
        callKey: deps.callKey ?? AI13_COMPOSE_CALL_KEY,
        tier: AI13_COMPOSE_TIER,
        systemBlocks: composeSystemBlocks(),
        userBlocks: composeUserBlocks(ctx, { style: options.style, retry, kind: ctx.kind }),
        outputSchema,
        maxOutputTokens: AI13_COMPOSE_MAX_OUTPUT_TOKENS,
        reasoningLevel: "low",
        signal: deps.signal,
      })) {
        if (chunk.type === "error") throw chunk.error;
        if (chunk.type === "done") {
          meta = chunk.result;
          break;
        }
        tokensShown = true;
        if (parseFailed) continue;
        let events;
        try {
          events = parser.push(chunk.text);
        } catch (err) {
          if (err instanceof JsonStreamError) {
            parseFailed = true;
            continue;
          }
          throw err;
        }
        for (const e of events) {
          if (e.type !== "close" || e.kind !== "object" || e.path.length !== BLOCK_PATH_DEPTH || e.path[0] !== "blocks") continue;
          const index = Number(e.path[1]);
          const raw = Ai13BlockOutputSchema.safeParse(e.value);
          if (!raw.success) continue;
          const outcome = validateDraftBlock(raw.data, index, vctx);
          if (!outcome.block) continue;
          if (outcome.block.type === "heading") {
            heldHeadings = heldHeadings.filter((h) => (h.level ?? 2) < (outcome.block!.level ?? 2));
            heldHeadings.push(outcome.block);
            continue;
          }
          for (const h of heldHeadings) yield { type: "draft_block", attempt: calls, block: h };
          heldHeadings = [];
          yield { type: "draft_block", attempt: calls, block: outcome.block };
        }
      }
    } catch (err) {
      // A provider error on the regeneration keeps the first draft (already validated, only over the drop ratio).
      if (accepted) break;
      if (err instanceof ProviderError && calls > 1 && tokensShown) throw err.with({ beforeFirstToken: false });
      throw err;
    }

    const attempt = finishAttempt(parser, parseFailed, meta, vctx);
    if (!attempt.ok) {
      if (accepted) break; // regeneration did not parse: keep the first draft
      if (calls < AI13_COMPOSE_MAX_CALLS) {
        reason = "schema_retry";
        continue;
      }
      throw new AiError("schema_invalid", { retryable: false });
    }
    accepted = attempt;
    if (attempt.validation.overDropLimit && calls < AI13_COMPOSE_MAX_CALLS) {
      regenerated = true;
      reason = "regenerate";
      retry = violationSummary(attempt.validation.rejections);
      continue;
    }
    break;
  }

  const final = accepted!;
  const v = final.validation;
  (deps.logger ?? silentAiLogger)({
    event: "ai_validation",
    jobId: deps.jobId ?? null,
    feature: "AI-13.compose",
    promptVersion: AI13_COMPOSE_PROMPT_VERSION,
    stats: {
      blocks_total: v.report.blocks_total,
      blocks_kept: v.report.blocks_kept,
      units_total: v.report.units_total,
      units_dropped: v.report.units_dropped,
      needs_review: v.report.needs_review,
      sensitive_added: v.report.sensitive_added,
      attempts: calls,
      regenerated: regenerated ? 1 : 0,
      ...Object.fromEntries(Object.entries(v.report.by_check).filter(([, n]) => n > 0).map(([c, n]) => [`rejected_${c}`, n])),
    },
  });

  const empty = v.blocks.length === 0;
  return {
    outcome: empty ? "empty" : "draft",
    patch: draftPatch(ctx, v),
    validation: v,
    assistantMessage: empty ? DRAFT_EMPTY_MESSAGE : DRAFT_READY_MESSAGE + (v.droppedUnits > 0 ? draftDroppedSuffix(v.droppedUnits) : ""),
    attempts: calls,
    regenerated,
    promptVersion: AI13_COMPOSE_PROMPT_VERSION,
    meta: final.meta,
  };
}

function finishAttempt(parser: IncrementalJsonParser, parseFailed: boolean, meta: AiCallResult | null, vctx: ReturnType<typeof composeValidationContext>): Attempt {
  if (parseFailed || !meta) return { ok: false };
  let json: unknown;
  try {
    json = parser.end();
  } catch (err) {
    if (err instanceof JsonStreamError) return { ok: false };
    throw err;
  }
  const parsed = Ai13ComposeOutputSchema.safeParse(json);
  if (!parsed.success) return { ok: false };
  return { ok: true, output: parsed.data, validation: validateComposeOutput(parsed.data, vctx), meta };
}

/** True when `err` is the compose's terminal schema failure (no further retry by the runner). */
export function isComposeSchemaFailure(err: unknown): boolean {
  return isAiError(err) && err.code === "schema_invalid";
}
