import "server-only";
import { after } from "next/server";
import { ProviderError } from "@/server/ai/errors";
import { createLlm, type Llm } from "@/server/ai/llm";
import { createAiWriterClient } from "@/server/db/ai-writer";
import { getServerEnv } from "@/server/env";
import { signContinueToken } from "./continue-token";
import {
  createDevEnvKeySource,
  createDevEnvKeyStatusReporter,
  createDevEnvProviderContext,
  readDevAiEnv,
  type KeySource,
  type KeyStatusReporter,
  type ProviderContextSource,
} from "./provider-context";
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
 * Connection + key (S3a): development-only env implementation (AI_DEV_*),
 * which throws in production. S3b replaces `connections()` with
 * ai_provider_keys + app_key_reader decryption + mark_provider_key_invalid.
 *
 * `origin` must be the app's own origin (getSiteOrigin(): NEXT_PUBLIC_SITE_URL
 * in production), never a raw Host header — the continue token is sent there.
 */
function connections(): { context: ProviderContextSource; keys: KeySource; keyStatus: KeyStatusReporter } {
  const env = readDevAiEnv();
  return {
    context: createDevEnvProviderContext(env),
    keys: createDevEnvKeySource(env, () => new ProviderError("key_missing")),
    keyStatus: createDevEnvKeyStatusReporter(env, logJobEvent),
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
        keySource: conn.keys,
        keyStatus: conn.keyStatus,
      };
    },
    providerContext: conn.context,
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

/** C-7: job metadata only (ids, type, stage, provider, code) — never prompt / output text or a key. */
export function logJobEvent(event: string, fields: Record<string, string | number | boolean | null>): void {
  console.info(JSON.stringify({ event, ...fields }));
}
