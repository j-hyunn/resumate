/**
 * AI 연결 data layer (v4 BYOK, 04 §2.11): provider keys (view ai_provider_keys_public),
 * profiles.active_ai_provider, ai_data_use_consents, ai_disclosures, ai_providers.
 * Reads and writes go to the real services (`*Real` helpers below); `?state=` previews run the mock
 * bodies (`previewOr`). Server only; the raw key goes straight to `registerProviderKey`, is never
 * returned, logged or kept here, and the mock stores only last4 (NFR-KEY-01, -05).
 */
import type {
  AiConnection,
  AiDataUseConsent,
  AiDisclosure,
  AiErrorCode,
  AiFailureCause,
  AiProviderKeyPublic,
  AiProviderName,
  ConnectionTier,
  ProviderKeyVerificationResult,
} from "@/types/db"
import { clone, mockRequest } from "@/lib/mock/store"
import type { MockDb } from "@/lib/mock/fixtures"
import { newId, USER_ID } from "@/lib/mock/ids"
import { AI_PROVIDERS, AI_PROVIDER_ORDER, type AiProviderInfo } from "@/lib/mock/ai-providers"
import { failureTimestamps, mockSyncCall, MockAiError, recordMockUsage } from "@/lib/mock/ai"
import { failureCauseOf } from "./ai-errors"
import { currentPeriodMonth } from "@/lib/mock/time"
import { consentRequired } from "@/lib/mock/consent"
import { isPreviewRequest, previewOr, unwrap } from "./source"
import type { KeyCheckOutcome } from "@/lib/contracts/ai-connection"
import { isAppError } from "@/lib/contracts/errors"
import * as connectionActions from "@/server/actions/ai-connection"
import { requireUser } from "@/server/auth/session"
import { getConsentState, loadCurrentDisclosureRow, loadLiveConsentRows } from "@/server/services/ai-connection/consent"
import { getAiConnection as loadConnection, loadPublicKeyRows } from "@/server/services/ai-connection/keys"
import { loadDataReadiness } from "@/server/services/shell"
import { getAiUsageSummary as loadUsageSummary } from "@/server/services/usage"

export { consentRequired }

// ---------------------------------------------------------------------------
// reads
// ---------------------------------------------------------------------------

function toPublic(k: MockDb["ai_provider_keys"][number]): AiProviderKeyPublic {
  return {
    id: k.id,
    provider: k.provider,
    connection_tier: k.connection_tier,
    key_last4: k.key_last4,
    status: k.status,
    last_verified_at: k.last_verified_at,
    last_failure_cause: k.last_failure_cause,
    last_failure_at: k.last_failure_at,
    created_at: k.created_at,
    updated_at: k.updated_at,
  }
}


/** get_data_readiness().ai_connection — also used standalone by badges / C-18 */
export function computeAiConnection(db: MockDb): AiConnection {
  const provider = db.profiles[0]?.active_ai_provider ?? null
  const key = provider ? db.ai_provider_keys.find((k) => k.provider === provider) : undefined
  if (!provider || !key)
    return { active_provider: null, key_status: null, connection_tier: null, consent_required: null }
  return {
    active_provider: provider,
    key_status: key.status,
    connection_tier: key.connection_tier,
    consent_required: consentRequired(db, provider, key.connection_tier),
  }
}

/** Read as the signed-in user with no consent gate: the shell (S-25 included, A7) mounts this. */
async function realConnection(): Promise<AiConnection> {
  const { supabase } = await requireUser()
  return ((await loadDataReadiness(supabase)) as { ai_connection: AiConnection }).ai_connection
}

export async function getAiConnection(): Promise<AiConnection> {
  return previewOr(async () => computeAiConnection(await mockRequest(0)), realConnection)
}

/** Client shell state: ai_connection + whether any key is saved (C-18 destination: S-41 vs S-40) */
export interface AiConnectionState {
  connection: AiConnection
  has_any_key: boolean
}

export async function getAiConnectionState(): Promise<AiConnectionState> {
  return previewOr(
    async () => {
      const db = await mockRequest(0)
      return { connection: computeAiConnection(db), has_any_key: db.ai_provider_keys.length > 0 }
    },
    async () => {
      const [connection, keys] = await Promise.all([realConnection(), listRealKeys()])
      return { connection, has_any_key: keys.length > 0 }
    },
  )
}

async function listRealKeys(provider?: AiProviderName): Promise<AiProviderKeyPublic[]> {
  return (await loadPublicKeyRows((await requireUser()).supabase, provider)) as AiProviderKeyPublic[]
}

/** ai_data_use_consents has no updated_at column (mock type only). */
function toConsentRow(row: Awaited<ReturnType<typeof loadLiveConsentRows>>[number]): AiDataUseConsent {
  return {
    ...row,
    provider: row.provider as AiProviderName,
    connection_tier: row.connection_tier as ConnectionTier,
    updated_at: row.withdrawn_at ?? row.agreed_at,
  }
}

async function realOverview(): Promise<AiConnectionOverview> {
  const { supabase, user } = await requireUser()
  const [connection, ai, keys, consents, usage] = await Promise.all([
    realConnection(),
    loadConnection(supabase, user.id),
    loadPublicKeyRows(supabase),
    loadLiveConsentRows(supabase),
    loadUsageSummary(supabase),
  ])
  return {
    connection,
    providers: ai.providers.map(({ info }) => {
      const p = info.provider
      const key = (keys.find((k) => k.provider === p) ?? null) as AiProviderKeyPublic | null
      const consent = [...consents].reverse().find((c) => c.provider === p)
      return {
        // Status, key-issue and upgrade links, description, default tier: UI constants (Q-6), no table column.
        info: {
          ...AI_PROVIDERS[p],
          display_order: info.displayOrder,
          is_available: info.isAvailable,
          is_recommended: info.isRecommended,
          dashboard_url: info.dashboardUrl ?? AI_PROVIDERS[p].dashboard_url,
          billing_url: info.billingUrl ?? AI_PROVIDERS[p].billing_url,
          key_guide_version: info.keyGuideVersion ?? AI_PROVIDERS[p].key_guide_version,
          key_guide_checked_at: info.keyGuideCheckedAt ?? AI_PROVIDERS[p].key_guide_checked_at,
        },
        key,
        is_active: ai.activeProvider === p && !!key,
        consent: consent ? toConsentRow(consent) : null,
      }
    }),
    month_estimated_cost_usd: usage.totals.estimatedCostUsd,
  }
}

/** The key row after a verification (ProviderKeyMeta has no timestamps): null when none is stored. */
async function realKeyRow(provider: AiProviderName): Promise<AiProviderKeyPublic | null> {
  return (await listRealKeys(provider))[0] ?? null
}

/** KeyCheckOutcome (service) → KeyCheckResult (screen). */
async function toKeyCheckResult(o: KeyCheckOutcome, provider: AiProviderName): Promise<KeyCheckResult> {
  if (o.result === "rejected") {
    return { outcome: "rejected", error_code: o.errorCode ?? "key_invalid", failure_cause: o.failureCause, ...(o.reason === "format" ? { format_error: true } : {}) }
  }
  const key = await realKeyRow(provider)
  if (!key) throw new AiConnectionError("save_failed")
  if (o.result === "valid") return { outcome: "valid", key, became_active: o.becameActive }
  return {
    outcome: "limited",
    key,
    became_active: o.becameActive,
    failure_cause: o.failureCause ?? "provider_unavailable",
    quota_resets_at: o.quotaResetsAt,
    retry_after: o.retryAfter,
  }
}

/** Service refusals → the error S-40 / S-41 catch. Anything unknown stays "save failed". */
function toConnectionError(err: unknown): AiConnectionError {
  if (isAppError(err)) {
    if (err.code === "ai_consent_required") return new AiConnectionError("consent_required")
    if (err.code === "key_not_found") return new AiConnectionError("no_key")
  }
  return new AiConnectionError("save_failed")
}

/** S-40 provider card view: provider reference row + the user's key (public columns) */
export interface ProviderCardData {
  info: AiProviderInfo
  key: AiProviderKeyPublic | null
  is_active: boolean
  /** latest non-withdrawn consent for this provider (any tier) */
  consent: AiDataUseConsent | null
}

export interface AiConnectionOverview {
  connection: AiConnection
  providers: ProviderCardData[]
  /** "이번 달 Resumate에서 약 $0.42 (예상치)" (S-40 사용량 입구) */
  month_estimated_cost_usd: number
}

/** S-40 AI 연결 (settings dialog section) */
export async function getAiConnectionOverview(): Promise<AiConnectionOverview> {
  if (!(await isPreviewRequest())) return realOverview()
  const db = await mockRequest()
  const period = currentPeriodMonth()
  return clone({
    connection: computeAiConnection(db),
    providers: AI_PROVIDER_ORDER.map((p) => {
      const key = db.ai_provider_keys.find((k) => k.provider === p)
      const consent =
        [...db.ai_data_use_consents].reverse().find((c) => c.provider === p && !c.withdrawn_at) ?? null
      return { info: AI_PROVIDERS[p], key: key ? toPublic(key) : null, is_active: db.profiles[0]?.active_ai_provider === p && !!key, consent }
    }),
    month_estimated_cost_usd: db.ai_usage_records
      .filter((r) => r.period_month === period)
      .reduce((sum, r) => sum + r.estimated_cost_usd, 0),
  })
}

export async function listProviderKeys(): Promise<AiProviderKeyPublic[]> {
  if (!(await isPreviewRequest())) return listRealKeys()
  const db = await mockRequest()
  return clone(db.ai_provider_keys.map(toPublic))
}

/** Current disclosure for provider × tier (C-21) */
export async function getDisclosure(provider: AiProviderName, tier: ConnectionTier): Promise<AiDisclosure | null> {
  if (!(await isPreviewRequest())) {
    const row = await loadCurrentDisclosureRow((await requireUser()).supabase, provider, tier)
    return row ? { ...row, provider, connection_tier: tier, terms_checked_at: row.terms_checked_at ?? "" } : null
  }
  const db = await mockRequest(0)
  const rows = db.ai_disclosures
    .filter((d) => d.provider === provider && d.connection_tier === tier)
    .sort((a, b) => b.effective_at.localeCompare(a.effective_at))
  return rows[0] ? clone(rows[0]) : null
}

/**
 * C-21 dialog context: `required` (2.11.5 rule) and `reconsent` — a live consent exists but a
 * newer `requires_reconsent` disclosure took effect (shows "데이터 사용 고지가 바뀌어 다시 동의가 필요해요").
 */
export async function getDataUseConsentState(
  provider: AiProviderName,
  tier: ConnectionTier,
): Promise<{ required: boolean; reconsent: boolean }> {
  if (!(await isPreviewRequest())) {
    const state = await getConsentState((await requireUser()).supabase, provider, tier)
    return { required: state.needsConsent, reconsent: state.needsConsent && state.agreedVersion !== null }
  }
  const db = await mockRequest(0)
  const required = consentRequired(db, provider, tier)
  const live = db.ai_data_use_consents.some((c) => c.provider === provider && c.connection_tier === tier && !c.withdrawn_at)
  return { required, reconsent: required && live }
}

/** Re-consent check (04 §2.11.5, v4.2 A20 — see consentRequired) */
export async function needsDataUseConsent(provider: AiProviderName, tier: ConnectionTier): Promise<boolean> {
  if (!(await isPreviewRequest())) return (await getConsentState((await requireUser()).supabase, provider, tier)).needsConsent
  const db = await mockRequest(0)
  return consentRequired(db, provider, tier)
}

/**
 * MOCK / dev only, mock store only (never `ai_disclosures`): publish a new disclosure version for provider × tier with
 * `requires_reconsent = true`, so `ai_connection.consent_required` becomes true for real (every AI
 * run then opens C-21 first; agreeing clears it). Reproduces R-67 without a `?state=` override.
 */
export async function publishMockReconsentDisclosure(provider?: AiProviderName, tier?: ConnectionTier): Promise<AiConnection> {
  // A public Server Action wraps this; a plain request (always, in production) never reaches the store.
  if (!(await isPreviewRequest())) throw new Error("mock reconsent is preview only")
  const db = await mockRequest(0)
  const base = computeAiConnection(db)
  const p = provider ?? base.active_provider
  const t = tier ?? base.connection_tier
  if (!p || !t) return base
  const now = new Date().toISOString()
  const version = `mock-${now}`
  db.ai_disclosures.push({
    id: newId(),
    provider: p,
    connection_tier: t,
    version,
    effective_at: now,
    requires_reconsent: true,
    requires_free_tier_ack: p === "gemini" && t === "free",
    document_path: `disclosures/${p}/${t}/${version}.md`,
    terms_checked_at: now.slice(0, 10),
  })
  return computeAiConnection(db)
}

// ---------------------------------------------------------------------------
// writes
// ---------------------------------------------------------------------------

export class AiConnectionError extends Error {
  constructor(
    public readonly reason: "consent_required" | "no_key" | "format" | "save_failed",
    message?: string,
  ) {
    super(message ?? reason)
  }
}

/** S-41 ② 동의 기록 (ai_data_use_consents insert). Withdraws older live rows of the same provider. */
export async function recordDataUseConsent(input: {
  provider: AiProviderName
  connection_tier: ConnectionTier
  free_tier_acknowledged: boolean
  fail?: boolean
}): Promise<AiDataUseConsent> {
  if (!(await isPreviewRequest())) {
    // The screen sends no version: the disclosure in effect now is what it shows (spec-gaps W1).
    const { supabase } = await requireUser()
    const disclosure = await loadCurrentDisclosureRow(supabase, input.provider, input.connection_tier)
    if (!disclosure) throw new AiConnectionError("save_failed")
    try {
      unwrap(
        await connectionActions.recordAiDataUseConsent({
          provider: input.provider,
          connectionTier: input.connection_tier,
          disclosureVersion: disclosure.version,
          freeTierAcknowledged: input.free_tier_acknowledged,
        }),
      )
    } catch (err) {
      throw toConnectionError(err)
    }
    const row = [...(await loadLiveConsentRows(supabase))]
      .reverse()
      .find((c) => c.provider === input.provider && c.connection_tier === input.connection_tier)
    if (!row) throw new AiConnectionError("save_failed")
    return toConsentRow(row)
  }
  const db = await mockRequest(300)
  if (input.fail) throw new AiConnectionError("save_failed")
  if (input.connection_tier === "free" && input.provider === "gemini" && !input.free_tier_acknowledged)
    throw new AiConnectionError("consent_required", "free tier acknowledgement required")
  const now = new Date().toISOString()
  for (const c of db.ai_data_use_consents)
    if (c.provider === input.provider && !c.withdrawn_at) Object.assign(c, { withdrawn_at: now, updated_at: now })
  // latest effective disclosure version for provider × tier
  const disclosure = db.ai_disclosures
    .filter((d) => d.provider === input.provider && d.connection_tier === input.connection_tier)
    .sort((a, b) => b.effective_at.localeCompare(a.effective_at))[0]
  const row: AiDataUseConsent = {
    id: newId(),
    user_id: USER_ID,
    created_at: now,
    updated_at: now,
    provider: input.provider,
    connection_tier: input.connection_tier,
    disclosure_version: disclosure?.version ?? "unknown",
    free_tier_acknowledged: input.free_tier_acknowledged,
    agreed_at: now,
    withdrawn_at: null,
  }
  db.ai_data_use_consents.push(row)
  return clone(row)
}

/** Result of the key check (S-41 ③ / S-40 다시 확인) */
export type KeyCheckResult =
  | { outcome: "valid"; key: AiProviderKeyPublic; became_active: boolean }
  | {
      outcome: "limited"
      key: AiProviderKeyPublic
      became_active: boolean
      failure_cause: AiFailureCause
      quota_resets_at: string | null
      retry_after: string | null
    }
  | { outcome: "rejected"; error_code: AiErrorCode; failure_cause: AiFailureCause | null; format_error?: boolean }

/** Mock outcome control (S-41 previews / tests): the error_code the provider "returns" */
export interface KeyCheckMock {
  /** key_invalid / billing_required / model_not_available → rejected; rate_limited / daily_quota_exhausted / provider_unavailable → limited */
  fail?: AiErrorCode | null
}

const LIMITED: AiErrorCode[] = ["rate_limited", "daily_quota_exhausted", "provider_unavailable"]

function keyFormatOk(provider: AiProviderName, raw: string): boolean {
  const v = raw.trim()
  return v.length >= 12 && AI_PROVIDERS[provider].key_prefixes.some((p) => v.startsWith(p))
}

/**
 * Key verification + save (04 §2.11.2–3): verify with the raw key (mock: format + injected
 * outcome), then save_provider_key with verification_result valid / limited, or reject without
 * saving (key_invalid / billing_required / model_not_available). First key → active provider.
 * Mock: a key ending in "0000" is treated as key_invalid, "1111" as rate-limited. // [UI-가정]
 */
export async function verifyAndSaveProviderKey(input: {
  provider: AiProviderName
  connection_tier: ConnectionTier
  raw_key: string
  mock?: KeyCheckMock
}): Promise<KeyCheckResult> {
  if (!(await isPreviewRequest())) {
    const state = await getConsentState((await requireUser()).supabase, input.provider, input.connection_tier)
    if (state.needsConsent || !state.agreedVersion) throw new AiConnectionError("consent_required")
    try {
      const outcome = unwrap(
        await connectionActions.registerProviderKey({
          provider: input.provider,
          connectionTier: input.connection_tier,
          apiKey: input.raw_key,
          disclosureVersion: state.agreedVersion,
        }),
      )
      return await toKeyCheckResult(outcome, input.provider)
    } catch (err) {
      throw err instanceof AiConnectionError ? err : toConnectionError(err)
    }
  }
  const db = await mockRequest(0)
  if (!keyFormatOk(input.provider, input.raw_key))
    return { outcome: "rejected", error_code: "key_invalid", failure_cause: "key_invalid", format_error: true }
  if (await needsDataUseConsent(input.provider, input.connection_tier)) throw new AiConnectionError("consent_required")
  const raw = input.raw_key.trim()
  const injected: AiErrorCode | null =
    input.mock?.fail ?? (raw.endsWith("0000") ? "key_invalid" : raw.endsWith("1111") ? "rate_limited" : null)
  let code: AiErrorCode | null = null
  try {
    await mockSyncCall(true, { ms: input.connection_tier === "free" ? 2_500 : 1_500, fail: injected })
  } catch (e) {
    code = e instanceof MockAiError ? e.error_code : "provider_unavailable"
  }
  recordMockUsage(db, {
    job_type: "key_verification",
    ai_job_id: null,
    application_project_id: null,
    provider: input.provider,
    connection_tier: input.connection_tier,
    outcome: code ? "failed" : "succeeded",
    error_code: code,
  })
  if (code && !LIMITED.includes(code)) return { outcome: "rejected", error_code: code, failure_cause: failureCauseOf(code) }
  // save_provider_key(..., verification_result)
  const verification: ProviderKeyVerificationResult = code ? "limited" : "valid"
  const now = new Date().toISOString()
  let row = db.ai_provider_keys.find((k) => k.provider === input.provider)
  if (!row) {
    row = {
      id: newId(),
      user_id: USER_ID,
      created_at: now,
      updated_at: now,
      provider: input.provider,
      connection_tier: input.connection_tier,
      key_ciphertext: "mock-ciphertext",
      key_nonce: "mock-nonce",
      wrapped_dek: "mock-dek",
      kek_id: "mock-kek-1",
      encryption_version: 1,
      key_last4: raw.slice(-4),
      status: "valid",
      last_verified_at: null,
      last_failure_cause: null,
      last_failure_at: null,
    }
    db.ai_provider_keys.push(row)
  }
  Object.assign(row, {
    connection_tier: input.connection_tier,
    key_last4: raw.slice(-4),
    status: verification === "valid" ? "valid" : "needs_check",
    last_verified_at: verification === "valid" ? now : null,
    last_failure_cause: code ? failureCauseOf(code) : null,
    last_failure_at: code ? now : null,
    updated_at: now,
  })
  const profile = db.profiles[0]
  const becameActive = !profile.active_ai_provider
  if (becameActive) profile.active_ai_provider = input.provider
  const key = clone(toPublic(row))
  if (!code) return { outcome: "valid", key, became_active: becameActive }
  return {
    outcome: "limited",
    key,
    became_active: becameActive,
    failure_cause: failureCauseOf(code) ?? "provider_unavailable",
    ...failureTimestamps(code),
  }
}

/** RPC record_provider_key_check (S-40 "다시 확인") */
export async function recheckProviderKey(provider: AiProviderName, mock?: KeyCheckMock): Promise<AiProviderKeyPublic | null> {
  if (!(await isPreviewRequest())) {
    const result = await connectionActions.recheckProviderKey({ provider })
    if ("error" in result && result.error.code === "key_not_found") return null
    unwrap(result)
    return realKeyRow(provider)
  }
  const db = await mockRequest(0)
  const row = db.ai_provider_keys.find((k) => k.provider === provider)
  if (!row) return null
  let code: AiErrorCode | null = null
  try {
    await mockSyncCall(true, { ms: row.connection_tier === "free" ? 2_500 : 1_500, fail: mock?.fail ?? null })
  } catch (e) {
    code = e instanceof MockAiError ? e.error_code : "provider_unavailable"
  }
  recordMockUsage(db, {
    job_type: "key_verification",
    ai_job_id: null,
    application_project_id: null,
    provider,
    connection_tier: row.connection_tier,
    outcome: code ? "failed" : "succeeded",
    error_code: code,
  })
  const now = new Date().toISOString()
  if (!code) Object.assign(row, { status: "valid", last_verified_at: now, updated_at: now })
  else
    Object.assign(row, {
      status: code === "key_invalid" ? "invalid" : "needs_check",
      last_failure_cause: failureCauseOf(code),
      last_failure_at: now,
      updated_at: now,
    })
  return clone(toPublic(row))
}

/** RPC delete_provider_key: hard delete, active → null (no auto switch), consent withdrawn */
export async function deleteProviderKey(provider: AiProviderName): Promise<void> {
  if (!(await isPreviewRequest())) {
    unwrap(await connectionActions.deleteProviderKey({ provider }))
    return
  }
  const db = await mockRequest()
  const now = new Date().toISOString()
  db.ai_provider_keys = db.ai_provider_keys.filter((k) => k.provider !== provider)
  const profile = db.profiles[0]
  if (profile.active_ai_provider === provider) profile.active_ai_provider = null
  for (const c of db.ai_data_use_consents)
    if (c.provider === provider && !c.withdrawn_at) Object.assign(c, { withdrawn_at: now, updated_at: now })
}

/** RPC set_active_ai_provider: only a provider with a registered key (FK) */
export async function setActiveAiProvider(provider: AiProviderName): Promise<AiConnection> {
  if (!(await isPreviewRequest())) {
    try {
      unwrap(await connectionActions.setActiveAiProvider({ provider }))
    } catch (err) {
      throw toConnectionError(err)
    }
    return realConnection()
  }
  const db = await mockRequest()
  if (!db.ai_provider_keys.some((k) => k.provider === provider)) throw new AiConnectionError("no_key")
  db.profiles[0].active_ai_provider = provider
  return computeAiConnection(db)
}

/** S-41 ①② 등급 변경: key keeps its secret, tier changes after re-consent */
export async function changeProviderTier(provider: AiProviderName, tier: ConnectionTier): Promise<AiProviderKeyPublic | null> {
  if (!(await isPreviewRequest())) {
    const state = await getConsentState((await requireUser()).supabase, provider, tier)
    if (state.needsConsent || !state.agreedVersion) throw new AiConnectionError("consent_required")
    const result = await connectionActions.recheckProviderKey({ provider, connectionTier: tier, disclosureVersion: state.agreedVersion })
    if ("error" in result && result.error.code === "key_not_found") return null
    try {
      const outcome = unwrap(result)
      // A rejected re-check keeps the old tier: the screen's save-failed row, not a silent success.
      if (outcome.result === "rejected") throw new AiConnectionError("save_failed")
    } catch (err) {
      throw err instanceof AiConnectionError ? err : toConnectionError(err)
    }
    return realKeyRow(provider)
  }
  const db = await mockRequest()
  const row = db.ai_provider_keys.find((k) => k.provider === provider)
  if (!row) return null
  if (await needsDataUseConsent(provider, tier)) throw new AiConnectionError("consent_required")
  Object.assign(row, { connection_tier: tier, updated_at: new Date().toISOString() })
  return clone(toPublic(row))
}

// ---------------------------------------------------------------------------
// `?state=` previews (C-18 / C-19 / ST-AI-KEY-*), client-safe shape
// ---------------------------------------------------------------------------

/**
 * ai_connection override for previews: ai-locked → none, key-invalid, key-check,
 * consent-required (v4.2 R-67). Same rules as components/common/ai-connection-context.
 */
export function previewAiConnection(base: AiConnection, state: string | null): AiConnection {
  if (state === "ai-locked") return { active_provider: null, key_status: null, connection_tier: null, consent_required: null }
  const provider = base.active_provider ?? "gemini"
  const tier = base.connection_tier ?? "free"
  if (state === "key-invalid")
    return { active_provider: provider, key_status: "invalid", connection_tier: tier, consent_required: false }
  if (state === "key-check")
    return { active_provider: provider, key_status: "needs_check", connection_tier: tier, consent_required: false }
  if (state === "consent-required")
    return { active_provider: provider, key_status: base.key_status ?? "valid", connection_tier: tier, consent_required: true }
  return base
}
