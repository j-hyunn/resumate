import { z } from "zod";
import { CONSENT_TYPES, OPTIONAL_CONSENT_TYPES, REQUIRED_CONSENT_TYPES, type ConsentType } from "./enums";

/** F-COM-02 consent (S-03), RPCs `get_consent_status` / `record_consents` (DM A.2). */

/** One row of `get_consent_status()`. */
export type ConsentStatusItem = {
  consentType: ConsentType;
  required: boolean;
  /** Latest effective policy version for this consent type; null if none is effective yet. */
  currentVersion: string | null;
  /** Version the user last agreed to (not withdrawn), or null. */
  agreedVersion: string | null;
  needsConsent: boolean;
};

export type ConsentStatus = {
  items: ConsentStatusItem[];
  /** True when any required consent needs (re)consent — the S-03 gate. */
  needsRequiredConsent: boolean;
};

export const ConsentItemInput = z.object({
  consentType: z.enum(CONSENT_TYPES),
  agreed: z.boolean(),
});

/**
 * The client sends only type + agreed. Policy versions are filled by the
 * server (`record_consents`), never trusted from the client.
 */
export const SubmitConsentsInput = z
  .object({
    items: z.array(ConsentItemInput).min(1).max(CONSENT_TYPES.length),
  })
  .refine((v) => new Set(v.items.map((i) => i.consentType)).size === v.items.length, {
    message: "duplicate consent type",
    path: ["items"],
  })
  // A required type that is sent must be agreed. Not every required type has to be
  // sent: on re-consent the client may send only the types that need it. Whether
  // any required consent is still missing afterwards is checked by record_consents.
  .refine(
    (v) => v.items.every((i) => !(REQUIRED_CONSENT_TYPES as readonly string[]).includes(i.consentType) || i.agreed),
    { message: "required consents must be agreed", path: ["items"] },
  );
export type SubmitConsentsInput = z.input<typeof SubmitConsentsInput>;

export type SubmitConsentsResult = {
  status: ConsentStatus;
  /** Where the client goes next (same-origin path, default S-08). */
  redirectTo: string;
};

/** S-24: withdraw an optional consent (DM A.2 — required consents can't be withdrawn). */
export const WithdrawConsentInput = z.object({
  consentType: z.enum(OPTIONAL_CONSENT_TYPES),
});
export type WithdrawConsentInput = z.input<typeof WithdrawConsentInput>;
