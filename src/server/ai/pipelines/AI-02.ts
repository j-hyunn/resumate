import { AliasMap } from "../context-pack/aliases";
import { buildCareerPack, type CareerPack } from "../context-pack/career-pack";
import type { CareerRows } from "../context-pack/career-rows";
import { buildJdContext, type JdContext, type JdSentence } from "../context-pack/jd";
import type { YearMonth } from "../context-pack/months";
import type { EvidenceSourceType } from "../evidence-rules";
import { computeInputHash } from "../input-hash";
import type { Llm } from "../llm";
import { silentAiLogger, type AiLogger } from "../log";
import {
  AI02_MATCH_PROMPT_VERSION,
  AI02_MAX_MATCHES,
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
  type RequirementCategory,
  type RequirementImportance,
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
  validateMatchStage,
  validateSynthesis,
  MATCH_REF_PATTERN,
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
 *   buildInsightContext (every step, deterministic; JD = raw sentences S-n)
 *   → matchRequirements   (stage 1, ONE call, low reasoning: the model reads
 *                          the requirements from the sentences and judges them;
 *                          validated at once, result serializable for the job step output)
 *   → synthesizeOnce      (stage 2, medium reasoning) → regenerateSynthesis (one V-5 regeneration)
 *   → finalizeInsight     (pure: merge → validate → complete_insight p_payload)
 *
 * (R17) The AI-01 requirement extraction is gone: no REQ-n list, no batches,
 * no seniority line. Matches get insight-internal ids M1…Mn (model refs M-n).
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
/** Stage 1 output for ≤ 20 requirements incl. reasoning (one call, R17); headroom. */
export const AI02_MATCH_MAX_OUTPUT_TOKENS = 16_000;
/** Stage 2 output ≈ 3k tokens incl. reasoning; headroom. */
export const AI02_SYNTHESIZE_MAX_OUTPUT_TOKENS = 12_000;
export const AI02_JOB_TYPE = "insight";

export { AI02_PROMPT_VERSION, AI02_MATCH_PROMPT_VERSION, AI02_SYNTHESIZE_PROMPT_VERSION, AI02_MAX_MATCHES };

/**
 * [가정] C-14 (v4.5, CR-11) data_sufficiency `thin` = complete projects ≤ 2,
 * or no number anywhere in affiliated results, standalone descriptions, or the
 * deliverable text that entered the pack (replaces "no quantitative achievement").
 */
export const THIN_MAX_COMPLETE_PROJECTS = 2;
export const THIN_HINTS = {
  fewProjects: "완료된 프로젝트가 2개 이하라 요건별 근거가 적을 수 있습니다.",
  noQuantitative: "결과/성과 서술에 수치가 없어 강점을 뒷받침할 근거가 약할 수 있습니다.",
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
  /** job_descriptions.sentences (all of them). */
  sentences: readonly JdSentence[];
  /** User-entered position title (may be null). */
  positionTitle: string | null;
  /** job_descriptions.raw_text_hash. */
  rawTextHash: string;
};

export type InsightContext = {
  pack: CareerPack;
  jd: JdContext;
  /** <jd> block as sent (title + every sentence). Never log it. */
  jdText: string;
  /** Pack + JD aliases of this call. */
  aliases: AliasMap;
  careerSnapshotHash: string;
  /** = job_descriptions.raw_text_hash (C-6 JD part, R17). */
  jdTextHash: string;
  sentenceCount: number;
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
    positionTitle: input.positionTitle,
    rawTextHash: input.rawTextHash,
  });
  const aliases = AliasMap.merge(pack.aliases, jd.aliases);
  const sourceTexts = [...pack.numberSources.factualTexts, ...jd.numberTexts];
  const allowedNumbers = buildAllowedNumbers({ texts: sourceTexts, numbers: pack.numberSources.computedNumbers });
  const textGuard: TextGuard = { allowedNumbers, literalAliasTokens: literalAliasTokens(sourceTexts) };

  return {
    pack,
    jd,
    jdText: jd.text,
    aliases,
    careerSnapshotHash: pack.careerSnapshotHash,
    jdTextHash: jd.jdTextHash,
    sentenceCount: jd.sentenceCount,
    allowedNumbers,
    textGuard,
    dataSufficiency: computeDataSufficiency(input.careerRows, pack),
  };
}

/** Server-computed (card: "규칙 기반, 서버 계산"); counts only rows that made it into the pack. */
export function computeDataSufficiency(_rows: CareerRows, pack: CareerPack): InsightDataSufficiency {
  const hints: string[] = [];
  if (pack.counts.projects <= THIN_MAX_COMPLETE_PROJECTS) hints.push(THIN_HINTS.fewProjects);
  if (!pack.hasResultNumbers) hints.push(THIN_HINTS.noQuantitative);
  return { level: hints.length ? "thin" : "ok", hints };
}

/** C-6 input_hash for insight reuse (route) and storage (finalize). */
export function computeInsightInputHash(parts: {
  provider: ProviderId;
  /** resolveModel(provider, "default") — the mapped id the call uses. */
  model: string;
  careerSnapshotHash: string;
  /** job_descriptions.raw_text_hash. */
  jdTextHash: string;
}): string {
  return computeInputHash({
    feature: AI02_JOB_TYPE,
    promptVersion: AI02_PROMPT_VERSION,
    provider: parts.provider,
    model: parts.model,
    careerSnapshotHash: parts.careerSnapshotHash,
    jdTextHash: parts.jdTextHash,
  });
}

/**
 * (R17) The JD raw text differs from the one stage 1 read (`jdTextHash`
 * changed mid-job), so the match ids / sentence refs no longer describe the
 * current JD. Name and `code` are kept from v1 (then: requirement list
 * changed, QA-S6-09) so the runner mapping stays. Not an AiError: no C-11
 * code fits; the runner ends the job with its own code (api notes).
 */
export class InsightRequirementsChangedError extends Error {
  readonly code = "requirements_changed" as const;
  constructor() {
    super("insight: JD text changed since stage 1");
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
  /** `M{n}`. */
  requirement_id: string;
  requirement: {
    content: string;
    category: RequirementCategory;
    importance: RequirementImportance;
    sentence_ids: string[];
  };
  status: InsightMatchStatus;
  model_status: InsightMatchStatus;
  rationale: string;
  missing_aspect: string | null;
  /** Career evidence only (JD sentences are `requirement.sentence_ids`). */
  evidence: StoredEvidence[];
};

/** Stage-1 output (one call, R17). JSON-safe (plain objects only) for the job step output. */
export type MatchStageResult = {
  v: 2;
  promptVersion: string;
  model: string;
  usage: NormalizedUsage;
  attempts: number;
  careerSnapshotHash: string;
  jdTextHash: string;
  matches: StoredMatch[];
  report: Record<string, number>;
};

/** Stage 1: the whole JD in one call. Zero matches is a valid result ([가정 R17-AI-3]). */
export async function matchRequirements(input: { context: InsightContext }, deps: Ai02Deps): Promise<MatchStageResult> {
  const { context } = input;
  const structured = await generateStructured(
    deps.llm,
    {
      feature: "AI-02.match",
      promptVersion: AI02_MATCH_PROMPT_VERSION,
      callKey: "insight.match",
      tier: AI02_TIER,
      systemBlocks: systemBlocks(),
      userBlocks: matchUserBlocks({ packText: context.pack.text, jdText: context.jdText }),
      maxOutputTokens: AI02_MATCH_MAX_OUTPUT_TOKENS,
      reasoningLevel: "low",
      signal: deps.signal,
    },
    Ai02MatchOutputSchema,
  );

  const { matches, report } = validateMatchStage(structured.value, context.aliases, context.textGuard, AI02_MAX_MATCHES);
  log(deps, AI02_MATCH_PROMPT_VERSION, "AI-02.match", report);
  return {
    v: 2,
    promptVersion: AI02_MATCH_PROMPT_VERSION,
    model: structured.meta.model,
    usage: structured.meta.usage,
    attempts: structured.attempts,
    careerSnapshotHash: context.careerSnapshotHash,
    jdTextHash: context.jdTextHash,
    matches: matches.map((m) => toStoredMatch(m, context.aliases)),
    report: { ...report },
  };
}

function toStoredMatch(m: ValidatedMatch, aliases: AliasMap): StoredMatch {
  return {
    requirement_id: m.requirementId,
    requirement: {
      content: m.requirement.content,
      category: m.requirement.category,
      importance: m.requirement.importance,
      sentence_ids: [...m.requirement.sentenceIds],
    },
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
 * Stage-1 result → verdicts in the alias form of the current context. Throws
 * InsightRequirementsChangedError when the JD raw text changed since stage 1.
 * Sentences that are gone are dropped (a match with none left is dropped);
 * career sources that vanished between steps (deleted / back to draft) are
 * dropped, then V-4 and the met rule run again.
 */
export function restoreMatches(stage: MatchStageResult, context: InsightContext): { matches: ValidatedMatch[]; report: Ai02ValidationReport } {
  if (stage.jdTextHash !== context.jdTextHash) throw new InsightRequirementsChangedError();
  const report = emptyAi02Report();
  const matches: ValidatedMatch[] = [];
  for (const m of stage.matches) {
    const n = MATCH_ID_PATTERN.exec(m.requirement_id)?.[1];
    if (!n) throw new Error("restoreMatches: bad match id");
    const sentenceIds = m.requirement.sentence_ids.filter((sid) => context.aliases.get(sid)?.sourceType === "jd_sentence");
    if (sentenceIds.length === 0) {
      report.matches_dropped_no_sentence++;
      continue;
    }
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
    matches.push({
      ref: `M-${n}`,
      requirementId: m.requirement_id,
      requirement: {
        content: m.requirement.content,
        category: m.requirement.category,
        importance: m.requirement.importance,
        sentenceIds,
      },
      status,
      modelStatus: m.model_status,
      rationale,
      missingAspect,
      evidence,
    });
  }
  return { matches, report };
}

const MATCH_ID_PATTERN = /^M(\d+)$/;

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
  v: 2;
  kind: "first" | "regen";
  promptVersion: string;
  model: string;
  /** This call incl. its V-6 retry. */
  usage: NormalizedUsage;
  attempts: number;
  careerSnapshotHash: string;
  jdTextHash: string;
  output: Ai02SynthesisOutput;
  refs: Record<string, StoredRef>;
  /** V-5: unsupported numbers (raw text, deduplicated) in `output`. Non-empty after "first" → run regenerateSynthesis. */
  violations: string[];
};

function synthesisCall(
  context: InsightContext,
  stage: MatchStageResult,
  deps: Ai02Deps,
  kind: SynthesisAttempt["kind"],
  unsupportedNumbers?: readonly string[],
): Promise<SynthesisAttempt> {
  const { matches } = restoreMatches(stage, context);
  const lines = matches.map((m) => ({
    ref: m.ref,
    requirement: m.requirement.content,
    category: m.requirement.category,
    importance: m.requirement.importance,
    sentenceRefs: m.requirement.sentenceIds,
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
    v: 2 as const,
    kind,
    promptVersion: AI02_SYNTHESIZE_PROMPT_VERSION,
    model: r.meta.model,
    usage: r.meta.usage,
    attempts: r.attempts,
    careerSnapshotHash: context.careerSnapshotHash,
    jdTextHash: context.jdTextHash,
    output: r.value,
    refs: collectRefs(r.value, context.aliases),
    violations: synthesisNumberViolations(r.value, context.allowedNumbers),
  }));
}

/** Stage 2, first answer: one logical call (V-6 retry inside). */
export async function synthesizeOnce(input: { context: InsightContext; match: MatchStageResult }, deps: Ai02Deps): Promise<SynthesisAttempt> {
  return synthesisCall(input.context, input.match, deps, "first");
}

/**
 * Stage 2, V-5 regeneration (C-3: one regeneration request): the same input
 * plus the unsupported numbers of the first answer. Run only when
 * `first.violations` is non-empty. What is still unsupported is replaced in finalize.
 */
export async function regenerateSynthesis(
  input: { context: InsightContext; match: MatchStageResult; violations: readonly string[] },
  deps: Ai02Deps,
): Promise<SynthesisAttempt> {
  if (input.violations.length === 0) throw new Error("regenerateSynthesis: nothing to regenerate");
  return synthesisCall(input.context, input.match, deps, "regen", input.violations);
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
  if (attempt.careerSnapshotHash === context.careerSnapshotHash && attempt.jdTextHash === context.jdTextHash) {
    return { output: attempt.output, remapped: false };
  }
  const translate = (alias: string): string | null => {
    // Match refs (M-n) are fixed by the stage-1 result, not by the data: kept as is.
    if (MATCH_REF_PATTERN.test(alias)) return alias;
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
  match: MatchStageResult;
  first: SynthesisAttempt;
  regen: SynthesisAttempt | null;
  snapshot: { careerSnapshotHash: string; jdTextHash: string };
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
  const restored = restoreMatches(input.match, context);
  const validated = validateSynthesis(adapted.output, restored.matches, context.aliases, context.textGuard);
  const report = mergeAi02Reports(input.match.report, restored.report, validated.report);
  report.requirements_total = restored.matches.length;
  // V-5 counts: the first answer's violations (regenerated or replaced) are part of number_violations.
  if (regen) report.number_violations += first.violations.length;
  report.synthesis_regenerated = regen ? 1 : 0;

  const synthUsage = regen ? addUsage(first.usage, regen.usage) : first.usage;
  const usage = addUsage(input.match.usage, synthUsage);
  const inputHash = computeInsightInputHash({
    provider: input.provider,
    model: chosen.model,
    careerSnapshotHash: input.snapshot.careerSnapshotHash,
    jdTextHash: input.snapshot.jdTextHash,
  });
  const payload = toCompleteInsightPayload({
    matches: restored.matches,
    synthesis: validated.value,
    aliases: context.aliases,
    dataSufficiency: context.dataSufficiency,
    hashes: { jdTextHash: input.snapshot.jdTextHash, careerSnapshotHash: input.snapshot.careerSnapshotHash, inputHash },
    meta: {
      promptVersion: AI02_PROMPT_VERSION,
      matchPromptVersion: AI02_MATCH_PROMPT_VERSION,
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
