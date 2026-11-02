import { describe, expect, it } from "vitest";
import { decodePendingCookie, encodePendingCookie, type PendingCareerDescription } from "./pending-cookie";

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b1";
const pending: PendingCareerDescription = {
  id: "00000000-0000-4000-8000-0000000000d1",
  user_id: A,
  application_project_id: "00000000-0000-4000-8000-0000000000e1",
  options: { included_project_ids: [] },
  regenerated_from_id: null,
  ended: false,
};

describe("W3-2 pending cookie (QA-W5-02)", () => {
  it("round-trips for its own user and id", () => {
    const raw = encodePendingCookie(pending);
    expect(decodePendingCookie(raw, A)).toEqual(pending);
    expect(decodePendingCookie(raw, A, pending.id)).toEqual(pending);
  });

  it("is null for another user on the same browser, another id, or a missing value", () => {
    const raw = encodePendingCookie(pending);
    expect(decodePendingCookie(raw, B)).toBeNull();
    expect(decodePendingCookie(raw, B, pending.id)).toBeNull();
    expect(decodePendingCookie(raw, A, "00000000-0000-4000-8000-0000000000d2")).toBeNull();
    expect(decodePendingCookie(undefined, A)).toBeNull();
  });

  it("an old cookie without user_id (pre-fix) or a forged / broken one is null", () => {
    const { user_id: _drop, ...legacy } = pending;
    void _drop;
    const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
    expect(decodePendingCookie(enc(legacy), A)).toBeNull();
    expect(decodePendingCookie("%%%not-base64", A)).toBeNull();
    expect(decodePendingCookie(enc("str"), A)).toBeNull();
    expect(decodePendingCookie(enc({ ...pending, application_project_id: "x'; drop" }), A)).toBeNull();
    expect(decodePendingCookie(enc({ ...pending, options: [] }), A)).toBeNull();
    expect(decodePendingCookie(enc({ ...pending, regenerated_from_id: 7 }), A)).toBeNull();
  });
});
