import { AI_PROVIDERS, CONNECTION_TIERS, type AiProvider, type ConnectionTier } from "@/lib/contracts/enums";

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
export type KeyStatus = "valid" | "invalid" | "needs_check";

export type ProviderContext = {
  provider: AiProvider;
  connectionTier: ConnectionTier;
  keyStatus: KeyStatus;
};

/** The user's active provider + tier, read at job start and fixed into ai_jobs (F-AI-03 (2)). Null = not connected. */
export interface ProviderContextSource {
  forUser(userId: string): Promise<ProviderContext | null>;
}

/**
 * The plaintext key for one provider call of a running job. Called per call
 * (by the LLM wrapper), never cached by the runner. Throws an error with code
 * `key_missing` when the key is gone (deleted mid-run, D-36).
 */
export interface KeySource {
  forJob(jobId: string): Promise<string>;
}

/** C-11.1 cause 4: marks the job's key invalid (S3b: RPC mark_provider_key_invalid). */
export interface KeyStatusReporter {
  markInvalid(jobId: string): Promise<void>;
}

// ---------------- fakes (tests) ----------------

export function createStaticProviderContext(context: ProviderContext | null): ProviderContextSource {
  return { forUser: async () => context };
}

export function createStaticKeySource(key: string | null, onMissing: () => Error): KeySource {
  return {
    async forJob() {
      if (key === null) throw onMissing();
      return key;
    },
  };
}

export function createRecordingKeyStatusReporter(): KeyStatusReporter & { invalidated: string[] } {
  const invalidated: string[] = [];
  return {
    invalidated,
    async markInvalid(jobId) {
      invalidated.push(jobId);
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
  };
}
