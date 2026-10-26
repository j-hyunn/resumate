import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AiError, retryableAiErrorCodes } from "./errors";
import { REFUSAL_FALLBACKS_ENABLED } from "./models";
import { createFakeAiClient } from "./fake-client";
import { computeInputHash } from "./input-hash";
import { generateStructured, toOutputJsonSchema } from "./structured";
import { ModelEvidenceSchema } from "./validation/evidence";

const Schema = z.object({ schema_version: z.literal(1), items: z.array(z.object({ title: z.string().max(50), evidence: z.array(ModelEvidenceSchema) })) });
const request = { feature: "TEST.step", promptVersion: "test.v1", model: "claude-sonnet-5-5", system: [{ text: "s" }], user: [{ text: "u" }] };
const good = { schema_version: 1, items: [{ title: "a", evidence: [{ source_type: "skill", ref: "SKL-1", field: "name" }] }] };

describe("generateStructured (V-6)", () => {
  it("returns the parsed value on the first valid output and sends the JSON schema", async () => {
    const ai = createFakeAiClient([{ json: good }]);
    const result = await generateStructured(ai, request, Schema);
    expect(result.value).toEqual(good);
    expect(result.attempts).toBe(1);
    expect(ai.requests[0].outputSchema).toMatchObject({ type: "object", additionalProperties: false });
  });

  it("retries once on a schema miss and sums usage", async () => {
    const ai = createFakeAiClient([{ json: { schema_version: 2 } }, { json: good }]);
    const result = await generateStructured(ai, request, Schema);
    expect(result.attempts).toBe(2);
    expect(result.meta.usage.inputTokens).toBe(200);
  });

  it("retries once on unparseable text or truncation, then fails with schema_invalid", async () => {
    const ai = createFakeAiClient([{ text: '{"schema_version":1,' }, { error: "schema_invalid" }]);
    await expect(generateStructured(ai, request, Schema)).rejects.toMatchObject({ code: "schema_invalid" });
    expect(ai.remaining()).toBe(0);
  });

  it("does not retry other errors here (the job runner owns step retries)", async () => {
    const ai = createFakeAiClient([{ error: "rate_limited" }, { json: good }]);
    const err = await generateStructured(ai, request, Schema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err).toMatchObject({ code: "rate_limited", retryable: true });
    expect(ai.remaining()).toBe(1);
  });
});

describe("retryability (C-6, QA-S3-07)", () => {
  it("refused is never retried automatically; refusal fallbacks are off per C-6", () => {
    expect(REFUSAL_FALLBACKS_ENABLED).toBe(false);
    expect(new AiError("refused").retryable).toBe(false);
    expect(retryableAiErrorCodes().has("refused")).toBe(false);
    for (const code of ["model_unavailable", "rate_limited", "schema_invalid", "timeout"] as const) expect(new AiError(code).retryable).toBe(true);
    for (const code of ["not_a_jd", "insufficient_data", "input_too_long", "stalled", "canceled"] as const) expect(new AiError(code).retryable).toBe(false);
  });
});

describe("toOutputJsonSchema", () => {
  it("emits closed objects and strips keywords structured outputs don't take", () => {
    const json = toOutputJsonSchema(z.object({ name: z.string().min(1).max(10), n: z.number().int().min(0), tags: z.array(z.string()).max(3) }));
    expect(json).not.toHaveProperty("$schema");
    expect(JSON.stringify(json)).not.toMatch(/"(minLength|maxLength|minimum|maxItems)"/);
    expect(json).toMatchObject({ type: "object", additionalProperties: false, required: ["name", "n", "tags"] });
  });
});

describe("computeInputHash (C-6)", () => {
  const parts = { feature: "insight", promptVersion: "ai-02.v1", model: "claude-sonnet-5-5", careerSnapshotHash: "c", requirementsHash: "r", params: { a: 1, b: [2] } };
  it("is stable under key order and changes with prompt_version, model, or params", () => {
    expect(computeInputHash({ ...parts, params: { b: [2], a: 1 } })).toBe(computeInputHash(parts));
    expect(computeInputHash({ ...parts, promptVersion: "ai-02.v2" })).not.toBe(computeInputHash(parts));
    expect(computeInputHash({ ...parts, model: "claude-opus-5-5" })).not.toBe(computeInputHash(parts));
    expect(computeInputHash({ ...parts, params: { a: 2, b: [2] } })).not.toBe(computeInputHash(parts));
    expect(computeInputHash(parts)).toMatch(/^[0-9a-f]{64}$/);
  });
});
