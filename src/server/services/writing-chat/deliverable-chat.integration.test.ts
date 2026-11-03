import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateProjectInput } from "@/lib/contracts/career";
import type { DeliverableTurnEvent, DeliverableWritingChatDto } from "@/lib/contracts/writing-chat";
import { ProviderError } from "@/server/ai/errors";
import { createAiWriterClient } from "@/server/db/ai-writer";
import type { Database } from "@/server/db/database.types";
import { resetServerEnvCache } from "@/server/env";
import { createRecordingKeyStatusReporter, createStaticKeySource, createStaticProviderContext } from "@/server/jobs/provider-context";
import { createSupabaseJobStore } from "@/server/jobs/supabase-store";
import { createSupabaseUsageStore } from "@/server/jobs/supabase-usage";
import type { LlmFactoryInput } from "@/server/jobs/types";
import { createProject, getDeletionImpact, getDeliverable, saveProjectDeliverable } from "@/server/services/career";
import { createScriptedAdapter, scriptedLlmFactory, type ScriptedResponse } from "@/test/job-fakes";
import { hasTable, isStackReady, readLocalSupabase } from "@/test/local-supabase";
import { editDeliverableDraft, getWritingChat, listDeliverableWritingChats, startDeliverableWritingChat, startWritingChat } from "./chat";
import { createTurnChatDb } from "./db";
import { createDeliverablePipelines, createWritingChatPipelines } from "./pipelines";
import { prepareTurn, runTurn, type TurnRequest } from "./turn";
import type { TurnDeps } from "./types";

/**
 * R5 (DM v4.5, AI-13) end-to-end against the local stack: S-44 page save creates the deliverable →
 * start_deliverable_writing_chat → question turn (real AI-13 pipelines, scripted provider) → draft
 * turn (extract → compose → V-10 → replace_draft) → "저장하기" with the draft records "반영됨";
 * deletion impact counts the deliverable's chats (the draft-limit 409 is in deliverable-turn.test.ts;
 * writing_chats_guard keeps tests from forging draft_count here). No conversation or form text in logs.
 * Skips when the stack isn't running or R5 isn't migrated.
 */

const stack = readLocalSupabase();
const ready = stack ? (await isStackReady(stack)) && (await hasTable(stack, "project_deliverables")) : false;

type Client = SupabaseClient<Database>;

const FIRST = "장애 대응 런북은 제가 직접 썼어요. 저희 팀 배포 후에 하루 장애 알림이 40건에서 10건으로 줄었어요.";
const SNAPSHOT_BODY = "아직 저장하지 않은 비밀 본문 문장";

const extractOut = {
  schema_version: 1,
  writing_kind: "retrospective",
  intent: null,
  style: null,
  facts: [
    { slot: "contribution", text: "장애 대응 런북을 직접 썼다", actor: "self", source_message_ids: ["M2"], source_quotes: ["장애 대응 런북은 제가 직접 썼어요"] },
    {
      slot: "went_well",
      text: "팀 배포 후에 하루 장애 알림이 40건에서 10건으로 줄었다",
      actor: "team",
      source_message_ids: ["M2"],
      source_quotes: ["저희 팀 배포 후에 하루 장애 알림이 40건에서 10건으로 줄었어요"],
    },
  ],
  clarifications: [],
  sensitive_flags: [],
};

const emptyExtract = { schema_version: 1, writing_kind: null, intent: "compose_draft", style: null, facts: [], clarifications: [], sensitive_flags: [] };

const src = (facts: string[]) => ({ source_fact_ids: facts, source_body_quotes: [], source_project_fields: [] });
const composeOut = {
  schema_version: 1,
  writing_kind: "retrospective",
  replace_mode: true,
  blocks: [
    { type: "heading", level: 2, text: "내가 맡은 일", items: null, rows: null, basis: null, ...src([]) },
    { type: "paragraph", level: null, text: "장애 대응 런북을 직접 썼다.", items: null, rows: null, basis: "new", ...src(["F1"]) },
    { type: "heading", level: 2, text: "잘된 점", items: null, rows: null, basis: null, ...src([]) },
    { type: "paragraph", level: null, text: "팀 배포 후에 하루 장애 알림이 40건에서 10건으로 줄었다.", items: null, rows: null, basis: "new", ...src(["F2"]) },
  ],
  missing_slots: ["went_wrong", "learnings"],
};

describe.skipIf(!ready)("AI-13 deliverable chat + page save (local stack)", () => {
  const s = stack!;
  let admin: Client;
  let user: Client;
  let userId = "";
  let projectId = "";
  let deliverableId = "";
  let chatId = "";
  let deliverableUpdatedAt = "";
  const logs: string[] = [];
  const replies: ScriptedResponse[] = [];
  const extracts: ScriptedResponse[] = [];

  function deps(): TurnDeps {
    const writer = createAiWriterClient(userId);
    const replyAdapter = createScriptedAdapter("openai", replies, Date.now);
    const extractAdapter = createScriptedAdapter("openai", extracts, Date.now);
    replies.length = 0;
    extracts.length = 0;
    const log = (event: string, fields: Record<string, unknown>) => void logs.push(JSON.stringify({ event, ...fields }));
    return {
      userId,
      chats: createTurnChatDb(user, writer, log),
      store: createSupabaseJobStore(writer),
      usage: createSupabaseUsageStore(writer),
      writer,
      providerContext: createStaticProviderContext({ provider: "openai", connectionTier: "paid", keyStatus: "valid" }),
      keySource: createStaticKeySource("sk-FAKE-deliverable-key-0000", () => new ProviderError("key_missing")),
      keyStatus: createRecordingKeyStatusReporter(),
      runGate: null,
      createLlm: (input: LlmFactoryInput) =>
        input.tier === "light" ? scriptedLlmFactory(extractAdapter.adapter, Date.now)(input) : scriptedLlmFactory(replyAdapter.adapter, Date.now)(input),
      pipelines: createWritingChatPipelines({ logger: (entry) => void logs.push(JSON.stringify(entry)), log }),
      deliverablePipelines: createDeliverablePipelines({ logger: (entry) => void logs.push(JSON.stringify(entry)), log }),
      log,
    };
  }

  async function turn(req: Omit<TurnRequest, "chatId" | "requestedSlot"> & { requestedSlot?: TurnRequest["requestedSlot"] }, reply: ScriptedResponse[], extract: ScriptedResponse[]) {
    replies.push(...reply);
    extracts.push(...extract);
    const d = deps();
    const prepared = await prepareTurn(d, { chatId, requestedSlot: null, ...req });
    if (prepared.kind !== "ready") throw new Error(`blocked: ${prepared.code}`);
    const events: DeliverableTurnEvent[] = [];
    await runTurn(d, prepared, (e) => events.push(e as DeliverableTurnEvent), new AbortController().signal);
    return { events, jobId: prepared.job.id };
  }

  const openChat = async (): Promise<DeliverableWritingChatDto> => {
    const dto = await getWritingChat(user, userId, chatId);
    if (dto.target !== "project_deliverable") throw new Error("expected a deliverable chat");
    return dto;
  };

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", s.url);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", s.anonKey);
    vi.stubEnv("SUPABASE_JWT_SECRET", s.jwtSecret);
    vi.stubEnv("CRON_SECRET", "test-cron-secret-0000");
    resetServerEnvCache();
    for (const m of ["info", "warn", "error", "log"] as const) {
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(" ")));
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeAll(async () => {
    admin = createClient<Database>(s.url, s.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const email = `dchat-${crypto.randomUUID()}@example.test`;
    const password = `pw-${crypto.randomUUID()}`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.code}`);
    userId = data.user.id;
    user = createClient<Database>(s.url, s.anonKey, { auth: { persistSession: false } });
    const signIn = await user.auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error(`signIn failed: ${signIn.error.code}`);
    projectId = (await createProject(user, CreateProjectInput.parse({ name: "간편결제 서비스", affiliation: { type: "none" } }))).id;
  });

  afterAll(async () => {
    if (userId) {
      await admin.from("ai_jobs").delete().eq("user_id", userId);
      await admin.auth.admin.deleteUser(userId);
    }
    resetServerEnvCache();
  });

  it("S-44 저장하기 creates the deliverable (page save), then the chat starts on it with the guessed kind", async () => {
    await expect(saveProjectDeliverable(user, { projectDeliverableId: null, projectId, title: " ", body: null })).rejects.toMatchObject({ code: "deliverable_title_required" });
    await expect(saveProjectDeliverable(user, { projectDeliverableId: null, projectId, title: "x", body: "가".repeat(20001) })).rejects.toMatchObject({
      code: "field_too_long",
      details: { field: "body" },
    });
    const created = await saveProjectDeliverable(user, { projectDeliverableId: null, projectId, title: "결제 장애 회고", body: null });
    expect(created).toMatchObject({ projectId, applied: [], skipped: [] });
    deliverableId = created.projectDeliverableId;
    deliverableUpdatedAt = created.updatedAt;

    await expect(startDeliverableWritingChat(user, { projectDeliverableId: crypto.randomUUID() })).rejects.toMatchObject({ code: "not_found", status: 404 });
    // A STAR chat can't start on a standalone project (deliverable chats live under its deliverables).
    await expect(startWritingChat(user, { projectId })).rejects.toMatchObject({ code: "writing_chat_requires_affiliated_project" });
    ({ writingChatId: chatId } = await startDeliverableWritingChat(user, { projectDeliverableId: deliverableId, formSnapshot: { title: "결제 장애 회고", body: "" } }));
    const chat = await openChat();
    expect(chat).toMatchObject({ projectId, projectDeliverableId: deliverableId, status: "active", draftCount: 0, draftLimit: 6, messageCount: 0 });
    expect(chat.structuredDraft.writing_kind).toBe("retrospective");
    expect(chat.messages).toHaveLength(1);
    expect((await listDeliverableWritingChats(user, deliverableId)).map((c) => c.id)).toEqual([chatId]);
    expect((await getDeliverable(user, deliverableId))!.writingChats.map((c) => c.id)).toEqual([chatId]);
  });

  it("question turn: reply ∥ extract → facts stored with UUID sources; the form snapshot is never stored", async () => {
    const { events, jobId } = await turn({ content: FIRST, formSnapshot: { title: "결제 장애 회고", body: SNAPSHOT_BODY } }, [{ json: "어떤 점이 아쉬웠나요?" }], [{ json: extractOut }]);
    expect(events.map((e) => e.type)).toEqual(["turn_started", "reply_delta", "reply_done", "facts_patch", "draft_flags", "turn_done"]);
    expect(events.at(-1)).toMatchObject({ type: "turn_done", draftCount: 0, readyToReturn: false });
    const chat = await openChat();
    expect(chat.structuredDraft.facts).toHaveLength(2);
    expect(chat.structuredDraft.facts[0]!.source_message_ids).toEqual([chat.messages[1]!.id]);

    const { data: job } = await admin.from("ai_jobs").select("*").eq("id", jobId).single();
    expect(job).toMatchObject({ status: "succeeded", job_type: "writing_chat_turn", target_id: chatId });
    expect(JSON.stringify(job)).not.toContain(SNAPSHOT_BODY);
    const { data: row } = await admin.from("writing_chats").select("*").eq("id", chatId).single();
    expect(JSON.stringify(row)).not.toContain(SNAPSHOT_BODY);
    const { data: usage } = await admin.from("ai_usage_records").select("call_key, feature, model_tier").eq("ai_job_id", jobId).order("call_key");
    expect(usage).toEqual([
      { call_key: "writing_chat.turn.2.extract", feature: "writing_chat", model_tier: "light" },
      { call_key: "writing_chat.turn.2.reply", feature: "writing_chat", model_tier: "default" },
    ]);
  });

  it("draft turn: extract → compose stream → draft stored (rev 1, draft_count 1) → fixed message; save records it", async () => {
    const { events, jobId } = await turn({ content: "지금까지 내용으로 초안 만들기", requestedAction: "compose_draft", formSnapshot: { title: "결제 장애 회고", body: "" } }, [{ json: composeOut }], [{ json: emptyExtract }]);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("turn_started");
    expect(types).toContain("draft_started");
    expect(types).toContain("draft_block");
    expect(types.slice(-3)).toEqual(["draft_done", "reply_done", "turn_done"]);
    const done = events.find((e) => e.type === "draft_done") as Extract<DeliverableTurnEvent, { type: "draft_done" }>;
    expect(done).toMatchObject({ rev: 1, draftCount: 1, replaceAllowed: true });
    expect(done.body.value).toContain("장애 대응 런북을 직접 썼다.");
    expect(events.at(-1)).toMatchObject({ type: "turn_done", draftCount: 1, draftStatus: "updated" });

    const { data: job } = await admin.from("ai_jobs").select("status, progress").eq("id", jobId).single();
    expect(job).toMatchObject({ status: "succeeded", progress: { stage: "validate" } });
    const { data: usage } = await admin.from("ai_usage_records").select("call_key").eq("ai_job_id", jobId).order("call_key");
    expect((usage ?? []).map((u) => u.call_key)).toEqual(["writing_chat.turn.4.compose", "writing_chat.turn.4.extract"]);
    const chat = await openChat();
    expect(chat.messages.at(-1)).toMatchObject({ role: "assistant", status: "done", content: expect.stringContaining("초안을 만들었어요") });

    // [본문에 넣기] fills the form; 저장하기 writes the body and records it (applied_mode replace).
    const body = chat.structuredDraft.deliverable.body!;
    const saved = await saveProjectDeliverable(user, {
      projectDeliverableId: deliverableId,
      projectId: null,
      title: "결제 장애 회고",
      body: body.value,
      expectedUpdatedAt: deliverableUpdatedAt,
      appliedProposals: [{ writingChatId: chatId, rev: body.rev, mode: "replace" }],
    });
    expect(saved).toMatchObject({ projectDeliverableId: deliverableId, applied: [{ writingChatId: chatId }], skipped: [] });
    const after = await openChat();
    expect(after.structuredDraft.deliverable.body).toMatchObject({ applied_mode: "replace", applied_rev: body.rev });
    expect(after.lastAppliedAt).not.toBeNull();
    // An applied draft's blocks can't be edited; a stale version is refused with the current one.
    await expect(editDeliverableDraft(user, { writingChatId: chatId, op: "remove_block", blockId: body.blocks[0]!.block_id })).rejects.toMatchObject({ code: "field_already_applied" });
    await expect(
      saveProjectDeliverable(user, { projectDeliverableId: deliverableId, projectId: null, title: "새 제목", body: body.value, expectedUpdatedAt: deliverableUpdatedAt }),
    ).rejects.toMatchObject({ code: "stale_write", details: { current_updated_at: expect.any(String) } });
  });

  it("deletion impact counts the deliverable's chats (cascade.writing_chats)", async () => {
    await expect(getDeletionImpact(user, { entityType: "project_deliverable", entityId: deliverableId })).resolves.toMatchObject({ cascade: { writing_chats: 1 } });
    await expect(getDeletionImpact(user, { entityType: "project", entityId: projectId })).resolves.toMatchObject({ cascade: { project_deliverables: 1, writing_chats: 1 } });
  });

  it("no conversation, form, or key text in logs (NFR-PRV-09)", () => {
    const all = logs.join("\n");
    expect(all).not.toContain("런북");
    expect(all).not.toContain(SNAPSHOT_BODY);
    expect(all).not.toContain("FAKE-deliverable-key");
  });
});
