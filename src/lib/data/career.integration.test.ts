import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { previewMarkerValue } from "@/server/auth/preview-marker";
import { CreateApplicationProjectInput } from "@/lib/contracts/application";
import { ProviderError } from "@/server/ai/errors";
import { output } from "@/server/ai/__fixtures__/AI-12/conversations";
import { createAiWriterClient } from "@/server/db/ai-writer";
import type { Database } from "@/server/db/database.types";
import { resetServerEnvCache } from "@/server/env";
import { createRecordingKeyStatusReporter, createStaticKeySource, createStaticProviderContext } from "@/server/jobs/provider-context";
import { createSupabaseJobStore } from "@/server/jobs/supabase-store";
import { createSupabaseUsageStore } from "@/server/jobs/supabase-usage";
import type { LlmFactoryInput } from "@/server/jobs/types";
import { createApplicationProject } from "@/server/services/application/write";
import { applyDraftPatch, createTurnChatDb } from "@/server/services/writing-chat/db";
import { createWritingChatPipelines } from "@/server/services/writing-chat/pipelines";
import type { TurnDeps } from "@/server/services/writing-chat/types";
import { connectTestProvider, markTestKeyInvalid } from "@/test/ai-connection-db";
import { createScriptedAdapter, scriptedLlmFactory, type ScriptedResponse } from "@/test/job-fakes";
import { hasTable, isStackReady, readLocalSupabase } from "@/test/local-supabase";

/**
 * W2 wiring against the local stack: the real data functions of `career.ts`, `writing-chats.ts`,
 * `deletion.ts` and `writing-chat-view.ts` → services → real rows as a signed-in, consented user (the real
 * consent gate runs). The turn goes through the real Route Handler and the client's SSE reader
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
const ready = stack ? (await isStackReady(stack)) && (await hasTable(stack, "writing_chats")) : false;

type Client = SupabaseClient<Database>;

const USER_TEXT = "에이비씨페이에서 결제 승인 API 성능 개선 프로젝트를 했어요. 저는 백엔드 개발을 맡았어요.";
const firstExtract = output({
  project_patches: [
    { field: "name", op: "set", value: "결제 승인 API 성능 개선", source_message_ids: ["M2"], source_quotes: ["결제 승인 API 성능 개선 프로젝트를 했어요"] },
    { field: "role", op: "set", value: "백엔드 개발", source_message_ids: ["M2"], source_quotes: ["저는 백엔드 개발을 맡았어요"] },
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

  const count = async (table: "experiences" | "educations" | "projects" | "project_details" | "achievements" | "skills") => {
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

  it("profile: read and save only the four columns", async () => {
    const { getProfile, updateProfile } = await career();
    expect((await getProfile()).id).toBe(userId);
    const saved = await updateProfile({ desired_job_title: "백엔드 개발자", total_years_of_experience: 7, interested_industries: ["핀테크"] });
    expect(saved).toMatchObject({ desired_job_title: "백엔드 개발자", total_years_of_experience: 7, interested_industries: ["핀테크"] });
  });

  let experienceId = "";
  let educationId = "";
  let projectId = "";
  let detailId = "";
  let secondDetailId = "";

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

  it("education, project, detail, achievement, skills: every create and edit, status recomputed", async () => {
    const { saveEducation, saveProject, saveProjectDetail, saveAchievement, setProjectSkills, addManualSkill, reorderProjectDetails, getProject, getEducation, getExperience, getProjectDetail, listSkills } = await career();

    const education = await saveEducation(null, { institution_name: "한국대학교", education_type: "degree", start_month: "2015-03-01", end_month: "2019-02-01", enrollment_status: "enrolled" });
    educationId = education.id;
    expect(education).toMatchObject({ status: "complete", end_month: null, enrollment_status: "enrolled" });

    const project = await saveProject(null, { experience_id: experienceId, education_id: null, name: "결제 개선", start_month: "2022-05-01", team_size: 4 });
    projectId = project.id;
    expect(project).toMatchObject({ status: "draft", experience_id: experienceId, education_id: null, team_size: 4 });

    const detail = await saveProjectDetail(projectId, null, { title: "지연 개선", situation: "피크 지연" });
    detailId = detail.id;
    expect(detail).toMatchObject({ project_id: projectId, status: "draft", sort_order: 1 });
    const complete = await saveProjectDetail(projectId, detailId, { title: "지연 개선", situation: "피크 지연", action: "쿼리 개선" });
    expect(complete.status).toBe("complete");

    const withRole = await saveProject(projectId, { experience_id: experienceId, education_id: null, name: "결제 개선", role: "백엔드", start_month: "2022-05-01", team_size: 4 });
    expect(withRole.status).toBe("complete");

    secondDetailId = (await saveProjectDetail(projectId, null, { title: "두 번째" })).id;
    await reorderProjectDetails(projectId, [secondDetailId, detailId]);
    expect((await getProject(projectId))?.details.map((d) => d.id)).toEqual([secondDetailId, detailId]);

    const achievement = await saveAchievement(null, { project_detail_id: detailId, metric_name: "응답 시간", value_before: 1.2, value_after: 0.7, unit: "초" });
    expect(achievement).toMatchObject({ project_detail_id: detailId, status: "complete", value_before: 1.2, value_after: 0.7 });
    const edited = await saveAchievement(achievement.id, { metric_name: "응답 시간", value_before: 1.5, value_after: 0.7, unit: "초" });
    expect(edited).toMatchObject({ id: achievement.id, value_before: 1.5, project_detail_id: detailId });
    const onExperience = await saveAchievement(null, { experience_id: experienceId, description: "연간 장애 0건" });
    expect(onExperience).toMatchObject({ experience_id: experienceId, project_detail_id: null, status: "complete" });

    expect((await setProjectSkills(projectId, ["Node.js", "PostgreSQL"])).map((x) => x.name)).toEqual(["Node.js", "PostgreSQL"]);
    expect(await count("skills")).toBe(2);
    // Same names in another case → same skills; removing the last link of a tag skill deletes it.
    expect((await setProjectSkills(projectId, ["node.js"])).map((x) => x.name)).toEqual(["Node.js"]);
    expect(await count("skills")).toBe(1);
    expect(await addManualSkill("Kafka")).toMatchObject({ name: "Kafka", is_manual: true, user_id: userId });
    expect((await listSkills()).map((x) => [x.name, x.project_count])).toEqual([["Node.js", 1], ["Kafka", 0]]);

    const loaded = await getProject(projectId);
    expect(loaded).toMatchObject({ experience: { id: experienceId }, education: null });
    expect(loaded?.skills.map((x) => x.name)).toEqual(["Node.js"]);
    expect((await getExperience(experienceId))?.achievements.map((a) => a.id)).toEqual([onExperience.id]);
    expect((await getEducation(educationId))?.projects).toEqual([]);
    expect((await getProjectDetail(projectId, detailId))?.detail.achievements.map((a) => a.id)).toEqual([achievement.id]);
    for (const missing of [await getProject("not-a-uuid"), await getExperience(crypto.randomUUID()), await getProjectDetail(projectId, crypto.randomUUID())]) expect(missing).toBeNull();
  });

  it("form save outcomes (W5): conflict comes back with the latest row, a form-invisible bump is rebased, a reversed period stays out of the patch", async () => {
    const { saveExperience, saveProject, saveProjectDetail, getExperience, getProject } = await career();
    const { guardRowSave } = await import("./row-save-guard");
    const { decideConflict, periodPatch } = await import("./row-save");
    const { deleteCareerItem } = await deletion();

    const clientId = crypto.randomUUID();
    const created = await saveExperience(null, { company_name: "두 탭 회사" }, { client_id: clientId });
    const otherTab = await saveExperience(clientId, { company_name: "다른 탭이 고침" }, { expected_updated_at: created.updated_at });

    const stale = await guardRowSave(() => saveExperience(clientId, { company_name: "낡은 탭" }, { expected_updated_at: created.updated_at }), () => getExperience(clientId));
    expect(stale).toMatchObject({ ok: false, reason: "conflict", latest: { id: clientId, company_name: "다른 탭이 고침", updated_at: otherTab.updated_at } });
    // "내 입력으로 저장": the same save on the latest version goes through
    const kept = await guardRowSave(() => saveExperience(clientId, { company_name: "낡은 탭" }, { expected_updated_at: otherTab.updated_at }), () => getExperience(clientId));
    expect(kept).toMatchObject({ ok: true, row: { company_name: "낡은 탭" } });

    // A retried create after the row was edited: a conflict, found through the client id
    const late = await guardRowSave(() => saveExperience(null, { company_name: "늦은 재시도" }, { client_id: clientId }), () => getExperience(clientId));
    expect(late).toMatchObject({ ok: false, reason: "conflict", latest: { company_name: "낡은 탭" } });

    // The inline rule and the contract agree: refused when sent, and left out it saves the other fields
    const reversed = { start_month: "2024-05-01", end_month: "2024-04-01" };
    expect(await guardRowSave(() => saveExperience(clientId, reversed), () => getExperience(clientId))).toEqual({ ok: false, reason: "invalid" });
    expect(await guardRowSave(() => saveExperience(clientId, { company_name: "기간 빼고 저장", ...periodPatch(reversed.start_month, reversed.end_month) }), () => getExperience(clientId))).toMatchObject({
      ok: true,
      row: { company_name: "기간 빼고 저장", start_month: null, end_month: null },
    });

    await deleteCareerItem("experience", clientId);
    expect(await guardRowSave(() => saveExperience(clientId, { company_name: "지운 행" }), () => getExperience(clientId))).toEqual({ ok: false, reason: "gone" });

    // A child's save moves the parent's version without changing what its form shows: not a conflict for the user
    const project = await saveProject(null, { experience_id: null, education_id: null, name: "부모", role: "역할" });
    await saveProjectDetail(project.id, null, { title: "t", situation: "s", action: "a" });
    const bumped = await getProject(project.id);
    expect(bumped?.updated_at).not.toBe(project.updated_at);
    const shown = (r: { name: string | null; role: string | null }) => ({ name: r.name, role: r.role });
    expect(decideConflict({ base: project, latest: bumped!, sent: { name: "내 입력", role: "역할" }, comparable: shown })).toBe("rebase");
    await deleteCareerItem("project", project.id);
  });

  it("S-08 tree: an experience / education with no start month is under undated_entries, with its projects (W2-④)", async () => {
    const { saveExperience, saveEducation, saveProject, getCareerTree } = await career();
    const { deleteCareerItem } = await deletion();
    const exp = await saveExperience(null, { company_name: "시작 월 없는 회사" });
    const edu = await saveEducation(null, { institution_name: "시작 월 없는 학교" });
    const inside = await saveProject(null, { experience_id: exp.id, education_id: null, name: "그 회사 프로젝트" });
    const tree = await getCareerTree();
    expect(tree.undated_entries.find((e) => e.experience?.id === exp.id)).toMatchObject({ kind: "experience", collapsed: false, projects: [expect.objectContaining({ id: inside.id })] });
    expect(tree.undated_entries.find((e) => e.education?.id === edu.id)).toMatchObject({ kind: "education", collapsed: true, projects: [] });
    expect(tree.undated_projects.map((p) => p.id)).not.toContain(inside.id);
    await deleteCareerItem("experience", exp.id, "delete_projects");
    await deleteCareerItem("education", edu.id);
  });

  it("S-08 tree: year view on real rows, including a project dated before its affiliation and the undated bucket", async () => {
    const { saveProject, getCareerTree } = await career();
    const early = await saveProject(null, { experience_id: experienceId, education_id: null, name: "입사 전 파일럿", start_month: "2020-02-01" });
    const standalone = await saveProject(null, { experience_id: null, education_id: null, name: "개인 프로젝트", start_month: "2019-06-01" });
    const undated = await saveProject(null, { experience_id: null, education_id: null, name: "날짜 없음" });
    const tree = await getCareerTree();
    const year = (y: number) => tree.years.find((g) => g.year === y);

    expect(tree.years.map((g) => g.year)).toEqual([...tree.years.map((g) => g.year)].sort((a, b) => b - a));
    expect(year(2022)?.entries.find((e) => e.kind === "experience")).toMatchObject({ collapsed: false, projects: [expect.objectContaining({ id: projectId })] });
    expect(year(2021)?.entries.find((e) => e.kind === "experience")).toMatchObject({ collapsed: true, projects: [] });
    // Outside the job's years: the mock's algorithm would lose this one.
    expect(year(2020)?.entries.find((e) => e.experience?.id === experienceId)?.projects.map((p) => p.id)).toEqual([early.id]);
    expect(year(2019)?.other_projects.map((p) => p.id)).toEqual([standalone.id]);
    expect(tree.undated_projects.map((p) => p.id)).toEqual([undated.id]);
    expect(year(2022)?.entries[0]?.projects[0]?.details.map((d) => d.id)).toEqual([secondDetailId, detailId]);
    expect(tree).toMatchObject({
      is_empty: false,
      skill_count: 2,
      counts: { complete_experiences: 1, complete_educations: 1, complete_projects: 1, complete_project_details: 1 },
      hints: { details_without_result: 2, projects_without_detail: 3 },
      profile: { desired_job_title: "백엔드 개발자" },
    });
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

  it("delete with impact: counts from the RPC; keep_projects / delete_projects; parent status recalculated", async () => {
    const { getDeletionImpact, deleteCareerItem } = await deletion();
    const { getProject, saveProjectDetail, listExperiences, saveExperience, saveProject } = await career();

    const detailImpact = await getDeletionImpact("project_detail", detailId);
    expect(detailImpact.cascade).toMatchObject({ project_details: 0, achievements: 1 }); // the RPC excludes the target itself; C-05 reads only achievements here
    await deleteCareerItem("project_detail", detailId);
    expect((await getProject(projectId))?.status).toBe("draft");
    await saveProjectDetail(projectId, secondDetailId, { title: "두 번째", situation: "상황", action: "행동" });
    expect((await getProject(projectId))?.status).toBe("complete");

    const keep = await getDeletionImpact("experience", experienceId, "keep_projects");
    expect(keep.cascade.projects).toBe(0);
    const del = await getDeletionImpact("experience", experienceId, "delete_projects");
    expect(del.cascade.projects).toBe(2);
    expect(del.affected_results.by_application_project).toEqual([]);

    await deleteCareerItem("experience", experienceId, "keep_projects");
    expect(await getProject(projectId)).toMatchObject({ experience_id: null, experience: null });
    expect(await listExperiences()).toEqual([]);

    const other = await saveExperience(null, { company_name: "다른 회사" });
    const owned = await saveProject(null, { experience_id: other.id, education_id: null, name: "함께 지울 것" });
    await deleteCareerItem("experience", other.id, "delete_projects");
    expect(await getProject(owned.id)).toBeNull();
  });

  // ---------- writing chat ----------

  let chatId = "";

  it("start: fixed greeting, chosen affiliation, not locked without a key; send without a key is refused and stores nothing", async () => {
    const { startWritingChat, sendWritingChatTurn } = await chats();
    const { withAiGuard } = await import("./ai-guard");
    const { saveEducation } = await career();
    const edu = await saveEducation(null, { institution_name: "두 번째 대학" });
    const chat = await startWritingChat({ mode: "new_project", education_id: edu.id });
    chatId = chat.id;
    expect(chat).toMatchObject({ status: "active", message_count: 0, education_id: edu.id, experience_id: null });
    expect(chat.messages.map((m) => [m.sequence, m.role, m.status])).toEqual([[1, "assistant", "done"]]);

    expect(await withAiGuard(() => sendWritingChatTurn(chatId, USER_TEXT))).toMatchObject({ rejected: "key_missing", refusal: "ai_not_connected" });
    const { count: stored } = await admin.from("writing_chat_messages").select("id", { count: "exact", head: true }).eq("writing_chat_id", chatId);
    expect(stored).toBe(1);

    // QA-W5-09: an affiliation that isn't readable (gone / another user's) → not_found and no chat left behind
    const chatsBefore = (await admin.from("writing_chats").select("id", { count: "exact", head: true }).eq("user_id", userId)).count
    for (const args of [{ experience_id: crypto.randomUUID() }, { education_id: crypto.randomUUID() }]) {
      await expect(startWritingChat({ mode: "new_project", ...args })).rejects.toMatchObject({ code: "not_found" })
    }
    await expect(startWritingChat({ mode: "new_project", experience_id: "not-a-uuid" })).rejects.toMatchObject({ code: "invalid_input" })
    expect((await admin.from("writing_chats").select("id", { count: "exact", head: true }).eq("user_id", userId)).count).toBe(chatsBefore)
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

  it("turn through the real route: stand-in message → SSE → stored rows, draft patched, no career row; view rebuilt", async () => {
    const { sendWritingChatTurn, completeWritingChatTurn, getWritingChat } = await chats();
    const { buildChatView } = await import("./writing-chat-view");
    const projects = await count("projects");

    const sent = await sendWritingChatTurn(chatId, USER_TEXT, "situation");
    expect(sent.endpoint).toBe(`/api/writing-chats/${chatId}/turns`);
    expect(sent.body).toMatchObject({ content: USER_TEXT, requestedSlot: { slot: "situation" } });
    expect(sent.message).toMatchObject({ role: "user", content: USER_TEXT, sequence: 2, status: "done" });
    const { count: notYet } = await admin.from("writing_chat_messages").select("id", { count: "exact", head: true }).eq("writing_chat_id", chatId);
    expect(notYet).toBe(1);

    const events = await stream(sent, [{ json: "그때 어떤 상황이었나요?" }], [{ json: firstExtract }]);
    expect(events.map((e) => e.type)).toEqual(["reply_delta", "reply_done", "draft_patch", "draft_flags", "turn_done"]);
    await completeWritingChatTurn(chatId, false);

    const chat = await getWritingChat(chatId);
    expect(chat?.message_count).toBe(2);
    expect(chat?.messages.map((m) => [m.role, m.status])).toEqual([["assistant", "done"], ["user", "done"], ["assistant", "done"]]);
    expect(chat?.messages[2]?.content).toContain("그때 어떤 상황이었나요?");
    expect(chat?.messages[2]).toMatchObject({ provider: "anthropic", model_tier: "default", connection_tier: "paid" });
    expect(chat?.user_message_numbers[chat.messages[1]!.id]).toBe(1);
    expect(chat?.messages.some((m) => m.id === sent.message.id)).toBe(false);
    expect(chat?.structured_draft.project?.name?.value).toBe("결제 승인 API 성능 개선");
    expect(await count("projects")).toBe(projects);

    const view = await buildChatView(chat!);
    expect(view).toMatchObject({ currentSlot: "title", skippedSlots: [], turnFailures: {}, existingDetail: null });
    expect(view.educations.length).toBeGreaterThan(0);
  });

  it("failed reply: real cause in the view; 다시 보내기 through ?retry=1 reuses the row, count unchanged; nothing to retry → null", async () => {
    const { sendWritingChatTurn, retryWritingChatTurn, completeWritingChatTurn, getWritingChat } = await chats();
    const { buildChatView } = await import("./writing-chat-view");

    expect(await retryWritingChatTurn(chatId)).toBeNull();
    const sent = await sendWritingChatTurn(chatId, "결제 실패 문의가 많았어요.");
    const failed = await stream(sent, [{ error: "rate_limited" }], [{ json: output({}) }]);
    expect(failed.at(-1)).toMatchObject({ type: "error", error_code: "rate_limited", provider: "anthropic" });
    await completeWritingChatTurn(chatId, true, "rate_limited");

    const chat = await getWritingChat(chatId);
    expect(chat?.messages.at(-1)).toMatchObject({ role: "assistant", status: "failed" });
    const countAfterFailure = chat!.message_count;
    const view = await buildChatView(chat!);
    expect(view.turnFailures[chat!.messages.at(-1)!.id]).toMatchObject({ error_code: "rate_limited", provider: "anthropic" });
    expect(view.turnFailures[chat!.messages.at(-1)!.id]?.retry_after).not.toBeNull();

    const spec = await retryWritingChatTurn(chatId);
    expect(spec?.endpoint).toBe(`/api/writing-chats/${chatId}/turns?retry=1`);
    const resend = await stream(spec!, [{ json: "어떤 지표를 봤나요?" }], []);
    expect(resend.at(-1)).toMatchObject({ type: "turn_done" });
    const after = await getWritingChat(chatId);
    expect(after?.message_count).toBe(countAfterFailure);
    expect(after?.messages.at(-1)?.status).toBe("done");
    expect(after?.messages.at(-1)?.content).toContain("어떤 지표를 봤나요?");
  });

  it("중단: the abort reaches the route, the row leaves streaming, the job is canceled; the view shows no failure cause; resend works", async () => {
    const { sendWritingChatTurn, retryWritingChatTurn, completeWritingChatTurn, getWritingChat } = await chats();
    const { buildChatView } = await import("./writing-chat-view");
    const sent = await sendWritingChatTurn(chatId, "지표는 응답 시간이었어요.");
    const controller = new AbortController();
    // In-process Response: the abort reaches the route through Request.signal; a browser's reader would also throw AbortError.
    const running = stream(sent, [{ hang: true }], [{ json: output({}) }], controller).catch(() => null);
    await vi.waitFor(async () => {
      const chat = await getWritingChat(chatId);
      expect(chat?.messages.at(-1)?.status).toBe("streaming");
    });
    controller.abort();
    await running;
    await completeWritingChatTurn(chatId, true, "canceled");

    const chat = await getWritingChat(chatId);
    const last = chat!.messages.at(-1)!;
    expect(last.status).toBe("failed");
    const job = await admin.from("ai_jobs").select("status, error_code").eq("id", last.ai_job_id!).single();
    expect(job.data).toMatchObject({ status: "canceled", error_code: "canceled" });
    expect((await buildChatView(chat!)).turnFailures).toEqual({});

    const resend = await stream((await retryWritingChatTurn(chatId))!, [{ json: "좋아요. 결과는요?" }], []);
    expect(resend.at(-1)).toMatchObject({ type: "turn_done" });
  });

  it("preview patches by the screen's index paths: edit (first card created), needs_review accept / reject, achievement, affiliation", async () => {
    const { applyStructuredDraftPatch, setWritingChatAffiliation, getWritingChat, getWritingChatSaveSummary } = await chats();

    const edited = await applyStructuredDraftPatch(chatId, { path: "project.role", action: "edit", value: "백엔드 리드" });
    expect(edited.project?.role).toMatchObject({ value: "백엔드 리드", origin: "user_edit", review: "ok" });

    const card = await applyStructuredDraftPatch(chatId, { path: "details.0.fields.title", action: "edit", value: "피크 지연" });
    expect(card.details?.[0]).toMatchObject({ detail_key: "D1", fields: { title: { value: "피크 지연" } } });
    await applyStructuredDraftPatch(chatId, { path: "details.0.fields.situation", action: "edit", value: "피크 시간 지연" });

    // Fields only the AI can flag: written the way the turn writes them.
    const firstUser = (await getWritingChat(chatId))!.messages.find((m) => m.role === "user")!.id;
    const writer = createAiWriterClient(userId);
    const flagged = await applyDraftPatch(writer, chatId, {
      ops: [
        { op: "set", target: { section: "detail", detail_key: "D1", field: "action" }, value: "쿼리 개선", source_message_ids: [firstUser], source_quotes: ["결제"], review: "needs_review" },
        { op: "set", target: { section: "detail", detail_key: "D1", field: "result" }, value: "지연 감소", source_message_ids: [firstUser], source_quotes: ["결제"], review: "needs_review" },
        { op: "add_achievement", detail: { detail_key: "D1" }, fields: { metric_name: { value: "지연", source_message_ids: [firstUser], source_quotes: ["결제"] } } },
      ],
    });
    expect(flagged.rejected).toEqual([]);

    expect((await getWritingChatSaveSummary(chatId))?.unreviewed).toBe(2);
    const accepted = await applyStructuredDraftPatch(chatId, { path: "details.0.fields.action", action: "accept" });
    expect(accepted.details?.[0]?.fields.action).toMatchObject({ review: "accepted", value: "쿼리 개선" });
    const rejected = await applyStructuredDraftPatch(chatId, { path: "details.0.fields.result", action: "reject" });
    expect(rejected.details?.[0]?.fields.result).toMatchObject({ value: null, review: "ok" });
    const metric = await applyStructuredDraftPatch(chatId, { path: "details.0.achievements.0.metric_name", action: "edit", value: "응답 시간" });
    expect(metric.details?.[0]?.achievements[0]?.metric_name).toMatchObject({ value: "응답 시간", origin: "user_edit" });
    await expect(applyStructuredDraftPatch(chatId, { path: "details.5.fields.title", action: "accept" })).rejects.toMatchObject({ code: "not_found" });

    const noAffiliation = await setWritingChatAffiliation(chatId, { experience_id: null, education_id: null });
    expect(noAffiliation).toMatchObject({ experience_id: null, education_id: null, id: chatId });
    expect("messages" in noAffiliation).toBe(false);
    await setWritingChatAffiliation(chatId, "dismiss_suggestion");
  });

  it("save: summary → career rows, project_id back; the chat turns read-only; a later send is refused", async () => {
    const { getWritingChatSaveSummary, saveWritingChat, sendWritingChatTurn, getWritingChat, abandonWritingChat, resumeWritingChat } = await chats();
    const { getProject } = await career();
    const summary = await getWritingChatSaveSummary(chatId);
    expect(summary).toMatchObject({ project: { kind: "new", name: "결제 승인 API 성능 개선" }, new_details: 1, achievements: 1, unreviewed: 0 });

    const { project_id } = await saveWritingChat(chatId);
    const project = await getProject(project_id);
    expect(project).toMatchObject({ name: "결제 승인 API 성능 개선", role: "백엔드 리드", status: "complete", source_writing_chat_id: chatId });
    expect(project?.details[0]).toMatchObject({ title: "피크 지연", action: "쿼리 개선", result: null, source_writing_chat_id: chatId });
    expect(project?.details[0]?.achievements[0]).toMatchObject({ metric_name: "응답 시간" });
    expect(project?.writing_chats.map((c) => [c.id, c.status])).toEqual([[chatId, "saved"]]);

    expect((await getWritingChat(chatId))?.status).toBe("saved");
    await expect(sendWritingChatTurn(chatId, "더")).rejects.toMatchObject({ code: "writing_chat_not_active" });
    await abandonWritingChat(chatId); // no-op as in the mock
    expect((await getWritingChat(chatId))?.status).toBe("saved");
    expect(await resumeWritingChat(chatId)).toBeNull();
  });

  it("hand-off, return target, abandon → lists → resume, augment first edit, delete the chat only", async () => {
    const { startWritingChat, applyStructuredDraftPatch, handOffWritingChat, abandonWritingChat, resumeWritingChat, listActiveWritingChats, listAbandonedWritingChats, getWritingChat, clearReturnTarget } = await chats();
    const { deleteCareerItem, getDeletionImpact } = await deletion();
    const { getProject, saveProjectDetail, getCareerTree } = await career();

    const handoff = await startWritingChat({ mode: "new_project" });
    await applyStructuredDraftPatch(handoff.id, { path: "project.name", action: "edit", value: "사내 배포 도구" });
    const { project_id } = await handOffWritingChat(handoff.id);
    expect(await getProject(project_id)).toMatchObject({ name: "사내 배포 도구", status: "draft" });

    const impact = await getDeletionImpact("writing_chat", handoff.id);
    expect(impact.writing_chat).toEqual({ message_count: 1, linked_saved_rows: 1 });
    expect(impact.cascade.projects).toBe(0);
    await deleteCareerItem("writing_chat", handoff.id);
    expect(await getWritingChat(handoff.id)).toBeNull();
    expect(await getProject(project_id)).toMatchObject({ name: "사내 배포 도구", source_writing_chat_id: null });

    const applicationProjectId = crypto.randomUUID();
    await createApplicationProject(user, CreateApplicationProjectInput.parse({ id: applicationProjectId, rawText: "결제 서버 개발자를 뽑습니다. ".repeat(10) }));
    const gated = await startWritingChat({ mode: "new_project", return_target: { application_project_id: applicationProjectId, feature: "insight", params: { a: 1 } } });
    expect(gated.return_target).toMatchObject({ application_project_id: applicationProjectId, feature: "insight", params: { a: 1 } });
    await clearReturnTarget(gated.id);
    expect((await getWritingChat(gated.id))?.return_target).toBeNull();

    expect((await listActiveWritingChats()).map((c) => c.id)).toContain(gated.id);
    await abandonWritingChat(gated.id);
    expect((await listActiveWritingChats()).map((c) => c.id)).not.toContain(gated.id);
    expect((await listAbandonedWritingChats()).map((c) => c.id)).toContain(gated.id);
    expect((await getCareerTree()).active_writing_chats.map((c) => c.id)).not.toContain(gated.id);
    expect((await resumeWritingChat(gated.id))?.status).toBe("active");

    const draftDetail = await saveProjectDetail(project_id, null, { title: "보강할 내용" });
    const augment = await startWritingChat({ mode: "augment_project", project_id });
    expect(augment).toMatchObject({ mode: "augment_project", project_id });
    const patched = await applyStructuredDraftPatch(augment.id, { path: "details.0.fields.situation", action: "edit", value: "배포가 느렸다" });
    expect(patched.details?.[0]).toMatchObject({ existing_detail_id: draftDetail.id, fields: { situation: { value: "배포가 느렸다" } } });

    expect(await getWritingChat("not-a-uuid")).toBeNull();
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
      ["updateProfile(null)", () => c.updateProfile(n)],
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
