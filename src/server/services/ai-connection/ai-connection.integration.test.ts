import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { KeyCheckOutcome } from "@/lib/contracts/ai-connection";
import type { AiErrorCode, AiProvider } from "@/lib/contracts/enums";
import { AppError } from "@/lib/contracts/errors";
import { ProviderError } from "@/server/ai/errors";
import { createLlm, verifyProviderKey, type Llm } from "@/server/ai/llm";
import { silentAiLogger } from "@/server/ai/log";
import type { ProviderAdapter, ProviderVerifyOutcome } from "@/server/ai/providers/types";
import { createAiWriterClient } from "@/server/db/ai-writer";
import type { Database } from "@/server/db/database.types";
import { createKeySecretReader } from "@/server/db/key-reader";
import { resetServerEnvCache } from "@/server/env";
import { createJobRunner } from "@/server/jobs/runner";
import { createSupabaseJobStore } from "@/server/jobs/supabase-store";
import { createSupabaseUsageStore } from "@/server/jobs/supabase-usage";
import type { JobStep, JobTypeDefinition } from "@/server/jobs/types";
import { createEnvelopeKeySource } from "@/server/keys/key-source";
import { EnvKms } from "@/server/keys/kms";
import { createScriptedAdapter, type ScriptedResponse } from "@/test/job-fakes";
import { hasTable, isStackReady, readLocalSupabase } from "@/test/local-supabase";
import { getAiDisclosure, recordAiDataUseConsent, withdrawAiDataUseConsent } from "./consent";
import { createDbKeyStatusReporter, createDbProviderContextSource, createDbRunGate, deleteProviderKey, getAiConnection, setActiveAiProvider } from "./keys";
import { recheckProviderKey, registerProviderKey, type KeyVerificationDeps } from "./verification";

/**
 * S3b end-to-end against the local Supabase stack: consent → register (fake
 * verify adapter through the real verifyProviderKey) → encrypted row →
 * AI job reads the key through app_key_reader / get_provider_key_secret →
 * decrypt → delete key → next step fails key_missing. Plus R-38 save rules,
 * replacement, re-check, tier change, needs_check → valid, and a leak scan
 * (no fake key in any row, response, error, or log). Fake keys only; no
 * provider call. Skips when the stack isn't running or S3b isn't migrated.
 */

const stack = readLocalSupabase();
const ready = stack ? (await isStackReady(stack)) && (await hasTable(stack, "ai_disclosures")) : false;

// Fake keys only. The distinctive middle part is what the leak scan looks for.
const fakeKey = (provider: AiProvider, tag: string) => {
  const body = `FAKE${tag}SECRETMIDDLE${randomBytes(6).toString("hex")}`;
  return provider === "gemini" ? `AIza${body}` : provider === "anthropic" ? `sk-ant-${body}` : `sk-${body}`;
};
const secretPart = (key: string) => key.slice(0, -4);

const OK_USAGE = {
  inputTokens: 8,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 1,
  reasoningTokens: null,
  usageSource: "provider_reported" as const,
};

type VerifyScript = { ok: true } | { stage: 1 | 2; code: AiErrorCode; quotaResetsAt?: Date };

describe.skipIf(!ready)("AI connection / BYOK keys (local stack)", () => {
  const s = stack!;
  let admin: SupabaseClient<Database>;
  let user: SupabaseClient<Database>;
  let userId = "";
  const kms = new EnvKms(randomBytes(32), "env-test-v1");
  const verifyScript: VerifyScript[] = [];
  const verifiedKeys: string[] = [];
  const usedKeys: string[] = [];
  const logs: string[] = [];
  const outputs: unknown[] = [];

  const verifyAdapter = (provider: AiProvider): ProviderAdapter => ({
    ...createScriptedAdapter(provider, [], Date.now).adapter,
    async verify(req): Promise<ProviderVerifyOutcome> {
      verifiedKeys.push(req.apiKey);
      const next = verifyScript.shift();
      if (!next) throw new Error("no verify script");
      if ("ok" in next) return { ok: true, usage: OK_USAGE };
      return {
        ok: false,
        stage: next.stage,
        error: new ProviderError(next.code, { provider, quotaResetsAt: next.quotaResetsAt }),
        usage: next.stage === 2 ? OK_USAGE : null,
      };
    },
  });

  function deps(): KeyVerificationDeps {
    const writer = createAiWriterClient(userId);
    return {
      supabase: user,
      userId,
      // R1 A19: the server-only key RPCs run on service_role with p_user_id.
      keyRpc: () => admin,
      store: createSupabaseJobStore(writer),
      usage: createSupabaseUsageStore(writer),
      kms: () => kms,
      keySource: createEnvelopeKeySource({ userId, reader: createKeySecretReader(userId), kms }),
      verify: ({ provider, apiKey, signal }) =>
        verifyProviderKey({ provider, apiKey, signal, adapters: { [provider]: verifyAdapter(provider) } }),
      log: (event, fields) => logs.push(JSON.stringify({ event, ...fields })),
    };
  }

  async function run<T>(p: Promise<T>): Promise<T> {
    const v = await p;
    outputs.push(v);
    return v;
  }

  async function consent(provider: AiProvider, tier: "free" | "paid") {
    const d = await getAiDisclosure(user, provider, tier);
    await recordAiDataUseConsent(user, { provider, connectionTier: tier, disclosureVersion: d.version, freeTierAcknowledged: tier === "free" });
    return d.version;
  }

  /** Key metadata through the screen view (no role — not even service_role — can select the ciphertext). */
  async function keyRow(provider: AiProvider) {
    const { data, error } = await user.from("ai_provider_keys_public").select("*").eq("provider", provider).maybeSingle();
    if (error) throw new Error(error.code);
    return data;
  }

  async function verificationJobs() {
    const { data } = await admin.from("ai_jobs").select("*").eq("user_id", userId).eq("job_type", "key_verification").order("created_at");
    return data ?? [];
  }

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", s.url);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", s.anonKey);
    vi.stubEnv("SUPABASE_JWT_SECRET", s.jwtSecret);
    vi.stubEnv("CRON_SECRET", "test-cron-secret-0000");
    resetServerEnvCache();
    verifyScript.length = 0;
    for (const m of ["info", "warn", "error", "log"] as const) {
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(" ")));
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeAll(async () => {
    admin = createClient<Database>(s.url, s.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const email = `byok-${crypto.randomUUID()}@example.test`;
    const password = `pw-${crypto.randomUUID()}`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.code}`);
    userId = data.user.id;
    user = createClient<Database>(s.url, s.anonKey, { auth: { persistSession: false } });
    const signIn = await user.auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error(`signIn failed: ${signIn.error.code}`);
  });

  afterAll(async () => {
    if (userId) {
      await admin.from("ai_jobs").delete().eq("user_id", userId);
      await admin.auth.admin.deleteUser(userId); // cascades keys, consents, usage rows
    }
    resetServerEnvCache();
  });

  it("refuses to register without a current consent (no job, no provider call)", async () => {
    await expect(
      registerProviderKey(deps(), { provider: "anthropic", connectionTier: "paid", apiKey: fakeKey("anthropic", "A"), disclosureVersion: "v2026-10-29" }),
    ).rejects.toMatchObject({ code: "ai_consent_required", status: 409 });
    expect(verifiedKeys).toHaveLength(0);
    expect(await verificationJobs()).toHaveLength(0);
  });

  it("R1 A19: the browser's user session can't call the key RPCs (service_role only)", async () => {
    const save = await user.rpc("save_provider_key", {
      p_user_id: userId,
      p_provider: "anthropic",
      p_connection_tier: "paid",
      p_key_ciphertext: "\\x00",
      p_key_nonce: "\\x00",
      p_wrapped_dek: "\\x00",
      p_kek_id: "k",
      p_key_last4: "0000",
      p_disclosure_version: "v2026-10-29",
      p_verification_result: "valid",
      p_key_id: crypto.randomUUID(),
    });
    expect(save.error?.code).toBe("42501");
    const check = await user.rpc("record_provider_key_check", { p_user_id: userId, p_provider: "anthropic", p_result_status: "valid" });
    expect(check.error?.code).toBe("42501");
  });

  it("format error: rejected before any provider call, no job", async () => {
    const version = await consent("anthropic", "paid");
    const r = await run(registerProviderKey(deps(), { provider: "anthropic", connectionTier: "paid", apiKey: "AIzaNOTANTHROPIC000000000000", disclosureVersion: version }));
    expect(r).toMatchObject({ result: "rejected", reason: "format", saved: false, jobId: null, errorCode: "key_invalid" });
    expect(r.message).toContain("형식");
    expect(verifiedKeys).toHaveLength(0);
  });

  it.each<[string, VerifyScript, AiErrorCode]>([
    ["key_invalid (stage 1)", { stage: 1, code: "key_invalid" }, "key_invalid"],
    ["model_not_available (stage 1)", { stage: 1, code: "model_not_available" }, "model_not_available"],
    ["billing_required (stage 2)", { stage: 2, code: "billing_required" }, "billing_required"],
    ["provider_unavailable (stage 1)", { stage: 1, code: "provider_unavailable" }, "provider_unavailable"],
  ])("R-38 not saved: %s", async (_name, script, code) => {
    const version = await consent("anthropic", "paid");
    verifyScript.push(script);
    const r = await run(registerProviderKey(deps(), { provider: "anthropic", connectionTier: "paid", apiKey: fakeKey("anthropic", "R"), disclosureVersion: version }));
    expect(r).toMatchObject({ result: "rejected", reason: "verification", saved: false, key: null, errorCode: code });
    expect(await keyRow("anthropic")).toBeNull();
    const job = (await verificationJobs()).at(-1)!;
    expect(job).toMatchObject({ status: "failed", error_code: code, target_type: "ai_provider", provider: "anthropic" });
    const { data: usage } = await admin.from("ai_usage_records").select("*").eq("ai_job_id", job.id);
    // Step-2 generation is recorded (meter "연결 확인"); step-1 model listing isn't.
    expect(usage ?? []).toHaveLength("stage" in script && script.stage === 2 ? 1 : 0);
  });

  it("register valid: encrypted row, first key becomes active, last 4 only, usage row key_verification", async () => {
    const version = await consent("anthropic", "paid");
    const key = fakeKey("anthropic", "V");
    verifyScript.push({ ok: true });
    const r = await run(registerProviderKey(deps(), { provider: "anthropic", connectionTier: "paid", apiKey: key, disclosureVersion: version }));
    expect(r).toMatchObject({ result: "valid", saved: true, becameActive: true, errorCode: null });
    expect(r.key).toMatchObject({ provider: "anthropic", connectionTier: "paid", keyLast4: key.slice(-4), status: "valid", isActive: true });
    expect(verifiedKeys.at(-1)).toBe(key);

    const row = (await keyRow("anthropic"))!;
    expect(row.id).toBe(r.key!.id);
    expect(row.key_last4).toBe(key.slice(-4));
    // Ciphertext columns: no grant for any role, including the operator's service role (NFR-KEY-07).
    const asAdmin = await admin.from("ai_provider_keys").select("key_ciphertext");
    expect(asAdmin.error).not.toBeNull();

    const job = (await verificationJobs()).at(-1)!;
    expect(job).toMatchObject({ status: "succeeded", job_type: "key_verification", connection_tier: "paid" });
    const { data: usage } = await admin.from("ai_usage_records").select("*").eq("ai_job_id", job.id);
    expect(usage).toHaveLength(1);
    expect(usage![0]).toMatchObject({ feature: "key_verification", job_type: "key_verification", outcome: "succeeded", provider: "anthropic" });

    // Neither the user session nor app_ai_writer can read ciphertext columns (DM 2.11.1).
    const asUser = await user.from("ai_provider_keys").select("key_ciphertext");
    expect(asUser.error?.code).toBe("42501");
    const asWriter = await createAiWriterClient(userId).from("ai_provider_keys").select("key_ciphertext");
    expect(asWriter.error).not.toBeNull();
  });

  it("replacement that fails verification keeps the old key unchanged (F-AI-02 (1))", async () => {
    const before = (await keyRow("anthropic"))!;
    const version = await consent("anthropic", "paid");
    verifyScript.push({ stage: 1, code: "key_invalid" });
    const r = await run(registerProviderKey(deps(), { provider: "anthropic", connectionTier: "paid", apiKey: fakeKey("anthropic", "BAD"), disclosureVersion: version }));
    expect(r).toMatchObject({ result: "rejected", saved: false });
    expect(r.key).toMatchObject({ id: before.id, keyLast4: before.key_last4, status: "valid" });
    const after = (await keyRow("anthropic"))!;
    expect(after).toEqual(before); // untouched: same last4, status, updated_at

  });

  it("AI job decrypts the key via get_provider_key_secret; deleting the key makes the next step fail key_missing", async () => {
    // Replace with a known key first (same row id → AAD still bound).
    const before = (await keyRow("anthropic"))!;
    const version = await consent("anthropic", "paid");
    const key = fakeKey("anthropic", "RUN");
    verifyScript.push({ ok: true });
    const replaced = await run(registerProviderKey(deps(), { provider: "anthropic", connectionTier: "paid", apiKey: key, disclosureVersion: version }));
    expect(replaced.key!.id).toBe(before.id);

    const scripted = createScriptedAdapter("anthropic", [{ json: { a: 1 } }, { json: { b: 2 } }] as ScriptedResponse[], Date.now);
    const step = (stage: string, after?: () => Promise<void>): JobStep<Llm> => ({
      stage,
      run: async (ctx) => {
        const res = await ctx.llm.complete({
          feature: "TEST",
          promptVersion: "test.v1",
          callKey: `${ctx.callKeyPrefix}.1`,
          systemBlocks: [{ text: "s" }],
          userBlocks: [{ text: "u" }],
          outputSchema: null,
          signal: ctx.signal,
        });
        await after?.();
        return JSON.parse(res.text) as unknown;
      },
    });
    const def: JobTypeDefinition<Llm> = {
      jobType: "insight",
      steps: [step("match", async () => void (await deleteProviderKey(user, "anthropic"))), step("synthesize")],
    };
    const scheduled: (() => Promise<void>)[] = [];
    const runner = createJobRunner<Llm>({
      forUser: (uid) => {
        const db = createAiWriterClient(uid);
        return {
          db,
          store: createSupabaseJobStore(db),
          usage: createSupabaseUsageStore(db),
          keySource: createEnvelopeKeySource({ userId: uid, reader: createKeySecretReader(uid), kms }),
          keyStatus: createDbKeyStatusReporter(db),
        };
      },
      providerContext: createDbProviderContextSource(async () => user),
      createLlm: (input) => {
        const llm = createLlm({ ...input, logger: silentAiLogger, adapters: { anthropic: scripted.adapter } });
        return llm;
      },
      settleLlm: (llm, t) => llm.settle(t),
      getDefinition: (t) => (t === "insight" ? def : undefined),
      schedule: (task) => void scheduled.push(task),
      continueJob: async () => {},
      log: (event, fields) => logs.push(JSON.stringify({ event, ...fields })),
    });
    const { jobId } = await runner.startJob({ userId, jobType: "insight", target: { type: "application_project", id: crypto.randomUUID() } });
    while (scheduled.length) await scheduled.shift()!();

    // Step 1 got the decrypted key; step 2 found no key row.
    expect(scripted.calls).toHaveLength(1);
    usedKeys.push(scripted.calls[0]!.apiKey);
    expect(scripted.calls[0]!.apiKey).toBe(key);
    const { data: job } = await admin.from("ai_jobs").select("*").eq("id", jobId).single();
    expect(job).toMatchObject({ status: "failed", error_code: "key_missing", failure_cause: null, provider: "anthropic" });
    const { data: usage } = await admin.from("ai_usage_records").select("*").eq("ai_job_id", jobId);
    expect(usage).toHaveLength(1);
    expect(await keyRow("anthropic")).toBeNull();
    // Deleting withdrew the provider's consents; the active provider is cleared (no auto switch).
    const conn = await getAiConnection(user, userId);
    expect(conn.activeProvider).toBeNull();
    expect(conn.providers.find((p) => p.info.provider === "anthropic")!.consents.paid.needsConsent).toBe(true);

    // get_provider_key_secret refuses a finished job.
    expect(await createKeySecretReader(userId).getProviderKeySecret(jobId)).toEqual({ kind: "not_available" });
    // …and a job of another user is invisible (sub mismatch).
    const otherReader = createKeySecretReader(crypto.randomUUID());
    expect(await otherReader.getProviderKeySecret(jobId)).toEqual({ kind: "not_available" });
    // Starting AI now: not connected.
    await expect(runner.startJob({ userId, jobType: "insight", target: { type: "application_project", id: crypto.randomUUID() } })).rejects.toMatchObject({
      code: "ai_not_connected",
    });
  });

  it("limited (R-38): saved as needs_check with the cause; a successful run turns it valid", async () => {
    const version = await consent("gemini", "free");
    verifyScript.push({ stage: 2, code: "daily_quota_exhausted", quotaResetsAt: new Date("2026-10-30T07:00:00Z") });
    const r = await run(registerProviderKey(deps(), { provider: "gemini", connectionTier: "free", apiKey: fakeKey("gemini", "L"), disclosureVersion: version }));
    expect(r).toMatchObject({ result: "limited", saved: true, becameActive: true, errorCode: "daily_quota_exhausted", failureCause: "daily_quota_exhausted" });
    expect(r.quotaResetsAt).toBe("2026-10-30T07:00:00.000Z");
    expect(r.key).toMatchObject({ status: "needs_check", lastFailureCause: "daily_quota_exhausted", lastVerifiedAt: null });

    // The verification job itself is a succeeded job → record_provider_key_success flips needs_check → valid.
    const job = (await verificationJobs()).at(-1)!;
    expect(job.status).toBe("succeeded");
    await createDbKeyStatusReporter(createAiWriterClient(userId)).recordSuccess(job.id);
    expect((await keyRow("gemini"))!.status).toBe("valid");
  });

  it("re-check: valid / key_invalid → invalid / rate_limited → needs_check (record_provider_key_check)", async () => {
    verifyScript.push({ ok: true });
    expect(await run(recheckProviderKey(deps(), { provider: "gemini" }))).toMatchObject({ result: "valid", saved: false, key: { status: "valid" } });
    verifyScript.push({ stage: 2, code: "rate_limited" });
    expect(await run(recheckProviderKey(deps(), { provider: "gemini" }))).toMatchObject({ result: "limited", key: { status: "needs_check", lastFailureCause: "rate_limited" } });
    verifyScript.push({ stage: 1, code: "key_invalid" });
    expect(await run(recheckProviderKey(deps(), { provider: "gemini" }))).toMatchObject({ result: "rejected", key: { status: "invalid", lastFailureCause: "key_invalid" } });
    // Re-check verified with the decrypted stored key.
    expect(new Set(verifiedKeys.slice(-3)).size).toBe(1);
    expect(verifiedKeys.at(-1)!.startsWith("AIza")).toBe(true);
    await expect(recheckProviderKey(deps(), { provider: "openai" })).rejects.toMatchObject({ code: "key_not_found" });
  });

  it("tier change: needs consent for the new tier, keeps the row id, withdraws the old tier's consent", async () => {
    const before = (await keyRow("gemini"))!;
    await expect(recheckProviderKey(deps(), { provider: "gemini", connectionTier: "paid", disclosureVersion: "v2026-10-29" })).rejects.toMatchObject({
      code: "ai_consent_required",
    });
    const version = await consent("gemini", "paid");
    verifyScript.push({ ok: true });
    const r = await run(recheckProviderKey(deps(), { provider: "gemini", connectionTier: "paid", disclosureVersion: version }));
    expect(r).toMatchObject({ result: "valid", saved: true, key: { id: before.id, connectionTier: "paid", status: "valid" } });
    const conn = await getAiConnection(user, userId);
    const g = conn.providers.find((p) => p.info.provider === "gemini")!;
    expect(g.consents.free.needsConsent).toBe(true);
    expect(g.consents.paid.needsConsent).toBe(false);
    // Key still decrypts after re-encryption under the same id (re-check reads it back).
    verifyScript.push({ ok: true });
    await run(recheckProviderKey(deps(), { provider: "gemini" }));
    expect(verifiedKeys.at(-1)).toBe(verifiedKeys.at(-2));
  });

  it("active provider: requires the key's tier consent; withdrawn consent blocks AI start with ai_consent_required", async () => {
    await withdrawAiDataUseConsent(user, { provider: "gemini", connectionTier: "paid" });
    await expect(setActiveAiProvider(user, userId, "gemini")).rejects.toMatchObject({ code: "ai_consent_required" });
    await expect(createDbProviderContextSource(async () => user).forUser(userId)).rejects.toMatchObject({ code: "ai_consent_required" });
    await consent("gemini", "paid");
    const conn = await setActiveAiProvider(user, userId, "gemini");
    expect(conn.activeProvider).toBe("gemini");
    expect(await createDbProviderContextSource(async () => user).forUser(userId)).toEqual({ provider: "gemini", connectionTier: "paid", keyStatus: "valid" });
    await expect(setActiveAiProvider(user, userId, "openai")).rejects.toMatchObject({ code: "key_not_found" });
  });

  it("readiness exposes ai_connection (DM §6 v4)", async () => {
    const { data, error } = await user.rpc("get_data_readiness");
    expect(error).toBeNull();
    expect((data as { ai_connection: unknown }).ai_connection).toEqual({ active_provider: "gemini", key_status: "valid", connection_tier: "paid" });
  });

  it("one verification in flight per user and provider; a dead one is closed as stalled and replaced", async () => {
    const version = await consent("openai", "paid");
    const target = (await import("@/server/keys/format")).keyVerificationTarget("openai");
    const store = createSupabaseJobStore(createAiWriterClient(userId));
    const blockerId = crypto.randomUUID();
    await store.insert({
      id: blockerId,
      userId,
      jobType: "key_verification",
      applicationProjectId: null,
      targetType: target.type,
      targetId: target.id,
      provider: "openai",
      modelTier: "default",
      connectionTier: "paid",
      params: {},
      inputHash: null,
      promptVersion: null,
      model: null,
      progress: { stage: "verify", done: 0, total: 1 },
      meta: { runBase: 1, waitBase: 0, retries: {} },
    });
    await expect(
      registerProviderKey(deps(), { provider: "openai", connectionTier: "paid", apiKey: fakeKey("openai", "B"), disclosureVersion: version }),
    ).rejects.toMatchObject({ code: "key_verification_in_progress", status: 409 });

    // Age the blocker past VERIFY_STALE_MS → the next attempt closes it and proceeds.
    const old = new Date(Date.now() - 5 * 60_000).toISOString();
    const aged = await admin.from("ai_jobs").update({ heartbeat_at: old, created_at: old }).eq("id", blockerId);
    expect(aged.error).toBeNull();
    verifyScript.push({ ok: true });
    const r = await run(registerProviderKey(deps(), { provider: "openai", connectionTier: "paid", apiKey: fakeKey("openai", "C"), disclosureVersion: version }));
    expect(r).toMatchObject({ result: "valid", saved: true, becameActive: false });
    const { data: blocker } = await admin.from("ai_jobs").select("status, error_code").eq("id", blockerId).single();
    expect(blocker).toEqual({ status: "failed", error_code: "stalled" });
  });

  it("verification timeout (QA-S3b-02): step 1 → not saved; step 2 (authenticated) → limited / needs_check; both provider_unavailable", async () => {
    const version = await consent("anthropic", "paid");
    verifyScript.push({ stage: 1, code: "timeout" });
    const r1 = await run(registerProviderKey(deps(), { provider: "anthropic", connectionTier: "paid", apiKey: fakeKey("anthropic", "T1"), disclosureVersion: version }));
    expect(r1).toMatchObject({ result: "rejected", saved: false, errorCode: "provider_unavailable", failureCause: "provider_unavailable" });
    expect((await verificationJobs()).at(-1)).toMatchObject({ status: "failed", error_code: "provider_unavailable" });
    expect(await keyRow("anthropic")).toBeNull();

    verifyScript.push({ stage: 2, code: "timeout" });
    const r2 = await run(registerProviderKey(deps(), { provider: "anthropic", connectionTier: "paid", apiKey: fakeKey("anthropic", "T2"), disclosureVersion: version }));
    expect(r2).toMatchObject({ result: "limited", saved: true, errorCode: "provider_unavailable" });
    expect(r2.key).toMatchObject({ status: "needs_check", lastFailureCause: "provider_unavailable" });
  });

  it("run gate on the ACTIVE provider (QA-S3b-01, C-11.4 R2): consent withdrawal cancels in-flight jobs and blocks the next run", async () => {
    const source = createDbProviderContextSource(async () => user);
    await expect(source.forUser(userId)).resolves.toEqual({ provider: "gemini", connectionTier: "paid", keyStatus: "valid" });
    await expect(source.peekActive(userId)).resolves.toEqual({ provider: "gemini", connectionTier: "paid", keyStatus: "valid" });
    // A queued job on gemini/paid…
    const store = createSupabaseJobStore(createAiWriterClient(userId));
    const id = crypto.randomUUID();
    await store.insert({
      id,
      userId,
      jobType: "insight",
      applicationProjectId: null,
      targetType: "application_project",
      targetId: crypto.randomUUID(),
      provider: "gemini",
      modelTier: "default",
      connectionTier: "paid",
      params: {},
      inputHash: null,
      promptVersion: null,
      model: null,
      progress: { stage: "match", done: 0, total: 1 },
      meta: { runBase: 1, waitBase: 0, retries: {} },
    });
    await withdrawAiDataUseConsent(user, { provider: "gemini", connectionTier: "paid" });
    // Cancel requested: the runner ends it as canceled at claim / next heartbeat, before any call.
    const { data: job } = await admin.from("ai_jobs").select("status, cancel_requested_at").eq("id", id).single();
    expect(job?.cancel_requested_at).not.toBeNull();
    await expect(source.forUser(userId)).rejects.toMatchObject({ code: "ai_consent_required", status: 409 });
    // The retry badge still names the active provider (display only, no consent rule).
    await expect(source.peekActive(userId)).resolves.toEqual({ provider: "gemini", connectionTier: "paid", keyStatus: "valid" });
    // A non-active provider's key doesn't matter any more (every run uses the active one).
    await deleteProviderKey(user, "anthropic");
    await consent("gemini", "paid");
    await expect(source.forUser(userId)).resolves.toMatchObject({ provider: "gemini", connectionTier: "paid" });
  });

  it("run-time gate (check_ai_run_allowed): consent withdrawn while queued → key_missing, 0 provider calls, 0 usage rows", async () => {
    const scripted = createScriptedAdapter("gemini", [{ json: { a: 1 } }] as ScriptedResponse[], Date.now);
    const def: JobTypeDefinition<Llm> = {
      jobType: "insight",
      steps: [
        {
          stage: "match",
          run: async (ctx) =>
            (
              await ctx.llm.complete({
                feature: "TEST",
                promptVersion: "test.v1",
                callKey: `${ctx.callKeyPrefix}.1`,
                systemBlocks: [{ text: "s" }],
                userBlocks: [{ text: "u" }],
                outputSchema: null,
                signal: ctx.signal,
              })
            ).text,
        },
      ],
    };
    const scheduled: (() => Promise<void>)[] = [];
    const runner = createJobRunner<Llm>({
      forUser: (uid) => {
        const db = createAiWriterClient(uid);
        return {
          db,
          store: createSupabaseJobStore(db),
          usage: createSupabaseUsageStore(db),
          keySource: createEnvelopeKeySource({ userId: uid, reader: createKeySecretReader(uid), kms }),
          keyStatus: createDbKeyStatusReporter(db),
        };
      },
      providerContext: createDbProviderContextSource(async () => user),
      checkRunAllowed: (job) => createDbRunGate(createAiWriterClient(job.userId))(job.id),
      createLlm: (input) => createLlm({ ...input, logger: silentAiLogger, adapters: { gemini: scripted.adapter } }),
      settleLlm: (llm, t) => llm.settle(t),
      getDefinition: (t) => (t === "insight" ? def : undefined),
      schedule: (task) => void scheduled.push(task),
      continueJob: async () => {},
      log: (event, fields) => logs.push(JSON.stringify({ event, ...fields })),
    });
    // Allowed now: the gate answers null (generated type says string — handled).
    const { jobId } = await runner.startJob({ userId, jobType: "insight", target: { type: "application_project", id: crypto.randomUUID() } });
    expect(await createDbRunGate(createAiWriterClient(userId))(jobId)).toBeNull();

    // Consent withdrawn behind the app's back (no cancel path) while the job is queued.
    const w = await admin
      .from("ai_data_use_consents")
      .update({ withdrawn_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("provider", "gemini")
      .is("withdrawn_at", null);
    expect(w.error).toBeNull();
    expect(await createDbRunGate(createAiWriterClient(userId))(jobId)).toBe("key_missing");

    while (scheduled.length) await scheduled.shift()!();
    const { data: job } = await admin.from("ai_jobs").select("status, error_code, failure_cause, error_category").eq("id", jobId).single();
    expect(job).toEqual({ status: "failed", error_code: "key_missing", failure_cause: null, error_category: "user_account" });
    expect(scripted.calls).toHaveLength(0);
    const { data: usage } = await admin.from("ai_usage_records").select("id").eq("ai_job_id", jobId);
    expect(usage ?? []).toHaveLength(0);
    await consent("gemini", "paid");
  });

  it("leak scan: no fake key (beyond the last 4) in responses, job rows, usage rows, or logs", async () => {
    const keys = [...new Set([...verifiedKeys, ...usedKeys])];
    expect(keys.length).toBeGreaterThan(3);
    const { data: jobs } = await admin.from("ai_jobs").select("*").eq("user_id", userId);
    const { data: usage } = await admin.from("ai_usage_records").select("*").eq("user_id", userId);
    const haystack = JSON.stringify({ outputs, jobs, usage, logs });
    for (const k of keys) {
      expect(haystack).not.toContain(secretPart(k));
      expect(haystack).not.toContain("SECRETMIDDLE");
    }
    // Outcomes never carry a field that could hold a key.
    for (const o of outputs.filter((x): x is KeyCheckOutcome => !!x && typeof x === "object" && "result" in x)) {
      expect(Object.keys(o).sort()).toEqual(
        ["becameActive", "errorCode", "failureCause", "jobId", "key", "message", "quotaResetsAt", "reason", "result", "retryAfter", "saved"].sort(),
      );
    }
  });

  it("AppError codes from mapDbError for refused RPCs carry no key material", async () => {
    try {
      await setActiveAiProvider(user, userId, "openai");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect(JSON.stringify(err)).not.toContain("SECRETMIDDLE");
    }
  });
});
