import { describe, expect, it } from "vitest";
import { z } from "zod";
import { careerRowsFixture } from "../__fixtures__/career-rows";
import { buildCareerPack } from "../context-pack/career-pack";
import { createFakeLlm, type FakeLlmResponse } from "../fake-llm";
import { finalizeBlockNumbers, validateTextBlock } from "../validation/block";
import { ModelEvidenceSchema } from "../validation/evidence";
import { buildAllowedNumbers } from "../validation/numbers";
import { emptyReport, mergeReports } from "../validation/report";
import { stripEvidence } from "../storage/evidence-links";
import type { Llm } from "../llm";
import type { AiStreamEvent } from "./events";
import { AI_STREAM_TERMINAL_EVENT_TYPES, runStructuredStream } from "./structured-stream";

/** A tiny draft-like schema (AI-03 shape, synthetic). */
const Block = z.object({
  block_id: z.string(),
  text: z.string(),
  evidence: z.array(ModelEvidenceSchema),
  placeholders: z.array(z.object({ token: z.string(), hint: z.string() })),
});
const Draft = z.object({ schema_version: z.literal(1), blocks: z.array(Block) });

const pack = buildCareerPack(careerRowsFixture(), { asOf: { year: 2026, month: 10 } });
const allowed = buildAllowedNumbers({ texts: pack.numberSources.factualTexts, numbers: pack.numberSources.computedNumbers });
const ctx = { aliases: pack.aliases, learnings: "forbidden" as const };

const output = {
  schema_version: 1,
  blocks: [
    {
      block_id: "p2-b1",
      text: "결제 승인 API 응답 시간 1.2초 → 0.7초 단축",
      evidence: [{ source_type: "achievement", ref: "ACH-2", field: "metric" }],
      placeholders: [],
    },
    {
      block_id: "p2-b2",
      text: "장애 복구 시간 50% 단축", // invented number
      evidence: [{ source_type: "project_detail", ref: "DET-9", field: "action", quote: "없는 근거" }], // bad ref
      placeholders: [],
    },
  ],
};

async function run(responses: FakeLlmResponse[], signal?: AbortSignal, opts: { finalizeThrows?: boolean; llm?: Llm } = {}) {
  const llm = opts.llm ?? createFakeLlm(responses, { chunkSize: 5 });
  const events: AiStreamEvent[] = [];
  for await (const e of runStructuredStream({
    llm,
    request: { feature: "TEST.stream", promptVersion: "test.v1", callKey: "test.stream.1", systemBlocks: [], userBlocks: [], signal },
    schema: Draft,
    validateBlock: (raw) => {
      const parsed = Block.safeParse(raw);
      if (!parsed.success) return null;
      const r = validateTextBlock({ key: parsed.data.block_id, kind: "draft_block", ...parsed.data }, ctx, allowed);
      return { block_id: parsed.data.block_id, text: r.text, flags: r.outcome.flags };
    },
    finalize: (value) => {
      if (opts.finalizeThrows) throw new Error("db write failed");
      let report = emptyReport();
      const blocks = value.blocks.map((b) => {
        const r = validateTextBlock({ key: b.block_id, kind: "draft_block", ...b }, ctx, allowed);
        const n = finalizeBlockNumbers(r.text, allowed);
        report = mergeReports(report, r.report, n.report);
        return { ...b, text: n.text, flags: [...r.outcome.flags, ...n.flags] };
      });
      return { result: stripEvidence({ ...value, blocks }), validationReport: report, resultId: "draft-1" };
    },
  })) {
    events.push(e);
  }
  return events;
}

describe("runStructuredStream (C-6 streaming)", () => {
  it("streams block events, validates each block, then validated → done", async () => {
    const events = await run([{ json: output }]);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("block_started");
    expect(types.slice(-2)).toEqual(["validated", "done"]);
    expect(types.filter((t) => t === "error")).toEqual([]);

    const deltas = events.filter((e) => e.type === "block_delta" && e.blockId === "p2-b1").map((e) => (e.type === "block_delta" ? e.text : ""));
    expect(deltas.join("")).toBe(output.blocks[0].text);

    const completed = events.filter((e) => e.type === "block_completed");
    expect(completed).toEqual([
      { type: "block_completed", blockId: "p2-b1", block: { block_id: "p2-b1", text: output.blocks[0].text, flags: [] } },
      // Bad evidence → V-4 flag on block completion.
      { type: "block_completed", blockId: "p2-b2", block: { block_id: "p2-b2", text: "장애 복구 시간 50% 단축", flags: ["evidence_check_needed"] } },
    ]);

    const validated = events.find((e) => e.type === "validated");
    expect(validated).toMatchObject({
      result: {
        blocks: [
          { block_id: "p2-b1", text: output.blocks[0].text, flags: [] },
          { block_id: "p2-b2", text: "장애 복구 시간 [수치 확인 필요] 단축", flags: ["evidence_check_needed", "number_check_needed"] },
        ],
      },
      validationReport: { items_total: 2, items_flagged: 1, evidence_removed_v1_ref: 1, number_violations: 1, numbers_replaced: 1 },
    });
    // Storage form never carries evidence (C-3).
    expect(JSON.stringify(validated)).not.toContain('"evidence"');
    expect(events.at(-1)).toEqual({ type: "done", meta: { promptVersion: "test.v1", model: "claude-sonnet-5-5", resultId: "draft-1" } });
  });

  it("schema miss after the stream → single error event (schema_invalid, retryable)", async () => {
    const events = await run([{ json: { schema_version: 1, blocks: [{ block_id: "x", text: "t" }] } }]);
    expect(events.at(-1)).toMatchObject({ type: "error", code: "schema_invalid", retryable: true });
    expect(events.filter((e) => e.type === "validated" || e.type === "done")).toEqual([]);
  });

  it("truncated JSON → schema_invalid", async () => {
    const events = await run([{ text: '{"schema_version":1,"blocks":[{"block_id":"a","text":"부분' }]);
    expect(events.at(-1)).toMatchObject({ type: "error", code: "schema_invalid" });
  });

  it("provider error mid-stream → error event, not retryable after the first token (C-11.3), nothing validated", async () => {
    const events = await run([{ errorAfterChunks: "provider_unavailable", json: output, chunks: 10 }]);
    expect(events.some((e) => e.type === "block_started")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "error", code: "provider_unavailable", retryable: false });
    expect(events.filter((e) => e.type === "validated")).toEqual([]);
  });

  it("provider error before the first token stays retryable", async () => {
    const events = await run([{ error: "rate_limited" }]);
    expect(events).toEqual([{ type: "error", code: "rate_limited", message: expect.any(String), retryable: true, retryAfter: null, quotaResetsAt: null }]);
  });

  it("carries ProviderError retry / quota times as ISO (QA-S3a-01)", async () => {
    const resetAt = new Date("2026-10-28T07:00:00.000Z");
    const daily = await run([{ error: "daily_quota_exhausted", quotaResetsAt: resetAt }]);
    expect(daily.at(-1)).toMatchObject({ type: "error", code: "daily_quota_exhausted", retryable: false, quotaResetsAt: "2026-10-28T07:00:00.000Z", retryAfter: null });
    const limited = await run([{ error: "rate_limited", retryAfterMs: 30_000 }]);
    const last = limited.at(-1) as Extract<AiStreamEvent, { type: "error" }>;
    expect(last.retryAfter).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(last.quotaResetsAt).toBeNull();
  });

  it("safety block → safety_blocked, never retried (C-11.1 cause 7)", async () => {
    const events = await run([{ error: "safety_blocked" }]);
    expect(events.at(-1)).toMatchObject({ type: "error", code: "safety_blocked", retryable: false });
  });

  it("user cancel → canceled", async () => {
    const controller = new AbortController();
    controller.abort("canceled");
    const events = await run([{ json: output }], controller.signal);
    expect(events).toEqual([{ type: "error", code: "canceled", message: expect.any(String), retryable: false, retryAfter: null, quotaResetsAt: null }]);
  });

  describe("exactly one terminal event, always last (QA-S3-02)", () => {
    const isTerminal = (e: AiStreamEvent) => (AI_STREAM_TERMINAL_EVENT_TYPES as readonly string[]).includes(e.type);
    const canceled = new AbortController();
    canceled.abort("canceled");

    /** An Llm that keeps yielding junk after its terminal event, then throws. */
    const misbehaving: Llm = {
      provider: "anthropic",
      tier: "default",
      connectionTier: "paid",
      modelFor: () => "m",
      complete: () => Promise.reject(new Error("unused")),
      settle: async () => {},
      stream: () => ({
        async *[Symbol.asyncIterator]() {
          const text = JSON.stringify(output);
          yield { type: "delta" as const, text };
          yield {
            type: "done" as const,
            result: { text, model: "m", usage: { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: null, usageSource: "provider_reported" as const }, latencyMs: 0 },
          };
          yield { type: "delta" as const, text: '{"late":' };
          throw new Error("late failure");
        },
      }),
    };

    it.each<[string, () => Promise<AiStreamEvent[]>, "done" | "error"]>([
      ["success", () => run([{ json: output }]), "done"],
      ["schema miss", () => run([{ json: { schema_version: 1, blocks: [{ block_id: "x" }] } }]), "error"],
      ["truncated JSON", () => run([{ text: '{"blocks":[' }]), "error"],
      ["provider error mid-stream", () => run([{ errorAfterChunks: "rate_limited", json: output, chunks: 3 }]), "error"],
      ["provider error before output", () => run([{ error: "provider_unavailable" }]), "error"],
      ["cancel", () => run([{ json: output }], canceled.signal), "error"],
      ["finalize throws (e.g. DB write)", () => run([{ json: output }], undefined, { finalizeThrows: true }), "error"],
      ["llm yields after done", () => run([], undefined, { llm: misbehaving }), "done"],
    ])("%s → one %s, last", async (_, go, terminal) => {
      const events = await go();
      const terminals = events.filter(isTerminal);
      expect(terminals).toHaveLength(1);
      expect(events.at(-1)?.type).toBe(terminal);
      if (terminal === "error") expect(events.some((e) => e.type === "validated")).toBe(false);
    });

    it("finalize failure is internal_error (never reported as done)", async () => {
      const events = await run([{ json: output }], undefined, { finalizeThrows: true });
      expect(events.at(-1)).toMatchObject({ type: "error", code: "internal_error", retryable: true });
    });
  });
});

describe("runStructuredStream S7 extensions", () => {
  const Schema = z.object({ sources: z.array(z.object({ id: z.string() })), blocks: z.array(Block) });
  const value = { sources: [{ id: "a" }], blocks: [{ block_id: "b1", text: "본문", evidence: [], placeholders: [] }] };

  it("emits watched values before later blocks, and finalize generators can yield before validated", async () => {
    const llm = createFakeLlm([{ json: value }], { chunkSize: 4 });
    const events: AiStreamEvent[] = [];
    for await (const e of runStructuredStream({
      llm,
      request: { feature: "TEST", promptVersion: "t.v1", callKey: "t", systemBlocks: [], userBlocks: [] },
      schema: Schema,
      watchPaths: ["sources"],
      onValue: (path, v) => [{ type: "sources_selected", selectionMode: "ai", questionClass: null, sources: (v as unknown[]).length ? [] : [] }],
      validateBlock: (raw, _id, at) => ({ path: at.path, text: raw.text }),
      finalize: async function* () {
        yield { type: "adjusting_length", charCount: 1, charLimit: 1, countBasis: "with_spaces", reasons: ["length"] } as AiStreamEvent;
        return { result: {}, validationReport: emptyReport() };
      },
    })) {
      events.push(e);
    }
    const types = events.map((e) => e.type);
    expect(types.indexOf("sources_selected")).toBeLessThan(types.indexOf("block_started"));
    expect(types.slice(-3)).toEqual(["adjusting_length", "validated", "done"]);
    expect(events.find((e) => e.type === "block_completed")).toMatchObject({ block: { path: "blocks.0", text: "본문" } });
  });
});
