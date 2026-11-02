import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateProjectInput, SaveExperienceInput, SaveProjectInput } from "@/lib/contracts/career";
import { ProviderError } from "@/server/ai/errors";
import { output } from "@/server/ai/__fixtures__/AI-12/conversations";
import { createAiWriterClient } from "@/server/db/ai-writer";
import type { Database } from "@/server/db/database.types";
import { resetServerEnvCache } from "@/server/env";
import { createRecordingKeyStatusReporter, createStaticKeySource, createStaticProviderContext } from "@/server/jobs/provider-context";
import { createSupabaseJobStore } from "@/server/jobs/supabase-store";
import { createSupabaseUsageStore } from "@/server/jobs/supabase-usage";
import type { LlmFactoryInput } from "@/server/jobs/types";
import { createProject, getDeletionImpact, getProjectDetail, saveExperience, saveProject } from "@/server/services/career";
import { createScriptedAdapter, scriptedLlmFactory, type ScriptedResponse } from "@/test/job-fakes";
import { hasTable, isStackReady, readLocalSupabase } from "@/test/local-supabase";
import type { WritingChatTurnEvent } from "@/lib/contracts/writing-chat";
import {
  applyDraftEdit,
  applyWritingChatProposal,
  deleteWritingChat,
  getWritingChat,
  listProjectWritingChats,
  reviewDraftField,
  startWritingChat,
} from "./chat";
import { createTurnChatDb } from "./db";
import { createWritingChatPipelines } from "./pipelines";
import { prepareTurn, runTurn } from "./turn";
import type { TurnDeps } from "./types";

/**
 * R4 (DM v4.4) end-to-end against the local stack: a chat on an affiliated project →
 * full turn (real AI-12 v4.5 pipelines, scripted provider) → failed reply + "다시 보내기"
 * → proposal edits / review → [반영] (apply_writing_chat_proposal) → STAR on the project;
 * many chats per project; delete the chat only keeps the applied STAR. Checks NFR-AI-05
 * (the turn writes no career column), one usage row per provider call, message counts,
 * and that no message text reaches the logs (NFR-PRV-09).
 * Skips when the stack isn't running or R4 isn't migrated.
 */

const stack = readLocalSupabase();
const ready = stack ? (await isStackReady(stack)) && (await hasTable(stack, "project_deliverables")) : false;

type Client = SupabaseClient<Database>;

const USER_TEXT = "에이비씨페이 다닐 때 결제 승인 API 성능 개선 프로젝트를 했어요. 23년 3월부터 했고 저는 백엔드 개발을 맡았어요.";
const SECOND_TEXT = "결제 승인 API가 피크 시간에 느려져서 결제 실패 문의가 많았어요.";

const firstExtract = output({
  project_patches: [{ field: "start_month", op: "set", value: "2023-03", source_message_ids: ["M2"], source_quotes: ["23년 3월부터 했고"] }],
  star_patches: [
    { field: "task", op: "set", value: "백엔드 개발을 맡았다", source_message_ids: ["M2"], source_quotes: ["저는 백엔드 개발을 맡았어요"] },
  ],
});

const secondExtract = output({
  star_patches: [
    {
      field: "situation",
      op: "set",
      value: "결제 승인 API가 피크 시간에 느려져 결제 실패 문의가 많았다",
      source_message_ids: ["M4"],
      source_quotes: ["결제 승인 API가 피크 시간에 느려져서 결제 실패 문의가 많았어요"],
    },
  ],
});

describe.skipIf(!ready)("AI writing chat v4.4 (local stack)", () => {
  const s = stack!;
  let admin: Client;
  let user: Client;
  let userId = "";
  let experienceId = "";
  let projectId = "";
  const logs: string[] = [];
  const replies: ScriptedResponse[] = [];
  const extracts: ScriptedResponse[] = [];

  function deps(): TurnDeps {
    const writer = createAiWriterClient(userId);
    const replyAdapter = createScriptedAdapter("anthropic", replies, Date.now);
    const extractAdapter = createScriptedAdapter("anthropic", extracts, Date.now);
    replies.length = 0;
    extracts.length = 0;
    const log = (event: string, fields: Record<string, unknown>) => void logs.push(JSON.stringify({ event, ...fields }));
    return {
      userId,
      chats: createTurnChatDb(user, writer, log),
      store: createSupabaseJobStore(writer),
      usage: createSupabaseUsageStore(writer),
      writer,
      providerContext: createStaticProviderContext({ provider: "anthropic", connectionTier: "paid", keyStatus: "valid" }),
      keySource: createStaticKeySource("sk-ant-FAKE-integration-key-0000", () => new ProviderError("key_missing")),
      keyStatus: createRecordingKeyStatusReporter(),
      runGate: null,
      createLlm: (input: LlmFactoryInput) =>
        input.tier === "light" ? scriptedLlmFactory(extractAdapter.adapter, Date.now)(input) : scriptedLlmFactory(replyAdapter.adapter, Date.now)(input),
      pipelines: createWritingChatPipelines({ logger: (entry) => void logs.push(JSON.stringify(entry)), log }),
      log,
    };
  }

  async function turn(chatId: string, content: string | null, reply: ScriptedResponse[], extract: ScriptedResponse[]) {
    replies.push(...reply);
    extracts.push(...extract);
    const d = deps();
    const prepared = await prepareTurn(d, { chatId, content, requestedSlot: null });
    if (prepared.kind !== "ready") throw new Error(`blocked: ${prepared.code}`);
    const events: WritingChatTurnEvent[] = [];
    await runTurn(d, prepared, (e) => events.push(e), new AbortController().signal);
    return { events, jobId: prepared.job.id };
  }

  async function projectStar() {
    const { data } = await admin.from("projects").select("situation, task, action, result, learnings, start_month, status, source_writing_chat_id").eq("id", projectId).single();
    return data!;
  }

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
    const email = `wchat-${crypto.randomUUID()}@example.test`;
    const password = `pw-${crypto.randomUUID()}`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.code}`);
    userId = data.user.id;
    user = createClient<Database>(s.url, s.anonKey, { auth: { persistSession: false } });
    const signIn = await user.auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error(`signIn failed: ${signIn.error.code}`);
    experienceId = crypto.randomUUID();
    await saveExperience(user, SaveExperienceInput.parse({ id: experienceId, companyName: "에이비씨페이", startMonth: "2021-03", isCurrent: true, jobPosition: "백엔드 개발자" }));
    projectId = (await createProject(user, CreateProjectInput.parse({ name: "결제 승인 API 성능 개선", affiliation: { type: "experience", id: experienceId } }))).id;
  });

  afterAll(async () => {
    if (userId) {
      await admin.from("ai_jobs").delete().eq("user_id", userId);
      await admin.auth.admin.deleteUser(userId);
    }
    resetServerEnvCache();
  });

  let chatId = "";

  it("start: affiliated projects only; greeting not counted (R1 A5), no AI call; chips from AI-12", async () => {
    const standalone = await createProject(user, CreateProjectInput.parse({ name: "사이드", affiliation: { type: "none" } }));
    await expect(startWritingChat(user, { projectId: standalone.id })).rejects.toMatchObject({ code: "writing_chat_requires_affiliated_project" });
    await expect(startWritingChat(user, { projectId: crypto.randomUUID() })).rejects.toMatchObject({ code: "not_found" });

    ({ writingChatId: chatId } = await startWritingChat(user, { projectId }));
    const chat = await getWritingChat(user, userId, chatId);
    expect(chat).toMatchObject({ projectId, title: null, status: "active", messageCount: 0, remainingMessages: 40, limitReached: false, lastAppliedAt: null });
    expect(chat.messages).toHaveLength(1);
    expect(chat.messages[0]).toMatchObject({ role: "assistant", status: "done", provider: null, aiJobId: null });
    expect(chat.chips).toHaveLength(3);
    // No key in this test user: reading works, sending is locked (PRD 3.3).
    expect(chat.connection.lock).toBe("ai_not_connected");
    expect(chat.canSend).toBe(false);
    // S-10 page lists the chat under the project.
    expect((await getProjectDetail(user, projectId))!.writingChats.map((c) => c.id)).toEqual([chatId]);
  });

  it("full turn (paid, parallel): reply streamed + stored, AI patch applied, title from the first message, no career write, usage per call", async () => {
    const before = await projectStar();
    const { events, jobId } = await turn(chatId, USER_TEXT, [{ json: "그때 어떤 상황이었나요?" }], [{ json: firstExtract }]);
    expect(events.map((e) => e.type)).toEqual(["turn_started", "reply_delta", "reply_done", "draft_patch", "draft_flags", "turn_done"]);
    const done = events.at(-1) as Extract<WritingChatTurnEvent, { type: "turn_done" }>;
    expect(done).toMatchObject({ draftStatus: "updated", closed: false, readyToReturn: false });
    expect(done.chips).toHaveLength(3);

    const chat = await getWritingChat(user, userId, chatId);
    expect(chat.messageCount).toBe(2);
    expect(chat.title).toBe(USER_TEXT.slice(0, 30).trim());
    expect(chat.messages.map((m) => [m.sequence, m.role, m.status])).toEqual([
      [1, "assistant", "done"],
      [2, "user", "done"],
      [3, "assistant", "done"],
    ]);
    expect(chat.messages[2]).toMatchObject({ provider: "anthropic", modelTier: "default", connectionTier: "paid", aiJobId: jobId });
    expect(chat.structuredDraft.project.start_month?.value).toBe("2023-03");
    expect(chat.structuredDraft.star.task?.source_message_ids).toEqual([chat.messages[1]!.id]);

    // NFR-AI-05: the turn wrote no career column.
    expect(await projectStar()).toEqual(before);

    const { data: job } = await admin.from("ai_jobs").select("*").eq("id", jobId).single();
    expect(job).toMatchObject({ status: "succeeded", job_type: "writing_chat_turn", target_type: "writing_chat", target_id: chatId, provider: "anthropic" });
    const { data: usage } = await admin.from("ai_usage_records").select("*").eq("ai_job_id", jobId).order("call_key");
    expect((usage ?? []).map((u) => [u.call_key, u.feature, u.model_tier, u.outcome])).toEqual([
      ["writing_chat.turn.2.extract", "writing_chat", "light", "succeeded"],
      ["writing_chat.turn.2.reply", "writing_chat", "default", "succeeded"],
    ]);
    expect(logs.some((l) => l.includes('"ai_validation"') && l.includes(jobId))).toBe(true);
    const { data: row } = await admin.from("writing_chats").select("last_extracted_sequence").eq("id", chatId).single();
    expect(row?.last_extracted_sequence).toBe(2);
  });

  it("reply fails before the first token (rate_limited): turn failed, extract kept; resend reuses the row, count unchanged", async () => {
    const failed = await turn(chatId, SECOND_TEXT, [{ error: "rate_limited" }], [{ json: secondExtract }]);
    expect(failed.events.map((e) => e.type)).toEqual(["turn_started", "draft_patch", "draft_flags", "error"]);
    let chat = await getWritingChat(user, userId, chatId);
    expect(chat.messageCount).toBe(4);
    expect(chat.messages.at(-1)).toMatchObject({ role: "assistant", status: "failed" });
    expect(chat.structuredDraft.star.situation?.value).toBeTruthy();
    const { data: failedJob } = await admin.from("ai_jobs").select("status, error_code, retry_after").eq("id", failed.jobId).single();
    expect(failedJob).toMatchObject({ status: "failed", error_code: "rate_limited" });
    expect(failedJob?.retry_after).not.toBeNull();

    const resend = await turn(chatId, null, [{ json: "결과는 어땠나요?" }], []);
    expect(resend.events.map((e) => e.type)).toEqual(["turn_started", "reply_delta", "reply_done", "turn_done"]);
    chat = await getWritingChat(user, userId, chatId);
    expect(chat.messageCount).toBe(4);
    expect(chat.messages).toHaveLength(5);
    expect(chat.messages.at(-1)).toMatchObject({ status: "done", aiJobId: resend.jobId });
    const { data: usage } = await admin.from("ai_usage_records").select("call_key").eq("ai_job_id", resend.jobId);
    expect(usage).toHaveLength(1);
  });

  it("proposal card: edit / review, then [반영] writes the project as the user; applied fields are locked", async () => {
    await applyDraftEdit(user, { writingChatId: chatId, path: { section: "star", field: "action" }, value: "APM으로 병목 쿼리를 찾아 인덱스를 재설계했다" });
    let chat = await getWritingChat(user, userId, chatId);
    expect(chat.structuredDraft.star.action).toMatchObject({ value: "APM으로 병목 쿼리를 찾아 인덱스를 재설계했다", origin: "user_edit", review: "ok" });
    await expect(reviewDraftField(user, { writingChatId: chatId, path: { section: "star", field: "action" } }, "accept")).rejects.toMatchObject({
      code: "invalid_review_transition",
    });
    if (chat.structuredDraft.star.situation?.review === "needs_review") {
      await reviewDraftField(user, { writingChatId: chatId, path: { section: "star", field: "situation" } }, "accept");
    }
    await applyDraftEdit(user, { writingChatId: chatId, path: { section: "classification", field: "competencies" }, value: ["analysis", "execution"] });

    // [반영] one field, then [모두 반영].
    const one = await applyWritingChatProposal(user, { writingChatId: chatId, fields: ["start_month"] });
    expect(one).toMatchObject({ applied: ["start_month"], skipped: [], projectStatus: "draft" });
    const all = await applyWritingChatProposal(user, { writingChatId: chatId });
    expect(all.applied).toEqual(expect.arrayContaining(["situation", "task", "action", "competencies"]));
    expect(all.projectStatus).toBe("complete");
    expect(all.structuredDraft.star.action?.applied_at).not.toBeNull();
    const star = await projectStar();
    expect(star).toMatchObject({ status: "complete", start_month: "2023-03-01", action: "APM으로 병목 쿼리를 찾아 인덱스를 재설계했다", source_writing_chat_id: chatId });
    const { data: comp } = await admin.from("projects").select("competencies").eq("id", projectId).single();
    expect(comp?.competencies).toEqual(["analysis", "execution"]);

    // Nothing left: applied [] (not an error); an applied field can't be edited in the card.
    await expect(applyWritingChatProposal(user, { writingChatId: chatId })).resolves.toMatchObject({ applied: [] });
    await expect(applyDraftEdit(user, { writingChatId: chatId, path: { section: "star", field: "action" }, value: "x" })).rejects.toMatchObject({
      code: "field_already_applied",
    });
    chat = await getWritingChat(user, userId, chatId);
    expect(chat.lastAppliedAt).not.toBeNull();
    expect(chat.applicableFields).toEqual([]);
  });

  it("a second chat on the same project appends to filled STAR; over 2,000 chars → field_too_long, nothing written", async () => {
    const { writingChatId } = await startWritingChat(user, { projectId });
    await applyDraftEdit(user, { writingChatId, path: { section: "star", field: "result" }, value: "응답 시간이 1.2초에서 0.7초로 줄었다" });
    await applyDraftEdit(user, { writingChatId, path: { section: "star", field: "action" }, value: "캐시를 도입했다" });
    const r = await applyWritingChatProposal(user, { writingChatId, fields: ["action", "result"] });
    expect(r.applied).toEqual(["action", "result"]);
    const star = await projectStar();
    expect(star.action).toBe("APM으로 병목 쿼리를 찾아 인덱스를 재설계했다\n캐시를 도입했다");

    // Fill the project's learnings close to the limit, then try to append.
    await saveProject(user, SaveProjectInput.parse({ id: projectId, learnings: "가".repeat(1990) }));
    await applyDraftEdit(user, { writingChatId, path: { section: "star", field: "learnings" }, value: "나".repeat(50) });
    await expect(applyWritingChatProposal(user, { writingChatId })).rejects.toMatchObject({ code: "field_too_long", status: 409, details: { fields: ["learnings"] } });

    expect((await listProjectWritingChats(user, projectId)).map((c) => c.id)).toEqual(expect.arrayContaining([chatId, writingChatId]));
    const impact = await getDeletionImpact(user, { entityType: "writing_chat", entityId: writingChatId });
    expect(impact).toMatchObject({ message_count: 0 });
    expect(impact.last_applied_at).not.toBeNull();
    const deleted = await deleteWritingChat(user, writingChatId);
    expect(deleted.messageCount).toBe(0);
    // The applied STAR stays on the project.
    expect((await projectStar()).result).toBe("응답 시간이 1.2초에서 0.7초로 줄었다");
  });

  it("no conversation text in logs (NFR-PRV-09)", () => {
    const all = logs.join("\n");
    expect(all).not.toContain("결제 승인");
    expect(all).not.toContain("피크 시간");
    expect(all).not.toContain("FAKE-integration-key");
  });
});
