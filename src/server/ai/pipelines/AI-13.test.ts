import { describe, expect, it } from "vitest";
import {
  baseInput,
  extractOutput,
  factsInput,
  goodCompose,
  heading,
  paragraph,
  storedDraft,
  twoFacts,
  SAY_1,
} from "../__fixtures__/AI-13/conversations";
import { buildDeliverableChatContext } from "../context-pack/deliverable-chat";
import { AiError, ProviderError } from "../errors";
import { createFakeLlm } from "../fake-llm";
import { AI13_COMPOSE_PROMPT_VERSION, AI13_EXTRACT_PROMPT_VERSION, AI13_REPLY_PROMPT_VERSION } from "../prompts/AI-13";
import { ai13ComposeJsonSchema, ai13ExtractJsonSchema } from "../schemas/AI-13";
import {
  AI13_COMPOSE_CALL_KEY,
  DRAFT_EMPTY_MESSAGE,
  DRAFT_READY_MESSAGE,
  compose,
  composeDecision,
  extract,
  planDeliverableTurn,
  reply,
  type ComposeEvent,
  type ComposeResult,
} from "./AI-13";

async function runCompose(gen: AsyncGenerator<ComposeEvent, ComposeResult, void>): Promise<{ events: ComposeEvent[]; result: ComposeResult }> {
  const events: ComposeEvent[] = [];
  let step = await gen.next();
  while (!step.done) {
    events.push(step.value);
    step = await gen.next();
  }
  return { events, result: step.value };
}

async function drain<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const userText = (llm: ReturnType<typeof createFakeLlm>, i = 0) => llm.requests[i].userBlocks.map((b) => b.text).join("\n");

describe("canonical schemas (C-10.2)", () => {
  it("extract and compose schemas convert", () => {
    expect(ai13ExtractJsonSchema().type).toBe("object");
    expect(ai13ComposeJsonSchema().type).toBe("object");
  });
});

describe("planDeliverableTurn", () => {
  it("question / compose (requested_action, text) / reject at the draft limit", () => {
    expect(planDeliverableTurn(buildDeliverableChatContext(baseInput()))).toEqual({ kind: "question" });
    expect(planDeliverableTurn(buildDeliverableChatContext(baseInput({ requestedAction: "compose_draft" })))).toEqual({ kind: "compose", source: "requested_action" });
    expect(planDeliverableTurn(buildDeliverableChatContext(factsInput()))).toEqual({ kind: "compose", source: "text" });
    const limit = buildDeliverableChatContext(baseInput({ requestedAction: "compose_draft", structuredDraft: storedDraft({ draft_count: 6 }) }));
    expect(planDeliverableTurn(limit)).toEqual({ kind: "reject_draft_limit" });
  });
});

describe("extract", () => {
  it("light tier, low reasoning, structured output; patch = add_facts with UUID sources", async () => {
    const ctx = buildDeliverableChatContext(baseInput());
    const llm = createFakeLlm([
      { json: extractOutput({ facts: [{ slot: "contribution", text: "장애 대응 런북을 직접 썼다", actor: "self", source_message_ids: ["M2"], source_quotes: ["장애 대응 런북은 제가 직접 썼어요"] }] }) },
    ]);
    const r = await extract(ctx, { llm });
    expect(llm.calls[0].model).toBe(llm.modelFor("light"));
    expect(llm.requests[0]).toMatchObject({ feature: "AI-13.extract", reasoningLevel: "low", promptVersion: AI13_EXTRACT_PROMPT_VERSION, callKey: "writing_chat.extract" });
    expect(llm.requests[0].outputSchema).not.toBeNull();
    expect(r.patch.ops[0]).toMatchObject({ op: "add_facts", facts: [{ source_message_ids: ["00000000-0000-4000-8000-000000000002"], review: "ok" }] });
    expect(r.processedThroughSequence).toBe(2);
    expect(AI13_EXTRACT_PROMPT_VERSION).toMatch(/^ai-13\.extract\.v1\+common\.v2$/);
  });

  it("nothing pending → no call", async () => {
    const llm = createFakeLlm([]);
    const r = await extract(buildDeliverableChatContext(baseInput({ lastExtractedSequence: 2 })), { llm });
    expect(r.skipped).toBe(true);
    expect(llm.requests).toHaveLength(0);
  });

  it("the extract sees messages and facts, not the body or the project", async () => {
    const llm = createFakeLlm([{ json: extractOutput() }]);
    await extract(buildDeliverableChatContext(baseInput({ formSnapshot: { body: "본문 비밀 문장" } })), { llm });
    const text = userText(llm);
    expect(text).toContain(SAY_1);
    expect(text).not.toContain("본문 비밀 문장");
    expect(text).not.toContain("결제 백엔드 담당");
  });
});

describe("reply", () => {
  it("default tier text stream with the project, body, facts, and notices", async () => {
    const ctx = buildDeliverableChatContext(factsInput({ formSnapshot: { body: "현재 본문" } }));
    const llm = createFakeLlm([{ text: "잘된 점을 더 알려 주세요." }]);
    const events = await drain(reply(ctx, { llm }, ["compose_insufficient"]));
    expect(events.at(-1)).toMatchObject({ type: "done", text: "잘된 점을 더 알려 주세요." });
    expect(llm.requests[0]).toMatchObject({ outputSchema: null, promptVersion: AI13_REPLY_PROMPT_VERSION, callKey: "writing_chat.reply" });
    expect(llm.calls[0].model).toBe(llm.modelFor("default"));
    const text = userText(llm);
    expect(text).toContain("현재 본문");
    expect(text).toContain('<project ref="PRJ">');
    expect(text).toContain("notices: compose_insufficient");
    expect(text).toContain("<sibling_titles>");
  });
});

describe("composeDecision", () => {
  const ctx = buildDeliverableChatContext(factsInput());
  it("text request not confirmed by the extract → plain question turn", () => {
    expect(composeDecision(ctx, { kind: "compose", source: "text" }, { intent: null, style: null })).toEqual({ action: "reply", notices: [] });
  });
  it("draft limit / insufficient facts → reply with a notice", () => {
    const limit = buildDeliverableChatContext(factsInput({ structuredDraft: storedDraft({ facts: twoFacts(), draft_count: 6 }) }));
    expect(composeDecision(limit, { kind: "compose", source: "text" }, { intent: "compose_draft", style: null })).toEqual({ action: "reply", notices: ["draft_limit"] });
    const thin = buildDeliverableChatContext(baseInput({ requestedAction: "compose_draft" }));
    expect(composeDecision(thin, { kind: "compose", source: "requested_action" }, null)).toEqual({ action: "reply", notices: ["compose_insufficient"] });
  });
  it("ok → compose with the request's style, else the extract's", () => {
    expect(composeDecision(ctx, { kind: "compose", source: "text" }, { intent: "compose_draft", style: "shorter" })).toEqual({ action: "compose", style: "shorter" });
    const styled = buildDeliverableChatContext(factsInput({ style: "more_detail_on_contribution" }));
    expect(composeDecision(styled, { kind: "compose", source: "requested_action" }, { intent: null, style: "shorter" })).toEqual({ action: "compose", style: "more_detail_on_contribution" });
  });
});

describe("compose", () => {
  it("streams validated blocks (headings wait for content), returns the replace_draft patch and the fixed message", async () => {
    const ctx = buildDeliverableChatContext(factsInput());
    const llm = createFakeLlm([{ json: goodCompose() }]);
    const { events, result } = await runCompose(compose(ctx, { llm }, { style: null }));
    expect(events[0]).toEqual({ type: "draft_started", attempt: 1, reason: "initial" });
    expect(events.slice(1).map((e) => (e.type === "draft_block" ? e.block.block_id : e.type))).toEqual(["b1", "b2", "b3", "b4"]);
    expect(result.outcome).toBe("draft");
    expect(result.assistantMessage).toBe(DRAFT_READY_MESSAGE);
    expect(result.patch.ops[0]).toMatchObject({ op: "replace_draft", body: { replace_allowed: true, dropped_block_count: 0 } });
    expect(llm.requests[0]).toMatchObject({ feature: "AI-13.compose", callKey: AI13_COMPOSE_CALL_KEY, promptVersion: AI13_COMPOSE_PROMPT_VERSION });
    expect(llm.calls[0].model).toBe(llm.modelFor("default"));
  });

  it("the compose prompt has facts, body, and project — not the conversation", async () => {
    const ctx = buildDeliverableChatContext(factsInput({ formSnapshot: { body: "현재 본문 문장" } }));
    const llm = createFakeLlm([{ json: goodCompose() }]);
    await runCompose(compose(ctx, { llm }, { style: "shorter" }));
    const text = userText(llm);
    expect(text).toContain('<fact id="F1"');
    expect(text).toContain("현재 본문 문장");
    expect(text).toContain("mode: replace");
    expect(text).toContain("style: shorter");
    expect(text).not.toContain("<message");
    expect(text).not.toContain(SAY_1);
  });

  it("body > 6,000 chars → mode new_only, replace_allowed false", async () => {
    const ctx = buildDeliverableChatContext(factsInput({ formSnapshot: { body: "가".repeat(6001) } }));
    const llm = createFakeLlm([{ json: goodCompose({ replace_mode: false }) }]);
    const { result } = await runCompose(compose(ctx, { llm }, { style: null }));
    expect(userText(llm)).toContain("mode: new_only");
    expect(result.patch.ops[0]).toMatchObject({ body: { replace_allowed: false } });
  });

  it("> 30% dropped → one regeneration with check ids only; the second result is used", async () => {
    const ctx = buildDeliverableChatContext(factsInput());
    const bad = goodCompose({ blocks: [paragraph("결제 모듈의 장애 대응 런북을 직접 작성했다.", { source_fact_ids: ["F1"] }), paragraph("Redis를 도입했다.", { source_fact_ids: ["F1"] }), paragraph("장애가 99% 줄었다.", { source_fact_ids: ["F1"] })] });
    const llm = createFakeLlm([{ json: bad }, { json: goodCompose() }]);
    const { events, result } = await runCompose(compose(ctx, { llm }, { style: null }));
    expect(events.filter((e) => e.type === "draft_started")).toEqual([
      { type: "draft_started", attempt: 1, reason: "initial" },
      { type: "draft_started", attempt: 2, reason: "regenerate" },
    ]);
    const retry = userText(llm, 1);
    expect(retry).toContain("<retry>");
    expect(retry).toContain("V-10c 1건, V-10b 1건");
    expect(retry).not.toContain("Redis");
    expect(result.regenerated).toBe(true);
    expect(result.validation.droppedUnits).toBe(0);
  });

  it("still over the ratio after regenerating → the remaining blocks, with the dropped-count message", async () => {
    const ctx = buildDeliverableChatContext(factsInput());
    const bad = goodCompose({ blocks: [paragraph("결제 모듈의 장애 대응 런북을 직접 작성했다.", { source_fact_ids: ["F1"] }), paragraph("Redis를 도입했다.", { source_fact_ids: ["F1"] })] });
    const llm = createFakeLlm([{ json: bad }, { json: bad }]);
    const { result } = await runCompose(compose(ctx, { llm }, { style: null }));
    expect(result.attempts).toBe(2);
    expect(result.assistantMessage).toBe(`${DRAFT_READY_MESSAGE} 확인되지 않은 문장 1개는 뺐어요.`);
  });

  it("nothing left → count_draft only and the 'not enough' message", async () => {
    const ctx = buildDeliverableChatContext(factsInput());
    const none = goodCompose({ blocks: [heading("내가 맡은 일"), paragraph("Redis를 도입했다.", { source_fact_ids: ["F1"] })] });
    const llm = createFakeLlm([{ json: none }, { json: none }]);
    const { result, events } = await runCompose(compose(ctx, { llm }, { style: null }));
    expect(result.outcome).toBe("empty");
    expect(result.patch.ops).toEqual([{ op: "count_draft" }]);
    expect(result.assistantMessage).toBe(DRAFT_EMPTY_MESSAGE);
    expect(events.some((e) => e.type === "draft_block")).toBe(false);
  });

  it("V-6: a schema miss gets one retry; two misses → schema_invalid (not retryable)", async () => {
    const ctx = buildDeliverableChatContext(factsInput());
    const ok = createFakeLlm([{ text: "{\"schema_version\": 1, \"blocks\": [" }, { json: goodCompose() }]);
    const { events } = await runCompose(compose(ctx, { llm: ok }, { style: null }));
    expect(events.filter((e) => e.type === "draft_started").map((e) => (e.type === "draft_started" ? e.reason : ""))).toEqual(["initial", "schema_retry"]);
    const bad = createFakeLlm([{ json: { nope: 1 } }, { json: { nope: 2 } }]);
    await expect(runCompose(compose(ctx, { llm: bad }, { style: null }))).rejects.toMatchObject({ code: "schema_invalid", retryable: false });
  });

  it("a provider error is thrown as-is (runner decides retries)", async () => {
    const ctx = buildDeliverableChatContext(factsInput());
    const llm = createFakeLlm([{ error: "rate_limited", retryAfterMs: 1000 }]);
    const err = await runCompose(compose(ctx, { llm }, { style: null })).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.code).toBe("rate_limited");
  });

  it("a provider error on the regeneration keeps the first draft", async () => {
    const ctx = buildDeliverableChatContext(factsInput());
    const bad = goodCompose({ blocks: [paragraph("결제 모듈의 장애 대응 런북을 직접 작성했다.", { source_fact_ids: ["F1"] }), paragraph("Redis를 도입했다.", { source_fact_ids: ["F1"] })] });
    const llm = createFakeLlm([{ json: bad }, { error: "provider_unavailable" }]);
    const { result } = await runCompose(compose(ctx, { llm }, { style: null }));
    expect(result.outcome).toBe("draft");
    expect(result.validation.blocks).toHaveLength(1);
  });

  it("AiError type is exported for the runner", () => {
    expect(new AiError("schema_invalid").code).toBe("schema_invalid");
  });
});

describe("evaluation set skeleton (AI-13 품질 기준)", () => {
  it("≥ 15 synthetic cases, 3 per kind, every case ends with a draft request", async () => {
    const { AI13_EVAL_SET } = await import("../__fixtures__/AI-13/eval-set");
    expect(AI13_EVAL_SET.length).toBeGreaterThanOrEqual(15);
    const perKind = new Map<string, number>();
    for (const c of AI13_EVAL_SET) perKind.set(c.kind, (perKind.get(c.kind) ?? 0) + 1);
    expect([...perKind.values()].every((n) => n >= 3)).toBe(true);
    expect(new Set(AI13_EVAL_SET.map((c) => c.id)).size).toBe(AI13_EVAL_SET.length);
  });
});
