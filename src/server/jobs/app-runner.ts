import "server-only";
import { after } from "next/server";
import { ProviderError } from "@/server/ai/errors";
import { createLlm, type Llm } from "@/server/ai/llm";
import { AppError } from "@/lib/contracts/errors";
import { createAiWriterClient } from "@/server/db/ai-writer";
import { createSupabaseServerClient } from "@/server/db/server";
import type { AiWriterSupabaseClient } from "@/server/db/types";
import { createAppKeySource } from "@/server/keys/app";
import type { AiErrorCode } from "@/lib/contracts/enums";
import { createDbKeyStatusReporter, createDbProviderContextSource, createDbRunGate } from "@/server/services/ai-connection/keys";
import { logJobEvent } from "./log";
import { getServerEnv } from "@/server/env";
import { signContinueToken } from "./continue-token";
import {
  createDevEnvKeySource,
  createDevEnvKeyStatusReporter,
  createDevEnvProviderContext,
  readDevAiEnv,
  type DevAiEnv,
  type KeySource,
  type KeyStatusReporter,
  type ProviderContextSource,
} from "./provider-context";
import { getJobType } from "./registry";
import { createJobRunner, type JobRunner } from "./runner";
import { createSupabaseJobStore } from "./supabase-store";
import { createSupabaseUsageStore } from "./supabase-usage";
import type { JobRecord, JobRef } from "./types";

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
function devEnvActive(env: DevAiEnv): boolean {
  return env.nodeEnv !== "production" && !!env.provider && !!env.apiKey;
}

/**
 * S3b: the real connection — active provider + key status + run-time consent
 * from the user session (`createDbProviderContextSource`), keys decrypted per
 * provider call through app_key_reader (`createAppKeySource`), key status
 * updates through app_ai_writer RPCs (`createDbKeyStatusReporter`).
 *
 * Development override: when AI_DEV_PROVIDER + AI_DEV_API_KEY are set outside
 * production, the S3a env implementation is used instead (local runs without
 * registering a key). Production always uses the DB path.
 */
function connections(): {
  context: ProviderContextSource;
  keysFor: (userId: string) => KeySource;
  statusFor: (db: AiWriterSupabaseClient) => KeyStatusReporter;
  /** QA-S3b-01 run-time gate; null in the dev-env mode (no key rows to check). */
  runGate: ((job: JobRecord) => Promise<AiErrorCode | null>) | null;
} {
  const env = readDevAiEnv();
  if (devEnvActive(env)) {
    const keys = createDevEnvKeySource(env, () => new ProviderError("key_missing"));
    const status = createDevEnvKeyStatusReporter(env, logJobEvent);
    return { context: createDevEnvProviderContext(env), keysFor: () => keys, statusFor: () => status, runGate: null };
  }
  return {
    // startJob runs inside a request (start / retry routes): the cookie session is that user's.
    context: createDbProviderContextSource(async (userId) => {
      const supabase = await createSupabaseServerClient();
      const { data } = await supabase.auth.getUser();
      if (data.user?.id !== userId) throw new AppError("unauthenticated");
      return supabase;
    }),
    keysFor: createAppKeySource,
    statusFor: createDbKeyStatusReporter,
    // check_ai_run_allowed as the job's user (app_ai_writer), before every step.
    runGate: (job) => createDbRunGate(createAiWriterClient(job.userId))(job.id),
  };
}

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

export { logJobEvent };
