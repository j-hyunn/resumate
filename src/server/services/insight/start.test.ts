import { describe, expect, it } from "vitest";
import type { ReadinessFeature } from "@/lib/contracts/career";
import { AppError } from "@/lib/contracts/errors";
import { resolveModel } from "@/server/ai/providers/models";
import type { UserSupabaseClient } from "@/server/db/types";
import { createStaticProviderContext, type ProviderContext } from "@/server/jobs/provider-context";
import type { StartJobInput } from "@/server/jobs/runner";
import type { InsightInputs } from "./db";
import { startInsight, type StartInsightDeps } from "./start";

/**
 * Start route service (S6 plan API 2): readiness 422 before anything AI,
 * connection gate, input_hash reuse against ready insights (no job), regenerate,
 * and the started / in-flight job.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const PROJECT = "00000000-0000-4000-8000-0000000000aa";
const PAID: ProviderContext = { provider: "anthropic", connectionTier: "paid", keyStatus: "valid" };

/** Tiny PostgREST chain fake: rows per table, filters by eq(). */
function fakeUser(tables: Record<string, Array<Record<string, unknown>>>): UserSupabaseClient {
  const from = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const rows = () => (tables[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (k: string, v: unknown) => {
        filters.push([k, v]);
        return chain;
      },
      order: () => chain,
      limit: (n: number) => Promise.resolve({ data: rows().slice(0, n), error: null }),
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
    };
    return chain;
  };
  return { from } as unknown as UserSupabaseClient;
}

const READY: ReadinessFeature = { ready: true };
const NOT_READY: ReadinessFeature = { ready: false, missing: ["complete_project"], hints: ["complete_project_detail"], next_action: "writing_chat", suggested_mode: "new_project" };

const INPUTS = { jd: {}, requirements: [], careerRows: {} } as unknown as InsightInputs;

function deps(over: {
  readiness?: ReadinessFeature;
  context?: ProviderContext | null;
  insights?: Array<Record<string, unknown>>;
  inputs?: InsightInputs | null;
  started?: { jobId: string; inProgress: boolean };
}) {
  const calls: StartJobInput[] = [];
  const d: StartInsightDeps = {
    userId: USER,
    user: fakeUser({ application_projects: [{ id: PROJECT }], insights: over.insights ?? [] }),
    providerContext: createStaticProviderContext(over.context === undefined ? PAID : over.context),
    runner: {
      startJob: async (input) => {
        calls.push(input);
        return { jobId: over.started?.jobId ?? "job-1", reused: false, inProgress: over.started?.inProgress ?? false };
      },
    },
    pipeline: {
      promptVersion: "ai-02.test",
      tier: "default",
      buildContext: () => ({}),
      hashes: () => ({ careerSnapshotHash: "c", requirementsHash: "r" }),
      inputHash: (p) => `${p.provider}|${p.model}|${p.careerSnapshotHash}|${p.requirementsHash}`,
    },
    loadInputs: async () => (over.inputs === undefined ? INPUTS : over.inputs),
    getReadiness: async () => ({ features: { insight: over.readiness ?? READY } }),
  };
  return { d, calls };
}

describe("startInsight", () => {
  it("not ready → insufficient_data with the readiness feature; no gate, no job", async () => {
    const { d, calls } = deps({ readiness: NOT_READY, context: null });
    const out = await startInsight(d, PROJECT, { regenerate: false });
    expect(out).toEqual({ kind: "insufficient_data", readiness: NOT_READY });
    expect(calls).toHaveLength(0);
  });

  it("unknown project → not_found", async () => {
    const { d } = deps({});
    await expect(startInsight(d, "00000000-0000-4000-8000-0000000000ff", { regenerate: false })).rejects.toMatchObject({ code: "not_found" });
  });

  it("no connection → 409 ai_not_connected; invalid key → 409 key_invalid", async () => {
    await expect(startInsight(deps({ context: null }).d, PROJECT, { regenerate: false })).rejects.toMatchObject({ code: "ai_not_connected", status: 409 });
    await expect(startInsight(deps({ context: { ...PAID, keyStatus: "invalid" } }).d, PROJECT, { regenerate: false })).rejects.toBeInstanceOf(AppError);
  });

  it("same input_hash ready → reused, no job (C-6)", async () => {
    const model = resolveModel("anthropic", "default");
    const { d, calls } = deps({ insights: [{ id: "ins-1", application_project_id: PROJECT, input_hash: `anthropic|${model}|c|r`, status: "ready", is_latest: true }] });
    const out = await startInsight(d, PROJECT, { regenerate: false });
    expect(out).toEqual({ kind: "started", data: { reused: true, insightId: "ins-1", jobId: null, inProgress: false } });
    expect(calls).toHaveLength(0);
  });

  it("QA-S6-06: an older ready version with the same hash is not reused when the latest differs", async () => {
    const model = resolveModel("anthropic", "default");
    const { d, calls } = deps({
      insights: [
        { id: "ins-1", application_project_id: PROJECT, input_hash: `anthropic|${model}|c|r`, status: "ready", is_latest: false },
        { id: "ins-2", application_project_id: PROJECT, input_hash: "other", status: "ready", is_latest: true },
      ],
    });
    const out = await startInsight(d, PROJECT, { regenerate: false });
    expect(out).toMatchObject({ kind: "started", data: { reused: false, jobId: "job-1" } });
    expect(calls).toHaveLength(1);
  });

  it("regenerate skips reuse and starts a job with the hash function, target and params", async () => {
    const model = resolveModel("anthropic", "default");
    const { d, calls } = deps({ insights: [{ id: "ins-1", application_project_id: PROJECT, input_hash: `anthropic|${model}|c|r`, status: "ready" }] });
    const out = await startInsight(d, PROJECT, { regenerate: true });
    expect(out).toEqual({ kind: "started", data: { reused: false, insightId: null, jobId: "job-1", inProgress: false } });
    expect(calls[0]).toMatchObject({ jobType: "insight", target: { type: "application_project", id: PROJECT }, params: { applicationProjectId: PROJECT }, regenerate: true });
    const hashFn = calls[0]!.inputHash as (c: { provider: "anthropic"; model: string; modelTier: "default"; connectionTier: "paid" }) => string;
    expect(hashFn({ provider: "anthropic", model, modelTier: "default", connectionTier: "paid" })).toBe(`anthropic|${model}|c|r`);
  });

  it("JD not extracted yet → no reuse lookup, job started without input_hash (D-30)", async () => {
    const { d, calls } = deps({ inputs: null, started: { jobId: "job-2", inProgress: true } });
    const out = await startInsight(d, PROJECT, { regenerate: false });
    expect(out).toEqual({ kind: "started", data: { reused: false, insightId: null, jobId: "job-2", inProgress: true } });
    expect(calls[0]!.inputHash).toBeNull();
  });
});
