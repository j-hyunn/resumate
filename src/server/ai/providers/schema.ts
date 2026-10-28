import { z } from "zod";

/**
 * C-10.2 structured output: one canonical JSON schema per feature, converted
 * per provider. The canonical form is the lowest common denominator of
 * OpenAI strict JSON Schema, Gemini `responseJsonSchema`, and Claude
 * `output_config.format`:
 *
 * - root is an object; no `oneOf`/`anyOf` at the root
 * - every object is closed (`additionalProperties: false`) and lists every
 *   property in `required` (optional values are explicit `null`: zod `.nullable()`)
 * - discriminators are string enums; `const` is rewritten to a one-value `enum`
 * - object nesting depth ≤ CANONICAL_MAX_DEPTH; no `$ref` (no recursion)
 * - no length / count / range keywords: zod enforces them after parsing (V-6)
 *
 * The server re-validates every response with zod regardless (V-6).
 */

export const CANONICAL_MAX_DEPTH = 5;

/** Keywords not shared by all three providers; zod still enforces them after parsing. */
const STRIPPED_KEYWORDS = new Set([
  "$schema",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "pattern",
  "format",
  "default",
]);

export class CanonicalSchemaError extends Error {
  constructor(readonly problems: string[]) {
    super(`Schema is not canonical (C-10.2): ${problems.join("; ")}`);
    this.name = "CanonicalSchemaError";
  }
}

/** zod → canonical JSON schema. Throws CanonicalSchemaError when the zod schema breaks a C-10.2 rule. */
export function toCanonicalJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { target: "draft-2020-12", io: "output", unrepresentable: "throw" }) as Record<string, unknown>;
  const canonical = normalize(raw) as Record<string, unknown>;
  assertCanonicalSchema(canonical);
  return canonical;
}

function normalize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalize);
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (STRIPPED_KEYWORDS.has(key)) continue;
    if (key === "const") {
      out.enum = [value];
      continue;
    }
    if (key === "properties" && value && typeof value === "object") {
      // Keys under `properties` are field names, not keywords.
      out[key] = Object.fromEntries(Object.entries(value).map(([name, sub]) => [name, normalize(sub)]));
      continue;
    }
    out[key] = normalize(value);
  }
  return splitNullableTypeArray(out);
}

/**
 * zod emits `.nullable()` as `type: ["string", "null"]`. Claude's documented
 * subset lists `anyOf` but not type arrays, so the canonical form is
 * `anyOf: [{ type: T, … }, { type: "null" }]` (supported by all three).
 */
function splitNullableTypeArray(node: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(node.type)) return node;
  const types = node.type as string[];
  const nonNull = types.filter((t) => t !== "null");
  if (nonNull.length !== 1) throw new CanonicalSchemaError([`type union ${JSON.stringify(types)} is not allowed (only T | null)`]);
  const { type: _type, ...rest } = node;
  void _type;
  if (!types.includes("null")) return { ...rest, type: nonNull[0] };
  const branch: Record<string, unknown> = { ...rest, type: nonNull[0] };
  if (Array.isArray(branch.enum)) branch.enum = (branch.enum as unknown[]).filter((v) => v !== null);
  const description = typeof rest.description === "string" ? { description: rest.description } : {};
  return { ...description, anyOf: [branch, { type: "null" }] };
}

/** Lists every C-10.2 rule break; throws when there is any. */
export function assertCanonicalSchema(schema: Record<string, unknown>): void {
  const problems: string[] = [];
  if (schema.type !== "object") problems.push("root must be an object");
  if ("oneOf" in schema || "anyOf" in schema) problems.push("no oneOf/anyOf at the root");
  walk(schema, "$", 0, problems);
  if (problems.length > 0) throw new CanonicalSchemaError(problems);
}

function walk(node: unknown, path: string, depth: number, problems: string[]): void {
  if (node === null || typeof node !== "object") return;
  const n = node as Record<string, unknown>;
  if ("$ref" in n || "$defs" in n || "definitions" in n) problems.push(`${path}: $ref/$defs not allowed`);
  if ("oneOf" in n || "allOf" in n) problems.push(`${path}: oneOf/allOf not allowed`);
  if (n.type === "object") {
    const level = depth + 1;
    if (level > CANONICAL_MAX_DEPTH) problems.push(`${path}: object depth ${level} > ${CANONICAL_MAX_DEPTH}`);
    if (n.additionalProperties !== false) problems.push(`${path}: additionalProperties must be false`);
    const props = (n.properties ?? {}) as Record<string, unknown>;
    const required = Array.isArray(n.required) ? (n.required as string[]) : [];
    for (const key of Object.keys(props)) {
      if (!required.includes(key)) problems.push(`${path}.${key}: must be required (use .nullable() for optional values)`);
      walk(props[key], `${path}.${key}`, level, problems);
    }
    return;
  }
  if (n.items) walk(n.items, `${path}[]`, depth, problems);
  if (Array.isArray(n.anyOf)) n.anyOf.forEach((branch, i) => walk(branch, `${path}|${i}`, depth, problems));
}

// ---------- per-provider conversion ----------

/** Claude: `output_config.format` takes the canonical schema as is. */
export function toAnthropicFormat(schema: Record<string, unknown>) {
  return { type: "json_schema" as const, schema };
}

/** OpenAI Responses API: `text.format`, strict JSON schema (all required, closed objects). */
export function toOpenAiTextFormat(schema: Record<string, unknown>) {
  return { type: "json_schema" as const, name: "output", schema, strict: true };
}

/**
 * Gemini: `responseMimeType: application/json` + `responseJsonSchema`
 * (`@google/genai` accepts JSON Schema there, incl. `anyOf`, `enum`,
 * `additionalProperties`, and the non-standard `propertyOrdering`).
 * `propertyOrdering` pins key order so "선택 → 본문" ordering holds (C-10.2 [가정]).
 */
export function toGeminiResponseJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return addPropertyOrdering(schema) as Record<string, unknown>;
}

function addPropertyOrdering(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(addPropertyOrdering);
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "properties" && value && typeof value === "object") {
      out[key] = Object.fromEntries(Object.entries(value).map(([name, sub]) => [name, addPropertyOrdering(sub)]));
    } else {
      out[key] = addPropertyOrdering(value);
    }
  }
  if (out.type === "object" && out.properties && typeof out.properties === "object") {
    out.propertyOrdering = Object.keys(out.properties);
  }
  return out;
}
