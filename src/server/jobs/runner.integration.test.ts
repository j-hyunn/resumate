import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "@/server/ai/errors";
import type { Llm } from "@/server/ai/llm";
import { createAiWriterClient } from "@/server/db/ai-writer";
import type { Database } from "@/server/db/database.types";
import { resetServerEnvCache } from "@/server/env";
import { requestCancel } from "@/server/services/ai-jobs";
import { CreateApplicationProjectInput } from "@/lib/contracts/application";
import { KO_BACKEND } from "@/server/ai/__fixtures__/AI-01/jds";
import { resolveModel } from "@/server/ai/providers/models";
import { withdrawAiDataUseConsent } from "@/server/services/ai-connection/consent";
import { deleteProviderKey } from "@/server/services/ai-connection/keys";
import { createApplicationProject } from "@/server/services/application/write";
import { getAiUsageSummary } from "@/server/services/usage";
import { connectTestProvider, markTestKeyInvalid } from "@/test/ai-connection-db";
import { createScriptedAdapter, fakeClock, scriptedLlmFactory, type ScriptedResponse } from "@/test/job-fakes";
import { hasTable, isStackReady, readLocalSupabase } from "@/test/local-supabase";
import { FREE_TIER_MIN_INTERVAL_MS, STALLED_AFTER_MS } from "./constants";
import { kstDate, kstPeriodMonth } from "./cost";
import {
  createRecordingKeyStatusReporter,
  createStaticKeySource,
  createStaticProviderContext,
  type ProviderContext,
} from "./provider-context";
import { createJobRunner } from "./runner";
import { createSupabaseJobStore } from "./supabase-store";
import { createSupabaseUsageStore } from "./supabase-usage";
import type { JobRef, JobStep, JobTypeDefinition } from "./types";

/**
 * Runner v4 end-to-end against the local Supabase stack (S3a schema): real
 * ai_jobs rows (generated error_category / failure_cause, guard trigger,
 * in-flight unique index), real ai_usage_records inserts + seeded price
 * table as app_ai_writer, the user's cancel RPC, the service-role sweep and
 * claim_due_ai_jobs, and get_ai_usage_summary as the user.
 * Fake provider adapter through the real createLlm — no provider call.
 * Skips when `supabase start` isn't running or S3a isn't migrated.
 */

const stack = readLocalSupabase();
const ready = stack ? (await isStackReady(stack)) && (await hasTable(stack, "ai_usage_records")) : false;

/** Seeded price version in effect today (every version carries all 9 models; Sonnet's price is the same in all). */
function seededVersion(now = new Date()): string {
  const d = kstDate(now);
  return d >= "2027-01-01" ? "v2027-01-01" : d >= "2026-12-01" ? "v2026-12-01" : "v2026-10-28";
}

const PAID: ProviderContext = { provider: "anthropic", connectionTier: "paid", keyStatus: "valid" };
const FREE: ProviderContext = { provider: "gemini", connectionTier: "free", keyStatus: "valid" };

describe.skipIf(!ready)("job runner v4 (local stack)", () => {
  const s = stack!;
  let admin: SupabaseClient<Database>;
  let userId = "";
  let userClient: SupabaseClient<Database>;
  const scheduled: (() => Promise<void>)[] = [];
  const continued: JobRef[] = [];

  const step = (stage: string): JobStep<Llm> => ({
    stage,
    run: async (ctx) => {
      const r = await ctx.llm.complete({
        feature: "TEST",
        promptVersion: "test.v1",
        callKey: `${ctx.callKeyPrefix}.1`,
        systemBlocks: [{ text: "s" }],
        userBlocks: [{ text: "u" }],
        outputSchema: null,
        signal: ctx.signal,
      });
      return JSON.parse(r.text) as unknown;
    },
  });
  const def: JobTypeDefinition<Llm> = { jobType: "insight", modelTier: "default", steps: [step("match"), step("synthesize")] };

  function makeRunner(responses: ScriptedResponse[], context: ProviderContext = PAID) {
    const clock = fakeClock(new Date());
    const scripted = createScriptedAdapter(context.provider, responses, clock.ms);
    const keyStatus = createRecordingKeyStatusReporter();
    const runner = createJobRunner<Llm>({
      forUser: (uid) => {
        const db = createAiWriterClient(uid);
        return {
          db,
          store: createSupabaseJobStore(db),
          usage: createSupabaseUsageStore(db),
          keySource: createStaticKeySource("sk-integration-test", () => new ProviderError("key_missing")),
          keyStatus,
        };
      },
      providerContext: createStaticProviderContext(context),
      createLlm: scriptedLlmFactory(scripted.adapter, clock.ms),
      settleLlm: (llm, timeoutMs) => llm.settle(timeoutMs),
      getDefinition: (t) => (t === "insight" ? def : undefined),
      schedule: (task) => void scheduled.push(task),
      continueJob: async (ref) => void continued.push(ref),
      now: clock.now,
      random: () => 0,
      timing: { heartbeatIntervalMs: 50 },
    });
    return { runner, clock, scripted, keyStatus };
  }

  const target = () => ({ type: "application_project", id: crypto.randomUUID() });

  /**
   * R2: retry_ai_job only requeues an insight job that belongs to a real application project
   * (DM 2.9.1 case (1)), so retry tests start the job on one.
   */
  async function projectJob() {
    const id = crypto.randomUUID();
    await createApplicationProject(userClient, CreateApplicationProjectInput.parse({ id, rawText: KO_BACKEND.raw }));
    return { applicationProjectId: id, target: { type: "application_project", id } };
  }

  async function drain() {
    while (scheduled.length) await scheduled.shift()!();
  }

  async function jobRow(jobId: string) {
    const { data, error } = await admin.from("ai_jobs").select("*").eq("id", jobId).single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function usageRows(jobId: string) {
    const { data, error } = await admin.from("ai_usage_records").select("*").eq("ai_job_id", jobId).order("occurred_at");
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async function wake(h: ReturnType<typeof makeRunner>, jobId: string) {
    const at = (await jobRow(jobId)).next_run_at!;
    h.clock.advance(Math.max(0, Date.parse(at) - h.clock.ms()));
    await h.runner.getStatus({ jobId, userId });
    await drain();
  }

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", s.url);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", s.anonKey);
    vi.stubEnv("SUPABASE_JWT_SECRET", s.jwtSecret);
    vi.stubEnv("CRON_SECRET", "test-cron-secret-0000");
    resetServerEnvCache();
    scheduled.length = 0;
    continued.length = 0;
  });

  beforeAll(async () => {
    admin = createClient<Database>(s.url, s.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const email = `runner-${crypto.randomUUID()}@example.test`;
    const password = `pw-${crypto.randomUUID()}`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.code}`);
    userId = data.user.id;
    userClient = createClient<Database>(s.url, s.anonKey, { auth: { persistSession: false } });
    const signIn = await userClient.auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error(`signIn failed: ${signIn.error.code}`);
    // R2: retry_ai_job reads the active connection from the DB (C-11.4).
    await connectTestProvider(admin, userClient, userId, "anthropic", "paid");
  });

  afterAll(async () => {
    if (userId) {
      await admin.from("ai_jobs").delete().eq("user_id", userId);
      await admin.auth.admin.deleteUser(userId); // cascades ai_usage_records
    }
    resetServerEnvCache();
  });

  it("success: succeeded row with fixed provider / tiers; one usage row per call priced from the seeded table", async () => {
    const h = makeRunner([{ json: { a: 1 } }, { json: { b: 2 } }]);
    const { jobId } = await h.runner.startJob({ userId, jobType: "insight", target: target(), inputHash: `ok-${crypto.randomUUID()}` });
    await drain();
    const row = await jobRow(jobId);
    expect(row).toMatchObject({
      status: "succeeded",
      provider: "anthropic",
      model_tier: "default",
      connection_tier: "paid",
      run_generation: 1,
      retry_count: 0,
      next_run_at: null,
      error_code: null,
      error_category: null,
      failure_cause: null,
    });
    const rows = await usageRows(jobId);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r).toMatchObject({
        user_id: userId,
        feature: "insight",
        job_type: "insight",
        provider: "anthropic",
        model: "claude-sonnet-5-5",
        model_tier: "default",
        connection_tier: "paid",
        outcome: "succeeded",
        usage_source: "provider_reported",
        input_tokens: 1000,
        output_tokens: 200,
        price_table_version: seededVersion(),
        period_month: kstPeriodMonth(new Date(r.occurred_at)),
      });
      // 1000 × $2 + 200 × $10 per 1M (claude-sonnet-5-5)
      expect(Number(r.estimated_cost_usd)).toBeCloseTo(0.004, 6);
    }
    // complete_ai_job again: idempotent for the same generation.
    const store = createSupabaseJobStore(createAiWriterClient(userId));
    expect(await store.complete(jobId, 1, { stage: "synthesize", done: 1, total: 1 })).toBe(true);
    expect(await store.complete(jobId, 2, { stage: "synthesize", done: 1, total: 1 })).toBe(false);
  });

  it("input_hash reuse: same job, no new usage row", async () => {
    const h = makeRunner([{ json: {} }, { json: {} }]);
    const hash = `reuse-${crypto.randomUUID()}`;
    const t = target();
    const first = await h.runner.startJob({ userId, jobType: "insight", target: t, inputHash: hash });
    await drain();
    const again = await h.runner.startJob({ userId, jobType: "insight", target: t, inputHash: hash });
    expect(again).toEqual({ jobId: first.jobId, reused: true, inProgress: false });
    expect(await usageRows(first.jobId)).toHaveLength(2);
  });

  it("rate_limited: scheduled via next_run_at; sweep skips it; claim_due lists it only when due; poll wakes it", async () => {
    const h = makeRunner([{ error: "rate_limited" }, { json: {} }, { json: {} }]);
    const { jobId } = await h.runner.startJob({ userId, jobType: "insight", target: target() });
    await drain();
    let row = await jobRow(jobId);
    expect(row).toMatchObject({ status: "queued", retry_count: 1, retry_wait_total_ms: 2000, run_generation: 2, error_code: null });
    expect(Date.parse(row.next_run_at!)).toBe(h.clock.ms() + 2000);
    expect((row.progress as Record<string, unknown>).waiting_retry_until).toBe(new Date(h.clock.ms() + 2000).toISOString());

    // The sweep still leaves a waiting job alone, even one whose heartbeat is long past the cutoff.
    // Test isolation (S3b QA round 2): the sweep RPC is global (cron), so never pass a future cutoff —
    // it would stall other test files' fresh jobs running in parallel. Backdate THIS job's heartbeat
    // instead and sweep with a cutoff in the past that no fresh job can match.
    const dayAgo = new Date(Date.now() - 24 * 3_600_000).toISOString();
    expect((await admin.from("ai_jobs").update({ heartbeat_at: dayAgo }).eq("id", jobId)).error).toBeNull();
    const swept = await admin.rpc("sweep_stalled_ai_jobs", { p_stalled_before: new Date(Date.now() - 12 * 3_600_000).toISOString() });
    expect(swept.error).toBeNull();
    expect((await jobRow(jobId)).status).toBe("queued");

    const notYet = await admin.rpc("claim_due_ai_jobs", { p_now: new Date(h.clock.ms() + 1000).toISOString(), p_limit: 100 });
    expect((notYet.data ?? []).map((r) => r.id)).not.toContain(jobId);
    const due = await admin.rpc("claim_due_ai_jobs", { p_now: new Date(h.clock.ms() + 2000).toISOString(), p_limit: 100 });
    expect(due.data).toContainEqual({ id: jobId, user_id: userId });
    expect((await jobRow(jobId)).status).toBe("queued"); // read-only

    await wake(h, jobId);
    row = await jobRow(jobId);
    expect(row).toMatchObject({ status: "succeeded", retry_count: 1, next_run_at: null });
    const rows = await usageRows(jobId);
    expect(rows.map((r) => [r.outcome, r.error_code, r.usage_source])).toEqual([
      ["failed", "rate_limited", "unavailable"],
      ["succeeded", null, "provider_reported"],
      ["succeeded", null, "provider_reported"],
    ]);
    expect(Number(rows[0]!.estimated_cost_usd)).toBe(0);
  });

  it("provider_unavailable final failure: generated category / cause, retry_after; manual retry clears it", async () => {
    const h = makeRunner([{ error: "provider_unavailable" }, { error: "provider_unavailable" }, { error: "provider_unavailable" }, { json: {} }, { json: {} }]);
    const { jobId } = await h.runner.startJob({ userId, jobType: "insight", ...(await projectJob()) });
    await drain();
    await wake(h, jobId);
    await wake(h, jobId);
    let row = await jobRow(jobId);
    expect(row).toMatchObject({
      status: "failed",
      error_code: "provider_unavailable",
      error_category: "transient",
      failure_cause: "provider_unavailable",
      retry_count: 2,
      retry_wait_total_ms: 6000,
      next_run_at: null,
    });
    expect(Date.parse(row.retry_after!)).toBe(h.clock.ms() + 60_000);
    expect(await usageRows(jobId)).toHaveLength(3);

    const res = await h.runner.retryJob({ jobId, userId });
    expect(res.inProgress).toBe(false);
    row = await jobRow(jobId);
    expect(row).toMatchObject({ status: "queued", retry_after: null, error_code: null, run_generation: 4 });
    await drain();
    expect((await jobRow(jobId)).status).toBe("succeeded");
    expect(await usageRows(jobId)).toHaveLength(5);
  });

  it("daily quota: quota_resets_at stored, cause daily_quota_exhausted; key_invalid marks the key", async () => {
    const resets = new Date(Date.now() + 5 * 3_600_000);
    const h = makeRunner([{ error: "daily_quota_exhausted", quotaResetsAt: resets }, { error: "key_invalid" }]);
    const a = await h.runner.startJob({ userId, jobType: "insight", target: target() });
    await drain();
    const rowA = await jobRow(a.jobId);
    expect(rowA).toMatchObject({ status: "failed", error_category: "provider_limit", failure_cause: "daily_quota_exhausted", retry_count: 0 });
    expect(Date.parse(rowA.quota_resets_at!)).toBe(resets.getTime());
    const b = await h.runner.startJob({ userId, jobType: "insight", target: target() });
    await drain();
    expect(await jobRow(b.jobId)).toMatchObject({ status: "failed", error_category: "user_account", failure_cause: "key_invalid" });
    expect(h.keyStatus.invalidated).toEqual([b.jobId]);
  });

  it("one in-flight job per target: a concurrent start follows the winner", async () => {
    const h = makeRunner([]);
    const t = target();
    const [x, y] = await Promise.all([
      h.runner.startJob({ userId, jobType: "insight", target: t }),
      h.runner.startJob({ userId, jobType: "insight", target: t }),
    ]);
    expect(x.jobId).toBe(y.jobId);
    expect([x.inProgress, y.inProgress].sort()).toEqual([false, true]);
    scheduled.length = 0;
    await admin.from("ai_jobs").update({ status: "canceled", error_code: "canceled" }).eq("id", x.jobId);
  });

  it("cancel of a job waiting for its retry: user RPC + settle → canceled", async () => {
    const h = makeRunner([{ error: "rate_limited" }]);
    const { jobId } = await h.runner.startJob({ userId, jobType: "insight", target: target() });
    await drain();
    expect((await jobRow(jobId)).status).toBe("queued");
    await requestCancel(userClient, jobId);
    const after = await h.runner.settleCancelIfQueued({ jobId, userId });
    expect(after).toMatchObject({ status: "canceled", errorCode: "canceled" });
    expect(await jobRow(jobId)).toMatchObject({ error_category: "system", failure_cause: null, next_run_at: null });
  });

  it("free tier: the second step waits ≥ 6 s after the last recorded call (read from ai_usage_records)", async () => {
    const h = makeRunner([{ json: {} }, { json: {} }], FREE);
    const { jobId } = await h.runner.startJob({ userId, jobType: "insight", target: target() });
    const t0 = h.clock.ms();
    await drain();
    const row = await jobRow(jobId);
    expect(row).toMatchObject({ status: "queued", connection_tier: "free", provider: "gemini", retry_count: 0 });
    expect(Date.parse(row.next_run_at!)).toBe(t0 + FREE_TIER_MIN_INTERVAL_MS);
    await wake(h, jobId);
    expect((await jobRow(jobId)).status).toBe("succeeded");
    const rows = await usageRows(jobId);
    expect(rows.map((r) => [r.connection_tier, r.model])).toEqual([
      ["free", "gemini-3.8-flash"],
      ["free", "gemini-3.8-flash"],
    ]);
  });

  it("lazy stalled detection on the status read", async () => {
    const h = makeRunner([]);
    const { jobId } = await h.runner.startJob({ userId, jobType: "insight", target: target() });
    scheduled.length = 0;
    h.clock.advance(STALLED_AFTER_MS + 1_000);
    const res = await h.runner.getStatus({ jobId, userId });
    expect(res).toMatchObject({ status: "failed", errorCode: "stalled" });
  });

  it("usage meter summary as the user (get_ai_usage_summary)", async () => {
    const summary = await getAiUsageSummary(userClient);
    expect(summary.periodMonth).toBe(kstPeriodMonth(new Date()));
    expect(summary.totals.calls).toBeGreaterThan(0);
    expect(summary.totals.failedCalls).toBeGreaterThan(0);
    expect(summary.byFeature.map((f) => f.feature)).toContain("insight");
    expect(summary.byProvider.map((p) => `${p.provider}/${p.connectionTier}`)).toEqual(expect.arrayContaining(["anthropic/paid", "gemini/free"]));
    expect(summary.priceTableVersions.map((v) => v.version)).toContain(seededVersion());
    expect(summary.previousMonth).toBeNull();
    const withPrev = await getAiUsageSummary(userClient, { includePrevious: true });
    expect(withPrev.previousMonth?.estimatedCostUsd).toBe(0);
  });

  describe("R2 manual retry on the ACTIVE provider (C-11.4, A1 changed; retry_ai_job)", () => {
    const OPENAI: ProviderContext = { provider: "openai", connectionTier: "paid", keyStatus: "valid" };

    /** A job that failed at synthesize after match was checkpointed. */
    async function failedAtSynthesize() {
      const h = makeRunner([{ json: { m: 1 } }, { error: "billing_required" }]);
      const { jobId } = await h.runner.startJob({ userId, jobType: "insight", ...(await projectJob()) });
      await drain();
      const row = await jobRow(jobId);
      expect(row).toMatchObject({ status: "failed", error_code: "billing_required", provider: "anthropic" });
      expect(Object.keys(row.step_outputs as object).sort()).toEqual(["_meta", "match"]);
      return { jobId, gen: row.run_generation };
    }

    it("same active provider + tier → resumes from synthesize, match kept, fresh run meta", async () => {
      const { jobId, gen } = await failedAtSynthesize();
      const h = makeRunner([{ json: { s: 1 } }]);
      const res = await h.runner.retryJob({ jobId, userId });
      expect(res).toEqual({ jobId, reused: false, inProgress: false, restarted: false });
      const row = await jobRow(jobId);
      expect(row).toMatchObject({ status: "queued", run_generation: gen + 1, provider: "anthropic", connection_tier: "paid", model_tier: "default", model: resolveModel("anthropic", "default"), error_code: null });
      expect(row.step_outputs).toMatchObject({ match: { m: 1 }, _meta: { runBase: gen + 1, retries: {} } });
      await drain();
      expect((await jobRow(jobId)).status).toBe("succeeded");
      expect(h.scripted.calls).toHaveLength(1); // only synthesize
    });

    it("another active provider → restarted: provider / model / tier columns replaced, step_outputs only _meta, both steps run again", async () => {
      const { jobId, gen } = await failedAtSynthesize();
      await connectTestProvider(admin, userClient, userId, "openai", "paid");
      try {
        const h = makeRunner([{ json: { m: 2 } }, { json: { s: 2 } }], OPENAI);
        const res = await h.runner.retryJob({ jobId, userId });
        expect(res).toEqual({ jobId, reused: false, inProgress: false, restarted: true });
        const row = await jobRow(jobId);
        expect(row).toMatchObject({ status: "queued", run_generation: gen + 1, provider: "openai", connection_tier: "paid", model: resolveModel("openai", "default") });
        expect(Object.keys(row.step_outputs as object)).toEqual(["_meta"]);
        await drain();
        const done = await jobRow(jobId);
        expect(done).toMatchObject({ status: "succeeded", provider: "openai" });
        expect(h.scripted.calls).toHaveLength(2);
        const usage = await usageRows(jobId);
        expect(usage.slice(-2).map((u) => u.provider)).toEqual(["openai", "openai"]);
      } finally {
        await connectTestProvider(admin, userClient, userId, "anthropic", "paid");
      }
    });

    it("path ② refusals come from the DB on the ACTIVE provider: 409, job stays failed, no call", async () => {
      const { jobId, gen } = await failedAtSynthesize();
      const h = makeRunner([]);
      const expectRefused = async (code: string) => {
        await expect(h.runner.retryJob({ jobId, userId })).rejects.toMatchObject({ code, status: 409 });
        expect(await jobRow(jobId)).toMatchObject({ status: "failed", run_generation: gen, provider: "anthropic" });
      };
      try {
        await withdrawAiDataUseConsent(userClient, { provider: "anthropic", connectionTier: "paid" }, () => {});
        await expectRefused("ai_consent_required");
        await connectTestProvider(admin, userClient, userId, "anthropic", "paid");
        await markTestKeyInvalid(admin, userId, "anthropic");
        await expectRefused("key_invalid");
        await deleteProviderKey(userClient, "anthropic");
        await expectRefused("key_missing");
        expect(h.scripted.calls).toHaveLength(0);
      } finally {
        await connectTestProvider(admin, userClient, userId, "anthropic", "paid");
      }
    });
  });
});
