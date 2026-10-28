import "server-only";
import type { AiErrorCode } from "@/lib/contracts/errors";
import { ProviderError, isProviderError, signalReason } from "./errors";
import { consoleAiLogger, type AiLogger } from "./log";
import { getProviderAdapter } from "./providers/index";
import { DEFAULT_MAX_OUTPUT_TOKENS, resolveModel } from "./providers/models";
import type {
  AiCallResult,
  AiTextBlock,
  ConnectionTier,
  LlmStreamEvent,
  ModelTier,
  NormalizedUsage,
  ProviderAdapter,
  ProviderCallRequest,
  ProviderId,
  ReasoningLevel,
} from "./providers/types";
import { UNAVAILABLE_USAGE } from "./providers/types";

/**
 * The provider-neutral model client a job step uses (S3a plan "인터페이스 합의").
 * The job runner builds one per step with the job's fixed provider, tier, and
 * connection tier (C-10, D-28). Each call:
 *   1. fetches the decrypted key from `keySource` (never stored here),
 *   2. resolves tier → model (C-10.1, no fallback, D-31),
 *   3. calls the adapter,
 *   4. hands one usage record per call to `onCall` (C-13; failures too),
 *   5. logs C-7 fields only.
 * Pipelines receive `Llm`; they never see the key or pick a provider.
 */

export type KeySource = {
  /** Decrypted key for the job's provider. Throws `new ProviderError("key_missing")` when the key is gone (D-36). */
  forJob(jobId: string): Promise<string>;
};

export type LlmCallRecord = {
  jobId: string;
  callKey: string;
  /** Log feature id of the request (e.g. "AI-02.match"); the usage `feature` column comes from the job type (api). */
  feature: string;
  promptVersion: string;
  provider: ProviderId;
  model: string;
  modelTier: ModelTier;
  connectionTier: ConnectionTier;
  outcome: "succeeded" | "failed";
  errorCode: AiErrorCode | null;
  usage: NormalizedUsage;
  latencyMs: number;
  occurredAt: Date;
};

export type LlmRequest = {
  feature: string;
  promptVersion: string;
  /** ai_usage_records.call_key, e.g. "insight.match.2". */
  callKey: string;
  /** Defaults to the Llm's tier. Set only when one job mixes tiers (AI-12 extract vs reply). */
  tier?: ModelTier;
  /** C-8 prefix order: [common system] → [feature system]. Instructions only (C-4). */
  systemBlocks: readonly AiTextBlock[];
  /** C-8 prefix order: [career pack] → [JD] → [variable input], each in its data tag. */
  userBlocks: readonly AiTextBlock[];
  /** Canonical JSON schema (providers/schema.ts `toCanonicalJsonSchema`) or null for free text. */
  outputSchema: Record<string, unknown> | null;
  maxOutputTokens?: number;
  /** Defaults to "low" (C-4: low for latency-sensitive streaming). */
  reasoningLevel?: ReasoningLevel;
  /** abort("canceled") = user cancel; any other reason = timeout. */
  signal?: AbortSignal;
};

export interface Llm {
  readonly provider: ProviderId;
  readonly tier: ModelTier;
  readonly connectionTier: ConnectionTier;
  modelFor(tier?: ModelTier): string;
  /**
   * One call. Throws ProviderError (C-11 codes) on failure. The usage record
   * (`onCall`) has settled before this promise resolves or rejects.
   */
  complete(request: LlmRequest): Promise<AiCallResult>;
  /**
   * C-10.3 normalized stream: `delta`* then exactly one `done` or `error`.
   * Provider failures arrive as the `error` event (with `beforeFirstToken`),
   * not as a throw; its usage record has settled before the event is yielded.
   * Only a key lookup failure (before any provider call) throws.
   */
  stream(request: LlmRequest): AsyncIterable<LlmStreamEvent>;
  /**
   * QA-S3a-03: waits (≤ timeoutMs) for every call started on this Llm to
   * deliver its usage record, then force-records any call still open
   * (abandoned stream, call cut by the step deadline) as failed with
   * `canceled`/`timeout` and usage `unavailable`. Exactly one record per
   * provider call either way; a late finish after a forced record is dropped.
   * Records already being written get up to LLM_SETTLE_GRACE_MS more (total
   * worst case timeoutMs + grace). The runner awaits this on every exit path.
   */
  settle(timeoutMs?: number, graceMs?: number): Promise<void>;
}

export const LLM_SETTLE_TIMEOUT_MS = 3_000;
/** Extra wait after LLM_SETTLE_TIMEOUT_MS for usage inserts already in progress or just forced (QA-S3a-10). */
export const LLM_SETTLE_GRACE_MS = 2_000;

/** Resolves when all promises settle or after `ms`, whichever is first. */
async function within(promises: Promise<void>[], ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => (timer = setTimeout(resolve, ms)));
  await Promise.race([Promise.all(promises), timeout]);
  clearTimeout(timer);
}

export type CreateLlmOptions = {
  provider: ProviderId;
  tier: ModelTier;
  connectionTier: ConnectionTier;
  keySource: KeySource;
  jobId: string;
  /** Usage row writer (api: ai_usage_records insert + cost). Awaited after every provider call. */
  onCall: (record: LlmCallRecord) => void | Promise<void>;
  /**
   * Run-level abort signal (step deadline / cancel), applied to every call
   * together with the request's own signal (QA-S3a-03), so a step that
   * forgets `request.signal` still stops on cancel or deadline.
   */
  signal?: AbortSignal;
  logger?: AiLogger;
  now?: () => number;
  /** Test injection; production uses providers/index.ts. */
  adapters?: Partial<Record<ProviderId, ProviderAdapter>>;
};

type Outcome = { ok: true; result: AiCallResult } | { ok: false; error: ProviderError; usage: NormalizedUsage };

/** One in-flight provider call (QA-S3a-03 exactly-one-record guard). */
type CallTracker = {
  request: LlmRequest;
  tier: ModelTier;
  model: string;
  startedAt: number;
  signal: AbortSignal | undefined;
  recorded: boolean;
  /** Resolves once the usage record for this call has settled. */
  settled: Promise<void>;
  markSettled: () => void;
};

export function createLlm(options: CreateLlmOptions): Llm {
  const logger = options.logger ?? consoleAiLogger;
  const now = options.now ?? Date.now;
  const open = new Set<CallTracker>();

  const adapter = (): ProviderAdapter => options.adapters?.[options.provider] ?? getProviderAdapter(options.provider);

  function mergeSignals(request: LlmRequest): AbortSignal | undefined {
    const signals = [options.signal, request.signal].filter((s): s is AbortSignal => !!s);
    if (signals.length <= 1) return signals[0];
    return AbortSignal.any(signals);
  }

  async function prepare(request: LlmRequest): Promise<{ call: ProviderCallRequest; tracker: CallTracker; impl: ProviderAdapter }> {
    const tier = request.tier ?? options.tier;
    const apiKey = await options.keySource.forJob(options.jobId);
    const impl = adapter();
    const signal = mergeSignals(request);
    const call: ProviderCallRequest = {
      model: resolveModel(options.provider, tier),
      apiKey,
      systemBlocks: request.systemBlocks,
      userBlocks: request.userBlocks,
      outputSchema: request.outputSchema,
      maxOutputTokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      reasoningLevel: request.reasoningLevel ?? "low",
      signal,
    };
    let markSettled = () => {};
    const settled = new Promise<void>((resolve) => (markSettled = resolve));
    const tracker: CallTracker = { request, tier, model: call.model, startedAt: now(), signal, recorded: false, settled, markSettled };
    open.add(tracker);
    return { call, tracker, impl };
  }

  /** Logs and records one call. No-op when this call was already recorded. */
  async function finish(tracker: CallTracker, outcome: Outcome): Promise<void> {
    if (tracker.recorded) return;
    tracker.recorded = true;
    const { request, tier, model } = tracker;
    const usage = outcome.ok ? outcome.result.usage : outcome.usage;
    const latencyMs = outcome.ok ? outcome.result.latencyMs : now() - tracker.startedAt;
    try {
      logger({
        event: "ai_call",
        jobId: options.jobId,
        feature: request.feature,
        callKey: request.callKey,
        promptVersion: request.promptVersion,
        provider: options.provider,
        tier,
        connectionTier: options.connectionTier,
        model,
        outcome: outcome.ok ? "ok" : "error",
        errorCode: outcome.ok ? null : outcome.error.code,
        unclassified: outcome.ok ? false : outcome.error.unclassified,
        beforeFirstToken: outcome.ok ? null : outcome.error.beforeFirstToken,
        inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        outputTokens: usage.outputTokens,
        reasoningTokens: usage.reasoningTokens,
        usageSource: usage.usageSource,
        latencyMs,
      });
      await options.onCall({
        jobId: options.jobId,
        callKey: request.callKey,
        feature: request.feature,
        promptVersion: request.promptVersion,
        provider: options.provider,
        model,
        modelTier: tier,
        connectionTier: options.connectionTier,
        outcome: outcome.ok ? "succeeded" : "failed",
        errorCode: outcome.ok ? null : outcome.error.code,
        usage,
        latencyMs,
        occurredAt: new Date(now()),
      });
    } catch {
      // A failed usage insert must not fail (and so re-run) a call whose tokens are already spent [구현 결정].
      logger({ event: "usage_record_failed", jobId: options.jobId, callKey: request.callKey, provider: options.provider });
    } finally {
      open.delete(tracker);
      tracker.markSettled();
    }
  }

  /** Failure record for a call that never reached a terminal event. */
  function abandoned(tracker: CallTracker, beforeFirstToken: boolean): Outcome {
    const code = signalReason(tracker.signal) ?? "canceled";
    return { ok: false, error: new ProviderError(code, { provider: options.provider, beforeFirstToken }), usage: UNAVAILABLE_USAGE };
  }

  async function* stream(request: LlmRequest): AsyncGenerator<LlmStreamEvent> {
    const { call, tracker, impl } = await prepare(request);
    let emitted = false;
    try {
      for await (const event of impl.stream(call)) {
        if (event.type === "delta") {
          emitted = true;
          yield event;
          continue;
        }
        if (event.type === "done") {
          await finish(tracker, { ok: true, result: event.result });
        } else {
          await finish(tracker, { ok: false, error: event.error, usage: event.usage });
        }
        yield event;
        return;
      }
      // Adapter ended without a terminal event (defect): still one terminal event and one record.
      const error = new ProviderError("provider_unavailable", { provider: options.provider, unclassified: true, beforeFirstToken: !emitted });
      await finish(tracker, { ok: false, error, usage: UNAVAILABLE_USAGE });
      yield { type: "error", error, usage: UNAVAILABLE_USAGE };
    } catch (err) {
      if (tracker.recorded) throw err;
      // Adapters don't throw; this is a defect.
      const error = isProviderError(err)
        ? err.with({ beforeFirstToken: !emitted })
        : new ProviderError("provider_unavailable", { provider: options.provider, unclassified: true, beforeFirstToken: !emitted, cause: err });
      await finish(tracker, { ok: false, error, usage: UNAVAILABLE_USAGE });
      yield { type: "error", error, usage: UNAVAILABLE_USAGE };
    } finally {
      // Consumer stopped iterating before a terminal event (break / return).
      if (!tracker.recorded) await finish(tracker, abandoned(tracker, !emitted));
    }
  }

  async function settle(timeoutMs: number = LLM_SETTLE_TIMEOUT_MS, graceMs: number = LLM_SETTLE_GRACE_MS): Promise<void> {
    if (open.size === 0) return;
    await within([...open].map((t) => t.settled), timeoutMs);
    // Still open after the cap: either still running (abandoned stream, call past the
    // deadline) → force-record now, or already recording (slow usage insert) → keep
    // waiting. Both get one more short bound (QA-S3a-10).
    const remaining = [...open];
    if (remaining.length === 0) return;
    for (const t of remaining) if (!t.recorded) void finish(t, abandoned(t, true));
    await within(remaining.map((t) => t.settled), graceMs);
  }

  return {
    provider: options.provider,
    tier: options.tier,
    connectionTier: options.connectionTier,
    modelFor: (tier) => resolveModel(options.provider, tier ?? options.tier),
    async complete(request) {
      for await (const event of stream(request)) {
        if (event.type === "done") return event.result;
        // A complete() caller never showed a delta, so the retry gate (beforeFirstToken) stays open.
        if (event.type === "error") throw event.error.with({ beforeFirstToken: true, usage: event.usage });
      }
      throw new ProviderError("provider_unavailable", { provider: options.provider, unclassified: true });
    },
    stream,
    settle,
  };
}

// ---------- C-10.5 key verification ----------

export type KeyVerificationResult = {
  /** valid / limited → save_provider_key; rejected → don't save (R-38). */
  decision: "valid" | "limited" | "rejected";
  stage: 1 | 2;
  /** Default-tier model used for both steps. */
  model: string;
  error: ProviderError | null;
  /** Step-2 generation tokens (meter feature key_verification); null when step 2 didn't report or didn't run. */
  usage: NormalizedUsage | null;
  latencyMs: number;
};

const LIMITED_CODES: ReadonlySet<AiErrorCode> = new Set(["rate_limited", "daily_quota_exhausted", "provider_unavailable"]);

/**
 * C-10.5 two steps on the default-tier model, no retries. The key is used
 * only for these two calls and never logged or returned.
 */
export async function verifyProviderKey(options: {
  provider: ProviderId;
  apiKey: string;
  signal?: AbortSignal;
  adapters?: Partial<Record<ProviderId, ProviderAdapter>>;
  now?: () => number;
}): Promise<KeyVerificationResult> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const model = resolveModel(options.provider, "default");
  const impl = options.adapters?.[options.provider] ?? getProviderAdapter(options.provider);
  const outcome = await impl.verify({ apiKey: options.apiKey, model, signal: options.signal });
  const latencyMs = now() - startedAt;
  if (outcome.ok) return { decision: "valid", stage: 2, model, error: null, usage: outcome.usage, latencyMs };
  // Step 1 passed (authenticated) and step 2 hit a limit or outage → save as needs_check (R-38).
  const decision = outcome.stage === 2 && LIMITED_CODES.has(outcome.error.code) ? "limited" : "rejected";
  return { decision, stage: outcome.stage, model, error: outcome.error, usage: outcome.usage, latencyMs };
}
