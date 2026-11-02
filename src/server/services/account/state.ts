import { ACCOUNT_STATES, type AccountState } from "@/lib/contracts/account";
import { AppError } from "@/lib/contracts/errors";
import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";
import { computeSubjectHash } from "./index";

/**
 * R1 A7 — half-finished account deletion (DM v4.2 6.1, UX FL-07 / L-01 / S-02 / S-25).
 *
 * `delete_account` removes every public row incl. `profiles` in one transaction; when the
 * Auth user delete then fails, the user can still sign in with no profile. Such a session
 * must go to S-25 "탈퇴 마무리" BEFORE the consent gate (its consents are gone too).
 *
 * Cost rule (DM 6.1): a normal user only pays the own-profile read; the HMAC + service-role
 * RPC `get_account_deletion_state` runs only when no `profiles` row is visible.
 * Next-free: the caller injects the service-role RPC client and the HMAC secret.
 */

export type DeletionStateRpc = Pick<UserSupabaseClient, "rpc">;

export type AccountStateDeps = {
  /** User session (RLS): own `profiles` row. */
  supabase: Pick<UserSupabaseClient, "from">;
  userId: string;
  /** Built only when the profile is missing (service_role; users can't read account_deletion_logs). */
  deletionStateRpc: () => DeletionStateRpc;
  /** ACCOUNT_DELETION_HASH_SECRET (same HMAC as delete_account). */
  hashSecret: string | undefined;
  log?: (event: string, fields: Record<string, unknown>) => void;
};

export async function hasOwnProfile(supabase: Pick<UserSupabaseClient, "from">, userId: string): Promise<boolean> {
  const { data, error } = await supabase.from("profiles").select("id").eq("id", userId).maybeSingle();
  if (error) throw mapDbError(error);
  return data !== null;
}

function isAccountState(v: unknown): v is AccountState {
  return typeof v === "string" && (ACCOUNT_STATES as readonly string[]).includes(v);
}

export async function getAccountState(deps: AccountStateDeps): Promise<AccountState> {
  if (await hasOwnProfile(deps.supabase, deps.userId)) return "active";
  if (!deps.hashSecret) {
    // Fail closed: without the secret the state can't be judged (and delete_account can't run either).
    deps.log?.("account.state_failed", { step: "config" });
    throw new AppError("internal_error", undefined, { status: 500, cause: new Error("ACCOUNT_DELETION_HASH_SECRET missing") });
  }
  const { data, error } = await deps.deletionStateRpc().rpc("get_account_deletion_state", {
    p_user_id: deps.userId,
    p_subject_hash: computeSubjectHash(deps.userId, deps.hashSecret),
  });
  if (error) throw mapDbError(error);
  if (!isAccountState(data)) throw new AppError("internal_error", undefined, { status: 500, cause: new Error("unexpected account state") });
  // Counts-free log, no user id (D-DM-02).
  deps.log?.("account.state_without_profile", { state: data });
  return data;
}

/** Thrown by consent-gated actions / handlers for a half-deleted account (S-25 "탈퇴 마무리"). */
export function accountDeletionIncomplete(): AppError {
  return new AppError("account_deletion_incomplete", "탈퇴가 아직 끝나지 않았어요. 탈퇴 마무리를 진행해 주세요.", { status: 403 });
}

/**
 * [가정] R1 A7: `profile_missing` (no profile, no deletion log) has no screen in UX v5.3. It
 * can only come from a broken sign-up (the profile trigger failed) — treated as a server
 * fault, never as "deleted" and never sent through the consent gate.
 */
export function accountProfileMissing(): AppError {
  return new AppError("account_profile_missing", "계정 정보를 불러오지 못했어요. 잠시 후 다시 로그인해 주세요.", { status: 500 });
}
