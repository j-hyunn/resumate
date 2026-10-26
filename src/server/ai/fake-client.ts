import { EMPTY_USAGE, type AiClient, type AiRequest, type AiResult, type AiStreamChunk } from "./client";
import { AiError } from "./errors";
import type { AiErrorCode } from "@/lib/contracts/errors";

/**
 * Test double for AiClient (no network). Each call consumes the next scripted
 * response: a JSON value/string, or an error code. Streams split the JSON text
 * into `chunkSize` pieces so incremental parsing is exercised.
 * Exported from non-test code so the job runner's tests can use it too.
 */
export type FakeResponse =
  | { json: unknown }
  | { text: string }
  | { error: AiErrorCode }
  | { errorAfterChunks: AiErrorCode; json: unknown; chunks: number };

export type FakeAiClient = AiClient & {
  readonly requests: AiRequest[];
  remaining(): number;
};

export function createFakeAiClient(responses: FakeResponse[], options: { chunkSize?: number; model?: string } = {}): FakeAiClient {
  const queue = [...responses];
  const requests: AiRequest[] = [];
  const chunkSize = options.chunkSize ?? 7;

  function next(request: AiRequest): FakeResponse {
    requests.push(request);
    const response = queue.shift();
    if (!response) throw new Error("FakeAiClient: no scripted response left");
    return response;
  }

  function resultFor(request: AiRequest, text: string): AiResult {
    return {
      text,
      model: options.model ?? request.model,
      usage: { ...EMPTY_USAGE, inputTokens: 100, outputTokens: Math.ceil(text.length / 4) },
      latencyMs: 1,
      fallbackUsed: false,
    };
  }

  return {
    requests,
    remaining: () => queue.length,
    async complete(request) {
      const response = next(request);
      if ("error" in response) throw new AiError(response.error);
      if ("errorAfterChunks" in response) throw new AiError(response.errorAfterChunks);
      const text = "text" in response ? response.text : JSON.stringify(response.json);
      return resultFor(request, text);
    },
    stream(request): AsyncIterable<AiStreamChunk> {
      return {
        async *[Symbol.asyncIterator]() {
          if (request.signal?.aborted) throw new AiError(request.signal.reason === "canceled" ? "canceled" : "timeout");
          const response = next(request);
          if ("error" in response) throw new AiError(response.error);
          const text = "text" in response ? response.text : JSON.stringify(response.json);
          const failAt = "errorAfterChunks" in response ? response.chunks : Infinity;
          let sent = 0;
          for (let i = 0; i < text.length; i += chunkSize) {
            if (sent === failAt && "errorAfterChunks" in response) throw new AiError(response.errorAfterChunks);
            if (request.signal?.aborted) throw new AiError(request.signal.reason === "canceled" ? "canceled" : "timeout");
            yield { type: "text_delta", text: text.slice(i, i + chunkSize) };
            sent++;
          }
          yield { type: "final", result: resultFor(request, text) };
        },
      };
    },
  };
}
