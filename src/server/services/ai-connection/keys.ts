import {
  ProviderKeyMetaSchema,
  type AiConnection,
  type AiProviderConnection,
  type AiProviderInfo,
  type ProviderKeyMeta,
} from "@/lib/contracts/ai-connection";
import { AI_PROVIDERS, CONNECTION_TIERS, type AiErrorCode, type AiProvider, type ConnectionTier, type KeyStatus } from "@/lib/contracts/enums";
import { AppError } from "@/lib/contracts/errors";
import { mapDbError } from "@/server/db/errors";
import type { AiWriterSupabaseClient, UserSupabaseClient } from "@/server/db/types";
import { type KeyFailureCause, type KeyStatusReporter, type ProviderContext, type ProviderContextSource } from "@/server/jobs/provider-context";
import { consentRequired, consentStateOf, loadActiveConsents, loadDisclosures, mayRunWithConsent } from "./consent";

/**
 * AI connection reads and simple writes (S-40, DM 2.11) + the runner's real
 * provider context and key status reporter (S3a interfaces).
 * Everything here reads metadata only — the ciphertext columns have no grant
 * for these roles at all (DM 2.11.1).
 */

/** Columns of ai_provider_keys_public the service uses. */
const KEY_META_COLUMNS = "id, provider, connection_tier, key_last4, status, last_verified_at, last_failure_cause, last_failure_at";

type KeyMetaRow = {
  id: string;
  provider: string;
  connection_tier: string;
  key_last4: string;
  status: string;
  last_verified_at: string | null;
  last_failure_cause: string | null;
  last_failure_at: string | null;
  is_active?: boolean;
};

export function toProviderKeyMeta(row: KeyMetaRow, activeProvider: AiProvider | null): ProviderKeyMeta {
  const parsed = ProviderKeyMetaSchema.safeParse({
    id: row.id,
    provider: row.provider,
    connectionTier: row.connection_tier,
    keyLast4: row.key_last4,
    status: row.status,
    lastVerifiedAt: row.last_verified_at,
    lastFailureCause: row.last_failure_cause,
    lastFailureAt: row.last_failure_at,
    isActive: row.is_active ?? row.provider === activeProvider,
  });
  if (!parsed.success) throw new AppError("internal_error", undefined, { status: 500, cause: parsed.error });
  return parsed.data;
}

/** Key meta JSON returned by save_provider_key / record_provider_key_check. */
export function keyMetaFromRpc(data: unknown): ProviderKeyMeta {
  const row = (data ?? {}) as KeyMetaRow;
  return toProviderKeyMeta(row, null);
}

export async function loadKeyMetas(supabase: UserSupabaseClient, provider?: AiProvider): Promise<KeyMetaRow[]> {
  let q = supabase.from("ai_provider_keys_public").select(KEY_META_COLUMNS);
  if (provider) q = q.eq("provider", provider);
  const { data, error } = await q;
  if (error) throw mapDbError(error);
  return (data ?? []) as KeyMetaRow[];
}

export async function loadActiveProvider(supabase: UserSupabaseClient, userId: string): Promise<AiProvider | null> {
  const { data, error } = await supabase.from("profiles").select("active_ai_provider").eq("id", userId).maybeSingle();
  if (error) throw mapDbError(error);
  const value = data?.active_ai_provider ?? null;
  return (AI_PROVIDERS as readonly string[]).includes(value ?? "") ? (value as AiProvider) : null;
}

type ProviderRow = {
  provider: string;
  display_order: number;
  is_available: boolean;
  is_recommended: boolean;
  dashboard_url: string | null;
  billing_url: string | null;
  key_guide_version: string | null;
  key_guide_checked_at: string | null;
};

export async function loadProviders(supabase: UserSupabaseClient): Promise<AiProviderInfo[]> {
  const { data, error } = await supabase
    .from("ai_providers")
    .select("provider, display_order, is_available, is_recommended, dashboard_url, billing_url, key_guide_version, key_guide_checked_at")
    .order("display_order", { ascending: true });
  if (error) throw mapDbError(error);
  return ((data ?? []) as ProviderRow[])
    .filter((r) => (AI_PROVIDERS as readonly string[]).includes(r.provider))
    .map((r) => ({
      provider: r.provider as AiProvider,
      displayOrder: r.display_order,
      isAvailable: r.is_available,
      isRecommended: r.is_recommended,
      dashboardUrl: r.dashboard_url,
      billingUrl: r.billing_url,
      keyGuideVersion: r.key_guide_version,
      keyGuideCheckedAt: r.key_guide_checked_at,
    }));
}

/** D-38: a paused provider takes no new key or replacement ("일시 중지", stored keys stay). */
export async function assertProviderAvailable(supabase: UserSupabaseClient, provider: AiProvider): Promise<void> {
  const { data, error } = await supabase.from("ai_providers").select("is_available").eq("provider", provider).maybeSingle();
  if (error) throw mapDbError(error);
  if (!data?.is_available) {
    throw new AppError("ai_provider_paused", "이 공급자 연결을 잠시 멈췄어요. 이미 연결한 키는 계속 보관돼요.", { status: 409 });
  }
}

/** queued + running jobs per provider (S-40 delete dialog "진행 중인 AI 작업 N건"). */
async function countInFlight(supabase: UserSupabaseClient): Promise<Record<AiProvider, number>> {
  const counts: Record<AiProvider, number> = { openai: 0, gemini: 0, anthropic: 0 };
  const { data, error } = await supabase.from("ai_jobs").select("provider").in("status", ["queued", "running"]);
  if (error) throw mapDbError(error);
  for (const row of data ?? []) {
    const p = row.provider as AiProvider;
    if (p in counts) counts[p] += 1;
  }
  return counts;
}

/** Everything S-40 shows (F-AI-01~05, F-AI-09). */
export async function getAiConnection(supabase: UserSupabaseClient, userId: string, now: Date = new Date()): Promise<AiConnection> {
  const [providers, keys, active, disclosures, consents, inFlight] = await Promise.all([
    loadProviders(supabase),
    loadKeyMetas(supabase),
    loadActiveProvider(supabase, userId),
    loadDisclosures(supabase),
    loadActiveConsents(supabase),
    countInFlight(supabase),
  ]);
  const list: AiProviderConnection[] = providers.map((info) => {
    const row = keys.find((k) => k.provider === info.provider);
    return {
      info,
      key: row ? toProviderKeyMeta(row, active) : null,
      consents: Object.fromEntries(
        CONNECTION_TIERS.map((t) => [t, consentStateOf(disclosures, consents, info.provider, t, now)]),
      ) as Record<ConnectionTier, ReturnType<typeof consentStateOf>>,
      inFlightJobs: inFlight[info.provider],
    };
  });
  return { activeProvider: active, providers: list, needsActiveSelection: active === null && keys.length > 0 };
}

/** F-AI-02 (3)/(4), NFR-KEY-06: hard delete, consents withdrawn, no automatic switch. */
export async function deleteProviderKey(supabase: UserSupabaseClient, provider: AiProvider): Promise<{ deleted: boolean }> {
  const { data, error } = await supabase.rpc("delete_provider_key", { p_provider: provider });
  if (error) throw mapDbError(error);
  return { deleted: data === true };
}

/**
 * F-AI-03: next runs use this provider. The key's tier must have a current
 * consent first (S-40 "등급·고지 버전이 다르면 C-21 재동의").
 */
export async function setActiveAiProvider(supabase: UserSupabaseClient, userId: string, provider: AiProvider): Promise<AiConnection> {
  const [key] = await loadKeyMetas(supabase, provider);
  if (!key) throw new AppError("key_not_found", "등록된 키가 없는 공급자예요.", { status: 404 });
  const [disclosures, consents] = await Promise.all([loadDisclosures(supabase, provider), loadActiveConsents(supabase, provider)]);
  if (consentStateOf(disclosures, consents, provider, key.connection_tier as ConnectionTier, new Date()).needsConsent) {
    throw consentRequired();
  }
  const { error } = await supabase.rpc("set_active_ai_provider", { p_provider: provider });
  if (error) throw mapDbError(error);
  return getAiConnection(supabase, userId);
}

// ---------------- runner wiring (S3a interfaces) ----------------

/**
 * Real `ProviderContextSource` (S3a notes "남은 일"): active provider + key
 * status + tier from the user session, plus the run-time consent rule.
 * Used for new jobs and same-row retries alike (C-11.4, A1 changed in R2).
 * `clientFor` must return a client of THE SAME user (user-session client in a
 * request); a mismatch is refused.
 */
export function createDbProviderContextSource(clientFor: (userId: string) => Promise<UserSupabaseClient>): ProviderContextSource {
  return {
    async forUser(userId): Promise<ProviderContext | null> {
      const supabase = await clientFor(userId);
      const active = await loadActiveProvider(supabase, userId);
      if (!active) return null;
      const [key] = await loadKeyMetas(supabase, active);
      if (!key) return null;
      const tier = key.connection_tier as ConnectionTier;
      const [disclosures, consents] = await Promise.all([loadDisclosures(supabase, active), loadActiveConsents(supabase, active)]);
      if (!mayRunWithConsent(disclosures, consents, active, tier, new Date())) throw consentRequired();
      return { provider: active, connectionTier: tier, keyStatus: key.status as KeyStatus };
    },
    async peekActive(userId) {
      const supabase = await clientFor(userId);
      const active = await loadActiveProvider(supabase, userId);
      if (!active) return null;
      const [key] = await loadKeyMetas(supabase, active);
      return key ? { provider: active, connectionTier: key.connection_tier as ConnectionTier, keyStatus: key.status as KeyStatus } : null;
    },
  };
}

/** Real `KeyStatusReporter`: app_ai_writer RPCs (never touch ciphertext, NFR-KEY-09). */
export function createDbKeyStatusReporter(db: AiWriterSupabaseClient): KeyStatusReporter {
  const mark = async (jobId: string, cause: KeyFailureCause) => {
    const { error } = await db.rpc("mark_provider_key_invalid", { p_ai_job_id: jobId, p_failure_cause: cause });
    if (error) throw mapDbError(error);
  };
  return {
    markInvalid: (jobId) => mark(jobId, "key_invalid"),
    recordFailure: (jobId, cause) => mark(jobId, cause),
    async recordSuccess(jobId) {
      const { error } = await db.rpc("record_provider_key_success", { p_ai_job_id: jobId });
      if (error) throw mapDbError(error);
    },
  };
}

/**
 * QA-S3b-01 run-time gate (decisions 2026-10-29): app_ai_writer RPC
 * `check_ai_run_allowed` before every step. null → allowed. `consent_required`
 * ends the job as `key_missing` (user_account, failure_cause null → "AI
 * 연결하기" lock); `key_invalid` / `key_missing` as themselves. No provider
 * call and no usage record when blocked.
 */
export function mapRunGate(answer: string | null): AiErrorCode | null {
  if (answer === null || answer === undefined) return null;
  if (answer === "key_invalid") return "key_invalid";
  if (answer === "key_missing" || answer === "consent_required") return "key_missing";
  throw new AppError("internal_error", undefined, { status: 500, cause: new Error("unknown run gate answer") });
}

export function createDbRunGate(db: AiWriterSupabaseClient): (jobId: string) => Promise<AiErrorCode | null> {
  return async (jobId) => {
    const { data, error } = await db.rpc("check_ai_run_allowed", { p_ai_job_id: jobId });
    if (error) throw mapDbError(error);
    // The generated type says string, but the RPC returns null when the run is allowed.
    return mapRunGate((data as string | null) ?? null);
  };
}
