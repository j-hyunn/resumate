"use server"

/**
 * A1 account server actions (S-02, S-03, S-24, S-25). Thin wrappers around the account data
 * module. `fail` flags simulate failures for `?state=` previews (mock only).
 * Results are plain objects ({ ok, ... }) so client components can show inline errors.
 */
import { refresh } from "next/cache"
import type { ConsentType } from "@/types/db"
import {
  completeSignIn,
  getConsentStatuses,
  recordConsents,
  sendMagicLink,
  setOptionalConsent,
  signInWithGoogle,
  signOut,
  type ConsentStatus,
} from "@/lib/data/account"
import { getCurrentUser } from "@/lib/data/shell"
import { routes, safeNextPath } from "@/lib/routes"

type Result<T = object> = ({ ok: true } & T) | { ok: false }

/**
 * Where the auth callback sends the user (02 L-01 첫 화면, S-02, FL-07 A7):
 * 탈퇴 미완료 계정(`deletion_incomplete`) → S-25 탈퇴 마무리 — before S-03, the original URL and S-08
 * (`next` is dropped: the account can't go anywhere else) / new or no consents → S-03 / else next or S-08.
 * `previewDeletionIncomplete` (S-02 `?state=deletion-incomplete`) behaves like such an account.
 */
function destinationHref(
  result: { destination: "consent" | "career"; deletion_incomplete?: boolean },
  next: string | null,
  previewDeletionIncomplete?: boolean,
): string {
  if (previewDeletionIncomplete) return routes.withdrawFinalize("deletion-incomplete")
  if (result.deletion_incomplete) return routes.withdrawFinalize()
  if (result.destination === "consent") return routes.consent(next)
  return next ?? routes.career()
}

export async function sendMagicLinkAction(email: string, opts?: { fail?: boolean }): Promise<Result<{ sent_at: string }>> {
  try {
    const { sent_at } = await sendMagicLink(email, opts)
    return { ok: true, sent_at }
  } catch {
    return { ok: false }
  }
}

/** Dev-only stand-in for opening the emailed link (auth callback). */
export async function openMagicLinkAction(
  email: string,
  next: string | null,
  opts?: { forceNewUser?: boolean; deletionIncomplete?: boolean },
): Promise<Result<{ href: string }>> {
  try {
    const result = await completeSignIn({ method: "magic_link", email, forceNewUser: opts?.forceNewUser })
    return { ok: true, href: destinationHref(result, safeNextPath(next), opts?.deletionIncomplete) }
  } catch {
    return { ok: false }
  }
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

/** S-24 설정 다이얼로그를 열 때 읽는 데이터 (계정 이메일 + 동의 상태) */
export async function getSettingsDataAction(): Promise<Result<{ email: string; statuses: ConsentStatus[] }>> {
  try {
    const [user, statuses] = await Promise.all([getCurrentUser(), getConsentStatuses()])
    return { ok: true, email: user.email, statuses }
  } catch {
    return { ok: false }
  }
}

export async function signOutAction(): Promise<Result> {
  await signOut()
  return { ok: true }
}

