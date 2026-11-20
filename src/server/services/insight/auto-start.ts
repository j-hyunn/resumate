import type { InsightSkipReason } from "@/lib/contracts/application";
import { isAppError } from "@/lib/contracts/errors";
import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";
import { getDataReadiness } from "@/server/services/career";
import { loadInsightInputs } from "./db";
import { INSIGHT_JOB_TYPE } from "./job";
import { startInsight, type StartInsightDeps } from "./start";

/**
 * JR-6 (decisions 4.24 #10, DM 2.6.2 "인사이트 자동 시작"): after `create_application_project`
 * made a NEW row, the create Server Action starts the insight through the same service as the
 * manual start (`startInsight` — readiness, connection gate, `jd_no_sentences`, reuse, one job per
 * project) when every condition holds:
 *
 *   AI connected (active provider, key `valid` / `needs_check`, current consent) → D-01
 *   (`features.insight.ready`) → JD sentences ≥ 1 → no insight job queued / running.
 *
 * Otherwise — or when starting throws — nothing is started and no error escapes: the project was
 * already created. The outcome only tells the screen what happened (`insightJobId` /
 * `insightSkipReason`). Usage is recorded by the runner exactly as for a manual start (4.24 #20).
 */

export type AutoStartInsightDeps = StartInsightDeps & {
  /** Override for tests (default: a queued / running `insight` job on the project, user session). */
  hasInsightInProgress?: (db: UserSupabaseClient, applicationProjectId: string) => Promise<boolean>;
  /** C-7 metadata only (ids and codes). */
  log?: (event: string, fields: Record<string, string | number | boolean | null>) => void;
};

export type AutoStartInsightOutcome = { insightJobId: string | null; insightSkipReason: InsightSkipReason | null };

const skip = (reason: InsightSkipReason): AutoStartInsightOutcome => ({ insightJobId: null, insightSkipReason: reason });

async function insightInProgress(db: UserSupabaseClient, applicationProjectId: string): Promise<boolean> {
  const { count, error } = await db
    .from("ai_jobs")
    .select("id", { count: "exact", head: true })
    .eq("application_project_id", applicationProjectId)
    .eq("job_type", INSIGHT_JOB_TYPE)
    .in("status", ["queued", "running"]);
  if (error) throw mapDbError(error);
  return (count ?? 0) > 0;
}

/** Error codes of the shared start path → the skip reason the screen gets. */
function reasonOf(err: unknown): InsightSkipReason {
  if (!isAppError(err)) return "start_failed";
  switch (err.code) {
    case "ai_not_connected":
    case "key_missing":
      return "ai_not_connected";
    case "key_invalid":
      return "key_invalid";
    case "ai_consent_required":
      return "consent_required";
    case "insufficient_data":
      return "insufficient_data";
    case "jd_no_sentences":
      return "no_sentences";
    default:
      return "start_failed";
  }
}

export async function autoStartInsight(deps: AutoStartInsightDeps, applicationProjectId: string): Promise<AutoStartInsightOutcome> {
  const log = deps.log ?? (() => {});
  try {
    // 1. AI connection (forUser throws ai_consent_required for a missing / outdated consent).
    const context = await deps.providerContext.forUser(deps.userId);
    if (!context) return skip("ai_not_connected");
    if (context.keyStatus === "invalid") return skip("key_invalid");

    // 2. D-01 — insufficient data never calls AI.
    const readiness = await (deps.getReadiness ?? getDataReadiness)(deps.user);
    if (!readiness.features.insight.ready) return skip("insufficient_data");

    // 3. sentences ≥ 1 (the create RPC already refuses 0; kept so the rule reads like the DM).
    const inputs = await (deps.loadInputs ?? loadInsightInputs)(deps.user, applicationProjectId);
    if (!inputs) return skip("start_failed");
    if (inputs.jd.sentences.length === 0) return skip("no_sentences");

    // 4. one insight job per project (D-34): never follow another run from the create response.
    if (await (deps.hasInsightInProgress ?? insightInProgress)(deps.user, applicationProjectId)) return skip("in_progress");

    const outcome = await startInsight(deps, applicationProjectId, { regenerate: false });
    if (outcome.kind === "insufficient_data") return skip("insufficient_data");
    const data = outcome.data;
    if (data.reused) return { insightJobId: null, insightSkipReason: null };
    if (data.inProgress) return skip("in_progress");
    log("insight.auto_started", { applicationProjectId, jobId: data.jobId });
    return { insightJobId: data.jobId, insightSkipReason: null };
  } catch (err) {
    const reason = reasonOf(err);
    log("insight.auto_start_skipped", { applicationProjectId, reason, code: isAppError(err) ? err.code : null });
    return skip(reason);
  }
}
