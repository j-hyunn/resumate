import type { ConnectionTier, ModelTier, ProviderId } from "./providers/types";

/**
 * C-7 / NFR-PRV-09 / NFR-KEY-05 log: only these fields. Never prompt or
 * response bodies, never career or JD text, never quotes, never provider
 * error messages, never any part of an API key. The type is closed on
 * purpose — adding a free-text field here is a privacy change and needs review.
 */
export type AiCallLog = {
  event: "ai_call";
  jobId: string | null;
  feature: string;
  callKey: string;
  promptVersion: string;
  provider: ProviderId;
  tier: ModelTier;
  connectionTier: ConnectionTier;
  model: string;
  outcome: "ok" | "error";
  errorCode: string | null;
  /** Error outside the C-11.2 table, recorded as provider_unavailable [가정]. */
  unclassified: boolean;
  /** Streaming only: whether the error came before the first delta. */
  beforeFirstToken: boolean | null;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number | null;
  usageSource: "provider_reported" | "unavailable";
  latencyMs: number;
};

export type AiValidationLog = {
  event: "ai_validation";
  jobId: string | null;
  feature: string;
  promptVersion: string;
  /** Counts only (validation_report). */
  stats: Readonly<Record<string, number>>;
};

/** `onCall` threw: the usage row may be missing for this call (ids and code only). */
export type AiUsageRecordFailedLog = {
  event: "usage_record_failed";
  jobId: string | null;
  callKey: string;
  provider: ProviderId;
};

export type AiLogEntry = AiCallLog | AiValidationLog | AiUsageRecordFailedLog;
export type AiLogger = (entry: AiLogEntry) => void;

export const consoleAiLogger: AiLogger = (entry) => {
  console.info(JSON.stringify(entry));
};

export const silentAiLogger: AiLogger = () => {};
