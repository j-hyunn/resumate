import { describe, expect, it } from "vitest";
import { DELETED_ROWS_MAX, decodeDeletedRows, encodeDeletedRows, isDeletedRow } from "./deleted-rows";

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b1";
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

describe("deleted-row ids of this browser (QA-W5-06)", () => {
  it("remembers deleted ids for their user only", () => {
    const raw = encodeDeletedRows(undefined, A, id(1));
    expect(isDeletedRow(raw, A, id(1))).toBe(true);
    expect(isDeletedRow(raw, A, id(2))).toBe(false);
    expect(isDeletedRow(raw, B, id(1))).toBe(false);
    // B deleting on the same browser starts its own list
    expect(decodeDeletedRows(encodeDeletedRows(raw, B, id(3)), B)).toEqual([id(3)]);
  });

  it("dedupes and keeps the newest DELETED_ROWS_MAX ids", () => {
    let raw: string | undefined;
    for (let i = 0; i < DELETED_ROWS_MAX + 5; i++) raw = encodeDeletedRows(raw, A, id(i));
    raw = encodeDeletedRows(raw, A, id(DELETED_ROWS_MAX + 4));
    const ids = decodeDeletedRows(raw, A);
    expect(ids).toHaveLength(DELETED_ROWS_MAX);
    expect(ids.at(-1)).toBe(id(DELETED_ROWS_MAX + 4));
    expect(ids).not.toContain(id(0));
    expect(raw!.length).toBeLessThan(3_000);
  });

  it("broken or forged values are empty", () => {
    expect(decodeDeletedRows("@@", A)).toEqual([]);
    expect(decodeDeletedRows(Buffer.from(JSON.stringify({ u: A, ids: ["x", 1, id(1)] })).toString("base64url"), A)).toEqual([id(1)]);
  });
});
