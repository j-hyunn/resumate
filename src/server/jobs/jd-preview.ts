import "server-only";
import { createLlm } from "@/server/ai/llm";
import { consoleAiLogger } from "@/server/ai/log";
import { extractJdRequirements, jdPreviewSummary } from "@/server/ai/pipelines/AI-01";
import { createAiWriterClient } from "@/server/db/ai-writer";
import { createDbRunGate } from "@/server/services/ai-connection/keys";
import type { JdPreviewDeps, JdPreviewExtractor } from "@/server/services/application/preview";
import { connections } from "./connections";
import { logJobEvent } from "./log";
import { createSupabaseJobStore } from "./supabase-store";
import { createSupabaseUsageStore } from "./supabase-usage";

/**
 * Production wiring of the A2 요건 미리 보기 (R15, CF-A17). Same connection path as the
 * 생성 뒤 extraction (`jd-extraction.ts`): provider context from the user session, keys decrypted
 * per call through `app_key_reader`, key status and the run gate through `app_ai_writer`.
 *
 * `payload` is the validated AI-01 result — exactly the `p_result` shape
 * `apply_jd_extraction` takes — and it is what goes into `ai_jobs.output`, because
 * `create_application_project` applies it through the same internal function
 * (`private.jd_apply_extraction_result`, db notes ②-3).
 */
export const productionJdPreviewExtractor: JdPreviewExtractor = async (input, deps) => {
  const result = await extractJdRequirements(
    { sentences: input.sentences, companyName: input.companyName, positionTitle: input.positionTitle, today: input.today },
    { llm: deps.llm, signal: deps.signal, callKey: deps.callKey, jobId: deps.jobId, logger: consoleAiLogger },
  );
  return { payload: result.payload, summary: jdPreviewSummary(result), model: result.meta.model, promptVersion: result.promptVersion };
};

export function createJdPreviewDeps(userId: string): JdPreviewDeps {
  const conn = connections();
  const writer = createAiWriterClient(userId);
  return {
    userId,
    store: createSupabaseJobStore(writer),
    usage: createSupabaseUsageStore(writer),
    providerContext: conn.context,
    keySource: conn.keysFor(userId),
    keyStatus: conn.statusFor(writer),
    runGate: conn.runGate ? createDbRunGate(writer) : null,
    createLlm: (input) => createLlm(input),
    extract: productionJdPreviewExtractor,
    log: logJobEvent,
  };
}
