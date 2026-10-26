/**
 * Incremental JSON parser for streamed structured output (C-6 streaming mode).
 * Feed text chunks with `push()`; it returns events as values open, grow, and
 * close. `end()` returns the complete value or throws JsonStreamError.
 *
 * Paths are arrays of object keys and array indices from the root.
 * String values emit `string_partial` with the newly decoded text per push,
 * so callers can stream a growing `text` field.
 */

export type JsonPath = ReadonlyArray<string | number>;

export type JsonEvent =
  | { type: "open"; path: JsonPath; kind: "object" | "array" }
  | { type: "string_partial"; path: JsonPath; text: string }
  | { type: "value"; path: JsonPath; value: string | number | boolean | null }
  | { type: "close"; path: JsonPath; kind: "object" | "array"; value: unknown };

export class JsonStreamError extends Error {
  constructor(reason: string) {
    // Reason only — never include the text (C-7).
    super(`Invalid JSON stream: ${reason}`);
    this.name = "JsonStreamError";
  }
}

type ObjectFrame = {
  kind: "object";
  value: Record<string, unknown>;
  path: JsonPath;
  key: string | null;
  expect: "key_or_end" | "key" | "colon" | "value" | "comma_or_end";
};
type ArrayFrame = {
  kind: "array";
  value: unknown[];
  path: JsonPath;
  expect: "value_or_end" | "value" | "comma_or_end";
};
type Frame = ObjectFrame | ArrayFrame;

const WS = /\s/;
const ESCAPES: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

export class IncrementalJsonParser {
  private stack: Frame[] = [];
  private root: unknown = undefined;
  private done = false;
  private mode: "default" | "string" | "literal" = "default";
  private str = "";
  private strIsKey = false;
  private strPath: JsonPath = [];
  private pending = "";
  /** null = not escaping; "" = after backslash; "u…" = collecting \u hex. */
  private esc: string | null = null;
  private literal = "";
  private literalPath: JsonPath = [];

  push(chunk: string): JsonEvent[] {
    const events: JsonEvent[] = [];
    for (let i = 0; i < chunk.length; i++) this.step(chunk[i], events);
    if (this.mode === "string" && !this.strIsKey && this.pending) {
      events.push({ type: "string_partial", path: this.strPath, text: this.pending });
      this.pending = "";
    }
    return events;
  }

  end(): unknown {
    const events: JsonEvent[] = [];
    if (this.mode === "literal") this.finishLiteral(events);
    if (this.mode !== "default" || this.stack.length > 0 || !this.done) throw new JsonStreamError("unexpected end");
    return this.root;
  }

  private currentPath(): JsonPath {
    const top = this.stack[this.stack.length - 1];
    if (!top) return [];
    if (top.kind === "object") return [...top.path, top.key ?? ""];
    return [...top.path, top.value.length];
  }

  private expectValue(): void {
    const top = this.stack[this.stack.length - 1];
    if (!top) {
      if (this.done) throw new JsonStreamError("trailing value");
      return;
    }
    if (top.kind === "object" && top.expect !== "value") throw new JsonStreamError("unexpected value in object");
    if (top.kind === "array" && top.expect !== "value" && top.expect !== "value_or_end") throw new JsonStreamError("unexpected value in array");
  }

  private assign(value: unknown): void {
    const top = this.stack[this.stack.length - 1];
    if (!top) {
      this.root = value;
      this.done = true;
      return;
    }
    if (top.kind === "object") {
      top.value[top.key ?? ""] = value;
      top.expect = "comma_or_end";
    } else {
      top.value.push(value);
      top.expect = "comma_or_end";
    }
  }

  private step(ch: string, events: JsonEvent[]): void {
    if (this.mode === "string") return this.stepString(ch, events);
    if (this.mode === "literal") {
      if (/[0-9eE+\-.a-z]/.test(ch)) {
        this.literal += ch;
        return;
      }
      this.finishLiteral(events);
    }
    if (WS.test(ch)) return;
    const top = this.stack[this.stack.length - 1];

    if (ch === '"') {
      if (top?.kind === "object" && (top.expect === "key" || top.expect === "key_or_end")) {
        this.strIsKey = true;
        this.strPath = top.path;
      } else {
        this.expectValue();
        this.strIsKey = false;
        this.strPath = this.currentPath();
      }
      this.mode = "string";
      this.str = "";
      this.pending = "";
      this.esc = null;
      return;
    }
    if (ch === "{" || ch === "[") {
      this.expectValue();
      const path = this.currentPath();
      const frame: Frame =
        ch === "{"
          ? { kind: "object", value: {}, path, key: null, expect: "key_or_end" }
          : { kind: "array", value: [], path, expect: "value_or_end" };
      this.assignContainer(frame.value);
      this.stack.push(frame);
      events.push({ type: "open", path, kind: frame.kind });
      return;
    }
    if (ch === "}" || ch === "]") {
      if (!top) throw new JsonStreamError("unbalanced close");
      const ok =
        ch === "}"
          ? top.kind === "object" && (top.expect === "key_or_end" || top.expect === "comma_or_end")
          : top.kind === "array" && (top.expect === "value_or_end" || top.expect === "comma_or_end");
      if (!ok) throw new JsonStreamError("unexpected close");
      this.stack.pop();
      events.push({ type: "close", path: top.path, kind: top.kind, value: top.value });
      this.afterContainerClose();
      return;
    }
    if (ch === ":") {
      if (top?.kind !== "object" || top.expect !== "colon") throw new JsonStreamError("unexpected colon");
      top.expect = "value";
      return;
    }
    if (ch === ",") {
      if (!top || top.expect !== "comma_or_end") throw new JsonStreamError("unexpected comma");
      top.expect = top.kind === "object" ? "key" : "value";
      return;
    }
    if (/[-0-9tfn]/.test(ch)) {
      this.expectValue();
      this.mode = "literal";
      this.literal = ch;
      this.literalPath = this.currentPath();
      return;
    }
    throw new JsonStreamError("unexpected character");
  }

  /** Containers are attached to the parent when they open so the root holds partial data. */
  private assignContainer(value: unknown): void {
    const top = this.stack[this.stack.length - 1];
    if (!top) {
      this.root = value;
      return;
    }
    if (top.kind === "object") top.value[top.key ?? ""] = value;
    else top.value.push(value);
  }

  private afterContainerClose(): void {
    const top = this.stack[this.stack.length - 1];
    if (!top) {
      this.done = true;
      return;
    }
    top.expect = "comma_or_end";
  }

  private stepString(ch: string, events: JsonEvent[]): void {
    if (this.esc !== null) {
      if (this.esc === "") {
        if (ch === "u") {
          this.esc = "u";
          return;
        }
        const decoded = ESCAPES[ch];
        if (decoded === undefined) throw new JsonStreamError("bad escape");
        this.appendString(decoded);
        this.esc = null;
        return;
      }
      if (!/[0-9a-fA-F]/.test(ch)) throw new JsonStreamError("bad unicode escape");
      this.esc += ch;
      if (this.esc.length === 5) {
        this.appendString(String.fromCharCode(parseInt(this.esc.slice(1), 16)));
        this.esc = null;
      }
      return;
    }
    if (ch === "\\") {
      this.esc = "";
      return;
    }
    if (ch !== '"') {
      this.appendString(ch);
      return;
    }
    // End of string.
    this.mode = "default";
    if (this.strIsKey) {
      const top = this.stack[this.stack.length - 1] as ObjectFrame;
      top.key = this.str;
      top.expect = "colon";
      return;
    }
    if (this.pending) events.push({ type: "string_partial", path: this.strPath, text: this.pending });
    this.pending = "";
    events.push({ type: "value", path: this.strPath, value: this.str });
    this.assign(this.str);
  }

  private appendString(text: string): void {
    this.str += text;
    if (!this.strIsKey) this.pending += text;
  }

  private finishLiteral(events: JsonEvent[]): void {
    this.mode = "default";
    const raw = this.literal;
    let value: number | boolean | null;
    if (raw === "true") value = true;
    else if (raw === "false") value = false;
    else if (raw === "null") value = null;
    else if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(raw)) value = Number(raw);
    else throw new JsonStreamError("bad literal");
    events.push({ type: "value", path: this.literalPath, value });
    this.assign(value);
  }
}
