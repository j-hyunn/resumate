import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/contracts/errors";
import { ErrorEvent } from "@/lib/contracts/ai";
import { DeliverableTurnEventSchema, type DeliverableTurnEvent } from "@/lib/contracts/writing-chat";
import { createRecordingKeyStatusReporter, createStaticKeySource, createStaticProviderContext, type ProviderContext } from "@/server/jobs/provider-context";
import type { AiWriterSupabaseClient } from "@/server/db/types";
import type { LlmFactoryInput } from "@/server/jobs/types";
import { ProviderError } from "@/server/ai/errors";
import { MemoryJobStore, MemoryUsageStore, createScriptedAdapter, fakeClock, scriptedLlmFactory, type ScriptedResponse } from "@/test/job-fakes";
import { MemoryChatDb, fakeDeliverablePipelines, fakeDocumentPipelines, fakeWritingChatPipelines } from "@/test/writing-chat-fakes";
import { prepareTurn, runTurn, type TurnRequest } from "./turn";
import type { DeliverableComposeOutcome, PipelineCall, TurnDeps } from "./types";
import type { ComposeEvent } from "@/server/ai/pipelines/AI-13";

/**
 * R5 AI-13 deliverable turn exit paths (ai notes §3.3, DM §7 v4.5): question turn (reply ∥ extract →
 * facts_patch / draft_flags), draft turn (extract → compose stream → draft_done → fixed message, no reply
 * call), empty draft, draft failure, the draft-limit 409 before the message is saved, form snapshot
 * validation by target. Fake AI-13 pipelines over the real Llm wrapper (one usage row per call).
 */

const USER = "00000000-0000-4000-8000-000000000001";
const CHAT = "00000000-0000-4000-8000-0000000000d1";
const DELIVERABLE = "00000000-0000-4000-8000-0000000000e1";
const PAID: ProviderContext = { provider: "openai", connectionTier: "paid", keyStatus: "valid" };
const FREE: ProviderContext = { provider: "gemini", connectionTier: "free", keyStatus: "valid" };
const KEY = "sk-test-deliverable-key-0001";
const FIRST_USER_MSG = "00000000-0000-4000-8000-000000000001";

const emptyDraft = (draftCount = 0) => ({
  schema_version: 1,
  target: "project_deliverable",
  writing_kind: null,
  facts: [],
  deliverable: {},
  clarifications: [],
  sensitive_flags_count: 0,
  draft_count: draftCount,
});

const withFacts = (draftCount = 0) => ({
  ...emptyDraft(draftCount),
  writing_kind: "retrospective",
  facts: [
    { id: "f1", slot: "contribution", text: "장애 대응 런북을 직접 작성했다", actor: "self", source_message_ids: [FIRST_USER_MSG], source_quotes: ["런북"], review: "ok" },
    { id: "f2", slot: "went_well", text: "장애 알림이 줄었다", actor: "team", source_message_ids: [FIRST_USER_MSG], source_quotes: ["알림"], review: "needs_review" },
  ],
  clarifications: [{ kind: "number_vague", slot: "went_well", note: null }],
});

const block = { block_id: "b2", type: "paragraph", text: "장애 대응 런북을 직접 작성했다.", basis: "new", source_fact_ids: ["f1"], review: "ok" };
const withDraft = (draftCount: number) => ({
  ...withFacts(draftCount),
  deliverable: { body: { value: "장애 대응 런북을 직접 작성했다.", blocks: [block], rev: draftCount, replace_allowed: true, missing_slots: ["learnings"], dropped_block_count: 1 } },
});

function setup(opts: { context?: ProviderContext; reply?: ScriptedResponse[]; extract?: ScriptedResponse[]; draft?: unknown; deliverable?: boolean } = {}) {
  const clock = fakeClock();
  const store = new MemoryJobStore(clock.now);
  const usage = new MemoryUsageStore(USER);
  const context = opts.context ?? PAID;
  const replyAdapter = createScriptedAdapter(context.provider, opts.reply ?? [], clock.ms);
  const extractAdapter = createScriptedAdapter(context.provider, opts.extract ?? [], clock.ms);
  const replyLlm = scriptedLlmFactory(replyAdapter.adapter, clock.ms);
  const extractLlm = scriptedLlmFactory(extractAdapter.adapter, clock.ms);
  const deliverable = opts.deliverable ?? true;
  const chats = new MemoryChatDb(
    deliverable
      ? { id: CHAT, userId: USER, projectDeliverableId: DELIVERABLE, deliverableDraft: (opts.draft ?? emptyDraft()) as never }
      : { id: CHAT, userId: USER },
    clock.now,
  );
  const deliverablePipelines = fakeDeliverablePipelines();
  const sleeps: number[] = [];
  const deps: TurnDeps = {
    userId: USER,
    chats,
    store,
    usage,
    writer: {} as AiWriterSupabaseClient,
    providerContext: createStaticProviderContext(context),
    keySource: createStaticKeySource(KEY, () => new ProviderError("key_missing")),
    keyStatus: createRecordingKeyStatusReporter(),
    runGate: null,
    createLlm: (input: LlmFactoryInput) => (input.tier === "light" ? extractLlm(input) : replyLlm(input)),
    pipelines: fakeWritingChatPipelines(),
    deliverablePipelines,
    documentPipelines: fakeDocumentPipelines(),
    now: clock.now,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    timing: { heartbeatMs: 1_000_000 },
  };
  return { store, usage, chats, deps, deliverablePipelines, sleeps };
}

async function run(deps: TurnDeps, req: Partial<TurnRequest> & { content: string | null }, signal: AbortSignal = new AbortController().signal) {
  const prepared = await prepareTurn(deps, { chatId: CHAT, requestedSlot: null, ...req });
  if (prepared.kind !== "ready") throw new Error(`blocked ${prepared.code}`);
  const events: DeliverableTurnEvent[] = [];
  await runTurn(deps, prepared, (e) => events.push(e as DeliverableTurnEvent), signal);
  return { prepared, events, job: () => deps.store };
}

/** One compose call through the turn's Llm (records one usage row). */
const composeCall = (call: PipelineCall) =>
  call.llm.complete({
    feature: "AI-13.compose",
    promptVersion: "AI-13.compose.test",
    callKey: call.callKey,
    systemBlocks: [{ text: "s" }],
    userBlocks: [{ text: "u" }],
    outputSchema: { type: "object" },
    signal: call.signal,
  });

const outcomeOf = (patch: unknown, blocks: unknown[] = [block]): DeliverableComposeOutcome => ({
  outcome: blocks.length > 0 ? "draft" : "empty",
  patch,
  validation: { needsReviewBlockIds: [] },
  assistantMessage: "초안을 만들었어요. 확인하고 반영 방식을 골라 주세요.",
});

const types = (events: DeliverableTurnEvent[]) => events.map((e) => e.type);

describe("AI-13 deliverable turn — question turn", () => {
  it("paid: reply ∥ extract, then facts_patch / draft_flags, turn_done with draft_count; snapshot only in memory", async () => {
    const t = setup({ reply: [{ json: "어떤 일을 맡으셨나요?" }], extract: [{ json: { patch: withFacts() } }] });
    const snapshot = { title: "결제 장애 회고", body: "기존 본문", ignored: "dropped" };
    const { prepared, events } = await run(t.deps, { content: "런북을 제가 직접 썼고 알림이 많이 줄었어요", formSnapshot: snapshot });
    for (const e of events) expect(DeliverableTurnEventSchema.safeParse(e).success).toBe(true);
    expect(types(events)).toEqual(["turn_started", "reply_delta", "reply_done", "facts_patch", "draft_flags", "turn_done"]);
    const facts = events[3] as Extract<DeliverableTurnEvent, { type: "facts_patch" }>;
    expect(facts.added).toEqual(["f1", "f2"]);
    const flags = events[4] as Extract<DeliverableTurnEvent, { type: "draft_flags" }>;
    expect(flags).toMatchObject({ needsReview: ["f2"], actorAmbiguous: false, numberVague: true });
    expect(events.at(-1)).toMatchObject({ type: "turn_done", draftStatus: "updated", draftCount: 0, readyToReturn: false, needsReviewCount: 1 });
    expect("chips" in events.at(-1)!).toBe(false);

    // The validated S-44 snapshot (unknown keys dropped) reached the pipeline; nothing of it is in the job row.
    expect(t.deliverablePipelines.seen.snapshots).toEqual([{ title: "결제 장애 회고", body: "기존 본문" }]);
    const job = t.store.jobs.get(prepared.kind === "ready" ? prepared.job.id : "")!;
    expect(job.status).toBe("succeeded");
    expect(JSON.stringify(job)).not.toContain("기존 본문");
    expect(job.params).toMatchObject({ target: "project_deliverable", requested_action: null });
    expect(t.usage.records.map((r) => r.callKey).sort()).toEqual(["writing_chat.turn.2.extract", "writing_chat.turn.2.reply"]);
    expect(t.chats.calls).toContain("markExtracted:2");
  });

  it("free tier: reply → spacing → extract", async () => {
    const t = setup({ context: FREE, reply: [{ json: "질문" }], extract: [{ json: { patch: withFacts() } }] });
    const { events } = await run(t.deps, { content: "답변" });
    expect(types(events)).toEqual(["turn_started", "reply_delta", "reply_done", "facts_patch", "draft_flags", "turn_done"]);
    expect(t.sleeps.length).toBeGreaterThanOrEqual(1);
  });
});

describe("AI-13 deliverable turn — draft turn", () => {
  it("compose_draft: extract → facts → draft_started / draft_block → draft_done → fixed message; no reply call", async () => {
    const t = setup({ reply: [{ json: { blocks: [block], patch: withDraft(1) } }], extract: [{ json: { patch: withFacts() } }] });
    const { prepared, events } = await run(t.deps, { content: "지금까지 내용으로 초안 만들기", requestedAction: "compose_draft" });
    for (const e of events) expect(DeliverableTurnEventSchema.safeParse(e).success).toBe(true);
    expect(types(events)).toEqual(["turn_started", "facts_patch", "draft_flags", "draft_started", "draft_block", "draft_done", "reply_done", "turn_done"]);
    const done = events.find((e) => e.type === "draft_done") as Extract<DeliverableTurnEvent, { type: "draft_done" }>;
    expect(done).toMatchObject({ rev: 1, draftCount: 1, droppedBlockCount: 1, missingSlots: ["learnings"], replaceAllowed: true, needsReviewBlockIds: [] });
    const reply = events.find((e) => e.type === "reply_done") as Extract<DeliverableTurnEvent, { type: "reply_done" }>;
    expect(reply.message.content).toBe("초안을 만들었어요. 확인하고 반영 방식을 골라 주세요.");
    expect(events.at(-1)).toMatchObject({ type: "turn_done", draftCount: 1, draftStatus: "updated" });
    expect(t.deliverablePipelines.seen.reply).toBe(0);
    expect(t.deliverablePipelines.seen.compose).toBe(1);
    const job = t.store.jobs.get(prepared.kind === "ready" ? prepared.job.id : "")!;
    expect(job.progress).toMatchObject({ stage: "validate", total: 3 });
    expect(t.usage.records.map((r) => r.callKey).sort()).toEqual(["writing_chat.turn.2.compose", "writing_chat.turn.2.extract"]);
  });

  it("no content block left: draft counted (count_draft), no draft_done (R-PA-15)", async () => {
    const t = setup({ reply: [{ json: { blocks: [], patch: { ...withFacts(1) } } }], extract: [{ json: { patch: withFacts() } }] });
    const { events } = await run(t.deps, { content: "초안", requestedAction: "compose_draft" });
    expect(types(events)).not.toContain("draft_done");
    expect((events.find((e) => e.type === "reply_done") as Extract<DeliverableTurnEvent, { type: "reply_done" }>).message.content).toBe("초안을 만들 내용이 아직 부족해요.");
    expect(events.at(-1)).toMatchObject({ type: "turn_done", draftCount: 1 });
  });

  it("draft call failure: error, previous draft kept, assistant row failed, one usage row per call", async () => {
    const t = setup({ reply: [{ error: "safety_blocked" }], extract: [{ json: { patch: withFacts() } }] });
    const { prepared, events } = await run(t.deps, { content: "초안", requestedAction: "compose_draft" });
    expect(types(events)).toEqual(["turn_started", "facts_patch", "draft_flags", "draft_started", "error"]);
    // QA-R15-02: the failure event satisfies `ErrorEvent` / the turn's own union, not only `{code}`.
    const err = events.at(-1)!;
    expect(ErrorEvent.safeParse(err).success).toBe(true);
    expect(DeliverableTurnEventSchema.safeParse(err).success).toBe(true);
    expect(err).toMatchObject({ type: "error", code: "safety_blocked", category: "input", failureCause: "input_rejected", retryable: false });
    expect((err as { message: string }).message).toMatch(/[가-힣]/);
    expect(t.chats.chat.deliverableDraft?.draft_count).toBe(0);
    expect(t.chats.chat.messages.at(-1)).toMatchObject({ role: "assistant", status: "failed" });
    const job = t.store.jobs.get(prepared.kind === "ready" ? prepared.job.id : "")!;
    expect(job).toMatchObject({ status: "failed", errorCode: "safety_blocked" });
    expect(t.usage.records).toHaveLength(2);
  });

  it("compose_draft at draft_count 6 → 409 before the user message is saved (no job, no call)", async () => {
    const t = setup({ draft: withDraft(6) });
    await expect(prepareTurn(t.deps, { chatId: CHAT, content: "초안", requestedSlot: null, requestedAction: "compose_draft" })).rejects.toMatchObject({
      code: "writing_chat_draft_limit_reached",
      status: 409,
    });
    expect(t.chats.calls).not.toContain("appendUserMessage");
    expect(t.store.jobs.size).toBe(0);
    expect(t.usage.records).toHaveLength(0);
  });

  it("a free-text request the pipeline answers with a reply (limit notice) streams a reply", async () => {
    const t = setup({ draft: withDraft(6), reply: [{ json: "새 대화에서 이어 해 주세요" }], extract: [{ json: { patch: null } }] });
    // A plan that asks for a draft but decide() sees the limit → reply with the notice.
    t.deps.deliverablePipelines.plan = async () => ({ kind: "compose", source: "text" });
    const { events } = await run(t.deps, { content: "초안 써 줘" });
    expect(types(events)).toEqual(["turn_started", "reply_delta", "reply_done", "turn_done"]);
    expect(t.deliverablePipelines.seen.notices).toEqual([["draft_limit"]]);
  });
});

describe("turn options are checked against the chat's target", () => {
  it("bad snapshot → invalid_form_snapshot (400) before anything is saved", async () => {
    const t = setup();
    await expect(prepareTurn(t.deps, { chatId: CHAT, content: "x", requestedSlot: null, formSnapshot: { body: "가".repeat(20001) } })).rejects.toMatchObject({
      code: "invalid_form_snapshot",
      status: 400,
    });
    // An S-10 shape on a deliverable chat is not an S-44 snapshot either (only title / body are read).
    await expect(prepareTurn(t.deps, { chatId: CHAT, content: "x", requestedSlot: null, formSnapshot: { title: 3 } })).rejects.toMatchObject({ code: "invalid_form_snapshot" });
    expect(t.chats.calls).not.toContain("appendUserMessage");
  });

  it("AI-12 slots / AI-13 options on the wrong chat → invalid_input", async () => {
    const d = setup();
    await expect(prepareTurn(d.deps, { chatId: CHAT, content: "x", requestedSlot: { slot: "period" } })).rejects.toBeInstanceOf(AppError);
    const s = setup({ deliverable: false });
    await expect(prepareTurn(s.deps, { chatId: CHAT, content: "x", requestedSlot: null, requestedAction: "compose_draft" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(prepareTurn(s.deps, { chatId: CHAT, content: "x", requestedSlot: { slot: "contribution" } })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(prepareTurn(s.deps, { chatId: CHAT, content: "x", requestedSlot: null, formSnapshot: { star: { action: "가".repeat(2001) } } })).rejects.toMatchObject({
      code: "invalid_form_snapshot",
    });
  });
});

describe("AI-13 draft turn — exit paths (QA-R5-02)", () => {
  const jobOf = (t: ReturnType<typeof setup>, r: Awaited<ReturnType<typeof run>>) => t.store.jobs.get(r.prepared.kind === "ready" ? r.prepared.job.id : "")!;
  const composeRows = (t: ReturnType<typeof setup>) => t.usage.records.filter((r) => r.callKey?.endsWith(".compose"));

  it("a compose failure before any block is retried at once (timeout → retry_now); the second call's draft is stored", async () => {
    const t = setup({ reply: [{ error: "timeout" }, { json: { blocks: [block], patch: withDraft(1) } }], extract: [{ json: { patch: withFacts() } }] });
    const r = await run(t.deps, { content: "초안", requestedAction: "compose_draft" });
    expect(types(r.events)).toEqual(["turn_started", "facts_patch", "draft_flags", "draft_started", "draft_started", "draft_block", "draft_done", "reply_done", "turn_done"]);
    expect(jobOf(t, r).status).toBe("succeeded");
    expect(composeRows(t).map((u) => u.outcome)).toEqual(["failed", "succeeded"]);
    expect(t.chats.chat.deliverableDraft?.draft_count).toBe(1);
  });

  it("a compose failure after a block was shown is not retried: error, previous draft kept, assistant row failed", async () => {
    const t = setup({ reply: [{ error: "timeout" }, { json: "unused" }], extract: [{ json: { patch: withFacts() } }] });
    t.deps.deliverablePipelines.compose = async function* (call): AsyncGenerator<ComposeEvent, DeliverableComposeOutcome, void> {
      yield { type: "draft_started", attempt: 1, reason: "initial" };
      yield { type: "draft_block", attempt: 1, block: { ...block, level: null, items: null, rows: null, source_body_quotes: [], source_project_fields: [], basis: "new", review: "ok" } as never };
      await composeCall(call);
      return outcomeOf(withDraft(1));
    };
    const r = await run(t.deps, { content: "초안", requestedAction: "compose_draft" });
    expect(types(r.events)).toEqual(["turn_started", "facts_patch", "draft_flags", "draft_started", "draft_block", "error"]);
    expect(r.events.at(-1)).toMatchObject({ type: "error", code: "timeout" });
    expect(jobOf(t, r)).toMatchObject({ status: "failed", errorCode: "timeout" });
    expect(composeRows(t)).toHaveLength(1);
    expect(t.chats.chat.deliverableDraft?.draft_count).toBe(0);
    expect(t.chats.chat.messages.at(-1)).toMatchObject({ role: "assistant", status: "failed" });
  });

  it("regeneration inside one compose (2 provider calls) → 2 usage rows for compose", async () => {
    const t = setup({ reply: [{ json: "first" }, { json: "regenerated" }], extract: [{ json: { patch: withFacts() } }] });
    t.deps.deliverablePipelines.compose = async function* (call): AsyncGenerator<ComposeEvent, DeliverableComposeOutcome, void> {
      yield { type: "draft_started", attempt: 1, reason: "initial" };
      await composeCall(call);
      yield { type: "draft_started", attempt: 2, reason: "regenerate" };
      await composeCall(call);
      return outcomeOf(withDraft(1));
    };
    const r = await run(t.deps, { content: "초안", requestedAction: "compose_draft" });
    expect(types(r.events)).toEqual(["turn_started", "facts_patch", "draft_flags", "draft_started", "draft_started", "draft_done", "reply_done", "turn_done"]);
    expect(composeRows(t).map((u) => u.outcome)).toEqual(["succeeded", "succeeded"]);
    expect(t.usage.records).toHaveLength(3);
  });

  it("the RPC rejects replace_draft (R5-API-6): schema_invalid, previous draft kept, job failed", async () => {
    const t = setup({ reply: [{ json: { blocks: [block], patch: withDraft(1) } }], extract: [{ json: { patch: withFacts() } }] });
    const original = t.chats.applyDeliverablePatch.bind(t.chats);
    let n = 0;
    t.chats.applyDeliverablePatch = async (chatId, patch) => {
      n += 1;
      if (n === 1) return original(chatId, patch);
      return { draft: structuredClone(t.chats.chat.deliverableDraft!), rejected: [{ index: 0, op: "replace_draft", reason: "invalid_source" }] };
    };
    const r = await run(t.deps, { content: "초안", requestedAction: "compose_draft" });
    expect(types(r.events)).toEqual(["turn_started", "facts_patch", "draft_flags", "draft_started", "draft_block", "error"]);
    expect(r.events.at(-1)).toMatchObject({ code: "schema_invalid" });
    expect(jobOf(t, r)).toMatchObject({ status: "failed", errorCode: "schema_invalid" });
    expect(t.chats.chat.deliverableDraft?.draft_count).toBe(0);
    expect(t.chats.chat.messages.at(-1)).toMatchObject({ role: "assistant", status: "failed" });
  });

  it("draft-limit race at store time (R5-API-5): fixed limit message, turn done, draft unchanged", async () => {
    const t = setup({ reply: [{ json: { blocks: [block], patch: withDraft(1) } }], extract: [{ json: { patch: withFacts(5) } }] });
    const original = t.chats.applyDeliverablePatch.bind(t.chats);
    let n = 0;
    t.chats.applyDeliverablePatch = async (chatId, patch) => {
      n += 1;
      if (n === 1) return original(chatId, patch);
      throw new AppError("writing_chat_draft_limit_reached", undefined, { status: 409 });
    };
    const r = await run(t.deps, { content: "초안", requestedAction: "compose_draft" });
    expect(types(r.events).slice(-2)).toEqual(["reply_done", "turn_done"]);
    expect(types(r.events)).not.toContain("draft_done");
    const reply = r.events.find((e) => e.type === "reply_done") as Extract<DeliverableTurnEvent, { type: "reply_done" }>;
    expect(reply.message.content).toContain("초안을 6번까지");
    expect(r.events.at(-1)).toMatchObject({ type: "turn_done", draftCount: 5 });
    expect(jobOf(t, r).status).toBe("succeeded");
  });

  it("client disconnect during the draft: canceled job, assistant row failed, the open call still recorded", async () => {
    const t = setup({ reply: [{ hang: true }], extract: [{ json: { patch: withFacts() } }] });
    const client = new AbortController();
    t.deps.deliverablePipelines.compose = async function* (call): AsyncGenerator<ComposeEvent, DeliverableComposeOutcome, void> {
      yield { type: "draft_started", attempt: 1, reason: "initial" };
      setTimeout(() => client.abort(), 0);
      await composeCall(call);
      return outcomeOf(withDraft(1));
    };
    const r = await run(t.deps, { content: "초안", requestedAction: "compose_draft" }, client.signal);
    expect(jobOf(t, r)).toMatchObject({ status: "canceled", errorCode: "canceled" });
    expect(t.chats.chat.deliverableDraft?.draft_count).toBe(0);
    expect(t.chats.chat.messages.at(-1)).toMatchObject({ role: "assistant", status: "failed" });
    expect(composeRows(t)).toHaveLength(1);
    expect(types(r.events)).not.toContain("turn_done");
  });

  it("compose timeout twice (one immediate retry, C-11.3): failed with timeout, 2 compose usage rows", async () => {
    const t = setup({ reply: [{ hang: true }, { hang: true }], extract: [{ json: { patch: withFacts() } }] });
    t.deps.timing = { ...t.deps.timing, composeTimeoutMs: { paid: 20, free: 20 }, minCallMs: 10 };
    const r = await run(t.deps, { content: "초안", requestedAction: "compose_draft" });
    expect(r.events.at(-1)).toMatchObject({ type: "error", code: "timeout" });
    expect(jobOf(t, r)).toMatchObject({ status: "failed", errorCode: "timeout" });
    expect(composeRows(t)).toHaveLength(2);
    expect(t.chats.chat.deliverableDraft?.draft_count).toBe(0);
  });
});
