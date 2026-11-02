import { aiErrorEvent } from "@/lib/contracts/ai";
import { toAiFailure, type JdExtractionResponse } from "@/lib/contracts/application";
import type { UserSupabaseClient } from "@/server/db/types";
import { alreadyExtracted, ensureJdExtracted, type JdExtractionDeps } from "./extraction";
import { getJdView } from "./read";

/**
 * Body of `POST /api/application-projects/{id}/jd-extraction` (C-6 동기).
 * D-19: an extracted JD is never re-extracted → 409 `already_extracted`.
 * Every C-11 failure (connection gate included) is a `failed` body with the
 * SSE `error` field shape plus the refreshed JD view (raw text stays readable).
 */
export async function runJdExtraction(user: UserSupabaseClient, deps: JdExtractionDeps, applicationProjectId: string): Promise<JdExtractionResponse> {
  const result = await ensureJdExtracted(deps, applicationProjectId);
  if (result.status === "already_extracted") throw alreadyExtracted();
  const jd = await getJdView(user, applicationProjectId);
  if (result.status === "succeeded") return { status: "succeeded", jobId: result.jobId, jd };
  const error = toAiFailure(aiErrorEvent(result.code, { retryAfter: result.retryAfter, quotaResetsAt: result.quotaResetsAt }));
  return { status: "failed", jobId: result.jobId, error, jd };
}
