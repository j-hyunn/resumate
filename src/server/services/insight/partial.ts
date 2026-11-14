import type { InsightJobPartial, InsightRequirement, MatchStatus } from "@/lib/contracts/insight";
import { MATCH_STATUSES } from "@/lib/contracts/insight";
import type { JobRecord } from "@/server/jobs/types";
import { toV2Requirement } from "./requirements";

/**
 * S-16 부분 결과 (C-03, AI-02 응답 모드): stage-1 verdicts for `GET /api/ai-jobs/{id}` while an
 * insight job runs. R17: stage 1 is a single call, so the partial exists once the `match`
 * checkpoint is stored (ai `MatchStageResult.matches`). Evidence chips come only after the
 * insight is saved. Null before that.
 */

function isStatus(value: unknown): value is MatchStatus {
  return typeof value === "string" && (MATCH_STATUSES as readonly string[]).includes(value);
}

export function insightJobPartial(job: Pick<JobRecord, "jobType" | "stepOutputs" | "meta" | "progress">): InsightJobPartial | null {
  if (job.jobType !== "insight") return null;
  const stage = job.stepOutputs.match;
  const list = stage && typeof stage === "object" ? (stage as { matches?: unknown }).matches : undefined;
  if (!Array.isArray(list)) return null;

  const requirementMatches: InsightJobPartial["requirementMatches"] = [];
  list.forEach((raw, n) => {
    const m = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    if (typeof m.requirement_id !== "string" || !isStatus(m.status)) return;
    const requirement: InsightRequirement | null = toV2Requirement(m.requirement_id, m.requirement, n);
    requirementMatches.push({
      requirementId: m.requirement_id,
      requirement,
      status: m.status,
      rationale: typeof m.rationale === "string" ? m.rationale : "",
      missingAspect: typeof m.missing_aspect === "string" ? m.missing_aspect : null,
    });
  });
  return { kind: "insight_matches", batchesDone: 1, batchesTotal: 1, requirementMatches };
}
