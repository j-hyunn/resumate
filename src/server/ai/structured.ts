import { z } from "zod";
import { addUsage, type AiClient, type AiRequest, type AiResult } from "./client";
import { AiError } from "./errors";

/**
 * V-6 schema check (AI spec C-3, C-6): parse the structured-output JSON with
 * the feature's zod schema. A miss gets one more call; a second miss throws
 * AiError("schema_invalid"). Usage of both attempts is summed.
 *
 * The step-level retry in the job runner is separate: it re-runs the whole
 * step after any retryable AiError.
 */

export const SCHEMA_RETRY_LIMIT = 1;

export type StructuredResult<T> = {
  value: T;
  meta: AiResult;
  /** 1 or 2. */
  attempts: number;
};

export async function generateStructured<S extends z.ZodType>(
  ai: AiClient,
  request: Omit<AiRequest, "outputSchema">,
  schema: S,
): Promise<StructuredResult<z.infer<S>>> {
  const outputSchema = toOutputJsonSchema(schema);
  let usage = null as AiResult["usage"] | null;
  for (let attempt = 1; attempt <= SCHEMA_RETRY_LIMIT + 1; attempt++) {
    let meta: AiResult;
    try {
      meta = await ai.complete({ ...request, outputSchema });
    } catch (err) {
      // max_tokens truncation surfaces as schema_invalid from the client: same retry budget.
      if (err instanceof AiError && err.code === "schema_invalid" && attempt <= SCHEMA_RETRY_LIMIT) continue;
      throw err;
    }
    usage = usage ? addUsage(usage, meta.usage) : meta.usage;
    const parsed = parseStructured(meta.text, schema);
    if (parsed.ok) return { value: parsed.value, meta: { ...meta, usage }, attempts: attempt };
  }
  throw new AiError("schema_invalid");
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

/**
 * zod → JSON schema for output_config.format. Structured outputs require every
 * object to be closed (`additionalProperties: false`); z.object() is emitted
 * that way with io "output". Features should keep schemas to the supported
 * subset (objects, arrays, enums, strings, numbers, nullable) — length and
 * count limits are enforced by zod after parsing, not by the API.
 */
export function toOutputJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12", io: "output", unrepresentable: "throw" }) as Record<
    string,
    unknown
  >;
  delete json.$schema;
  return stripUnsupportedKeywords(json) as Record<string, unknown>;
}

/** Keywords the structured-output grammar does not accept; zod still enforces them after parsing. */
const UNSUPPORTED_KEYWORDS = new Set(["minLength", "maxLength", "minItems", "maxItems", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "pattern", "format"]);

function stripUnsupportedKeywords(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripUnsupportedKeywords);
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) continue;
    // `properties` keys are field names, not keywords.
    if (key === "properties" && value && typeof value === "object") {
      out[key] = Object.fromEntries(Object.entries(value).map(([name, sub]) => [name, stripUnsupportedKeywords(sub)]));
      continue;
    }
    out[key] = stripUnsupportedKeywords(value);
  }
  return out;
}
