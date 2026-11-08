"use server"

/**
 * A1 account server actions (S-02, S-03, S-24 ①③, S-25). Thin wrappers around the account data
 * module. `fail` flags simulate failures for `?state=` previews (mock only).
 * Results are plain objects ({ ok, ... }) so client components can show inline errors.
 */
import { refresh } from "next/cache"
import type { ConsentType } from "@/types/db"
import {
  getConsentStatuses,
  recordConsents,
  setOptionalConsent,
  signInWithGoogle,
  signOut,
  type ConsentStatus,
} from "@/lib/data/account"
import { getCurrentUser } from "@/lib/data/shell"
import { getProfileBasics, saveProfileBasics, type ProfileBasicsViewDto } from "@/lib/data/profile"
import { PROFILE_SAVE_ERROR_CODES, type SaveProfileBasicsInput } from "@/lib/contracts/profile"
import { isAppError } from "@/lib/contracts/errors"
import { routes, safeNextPath } from "@/lib/routes"

type Result<T = object> = ({ ok: true } & T) | { ok: false }

/**
 * Where the auth callback sends the user (02 L-01 첫 화면, S-02, FL-07 A7):
 * 탈퇴 미완료 계정(`deletion_incomplete`) → S-25 탈퇴 마무리 — before S-03, the original URL and S-08
 * (`next` is dropped: the account can't go anywhere else) / new or no consents → S-03 / else next or S-08.
 * `previewDeletionIncomplete` (S-02 `?state=deletion-incomplete`) behaves like such an account.
 */
function destinationHref(
  result: { destination: "consent" | "career"; deletion_incomplete?: boolean; provider_url?: string },
  next: string | null,
  previewDeletionIncomplete?: boolean,
): string {
  if (result.provider_url) return result.provider_url // real Google OAuth (previews never set it)
  if (previewDeletionIncomplete) return routes.withdrawFinalize("deletion-incomplete")
  if (result.deletion_incomplete) return routes.withdrawFinalize()
  if (result.destination === "consent") return routes.consent(next)
  return next ?? routes.career()
}

export async function signInWithGoogleAction(
  next: string | null,
  opts?: { fail?: boolean; forceNewUser?: boolean; deletionIncomplete?: boolean },
): Promise<Result<{ href: string }>> {
  try {
    const result = await signInWithGoogle({ fail: opts?.fail, forceNewUser: opts?.forceNewUser })
    return { ok: true, href: destinationHref(result, safeNextPath(next), opts?.deletionIncomplete) }
  } catch {
    return { ok: false }
  }
}

export async function recordConsentsAction(
  agreed: Partial<Record<ConsentType, boolean>>,
  next: string | null,
  opts?: { fail?: boolean },
): Promise<Result<{ href: string }>> {
  try {
    await recordConsents(agreed, opts)
    return { ok: true, href: safeNextPath(next) ?? routes.career() }
  } catch {
    return { ok: false }
  }
}

export async function setOptionalConsentAction(
  consentType: ConsentType,
  agree: boolean,
  opts?: { fail?: boolean },
): Promise<Result<{ status: ConsentStatus }>> {
  try {
    const status = await setOptionalConsent(consentType, agree, opts)
    refresh()
    return { ok: true, status }
  } catch {
    return { ok: false }
  }
}

/** S-24 ③ 약관 탭: 선택 동의 상태 (탭을 열 때마다 다시 읽는다) */
export async function getConsentStatusesAction(): Promise<Result<{ statuses: ConsentStatus[] }>> {
  try {
    return { ok: true, statuses: await getConsentStatuses() }
  } catch {
    return { ok: false }
  }
}

/** S-24 ① 계정 탭: 이메일 + 내 정보 (profiles + profile_job_interests + profile_options) */
export async function getAccountTabDataAction(): Promise<Result<{ email: string; view: ProfileBasicsViewDto }>> {
  try {
    const [user, view] = await Promise.all([getCurrentUser(), getProfileBasics()])
    return { ok: true, email: user.email, view }
  } catch {
    return { ok: false }
  }
}

/** S-24 ① 내 정보 다시 읽기 (stale_write · invalid_profile_option 뒤) */
export async function getProfileBasicsAction(): Promise<Result<{ view: ProfileBasicsViewDto }>> {
  try {
    return { ok: true, view: await getProfileBasics() }
  } catch {
    return { ok: false }
  }
}

export type SaveProfileBasicsActionResult =
  | { ok: true; updatedAt: string }
  /** `code` = UX S-24 ① 오류 6종(그 밖은 null), `details.field` / `details.sortOrder`로 칸·행을 찾는다 */
  | { ok: false; code: string | null; details: Record<string, unknown> | null }

/** S-24 ① [저장] — RPC save_profile_basics (섹션 전체 덮어쓰기) */
export async function saveProfileBasicsAction(input: SaveProfileBasicsInput): Promise<SaveProfileBasicsActionResult> {
  try {
    const { updatedAt } = await saveProfileBasics(input)
    return { ok: true, updatedAt }
  } catch (err) {
    if (isAppError(err) && (PROFILE_SAVE_ERROR_CODES as readonly string[]).includes(err.code))
      return { ok: false, code: err.code, details: err.details ?? null }
    return { ok: false, code: null, details: null }
  }
}

export async function signOutAction(): Promise<Result> {
  await signOut()
  return { ok: true }
}

