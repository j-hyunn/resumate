import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeAiClient } from "@/server/ai/fake-client";
import { AiError } from "@/server/ai/errors";
import type { AiClient } from "@/server/ai/client";
import { createAiWriterClient } from "@/server/db/ai-writer";
import type { Database } from "@/server/db/database.types";
import { resetServerEnvCache } from "@/server/env";
import { requestCancel } from "@/server/services/ai-jobs";
import { getUsageSummary } from "@/server/services/usage";
import { hasTable, isStackReady, readLocalSupabase } from "@/test/local-supabase";
import { STALLED_AFTER_MS } from "./constants";
import { createSupabaseLedger } from "./ledger";
import { createJobRunner } from "./runner";
import { createSupabaseJobStore } from "./supabase-store";
import type { JobRef, JobTypeDefinition } from "./types";

/**
 * Runner end-to-end against the local Supabase stack (S3 schema): real ai_jobs
 * rows, real ledger RPCs as app_ai_writer, the user's cancel RPC, and the
 * service-role sweep. Fake job types and a fake model — no Anthropic call.
 * Skips when `supabase start` isn't running or S3 isn't migrated.
 */

const stack = readLocalSupabase();
const ready = stack ? (await isStackReady(stack)) && (await hasTable(stack, "ai_jobs")) : false;

describe.skipIf(!ready)("job runner (local stack)", () => {
  const s = stack!;
  let admin: SupabaseClient<Database>;
  let userId = "";
  let userClient: SupabaseClient<Database>;
  const scheduled: (() => Promise<void>)[] = [];
  const continued: JobRef[] = [];

  let failMode: "none" | "schema" | "input" | "hang" = "none";

  // Fake pipeline: one model call per step through the fake AiClient.
  const defs: Record<string, JobTypeDefinition<AiClient>> = {
    insight: {
      jobType: "insight",
      usage: { feature: "insight", units: 1 },
      steps: [
        {
          stage: "match",
          total: 2,
          run: async (ctx) => {
            const r = await ctx.ai.complete({
              feature: "insight",
              promptVersion: "test-v1",
              model: "claude-sonnet-5-5",
              system: [{ text: "s" }],
              user: [{ text: "u" }],
              outputSchema: { type: "object" },
              signal: ctx.signal,
            });
            await ctx.reportProgress(1, 2);
            return JSON.parse(r.text) as unknown;
          },
        },
        {
          stage: "synthesize",
          timeoutMs: 300,
          run: async (ctx) => {
            if (failMode === "schema") throw new AiError("schema_invalid");
            if (failMode === "input") throw new AiError("input_too_long");
            if (failMode === "hang") return new Promise(() => {});
            return { previous: Object.keys(ctx.previous) };
          },
        },
      ],
    },
    jd_extraction: {
      jobType: "jd_extraction",
      steps: [{ stage: "extract", run: async () => ({ ok: true }) }],
    },
    interview_questions: {
      jobType: "interview_questions",
      usage: { feature: "interview_session", units: 1 },
      steps: [{ stage: "generate", run: async () => new Promise(() => {}), timeoutMs: 60_000 }],
    },
  };

  function makeRunner() {
    return createJobRunner<AiClient>({
      forUser: (uid) => {
        const db = createAiWriterClient(uid);
        return {
          db,
          store: createSupabaseJobStore(db),
          ledger: createSupabaseLedger(db),
          ai: createFakeAiClient(Array.from({ length: 10 }, () => ({ text: JSON.stringify({ matched: 2 }) }))),
        };
      },
      getDefinition: (t) => defs[t],
      schedule: (task) => void scheduled.push(task),
      continueJob: async (ref) => void continued.push(ref),
      timing: { heartbeatIntervalMs: 50 },
    });
  }

  async function drain() {
    while (scheduled.length) await scheduled.shift()!();
  }

  async function usageOf(jobId: string) {
    const { data, error } = await admin.from("usage_events").select("status").eq("ai_job_id", jobId);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => r.status);
  }

  async function jobRow(jobId: string) {
    const { data, error } = await admin.from("ai_jobs").select("*").eq("id", jobId).single();
    if (error) throw new Error(error.message);
    const { _meta, ...stepOutputs } = (data.step_outputs ?? {}) as Record<string, unknown>;
    return { ...data, step_outputs: stepOutputs, meta: _meta as { usageEventId: string | null; runBase: number } };
  }

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", s.url);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", s.anonKey);
    vi.stubEnv("SUPABASE_JWT_SECRET", s.jwtSecret);
    vi.stubEnv("ANTHROPIC_API_KEY", "test-not-used");
    vi.stubEnv("CRON_SECRET", "test-cron-secret-0000");
    resetServerEnvCache();
    failMode = "none";
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
  });

  afterAll(async () => {
    if (userId) {
      // Test rows: service role cleanup (usage_events / ai_jobs aren't cascaded by user deletion in every setup).
      await admin.from("usage_events").delete().eq("user_id", userId);
      await admin.from("ai_jobs").delete().eq("user_id", userId);
      await admin.auth.admin.deleteUser(userId);
    }
    resetServerEnvCache();
  });

  it("success: queued → running → succeeded, checkpoints saved, usage charged", async () => {
    const runner = makeRunner();
    const { jobId } = await runner.startJob({ userId, jobType: "insight", params: { x: 1 }, inputHash: `ok-${crypto.randomUUID()}` });
    expect((await jobRow(jobId)).status).toBe("queued");
    expect(await usageOf(jobId)).toEqual(["reserved"]);
    await drain();
    const row = await jobRow(jobId);
    expect(row).toMatchObject({ status: "succeeded", error_code: null, attempt_count: 1 });
    expect(row.started_at).not.toBeNull();
    expect(row.finished_at).not.toBeNull();
    expect(row.step_outputs).toEqual({ match: { matched: 2 }, synthesize: { previous: ["match"] } });
    expect(row.progress).toEqual({ stage: "synthesize", done: 1, total: 1 });
    expect(await usageOf(jobId)).toEqual(["charged"]);
    // complete_ai_job again is idempotent (0 leftover rows, still succeeded).
    const store = createSupabaseJobStore(createAiWriterClient(userId));
    expect(await store.complete(jobId, row.attempt_count, row.meta.usageEventId, { stage: "synthesize", done: 1, total: 1 })).toBe(true);
    expect(await usageOf(jobId)).toEqual(["charged"]);
  });

  it("input_hash reuse returns the succeeded job and reserves nothing", async () => {
    const runner = makeRunner();
    const hash = `reuse-${crypto.randomUUID()}`;
    const first = await runner.startJob({ userId, jobType: "insight", inputHash: hash });
    await drain();
    const again = await runner.startJob({ userId, jobType: "insight", inputHash: hash });
    expect(again).toEqual({ jobId: first.jobId, reused: true, inProgress: false });
    expect(await usageOf(first.jobId)).toEqual(["charged"]);
  });

  it("schema_invalid after the retry: failed (category transient), usage released", async () => {
    failMode = "schema";
    const runner = makeRunner();
    const { jobId } = await runner.startJob({ userId, jobType: "insight" });
    await drain();
    const row = await jobRow(jobId);
    expect(row).toMatchObject({ status: "failed", error_code: "schema_invalid", error_category: "transient", attempt_count: 2 });
    expect(row.step_outputs).toEqual({ match: { matched: 2 } });
    expect(await usageOf(jobId)).toEqual(["released"]);

    // Manual retry resumes at synthesize and charges a new reservation.
    failMode = "none";
    await runner.retryJob({ jobId, userId });
    await drain();
    expect((await jobRow(jobId)).status).toBe("succeeded");
    expect((await usageOf(jobId)).sort()).toEqual(["charged", "released"]);
  });

  it("input error: failed without retry, released", async () => {
    failMode = "input";
    const runner = makeRunner();
    const { jobId } = await runner.startJob({ userId, jobType: "insight" });
    await drain();
    expect(await jobRow(jobId)).toMatchObject({ status: "failed", error_code: "input_too_long", error_category: "input", attempt_count: 1 });
    expect(await usageOf(jobId)).toEqual(["released"]);
  });

  it("hanging step: timeout after retry, released", async () => {
    failMode = "hang";
    const runner = makeRunner();
    const { jobId } = await runner.startJob({ userId, jobType: "insight" });
    await drain();
    expect(await jobRow(jobId)).toMatchObject({ status: "failed", error_code: "timeout", error_category: "timeout" });
    expect(await usageOf(jobId)).toEqual(["released"]);
  });

  it("user cancel RPC during a running step: canceled, released", async () => {
    const runner = makeRunner();
    const { jobId } = await runner.startJob({ userId, jobType: "interview_questions" });
    const run = scheduled.shift()!();
    // Wait until the step is running, then cancel as the user.
    await vi.waitFor(async () => expect((await jobRow(jobId)).status).toBe("running"), { timeout: 3_000 });
    const res = await requestCancel(userClient, jobId);
    expect(res.cancelRequestedAt).not.toBeNull();
    await run;
    expect(await jobRow(jobId)).toMatchObject({ status: "canceled", error_code: "canceled" });
    expect(await usageOf(jobId)).toEqual(["released"]);
  });

  it("cancel of a queued job is settled immediately", async () => {
    const runner = makeRunner();
    const { jobId } = await runner.startJob({ userId, jobType: "insight" });
    scheduled.length = 0; // the after() never ran
    await requestCancel(userClient, jobId);
    const job = await runner.settleCancelIfQueued({ jobId, userId });
    expect(job?.status).toBe("canceled");
    expect(await usageOf(jobId)).toEqual(["released"]);
  });

  it("sweep (service role RPC) fails a stalled job; the zombie runner can't overwrite it", async () => {
    const runner = makeRunner();
    const { jobId } = await runner.startJob({ userId, jobType: "insight" });
    scheduled.length = 0;
    const old = new Date(Date.now() - STALLED_AFTER_MS - 60_000).toISOString();
    await admin.from("ai_jobs").update({ status: "running", heartbeat_at: old }).eq("id", jobId);
    const { data: swept, error } = await admin.rpc("sweep_stalled_ai_jobs", {
      p_stalled_before: new Date(Date.now() - STALLED_AFTER_MS).toISOString(),
    });
    expect(error).toBeNull();
    expect(swept).toBeGreaterThanOrEqual(1);
    expect(await jobRow(jobId)).toMatchObject({ status: "failed", error_code: "stalled" });
    expect(await usageOf(jobId)).toEqual(["released"]);

    // Zombie: a late finish is refused by the conditional update / status guard.
    const store = createSupabaseJobStore(createAiWriterClient(userId));
    const zombie = await jobRow(jobId);
    expect(await store.finish(jobId, zombie.attempt_count, { status: "canceled" })).toBe(false);
    expect(await store.complete(jobId, zombie.attempt_count, zombie.meta.usageEventId, { stage: "synthesize", done: 1, total: 1 })).toBe(false);
    expect((await jobRow(jobId)).status).toBe("failed");
    expect(await usageOf(jobId)).toEqual(["released"]);
  });

  it("status read marks a stalled job failed and releases (lazy detection)", async () => {
    const runner = makeRunner();
    const { jobId } = await runner.startJob({ userId, jobType: "insight" });
    scheduled.length = 0;
    const old = new Date(Date.now() - STALLED_AFTER_MS - 60_000).toISOString();
    await admin.from("ai_jobs").update({ status: "running", heartbeat_at: old }).eq("id", jobId);
    const job = await runner.getStatus({ jobId, userId });
    expect(job).toMatchObject({ status: "failed", errorCode: "stalled" });
    expect(await usageOf(jobId)).toEqual(["released"]);
  });

  it("another user's job is not visible to the runner scope (RLS via sub)", async () => {
    const runner = makeRunner();
    const { jobId } = await runner.startJob({ userId, jobType: "insight" });
    scheduled.length = 0;
    const otherUser = crypto.randomUUID();
    await expect(runner.getStatus({ jobId, userId: otherUser })).rejects.toMatchObject({ code: "not_found" });
    await runner.settleCancelIfQueued({ jobId, userId }); // cleanup path: nothing to cancel
    await requestCancel(userClient, jobId);
    await runner.settleCancelIfQueued({ jobId, userId });
  });

  it("limit: the 6th interview_session reservation is refused and leaves no job row; usage summary counts reserved", async () => {
    const runner = makeRunner();
    // Fill the month's interview_session limit (5) with jobs whose after() never runs.
    const before = await getUsageSummary(userClient);
    const room = before.features.interview_session.remaining ?? 0;
    const ids: string[] = [];
    for (let i = 0; i < room; i++) ids.push((await runner.startJob({ userId, jobType: "interview_questions" })).jobId);
    scheduled.length = 0;
    const { count: jobsBefore } = await admin.from("ai_jobs").select("id", { count: "exact", head: true }).eq("user_id", userId);
    await expect(runner.startJob({ userId, jobType: "interview_questions" })).rejects.toMatchObject({ code: "usage_limit_reached" });
    const { count: jobsAfter } = await admin.from("ai_jobs").select("id", { count: "exact", head: true }).eq("user_id", userId);
    expect(jobsAfter).toBe(jobsBefore);

    const summary = await getUsageSummary(userClient);
    expect(summary.features.interview_session).toMatchObject({ limit: 5, remaining: 0 });
    expect(summary.features.chat_message.limit).toBeNull();

    // Clean up: cancel them so reservations are released.
    for (const id of ids) {
      await requestCancel(userClient, id);
      await runner.settleCancelIfQueued({ jobId: id, userId });
      expect(await usageOf(id)).toEqual(["released"]);
    }
    expect((await getUsageSummary(userClient)).features.interview_session.remaining).toBe(5);
  });

  it("yield → continuation resumes from the checkpoint", async () => {
    const runner = createJobRunner<AiClient>({
      forUser: (uid) => {
        const db = createAiWriterClient(uid);
        return { db, store: createSupabaseJobStore(db), ledger: createSupabaseLedger(db), ai: createFakeAiClient([{ text: "{\"m\":1}" }]) };
      },
      getDefinition: (t) => defs[t],
      schedule: (task) => void scheduled.push(task),
      continueJob: async (ref) => void continued.push(ref),
      // Budget 0: every step after the first in an invocation yields.
      timing: { invocationBudgetMs: 0 },
    });
    const { jobId } = await runner.startJob({ userId, jobType: "insight" });
    await drain();
    expect(await jobRow(jobId)).toMatchObject({ status: "queued", step_outputs: { match: { m: 1 } } });
    expect(continued).toEqual([{ jobId, userId }]);
    expect(await runner.runJob({ jobId, userId })).toBe("succeeded");
    expect(await usageOf(jobId)).toEqual(["charged"]);
  });

  it("no-charge job: complete_ai_job with a null reservation succeeds without usage rows", async () => {
    const runner = makeRunner();
    const { jobId } = await runner.startJob({ userId, jobType: "jd_extraction" });
    await drain();
    expect((await jobRow(jobId)).status).toBe("succeeded");
    expect(await usageOf(jobId)).toEqual([]);
  });

  it("QA-S3-01 concurrent manual retries: one winner, original released + one charged", async () => {
    failMode = "schema";
    const runner = makeRunner();
    const { jobId } = await runner.startJob({ userId, jobType: "insight" });
    await drain();
    failMode = "none";
    const results = await Promise.all([runner.retryJob({ jobId, userId }), runner.retryJob({ jobId, userId })]);
    expect(results.filter((r) => !r.inProgress)).toHaveLength(1);
    await drain();
    expect((await jobRow(jobId)).status).toBe("succeeded");
    expect((await usageOf(jobId)).sort()).toEqual(["charged", "released"]);
  });

  it("QA-S3-03 double start race: one job row, the loser's reservation released", async () => {
    const runner = makeRunner();
    const hash = `race-${crypto.randomUUID()}`;
    const [a, b] = await Promise.all([
      runner.startJob({ userId, jobType: "insight", inputHash: hash }),
      runner.startJob({ userId, jobType: "insight", inputHash: hash }),
    ]);
    expect(a.jobId).toBe(b.jobId);
    await drain();
    const { data } = await admin.from("usage_events").select("status, ai_job_id").eq("user_id", userId).eq("status", "reserved");
    expect(data ?? []).toEqual([]);
    expect(await usageOf(a.jobId)).toEqual(["charged"]);
  });

  it("QA-S3-04/05 retry sets heartbeat = now (poll doesn't stall it) and bumps the generation", async () => {
    failMode = "input";
    const runner = makeRunner();
    const { jobId } = await runner.startJob({ userId, jobType: "insight" });
    await drain();
    // Make it look old and transient-failed.
    const old = new Date(Date.now() - STALLED_AFTER_MS * 5).toISOString();
    await admin.from("ai_jobs").update({ error_code: "model_unavailable", created_at: old }).eq("id", jobId);
    const before = await jobRow(jobId);
    failMode = "none";
    await runner.retryJob({ jobId, userId });
    scheduled.length = 0;
    const polled = await runner.getStatus({ jobId, userId });
    expect(polled.status).toBe("queued");
    expect(polled.attemptCount).toBe(before.attempt_count + 1);
    // A late write of the old generation matches nothing.
    const store = createSupabaseJobStore(createAiWriterClient(userId));
    expect(await store.update(jobId, before.attempt_count, { progress: { stage: "x", done: 0, total: 1 } })).toBe(false);
    await runner.runJob({ jobId, userId });
    expect((await jobRow(jobId)).status).toBe("succeeded");
  });
});
