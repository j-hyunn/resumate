import type { InsightJobPartial, MatchStatus } from "@/lib/contracts/insight";
import { MATCH_STATUSES } from "@/lib/contracts/insight";
import type { JobRecord } from "@/server/jobs/types";

/**
 * S-16 부분 결과 (C-03, AI-02 응답 모드): stage-1 verdicts for
 * `GET /api/ai-jobs/{id}` while an insight job runs — from the completed
 * `match` checkpoint, or the batches saved so far (`_meta.partials.match`).
 * Evidence chips come only after the insight is saved. Null before any batch.
 */

type BatchLike = { batchIndex?: unknown; matches?: unknown };

function batchesOf(value: unknown): BatchLike[] {
  if (!value || typeof value !== "object") return [];
  const list = (value as { batches?: unknown }).batches;
  return Array.isArray(list) ? (list as BatchLike[]) : [];
}

function isStatus(value: unknown): value is MatchStatus {
  return typeof value === "string" && (MATCH_STATUSES as readonly string[]).includes(value);
}

export function insightJobPartial(job: Pick<JobRecord, "jobType" | "stepOutputs" | "meta" | "progress">): InsightJobPartial | null {
  if (job.jobType !== "insight") return null;
  const complete = job.stepOutputs.match !== undefined;
  const batches = batchesOf(complete ? job.stepOutputs.match : job.meta.partials?.match);
  if (batches.length === 0) return null;

  const ordered = [...batches].sort((a, b) => Number(a.batchIndex) - Number(b.batchIndex));
  const requirementMatches: InsightJobPartial["requirementMatches"] = [];
  for (const batch of ordered) {
    if (!Array.isArray(batch.matches)) continue;
    for (const m of batch.matches as Array<Record<string, unknown>>) {
      if (typeof m.requirement_id !== "string" || !isStatus(m.status)) continue;
      requirementMatches.push({
        requirementId: m.requirement_id,
        status: m.status,
        rationale: typeof m.rationale === "string" ? m.rationale : "",
        missingAspect: typeof m.missing_aspect === "string" ? m.missing_aspect : null,
      });
    }
  }
  const total = complete ? batches.length : job.progress.stage === "match" ? job.progress.total : null;
  return { kind: "insight_matches", batchesDone: batches.length, batchesTotal: total, requirementMatches };
}
