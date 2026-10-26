import "server-only";
import { after } from "next/server";
import { createAnthropicAiClient } from "@/server/ai/anthropic-client";
import type { AiClient } from "@/server/ai/client";
import { createAiWriterClient } from "@/server/db/ai-writer";
import { getServerEnv } from "@/server/env";
import { signContinueToken } from "./continue-token";
import { createSupabaseLedger } from "./ledger";
import { getJobType } from "./registry";
import { createJobRunner, type JobRunner } from "./runner";
import { createSupabaseJobStore } from "./supabase-store";
import type { JobRef } from "./types";

/**
 * Production wiring of the runner: app_ai_writer client per user, Anthropic
 * AiClient, `after()` scheduling, and the self-invoke continuation.
 *
 * `origin` must be the app's own origin (getSiteOrigin(): NEXT_PUBLIC_SITE_URL
 * in production), never a raw Host header — the continue token is sent there.
 */
export function createAppJobRunner(origin: string): JobRunner<AiClient> {
  let ai: AiClient | undefined;
  return createJobRunner<AiClient>({
    forUser(userId) {
      const db = createAiWriterClient(userId);
      return {
        db,
        store: createSupabaseJobStore(db),
        ledger: createSupabaseLedger(db),
        // Lazy so status reads don't need ANTHROPIC_API_KEY.
        get ai() {
          ai ??= createAnthropicAiClient();
          return ai;
        },
      };
    },
    getDefinition: (jobType) => getJobType<AiClient>(jobType),
    schedule: (task) => after(task),
    continueJob: (ref) => selfInvokeContinue(origin, ref),
    log: logJobEvent,
  });
}

async function selfInvokeContinue(origin: string, ref: JobRef): Promise<void> {
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

/** C-7: job metadata only (ids, type, stage, code) — never prompt or output text. */
function logJobEvent(event: string, fields: Record<string, string | number | boolean | null>): void {
  console.info(JSON.stringify({ event, ...fields }));
}
