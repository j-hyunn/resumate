import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PREVIEW_REQUEST_HEADER, REQUEST_PATH_HEADER } from "@/lib/contracts/preview";
import { isTrustedPreviewMarker } from "./preview-marker";
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
    expect(res.headers.get("location")).toBe("http://localhost:3000/sign-in?next=%2Fcareer%2Fprojects%3Ftab%3D1");
  });

  it("lets anonymous users through on public paths", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    const res = await updateSession(req("/sign-in"));
    expect(res.headers.get("location")).toBeNull();
  });

  it.each(["/", "/sign-in", "/policies", "/auth/callback"])("anonymous %s isn't redirected", async (path) => {
    getClaims.mockResolvedValue({ data: null, error: null });
    expect((await updateSession(req(path))).headers.get("location")).toBeNull();
  });

  it.each([
    ["/consent", "/sign-in?next=%2Fconsent"],
    ["/settings/withdraw", "/sign-in?next=%2Fsettings%2Fwithdraw"],
    ["/settings/withdraw/finalize", "/sign-in?next=%2Fsettings%2Fwithdraw%2Ffinalize"],
  ])("anonymous %s goes to sign-in", async (path, target) => {
    getClaims.mockResolvedValue({ data: null, error: null });
    expect((await updateSession(req(path))).headers.get("location")).toBe(`http://localhost:3000${target}`);
  });

  it.each(["/consent", "/settings/withdraw", "/settings/withdraw/finalize"])("signed-in %s passes: the proxy has no consent gate", async (path) => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "u1" } }, error: null });
    expect((await updateSession(req(path))).headers.get("location")).toBeNull();
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

  describe("request marks (W1)", () => {
    const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);

    it("forwards the page path for the consent gate's ?next=", async () => {
      getClaims.mockResolvedValue({ data: { claims: { sub: "u1" } }, error: null });
      const res = await updateSession(req("/career/skills?x=1"));
      expect(forwarded(res, REQUEST_PATH_HEADER)).toBe("/career/skills?x=1");
      expect(forwarded(res, PREVIEW_REQUEST_HEADER)).toBeNull();
    });

    it("?state= and /dev/ are previews: mock store, no sign-in needed", async () => {
      getClaims.mockResolvedValue({ data: null, error: null });
      for (const path of ["/career?state=empty", "/dev/states"]) {
        const res = await updateSession(req(path));
        expect(res.status).toBe(200);
        expect(isTrustedPreviewMarker(forwarded(res, PREVIEW_REQUEST_HEADER))).toBe(true);
      }
    });

    it("a client can't mark its own request as a preview", async () => {
      getClaims.mockResolvedValue({ data: { claims: { sub: "u1" } }, error: null });
      const res = await updateSession(new NextRequest("http://localhost:3000/career", { headers: { [PREVIEW_REQUEST_HEADER]: "1" } }));
      expect(forwarded(res, PREVIEW_REQUEST_HEADER)).toBeNull();
      // QA-W5-03: a ?state= request with a forged value gets the proxy's own marker, not the client's
      const pv = await updateSession(new NextRequest("http://localhost:3000/career?state=empty", { headers: { [PREVIEW_REQUEST_HEADER]: "1" } }));
      expect(forwarded(pv, PREVIEW_REQUEST_HEADER)).not.toBe("1");
      expect(isTrustedPreviewMarker(forwarded(pv, PREVIEW_REQUEST_HEADER))).toBe(true);
    });

    it("refreshed cookies still reach the page", async () => {
      pendingCookies = [{ name: "sb-test-auth-token", value: "new", options: { path: "/" } }];
      getClaims.mockResolvedValue({ data: { claims: { sub: "u1" } }, error: null });
      const res = await updateSession(req("/career"));
      expect(forwarded(res, "cookie")).toContain("sb-test-auth-token=new");
    });
  });
});
