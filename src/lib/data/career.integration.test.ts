import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { previewMarkerValue } from "@/server/auth/preview-marker";
import { ProviderError } from "@/server/ai/errors";
import { output } from "@/server/ai/__fixtures__/AI-12/conversations";
import { createAiWriterClient } from "@/server/db/ai-writer";
import type { Database } from "@/server/db/database.types";
import { resetServerEnvCache } from "@/server/env";
import { createRecordingKeyStatusReporter, createStaticKeySource, createStaticProviderContext } from "@/server/jobs/provider-context";
import { createSupabaseJobStore } from "@/server/jobs/supabase-store";
import { createSupabaseUsageStore } from "@/server/jobs/supabase-usage";
import type { LlmFactoryInput } from "@/server/jobs/types";
import { createTurnChatDb } from "@/server/services/writing-chat/db";
import { createDeliverablePipelines, createWritingChatPipelines } from "@/server/services/writing-chat/pipelines";
import type { TurnDeps } from "@/server/services/writing-chat/types";
import { connectTestProvider, markTestKeyInvalid } from "@/test/ai-connection-db";
import { createScriptedAdapter, scriptedLlmFactory, type ScriptedResponse } from "@/test/job-fakes";
import { hasTable, isStackReady, readLocalSupabase } from "@/test/local-supabase";

/**
 * W2 wiring against the local stack: the real data functions of `career.ts`, `writing-chats.ts`,
 * `deletion.ts` and `writing-chat-view.ts` → services → real rows as a signed-in, consented user (the real
 * consent gate runs). R4: the v4.3b exports are compatibility shims over the v4.4 model (mapped rows,
 * `not_supported` for removed paths); `career-v44.ts` / `writing-chats-v44.ts` are the new layer. The turn goes through the real Route Handler and the client's SSE reader
 * (`realChatTurn`); only the provider is scripted. Fake keys, no provider call.
 * Own generated user, removed at the end. Skips when the stack isn't running.
 */

const session = vi.hoisted(() => ({ client: null as unknown, preview: false, deps: null as null | (() => unknown), jar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(session.preview ? { "x-resumate-preview": previewMarkerValue() } : {}),
  cookies: async () => ({
    get: (name: string) => (session.jar.has(name) ? { name, value: session.jar.get(name)! } : undefined),
    getAll: () => [...session.jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void session.jar.set(name, value),
    delete: (name: string) => void session.jar.delete(name),
  }),
}));
vi.mock("next/server", async (actual) => ({ ...(await actual<typeof import("next/server")>()), connection: async () => {} }));
vi.mock("@/server/db/server", () => ({ createSupabaseServerClient: async () => session.client }));
vi.mock("@/server/jobs/writing-chat-turn", () => ({ createWritingChatTurnDeps: () => session.deps!() }));

const stack = readLocalSupabase();
const ready = stack ? (await isStackReady(stack)) && (await hasTable(stack, "project_deliverables")) : false;

type Client = SupabaseClient<Database>;

const USER_TEXT = "결제 승인 API가 피크 시간에 느려졌어요. 저는 백엔드 개발을 맡았어요.";
const firstExtract = output({
  star_patches: [
    { field: "situation", op: "set", value: "결제 승인 API가 피크 시간에 느려졌다", source_message_ids: ["M2"], source_quotes: ["결제 승인 API가 피크 시간에 느려졌어요"] },
    { field: "task", op: "set", value: "백엔드 개발을 맡았다", source_message_ids: ["M2"], source_quotes: ["저는 백엔드 개발을 맡았어요"] },
  ],
});

describe.skipIf(!ready)("W2 career and writing chat wiring (local stack)", () => {
  const s = stack!;
  let admin: Client;
  let user: Client;
  let userId = "";
  const replies: ScriptedResponse[] = [];
  const extracts: ScriptedResponse[] = [];

  const career = () => import("./career");
  const chats = () => import("./writing-chats");
  const deletion = () => import("./deletion");

  function turnDeps(): TurnDeps {
    const writer = createAiWriterClient(userId);
    const replyAdapter = createScriptedAdapter("anthropic", replies, Date.now);
    const extractAdapter = createScriptedAdapter("anthropic", extracts, Date.now);
    replies.length = 0;
    extracts.length = 0;
    const log = () => {};
    return {
      userId,
      chats: createTurnChatDb(user, writer, log),
      store: createSupabaseJobStore(writer),
      usage: createSupabaseUsageStore(writer),
      writer,
      providerContext: createStaticProviderContext({ provider: "anthropic", connectionTier: "paid", keyStatus: "valid" }),
      keySource: createStaticKeySource("sk-ant-FAKE-wiring-key-0000", () => new ProviderError("key_missing")),
      keyStatus: createRecordingKeyStatusReporter(),
      runGate: null,
      createLlm: (input: LlmFactoryInput) =>
        input.tier === "light" ? scriptedLlmFactory(extractAdapter.adapter, Date.now)(input) : scriptedLlmFactory(replyAdapter.adapter, Date.now)(input),
      pipelines: createWritingChatPipelines({ logger: () => {}, log }),
      deliverablePipelines: createDeliverablePipelines({ logger: () => {}, log }),
      log,
    };
  }

  /** What the screen does with `{ endpoint, body }`: the client SSE reader over the real Route Handler. */
  async function stream(request: { endpoint?: string; body?: unknown }, reply: ScriptedResponse[], extract: ScriptedResponse[], controller = new AbortController()) {
    replies.push(...reply);
    extracts.push(...extract);
    const { realChatTurn } = await import("./ai-stream-client");
    const { POST } = await import("@/app/api/writing-chats/[id]/turns/route");
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      if (typeof input !== "string" || !input.startsWith("/api/")) return fetchReal(input, init);
      const url = new URL(input, "http://localhost");
      const id = url.pathname.split("/")[3]!;
      return POST(new Request(url, init), { params: Promise.resolve({ id }) } as never);
    });
    const events: Array<{ type: string; error_code?: string }> = [];
    try {
      for await (const ev of realChatTurn({ endpoint: request.endpoint!, body: request.body }, controller.signal)) events.push(ev);
    } finally {
      vi.unstubAllGlobals();
    }
    return events;
  }
  const fetchReal = globalThis.fetch;

  beforeEach(() => {
    session.client = user;
    session.preview = false;
    session.deps = turnDeps;
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", s.url);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", s.anonKey);
    vi.stubEnv("SUPABASE_JWT_SECRET", s.jwtSecret);
    vi.stubEnv("CRON_SECRET", "test-cron-secret-0000");
    resetServerEnvCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeAll(async () => {
    admin = createClient<Database>(s.url, s.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const email = `w2-${crypto.randomUUID()}@example.test`;
    const password = `pw-${crypto.randomUUID()}`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.code}`);
    userId = data.user.id;
    user = createClient<Database>(s.url, s.anonKey, { auth: { persistSession: false } });
    const signIn = await user.auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error(`signIn failed: ${signIn.error.code}`);
  });

  afterAll(async () => {
    if (userId) {
      await admin.from("ai_jobs").delete().eq("user_id", userId);
      await admin.auth.admin.deleteUser(userId);
    }
    resetServerEnvCache();
  });

  const count = async (table: "experiences" | "educations" | "projects" | "project_deliverables" | "skills") => {
    const { count: n } = await admin.from(table).select("id", { count: "exact", head: true }).eq("user_id", userId);
    return n ?? 0;
  };

  it("the consent gate refuses before anything is read; record_consents opens it (spec-gaps ⑲: the RPC, not S-03)", async () => {
    const { listExperiences } = await career();
    await expect(listExperiences()).rejects.toMatchObject({ code: "consent_required" });
    const consented = await user.rpc("record_consents", {
      items: ["terms", "privacy_required", "cross_border_transfer"].map((consent_type) => ({ consent_type, agreed: true })),
    });
    expect(consented.error).toBeNull();
    expect(await listExperiences()).toEqual([]);
  });

  let experienceId = "";
  let educationId = "";
  let projectId = "";

  it("experience: create → edit, DB status, month format kept as the screen sends it, no duplicate on repeated saves", async () => {
    const { saveExperience, listExperiences } = await career();
    const created = await saveExperience(null, { company_name: "에이비씨페이", start_month: null });
    experienceId = created.id;
    expect(created.status).toBe("draft");

    const edited = await saveExperience(experienceId, { company_name: "에이비씨페이", start_month: "2021-03-01", is_current: true, end_month: "2022-01-01", job_position: "백엔드 개발자" });
    expect(edited).toMatchObject({ id: experienceId, status: "complete", start_month: "2021-03-01", end_month: null, is_current: true });
    // The same form values again (autosave retry, or a flush with nothing new).
    await saveExperience(experienceId, { company_name: "에이비씨페이", start_month: "2021-03-01", is_current: true, job_position: "백엔드 개발자" });
    await saveExperience(experienceId, { company_name: "에이비씨페이", start_month: "2021-03-01", is_current: true, job_position: "백엔드 개발자" });
    expect(await count("experiences")).toBe(1);
    expect((await listExperiences()).map((e) => e.id)).toEqual([experienceId]);
  });

  it("autosave identity: client_id makes a retried create one row; expected_updated_at refuses a stale save; a deleted id isn't re-created", async () => {
    const { saveExperience } = await career();
    const { deleteCareerItem } = await deletion();
    const before = await count("experiences");
    const clientId = crypto.randomUUID();
    const first = await saveExperience(null, { company_name: "재시도 회사" }, { client_id: clientId });
    const retried = await saveExperience(null, { company_name: "재시도 회사" }, { client_id: clientId });
    expect([first.id, retried.id]).toEqual([clientId, clientId]);
    expect(await count("experiences")).toBe(before + 1);

    const edited = await saveExperience(clientId, { company_name: "수정한 회사" });
    await expect(saveExperience(clientId, { company_name: "낡은 탭" }, { expected_updated_at: first.updated_at })).rejects.toMatchObject({ code: "conflict" });
    await expect(saveExperience(null, { company_name: "늦게 온 재시도" }, { client_id: clientId })).rejects.toMatchObject({ code: "conflict" });
    expect((await saveExperience(clientId, { company_name: "최신 탭" }, { expected_updated_at: edited.updated_at })).company_name).toBe("최신 탭");

    await deleteCareerItem("experience", clientId);
    await expect(saveExperience(clientId, { company_name: "지운 행" })).rejects.toMatchObject({ code: "not_found" });
    expect(await count("experiences")).toBe(before);
    // QA-W5-06 (2): the lost-response retry of the create (same client_id) doesn't bring it back either
    await expect(saveExperience(null, { company_name: "재시도 회사" }, { client_id: clientId })).rejects.toMatchObject({ code: "not_found" });
    expect(await count("experiences")).toBe(before);
    // another browser (no cookie) is not covered — documented; a fresh client_id still creates
    const fresh = await saveExperience(null, { company_name: "새 회사" }, { client_id: crypto.randomUUID() });
    await deleteCareerItem("experience", fresh.id);
  });

  it("a range the DB refuses comes back as a failed save, not a stored row (spec-gaps W2)", async () => {
    const { saveExperience } = await career();
    await expect(saveExperience(experienceId, { start_month: "2021-03-01", end_month: "2020-01-01", is_current: false })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("shims: education, project (legacy form → v4.4 columns), details / achievements not supported, skills on standalone only", async () => {
    const { saveEducation, saveProject, saveProjectDetail, saveAchievement, reorderProjectDetails, setProjectSkills, addManualSkill, getProject, getEducation, getExperience, getProjectDetail, getAchievement, listSkills } = await career();

    const education = await saveEducation(null, { institution_name: "한국대학교", education_type: "degree", start_month: "2015-03-01", end_month: "2019-02-01", enrollment_status: "enrolled" });
    educationId = education.id;
    expect(education).toMatchObject({ status: "complete", end_month: null, enrollment_status: "enrolled" });

    // Legacy create: name + affiliation (C-23), team_size / role dropped on an affiliated project.
    const project = await saveProject(null, { experience_id: experienceId, education_id: null, name: "결제 개선", role: "백엔드", start_month: "2022-05-01", team_size: 4 });
    projectId = project.id;
    expect(project).toMatchObject({ status: "draft", experience_id: experienceId, name: "결제 개선", role: null, team_size: null, start_month: "2022-05-01" });
    const loaded = await getProject(projectId);
    expect(loaded).toMatchObject({ experience: { id: experienceId }, education: null, details: [], skills: [], writing_chats: [] });

    // Standalone: summary → description (completes it), role kept.
    const standalone = await saveProject(null, { experience_id: null, education_id: null, name: "개인 프로젝트" });
    const done = await saveProject(standalone.id, { role: "1인 개발", summary: "가계부 앱" });
    expect(done).toMatchObject({ status: "complete", role: "1인 개발", summary: "가계부 앱" });
    await expect(saveProject(standalone.id, { experience_id: experienceId })).rejects.toMatchObject({ code: "project_scope_change_not_allowed" });

    for (const removed of [
      () => saveProjectDetail(projectId, null, { title: "지연 개선" }),
      () => reorderProjectDetails(projectId, []),
      () => saveAchievement(null, { experience_id: experienceId, description: "연간 장애 0건" }),
    ]) {
      await expect(removed()).rejects.toMatchObject({ code: "not_supported", status: 410 });
    }
    expect(await getProjectDetail(projectId, crypto.randomUUID())).toBeNull();
    expect(await getAchievement(crypto.randomUUID())).toBeNull();
    expect((await getExperience(experienceId))?.achievements).toEqual([]);

    expect((await setProjectSkills(standalone.id, ["Node.js", "PostgreSQL"])).map((x) => x.name)).toEqual(["Node.js", "PostgreSQL"]);
    await expect(setProjectSkills(projectId, ["Go"])).rejects.toMatchObject({ code: "project_skill_requires_standalone_project" });
    expect((await setProjectSkills(standalone.id, ["node.js"])).map((x) => x.name)).toEqual(["Node.js"]);
    expect(await addManualSkill("Kafka")).toMatchObject({ name: "Kafka", is_manual: true, user_id: userId });
    expect((await listSkills()).map((x) => [x.name, x.project_count])).toEqual([["Node.js", 1], ["Kafka", 0]]);
    expect((await getEducation(educationId))?.projects).toEqual([]);
    for (const missing of [await getProject("not-a-uuid"), await getExperience(crypto.randomUUID())]) expect(missing).toBeNull();
  });

  it("v4.4 data layer (연결 대기): list, panels, STAR section saves, deliverables", async () => {
    const v44 = await import("./career-v44");
    const list = await v44.getCareerList();
    const ids = list.years.flatMap((y) => y.items.map((i) => i.id));
    expect(ids).toContain(experienceId);
    expect(ids).not.toContain(projectId);
    const panel = await v44.getExperiencePanel(experienceId);
    expect(panel!.projects.map((p) => p.id)).toEqual([projectId]);

    const page = await v44.getProjectPage(projectId);
    await v44.saveProjectSection({ id: projectId, expectedUpdatedAt: page!.project.updatedAt, situation: "피크 지연", action: "쿼리 개선", competencies: ["analysis"] });
    expect((await v44.getProjectPage(projectId))!.project).toMatchObject({ status: "complete", competencies: ["analysis"] });

    const sp = await v44.createProject({ name: "사이드", affiliation: { type: "none" } });
    const dlv = await v44.saveDeliverable({ id: crypto.randomUUID(), projectId: sp.id, title: "회고", body: "배운 것" });
    expect((await v44.getStandaloneProject(sp.id))!.deliverables.map((d) => d.id)).toEqual([dlv.id]);
    expect(await v44.getDeliverable(dlv.id)).toMatchObject({ deliverable: { title: "회고", body: "배운 것" } });
    expect(await count("project_deliverables")).toBe(1);
  });

  it("QA-02 (UI32): S-10 new project under an education — parent name is the trimmed program_name, else institution_name", async () => {
    const { getNewProjectPage } = await import("./career-v45");
    const insert = async (program_name: string | null, institution_name: string | null) => {
      const r = await user.from("educations").insert({ user_id: userId, program_name, institution_name }).select("id").single();
      if (r.error) throw new Error(`insert education failed: ${r.error.code}`);
      return r.data.id;
    };
    const named = await insert("  클라우드 백엔드 부트캠프 ", "코드스쿨");
    const blankProgram = await insert("   ", " 코드스쿨 ");
    const nameless = await insert(null, " ");
    const parentOf = async (education: string) => {
      const page = await getNewProjectPage({ education });
      if (page.kind !== "ok") throw new Error(`expected ok, got ${page.kind}`);
      return page.data;
    };
    const page = await parentOf(named);
    expect(page.parent).toEqual({ type: "education", id: named, name: "클라우드 백엔드 부트캠프" });
    expect(page.values).toMatchObject({ education_id: named });
    expect(page.affiliations).toContainEqual({ type: "education", id: named, name: "클라우드 백엔드 부트캠프" });
    expect((await parentOf(blankProgram)).parent.name).toBe("코드스쿨");
    expect((await parentOf(nameless)).parent.name).toBeNull();
    expect(await getNewProjectPage({ education: crypto.randomUUID() })).toEqual({ kind: "not_found" });
    await admin.from("educations").delete().in("id", [named, blankProgram, nameless]);
  });

  it("S-08 tree shim: each experience / education once under its start year with all its projects; standalone by year or undated", async () => {
    const { saveExperience, saveEducation, saveProject, getCareerTree } = await career();
    const { deleteCareerItem } = await deletion();
    const exp = await saveExperience(null, { company_name: "시작 월 없는 회사" });
    const edu = await saveEducation(null, { institution_name: "시작 월 없는 학교" });
    const inside = await saveProject(null, { experience_id: exp.id, education_id: null, name: "그 회사 프로젝트" });
    const dated = await saveProject(null, { experience_id: null, education_id: null, name: "2019 개인", start_month: "2019-06-01" });
    const undated = await saveProject(null, { experience_id: null, education_id: null, name: "날짜 없음" });
    const tree = await getCareerTree();
    expect(tree.undated_entries.find((e) => e.experience?.id === exp.id)).toMatchObject({ kind: "experience", collapsed: false, projects: [expect.objectContaining({ id: inside.id })] });
    expect(tree.undated_entries.find((e) => e.education?.id === edu.id)).toMatchObject({ kind: "education", collapsed: true, projects: [] });
    expect(tree.years.find((y) => y.year === 2019)?.other_projects.map((p) => p.id)).toEqual([dated.id]);
    expect(tree.undated_projects.map((p) => p.id)).toContain(undated.id);
    // CR-4: the 2021–now job is listed once, under 2021, with its projects.
    expect(tree.years.flatMap((y) => y.entries).filter((e) => e.experience?.id === experienceId)).toHaveLength(1);
    expect(tree.years.find((y) => y.year === 2021)?.entries.find((e) => e.experience?.id === experienceId)?.projects.map((p) => p.id)).toEqual([projectId]);
    expect(tree).toMatchObject({ is_empty: false, active_writing_chats: [], counts: { complete_project_details: 0 } });
    await deleteCareerItem("experience", exp.id);
    await deleteCareerItem("education", edu.id);
    await deleteCareerItem("project", dated.id);
    await deleteCareerItem("project", undated.id);
  });

  it("a `?state=` request stays on the mock store: fixtures read, nothing written to real rows", async () => {
    const { listExperiences, saveExperience } = await career();
    const before = await count("experiences");
    session.preview = true;
    const fixture = await listExperiences();
    expect(fixture.length).toBeGreaterThan(0);
    expect(fixture.some((e) => e.id === experienceId)).toBe(false);
    await saveExperience(null, { company_name: "미리보기" });
    await expect(saveExperience(null, { company_name: "실패" }, { fail: true })).rejects.toThrow();
    session.preview = false;
    expect(await count("experiences")).toBe(before);
  });

  it("delete shim: v4.4 counts in the legacy shape; keep_projects / removed types refused; an experience takes its projects", async () => {
    const { getDeletionImpact, deleteCareerItem } = await deletion();
    const { getProject, saveExperience, saveProject } = await career();
    await expect(getDeletionImpact("project_detail", crypto.randomUUID())).rejects.toMatchObject({ code: "not_supported" });
    await expect(getDeletionImpact("experience", experienceId, "keep_projects")).rejects.toMatchObject({ code: "affiliation_mode_not_supported" });
    const impact = await getDeletionImpact("experience", experienceId);
    expect(impact.cascade).toMatchObject({ projects: 1, project_details: 0, achievements: 0 });

    const other = await saveExperience(null, { company_name: "다른 회사" });
    const owned = await saveProject(null, { experience_id: other.id, education_id: null, name: "함께 지울 것" });
    await deleteCareerItem("experience", other.id);
    expect(await getProject(owned.id)).toBeNull();
  });

  // ---------- writing chat (legacy screen shims + the real route) ----------

  let chatId = "";

  it("start shim: only a chat on an affiliated project; send without a key is refused and stores nothing", async () => {
    const { startWritingChat, sendWritingChatTurn } = await chats();
    const { withAiGuard } = await import("./ai-guard");
    await expect(startWritingChat({ mode: "new_project", experience_id: experienceId })).rejects.toMatchObject({ code: "not_supported" });
    const chat = await startWritingChat({ mode: "augment_project", project_id: projectId });
    chatId = chat.id;
    expect(chat).toMatchObject({ status: "active", message_count: 0, mode: "augment_project", project_id: projectId, experience_id: experienceId });
    expect(chat.messages.map((m) => [m.sequence, m.role, m.status])).toEqual([[1, "assistant", "done"]]);

    expect(await withAiGuard(() => sendWritingChatTurn(chatId, USER_TEXT))).toMatchObject({ rejected: "key_missing", refusal: "ai_not_connected" });
    const { count: stored } = await admin.from("writing_chat_messages").select("id", { count: "exact", head: true }).eq("writing_chat_id", chatId);
    expect(stored).toBe(1);
  });

  it("invalid key → refused as key_invalid", async () => {
    const { sendWritingChatTurn, retryWritingChatTurn } = await chats();
    const { withAiGuard } = await import("./ai-guard");
    await connectTestProvider(admin, user, userId, "anthropic", "paid");
    await markTestKeyInvalid(admin, userId, "anthropic");
    expect(await withAiGuard(() => sendWritingChatTurn(chatId, USER_TEXT))).toMatchObject({ rejected: "key_invalid" });
    expect(await withAiGuard(() => retryWritingChatTurn(chatId))).toMatchObject({ rejected: "key_invalid" });
    await connectTestProvider(admin, user, userId, "anthropic", "paid");
  });

  it("turn through the real route: stand-in message → SSE → stored rows, v3 draft patched, no career write", async () => {
    const { sendWritingChatTurn, completeWritingChatTurn, getWritingChat } = await chats();
    const v44 = await import("./writing-chats-v44");
    const before = await admin.from("projects").select("situation, task").eq("id", projectId).single();

    const sent = await sendWritingChatTurn(chatId, USER_TEXT, "situation");
    expect(sent.endpoint).toBe(`/api/writing-chats/${chatId}/turns`);
    expect(sent.body).toMatchObject({ content: USER_TEXT, requestedSlot: { slot: "situation" } });

    const events = await stream(sent, [{ json: "그때 어떤 상황이었나요?" }], [{ json: firstExtract }]);
    expect(events.map((e) => e.type)).toEqual(["reply_delta", "reply_done", "draft_patch", "draft_flags", "turn_done"]);
    await completeWritingChatTurn(chatId, false);

    const chat = await getWritingChat(chatId);
    expect(chat?.message_count).toBe(2);
    expect(chat?.messages.map((m) => [m.role, m.status])).toEqual([["assistant", "done"], ["user", "done"], ["assistant", "done"]]);
    expect(chat?.messages[2]).toMatchObject({ provider: "anthropic", model_tier: "default", connection_tier: "paid" });
    // The legacy view shows no v1 draft; the v4.4 panel reads the v3 proposal.
    expect(chat?.structured_draft).toEqual({});
    const panel = await v44.getProjectChat(chatId);
    expect(panel.structuredDraft.star.task?.value).toBe("백엔드 개발을 맡았다");
    expect(panel.title).not.toBeNull();
    const after = await admin.from("projects").select("situation, task").eq("id", projectId).single();
    expect(after.data).toEqual(before.data);
  });

  it("failed reply: 다시 보내기 through ?retry=1 reuses the row, count unchanged; nothing to retry → null", async () => {
    const { sendWritingChatTurn, retryWritingChatTurn, completeWritingChatTurn, getWritingChat } = await chats();
    expect(await retryWritingChatTurn(chatId)).toBeNull();
    const sent = await sendWritingChatTurn(chatId, "결제 실패 문의가 많았어요.");
    const failed = await stream(sent, [{ error: "rate_limited" }], [{ json: output({}) }]);
    expect(failed.at(-1)).toMatchObject({ type: "error", error_code: "rate_limited", provider: "anthropic" });
    await completeWritingChatTurn(chatId, true, "rate_limited");
    const chat = await getWritingChat(chatId);
    expect(chat?.messages.at(-1)).toMatchObject({ role: "assistant", status: "failed" });
    const countAfterFailure = chat!.message_count;

    const spec = await retryWritingChatTurn(chatId);
    expect(spec?.endpoint).toBe(`/api/writing-chats/${chatId}/turns?retry=1`);
    const resend = await stream(spec!, [{ json: "어떤 지표를 봤나요?" }], []);
    expect(resend.at(-1)).toMatchObject({ type: "turn_done" });
    const after = await getWritingChat(chatId);
    expect(after?.message_count).toBe(countAfterFailure);
    expect(after?.messages.at(-1)?.status).toBe("done");
  });

  it("v4.5 page save (연결 대기): [반영] fills the form, 저장하기 records it; removed v4.3b chat paths answer not_supported", async () => {
    const v44 = await import("./writing-chats-v44");
    const v45 = await import("./page-save-v45");
    const w = await chats();
    const draft = (await v44.getProjectChat(chatId)).structuredDraft;
    const task = draft.star.task!;
    const saved = await v45.saveProjectPage({ projectId, values: { task: task.value }, appliedProposals: [{ writingChatId: chatId, field: "task", rev: task.rev }] });
    expect(saved.applied).toEqual([{ writingChatId: chatId, field: "task" }]);
    const row = await admin.from("projects").select("situation, task, source_writing_chat_id").eq("id", projectId).single();
    expect(row.data).toMatchObject({ task: "백엔드 개발을 맡았다", source_writing_chat_id: chatId });
    expect((await v44.listProjectChats(projectId)).map((c) => c.id)).toEqual([chatId]);

    for (const removed of [
      () => w.saveWritingChat(chatId),
      () => w.handOffWritingChat(chatId),
      () => w.setWritingChatAffiliation(chatId, "dismiss_suggestion"),
      () => w.applyStructuredDraftPatch(chatId, { path: "project.name", action: "edit", value: "x" }),
    ]) {
      await expect(removed()).rejects.toMatchObject({ code: "not_supported" });
    }
    expect(await w.listActiveWritingChats()).toEqual([]);
    expect(await w.listAbandonedWritingChats()).toEqual([]);
    expect(await w.getWritingChatSaveSummary(chatId)).toBeNull();
    await w.abandonWritingChat(chatId); // no-op
    expect((await w.resumeWritingChat(chatId))?.status).toBe("active");

    const { getDeletionImpact, deleteCareerItem } = await deletion();
    expect((await getDeletionImpact("writing_chat", chatId)).writing_chat).toEqual({ message_count: 4, linked_saved_rows: 1 });
    await deleteCareerItem("writing_chat", chatId);
    expect(await w.getWritingChat(chatId)).toBeNull();
    expect(await w.getWritingChat("not-a-uuid")).toBeNull();
  });

  it("QA-W5-07: the data functions behind component actions answer bad input with a typed AppError, never a TypeError", async () => {
    const { isAppError } = await import("@/lib/contracts/errors")
    const c = await career()
    const w = await chats()
    const d = await deletion()
    const i = await import("./interviews")
    const j = await import("./ai-jobs")
    const e = await import("./evidence")
    const n = null as never
    const calls: Array<[string, () => Promise<unknown>]> = [
      ["saveExperience(null, null)", () => c.saveExperience(null, n)],
      ["saveExperience(bad id)", () => c.saveExperience("x" as never, {})],
      ["saveEducation(null, null)", () => c.saveEducation(null, n)],
      ["saveProject(null, null)", () => c.saveProject(null, n)],
      ["saveAchievement(null, null)", () => c.saveAchievement(null, n)],
      ["saveProjectDetail(null…)", () => (c.saveProjectDetail as (...a: unknown[]) => Promise<unknown>)(null, null, null)],
      ["setProjectSkills(null, null)", () => c.setProjectSkills(n, n)],
      ["reorderProjectDetails(null, null)", () => c.reorderProjectDetails(n, n)],
      ["addManualSkill(null)", () => c.addManualSkill(n)],
      ["deleteCareerItem(null…)", () => d.deleteCareerItem(n, n)],
      ["startWritingChat(null)", () => w.startWritingChat(n)],
      ["sendWritingChatTurn(null, null)", () => w.sendWritingChatTurn(n, n)],
      ["retryWritingChatTurn(null)", () => w.retryWritingChatTurn(n)],
      ["completeWritingChatTurn(null…)", () => (w.completeWritingChatTurn as (...a: unknown[]) => Promise<unknown>)(null, null, null)],
      ["applyStructuredDraftPatch(null, null)", () => w.applyStructuredDraftPatch(n, n)],
      ["setWritingChatAffiliation(null…)", () => (w.setWritingChatAffiliation as (...a: unknown[]) => Promise<unknown>)(null, null)],
      ["getWritingChatSaveSummary(null)", () => w.getWritingChatSaveSummary(n)],
      ["saveWritingChat(null)", () => w.saveWritingChat(n)],
      ["handOffWritingChat(null)", () => w.handOffWritingChat(n)],
      ["clearReturnTarget(null)", () => w.clearReturnTarget(n)],
      ["startInterviewSession(null)", () => i.startInterviewSession(n)],
      ["startInterviewSession(bad)", () => i.startInterviewSession({ application_project_id: "x", interview_type: "nope", question_count: 99 } as never)],
      ["restartInterviewSession(null, null)", () => i.restartInterviewSession(n, n)],
      ["getInterviewSession(null, null)", () => i.getInterviewSession(n, n)],
      ["saveInterviewAnswer(null, null)", () => i.saveInterviewAnswer(n, n)],
      ["submitInterviewSession(null)", () => i.submitInterviewSession(n)],
      ["abandonInterviewSession(null)", () => i.abandonInterviewSession(n)],
      ["deleteInterviewSession(null)", () => d.deleteInterviewSession(n)],
      ["getLatestJobFor(null, null)", () => (j.getLatestJobFor as (...a: unknown[]) => Promise<unknown>)(null, null)],
      ["getEvidenceForOwners(null, null)", () => e.getEvidenceForOwners(n, n)],
    ]
    const untyped: string[] = []
    for (const [name, call] of calls) {
      try {
        await call()
      } catch (err) {
        if (!isAppError(err)) untyped.push(`${name}: ${(err as Error)?.constructor?.name} ${(err as Error)?.message?.slice(0, 80)}`)
      }
    }
    expect(untyped).toEqual([])
  })
});
