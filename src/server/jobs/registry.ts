import type { AiJobType } from "@/lib/contracts/enums";
import type { JobTypeDefinition } from "./types";

/**
 * Job type registry. Each AI feature registers its steps once at module load
 * (S5+: `registerJobType({ jobType: "insight", steps: [...], usage: { feature: "insight", units: 1 } })`).
 *
 * Rule (QA-S3-08): a step's returned value is stored as its checkpoint in
 * ai_jobs.step_outputs. Return only VALIDATED, storage-form data (or ids of
 * rows the step saved) — never raw model output that hasn't passed C-3.
 */
const registry = new Map<AiJobType, JobTypeDefinition<never>>();

export function registerJobType<TAi>(def: JobTypeDefinition<TAi>): void {
  if (def.steps.length === 0) throw new Error(`registerJobType(${def.jobType}): at least one step`);
  if (def.steps.some((s) => s.stage.startsWith("_"))) throw new Error(`registerJobType(${def.jobType}): stage names can't start with "_" (reserved for runner meta)`);
  const stages = new Set(def.steps.map((s) => s.stage));
  if (stages.size !== def.steps.length) throw new Error(`registerJobType(${def.jobType}): duplicate stage`);
  registry.set(def.jobType, def as unknown as JobTypeDefinition<never>);
}

export function getJobType<TAi>(jobType: AiJobType): JobTypeDefinition<TAi> | undefined {
  return registry.get(jobType) as unknown as JobTypeDefinition<TAi> | undefined;
}

/** Test-only. */
export function unregisterJobType(jobType: AiJobType): void {
  registry.delete(jobType);
}
