import { AuthError } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/contracts/errors";
import {
  LOGIN_CALLBACK_ERROR,
  buildCallbackUrl,
  loginCallbackErrorUrl,
  completeAuthCallback,
  mapAuthError,
  signOut,
  startGoogleSignIn,
  type CallbackParams,
} from "./index";

const consentRows = (needs: boolean) => [
  { consent_type: "terms", required: true, current_version: "2026-10-01", agreed_version: needs ? null : "2026-10-01", needs_consent: needs },
  { consent_type: "marketing", required: false, current_version: "2026-10-01", agreed_version: null, needs_consent: false },
];

function fakeClient(overrides: Partial<Record<string, unknown>> = {}) {
  const auth = {
    signInWithOAuth: vi.fn().mockResolvedValue({ data: { url: "https://auth.example/google" }, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    exchangeCodeForSession: vi.fn().mockResolvedValue({ data: {}, error: null }),
    ...overrides,
  };
  const rpc = vi.fn().mockResolvedValue({ data: consentRows(false), error: null });
  return { auth, rpc } as unknown as Parameters<typeof completeAuthCallback>[0] & { auth: typeof auth; rpc: typeof rpc };
}

const params = (p: Partial<CallbackParams>): CallbackParams => ({
  code: null,
  next: null,
  providerError: null,
  ...p,
});

describe("buildCallbackUrl", () => {
  it("adds a safe next", () => {
    expect(buildCallbackUrl("http://localhost:3000", "/board")).toBe("http://localhost:3000/auth/callback?next=%2Fboard");
  });
  it("replaces an unsafe next with the home path", () => {
    expect(buildCallbackUrl("https://app.example", "https://evil.example")).toBe("https://app.example/auth/callback?next=%2Fcareer");
  });
});

describe("mapAuthError", () => {
  it("hides any Auth error behind auth_failed with a Korean message", () => {
    for (const e of [new AuthError("Internal details", 500, "unexpected_failure"), new AuthError("too many", 429, "over_request_rate_limit")]) {
      const err = mapAuthError(e);
      expect(err.code).toBe("auth_failed");
      expect(err.status).toBe(502);
      expect(err.message).not.toContain("Internal");
    }
  });
});

describe("startGoogleSignIn", () => {
  it("returns the provider URL without a server-side redirect", async () => {
    const c = fakeClient();
    await expect(startGoogleSignIn(c, {}, "http://localhost:3000")).resolves.toEqual({ url: "https://auth.example/google" });
    expect(c.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "http://localhost:3000/auth/callback?next=%2Fcareer", skipBrowserRedirect: true },
    });
  });
  it("fails when no URL comes back", async () => {
    const c = fakeClient({ signInWithOAuth: vi.fn().mockResolvedValue({ data: { url: null }, error: null }) });
    await expect(startGoogleSignIn(c, {}, "http://x")).rejects.toBeInstanceOf(AppError);
  });
});

describe("signOut", () => {
  it("signs out locally", async () => {
    const c = fakeClient();
    await signOut(c);
    expect(c.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});

describe("completeAuthCallback", () => {
  it("code + consented → next", async () => {
    const c = fakeClient();
    await expect(completeAuthCallback(c, params({ code: "abc", next: "/board" }))).resolves.toBe("/board");
    expect(c.auth.exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(c.rpc).toHaveBeenCalledWith("get_consent_status");
  });
  it("code + consented, no next → /career", async () => {
    await expect(completeAuthCallback(fakeClient(), params({ code: "abc" }))).resolves.toBe("/career");
  });
  it("R1 A7: unfinished deletion → S-25 before the consent gate and next (consent not even checked)", async () => {
    const c = fakeClient();
    c.rpc.mockResolvedValue({ data: consentRows(true), error: null });
    await expect(completeAuthCallback(c, params({ code: "abc", next: "/board" }), async () => "deletion_incomplete")).resolves.toBe("/settings/withdraw/finalize");
    expect(c.rpc).not.toHaveBeenCalled();
  });
  it("R1 A7 [가정]: profile_missing → signed out, login error; active → the usual flow", async () => {
    const c = fakeClient();
    await expect(completeAuthCallback(c, params({ code: "abc" }), async () => "profile_missing")).resolves.toBe("/sign-in?error=auth_callback");
    // UQ-732: next survives here too (harmless — the user is signed out and retries from S-02).
    await expect(
      completeAuthCallback(fakeClient(), params({ code: "abc", next: "/board" }), async () => "profile_missing"),
    ).resolves.toBe("/sign-in?error=auth_callback&next=%2Fboard");
    expect(c.auth.signOut).toHaveBeenCalled();
    await expect(completeAuthCallback(fakeClient(), params({ code: "abc", next: "/board" }), async () => "active")).resolves.toBe("/board");
    // A state lookup failure doesn't block sign-in (gated pages re-check).
    await expect(
      completeAuthCallback(fakeClient(), params({ code: "abc", next: "/board" }), async () => {
        throw new Error("down");
      }),
    ).resolves.toBe("/board");
  });
  it("code + consent needed → consent page with next", async () => {
    const c = fakeClient();
    c.rpc.mockResolvedValue({ data: consentRows(true), error: null });
    await expect(completeAuthCallback(c, params({ code: "abc", next: "/board" }))).resolves.toBe(
      "/consent?next=%2Fboard",
    );
  });
  it("unsafe next is replaced before the consent redirect", async () => {
    const c = fakeClient();
    c.rpc.mockResolvedValue({ data: consentRows(true), error: null });
    await expect(completeAuthCallback(c, params({ code: "abc", next: "//evil" }))).resolves.toBe(
      "/consent?next=%2Fcareer",
    );
  });
  it("consent check failure → consent page (fail closed)", async () => {
    const c = fakeClient();
    c.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    await expect(completeAuthCallback(c, params({ code: "abc" }))).resolves.toBe("/consent?next=%2Fcareer");
  });
  it("exchange error → login error", async () => {
    const c = fakeClient({
      exchangeCodeForSession: vi.fn().mockResolvedValue({ data: {}, error: new AuthError("bad", 400, "bad_code_verifier") }),
    });
    await expect(completeAuthCallback(c, params({ code: "abc" }))).resolves.toBe(LOGIN_CALLBACK_ERROR);
    expect(c.rpc).not.toHaveBeenCalled();
  });
  it("D-09 변경: a magic-link style callback (token_hash/type, no code) → login error, no session", async () => {
    const c = fakeClient();
    // Extra query params beyond CallbackParams are ignored by the route; simulate one arriving anyway.
    const legacy = { ...params({ next: "/board" }), tokenHash: "th", type: "magiclink" } as CallbackParams;
    await expect(completeAuthCallback(c, legacy)).resolves.toBe("/sign-in?error=auth_callback&next=%2Fboard");
    expect(c.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(c.rpc).not.toHaveBeenCalled();
  });
  it("provider error or no params → login error", async () => {
    await expect(completeAuthCallback(fakeClient(), params({ providerError: "access_denied", code: "x" }))).resolves.toBe(
      LOGIN_CALLBACK_ERROR,
    );
    await expect(completeAuthCallback(fakeClient(), params({}))).resolves.toBe(LOGIN_CALLBACK_ERROR);
    expect(LOGIN_CALLBACK_ERROR).toBe("/sign-in?error=auth_callback");
  });
  it("UQ-732: Google cancel (provider error) keeps next for the retry", async () => {
    const c = fakeClient();
    await expect(
      completeAuthCallback(c, params({ providerError: "access_denied", next: "/applications/42?tab=insight" })),
    ).resolves.toBe("/sign-in?error=auth_callback&next=%2Fapplications%2F42%3Ftab%3Dinsight");
    expect(c.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
  it("UQ-732: exchange failure keeps next", async () => {
    const c = fakeClient({
      exchangeCodeForSession: vi.fn().mockResolvedValue({ data: {}, error: new AuthError("bad", 400, "bad_code_verifier") }),
    });
    await expect(completeAuthCallback(c, params({ code: "abc", next: "/board" }))).resolves.toBe(
      "/sign-in?error=auth_callback&next=%2Fboard",
    );
  });
  it("UQ-732: unsafe, auth-page, or default next is dropped from the failure URL", async () => {
    for (const next of ["//evil.example", "https://evil.example/x", "/\\evil", "/sign-in?next=/board", "/auth/callback", "/career"]) {
      await expect(completeAuthCallback(fakeClient(), params({ providerError: "access_denied", next }))).resolves.toBe(
        LOGIN_CALLBACK_ERROR,
      );
    }
    expect(loginCallbackErrorUrl("/career")).toBe(LOGIN_CALLBACK_ERROR);
  });
});
