import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/contracts/errors";

const getUser = vi.fn();
const rpc = vi.fn();
const redirect = vi.fn((url: string) => {
  throw Object.assign(new Error("NEXT_REDIRECT"), { url });
});

const accountState = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));
const requestHeaders = vi.hoisted(() => ({ value: null as Headers | null }));
vi.mock("next/headers", () => ({
  headers: async () => {
    if (!requestHeaders.value) throw new Error("outside a request scope");
    return requestHeaders.value;
  },
}));
vi.mock("./account-state", () => ({ loadAccountState: () => accountState() }));
vi.mock("@/server/db/server", () => ({
  createSupabaseServerClient: async () => {
    const r = getUser();
    if (r instanceof Error) throw r;
    return { auth: { getUser: async () => r }, rpc };
  },
}));

const { requireActiveUser, requireConsentedUser, requireConsentedUserOrRedirect, requireUser, requireUserForAccountDeletion, requireUserForConsentPage } = await import("./session");

const consented = [{ consent_type: "terms", required: true, current_version: "v", agreed_version: "v", needs_consent: false }];
const needs = [{ consent_type: "terms", required: true, current_version: "v", agreed_version: null, needs_consent: true }];

beforeEach(() => {
  getUser.mockReset();
  rpc.mockReset();
  redirect.mockClear();
  accountState.mockReset();
  accountState.mockResolvedValue("active");
  requestHeaders.value = null;
});

describe("requireUser", () => {
  it("throws unauthenticated without a user", async () => {
    getUser.mockReturnValue({ data: { user: null }, error: null });
    await expect(requireUser()).rejects.toMatchObject({ code: "unauthenticated" });
  });
});

describe("requireConsentedUser", () => {
  it("throws consent_required (403) when a required consent is missing", async () => {
    getUser.mockReturnValue({ data: { user: { id: "u" } }, error: null });
    rpc.mockResolvedValue({ data: needs, error: null });
    await expect(requireConsentedUser()).rejects.toMatchObject({ code: "consent_required", status: 403 });
  });
});

describe("requireConsentedUserOrRedirect (QA-07)", () => {
  it("signed out → login with next", async () => {
    getUser.mockReturnValue({ data: { user: null }, error: null });
    await expect(requireConsentedUserOrRedirect("/board")).rejects.toMatchObject({ url: "/sign-in?next=%2Fboard" });
  });
  it("needs consent → consent page with next", async () => {
    getUser.mockReturnValue({ data: { user: { id: "u" } }, error: null });
    rpc.mockResolvedValue({ data: needs, error: null });
    await expect(requireConsentedUserOrRedirect("/board")).rejects.toMatchObject({ url: "/consent?next=%2Fboard" });
  });
  it("consented → context", async () => {
    getUser.mockReturnValue({ data: { user: { id: "u" } }, error: null });
    rpc.mockResolvedValue({ data: consented, error: null });
    await expect(requireConsentedUserOrRedirect("/board")).resolves.toMatchObject({ user: { id: "u" } });
  });
  it("other failures are rethrown, not turned into a login redirect", async () => {
    getUser.mockReturnValue(new Error("env missing"));
    await expect(requireConsentedUserOrRedirect("/board")).rejects.toThrow("env missing");
    expect(redirect).not.toHaveBeenCalled();
  });
  it("a consent RPC failure is rethrown", async () => {
    getUser.mockReturnValue({ data: { user: { id: "u" } }, error: null });
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "down" } });
    await expect(requireConsentedUserOrRedirect("/board")).rejects.toBeInstanceOf(AppError);
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("R1 A7 account state gate", () => {
  it("actions: deletion_incomplete → account_deletion_incomplete (403) before the consent gate", async () => {
    getUser.mockReturnValue({ data: { user: { id: "u" } }, error: null });
    accountState.mockResolvedValue("deletion_incomplete");
    await expect(requireConsentedUser()).rejects.toMatchObject({ code: "account_deletion_incomplete", status: 403 });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("pages: deletion_incomplete → S-25 instead of the consent page / original URL", async () => {
    getUser.mockReturnValue({ data: { user: { id: "u" } }, error: null });
    rpc.mockResolvedValue({ data: needs, error: null });
    accountState.mockResolvedValue("deletion_incomplete");
    await expect(requireConsentedUserOrRedirect("/board")).rejects.toMatchObject({ url: "/settings/withdraw/finalize" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("profile_missing [가정] → account_profile_missing, never the consent gate", async () => {
    getUser.mockReturnValue({ data: { user: { id: "u" } }, error: null });
    accountState.mockResolvedValue("profile_missing");
    await expect(requireConsentedUser()).rejects.toMatchObject({ code: "account_profile_missing" });
    await expect(requireConsentedUserOrRedirect("/board")).rejects.toMatchObject({ code: "account_profile_missing" });
  });
  it("S-25 is outside the consent gate: consent never checked; returns the state", async () => {
    getUser.mockReturnValue({ data: { user: { id: "u" } }, error: null });
    rpc.mockResolvedValue({ data: needs, error: null });
    accountState.mockResolvedValue("deletion_incomplete");
    await expect(requireUserForAccountDeletion()).resolves.toMatchObject({ accountState: "deletion_incomplete" });
    accountState.mockResolvedValue("active");
    await expect(requireUserForAccountDeletion()).resolves.toMatchObject({ accountState: "active" });
    expect(rpc).not.toHaveBeenCalled();
    getUser.mockReturnValue({ data: { user: null }, error: null });
    await expect(requireUserForAccountDeletion()).rejects.toMatchObject({ url: "/sign-in?next=%2Fsettings%2Fwithdraw" });
  });
});

describe("QA-R1-02: consent page / consent actions check the account state, not consent", () => {
  it("requireActiveUser: deletion_incomplete → 403 account_deletion_incomplete; active → no consent check", async () => {
    getUser.mockReturnValue({ data: { user: { id: "u" } }, error: null });
    rpc.mockResolvedValue({ data: needs, error: null });
    accountState.mockResolvedValue("deletion_incomplete");
    await expect(requireActiveUser()).rejects.toMatchObject({ code: "account_deletion_incomplete", status: 403 });
    accountState.mockResolvedValue("active");
    await expect(requireActiveUser()).resolves.toMatchObject({ user: { id: "u" } });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("requireUserForConsentPage: deletion_incomplete → S-25; needs consent → stays (no redirect)", async () => {
    getUser.mockReturnValue({ data: { user: { id: "u" } }, error: null });
    rpc.mockResolvedValue({ data: needs, error: null });
    accountState.mockResolvedValue("deletion_incomplete");
    await expect(requireUserForConsentPage()).rejects.toMatchObject({ url: "/settings/withdraw/finalize" });
    accountState.mockResolvedValue("active");
    await expect(requireUserForConsentPage()).resolves.toMatchObject({ user: { id: "u" } });
    expect(redirect).toHaveBeenCalledTimes(1);
    getUser.mockReturnValue({ data: { user: null }, error: null });
    await expect(requireUserForConsentPage()).rejects.toMatchObject({ url: "/sign-in?next=%2Fconsent" });
  });
});

describe("requireConsentedUser in a page render (UQ-704)", () => {
  const needsConsent = () => {
    getUser.mockReturnValue({ data: { user: { id: "u1" } }, error: null });
    rpc.mockResolvedValue({ data: needs, error: null });
  };

  it("a page render redirects to S-03 with next (the gate's own answer), so nothing is logged as a server error", async () => {
    needsConsent();
    requestHeaders.value = new Headers({ "x-resumate-path": "/career?x=1" });
    await expect(requireConsentedUser()).rejects.toMatchObject({ message: "NEXT_REDIRECT", url: "/consent?next=%2Fcareer%3Fx%3D1" });
  });

  it("Server Actions, Route Handlers and code outside a request still get consent_required (403)", async () => {
    for (const h of [new Headers({ "x-resumate-path": "/career", "next-action": "abc" }), new Headers({ "x-resumate-path": "/api/application-projects/x/insights" }), new Headers(), null]) {
      needsConsent();
      requestHeaders.value = h;
      await expect(requireConsentedUser()).rejects.toMatchObject({ code: "consent_required", status: 403 });
    }
    expect(redirect).not.toHaveBeenCalled();
  });
});
