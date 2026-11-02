import type { AiErrorCode } from "@/lib/contracts/errors";
import { ProviderError } from "./errors";
import { createLlm, type Llm, type LlmCallRecord, type LlmRequest } from "./llm";
import { silentAiLogger } from "./log";
import { drainStream } from "./providers/shared";
import type {
  ConnectionTier,
  LlmStreamEvent,
  ModelTier,
  NormalizedUsage,
  ProviderAdapter,
  ProviderCallRequest,
  ProviderId,
} from "./providers/types";
import { UNAVAILABLE_USAGE } from "./providers/types";

/**
 * Test double for `Llm` (no network). It is the real `createLlm` over a
 * scripted fake adapter, so usage records, logging, and the stream contract
 * behave as in production. Each provider call consumes the next response.
 * Exported from non-test code so the job runner's tests can use it too.
 */
export type FakeLlmResponse =
  | { json: unknown; usage?: Partial<NormalizedUsage> }
  | { text: string; usage?: Partial<NormalizedUsage> }
  | { error: AiErrorCode; retryAfterMs?: number; quotaResetsAt?: Date; usage?: Partial<NormalizedUsage> }
  | { errorAfterChunks: AiErrorCode; json: unknown; chunks: number };

export type FakeLlm = Llm & {
  /** Requests as the pipeline built them. */
  readonly requests: LlmRequest[];
  /** What the adapter received (model resolved, key = "test-key"). */
  readonly calls: ProviderCallRequest[];
  /** Usage records handed to onCall. */
  readonly records: LlmCallRecord[];
  remaining(): number;
};

export type FakeLlmOptions = {
  chunkSize?: number;
  provider?: ProviderId;
  tier?: ModelTier;
  connectionTier?: ConnectionTier;
  jobId?: string;
  onCall?: (record: LlmCallRecord) => void | Promise<void>;
  now?: () => number;
  signal?: AbortSignal;
};

export const FAKE_API_KEY = "test-key";

export function createFakeLlm(responses: FakeLlmResponse[], options: FakeLlmOptions = {}): FakeLlm {
  const queue = [...responses];
  const requests: LlmRequest[] = [];
  const calls: ProviderCallRequest[] = [];
  const records: LlmCallRecord[] = [];
  const provider = options.provider ?? "anthropic";
  const chunkSize = options.chunkSize ?? 7;
  const now = options.now ?? Date.now;

  function usageFor(text: string, partial?: Partial<NormalizedUsage>): NormalizedUsage {
    return {
      inputTokens: 100,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: Math.ceil(text.length / 4),
      reasoningTokens: null,
      usageSource: "provider_reported",
      ...partial,
    };
  }

  function errorFor(code: AiErrorCode, extra: { retryAfterMs?: number; quotaResetsAt?: Date } = {}): ProviderError {
    return new ProviderError(code, {
      provider,
      retryAfter: extra.retryAfterMs !== undefined ? new Date(now() + extra.retryAfterMs) : undefined,
      quotaResetsAt: extra.quotaResetsAt,
    });
  }

  async function* stream(call: ProviderCallRequest): AsyncGenerator<LlmStreamEvent> {
    calls.push(call);
    const abortCode = () => (call.signal?.reason === "canceled" ? "canceled" : "timeout");
    const response = queue.shift();
    if (!response) throw new Error("FakeLlm: no scripted response left");
    if (call.signal?.aborted) {
      yield { type: "error", error: errorFor(abortCode()), usage: UNAVAILABLE_USAGE };
      return;
    }
    if ("error" in response) {
      const usage = response.usage ? usageFor("", response.usage) : UNAVAILABLE_USAGE;
      yield { type: "error", error: errorFor(response.error, response).with({ usage }), usage };
      return;
    }
    const text = "text" in response ? response.text : JSON.stringify(response.json);
    const failAt = "errorAfterChunks" in response ? response.chunks : Infinity;
    let sent = 0;
    for (let i = 0; i < text.length; i += chunkSize) {
      if (sent === failAt && "errorAfterChunks" in response) {
        const usage = usageFor(text.slice(0, i));
        yield { type: "error", error: errorFor(response.errorAfterChunks).with({ beforeFirstToken: sent === 0, usage }), usage };
        return;
      }
      if (call.signal?.aborted) {
        yield { type: "error", error: errorFor(abortCode()).with({ beforeFirstToken: sent === 0 }), usage: UNAVAILABLE_USAGE };
        return;
      }
      yield { type: "delta", text: text.slice(i, i + chunkSize) };
      sent++;
    }
    const partial = "usage" in response ? response.usage : undefined;
    yield { type: "done", result: { text, model: call.model, usage: usageFor(text, partial), latencyMs: 1 } };
  }

  const adapter: ProviderAdapter = {
    id: provider,
    stream,
    complete: (call) => drainStream(stream(call)),
    verify: async () => ({ ok: true, usage: usageFor("") }),
  };

  const llm = createLlm({
    provider,
    tier: options.tier ?? "default",
    connectionTier: options.connectionTier ?? "paid",
    keySource: { forJob: async () => FAKE_API_KEY },
    jobId: options.jobId ?? "00000000-0000-4000-8000-000000000000",
    onCall: async (record) => {
      records.push(record);
      await options.onCall?.(record);
    },
    logger: silentAiLogger,
    now,
    signal: options.signal,
    adapters: { [provider]: adapter },
  });

  return {
    provider: llm.provider,
    tier: llm.tier,
    connectionTier: llm.connectionTier,
    modelFor: llm.modelFor,
    complete(request) {
      requests.push(request);
      return llm.complete(request);
    },
    stream(request) {
      requests.push(request);
      return llm.stream(request);
    },
    settle: llm.settle,
    requests,
    calls,
    records,
    remaining: () => queue.length,
  };
}
