import { describe, expect, it, vi } from "vitest";
import { AiError } from "@/server/ai/errors";
import { createSseResponse, formatSseEvent, type SseOutcome } from "./sse";

async function readAll(res: Response): Promise<string> {
  return await res.text();
}

function parseEvents(text: string) {
  return text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("event:"))
    .map((chunk) => {
      const [eventLine, dataLine] = chunk.split("\n");
      return { event: eventLine!.slice("event: ".length), data: JSON.parse(dataLine!.slice("data: ".length)) };
    });
}

describe("formatSseEvent", () => {
  it("puts the type in `event:` and the rest in one `data:` line", () => {
    expect(formatSseEvent({ type: "block_delta", blockId: "b1", text: "줄1\n줄2" } as never)).toBe(
      'event: block_delta\ndata: {"blockId":"b1","text":"줄1\\n줄2"}\n\n',
    );
  });

  it("adds error.category from the code when the pipeline omits it", () => {
    const out = formatSseEvent({ type: "error", code: "stalled", message: "m", retryable: true } as never);
    expect(JSON.parse(out.split("data: ")[1]!)).toMatchObject({ code: "stalled", category: "timeout" });
  });
});

describe("createSseResponse", () => {
  it("streams iterable events with SSE headers and reports completed", async () => {
    const onFinish = vi.fn();
    const res = createSseResponse(
      async function* () {
        yield { type: "block_started", blockId: "b1", path: "sections[0]" };
        yield { type: "done", meta: { promptVersion: "p1", model: "m", resultId: null } };
      },
      { onFinish },
    );
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(res.headers.get("Cache-Control")).toContain("no-cache");
    const events = parseEvents(await readAll(res));
    expect(events.map((e) => e.event)).toEqual(["block_started", "done"]);
    await vi.waitFor(() => expect(onFinish).toHaveBeenCalledWith({ kind: "completed" }));
  });

  it("a thrown AiError becomes one error event with category, and onFinish sees failed", async () => {
    const outcomes: SseOutcome[] = [];
    const res = createSseResponse(
      async ({ emit }) => {
        emit({ type: "block_started", blockId: "b1", path: "x" } as never);
        throw new AiError("schema_invalid");
      },
      { onFinish: (o) => void outcomes.push(o) },
    );
    const events = parseEvents(await readAll(res));
    expect(events.at(-1)).toMatchObject({ event: "error", data: { code: "schema_invalid", category: "transient", retryable: true } });
    await vi.waitFor(() => expect(outcomes[0]?.kind).toBe("failed"));
  });

  it("unknown errors become internal_error without leaking the message", async () => {
    const res = createSseResponse(async () => {
      throw new Error("secret prompt text");
    });
    const text = await readAll(res);
    expect(text).not.toContain("secret prompt text");
    expect(parseEvents(text)[0]).toMatchObject({ event: "error", data: { code: "internal_error", category: "transient" } });
  });

  it("client abort aborts the producer signal and onFinish sees aborted (ledger release hook)", async () => {
    const request = new AbortController();
    const outcomes: SseOutcome[] = [];
    let producerSignal: AbortSignal | undefined;
    const res = createSseResponse(
      ({ signal }) => {
        producerSignal = signal;
        return new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
      },
      { requestSignal: request.signal, onFinish: (o) => void outcomes.push(o) },
    );
    const reader = res.body!.getReader();
    request.abort();
    await vi.waitFor(() => expect(outcomes).toEqual([{ kind: "aborted" }]));
    expect(producerSignal?.aborted).toBe(true);
    await reader.cancel();
  });

  it("reader cancel (browser closed) aborts the producer", async () => {
    let producerSignal: AbortSignal | undefined;
    const outcomes: SseOutcome[] = [];
    const res = createSseResponse(
      ({ signal }) => {
        producerSignal = signal;
        return new Promise<void>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
      },
      { onFinish: (o) => void outcomes.push(o) },
    );
    await res.body!.cancel();
    await vi.waitFor(() => expect(outcomes).toEqual([{ kind: "aborted" }]));
    expect(producerSignal?.aborted).toBe(true);
  });

  it("sends keep-alive comments while idle", async () => {
    const res = createSseResponse(() => new Promise<void>((r) => setTimeout(r, 40)), { keepAliveMs: 10 });
    expect(await readAll(res)).toContain(": keep-alive");
  });

  it("QA-S3-02 pipeline yields an error event (no throw) → onFinish failed, message/retryable normalized", async () => {
    const outcomes: SseOutcome[] = [];
    const res = createSseResponse(
      async function* () {
        yield { type: "block_started", blockId: "b1", path: "x" };
        yield { type: "error", code: "refused", message: "pipeline copy", retryable: true };
        yield { type: "done", meta: { promptVersion: "p", model: "m", resultId: null } }; // dropped: after terminal
      },
      { onFinish: (o) => void outcomes.push(o) },
    );
    const events = parseEvents(await readAll(res));
    expect(events.map((e) => e.event)).toEqual(["block_started", "error"]);
    expect(events[1]!.data).toMatchObject({ code: "refused", category: "transient", retryable: false });
    expect(events[1]!.data.message).toContain("차감되지 않았습니다");
    await vi.waitFor(() => expect(outcomes).toEqual([{ kind: "failed", code: "refused" }]));
  });

  it("QA-S3-02 stream ending without done/error → error event + failed", async () => {
    const outcomes: SseOutcome[] = [];
    const res = createSseResponse(
      async function* () {
        yield { type: "block_delta", blockId: "b1", text: "x" };
      },
      { onFinish: (o) => void outcomes.push(o) },
    );
    const events = parseEvents(await readAll(res));
    expect(events.at(-1)).toMatchObject({ event: "error", data: { code: "internal_error" } });
    await vi.waitFor(() => expect(outcomes).toEqual([{ kind: "failed", code: "internal_error" }]));
  });

  it("custom terminal events (S4 turn_done) count as completed", async () => {
    const outcomes: SseOutcome[] = [];
    const res = createSseResponse(
      async ({ emit }) => {
        emit({ type: "turn_done" });
      },
      { terminalEvents: ["turn_done", "error"], onFinish: (o) => void outcomes.push(o) },
    );
    await readAll(res);
    await vi.waitFor(() => expect(outcomes).toEqual([{ kind: "completed" }]));
  });
});
