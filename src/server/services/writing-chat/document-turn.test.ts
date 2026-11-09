import { describe, expect, it } from "vitest";
import { ErrorEvent } from "@/lib/contracts/ai";
import { DocumentTurnEventSchema, type DocumentTurnEvent } from "@/lib/contracts/writing-chat";
import type { AiWriterSupabaseClient } from "@/server/db/types";
import { ProviderError } from "@/server/ai/errors";
import { createRecordingKeyStatusReporter, createStaticKeySource, createStaticProviderContext, type ProviderContext } from "@/server/jobs/provider-context";
import type { LlmFactoryInput } from "@/server/jobs/types";
import { MemoryJobStore, MemoryUsageStore, createScriptedAdapter, fakeClock, scriptedLlmFactory, type ScriptedResponse } from "@/test/job-fakes";
import { MemoryChatDb, fakeDeliverablePipelines, fakeDocumentPipelines, fakeWritingChatPipelines } from "@/test/writing-chat-fakes";
import { chatTargetOf, checkTurnOptions, prepareTurn, runTurn, turnJobType, type TurnRequest } from "./turn";
import type { ChatSnapshot, TurnDeps } from "./types";

/**
 * A6 (R15): the 서류 분기 of `POST /api/writing-chats/{id}/turns`.
 *
 * What this pins down:
 *   - the chat's target decides the job row: `job_type = 'cover_letter'`,
 *     `target_type = 'writing_chat'` and a non-null `application_project_id` (R15 D3),
 *   - the question turn is reply ∥ extract like the other two targets,
 *   - a 초안 turn writes **several questions in one call** and sends one `draft_done` per question
 *     carrying `slot` / `questionNo` (leader decision R15-L2 — no new event names),
 *   - the draft limit is per chat (6, DM 2.9.4) and is refused before the user message is saved,
 *   - the option vocabularies are checked against the target.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const CHAT = "00000000-0000-4000-8000-0000000000c1";
const PROJECT = "00000000-0000-4000-8000-0000000000a1";
const PAID: ProviderContext = { provider: "openai", connectionTier: "paid", keyStatus: "valid" };
const FREE: ProviderContext = { provider: "gemini", connectionTier: "free", keyStatus: "valid" };
const KEY = "sk-test-document-key-0001";
const FIRST_USER_MSG = "00000000-0000-4000-8000-000000000001";

const emptyDraft = (draftCount = 0) => ({
  schema_version: 1,
  target: "cover_letter",
  facts: [],
  document: { questions: [] },
  clarifications: [],
  sensitive_flags_count: 0,
  draft_count: draftCount,
});

const fact = (id: string, review: "ok" | "needs_review") => ({
  id,
  slot: "q_1",
  text: "결제 승인 API의 병목 쿼리를 재설계했다",
  actor: "self",
  source_message_ids: [FIRST_USER_MSG],
  source_quotes: ["병목"],
  review,
});

const withFacts = (draftCount = 0) => ({
  ...emptyDraft(draftCount),
  facts: [fact("f1", "ok"), fact("f2", "needs_review")],
  clarifications: [{ kind: "number_vague", slot: "q_1", note: null }],
});

const paragraph = (blockId: string, slot: string) => ({
  block_id: blockId,
  type: "paragraph",
  text: `${slot} 문항의 답변 문단입니다.`,
  basis: "new",
  source_fact_ids: ["f1"],
  review: "ok",
});

/** A draft with one stored proposal per slot, so the runner can read each slot's `rev`. */
const withDraft = (slots: readonly string[], draftCount: number, rev = 1) => ({
  ...withFacts(draftCount),
  document: {
    questions: slots.map((slot, i) => ({
      slot,
      question_id: `00000000-0000-4000-8000-00000000q${i}`.replace("q", "0"),
      draft: {
        value: `${slot} 문항의 답변 문단입니다.`,
        blocks: [paragraph(`${slot}.1`, slot)],
        rev,
        answer_title: null,
        char_count: 20,
        generated_at: "2026-11-09T00:00:00.000Z",
      },
    })),
  },
});

function setup(opts: { context?: ProviderContext; reply?: ScriptedResponse[]; extract?: ScriptedResponse[]; draft?: unknown; questionSlots?: readonly string[] } = {}) {
  const clock = fakeClock();
  const store = new MemoryJobStore(clock.now);
  const usage = new MemoryUsageStore(USER);
  const context = opts.context ?? PAID;
  const replyAdapter = createScriptedAdapter(context.provider, opts.reply ?? [], clock.ms);
  const extractAdapter = createScriptedAdapter(context.provider, opts.extract ?? [], clock.ms);
  const replyLlm = scriptedLlmFactory(replyAdapter.adapter, clock.ms);
  const extractLlm = scriptedLlmFactory(extractAdapter.adapter, clock.ms);
  const chats = new MemoryChatDb(
    { id: CHAT, userId: USER, projectId: null, applicationProjectId: PROJECT, documentKind: "cover_letter", documentDraft: (opts.draft ?? emptyDraft()) as never },
    clock.now,
  );
  const documentPipelines = fakeDocumentPipelines(undefined, opts.questionSlots ? { questionSlots: opts.questionSlots } : {});
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
    deliverablePipelines: fakeDeliverablePipelines(),
    documentPipelines,
    now: clock.now,
    sleep: async (ms) => void sleeps.push(ms),
    timing: { heartbeatMs: 1_000_000 },
  };
  return { store, usage, chats, deps, documentPipelines, sleeps };
}

async function run(deps: TurnDeps, req: Partial<TurnRequest> & { content: string | null }) {
  const prepared = await prepareTurn(deps, { chatId: CHAT, requestedSlot: null, ...req });
  if (prepared.kind !== "ready") throw new Error(`blocked ${prepared.code}`);
  const events: DocumentTurnEvent[] = [];
  await runTurn(deps, prepared, (e) => events.push(e as DocumentTurnEvent), new AbortController().signal);
  return { prepared, events };
}

const types = (events: readonly DocumentTurnEvent[]) => events.map((e) => e.type);
const find = <T extends DocumentTurnEvent["type"]>(events: readonly DocumentTurnEvent[], type: T) =>
  events.filter((e): e is Extract<DocumentTurnEvent, { type: T }> => e.type === type);

describe("chat target (R15 D2)", () => {
  const snap = (over: Partial<ChatSnapshot>) => ({ projectDeliverableId: null, applicationProjectId: null, ...over }) as ChatSnapshot;

  it("application_project_id + document_kind = a 서류 대화; the job type is `cover_letter`", () => {
    expect(chatTargetOf(snap({ applicationProjectId: PROJECT }))).toBe("application_document");
    expect(turnJobType("application_document")).toBe("cover_letter");
    expect(turnJobType("project")).toBe("writing_chat_turn");
    expect(turnJobType("project_deliverable")).toBe("writing_chat_turn");
  });

  it("a deliverable chat still wins over anything else", () => {
    expect(chatTargetOf(snap({ projectDeliverableId: "x", applicationProjectId: PROJECT }))).toBe("project_deliverable");
  });
});

describe("checkTurnOptions — 서류 vocabularies", () => {
  const chat = { id: CHAT, userId: USER, projectDeliverableId: null, applicationProjectId: PROJECT, documentKind: "cover_letter" } as ChatSnapshot;

  it("accepts a `q_{n}` slot and refuses the STAR / deliverable slots", () => {
    expect(checkTurnOptions(chat, { chatId: CHAT, content: "x", requestedSlot: { slot: "q_3" } }).requestedSlot).toEqual({ slot: "q_3" });
    expect(() => checkTurnOptions(chat, { chatId: CHAT, content: "x", requestedSlot: { slot: "situation" } })).toThrow();
    expect(() => checkTurnOptions(chat, { chatId: CHAT, content: "x", requestedSlot: { slot: "q_1234" } as never })).toThrow();
  });

  it("accepts the 서류 style chips and refuses the deliverable one", () => {
    expect(checkTurnOptions(chat, { chatId: CHAT, content: "x", requestedSlot: null, style: "fit_length" }).style).toBe("fit_length");
    expect(checkTurnOptions(chat, { chatId: CHAT, content: "x", requestedSlot: null, style: "shorter" }).style).toBe("shorter");
    expect(() => checkTurnOptions(chat, { chatId: CHAT, content: "x", requestedSlot: null, style: "more_detail_on_contribution" })).toThrow();
  });

  it("validates the S-46 form snapshot shape and refuses a malformed one (invalid_form_snapshot)", () => {
    const ok = checkTurnOptions(chat, {
      chatId: CHAT,
      content: "x",
      requestedSlot: null,
      formSnapshot: { questions: [{ slot: "q_1", question_text: "지원 동기", char_limit: 800, body: "쓰던 내용" }] },
    });
    expect(ok.formSnapshot).toMatchObject({ questions: [{ slot: "q_1" }] });
    expect(() => checkTurnOptions(chat, { chatId: CHAT, content: "x", requestedSlot: null, formSnapshot: { title: "산출물 모양" } })).toThrow(
      expect.objectContaining({ code: "invalid_form_snapshot" }),
    );
  });
});

describe("question turn", () => {
  it("streams the reply, stores the extract patch, and emits draft_patch / draft_flags", async () => {
    const t = setup({
      reply: [{ json: "이 문항은 이렇게 써 보면 어때요?" }],
      extract: [{ json: { patch: withFacts(0) } }],
    });
    const { events } = await run(t.deps, { content: "결제 API 병목을 고쳤어요" });

    expect(types(events)).toEqual(["turn_started", "reply_delta", "reply_done", "draft_patch", "draft_flags", "turn_done"]);
    for (const e of events) expect(DocumentTurnEventSchema.safeParse(e).success).toBe(true);
    expect(find(events, "draft_patch")[0]!.added).toEqual(["f1", "f2"]);
    expect(find(events, "draft_flags")[0]).toMatchObject({ needsReview: ["f2"], sensitiveFlagsCount: 0 });
    expect(find(events, "turn_done")[0]).toMatchObject({ draftStatus: "updated", draftCount: 0, readyToReturn: false, needsReviewCount: 1 });
  });

  it("the job row is a `cover_letter` turn on the chat, with its 지원 프로젝트 (R15 D3)", async () => {
    const t = setup({ reply: [{ json: "ㅇ" }], extract: [{ json: { patch: null } }] });
    const { prepared } = await run(t.deps, { content: "안녕" });
    const job = t.store.jobs.get(prepared.job.id)!;
    expect(job).toMatchObject({
      jobType: "cover_letter",
      targetType: "writing_chat",
      targetId: CHAT,
      applicationProjectId: PROJECT,
      status: "succeeded",
    });
    expect(job.params).toMatchObject({ target: "application_document" });
  });

  it("one usage row per provider call and the key never reaches a stored row", async () => {
    const t = setup({ reply: [{ json: "ㅇ" }], extract: [{ json: { patch: withFacts(0) } }] });
    const { prepared } = await run(t.deps, { content: "안녕" });
    expect(t.usage.forJob(prepared.job.id)).toHaveLength(2);
    expect(JSON.stringify([[...t.store.jobs.values()], t.usage.records])).not.toContain(KEY);
  });

  it("free tier: the reply runs first, then the extract after the call spacing (C-12)", async () => {
    const t = setup({ context: FREE, reply: [{ json: "ㅇ" }], extract: [{ json: { patch: null } }] });
    await run(t.deps, { content: "안녕" });
    expect(t.sleeps.length).toBeGreaterThan(0);
    expect(t.documentPipelines.seen.reply).toBe(1);
    expect(t.documentPipelines.seen.extract).toBe(1);
  });

  it("nothing pending (resend) → no extract call and draftStatus unchanged", async () => {
    const t = setup({ reply: [{ json: "ㅇ" }] });
    await run(t.deps, { content: "안녕" });
    // The first turn marked the message extracted; resend answers the same user message.
    const t2 = setup({ reply: [{ json: "ㅇ" }] });
    t2.chats.chat.lastExtractedSequence = 99;
    const { events } = await run(t2.deps, { content: "또 안녕" });
    expect(t2.documentPipelines.seen.extract).toBe(0);
    expect(find(events, "turn_done")[0]!.draftStatus).toBe("unchanged");
  });
});

describe("초안 turn", () => {
  const composeResponse = (slots: readonly string[], draftCount: number) => ({
    json: {
      questions: slots.map((slot, i) => ({ slot, questionNo: i + 1, answerTitle: i === 0 ? "병목을 찾아낸 경험" : null, blocks: [paragraph(`${slot}.1`, slot)] })),
      patch: withDraft(slots, draftCount),
    },
  });

  it("one call writes up to three questions and sends one draft_done per question with slot / questionNo", async () => {
    const slots = ["q_1", "q_2", "q_3"];
    const t = setup({
      draft: withFacts(0),
      questionSlots: slots,
      extract: [{ json: { patch: withFacts(0), intent: "compose_draft" } }],
      reply: [composeResponse(slots, 1)],
    });
    const { events } = await run(t.deps, { content: "초안 만들어 줘", requestedAction: "compose_draft" });

    expect(types(events)).toEqual([
      "turn_started",
      "draft_patch",
      "draft_flags",
      "draft_started",
      "draft_block",
      "draft_block",
      "draft_block",
      "draft_done",
      "draft_done",
      "draft_done",
      "reply_done",
      "turn_done",
    ]);
    for (const e of events) expect(DocumentTurnEventSchema.safeParse(e).success).toBe(true);
    // R15-L2: the event names are the existing ones; `slot` / `questionNo` say which question.
    expect(find(events, "draft_started")[0]).toMatchObject({ attempt: 1, reason: "initial", slots });
    expect(find(events, "draft_block").map((e) => [e.slot, e.questionNo])).toEqual([
      ["q_1", 1],
      ["q_2", 2],
      ["q_3", 3],
    ]);
    const done = find(events, "draft_done");
    expect(done.map((e) => e.slot)).toEqual(slots);
    // `rev` and `draftCount` come from the RPC's answer, not from the pipeline.
    expect(done.every((e) => e.rev === 1 && e.draftCount === 1)).toBe(true);
    expect(done[0]!.answerTitle).toBe("병목을 찾아낸 경험");
    expect(done[1]!.answerTitle).toBeNull();
    // One compose call for the whole batch (C-15), plus the extract.
    expect(t.documentPipelines.seen.compose).toBe(1);
    expect(t.documentPipelines.seen.slots).toEqual([slots]);
  });

  /**
   * QA-R15-02: the pipeline's `sources_selected` carries the stored row's snake_case keys; the
   * runner renames them for the camelCase SSE contract. An `as` cast used to hide this, which
   * would have put `sort_order` / `experience_id` on the wire for a `sortOrder` / `experienceId`
   * contract — the screen's 근거 칩 would have parsed to nothing.
   */
  it("sources_selected is renamed to the camelCase contract", async () => {
    const source = {
      sort_order: 0,
      role: "primary" as const,
      experience_id: "00000000-0000-4000-8000-0000000000e1",
      education_id: null,
      project_id: "00000000-0000-4000-8000-0000000000f1",
      label: "알파 › 결제 개선",
      rationale: "직무 역량을 보여 줍니다.",
      reuse_reason: null,
      requirement_ids: ["00000000-0000-4000-8000-0000000000b1"],
    };
    const t = setup({
      draft: withFacts(0),
      questionSlots: ["q_1"],
      extract: [{ json: { patch: withFacts(0), intent: "compose_draft" } }],
      reply: [
        {
          json: {
            questions: [{ slot: "q_1", questionNo: 1, questionClass: "job_competency", sources: [source], blocks: [paragraph("q_1.1", "q_1")] }],
            patch: withDraft(["q_1"], 1),
          },
        },
      ],
    });
    const { events } = await run(t.deps, { content: "초안 만들어 줘", requestedAction: "compose_draft" });
    const selected = find(events, "sources_selected");
    expect(selected).toHaveLength(1);
    expect(DocumentTurnEventSchema.safeParse(selected[0]).success).toBe(true);
    expect(selected[0]!.sources[0]).toEqual({
      sortOrder: 0,
      role: "primary",
      experienceId: source.experience_id,
      educationId: null,
      projectId: source.project_id,
      label: source.label,
      rationale: source.rationale,
      reuseReason: null,
      requirementIds: source.requirement_ids,
    });
    // No snake_case key survives the rename.
    expect(JSON.stringify(selected[0])).not.toContain("sort_order");
    expect(JSON.stringify(selected[0])).not.toContain("experience_id");
  });

  it("no reply call on a 초안 turn: the fixed message is the assistant message (AI-04)", async () => {
    const t = setup({
      draft: withFacts(0),
      questionSlots: ["q_1"],
      extract: [{ json: { patch: withFacts(0), intent: "compose_draft" } }],
      reply: [composeResponse(["q_1"], 1)],
    });
    const { events } = await run(t.deps, { content: "초안 만들어 줘", requestedAction: "compose_draft" });
    expect(t.documentPipelines.seen.reply).toBe(0);
    expect(find(events, "reply_done")[0]!.message.content).toContain("초안을 만들었어요");
    expect(types(events)).not.toContain("reply_delta");
  });

  it("no question to write → the turn answers with a reply instead of a draft", async () => {
    const t = setup({
      draft: emptyDraft(0),
      questionSlots: [],
      extract: [{ json: { patch: null, intent: "compose_draft" } }],
      reply: [{ json: "문항을 먼저 적어 주세요." }],
    });
    const { events } = await run(t.deps, { content: "초안 만들어 줘", requestedAction: "compose_draft" });
    expect(t.documentPipelines.seen.compose).toBe(0);
    expect(t.documentPipelines.seen.notices).toEqual([["compose_insufficient"]]);
    expect(types(events)).toContain("reply_delta");
    expect(types(events)).not.toContain("draft_done");
  });

  /** DM 2.9.4: the 6-draft limit is per chat, not per slot, and is refused before anything is saved. */
  it("the draft chip at draft_count 6 → 409 before the user message is saved", async () => {
    const t = setup({ draft: withFacts(6) });
    await expect(prepareTurn(t.deps, { chatId: CHAT, content: "초안 만들어 줘", requestedSlot: null, requestedAction: "compose_draft" })).rejects.toMatchObject({
      code: "writing_chat_draft_limit_reached",
      status: 409,
    });
    expect([...t.store.jobs.values()]).toHaveLength(0);
    expect(t.chats.chat.messages.filter((m) => m.role === "user")).toHaveLength(0);
  });

  it("a compose failure keeps the previous proposals and ends the turn with an error", async () => {
    const t = setup({
      draft: withDraft(["q_1"], 1),
      questionSlots: ["q_1"],
      extract: [{ json: { patch: withFacts(1), intent: "compose_draft" } }],
      reply: [{ error: "safety_blocked" }],
    });
    const { events } = await run(t.deps, { content: "초안 만들어 줘", requestedAction: "compose_draft" });
    expect(types(events)).toContain("error");
    expect(types(events)).not.toContain("draft_done");
    /**
     * QA-R15-02: the failure event must satisfy `ErrorEvent` and the 서류 union on its own. The
     * SSE writer normalizes an `error` event on the way out, so a partial object emitted here
     * would be checked by nothing — and any in-process reader would drop it.
     */
    const err = events.at(-1)!;
    expect(ErrorEvent.safeParse(err).success).toBe(true);
    expect(DocumentTurnEventSchema.safeParse(err).success).toBe(true);
    expect(err).toMatchObject({ type: "error", code: "safety_blocked", category: "input", failureCause: "input_rejected", retryable: false, retryAfter: null });
    expect((err as { message: string }).message).toMatch(/[가-힣]/);
    // No proposal was added: the draft count stayed where the extract left it.
    expect(t.chats.chat.documentDraft!.draft_count).toBe(1);
  });
});
