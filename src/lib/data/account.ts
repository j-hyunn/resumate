/**
 * 계정 data layer (server only): Supabase Auth (Google), consents, policy versions,
 * account deletion. Signatures kept from the mock; `?state=` previews still run the mock bodies
 * (`previewOr`, lib/data/source.ts). Names follow 04-data-model.md.
 */
import { headers } from "next/headers"
import type {
  AccountDeletionErrorCode,
  AccountDeletionState,
  AccountDeletionSummary,
  AiProviderName,
  Consent,
  ConsentType,
  PolicyType,
  PolicyVersion,
} from "@/types/db"
import { mockRequest, clone, resetMockDb } from "@/lib/mock/store"
import { newId } from "@/lib/mock/ids"
import { nowIso } from "@/lib/mock/time"
import type { MockDb } from "@/lib/mock/fixtures"
import { CONSENT_ITEMS, REQUIRED_CONSENT_TYPES } from "./consent-items"
import { isPreviewRequest, previewOr, unwrap } from "./source"
import { REQUEST_PATH_HEADER } from "@/lib/contracts/preview"
import { AppError, isAppError, type ActionResult } from "@/lib/contracts/errors"
import { safeNextPath } from "@/lib/contracts/routes"
import type { DeleteAccountResult as RealDeleteAccountResult } from "@/lib/contracts/account"
import * as authActions from "@/server/actions/auth"
import * as accountActions from "@/server/actions/account"
import * as consentActions from "@/server/actions/consent"
import { requireUser } from "@/server/auth/session"
import { loadAccountState } from "@/server/auth/account-state"
import { accountProfileMissing } from "@/server/services/account/state"
import { countRunningJobs, loadConsentRows, loadPolicyVersions } from "@/server/services/shell"
import { createSupabaseServerClient } from "@/server/db/server"

/** policy_versions: latest effective row per type */
function currentVersion(db: MockDb, policy_type: PolicyType): PolicyVersion {
  const rows = db.policy_versions
    .filter((p) => p.policy_type === policy_type && Date.parse(p.effective_at) <= Date.now())
    .sort((x, y) => y.effective_at.localeCompare(x.effective_at))
  return rows[0] ?? db.policy_versions.find((p) => p.policy_type === policy_type)!
}

/** Current version of each policy document (S-03 고지, S-30 tabs). Pass to client components as props. */
export async function getPolicyVersions(): Promise<Record<PolicyType, PolicyVersion>> {
  return previewOr(
    async () => {
      const db = await mockRequest(0)
      return clone({
        terms: currentVersion(db, "terms"),
        privacy: currentVersion(db, "privacy"),
        cross_border_transfer: currentVersion(db, "cross_border_transfer"),
      })
    },
    async () => {
      // policy_versions is public (S-30 opens signed out). DM has no updated_at use on screens.
      const rows = (await loadPolicyVersions(await createSupabaseServerClient())) as PolicyVersion[]
      const latest = (type: PolicyType) => {
        const row = rows.find((r) => r.policy_type === type)
        if (!row) throw new AppError("internal_error")
        return row
      }
      return { terms: latest("terms"), privacy: latest("privacy"), cross_border_transfer: latest("cross_border_transfer") }
    },
  )
}

export class AccountRequestError extends Error {
  constructor(message = "account request failed (mock)") {
    super(message)
  }
}

type FailOption = { fail?: boolean }

function maybeFail(opts?: FailOption) {
  if (opts?.fail) throw new AccountRequestError()
}

// ---------------------------------------------------------------------------
// Auth (F-COM-01, D-09 변경: Google 로그인만 — decisions.md 3.11 / 4.5).
// ---------------------------------------------------------------------------

/**
 * `deletion_incomplete` (v4.2 A7): the account's data is gone but the auth delete did not finish →
 * S-25 탈퇴 마무리 before the consent gate / original URL / S-08.
 */
export type SignInResult = {
  destination: "consent" | "career"
  deletion_incomplete?: boolean
  /** Real Google sign-in: the provider page to open. The destination is decided later by /auth/callback. */
  provider_url?: string
}

/** S-02 passes `?next=` only in its URL; Server Actions POST to the page URL, so read it there. */
async function nextFromSignInUrl(): Promise<string | undefined> {
  const path = (await headers()).get(REQUEST_PATH_HEADER)
  const next = path ? new URLSearchParams(path.split("?")[1] ?? "").get("next") : null
  return next ? safeNextPath(next) : undefined
}

/**
 * Google OAuth start. The `?state=` preview skips the provider page and resolves the destination
 * the callback would pick: `forceNewUser` → S-03, the fixture user → S-25 when deletion is
 * incomplete, else S-08 (or S-03 when required consents are missing). A real request returns the
 * provider URL; /auth/callback decides the destination.
 */
export async function signInWithGoogle(opts?: FailOption & { forceNewUser?: boolean }): Promise<SignInResult> {
  return previewOr(
    async () => {
      const db = await mockRequest(500)
      maybeFail(opts)
      if (opts?.forceNewUser) return { destination: "consent" as const }
      if (db.mock_controls.account_deletion_state === "deletion_incomplete")
        return { destination: "consent" as const, deletion_incomplete: true }
      return { destination: hasActiveRequiredConsents(db.consents) ? ("career" as const) : ("consent" as const) }
    },
    async () => {
      const { url } = unwrap(await authActions.signInWithGoogle({ next: await nextFromSignInUrl() }))
      return { destination: "career" as const, provider_url: url }
    },
  )
}

export async function signOut(): Promise<void> {
  return previewOr(
    async () => {
      await mockRequest(200)
    },
    async () => {
      unwrap(await authActions.signOut())
    },
  )
}

// ---------------------------------------------------------------------------
// Consents (F-COM-02, NFR-PRV-02; 04 A.2: 1 agreement = 1 row, withdraw = withdrawn_at)
// ---------------------------------------------------------------------------

function isActive(row: Consent) {
  return row.agreed && !row.withdrawn_at
}

function latestByType(rows: Consent[]): Map<ConsentType, Consent> {
  const map = new Map<ConsentType, Consent>()
  for (const row of rows) {
    const prev = map.get(row.consent_type)
    if (!prev || Date.parse(row.agreed_at) >= Date.parse(prev.agreed_at)) map.set(row.consent_type, row)
  }
  return map
}

function hasActiveRequiredConsents(rows: Consent[]) {
  const latest = latestByType(rows)
  return REQUIRED_CONSENT_TYPES.every((t) => {
    const row = latest.get(t)
    return row ? isActive(row) : false
  })
}

export interface ConsentStatus {
  consent_type: ConsentType
  /** latest row for this type, if any */
  latest: Consent | null
  active: boolean
}

/** consents has no updated_at column (mock type only): the last change is the agreement or withdrawal. */
async function realConsentRows(): Promise<Consent[]> {
  const { supabase } = await requireUser()
  const rows = await loadConsentRows(supabase)
  return rows.map((r) => ({ ...r, consent_type: r.consent_type as ConsentType, updated_at: r.withdrawn_at ?? r.agreed_at }))
}

function statusesOf(rows: Consent[]): ConsentStatus[] {
  const latest = latestByType(rows)
  return CONSENT_ITEMS.map((item) => {
    const row = latest.get(item.consent_type) ?? null
    return { consent_type: item.consent_type, latest: row, active: row ? isActive(row) : false }
  })
}

export async function getConsentStatuses(): Promise<ConsentStatus[]> {
  if (!(await isPreviewRequest())) return statusesOf(await realConsentRows())
  const db = await mockRequest()
  const latest = latestByType(db.consents)
  return CONSENT_ITEMS.map((item) => {
    const row = latest.get(item.consent_type) ?? null
    return { consent_type: item.consent_type, latest: row ? clone(row) : null, active: row ? isActive(row) : false }
  })
}

/** S-03 submit: one row per agreed item (required must all be true). */
export async function recordConsents(
  agreed: Partial<Record<ConsentType, boolean>>,
  opts?: FailOption,
): Promise<Consent[]> {
  if (!(await isPreviewRequest())) {
    const items = CONSENT_ITEMS.filter((item) => agreed[item.consent_type]).map((item) => ({ consentType: item.consent_type, agreed: true }))
    unwrap(await consentActions.submitConsents({ items }))
    const types = new Set(items.map((i) => i.consentType))
    return (await realConsentRows()).filter((r) => types.has(r.consent_type) && isActive(r))
  }
  const db = await mockRequest(400)
  maybeFail(opts)
  const missing = REQUIRED_CONSENT_TYPES.filter((t) => !agreed[t])
  if (missing.length > 0) throw new AccountRequestError(`required consents missing: ${missing.join(",")}`)
  const now = nowIso()
  const rows: Consent[] = CONSENT_ITEMS.filter((item) => agreed[item.consent_type]).map((item) => ({
    id: newId(),
    user_id: db.user.id,
    created_at: now,
    updated_at: now,
    consent_type: item.consent_type,
    policy_version: currentVersion(db, item.policy_type).version,
    agreed: true,
    agreed_at: now,
    withdrawn_at: null,
    user_agent_hash: null,
  }))
  db.consents.push(...rows)
  return clone(rows)
}

/** S-24 optional consent toggle: agree = new row, withdraw = set withdrawn_at (RLS: optional only). */
export async function setOptionalConsent(
  consent_type: ConsentType,
  agree: boolean,
  opts?: FailOption,
): Promise<ConsentStatus> {
  if (!(await isPreviewRequest())) {
    const item = CONSENT_ITEMS.find((c) => c.consent_type === consent_type)
    if (!item || item.required) throw new AccountRequestError("only optional consents can be changed")
    if (agree) unwrap(await consentActions.submitConsents({ items: [{ consentType: consent_type, agreed: true }] }))
    else unwrap(await consentActions.withdrawConsent({ consentType: consent_type }))
    return statusesOf(await realConsentRows()).find((c) => c.consent_type === consent_type)!
  }
  const db = await mockRequest(300)
  maybeFail(opts)
  const item = CONSENT_ITEMS.find((c) => c.consent_type === consent_type)
  if (!item || item.required) throw new AccountRequestError("only optional consents can be changed")
  const now = nowIso()
  const current = latestByType(db.consents).get(consent_type)
  if (agree) {
    if (!current || !isActive(current)) {
      db.consents.push({
        id: newId(),
        user_id: db.user.id,
        created_at: now,
        updated_at: now,
        consent_type,
        policy_version: currentVersion(db, item.policy_type).version,
        agreed: true,
        agreed_at: now,
        withdrawn_at: null,
        user_agent_hash: null,
      })
    }
  } else if (current && isActive(current)) {
    current.withdrawn_at = now
    current.updated_at = now
  }
  const latest = latestByType(db.consents).get(consent_type) ?? null
  return { consent_type, latest: latest ? clone(latest) : null, active: latest ? isActive(latest) : false }
}

// ---------------------------------------------------------------------------
// Account deletion (F-COM-05, D-11, FL-07; 04 §4.3 get_account_deletion_summary, DM-1)
// ---------------------------------------------------------------------------

/** RPC get_account_deletion_summary() — RPC shape only */
export async function getAccountDeletionSummary(): Promise<AccountDeletionSummary> {
  if (!(await isPreviewRequest())) {
    const r = unwrap(await accountActions.getAccountDeletionSummary())
    return {
      career: {
        experiences: r.career.experiences,
        educations: r.career.educations,
        projects: r.career.projects,
        // @deprecated R4 shim: the S-25 screen still lists these (dropped in DM v4.4); deliverables aren't shown yet.
        project_details: 0,
        achievements: 0,
        skills: r.career.skills,
        writing_chats: r.career.writingChats,
      },
      applications: {
        application_projects: r.applications.applicationProjects,
        insights: r.applications.insights,
        drafts: r.applications.drafts,
        interview_sessions: r.applications.interviewSessions,
        application_stage_events: r.applications.stageEvents,
      },
      ai: {
        provider_keys: r.aiConnection.providerKeys,
        data_use_consents: r.aiConnection.dataUseConsents,
        usage_records: r.aiConnection.usageRecords,
      },
    }
  }
  const db = await mockRequest()
  return {
    career: {
      experiences: db.experiences.length,
      educations: db.educations.length,
      projects: db.projects.length,
      project_details: db.project_details.length,
      achievements: db.achievements.length,
      skills: db.skills.length,
      writing_chats: db.writing_chats.length,
    },
    applications: {
      application_projects: db.application_projects.length,
      insights: db.insights.length,
      drafts: db.drafts.length,
      interview_sessions: db.interview_sessions.length,
      application_stage_events: db.application_stage_events.length,
    },
    // v4: AI 연결 — keys are destroyed immediately; consents / usage records follow D-DM-02
    ai: {
      provider_keys: db.ai_provider_keys.length,
      data_use_consents: db.ai_data_use_consents.length,
      usage_records: db.ai_usage_records.length,
    },
  }
}

/**
 * Running/queued AI jobs, shown on S-25 so the user knows they stop too.
 * [UI-가정] separate from the RPC (A1 UQ-95 ③).
 */
/**
 * Queued / running AI jobs of every job type (incl. jd_extraction, writing_chat_turn). `provider` →
 * only jobs pinned to that provider (S-40 키 삭제 "진행 중인 AI 작업 {N}건", A1 request 5).
 */
export async function getRunningAiJobCount(provider?: AiProviderName): Promise<number> {
  if (!(await isPreviewRequest())) return countRunningJobs((await requireUser()).supabase, provider)
  const db = await mockRequest(0)
  return db.ai_jobs.filter((j) => (j.status === "queued" || j.status === "running") && (!provider || j.provider === provider)).length
}

/** delete_account result for S-25 (02 S-25 v5.3): ok, or a known error code, or another failure */
export type DeleteAccountResult =
  | { ok: true; deleted_at: string }
  | { ok: false; error: AccountDeletionErrorCode | "failed" }

const ACCOUNT_DELETION_ERRORS: readonly string[] = ["account_deletion_busy", "account_deletion_incomplete"]

/** ActionResult → S-25's `{ ok }` result. An unknown failure is the screen's "failed" row. */
function toDeleteAccountResult(result: ActionResult<RealDeleteAccountResult>): DeleteAccountResult {
  if ("data" in result) return { ok: true, deleted_at: nowIso() }
  return ACCOUNT_DELETION_ERRORS.includes(result.error.code)
    ? { ok: false, error: result.error.code as AccountDeletionErrorCode }
    : { ok: false, error: "failed" }
}

/**
 * v4.2 delete_account with the confirmation flag (`confirm: true`, S-25 확인 체크). Idempotent —
 * "탈퇴 마무리하기" sends the same request again. Mock outcomes (mock_controls.account_deletion_failure):
 * - account_deletion_busy: overlaps other work, **nothing deleted** (S-25 unchanged)
 * - account_deletion_incomplete: public data deleted, auth delete failed → 탈퇴 마무리 state
 *   (get_account_deletion_state = deletion_incomplete until a retry succeeds)
 * The control is consumed once, so the retry succeeds. `opts.fail` → `failed` (그 밖 오류).
 */
export async function deleteAccountConfirmed(
  input: { confirm: true },
  opts?: FailOption & { simulate?: AccountDeletionErrorCode | null },
): Promise<DeleteAccountResult> {
  if (!(await isPreviewRequest())) return toDeleteAccountResult(await accountActions.deleteAccount({ confirm: input.confirm }))
  const db = await mockRequest(1200)
  if (input.confirm !== true || opts?.fail) return { ok: false, error: "failed" }
  const failure = opts?.simulate ?? db.mock_controls.account_deletion_failure
  if (failure) {
    db.mock_controls.account_deletion_failure = null
    if (failure === "account_deletion_incomplete") db.mock_controls.account_deletion_state = "deletion_incomplete"
    return { ok: false, error: failure }
  }
  resetMockDb()
  return { ok: true, deleted_at: nowIso() }
}

/**
 * RPC get_account_deletion_state(p_user_id) (04 §6.1 v4.2 [가정], server-only role):
 * active / deletion_incomplete (profiles gone + deletion log) / profile_missing. Mock: the value
 * comes from mock_controls (set by deleteAccountConfirmed or the dev gallery).
 */
export async function getAccountDeletionState(): Promise<AccountDeletionState> {
  if (!(await isPreviewRequest())) {
    let ctx: Awaited<ReturnType<typeof requireUser>>
    try {
      ctx = await requireUser()
    } catch (err) {
      // Session gone while a page is open: the guard shouldn't hang. Gated reads redirect to S-02.
      if (isAppError(err) && err.code === "unauthenticated") return "active"
      throw err
    }
    const state = await loadAccountState(ctx.supabase, ctx.user.id)
    if (state === "profile_missing") throw accountProfileMissing()
    return state
  }
  const db = await mockRequest(0)
  return db.mock_controls.account_deletion_state
}
