import { describe, expect, it } from "vitest";
import { splitJdSentences } from "@/server/ai/context-pack/jd";
import { sha256Hex } from "@/server/ai/hash";
import { normalizeJdRawText } from "./raw-text";

/**
 * A3 (R15 plan 1-C): the creation path, the raw-text edit and the 요건 미리 보기 route must all
 * derive the split, the hash and the stored raw text from **one** normalized string — otherwise
 * `create_application_project` can never match a preview (`preview_mismatch`, D11).
 */
describe("normalizeJdRawText (A3)", () => {
  it("rule 1: CRLF and lone CR become LF", () => {
    expect(normalizeJdRawText("a\r\nb\rc")).toBe("a\nb\nc");
    expect(normalizeJdRawText("a\r\n\r\nb")).toBe("a\n\nb");
  });

  it("rule 2: Unicode NFC (decomposed Hangul and a combining accent are composed)", () => {
    // 한 = U+1112 U+1161 U+11AB decomposed → U+D55C
    const decomposed = "한국";
    expect(normalizeJdRawText(decomposed)).toBe("한국");
    expect(normalizeJdRawText("é")).toBe("é");
  });

  it("rule 3: leading and trailing whitespace is removed", () => {
    expect(normalizeJdRawText("  \n\t공고 본문 \n  ")).toBe("공고 본문");
  });

  it("does NOT collapse inner whitespace or blank lines", () => {
    const raw = "백엔드  개발자\n\n\n자격요건\n  - 3년\t이상";
    expect(normalizeJdRawText(raw)).toBe(raw);
  });

  it("is idempotent", () => {
    const once = normalizeJdRawText("  a\r\nb한  ");
    expect(normalizeJdRawText(once)).toBe(once);
  });

  it("an all-whitespace text normalizes to the empty string (the RPC refuses it as invalid_raw_text)", () => {
    expect(normalizeJdRawText(" \r\n \t ")).toBe("");
  });

  /**
   * The point of the function: hash, split and stored text are all taken from the SAME string, so
   * the preview's `params.raw_text_hash` / `sentence_count` match what creation recomputes, and
   * every sentence's offsets index the stored text exactly (`raw.slice(start, end) === text`).
   */
  it("hash, split and stored text agree, and the offsets index the normalized text", () => {
    const pasted = "\r\n  백엔드 개발자를 찾습니다.\r\n\r\n자격요건\r\n- Kafka 경험 3년 이상.\r\n  ";
    const normalized = normalizeJdRawText(pasted);

    // What the create path sends.
    const createHash = sha256Hex(normalized);
    const createSentences = splitJdSentences(normalized);
    // What the preview route computes from the same user text.
    const previewHash = sha256Hex(normalizeJdRawText(pasted));
    const previewSentences = splitJdSentences(normalizeJdRawText(pasted));

    expect(previewHash).toBe(createHash);
    expect(previewSentences.length).toBe(createSentences.length);
    expect(previewSentences).toEqual(createSentences);
    expect(createSentences.length).toBeGreaterThan(0);
    for (const s of createSentences) expect(normalized.slice(s.start, s.end)).toBe(s.text);
  });

  it("the same text with different line endings produces the same hash and split", () => {
    const lf = normalizeJdRawText("백엔드 개발자.\n자격요건.");
    const crlf = normalizeJdRawText("백엔드 개발자.\r\n자격요건.");
    const cr = normalizeJdRawText("백엔드 개발자.\r자격요건.");
    expect(sha256Hex(crlf)).toBe(sha256Hex(lf));
    expect(sha256Hex(cr)).toBe(sha256Hex(lf));
    expect(splitJdSentences(crlf)).toEqual(splitJdSentences(lf));
  });

  it("the hash of the un-normalized text differs — so a caller that skips the function breaks the preview", () => {
    const pasted = "  백엔드 개발자.\r\n";
    expect(sha256Hex(pasted)).not.toBe(sha256Hex(normalizeJdRawText(pasted)));
  });
});
