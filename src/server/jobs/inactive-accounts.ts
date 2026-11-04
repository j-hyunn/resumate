import "server-only";
import { AppError } from "@/lib/contracts/errors";
import type { MailContent } from "@/server/mail/inactivity-notice";
import { buildInactivityNotice } from "@/server/mail/inactivity-notice";
import { computeSubjectHash } from "@/server/services/account";
import type { ServiceRoleClient } from "./service-role";

/**
 * Inactive account deletion (privacy policy 2026-11-04 §4; DM A.1 last_active_at / inactivity_notice_sent_at,
 * A.17 reason 'inactivity'). Runs inside the daily retention cron, after the purges:
 *
 * 1. notices  — accounts 1 year - 30 days without access, not yet told: send the Gmail notice, then
 *               `mark_inactivity_notice_sent` (only after the mail server accepted it, so nobody is deleted
 *               without a notice; a failed mark means a repeat mail the next day, never a missing one).
 * 2. deletions — accounts told >= 30 days ago and 1 year without access: `purge_inactive_account` (same scope
 *               as delete_account, reason 'inactivity'), then the Auth user (service-role admin API).
 * 3. auth cleanup — Auth users whose public data is already deleted (step 2's or a user deletion's Auth
 *               delete failed): confirmed with `get_account_deletion_state`, then the Auth user is deleted.
 *
 * Sign-in in between: touch_last_active clears the notice and the RPCs re-check under a row lock.
 * Logs and the result carry counts only — no user id, e-mail, or hash.
 */

/** Gmail's sending limit is ~500/day for a personal account; stay well below and leave the rest for tomorrow. */
export const INACTIVITY_NOTICE_MAX_PER_RUN = 30;
export const INACTIVITY_DELETE_MAX_PER_RUN = 30;
export const AUTH_CLEANUP_MAX_PER_RUN = 20;
/** Stop sending after this many failures in a row (Gmail down / blocked): retry the next day. */
export const NOTICE_MAX_CONSECUTIVE_FAILURES = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export type InactiveAccountsDeps = {
  admin: ServiceRoleClient;
  /** Builds the Gmail sender; throws when not configured (notices fail, deletions of told accounts still run). */
  createMailer: () => { send: (to: string, content: MailContent) => Promise<void>; close: () => void };
  /** ACCOUNT_DELETION_HASH_SECRET; missing → deletions and auth cleanup fail closed. */
  hashSecret: string | undefined;
  /** Public origin for the sign-in link in the notice. */
  siteOrigin: string;
  deleteAuthUser: (userId: string) => Promise<{ alreadyGone: boolean }>;
  log?: (event: string, fields: Record<string, unknown>) => void;
};

export type InactiveAccountsStep = "notices" | "deletions" | "authCleanup";

export type InactiveAccountsResult = {
  notices: { sent: number; notMarked: number; failed: number };
  deletions: { deleted: number; skipped: number; authFailed: number };
  authCleanup: { deleted: number; skipped: number; failed: number };
  failed: InactiveAccountsStep[];
};

/** Earliest deletion date for an account told at `sentAt` whose last access was `lastActive`. */
export function inactivityDeleteOn(sentAt: Date, lastActive: Date): Date {
  const afterNotice = new Date(sentAt.getTime() + 30 * DAY_MS);
  const oneYear = new Date(lastActive);
  oneYear.setUTCFullYear(oneYear.getUTCFullYear() + 1);
  return afterNotice > oneYear ? afterNotice : oneYear;
}

async function sendNotices(deps: InactiveAccountsDeps, now: Date, result: InactiveAccountsResult): Promise<boolean> {
  const { data, error } = await deps.admin.rpc("list_inactivity_notice_targets", {
    p_now: now.toISOString(),
    p_limit: INACTIVITY_NOTICE_MAX_PER_RUN,
  });
  if (error || !Array.isArray(data)) return false;
  if (data.length === 0) return true;

  let mailer: ReturnType<InactiveAccountsDeps["createMailer"]>;
  try {
    mailer = deps.createMailer();
  } catch {
    result.notices.failed += data.length;
    return false;
  }
  let ok = true;
  let consecutive = 0;
  try {
    for (const target of data) {
      const sentAt = now;
      const content = buildInactivityNotice({
        deleteOn: inactivityDeleteOn(sentAt, new Date(target.last_active_at)),
        siteOrigin: deps.siteOrigin,
      });
      try {
        await mailer.send(target.email, content);
      } catch {
        result.notices.failed++;
        ok = false;
        if (++consecutive >= NOTICE_MAX_CONSECUTIVE_FAILURES) break;
        continue;
      }
      consecutive = 0;
      const marked = await deps.admin.rpc("mark_inactivity_notice_sent", { p_user_id: target.user_id, p_sent_at: sentAt.toISOString() });
      if (marked.error) {
        // Sent but not recorded: the account is listed again tomorrow (a repeat notice, never a missing one).
        result.notices.failed++;
        ok = false;
      } else if (marked.data === true) {
        result.notices.sent++;
      } else {
        // Signed in between listing and marking: kept, nothing recorded.
        result.notices.notMarked++;
      }
    }
  } finally {
    mailer.close();
  }
  return ok;
}

async function deleteDue(deps: InactiveAccountsDeps, now: Date, result: InactiveAccountsResult): Promise<boolean> {
  if (!deps.hashSecret) return false;
  const { data, error } = await deps.admin.rpc("list_inactive_accounts_due", {
    p_now: now.toISOString(),
    p_limit: INACTIVITY_DELETE_MAX_PER_RUN,
  });
  if (error || !Array.isArray(data)) return false;
  let ok = true;
  for (const { user_id: userId } of data) {
    const purged = await deps.admin.rpc("purge_inactive_account", {
      p_user_id: userId,
      p_subject_hash: computeSubjectHash(userId, deps.hashSecret),
      p_now: now.toISOString(),
    });
    if (purged.error) {
      ok = false;
      continue;
    }
    if (purged.data === null) {
      result.deletions.skipped++;
      continue;
    }
    result.deletions.deleted++;
    try {
      await deps.deleteAuthUser(userId);
    } catch {
      // Public data is gone; the Auth user is picked up by the auth cleanup step (this run or the next).
      result.deletions.authFailed++;
    }
  }
  return ok;
}

async function cleanUpAuthUsers(deps: InactiveAccountsDeps, result: InactiveAccountsResult): Promise<boolean> {
  if (!deps.hashSecret) return false;
  const { data, error } = await deps.admin.rpc("list_incomplete_account_deletions", { p_limit: AUTH_CLEANUP_MAX_PER_RUN });
  if (error || !Array.isArray(data)) return false;
  let ok = true;
  for (const { user_id: userId } of data) {
    const state = await deps.admin.rpc("get_account_deletion_state", {
      p_user_id: userId,
      p_subject_hash: computeSubjectHash(userId, deps.hashSecret),
    });
    if (state.error) {
      result.authCleanup.failed++;
      ok = false;
      continue;
    }
    // 'profile_missing' (no deletion log) is a different fault: leave it for the operator.
    if (state.data !== "deletion_incomplete") {
      result.authCleanup.skipped++;
      continue;
    }
    try {
      await deps.deleteAuthUser(userId);
      result.authCleanup.deleted++;
    } catch {
      result.authCleanup.failed++;
      ok = false;
    }
  }
  return ok;
}

/** Runs every step even if an earlier one fails, then throws `internal_error` if any failed. */
export async function runInactiveAccountsCron(deps: InactiveAccountsDeps, now = new Date()): Promise<InactiveAccountsResult> {
  const result: InactiveAccountsResult = {
    notices: { sent: 0, notMarked: 0, failed: 0 },
    deletions: { deleted: 0, skipped: 0, authFailed: 0 },
    authCleanup: { deleted: 0, skipped: 0, failed: 0 },
    failed: [],
  };
  const steps: Array<[InactiveAccountsStep, () => Promise<boolean>]> = [
    ["notices", () => sendNotices(deps, now, result)],
    ["deletions", () => deleteDue(deps, now, result)],
    ["authCleanup", () => cleanUpAuthUsers(deps, result)],
  ];
  for (const [step, run] of steps) {
    let ok: boolean;
    try {
      ok = await run();
    } catch {
      ok = false;
    }
    if (!ok) result.failed.push(step);
  }
  deps.log?.("cron.inactive_accounts", result);
  if (result.failed.length > 0) {
    throw new AppError("internal_error", undefined, { status: 500, cause: new Error(`inactive accounts step failed: ${result.failed.join(",")}`) });
  }
  return result;
}
