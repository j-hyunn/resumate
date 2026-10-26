import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { REQUIRED_CONSENT_TYPES } from "@/lib/contracts/enums";
import { getConsentStatus, hashUserAgent, submitConsents, toConsentStatus } from "./index";

const row = (consent_type: string, required: boolean, needs_consent: boolean, agreed_version: string | null = null) => ({
  consent_type,
  required,
  current_version: "2026-10-01",
  agreed_version,
  needs_consent,
});

function fakeRpc(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc } as unknown as Parameters<typeof getConsentStatus>[0], rpc };
}

describe("toConsentStatus", () => {
  it("maps rows and computes the required gate", () => {
    const status = toConsentStatus([row("terms", true, false, "2026-10-01"), row("marketing", false, false)]);
    expect(status).toEqual({
      items: [
        { consentType: "terms", required: true, currentVersion: "2026-10-01", agreedVersion: "2026-10-01", needsConsent: false },
        { consentType: "marketing", required: false, currentVersion: "2026-10-01", agreedVersion: null, needsConsent: false },
      ],
      needsRequiredConsent: false,
    });
    expect(toConsentStatus([row("privacy_required", true, true)]).needsRequiredConsent).toBe(true);
  });
  it("optional needs_consent does not trip the gate", () => {
    expect(toConsentStatus([row("marketing", false, true)]).needsRequiredConsent).toBe(false);
  });
  it("throws on a consent type the TS enum doesn't know", () => {
    expect(() => toConsentStatus([row("newsletter", false, false)])).toThrow();
  });
});

describe("hashUserAgent", () => {
  it("returns sha-256 hex or null", () => {
    expect(hashUserAgent("UA/1.0")).toBe(createHash("sha256").update("UA/1.0").digest("hex"));
    expect(hashUserAgent("")).toBeNull();
    expect(hashUserAgent(null)).toBeNull();
  });
});

describe("getConsentStatus", () => {
  it("calls the RPC", async () => {
    const { client, rpc } = fakeRpc({ data: [row("terms", true, true)], error: null });
    await expect(getConsentStatus(client)).resolves.toMatchObject({ needsRequiredConsent: true });
    expect(rpc).toHaveBeenCalledWith("get_consent_status");
  });
  it("maps RPC errors", async () => {
    const { client } = fakeRpc({ data: null, error: { code: "42501", message: "permission denied" } });
    await expect(getConsentStatus(client)).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("submitConsents", () => {
  const items = REQUIRED_CONSENT_TYPES.map((consentType) => ({ consentType, agreed: true }));

  it("sends snake_case items + UA hash, never a version", async () => {
    const { client, rpc } = fakeRpc({ data: [row("terms", true, false, "2026-10-01")], error: null });
    await submitConsents(client, items, "UA/1.0");
    expect(rpc).toHaveBeenCalledWith("record_consents", {
      items: [
        { consent_type: "terms", agreed: true },
        { consent_type: "privacy_required", agreed: true },
        { consent_type: "cross_border_transfer", agreed: true },
      ],
      user_agent_hash: hashUserAgent("UA/1.0"),
    });
  });
  it("omits user_agent_hash without a UA", async () => {
    const { client, rpc } = fakeRpc({ data: [], error: null });
    await submitConsents(client, items, null);
    expect(rpc.mock.calls[0]![1]).not.toHaveProperty("user_agent_hash");
  });
  it("maps record_consents raises to their code with a Korean message", async () => {
    const { client } = fakeRpc({ data: null, error: { code: "P0001", message: "required_consent_missing" } });
    await expect(submitConsents(client, items, null)).rejects.toMatchObject({
      code: "required_consent_missing",
      message: "필수 항목에 모두 동의해 주세요.",
      status: 400,
    });
  });
});

describe("withdrawOptionalConsent", () => {
  it("updates only active agreed rows of the type, then re-reads status", async () => {
    const chain = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ error: null }),
    };
    const from = vi.fn().mockReturnValue(chain);
    const rpc = vi.fn().mockResolvedValue({ data: [row("marketing", false, false)], error: null });
    const { withdrawOptionalConsent } = await import("./index");
    await withdrawOptionalConsent({ from, rpc } as never, "marketing");
    expect(from).toHaveBeenCalledWith("consents");
    expect(chain.update).toHaveBeenCalledWith({ withdrawn_at: expect.any(String) });
    expect(chain.eq).toHaveBeenCalledWith("consent_type", "marketing");
    expect(chain.eq).toHaveBeenCalledWith("agreed", true);
    expect(chain.is).toHaveBeenCalledWith("withdrawn_at", null);
    expect(rpc).toHaveBeenCalledWith("get_consent_status");
  });
});
