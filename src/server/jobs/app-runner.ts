import "server-only";
import { after } from "next/server";
import { createLlm, type Llm } from "@/server/ai/llm";
import { createAiWriterClient } from "@/server/db/ai-writer";
import { getServerEnv } from "@/server/env";
import { connections } from "./connections";
import { signContinueToken } from "./continue-token";
import "./definitions";
import { logJobEvent } from "./log";
import { getJobType } from "./registry";
import { createJobRunner, type JobRunner } from "./runner";
import { createSupabaseJobStore } from "./supabase-store";
import { createSupabaseUsageStore } from "./supabase-usage";
import type { JobRef } from "./types";

/**
 * Production wiring of the runner: app_ai_writer client per user, the
 * provider-neutral `createLlm` per job run, `after()` scheduling, and the
 * self-invoke continuation.
 *
 * Connection + key: see `connections()` (S3b).
 *
 * `origin` must be the app's own origin (getSiteOrigin(): NEXT_PUBLIC_SITE_URL
 * in production), never a raw Host header — the continue token is sent there.
 */
export function createAppJobRunner(origin: string): JobRunner<Llm> {
  const conn = connections();
  return createJobRunner<Llm>({
    forUser(userId) {
      const db = createAiWriterClient(userId);
      return {
        db,
        store: createSupabaseJobStore(db),
        usage: createSupabaseUsageStore(db),
        keySource: conn.keysFor(userId),
        keyStatus: conn.statusFor(db),
      };
    },
    providerContext: conn.context,
    checkRunAllowed: conn.runGate ?? undefined,
    createLlm: (input) => createLlm(input),
    settleLlm: (llm, timeoutMs) => llm.settle(timeoutMs),
    getDefinition: (jobType) => getJobType<Llm>(jobType),
    schedule: (task) => after(task),
    continueJob: (ref) => selfInvokeContinue(origin, ref),
    log: logJobEvent,
  });
}

export async function selfInvokeContinue(origin: string, ref: JobRef): Promise<void> {
  const token = signContinueToken(ref, getServerEnv().SUPABASE_JWT_SECRET);
  const res = await fetch(new URL(`/api/ai-jobs/${ref.jobId}/continue`, origin), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    // The continue route answers 202 right away and runs the job in its own after().
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok && res.status !== 202) throw new Error(`continue failed: ${res.status}`);
}

export { connections, logJobEvent };
