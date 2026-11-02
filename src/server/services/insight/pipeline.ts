import type { AiLogger } from "@/server/ai/log";
import {
  AI02_BATCH_SIZE,
  AI02_PROMPT_VERSION,
  AI02_TIER,
  buildInsightContext,
  computeInsightInputHash,
  finalizeInsight,
  matchRequirements,
  regenerateSynthesis,
  synthesizeOnce,
  type InsightContext,
  type MatchBatchResult,
  type SynthesisAttempt,
} from "@/server/ai/pipelines/AI-02";
import type { InsightPipeline } from "./job";

/** ai-pipeline AI-02 behind the job's pipeline interface (ai notes "api-engineer용 시그니처"). Next-free. */
export function createAi02InsightPipeline(logger?: AiLogger): InsightPipeline<InsightContext, MatchBatchResult, SynthesisAttempt> {
  return {
    promptVersion: AI02_PROMPT_VERSION,
    tier: AI02_TIER,
    batchSize: AI02_BATCH_SIZE,
    buildContext: (inputs) =>
      buildInsightContext({
        careerRows: inputs.careerRows,
        jobDescriptionId: inputs.jd.jobDescriptionId,
        jobDescriptionUpdatedAt: inputs.jd.updatedAt,
        sentences: inputs.jd.sentences,
        requirements: inputs.requirements,
        positionTitle: inputs.jd.positionTitle,
        seniorityLabel: inputs.jd.seniorityLabel,
      }),
    requirementIds: (context) => context.requirements.map((r) => r.id),
    hashes: (context) => ({ careerSnapshotHash: context.careerSnapshotHash, requirementsHash: context.requirementsHash }),
    match: (input, deps) => matchRequirements(input, { ...deps, logger }),
    synthesize: (input, deps) => synthesizeOnce(input, { ...deps, logger }),
    violations: (attempt) => attempt.violations,
    regenerate: (input, deps) => regenerateSynthesis(input, { ...deps, logger }),
    finalize: (input) => {
      const out = finalizeInsight({ ...input, logger });
      return { payload: out.payload, inputHash: out.inputHash };
    },
    inputHash: (parts) => computeInsightInputHash(parts),
  };
}
