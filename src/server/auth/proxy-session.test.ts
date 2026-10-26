import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetServerEnvCache } from "@/server/env";

const getClaims = vi.fn();
let pendingCookies: { name: string; value: string; options: object }[] = [];

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, opts: { cookies: { setAll: (c: unknown[], h: Record<string, string>) => void } }) => ({
    auth: {
      getClaims: async () => {
        if (pendingCookies.length) opts.cookies.setAll(pendingCookies, { "Cache-Control": "private, no-store" });
        return getClaims();
      },
    },
  }),
}));

const { updateSession } = await import("./proxy-session");

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  // QA-06: the proxy needs only the public Supabase keys.
  vi.stubEnv("SUPABASE_JWT_SECRET", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("CRON_SECRET", "");
  resetServerEnvCache();
  pendingCookies = [];
  getClaims.mockReset();
});

const req = (path: string) => new NextRequest(new URL(path, "http://localhost:3000"));

describe("updateSession", () => {
  it("redirects anonymous users on protected paths to login with next", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    const res = await updateSession(req("/career/projects?tab=1"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/login?next=%2Fcareer%2Fprojects%3Ftab%3D1");
  });

  it("lets anonymous users through on public paths", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    const res = await updateSession(req("/login"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("lets signed-in users through and writes refreshed cookies + no-cache headers", async () => {
    pendingCookies = [{ name: "sb-test-auth-token", value: "new", options: { path: "/" } }];
    getClaims.mockResolvedValue({ data: { claims: { sub: "u1" } }, error: null });
    const res = await updateSession(req("/career"));
    expect(res.headers.get("location")).toBeNull();
    expect(res.cookies.get("sb-test-auth-token")?.value).toBe("new");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("keeps cookie changes on the login redirect", async () => {
    pendingCookies = [{ name: "sb-test-auth-token", value: "", options: { path: "/", maxAge: 0 } }];
    getClaims.mockResolvedValue({ data: null, error: null });
    const res = await updateSession(req("/board"));
    expect(res.status).toBe(307);
    expect(res.cookies.get("sb-test-auth-token")).toBeDefined();
  });
});
