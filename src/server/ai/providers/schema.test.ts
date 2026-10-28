import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CanonicalSchemaError, assertCanonicalSchema, toCanonicalJsonSchema, toGeminiResponseJsonSchema, toOpenAiTextFormat } from "./schema";
import { ModelEvidenceSchema } from "../validation/evidence";

describe("toCanonicalJsonSchema (C-10.2)", () => {
  const Feature = z.object({
    schema_version: z.literal(1),
    target: z.enum(["career", "education"]),
    note: z.string().nullable(),
    items: z.array(z.object({ title: z.string().min(1).max(50), n: z.number().int().min(0), evidence: z.array(ModelEvidenceSchema).max(3) })),
  });

  it("closes objects, requires every key, strips range keywords, const → enum, nullable → anyOf", () => {
    const json = toCanonicalJsonSchema(Feature);
    expect(json).toMatchObject({ type: "object", additionalProperties: false, required: ["schema_version", "target", "note", "items"] });
    expect(JSON.stringify(json)).not.toMatch(/"(\$schema|minLength|maxLength|minimum|maxItems|const|default)"/);
    const props = json.properties as Record<string, unknown>;
    expect(props.schema_version).toEqual({ type: "number", enum: [1] });
    expect(props.note).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] });
    expect(JSON.stringify(json)).not.toContain('"type":["');
  });

  it("evidence keys are required + nullable (explicit null)", () => {
    const json = toCanonicalJsonSchema(z.object({ e: ModelEvidenceSchema }));
    const e = (json.properties as Record<string, Record<string, unknown>>).e;
    expect(e.required).toEqual(["source_type", "ref", "field", "quote"]);
  });

  it.each<[string, z.ZodType, RegExp]>([
    ["optional key", z.object({ a: z.string().optional() }), /must be required/],
    ["open object", z.object({ a: z.string() }).catchall(z.string()), /additionalProperties/],
    ["root not object", z.array(z.string()), /root must be an object/],
    ["root union", z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]), /root/],
    [
      "too deep",
      z.object({ a: z.object({ b: z.object({ c: z.object({ d: z.object({ e: z.object({ f: z.string() }) }) }) }) }) }),
      /depth 6 > 5/,
    ],
  ])("rejects %s", (_, schema, pattern) => {
    expect(() => toCanonicalJsonSchema(schema)).toThrow(pattern);
  });

  it("rejects $ref", () => {
    expect(() =>
      assertCanonicalSchema({ type: "object", properties: { a: { $ref: "#/$defs/x" } }, required: ["a"], additionalProperties: false }),
    ).toThrow(CanonicalSchemaError);
  });
});

describe("provider conversions", () => {
  const json = toCanonicalJsonSchema(z.object({ choice: z.enum(["a"]), body: z.object({ text: z.string(), extra: z.string().nullable() }) }));

  it("OpenAI: strict json_schema format", () => {
    expect(toOpenAiTextFormat(json)).toEqual({ type: "json_schema", name: "output", schema: json, strict: true });
  });

  it("Gemini: propertyOrdering on every object keeps declared order (선택 → 본문)", () => {
    const g = toGeminiResponseJsonSchema(json) as { propertyOrdering: string[]; properties: { body: { propertyOrdering: string[] } } };
    expect(g.propertyOrdering).toEqual(["choice", "body"]);
    expect(g.properties.body.propertyOrdering).toEqual(["text", "extra"]);
    // Canonical input unchanged.
    expect(json).not.toHaveProperty("propertyOrdering");
  });
});
