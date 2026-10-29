import type { ConnectionTier, ModelTier, AiProvider } from "@/lib/contracts/enums";
import { AppError } from "@/lib/contracts/errors";
import type { MatchStatus } from "@/lib/contracts/insight";
import { AiError, ProviderError } from "@/server/ai/errors";
import type { Llm } from "@/server/ai/llm";
import type { AiWriterSupabaseClient } from "@/server/db/types";
import type { JdRequirementInput } from "@/server/ai/context-pack/jd";
import { STEP_CONTINUE, type JobStep, type JobTypeDefinition, type StepContext } from "@/server/jobs/types";
import type { EnsureJdResult } from "@/server/services/application/extraction";
import { InsightRpcError, loadInsightInputs, type InsightInputs, type InsightStore } from "./db";

/**
 * AI-02 insight job (S6 plan "계약 — API" 1; AI C-6 비동기, C-11.3, C-12;
 * job_type `insight`, target `application_project`, default tier).
 *
 *   prepare    → D-30: extract the JD first when it has no requirements
 *                (ensureJdExtracted, its own jd_extraction job) → begin_insight
 *   match      → stage 1, one provider call per batch of ≤ 8 requirements.
 *                Paid: all pending batches in parallel in one step. Free
 *                (C-12): one batch per run, STEP_CONTINUE between batches so
 *                the runner's call spacing / budget / per-call retries apply.
 *                Every finished batch is saved with savePartial, so a retry
 *                never re-calls a batch that succeeded (QA-S3a-08 rule).
 *   synthesize       → stage 2, first answer (synthesizeOnce): ONE logical call,
 *                      its JSON-safe attempt is the checkpoint (QA-S6-03).
 *   synthesize_regen → V-5 regeneration (regenerateSynthesis), only when the
 *                      first answer has unsupported numbers; otherwise it
 *                      passes without a call and without free-tier spacing.
 *   validate         → finalizeInsight (merge → C-3 validation → payload, with
 *                      the prepare-time snapshot hashes) → complete_insight →
 *                      the runner completes the job. No provider call.
 *   One provider call per step after match, so the free-tier spacing applies
 *   between them and a retry never re-calls a step that already succeeded.
 *
 * Progress (C-6): `match` done/total = batches; S-16 partial results come
 * from the saved batches (services/insight/partial.ts).
 *
 * A batch that finally fails fails the job (no partial insight, card
 * [가정]); the generating row is failed by the DB trigger when the job ends.
 */

export const INSIGHT_JOB_TYPE = "insight" as const;
export const INSIGHT_TARGET_TYPE = "application_project" as const;
export const INSIGHT_STAGES = ["prepare", "match", "synthesize", "synthesize_regen", "validate"] as const;

/** A validated stage-1 batch (ai `MatchBatchResult`, JSON-safe), narrowed to what the job and partial view read. */
export type InsightBatch = {
  batchIndex: number;
  matches: ReadonlyArray<{ requirement_id: string; status: MatchStatus; rationale: string; missing_aspect: string | null }>;
};

/** The AI-02 pipeline as the job uses it (production: pipelines/AI-02; tests: fakes). */
export interface InsightPipeline<C = unknown, B extends InsightBatch = InsightBatch, S = unknown> {
  promptVersion: string;
  tier: ModelTier;
  batchSize: number;
  buildContext(inputs: InsightInputs): C;
  /** Requirement ids in prompt order (sort_order). */
  requirementIds(context: C): string[];
  hashes(context: C): { careerSnapshotHash: string; requirementsHash: string };
  match(input: { context: C; batchIndex: number; requirementIds: readonly string[] }, deps: InsightCallDeps): Promise<B>;
  /** Stage 2 first answer (ai synthesizeOnce). JSON-safe. */
  synthesize(input: { context: C; batches: readonly B[] }, deps: InsightCallDeps): Promise<S>;
  /** V-5 numbers the attempt couldn't support; non-empty → regenerate. */
  violations(attempt: S): readonly string[];
  /** The one V-5 regeneration call (ai regenerateSynthesis). */
  regenerate(input: { context: C; batches: readonly B[]; violations: readonly string[] }, deps: InsightCallDeps): Promise<S>;
  finalize(input: {
    context: C;
    batches: readonly B[];
    first: S;
    regen: S | null;
    /** Hashes captured at prepare (QA-S6-09): stored and used for input_hash. */
    snapshot: { careerSnapshotHash: string; requirementsHash: string };
    provider: AiProvider;
    modelTier: ModelTier;
    connectionTier: ConnectionTier;
    now: Date;
    jobId: string;
  }): { payload: unknown; inputHash: string };
  inputHash(parts: { provider: AiProvider; model: string; careerSnapshotHash: string; requirementsHash: string }): string;
}

export type InsightCallDeps = { llm: Llm; signal: AbortSignal; jobId: string };

/** Runs ensureJdExtracted for the job's user on the job's FIXED provider (production wires the S5 deps). */
export type InsightJdExtractor = (
  ctx: { userId: string; jobId: string; provider: AiProvider; connectionTier: ConnectionTier; db: AiWriterSupabaseClient; signal: AbortSignal },
  applicationProjectId: string,
) => Promise<EnsureJdResult>;

export type InsightJobDeps<C, B extends InsightBatch, S> = {
  pipeline: InsightPipeline<C, B, S>;
  /** app_ai_writer RPC wrappers of this step's user. */
  storeFor: (db: AiWriterSupabaseClient) => InsightStore;
  ensureJd: InsightJdExtractor;
  /** Override for tests (default: loadInsightInputs on the step's db). */
  loadInputs?: (db: AiWriterSupabaseClient, applicationProjectId: string) => Promise<InsightInputs | null>;
  now?: () => Date;
  log?: (event: string, fields: Record<string, string | number | boolean | null>) => void;
};

export type InsightJobParams = { applicationProjectId: string };

export type PrepareOutput = {
  insightId: string;
  requirementCount: number;
  extractedJobId: string | null;
  /**
   * QA-S6-09: the requirement list this run judges, fixed at prepare. Later
   * steps build their context from it (career rows stay current), so stage-1
   * verdicts, the synthesis and the stored `requirements_hash` all describe the
   * same list. A requirement edited mid-run (F-P2-03) then shows the saved
   * insight as "데이터 변경됨" instead of hiding the change.
   */
  requirements: JdRequirementInput[];
  /** QA-S6-09: career snapshot + requirements hashes at prepare (stored with the insight). */
  snapshot: { careerSnapshotHash: string; requirementsHash: string };
};
export type MatchOutput<B> = { batches: B[] };
export type SynthesizeOutput<S> = { first: S };
export type RegenOutput<S> = { regen: S | null };
export type ValidateOutput = { insightId: string; versionNo: number | null };

export function insightParams(params: Record<string, unknown>): InsightJobParams {
  const id = params.applicationProjectId;
  if (typeof id !== "string" || !id) throw new AiError("stalled", { retryable: false });
  return { applicationProjectId: id };
}

/** A runner-visible failure from a refused / gone DB state (no provider involved, no retry). */
const systemFailure = () => new AiError("stalled", { retryable: false });

/**
 * ai `InsightRequirementsChangedError` (code `requirements_changed`, plain
 * Error): the requirement list no longer matches stage 1. With the
 * prepare-time snapshot (QA-S6-09) it shouldn't happen; if it does, the job
 * ends `stalled` without an automatic retry [가정, spec-gaps S6 (api) ⑰].
 */
export function isRequirementsChanged(err: unknown): boolean {
  return err instanceof Error && (err as { code?: unknown }).code === "requirements_changed";
}

/** RPC refusals: the project is gone (cascade) → the job row is gone too and the runner ends `lost`. */
function fromRpc(err: unknown): never {
  if (err instanceof InsightRpcError) throw systemFailure();
  throw err;
}

export function createInsightJobDefinition<C, B extends InsightBatch, S>(deps: InsightJobDeps<C, B, S>): JobTypeDefinition<Llm> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const loadInputs = deps.loadInputs ?? ((db, id) => loadInsightInputs(db, id));
  const p = deps.pipeline;

  async function contextFor(ctx: StepContext<Llm>): Promise<C> {
    const { applicationProjectId } = insightParams(ctx.params);
    const { requirements } = prepareOutput(ctx);
    const inputs = await loadInputs(ctx.db, applicationProjectId);
    // Extracted in `prepare`; gone now = project deleted (the job row cascades → lost) or a re-extraction in flight.
    if (!inputs) throw systemFailure();
    return p.buildContext({ ...inputs, requirements });
  }

  function prepareOutput(ctx: StepContext<Llm>): PrepareOutput {
    const out = ctx.previous.prepare as PrepareOutput | undefined;
    if (!out?.insightId) throw systemFailure();
    return out;
  }

  const prepare: JobStep<Llm> = {
    stage: "prepare",
    async run(ctx) {
      const { applicationProjectId } = insightParams(ctx.params);
      // D-30: a JD created without a key is extracted first, in this job (its own jd_extraction job + usage record).
      const extracted = await deps.ensureJd(
        // QA-S6-08: the insight job's cancel / deadline also stops the extraction's calls.
        { userId: ctx.userId, jobId: ctx.jobId, provider: ctx.provider, connectionTier: ctx.connectionTier, db: ctx.db, signal: ctx.signal },
        applicationProjectId,
      ).catch((err: unknown) => {
        // extraction_in_progress (the user pressed "요건 정리하기" meanwhile) / not_found: no provider call here [가정].
        if (err instanceof AppError && !(err instanceof AiError)) {
          log("insight.prepare_refused", { jobId: ctx.jobId, code: String(err.code) });
          throw systemFailure();
        }
        throw err;
      });
      if (extracted.status === "failed") {
        log("insight.prepare_extraction_failed", { jobId: ctx.jobId, code: extracted.code });
        // The extraction already used its own C-11.3 retries (sync path): the insight job ends with that cause.
        throw new ProviderError(extracted.code, {
          retryable: false,
          retryAfter: extracted.retryAfter ? new Date(extracted.retryAfter) : undefined,
          quotaResetsAt: extracted.quotaResetsAt ? new Date(extracted.quotaResetsAt) : undefined,
        });
      }
      const inputs = await loadInputs(ctx.db, applicationProjectId);
      if (!inputs) throw systemFailure();
      // A JD with no requirements has nothing to match [가정, spec-gaps S6 (api)].
      if (inputs.requirements.length === 0) throw new AiError("not_a_jd", { retryable: false });
      const snapshot = p.hashes(p.buildContext(inputs));
      const insightId = await deps.storeFor(ctx.db).begin(applicationProjectId, ctx.jobId).catch(fromRpc);
      const out: PrepareOutput = {
        insightId,
        requirementCount: inputs.requirements.length,
        requirements: inputs.requirements,
        snapshot,
        extractedJobId: extracted.status === "succeeded" ? extracted.jobId : null,
      };
      return out;
    },
  };

  const match: JobStep<Llm> = {
    stage: "match",
    async run(ctx) {
      prepareOutput(ctx);
      const context = await contextFor(ctx);
      const ids = p.requirementIds(context);
      const plan = batchIds(ids, p.batchSize);
      const saved = savedBatches<B>(ctx.partial, plan);
      const total = plan.length;
      await ctx.reportProgress(saved.size, total);

      const pending = plan.map((_, i) => i).filter((i) => !saved.has(i));
      const all = () => ({ batches: plan.map((_, i) => saved.get(i)!) }) satisfies MatchOutput<B>;
      if (pending.length === 0) return all();

      const callDeps: InsightCallDeps = { llm: ctx.llm, signal: ctx.signal, jobId: ctx.jobId };
      const persist = async () => {
        await ctx.savePartial({ batches: [...saved.values()].sort((a, b) => a.batchIndex - b.batchIndex) });
        await ctx.reportProgress(saved.size, total);
      };

      if (ctx.sequential) {
        // C-12 free tier: one call per run; the runner spaces runs ≥ FREE_TIER_MIN_INTERVAL_MS apart.
        const index = pending[0]!;
        const batch = await p.match({ context, batchIndex: index, requirementIds: plan[index]! }, callDeps);
        saved.set(index, batch);
        await persist();
        return pending.length > 1 ? STEP_CONTINUE : all();
      }

      // Paid: pending batches in parallel. Successes are saved even when another batch fails,
      // so the step retry re-calls only the failed batches (C-11.3 per call, QA-S3a-08).
      // QA-S6-02: each batch is saved the moment it succeeds, so a step deadline / cancel that cuts a
      // slower batch keeps the finished ones (savePartial writes are serialized by the runner).
      const results = await Promise.allSettled(
        pending.map(async (index) => {
          const batch = await p.match({ context, batchIndex: index, requirementIds: plan[index]! }, callDeps);
          saved.set(index, batch);
          await persist();
          return index;
        }),
      );
      const failures = results.flatMap((r) => (r.status === "rejected" ? [r.reason as unknown] : []));
      if (failures.length > 0) {
        log("insight.match_batches_failed", { jobId: ctx.jobId, failed: failures.length, of: pending.length });
        throw pickFailure(failures);
      }
      return all();
    },
  };

  function batchesOf(ctx: StepContext<Llm>): B[] {
    const matched = ctx.previous.match as MatchOutput<B> | undefined;
    if (!matched?.batches?.length) throw systemFailure();
    return matched.batches;
  }

  function firstOf(ctx: StepContext<Llm>): S {
    const out = ctx.previous.synthesize as SynthesizeOutput<S> | undefined;
    if (!out?.first) throw systemFailure();
    return out.first;
  }

  /** Maps requirements_changed (ai) to a logged system failure. */
  async function guarded<T>(ctx: StepContext<Llm>, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (isRequirementsChanged(err)) {
        log("insight.requirements_changed", { jobId: ctx.jobId, stage: ctx.stage });
        throw systemFailure();
      }
      throw err;
    }
  }

  const synthesize: JobStep<Llm> = {
    stage: "synthesize",
    run: (ctx) => guarded(ctx, async () => {
      prepareOutput(ctx);
      const batches = batchesOf(ctx);
      const context = await contextFor(ctx);
      const first = await p.synthesize({ context, batches }, { llm: ctx.llm, signal: ctx.signal, jobId: ctx.jobId });
      const out: SynthesizeOutput<S> = { first };
      return out;
    }),
  };

  const synthesizeRegen: JobStep<Llm> = {
    stage: "synthesize_regen",
    // No call (and no C-12 spacing) when the first answer passed V-5.
    callsProvider: (previous) => {
      const out = previous.synthesize as SynthesizeOutput<S> | undefined;
      return !!out?.first && p.violations(out.first).length > 0;
    },
    run: (ctx) => guarded(ctx, async () => {
      const first = firstOf(ctx);
      const violations = p.violations(first);
      if (violations.length === 0) {
        const skipped: RegenOutput<S> = { regen: null };
        return skipped;
      }
      const context = await contextFor(ctx);
      const regen = await p.regenerate({ context, batches: batchesOf(ctx), violations }, { llm: ctx.llm, signal: ctx.signal, jobId: ctx.jobId });
      const out: RegenOutput<S> = { regen };
      return out;
    }),
  };

  const validate: JobStep<Llm> = {
    stage: "validate",
    callsProvider: false,
    run: (ctx) => guarded(ctx, async () => {
      const { insightId, snapshot } = prepareOutput(ctx);
      const batches = batchesOf(ctx);
      const first = firstOf(ctx);
      const regenOut = ctx.previous.synthesize_regen as RegenOutput<S> | undefined;
      if (!regenOut) throw systemFailure();
      const context = await contextFor(ctx);
      // Pure: merge → C-3 validation against today's rows → payload with the prepare-time hashes.
      const { payload } = p.finalize({
        context,
        batches,
        first,
        regen: regenOut.regen,
        snapshot,
        provider: ctx.provider,
        modelTier: ctx.modelTier,
        connectionTier: ctx.connectionTier,
        now: now(),
        jobId: ctx.jobId,
      });
      const result = await deps
        .storeFor(ctx.db)
        .complete({ insightId, jobId: ctx.jobId, runGeneration: ctx.runGeneration, payload })
        .catch((err: unknown) => {
          if (err instanceof InsightRpcError) log("insight.complete_refused", { jobId: ctx.jobId, raise: err.raise });
          return fromRpc(err);
        });
      // stale_run: a newer generation or another actor owns the job — never complete without a ready row.
      if (!result.applied) throw systemFailure();
      const out: ValidateOutput = { insightId, versionNo: result.versionNo };
      return out;
    }),
  };

  return {
    jobType: INSIGHT_JOB_TYPE,
    modelTier: p.tier,
    steps: [prepare, match, synthesize, synthesizeRegen, validate],
  };
}

/** Requirement ids → batches of ≤ size, in order (ai `batchRequirements`, same rule). */
export function batchIds(ids: readonly string[], size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/** Saved batches that still match the current plan (same index, same requirement ids). */
export function savedBatches<B extends InsightBatch>(partial: unknown, plan: readonly (readonly string[])[]): Map<number, B> {
  const out = new Map<number, B>();
  const list = partial && typeof partial === "object" ? (partial as { batches?: unknown }).batches : undefined;
  if (!Array.isArray(list)) return out;
  for (const item of list as B[]) {
    const ids = plan[item?.batchIndex];
    if (!ids || !Array.isArray(item.matches)) continue;
    const got = item.matches.map((m) => m.requirement_id);
    if (got.length === ids.length && got.every((id, i) => id === ids[i])) out.set(item.batchIndex, item);
  }
  return out;
}

/**
 * One error for the runner when several batches failed: a cancel wins, then a
 * provider error (its C-11.3 policy decides the retry), then anything else.
 */
export function pickFailure(failures: readonly unknown[]): unknown {
  const canceled = failures.find((f) => f instanceof AiError && f.code === "canceled");
  if (canceled) return canceled;
  return failures.find((f) => f instanceof ProviderError) ?? failures.find((f) => f instanceof AiError) ?? failures[0];
}
