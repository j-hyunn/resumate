import { AppError } from "@/lib/contracts/errors";
import { silentAiLogger } from "@/server/ai/log";
import { extractJdRequirements } from "@/server/ai/pipelines/AI-01";
import type { AiProvider } from "@/lib/contracts/enums";
import type { JdExtractionDb, JdExtractor, JdForExtraction } from "@/server/services/application/extraction";

/** The real AI-01 pipeline (same mapping as jobs/jd-extraction.ts), silent logger. */
export const productionJdExtractorForTests: JdExtractor = async (input, deps) => {
  const result = await extractJdRequirements(input, { llm: deps.llm, signal: deps.signal, callKey: deps.callKey, jobId: deps.jobId, logger: silentAiLogger });
  return { payload: result.payload, model: result.meta.model, promptVersion: result.promptVersion };
};

/** In-memory JD with the begin / apply / fail rules of the S5 RPCs (db notes). */
export class MemoryJdDb implements JdExtractionDb {
  extractionJobId: string | null = null;
  applied: { jobId: string; runGeneration: number; payload: unknown; provider: AiProvider; model: string }[] = [];
  beginError: AppError | null = null;
  applyError: AppError | null = null;
  applyStale = false;

  constructor(public state: JdForExtraction) {}

  async load(applicationProjectId: string) {
    return applicationProjectId === this.state.applicationProjectId ? structuredClone(this.state) : null;
  }

  async begin(jobDescriptionId: string, jobId: string) {
    if (this.beginError) throw this.beginError;
    if (jobDescriptionId !== this.state.jobDescriptionId) throw new AppError("not_found");
    if (this.state.extractionStatus === "succeeded") throw new AppError("already_extracted", undefined, { status: 409 });
    this.state.extractionStatus = "running";
    this.extractionJobId = jobId;
  }

  async apply(args: { jobDescriptionId: string; jobId: string; runGeneration: number; payload: unknown; provider: AiProvider; model: string }) {
    if (this.applyError) throw this.applyError;
    if (this.applyStale || this.state.extractionStatus !== "running" || this.extractionJobId !== args.jobId) return { applied: false };
    this.applied.push({ jobId: args.jobId, runGeneration: args.runGeneration, payload: args.payload, provider: args.provider, model: args.model });
    this.state.extractionStatus = "succeeded";
    return { applied: true };
  }

  async fail(_jobDescriptionId: string, jobId: string) {
    if (this.state.extractionStatus !== "running" || this.extractionJobId !== jobId) return false;
    this.state.extractionStatus = "failed";
    return true;
  }
}
