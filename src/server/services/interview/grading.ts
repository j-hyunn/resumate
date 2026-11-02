import { AI_ERROR_CODES, type AiErrorCode } from "@/lib/contracts/enums";
import type { InterviewGradingDecision } from "@/lib/contracts/interview";
import { mapDbError } from "@/server/db/errors";
import type { AiWriterSupabaseClient, UserSupabaseClient } from "@/server/db/types";

/**
 * DM 2.7.1 판정표 (Q53-3 · 5 · 6 · 10): the DB's one decision helper, read through
 * `get_interview_grading_decisions` (user session and app_ai_writer; own sessions only). The
 * reads, the 다시 채점 route and the same-row retry gate use this instead of re-deriving the table.
 */

export type GradingDb = UserSupabaseClient | AiWriterSupabaseClient;

export type GradingDecisionRow = {
  sessionId: string;
  decision: InterviewGradingDecision;
  /** Submitted answers without a success that aren't input-caused (0 = the same-row retry is refused). */
  regradeTargetCount: number;
  succeededCount: number;
};

export const NO_GRADING_DECISION: InterviewGradingDecision = { kind: "none" };

/** Generated types say `string`; the RPC returns null for these columns too. */
type RawRow = { session_id: string; decision: string; cause: string | null; regrade_target_count: number; succeeded_count: number };

function causeOf(value: string | null): AiErrorCode | null {
  return value !== null && (AI_ERROR_CODES as readonly string[]).includes(value) ? (value as AiErrorCode) : null;
}

export function toGradingDecision(row: Pick<RawRow, "decision" | "cause" | "regrade_target_count">): InterviewGradingDecision {
  switch (row.decision) {
    case "regrade":
      return { kind: "regrade", count: row.regrade_target_count };
    case "resummarize":
      return { kind: "resummarize" };
    case "input_only":
      return { kind: "input_only", cause: causeOf(row.cause) };
    default:
      return NO_GRADING_DECISION;
  }
}

/** One entry per owned, existing session; other ids are simply absent. */
export async function loadGradingDecisions(db: GradingDb, sessionIds: readonly string[]): Promise<Map<string, GradingDecisionRow>> {
  const out = new Map<string, GradingDecisionRow>();
  if (sessionIds.length === 0) return out;
  // Both clients share the Database type; the union of their rpc signatures isn't callable as is.
  const { data, error } = await (db as UserSupabaseClient).rpc("get_interview_grading_decisions", { p_session_ids: [...new Set(sessionIds)] });
  if (error) throw mapDbError(error);
  for (const row of (data ?? []) as RawRow[]) {
    out.set(row.session_id, {
      sessionId: row.session_id,
      decision: toGradingDecision(row),
      regradeTargetCount: row.regrade_target_count,
      succeededCount: row.succeeded_count,
    });
  }
  return out;
}

/**
 * QA-W0-04 (Q53-11): the JD's raw text was edited after this questions job's `prepare` finished, so the
 * JD is no longer `succeeded`. `prepare` is checkpointed and doesn't run again, so a same-row retry could
 * only end `stalled`. Refused like other non-retryable rows; a new session extracts the new text first.
 */
export async function isQuestionsPrepareStale(
  db: GradingDb,
  job: { stepOutputs: Record<string, unknown>; applicationProjectId: string | null },
): Promise<boolean> {
  if (!job.applicationProjectId || job.stepOutputs.prepare === undefined) return false;
  const { data, error } = await (db as UserSupabaseClient)
    .from("job_descriptions")
    .select("extraction_status")
    .eq("application_project_id", job.applicationProjectId)
    .maybeSingle();
  if (error) throw mapDbError(error);
  return data !== null && data.extraction_status !== "succeeded";
}
