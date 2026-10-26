import { IncrementalJsonParser, type JsonEvent, type JsonPath } from "./json-incremental";

/**
 * Finds "blocks" in streamed structured output: any object with a string
 * `block_id` (C-3: draft blocks carry block_id). Emits raw (unvalidated)
 * block events; `structured-stream.ts` validates and turns them into
 * AiStreamEvents.
 *
 * Works regardless of key order: if `text` streams before `block_id`, the
 * buffered text is emitted right after `started`.
 */

export type RawBlockEvent =
  | { type: "started"; blockId: string; path: string }
  | { type: "delta"; blockId: string; text: string }
  | { type: "completed"; blockId: string; path: string; raw: Record<string, unknown> };

type OpenObject = { blockId: string | null; bufferedText: string };

export function pathKey(path: JsonPath): string {
  return path.map(String).join(".");
}

export class BlockExtractor {
  private readonly parser = new IncrementalJsonParser();
  private readonly open = new Map<string, OpenObject>();

  constructor(private readonly keys: { blockId: string; text: string } = { blockId: "block_id", text: "text" }) {}

  push(chunk: string): RawBlockEvent[] {
    const out: RawBlockEvent[] = [];
    for (const event of this.parser.push(chunk)) this.handle(event, out);
    return out;
  }

  /** Complete parsed value (throws JsonStreamError on truncated/invalid JSON). */
  end(): unknown {
    return this.parser.end();
  }

  private handle(event: JsonEvent, out: RawBlockEvent[]): void {
    if (event.type === "open" && event.kind === "object") {
      this.open.set(pathKey(event.path), { blockId: null, bufferedText: "" });
      return;
    }
    if (event.type === "close" && event.kind === "object") {
      const key = pathKey(event.path);
      const obj = this.open.get(key);
      this.open.delete(key);
      if (obj?.blockId) out.push({ type: "completed", blockId: obj.blockId, path: key, raw: event.value as Record<string, unknown> });
      return;
    }
    if (event.path.length === 0) return;
    const parentKey = pathKey(event.path.slice(0, -1));
    const field = event.path[event.path.length - 1];
    const parent = this.open.get(parentKey);
    if (!parent) return;

    if (event.type === "value" && field === this.keys.blockId && typeof event.value === "string" && parent.blockId === null) {
      parent.blockId = event.value;
      out.push({ type: "started", blockId: event.value, path: parentKey });
      if (parent.bufferedText) {
        out.push({ type: "delta", blockId: event.value, text: parent.bufferedText });
        parent.bufferedText = "";
      }
      return;
    }
    if (event.type === "string_partial" && field === this.keys.text) {
      if (parent.blockId) out.push({ type: "delta", blockId: parent.blockId, text: event.text });
      else parent.bufferedText += event.text;
    }
  }
}
