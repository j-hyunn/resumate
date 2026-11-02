import { hashCanonical } from "./hash";
import type { ProviderId } from "./providers/types";

/**
 * C-6 동일 입력 재사용 (PRD 6.4):
 * input_hash = hash(feature, prompt_version, provider, model, career_snapshot_hash, requirements_hash, feature params).
 * (v4) provider is part of the hash: switching the active provider never reuses a result.
 *
 * `feature` is the ai_jobs.job_type. `params` must hold only what changes the
 * output (selection ids, tone, question text) — not request ids or timestamps.
 * Bumping a prompt_version changes the hash, so old results stop being reused.
 * Reuse is scoped to one application project by the lookup query, not by the hash.
 */
export type InputHashParts = {
  feature: string;
  promptVersion: string;
  provider: ProviderId;
  model: string;
  careerSnapshotHash: string | null;
  requirementsHash: string | null;
  params?: Record<string, unknown>;
};

/** 2: provider added (S3a, C-6 v4). */
export const INPUT_HASH_VERSION = 2;

export function computeInputHash(parts: InputHashParts): string {
  return hashCanonical({
    v: INPUT_HASH_VERSION,
    feature: parts.feature,
    prompt_version: parts.promptVersion,
    provider: parts.provider,
    model: parts.model,
    career_snapshot_hash: parts.careerSnapshotHash,
    requirements_hash: parts.requirementsHash,
    params: parts.params ?? {},
  });
}
