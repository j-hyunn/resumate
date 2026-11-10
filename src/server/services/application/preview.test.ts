import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/contracts/errors";
import { KO_BACKEND, NOT_A_JD } from "@/server/ai/__fixtures__/AI-01/jds";
import { ProviderError } from "@/server/ai/errors";
import { jdPreviewSummary } from "@/server/ai/pipelines/AI-01";
import { extractJdRequirements } from "@/server/ai/pipelines/AI-01";
import { silentAiLogger } from "@/server/ai/log";
import { sha256Hex } from "@/server/ai/hash";
import { splitJdSentences } from "@/server/ai/context-pack/jd";
import { createRecordingKeyStatusReporter, createStaticKeySource, createStaticProviderContext, type ProviderContext } from "@/server/jobs/provider-context";
import type { LlmFactoryInput } from "@/server/jobs/types";
import { MemoryJobStore, MemoryUsageStore, createScriptedAdapter, fakeClock, scriptedLlmFactory, type ScriptedResponse } from "@/test/job-fakes";
import { extractJdPreview, kstToday, type JdPreviewDeps, type JdPreviewExtractor } from "./preview";
import { normalizeJdRawText } from "./raw-text";

/**
 * A2 (R15, CF-A17): the 요건 미리 보기 run. What this pins down:
 *   - the job row's shape (`target_type = 'jd_preview'`, no target, no application project,
 *     `params = {raw_text_hash, sentence_count}` computed from the **normalized** text),
 *   - the validated result goes to `ai_jobs.output` and **not** into the response,
 *   - the Q53-1 gate answers 409 and creates **no job row and no usage row**,
 *   - one usage row per provider call with `application_project_id` null,
 *   - a failure is final (no `next_run_at`), and the key never reaches a stored row.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const PAID: ProviderContext = { provider: "anthropic", connectionTier: "paid", keyStatus: "valid" };
const KEY = "sk-ant-test-secret-key-0001";

/** Same wiring as production (`jobs/jd-preview.ts`) but with the silent logger. */
const extractorForTests: JdPreviewExtractor = async (input, deps) => {
  const result = await extractJdRequirements(input, { llm: deps.llm, signal: deps.signal, callKey: deps.callKey, jobId: deps.jobId, logger: silentAiLogger });
  return { payload: result.payload, summary: jdPreviewSummary(result), model: result.meta.model, promptVersion: result.promptVersion };
};

function setup(opts: { responses?: ScriptedResponse[]; context?: ProviderContext | null; gate?: JdPreviewDeps["runGate"] } = {}) {
  const clock = fakeClock();
  const store = new MemoryJobStore(clock.now);
  const usage = new MemoryUsageStore(USER);
  const keyStatus = createRecordingKeyStatusReporter();
  const context = opts.context === undefined ? PAID : opts.context;
  const adapter = createScriptedAdapter(context?.provider ?? "anthropic", opts.responses ?? [], clock.ms);
  const llm = scriptedLlmFactory(adapter.adapter, clock.ms);
  const logs: { event: string; fields: Record<string, unknown> }[] = [];
  const tiers: string[] = [];
  const deps: JdPreviewDeps = {
    userId: USER,
    store,
    usage,
    providerContext: createStaticProviderContext(context),
    keySource: createStaticKeySource(KEY, () => new ProviderError("key_missing")),
    keyStatus,
    runGate: opts.gate ?? null,
    createLlm: (input: LlmFactoryInput) => {
      tiers.push(input.tier);
      return llm(input);
    },
    extract: extractorForTests,
    now: clock.now,
    sleep: async (ms) => void clock.advance(ms),
    log: (event, fields) => void logs.push({ event, fields }),
    timing: { heartbeatMs: 1_000_000 },
  };
  return { clock, store, usage, keyStatus, adapter, deps, logs, tiers };
}

const jobs = (store: MemoryJobStore) => [...store.jobs.values()];

describe("extractJdPreview — success", () => {
  it("one light-tier call; the row has no target and the params the create RPC checks", async () => {
    const t = setup({ responses: [{ json: KO_BACKEND.output }] });
    const result = await extractJdPreview(t.deps, `  ${KO_BACKEND.raw}\r\n`);

    const [job] = jobs(t.store);
    expect(job!.id).toBe(result.previewJobId);
    expect(job!.status).toBe("succeeded");
    expect(job!.jobType).toBe("jd_extraction");
    expect(job!.targetType).toBe("jd_preview");
    expect(job!.targetId).toBeNull();
    expect(job!.applicationProjectId).toBeNull();
    expect(job!.modelTier).toBe("light");
    expect(t.tiers).toEqual(["light"]);

    // A3: hash and sentence count come from the normalized string, so the create RPC's own
    // recomputation from `p_raw_text` matches (D11 `preview_mismatch` otherwise).
    const normalized = normalizeJdRawText(`  ${KO_BACKEND.raw}\r\n`);
    expect(job!.params).toEqual({ raw_text_hash: sha256Hex(normalized), sentence_count: splitJdSentences(normalized).length });
  });

  it("writes the validated result to ai_jobs.output and keeps it out of the response (CF-A17)", async () => {
    const t = setup({ responses: [{ json: KO_BACKEND.output }] });
    const result = await extractJdPreview(t.deps, KO_BACKEND.raw);
    const [job] = jobs(t.store);
    const output = t.store.outputs.get(job!.id) as { requirements: unknown[]; requirements_hash: string };
    expect(output.requirements).toHaveLength(6);
    expect(output.requirements_hash).toMatch(/^[0-9a-f]{64}$/);
    // The summary only — never the requirement text.
    expect(Object.keys(result).sort()).toEqual(["companyName", "deadline", "positionTitle", "previewJobId", "requirementCount"]);
    expect(result.requirementCount).toBe(6);
    expect(JSON.stringify(result)).not.toContain(output.requirements_hash);
  });

  it("records one usage row with application_project_id null, and reports the key as working", async () => {
    const t = setup({ responses: [{ json: KO_BACKEND.output }] });
    const result = await extractJdPreview(t.deps, KO_BACKEND.raw);
    const rows = t.usage.forJob(result.previewJobId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ feature: "jd_extraction", applicationProjectId: null, outcome: "succeeded", modelTier: "light" });
    expect(t.keyStatus.successes).toEqual([result.previewJobId]);
  });

  it("never stores or logs the key, and logs counts only (C-7)", async () => {
    const t = setup({ responses: [{ json: KO_BACKEND.output }] });
    await extractJdPreview(t.deps, KO_BACKEND.raw);
    expect(JSON.stringify([jobs(t.store), t.usage.records])).not.toContain(KEY);
    const logged = JSON.stringify(t.logs);
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain(KO_BACKEND.raw.slice(0, 20));
  });

  it("company / position are sent as null (CF-A6: 단계 1 has no user values)", async () => {
    const t = setup({ responses: [{ json: KO_BACKEND.output }] });
    await extractJdPreview(t.deps, KO_BACKEND.raw);
    const prompt = JSON.stringify(t.adapter.calls[0]);
    // The reference block the extraction adds for user values is absent.
    expect(prompt).not.toContain("회사명: ");
  });

  it("the KST reference day is passed to the pipeline but never into the prompt (CF-A5)", async () => {
    const t = setup({ responses: [{ json: KO_BACKEND.output }] });
    const today = kstToday(new Date("2026-11-09T20:00:00.000Z"));
    expect(today).toBe("2026-11-10");
    await extractJdPreview({ ...t.deps, today: () => today }, KO_BACKEND.raw);
    expect(JSON.stringify(t.adapter.calls[0])).not.toContain(today);
  });
});

describe("extractJdPreview — Q53-1 connection gate (409, no rows)", () => {
  it("no active provider → 409 key_missing and no job row", async () => {
    const t = setup({ context: null });
    await expect(extractJdPreview(t.deps, KO_BACKEND.raw)).rejects.toMatchObject({ code: "key_missing", status: 409 });
    expect(jobs(t.store)).toHaveLength(0);
    expect(t.usage.records).toHaveLength(0);
    expect(t.adapter.calls).toHaveLength(0);
  });

  it("an invalid key → 409 key_invalid and no job row", async () => {
    const t = setup({ context: { ...PAID, keyStatus: "invalid" } });
    await expect(extractJdPreview(t.deps, KO_BACKEND.raw)).rejects.toMatchObject({ code: "key_invalid", status: 409 });
    expect(jobs(t.store)).toHaveLength(0);
    expect(t.usage.records).toHaveLength(0);
  });

  it("a withdrawn consent → 409 ai_consent_required and no job row", async () => {
    const t = setup({ context: null });
    const deps: JdPreviewDeps = {
      ...t.deps,
      providerContext: {
        forUser: async () => {
          throw new AppError("ai_consent_required", undefined, { status: 409 });
        },
        peekActive: async () => null,
      },
    };
    await expect(extractJdPreview(deps, KO_BACKEND.raw)).rejects.toMatchObject({ code: "ai_consent_required", status: 409 });
    expect(jobs(t.store)).toHaveLength(0);
  });

  /**
   * The run gate (`check_ai_run_allowed`) fires after the row exists, so the row is closed `failed`
   * with the gate code — it is never `succeeded`, so `create_application_project` will not apply it.
   */
  it("the run gate refuses after the insert → 409 and the row ends failed, not succeeded", async () => {
    const t = setup({ gate: async () => "key_invalid" });
    await expect(extractJdPreview(t.deps, KO_BACKEND.raw)).rejects.toMatchObject({ code: "key_invalid", status: 409 });
    const [job] = jobs(t.store);
    expect(job).toMatchObject({ status: "failed", errorCode: "key_invalid", nextRunAt: null });
    expect(t.usage.records).toHaveLength(0);
    expect(t.adapter.calls).toHaveLength(0);
  });
});

describe("extractJdPreview — failures are final (not on the retry path)", () => {
  it("not a JD → 422 not_a_jd, job failed with no next_run_at", async () => {
    const t = setup({ responses: [{ json: NOT_A_JD.output }] });
    await expect(extractJdPreview(t.deps, NOT_A_JD.raw)).rejects.toMatchObject({ code: "not_a_jd", status: 422 });
    const [job] = jobs(t.store);
    expect(job).toMatchObject({ status: "failed", errorCode: "not_a_jd", nextRunAt: null });
  });

  it("a text with no sentence ends not_a_jd without a provider call", async () => {
    const t = setup();
    await expect(extractJdPreview(t.deps, "----\n• • •")).rejects.toMatchObject({ code: "not_a_jd", status: 422 });
    expect(t.adapter.calls).toHaveLength(0);
    expect(jobs(t.store)[0]).toMatchObject({ status: "failed", nextRunAt: null });
  });

  it("a provider failure answers 502 and still records the call's usage row", async () => {
    const t = setup({ responses: [{ error: "provider_unavailable" }] });
    await expect(extractJdPreview(t.deps, KO_BACKEND.raw)).rejects.toMatchObject({ status: 502 });
    const [job] = jobs(t.store);
    expect(job!.status).toBe("failed");
    expect(job!.nextRunAt).toBeNull();
    expect(t.usage.forJob(job!.id).every((r) => r.applicationProjectId === null)).toBe(true);
  });
});
