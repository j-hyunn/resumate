import { describe, expect, it } from "vitest";
import { BlockExtractor, type RawBlockEvent } from "./blocks";
import { IncrementalJsonParser, JsonStreamError } from "./json-incremental";

function feed(text: string, size: number) {
  const parser = new IncrementalJsonParser();
  const events = [];
  for (let i = 0; i < text.length; i += size) events.push(...parser.push(text.slice(i, i + size)));
  return { events, value: parser.end() };
}

const SAMPLE = {
  schema_version: 1,
  sections: [{ summary: { block_id: "e1-s", text: "결제 \"플랫폼\" 백엔드\n담당 — ✓", evidence: [] }, n: -1.5e2, ok: true, none: null }],
};

describe("IncrementalJsonParser", () => {
  it.each([1, 2, 3, 7, 1000])("parses the same value for chunk size %i", (size) => {
    const text = JSON.stringify(SAMPLE);
    expect(feed(text, size).value).toEqual(SAMPLE);
  });

  it("parses \\u escapes and pretty-printed JSON", () => {
    expect(feed('{ "a" : "\\uD55C\\uAE00" ,\n "b": [ 1 , 2 ] }', 3).value).toEqual({ a: "한글", b: [1, 2] });
  });

  it("emits string_partial deltas that add up to the full string", () => {
    const text = JSON.stringify({ text: "가나다라마바사" });
    const { events } = feed(text, 4);
    const partial = events.filter((e) => e.type === "string_partial").map((e) => (e.type === "string_partial" ? e.text : ""));
    expect(partial.join("")).toBe("가나다라마바사");
    expect(events.at(-1)).toMatchObject({ type: "close", path: [] });
  });

  it.each(['{"a":1', '{"a" 1}', "[1,,2]", '{"a":tru}', '{"a":1}}', '{"a":"x\\q"}', ""])("rejects invalid JSON %j", (text) => {
    expect(() => feed(text, 2)).toThrow(JsonStreamError);
  });
});

describe("BlockExtractor", () => {
  function collect(text: string, size: number) {
    const ex = new BlockExtractor();
    const events: RawBlockEvent[] = [];
    for (let i = 0; i < text.length; i += size) events.push(...ex.push(text.slice(i, i + size)));
    return { events, value: ex.end() };
  }

  it("emits started → deltas → completed for each block_id object", () => {
    const text = JSON.stringify({
      sections: [
        {
          summary: { block_id: "b1", text: "첫 블록입니다", evidence: [] },
          bullets: [{ block_id: "b2", text: "둘째", evidence: [] }],
        },
      ],
    });
    const { events } = collect(text, 5);
    const b1 = events.filter((e) => e.type !== "value" && e.blockId === "b1");
    expect(b1[0]).toEqual({ type: "started", blockId: "b1", path: "sections.0.summary" });
    expect(b1.filter((e) => e.type === "delta").map((e) => (e.type === "delta" ? e.text : "")).join("")).toBe("첫 블록입니다");
    expect(b1.at(-1)).toEqual({ type: "completed", blockId: "b1", path: "sections.0.summary", raw: { block_id: "b1", text: "첫 블록입니다", evidence: [] } });
    expect(events.filter((e) => e.type === "completed").map((e) => e.blockId)).toEqual(["b1", "b2"]);
  });

  it("buffers text that streams before block_id", () => {
    const { events } = collect('{"x":{"text":"앞선 텍스트","block_id":"b9"}}', 3);
    expect(events).toEqual([
      { type: "started", blockId: "b9", path: "x" },
      { type: "delta", blockId: "b9", text: "앞선 텍스트" },
      { type: "completed", blockId: "b9", path: "x", raw: { text: "앞선 텍스트", block_id: "b9" } },
    ]);
  });

  it("ignores text fields outside blocks", () => {
    const { events } = collect('{"notes":{"text":"블록 아님"}}', 4);
    expect(events).toEqual([]);
  });
});
