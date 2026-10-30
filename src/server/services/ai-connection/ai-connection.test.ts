import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  isAiLocked,
  RecheckProviderKeyInput,
  RecordAiDataUseConsentInput,
  RegisterProviderKeyInput,
} from "@/lib/contracts/ai-connection";
import { FAILURE_CAUSES, KEY_STATUSES } from "@/lib/contracts/enums";
import { AiError, ProviderError } from "@/server/ai/errors";
import { mapDbError } from "@/server/db/errors";
import { toKeySecretResult, KeyReaderError, type KeySecretReader } from "@/server/db/key-reader";
import { KEY_FAILURE_CAUSES } from "@/server/jobs/provider-context";
import { encryptProviderKey, toByteaHex } from "@/server/keys/envelope";
import { createEnvelopeKeySource } from "@/server/keys/key-source";
import { EnvKms, KeyCryptoError } from "@/server/keys/kms";
import { cancelInFlightJobs, withdrawAiDataUseConsent, consentStateOf, mayRunWithConsent, type ConsentRow, type DisclosureRow } from "./consent";
import { mapRunGate } from "./keys";

const NOW = new Date("2026-11-15T00:00:00Z");
const disc = (version: string, effectiveAt: string, requiresReconsent = false): DisclosureRow => ({
  provider: "gemini",
  connection_tier: "free",
  version,
  effective_at: effectiveAt,
  requires_reconsent: requiresReconsent,
  requires_free_tier_ack: true,
  document_path: `/policies/ai/gemini/free/${version}`,
  terms_checked_at: null,
  created_at: effectiveAt,
});
const cons = (version: string, agreedAt = "2026-10-30T00:00:00Z"): ConsentRow => ({
  provider: "gemini",
  connection_tier: "free",
  disclosure_version: version,
  agreed_at: agreedAt,
  created_at: agreedAt,
});

describe("consent rules (DM 2.11.5)", () => {
  const v1 = disc("v1", "2026-10-28T00:00:00Z");

  it("R1 A20 unified state: none / other tier → needs consent; a newer version needs it only with requires_reconsent", () => {
    expect(consentStateOf([v1], [cons("v1")], "gemini", "free", NOW)).toMatchObject({ currentVersion: "v1", agreedVersion: "v1", needsConsent: false });
    expect(consentStateOf([v1], [], "gemini", "free", NOW).needsConsent).toBe(true);
    expect(consentStateOf([v1], [cons("v1")], "gemini", "paid", NOW).needsConsent).toBe(true);
    // Wording-only update (requires_reconsent false): no re-consent for saving either (was "exact current version").
    const wording = disc("v2", "2026-11-01T00:00:00Z", false);
    expect(consentStateOf([v1, wording], [cons("v1")], "gemini", "free", NOW)).toMatchObject({ currentVersion: "v2", agreedVersion: "v1", needsConsent: false });
    const v2 = disc("v2", "2026-11-01T00:00:00Z", true);
    expect(consentStateOf([v1, v2], [cons("v1")], "gemini", "free", NOW)).toMatchObject({ currentVersion: "v2", needsConsent: true });
    // Same answer as the run-time rule, for every case above.
    for (const [d, c, tier] of [
      [[v1], [cons("v1")], "free"],
      [[v1], [], "free"],
      [[v1, wording], [cons("v1")], "free"],
      [[v1, v2], [cons("v1")], "free"],
    ] as const) {
      expect(consentStateOf([...d], [...c], "gemini", tier, NOW).needsConsent).toBe(!mayRunWithConsent([...d], [...c], "gemini", tier, NOW));
    }
    // A future version isn't current yet.
    const future = disc("v3", "2027-01-01T00:00:00Z");
    expect(consentStateOf([v1, future], [cons("v1")], "gemini", "free", NOW).needsConsent).toBe(false);
    // The latest active consent counts.
    expect(consentStateOf([v1, v2], [cons("v1", "2026-10-29T00:00:00Z"), cons("v2", "2026-11-02T00:00:00Z")], "gemini", "free", NOW).needsConsent).toBe(false);
  });

  it("run-time: only a newer requires_reconsent disclosure blocks running", () => {
    const wording = disc("v2", "2026-11-01T00:00:00Z", false);
    expect(mayRunWithConsent([v1, wording], [cons("v1")], "gemini", "free", NOW)).toBe(true);
    const material = disc("v3", "2026-11-10T00:00:00Z", true);
    expect(mayRunWithConsent([v1, wording, material], [cons("v1")], "gemini", "free", NOW)).toBe(false);
    expect(mayRunWithConsent([v1, wording, material], [cons("v3")], "gemini", "free", NOW)).toBe(true);
    expect(mayRunWithConsent([v1], [], "gemini", "free", NOW)).toBe(false);
    expect(mayRunWithConsent([v1], [cons("unknown")], "gemini", "free", NOW)).toBe(false);
  });
});

describe("contracts", () => {
  it("free-tier consent needs the separate acknowledgement (F-AI-04 (3))", () => {
    expect(RecordAiDataUseConsentInput.safeParse({ provider: "gemini", connectionTier: "free", disclosureVersion: "v1" }).success).toBe(false);
    expect(
      RecordAiDataUseConsentInput.safeParse({ provider: "gemini", connectionTier: "free", disclosureVersion: "v1", freeTierAcknowledged: true }).success,
    ).toBe(true);
    expect(RecordAiDataUseConsentInput.safeParse({ provider: "openai", connectionTier: "paid", disclosureVersion: "v1" }).success).toBe(true);
  });

  it("register input bounds; tier change needs a disclosure version", () => {
    expect(RegisterProviderKeyInput.safeParse({ provider: "openai", connectionTier: "paid", apiKey: "", disclosureVersion: "v1" }).success).toBe(false);
    expect(RegisterProviderKeyInput.safeParse({ provider: "mistral", connectionTier: "paid", apiKey: "x", disclosureVersion: "v1" }).success).toBe(false);
    expect(RecheckProviderKeyInput.safeParse({ provider: "gemini", connectionTier: "paid" }).success).toBe(false);
    expect(RecheckProviderKeyInput.safeParse({ provider: "gemini" }).success).toBe(true);
  });

  it("isAiLocked (F-AI-06)", () => {
    expect(isAiLocked({ active_provider: null, key_status: null, connection_tier: null })).toBe(true);
    expect(isAiLocked({ active_provider: "gemini", key_status: "invalid", connection_tier: "free" })).toBe(true);
    expect(isAiLocked({ active_provider: "gemini", key_status: "needs_check", connection_tier: "free" })).toBe(false);
  });

  it("enum lists mirror the DB CHECKs", () => {
    expect([...KEY_STATUSES]).toEqual(["valid", "invalid", "needs_check"]);
    // private.is_key_failure_cause = failure_cause minus input_rejected
    expect([...KEY_FAILURE_CAUSES].sort()).toEqual(FAILURE_CAUSES.filter((c) => c !== "input_rejected").sort());
  });
});

describe("DB error mapping (S3b raise names)", () => {
  const p = (message: string) => mapDbError({ code: "P0001", message });
  it("maps key / consent raises to stable codes", () => {
    expect(p("consent_required")).toMatchObject({ code: "ai_consent_required", status: 409 });
    expect(p("key_not_found")).toMatchObject({ code: "key_not_found", status: 404 });
    expect(p("key_id_mismatch")).toMatchObject({ code: "conflict", status: 409 });
    expect(p("invalid_provider")).toMatchObject({ code: "invalid_input" });
    expect(p("disclosure_version_not_current")).toMatchObject({ code: "ai_disclosure_changed", status: 409 });
    expect(p("unknown_disclosure_version")).toMatchObject({ code: "ai_disclosure_changed", status: 409 });
    for (const m of ["invalid_failure_cause", "invalid_verification_result", "invalid_result_status", "invalid_key_id", "invalid_ai_job_state", "key_not_available"]) {
      expect(p(m)).toMatchObject({ code: "internal_error", status: 500 });
    }
  });
});

describe("run-time key source (app_key_reader → decrypt)", () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const keyId = "22222222-2222-4222-8222-222222222222";
  const kms = new EnvKms(randomBytes(32), "env-test-v1");
  const KEY = "sk-ant-FAKE-runtime-0000000000000000abcd";

  async function readerWith(binding: { userId: string; provider: string; keyId: string }): Promise<KeySecretReader> {
    const enc = await encryptProviderKey(KEY, binding, kms);
    return {
      getProviderKeySecret: async () => ({
        kind: "found",
        row: {
          key_id: binding.keyId,
          key_ciphertext: toByteaHex(enc.keyCiphertext),
          key_nonce: toByteaHex(enc.keyNonce),
          wrapped_dek: toByteaHex(enc.wrappedDek),
          kek_id: enc.kekId,
          encryption_version: enc.encryptionVersion,
        },
      }),
    };
  }

  it("decrypts with the job's provider bound into the AAD", async () => {
    const ks = createEnvelopeKeySource({ userId, reader: await readerWith({ userId, provider: "anthropic", keyId }), kms });
    expect(await ks.forJob("job-1", "anthropic")).toBe(KEY);
    // Wrong provider (or none) → no plaintext.
    await expect(ks.forJob("job-1", "openai")).rejects.toBeInstanceOf(KeyCryptoError);
    await expect(ks.forJob("job-1")).rejects.toMatchObject({ code: "stalled" });
  });

  it("another user's ciphertext never decrypts under this user", async () => {
    const other = "33333333-3333-4333-8333-333333333333";
    const ks = createEnvelopeKeySource({ userId, reader: await readerWith({ userId: other, provider: "anthropic", keyId }), kms });
    await expect(ks.forJob("job-1", "anthropic")).rejects.toBeInstanceOf(KeyCryptoError);
  });

  it("missing row → key_missing; refused → stalled (no provider call)", async () => {
    const missing = createEnvelopeKeySource({ userId, reader: { getProviderKeySecret: async () => ({ kind: "missing" }) }, kms });
    const err = await missing.forJob("j", "anthropic").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ code: "key_missing" });
    const refused = createEnvelopeKeySource({ userId, reader: { getProviderKeySecret: async () => ({ kind: "not_available" }) }, kms });
    const err2 = await refused.forJob("j", "anthropic").catch((e: unknown) => e);
    expect(err2).toBeInstanceOf(AiError);
    expect(err2).toMatchObject({ code: "stalled" });
  });

  it("toKeySecretResult maps the RPC answer", () => {
    expect(toKeySecretResult([], null)).toEqual({ kind: "missing" });
    expect(toKeySecretResult(null, { code: "P0001", message: "key_not_available" })).toEqual({ kind: "not_available" });
    expect(() => toKeySecretResult(null, { code: "42501", message: "permission denied" })).toThrow(KeyReaderError);
    const row = { key_id: keyId, key_ciphertext: "\\x00", key_nonce: "\\x00", wrapped_dek: "\\x00", kek_id: "k", encryption_version: 1 };
    expect(toKeySecretResult([row], null)).toEqual({ kind: "found", row });
  });
});

describe("run gate mapping (decisions 2026-10-29)", () => {
  it("null → allowed; consent_required → key_missing; key causes as themselves; unknown → error", () => {
    expect(mapRunGate(null)).toBeNull();
    expect(mapRunGate("consent_required")).toBe("key_missing");
    expect(mapRunGate("key_missing")).toBe("key_missing");
    expect(mapRunGate("key_invalid")).toBe("key_invalid");
    expect(() => mapRunGate("something_else")).toThrow();
  });
});

describe("consent withdrawal: in-flight cancel is best effort (QA-S3b-07)", () => {
  type Call = { rpc?: string; id?: string };
  /** Minimal fake of the query chain the service uses. */
  function fakeSupabase(opts: { jobs?: string[]; lookupError?: boolean; cancel: (id: string) => "ok" | "transition" | "error" | "throw" }) {
    const calls: Call[] = [];
    const chain = (result: unknown) => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "is", "update", "insert"]) c[m] = () => c;
      (c as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve(result);
      return c;
    };
    const client = {
      from(table: string) {
        if (table === "ai_jobs") {
          return chain(opts.lookupError ? { data: null, error: { code: "08006", message: "conn" } } : { data: (opts.jobs ?? []).map((id) => ({ id })), error: null });
        }
        if (table === "ai_data_use_consents") return chain({ data: [], error: null });
        if (table === "ai_disclosures") return chain({ data: [], error: null });
        throw new Error(table);
      },
      async rpc(name: string, args: { p_job_id: string }) {
        calls.push({ rpc: name, id: args.p_job_id });
        const r = opts.cancel(args.p_job_id);
        if (r === "throw") throw new TypeError("fetch failed");
        if (r === "error") return { data: null, error: { code: "08006", message: "connection lost" } };
        if (r === "transition") return { data: null, error: { code: "P0001", message: "invalid_ai_job_transition" } };
        return { data: { status: "canceled" }, error: null };
      },
    };
    return { client: client as unknown as Parameters<typeof cancelInFlightJobs>[0], calls };
  }

  it("keeps going past a failed cancel, logs it, and never throws", async () => {
    const logs: { event: string; fields: Record<string, unknown> }[] = [];
    const f = fakeSupabase({ jobs: ["a", "b", "c", "d"], cancel: (id) => (id === "a" ? "error" : id === "b" ? "throw" : id === "c" ? "transition" : "ok") });
    const r = await cancelInFlightJobs(f.client, "gemini", "free", (event, fields) => logs.push({ event, fields }));
    expect(r).toEqual({ requested: 2, failed: 2 });
    expect(f.calls.map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
    expect(logs.map((l) => [l.event, l.fields.jobId, l.fields.dbCode])).toEqual([
      ["ai_consent.cancel_failed", "a", "08006"],
      ["ai_consent.cancel_failed", "b", "unknown"],
    ]);
  });

  it("a failed job lookup is logged, not thrown", async () => {
    const logs: string[] = [];
    const f = fakeSupabase({ lookupError: true, cancel: () => "ok" });
    expect(await cancelInFlightJobs(f.client, "gemini", "free", (e) => logs.push(e))).toEqual({ requested: 0, failed: 1 });
    expect(logs).toEqual(["ai_consent.cancel_lookup_failed"]);
  });

  it("withdrawal succeeds even when every cancel fails (the run gate still blocks the next step)", async () => {
    const logs: string[] = [];
    const f = fakeSupabase({ jobs: ["a"], cancel: () => "throw" });
    const state = await withdrawAiDataUseConsent(f.client, { provider: "gemini", connectionTier: "free" }, (e) => logs.push(e));
    expect(state).toMatchObject({ connectionTier: "free", needsConsent: true });
    expect(logs).toEqual(["ai_consent.cancel_failed"]);
  });
});
