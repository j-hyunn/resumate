import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/contracts/errors";

const getUser = vi.fn();
const rpc = vi.fn();
const redirect = vi.fn((url: string) => {
  throw Object.assign(new Error("NEXT_REDIRECT"), { url });
});

vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));
vi.mock("@/server/db/server", () => ({
  createSupabaseServerClient: async () => {
    const r = getUser();
    if (r instanceof Error) throw r;
    return { auth: { getUser: async () => r }, rpc };
  },
}));

const { requireConsentedUser, requireConsentedUserOrRedirect, requireUser } = await import("./session");

const consented = [{ consent_type: "terms", required: true, current_version: "v", agreed_version: "v", needs_consent: false }];
const needs = [{ consent_type: "terms", required: true, current_version: "v", agreed_version: null, needs_consent: true }];

beforeEach(() => {
  getUser.mockReset();
  rpc.mockReset();
  redirect.mockClear();
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
    await expect(requireConsentedUserOrRedirect("/board")).rejects.toMatchObject({ url: "/login?next=%2Fboard" });
  });
  it("needs consent → consent page with next", async () => {
    getUser.mockReturnValue({ data: { user: { id: "u" } }, error: null });
    rpc.mockResolvedValue({ data: needs, error: null });
    await expect(requireConsentedUserOrRedirect("/board")).rejects.toMatchObject({ url: "/onboarding/consent?next=%2Fboard" });
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
