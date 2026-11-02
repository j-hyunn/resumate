import "server-only";
import { createLlm } from "@/server/ai/llm";
import { consoleAiLogger } from "@/server/ai/log";
import { extractJdRequirements } from "@/server/ai/pipelines/AI-01";
import { createAiWriterClient } from "@/server/db/ai-writer";
import type { UserSupabaseClient } from "@/server/db/types";
import { createDbRunGate } from "@/server/services/ai-connection/keys";
import { createJdExtractionDb } from "@/server/services/application/db";
import type { JdExtractionDeps, JdExtractor } from "@/server/services/application/extraction";
import { connections } from "./connections";
import { logJobEvent } from "./log";
import { createSupabaseJobStore } from "./supabase-store";
import { createSupabaseUsageStore } from "./supabase-usage";

/** ai-pipeline AI-01, narrowed to what ensureJdExtracted needs (payload = apply_jd_extraction p_result). */
export const productionJdExtractor: JdExtractor = async (input, deps) => {
  const result = await extractJdRequirements(input, { llm: deps.llm, signal: deps.signal, callKey: deps.callKey, jobId: deps.jobId, logger: consoleAiLogger });
  return { payload: result.payload, model: result.meta.model, promptVersion: result.promptVersion };
};

/**
 * Production wiring of the sync AI-01 extraction (S5). Same connection path as
 * the job runner and the AI-12 turn (S3b): provider context from the user
 * session, keys decrypted per call through app_key_reader, key status + run
 * gate + begin/apply/fail through app_ai_writer. S6–S8 job steps build the
 * same deps for their first step (D-30).
 */
export function createJdExtractionDeps(user: UserSupabaseClient, userId: string): JdExtractionDeps {
  const conn = connections();
  const writer = createAiWriterClient(userId);
  return {
    userId,
    jds: createJdExtractionDb(user, writer),
    store: createSupabaseJobStore(writer),
    usage: createSupabaseUsageStore(writer),
    providerContext: conn.context,
    keySource: conn.keysFor(userId),
    keyStatus: conn.statusFor(writer),
    runGate: conn.runGate ? createDbRunGate(writer) : null,
    createLlm: (input) => createLlm(input),
    extract: productionJdExtractor,
    log: logJobEvent,
  };
}
