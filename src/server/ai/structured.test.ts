import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AiError } from "./errors";
import { createFakeLlm } from "./fake-llm";
import { computeInputHash } from "./input-hash";
import { generateStructured } from "./structured";
import { ModelEvidenceSchema } from "./validation/evidence";

const Schema = z.object({ schema_version: z.literal(1), items: z.array(z.object({ title: z.string().max(50), evidence: z.array(ModelEvidenceSchema) })) });
const request = { feature: "TEST.step", promptVersion: "test.v1", callKey: "test.step.1", systemBlocks: [{ text: "s" }], userBlocks: [{ text: "u" }] };
const good = { schema_version: 1, items: [{ title: "a", evidence: [{ source_type: "skill", ref: "SKL-1", field: "name", quote: null }] }] };

describe("generateStructured (V-6)", () => {
  it("returns the parsed value on the first valid output and sends the canonical schema", async () => {
    const llm = createFakeLlm([{ json: good }]);
    const result = await generateStructured(llm, request, Schema);
    expect(result.value).toEqual(good);
    expect(result.attempts).toBe(1);
    expect(llm.calls[0].outputSchema).toMatchObject({ type: "object", additionalProperties: false });
    expect(llm.calls[0].model).toBe("claude-sonnet-5-5");
  });

  it("accepts evidence that omits optional keys (filled with null)", async () => {
    const llm = createFakeLlm([{ json: { schema_version: 1, items: [{ title: "a", evidence: [{ source_type: "skill", ref: "SKL-1" }] }] } }]);
    const result = await generateStructured(llm, request, Schema);
    expect(result.value.items[0].evidence[0]).toEqual({ source_type: "skill", ref: "SKL-1", field: null, quote: null });
  });

  it("retries once on a schema miss on the same model, sums usage, one record per call", async () => {
    const llm = createFakeLlm([{ json: { schema_version: 2 } }, { json: good }]);
    const result = await generateStructured(llm, request, Schema);
    expect(result.attempts).toBe(2);
    expect(result.meta.usage.inputTokens).toBe(200);
    expect(llm.records.map((r) => [r.outcome, r.model])).toEqual([
      ["succeeded", "claude-sonnet-5-5"],
      ["succeeded", "claude-sonnet-5-5"],
    ]);
  });

  it("after the V-6 retry, schema_invalid is not retryable (runner must not spend another retry)", async () => {
    const llm = createFakeLlm([{ text: '{"schema_version":1,' }, { error: "schema_invalid" }]);
    const err = await generateStructured(llm, request, Schema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err).toMatchObject({ code: "schema_invalid", retryable: false });
    expect(llm.remaining()).toBe(0);
    expect(llm.records.map((r) => r.outcome)).toEqual(["succeeded", "failed"]);
  });

  it("does not retry provider errors here (the job runner owns C-11.3)", async () => {
    const llm = createFakeLlm([{ error: "rate_limited", retryAfterMs: 5_000 }, { json: good }]);
    const err = await generateStructured(llm, request, Schema).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "rate_limited", retryable: true });
    expect(llm.remaining()).toBe(1);
  });
});

describe("computeInputHash (C-6 v4)", () => {
  const parts = {
    feature: "insight",
    promptVersion: "ai-02.v1",
    provider: "anthropic" as const,
    model: "claude-sonnet-5-5",
    careerSnapshotHash: "c",
    requirementsHash: "r",
    params: { a: 1, b: [2] },
  };
  it("is stable under key order and changes with prompt_version, provider, model, or params", () => {
    expect(computeInputHash({ ...parts, params: { b: [2], a: 1 } })).toBe(computeInputHash(parts));
    expect(computeInputHash({ ...parts, promptVersion: "ai-02.v2" })).not.toBe(computeInputHash(parts));
    expect(computeInputHash({ ...parts, provider: "openai" })).not.toBe(computeInputHash(parts));
    expect(computeInputHash({ ...parts, model: "claude-opus-5-5" })).not.toBe(computeInputHash(parts));
    expect(computeInputHash({ ...parts, params: { a: 2, b: [2] } })).not.toBe(computeInputHash(parts));
    expect(computeInputHash(parts)).toMatch(/^[0-9a-f]{64}$/);
  });
});
