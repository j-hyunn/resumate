import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SaveExperienceInput } from "@/lib/contracts/career";
import { ProviderError } from "@/server/ai/errors";
import { output } from "@/server/ai/__fixtures__/AI-12/conversations";
import { createAiWriterClient } from "@/server/db/ai-writer";
import type { Database } from "@/server/db/database.types";
import { resetServerEnvCache } from "@/server/env";
import { createRecordingKeyStatusReporter, createStaticKeySource, createStaticProviderContext } from "@/server/jobs/provider-context";
import { createSupabaseJobStore } from "@/server/jobs/supabase-store";
import { createSupabaseUsageStore } from "@/server/jobs/supabase-usage";
import type { LlmFactoryInput } from "@/server/jobs/types";
import { getCareerTree, getDeletionImpact, saveExperience } from "@/server/services/career";
import { createScriptedAdapter, scriptedLlmFactory, type ScriptedResponse } from "@/test/job-fakes";
import { hasTable, isStackReady, readLocalSupabase } from "@/test/local-supabase";
import type { WritingChatTurnEvent } from "@/lib/contracts/writing-chat";
import {
  abandonWritingChat,
  applyDraftEdit,
  deleteWritingChat,
  editDraftDetail,
  getWritingChat,
  handOffWritingChat,
  reviewDraftField,
  saveWritingChat,
  setWritingChatAffiliation,
  startWritingChat,
} from "./chat";
import { createTurnChatDb } from "./db";
import { createWritingChatPipelines } from "./pipelines";
import { prepareTurn, runTurn } from "./turn";
import type { TurnDeps } from "./types";

/**
 * S4 end-to-end against the local stack: start → full turn (real AI-12
 * pipelines, scripted provider) → failed reply + "다시 보내기" → preview edits
 * → affiliation → save; a second chat → hand-off; delete chat only. Checks
 * NFR-AI-05 (no career row before save), one usage row per provider call,
 * message counts, and that no message text reaches the logs (NFR-PRV-09).
 * Skips when the stack isn't running or S4 isn't migrated.
 */

const stack = readLocalSupabase();
const ready = stack ? (await isStackReady(stack)) && (await hasTable(stack, "writing_chats")) : false;

type Client = SupabaseClient<Database>;

const USER_TEXT = "에이비씨페이 다닐 때 결제 승인 API 성능 개선 프로젝트를 했어요. 23년 3월부터 했고 저는 백엔드 개발을 맡았어요.";
const SECOND_TEXT = "결제 승인 API가 피크 시간에 느려져서 결제 실패 문의가 많았어요.";

const firstExtract = output({
  project_patches: [
    { field: "name", op: "set", value: "결제 승인 API 성능 개선", source_message_ids: ["M2"], source_quotes: ["결제 승인 API 성능 개선 프로젝트를 했어요"] },
    { field: "start_month", op: "set", value: "2023-03", source_message_ids: ["M2"], source_quotes: ["23년 3월부터 했고"] },
    { field: "role", op: "set", value: "백엔드 개발", source_message_ids: ["M2"], source_quotes: ["저는 백엔드 개발을 맡았어요"] },
  ],
  affiliation_suggestion: { type: "experience", ref: "EXP-1", source_message_ids: ["M2"], source_quotes: ["에이비씨페이 다닐 때"] },
});

const secondExtract = output({
  new_details: [{ detail_key: "D1", source_message_ids: ["M4"] }],
  detail_patches: [
    {
      detail_key: "D1",
      detail_ref: null,
      field: "situation",
      op: "set",
      value: "결제 승인 API가 피크 시간에 느려져 결제 실패 문의가 많았다",
      source_message_ids: ["M4"],
      source_quotes: ["결제 승인 API가 피크 시간에 느려져서 결제 실패 문의가 많았어요"],
    },
  ],
});

describe.skipIf(!ready)("AI writing chat (local stack)", () => {
  const s = stack!;
  let admin: Client;
  let user: Client;
  let userId = "";
  let experienceId = "";
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

  async function projectCount() {
    const { count } = await admin.from("projects").select("id", { count: "exact", head: true }).eq("user_id", userId);
    return count ?? 0;
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
  });

  afterAll(async () => {
    if (userId) {
      await admin.from("ai_jobs").delete().eq("user_id", userId);
      await admin.auth.admin.deleteUser(userId);
    }
    resetServerEnvCache();
  });

  let chatId = "";

  it("start: greeting counts as message 1, no AI call; visible in the career tree", async () => {
    ({ writingChatId: chatId } = await startWritingChat(user, { mode: "new_project" }));
    const chat = await getWritingChat(user, userId, chatId);
    expect(chat).toMatchObject({ status: "active", messageCount: 1, limitReached: false });
    expect(chat.messages).toHaveLength(1);
    expect(chat.messages[0]).toMatchObject({ role: "assistant", status: "done", provider: null, aiJobId: null });
    // No key in this test user: reading works, sending is locked (PRD 3.3).
    expect(chat.connection.lock).toBe("ai_not_connected");
    expect(chat.canSend).toBe(false);
    const tree = await getCareerTree(user);
    expect(tree.activeWritingChats.map((c) => c.id)).toContain(chatId);
    expect(tree.activeWritingChats.find((c) => c.id === chatId)?.daysUntilAutoDelete).toBe(90);
  });

  it("full turn (paid, parallel): reply streamed + stored, AI patch applied, no career write, usage per call", async () => {
    const { events, jobId } = await turn(chatId, USER_TEXT, [{ json: "그때 어떤 상황이었나요?" }], [{ json: firstExtract }]);
    expect(events.map((e) => e.type)).toEqual(["turn_started", "reply_delta", "reply_done", "draft_patch", "draft_flags", "turn_done"]);

    const chat = await getWritingChat(user, userId, chatId);
    expect(chat.messageCount).toBe(3);
    expect(chat.messages.map((m) => [m.sequence, m.role, m.status])).toEqual([
      [1, "assistant", "done"],
      [2, "user", "done"],
      [3, "assistant", "done"],
    ]);
    expect(chat.messages[2]).toMatchObject({ provider: "anthropic", modelTier: "default", connectionTier: "paid", aiJobId: jobId });
    expect(chat.structuredDraft.project.name?.value).toBe("결제 승인 API 성능 개선");
    expect(chat.structuredDraft.project.name?.source_message_ids).toEqual([chat.messages[1]!.id]);
    expect(chat.structuredDraft.affiliation_suggestion).toMatchObject({ type: "experience", id: experienceId });

    // NFR-AI-05: the turn wrote no career row.
    expect(await projectCount()).toBe(0);

    const { data: job } = await admin.from("ai_jobs").select("*").eq("id", jobId).single();
    expect(job).toMatchObject({ status: "succeeded", job_type: "writing_chat_turn", target_type: "writing_chat", target_id: chatId, provider: "anthropic" });
    const { data: usage } = await admin.from("ai_usage_records").select("*").eq("ai_job_id", jobId).order("call_key");
    // QA-S4-03: turn-numbered call keys (C-13 `writing_chat.turn.{n}.*`).
    expect((usage ?? []).map((u) => [u.call_key, u.feature, u.model_tier, u.outcome])).toEqual([
      ["writing_chat.turn.2.extract", "writing_chat", "light", "succeeded"],
      ["writing_chat.turn.2.reply", "writing_chat", "default", "succeeded"],
    ]);
    // QA-S4-02: V-9 stats are logged for this job (counts only).
    expect(logs.some((l) => l.includes('"ai_validation"') && l.includes(jobId))).toBe(true);
    const { data: row } = await admin.from("writing_chats").select("last_extracted_sequence").eq("id", chatId).single();
    expect(row?.last_extracted_sequence).toBe(2);
  });

  it("reply fails before the first token (rate_limited): turn failed, extract kept; resend reuses the row, count unchanged", async () => {
    const failed = await turn(chatId, SECOND_TEXT, [{ error: "rate_limited" }], [{ json: secondExtract }]);
    expect(failed.events.map((e) => e.type)).toEqual(["turn_started", "draft_patch", "draft_flags", "error"]);
    let chat = await getWritingChat(user, userId, chatId);
    expect(chat.messageCount).toBe(5);
    expect(chat.messages.at(-1)).toMatchObject({ role: "assistant", status: "failed" });
    expect(chat.structuredDraft.details[0]?.fields.situation?.value).toBeTruthy();
    const { data: failedJob } = await admin.from("ai_jobs").select("status, error_code, retry_after").eq("id", failed.jobId).single();
    expect(failedJob).toMatchObject({ status: "failed", error_code: "rate_limited" });
    expect(failedJob?.retry_after).not.toBeNull();

    const resend = await turn(chatId, null, [{ json: "결과는 어땠나요?" }], []);
    expect(resend.events.map((e) => e.type)).toEqual(["turn_started", "reply_delta", "reply_done", "turn_done"]);
    chat = await getWritingChat(user, userId, chatId);
    expect(chat.messageCount).toBe(5);
    expect(chat.messages).toHaveLength(5);
    expect(chat.messages.at(-1)).toMatchObject({ status: "done", aiJobId: resend.jobId });
    // Only the reply was called again (QA-S3a-08): one usage row for the resend job.
    const { data: usage } = await admin.from("ai_usage_records").select("call_key").eq("ai_job_id", resend.jobId);
    expect(usage).toHaveLength(1);
  });

  it("preview edits, affiliation, save: reviewed draft → career rows as the user", async () => {
    await applyDraftEdit(user, { writingChatId: chatId, path: { section: "project", field: "role" }, value: "백엔드 리드" });
    let chat = await getWritingChat(user, userId, chatId);
    expect(chat.structuredDraft.project.role).toMatchObject({ value: "백엔드 리드", origin: "user_edit", review: "ok" });

    // A needs_review field: accept it explicitly if V-9e flagged one, else this is a no-op check.
    const situation = chat.structuredDraft.details[0]?.fields.situation;
    if (situation?.review === "needs_review") {
      await reviewDraftField(user, { writingChatId: chatId, path: { section: "detail", detail: { detailKey: "D1" }, field: "situation" } }, "accept");
    }
    await applyDraftEdit(user, { writingChatId: chatId, path: { section: "detail", detail: { detailKey: "D1" }, field: "title" }, value: "피크 시간 결제 지연" });
    await expect(
      reviewDraftField(user, { writingChatId: chatId, path: { section: "project", field: "role" } }, "accept"),
    ).rejects.toMatchObject({ code: "invalid_review_transition" });

    const aff = await setWritingChatAffiliation(user, { writingChatId: chatId, affiliation: { type: "experience", id: experienceId }, clearSuggestionOnly: false });
    expect(aff).toMatchObject({ experienceId, educationId: null });
    expect(aff.structuredDraft.affiliation_suggestion).toBeNull();

    expect(await projectCount()).toBe(0);
    const saved = await saveWritingChat(user, chatId);
    expect(saved).toMatchObject({ status: "saved", projectCreated: true, detailsCreated: 1 });
    const { data: project } = await user.from("projects").select("*").eq("id", saved.projectId).single();
    expect(project).toMatchObject({ name: "결제 승인 API 성능 개선", role: "백엔드 리드", experience_id: experienceId, source_writing_chat_id: chatId, start_month: "2023-03-01" });
    const { data: details } = await user.from("project_details").select("*").eq("project_id", saved.projectId);
    expect(details).toHaveLength(1);
    expect(details![0]).toMatchObject({ title: "피크 시간 결제 지연", source_writing_chat_id: chatId });

    chat = await getWritingChat(user, userId, chatId);
    expect(chat).toMatchObject({ status: "saved", projectId: saved.projectId, canSend: false, daysUntilAutoDelete: null });
    await expect(prepareTurn(deps(), { chatId, content: "더", requestedSlot: null })).rejects.toMatchObject({ code: "writing_chat_not_active" });
    expect((await getCareerTree(user)).activeWritingChats.map((c) => c.id)).not.toContain(chatId);
  });

  it("hand-off (no AI): a second chat's edits go to draft career rows; delete the chat only keeps them", async () => {
    const { writingChatId } = await startWritingChat(user, { mode: "new_project" });
    await applyDraftEdit(user, { writingChatId, path: { section: "project", field: "name" }, value: "사내 배포 도구" });
    await editDraftDetail(user, { writingChatId, action: "add", detailKey: "D1" });
    await applyDraftEdit(user, { writingChatId, path: { section: "detail", detail: { detailKey: "D1" }, field: "title" }, value: "배포 자동화" });
    const handed = await handOffWritingChat(user, writingChatId);
    expect(handed).toMatchObject({ status: "handed_off", projectCreated: true, detailsCreated: 1 });
    const { data: project } = await user.from("projects").select("status, source_writing_chat_id").eq("id", handed.projectId).single();
    expect(project).toMatchObject({ status: "draft", source_writing_chat_id: writingChatId });

    const impact = await getDeletionImpact(user, { entityType: "writing_chat", entityId: writingChatId, affiliationMode: "keep_projects" });
    expect(impact.message_count).toBe(1);
    expect(impact.linked_saved_rows).toBeGreaterThanOrEqual(2);
    const deleted = await deleteWritingChat(user, writingChatId);
    expect(deleted.messageCount).toBe(1);
    const { data: kept } = await user.from("projects").select("id, source_writing_chat_id").eq("id", handed.projectId).single();
    expect(kept).toMatchObject({ id: handed.projectId, source_writing_chat_id: null });
  });

  it("abandon: active → abandoned once; augment start checks the project", async () => {
    const { writingChatId } = await startWritingChat(user, { mode: "new_project" });
    expect(await abandonWritingChat(user, writingChatId)).toEqual({ writingChatId, status: "abandoned" });
    await expect(abandonWritingChat(user, writingChatId)).rejects.toMatchObject({ code: "writing_chat_not_active" });
    await expect(startWritingChat(user, { mode: "augment_project", projectId: crypto.randomUUID() })).rejects.toMatchObject({ code: "not_found" });
  });

  it("no conversation text in logs (NFR-PRV-09)", () => {
    const all = logs.join("\n");
    expect(all).not.toContain("결제 승인");
    expect(all).not.toContain("피크 시간");
    expect(all).not.toContain("FAKE-integration-key");
  });
});
