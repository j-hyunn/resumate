import type { ApplicationProgress } from "@/lib/contracts/application";
import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";
import { INSIGHT_JOB_TYPE } from "./job";

/**
 * S-13 / S-39 / S-31 기능 진행 — `insight: none | generating | ready` per
 * project: `generating` while an insight job is queued/running (it wins over
 * an older ready result [가정]), `ready` with a latest ready insight.
 */
export async function loadInsightProgress(
  user: UserSupabaseClient,
  ids: readonly string[],
): Promise<Map<string, ApplicationProgress["insight"]>> {
  const out = new Map<string, ApplicationProgress["insight"]>();
  if (ids.length === 0) return out;
  const unique = [...new Set(ids)];
  const [insights, jobs] = await Promise.all([
    user.from("insights").select("application_project_id").in("application_project_id", unique).eq("is_latest", true),
    user.from("ai_jobs").select("application_project_id").in("application_project_id", unique).eq("job_type", INSIGHT_JOB_TYPE).in("status", ["queued", "running"]),
  ]);
  if (insights.error) throw mapDbError(insights.error);
  if (jobs.error) throw mapDbError(jobs.error);
  for (const r of insights.data ?? []) out.set(r.application_project_id, "ready");
  for (const j of jobs.data ?? []) if (j.application_project_id) out.set(j.application_project_id, "generating");
  return out;
}
