import type { AiConsentState, AiDisclosure } from "@/lib/contracts/ai-connection";
import { AI_PROVIDERS, CONNECTION_TIERS, type AiProvider, type ConnectionTier } from "@/lib/contracts/enums";
import { AppError } from "@/lib/contracts/errors";
import { mapDbError } from "@/server/db/errors";
import { logJobEvent } from "@/server/jobs/log";
import type { UserSupabaseClient } from "@/server/db/types";

/**
 * AI data-use consent (F-AI-04, DM 2.11.5 재동의 판정).
 *
 * Two different questions:
 * - **Save a key / change tier / make active** (strict): the latest active
 *   consent for (provider, tier) must cite the CURRENT disclosure version —
 *   the same rule `save_provider_key` enforces.
 * - **Run AI** (job start): an active consent must exist, and no disclosure
 *   with `requires_reconsent = true` may have taken effect after the agreed
 *   version (DM 2.11.5 "고지 버전이 바뀌면(requires_reconsent = true) 다음 AI
 *   실행 전에 재동의"). A wording-only update doesn't block running.
 */

export type DisclosureRow = {
  provider: string;
  connection_tier: string;
  version: string;
  effective_at: string;
  requires_reconsent: boolean;
  requires_free_tier_ack: boolean;
  document_path: string;
  terms_checked_at: string | null;
  created_at: string;
};

export type ConsentRow = {
  provider: string;
  connection_tier: string;
  disclosure_version: string;
  agreed_at: string;
  created_at: string;
};

const DISCLOSURE_COLUMNS =
  "provider, connection_tier, version, effective_at, requires_reconsent, requires_free_tier_ack, document_path, terms_checked_at, created_at";
const CONSENT_COLUMNS = "provider, connection_tier, disclosure_version, agreed_at, created_at";

export const CONSENT_REQUIRED_MESSAGE = "AI 데이터 사용 고지에 다시 동의해 주세요.";
export function consentRequired(): AppError {
  return new AppError("ai_consent_required", CONSENT_REQUIRED_MESSAGE, { status: 409 });
}

function byLatest<T extends { created_at: string }>(key: (r: T) => string) {
  return (a: T, b: T) => key(b).localeCompare(key(a)) || b.created_at.localeCompare(a.created_at);
}

/** Effective disclosures of one provider × tier, newest first. */
function effective(rows: DisclosureRow[], provider: AiProvider, tier: ConnectionTier, now: Date): DisclosureRow[] {
  const t = now.getTime();
  return rows
    .filter((d) => d.provider === provider && d.connection_tier === tier && Date.parse(d.effective_at) <= t)
    .sort(byLatest((d) => new Date(d.effective_at).toISOString()));
}

export function currentDisclosure(rows: DisclosureRow[], provider: AiProvider, tier: ConnectionTier, now: Date): DisclosureRow | null {
  return effective(rows, provider, tier, now)[0] ?? null;
}

export function latestActiveConsent(rows: ConsentRow[], provider: AiProvider, tier: ConnectionTier): ConsentRow | null {
  return (
    rows
      .filter((c) => c.provider === provider && c.connection_tier === tier)
      .sort(byLatest((c) => new Date(c.agreed_at).toISOString()))[0] ?? null
  );
}

/** Strict state (save / tier change / activation). Pure. */
export function consentStateOf(
  disclosures: DisclosureRow[],
  activeConsents: ConsentRow[],
  provider: AiProvider,
  tier: ConnectionTier,
  now: Date,
): AiConsentState {
  const current = currentDisclosure(disclosures, provider, tier, now);
  const agreed = latestActiveConsent(activeConsents, provider, tier);
  return {
    connectionTier: tier,
    currentVersion: current?.version ?? null,
    agreedVersion: agreed?.disclosure_version ?? null,
    agreedAt: agreed?.agreed_at ?? null,
    needsConsent: !current || !agreed || agreed.disclosure_version !== current.version,
  };
}

/** Run-time rule (job start). Pure. */
export function mayRunWithConsent(
  disclosures: DisclosureRow[],
  activeConsents: ConsentRow[],
  provider: AiProvider,
  tier: ConnectionTier,
  now: Date,
): boolean {
  const agreed = latestActiveConsent(activeConsents, provider, tier);
  if (!agreed) return false;
  const list = effective(disclosures, provider, tier, now);
  const agreedRow = list.find((d) => d.version === agreed.disclosure_version);
  // Agreed to a version that isn't (or is no longer) effective: ask again.
  if (!agreedRow) return false;
  const agreedAt = Date.parse(agreedRow.effective_at);
  return !list.some((d) => d.requires_reconsent && Date.parse(d.effective_at) > agreedAt);
}

export function toAiDisclosure(row: DisclosureRow): AiDisclosure {
  return {
    provider: row.provider as AiProvider,
    connectionTier: row.connection_tier as ConnectionTier,
    version: row.version,
    effectiveAt: row.effective_at,
    requiresReconsent: row.requires_reconsent,
    requiresFreeTierAck: row.requires_free_tier_ack,
    documentPath: row.document_path,
    termsCheckedAt: row.terms_checked_at,
  };
}

// ---------------- queries (user session) ----------------

export async function loadDisclosures(supabase: UserSupabaseClient, provider?: AiProvider): Promise<DisclosureRow[]> {
  let q = supabase.from("ai_disclosures").select(DISCLOSURE_COLUMNS);
  if (provider) q = q.eq("provider", provider);
  const { data, error } = await q;
  if (error) throw mapDbError(error);
  return (data ?? []) as DisclosureRow[];
}

/** The user's not-withdrawn consents (RLS: own rows). */
export async function loadActiveConsents(supabase: UserSupabaseClient, provider?: AiProvider): Promise<ConsentRow[]> {
  let q = supabase.from("ai_data_use_consents").select(CONSENT_COLUMNS).is("withdrawn_at", null);
  if (provider) q = q.eq("provider", provider);
  const { data, error } = await q;
  if (error) throw mapDbError(error);
  return (data ?? []) as ConsentRow[];
}

export async function getConsentState(
  supabase: UserSupabaseClient,
  provider: AiProvider,
  tier: ConnectionTier,
  now: Date = new Date(),
): Promise<AiConsentState> {
  const [d, c] = await Promise.all([loadDisclosures(supabase, provider), loadActiveConsents(supabase, provider)]);
  return consentStateOf(d, c, provider, tier, now);
}

/** Current disclosure (S-41 ② / C-21). 404 when none is in effect for the pair. */
export async function getAiDisclosure(supabase: UserSupabaseClient, provider: AiProvider, tier: ConnectionTier): Promise<AiDisclosure> {
  const row = currentDisclosure(await loadDisclosures(supabase, provider), provider, tier, new Date());
  if (!row) throw new AppError("not_found");
  return toAiDisclosure(row);
}

/**
 * S-41 ② consent (F-AI-04 (6)). The DB trigger enforces the current version and
 * the server time; free tier needs the separate acknowledgement (CHECK).
 */
export async function recordAiDataUseConsent(
  supabase: UserSupabaseClient,
  input: { provider: AiProvider; connectionTier: ConnectionTier; disclosureVersion: string; freeTierAcknowledged: boolean },
): Promise<AiConsentState> {
  const { error } = await supabase.from("ai_data_use_consents").insert({
    provider: input.provider,
    connection_tier: input.connectionTier,
    disclosure_version: input.disclosureVersion,
    free_tier_acknowledged: input.freeTierAcknowledged,
  });
  if (error) throw mapDbError(error);
  return getConsentState(supabase, input.provider, input.connectionTier);
}

/** User withdrawal (S-40). Running AI with that tier then needs consent again. */
export async function withdrawAiDataUseConsent(
  supabase: UserSupabaseClient,
  input: { provider: AiProvider; connectionTier: ConnectionTier },
  log: Log = logJobEvent,
): Promise<AiConsentState> {
  const { error } = await supabase
    .from("ai_data_use_consents")
    .update({ withdrawn_at: new Date().toISOString() })
    .eq("provider", input.provider)
    .eq("connection_tier", input.connectionTier)
    .is("withdrawn_at", null);
  if (error) throw mapDbError(error);
  // QA-S3b-01: no more data to this provider × tier — stop in-flight jobs. Best effort (QA-S3b-07):
  // the withdrawal is already committed, and the run gate (check_ai_run_allowed) blocks the next step anyway.
  await cancelInFlightJobs(supabase, input.provider, input.connectionTier, log);
  return getConsentState(supabase, input.provider, input.connectionTier);
}

type Log = (event: string, fields: Record<string, string | number | boolean | null>) => void;

/**
 * Requests cancel of the user's queued / running jobs on provider × tier
 * (queued: canceled before any call; running: aborted at the next heartbeat).
 * Never throws: failures are logged (ids and DB code only) and returned.
 */
export async function cancelInFlightJobs(
  supabase: UserSupabaseClient,
  provider: AiProvider,
  tier: ConnectionTier,
  log: Log = logJobEvent,
): Promise<{ requested: number; failed: number }> {
  let ids: string[];
  try {
    const { data, error } = await supabase
      .from("ai_jobs")
      .select("id")
      .eq("provider", provider)
      .eq("connection_tier", tier)
      .in("status", ["queued", "running"]);
    if (error) throw error;
    ids = (data ?? []).map((j) => j.id);
  } catch (err) {
    log("ai_consent.cancel_lookup_failed", { provider, connectionTier: tier, dbCode: dbCodeOf(err) });
    return { requested: 0, failed: 1 };
  }
  let requested = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      const { error } = await supabase.rpc("request_ai_job_cancel", { p_job_id: id });
      // Finished meanwhile: nothing to stop.
      if (error && error.message !== "invalid_ai_job_transition") throw error;
      requested++;
    } catch (err) {
      failed++;
      log("ai_consent.cancel_failed", { jobId: id, provider, dbCode: dbCodeOf(err) });
    }
  }
  return { requested, failed };
}

function dbCodeOf(err: unknown): string {
  return err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string"
    ? (err as { code: string }).code
    : "unknown";
}

export const ALL_PAIRS = AI_PROVIDERS.flatMap((p) => CONNECTION_TIERS.map((t) => [p, t] as const));
