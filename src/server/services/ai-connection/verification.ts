import { randomUUID } from "node:crypto";
import { failureCauseOf } from "@/lib/contracts/ai";
import {
  KEY_FORMAT_MESSAGE,
  keyCheckMessage,
  type KeyCheckOutcome,
  type KeyCheckResult,
  type ProviderKeyMeta,
} from "@/lib/contracts/ai-connection";
import type { AiErrorCode, AiProvider, ConnectionTier } from "@/lib/contracts/enums";
import { AppError } from "@/lib/contracts/errors";
import { isAiError } from "@/server/ai/errors";
import type { KeyVerificationResult } from "@/server/ai/llm";
import { resolveModel } from "@/server/ai/providers/models";
import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";
import { isKeyFailureCause, type KeySource } from "@/server/jobs/provider-context";
import type { JobMeta, JobRecord, JobStore, UsageStore } from "@/server/jobs/types";
import { createPriceCache, createUsageRecorder } from "@/server/jobs/usage-recorder";
import { encryptProviderKey, keyLast4, toByteaHex } from "@/server/keys/envelope";
import { isPlausibleProviderKey, keyVerificationTarget, normalizeProviderKey } from "@/server/keys/format";
import type { KmsAdapter } from "@/server/keys/kms";
import { consentRequired, getConsentState } from "./consent";
import { assertProviderAvailable, keyMetaFromRpc, loadActiveProvider, loadKeyMetas, toProviderKeyMeta } from "./keys";

/**
 * Key registration / replacement / re-check / tier change (F-AI-01, F-AI-02,
 * AI C-10.5, R-38, DM 2.11.2–2.11.3, NFR-KEY-01/04/05).
 *
 * Every verification is a `key_verification` ai_jobs row (target
 * `ai_provider` / uuidv5(provider) → one in flight per user and provider), run
 * synchronously inside the Server Action (target 5 s, free tier 10 s; no
 * retries, C-10.5), with one ai_usage_records row for the step-2 generation
 * call (meter "연결 확인", NFR-KEY-04).
 *
 * The plaintext key: register/replace use the string the user just sent;
 * re-check gets it through the run-time path (app_key_reader →
 * get_provider_key_secret → decrypt) while the job is running. It is passed to
 * `verify` and `encryptProviderKey` only — never to a log, an error, the job
 * row, a usage row, or the response (only `keyLast4`).
 */

export type Log = (event: string, fields: Record<string, string | number | boolean | null>) => void;

export type VerifyFn = (input: { provider: AiProvider; apiKey: string; signal: AbortSignal }) => Promise<KeyVerificationResult>;

export type KeyVerificationDeps = {
  /** User session (RLS as the user): key meta, consents, key RPCs. */
  supabase: UserSupabaseClient;
  userId: string;
  /** app_ai_writer stores of this user (ai_jobs, ai_usage_records). */
  store: JobStore;
  usage: UsageStore;
  /** Lazily built so a missing KEK fails before any provider call. */
  kms: () => KmsAdapter;
  /** Run-time key source (re-check). */
  keySource: KeySource;
  /** C-10.5 two-step check (ai `verifyProviderKey`; fake adapters in tests). */
  verify: VerifyFn;
  now?: () => Date;
  newId?: () => string;
  log?: Log;
};

/** Hard caps around the C-10.5 targets (paid 5 s, free 10 s). */
export const VERIFY_TIMEOUT_MS: Record<ConnectionTier, number> = { paid: 15_000, free: 20_000 };
/** An in-flight verification older than this is a dead invocation; it is closed as `stalled` and replaced. */
export const VERIFY_STALE_MS = 45_000;

const LIMITED_CAUSES = ["rate_limited", "daily_quota_exhausted", "provider_unavailable"] as const;
type LimitedCause = (typeof LIMITED_CAUSES)[number];
const STAGE = "verify";
const CALL_KEY = "key_verification.verify.1";

function emptyMeta(): JobMeta {
  return { runBase: 1, waitBase: 0, retries: {} };
}

type Verified = {
  result: KeyCheckResult;
  errorCode: AiErrorCode | null;
  retryAfter: string | null;
  quotaResetsAt: string | null;
};

/**
 * QA-S3b-02 / spec-gaps 2026-10-29: a verification that runs past its cap
 * (adapter `timeout`) is treated as a provider outage (C-11 cause 6):
 * `provider_unavailable`. Step 1 (not authenticated yet) → not saved;
 * step 2 (authenticated) → `limited` like any other step-2 outage (R-38).
 */
export function toVerified(v: KeyVerificationResult): Verified {
  const err = v.error;
  const code: AiErrorCode | null = err ? (err.code === "timeout" ? "provider_unavailable" : err.code) : null;
  const timedOutAfterAuth = err?.code === "timeout" && v.stage === 2;
  return {
    result: timedOutAfterAuth ? "limited" : v.decision,
    errorCode: code,
    retryAfter: err?.retryAfter?.toISOString() ?? null,
    quotaResetsAt: err?.quotaResetsAt?.toISOString() ?? null,
  };
}

function outcome(
  v: Verified,
  extra: { saved: boolean; key: ProviderKeyMeta | null; becameActive: boolean; keyLast4Fallback?: string; jobId: string | null; reason?: KeyCheckOutcome["reason"] },
): KeyCheckOutcome {
  return {
    result: v.result,
    reason: extra.reason ?? (v.result === "valid" ? null : "verification"),
    saved: extra.saved,
    key: extra.key,
    becameActive: extra.becameActive,
    errorCode: v.errorCode,
    failureCause: v.errorCode ? failureCauseOf(v.errorCode) : null,
    message: keyCheckMessage(v.errorCode),
    retryAfter: v.retryAfter,
    quotaResetsAt: v.quotaResetsAt,
    jobId: extra.jobId,
  };
}

// ---------------- verification job ----------------

type RunningJob = { record: JobRecord; gen: number };

async function openJob(deps: KeyVerificationDeps, provider: AiProvider, tier: ConnectionTier): Promise<RunningJob> {
  const now = deps.now ?? (() => new Date());
  const target = keyVerificationTarget(provider);
  const insert = async (): Promise<string> => {
    const id = (deps.newId ?? randomUUID)();
    await deps.store.insert({
      id,
      userId: deps.userId,
      jobType: "key_verification",
      applicationProjectId: null,
      targetType: target.type,
      targetId: target.id,
      provider,
      modelTier: "default",
      connectionTier: tier,
      params: {},
      inputHash: null,
      promptVersion: null,
      model: resolveModel(provider, "default"),
      progress: { stage: STAGE, done: 0, total: 1 },
      meta: emptyMeta(),
    });
    return id;
  };

  let jobId: string;
  try {
    jobId = await insert();
  } catch (err) {
    if (!(err instanceof AppError && err.code === "conflict")) throw err;
    // One verification per user and provider. A dead one (function killed mid-check) is closed and replaced.
    const other = await deps.store.findInFlight({
      userId: deps.userId,
      jobType: "key_verification",
      target,
      inputHash: null,
      applicationProjectId: null,
    });
    const otherJob = other ? await deps.store.get(other.id) : null;
    const lastBeat = otherJob ? Date.parse(otherJob.heartbeatAt ?? otherJob.createdAt) : NaN;
    if (otherJob && now().getTime() - lastBeat > VERIFY_STALE_MS) {
      await deps.store.finish(otherJob.id, otherJob.runGeneration, {
        status: "failed",
        errorCode: "stalled",
        finishedAt: now().toISOString(),
        nextRunAt: null,
      });
      jobId = await insert();
    } else {
      throw new AppError("key_verification_in_progress", "키를 확인하고 있어요. 잠시 후 다시 시도해 주세요.", { status: 409 });
    }
  }

  const claimed = await deps.store.claim(jobId, {
    now: now().toISOString(),
    staleBefore: new Date(now().getTime() + 1_000).toISOString(),
  });
  if (!claimed) throw new AppError("internal_error", undefined, { status: 500 });
  return { record: claimed, gen: claimed.runGeneration };
}

async function recordUsage(deps: KeyVerificationDeps, job: JobRecord, v: KeyVerificationResult): Promise<void> {
  // C-10.5 step 1 is a model listing (no tokens). Step 2 is the one generation call → one usage row.
  if (v.stage !== 2) return;
  const now = deps.now ?? (() => new Date());
  const onCall = createUsageRecorder({ store: deps.usage, job, priceFor: createPriceCache(deps.usage), now, log: deps.log ?? (() => {}) });
  await onCall({
    callKey: CALL_KEY,
    model: v.model,
    usage: v.usage ?? {
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      reasoningTokens: null,
      usageSource: "unavailable",
    },
    outcome: v.error ? "failed" : "succeeded",
    errorCode: v.error?.code ?? null,
    latencyMs: v.latencyMs,
  });
}

async function closeJob(deps: KeyVerificationDeps, job: RunningJob, errorCode: AiErrorCode | null): Promise<void> {
  const now = (deps.now ?? (() => new Date()))().toISOString();
  try {
    if (errorCode === null) {
      await deps.store.complete(job.record.id, job.gen, { stage: STAGE, done: 1, total: 1 });
    } else {
      await deps.store.finish(job.record.id, job.gen, { status: "failed", errorCode, finishedAt: now, heartbeatAt: now, nextRunAt: null });
    }
  } catch {
    // The verification result stands; a stuck row is closed by the stalled sweep / the next attempt (VERIFY_STALE_MS).
    deps.log?.("key_verification.close_failed", { jobId: job.record.id });
  }
}

/** Runs C-10.5. `result` is null when verify threw (timeout or a bug) — treated as a step-1 outage ("잠시 후 다시"). */
async function runVerify(
  deps: KeyVerificationDeps,
  provider: AiProvider,
  tier: ConnectionTier,
  apiKey: string,
): Promise<{ result: KeyVerificationResult | null; verified: Verified }> {
  try {
    const result = await deps.verify({ provider, apiKey, signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS[tier]) });
    return { result, verified: toVerified(result) };
  } catch (err) {
    deps.log?.("key_verification.verify_threw", { provider, aiError: isAiError(err) });
    return { result: null, verified: { result: "rejected", errorCode: "provider_unavailable", retryAfter: null, quotaResetsAt: null } };
  }
}

async function saveEncrypted(
  deps: KeyVerificationDeps,
  args: {
    provider: AiProvider;
    tier: ConnectionTier;
    keyId: string;
    apiKey: string;
    disclosureVersion: string;
    verified: Verified;
    kms: KmsAdapter;
  },
): Promise<ProviderKeyMeta> {
  const enc = await encryptProviderKey(args.apiKey, { userId: deps.userId, provider: args.provider, keyId: args.keyId }, args.kms);
  const limitedCause =
    args.verified.result === "limited" && (LIMITED_CAUSES as readonly string[]).includes(args.verified.errorCode ?? "")
      ? (args.verified.errorCode as LimitedCause)
      : undefined;
  const { data, error } = await deps.supabase.rpc("save_provider_key", {
    p_provider: args.provider,
    p_connection_tier: args.tier,
    p_key_ciphertext: toByteaHex(enc.keyCiphertext),
    p_key_nonce: toByteaHex(enc.keyNonce),
    p_wrapped_dek: toByteaHex(enc.wrappedDek),
    p_kek_id: enc.kekId,
    p_key_last4: keyLast4(args.apiKey),
    p_disclosure_version: args.disclosureVersion,
    p_verification_result: args.verified.result === "valid" ? "valid" : "limited",
    p_key_id: args.keyId,
    ...(limitedCause ? { p_failure_cause: limitedCause } : {}),
    p_encryption_version: enc.encryptionVersion,
  });
  if (error) throw mapDbError(error);
  return keyMetaFromRpc(data);
}

/** F-AI-04 (4): strict consent for (provider, tier) at the version the client showed. */
async function assertConsent(deps: KeyVerificationDeps, provider: AiProvider, tier: ConnectionTier, disclosureVersion: string): Promise<void> {
  const state = await getConsentState(deps.supabase, provider, tier, (deps.now ?? (() => new Date()))());
  if (state.needsConsent || state.currentVersion !== disclosureVersion) throw consentRequired();
}

// ---------------- register / replace ----------------

export async function registerProviderKey(
  deps: KeyVerificationDeps,
  input: { provider: AiProvider; connectionTier: ConnectionTier; apiKey: string; disclosureVersion: string },
): Promise<KeyCheckOutcome> {
  const { provider, connectionTier: tier } = input;
  const apiKey = normalizeProviderKey(input.apiKey);
  await assertProviderAvailable(deps.supabase, provider);
  await assertConsent(deps, provider, tier, input.disclosureVersion);

  const [existing] = await loadKeyMetas(deps.supabase, provider);
  if (!isPlausibleProviderKey(provider, apiKey)) {
    // No provider call, no job (S-41 "{공급자} 키 형식이 아니에요"). A replacement keeps the old key.
    return {
      ...outcome({ result: "rejected", errorCode: "key_invalid", retryAfter: null, quotaResetsAt: null }, {
        saved: false,
        key: existing ? toProviderKeyMeta(existing, await loadActiveProvider(deps.supabase, deps.userId)) : null,
        becameActive: false,
        jobId: null,
        reason: "format",
      }),
      message: KEY_FORMAT_MESSAGE[provider],
    };
  }

  const kms = deps.kms(); // fail closed (no KEK) before spending a provider call
  const activeBefore = await loadActiveProvider(deps.supabase, deps.userId);
  const keyId = existing?.id ?? (deps.newId ?? randomUUID)();

  const job = await openJob(deps, provider, tier);
  const { result: v, verified } = await runVerify(deps, provider, tier, apiKey);
  if (v) await recordUsage(deps, job.record, v);
  deps.log?.("key_verification.result", { jobId: job.record.id, provider, result: verified.result, errorCode: verified.errorCode });

  if (verified.result === "rejected") {
    // R-38: key_invalid / billing_required / model_not_available (or step-1 outage) → not saved, old key kept.
    await closeJob(deps, job, verified.errorCode ?? "provider_unavailable");
    const key = existing ? toProviderKeyMeta(existing, activeBefore) : null;
    return outcome(verified, { saved: false, key, becameActive: false, jobId: job.record.id });
  }

  let meta: ProviderKeyMeta;
  try {
    meta = await saveEncrypted(deps, { provider, tier, keyId, apiKey, disclosureVersion: input.disclosureVersion, verified, kms });
  } catch (err) {
    await closeJob(deps, job, "stalled");
    throw err;
  }
  await closeJob(deps, job, null);
  return outcome(verified, { saved: true, key: meta, becameActive: meta.isActive && activeBefore !== provider, jobId: job.record.id });
}

// ---------------- re-check / tier change ----------------

export async function recheckProviderKey(
  deps: KeyVerificationDeps,
  input: { provider: AiProvider; connectionTier?: ConnectionTier; disclosureVersion?: string },
): Promise<KeyCheckOutcome> {
  const { provider } = input;
  const [existing] = await loadKeyMetas(deps.supabase, provider);
  if (!existing) throw new AppError("key_not_found", "등록된 키가 없는 공급자예요.", { status: 404 });
  const storedTier = existing.connection_tier as ConnectionTier;
  const tier = input.connectionTier ?? storedTier;
  const tierChange = tier !== storedTier;
  let kms: KmsAdapter | null = null;
  if (tierChange) {
    await assertProviderAvailable(deps.supabase, provider);
    await assertConsent(deps, provider, tier, input.disclosureVersion ?? "");
    kms = deps.kms();
  }

  const job = await openJob(deps, provider, tier);
  let apiKey: string;
  try {
    apiKey = await deps.keySource.forJob(job.record.id, provider);
  } catch (err) {
    const code: AiErrorCode = isAiError(err) ? err.code : "stalled";
    await closeJob(deps, job, code);
    if (code === "key_missing") throw new AppError("key_not_found", "등록된 키가 없는 공급자예요.", { status: 404 });
    throw new AppError("internal_error", undefined, { status: 500 });
  }

  const { result: v, verified } = await runVerify(deps, provider, tier, apiKey);
  if (v) await recordUsage(deps, job.record, v);
  deps.log?.("key_verification.result", { jobId: job.record.id, provider, result: verified.result, errorCode: verified.errorCode, tierChange });

  try {
    if (tierChange && kms && verified.result !== "rejected") {
      const meta = await saveEncrypted(deps, {
        provider,
        tier,
        keyId: existing.id,
        apiKey,
        disclosureVersion: input.disclosureVersion ?? "",
        verified,
        kms,
      });
      await closeJob(deps, job, null);
      return outcome(verified, { saved: true, key: meta, becameActive: false, jobId: job.record.id });
    }

    // DM 2.11.3 record_provider_key_check: valid → valid / key_invalid → invalid / others → needs_check.
    const cause = verified.errorCode ? failureCauseOf(verified.errorCode) : null;
    const { data, error } = await deps.supabase.rpc(
      "record_provider_key_check",
      verified.result === "valid"
        ? { p_provider: provider, p_result_status: "valid" }
        : { p_provider: provider, p_result_status: "failed", p_failure_cause: isKeyFailureCause(cause) ? cause : "provider_unavailable" },
    );
    if (error) throw mapDbError(error);
    await closeJob(deps, job, verified.result === "valid" ? null : (verified.errorCode ?? "provider_unavailable"));
    return outcome(verified, { saved: false, key: keyMetaFromRpc(data), becameActive: false, jobId: job.record.id });
  } catch (err) {
    await closeJob(deps, job, "stalled");
    throw err;
  }
}
