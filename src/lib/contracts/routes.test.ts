import { describe, expect, it } from "vitest";
import { ROUTES, isProtectedPath, safeNextPath, withNext } from "./routes";

describe("safeNextPath", () => {
  it.each([
    ["/career", "/career"],
    ["/applications/abc?tab=insight#top", "/applications/abc?tab=insight#top"],
    ["/onboarding/consent?next=%2Fboard", "/onboarding/consent?next=%2Fboard"],
  ])("keeps same-origin path %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    [null],
    [undefined],
    [""],
    ["https://evil.example/career"],
    ["//evil.example"],
    ["/\\evil.example"],
    ["career"],
    ["javascript:alert(1)"],
    ["/career\nSet-Cookie: x"],
    ["/a\\b"],
    [ROUTES.login],
    [`${ROUTES.authCallback}?code=x`],
    [`/${"a".repeat(600)}`],
  ])("falls back for %s", (input) => {
    expect(safeNextPath(input as string | null | undefined)).toBe(ROUTES.home);
  });

  it("uses the given fallback", () => {
    expect(safeNextPath("//x", "/board")).toBe("/board");
  });
});

describe("isProtectedPath", () => {
  it("matches prefixes on segment boundaries", () => {
    expect(isProtectedPath("/career")).toBe(true);
    expect(isProtectedPath("/career/projects/1")).toBe(true);
    expect(isProtectedPath("/onboarding/consent")).toBe(true);
    expect(isProtectedPath("/careers")).toBe(false);
    expect(isProtectedPath("/")).toBe(false);
    expect(isProtectedPath("/login")).toBe(false);
    expect(isProtectedPath("/auth/callback")).toBe(false);
  });
});

describe("withNext", () => {
  it("encodes the next path", () => {
    expect(withNext("/login", "/career?x=1&y=2")).toBe("/login?next=%2Fcareer%3Fx%3D1%26y%3D2");
  });
});
