import "server-only";
import type { AccountState } from "@/lib/contracts/account";
import type { UserSupabaseClient } from "@/server/db/types";
import { getServerEnv } from "@/server/env";
import { createServiceRoleClient } from "@/server/jobs/service-role";
import { getAccountState } from "@/server/services/account/state";

function log(event: string, fields: Record<string, unknown>): void {
  // No user id, email, or hash (D-DM-02).
  console.info(JSON.stringify({ event, ...fields }));
}

/**
 * R1 A7 wiring: own profile read as the user; only when it's missing, the service-role
 * `get_account_deletion_state` (with the delete_account HMAC) decides S-25 vs. a fault.
 */
export function loadAccountState(supabase: UserSupabaseClient, userId: string): Promise<AccountState> {
  return getAccountState({
    supabase,
    userId,
    deletionStateRpc: () => createServiceRoleClient("resumate-account-state"),
    hashSecret: getServerEnv().ACCOUNT_DELETION_HASH_SECRET,
    log,
  });
}
