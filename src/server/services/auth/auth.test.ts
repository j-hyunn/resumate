import { AuthError } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/contracts/errors";
import {
  LOGIN_CALLBACK_ERROR,
  buildCallbackUrl,
  completeAuthCallback,
  mapAuthError,
  sendMagicLink,
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
    signInWithOtp: vi.fn().mockResolvedValue({ data: {}, error: null }),
    signInWithOAuth: vi.fn().mockResolvedValue({ data: { url: "https://auth.example/google" }, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    exchangeCodeForSession: vi.fn().mockResolvedValue({ data: {}, error: null }),
    verifyOtp: vi.fn().mockResolvedValue({ data: {}, error: null }),
    ...overrides,
  };
  const rpc = vi.fn().mockResolvedValue({ data: consentRows(false), error: null });
  return { auth, rpc } as unknown as Parameters<typeof completeAuthCallback>[0] & { auth: typeof auth; rpc: typeof rpc };
}

const params = (p: Partial<CallbackParams>): CallbackParams => ({
  code: null,
  tokenHash: null,
  type: null,
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
  it("maps rate limits to auth_rate_limited (429)", () => {
    const err = mapAuthError(new AuthError("too many", 429, "over_email_send_rate_limit"));
    expect(err.code).toBe("auth_rate_limited");
    expect(err.status).toBe(429);
  });
  it("maps invalid email to invalid_input", () => {
    expect(mapAuthError(new AuthError("bad", 400, "email_address_invalid")).code).toBe("invalid_input");
  });
  it("hides other errors behind auth_failed with a Korean message", () => {
    const err = mapAuthError(new AuthError("Internal details", 500, "unexpected_failure"));
    expect(err.code).toBe("auth_failed");
    expect(err.message).not.toContain("Internal");
  });
});

describe("sendMagicLink", () => {
  it("calls signInWithOtp with the callback URL and creates new users", async () => {
    const c = fakeClient();
    await expect(sendMagicLink(c, { email: "a@b.co", next: "/board" }, "http://localhost:3000")).resolves.toEqual({ sent: true });
    expect(c.auth.signInWithOtp).toHaveBeenCalledWith({
      email: "a@b.co",
      options: { emailRedirectTo: "http://localhost:3000/auth/callback?next=%2Fboard", shouldCreateUser: true },
    });
  });
  it("throws the mapped error", async () => {
    const c = fakeClient({
      signInWithOtp: vi.fn().mockResolvedValue({ data: {}, error: new AuthError("x", 429, "over_email_send_rate_limit") }),
    });
    await expect(sendMagicLink(c, { email: "a@b.co" }, "http://x")).rejects.toMatchObject({ code: "auth_rate_limited" });
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
    await expect(completeAuthCallback(c, params({ code: "abc", next: "/board" }), async () => "deletion_incomplete")).resolves.toBe("/settings/account/delete");
    expect(c.rpc).not.toHaveBeenCalled();
  });
  it("R1 A7 [가정]: profile_missing → signed out, login error; active → the usual flow", async () => {
    const c = fakeClient();
    await expect(completeAuthCallback(c, params({ code: "abc" }), async () => "profile_missing")).resolves.toBe("/login?error=auth_callback");
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
      "/onboarding/consent?next=%2Fboard",
    );
  });
  it("unsafe next is replaced before the consent redirect", async () => {
    const c = fakeClient();
    c.rpc.mockResolvedValue({ data: consentRows(true), error: null });
    await expect(completeAuthCallback(c, params({ code: "abc", next: "//evil" }))).resolves.toBe(
      "/onboarding/consent?next=%2Fcareer",
    );
  });
  it("consent check failure → consent page (fail closed)", async () => {
    const c = fakeClient();
    c.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    await expect(completeAuthCallback(c, params({ code: "abc" }))).resolves.toBe("/onboarding/consent?next=%2Fcareer");
  });
  it("exchange error → login error", async () => {
    const c = fakeClient({
      exchangeCodeForSession: vi.fn().mockResolvedValue({ data: {}, error: new AuthError("bad", 400, "bad_code_verifier") }),
    });
    await expect(completeAuthCallback(c, params({ code: "abc" }))).resolves.toBe(LOGIN_CALLBACK_ERROR);
    expect(c.rpc).not.toHaveBeenCalled();
  });
  it("token_hash path verifies the OTP", async () => {
    const c = fakeClient();
    await expect(completeAuthCallback(c, params({ tokenHash: "th", type: "magiclink" }))).resolves.toBe("/career");
    expect(c.auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "th", type: "magiclink" });
  });
  it("token_hash with an unknown type → login error", async () => {
    const c = fakeClient();
    await expect(completeAuthCallback(c, params({ tokenHash: "th", type: "sms" }))).resolves.toBe(LOGIN_CALLBACK_ERROR);
    expect(c.auth.verifyOtp).not.toHaveBeenCalled();
  });
  it("provider error or no params → login error", async () => {
    await expect(completeAuthCallback(fakeClient(), params({ providerError: "access_denied", code: "x" }))).resolves.toBe(
      LOGIN_CALLBACK_ERROR,
    );
    await expect(completeAuthCallback(fakeClient(), params({}))).resolves.toBe(LOGIN_CALLBACK_ERROR);
    expect(LOGIN_CALLBACK_ERROR).toBe("/login?error=auth_callback");
  });
});
