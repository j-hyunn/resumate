import { AppError } from "@/lib/contracts/errors";
import { AI_PROVIDERS, CONNECTION_TIERS, type AiProvider, type ConnectionTier, type FailureCause } from "@/lib/contracts/enums";

/**
 * Where the runner gets the user's AI connection and key (S3a plan API 1).
 * S3a ships only these interfaces, fakes for tests, and a development-only env
 * implementation. S3b plugs in the real ones (ai_provider_keys + envelope
 * decryption through app_key_reader → get_provider_key_secret, and
 * mark_provider_key_invalid).
 *
 * NFR-KEY-03/05: a key returned by `KeySource` lives only for one provider
 * call. Never put it in a job row, step output, error, or log.
 */

/** ai_provider_keys.status (DM §2.11.1). */
export type { KeyStatus } from "@/lib/contracts/enums";
import type { KeyStatus } from "@/lib/contracts/enums";

export type ProviderContext = {
  provider: AiProvider;
  connectionTier: ConnectionTier;
  keyStatus: KeyStatus;
};

/** The user's active provider + tier (display only, no key status). */
export type ActiveConnection = { provider: AiProvider; connectionTier: ConnectionTier };

export interface ProviderContextSource {
  /**
   * The active provider + tier + key status, read when a run starts — a new
   * job (written into the row) and a same-row manual retry alike (C-11.4,
   * A1 changed in R2). Null = no active provider or no key for it. Throws
   * AppError 409 `ai_consent_required` when the active key's current tier
   * lacks a current consent (A20).
   */
  forUser(userId: string): Promise<ProviderContext | null>;
  /**
   * Same read without the consent rule: the retry badge (UX C-20 / S-40) and
   * the key checks of the same-row retry gate, which go key_missing →
   * key_invalid → ai_consent_required like `retry_ai_job` / `check_ai_run_allowed`
   * (QA-R2-03). Never the only gate of a run — the consent rule is `forUser`.
   */
  peekActive(userId: string): Promise<ProviderContext | null>;
}

/** 409 errors of the run gates (same codes as startJob / the AI spec). */
export function runGateError(code: "key_missing" | "key_invalid" | "ai_consent_required"): AppError {
  const message =
    code === "key_missing"
      ? "AI 연결이 필요합니다. 키를 등록한 뒤 다시 시도해 주세요."
      : code === "key_invalid"
        ? "AI 키가 유효하지 않습니다. 키를 확인해 다시 연결해 주세요."
        : "AI 데이터 사용 고지에 다시 동의해 주세요.";
  return new AppError(code, message, { status: 409 });
}

/**
 * The plaintext key for one provider call of a running job. Called per call
 * (by the LLM wrapper), never cached by the runner. Throws an error with code
 * `key_missing` when the key is gone (deleted mid-run, D-36).
 */
export interface KeySource {
  /**
   * `provider` = the current run's provider (the runner passes ai_jobs.provider, fixed while it runs).
   * The envelope key source needs it for the AAD (user_id|provider|key id).
   */
  forJob(jobId: string, provider?: AiProvider): Promise<string>;
}

/** Key causes a provider call can report (C-11.1 failure_cause minus input_rejected; DB private.is_key_failure_cause). */
export const KEY_FAILURE_CAUSES = [
  "rate_limited",
  "daily_quota_exhausted",
  "billing_required",
  "key_invalid",
  "model_not_available",
  "provider_unavailable",
] as const satisfies readonly FailureCause[];
export type KeyFailureCause = (typeof KEY_FAILURE_CAUSES)[number];

export function isKeyFailureCause(cause: FailureCause | null): cause is KeyFailureCause {
  return cause !== null && (KEY_FAILURE_CAUSES as readonly string[]).includes(cause);
}

/** Key status updates from job runs (DM 2.11.3; S3b: app_ai_writer RPCs). */
export interface KeyStatusReporter {
  /** C-11.1 cause 4: key → invalid (RPC mark_provider_key_invalid(job, 'key_invalid')). */
  markInvalid(jobId: string): Promise<void>;
  /** Final failure with another key cause: last_failure_* only, status kept (mark_provider_key_invalid(job, cause)). */
  recordFailure(jobId: string, cause: Exclude<KeyFailureCause, "key_invalid">): Promise<void>;
  /** Job succeeded: a needs_check key returns to valid (RPC record_provider_key_success; no-op otherwise). */
  recordSuccess(jobId: string): Promise<void>;
}

// ---------------- fakes (tests) ----------------

/**
 * Test fake. `context` may be a function (read on every call) so a test can
 * change the active connection, or throw (e.g. consent required) mid-test.
 */
export function createStaticProviderContext(context: ProviderContext | null | (() => ProviderContext | null)): ProviderContextSource {
  const fn = typeof context === "function" ? context : () => context;
  // A function that throws simulates consent required; peekActive (no consent rule) then sees
  // the connection last read successfully.
  let lastGood: ProviderContext | null = null;
  const read = () => {
    const c = fn();
    lastGood = c;
    return c;
  };
  return {
    forUser: async () => read(),
    async peekActive() {
      try {
        return read();
      } catch {
        // The fake's "consent required" error: the key itself is still there.
        return lastGood;
      }
    },
  };
}

export function createStaticKeySource(key: string | null, onMissing: () => Error): KeySource {
  return {
    async forJob() {
      if (key === null) throw onMissing();
      return key;
    },
  };
}

export function createRecordingKeyStatusReporter(): KeyStatusReporter & {
  invalidated: string[];
  failures: { jobId: string; cause: KeyFailureCause }[];
  successes: string[];
} {
  const invalidated: string[] = [];
  const failures: { jobId: string; cause: KeyFailureCause }[] = [];
  const successes: string[] = [];
  return {
    invalidated,
    failures,
    successes,
    async markInvalid(jobId) {
      invalidated.push(jobId);
    },
    async recordFailure(jobId, cause) {
      failures.push({ jobId, cause });
    },
    async recordSuccess(jobId) {
      successes.push(jobId);
    },
  };
}

// ---------------- development-only env implementation ----------------

/**
 * Local development without S3b key storage: one provider + key from env
 * (`AI_DEV_PROVIDER`, `AI_DEV_API_KEY`, optional `AI_DEV_CONNECTION_TIER`,
 * default `paid`). Throws in production — production must never run AI with
 * a service-side key (D-28, D-34).
 */
export type DevAiEnv = {
  nodeEnv: string | undefined;
  provider: string | undefined;
  apiKey: string | undefined;
  connectionTier: string | undefined;
};

export class DevAiEnvInProductionError extends Error {
  constructor() {
    super("The development AI key source is disabled in production");
    this.name = "DevAiEnvInProductionError";
  }
}

function assertNotProduction(env: DevAiEnv): void {
  if (env.nodeEnv === "production") throw new DevAiEnvInProductionError();
}

function devProvider(env: DevAiEnv): AiProvider | null {
  return (AI_PROVIDERS as readonly string[]).includes(env.provider ?? "") ? (env.provider as AiProvider) : null;
}

export function readDevAiEnv(source: Record<string, string | undefined> = process.env): DevAiEnv {
  return {
    nodeEnv: source.NODE_ENV,
    provider: source.AI_DEV_PROVIDER?.trim() || undefined,
    apiKey: source.AI_DEV_API_KEY?.trim() || undefined,
    connectionTier: source.AI_DEV_CONNECTION_TIER?.trim() || undefined,
  };
}

export function createDevEnvProviderContext(env: DevAiEnv): ProviderContextSource {
  return {
    async forUser() {
      assertNotProduction(env);
      const provider = devProvider(env);
      if (!provider || !env.apiKey) return null;
      const connectionTier: ConnectionTier = (CONNECTION_TIERS as readonly string[]).includes(env.connectionTier ?? "")
        ? (env.connectionTier as ConnectionTier)
        : "paid";
      return { provider, connectionTier, keyStatus: "valid" };
    },
    async peekActive(userId) {
      return this.forUser(userId);
    },
  };
}

export function createDevEnvKeySource(env: DevAiEnv, onMissing: () => Error): KeySource {
  return {
    async forJob() {
      assertNotProduction(env);
      if (!devProvider(env) || !env.apiKey) throw onMissing();
      return env.apiKey;
    },
  };
}

export function createDevEnvKeyStatusReporter(env: DevAiEnv, log: (event: string, fields: Record<string, string>) => void): KeyStatusReporter {
  return {
    async markInvalid(jobId) {
      assertNotProduction(env);
      // No key row in development: just surface it. The key itself is never logged.
      log("ai_key.invalid_dev", { jobId });
    },
    async recordFailure(jobId, cause) {
      assertNotProduction(env);
      log("ai_key.failure_dev", { jobId, cause });
    },
    async recordSuccess() {
      assertNotProduction(env);
    },
  };
}
