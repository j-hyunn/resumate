import type { InsightJobPartial, MatchStatus } from "@/lib/contracts/insight";
import { MATCH_STATUSES } from "@/lib/contracts/insight";
import type { JobRecord } from "@/server/jobs/types";
import { INSIGHT_MATCH_STAGE_VERSION } from "./job";

/**
 * S-16 부분 결과 (C-03, AI-02 응답 모드): stage-1 verdicts for `GET /api/ai-jobs/{id}` while an
 * insight job runs. Stage 1 is a single call, so the partial exists once the `match` checkpoint
 * (ai `MatchStageResult`, `v: 3`, `items[]` with `MT-n`) is stored. Evidence chips come only after
 * the insight is saved. Null before that (and for an older checkpoint shape).
 */

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function isStatus(value: unknown): value is MatchStatus {
  return typeof value === "string" && (MATCH_STATUSES as readonly string[]).includes(value);
}

export function insightJobPartial(job: Pick<JobRecord, "jobType" | "stepOutputs" | "meta" | "progress">): InsightJobPartial | null {
  if (job.jobType !== "insight") return null;
  const stage = obj(job.stepOutputs.match);
  if (stage.v !== INSIGHT_MATCH_STAGE_VERSION || !Array.isArray(stage.items)) return null;

  const requirementMatches = stage.items.flatMap((raw) => {
    const m = obj(raw);
    if (typeof m.match_key !== "string" || typeof m.requirement_text !== "string" || !isStatus(m.status)) return [];
    return [
      {
        matchKey: m.match_key,
        requirementText: m.requirement_text,
        sentenceIds: strs(m.sids),
        status: m.status,
        rationale: typeof m.rationale === "string" ? m.rationale : "",
        missingAspect: typeof m.missing_aspect === "string" ? m.missing_aspect : null,
      },
    ];
  });
  return { kind: "insight_matches", requirementMatches };
}
