import "server-only";
import { after } from "next/server";
import { DRAFT_STREAM_TERMINAL_EVENTS } from "@/lib/contracts/draft";
import { createSseResponse, type SseEvent } from "@/server/sse";

/**
 * SSE response for the S7 generation routes. The run is NOT tied to the
 * client: a disconnect only stops the writes (S7 plan "계약 — API" 2,
 * spec-gaps S5 ③); `after()` keeps the function alive until the run has saved
 * and settled its usage records. The request signal is deliberately not passed.
 */
export function draftSseResponse(run: (emit: (event: SseEvent) => void) => Promise<void>): Response {
  let work: Promise<void> | null = null;
  const response = createSseResponse(
    ({ emit }) => {
      work = run(emit);
      return work;
    },
    { terminalEvents: DRAFT_STREAM_TERMINAL_EVENTS },
  );
  after(() => work ?? Promise.resolve());
  return response;
}

/** One `error` event and close (F-AI-08 lock before anything ran). */
export function draftSseError(code: string): Response {
  return createSseResponse(async ({ emit }) => emit({ type: "error", code } as SseEvent), { terminalEvents: DRAFT_STREAM_TERMINAL_EVENTS });
}
