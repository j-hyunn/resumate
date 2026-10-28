"use server";

import {
  ProviderInput,
  ProviderTierInput,
  RecheckProviderKeyInput,
  RecordAiDataUseConsentInput,
  RegisterProviderKeyInput,
  type AiConnection,
  type AiConsentState,
  type AiDisclosure,
  type KeyCheckOutcome,
} from "@/lib/contracts/ai-connection";
import { invalid, runAction, type ActionResult } from "@/lib/contracts/errors";
import { requireConsentedUser } from "@/server/auth/session";
import { createKeyVerificationDeps } from "@/server/keys/app";
import * as consent from "@/server/services/ai-connection/consent";
import * as keys from "@/server/services/ai-connection/keys";
import * as verification from "@/server/services/ai-connection/verification";

/**
 * AI connection Server Actions (S-40, S-41; F-AI-01~05; DM §2.11).
 * Thin: auth → validate → service. NFR-KEY-01/05: the API key is accepted
 * only by `registerProviderKey` and never appears in any result or error —
 * results carry `keyLast4` only.
 */

/** S-40: providers, key metadata, active provider, consent state per tier, in-flight jobs. */
export async function getAiConnection(): Promise<ActionResult<AiConnection>> {
  return runAction(async () => {
    const { supabase, user } = await requireConsentedUser();
    return keys.getAiConnection(supabase, user.id);
  });
}

/** S-41 ② / C-21: the disclosure currently in effect for provider × tier. */
export async function getAiDisclosure(input: unknown): Promise<ActionResult<AiDisclosure>> {
  const parsed = ProviderTierInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return consent.getAiDisclosure(supabase, parsed.data.provider, parsed.data.connectionTier);
  });
}

/** S-41 ② consent (F-AI-04). 409 `ai_disclosure_changed` when the disclosure changed meanwhile. */
export async function recordAiDataUseConsent(input: unknown): Promise<ActionResult<AiConsentState>> {
  const parsed = RecordAiDataUseConsentInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return consent.recordAiDataUseConsent(supabase, parsed.data);
  });
}

/** S-40: withdraw the consent of provider × tier (AI runs on it need consent again). */
export async function withdrawAiDataUseConsent(input: unknown): Promise<ActionResult<AiConsentState>> {
  const parsed = ProviderTierInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase } = await requireConsentedUser();
    return consent.withdrawAiDataUseConsent(supabase, parsed.data);
  });
}

/**
 * S-41 ③ register or replace (F-AI-01, F-AI-02 (1)): verify (C-10.5) → save
 * encrypted when valid / limited (R-38). Errors: 409 `ai_consent_required`,
 * 409 `ai_provider_paused`, 409 `key_verification_in_progress`.
 */
export async function registerProviderKey(input: unknown): Promise<ActionResult<KeyCheckOutcome>> {
  const parsed = RegisterProviderKeyInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase, user } = await requireConsentedUser();
    return verification.registerProviderKey(createKeyVerificationDeps(supabase, user.id), parsed.data);
  });
}

/** S-40 "다시 확인" (F-AI-02 (2)), or "등급 변경" with `connectionTier` + `disclosureVersion`. */
export async function recheckProviderKey(input: unknown): Promise<ActionResult<KeyCheckOutcome>> {
  const parsed = RecheckProviderKeyInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase, user } = await requireConsentedUser();
    return verification.recheckProviderKey(createKeyVerificationDeps(supabase, user.id), parsed.data);
  });
}

/** S-40 키 삭제 (F-AI-02 (3), NFR-KEY-06): immediate hard delete; consents withdrawn; no auto switch. */
export async function deleteProviderKey(input: unknown): Promise<ActionResult<AiConnection>> {
  const parsed = ProviderInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase, user } = await requireConsentedUser();
    await keys.deleteProviderKey(supabase, parsed.data.provider);
    return keys.getAiConnection(supabase, user.id);
  });
}

/** S-40 활성 공급자 (F-AI-03). 409 `ai_consent_required` when the key's tier needs (re)consent. */
export async function setActiveAiProvider(input: unknown): Promise<ActionResult<AiConnection>> {
  const parsed = ProviderInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { supabase, user } = await requireConsentedUser();
    return keys.setActiveAiProvider(supabase, user.id, parsed.data.provider);
  });
}
