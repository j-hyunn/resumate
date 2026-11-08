import { describe, expect, it } from "vitest";
import { SignInWithGoogleInput } from "./auth";
import { SubmitConsentsInput, WithdrawConsentInput } from "./consent";
import { CONSENT_TYPES, OPTIONAL_CONSENT_TYPES, REQUIRED_CONSENT_TYPES } from "./enums";
import { UpdateProfileInput } from "./profile";

describe("enums", () => {
  it("required + optional + cross_border_transfer = all consent types", () => {
    expect([...REQUIRED_CONSENT_TYPES, ...OPTIONAL_CONSENT_TYPES, "cross_border_transfer"].sort()).toEqual([...CONSENT_TYPES].sort());
  });
  it("sign-up requires only terms and privacy_required (F-COM-02, D-39)", () => {
    expect([...REQUIRED_CONSENT_TYPES]).toEqual(["terms", "privacy_required"]);
  });
});

describe("SignInWithGoogleInput", () => {
  it("allows an empty object", () => {
    expect(SignInWithGoogleInput.parse({})).toEqual({});
  });
});

const allRequired = REQUIRED_CONSENT_TYPES.map((consentType) => ({ consentType, agreed: true }));

describe("SubmitConsentsInput", () => {
  it("accepts all required agreed + optional declined", () => {
    const r = SubmitConsentsInput.safeParse({ items: [...allRequired, { consentType: "marketing", agreed: false }] });
    expect(r.success).toBe(true);
  });
  it("allows sending only some required types (re-consent); the RPC checks the rest", () => {
    expect(SubmitConsentsInput.safeParse({ items: allRequired.slice(1) }).success).toBe(true);
  });
  it("rejects a required consent with agreed=false", () => {
    const items = allRequired.map((i, idx) => (idx === 0 ? { ...i, agreed: false } : i));
    expect(SubmitConsentsInput.safeParse({ items }).success).toBe(false);
  });
  it("rejects duplicates", () => {
    expect(SubmitConsentsInput.safeParse({ items: [...allRequired, allRequired[0]] }).success).toBe(false);
  });
  it("rejects unknown types and client-sent versions are stripped", () => {
    expect(SubmitConsentsInput.safeParse({ items: [...allRequired, { consentType: "x", agreed: true }] }).success).toBe(false);
    const parsed = SubmitConsentsInput.parse({ items: allRequired.map((i) => ({ ...i, policyVersion: "1999" })) });
    expect(parsed.items[0]).not.toHaveProperty("policyVersion");
  });
});

describe("UpdateProfileInput (R13: display_name only)", () => {
  it("turns empty strings into null", () => {
    expect(UpdateProfileInput.parse({ displayName: "  " })).toEqual({ displayName: null });
    expect(UpdateProfileInput.parse({ displayName: " 홍길동 " })).toEqual({ displayName: "홍길동" });
  });
  it("enforces the DM A.1 limit (50자) and refuses the dropped columns' keys silently", () => {
    expect(UpdateProfileInput.safeParse({ displayName: "a".repeat(51) }).success).toBe(false);
    expect(UpdateProfileInput.safeParse({ displayName: "a".repeat(50) }).success).toBe(true);
    // 삭제된 컬럼(DM 2.1.1): 보내도 통과하지 않는다 — 키가 없으면 displayName 누락으로 거부된다.
    expect(UpdateProfileInput.safeParse({ desiredJobTitle: "PM" }).success).toBe(false);
    expect(UpdateProfileInput.safeParse({ totalYearsOfExperience: 3 }).success).toBe(false);
  });
  it("rejects an empty patch", () => {
    expect(UpdateProfileInput.safeParse({}).success).toBe(false);
  });
});

describe("WithdrawConsentInput", () => {
  it("accepts optional types only", () => {
    expect(WithdrawConsentInput.safeParse({ consentType: "marketing" }).success).toBe(true);
    expect(WithdrawConsentInput.safeParse({ consentType: "terms" }).success).toBe(false);
  });
});
