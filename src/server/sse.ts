import { aiErrorEvent, type AiStreamEvent } from "@/lib/contracts/ai";
import type { AiErrorCode } from "@/lib/contracts/enums";
import { isAiError, isRetryableAiErrorCode } from "@/server/ai/errors";
import { AI_STREAM_TERMINAL_EVENT_TYPES } from "@/server/ai/streaming/structured-stream";

/**
 * Server-Sent Events helper for streaming Route Handlers (AI C-6).
 * Wire format: `event: <type>\ndata: <json without type>\n\n`.
 * Next-free (only Web APIs) so Vitest can drive it directly.
 */

/** Comment line keeps proxies from closing an idle stream. */
export const SSE_KEEPALIVE_MS = 15_000;

export const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  // Disable proxy buffering (nginx-style proxies).
  "X-Accel-Buffering": "no",
};

/** Any event with a string `type` (C-6 block events now, AI-12 turn events in S4). */
export type SseEvent = { type: string };

export function formatSseEvent(event: SseEvent): string {
  const { type, ...data } = normalizeErrorEvent(event) as SseEvent & Record<string, unknown>;
  // JSON.stringify never emits raw newlines, so one `data:` line is enough.
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Every `error` event goes out in one shape (QA-S3-02): category + the
 * "사용량은 차감되지 않았습니다" message by category, retryable by the server rule.
 */
export function normalizeErrorEvent(event: SseEvent): SseEvent {
  if (event.type !== "error") return event;
  const code = (event as SseEvent & { code?: unknown }).code;
  return errorEventFor(typeof code === "string" ? (code as AiErrorCode | "internal_error") : "internal_error");
}

function errorEventFor(code: AiErrorCode | "internal_error"): SseEvent {
  return aiErrorEvent(code, code === "internal_error" ? true : isRetryableAiErrorCode(code));
}

export function formatSseComment(text: string): string {
  return `: ${text.replace(/[\r\n]/g, " ")}\n\n`;
}

export type SseProducerContext = {
  /** Aborted when the client disconnects (or the request signal aborts). Pass it to the model stream. */
  signal: AbortSignal;
  /** Sends one event. No-op after the stream closed. */
  emit: (event: SseEvent) => void;
};

export type CreateSseOptions = {
  /** Request signal (`request.signal`); its abort also aborts the producer. */
  requestSignal?: AbortSignal;
  keepAliveMs?: number;
  /**
   * Always runs once after the producer settles. The outcome is decided by the
   * last TERMINAL event actually sent (QA-S3-02): `error` → failed, another
   * terminal (`done`, S4 `turn_done`) → completed, client abort → aborted, no
   * terminal event → failed (an `error` event is sent for it). Charge the ledger
   * only on `completed`; release otherwise. Its own errors are swallowed.
   */
  onFinish?: (outcome: SseOutcome) => Promise<void> | void;
  /** Terminal event names (default: the pipeline's `done` / `error`). After one is sent, later events are dropped. */
  terminalEvents?: readonly string[];
};

export type SseOutcome =
  | { kind: "completed" }
  | { kind: "aborted" }
  | { kind: "failed"; code: AiErrorCode | "internal_error"; error?: unknown };

/**
 * Builds the SSE Response. `produce` either emits through `ctx.emit` or returns
 * an async iterable of events (or both). A thrown error becomes one `error`
 * event (C-6 code if it is an AiError, else internal_error) and closes the stream.
 */
export function createSseResponse(
  produce: (ctx: SseProducerContext) => Promise<void> | AsyncIterable<SseEvent>,
  options: CreateSseOptions = {},
): Response {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  let closed = false;
  let keepAlive: ReturnType<typeof setInterval> | undefined;

  const onRequestAbort = () => abort.abort(new DOMException("client disconnected", "AbortError"));
  if (options.requestSignal) {
    if (options.requestSignal.aborted) onRequestAbort();
    else options.requestSignal.addEventListener("abort", onRequestAbort, { once: true });
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const terminals = options.terminalEvents ?? AI_STREAM_TERMINAL_EVENT_TYPES;
      let terminal: SseEvent | null = null;
      const emit = (event: SseEvent) => {
        if (terminal) return; // exactly one terminal event
        const normalized = normalizeErrorEvent(event);
        if (terminals.includes(normalized.type)) terminal = normalized;
        write(formatSseEvent(normalized));
      };
      const close = () => {
        if (keepAlive) clearInterval(keepAlive);
        options.requestSignal?.removeEventListener("abort", onRequestAbort);
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed by cancel()
        }
      };

      keepAlive = setInterval(() => write(formatSseComment("keep-alive")), options.keepAliveMs ?? SSE_KEEPALIVE_MS);

      void (async () => {
        let thrown: { error: unknown } | null = null;
        try {
          const result = produce({ signal: abort.signal, emit });
          if (isAsyncIterable(result)) {
            for await (const event of result) {
              if (abort.signal.aborted || terminal) break;
              emit(event);
            }
          } else {
            await result;
          }
        } catch (error) {
          thrown = { error };
        }

        let outcome: SseOutcome;
        const sent = terminal as SseEvent | null;
        if (sent && sent.type === "error") {
          outcome = { kind: "failed", code: (sent as SseEvent & { code: AiErrorCode | "internal_error" }).code };
        } else if (sent) {
          outcome = { kind: "completed" };
        } else if (abort.signal.aborted) {
          outcome = { kind: "aborted" };
        } else {
          const code: AiErrorCode | "internal_error" = thrown && isAiError(thrown.error) ? thrown.error.code : "internal_error";
          emit(errorEventFor(code));
          outcome = { kind: "failed", code, ...(thrown ? { error: thrown.error } : {}) };
        }

        close();
        if (options.onFinish) {
          try {
            await options.onFinish(outcome);
          } catch {
            // ledger errors are logged by the caller; the response is already closed
          }
        }
      })();
    },
    cancel() {
      // Client went away: stop the producer (model stream) via the signal.
      closed = true;
      if (keepAlive) clearInterval(keepAlive);
      abort.abort(new DOMException("client disconnected", "AbortError"));
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

function isAsyncIterable(value: unknown): value is AsyncIterable<SseEvent> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

/** Typed alias for C-6 block streams. */
export type AiSseEvent = AiStreamEvent;
