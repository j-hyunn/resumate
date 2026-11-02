import "server-only";
import { consoleAiLogger } from "@/server/ai/log";
import { createLlm } from "@/server/ai/llm";
import { createDbRunGate } from "@/server/services/ai-connection/keys";
import { createJdExtractionDb } from "@/server/services/application/db";
import { ensureJdExtracted } from "@/server/services/application/extraction";
import { createInsightStore } from "@/server/services/insight/db";
import { createInsightJobDefinition, type InsightJdExtractor } from "@/server/services/insight/job";
import { createAi02InsightPipeline } from "@/server/services/insight/pipeline";
import { connections } from "./connections";
import { productionJdExtractor } from "./jd-extraction";
import { logJobEvent } from "./log";
import { createStaticProviderContext } from "./provider-context";
import { createSupabaseJobStore } from "./supabase-store";
import { createSupabaseUsageStore } from "./supabase-usage";

/** AI-02 with the console AI logger (C-7 metadata only). */
export const productionInsightPipeline = createAi02InsightPipeline(consoleAiLogger);

/**
 * D-30 inside the job: ensureJdExtracted with the S5 deps, except the
 * connection is the current run's provider + tier (fixed while it runs, F-AI-03 (2); the
 * step may run in a cron / continue invocation without the user's cookies)
 * and the JD is read through app_ai_writer (select grant on job_descriptions).
 * check_ai_run_allowed still gates the extraction job (key / consent now).
 */
export const productionInsightJdExtractor: InsightJdExtractor = (ctx, applicationProjectId) => {
  const conn = connections();
  return ensureJdExtracted(
    {
      userId: ctx.userId,
      jds: createJdExtractionDb(ctx.db, ctx.db),
      store: createSupabaseJobStore(ctx.db),
      usage: createSupabaseUsageStore(ctx.db),
      providerContext: createStaticProviderContext({ provider: ctx.provider, connectionTier: ctx.connectionTier, keyStatus: "valid" }),
      keySource: conn.keysFor(ctx.userId),
      keyStatus: conn.statusFor(ctx.db),
      runGate: conn.runGate ? createDbRunGate(ctx.db) : null,
      createLlm: (input) => createLlm(input),
      extract: productionJdExtractor,
      log: logJobEvent,
    },
    applicationProjectId,
    { signal: ctx.signal },
  );
};

export const insightJobDefinition = createInsightJobDefinition({
  pipeline: productionInsightPipeline,
  storeFor: createInsightStore,
  ensureJd: productionInsightJdExtractor,
  log: logJobEvent,
});
