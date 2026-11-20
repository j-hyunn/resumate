import type { ConnectionTier, ModelTier, AiProvider } from "@/lib/contracts/enums";
import type { MatchStatus } from "@/lib/contracts/insight";
import { AiError } from "@/server/ai/errors";
import type { Llm } from "@/server/ai/llm";
import { mapDbError } from "@/server/db/errors";
import type { AiWriterSupabaseClient, UserSupabaseClient } from "@/server/db/types";
import type { JobRecord, JobStep, JobTypeDefinition, StepContext } from "@/server/jobs/types";
import { InsightRpcError, loadInsightInputs, type InsightInputs, type InsightStore } from "./db";

/**
 * AI-02 insight job (S6 plan "계약 — API" 1; AI C-6 비동기, C-11.3, C-12;
 * job_type `insight`, target `application_project`, default tier).
 * R17: the JD is its raw text — no extraction first (D-30 removed), no batches.
 *
 *   prepare          → load the JD (sentences + raw_text_hash) and career rows, fix the
 *                      snapshot hashes, begin_insight (`job_description_not_found` when the
 *                      project has no JD → system failure). No provider call.
 *   match            → stage 1, ONE logical call (matchRequirements, `insight.match.1`; a
 *                      second one only when the first left no requirement): the model reads
 *                      the requirements from the JD sentences and judges them (`MT-n`). Its
 *                      JSON-safe result (`v: 3`, incl. the measured `latencyMs`, 4.24 #18) is
 *                      the checkpoint; S-16 partial results read it.
 *   synthesize       → stage 2, first answer (synthesizeOnce): ONE logical call,
 *                      its JSON-safe attempt is the checkpoint (QA-S6-03).
 *   synthesize_regen → V-5 regeneration (regenerateSynthesis), only when the
 *                      first answer has unsupported numbers; otherwise it
 *                      passes without a call and without free-tier spacing.
 *   validate         → finalizeInsight (merge → C-3 validation → payload, with
 *                      the prepare-time snapshot hashes) → complete_insight →
 *                      the runner completes the job. No provider call. `stale_run` (the JD
 *                      raw text changed after prepare, DM 2.6.1) → the job ends `canceled`.
 *   One provider call per step, so the free-tier spacing (C-12) applies between
 *   them and a retry never re-calls a step that already succeeded.
 *
 * Progress (C-6): `match` done/total = 0/1 → 1/1.
 */

export const INSIGHT_JOB_TYPE = "insight" as const;
export const INSIGHT_TARGET_TYPE = "application_project" as const;
export const INSIGHT_STAGES = ["prepare", "match", "synthesize", "synthesize_regen", "validate"] as const;

/** Step-output version of the stage-1 checkpoint (ai `MatchStageResult.v`). Anything else is an older run. */
export const INSIGHT_MATCH_STAGE_VERSION = 3;

/** The validated stage-1 result (ai `MatchStageResult`, JSON-safe), narrowed to what the job and partial view read. */
export type InsightMatchStage = {
  v: typeof INSIGHT_MATCH_STAGE_VERSION;
  rawTextHash: string;
  /** Stage-1 wall time (retries included), kept in the step output (4.24 #18 measurement). */
  latencyMs: number;
  items: ReadonlyArray<{
    match_key: string;
    requirement_text: string;
    sids: readonly string[];
    status: MatchStatus;
    rationale: string;
    missing_aspect: string | null;
  }>;
};

/** Hashes fixed at prepare (QA-S6-09): stored with the insight (`raw_text_hash`) and used for input_hash. */
export type InsightSnapshot = { careerSnapshotHash: string; rawTextHash: string };

/** The AI-02 pipeline as the job uses it (production: pipelines/AI-02; tests: fakes). */
export interface InsightPipeline<C = unknown, M extends InsightMatchStage = InsightMatchStage, S = unknown> {
  promptVersion: string;
  tier: ModelTier;
  buildContext(inputs: InsightInputs): C;
  hashes(context: C): InsightSnapshot;
  /** Stage 1: one call (ai matchRequirements). */
  match(input: { context: C }, deps: InsightCallDeps): Promise<M>;
  /** Stage 2 first answer (ai synthesizeOnce). JSON-safe. */
  synthesize(input: { context: C; match: M }, deps: InsightCallDeps): Promise<S>;
  /** V-5 numbers the attempt couldn't support; non-empty → regenerate. */
  violations(attempt: S): readonly string[];
  /** The one V-5 regeneration call (ai regenerateSynthesis). */
  regenerate(input: { context: C; match: M; violations: readonly string[] }, deps: InsightCallDeps): Promise<S>;
  finalize(input: {
    context: C;
    match: M;
    first: S;
    regen: S | null;
    snapshot: InsightSnapshot;
    provider: AiProvider;
    modelTier: ModelTier;
    connectionTier: ConnectionTier;
    now: Date;
    jobId: string;
  }): { payload: unknown; inputHash: string };
  inputHash(parts: { provider: AiProvider; model: string; careerSnapshotHash: string; rawTextHash: string }): string;
}

export type InsightCallDeps = { llm: Llm; signal: AbortSignal; jobId: string };

export type InsightJobDeps<C, M extends InsightMatchStage, S> = {
  pipeline: InsightPipeline<C, M, S>;
  /** app_ai_writer RPC wrappers of this step's user. */
  storeFor: (db: AiWriterSupabaseClient) => InsightStore;
  /** Override for tests (default: loadInsightInputs on the step's db). */
  loadInputs?: (db: AiWriterSupabaseClient, applicationProjectId: string) => Promise<InsightInputs | null>;
  /** Override for tests (default: `job_descriptions.raw_text_hash` on the retry's db) — QA-07 retry gate. */
  loadRawTextHash?: (db: AiWriterSupabaseClient, applicationProjectId: string) => Promise<string | null>;
  now?: () => Date;
  log?: (event: string, fields: Record<string, string | number | boolean | null>) => void;
};

export type InsightJobParams = { applicationProjectId: string };

export type PrepareOutput = {
  insightId: string;
  /** Sentences of the JD at prepare (C-2 split of the raw text). */
  sentenceCount: number;
  /** QA-S6-09: career snapshot + JD raw-text hashes at prepare (stored with the insight). */
  snapshot: InsightSnapshot;
};
export type SynthesizeOutput<S> = { first: S };
export type RegenOutput<S> = { regen: S | null };
export type ValidateOutput = { insightId: string; versionNo: number | null };

/**
 * R17 (QA-03): checkpoints written before this shape (prepare snapshot without `rawTextHash`, a
 * match output whose `v` isn't 3 — pre-R17 `{ batches }` or an unreleased first-pass R17 run) can't
 * be resumed, and `retry_ai_job` keeps step outputs (no restart flag). So a manual retry of such a
 * job is refused up front (409 `ai_job_not_retryable`, `canRetry: false` in the status) instead of
 * being accepted and ending `stalled`; the user starts a new run with "다시 생성".
 */
export function hasPreR17Checkpoint(stepOutputs: Readonly<Record<string, unknown>>): boolean {
  const prepare = stepOutputs.prepare as { snapshot?: { rawTextHash?: unknown } } | undefined;
  if (prepare && typeof prepare.snapshot?.rawTextHash !== "string") return true;
  const match = stepOutputs.match as { v?: unknown; items?: unknown } | undefined;
  return match !== undefined && !isCurrentMatchStage(match);
}

function isCurrentMatchStage(value: unknown): boolean {
  const m = value as { v?: unknown; items?: unknown } | null | undefined;
  return !!m && m.v === INSIGHT_MATCH_STAGE_VERSION && Array.isArray(m.items);
}

export function insightParams(params: Record<string, unknown>): InsightJobParams {
  const id = params.applicationProjectId;
  if (typeof id !== "string" || !id) throw new AiError("stalled", { retryable: false });
  return { applicationProjectId: id };
}

/** A runner-visible failure from a refused / gone DB state (no provider involved, no retry). */
const systemFailure = () => new AiError("stalled", { retryable: false });

/**
 * DM 2.6.1 (JR-7): the JD raw text changed since prepare read it — same rule as `complete_insight`
 * `stale_run`: the run is closed `canceled` (no new error_code); the user regenerates from S-16
 * ("공고가 바뀌었어요 — 다시 생성").
 */
const rawTextChanged = () => new AiError("canceled", { retryable: false });

/** The prepare-time JD hash of a stored checkpoint, or null (no prepare yet / older shape). */
export function preparedRawTextHash(stepOutputs: Readonly<Record<string, unknown>>): string | null {
  const prepare = stepOutputs.prepare as { snapshot?: { rawTextHash?: unknown } } | undefined;
  return typeof prepare?.snapshot?.rawTextHash === "string" ? prepare.snapshot.rawTextHash : null;
}

type JdHashReader = Pick<AiWriterSupabaseClient, "from"> | Pick<UserSupabaseClient, "from">;

/**
 * QA-07 (R17 정렬): a manual retry is refused (409 `ai_job_not_retryable`, status `canRetry: false`)
 * when the checkpoints can't be resumed — an older shape (`hasPreR17Checkpoint`) or a prepare
 * snapshot whose JD hash is no longer the JD's (the raw text was edited after the run failed:
 * resuming would only end canceled). The user starts a new run with "다시 생성".
 */
export async function insightRetryBlocked(
  db: JdHashReader,
  job: Pick<JobRecord, "jobType" | "stepOutputs" | "params">,
  readHash: (db: JdHashReader, applicationProjectId: string) => Promise<string | null> = loadJdRawTextHash,
): Promise<boolean> {
  if (job.jobType !== INSIGHT_JOB_TYPE) return false;
  if (hasPreR17Checkpoint(job.stepOutputs)) return true;
  const prepared = preparedRawTextHash(job.stepOutputs);
  const applicationProjectId = typeof job.params.applicationProjectId === "string" ? job.params.applicationProjectId : null;
  if (!prepared || !applicationProjectId) return false;
  const current = await readHash(db, applicationProjectId);
  // Project / JD gone: the retry ends lost anyway (the job row cascades); nothing to block here.
  return current !== null && current !== prepared;
}

/** `job_descriptions.raw_text_hash` of the project (RLS = this user), null when gone. */
export async function loadJdRawTextHash(db: JdHashReader, applicationProjectId: string): Promise<string | null> {
  const { data, error } = await (db as AiWriterSupabaseClient).from("job_descriptions").select("raw_text_hash").eq("application_project_id", applicationProjectId).maybeSingle();
  if (error) throw mapDbError(error);
  return data?.raw_text_hash ?? null;
}

/**
 * ai `InsightRequirementsChangedError` (code `requirements_changed`, plain Error). R17: it now
 * means the JD raw text changed after stage 1 (its `rawTextHash` differs from the current
 * context). R17 정렬 (QA-07, DM 2.6.1): the job ends `canceled` like `stale_run`, no automatic retry.
 */
export function isRequirementsChanged(err: unknown): boolean {
  return err instanceof Error && (err as { code?: unknown }).code === "requirements_changed";
}

/** RPC refusals (project gone, `job_description_not_found`, stale run): a system failure, never retried. */
function fromRpc(err: unknown): never {
  if (err instanceof InsightRpcError) throw systemFailure();
  throw err;
}

export function createInsightJobDefinition<C, M extends InsightMatchStage, S>(deps: InsightJobDeps<C, M, S>): JobTypeDefinition<Llm> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const loadInputs = deps.loadInputs ?? ((db, id) => loadInsightInputs(db, id));
  const p = deps.pipeline;

  function prepareOutput(ctx: StepContext<Llm>): PrepareOutput {
    const out = ctx.previous.prepare as PrepareOutput | undefined;
    // An older checkpoint (requirements snapshot) has no rawTextHash: it can't continue.
    if (!out?.insightId || typeof out.snapshot?.rawTextHash !== "string") throw systemFailure();
    return out;
  }

  /** The current context; the JD text must still be the one fixed at prepare. */
  async function contextFor(ctx: StepContext<Llm>): Promise<C> {
    const { applicationProjectId } = insightParams(ctx.params);
    const { snapshot } = prepareOutput(ctx);
    const inputs = await loadInputs(ctx.db, applicationProjectId);
    // Gone now = project deleted (the job row cascades → lost).
    if (!inputs) throw systemFailure();
    const context = p.buildContext(inputs);
    if (p.hashes(context).rawTextHash !== snapshot.rawTextHash) {
      log("insight.jd_text_changed", { jobId: ctx.jobId, stage: ctx.stage });
      throw rawTextChanged();
    }
    return context;
  }

  const prepare: JobStep<Llm> = {
    stage: "prepare",
    callsProvider: false,
    async run(ctx) {
      const { applicationProjectId } = insightParams(ctx.params);
      const inputs = await loadInputs(ctx.db, applicationProjectId);
      if (!inputs) throw systemFailure();
      const snapshot = p.hashes(p.buildContext(inputs));
      const insightId = await deps
        .storeFor(ctx.db)
        .begin(applicationProjectId, ctx.jobId)
        .catch((err: unknown) => {
          if (err instanceof InsightRpcError) log("insight.begin_refused", { jobId: ctx.jobId, raise: err.raise });
          return fromRpc(err);
        });
      const out: PrepareOutput = { insightId, sentenceCount: inputs.jd.sentences.length, snapshot };
      return out;
    },
  };

  const match: JobStep<Llm> = {
    stage: "match",
    async run(ctx) {
      const context = await contextFor(ctx);
      await ctx.reportProgress(0, 1);
      const result = await p.match({ context }, { llm: ctx.llm, signal: ctx.signal, jobId: ctx.jobId });
      await ctx.reportProgress(1, 1);
      return result;
    },
  };

  function matchOf(ctx: StepContext<Llm>): M {
    const out = ctx.previous.match as M | undefined;
    // An older checkpoint (`{ batches }` / first-pass `{ matches }`) isn't v3: it can't continue.
    if (!isCurrentMatchStage(out)) throw systemFailure();
    return out as M;
  }

  function firstOf(ctx: StepContext<Llm>): S {
    const out = ctx.previous.synthesize as SynthesizeOutput<S> | undefined;
    if (!out?.first) throw systemFailure();
    return out.first;
  }

  /** Maps requirements_changed (ai: JD text changed since stage 1) to a logged `canceled` (DM 2.6.1). */
  async function guarded<T>(ctx: StepContext<Llm>, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (isRequirementsChanged(err)) {
        log("insight.requirements_changed", { jobId: ctx.jobId, stage: ctx.stage });
        throw rawTextChanged();
      }
      throw err;
    }
  }

  const synthesize: JobStep<Llm> = {
    stage: "synthesize",
    run: (ctx) =>
      guarded(ctx, async () => {
        const matched = matchOf(ctx);
        const context = await contextFor(ctx);
        const first = await p.synthesize({ context, match: matched }, { llm: ctx.llm, signal: ctx.signal, jobId: ctx.jobId });
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
    run: (ctx) =>
      guarded(ctx, async () => {
        const first = firstOf(ctx);
        const violations = p.violations(first);
        if (violations.length === 0) {
          const skipped: RegenOutput<S> = { regen: null };
          return skipped;
        }
        const context = await contextFor(ctx);
        const regen = await p.regenerate({ context, match: matchOf(ctx), violations }, { llm: ctx.llm, signal: ctx.signal, jobId: ctx.jobId });
        const out: RegenOutput<S> = { regen };
        return out;
      }),
  };

  const validate: JobStep<Llm> = {
    stage: "validate",
    callsProvider: false,
    run: (ctx) =>
      guarded(ctx, async () => {
        const { insightId, snapshot } = prepareOutput(ctx);
        const matched = matchOf(ctx);
        const first = firstOf(ctx);
        const regenOut = ctx.previous.synthesize_regen as RegenOutput<S> | undefined;
        if (!regenOut) throw systemFailure();
        const context = await contextFor(ctx);
        // Pure: merge → C-3 validation against today's rows → payload with the prepare-time hashes.
        const { payload } = p.finalize({
          context,
          match: matched,
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
        if (!result.applied) {
          // DM 2.6.1: `stale_run` = the JD raw text changed after prepare (or a newer generation owns the
          // job) — nothing was saved; the job ends `canceled` (no new error_code). A lost generation makes
          // the runner's finish a no-op. Anything else: never complete without a ready row.
          if (result.reason === "stale_run") {
            log("insight.stale_run", { jobId: ctx.jobId });
            throw new AiError("canceled", { retryable: false });
          }
          throw systemFailure();
        }
        const out: ValidateOutput = { insightId, versionNo: result.versionNo };
        return out;
      }),
  };

  return {
    jobType: INSIGHT_JOB_TYPE,
    modelTier: p.tier,
    retryBlocked: ({ db, job }) =>
      insightRetryBlocked(db, job, deps.loadRawTextHash ? (d, id) => deps.loadRawTextHash!(d as AiWriterSupabaseClient, id) : loadJdRawTextHash),
    steps: [prepare, match, synthesize, synthesizeRegen, validate],
  };
}
