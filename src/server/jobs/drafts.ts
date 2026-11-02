import "server-only";
import type { CareerRows } from "@/server/ai/context-pack/career-rows";
import { loadCareerRows } from "@/server/ai/context-pack/career-rows";
import { createLlm } from "@/server/ai/llm";
import { consoleAiLogger } from "@/server/ai/log";
import {
  AI03_PROMPT_VERSION,
  AI03_TIER,
  buildCareerDescriptionContext,
  computeCareerDescriptionInputHash,
  planCareerDescription,
  streamCareerDescription,
  type CareerDescriptionContext,
} from "@/server/ai/pipelines/AI-03";
import {
  AI04_PROMPT_VERSION,
  AI04_TIER,
  buildCoverLetterContext,
  computeCoverLetterInputHash,
  streamCoverLetterSection,
  type CoverLetterContext,
} from "@/server/ai/pipelines/AI-04";
import {
  AI11_PROMPT_VERSION,
  AI11_TIER,
  DraftSourceRankingOutputSchema,
  buildRankingContext,
  computeDraftSourceRankingInputHash,
  rankDraftSources,
  selectionFromInsightPriorities,
  selectionFromRankingOutput,
  type RankingContext,
} from "@/server/ai/pipelines/AI-11";
import { createAiWriterClient } from "@/server/db/ai-writer";
import type { AiWriterSupabaseClient, UserSupabaseClient } from "@/server/db/types";
import { createDbRunGate } from "@/server/services/ai-connection/keys";
import { createDraftStore } from "@/server/services/drafts/db";
import type { DraftAiDeps, DraftPipelines } from "@/server/services/drafts/types";
import { connections } from "./connections";
import { logJobEvent } from "./log";
import { createSupabaseJobStore } from "./supabase-store";
import { createSupabaseUsageStore } from "./supabase-usage";

/**
 * Production wiring of the S7 draft AI paths (AI-11 sync, AI-03 / AI-04 SSE):
 * same connection path as the S4 turn and the S5 extraction (provider context
 * from the user session, keys per call through app_key_reader, key status +
 * run gate + RPCs through app_ai_writer). The pipelines are the ai-pipeline
 * functions behind the service's narrow interfaces (ids, never aliases).
 */

export const productionDraftPipelines: DraftPipelines = {
  ranking: {
    tier: AI11_TIER,
    promptVersion: AI11_PROMPT_VERSION,
    buildContext: (input) => buildRankingContext(input),
    inputHash: (parts) => computeDraftSourceRankingInputHash(parts),
    async rank(context, deps) {
      const r = await rankDraftSources({ context: context as RankingContext }, { llm: deps.llm, signal: deps.signal, jobId: deps.jobId, callKey: deps.callKey, logger: consoleAiLogger });
      return {
        includedProjectIds: r.includedProjectIds,
        projectOrder: r.projectOrder,
        includedExperienceIds: r.includedExperienceIds,
        includedEducationIds: r.includedEducationIds,
        ranking: r.ranking,
        output: r.output,
        promptVersion: r.promptVersion,
        model: r.model,
      };
    },
    fromOutput(output, careerRows) {
      const parsed = DraftSourceRankingOutputSchema.safeParse(output);
      return parsed.success ? selectionFromRankingOutput(parsed.data, careerRows) : null;
    },
    fromInsight: (priorities, careerRows) => selectionFromInsightPriorities(priorities, careerRows),
  },
  careerDescription: {
    tier: AI03_TIER,
    promptVersion: AI03_PROMPT_VERSION,
    plan: (input) => planCareerDescription(input) as ReturnType<DraftPipelines["careerDescription"]["plan"]>,
    buildContext: (input) => buildCareerDescriptionContext({ ...input, plan: input.plan as Parameters<typeof buildCareerDescriptionContext>[0]["plan"] }),
    inputHash: (parts) => computeCareerDescriptionInputHash(parts),
    stream: (input, deps) =>
      streamCareerDescription(
        { context: input.context as CareerDescriptionContext, sections: input.sections },
        { llm: deps.llm, signal: deps.signal, jobId: deps.jobId, callKey: deps.callKey, logger: consoleAiLogger, persist: (p) => deps.persist(p) },
      ),
  },
  coverLetter: {
    tier: AI04_TIER,
    promptVersion: AI04_PROMPT_VERSION,
    buildContext: (input) => buildCoverLetterContext(input),
    inputHash: (parts) => computeCoverLetterInputHash(parts),
    stream: (input, deps) =>
      streamCoverLetterSection(
        { context: input.context as CoverLetterContext },
        { llm: deps.llm, signal: deps.signal, jobId: deps.jobId, callKey: deps.callKey, adjustCallKey: deps.adjustCallKey, logger: consoleAiLogger, persist: (p) => deps.persist(p) },
      ),
  },
};

export function createDraftAiDeps(user: UserSupabaseClient, userId: string): DraftAiDeps {
  const conn = connections();
  const writer = createAiWriterClient(userId);
  return {
    userId,
    user,
    writer,
    store: createSupabaseJobStore(writer),
    usage: createSupabaseUsageStore(writer),
    providerContext: conn.context,
    keySource: conn.keysFor(userId),
    keyStatus: conn.statusFor(writer),
    runGate: conn.runGate ? createDbRunGate(writer) : null,
    createLlm: (input) => createLlm(input),
    drafts: createDraftStore(writer),
    pipelines: productionDraftPipelines,
    loadCareerRows: (db: UserSupabaseClient | AiWriterSupabaseClient): Promise<CareerRows> => loadCareerRows(db as AiWriterSupabaseClient),
    log: logJobEvent,
  };
}
