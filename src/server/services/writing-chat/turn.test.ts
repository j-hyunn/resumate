import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/contracts/errors";
import { WritingChatTurnEventSchema, type WritingChatTurnEvent } from "@/lib/contracts/writing-chat";
import { resolveModel } from "@/server/ai/providers/models";
import {
  createRecordingKeyStatusReporter,
  createStaticKeySource,
  createStaticProviderContext,
  runGateError,
  type ProviderContext,
} from "@/server/jobs/provider-context";
import type { AiWriterSupabaseClient } from "@/server/db/types";
import type { LlmFactoryInput } from "@/server/jobs/types";
import { MemoryJobStore, MemoryUsageStore, createScriptedAdapter, fakeClock, scriptedLlmFactory, type ScriptedResponse } from "@/test/job-fakes";
import { MemoryChatDb, fakeWritingChatPipelines } from "@/test/writing-chat-fakes";
import { ProviderError } from "@/server/ai/errors";
import { hasRoomForTurn, prepareTurn, remainingMessages, runTurn, type PreparedTurn } from "./turn";
import type { TurnDeps } from "./types";

/**
 * AI-12 turn exit paths (S4 plan API 2/5): paid parallel, free sequential,
 * extract failure, reply failure + "다시 보내기", limit, gates, disconnect.
 * Real createLlm over scripted adapters (one for reply, one for extract), so
 * usage records are exactly one per provider call.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const CHAT = "00000000-0000-4000-8000-0000000000c1";
const PAID: ProviderContext = { provider: "anthropic", connectionTier: "paid", keyStatus: "valid" };
const FREE: ProviderContext = { provider: "gemini", connectionTier: "free", keyStatus: "valid" };
const KEY = "sk-ant-test-secret-key-0001";
/** Id the in-memory chat gives the first appended message. */
const FIRST_USER_MSG = "00000000-0000-4000-8000-000000000001";

const draftWith = (userMessageId: string) => ({
  schema_version: 1,
  project: {
    name: { value: "결제 개선", origin: "ai", source_message_ids: [userMessageId], source_quotes: ["결제 개선"], review: "ok", reviewed_at: null },
  },
  details: [
    {
      detail_key: "D1",
      existing_detail_id: null,
      fields: {
        situation: { value: "트래픽이 늘었다", origin: "ai", source_message_ids: [userMessageId], source_quotes: ["트래픽"], review: "needs_review", reviewed_at: null },
      },
      achievements: [],
    },
  ],
  skills: [],
  clarifications: [{ kind: "actor_ambiguous", field: "action", detail_key: "D1", existing_detail_id: null }],
  sensitive_flags_count: 1,
});

function setup(opts: {
  context?: ProviderContext | null;
  contextError?: AppError;
  reply?: ScriptedResponse[];
  extract?: ScriptedResponse[];
  chat?: ConstructorParameters<typeof MemoryChatDb>[0];
  gate?: TurnDeps["runGate"];
  key?: string | null;
}) {
  const clock = fakeClock();
  const store = new MemoryJobStore(clock.now);
  const usage = new MemoryUsageStore(USER);
  const keyStatus = createRecordingKeyStatusReporter();
  const context = opts.context === undefined ? PAID : opts.context;
  const provider = context?.provider ?? "anthropic";
  const replyAdapter = createScriptedAdapter(provider, opts.reply ?? [], clock.ms);
  const extractAdapter = createScriptedAdapter(provider, opts.extract ?? [], clock.ms);
  const replyLlm = scriptedLlmFactory(replyAdapter.adapter, clock.ms);
  const extractLlm = scriptedLlmFactory(extractAdapter.adapter, clock.ms);
  const chats = new MemoryChatDb(opts.chat ?? { id: CHAT, userId: USER }, clock.now);
  const pipelines = fakeWritingChatPipelines();
  const sleeps: number[] = [];
  const llmTiers: string[] = [];
  const providerContext = opts.contextError
    ? { forUser: async () => Promise.reject(opts.contextError), assertJobRunnable: async () => {} }
    : createStaticProviderContext(context);
  const deps: TurnDeps = {
    userId: USER,
    chats,
    store,
    usage,
    writer: {} as AiWriterSupabaseClient,
    providerContext,
    keySource: createStaticKeySource(opts.key === undefined ? KEY : opts.key, () => new ProviderError("key_missing")),
    keyStatus,
    runGate: opts.gate ?? null,
    createLlm: (input: LlmFactoryInput) => {
      llmTiers.push(input.tier);
      return input.tier === "light" ? extractLlm(input) : replyLlm(input);
    },
    pipelines,
    now: clock.now,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    timing: { heartbeatMs: 1_000_000 },
  };
  return { clock, store, usage, keyStatus, chats, pipelines, deps, replyAdapter, extractAdapter, sleeps, llmTiers };
}

async function runFull(deps: TurnDeps, content: string | null, signal: AbortSignal = new AbortController().signal) {
  const prepared = await prepareTurn(deps, { chatId: CHAT, content, requestedSlot: null });
  if (prepared.kind !== "ready") return { prepared, events: [] as WritingChatTurnEvent[] };
  const events: WritingChatTurnEvent[] = [];
  await runTurn(deps, prepared, (e) => events.push(e), signal);
  return { prepared, events };
}

const types = (events: WritingChatTurnEvent[]) => events.map((e) => e.type);

describe("AI-12 turn — paid tier (parallel)", () => {
  it("streams the reply, applies the extract patch, records one usage row per call, never writes career data", async () => {
    // The extract patch references the user message the turn appends (ids are deterministic in the fake).
    const t = setup({ reply: [{ json: "어떤 프로젝트였나요?" }], extract: [{ json: draftWith(FIRST_USER_MSG) }] });

    const { prepared, events } = await runFull(t.deps, "결제 개선 프로젝트였어요");
    expect(prepared.kind).toBe("ready");
    for (const e of events) expect(WritingChatTurnEventSchema.safeParse(e).success).toBe(true);
    expect(types(events)).toEqual(["turn_started", "reply_delta", "reply_done", "draft_patch", "draft_flags", "turn_done"]);

    const started = events[0] as Extract<WritingChatTurnEvent, { type: "turn_started" }>;
    expect(started.userMessage.sequence).toBe(2);
    // R1 A5: greeting not counted → user 1 + reply 1.
    expect(started.messageCount).toBe(2);
    const flags = events.find((e) => e.type === "draft_flags") as Extract<WritingChatTurnEvent, { type: "draft_flags" }>;
    expect(flags.needsReview).toHaveLength(1);
    expect(flags.sensitiveAdded).toBe(1);
    expect(flags.clarifications[0]!.kind).toBe("actor_ambiguous");
    const done = events.at(-1) as Extract<WritingChatTurnEvent, { type: "turn_done" }>;
    expect(done.draftUpdated).toBe(true);
    expect(done.progress.slots.find((s) => s.slot === "situation")!.filled).toBe(true);

    const job = t.store.jobs.get(started.jobId)!;
    expect(job.status).toBe("succeeded");
    expect(job.jobType).toBe("writing_chat_turn");
    expect(job.targetId).toBe(CHAT);
    expect(t.usage.forJob(job.id).map((r) => [r.callKey, r.modelTier, r.outcome])).toEqual(
      expect.arrayContaining([
        ["writing_chat.turn.2.reply", "default", "succeeded"],
        ["writing_chat.turn.2.extract", "light", "succeeded"],
      ]),
    );
    expect(t.usage.records).toHaveLength(2);
    expect(t.chats.chat.messages.map((m) => [m.role, m.status])).toEqual([
      ["assistant", "done"],
      ["user", "done"],
      ["assistant", "done"],
    ]);
    expect(t.chats.chat.messages[2]!.content).toBe(JSON.stringify("어떤 프로젝트였나요?"));
    expect(t.chats.chat.messages[2]!.model).toBe(resolveModel("anthropic", "default"));
    expect(t.chats.calls).toContain("markExtracted:2");
    expect(t.keyStatus.successes).toEqual([job.id]);
    // The key never reaches events, job rows, or usage rows.
    expect(JSON.stringify([events, [...t.store.jobs.values()], t.usage.records])).not.toContain(KEY);
  });

  it("an extract failure never blocks the reply; the messages stay pending for the next turn", async () => {
    const t = setup({ reply: [{ json: "다음 질문" }, { json: "또 질문" }], extract: [{ error: "provider_unavailable" }, { json: draftWith(FIRST_USER_MSG) }] });
    const first = await runFull(t.deps, "첫 답변");
    expect(types(first.events)).toEqual(["turn_started", "reply_delta", "reply_done", "turn_done"]);
    const done = first.events.at(-1) as Extract<WritingChatTurnEvent, { type: "turn_done" }>;
    expect(done.draftUpdated).toBe(false);
    const job = t.store.jobs.get(done.jobId)!;
    expect(job.status).toBe("succeeded");
    // provider_unavailable needs a wait → not retried inside the stream (spec-gaps 2026-10-30 ③): 1 extract record.
    expect(t.usage.forJob(job.id).filter((r) => r.callKey?.endsWith("extract")).map((r) => r.outcome)).toEqual(["failed"]);
    expect(t.chats.chat.lastExtractedSequence).toBe(0);

    // Next turn: both user messages are extracted together.
    const second = await runFull(t.deps, "둘째 답변");
    expect(types(second.events)).toContain("draft_patch");
    expect(t.chats.calls).toContain("markExtracted:4");
  });

  it("a reply that fails before the first token with a wait cause fails the turn; the finished extract is kept, not repeated on resend", async () => {
    const t = setup({ reply: [{ error: "rate_limited", retryAfterMs: 5_000 }, { json: "다시 만든 응답" }], extract: [{ json: draftWith(FIRST_USER_MSG) }] });
    const first = await runFull(t.deps, "답변");
    expect(types(first.events)).toEqual(["turn_started", "draft_patch", "draft_flags", "error"]);
    const err = first.events.at(-1) as Extract<WritingChatTurnEvent, { type: "error" }>;
    expect(err.code).toBe("rate_limited");
    // QA-S4-01: final retry_after per C-11.3 (rate limit: at least 1 min), not the short wait.
    expect(Date.parse(err.retryAfter!) - t.clock.ms()).toBeGreaterThanOrEqual(60_000);
    const failedJob = t.store.jobs.get((first.events[0] as Extract<WritingChatTurnEvent, { type: "turn_started" }>).jobId)!;
    expect(failedJob.status).toBe("failed");
    expect(failedJob.errorCode).toBe("rate_limited");
    expect(Date.parse(failedJob.retryAfter!) - t.clock.ms()).toBeGreaterThanOrEqual(60_000);
    expect(t.chats.chat.messages.at(-1)!.status).toBe("failed");
    expect(t.chats.chat.messageCount).toBe(2);
    expect(t.keyStatus.failures).toEqual([{ jobId: failedJob.id, cause: "rate_limited" }]);

    // "다시 보내기": same user message, failed row reused, count unchanged, extract not called again.
    const resend = await runFull(t.deps, null);
    expect(types(resend.events)).toEqual(["turn_started", "reply_delta", "reply_done", "turn_done"]);
    const started = resend.events[0] as Extract<WritingChatTurnEvent, { type: "turn_started" }>;
    expect(started.retry).toBe(true);
    expect(started.userMessage.sequence).toBe(2);
    expect(started.assistantMessageId).toBe(first.prepared.kind === "ready" ? first.prepared.assistant.id : "");
    expect(t.chats.chat.messageCount).toBe(2);
    expect(t.chats.chat.messages).toHaveLength(3);
    expect(t.chats.calls.filter((c) => c === "appendUserMessage")).toHaveLength(1);
    expect(t.pipelines.seen.extract).toBe(1);
    expect(t.usage.forJob(started.jobId)).toHaveLength(1);
    // The failed reply never reaches the model input of the resend.
    expect(t.pipelines.seen.historyIds.at(-1)).not.toContain(started.assistantMessageId);
  });

  it("a reply timeout before the first token is retried once immediately", async () => {
    const t = setup({ reply: [{ error: "timeout" }, { json: "응답" }], extract: [{ json: null }] });
    const { events } = await runFull(t.deps, "답변");
    expect(types(events)).toEqual(["turn_started", "reply_delta", "reply_done", "turn_done"]);
    const jobId = (events[0] as Extract<WritingChatTurnEvent, { type: "turn_started" }>).jobId;
    expect(t.usage.forJob(jobId).filter((r) => r.callKey?.endsWith("reply")).map((r) => r.outcome)).toEqual(["failed", "succeeded"]);
    // extract returned no patch: nothing applied, messages marked extracted.
    expect(t.chats.calls).not.toContain("applyAiPatch");
    expect(t.chats.calls).toContain("markExtracted:2");
  });

  it("a stream cut after the first token is not retried; the partial text is kept on the failed row", async () => {
    const t = setup({ reply: [{ errorAfterChunks: "provider_unavailable", json: "abcdef", chunks: 3 }], extract: [{ json: null }] });
    const { events } = await runFull(t.deps, "답변");
    expect(types(events)).toEqual(["turn_started", "reply_delta", "reply_delta", "reply_delta", "error"]);
    expect(t.chats.chat.messages.at(-1)).toMatchObject({ status: "failed", content: '"ab' });
    expect(t.replyAdapter.calls).toHaveLength(1);
  });

  it("key_invalid marks the key invalid", async () => {
    const t = setup({ reply: [{ error: "key_invalid" }], extract: [{ error: "key_invalid" }] });
    const { events } = await runFull(t.deps, "답변");
    expect((events.at(-1) as { code: string }).code).toBe("key_invalid");
    expect(t.keyStatus.invalidated).toHaveLength(1);
  });

  it("client disconnect stops the provider stream: reply failed, job canceled, the open calls still recorded", async () => {
    const t = setup({ reply: [{ hang: true }], extract: [{ hang: true }] });
    const client = new AbortController();
    const prepared = (await prepareTurn(t.deps, { chatId: CHAT, content: "답변", requestedSlot: null })) as PreparedTurn;
    const events: WritingChatTurnEvent[] = [];
    const running = runTurn(t.deps, prepared, (e) => events.push(e), client.signal);
    await new Promise((r) => setTimeout(r, 5));
    client.abort();
    await running;
    expect(t.store.jobs.get(prepared.job.id)!.status).toBe("canceled");
    expect(t.chats.chat.messages.at(-1)!.status).toBe("failed");
    expect(t.usage.forJob(prepared.job.id).map((r) => r.errorCode).sort()).toEqual(["canceled", "canceled"]);
  });
});

describe("AI-12 turn — final failure causes (QA-S4-01 / 07)", () => {
  it("provider_unavailable before the first token: retry_after = now + 1 min, no wait inside the stream", async () => {
    const t = setup({ reply: [{ error: "provider_unavailable" }], extract: [{ json: null }] });
    const { events } = await runFull(t.deps, "답변");
    const err = events.at(-1) as Extract<WritingChatTurnEvent, { type: "error" }>;
    // category / failureCause are added by the SSE layer from the code.
    expect(err).toMatchObject({ code: "provider_unavailable", quotaResetsAt: null });
    expect(Date.parse(err.retryAfter!) - t.clock.ms()).toBe(60_000);
    const jobId = (events[0] as Extract<WritingChatTurnEvent, { type: "turn_started" }>).jobId;
    expect(t.store.jobs.get(jobId)).toMatchObject({ status: "failed", errorCode: "provider_unavailable" });
    expect(t.replyAdapter.calls).toHaveLength(1);
    expect(t.keyStatus.failures).toEqual([{ jobId, cause: "provider_unavailable" }]);
  });

  it("daily_quota_exhausted: no retry, quotaResetsAt from the provider, no retry_after", async () => {
    const resetsAt = new Date("2026-10-28T08:00:00.000Z");
    const t = setup({ reply: [{ error: "daily_quota_exhausted", quotaResetsAt: resetsAt }], extract: [{ json: null }] });
    const { events } = await runFull(t.deps, "답변");
    const err = events.at(-1) as Extract<WritingChatTurnEvent, { type: "error" }>;
    expect(err).toMatchObject({ code: "daily_quota_exhausted", retryAfter: null, quotaResetsAt: resetsAt.toISOString() });
    const jobId = (events[0] as Extract<WritingChatTurnEvent, { type: "turn_started" }>).jobId;
    expect(t.store.jobs.get(jobId)).toMatchObject({ status: "failed", errorCode: "daily_quota_exhausted", quotaResetsAt: resetsAt.toISOString(), retryAfter: null });
    expect(t.replyAdapter.calls).toHaveLength(1);
  });
});

describe("AI-12 turn — draftStatus and orphaned replies (QA-S4-04 / 05)", () => {
  it("resend with nothing pending → draftStatus unchanged (draftUpdated true); failed extract → failed", async () => {
    const t = setup({ reply: [{ error: "rate_limited" }, { json: "다시" }], extract: [{ json: null }] });
    await runFull(t.deps, "답변");
    const resend = await runFull(t.deps, null);
    expect(resend.events.at(-1)).toMatchObject({ type: "turn_done", draftStatus: "unchanged", draftUpdated: true });

    const u = setup({ reply: [{ json: "q" }], extract: [{ error: "provider_unavailable" }] });
    const { events } = await runFull(u.deps, "답변");
    expect(events.at(-1)).toMatchObject({ type: "turn_done", draftStatus: "failed", draftUpdated: false });
  });

  it("a reply left streaming by a dead turn is closed as failed so resend works at once", async () => {
    const t = setup({ reply: [{ json: "다시 만든 응답" }], extract: [] });
    t.chats.chat.messages.push(
      { id: "00000000-0000-4000-8000-0000000000e2", sequence: 2, role: "user", content: "u", status: "done", aiJobId: null, provider: null, model: null, modelTier: null, connectionTier: null, createdAt: "" },
      { id: "00000000-0000-4000-8000-0000000000e3", sequence: 3, role: "assistant", content: "par", status: "streaming", aiJobId: null, provider: "anthropic", model: "m", modelTier: "default", connectionTier: "paid", createdAt: "" },
    );
    t.chats.chat.messageCount = 2;
    t.chats.chat.lastExtractedSequence = 2;
    const { events } = await runFull(t.deps, null);
    expect(events.map((e) => e.type)).toEqual(["turn_started", "reply_delta", "reply_done", "turn_done"]);
    expect(t.chats.calls).toContain("finishAssistant:failed");
    expect(t.chats.chat.messages.at(-1)).toMatchObject({ id: "00000000-0000-4000-8000-0000000000e3", status: "done" });
    expect(t.chats.chat.messageCount).toBe(2);
  });
});

describe("AI-12 turn — free tier (sequential, C-12)", () => {
  it("reply first, then extract after the call spacing", async () => {
    const t = setup({ context: FREE, reply: [{ json: "질문" }], extract: [{ json: draftWith(FIRST_USER_MSG) }] });
    const { events } = await runFull(t.deps, "답변");
    expect(types(events)).toEqual(["turn_started", "reply_delta", "reply_done", "draft_patch", "draft_flags", "turn_done"]);
    expect(t.llmTiers).toEqual(["default", "light"]);
    expect(t.sleeps).toEqual([6_000]);
    const job = t.store.jobs.get((events[0] as Extract<WritingChatTurnEvent, { type: "turn_started" }>).jobId)!;
    expect(job.connectionTier).toBe("free");
    expect(t.usage.forJob(job.id).map((r) => r.connectionTier)).toEqual(["free", "free"]);
  });

  it("a failed reply skips the extract call (pending for the next turn)", async () => {
    const t = setup({ context: FREE, reply: [{ error: "rate_limited" }], extract: [] });
    const { events } = await runFull(t.deps, "답변");
    expect(types(events)).toEqual(["turn_started", "error"]);
    expect(t.pipelines.seen.extract).toBe(0);
    expect(t.usage.records).toHaveLength(1);
  });
});

describe("AI-12 turn — gates and limits", () => {
  it("message limit (40 = user + AI, greeting excluded — R1 A5): refused before any job or message", async () => {
    expect(hasRoomForTurn(0)).toBe(true);
    expect(hasRoomForTurn(38)).toBe(true);
    expect(hasRoomForTurn(39)).toBe(false);
    expect(hasRoomForTurn(40)).toBe(false);
    expect(remainingMessages(0)).toBe(40);
    expect(remainingMessages(38)).toBe(2);
    expect(remainingMessages(40)).toBe(0);
    const t = setup({ chat: { id: CHAT, userId: USER, messageCount: 39 } });
    await expect(prepareTurn(t.deps, { chatId: CHAT, content: "x", requestedSlot: null })).rejects.toMatchObject({ code: "message_limit_reached", status: 409 });
    expect(t.store.jobs.size).toBe(0);
    expect(t.chats.calls).not.toContain("appendUserMessage");
  });

  it("not connected / consent missing → key_missing, invalid key → key_invalid (no job, no message, no call)", async () => {
    for (const [opts, code] of [
      [{ context: null }, "key_missing"],
      [{ contextError: runGateError("ai_consent_required") }, "key_missing"],
      [{ context: { ...PAID, keyStatus: "invalid" as const } }, "key_invalid"],
    ] as const) {
      const t = setup(opts);
      const prepared = await prepareTurn(t.deps, { chatId: CHAT, content: "x", requestedSlot: null });
      expect(prepared).toEqual({ kind: "blocked", code, jobId: null });
      expect(t.store.jobs.size).toBe(0);
      expect(t.chats.calls).toEqual(["load"]);
    }
  });

  it("run gate blocks after the job was created: job failed with the gate code, no message", async () => {
    const t = setup({ gate: async () => "key_missing" });
    const prepared = await prepareTurn(t.deps, { chatId: CHAT, content: "x", requestedSlot: null });
    expect(prepared.kind).toBe("blocked");
    const job = [...t.store.jobs.values()][0]!;
    expect(job).toMatchObject({ status: "failed", errorCode: "key_missing" });
    expect(t.chats.calls).not.toContain("appendUserMessage");
    expect(t.usage.records).toHaveLength(0);
  });

  it("one turn at a time per chat", async () => {
    const t = setup({ reply: [{ hang: true }], extract: [{ hang: true }] });
    const first = await prepareTurn(t.deps, { chatId: CHAT, content: "a", requestedSlot: null });
    expect(first.kind).toBe("ready");
    await expect(prepareTurn(t.deps, { chatId: CHAT, content: "b", requestedSlot: null })).rejects.toMatchObject({ code: "turn_in_progress" });
  });

  it("closed chat and nothing to resend are refused", async () => {
    const t = setup({ chat: { id: CHAT, userId: USER, status: "saved" } });
    await expect(prepareTurn(t.deps, { chatId: CHAT, content: "x", requestedSlot: null })).rejects.toMatchObject({ code: "writing_chat_not_active" });
    const u = setup({});
    await expect(prepareTurn(u.deps, { chatId: CHAT, content: null, requestedSlot: null })).rejects.toMatchObject({ code: "nothing_to_retry" });
    await expect(prepareTurn(u.deps, { chatId: "00000000-0000-4000-8000-0000000000ff", content: "x", requestedSlot: null })).rejects.toMatchObject({ code: "not_found" });
  });

  it("append refused by the RPC (limit reached meanwhile): the job is canceled, no call", async () => {
    const t = setup({});
    t.chats.failNext.appendUserMessage = new AppError("message_limit_reached", undefined, { status: 409 });
    await expect(prepareTurn(t.deps, { chatId: CHAT, content: "x", requestedSlot: null })).rejects.toMatchObject({ code: "message_limit_reached" });
    expect([...t.store.jobs.values()][0]).toMatchObject({ status: "canceled" });
    expect(t.usage.records).toHaveLength(0);
  });
});
