import { AliasMap } from "../context-pack/aliases";
import { buildCareerPack, type CareerPack } from "../context-pack/career-pack";
import type { CareerRows } from "../context-pack/career-rows";
import { buildJdContext, type JdContext, type JdRequirementInput, type JdSentence } from "../context-pack/jd";
import type { YearMonth } from "../context-pack/months";
import type { EvidenceSourceType } from "../evidence-rules";
import { computeInputHash } from "../input-hash";
import type { Llm } from "../llm";
import { silentAiLogger, type AiLogger } from "../log";
import {
  AI02_MATCH_PROMPT_VERSION,
  AI02_PROMPT_VERSION,
  AI02_SYNTHESIZE_PROMPT_VERSION,
  matchUserBlocks,
  synthesizeUserBlocks,
  systemBlocks,
} from "../prompts/AI-02";
import { addUsage, type ConnectionTier, type ModelTier, type NormalizedUsage, type ProviderId } from "../providers/types";
import {
  Ai02MatchOutputSchema,
  Ai02SynthesisOutputSchema,
  type Ai02SynthesisOutput,
  type InsightMatchStatus,
} from "../schemas/AI-02";
import { toCompleteInsightPayload, type CompleteInsightPayload, type InsightDataSufficiency, type InsightSummaryCounts } from "../storage/insight";
import { generateStructured } from "../structured";
import type { ModelEvidence, ValidatedEvidence } from "../validation/evidence";
import {
  applyMatchRules,
  emptyAi02Report,
  mergeAi02Reports,
  recheckEvidence,
  synthesisNumberViolations,
  validateMatchBatch,
  validateSynthesis,
  MET_DOWNGRADE_MISSING_ASPECT,
  NO_EVIDENCE_RATIONALE,
  type Ai02ValidationReport,
  type TextGuard,
  type ValidatedMatch,
} from "../validation/insight";
import { ALIAS_TOKEN_PATTERN, literalAliasTokens } from "../validation/alias-text";
import { buildAllowedNumbers } from "../validation/numbers";

/**
 * AI-02 JD 인사이트 (F-P2-04, F-P2-05, F-P2-07, F-P2-09). Two-stage chain run
 * as an async job (C-6, job_type `insight`), default tier:
 *
 *   buildInsightContext (every step, deterministic)
 *   → matchRequirements × batches  (stage 1, low reasoning, validated at once,
 *                                    result serializable for the job step output)
 *   → synthesizeInsight             (stage 2, medium reasoning, one V-5 regeneration)
 *   → finalizeInsight               (pure: merge → validate → complete_insight p_payload)
 *
 * Plain async functions: no request, DB, or after(). The job runner
 * (api-engineer) loads rows, calls these, persists step outputs, and calls
 * begin/complete_insight. Usage records come from createLlm's onCall.
 *
 * Throws (stage functions): ProviderError (C-11) as is; AiError("schema_invalid",
 * retryable: false) after the single V-6 retry. finalizeInsight makes no call
 * and throws plain Errors only for caller bugs.
 */

export const AI02_TIER = "default" as const;
/** Card 처리 방식: "요건을 최대 8개씩 배치" [가정]. */
export const AI02_BATCH_SIZE = 8;
/** Stage 1 output per batch ≈ 2k tokens incl. reasoning (card 비용); headroom. */
export const AI02_MATCH_MAX_OUTPUT_TOKENS = 8192;
/** Stage 2 output ≈ 3k tokens incl. reasoning; headroom. */
export const AI02_SYNTHESIZE_MAX_OUTPUT_TOKENS = 12_000;
export const AI02_JOB_TYPE = "insight";

export { AI02_PROMPT_VERSION, AI02_MATCH_PROMPT_VERSION, AI02_SYNTHESIZE_PROMPT_VERSION };

/**
 * [가정 S6-4] data_sufficiency `thin` = complete projects ≤ 2 or no
 * quantitative achievement (card example used as the rule).
 */
export const THIN_MAX_COMPLETE_PROJECTS = 2;
export const THIN_HINTS = {
  fewProjects: "완료된 프로젝트가 2개 이하라 요건별 근거가 적을 수 있습니다.",
  noQuantitative: "수치가 있는 성과가 없어 강점을 뒷받침할 근거가 약할 수 있습니다.",
} as const;

export type Ai02Deps = {
  llm: Llm;
  /** abort("canceled") = user cancel; any other reason = timeout. */
  signal?: AbortSignal;
  logger?: AiLogger;
  jobId?: string | null;
};

// ---------- context ----------

export type InsightContextInput = {
  careerRows: CareerRows;
  asOf?: YearMonth;
  jobDescriptionId: string;
  jobDescriptionUpdatedAt: string | null;
  sentences: readonly JdSentence[];
  requirements: readonly JdRequirementInput[];
  positionTitle: string | null;
  /** job_descriptions.extraction.seniority.label (card JD 메타). */
  seniorityLabel: string | null;
};

export type InsightContext = {
  pack: CareerPack;
  jd: JdContext;
  /** <jd> block as sent (requirements + cited sentences + seniority). Never log it. */
  jdText: string;
  /** Pack + JD aliases of this call. */
  aliases: AliasMap;
  /** sort_order order; REQ-n = index + 1. */
  requirements: ReadonlyArray<{ id: string; ref: string }>;
  careerSnapshotHash: string;
  requirementsHash: string;
  /** V-5 allowed set: pack factual text + computed durations + JD text. */
  allowedNumbers: ReadonlySet<string>;
  /** Prose checks (V-5 numbers, alias tokens → labels, QA-S6-04). */
  textGuard: TextGuard;
  dataSufficiency: InsightDataSufficiency;
};

export function buildInsightContext(input: InsightContextInput): InsightContext {
  const pack = buildCareerPack(input.careerRows, { asOf: input.asOf });
  const jd = buildJdContext({
    jobDescriptionId: input.jobDescriptionId,
    jobDescriptionUpdatedAt: input.jobDescriptionUpdatedAt,
    sentences: input.sentences,
    requirements: input.requirements,
    // Stage 1 needs each requirement's source sentences (card 입력 컨텍스트); stage 2 reuses the same block for the cache.
    includeSentences: "cited",
    positionTitle: input.positionTitle,
  });
  const seniority = input.seniorityLabel?.trim() || null;
  const jdText = seniority
    ? jd.text.replace(/<\/jd>$/, `seniority: ${seniority.replace(/</g, "＜").replace(/>/g, "＞").replace(/\n/g, " ")}\n</jd>`)
    : jd.text;
  const aliases = AliasMap.merge(pack.aliases, jd.aliases);

  const requirements = [...aliases.values()]
    .filter((e) => e.sourceType === "jd_requirement")
    .map((e) => ({ id: e.id, ref: e.alias }))
    .sort((a, b) => Number(a.ref.slice(4)) - Number(b.ref.slice(4)));

  const sourceTexts = [...pack.numberSources.factualTexts, ...jd.numberTexts, ...(seniority ? [seniority] : [])];
  const allowedNumbers = buildAllowedNumbers({ texts: sourceTexts, numbers: pack.numberSources.computedNumbers });
  const textGuard: TextGuard = { allowedNumbers, literalAliasTokens: literalAliasTokens(sourceTexts) };

  return {
    pack,
    jd,
    jdText,
    aliases,
    requirements,
    careerSnapshotHash: pack.careerSnapshotHash,
    requirementsHash: jd.requirementsHash,
    allowedNumbers,
    textGuard,
    dataSufficiency: computeDataSufficiency(input.careerRows, pack),
  };
}

/** Server-computed (card: "규칙 기반, 서버 계산"); counts only rows that made it into the pack. */
export function computeDataSufficiency(rows: CareerRows, pack: CareerPack): InsightDataSufficiency {
  const packAchievementIds = new Set([...pack.aliases.values()].filter((e) => e.sourceType === "achievement").map((e) => e.id));
  const quantitative = rows.achievements.filter((a) => packAchievementIds.has(a.id) && a.kind === "quantitative").length;
  const hints: string[] = [];
  if (pack.counts.projects <= THIN_MAX_COMPLETE_PROJECTS) hints.push(THIN_HINTS.fewProjects);
  if (quantitative === 0) hints.push(THIN_HINTS.noQuantitative);
  return { level: hints.length ? "thin" : "ok", hints };
}

/** C-6 input_hash for insight reuse (route) and storage (finalize). */
export function computeInsightInputHash(parts: {
  provider: ProviderId;
  /** resolveModel(provider, "default") — the mapped id the call uses. */
  model: string;
  careerSnapshotHash: string;
  requirementsHash: string;
}): string {
  return computeInputHash({
    feature: AI02_JOB_TYPE,
    promptVersion: AI02_PROMPT_VERSION,
    provider: parts.provider,
    model: parts.model,
    careerSnapshotHash: parts.careerSnapshotHash,
    requirementsHash: parts.requirementsHash,
  });
}

export function batchRequirements<T>(requirements: readonly T[], size: number = AI02_BATCH_SIZE): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error("batchRequirements: size must be a positive integer");
  const out: T[][] = [];
  for (let i = 0; i < requirements.length; i += size) out.push(requirements.slice(i, i + size));
  return out;
}

/**
 * The JD requirement list (ids) differs from the one stage 1 judged
 * (requirements added/removed mid-job, QA-S6-09). Not an AiError: no C-11
 * code fits; the runner ends the job with its own code (api notes).
 */
export class InsightRequirementsChangedError extends Error {
  readonly code = "requirements_changed" as const;
  constructor() {
    super("insight: requirement list changed since stage 1");
    this.name = "InsightRequirementsChangedError";
  }
}

// ---------- stage 1 (serializable) ----------

export type StoredEvidence = {
  source_type: EvidenceSourceType;
  /** UUID; jd_sentence → job_descriptions.id. */
  source_id: string;
  /** jd_sentence only. */
  sid: string | null;
  field: string | null;
  quote: string | null;
  quote_adjusted: boolean;
};

export type StoredMatch = {
  requirement_id: string;
  status: InsightMatchStatus;
  model_status: InsightMatchStatus | null;
  rationale: string;
  missing_aspect: string | null;
  evidence: StoredEvidence[];
};

/** Stage-1 output of one batch. JSON-safe (plain objects only) for the job step output. */
export type MatchBatchResult = {
  v: 1;
  batchIndex: number;
  promptVersion: string;
  model: string;
  usage: NormalizedUsage;
  attempts: number;
  careerSnapshotHash: string;
  requirementsHash: string;
  matches: StoredMatch[];
  report: Record<string, number>;
};

export async function matchRequirements(
  input: { context: InsightContext; batchIndex: number; requirementIds: readonly string[] },
  deps: Ai02Deps,
): Promise<MatchBatchResult> {
  const { context } = input;
  if (input.requirementIds.length === 0) throw new Error("matchRequirements: empty batch");
  const batch = input.requirementIds.map((id) => {
    const req = context.requirements.find((r) => r.id === id);
    if (!req) throw new Error("matchRequirements: requirement not in context");
    return { ref: req.ref, requirementId: req.id };
  });

  const structured = await generateStructured(
    deps.llm,
    {
      feature: "AI-02.match",
      promptVersion: AI02_MATCH_PROMPT_VERSION,
      callKey: `insight.match.${input.batchIndex + 1}`,
      tier: AI02_TIER,
      systemBlocks: systemBlocks(),
      userBlocks: matchUserBlocks({ packText: context.pack.text, jdText: context.jdText, batchRefs: batch.map((b) => b.ref) }),
      maxOutputTokens: AI02_MATCH_MAX_OUTPUT_TOKENS,
      reasoningLevel: "low",
      signal: deps.signal,
    },
    Ai02MatchOutputSchema,
  );

  const { matches, report } = validateMatchBatch(structured.value, batch, context.aliases, context.textGuard);
  log(deps, AI02_MATCH_PROMPT_VERSION, "AI-02.match", report);
  return {
    v: 1,
    batchIndex: input.batchIndex,
    promptVersion: AI02_MATCH_PROMPT_VERSION,
    model: structured.meta.model,
    usage: structured.meta.usage,
    attempts: structured.attempts,
    careerSnapshotHash: context.careerSnapshotHash,
    requirementsHash: context.requirementsHash,
    matches: matches.map((m) => toStoredMatch(m, context.aliases)),
    report: { ...report },
  };
}

function toStoredMatch(m: ValidatedMatch, aliases: AliasMap): StoredMatch {
  return {
    requirement_id: m.requirementId,
    status: m.status,
    model_status: m.modelStatus,
    rationale: m.rationale,
    missing_aspect: m.missingAspect,
    evidence: m.evidence.map((e) => {
      const entry = aliases.get(e.ref);
      if (!entry) throw new Error("toStoredMatch: evidence not in alias map");
      return {
        source_type: e.source_type,
        source_id: entry.id,
        sid: e.source_type === "jd_sentence" ? e.ref : null,
        field: e.field,
        quote: e.quote,
        quote_adjusted: e.quote_adjusted,
      };
    }),
  };
}

/**
 * Stage-1 batches → one verdict per context requirement (alias form of the
 * current context). Sources that vanished between steps (deleted / back to
 * draft) are dropped, then V-4 and the met rule run again. Throws
 * InsightRequirementsChangedError when the batches don't cover exactly the
 * context's requirements (the requirement list changed mid-job, QA-S6-09).
 */
export function restoreMatches(
  batches: readonly MatchBatchResult[],
  context: InsightContext,
): { matches: ValidatedMatch[]; report: Ai02ValidationReport } {
  const report = emptyAi02Report();
  const stored = new Map<string, StoredMatch>();
  for (const b of batches) {
    for (const m of b.matches) {
      if (stored.has(m.requirement_id)) throw new Error("restoreMatches: requirement judged twice");
      stored.set(m.requirement_id, m);
    }
  }
  if (stored.size !== context.requirements.length) throw new InsightRequirementsChangedError();
  const matches = context.requirements.map(({ id, ref }) => {
    const m = stored.get(id);
    if (!m) throw new InsightRequirementsChangedError();
    const raw: ModelEvidence[] = [];
    const adjusted: boolean[] = [];
    let lost = 0;
    for (const e of m.evidence) {
      const alias = aliasFor(e, context.aliases);
      if (!alias) {
        lost++;
        continue;
      }
      raw.push({ source_type: e.source_type, ref: alias, field: e.field, quote: e.quote });
      adjusted.push(e.quote_adjusted);
    }
    report.evidence_lost_on_restore += lost;
    let evidence: ValidatedEvidence[] = recheckEvidence(raw, context.aliases, report, adjusted);
    let status = m.status;
    let rationale = m.rationale;
    let missingAspect = m.missing_aspect;
    if (lost > 0 || evidence.length !== m.evidence.length) {
      const ruled = applyMatchRules(m.status, evidence, report);
      status = ruled.status;
      evidence = ruled.evidence;
      if (ruled.downgradedTo === "no_evidence") rationale = NO_EVIDENCE_RATIONALE;
      if (ruled.downgradedTo === "partial" && !missingAspect) missingAspect = MET_DOWNGRADE_MISSING_ASPECT;
    }
    return { ref, requirementId: id, status, modelStatus: m.model_status, rationale, missingAspect, evidence };
  });
  return { matches, report };
}

function aliasFor(e: StoredEvidence, aliases: AliasMap): string | null {
  if (e.source_type === "jd_sentence") {
    const entry = e.sid ? aliases.get(e.sid) : undefined;
    return entry && entry.sourceType === "jd_sentence" && entry.id === e.source_id ? entry.alias : null;
  }
  return aliases.aliasOf(e.source_type, e.source_id) ?? null;
}

// ---------- stage 2 ----------

/** An alias seen in a stage-2 output, kept by row id so the output survives renumbering. */
export type StoredRef = { source_type: EvidenceSourceType; source_id: string; sid: string | null };

/**
 * One stage-2 call (the first answer or the V-5 regeneration). JSON-safe:
 * the job runner stores it as a step output (QA-S6-03: one logical provider
 * call per step). `output` is in the alias form of the context it was made
 * with; `refs` maps those aliases to row ids so finalize can re-map them when
 * the data changed between steps.
 */
export type SynthesisAttempt = {
  v: 1;
  kind: "first" | "regen";
  promptVersion: string;
  model: string;
  /** This call incl. its V-6 retry. */
  usage: NormalizedUsage;
  attempts: number;
  careerSnapshotHash: string;
  requirementsHash: string;
  output: Ai02SynthesisOutput;
  refs: Record<string, StoredRef>;
  /** V-5: unsupported numbers (raw text, deduplicated) in `output`. Non-empty after "first" → run regenerateSynthesis. */
  violations: string[];
};

function synthesisCall(
  context: InsightContext,
  batches: readonly MatchBatchResult[],
  deps: Ai02Deps,
  kind: SynthesisAttempt["kind"],
  unsupportedNumbers?: readonly string[],
): Promise<SynthesisAttempt> {
  const { matches } = restoreMatches(batches, context);
  const lines = matches.map((m) => ({
    ref: m.ref,
    status: m.status,
    rationale: m.rationale,
    missingAspect: m.missingAspect,
    evidenceRefs: [...new Set(m.evidence.map((e) => (e.field ? `${e.ref}.${e.field}` : e.ref)))],
  }));
  return generateStructured(
    deps.llm,
    {
      feature: "AI-02.synthesize",
      promptVersion: AI02_SYNTHESIZE_PROMPT_VERSION,
      callKey: kind === "first" ? "insight.synthesize" : "insight.synthesize.regen",
      tier: AI02_TIER,
      systemBlocks: systemBlocks(),
      userBlocks: synthesizeUserBlocks({ packText: context.pack.text, jdText: context.jdText, matches: lines, unsupportedNumbers }),
      maxOutputTokens: AI02_SYNTHESIZE_MAX_OUTPUT_TOKENS,
      reasoningLevel: "medium",
      signal: deps.signal,
    },
    Ai02SynthesisOutputSchema,
  ).then((r) => ({
    v: 1 as const,
    kind,
    promptVersion: AI02_SYNTHESIZE_PROMPT_VERSION,
    model: r.meta.model,
    usage: r.meta.usage,
    attempts: r.attempts,
    careerSnapshotHash: context.careerSnapshotHash,
    requirementsHash: context.requirementsHash,
    output: r.value,
    refs: collectRefs(r.value, context.aliases),
    violations: synthesisNumberViolations(r.value, context.allowedNumbers),
  }));
}

/** Stage 2, first answer: one logical call (V-6 retry inside). */
export async function synthesizeOnce(input: { context: InsightContext; batches: readonly MatchBatchResult[] }, deps: Ai02Deps): Promise<SynthesisAttempt> {
  return synthesisCall(input.context, input.batches, deps, "first");
}

/**
 * Stage 2, V-5 regeneration (C-3: one regeneration request): the same input
 * plus the unsupported numbers of the first answer. Run only when
 * `first.violations` is non-empty. What is still unsupported is replaced in finalize.
 */
export async function regenerateSynthesis(
  input: { context: InsightContext; batches: readonly MatchBatchResult[]; violations: readonly string[] },
  deps: Ai02Deps,
): Promise<SynthesisAttempt> {
  if (input.violations.length === 0) throw new Error("regenerateSynthesis: nothing to regenerate");
  return synthesisCall(input.context, input.batches, deps, "regen", input.violations);
}

/** Every alias token in a synthesis output (structural refs and prose) that exists in the map. */
function collectRefs(output: Ai02SynthesisOutput, aliases: AliasMap): Record<string, StoredRef> {
  const refs: Record<string, StoredRef> = {};
  const add = (token: string) => {
    const alias = token.split(".")[0].trim();
    const entry = aliases.get(alias);
    if (!entry || refs[alias]) return;
    refs[alias] = { source_type: entry.sourceType, source_id: entry.id, sid: entry.sourceType === "jd_sentence" ? alias : null };
  };
  walkSynthesis(output, (ref) => (add(ref), ref), (text) => {
    for (const m of text.matchAll(ALIAS_TOKEN_PATTERN)) add(m[0]);
    return text;
  });
  return refs;
}

/** Visits (and rebuilds) every structural ref and every prose text of an output. */
function walkSynthesis(output: Ai02SynthesisOutput, ref: (r: string) => string, text: (t: string) => string): Ai02SynthesisOutput {
  const evs = <E extends { ref: string }>(list: readonly E[]) => list.map((e) => ({ ...e, ref: ref(e.ref) }));
  return {
    ...output,
    strengths: output.strengths.map((s) => ({
      ...s,
      title: text(s.title),
      description: text(s.description),
      requirement_refs: s.requirement_refs.map(ref),
      evidence: evs(s.evidence),
    })),
    gaps: output.gaps.map((g) => ({
      ...g,
      requirement_refs: g.requirement_refs.map(ref),
      description: text(g.description),
      actions: g.actions.map((a) => ({ ...a, text: text(a.text), evidence: evs(a.evidence) })),
      evidence: evs(g.evidence),
    })),
    strategy: {
      positioning: text(output.strategy.positioning),
      positioning_evidence: evs(output.strategy.positioning_evidence),
      project_priorities: output.strategy.project_priorities.map((p) => ({
        ...p,
        ref: ref(p.ref),
        reason: text(p.reason),
        requirement_refs: p.requirement_refs.map(ref),
      })),
    },
  };
}

/** Unresolvable structural ref: fails V-1 and every ref lookup. */
const GONE_REF = "GONE";

/**
 * The attempt's output in the alias form of `context`. Same hashes → as is.
 * Otherwise every alias goes through its row id to today's alias; rows that
 * are gone become GONE_REF (structural; dropped by validation) or vanish from
 * prose. Prose aliases the attempt didn't know stay for replaceAliasesInText.
 */
export function adaptSynthesisOutput(attempt: SynthesisAttempt, context: InsightContext): { output: Ai02SynthesisOutput; remapped: boolean } {
  if (attempt.careerSnapshotHash === context.careerSnapshotHash && attempt.requirementsHash === context.requirementsHash) {
    return { output: attempt.output, remapped: false };
  }
  const translate = (alias: string): string | null => {
    const stored = attempt.refs[alias];
    if (!stored) return null;
    return aliasFor({ ...stored, field: null, quote: null, quote_adjusted: false }, context.aliases);
  };
  const output = walkSynthesis(
    attempt.output,
    (r) => translate(r.trim()) ?? GONE_REF,
    (t) =>
      t.replace(ALIAS_TOKEN_PATTERN, (token) => {
        const [alias, ...rest] = token.split(".");
        if (!attempt.refs[alias]) return token;
        const next = translate(alias);
        return next ? [next, ...rest].join(".") : "";
      }),
  );
  return { output, remapped: true };
}

// ---------- finalize ----------

export type FinalizedInsight = {
  /** complete_insight p_payload. */
  payload: CompleteInsightPayload;
  summaryCounts: InsightSummaryCounts;
  report: Ai02ValidationReport;
  usage: NormalizedUsage;
  inputHash: string;
};

/**
 * Merge → validate → p_payload. Pure (no call). `regen` (when present) is the
 * chosen output; otherwise `first`. Numbers still unsupported are replaced
 * with [수치 확인 필요] (V-5 fallback), aliases in prose become labels.
 *
 * `snapshot` = the hashes captured when the job prepared (QA-S6-09): they are
 * what gets stored (and go into input_hash), so data changed mid-job shows as
 * "데이터 변경됨" instead of being hidden. Validation itself runs against
 * `context` (today's rows), so no evidence points at a vanished row.
 */
export function finalizeInsight(input: {
  context: InsightContext;
  batches: readonly MatchBatchResult[];
  first: SynthesisAttempt;
  regen: SynthesisAttempt | null;
  snapshot: { careerSnapshotHash: string; requirementsHash: string };
  /** The job's fixed values (ai_jobs.provider / model_tier / connection_tier). */
  provider: ProviderId;
  modelTier: ModelTier;
  connectionTier: ConnectionTier;
  now: Date;
  logger?: AiLogger;
  jobId?: string | null;
}): FinalizedInsight {
  const { context, first, regen } = input;
  if (first.kind !== "first" || (regen && regen.kind !== "regen")) throw new Error("finalizeInsight: attempts out of order");
  const chosen = regen ?? first;
  const adapted = adaptSynthesisOutput(chosen, context);
  const restored = restoreMatches(input.batches, context);
  const validated = validateSynthesis(adapted.output, restored.matches, context.aliases, context.textGuard);
  const report = mergeAi02Reports(...input.batches.map((b) => b.report), restored.report, validated.report);
  // V-5 counts: the first answer's violations (regenerated or replaced) are part of number_violations.
  if (regen) report.number_violations += first.violations.length;
  report.synthesis_regenerated = regen ? 1 : 0;

  const synthUsage = regen ? addUsage(first.usage, regen.usage) : first.usage;
  const usage = input.batches.reduce((acc, b) => addUsage(acc, b.usage), synthUsage);
  const inputHash = computeInsightInputHash({
    provider: input.provider,
    model: chosen.model,
    careerSnapshotHash: input.snapshot.careerSnapshotHash,
    requirementsHash: input.snapshot.requirementsHash,
  });
  const payload = toCompleteInsightPayload({
    matches: restored.matches,
    synthesis: validated.value,
    aliases: context.aliases,
    dataSufficiency: context.dataSufficiency,
    hashes: { requirementsHash: input.snapshot.requirementsHash, careerSnapshotHash: input.snapshot.careerSnapshotHash, inputHash },
    meta: {
      promptVersion: AI02_PROMPT_VERSION,
      matchPromptVersion: AI02_MATCH_PROMPT_VERSION,
      batches: input.batches.length,
      provider: input.provider,
      model: chosen.model,
      modelTier: input.modelTier,
      connectionTier: input.connectionTier,
      report,
      usage,
    },
    now: input.now,
  });
  log({ logger: input.logger, jobId: input.jobId }, AI02_PROMPT_VERSION, "AI-02", report);
  return { payload, summaryCounts: payload.result.summary_counts, report, usage, inputHash };
}

/** C-7: counts only. */
function log(deps: { logger?: AiLogger; jobId?: string | null }, promptVersion: string, feature: string, report: Record<string, number>): void {
  (deps.logger ?? silentAiLogger)({ event: "ai_validation", jobId: deps.jobId ?? null, feature, promptVersion, stats: { ...report } });
}
