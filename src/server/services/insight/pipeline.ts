import type { AiLogger } from "@/server/ai/log";
import {
  AI02_PROMPT_VERSION,
  AI02_TIER,
  buildInsightContext,
  computeInsightInputHash,
  finalizeInsight,
  matchRequirements,
  regenerateSynthesis,
  synthesizeOnce,
  type InsightContext,
  type MatchStageResult,
  type SynthesisAttempt,
} from "@/server/ai/pipelines/AI-02";
import type { InsightPipeline } from "./job";

/**
 * ai-pipeline AI-02 behind the job's pipeline interface (R17 ai notes "인터페이스" §3: the JD
 * is its raw-text sentences + raw_text_hash; stage 1 is one call). Next-free.
 */
export function createAi02InsightPipeline(logger?: AiLogger): InsightPipeline<InsightContext, MatchStageResult, SynthesisAttempt> {
  return {
    promptVersion: AI02_PROMPT_VERSION,
    tier: AI02_TIER,
    buildContext: (inputs) =>
      buildInsightContext({
        careerRows: inputs.careerRows,
        jobDescriptionId: inputs.jd.jobDescriptionId,
        jobDescriptionUpdatedAt: inputs.jd.updatedAt,
        sentences: inputs.jd.sentences,
        positionTitle: inputs.jd.positionTitle,
        rawTextHash: inputs.jd.rawTextHash,
      }),
    hashes: (context) => ({ careerSnapshotHash: context.careerSnapshotHash, jdTextHash: context.jdTextHash }),
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
