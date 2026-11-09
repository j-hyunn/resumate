import { PENDING_CAREER_DESCRIPTION_COOKIE } from "@/server/auth/user-cookies";
import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ values: new Map<string, string>(), deleted: [] as string[] }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.values.has(name) ? { name, value: jar.values.get(name) } : undefined),
    delete: (name: string) => {
      jar.deleted.push(name);
      jar.values.delete(name);
    },
  }),
}));

const { clearUserScopedCookies, USER_SCOPED_COOKIES } = await import("./user-cookies");

beforeEach(() => {
  jar.values.clear();
  jar.deleted.length = 0;
});

describe("clearUserScopedCookies (QA-W5-02)", () => {
  it("removes the W3-2 pending-generation cookie", async () => {
    expect(USER_SCOPED_COOKIES).toContain(PENDING_CAREER_DESCRIPTION_COOKIE);
    jar.values.set(PENDING_CAREER_DESCRIPTION_COOKIE, "x");
    jar.values.set("sb-test-auth-token", "keep"); // Supabase clears its own
    await clearUserScopedCookies();
    expect(jar.deleted).toEqual([PENDING_CAREER_DESCRIPTION_COOKIE]);
    expect(jar.values.has("sb-test-auth-token")).toBe(true);
  });

  it("sets no deletion header when there is nothing to clear", async () => {
    await clearUserScopedCookies();
    expect(jar.deleted).toEqual([]);
  });
});
