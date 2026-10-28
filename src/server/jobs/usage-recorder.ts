import { estimateCostUsd, kstDate, USAGE_FEATURE_BY_JOB_TYPE } from "./cost";
import type { JobRecord, LlmCallRecord, PriceRow, UsageStore } from "./types";

/**
 * C-13: one ai_usage_records row per provider call (every retry attempt and
 * failed calls included), inserted right after the call (meter within 1 min,
 * PRD 6.4). Calls not made (input_hash reuse) are never recorded — this is only
 * reached through the LLM wrapper's `onCall`.
 *
 * Never throws: a lost record must not make the job spend the user's tokens
 * again. Insert is tried twice, then logged (`ai_usage.record_failed`).
 * Unknown model price [가정]: cost 0 with price_table_version `unpriced`, logged.
 */

export const UNPRICED_VERSION = "unpriced";
const RECORD_TRIES = 2;

type Log = (event: string, fields: Record<string, string | number | boolean | null>) => void;

/** Price lookups cached per scope (one invocation / request), keyed by provider, model, date. */
export function createPriceCache(store: UsageStore) {
  const cache = new Map<string, Promise<PriceRow | null>>();
  return (provider: JobRecord["provider"], model: string, onDate: string): Promise<PriceRow | null> => {
    const key = `${provider}|${model}|${onDate}`;
    let hit = cache.get(key);
    if (!hit) {
      hit = store.priceFor(provider, model, onDate).catch((err: unknown) => {
        cache.delete(key); // don't cache a failed lookup
        throw err;
      });
      cache.set(key, hit);
    }
    return hit;
  };
}

export function createUsageRecorder(opts: {
  store: UsageStore;
  job: Pick<JobRecord, "id" | "jobType" | "applicationProjectId" | "provider" | "modelTier" | "connectionTier">;
  priceFor: ReturnType<typeof createPriceCache>;
  now: () => Date;
  log: Log;
}): (record: LlmCallRecord) => Promise<void> {
  const { store, job, priceFor, now, log } = opts;
  return async (record) => {
    const occurred = record.occurredAt ?? now();
    let price: PriceRow | null = null;
    try {
      price = await priceFor(job.provider, record.model, kstDate(occurred));
    } catch {
      log("ai_usage.price_lookup_failed", { jobId: job.id, provider: job.provider, model: record.model });
    }
    if (!price) log("ai_usage.unpriced", { jobId: job.id, provider: job.provider, model: record.model });

    const row = {
      occurredAt: occurred.toISOString(),
      feature: USAGE_FEATURE_BY_JOB_TYPE[job.jobType],
      jobType: job.jobType,
      aiJobId: job.id,
      callKey: record.callKey,
      applicationProjectId: job.applicationProjectId,
      provider: job.provider,
      model: record.model,
      modelTier: job.modelTier,
      connectionTier: job.connectionTier,
      usage: record.usage,
      outcome: record.outcome,
      errorCode: record.outcome === "failed" ? record.errorCode : null,
      priceTableVersion: price?.version ?? UNPRICED_VERSION,
      estimatedCostUsd: price ? estimateCostUsd(record.usage, price) : 0,
    };

    for (let t = 1; t <= RECORD_TRIES; t++) {
      try {
        await store.insert(row);
        return;
      } catch {
        // retry; the DB error body is not logged
      }
    }
    log("ai_usage.record_failed", { jobId: job.id, callKey: record.callKey, outcome: record.outcome });
  };
}
