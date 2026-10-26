/**
 * C-7 / NFR-PRV-09 log: only these fields. Never prompt or response bodies,
 * never career or JD text, never quotes. The type is closed on purpose — adding
 * a free-text field here is a privacy change and needs review.
 */
export type AiCallLog = {
  event: "ai_call";
  jobId: string | null;
  feature: string;
  promptVersion: string;
  model: string;
  outcome: "ok" | "error";
  errorCode: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  latencyMs: number;
  fallbackUsed: boolean;
};

export type AiValidationLog = {
  event: "ai_validation";
  jobId: string | null;
  feature: string;
  promptVersion: string;
  /** Counts only (validation_report). */
  stats: Readonly<Record<string, number>>;
};

export type AiLogEntry = AiCallLog | AiValidationLog;
export type AiLogger = (entry: AiLogEntry) => void;

export const consoleAiLogger: AiLogger = (entry) => {
  console.info(JSON.stringify(entry));
};

export const silentAiLogger: AiLogger = () => {};
