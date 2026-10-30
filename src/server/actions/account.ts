"use server";

import { ACCOUNT_DELETED_REDIRECT, DeleteAccountInput, type AccountDeletionSummary, type DeleteAccountResult } from "@/lib/contracts/account";
import { invalid, runAction, type ActionResult } from "@/lib/contracts/errors";
import { requireUser } from "@/server/auth/session";
import { getServerEnv } from "@/server/env";
import { createServiceRoleClient, deleteAuthUser, type ServiceRoleClient } from "@/server/jobs/service-role";
import * as account from "@/server/services/account";
import { signOut } from "@/server/services/auth";

/**
 * S-25 / FL-07 (F-COM-05). Both use `requireUser` (no consent gate): a user
 * must be able to leave without accepting new terms, and a retry after a
 * half-finished deletion runs with consents already gone.
 */

function log(event: string, fields: Record<string, unknown>): void {
  // No user id, email, key, or content (C-7, NFR-KEY-05, D-DM-02).
  console.info(JSON.stringify({ event, ...fields }));
}

/** S-25 삭제 범위 (DM §4.3) + NFR-KEY-09 hint flag. */
export async function getAccountDeletionSummary(): Promise<ActionResult<AccountDeletionSummary>> {
  return runAction(async () => {
    const { supabase } = await requireUser();
    return account.getAccountDeletionSummary(supabase);
  });
}

/** FL-07: cancel jobs → delete_account RPC → Auth user delete → sign out. The screen then goes to S-01. */
export async function deleteAccount(input: unknown): Promise<ActionResult<DeleteAccountResult>> {
  const parsed = DeleteAccountInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase, user } = await requireUser();
    let admin: ServiceRoleClient | undefined;
    const outcome = await account.deleteAccount({
      supabase,
      user,
      hashSecret: getServerEnv().ACCOUNT_DELETION_HASH_SECRET,
      // QA-S9-03: build the service-role client before anything is deleted.
      assertAuthAdminReady: () => {
        admin = createServiceRoleClient("resumate-account-deletion");
      },
      deleteAuthUser: (id) => deleteAuthUser(id, admin),
      signOut: () => signOut(supabase),
      log,
    });
    return { deleted: true as const, canceledJobs: outcome.canceledJobs, redirectTo: ACCOUNT_DELETED_REDIRECT };
  });
}
