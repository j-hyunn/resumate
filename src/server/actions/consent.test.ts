import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/contracts/errors";

const requireActiveUser = vi.fn();
const submit = vi.fn();
const withdraw = vi.fn();
const status = vi.fn();

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": "ua" }) }));
vi.mock("@/server/auth/session", () => ({ requireActiveUser: () => requireActiveUser() }));
vi.mock("@/server/services/consent", () => ({
  submitConsents: (...a: unknown[]) => submit(...a),
  withdrawOptionalConsent: (...a: unknown[]) => withdraw(...a),
  getConsentStatus: (...a: unknown[]) => status(...a),
}));

const { getConsentStatus, submitConsents, withdrawConsent } = await import("./consent");

beforeEach(() => {
  for (const f of [requireActiveUser, submit, withdraw, status]) f.mockReset();
});

describe("consent actions — QA-R1-02 (R1 A7)", () => {
  it("a half-deleted account can't read, submit, or withdraw consents (403, nothing written)", async () => {
    requireActiveUser.mockRejectedValue(new AppError("account_deletion_incomplete", "탈퇴가 아직 끝나지 않았어요.", { status: 403 }));
    const items = { items: [{ consentType: "terms", agreed: true }, { consentType: "privacy_required", agreed: true }] };
    for (const r of [await submitConsents(items, "/board"), await withdrawConsent({ consentType: "marketing" }), await getConsentStatus()]) {
      expect(r).toMatchObject({ error: { code: "account_deletion_incomplete" } });
    }
    expect(submit).not.toHaveBeenCalled();
    expect(withdraw).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it("an active account submits as before", async () => {
    requireActiveUser.mockResolvedValue({ supabase: {}, user: { id: "u" } });
    submit.mockResolvedValue({ items: [], needsRequiredConsent: false });
    const r = await submitConsents({ items: [{ consentType: "terms", agreed: true }, { consentType: "privacy_required", agreed: true }] }, "/board");
    expect(r).toMatchObject({ data: { redirectTo: "/board" } });
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
