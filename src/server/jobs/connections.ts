import "server-only";
import { ProviderError } from "@/server/ai/errors";
import { AppError } from "@/lib/contracts/errors";
import type { AiErrorCode } from "@/lib/contracts/enums";
import { createAiWriterClient } from "@/server/db/ai-writer";
import { createSupabaseServerClient } from "@/server/db/server";
import type { AiWriterSupabaseClient } from "@/server/db/types";
import { createAppKeySource } from "@/server/keys/app";
import { createDbKeyStatusReporter, createDbProviderContextSource, createDbRunGate } from "@/server/services/ai-connection/keys";
import { logJobEvent } from "./log";
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
import type { JobRecord } from "./types";

/**
 * Production connection + key wiring shared by the job runner, the sync AI-01
 * extraction, the AI-12 turn, and job steps that run nested work (S6 insight
 * `prepare` → ensureJdExtracted). Split out of app-runner.ts (S6) so job
 * definitions can import it without an import cycle.
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
export function connections(): {
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

