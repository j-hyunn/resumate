import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateProjectInput, SaveExperienceInput } from "@/lib/contracts/career";
import { ProviderError } from "@/server/ai/errors";
import { output } from "@/server/ai/__fixtures__/AI-12/conversations";
import { createAiWriterClient } from "@/server/db/ai-writer";
import type { Database } from "@/server/db/database.types";
import { resetServerEnvCache } from "@/server/env";
import { createRecordingKeyStatusReporter, createStaticKeySource, createStaticProviderContext } from "@/server/jobs/provider-context";
import { createSupabaseJobStore } from "@/server/jobs/supabase-store";
import { createSupabaseUsageStore } from "@/server/jobs/supabase-usage";
import type { LlmFactoryInput } from "@/server/jobs/types";
import { createProject, getDeletionImpact, getProjectDetail, saveExperience, saveProjectPage } from "@/server/services/career";
import { createScriptedAdapter, scriptedLlmFactory, type ScriptedResponse } from "@/test/job-fakes";
import { hasTable, isStackReady, readLocalSupabase } from "@/test/local-supabase";
import type { AnyWritingChatDto, WritingChatDto, WritingChatTurnEvent } from "@/lib/contracts/writing-chat";
import {
  applyDraftEdit,
  deleteWritingChat,
  getWritingChat,
  listProjectWritingChats,
  reviewDraftField,
  startWritingChat,
} from "./chat";
import { createTurnChatDb } from "./db";
import { createDeliverablePipelines, createWritingChatPipelines } from "./pipelines";
import { prepareTurn, runTurn } from "./turn";
import type { TurnDeps } from "./types";

/**
 * R4 (DM v4.4) end-to-end against the local stack: a chat on an affiliated project →
 * full turn (real AI-12 v4.5 pipelines, scripted provider) → failed reply + "다시 보내기"
 * → proposal edits / review → [반영] = form fill + "저장하기" (save_project_page records "반영됨", R5) → STAR on the project;
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
  let replyCalls: unknown[] = [];
  let extractCalls: unknown[] = [];

  function deps(): TurnDeps {
    const writer = createAiWriterClient(userId);
    const replyAdapter = createScriptedAdapter("anthropic", replies, Date.now);
    const extractAdapter = createScriptedAdapter("anthropic", extracts, Date.now);
    replies.length = 0;
    extracts.length = 0;
    replyCalls = replyAdapter.calls;
    extractCalls = extractAdapter.calls;
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
      deliverablePipelines: createDeliverablePipelines({ logger: (entry) => void logs.push(JSON.stringify(entry)), log }),
      log,
    };
  }

  async function turn(chatId: string, content: string | null, reply: ScriptedResponse[], extract: ScriptedResponse[], formSnapshot?: unknown) {
    replies.push(...reply);
    extracts.push(...extract);
    const d = deps();
    const prepared = await prepareTurn(d, { chatId, content, requestedSlot: null, formSnapshot });
    if (prepared.kind !== "ready") throw new Error(`blocked: ${prepared.code}`);
    const events: WritingChatTurnEvent[] = [];
    await runTurn(d, prepared, (e) => events.push(e as WritingChatTurnEvent), new AbortController().signal);
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

  const asStar = (dto: AnyWritingChatDto): WritingChatDto => {
    if (dto.target !== "project") throw new Error("expected a STAR chat");
    return dto;
  };
  const openChat = async (id: string) => asStar(await getWritingChat(user, userId, id));

  it("start: affiliated projects only; greeting not counted (R1 A5), no AI call; no chips (R-PA-5)", async () => {
    const standalone = await createProject(user, CreateProjectInput.parse({ name: "사이드", affiliation: { type: "none" } }));
    await expect(startWritingChat(user, { projectId: standalone.id })).rejects.toMatchObject({ code: "writing_chat_requires_affiliated_project" });
    await expect(startWritingChat(user, { projectId: crypto.randomUUID() })).rejects.toMatchObject({ code: "not_found" });

    // R5: a bad snapshot is refused by the start RPC; a good one only picks the greeting.
    await expect(startWritingChat(user, { projectId, formSnapshot: { name: "가".repeat(101) } })).rejects.toMatchObject({ code: "invalid_form_snapshot", status: 400 });
    ({ writingChatId: chatId } = await startWritingChat(user, { projectId, formSnapshot: { star: { situation: "" } } }));
    const chat = await openChat(chatId);
    expect(chat).toMatchObject({ projectId, title: null, status: "active", messageCount: 0, remainingMessages: 40, limitReached: false, lastAppliedAt: null });
    expect(chat.messages).toHaveLength(1);
    expect(chat.messages[0]).toMatchObject({ role: "assistant", status: "done", provider: null, aiJobId: null });
    expect("chips" in chat).toBe(false);
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
    expect("chips" in done).toBe(false);

    const chat = await openChat(chatId);
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
    let chat = await openChat(chatId);
    expect(chat.messageCount).toBe(4);
    expect(chat.messages.at(-1)).toMatchObject({ role: "assistant", status: "failed" });
    expect(chat.structuredDraft.star.situation?.value).toBeTruthy();
    const { data: failedJob } = await admin.from("ai_jobs").select("status, error_code, retry_after").eq("id", failed.jobId).single();
    expect(failedJob).toMatchObject({ status: "failed", error_code: "rate_limited" });
    expect(failedJob?.retry_after).not.toBeNull();

    const resend = await turn(chatId, null, [{ json: "결과는 어땠나요?" }], []);
    expect(resend.events.map((e) => e.type)).toEqual(["turn_started", "reply_delta", "reply_done", "turn_done"]);
    chat = await openChat(chatId);
    expect(chat.messageCount).toBe(4);
    expect(chat.messages).toHaveLength(5);
    expect(chat.messages.at(-1)).toMatchObject({ status: "done", aiJobId: resend.jobId });
    const { data: usage } = await admin.from("ai_usage_records").select("call_key").eq("ai_job_id", resend.jobId);
    expect(usage).toHaveLength(1);
  });

  it("proposal card: edit / review, then [반영] writes the project as the user; applied fields are locked", async () => {
    await applyDraftEdit(user, { writingChatId: chatId, path: { section: "star", field: "action" }, value: "APM으로 병목 쿼리를 찾아 인덱스를 재설계했다" });
    let chat = await openChat(chatId);
    expect(chat.structuredDraft.star.action).toMatchObject({ value: "APM으로 병목 쿼리를 찾아 인덱스를 재설계했다", origin: "user_edit", review: "ok" });
    await expect(reviewDraftField(user, { writingChatId: chatId, path: { section: "star", field: "action" } }, "accept")).rejects.toMatchObject({
      code: "invalid_review_transition",
    });
    if (chat.structuredDraft.star.situation?.review === "needs_review") {
      await reviewDraftField(user, { writingChatId: chatId, path: { section: "star", field: "situation" } }, "accept");
    }
    await applyDraftEdit(user, { writingChatId: chatId, path: { section: "classification", field: "competencies" }, value: ["analysis", "execution"] });

    // [반영] = the screen fills the form; "저장하기" writes the page and records "반영됨" (DM 2.5.1).
    chat = await openChat(chatId);
    const d = chat.structuredDraft;
    const saved = await saveProjectPage(user, {
      projectId,
      values: {
        startMonth: "2023-03",
        situation: d.star.situation?.value ?? null,
        task: d.star.task?.value ?? null,
        action: d.star.action!.value,
        competencies: ["analysis", "execution"],
      },
      appliedProposals: [
        { writingChatId: chatId, field: "start_month", rev: d.project.start_month!.rev },
        { writingChatId: chatId, field: "action", rev: d.star.action!.rev },
        { writingChatId: chatId, field: "competencies", rev: d.classification.competencies!.rev },
        // A stale rev is skipped; the save still succeeds.
        { writingChatId: chatId, field: "task", rev: 99 },
      ],
    });
    expect(saved.status).toBe("complete");
    expect(saved.applied.map((a) => a.field)).toEqual(["start_month", "action", "competencies"]);
    expect(saved.skipped).toEqual([{ writingChatId: chatId, field: "task", reason: "proposal_changed" }]);
    const star = await projectStar();
    expect(star).toMatchObject({ status: "complete", start_month: "2023-03-01", action: "APM으로 병목 쿼리를 찾아 인덱스를 재설계했다", source_writing_chat_id: chatId });
    const { data: comp } = await admin.from("projects").select("competencies").eq("id", projectId).single();
    expect(comp?.competencies).toEqual(["analysis", "execution"]);

    // The same record again → already_applied; an applied field can't be edited in the card.
    const again = await saveProjectPage(user, { projectId, values: {}, appliedProposals: [{ writingChatId: chatId, field: "action", rev: d.star.action!.rev }] });
    expect(again.skipped).toEqual([{ writingChatId: chatId, field: "action", reason: "already_applied" }]);
    // Optimistic concurrency: an old expectedUpdatedAt → stale_write with the current version.
    await expect(saveProjectPage(user, { projectId, values: { name: "다른 이름" }, expectedUpdatedAt: "2000-01-01T00:00:00Z" })).rejects.toMatchObject({
      code: "stale_write",
      status: 409,
      details: { current_updated_at: expect.any(String) },
    });
    await expect(applyDraftEdit(user, { writingChatId: chatId, path: { section: "star", field: "action" }, value: "x" })).rejects.toMatchObject({
      code: "field_already_applied",
    });
    chat = await openChat(chatId);
    expect(chat.lastAppliedAt).not.toBeNull();
    expect(chat.applicableFields).not.toContain("action");
  });

  it("page save rules: create needs a name + affiliation, field codes carry {field}; deleting the chat keeps the saved STAR", async () => {
    await expect(saveProjectPage(user, { projectId: null, values: { name: "새 프로젝트" } })).rejects.toMatchObject({ code: "project_affiliation_required", status: 400 });
    await expect(saveProjectPage(user, { projectId: null, values: { name: " ", experienceId } })).rejects.toMatchObject({ code: "project_name_required" });
    await expect(saveProjectPage(user, { projectId, values: { learnings: "가".repeat(2001) } })).rejects.toMatchObject({ code: "field_too_long", details: { field: "learnings" } });
    await expect(saveProjectPage(user, { projectId, values: { startMonth: "2024-05", endMonth: "2024-01" } })).rejects.toMatchObject({ code: "invalid_period", details: { field: "end_month" } });
    await expect(saveProjectPage(user, { projectId, values: { competencies: ["analysis", "analysis"] } })).rejects.toMatchObject({ code: "invalid_classification" });
    const created = await saveProjectPage(user, { projectId: null, values: { name: "새 프로젝트", experienceId, situation: "상황" } });
    expect(created).toMatchObject({ status: "draft", applied: [], skipped: [] });
    const standalone = await createProject(user, CreateProjectInput.parse({ name: "독립", affiliation: { type: "none" } }));
    await expect(saveProjectPage(user, { projectId: standalone.id, values: {} })).rejects.toMatchObject({ code: "project_not_affiliated" });

    const { writingChatId } = await startWritingChat(user, { projectId });
    expect((await listProjectWritingChats(user, projectId)).map((c) => c.id)).toEqual(expect.arrayContaining([chatId, writingChatId]));
    const impact = await getDeletionImpact(user, { entityType: "writing_chat", entityId: writingChatId });
    expect(impact).toMatchObject({ message_count: 0, last_applied_at: null });
    const deleted = await deleteWritingChat(user, writingChatId);
    expect(deleted.messageCount).toBe(0);
    // The saved STAR stays on the project.
    expect((await projectStar()).action).toBe("APM으로 병목 쿼리를 찾아 인덱스를 재설계했다");
  });

  it("UI32-2 QA-02: AI-12 model input keeps institution_name as the education affiliation (display name is UI-only)", async () => {
    const insert = async (program_name: string | null, institution_name: string | null) => {
      const r = await user.from("educations").insert({ user_id: userId, program_name, institution_name }).select("id").single();
      if (r.error) throw new Error(`insert education failed: ${r.error.code}`);
      return r.data.id;
    };
    // Same as before UI32-2: the pack line is `affiliation: 교육 '<institution_name>'`, never the program name.
    for (const [program, institution] of [
      ["클라우드 백엔드 부트캠프", "코드스쿨"],
      ["  ", "가상대학교"],
    ] as const) {
      const educationId = await insert(program, institution);
      const project = await createProject(user, CreateProjectInput.parse({ name: "교육 팀 프로젝트", affiliation: { type: "education", id: educationId } }));
      const { writingChatId } = await startWritingChat(user, { projectId: project.id });
      await turn(writingChatId, "팀 프로젝트에서 API를 만들었어요.", [{ json: "어떤 상황이었나요?" }], [{ json: output({}) }]);
      const pack = JSON.stringify([...replyCalls, ...extractCalls]);
      expect(pack).toContain(`affiliation: 교육 '${institution}'`);
      if (program.trim()) expect(pack).not.toContain(program);
      await deleteWritingChat(user, writingChatId);
    }
  });

  it("R10 (R9 QA-05): [무시] during a running turn — that turn's classification suggestion is refused by the RPC, the turn succeeds", async () => {
    const project = await createProject(user, CreateProjectInput.parse({ name: "배포 자동화", affiliation: { type: "experience", id: experienceId } }));
    // V-9i only suggests classifications once situation and action are known.
    const seeded = await admin.from("projects").update({ situation: "배포가 수동이라 오래 걸렸다", action: "배포 스크립트를 자동화했다" }).eq("id", project.id);
    if (seeded.error) throw new Error(`seed failed: ${seeded.error.code}`);
    const { writingChatId } = await startWritingChat(user, { projectId: project.id });
    const suggest = (value: "problem_solving" | "leadership") =>
      output({ classification_suggestions: { project_type: null, experience_type: { value, source_message_ids: ["M2"], reason: "문제를 찾아 해결한 경험" }, competencies: null } });
    const slot = async () => (await openChat(writingChatId)).structuredDraft.classification.experience_type;

    // Turn N: a pending experience_type proposal (rev 1).
    await turn(writingChatId, "배포 스크립트를 제가 직접 만들었어요.", [{ json: "어떤 결과가 있었나요?" }], [{ json: suggest("problem_solving") }]);
    expect(await slot()).toMatchObject({ value: "problem_solving", origin: "ai", rev: 1 });

    // Turn N+1: the user clicks [무시] after the turn read the draft (the extract call is the window).
    replies.push({ json: "다른 사람과 함께 한 부분도 있나요?" });
    extracts.push({ json: suggest("leadership") }); // a different value (the same one would be "unchanged" in V-9)
    const d = deps(); // takes the scripted queues
    const extract = d.pipelines.extract.bind(d.pipelines);
    d.pipelines = {
      ...d.pipelines,
      extract: async (call) => {
        await applyDraftEdit(user, { writingChatId, path: { section: "classification", field: "experience_type" }, value: null });
        return extract(call);
      },
    };
    const prepared = await prepareTurn(d, { chatId: writingChatId, content: "배포 시간이 절반으로 줄었어요.", requestedSlot: null });
    if (prepared.kind !== "ready") throw new Error(`blocked: ${prepared.code}`);
    const events: WritingChatTurnEvent[] = [];
    const logStart = logs.length;
    await runTurn(d, prepared, (e) => events.push(e as WritingChatTurnEvent), new AbortController().signal);

    // Normal path: no error event, job succeeded, the extract mark moved on.
    expect(events.map((e) => e.type)).not.toContain("error");
    expect(events.at(-1)).toMatchObject({ type: "turn_done" });
    const { data: job } = await admin.from("ai_jobs").select("status").eq("id", prepared.job.id).single();
    expect(job?.status).toBe("succeeded");
    const { data: row } = await admin.from("writing_chats").select("last_extracted_sequence").eq("id", writingChatId).single();
    expect(row?.last_extracted_sequence).toBe(4);
    // V-9i still saw the pre-[무시] draft, so the op reached the RPC — which refused it.
    const turnLogs = logs.slice(logStart).join("\n");
    expect(turnLogs).toContain('"event":"writing_chat.patch_rejected"');
    expect(turnLogs).toContain("classification_dismissed");
    // The slot stays dismissed (value null, rev 2) and the client got that state.
    expect(await slot()).toMatchObject({ value: null, origin: "ai", rev: 2 });
    const patch = events.find((e) => e.type === "draft_patch") as Extract<WritingChatTurnEvent, { type: "draft_patch" }> | undefined;
    if (patch) expect(patch.structuredDraft.classification.experience_type).toMatchObject({ value: null, rev: 2 });
    await deleteWritingChat(user, writingChatId);
  });

  it("no conversation text in logs (NFR-PRV-09)", () => {
    const all = logs.join("\n");
    expect(all).not.toContain("결제 승인");
    expect(all).not.toContain("피크 시간");
    expect(all).not.toContain("FAKE-integration-key");
  });
});
