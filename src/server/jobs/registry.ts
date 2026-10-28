import type { AiJobType, ConnectionTier } from "@/lib/contracts/enums";
import type { JobStep, JobTypeDefinition, JsonObject } from "./types";

/**
 * Job type registry. Each AI feature registers its steps once at module load
 * (S5+: `registerJobType({ jobType: "insight", modelTier: "default", steps: [...], freeTierSteps })`).
 *
 * Free tier (C-12): `freeTierSteps(params)` unfolds parallel work into one
 * provider call per step; the runner spaces steps FREE_TIER_MIN_INTERVAL_MS apart.
 *
 * Retry unit (QA-S3a-08, rule for S5+): the runner retries a STEP, and C-11.3
 * counts retries per call. A paid-tier step that makes several calls in
 * parallel (AI-02 match batches, AI-06 answers) must not re-call the calls that
 * already succeeded when one fails: either save each call's validated result
 * itself (result table rows keyed by call, read back via `ctx.previous` / the
 * DB on the retry) and skip those, or split the work into one step per call.
 * With one call per step (free tier), step = call and nothing extra is needed.
 *
 * Rule (QA-S3-08): a step's returned value is stored as its checkpoint in
 * ai_jobs.step_outputs. Return only VALIDATED, storage-form data (or ids of
 * rows the step saved) — never raw model output that hasn't passed C-3.
 */
const registry = new Map<AiJobType, JobTypeDefinition<never>>();

export function validateSteps(jobType: string, steps: readonly JobStep<never>[]): void {
  if (steps.length === 0) throw new Error(`registerJobType(${jobType}): at least one step`);
  if (steps.some((s) => s.stage.startsWith("_"))) throw new Error(`registerJobType(${jobType}): stage names can't start with "_" (reserved for runner meta)`);
  const stages = new Set(steps.map((s) => s.stage));
  if (stages.size !== steps.length) throw new Error(`registerJobType(${jobType}): duplicate stage`);
}

export function registerJobType<TLlm>(def: JobTypeDefinition<TLlm>): void {
  validateSteps(def.jobType, def.steps as unknown as JobStep<never>[]);
  registry.set(def.jobType, def as unknown as JobTypeDefinition<never>);
}

/**
 * The steps a job runs: `freeTierSteps(params)` on the free tier when defined,
 * else `steps` (C-12). Validated on every resolve (free-tier steps depend on params).
 */
export function stepsFor<TLlm>(def: JobTypeDefinition<TLlm>, connectionTier: ConnectionTier, params: JsonObject): JobStep<TLlm>[] {
  const steps = connectionTier === "free" && def.freeTierSteps ? def.freeTierSteps(params) : def.steps;
  validateSteps(def.jobType, steps as unknown as JobStep<never>[]);
  return steps;
}

export function getJobType<TLlm>(jobType: AiJobType): JobTypeDefinition<TLlm> | undefined {
  return registry.get(jobType) as unknown as JobTypeDefinition<TLlm> | undefined;
}

/** Test-only. */
export function unregisterJobType(jobType: AiJobType): void {
  registry.delete(jobType);
}
