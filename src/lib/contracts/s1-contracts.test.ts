import { describe, expect, it } from "vitest";
import { SendMagicLinkInput, SignInWithGoogleInput } from "./auth";
import { SubmitConsentsInput, WithdrawConsentInput } from "./consent";
import { CONSENT_TYPES, OPTIONAL_CONSENT_TYPES, REQUIRED_CONSENT_TYPES } from "./enums";
import { UpdateProfileInput } from "./profile";

describe("enums", () => {
  it("required + optional = all consent types", () => {
    expect([...REQUIRED_CONSENT_TYPES, ...OPTIONAL_CONSENT_TYPES].sort()).toEqual([...CONSENT_TYPES].sort());
  });
});

describe("SendMagicLinkInput", () => {
  it("trims and lowercases the email", () => {
    expect(SendMagicLinkInput.parse({ email: "  User@Example.COM " })).toEqual({ email: "user@example.com" });
  });
  it("rejects a non-email", () => {
    expect(SendMagicLinkInput.safeParse({ email: "nope" }).success).toBe(false);
  });
  it("accepts next", () => {
    expect(SendMagicLinkInput.parse({ email: "a@b.co", next: "/board" }).next).toBe("/board");
  });
  it("Google input allows an empty object", () => {
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

describe("UpdateProfileInput", () => {
  it("turns empty strings into null and keeps omitted keys omitted", () => {
    expect(UpdateProfileInput.parse({ displayName: "  ", desiredJobTitle: "PM" })).toEqual({
      displayName: null,
      desiredJobTitle: "PM",
    });
  });
  it("enforces DM A.1 limits", () => {
    expect(UpdateProfileInput.safeParse({ displayName: "a".repeat(51) }).success).toBe(false);
    expect(UpdateProfileInput.safeParse({ desiredJobTitle: "a".repeat(101) }).success).toBe(false);
    expect(UpdateProfileInput.safeParse({ totalYearsOfExperience: 51 }).success).toBe(false);
    expect(UpdateProfileInput.safeParse({ totalYearsOfExperience: 1.5 }).success).toBe(false);
    expect(UpdateProfileInput.safeParse({ totalYearsOfExperience: 0 }).success).toBe(true);
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
