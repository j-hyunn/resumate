import { z } from "zod";
import { AiError } from "./errors";
import type { Llm, LlmRequest } from "./llm";
import { toCanonicalJsonSchema } from "./providers/schema";
import { addUsage, type AiCallResult } from "./providers/types";

/**
 * V-6 schema check (AI spec C-3, C-10.2): parse the structured-output JSON
 * with the feature's zod schema. A miss (or a truncated output) gets one more
 * call on the same provider and model; a second miss throws
 * AiError("schema_invalid", retryable: false) — the C-11.3 "1 retry" for
 * schema_invalid is spent here, so the job runner must not retry it again.
 * Each attempt is its own usage record (createLlm `onCall`); `meta.usage` sums them.
 *
 * Provider errors (rate limits, outages, …) are rethrown as-is: the runner
 * decides retries with `retryPolicy`.
 */

export const SCHEMA_RETRY_LIMIT = 1;

export type StructuredResult<T> = {
  value: T;
  meta: AiCallResult;
  /** 1 or 2. */
  attempts: number;
};

export async function generateStructured<S extends z.ZodType>(
  llm: Llm,
  request: Omit<LlmRequest, "outputSchema">,
  schema: S,
): Promise<StructuredResult<z.infer<S>>> {
  const outputSchema = toCanonicalJsonSchema(schema);
  let usage: AiCallResult["usage"] | null = null;
  for (let attempt = 1; attempt <= SCHEMA_RETRY_LIMIT + 1; attempt++) {
    let meta: AiCallResult;
    try {
      meta = await llm.complete({ ...request, outputSchema });
    } catch (err) {
      // Truncation (max output tokens) surfaces as schema_invalid: same retry budget.
      if (err instanceof AiError && err.code === "schema_invalid") {
        if (attempt <= SCHEMA_RETRY_LIMIT) continue;
        throw new AiError("schema_invalid", { retryable: false, cause: err });
      }
      throw err;
    }
    usage = usage ? addUsage(usage, meta.usage) : meta.usage;
    const parsed = parseStructured(meta.text, schema);
    if (parsed.ok) return { value: parsed.value, meta: { ...meta, usage }, attempts: attempt };
  }
  throw new AiError("schema_invalid", { retryable: false });
}

export type ParseOutcome<T> = { ok: true; value: T } | { ok: false };

/** JSON.parse + zod. Never echoes the text in errors (C-7). */
export function parseStructured<S extends z.ZodType>(text: string, schema: S): ParseOutcome<z.infer<S>> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  const result = schema.safeParse(json);
  return result.success ? { ok: true, value: result.data } : { ok: false };
}
