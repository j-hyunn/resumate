import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateApplicationProjectInput } from "@/lib/contracts/application";
import { SaveAchievementInput, SaveExperienceInput, SaveProjectDetailInput, SaveProjectInput } from "@/lib/contracts/career";
import { KO_BACKEND } from "@/server/ai/__fixtures__/AI-01/jds";
import { ProviderError } from "@/server/ai/errors";
import type { Llm } from "@/server/ai/llm";
import { silentAiLogger } from "@/server/ai/log";
import type { InsightContext } from "@/server/ai/pipelines/AI-02";
import type { ProviderAdapter } from "@/server/ai/providers/types";
import type { Ai02MatchOutput, Ai02SynthesisOutput } from "@/server/ai/schemas/AI-02";
import { createAiWriterClient } from "@/server/db/ai-writer";
import type { Database } from "@/server/db/database.types";
import { resetServerEnvCache } from "@/server/env";
import { createRecordingKeyStatusReporter, createStaticKeySource, createStaticProviderContext } from "@/server/jobs/provider-context";
import { createJobRunner } from "@/server/jobs/runner";
import { createSupabaseJobStore } from "@/server/jobs/supabase-store";
import { createSupabaseUsageStore } from "@/server/jobs/supabase-usage";
import { createJdExtractionDb } from "@/server/services/application/db";
import { ensureJdExtracted } from "@/server/services/application/extraction";
import { loadProgress } from "@/server/services/application/read";
import { createApplicationProject, deleteApplicationProject } from "@/server/services/application/write";
import { getDeletionImpact, saveAchievement, saveExperience, saveProject, saveProjectDetail } from "@/server/services/career";
import { productionJdExtractorForTests } from "@/test/jd-extraction-fakes";
import { createScriptedAdapter, scriptedLlmFactory, type ScriptedResponse } from "@/test/job-fakes";
import { hasTable, isStackReady, readLocalSupabase } from "@/test/local-supabase";
import { createInsightStore, loadInsightInputs } from "./db";
import { createInsightJobDefinition } from "./job";
import { insightJobPartial } from "./partial";
import { createAi02InsightPipeline } from "./pipeline";
import { getInsight } from "./read";
import { startInsight } from "./start";

/**
 * S6 end-to-end against the local stack (S6 plan API 7 "로컬 DB 통합"):
 * start (readiness, gate) → job: prepare extracts the JD first (D-30) →
 * match → synthesize → complete_insight (evidence_links) → read with chips →
 * input_hash reuse → career edit → stale + "변경됨" chip → regenerate swaps
 * latest → deletion impact counts insights → RLS → project delete cascades.
 * Real AI-01 / AI-02 pipelines, scripted provider (model outputs built from
 * the same context the job builds). Skips without the stack or S6 tables.
 */

const stack = readLocalSupabase();
const ready = stack ? (await isStackReady(stack)) && (await hasTable(stack, "insights")) : false;

type Client = SupabaseClient<Database>;
const FAKE_KEY = "sk-ant-FAKE-insight-integration-0000";
type Lazy = ScriptedResponse | (() => Promise<ScriptedResponse>);

/** Scripted adapter whose responses may be computed at call time (outputs depend on the DB context). */
function lazyAdapter(queue: Lazy[]): ProviderAdapter {
  const one = async (): Promise<ProviderAdapter> => {
    const next = queue.shift();
    if (!next) throw new Error("lazy adapter: no response left");
    const response = typeof next === "function" ? await next() : next;
    return createScriptedAdapter("anthropic", [response], Date.now).adapter;
  };
  return {
    id: "anthropic",
    async *stream(call) {
      yield* (await one()).stream(call);
    },
    async complete(call) {
      return (await one()).complete(call);
    },
    verify: async () => ({ ok: true, usage: { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: null, usageSource: "provider_reported" } }),
  };
}

describe.skipIf(!ready)("insights (local stack)", () => {
  const s = stack!;
  let admin: Client;
  let user: Client;
  let otherUser: Client;
  let userId = "";
  let otherId = "";
  const logs: string[] = [];
  const queue: Lazy[] = [];
  const pipeline = createAi02InsightPipeline(silentAiLogger);
  const project = crypto.randomUUID();
  const ids = { experience: crypto.randomUUID(), project: crypto.randomUUID(), detail: crypto.randomUUID(), achievement: crypto.randomUUID() };
  const ACTION = "결제 승인 API의 병목 쿼리를 찾아 인덱스를 재설계했다";

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

  /** The context the job will build (same rows, same builder). */
  async function context(): Promise<InsightContext> {
    const inputs = await loadInsightInputs(createAiWriterClient(userId), project);
    if (!inputs) throw new Error("JD not extracted");
    return pipeline.buildContext(inputs);
  }

  function matchResponse(): () => Promise<ScriptedResponse> {
    return async () => {
      const ctx = await context();
      const det = ctx.aliases.aliasOf("project_detail", ids.detail)!;
      const ach = ctx.aliases.aliasOf("achievement", ids.achievement)!;
      const output: Ai02MatchOutput = {
        schema_version: 1,
        matches: ctx.requirements.map((r, i) =>
          i === 0
            ? {
                requirement_ref: r.ref,
                status: "met" as const,
                rationale: "결제 승인 API를 직접 개선한 행동이 있습니다.",
                missing_aspect: null,
                evidence: [
                  { source_type: "project_detail" as const, ref: det, field: "action", quote: ACTION },
                  { source_type: "achievement" as const, ref: ach, field: "metric", quote: null },
                ],
              }
            : { requirement_ref: r.ref, status: "no_evidence" as const, rationale: "근거 없음", missing_aspect: "관련 경험", evidence: [] },
        ),
      };
      return { json: output };
    };
  }

  function synthesisResponse(): () => Promise<ScriptedResponse> {
    return async () => {
      const ctx = await context();
      const det = ctx.aliases.aliasOf("project_detail", ids.detail)!;
      const prj = ctx.aliases.aliasOf("project", ids.project)!;
      const sentence = [...ctx.aliases.values()].find((e) => e.sourceType === "jd_sentence")!.alias;
      const [req1, req2] = ctx.requirements;
      const output: Ai02SynthesisOutput = {
        schema_version: 1,
        strengths: [
          {
            title: "결제 승인 API 개선",
            description: "결제 승인 API의 병목을 직접 찾아 개선한 경험이 핵심 업무와 맞닿습니다.",
            requirement_refs: [req1!.ref],
            evidence: [{ source_type: "project_detail", ref: det, field: "action", quote: ACTION }],
          },
        ],
        gaps: [
          {
            requirement_refs: [req2!.ref],
            gap_kind: "no_evidence",
            description: "관련 경험이 입력된 데이터에서 확인되지 않습니다.",
            actions: [{ type: "add_data", text: "관련 프로젝트가 있다면 추가해 주세요.", evidence: [] }],
            evidence: [{ source_type: "jd_sentence", ref: sentence, field: null, quote: null }],
          },
        ],
        strategy: {
          positioning: "결제 API 성능을 직접 개선해 온 백엔드 엔지니어로 포지셔닝합니다.",
          positioning_evidence: [{ source_type: "project_detail", ref: det, field: "action", quote: ACTION }],
          project_priorities: [{ rank: 1, ref: prj, reason: "결제 승인 업무와 가장 직접 연결됩니다.", requirement_refs: [req1!.ref] }],
        },
      };
      return { json: output };
    };
  }

  function harness() {
    const scheduled: (() => Promise<void>)[] = [];
    const adapter = lazyAdapter(queue);
    const createLlm = (input: Parameters<ReturnType<typeof scriptedLlmFactory>>[0]): Llm => scriptedLlmFactory(adapter, Date.now)(input);
    const keySource = createStaticKeySource(FAKE_KEY, () => new ProviderError("key_missing"));
    const providerContext = createStaticProviderContext({ provider: "anthropic", connectionTier: "paid", keyStatus: "valid" });
    const log = (event: string, fields: Record<string, unknown>) => void logs.push(JSON.stringify({ event, ...fields }));
    const definition = createInsightJobDefinition({
      pipeline,
      storeFor: createInsightStore,
      ensureJd: (ctx, id) =>
        ensureJdExtracted(
          {
            userId: ctx.userId,
            jds: createJdExtractionDb(ctx.db, ctx.db),
            store: createSupabaseJobStore(ctx.db),
            usage: createSupabaseUsageStore(ctx.db),
            providerContext: createStaticProviderContext({ provider: ctx.provider, connectionTier: ctx.connectionTier, keyStatus: "valid" }),
            keySource,
            keyStatus: createRecordingKeyStatusReporter(),
            runGate: null,
            createLlm,
            extract: productionJdExtractorForTests,
            log,
          },
          id,
          { signal: ctx.signal },
        ),
      log,
    });
    const runner = createJobRunner<Llm>({
      forUser: (uid) => {
        const db = createAiWriterClient(uid);
        return { db, store: createSupabaseJobStore(db), usage: createSupabaseUsageStore(db), keySource, keyStatus: createRecordingKeyStatusReporter() };
      },
      providerContext,
      createLlm,
      settleLlm: (llm, ms) => llm.settle(ms),
      getDefinition: (t) => (t === "insight" ? definition : undefined),
      schedule: (task) => void scheduled.push(task),
      continueJob: async () => {},
      log,
    });
    const start = (client: Client, uid: string, id: string, regenerate = false) =>
      startInsight({ userId: uid, user: client, providerContext, runner, pipeline }, id, { regenerate });
    async function drain() {
      while (scheduled.length) await scheduled.shift()!();
    }
    return { runner, start, drain };
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
    ({ id: userId, client: user } = await newUser("insight"));
    ({ id: otherId, client: otherUser } = await newUser("insight-other"));
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

  let firstInsightId = "";
  let failedJobId = "";

  it("readiness gate: no complete career → insufficient_data, no job", async () => {
    await createApplicationProject(user, CreateApplicationProjectInput.parse({ id: project, rawText: KO_BACKEND.raw }));
    const h = harness();
    const out = await h.start(user, userId, project);
    expect(out.kind).toBe("insufficient_data");
    const jobs = await admin.from("ai_jobs").select("id").eq("user_id", userId);
    expect(jobs.data).toEqual([]);
  });

  it("first run: D-30 extraction in prepare → match → synthesize → ready insight with evidence", async () => {
    await saveExperience(user, SaveExperienceInput.parse({ id: ids.experience, companyName: "알파", startMonth: "2021-03", jobPosition: "백엔드", isCurrent: true }));
    await saveProject(user, SaveProjectInput.parse({ id: ids.project, affiliation: { type: "experience", id: ids.experience }, name: "결제 개선", role: "리드", startMonth: "2024-02" }));
    await saveProjectDetail(user, SaveProjectDetailInput.parse({ id: ids.detail, projectId: ids.project, title: "응답 속도", situation: "피크 시간 응답이 느렸다", action: ACTION }));
    await saveAchievement(
      user,
      SaveAchievementInput.parse({ id: ids.achievement, target: { type: "project_detail", id: ids.detail }, metricName: "p95", valueBefore: 800, valueAfter: 200, unit: "ms" }),
    );

    queue.push({ json: KO_BACKEND.output }, matchResponse(), synthesisResponse());
    const h = harness();
    const out = await h.start(user, userId, project);
    expect(out).toMatchObject({ kind: "started", data: { reused: false, inProgress: false } });
    if (out.kind !== "started" || out.data.reused) throw new Error("unreachable");
    const jobId = out.data.jobId;
    await h.drain();
    expect(queue).toHaveLength(0);

    const job = await admin.from("ai_jobs").select("status, job_type, target_type, target_id, model_tier, input_hash, error_code").eq("id", jobId).single();
    expect(job.data).toMatchObject({ status: "succeeded", job_type: "insight", target_type: "application_project", target_id: project, model_tier: "default" });
    // The extraction ran as its own jd_extraction job (usage meter "요건 추출").
    const extraction = await admin.from("ai_jobs").select("status").eq("user_id", userId).eq("job_type", "jd_extraction");
    expect(extraction.data).toEqual([{ status: "succeeded" }]);
    const usage = await admin.from("ai_usage_records").select("feature, call_key, outcome").eq("user_id", userId).order("occurred_at");
    expect(usage.data!.map((u) => u.feature)).toEqual(["jd_extraction", "insight", "insight"]);
    expect(usage.data!.filter((u) => u.feature === "insight").map((u) => u.call_key).sort()).toEqual(["insight.match.1", "insight.synthesize"]);

    const rows = await admin.from("insights").select("id, version_no, status, is_latest, input_hash, ai_job_id").eq("application_project_id", project);
    expect(rows.data).toHaveLength(1);
    expect(rows.data![0]).toMatchObject({ version_no: 1, status: "ready", is_latest: true, ai_job_id: jobId });
    firstInsightId = rows.data![0]!.id;
    const links = await admin.from("evidence_links").select("item_key, source_type").eq("owner_type", "insight").eq("owner_id", firstInsightId);
    expect(links.data!.length).toBeGreaterThanOrEqual(4);
    expect(links.data!.map((l) => l.source_type)).toEqual(expect.arrayContaining(["project_detail", "achievement", "jd_sentence"]));

    // S-16 partial from the job's match checkpoint.
    const record = await createSupabaseJobStore(createAiWriterClient(userId)).get(jobId);
    expect(insightJobPartial(record!)).toMatchObject({ kind: "insight_matches", batchesDone: 1, batchesTotal: 1 });

    // C-7: no career / JD text and no key in logs.
    const all = logs.join("\n");
    expect(all).not.toContain(ACTION);
    expect(all).not.toContain(FAKE_KEY);
  });

  it("read: matches with requirement contents, evidence chips, provider badge, not stale; progress ready", async () => {
    const view = await getInsight(user, { applicationProjectId: project }, { pipeline });
    expect(view.extractionStatus).toBe("succeeded");
    expect(view.requirements).toHaveLength(6);
    expect(view.activeJob).toBeNull();
    expect(view.lastFailure).toBeNull();
    const insight = view.insight!;
    expect(insight).toMatchObject({ id: firstInsightId, versionNo: 1, provider: "anthropic", modelTier: "default", connectionTier: "paid", stale: false });
    expect(insight.requirementMatches).toHaveLength(6);
    const met = insight.requirementMatches.find((m) => m.status === "met")!;
    expect(met.requirement?.content).toBeTruthy();
    expect(met.evidence.map((c) => c.kindLabel)).toEqual(expect.arrayContaining(["상세 내용 · 행동", "정량 성과"]));
    expect(met.evidence.every((c) => c.state === "current")).toBe(true);
    expect(insight.strengths).toHaveLength(1);
    expect(insight.gaps[0]!.actions[0]).toMatchObject({ type: "add_data" });
    expect(insight.gaps[0]!.actions[0]!.relatedRequirementIds).toHaveLength(1);
    expect(insight.gaps[0]!.evidence[0]).toMatchObject({ sourceType: "jd_sentence", state: "current" });
    expect(insight.strategy.projectPriorities[0]).toMatchObject({ projectId: ids.project, projectName: "결제 개선" });

    const progress = await loadProgress(user, [project]);
    expect(progress.get(project)?.insight).toBe("ready");
  });

  it("same input again → reused (no job, no usage); other user → not_found", async () => {
    const before = await admin.from("ai_usage_records").select("id").eq("user_id", userId);
    const h = harness();
    const out = await h.start(user, userId, project);
    expect(out).toEqual({ kind: "started", data: { reused: true, insightId: firstInsightId, jobId: null, inProgress: false } });
    const after = await admin.from("ai_usage_records").select("id").eq("user_id", userId);
    expect(after.data).toHaveLength(before.data!.length);

    await expect(getInsight(otherUser, { applicationProjectId: project }, { pipeline })).rejects.toMatchObject({ code: "not_found" });
    await expect(h.start(otherUser, otherId, project)).rejects.toMatchObject({ code: "not_found" });
  });

  it("career edit → stale (F-P2-07) and the chip shows 변경됨; regenerate swaps latest", async () => {
    await saveProjectDetail(user, SaveProjectDetailInput.parse({ id: ids.detail, result: "응답 시간이 줄었다" }));
    const view = await getInsight(user, { applicationProjectId: project }, { pipeline });
    expect(view.insight).toMatchObject({ stale: true, staleReasons: { career: true, requirements: false } });
    const met = view.insight!.requirementMatches.find((m) => m.status === "met")!;
    expect(met.evidence.find((c) => c.sourceType === "project_detail")?.state).toBe("changed");

    queue.push(matchResponse(), synthesisResponse());
    const h = harness();
    const out = await h.start(user, userId, project, true);
    if (out.kind !== "started" || out.data.reused) throw new Error("expected a job");
    await h.drain();
    const rows = await admin.from("insights").select("id, version_no, is_latest, status").eq("application_project_id", project).order("version_no");
    expect(rows.data!.map((r) => [r.version_no, r.is_latest, r.status])).toEqual([
      [1, false, "ready"],
      [2, true, "ready"],
    ]);
    const latest = await getInsight(user, { applicationProjectId: project }, { pipeline });
    expect(latest.insight).toMatchObject({ versionNo: 2, stale: false });
    const old = await getInsight(user, { applicationProjectId: project, version: 1 }, { pipeline });
    expect(old.insight?.versionNo).toBe(1);
  });

  it("a failed run: generating row → failed (trigger), C-20 failure shown, latest result kept", async () => {
    queue.push({ error: "billing_required" });
    const h = harness();
    const out = await h.start(user, userId, project, true);
    if (out.kind !== "started" || out.data.reused) throw new Error("expected a job");
    await h.drain();
    const job = await admin.from("ai_jobs").select("status, error_code").eq("id", out.data.jobId).single();
    expect(job.data).toMatchObject({ status: "failed", error_code: "billing_required" });
    const row = await admin.from("insights").select("status, is_latest").eq("ai_job_id", out.data.jobId).single();
    expect(row.data).toEqual({ status: "failed", is_latest: false });
    const view = await getInsight(user, { applicationProjectId: project }, { pipeline });
    expect(view.insight?.versionNo).toBe(2);
    expect(view.activeJob).toBeNull();
    expect(view.lastFailure).toMatchObject({ code: "billing_required", jobId: out.data.jobId, failureCause: "billing_required" });
    expect((await loadProgress(user, [project])).get(project)?.insight).toBe("ready");
    failedJobId = out.data.jobId;
  });

  it("QA-S6-01: manual retry of the failed job resumes at match and ends ready (real triggers + begin/complete)", async () => {
    queue.push(matchResponse(), synthesisResponse());
    const h = harness();
    const retried = await h.runner.retryJob({ jobId: failedJobId, userId });
    expect(retried).toMatchObject({ jobId: failedJobId, inProgress: false });
    await h.drain();
    expect(queue).toHaveLength(0);
    const job = await admin.from("ai_jobs").select("status, error_code").eq("id", failedJobId).single();
    expect(job.data).toEqual({ status: "succeeded", error_code: null });
    const row = await admin.from("insights").select("status, is_latest, version_no").eq("ai_job_id", failedJobId).single();
    expect(row.data).toEqual({ status: "ready", is_latest: true, version_no: 3 });
    const view = await getInsight(user, { applicationProjectId: project }, { pipeline });
    expect(view).toMatchObject({ insight: { versionNo: 3 }, lastFailure: null, activeJob: null });
    // No extra jd_extraction: prepare's checkpoint was kept.
    const extraction = await admin.from("ai_jobs").select("id").eq("user_id", userId).eq("job_type", "jd_extraction");
    expect(extraction.data).toHaveLength(1);
  });

  it("deletion impact counts insights per application project (§4.2)", async () => {
    const impact = await getDeletionImpact(user, { entityType: "project_detail", entityId: ids.detail, affiliationMode: "keep_projects" });
    expect(impact.affected_results.by_application_project).toEqual([
      expect.objectContaining({ application_project_id: project, insights: 3, drafts: 0, draft_sections: 0, interview_sessions: 0 }),
    ]);
  });

  it("project delete cascades insights and their evidence", async () => {
    await deleteApplicationProject(user, project);
    const rows = await admin.from("insights").select("id").eq("application_project_id", project);
    expect(rows.data).toEqual([]);
    const links = await admin.from("evidence_links").select("id").eq("owner_id", firstInsightId);
    expect(links.data).toEqual([]);
  });
});
