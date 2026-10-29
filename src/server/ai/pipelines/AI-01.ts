import { computeRequirementsHash, type JdSentence } from "../context-pack/jd";
import { AiError } from "../errors";
import type { Llm } from "../llm";
import { silentAiLogger, type AiLogger } from "../log";
import { AI01_PROMPT_VERSION, systemBlocks, userBlocks } from "../prompts/AI-01";
import type { AiCallResult } from "../providers/types";
import { Ai01OutputSchema, type Ai01Output } from "../schemas/AI-01";
import { toApplyJdExtractionPayload, toApplyJdRequirements, type ApplyJdExtractionResult } from "../storage/jd-extraction";
import { generateStructured } from "../structured";
import {
  validateJdExtraction,
  type Ai01NormalizedOutput,
  type Ai01ValidationReport,
  type JdValidationResult,
} from "../validation/jd-extraction";

/**
 * AI-01 JD 요건 추출 (F-AP-01, F-P2-01, F-P2-02). Synchronous single call
 * (C-6 동기, job_type `jd_extraction`): light tier, low reasoning, structured
 * output → V-6 → server validation (sentence ids) → p_result for
 * apply_jd_extraction. No career data in the input.
 *
 * Plain async function: no request, DB, or after(). The route (api-engineer)
 * runs begin_jd_extraction → this → apply_jd_extraction and records usage
 * through createLlm's onCall.
 *
 * Throws:
 * - ProviderError (C-11 codes, incl. timeout / canceled from `signal`) as is;
 * - AiError("schema_invalid", retryable: false) after V-6 or "0 requirements
 *   on a likely JD" twice (the one retry is spent here);
 * - AiError("not_a_jd", retryable: false) when there are no sentences (no call)
 *   or the model says it is not a JD and no requirement survives [가정 S5-4].
 */

export const AI01_TIER = "light" as const;
export const AI01_CALL_KEY = "jd_extraction";
/** AI spec 7.2: output 1.5k–2.5k incl. reasoning; headroom for long JDs. */
export const AI01_MAX_OUTPUT_TOKENS = 8192;

export type Ai01Input = {
  /** job_descriptions.sentences (splitJdSentences). */
  sentences: readonly JdSentence[];
  /** User-entered values only (*_source = 'user'); reference for the model. */
  companyName: string | null;
  positionTitle: string | null;
};

export type Ai01Deps = {
  llm: Llm;
  /** ai_usage_records.call_key; defaults to AI01_CALL_KEY. */
  callKey?: string;
  /** abort("canceled") = user cancel; any other reason (30s deadline) = timeout. */
  signal?: AbortSignal;
  logger?: AiLogger;
  jobId?: string | null;
};

export type JdExtractionResult = {
  output: Ai01NormalizedOutput;
  requirementsHash: string;
  report: Ai01ValidationReport;
  /** p_result for apply_jd_extraction. */
  payload: ApplyJdExtractionResult;
  promptVersion: string;
  /** model, usage summed over attempts, latency of the last call. */
  meta: AiCallResult;
  attempts: number;
};

export async function extractJdRequirements(input: Ai01Input, deps: Ai01Deps): Promise<JdExtractionResult> {
  if (input.sentences.length === 0) throw new AiError("not_a_jd", { retryable: false });

  const sentenceIds = new Set(input.sentences.map((s) => s.sid));
  const logger = deps.logger ?? silentAiLogger;
  let validated: JdValidationResult | null = null;
  let emptyRetries = 0;

  const accept = (value: Ai01Output): boolean => {
    const result = validateJdExtraction(value, sentenceIds);
    validated = result;
    if (result.value.requirements.length > 0) return true;
    // [가정 S5-4] Not a JD and nothing usable → stop (no retry); a likely JD with
    // nothing left takes the schema_invalid retry path.
    if (!result.value.is_likely_jd) {
      log(logger, deps.jobId, result.report, { not_a_jd: 1 });
      throw new AiError("not_a_jd", { retryable: false });
    }
    emptyRetries++;
    return false;
  };

  let structured;
  try {
    structured = await generateStructured(
      deps.llm,
      {
        feature: "AI-01",
        promptVersion: AI01_PROMPT_VERSION,
        callKey: deps.callKey ?? AI01_CALL_KEY,
        tier: AI01_TIER,
        systemBlocks: systemBlocks(),
        userBlocks: userBlocks(input),
        maxOutputTokens: AI01_MAX_OUTPUT_TOKENS,
        reasoningLevel: "low",
        signal: deps.signal,
      },
      Ai01OutputSchema,
      { accept },
    );
  } catch (err) {
    if (err instanceof AiError && err.code === "schema_invalid" && emptyRetries > 0) {
      log(logger, deps.jobId, (validated as JdValidationResult | null)?.report ?? null, { empty_requirements: emptyRetries });
    }
    throw err;
  }

  const result = validated as JdValidationResult | null;
  if (!result) throw new AiError("schema_invalid", { retryable: false }); // unreachable: accept ran on success
  const requirementsHash = computeRequirementsHash(toApplyJdRequirements(result.value));
  log(logger, deps.jobId, result.report, emptyRetries ? { empty_requirements: emptyRetries } : {});
  return {
    output: result.value,
    requirementsHash,
    report: result.report,
    payload: toApplyJdExtractionPayload({ output: result.value, report: result.report, requirementsHash, promptVersion: AI01_PROMPT_VERSION }),
    promptVersion: AI01_PROMPT_VERSION,
    meta: structured.meta,
    attempts: structured.attempts,
  };
}

/** C-7: counts only. */
function log(logger: AiLogger, jobId: string | null | undefined, report: Ai01ValidationReport | null, extra: Record<string, number>): void {
  logger({
    event: "ai_validation",
    jobId: jobId ?? null,
    feature: "AI-01",
    promptVersion: AI01_PROMPT_VERSION,
    stats: { ...(report ?? {}), ...extra },
  });
}
