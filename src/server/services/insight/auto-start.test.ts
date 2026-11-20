import { describe, expect, it } from "vitest";
import type { ReadinessFeature } from "@/lib/contracts/career";
import { AppError } from "@/lib/contracts/errors";
import type { UserSupabaseClient } from "@/server/db/types";
import { createStaticProviderContext, type ProviderContext, type ProviderContextSource } from "@/server/jobs/provider-context";
import type { StartJobInput } from "@/server/jobs/runner";
import { autoStartInsight, type AutoStartInsightDeps } from "./auto-start";
import type { InsightInputs } from "./db";

/**
 * JR-6 (4.24 #10, DM 2.6.2): the automatic insight start after creation — each skip reason in
 * check order, the start through the shared service, and "never throws".
 */

const USER = "00000000-0000-4000-8000-000000000001";
const PROJECT = "00000000-0000-4000-8000-0000000000aa";
const PAID: ProviderContext = { provider: "anthropic", connectionTier: "paid", keyStatus: "valid" };
const READY: ReadinessFeature = { ready: true };
const NOT_READY: ReadinessFeature = { ready: false, missing: ["complete_project"], hints: ["project_star"], next_action: "writing_chat" };
const INPUTS = { jd: { sentences: [{ sid: "S1", text: "Spring", start: 0, end: 6 }] }, careerRows: {} } as unknown as InsightInputs;

/** Ownership read (startInsight) + the latest-insight lookup (none). */
function fakeUser(): UserSupabaseClient {
  const from = (table: string) => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => Promise.resolve({ data: [], error: null }),
      maybeSingle: () => Promise.resolve({ data: table === "application_projects" ? { id: PROJECT } : null, error: null }),
    };
    return chain;
  };
  return { from } as unknown as UserSupabaseClient;
}

function deps(over: {
  context?: ProviderContext | null;
  providerContext?: ProviderContextSource;
  readiness?: ReadinessFeature;
  inputs?: InsightInputs | null;
  inProgress?: boolean;
  startJob?: (input: StartJobInput) => Promise<{ jobId: string; reused: boolean; inProgress: boolean }>;
}) {
  const calls: StartJobInput[] = [];
  const logs: Array<[string, Record<string, unknown>]> = [];
  const d: AutoStartInsightDeps = {
    userId: USER,
    user: fakeUser(),
    providerContext: over.providerContext ?? createStaticProviderContext(over.context === undefined ? PAID : over.context),
    runner: {
      startJob:
        over.startJob ??
        (async (input) => {
          calls.push(input);
          return { jobId: "job-1", reused: false, inProgress: false };
        }),
    },
    pipeline: {
      promptVersion: "ai-02.test",
      tier: "default",
      buildContext: () => ({}),
      hashes: () => ({ careerSnapshotHash: "c", rawTextHash: "r" }),
      inputHash: () => "h",
    },
    loadInputs: async () => (over.inputs === undefined ? INPUTS : over.inputs),
    getReadiness: async () => ({ features: { insight: over.readiness ?? READY } }),
    hasInsightInProgress: async () => over.inProgress ?? false,
    log: (event, fields) => logs.push([event, fields]),
  };
  return { d, calls, logs };
}

describe("autoStartInsight (JR-6)", () => {
  it("all conditions hold → one insight job through the shared start path (no reuse skip, usage as manual)", async () => {
    const { d, calls } = deps({});
    await expect(autoStartInsight(d, PROJECT)).resolves.toEqual({ insightJobId: "job-1", insightSkipReason: null });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ jobType: "insight", target: { type: "application_project", id: PROJECT }, params: { applicationProjectId: PROJECT } });
  });

  it("needs_check key still starts (only `invalid` is refused)", async () => {
    const { d, calls } = deps({ context: { ...PAID, keyStatus: "needs_check" } });
    await expect(autoStartInsight(d, PROJECT)).resolves.toMatchObject({ insightJobId: "job-1" });
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["ai_not_connected", { context: null }],
    ["key_invalid", { context: { ...PAID, keyStatus: "invalid" as const } }],
    ["insufficient_data", { readiness: NOT_READY }],
    ["no_sentences", { inputs: { ...INPUTS, jd: { ...INPUTS.jd, sentences: [] } } as InsightInputs }],
    ["in_progress", { inProgress: true }],
    ["start_failed", { inputs: null }],
  ] as const)("%s → no job, no error", async (reason, over) => {
    const { d, calls } = deps(over);
    await expect(autoStartInsight(d, PROJECT)).resolves.toEqual({ insightJobId: null, insightSkipReason: reason });
    expect(calls).toHaveLength(0);
  });

  it("consent missing / outdated (forUser throws ai_consent_required) → consent_required", async () => {
    const providerContext: ProviderContextSource = {
      forUser: async () => {
        throw new AppError("ai_consent_required", "동의", { status: 409 });
      },
      peekActive: async () => PAID,
    };
    const { d, calls } = deps({ providerContext });
    await expect(autoStartInsight(d, PROJECT)).resolves.toEqual({ insightJobId: null, insightSkipReason: "consent_required" });
    expect(calls).toHaveLength(0);
  });

  it("the start throwing (runner gate, DB) is swallowed → start_failed, logged with the code only", async () => {
    const { d, logs } = deps({
      startJob: async () => {
        throw new Error("boom");
      },
    });
    await expect(autoStartInsight(d, PROJECT)).resolves.toEqual({ insightJobId: null, insightSkipReason: "start_failed" });
    expect(logs).toEqual([["insight.auto_start_skipped", { applicationProjectId: PROJECT, reason: "start_failed", code: null }]]);
  });

  it("the runner's own gate refusal keeps its reason (consent changed between the checks)", async () => {
    const { d } = deps({
      startJob: async () => {
        throw new AppError("ai_consent_required", "동의", { status: 409 });
      },
    });
    await expect(autoStartInsight(d, PROJECT)).resolves.toEqual({ insightJobId: null, insightSkipReason: "consent_required" });
  });

  it("a job already in flight returned by the runner → in_progress, no job id", async () => {
    const { d } = deps({ startJob: async () => ({ jobId: "job-x", reused: false, inProgress: true }) });
    await expect(autoStartInsight(d, PROJECT)).resolves.toEqual({ insightJobId: null, insightSkipReason: "in_progress" });
  });
});
