import "server-only";
import { consoleAiLogger } from "@/server/ai/log";
import { createInsightStore } from "@/server/services/insight/db";
import { createInsightJobDefinition } from "@/server/services/insight/job";
import { createAi02InsightPipeline } from "@/server/services/insight/pipeline";
import { logJobEvent } from "./log";

/** AI-02 with the console AI logger (C-7 metadata only). */
export const productionInsightPipeline = createAi02InsightPipeline(consoleAiLogger);

/** R17: no JD extraction step (D-30 removed) — the job reads the JD raw text directly. */
export const insightJobDefinition = createInsightJobDefinition({
  pipeline: productionInsightPipeline,
  storeFor: createInsightStore,
  log: logJobEvent,
});
