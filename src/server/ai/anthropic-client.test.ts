import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { buildParams, createAnthropicAiClient } from "./anthropic-client";
import type { AiRequest } from "./client";
import { mapSdkError } from "./errors";
import type { AiLogEntry } from "./log";

/** Fake SDK: only `beta.messages.stream` is used. No network. */
type Iteration = { type: string; input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number };
type Script = { error?: unknown; deltas?: string[]; stop_reason?: string; model?: string; fallbackBlock?: boolean; iterations?: Iteration[] };

function fakeSdk(scripts: Script[]) {
  const calls: Array<{ params: Record<string, unknown>; options: unknown }> = [];
  const sdk = {
    beta: {
      messages: {
        stream(params: Record<string, unknown>, options: unknown) {
          calls.push({ params, options });
          const script = scripts.shift()!;
          const text = (script.deltas ?? []).join("");
          return {
            async *[Symbol.asyncIterator]() {
              if (script.error) throw script.error;
              for (const t of script.deltas ?? []) yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } };
            },
            async finalMessage() {
              return {
                model: script.model ?? params.model,
                stop_reason: script.stop_reason ?? "end_turn",
                content: [
                  ...(script.fallbackBlock ? [{ type: "fallback" }] : []),
                  { type: "thinking", thinking: "" },
                  { type: "text", text },
                ],
                usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: null, iterations: script.iterations ?? null },
              };
            },
          };
        },
      },
    },
  };
  return { sdk: sdk as unknown as Anthropic, calls };
}

const request: AiRequest = {
  feature: "TEST.call",
  promptVersion: "test.v1",
  model: "claude-sonnet-5-5",
  system: [{ text: "common" }, { text: "feature", cache: true }],
  user: [{ text: "<career_data>비밀 경력 텍스트</career_data>", cache: true }, { text: "<jd>JD</jd>", cache: true }, { text: "질문" }],
  outputSchema: { type: "object", properties: {}, additionalProperties: false },
  effort: "low",
  jobId: "job-1",
};

const headers = new Headers();

describe("buildParams", () => {
  it("uses output_config.format (C-4), no tools, no refusal fallbacks by default (C-6), and cache breakpoints (C-8)", () => {
    const params = buildParams(request, request.model) as unknown as Record<string, unknown>;
    expect(params).not.toHaveProperty("fallbacks");
    expect(params).not.toHaveProperty("betas");
    expect(params).toMatchObject({
      model: "claude-sonnet-5-5",
      output_config: { effort: "low", format: { type: "json_schema", schema: request.outputSchema } },
      system: [{ type: "text", text: "common" }, { type: "text", text: "feature", cache_control: { type: "ephemeral" } }],
    });
    expect(params).not.toHaveProperty("tools");
    expect(params).not.toHaveProperty("tool_choice");
    expect(params).not.toHaveProperty("thinking");
    const messages = params.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>;
    expect(messages).toHaveLength(1);
    expect(messages[0].content.map((b) => "cache_control" in b)).toEqual([true, true, false]);
  });
});

describe("createAnthropicAiClient", () => {
  it("streams deltas, returns joined text and usage, logs C-7 fields only", async () => {
    const logs: AiLogEntry[] = [];
    const { sdk, calls } = fakeSdk([{ deltas: ['{"a":', '"값"}'] }]);
    const client = createAnthropicAiClient({ sdk, logger: (e) => logs.push(e), now: () => 1000 });
    const chunks = [];
    for await (const c of client.stream(request)) chunks.push(c);
    expect(chunks.slice(0, 2)).toEqual([{ type: "text_delta", text: '{"a":' }, { type: "text_delta", text: '"값"}' }]);
    expect(chunks[2]).toMatchObject({
      type: "final",
      result: { text: '{"a":"값"}', model: "claude-sonnet-5-5", usage: { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 3, cacheCreationInputTokens: 0 } },
    });
    expect(calls).toHaveLength(1);
    expect(logs).toEqual([expect.objectContaining({ event: "ai_call", outcome: "ok", jobId: "job-1", promptVersion: "test.v1" })]);
    const logged = JSON.stringify(logs);
    expect(logged).not.toContain("비밀");
    expect(logged).not.toContain("값");
  });

  it.each<[string, Script, string]>([
    ["max_tokens truncation", { deltas: ['{"a"'], stop_reason: "max_tokens" }, "schema_invalid"],
    ["context window exceeded", { stop_reason: "model_context_window_exceeded" }, "input_too_long"],
    ["429", { error: new Anthropic.RateLimitError(429, undefined, "rate", headers) }, "rate_limited"],
    ["connection timeout", { error: new Anthropic.APIConnectionTimeoutError() }, "timeout"],
  ])("%s → AiError(%s)", async (_, script, code) => {
    const { sdk } = fakeSdk([script]);
    const client = createAnthropicAiClient({ sdk, logger: () => {}, unavailableFallback: {} });
    await expect(client.complete(request)).rejects.toMatchObject({ code });
  });

  it("falls back to the previous-generation model once when the primary is unavailable before any output", async () => {
    const { sdk, calls } = fakeSdk([
      { error: new Anthropic.InternalServerError(529, undefined, "overloaded", headers) },
      { deltas: ["{}"], model: "claude-sonnet-5" },
    ]);
    const client = createAnthropicAiClient({ sdk, logger: () => {} });
    const result = await client.complete(request);
    expect(calls.map((c) => c.params.model)).toEqual(["claude-sonnet-5-5", "claude-sonnet-5"]);
    expect(result).toMatchObject({ model: "claude-sonnet-5", fallbackUsed: true });
  });

  it("does not switch models when the fallback also fails", async () => {
    const err = () => new Anthropic.InternalServerError(500, undefined, "down", headers);
    const { sdk, calls } = fakeSdk([{ error: err() }, { error: err() }]);
    const client = createAnthropicAiClient({ sdk, logger: () => {} });
    await expect(client.complete(request)).rejects.toMatchObject({ code: "model_unavailable" });
    expect(calls).toHaveLength(2);
  });

  it("refused is not retryable (C-6); by default no fallback params are sent, opting in sends them", async () => {
    const off = fakeSdk([{ deltas: ["{}"], stop_reason: "refusal" }]);
    await expect(createAnthropicAiClient({ sdk: off.sdk, logger: () => {} }).complete(request)).rejects.toMatchObject({ code: "refused", retryable: false });
    expect(off.calls[0].params).not.toHaveProperty("fallbacks");
    expect(off.calls[0].params).not.toHaveProperty("betas");

    const on = fakeSdk([{ deltas: ["{}"], stop_reason: "refusal" }]);
    await expect(createAnthropicAiClient({ sdk: on.sdk, logger: () => {}, refusalFallbacks: true }).complete(request)).rejects.toMatchObject({
      code: "refused",
      retryable: false,
    });
    expect(on.calls[0].params).toMatchObject({ fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] });
  });

  it("sums usage.iterations and detects a fallback from iterations (sticky routing has no fallback block)", async () => {
    const logs: AiLogEntry[] = [];
    const it1 = { type: "message", input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 };
    const it2 = { type: "fallback_message", input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 0, cache_creation_input_tokens: 10 };
    const { sdk } = fakeSdk([{ deltas: ["{}"], iterations: [it1, it2], model: "claude-opus-5-5" }]);
    const result = await createAnthropicAiClient({ sdk, logger: (e) => logs.push(e) }).complete(request);
    expect(result.usage).toEqual({ inputTokens: 220, outputTokens: 50, cacheReadInputTokens: 50, cacheCreationInputTokens: 10 });
    expect(result.fallbackUsed).toBe(true);
    expect(logs[0]).toMatchObject({ inputTokens: 220, outputTokens: 50, fallbackUsed: true });
  });

  it("logs billed tokens of a refused call", async () => {
    const logs: AiLogEntry[] = [];
    const { sdk } = fakeSdk([{ deltas: ["{}"], stop_reason: "refusal" }]);
    await createAnthropicAiClient({ sdk, logger: (e) => logs.push(e) }).complete(request).catch(() => {});
    expect(logs[0]).toMatchObject({ outcome: "error", errorCode: "refused", inputTokens: 10, outputTokens: 5 });
  });

  it("marks a server-side refusal fallback", async () => {
    const { sdk } = fakeSdk([{ deltas: ["{}"], fallbackBlock: true, model: "claude-opus-5-5" }]);
    const client = createAnthropicAiClient({ sdk, logger: () => {} });
    expect(await client.complete(request)).toMatchObject({ fallbackUsed: true, model: "claude-opus-5-5" });
  });

  it("passes the abort signal; a user cancel maps to canceled, anything else to timeout", async () => {
    const canceled = new AbortController();
    canceled.abort("canceled");
    expect(mapSdkError(new Anthropic.APIUserAbortError(), canceled.signal)?.code).toBe("canceled");
    const deadline = new AbortController();
    deadline.abort();
    expect(mapSdkError(new Anthropic.APIUserAbortError(), deadline.signal)?.code).toBe("timeout");
    const { sdk, calls } = fakeSdk([{ deltas: ["{}"] }]);
    await createAnthropicAiClient({ sdk, logger: () => {} }).complete({ ...request, signal: canceled.signal });
    expect(calls[0].options).toEqual({ signal: canceled.signal });
  });

  it("leaves unknown SDK errors unmapped (become internal_error upstream)", () => {
    expect(mapSdkError(new Anthropic.AuthenticationError(401, undefined, "bad key", headers))).toBeNull();
    expect(mapSdkError(new Error("x"))).toBeNull();
  });
});
