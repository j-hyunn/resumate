import { createHmac } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import type { AccountDeletionSummary } from "@/lib/contracts/account";
import { AppError } from "@/lib/contracts/errors";
import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";
import { requestCancel } from "@/server/services/ai-jobs";

/**
 * Account deletion (F-COM-05, FL-07, NFR-PRV-06, NFR-KEY-06, D-11, D-DM-02).
 * Next-free so Vitest can run it; the action injects the Auth admin call,
 * the sign-out, the HMAC secret, and the logger.
 */

// ---------------- summary (DM §4.3) ----------------

function count(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < 0) throw new AppError("internal_error", undefined, { status: 500, cause: new Error("invalid deletion summary count") });
  return n;
}

function group(row: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = row[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError("internal_error", undefined, { status: 500, cause: new Error(`deletion summary group ${key} missing`) });
  }
  return value as Record<string, unknown>;
}

/** Maps the RPC's jsonb (snake_case groups, db-engineer notes) to the S-25 DTO. */
export function toAccountDeletionSummary(raw: unknown): AccountDeletionSummary {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AppError("internal_error", undefined, { status: 500, cause: new Error("deletion summary missing") });
  }
  const row = raw as Record<string, unknown>;
  const career = group(row, "career");
  const apps = group(row, "applications");
  const ai = group(row, "ai_connection");
  const providerKeys = count(ai.provider_keys);
  return {
    career: {
      experiences: count(career.experiences),
      educations: count(career.educations),
      projects: count(career.projects),
      projectDetails: count(career.project_details),
      achievements: count(career.achievements),
      skills: count(career.skills),
      writingChats: count(career.writing_chats),
    },
    applications: {
      applicationProjects: count(apps.application_projects),
      insights: count(apps.insights),
      drafts: count(apps.drafts),
      interviewSessions: count(apps.interview_sessions),
      stageEvents: count(apps.application_stage_events),
    },
    aiConnection: {
      providerKeys,
      dataUseConsents: count(ai.ai_data_use_consents),
      usageRecords: count(ai.usage_records),
    },
    // NFR-KEY-09 (`has_provider_keys` = provider_keys > 0 in the RPC)
    recommendProviderKeyRevocation: ai.has_provider_keys === true || providerKeys > 0,
  };
}

/** S-25: RPC `get_account_deletion_summary()` as the user (invoker, RLS). */
export async function getAccountDeletionSummary(supabase: UserSupabaseClient): Promise<AccountDeletionSummary> {
  const { data, error } = await supabase.rpc("get_account_deletion_summary");
  if (error) throw mapDbError(error);
  return toAccountDeletionSummary(data);
}

// ---------------- delete (FL-07) ----------------

/**
 * D-DM-02: the deletion log keeps only HMAC-SHA256(secret, user id), hex.
 * Not reversible without the secret; never used to recognize a returning user
 * ([가정] S9 plan 3).
 */
export function computeSubjectHash(userId: string, secret: string): string {
  return createHmac("sha256", secret).update(`account:${userId}`).digest("hex");
}

/** Postgres deadlock_detected. */
const DEADLOCK_DETECTED = "40P01";

export type AccountLog = (event: string, fields: Record<string, unknown>) => void;

export type DeleteAccountDeps = {
  supabase: UserSupabaseClient;
  user: Pick<User, "id">;
  /** ACCOUNT_DELETION_HASH_SECRET; undefined → fail closed before anything is deleted. */
  hashSecret: string | undefined;
  /**
   * Throws when the Auth admin client can't be built (service-role key
   * missing). Called first, so a misconfigured deploy deletes nothing (QA-S9-03).
   */
  assertAuthAdminReady: () => void;
  /** Service-role `auth.admin.deleteUser`; `alreadyGone` on 404 (retry). */
  deleteAuthUser: (userId: string) => Promise<{ alreadyGone: boolean }>;
  /** Clears this device's session cookies. Errors are swallowed by the service. */
  signOut: () => Promise<void>;
  log: AccountLog;
};

export type DeleteAccountOutcome = { canceledJobs: number; authUserAlreadyGone: boolean };

/**
 * FL-07, in order:
 * 1. cancel requests for in-flight AI jobs (so runners stop spending the user's key);
 * 2. RPC `delete_account(p_subject_hash)` — one transaction: key rows hard-deleted
 *    (NFR-KEY-06), de-identified log row, every public row of the user;
 * 3. service-role `auth.admin.deleteUser`;
 * 4. sign out (cookies).
 *
 * Config (hash secret, Auth admin client) is checked before step 1.
 * Failure points: before / at 2 nothing is deleted (the RPC is one transaction;
 * cancel requests alone are harmless). At 3 public data is already gone and the
 * error is returned; a retry passes 2 idempotently and tries 3 again.
 * Logs carry no user id, email, key, or content — only the step and counts.
 */
export async function deleteAccount(deps: DeleteAccountDeps): Promise<DeleteAccountOutcome> {
  const { supabase, user, log } = deps;
  if (!deps.hashSecret) {
    log("account.delete_failed", { step: "config" });
    throw new AppError("internal_error", undefined, { status: 500, cause: new Error("ACCOUNT_DELETION_HASH_SECRET missing") });
  }
  try {
    deps.assertAuthAdminReady();
  } catch (err) {
    log("account.delete_failed", { step: "config" });
    throw err instanceof AppError ? err : new AppError("internal_error", undefined, { status: 500, cause: err });
  }
  const subjectHash = computeSubjectHash(user.id, deps.hashSecret);

  // 1. In-flight jobs (C-6 cancel). The RPC deletes the job rows anyway; the
  // separate cancel commit lets runners that hold a job stop on the normal
  // cancel path at their next checkpoint.
  let canceledJobs = 0;
  const { data: jobs, error: jobsError } = await supabase.from("ai_jobs").select("id").in("status", ["queued", "running"]);
  if (jobsError) {
    log("account.delete_failed", { step: "cancel_jobs" });
    throw mapDbError(jobsError);
  }
  for (const job of jobs ?? []) {
    try {
      await requestCancel(supabase, job.id);
      canceledJobs++;
    } catch (err) {
      // Finished meanwhile → nothing to cancel. The delete still removes the row.
      if (!(err instanceof AppError)) throw err;
    }
  }

  // 2. Public data (one transaction, idempotent). A lock cycle with a runner
  // or another tab aborts one side with 40P01; the whole transaction rolled
  // back, so the same call is retried once (QA-S9-01, db notes "잠금 근거").
  let { error: rpcError } = await supabase.rpc("delete_account", { p_subject_hash: subjectHash });
  if (rpcError?.code === DEADLOCK_DETECTED) {
    log("account.delete_retry", { step: "delete_account_rpc", reason: "deadlock" });
    ({ error: rpcError } = await supabase.rpc("delete_account", { p_subject_hash: subjectHash }));
  }
  if (rpcError) {
    log("account.delete_failed", { step: "delete_account_rpc", canceledJobs, deadlock: rpcError.code === DEADLOCK_DETECTED });
    if (rpcError.code === DEADLOCK_DETECTED) {
      throw new AppError("account_deletion_busy", "다른 작업과 겹쳐 탈퇴를 마치지 못했어요. 지운 것은 없어요. 잠시 후 다시 시도해 주세요.", { status: 503 });
    }
    throw mapDbError(rpcError);
  }

  // 3. Auth user.
  let authUserAlreadyGone: boolean;
  try {
    ({ alreadyGone: authUserAlreadyGone } = await deps.deleteAuthUser(user.id));
  } catch (err) {
    log("account.delete_failed", { step: "auth_delete_user", publicDataDeleted: true, canceledJobs });
    throw err instanceof AppError
      ? new AppError("account_deletion_incomplete", "계정 정보 삭제를 마치지 못했어요. 잠시 후 다시 시도해 주세요.", { status: 500, cause: err })
      : err;
  }

  // 4. Sign out (cookies). The Auth user is gone; a failure here only leaves a dead cookie.
  try {
    await deps.signOut();
  } catch {
    // ignored — the session can no longer be used
  }

  log("account.deleted", { canceledJobs, authUserAlreadyGone });
  return { canceledJobs, authUserAlreadyGone };
}
