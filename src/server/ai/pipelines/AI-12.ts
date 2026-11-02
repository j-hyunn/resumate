import type { WritingChatContext } from "../context-pack/writing-chat";
import { ProviderError } from "../errors";
import type { Llm } from "../llm";
import { silentAiLogger, type AiLogger } from "../log";
import {
  AI12_EXTRACT_PROMPT_VERSION,
  AI12_REPLY_PROMPT_VERSION,
  extractSystemBlocks,
  extractUserBlocks,
  replySystemBlocks,
  replyUserBlocks,
} from "../prompts/AI-12";
import type { AiCallResult } from "../providers/types";
import { Ai12ExtractOutputSchema } from "../schemas/AI-12";
import { toDraftPatch, type DraftPatch, type FieldRef } from "../schemas/structured-draft";
import { generateStructured } from "../structured";
import { V9_CHECKS, validateExtractOutput, type V9Check, type V9Rejection, type V9Report } from "../validation/v9";

/**
 * AI-12 프로젝트 AI 작성 대화 — one turn = two calls the runner schedules
 * (paid tier: in parallel; free tier: reply then extract, C-12):
 *
 * - `extract`: light tier, structured output → V-9 → DraftPatch (aliases → UUIDs)
 *   for `apply_structured_draft_patch`. Failure never blocks the reply; the
 *   runner leaves last_extracted_sequence alone so the next turn re-covers it.
 * - `reply`: default tier, plain text stream (no structured output).
 *
 * Plain async functions: no request, cookies, DB, or after() (api-engineer's
 * runner loads rows, persists results, and records usage via createLlm).
 */

export const AI12_EXTRACT_TIER = "light" as const;
export const AI12_REPLY_TIER = "default" as const;
export const AI12_EXTRACT_CALL_KEY = "writing_chat.extract";
export const AI12_REPLY_CALL_KEY = "writing_chat.reply";
export const AI12_EXTRACT_MAX_OUTPUT_TOKENS = 4096;
export const AI12_REPLY_MAX_OUTPUT_TOKENS = 2048;

export type Ai12Deps = {
  llm: Llm;
  /**
   * ai_usage_records.call_key from the runner (C-13, e.g. "writing_chat.turn.7.extract").
   * Defaults to AI12_EXTRACT_CALL_KEY / AI12_REPLY_CALL_KEY (QA-S4-03).
   */
  callKey?: string;
  signal?: AbortSignal;
  logger?: AiLogger;
  jobId?: string | null;
};

export type DraftFlags = { needsReview: FieldRef[]; actorAmbiguous: FieldRef[]; sensitiveAdded: number };

export type ExtractResult = {
  /** Nothing pending (no new user message since last_extracted_sequence): no call made. */
  skipped: boolean;
  /** p_patch for apply_structured_draft_patch (skip the RPC when isEmptyDraftPatch). */
  patch: DraftPatch;
  flags: DraftFlags;
  /** mark_writing_chat_extracted(p_sequence) after the patch is applied. */
  processedThroughSequence: number | null;
  report: V9Report;
  rejections: V9Rejection[];
  promptVersion: string;
  meta: AiCallResult | null;
  attempts: number;
};

export async function extract(ctx: WritingChatContext, deps: Ai12Deps): Promise<ExtractResult> {
  if (ctx.processThroughSequence === null) {
    return {
      skipped: true,
      patch: { ops: [] },
      flags: { needsReview: [], actorAmbiguous: [], sensitiveAdded: 0 },
      processedThroughSequence: null,
      report: emptyV9Report(),
      rejections: [],
      promptVersion: AI12_EXTRACT_PROMPT_VERSION,
      meta: null,
      attempts: 0,
    };
  }
  const { value, meta, attempts } = await generateStructured(
    deps.llm,
    {
      feature: "AI-12.extract",
      promptVersion: AI12_EXTRACT_PROMPT_VERSION,
      callKey: deps.callKey ?? AI12_EXTRACT_CALL_KEY,
      tier: AI12_EXTRACT_TIER,
      systemBlocks: extractSystemBlocks(),
      userBlocks: extractUserBlocks(ctx),
      maxOutputTokens: AI12_EXTRACT_MAX_OUTPUT_TOKENS,
      reasoningLevel: "low",
      signal: deps.signal,
    },
    Ai12ExtractOutputSchema,
  );
  const result = validateExtractOutput(value, ctx.v9);
  (deps.logger ?? silentAiLogger)({
    event: "ai_validation",
    jobId: deps.jobId ?? null,
    feature: "AI-12.extract",
    promptVersion: AI12_EXTRACT_PROMPT_VERSION,
    stats: { ...flattenReport(result.report), ...rejectionTargetCounts(result.rejections) },
  });
  return {
    skipped: false,
    patch: toDraftPatch(result.changes),
    flags: result.flags,
    processedThroughSequence: ctx.processThroughSequence,
    report: result.report,
    rejections: result.rejections,
    promptVersion: AI12_EXTRACT_PROMPT_VERSION,
    meta,
    attempts,
  };
}

export type ReplyEvent =
  | { type: "delta"; text: string }
  | { type: "done"; text: string; result: AiCallResult }
  | { type: "error"; error: ProviderError; partialText: string };

/**
 * Streams the reply text. Exactly one terminal event (`done` or `error`).
 * A provider error arrives as `error` with `error.beforeFirstToken` so the
 * runner can retry only before the first token (C-11.3). A key lookup failure
 * (before any provider call) is thrown by `llm.stream`, as in S3a.
 */
export async function* reply(ctx: WritingChatContext, deps: Pick<Ai12Deps, "llm" | "signal" | "callKey">): AsyncGenerator<ReplyEvent> {
  let text = "";
  for await (const event of deps.llm.stream({
    feature: "AI-12.reply",
    promptVersion: AI12_REPLY_PROMPT_VERSION,
    callKey: deps.callKey ?? AI12_REPLY_CALL_KEY,
    tier: AI12_REPLY_TIER,
    systemBlocks: replySystemBlocks(),
    userBlocks: replyUserBlocks(ctx),
    outputSchema: null,
    maxOutputTokens: AI12_REPLY_MAX_OUTPUT_TOKENS,
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
  // The Llm contract guarantees a terminal event; treat a silent end as an outage.
  yield { type: "error", error: new ProviderError("provider_unavailable", { provider: deps.llm.provider, beforeFirstToken: text.length === 0 }), partialText: text };
}

export function emptyV9Report(): V9Report {
  return {
    proposed: 0,
    applied: 0,
    needs_review: 0,
    rejected: 0,
    by_check: Object.fromEntries(V9_CHECKS.map((c) => [c, 0])) as Record<V9Check, number>,
    actor_ambiguous: 0,
    sensitive_added: 0,
    unchanged: 0,
  };
}

/**
 * QA-S4-02: rejected fields by kind, e.g. `rejected_field_action: 2` (field
 * names from the fixed schema only — never values, quotes, or detail keys).
 */
export function rejectionTargetCounts(rejections: readonly V9Rejection[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rejections) {
    const parts = r.target.split(".");
    const kind = parts[0] === "project" || parts[0] === "detail" ? parts[parts.length - 1] : parts[0];
    const key = `rejected_field_${/^[a-z_]+$/.test(kind) ? kind : "other"}`;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/** Counts only, flat keys (C-7 log). */
export function flattenReport(report: V9Report): Record<string, number> {
  const out: Record<string, number> = {
    proposed: report.proposed,
    applied: report.applied,
    needs_review: report.needs_review,
    rejected: report.rejected,
    actor_ambiguous: report.actor_ambiguous,
    sensitive_added: report.sensitive_added,
    unchanged: report.unchanged,
  };
  for (const [check, n] of Object.entries(report.by_check)) if (n > 0) out[`rejected_${check}`] = n;
  return out;
}
