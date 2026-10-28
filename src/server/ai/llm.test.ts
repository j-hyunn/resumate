import { describe, expect, it } from "vitest";
import { ProviderError } from "./errors";
import { createFakeLlm } from "./fake-llm";
import { createLlm, verifyProviderKey, type LlmCallRecord, type LlmRequest } from "./llm";
import type { AiLogEntry } from "./log";
import type { LlmStreamEvent, ProviderAdapter, ProviderVerifyOutcome } from "./providers/types";

const SECRET = "sk-live-should-never-appear-1234";
const request: LlmRequest = {
  feature: "AI-02.match",
  promptVersion: "ai-02.match.v1+common.v1",
  callKey: "insight.match.1",
  systemBlocks: [{ text: "s" }],
  userBlocks: [{ text: "u" }],
  outputSchema: null,
};

function scriptedAdapter(events: LlmStreamEvent[], seen: { apiKey?: string; model?: string }[] = []): ProviderAdapter {
  return {
    id: "openai",
    async *stream(call) {
      seen.push({ apiKey: call.apiKey, model: call.model });
      for (const e of events) yield e;
    },
    complete: () => Promise.reject(new Error("unused")),
    verify: () => Promise.reject(new Error("unused")),
  };
}

function build(events: LlmStreamEvent[], extra: { onCall?: (r: LlmCallRecord) => void | Promise<void> } = {}) {
  const records: LlmCallRecord[] = [];
  const logs: AiLogEntry[] = [];
  const seen: { apiKey?: string; model?: string }[] = [];
  let keyCalls = 0;
  const llm = createLlm({
    provider: "openai",
    tier: "default",
    connectionTier: "free",
    jobId: "job-1",
    keySource: {
      forJob: async (jobId) => {
        keyCalls++;
        expect(jobId).toBe("job-1");
        return SECRET;
      },
    },
    onCall: extra.onCall ?? ((r) => void records.push(r)),
    logger: (e) => logs.push(e),
    now: () => 1_000,
    adapters: { openai: scriptedAdapter(events, seen) },
  });
  return { llm, records, logs, seen, keyCalls: () => keyCalls };
}

const usage = { inputTokens: 10, cachedInputTokens: 2, cacheWriteTokens: 0, outputTokens: 5, reasoningTokens: 1, usageSource: "provider_reported" as const };

describe("createLlm", () => {
  it("fetches the key per call, resolves tier → model, records one usage row", async () => {
    const { llm, records, seen, keyCalls } = build([
      { type: "delta", text: "hi" },
      { type: "done", result: { text: "hi", model: "gpt-6.1-terra", usage, latencyMs: 7 } },
    ]);
    const result = await llm.complete(request);
    expect(result.text).toBe("hi");
    expect(seen).toEqual([{ apiKey: SECRET, model: "gpt-6.1-terra" }]);
    expect(keyCalls()).toBe(1);
    expect(records).toEqual([
      {
        jobId: "job-1",
        callKey: "insight.match.1",
        feature: "AI-02.match",
        promptVersion: "ai-02.match.v1+common.v1",
        provider: "openai",
        model: "gpt-6.1-terra",
        modelTier: "default",
        connectionTier: "free",
        outcome: "succeeded",
        errorCode: null,
        usage,
        latencyMs: 7,
        occurredAt: new Date(1_000),
      },
    ]);
  });

  it("per-request tier override (AI-12 extract on light)", async () => {
    const { llm, seen, records } = build([{ type: "done", result: { text: "", model: "gpt-6-luna", usage, latencyMs: 1 } }]);
    await llm.complete({ ...request, tier: "light" });
    expect(seen[0].model).toBe("gpt-6-luna");
    expect(records[0].modelTier).toBe("light");
    expect(llm.modelFor()).toBe("gpt-6.1-terra");
  });

  it("failed calls are recorded with their usage and error code; complete() throws a retry-gate-open error", async () => {
    const error = new ProviderError("rate_limited", { provider: "openai", beforeFirstToken: false });
    const { llm, records } = build([{ type: "delta", text: "x" }, { type: "error", error, usage }]);
    const err = await llm.complete(request).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "rate_limited", beforeFirstToken: true });
    expect(records[0]).toMatchObject({ outcome: "failed", errorCode: "rate_limited", usage });
  });

  it("stream passes deltas and exactly one terminal event; error keeps beforeFirstToken", async () => {
    const error = new ProviderError("provider_unavailable", { provider: "openai", beforeFirstToken: false });
    const { llm, records } = build([{ type: "delta", text: "a" }, { type: "error", error, usage }]);
    const events: LlmStreamEvent[] = [];
    for await (const e of llm.stream(request)) events.push(e);
    expect(events.map((e) => e.type)).toEqual(["delta", "error"]);
    expect(events[1]).toMatchObject({ error: { beforeFirstToken: false } });
    expect(records).toHaveLength(1);
  });

  it("an adapter stream that ends without a terminal event → unclassified error + record", async () => {
    const { llm, records } = build([{ type: "delta", text: "a" }]);
    const events: LlmStreamEvent[] = [];
    for await (const e of llm.stream(request)) events.push(e);
    expect(events.at(-1)).toMatchObject({ type: "error", error: { code: "provider_unavailable", unclassified: true } });
    expect(records[0]).toMatchObject({ outcome: "failed", usage: { usageSource: "unavailable", inputTokens: 0, reasoningTokens: null } });
  });

  it("key_missing: no provider call, no usage record", async () => {
    const records: LlmCallRecord[] = [];
    const seen: { apiKey?: string }[] = [];
    const llm = createLlm({
      provider: "openai",
      tier: "default",
      connectionTier: "paid",
      jobId: "job-1",
      keySource: { forJob: async () => Promise.reject(new ProviderError("key_missing")) },
      onCall: (r) => void records.push(r),
      adapters: { openai: scriptedAdapter([], seen) },
    });
    await expect(llm.complete(request)).rejects.toMatchObject({ code: "key_missing" });
    expect(seen).toHaveLength(0);
    expect(records).toHaveLength(0);
  });

  it("onCall failure does not fail the call (logged as usage_record_failed)", async () => {
    const { llm, logs } = build([{ type: "done", result: { text: "ok", model: "gpt-6.1-terra", usage, latencyMs: 1 } }], {
      onCall: () => Promise.reject(new Error("db down")),
    });
    await expect(llm.complete(request)).resolves.toMatchObject({ text: "ok" });
    expect(logs.map((l) => l.event)).toEqual(["ai_call", "usage_record_failed"]);
  });

  it("logs C-7 fields only: never the key, prompt, or output text (NFR-KEY-05)", async () => {
    const { llm, logs } = build([
      { type: "delta", text: "OUTPUT-BODY" },
      { type: "done", result: { text: "OUTPUT-BODY", model: "gpt-6.1-terra", usage, latencyMs: 1 } },
    ]);
    await llm.complete({ ...request, systemBlocks: [{ text: "PROMPT-BODY" }] });
    const serialized = JSON.stringify(logs);
    for (const secret of [SECRET, SECRET.slice(-4), "PROMPT-BODY", "OUTPUT-BODY"]) expect(serialized).not.toContain(secret);
    expect(logs[0]).toMatchObject({ event: "ai_call", provider: "openai", tier: "default", connectionTier: "free", model: "gpt-6.1-terra" });
  });
});

describe("createFakeLlm", () => {
  it("records usage per call and resolves the model from provider + tier", async () => {
    const llm = createFakeLlm([{ json: { a: 1 } }, { error: "provider_unavailable" }], { provider: "gemini", tier: "light" });
    await llm.complete(request);
    await expect(llm.complete(request)).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(llm.calls.map((c) => c.model)).toEqual(["gemini-3.5-flash-lite", "gemini-3.5-flash-lite"]);
    expect(llm.records.map((r) => [r.outcome, r.usage.usageSource])).toEqual([
      ["succeeded", "provider_reported"],
      ["failed", "unavailable"],
    ]);
  });
});

describe("verifyProviderKey (C-10.5, R-38)", () => {
  function adapterWith(outcome: ProviderVerifyOutcome, seen: { model?: string }[] = []): ProviderAdapter {
    return {
      id: "gemini",
      stream: () => {
        throw new Error("unused");
      },
      complete: () => Promise.reject(new Error("unused")),
      verify: async (r) => {
        seen.push({ model: r.model });
        return outcome;
      },
    };
  }
  const run = (outcome: ProviderVerifyOutcome, seen?: { model?: string }[]) =>
    verifyProviderKey({ provider: "gemini", apiKey: SECRET, adapters: { gemini: adapterWith(outcome, seen) } });

  it("valid on both steps, default-tier model", async () => {
    const seen: { model?: string }[] = [];
    expect(await run({ ok: true, usage }, seen)).toMatchObject({ decision: "valid", stage: 2, model: "gemini-3.8-flash", usage });
    expect(seen).toEqual([{ model: "gemini-3.8-flash" }]);
  });

  it.each([
    [2, "daily_quota_exhausted", "limited"],
    [2, "rate_limited", "limited"],
    [2, "provider_unavailable", "limited"],
    [2, "billing_required", "rejected"],
    [2, "model_not_available", "rejected"],
    [1, "key_invalid", "rejected"],
    [1, "model_not_available", "rejected"],
    [1, "provider_unavailable", "rejected"],
  ] as const)("stage %s %s → %s", async (stage, code, decision) => {
    const result = await run({ ok: false, stage, error: new ProviderError(code), usage: null });
    expect(result).toMatchObject({ decision, stage, error: { code } });
    expect(JSON.stringify({ ...result, error: result.error?.code })).not.toContain(SECRET);
  });
});

describe("usage record delivery on abort / abandon (QA-S3a-03)", () => {
  /** Adapter that yields one delta, then waits until its signal aborts, then reports an error. */
  function hangingAdapter(seen: { signal?: AbortSignal }[]): ProviderAdapter {
    return {
      id: "openai",
      async *stream(call) {
        seen.push({ signal: call.signal });
        yield { type: "delta", text: "partial" };
        await new Promise<void>((resolve) => {
          if (call.signal?.aborted) return resolve();
          call.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        const error = new ProviderError(call.signal?.reason === "canceled" ? "canceled" : "timeout", { provider: "openai" });
        yield { type: "error", error, usage };
      },
      complete: () => Promise.reject(new Error("unused")),
      verify: () => Promise.reject(new Error("unused")),
    };
  }

  function make(adapter: ProviderAdapter, extra: { signal?: AbortSignal; onCall?: (r: LlmCallRecord) => Promise<void> } = {}) {
    const records: LlmCallRecord[] = [];
    const llm = createLlm({
      provider: "openai",
      tier: "default",
      connectionTier: "paid",
      jobId: "job-1",
      keySource: { forJob: async () => SECRET },
      onCall: extra.onCall ?? (async (r) => void records.push(r)),
      signal: extra.signal,
      logger: () => {},
      adapters: { openai: adapter },
    });
    return { llm, records };
  }

  it("run-level signal reaches the adapter when the request has none; abort → one record", async () => {
    const run = new AbortController();
    const seen: { signal?: AbortSignal }[] = [];
    const { llm, records } = make(hangingAdapter(seen), { signal: run.signal });
    const pending = llm.complete(request).catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 5));
    run.abort("deadline");
    expect(await pending).toMatchObject({ code: "timeout" });
    expect(seen[0].signal?.aborted).toBe(true);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ outcome: "failed", errorCode: "timeout" });
  });

  it("complete() rejects only after onCall has settled", async () => {
    const order: string[] = [];
    const errorAdapter = scriptedAdapter([{ type: "error", error: new ProviderError("provider_unavailable"), usage }]);
    const { llm } = make(errorAdapter, {
      onCall: async () => {
        await new Promise((r) => setTimeout(r, 10));
        order.push("recorded");
      },
    });
    await llm.complete(request).catch(() => order.push("rejected"));
    expect(order).toEqual(["recorded", "rejected"]);
  });

  it("an abandoned (suspended) stream is force-recorded by settle(); a late finish is dropped", async () => {
    const run = new AbortController();
    const { llm, records } = make(hangingAdapter([]), { signal: run.signal });
    const it = llm.stream(request)[Symbol.asyncIterator]();
    expect((await it.next()).value).toMatchObject({ type: "delta" });
    // The step gave up on the stream without draining it (runner raced the deadline).
    run.abort("canceled");
    await llm.settle(20);
    expect(records).toEqual([expect.objectContaining({ outcome: "failed", errorCode: "canceled", usage: expect.objectContaining({ usageSource: "unavailable" }) })]);
    // If the generator is resumed later, it must not add a second row.
    await it.next();
    await it.return?.(undefined);
    expect(records).toHaveLength(1);
  });

  it("consumer break before the terminal event → one failed record", async () => {
    const run = new AbortController();
    const { llm, records } = make(hangingAdapter([]), { signal: run.signal });
    run.abort("canceled");
    for await (const e of llm.stream(request)) {
      expect(e.type).toBe("delta");
      break;
    }
    expect(records).toEqual([expect.objectContaining({ outcome: "failed", errorCode: "canceled" })]);
    await llm.settle(5);
    expect(records).toHaveLength(1);
  });

  it("settle() resolves at once when nothing is open, and waits for an in-flight record", async () => {
    const { llm, records } = make(scriptedAdapter([{ type: "done", result: { text: "x", model: "gpt-6.1-terra", usage, latencyMs: 1 } }]), {
      onCall: async (r) => {
        await new Promise((res) => setTimeout(res, 15));
        records.push(r);
      },
    });
    await llm.settle();
    const call = llm.complete(request);
    await new Promise((r) => setTimeout(r, 1));
    await llm.settle(1_000);
    expect(records).toHaveLength(1);
    await call;
  });

  it("settle() keeps waiting (grace bound) for a usage insert slower than the timeout (QA-S3a-10)", async () => {
    let inserted = false;
    const { llm } = make(scriptedAdapter([{ type: "done", result: { text: "x", model: "gpt-6.1-terra", usage, latencyMs: 1 } }]), {
      onCall: async () => {
        await new Promise((res) => setTimeout(res, 40));
        inserted = true;
      },
    });
    const call = llm.complete(request);
    await new Promise((r) => setTimeout(r, 1));
    // Timeout 10 ms < insert 40 ms < timeout + grace 110 ms.
    await llm.settle(10, 100);
    expect(inserted).toBe(true);
    await call;
  });

  it("settle() gives up after timeout + grace when the insert hangs", async () => {
    const { llm } = make(scriptedAdapter([{ type: "done", result: { text: "x", model: "gpt-6.1-terra", usage, latencyMs: 1 } }]), {
      onCall: () => new Promise<void>(() => {}),
    });
    void llm.complete(request);
    await new Promise((r) => setTimeout(r, 1));
    const started = Date.now();
    await llm.settle(10, 20);
    expect(Date.now() - started).toBeLessThan(500);
  });
});
