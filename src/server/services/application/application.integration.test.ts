import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateApplicationProjectInput, ListApplicationProjectsInput } from "@/lib/contracts/application";
import { ProviderError } from "@/server/ai/errors";
import { KO_BACKEND } from "@/server/ai/__fixtures__/AI-01/jds";
import { createAiWriterClient } from "@/server/db/ai-writer";
import type { Database } from "@/server/db/database.types";
import { resetServerEnvCache } from "@/server/env";
import { createRecordingKeyStatusReporter, createStaticKeySource, createStaticProviderContext } from "@/server/jobs/provider-context";
import { createSupabaseJobStore } from "@/server/jobs/supabase-store";
import { createSupabaseUsageStore } from "@/server/jobs/supabase-usage";
import { startWritingChat } from "@/server/services/writing-chat/chat";
import { loadGateRequirements } from "@/server/services/writing-chat/pipelines";
import { productionJdExtractorForTests } from "@/test/jd-extraction-fakes";
import { createScriptedAdapter, scriptedLlmFactory, type ScriptedResponse } from "@/test/job-fakes";
import { hasTable, isStackReady, readLocalSupabase } from "@/test/local-supabase";
import { createJdExtractionDb } from "./db";
import type { JdExtractionDeps } from "./extraction";
import { runJdExtraction } from "./extraction-response";
import { getApplicationHub, getBoard, getJdView, listApplicationProjects } from "./read";
import { createApplicationProject, deleteApplicationProject, moveApplicationStage, setApplicationOutcome, updateApplicationProject } from "./write";

/**
 * S5 end-to-end against the local stack: create (no key → default / user
 * names, shouldExtract false) → sync extraction (real AI-01 pipeline,
 * scripted provider, real begin/apply RPCs) → name / requirements / badge →
 * 409 already_extracted → stage moves + history → board / list / hub → R-31
 * gate requirements + chat start ownership → delete (cascade, usage kept with
 * null project, late usage insert of the deleted project kept). Skips when
 * the stack isn't running or S5 isn't migrated.
 */

const stack = readLocalSupabase();
const ready = stack ? (await isStackReady(stack)) && (await hasTable(stack, "application_projects")) : false;

type Client = SupabaseClient<Database>;
const FAKE_KEY = "sk-ant-FAKE-integration-key-0000";

describe.skipIf(!ready)("application projects & JD (local stack)", () => {
  const s = stack!;
  let admin: Client;
  let user: Client;
  let otherUser: Client;
  let userId = "";
  let otherId = "";
  const logs: string[] = [];
  const responses: ScriptedResponse[] = [];

  function extractionDeps(): JdExtractionDeps {
    const writer = createAiWriterClient(userId);
    const adapter = createScriptedAdapter("anthropic", [...responses], Date.now);
    responses.length = 0;
    const log = (event: string, fields: Record<string, unknown>) => void logs.push(JSON.stringify({ event, ...fields }));
    return {
      userId,
      jds: createJdExtractionDb(user, writer),
      store: createSupabaseJobStore(writer),
      usage: createSupabaseUsageStore(writer),
      providerContext: createStaticProviderContext({ provider: "anthropic", connectionTier: "paid", keyStatus: "valid" }),
      keySource: createStaticKeySource(FAKE_KEY, () => new ProviderError("key_missing")),
      keyStatus: createRecordingKeyStatusReporter(),
      runGate: null,
      createLlm: (input) => scriptedLlmFactory(adapter.adapter, Date.now)(input),
      extract: productionJdExtractorForTests,
      log,
    };
  }

  async function newUser(prefix: string): Promise<{ id: string; client: Client }> {
    const email = `${prefix}-${crypto.randomUUID()}@example.test`;
    const password = `pw-${crypto.randomUUID()}`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.code}`);
    const client = createClient<Database>(s.url, s.anonKey, { auth: { persistSession: false } });
    const signIn = await client.auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error(`signIn failed: ${signIn.error.code}`);
    return { id: data.user.id, client };
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
    ({ id: userId, client: user } = await newUser("app"));
    ({ id: otherId, client: otherUser } = await newUser("app-other"));
  });

  afterAll(async () => {
    for (const id of [userId, otherId]) {
      if (!id) continue;
      await admin.from("ai_usage_records").delete().eq("user_id", id);
      await admin.from("ai_jobs").delete().eq("user_id", id);
      await admin.auth.admin.deleteUser(id);
    }
    resetServerEnvCache();
  });

  const projectA = crypto.randomUUID();
  const projectB = crypto.randomUUID();

  it("create without a key: default name, raw text + sentences stored, no extraction; idempotent retry", async () => {
    const created = await createApplicationProject(user, CreateApplicationProjectInput.parse({ id: projectA, rawText: KO_BACKEND.raw }));
    expect(created).toMatchObject({ applicationProjectId: projectA, nameSource: "default", extractionStatus: "pending", shouldExtract: false, created: true });
    expect(created.name).toMatch(/^새 기업 JD \(\d{4}-\d{2}-\d{2}\)$/);
    expect(created.warnings).toEqual([]);

    const again = await createApplicationProject(user, CreateApplicationProjectInput.parse({ id: projectA, rawText: "다른 원문" }));
    expect(again).toMatchObject({ applicationProjectId: projectA, created: false });

    const view = await getJdView(user, projectA);
    expect(view.rawText).toBe(KO_BACKEND.raw);
    expect(view.sentences).toHaveLength(13);
    for (const sentence of view.sentences) expect(view.rawText.slice(sentence.start, sentence.end)).toBe(sentence.text);
    expect(view.requirements).toEqual([]);
    expect(view.extractedBy).toBeNull();
  });

  it("create with company + position and no key: '회사명 – 포지션명' (user); short JD warning", async () => {
    const created = await createApplicationProject(
      user,
      CreateApplicationProjectInput.parse({ id: projectB, rawText: "짧은 공고", companyName: "가나다랩", positionTitle: "데이터 엔지니어", deadline: "2026-12-01" }),
    );
    expect(created).toMatchObject({ name: "가나다랩 – 데이터 엔지니어", nameSource: "user", warnings: ["short_jd"] });
  });

  it("other users cannot read or touch the project (RLS)", async () => {
    await expect(getJdView(otherUser, projectA)).rejects.toMatchObject({ code: "not_found" });
    await expect(moveApplicationStage(otherUser, { id: projectA, toStage: "document" })).rejects.toMatchObject({ code: "not_found" });
    await expect(deleteApplicationProject(otherUser, projectA)).rejects.toMatchObject({ code: "not_found" });
    await expect(startWritingChat(otherUser, { mode: "new_project", returnTarget: { applicationProjectId: projectA, feature: "insight", params: {} } })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("sync extraction: requirements stored, name replaced (default → ai), badge, one usage row; then 409", async () => {
    responses.push({ json: KO_BACKEND.output });
    const res = await runJdExtraction(user, extractionDeps(), projectA);
    expect(res.status).toBe("succeeded");
    if (res.status !== "succeeded") throw new Error("unreachable");
    expect(res.jd.extractionStatus).toBe("succeeded");
    expect(res.jd.requirements).toHaveLength(6);
    expect(res.jd.requirements[0]).toMatchObject({ category: "responsibility", origin: "ai", isUserEdited: false, sourceSids: ["S4"] });
    expect(res.jd.companyName).toBe("에이비씨페이");
    expect(res.jd.companyNameSource).toBe("ai");
    expect(res.jd.isLikelyJd).toBe(true);
    expect(res.jd.seniority?.minYears).toBe(5);
    expect(res.jd.extractedBy?.provider).toBe("anthropic");
    expect(res.jd.techKeywords.map((k) => k.keyword)).toContain("Kafka");

    const hub = await getApplicationHub(user, projectA);
    expect(hub).toMatchObject({ name: "에이비씨페이 – 백엔드 엔지니어 (결제)", nameSource: "ai", stage: "before_apply" });
    expect(hub.jd.requirementCount).toBe(6);

    const job = await admin.from("ai_jobs").select("status, job_type, application_project_id, model_tier").eq("id", res.jobId).single();
    expect(job.data).toMatchObject({ status: "succeeded", job_type: "jd_extraction", application_project_id: projectA, model_tier: "light" });
    const usage = await admin.from("ai_usage_records").select("feature, outcome, application_project_id").eq("ai_job_id", res.jobId);
    expect(usage.data).toEqual([{ feature: "jd_extraction", outcome: "succeeded", application_project_id: projectA }]);

    await expect(runJdExtraction(user, extractionDeps(), projectA)).rejects.toMatchObject({ code: "already_extracted", status: 409 });
    // C-7: no JD text and no key in logs.
    const all = logs.join("\n");
    expect(all).not.toContain("결제 승인·정산");
    expect(all).not.toContain("FAKE-integration");
  });

  it("failed extraction keeps the raw text and reports the failure; the same route retries", async () => {
    responses.push({ error: "key_invalid" });
    const res = await runJdExtraction(user, extractionDeps(), projectB);
    expect(res).toMatchObject({ status: "failed", error: { code: "key_invalid", category: "user_account", failureCause: "key_invalid", retryable: true } });
    expect(res.jd.extractionStatus).toBe("failed");
    expect(res.jd.rawText).toBe("짧은 공고");
    expect(res.jd.lastFailure).toMatchObject({ code: "key_invalid", jobId: res.jobId });
  });

  it("stage moves: interview prompt, closed + outcome, leaving closed clears it, history kept", async () => {
    const toInterview = await moveApplicationStage(user, { id: projectA, toStage: "job_interview" });
    expect(toInterview).toMatchObject({ stage: "job_interview", changed: true, interviewPrompt: { interviewType: "job", inProgressSessionId: null } });
    const same = await moveApplicationStage(user, { id: projectA, toStage: "job_interview" });
    expect(same).toMatchObject({ changed: false });

    await expect(moveApplicationStage(user, { id: projectA, toStage: "document", outcome: "passed" })).rejects.toMatchObject({ code: "invalid_outcome" });
    await expect(setApplicationOutcome(user, { id: projectA, outcome: "passed" })).rejects.toMatchObject({ code: "not_closed", status: 409 });

    const closed = await moveApplicationStage(user, { id: projectA, toStage: "closed", outcome: "passed" });
    expect(closed).toMatchObject({ stage: "closed", stageOutcome: "passed", interviewPrompt: null });
    const cleared = await setApplicationOutcome(user, { id: projectA, outcome: null });
    expect(cleared).toMatchObject({ stageOutcome: null, changed: true });
    await setApplicationOutcome(user, { id: projectA, outcome: "failed" });
    const back = await moveApplicationStage(user, { id: projectA, toStage: "document" });
    expect(back).toMatchObject({ stage: "document", stageOutcome: null });

    const events = await user.from("application_stage_events").select("event_type, from_stage, to_stage, from_outcome, to_outcome").eq("application_project_id", projectA).order("created_at");
    expect(events.data?.map((e) => e.event_type)).toEqual(["created", "stage_changed", "stage_changed", "outcome_changed", "outcome_changed", "stage_changed"]);
    expect(events.data?.at(-1)).toMatchObject({ from_stage: "closed", to_stage: "document", from_outcome: "failed", to_outcome: null });
  });

  it("board / list / update: six columns, counts, sort, inline edit", async () => {
    const board = await getBoard(user);
    expect(board.columns.map((c) => c.stage)).toEqual(["before_apply", "document", "assignment", "job_interview", "culture_fit_interview", "closed"]);
    expect(board.total).toBe(2);
    expect(board.columns.find((c) => c.stage === "document")!.cards.map((c) => c.id)).toEqual([projectA]);
    expect(board.columns[0]!.cards[0]!.progress).toEqual({ insight: "none", draftCount: 0, interviewCount: 0, interviewInProgress: false });

    const byDeadline = await listApplicationProjects(user, ListApplicationProjectsInput.parse({ sort: "deadline" }));
    expect(byDeadline.map((p) => p.id)).toEqual([projectB, projectA]);
    const filtered = await listApplicationProjects(user, ListApplicationProjectsInput.parse({ stage: "document" }));
    expect(filtered.map((p) => p.id)).toEqual([projectA]);

    const updated = await updateApplicationProject(user, { id: projectA, name: "내가 붙인 이름", memo: "메모" });
    expect(updated).toMatchObject({ name: "내가 붙인 이름", nameSource: "user", memo: "메모" });
  });

  it("R-31: gate requirements for the reply call (high first, then weak evidence), via app_ai_writer", async () => {
    const picked = await loadGateRequirements(createAiWriterClient(userId), projectA);
    expect(picked.length).toBeGreaterThan(0);
    expect(picked.length).toBeLessThanOrEqual(8);
    expect(picked[0]!.reason).toBe("high");
    expect(await loadGateRequirements(createAiWriterClient(userId), projectB)).toEqual([]);
    // Another user's project is invisible to this user's writer.
    expect(await loadGateRequirements(createAiWriterClient(otherId), projectA)).toEqual([]);
    const { writingChatId } = await startWritingChat(user, { mode: "new_project", returnTarget: { applicationProjectId: projectA, feature: "insight", params: {} } });
    expect(writingChatId).toBeTruthy();
  });

  it("QA-S5-01: symbol-only raw text is saved (0 sentences); extraction ends not_a_jd with no provider call", async () => {
    const id = crypto.randomUUID();
    const created = await createApplicationProject(user, CreateApplicationProjectInput.parse({ id, rawText: "----\n• • •" }));
    expect(created).toMatchObject({ applicationProjectId: id, extractionStatus: "pending", created: true });
    expect((await getJdView(user, id)).sentences).toEqual([]);

    responses.push({ json: KO_BACKEND.output }); // must stay unused
    const res = await runJdExtraction(user, extractionDeps(), id);
    expect(res).toMatchObject({ status: "failed", error: { code: "not_a_jd", category: "input", retryable: false } });
    expect(res.jd.extractionStatus).toBe("failed");
    expect(res.jd.lastFailure).toMatchObject({ code: "not_a_jd", jobId: res.jobId });
    const usage = await admin.from("ai_usage_records").select("id").eq("ai_job_id", res.jobId!);
    expect(usage.data).toEqual([]);
    await deleteApplicationProject(user, id);
  });

  it("QA-S5-02: a run that died (job closed as stalled) leaves the JD failed with lastFailure = stalled", async () => {
    const id = crypto.randomUUID();
    await createApplicationProject(user, CreateApplicationProjectInput.parse({ id, rawText: KO_BACKEND.raw }));
    const writer = createAiWriterClient(userId);
    const store = createSupabaseJobStore(writer);
    const jd = await user.from("job_descriptions").select("id").eq("application_project_id", id).single();
    const jobId = crypto.randomUUID();
    await store.insert({
      id: jobId,
      userId,
      jobType: "jd_extraction",
      applicationProjectId: id,
      targetType: "job_description",
      targetId: jd.data!.id,
      provider: "anthropic",
      modelTier: "light",
      connectionTier: "paid",
      params: {},
      inputHash: null,
      promptVersion: null,
      model: null,
      progress: { stage: "extract", done: 0, total: 1 },
      meta: { runBase: 1, waitBase: 0, retries: {} },
    });
    const claimed = await store.claim(jobId, { now: new Date().toISOString(), staleBefore: new Date(Date.now() + 1000).toISOString() });
    await createJdExtractionDb(user, writer).begin(jd.data!.id, jobId);
    expect((await getJdView(user, id)).extractionStatus).toBe("running");

    // The function died; the stalled sweep (or any non-success end) closes the job.
    expect(await store.finish(jobId, claimed!.runGeneration, { status: "failed", errorCode: "stalled", finishedAt: new Date().toISOString(), nextRunAt: null })).toBe(true);

    const view = await getJdView(user, id);
    expect(view.extractionStatus).toBe("failed");
    expect(view.lastFailure).toMatchObject({ code: "stalled", category: "system", retryable: true, jobId });
    const listed = (await listApplicationProjects(user, ListApplicationProjectsInput.parse({}))).find((p) => p.id === id)!;
    expect(listed.extractionStatus).toBe("failed");
    expect(listed.lastExtractionFailure).toMatchObject({ code: "stalled", jobId });
    const hub = await getApplicationHub(user, id);
    expect(hub.lastExtractionFailure?.code).toBe("stalled");

    // The same route recovers it.
    responses.push({ json: KO_BACKEND.output });
    expect((await runJdExtraction(user, extractionDeps(), id)).status).toBe("succeeded");
    expect((await getApplicationHub(user, id)).lastExtractionFailure).toBeNull();
    await deleteApplicationProject(user, id);
  });

  it("delete: in-flight job cancel requested, cascade, usage kept with null project; late usage insert kept", async () => {
    const writer = createAiWriterClient(userId);
    const store = createSupabaseJobStore(writer);
    const jd = await user.from("job_descriptions").select("id").eq("application_project_id", projectB).single();
    const inflight = crypto.randomUUID();
    await store.insert({
      id: inflight,
      userId,
      jobType: "jd_extraction",
      applicationProjectId: projectB,
      targetType: "job_description",
      targetId: jd.data!.id,
      provider: "anthropic",
      modelTier: "light",
      connectionTier: "paid",
      params: {},
      inputHash: null,
      promptVersion: null,
      model: null,
      progress: { stage: "extract", done: 0, total: 1 },
      meta: { runBase: 1, waitBase: 0, retries: {} },
    });
    const usageBefore = await admin.from("ai_usage_records").select("id").eq("application_project_id", projectB);
    expect(usageBefore.data!.length).toBeGreaterThan(0);

    const res = await deleteApplicationProject(user, projectB);
    expect(res).toEqual({ applicationProjectId: projectB, canceledJobs: 1 });

    expect((await admin.from("ai_jobs").select("id").eq("application_project_id", projectB)).data).toEqual([]);
    expect((await admin.from("job_descriptions").select("id").eq("application_project_id", projectB)).data).toEqual([]);
    expect((await admin.from("application_stage_events").select("id").eq("application_project_id", projectB)).data).toEqual([]);
    const kept = await admin.from("ai_usage_records").select("id, application_project_id").in("id", usageBefore.data!.map((u) => u.id));
    expect(kept.data!.every((u) => u.application_project_id === null)).toBe(true);

    // A runner that finishes its call after the delete still records the call (FK → null project).
    const usage = createSupabaseUsageStore(writer);
    await usage.insert({
      occurredAt: new Date().toISOString(),
      feature: "jd_extraction",
      jobType: "jd_extraction",
      aiJobId: inflight,
      callKey: "jd_extraction",
      applicationProjectId: projectB,
      provider: "anthropic",
      model: "claude-haiku-5-5",
      modelTier: "light",
      connectionTier: "paid",
      usage: { inputTokens: 10, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 5, reasoningTokens: null, usageSource: "provider_reported" },
      outcome: "failed",
      errorCode: "canceled",
      priceTableVersion: "unpriced",
      estimatedCostUsd: 0,
    });
    const late = await admin.from("ai_usage_records").select("application_project_id").eq("ai_job_id", inflight);
    expect(late.data).toEqual([{ application_project_id: null }]);

    await expect(deleteApplicationProject(user, projectB)).rejects.toMatchObject({ code: "not_found" });
  });
});
