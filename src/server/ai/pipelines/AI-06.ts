import { AliasMap } from "../context-pack/aliases";
import type { CareerRows } from "../context-pack/career-rows";
import { buildInterviewBase, type InterviewBase } from "../context-pack/interview";
import type { JdRequirementInput, JdSentence } from "../context-pack/jd";
import type { YearMonth } from "../context-pack/months";
import { WHOLE_SOURCE_FIELD, isCareerSupportEvidence, isEvidenceSourceType, isReflectionEvidence, type EvidenceSourceType } from "../evidence-rules";
import { computeInputHash } from "../input-hash";
import type { Llm } from "../llm";
import { silentAiLogger, type AiLogger } from "../log";
import { AI06_PROMPT_VERSION, evaluateUserBlocks, systemBlocks } from "../prompts/AI-06";
import { addUsage, type ConnectionTier, type NormalizedUsage, type ProviderId } from "../providers/types";
import { AI06_OUTPUT_SCHEMA_VERSION, Ai06OutputSchema, type Ai06Output } from "../schemas/AI-06";
import { CRITERIA_KEYS, pendingScore, type DataSufficiencyLevel, type InterviewAnchor, type InterviewType } from "../schemas/interview-common";
import { toPayloadEvidence } from "../storage/drafts";
import { payloadMeta, type SaveAnswerEvaluationPayload, type StoredAnswerEvaluation, type StoredCriterion } from "../storage/interview";
import { generateStructured } from "../structured";
import { ALIAS_TOKEN_PATTERN, replaceAliasesInText } from "../validation/alias-text";
import { finalizeBlockNumbers, validateTextBlock } from "../validation/block";
import { addToReport } from "../validation/draft-blocks";
import { validateItem, type LearningsPolicy, type ValidatedEvidence } from "../validation/evidence";
import { buildAllowedNumbers, guardNumbers, type NumberMention } from "../validation/numbers";
import { matchQuote } from "../validation/quote";

/**
 * AI-06 답변별 평가 (F-P3-06). One call per submitted answer inside the
 * `interview_evaluation` job (parallel on paid tier, sequential on free —
 * the runner decides), default tier, medium reasoning.
 *
 * Server checks (card 처리 방식, 4.1, 4.2):
 * - criteria: the 4 keys exactly once; `not_applicable` only for job_relevance
 *   → otherwise a V-6 miss (one retry, then schema_invalid)
 * - answer_quotes: substring of the answer (V-3 normalization); failed quotes
 *   removed; a grade left with neither quote nor `missing` gets a fixed note
 * - strengths: ≥ 1 valid quote or dropped (V-4)
 * - model answer: V-1..V-3, V-8 (job: no learnings; culture: reflection only),
 *   V-4 flag, C-5 placeholders, V-5 with one regeneration then
 *   [수치 확인 필요]; facts outside the data only in suggestions_if_true
 * - consistency_notes: job, or culture fit with `ok` data only; each needs a
 *   factual career evidence (learnings never, C-9)
 * - score: always pending_method (D-AI-07 (a), D-14 대기)
 * Evidence item_keys: criteria.<key>, strengths.<n>, improvements.<n>,
 * model_answer, consistency_notes.<n> (answer quotes are interview_answer rows).
 */

export const AI06_TIER = "default" as const;
export const AI06_CALL_KEY = "interview_evaluation.evaluate";
/** Output ≈ 3k tokens incl. medium reasoning (card 비용); headroom. */
export const AI06_MAX_OUTPUT_TOKENS = 12_000;
export const AI06_QUESTION_REF = "Q-1";
export const AI06_ANSWER_REF = "ANS-1";
export const ANSWER_LABEL = "내 답변";
/** Shown when every quote of a grade failed V-3 and the model gave no `missing` [가정]. */
export const MISSING_FALLBACK = "답변에서 이 판단의 근거 구간을 확인하지 못했습니다.";

export { AI06_PROMPT_VERSION };

export type EvaluationQuestionInput = {
  id: string;
  sequence: number;
  question_text: string;
  source_kind: string;
  anchor: InterviewAnchor;
  intent: string | null;
  focus_criteria: readonly string[];
  good_answer_signals: readonly string[];
  target_requirement_ids: readonly string[];
  /** The question's evidence_links (UUID form). `sid` (source_locator.sid) is needed for JD sentences. */
  evidence: ReadonlyArray<{ source_type: string; source_id: string; source_field: string | null; sid?: string | null }>;
};

export type AnswerEvaluationContextInput = {
  interviewType: InterviewType;
  dataSufficiency: DataSufficiencyLevel;
  careerRows: CareerRows | null;
  asOf?: YearMonth;
  jobDescriptionId: string;
  jobDescriptionUpdatedAt: string | null;
  sentences: readonly JdSentence[];
  cultureSids: readonly string[];
  requirements: readonly JdRequirementInput[];
  positionTitle: string | null;
  question: EvaluationQuestionInput;
  answer: { id: string; answer_text: string; updated_at: string | null };
};

export type AnswerEvaluationContext = {
  interviewType: InterviewType;
  dataSufficiency: DataSufficiencyLevel;
  base: InterviewBase;
  aliases: AliasMap;
  question: EvaluationQuestionInput;
  questionEvidenceRefs: string[];
  targetRequirementRefs: string[];
  answer: { id: string; text: string };
  /** Pack + JD + answer (V-5 for the model answer). */
  allowedNumbers: ReadonlySet<string>;
  consistencyAllowed: boolean;
  modelAnswerLearnings: LearningsPolicy;
};

export function buildAnswerEvaluationContext(input: AnswerEvaluationContextInput): AnswerEvaluationContext {
  const base = buildInterviewBase(input);
  const answerMap = new AliasMap();
  answerMap.add({
    alias: AI06_ANSWER_REF,
    sourceType: "interview_answer",
    id: input.answer.id,
    fields: { [WHOLE_SOURCE_FIELD]: input.answer.answer_text },
    snapshotAt: input.answer.updated_at,
    label: ANSWER_LABEL,
    parents: [],
  });
  const aliases = AliasMap.merge(base.aliases, answerMap);

  const questionEvidenceRefs: string[] = [];
  for (const e of input.question.evidence) {
    if (!isEvidenceSourceType(e.source_type)) continue;
    const alias = e.source_type === "jd_sentence" ? (e.sid && aliases.get(e.sid)?.sourceType === "jd_sentence" ? e.sid : undefined) : aliases.aliasOf(e.source_type, e.source_id);
    if (!alias) continue;
    const token = e.source_field ? `${alias}.${e.source_field}` : alias;
    if (!questionEvidenceRefs.includes(token)) questionEvidenceRefs.push(token);
  }
  const targetRequirementRefs = input.question.target_requirement_ids.map((id) => aliases.aliasOf("jd_requirement", id)).filter((a): a is string => !!a);

  return {
    interviewType: input.interviewType,
    dataSufficiency: input.dataSufficiency,
    base,
    aliases,
    question: input.question,
    questionEvidenceRefs,
    targetRequirementRefs,
    answer: { id: input.answer.id, text: input.answer.answer_text },
    allowedNumbers: buildAllowedNumbers({ texts: [...base.factualTexts, ...base.jdTexts, input.answer.answer_text], numbers: base.pack.numberSources.computedNumbers }),
    consistencyAllowed: input.interviewType === "job" || input.dataSufficiency === "ok",
    modelAnswerLearnings: input.interviewType === "culture_fit" ? "reflection_only" : "forbidden",
  };
}

export function computeAnswerEvaluationInputHash(context: AnswerEvaluationContext, provider: Llm["provider"], model: string): string {
  return computeInputHash({
    feature: "interview_evaluation",
    promptVersion: AI06_PROMPT_VERSION,
    provider,
    model,
    careerSnapshotHash: context.base.careerSnapshotHash,
    requirementsHash: context.base.requirementsHash,
    params: { question_id: context.question.id, answer_text: context.answer.text, interview_type: context.interviewType, data_sufficiency: context.dataSufficiency },
  });
}

/** V-6 acceptance beyond zod: 4 keys once each; not_applicable only for job_relevance. */
export function acceptEvaluation(output: Ai06Output): boolean {
  const keys = output.criteria.map((c) => c.key);
  if (keys.length !== CRITERIA_KEYS.length || new Set(keys).size !== CRITERIA_KEYS.length) return false;
  return output.criteria.every((c) => c.grade !== "not_applicable" || c.key === "job_relevance");
}

// ---------- validation (pure) ----------

export type ValidatedEvaluation = {
  result: StoredAnswerEvaluation;
  evidence: Array<{ itemKey: string; evidence: ValidatedEvidence[] }>;
  /** V-5 numbers still unsupported in the model answer (before replacement). */
  unsupportedNumbers: NumberMention[];
  report: Record<string, number>;
};

/**
 * Full validation of one output. `final` replaces V-5 numbers in the model
 * answer (after the regeneration attempt); otherwise they are only reported.
 */
export function validateEvaluation(output: Ai06Output, context: AnswerEvaluationContext, mode: "provisional" | "final"): ValidatedEvaluation {
  const report: Record<string, number> = {};
  const { aliases } = context;
  const evidenceItems: ValidatedEvaluation["evidence"] = [];
  const literal = context.base.literalAliasTokens;
  const prose = (t: string) => {
    const r = replaceAliasesInText(t, aliases, literal);
    addToReport(report, { aliases_replaced: r.stats.replaced, aliases_removed: r.stats.removed });
    const g = guardNumbers(r.text.replace(/\bQ-\d+\b/g, "이 질문"), context.allowedNumbers);
    addToReport(report, { numbers_replaced: g.replaced, number_violations: g.replaced });
    return g.text.trim();
  };
  /** Answer quotes → exact answer spans (V-3); failures removed. */
  const quotes = (list: readonly string[]): { kept: string[]; evidence: ValidatedEvidence[] } => {
    const kept: string[] = [];
    const evidence: ValidatedEvidence[] = [];
    for (const q of list) {
      if (q.trim() === "") continue;
      const m = matchQuote(q, context.answer.text);
      if (!m.ok) {
        addToReport(report, { answer_quotes_removed: 1 });
        continue;
      }
      if (m.adjusted) addToReport(report, { quotes_adjusted: 1 });
      if (kept.includes(m.quote)) continue;
      kept.push(m.quote);
      evidence.push({ source_type: "interview_answer", ref: AI06_ANSWER_REF, field: null, quote: m.quote, quote_adjusted: m.adjusted });
    }
    return { kept, evidence };
  };

  if (output.question_ref !== AI06_QUESTION_REF || output.answer_ref !== AI06_ANSWER_REF) addToReport(report, { refs_corrected: 1 });

  // Criteria in rubric order (acceptEvaluation guaranteed one per key).
  const criteria: StoredCriterion[] = CRITERIA_KEYS.map((key) => {
    const c = output.criteria.find((x) => x.key === key);
    if (!c) throw new Error("validateEvaluation: criteria not accepted");
    const q = quotes(c.answer_quotes);
    let missing = c.missing?.trim() ? prose(c.missing) : null;
    let filled = false;
    if (c.grade !== "not_applicable" && q.kept.length === 0 && !missing) {
      missing = MISSING_FALLBACK;
      filled = true;
      addToReport(report, { criteria_missing_filled: 1 });
    }
    if (q.evidence.length) evidenceItems.push({ itemKey: `criteria.${key}`, evidence: q.evidence });
    return { key, grade: c.grade, reason: prose(c.reason), answer_quotes: q.kept, missing, missing_filled: filled };
  });

  const strengths: StoredAnswerEvaluation["strengths"] = [];
  for (const s of output.strengths) {
    const q = quotes(s.answer_quotes);
    if (!q.kept.length) {
      addToReport(report, { strengths_dropped: 1, items_dropped: 1 });
      continue;
    }
    evidenceItems.push({ itemKey: `strengths.${strengths.length}`, evidence: q.evidence });
    strengths.push({ text: prose(s.text), answer_quotes: q.kept });
  }

  const improvements: StoredAnswerEvaluation["improvements"] = [];
  for (const imp of output.improvements) {
    const checked = validateItem({ key: "improvement", kind: "reference", evidence: imp.evidence, learnings: "forbidden" }, { aliases, learnings: "forbidden" });
    addToReport(report, checked.report);
    const text = prose(imp.text);
    if (!text) continue;
    if (checked.outcome.evidence.length) evidenceItems.push({ itemKey: `improvements.${improvements.length}`, evidence: checked.outcome.evidence });
    improvements.push({ text, how: prose(imp.how), related_criteria: [...new Set(imp.related_criteria)] });
  }

  // Model answer: a text block (V-1..V-5, V-8, C-5).
  const ma = output.model_answer;
  const block = validateTextBlock(
    { key: "model_answer", kind: "draft_block", text: replaceAliasesInText(ma.text, aliases, literal).text, evidence: ma.evidence, placeholders: ma.placeholders, learnings: context.modelAnswerLearnings },
    { aliases, learnings: context.modelAnswerLearnings },
    context.allowedNumbers,
  );
  addToReport(report, block.report);
  let maText = block.text;
  const flags = [...block.outcome.flags];
  if (mode === "final") {
    const n = finalizeBlockNumbers(maText, context.allowedNumbers);
    maText = n.text;
    flags.push(...n.flags);
    addToReport(report, n.report);
  }
  if (block.outcome.evidence.length) evidenceItems.push({ itemKey: "model_answer", evidence: block.outcome.evidence });
  const suggestions = ma.suggestions_if_true.map((s) => replaceAliasesInText(s, aliases, literal).text.trim()).filter(Boolean);

  // Consistency notes (4.2): job, or culture fit with ok data; factual career evidence required.
  const consistency: StoredAnswerEvaluation["consistency_notes"] = [];
  if (!context.consistencyAllowed) {
    if (output.consistency_notes.length) addToReport(report, { consistency_notes_dropped_not_allowed: output.consistency_notes.length });
  } else {
    for (const note of output.consistency_notes) {
      const checked = validateItem({ key: "consistency", kind: "judgment", evidence: note.evidence, learnings: "forbidden" }, { aliases, learnings: "forbidden" });
      addToReport(report, checked.report);
      const factual = checked.outcome.evidence.filter((e) => isCareerSupportEvidence(e) && e.source_type !== "interview_answer" && !isReflectionEvidence(e));
      if (checked.outcome.action === "drop" || !factual.length) {
        addToReport(report, { consistency_notes_dropped_no_evidence: 1 });
        continue;
      }
      const q = quotes(note.answer_quotes);
      evidenceItems.push({ itemKey: `consistency_notes.${consistency.length}`, evidence: [...factual, ...q.evidence] });
      consistency.push({ text: prose(note.text), answer_quotes: q.kept });
    }
  }

  if (output.score.status !== "pending_method" || output.score.value !== null) addToReport(report, { score_overridden: 1 });
  const intentReveal = prose(output.intent_reveal) || (context.question.intent ? prose(context.question.intent) : "");

  return {
    result: {
      schema_version: AI06_OUTPUT_SCHEMA_VERSION,
      criteria,
      strengths,
      improvements,
      intent_reveal: intentReveal,
      model_answer: { text: maText, placeholders: block.placeholders, suggestions_if_true: suggestions, flags: [...new Set(flags)] },
      consistency_notes: consistency,
      score: pendingScore(),
    },
    evidence: evidenceItems,
    unsupportedNumbers: block.unsupportedNumbers,
    report,
  };
}

// ---------- calls (one provider call per function, QA-S8-01) ----------

export type Ai06Deps = {
  llm: Llm;
  signal?: AbortSignal;
  logger?: AiLogger;
  jobId?: string | null;
  now?: () => Date;
  callKey?: string;
};

/** An alias seen in an output, kept by row id so the output survives renumbering between steps. */
export type Ai06StoredRef = { source_type: EvidenceSourceType; source_id: string; sid: string | null };

/**
 * One AI-06 call (first evaluation or the V-5 regeneration). JSON-safe: the
 * job runner stores it as a step output (savePartial) so a retry of the
 * regeneration never calls the first evaluation again (S6 QA-S6-03 pattern).
 * `output` is in the alias form of the context it was made with; `refs` maps
 * those aliases to row ids.
 */
export type AnswerEvaluationAttempt = {
  v: 1;
  kind: "first" | "regen";
  promptVersion: string;
  model: string;
  /** This call incl. its V-6 retry. */
  usage: NormalizedUsage;
  attempts: number;
  answerId: string;
  careerSnapshotHash: string;
  requirementsHash: string;
  output: Ai06Output;
  refs: Record<string, Ai06StoredRef>;
  /** V-5: unsupported numbers (raw, deduplicated) in the model answer. Non-empty on "first" → regenerateModelAnswer may run. */
  violations: string[];
};

function evaluationCall(context: AnswerEvaluationContext, deps: Ai06Deps, kind: AnswerEvaluationAttempt["kind"], unsupportedNumbers?: readonly string[]): Promise<AnswerEvaluationAttempt> {
  const callKey = deps.callKey ?? AI06_CALL_KEY;
  return generateStructured(
    deps.llm,
    {
      feature: "AI-06.evaluate",
      promptVersion: AI06_PROMPT_VERSION,
      callKey: kind === "regen" ? `${callKey}.regen` : callKey,
      tier: AI06_TIER,
      systemBlocks: systemBlocks(),
      userBlocks: evaluateUserBlocks({
        packText: context.base.pack.text,
        jdText: context.base.jdText,
        question: {
          ref: AI06_QUESTION_REF,
          interviewType: context.interviewType,
          dataSufficiency: context.dataSufficiency,
          sourceKind: context.question.source_kind,
          anchor: context.question.anchor,
          text: context.question.question_text,
          intent: context.question.intent,
          focusCriteria: context.question.focus_criteria,
          goodAnswerSignals: context.question.good_answer_signals,
          targetRequirementRefs: context.targetRequirementRefs,
          evidenceRefs: context.questionEvidenceRefs,
        },
        answerRef: AI06_ANSWER_REF,
        answerText: context.answer.text,
        consistencyAllowed: context.consistencyAllowed,
        unsupportedNumbers,
      }),
      maxOutputTokens: AI06_MAX_OUTPUT_TOKENS,
      reasoningLevel: "medium",
      signal: deps.signal,
    },
    Ai06OutputSchema,
    { accept: acceptEvaluation },
  ).then((r) => {
    const provisional = validateEvaluation(r.value, context, "provisional");
    return {
      v: 1 as const,
      kind,
      promptVersion: AI06_PROMPT_VERSION,
      model: r.meta.model,
      usage: r.meta.usage,
      attempts: r.attempts,
      answerId: context.answer.id,
      careerSnapshotHash: context.base.careerSnapshotHash,
      requirementsHash: context.base.requirementsHash,
      output: r.value,
      refs: collectRefs(r.value, context.aliases),
      violations: [...new Set(provisional.unsupportedNumbers.map((m) => m.raw))],
    };
  });
}

/** First evaluation: one logical call (V-6 retry inside). */
export async function evaluateAnswerOnce(input: { context: AnswerEvaluationContext }, deps: Ai06Deps): Promise<AnswerEvaluationAttempt> {
  return evaluationCall(input.context, deps, "first");
}

/**
 * V-5 regeneration (C-3 "1회 재생성"): the same input plus the unsupported
 * numbers of the first answer. Run only when `first.violations` is non-empty.
 * Its output replaces the first one as a whole; numbers still unsupported are
 * replaced in finalize.
 */
export async function regenerateModelAnswer(input: { context: AnswerEvaluationContext; violations: readonly string[] }, deps: Ai06Deps): Promise<AnswerEvaluationAttempt> {
  if (input.violations.length === 0) throw new Error("regenerateModelAnswer: nothing to regenerate");
  return evaluationCall(input.context, deps, "regen", input.violations);
}

function evidenceLists(output: Ai06Output): Array<ReadonlyArray<{ source_type: string; ref: string }>> {
  return [...output.improvements.map((i) => i.evidence), output.model_answer.evidence, ...output.consistency_notes.map((n) => n.evidence)];
}

function collectRefs(output: Ai06Output, aliases: AliasMap): Record<string, Ai06StoredRef> {
  const refs: Record<string, Ai06StoredRef> = {};
  const add = (token: string) => {
    const alias = token.split(".")[0].trim();
    const entry = aliases.get(alias);
    if (!entry || refs[alias]) return;
    refs[alias] = { source_type: entry.sourceType, source_id: entry.id, sid: entry.sourceType === "jd_sentence" ? alias : null };
  };
  for (const list of evidenceLists(output)) for (const e of list) add(e.ref);
  walkProse(output, (t) => {
    for (const m of t.matchAll(ALIAS_TOKEN_PATTERN)) add(m[0]);
    return t;
  });
  return refs;
}

/** Rebuilds every prose text of an output. */
function walkProse(output: Ai06Output, text: (t: string) => string): Ai06Output {
  return {
    ...output,
    criteria: output.criteria.map((c) => ({ ...c, reason: text(c.reason), missing: c.missing === null ? null : text(c.missing) })),
    strengths: output.strengths.map((s) => ({ ...s, text: text(s.text) })),
    improvements: output.improvements.map((i) => ({ ...i, text: text(i.text), how: text(i.how) })),
    intent_reveal: text(output.intent_reveal),
    model_answer: { ...output.model_answer, text: text(output.model_answer.text), suggestions_if_true: output.model_answer.suggestions_if_true.map(text) },
    consistency_notes: output.consistency_notes.map((n) => ({ ...n, text: text(n.text) })),
  };
}

/** Unresolvable ref: fails V-1. */
const GONE_REF = "GONE";

/**
 * The attempt's output in the alias form of `context`. Same hashes → as is.
 * Otherwise every alias goes through its row id to today's alias; rows that
 * are gone become GONE_REF in evidence (dropped by V-1) and vanish from prose.
 */
export function adaptEvaluationOutput(attempt: AnswerEvaluationAttempt, context: AnswerEvaluationContext): Ai06Output {
  if (attempt.answerId !== context.answer.id) throw new Error("adaptEvaluationOutput: attempt belongs to another answer");
  if (attempt.careerSnapshotHash === context.base.careerSnapshotHash && attempt.requirementsHash === context.base.requirementsHash) return attempt.output;
  const translate = (alias: string): string | null => {
    const stored = attempt.refs[alias];
    if (!stored) return null;
    if (stored.source_type === "jd_sentence") {
      const e = stored.sid ? context.aliases.get(stored.sid) : undefined;
      return e && e.sourceType === "jd_sentence" && e.id === stored.source_id ? e.alias : null;
    }
    return context.aliases.aliasOf(stored.source_type, stored.source_id) ?? null;
  };
  const mapEvidence = <E extends { ref: string }>(list: readonly E[]) => list.map((e) => ({ ...e, ref: translate(e.ref.trim()) ?? GONE_REF }));
  const remapped = walkProse(attempt.output, (t) =>
    t.replace(ALIAS_TOKEN_PATTERN, (token) => {
      const [alias, ...rest] = token.split(".");
      if (!attempt.refs[alias]) return token;
      const next = translate(alias);
      return next ? [next, ...rest].join(".") : "";
    }),
  );
  return {
    ...remapped,
    improvements: remapped.improvements.map((i) => ({ ...i, evidence: mapEvidence(i.evidence) })),
    model_answer: { ...remapped.model_answer, evidence: mapEvidence(remapped.model_answer.evidence) },
    consistency_notes: remapped.consistency_notes.map((n) => ({ ...n, evidence: mapEvidence(n.evidence) })),
  };
}

export type AnswerEvaluationResult = {
  payload: SaveAnswerEvaluationPayload;
  report: Record<string, number>;
  usage: NormalizedUsage;
  model: string;
  /** Provider calls incl. V-6 retries. */
  attempts: number;
  /** A V-5 regeneration call was made. */
  regenerated: boolean;
};

/**
 * No call. Chosen output = `regen` ?? `first`, validated against today's
 * context; numbers still unsupported → [수치 확인 필요] (V-5 fallback).
 * Builds the save_answer_evaluation p_payload.
 */
export function finalizeAnswerEvaluation(input: {
  context: AnswerEvaluationContext;
  first: AnswerEvaluationAttempt;
  regen: AnswerEvaluationAttempt | null;
  /** The job's values (ai_jobs.provider / connection_tier). */
  provider: ProviderId;
  connectionTier: ConnectionTier;
  now: Date;
  logger?: AiLogger;
  jobId?: string | null;
}): AnswerEvaluationResult {
  const { context, first, regen } = input;
  if (first.kind !== "first" || (regen && regen.kind !== "regen")) throw new Error("finalizeAnswerEvaluation: attempts out of order");
  const chosen = regen ?? first;
  const validated = validateEvaluation(adaptEvaluationOutput(chosen, context), context, "final");
  const report = { ...validated.report };
  if (regen) addToReport(report, { number_violations: first.violations.length, model_answer_regenerated: 1 });
  const usage = regen ? addUsage(first.usage, regen.usage) : first.usage;
  const payload: SaveAnswerEvaluationPayload = {
    result: validated.result,
    hashes: { input_hash: computeAnswerEvaluationInputHash(context, input.provider, chosen.model), career_snapshot_hash: context.base.careerSnapshotHash },
    meta: payloadMeta({
      schemaVersion: AI06_OUTPUT_SCHEMA_VERSION,
      promptVersion: AI06_PROMPT_VERSION,
      provider: input.provider,
      model: chosen.model,
      modelTier: AI06_TIER,
      connectionTier: input.connectionTier,
      report,
      usage,
    }),
    evidence: toPayloadEvidence(validated.evidence, context.aliases, input.now),
  };
  (input.logger ?? silentAiLogger)({ event: "ai_validation", jobId: input.jobId ?? null, feature: "AI-06", promptVersion: AI06_PROMPT_VERSION, stats: { ...report } });
  return { payload, report, usage, model: chosen.model, attempts: first.attempts + (regen?.attempts ?? 0), regenerated: !!regen };
}

/**
 * Convenience wrapper (tests, simple callers): first → (violations and
 * `numberRegeneration`) regen → finalize, all in one run. The job runner
 * should call the three steps separately (QA-S8-01).
 */
export async function evaluateAnswer(input: { context: AnswerEvaluationContext; numberRegeneration?: boolean }, deps: Ai06Deps): Promise<AnswerEvaluationResult> {
  const first = await evaluateAnswerOnce({ context: input.context }, deps);
  const regen = first.violations.length && (input.numberRegeneration ?? true) ? await regenerateModelAnswer({ context: input.context, violations: first.violations }, deps) : null;
  return finalizeAnswerEvaluation({
    context: input.context,
    first,
    regen,
    provider: deps.llm.provider,
    connectionTier: deps.llm.connectionTier,
    now: (deps.now ?? (() => new Date()))(),
    logger: deps.logger,
    jobId: deps.jobId,
  });
}
