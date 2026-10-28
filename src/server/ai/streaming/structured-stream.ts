import type { z } from "zod";
import { AiError, isAiError, isProviderError } from "../errors";
import type { Llm, LlmRequest } from "../llm";
import { toCanonicalJsonSchema } from "../providers/schema";
import type { AiCallResult } from "../providers/types";
import type { ValidationReport } from "../validation/report";
import { BlockExtractor } from "./blocks";
import type { AiStreamEvent } from "./events";
import { JsonStreamError } from "./json-incremental";

/**
 * Streaming pipeline skeleton (C-6 streaming mode): model text stream →
 * incremental JSON → block events → block validation → full validation →
 * `validated` → `done`. Feature pipelines (AI-03, AI-04, AI-12) supply the
 * schema and the two validation hooks.
 *
 * - `validateBlock` runs on each `block_completed` (V-1..V-3, V-7, V-8, V-4,
 *   C-5). Its return value is what the screen gets. Return `null` to hide a
 *   block (V-4 drop).
 * - `finalize` gets the zod-parsed whole output, runs full validation (incl.
 *   V-5 and its one regeneration), persists if needed, and returns the
 *   storage-form result. Nothing is final before it returns.
 * - V-6 in streaming: a schema miss after the stream ends is an `error`
 *   event (`schema_invalid`, retryable). The client restarts the whole
 *   generation (AI-03 "전체 재시도", MVP 단순화); blocks already shown are discarded.
 * - Exactly one terminal event (`done` or `error`). Errors carry C-11 codes only.
 * - C-11.3: a provider error after the first token is not retryable (`retryable:
 *   false`), so the partial output isn't regenerated and billed twice.
 */
export type StructuredStreamOptions<T> = {
  llm: Llm;
  request: Omit<LlmRequest, "outputSchema">;
  schema: z.ZodType<T>;
  validateBlock?: (raw: Record<string, unknown>, blockId: string) => unknown | null;
  finalize: (value: T, meta: AiCallResult) => Promise<StreamFinalization> | StreamFinalization;
  blockKeys?: { blockId: string; text: string };
};

export type StreamFinalization = {
  result: unknown;
  validationReport: ValidationReport;
  resultId?: string | null;
  model?: string;
};

export async function* runStructuredStream<T>(options: StructuredStreamOptions<T>): AsyncGenerator<AiStreamEvent> {
  const extractor = new BlockExtractor(options.blockKeys);
  const hidden = new Set<string>();
  let meta: AiCallResult | null = null;
  let final: StreamFinalization;
  try {
    const outputSchema = toCanonicalJsonSchema(options.schema);
    for await (const chunk of options.llm.stream({ ...options.request, outputSchema })) {
      if (chunk.type === "done") {
        meta = chunk.result;
        break;
      }
      if (chunk.type === "error") throw chunk.error;
      for (const event of extractor.push(chunk.text)) {
        if (event.type === "started") {
          yield { type: "block_started", blockId: event.blockId, path: event.path };
        } else if (event.type === "delta") {
          if (!hidden.has(event.blockId)) yield { type: "block_delta", blockId: event.blockId, text: event.text };
        } else {
          const block = options.validateBlock ? options.validateBlock(event.raw, event.blockId) : event.raw;
          if (block === null) hidden.add(event.blockId);
          yield { type: "block_completed", blockId: event.blockId, block };
        }
      }
    }
    if (!meta) throw new AiError("schema_invalid");

    let json: unknown;
    try {
      json = extractor.end();
    } catch (err) {
      if (err instanceof JsonStreamError) throw new AiError("schema_invalid", { cause: err });
      throw err;
    }
    const parsed = options.schema.safeParse(json);
    if (!parsed.success) throw new AiError("schema_invalid");

    final = await options.finalize(parsed.data, meta);
  } catch (err) {
    // Terminal event #1 of 1 (QA-S3-02): nothing follows an error.
    yield toErrorEvent(err);
    return;
  }
  // `validated` and `done` are yielded outside the try so an error can never
  // follow them: exactly one terminal event, always last.
  yield { type: "validated", result: final.result, validationReport: final.validationReport };
  yield {
    type: "done",
    meta: { promptVersion: options.request.promptVersion, model: final.model ?? meta.model, resultId: final.resultId ?? null },
  };
}

export const AI_STREAM_TERMINAL_EVENT_TYPES = ["done", "error"] as const;

function toErrorEvent(err: unknown): Extract<AiStreamEvent, { type: "error" }> {
  const mapped = err instanceof JsonStreamError ? new AiError("schema_invalid", { cause: err }) : err;
  if (isAiError(mapped)) {
    const provider = isProviderError(mapped) ? mapped : null;
    const retryable = mapped.retryable && (!provider || provider.beforeFirstToken);
    return {
      type: "error",
      code: mapped.code,
      message: mapped.message,
      retryable,
      retryAfter: provider?.retryAfter?.toISOString() ?? null,
      quotaResetsAt: provider?.quotaResetsAt?.toISOString() ?? null,
    };
  }
  return { type: "error", code: "internal_error", message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", retryable: true, retryAfter: null, quotaResetsAt: null };
}
