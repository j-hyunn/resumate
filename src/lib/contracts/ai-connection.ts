import { z } from "zod";
import { AI_ERROR_MESSAGES } from "./ai";
import {
  AI_PROVIDERS,
  CONNECTION_TIERS,
  FAILURE_CAUSES,
  KEY_STATUSES,
  type AiErrorCode,
  type AiProvider,
  type ConnectionTier,
  type FailureCause,
  type KeyStatus,
} from "./enums";

/**
 * AI connection (BYOK) contracts — S-40 AI 연결, S-41 키 연결 단계
 * (F-AI-01~05, F-AI-09, DM §2.11, AI C-10.5 / C-11, NFR-KEY-01/05).
 *
 * NFR-KEY-01/05: no response type in this file has a field that can carry an
 * API key. The key travels only in `RegisterProviderKeyInput.apiKey`
 * (browser → server, once) and the server answers with the last 4 characters.
 */

const provider = z.enum(AI_PROVIDERS);
const connectionTier = z.enum(CONNECTION_TIERS);
const disclosureVersion = z.string().trim().min(1).max(64);

// ---------------- inputs ----------------

/** S-41 ③ register or replace (F-AI-01, F-AI-02 (1)). The key is never echoed back. */
export const RegisterProviderKeyInput = z.object({
  provider,
  connectionTier,
  /** Plaintext key (password field). Length bounds only; format is checked per provider in the service. */
  apiKey: z.string().min(1).max(1024),
  /** The disclosure version the user agreed to in step ② (must still be current). */
  disclosureVersion,
});
export type RegisterProviderKeyInput = z.input<typeof RegisterProviderKeyInput>;

/**
 * S-40 "다시 확인" (F-AI-02 (2)) — or "등급 변경" when `connectionTier` differs
 * from the stored tier: the stored key is verified again and saved under the
 * new tier (consent for the new tier first, C-21).
 */
export const RecheckProviderKeyInput = z
  .object({
    provider,
    connectionTier: connectionTier.optional(),
    disclosureVersion: disclosureVersion.optional(),
  })
  .refine((v) => !v.connectionTier || v.disclosureVersion, {
    message: "disclosureVersion is required with connectionTier",
    path: ["disclosureVersion"],
  });
export type RecheckProviderKeyInput = z.input<typeof RecheckProviderKeyInput>;

export const ProviderInput = z.object({ provider });
export type ProviderInput = z.input<typeof ProviderInput>;

export const ProviderTierInput = z.object({ provider, connectionTier });
export type ProviderTierInput = z.input<typeof ProviderTierInput>;

/** S-41 ② / C-21 consent (F-AI-04). Free tier needs the separate acknowledgement (F-AI-04 (3)). */
export const RecordAiDataUseConsentInput = z
  .object({
    provider,
    connectionTier,
    disclosureVersion,
    freeTierAcknowledged: z.boolean().default(false),
  })
  .refine((v) => v.connectionTier !== "free" || v.freeTierAcknowledged, {
    message: "free tier requires the separate acknowledgement",
    path: ["freeTierAcknowledged"],
  });
export type RecordAiDataUseConsentInput = z.input<typeof RecordAiDataUseConsentInput>;

// ---------------- read models ----------------

/** ai_provider_keys_public row (camelCase) + whether it is the active provider. No ciphertext column exists here. */
export const ProviderKeyMetaSchema = z.object({
  id: z.guid(),
  provider,
  connectionTier,
  /** "••••{keyLast4}" on screen. */
  keyLast4: z.string().length(4),
  status: z.enum(KEY_STATUSES),
  lastVerifiedAt: z.string().nullable(),
  lastFailureCause: z.enum(FAILURE_CAUSES).nullable(),
  lastFailureAt: z.string().nullable(),
  isActive: z.boolean(),
});
export type ProviderKeyMeta = z.infer<typeof ProviderKeyMetaSchema>;

/** ai_providers row (DM 2.11.6). */
export type AiProviderInfo = {
  provider: AiProvider;
  displayOrder: number;
  /** D-38: false = "일시 중지" (no new connection or replacement). */
  isAvailable: boolean;
  isRecommended: boolean;
  dashboardUrl: string | null;
  billingUrl: string | null;
  keyGuideVersion: string | null;
  keyGuideCheckedAt: string | null;
};

/** ai_disclosures row (DM 2.11.6) — the version currently in effect. */
export type AiDisclosure = {
  provider: AiProvider;
  connectionTier: ConnectionTier;
  version: string;
  effectiveAt: string;
  requiresReconsent: boolean;
  requiresFreeTierAck: boolean;
  /** Full text page (S-41 ② / C-21 "전문 보기"). */
  documentPath: string;
  termsCheckedAt: string | null;
};

/** Consent state of one provider × tier (DM 2.11.5 재동의 판정). */
export type AiConsentState = {
  connectionTier: ConnectionTier;
  /** Current disclosure version; null when none is in effect (connection impossible). */
  currentVersion: string | null;
  /** Version of the latest active (not withdrawn) consent; null when none. */
  agreedVersion: string | null;
  agreedAt: string | null;
  /** True when a key can't be saved for this tier without (re)consent. */
  needsConsent: boolean;
};

export type AiProviderConnection = {
  info: AiProviderInfo;
  key: ProviderKeyMeta | null;
  consents: Record<ConnectionTier, AiConsentState>;
  /** queued + running AI jobs on this provider (S-40 키 삭제 대화상자 "진행 중인 AI 작업 N건"). */
  inFlightJobs: number;
};

/** `getAiConnection()` — everything S-40 shows. Providers in display order (Gemini first, UB-4). */
export type AiConnection = {
  activeProvider: AiProvider | null;
  providers: AiProviderConnection[];
  /** Keys exist but none is active (the active key was deleted, F-AI-02 (3)): "사용할 공급자를 골라 주세요". */
  needsActiveSelection: boolean;
};

// ---------------- key verification results ----------------

/**
 * Outcome of register / replace / re-check (C-10.5, R-38):
 * - `valid`: both steps passed → saved (or re-checked) as `valid`.
 * - `limited`: authenticated, step 2 hit rate_limited / daily_quota_exhausted /
 *   provider_unavailable → saved as `needs_check` (S-41 "확인 보류").
 * - `rejected`: not saved (key_invalid / billing_required / model_not_available,
 *   or step-1 outage, or a format error). A replacement keeps the old key.
 */
export const KEY_CHECK_RESULTS = ["valid", "limited", "rejected"] as const;
export type KeyCheckResult = (typeof KEY_CHECK_RESULTS)[number];

export type KeyCheckOutcome = {
  result: KeyCheckResult;
  /** `format`: refused before any provider call (S-41 "{공급자} 키 형식이 아니에요"). */
  reason: "format" | "verification" | null;
  /** True when ai_provider_keys was written (register, replace, tier change). */
  saved: boolean;
  /** Key metadata after this action (null when nothing is stored for the provider). */
  key: ProviderKeyMeta | null;
  /** True when this registration made the provider active (F-AI-01 (5) "활성 공급자로 지정했어요"). */
  becameActive: boolean;
  errorCode: AiErrorCode | null;
  failureCause: FailureCause | null;
  /** Korean message for the error (null on valid). */
  message: string | null;
  /** rate_limited: "이 시각 이후 다시 시도" (ISO). */
  retryAfter: string | null;
  /** daily_quota_exhausted: provider reset time (ISO, shown in KST). */
  quotaResetsAt: string | null;
  /** The key_verification job (meter "연결 확인"); null when no job was created (format error). */
  jobId: string | null;
};

export const KEY_FORMAT_MESSAGE: Record<AiProvider, string> = {
  openai: "OpenAI 키 형식이 아니에요. 키를 다시 붙여넣어 주세요.",
  gemini: "Google Gemini 키 형식이 아니에요. 키를 다시 붙여넣어 주세요.",
  anthropic: "Anthropic Claude 키 형식이 아니에요. 키를 다시 붙여넣어 주세요.",
};

/** Korean message for a verification error code (C-11 copy shared with job errors). */
export function keyCheckMessage(code: AiErrorCode | null): string | null {
  return code ? AI_ERROR_MESSAGES[code] : null;
}

// ---------------- readiness (DM §6 v4) ----------------

/** `get_data_readiness().ai_connection` (DM §6 v4): S-xx AI entry points lock on this (F-AI-06). */
export const ReadinessAiConnection = z.object({
  active_provider: provider.nullable(),
  key_status: z.enum(KEY_STATUSES).nullable(),
  connection_tier: connectionTier.nullable(),
  /**
   * R3 (R-67, DM §6 `ai_connection.consent_required`): true when the active provider's
   * (provider, active key tier) needs a data-use consent under the 2.11.5 re-consent rule
   * (`private.ai_consent_allows_run`, same check as `check_ai_run_allowed` / `retry_ai_job`).
   * null when there is no active provider or key. Required + nullable: the RPC always sends it.
   * Does not feed `isAiLocked` — screens open C-21 before running instead of locking.
   */
  consent_required: z.boolean().nullable(),
});
export type ReadinessAiConnection = z.infer<typeof ReadinessAiConnection>;

/** True when AI features are locked (F-AI-06): no active provider or its key is invalid. */
export function isAiLocked(c: ReadinessAiConnection): boolean {
  return c.active_provider === null || c.key_status === null || c.key_status === "invalid";
}

export type { KeyStatus };
