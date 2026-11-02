import type { AliasMap } from "../context-pack/aliases";
import type { CareerRows } from "../context-pack/career-rows";
import { buildInterviewBase, type InterviewBase } from "../context-pack/interview";
import type { JdRequirementInput, JdSentence } from "../context-pack/jd";
import type { YearMonth } from "../context-pack/months";
import { isActionResultEvidence, isCareerSupportEvidence, isEvidenceSourceType, isReflectionEvidence } from "../evidence-rules";
import { AiError } from "../errors";
import { computeInputHash } from "../input-hash";
import type { Llm } from "../llm";
import { silentAiLogger, type AiLogger } from "../log";
import { AI05_PROMPT_VERSION, generateUserBlocks, systemBlocks, type Ai05ExistingLine } from "../prompts/AI-05";
import { escLine } from "../prompts/drafts-common";
import { toCanonicalJsonSchema } from "../providers/schema";
import { addUsage, UNAVAILABLE_USAGE, type ConnectionTier, type NormalizedUsage, type ProviderId } from "../providers/types";
import { AI05_OUTPUT_SCHEMA_VERSION, Ai05OutputSchema, Ai05QuestionSchema, type Ai05Question } from "../schemas/AI-05";
import type { DataSufficiencyLevel, InterviewAnchor, InterviewSourceKind, InterviewType, QuestionCount } from "../schemas/interview-common";
import { toPayloadEvidence } from "../storage/drafts";
import { QUESTION_ITEM_KEY, payloadMeta, type CompleteInterviewQuestionsPayload, type SaveInterviewQuestionPayload } from "../storage/interview";
import { IncrementalJsonParser, JsonStreamError, type JsonEvent } from "../streaming/json-incremental";
import { replaceAliasesInText } from "../validation/alias-text";
import { addToReport } from "../validation/draft-blocks";
import { validateItem, type LearningsPolicy, type ModelEvidence, type ValidatedEvidence } from "../validation/evidence";
import {
  canAccept,
  citesReflection,
  compositionRule,
  exhaustedKinds,
  findCareerTerms,
  findForbiddenTopics,
  missingKinds,
  questionKey,
  type CompositionRule,
} from "../validation/interview";
import { findUnsupportedNumbers, guardNumbers } from "../validation/numbers";

/**
 * AI-05 면접 질문 일괄 생성 (F-P3-01, F-P3-02, F-P3-13). Async job
 * (`interview_questions`), default tier, low reasoning. The model output is
 * streamed; every `questions[n]` object is validated the moment it closes
 * and, when it passes, handed to `deps.onQuestion` (save_interview_question)
 * before the next one arrives (card 응답 모드 "질문이 완성될 때마다 저장").
 *
 * Per-question rules (a failing question is dropped; the remaining count is
 * generated again, plan [가정] 3):
 * - source_kind / anchor allowed for the type (job: experience | jd only; `none` data: no experience)
 * - evidence V-1..V-3, V-8 (job: no learnings; culture experience: learnings
 *   only quoted as the user's reflection), anchor needs its evidence
 *   (experience → career, culture jd → jd_sentence), kind needs its targets
 * - V-5 on the question text (job/experience: pack+JD; other culture anchors: JD only)
 * - culture non-experience anchors: no career proper nouns (4.1)
 * - C-7 forbidden topics, duplicates (text, same project ≤ 2, same detail 1, same requirement 1)
 * - set composition as a feasibility check at each acceptance (4.1 table);
 *   relaxed on a regeneration attempt (warn and proceed, card [가정])
 */

export const AI05_TIER = "default" as const;
export const AI05_JOB_TYPE = "interview_questions";
export const AI05_CALL_KEY = "interview_questions.generate";
/** First call + one regeneration of the remaining questions (card "1회 재생성" [가정]). */
export const AI05_MAX_ATTEMPTS = 2;
/** Output ≈ 3k tokens for 5 questions incl. reasoning (card 비용); 7 questions + headroom. */
export const AI05_MAX_OUTPUT_TOKENS = 10_000;
/** Same project as the primary target of at most 2 questions, same detail 1, same requirement 1 (4.1). */
export const MAX_PER_PROJECT = 2;
export const MAX_PER_DETAIL = 1;
export const MAX_PER_REQUIREMENT = 1;
const TEXT_MAX = 1000;
const SIGNAL_MAX = 300;
const MAX_SIGNALS = 10;

export { AI05_PROMPT_VERSION };

// ---------- context ----------

export type InterviewInsightSignal = {
  insightId: string;
  matches: ReadonlyArray<{ requirement_id: string; status: "met" | "partial" | "no_evidence"; missing_aspect: string | null }>;
};

export type InterviewQuestionContextInput = {
  interviewType: InterviewType;
  questionCount: QuestionCount;
  dataSufficiency: DataSufficiencyLevel;
  careerRows: CareerRows | null;
  asOf?: YearMonth;
  jobDescriptionId: string;
  jobDescriptionUpdatedAt: string | null;
  sentences: readonly JdSentence[];
  cultureSids: readonly string[];
  requirements: readonly JdRequirementInput[];
  positionTitle: string | null;
  insightSignal?: InterviewInsightSignal | null;
  recentQuestions?: readonly string[];
};

export type InterviewQuestionContext = {
  interviewType: InterviewType;
  questionCount: QuestionCount;
  dataSufficiency: DataSufficiencyLevel;
  base: InterviewBase;
  aliases: AliasMap;
  referenceText: string | null;
  /** Set only when the signal was actually put into the prompt (job). */
  insightId: string | null;
  recentQuestions: string[];
  rule: CompositionRule;
};

export function buildInterviewQuestionContext(input: InterviewQuestionContextInput): InterviewQuestionContext {
  const base = buildInterviewBase(input);
  const signal = input.interviewType === "job" ? (input.insightSignal ?? null) : null;
  let referenceText: string | null = null;
  if (signal) {
    const lines: string[] = [];
    for (const m of signal.matches) {
      const ref = base.aliases.aliasOf("jd_requirement", m.requirement_id);
      if (!ref || m.status === "met") continue;
      lines.push(`${ref} | ${m.status}${m.missing_aspect ? ` | 부족한 측면: ${escLine(m.missing_aspect)}` : ""}`);
    }
    if (lines.length) referenceText = ["<reference>", "최신 인사이트에서 근거가 약하다고 본 요건:", ...lines, "</reference>"].join("\n");
  }
  return {
    interviewType: input.interviewType,
    questionCount: input.questionCount,
    dataSufficiency: input.dataSufficiency,
    base,
    aliases: base.aliases,
    referenceText,
    insightId: referenceText && signal ? signal.insightId : null,
    recentQuestions: (input.recentQuestions ?? []).filter((q) => q.trim() !== "").slice(0, 20),
    rule: compositionRule(input.interviewType, input.questionCount),
  };
}

/** C-6 input_hash stored with each question (interview sets are not reused). */
export function computeInterviewQuestionsInputHash(context: InterviewQuestionContext, provider: ProviderId, model: string): string {
  return computeInputHash({
    feature: AI05_JOB_TYPE,
    promptVersion: AI05_PROMPT_VERSION,
    provider,
    model,
    careerSnapshotHash: context.base.careerSnapshotHash,
    requirementsHash: context.base.requirementsHash,
    params: {
      interview_type: context.interviewType,
      question_count: context.questionCount,
      data_sufficiency: context.dataSufficiency,
      insight_id: context.insightId,
    },
  });
}

// ---------- existing questions / acceptance state ----------

/** A question already saved (begin_interview_questions `existing_questions`, UUID form). */
export type ExistingInterviewQuestion = {
  sequence: number;
  source_kind: InterviewSourceKind;
  anchor: InterviewAnchor;
  question_text: string;
  target_requirement_ids: readonly string[];
  target_gap_requirement_ids: readonly string[];
  /** Optional: its evidence_links (source_type, source_id) → enables the per-project / per-detail duplicate rule across runs. */
  evidence_sources?: ReadonlyArray<{ source_type: string; source_id: string }>;
};

type Acceptance = {
  kinds: Partial<Record<InterviewSourceKind, number>>;
  projects: Map<string, number>;
  details: Set<string>;
  requirements: Set<string>;
  texts: Set<string>;
  accepted: number;
};

/** Primary project / detail alias of a question from its career evidence (first one wins). */
function primaryTargets(evidence: ReadonlyArray<{ source_type: string; ref: string }>, aliases: AliasMap): { project: string | null; detail: string | null } {
  for (const e of evidence) {
    if (!isCareerSupportEvidence(e)) continue;
    const entry = aliases.get(e.ref);
    if (!entry) continue;
    if (entry.sourceType === "project") return { project: entry.alias, detail: null };
    if (entry.sourceType === "project_detail") return { project: entry.parents[0] ?? null, detail: entry.alias };
    if (entry.sourceType === "achievement") {
      const parent = entry.parents[0] ? aliases.get(entry.parents[0]) : undefined;
      if (parent?.sourceType === "project_detail") return { project: parent.parents[0] ?? null, detail: parent.alias };
      continue;
    }
  }
  return { project: null, detail: null };
}

function emptyAcceptance(): Acceptance {
  return { kinds: {}, projects: new Map(), details: new Set(), requirements: new Set(), texts: new Set(), accepted: 0 };
}

function record(state: Acceptance, q: { kind: InterviewSourceKind; text: string; project: string | null; detail: string | null; requirement: string | null }): void {
  state.kinds[q.kind] = (state.kinds[q.kind] ?? 0) + 1;
  if (q.project) state.projects.set(q.project, (state.projects.get(q.project) ?? 0) + 1);
  if (q.detail) state.details.add(q.detail);
  if (q.requirement) state.requirements.add(q.requirement);
  state.texts.add(questionKey(q.text));
  state.accepted++;
}

function acceptanceFrom(existing: readonly ExistingInterviewQuestion[], aliases: AliasMap): Acceptance {
  const state = emptyAcceptance();
  for (const q of [...existing].sort((a, b) => a.sequence - b.sequence)) {
    const evidence: Array<{ source_type: string; ref: string }> = [];
    for (const s of q.evidence_sources ?? []) {
      const ref = isEvidenceSourceType(s.source_type) ? aliases.aliasOf(s.source_type, s.source_id) : undefined;
      if (ref) evidence.push({ source_type: s.source_type, ref });
    }
    const targets = primaryTargets(evidence, aliases);
    const requirement = q.target_requirement_ids[0] ?? q.target_gap_requirement_ids[0] ?? null;
    record(state, { kind: q.source_kind, text: q.question_text, project: targets.project, detail: targets.detail, requirement });
  }
  return state;
}

/** Empty slots of 1..count in ascending order (db: new questions fill the smallest empty sequence first). */
export function emptySequences(count: number, existing: readonly { sequence: number }[]): number[] {
  const used = new Set(existing.map((q) => q.sequence));
  const out: number[] = [];
  for (let s = 1; s <= count; s++) if (!used.has(s)) out.push(s);
  return out;
}

// ---------- per-question check ----------

/**
 * Whether a job question premises a fact of the user's career (4.1, A11).
 * project_deep_dive and requirement_fit always do. gap_probe does when it is
 * anchored on experience, cites factual career evidence, or names a career
 * proper noun in its text; otherwise it asks about the requirement without
 * assuming anything ("이 요건과 비슷한 경험이 있다면") and is exempt. [가정]
 * the evidence / proper-noun signals stand for "premises a fact" (spec gives
 * the rule, not the detection).
 */
export function premisesUserFacts(kind: InterviewSourceKind, anchor: InterviewAnchor, factualCareerEvidence: number, careerTermsInText: number): boolean {
  if (kind === "project_deep_dive" || kind === "requirement_fit") return true;
  if (kind !== "gap_probe") return false;
  return anchor === "experience" || factualCareerEvidence > 0 || careerTermsInText > 0;
}

export type QuestionDropReason =
  | "schema"
  | "kind_not_allowed"
  | "anchor_not_allowed"
  | "forbidden_topic"
  | "anchor_evidence_missing"
  | "kind_target_missing"
  | "fact_premise_unsupported"
  | "career_terms_in_non_experience"
  | "unsupported_numbers"
  | "duplicate_text"
  | "duplicate_project"
  | "duplicate_detail"
  | "duplicate_requirement"
  | "composition";

export type CheckedQuestion = {
  sourceKind: InterviewSourceKind;
  anchor: InterviewAnchor;
  text: string;
  intent: string;
  focusCriteria: string[];
  targetRequirementIds: string[];
  targetGapRequirementIds: string[];
  goodAnswerSignals: string[];
  evidence: ValidatedEvidence[];
  project: string | null;
  detail: string | null;
  requirement: string | null;
};

export type QuestionCheck = { ok: true; question: CheckedQuestion; report: Record<string, number> } | { ok: false; reason: QuestionDropReason; numbers?: string[]; report: Record<string, number> };

/**
 * One question through every per-question rule (pure). `relaxComposition`
 * (regeneration attempt) lets a set-composition miss through with a warning count.
 */
export function checkQuestion(
  raw: Ai05Question,
  context: InterviewQuestionContext,
  state: Acceptance,
  options: { relaxComposition: boolean },
): QuestionCheck {
  const report: Record<string, number> = {};
  const fail = (reason: QuestionDropReason, numbers?: string[]): QuestionCheck => ({ ok: false, reason, numbers, report });
  const { base, interviewType } = context;
  const aliases = base.aliases;
  const isJob = interviewType === "job";

  // Kind / anchor for the type (4.1).
  if (!context.rule.kinds.includes(raw.source_kind)) return fail("kind_not_allowed");
  const anchor = raw.anchor;
  if (isJob && anchor === "general") return fail("anchor_not_allowed");
  if (!isJob && anchor === "experience" && context.dataSufficiency === "none") return fail("anchor_not_allowed");

  // Aliases in prose → names (QA-S6-04). Done first: the checks below look at what is stored.
  const scrub = (t: string) => {
    const r = replaceAliasesInText(t, aliases, base.literalAliasTokens);
    addToReport(report, { aliases_replaced: r.stats.replaced, aliases_removed: r.stats.removed });
    return r.text;
  };
  const text = scrub(raw.text).slice(0, TEXT_MAX);
  if (text.trim() === "") return fail("schema");

  // C-7.
  if (findForbiddenTopics(text, raw.intent).length) return fail("forbidden_topic");

  // Evidence V-1..V-3, V-8. Culture experience anchor: learnings allowed only quoted as reflection (C-9).
  const learnings: LearningsPolicy = !isJob && anchor === "experience" && citesReflection(text) ? "reflection_only" : "forbidden";
  let rawEvidence: readonly ModelEvidence[] = raw.evidence;
  if (!isJob && anchor !== "experience") {
    // Not anchored on the user's data: only JD sentences may back it (general: none).
    const kept = anchor === "jd" ? raw.evidence.filter((e) => e.source_type === "jd_sentence") : [];
    addToReport(report, { evidence_dropped_off_anchor: raw.evidence.length - kept.length });
    rawEvidence = kept;
  }
  const checked = validateItem({ key: QUESTION_ITEM_KEY, kind: "reference", evidence: rawEvidence, learnings }, { aliases, learnings });
  addToReport(report, checked.report);
  const evidence = checked.outcome.evidence;
  // A10: profile wishes (희망 직무·관심 산업) are context, never a user fact.
  const career = evidence.filter((e) => isCareerSupportEvidence(e));
  const factualCareer = career.filter((e) => !isReflectionEvidence(e));

  // Anchor needs its evidence (4.1).
  if (anchor === "experience") {
    const support = isJob ? factualCareer : career;
    if (!support.length) return fail("anchor_evidence_missing");
  }
  if (!isJob && anchor === "jd" && !evidence.some((e) => e.source_type === "jd_sentence")) return fail("anchor_evidence_missing");

  // Requirement targets (job only; culture fit has none).
  const resolve = (refs: readonly string[], key: string) => {
    const ids: string[] = [];
    for (const ref of refs) {
      const id = aliases.resolveId(ref.trim(), "jd_requirement");
      if (!id) addToReport(report, { [key]: 1 });
      else if (!ids.includes(id)) ids.push(id);
    }
    return ids;
  };
  const targetIds = isJob ? resolve(raw.target_requirement_refs, "target_refs_dropped") : [];
  const gapIds = isJob ? resolve(raw.target_gap_requirement_refs, "target_refs_dropped") : [];
  if (!isJob && raw.target_requirement_refs.length + raw.target_gap_requirement_refs.length > 0) addToReport(report, { target_refs_dropped: 1 });

  // Kind needs its basis (4.1 table: project_deep_dive = action/result/성과, requirement_fit = 대상 요건, gap_probe = 보완 요건).
  const factBasis = factualCareer.some(isActionResultEvidence);
  if (raw.source_kind === "project_deep_dive" && !factBasis) return fail("kind_target_missing");
  if (raw.source_kind === "requirement_fit" && !targetIds.length) return fail("kind_target_missing");
  if (raw.source_kind === "gap_probe" && !gapIds.length) return fail("kind_target_missing");

  // 4.1 사실 전제 (v4.3, A11): every job question that premises a fact of the
  // user's career takes it only from a detail's action / result or an
  // achievement. requirement_fit always premises one; gap_probe does when it
  // points at the user's experience (anchor experience, career evidence, or a
  // career proper noun in the text). A gap_probe that only asks "if you had a
  // similar experience…" is exempt.
  if (isJob && premisesUserFacts(raw.source_kind, anchor, factualCareer.length, findCareerTerms(text, base.careerTerms).length) && !factBasis) {
    return fail("fact_premise_unsupported");
  }

  // Culture questions not anchored on experience assume no user facts (4.1).
  const nonExperienceCulture = !isJob && anchor !== "experience";
  if (nonExperienceCulture && findCareerTerms(text, base.careerTerms).length) return fail("career_terms_in_non_experience");

  // V-5 on the question text.
  const unsupported = findUnsupportedNumbers(text, nonExperienceCulture ? base.jdNumbers : base.allowedNumbers);
  if (unsupported.length) {
    addToReport(report, { number_violations: unsupported.length });
    return fail("unsupported_numbers", [...new Set(unsupported.map((m) => m.raw))]);
  }

  // Duplicates.
  const key = questionKey(text);
  if (state.texts.has(key) || context.recentQuestions.some((q) => questionKey(q) === key)) return fail("duplicate_text");
  const targets = primaryTargets(evidence, aliases);
  const requirement = targetIds[0] ?? gapIds[0] ?? null;
  if (isJob) {
    if (targets.project && (state.projects.get(targets.project) ?? 0) >= MAX_PER_PROJECT) return fail("duplicate_project");
    // MAX_PER_DETAIL = MAX_PER_REQUIREMENT = 1: any earlier use blocks.
    if (targets.detail && state.details.has(targets.detail)) return fail("duplicate_detail");
    if (requirement && state.requirements.has(requirement)) return fail("duplicate_requirement");
  }

  // Set composition (feasibility at each acceptance).
  const composition = canAccept(context.rule, state.kinds, context.questionCount, raw.source_kind);
  if (!composition.ok) {
    if (composition.reason === "kind_not_allowed" || !options.relaxComposition) return fail("composition");
    addToReport(report, { composition_relaxed: 1 });
  }

  // Internal prose: V-5 replacement (intent is revealed after submission) + aliases.
  const prose = (t: string, max: number) => {
    const g = guardNumbers(scrub(t), base.allowedNumbers);
    addToReport(report, { numbers_replaced: g.replaced });
    const out = g.text.trim();
    return out.length > max ? `${out.slice(0, max - 1)}…` : out;
  };
  const intent = prose(raw.intent, TEXT_MAX);
  const signals = raw.good_answer_signals.map((s) => prose(s, SIGNAL_MAX)).filter((s) => s !== "").slice(0, MAX_SIGNALS);

  return {
    ok: true,
    report,
    question: {
      sourceKind: raw.source_kind,
      anchor,
      text,
      intent: intent || "질문 의도를 정리하지 못했습니다.",
      focusCriteria: [...new Set(raw.focus_criteria)],
      targetRequirementIds: targetIds,
      targetGapRequirementIds: gapIds,
      goodAnswerSignals: signals,
      evidence,
      project: targets.project,
      detail: targets.detail,
      requirement,
    },
  };
}

// ---------- one call ----------

export type Ai05Deps = {
  llm: Llm;
  /** save_interview_question. Awaited before the next question is processed. */
  onQuestion: (payload: SaveInterviewQuestionPayload) => Promise<void>;
  signal?: AbortSignal;
  logger?: AiLogger;
  jobId?: string | null;
  now?: () => Date;
  callKey?: string;
};

export type InterviewQuestionsAttempt = {
  attempt: number;
  /** Saved by this call, in save order. */
  saved: SaveInterviewQuestionPayload[];
  totalSaved: number;
  /** questionCount − totalSaved. */
  remaining: number;
  /** weak_requirement_refs of this output → UUIDs, plus the gap targets of saved questions. */
  weakRequirementIds: string[];
  dropped: number;
  /** V-5: numbers that got questions dropped (pass to the next attempt). */
  unsupportedNumbers: string[];
  /** Unmet composition minima after this call (empty = fine). */
  missingKinds: Partial<Record<InterviewSourceKind, number>>;
  report: Record<string, number>;
  model: string;
  usage: NormalizedUsage;
  promptVersion: string;
};

/**
 * One provider call (streamed). New questions take the empty sequences of
 * 1..questionCount in ascending order. Attempt ≥ 1 is a regeneration:
 * composition is relaxed (warn and proceed) and the request carries what is
 * still needed. A truncated / invalid stream is not an error here: whatever
 * closed and passed is saved, the rest counts as remaining.
 */
export async function generateInterviewQuestions(
  input: {
    context: InterviewQuestionContext;
    existingQuestions?: readonly ExistingInterviewQuestion[];
    attempt?: number;
    /** V-5 feedback for a regeneration: numbers that got earlier questions dropped (InterviewQuestionsAttempt.unsupportedNumbers). */
    unsupportedNumbers?: readonly string[];
  },
  deps: Ai05Deps,
): Promise<InterviewQuestionsAttempt> {
  const { context } = input;
  const attempt = input.attempt ?? 0;
  const existing = (input.existingQuestions ?? []).filter((q) => q.sequence >= 1 && q.sequence <= context.questionCount);
  const slots = emptySequences(context.questionCount, existing);
  const state = acceptanceFrom(existing, context.aliases);
  const report: Record<string, number> = {};
  const now = deps.now ?? (() => new Date());
  const saved: SaveInterviewQuestionPayload[] = [];
  const weakIds = new Set<string>();
  const droppedNumbers = new Set<string>();
  const promptVersion = AI05_PROMPT_VERSION;
  const baseResult = (model: string, usage: NormalizedUsage, dropped: number): InterviewQuestionsAttempt => {
    for (const q of [...existing, ...saved.map((s) => ({ target_gap_requirement_ids: s.target_gap_requirement_ids }))]) {
      for (const id of q.target_gap_requirement_ids) weakIds.add(id);
    }
    return {
      attempt,
      saved,
      totalSaved: existing.length + saved.length,
      remaining: slots.length - saved.length,
      weakRequirementIds: [...weakIds],
      dropped,
      missingKinds: missingKinds(context.rule, state.kinds),
      unsupportedNumbers: [...droppedNumbers],
      report,
      model,
      usage,
      promptVersion,
    };
  };
  if (slots.length === 0) return baseResult(deps.llm.modelFor(AI05_TIER), UNAVAILABLE_USAGE, 0);

  const relax = attempt >= 1;
  const exhaustedProjects = [...state.projects.entries()].filter(([, n]) => n >= MAX_PER_PROJECT).map(([p]) => p);
  const usedReqs = [...state.requirements].map((id) => context.aliases.aliasOf("jd_requirement", id)).filter((a): a is string => !!a);
  const existingLines: Ai05ExistingLine[] = [...existing]
    .sort((a, b) => a.sequence - b.sequence)
    .map((q) => ({ order: q.sequence, sourceKind: q.source_kind, anchor: q.anchor, text: q.question_text }));

  const request = {
    feature: "AI-05.generate",
    promptVersion,
    callKey: deps.callKey ?? (attempt === 0 ? AI05_CALL_KEY : `${AI05_CALL_KEY}.${attempt + 1}`),
    tier: AI05_TIER,
    systemBlocks: systemBlocks(),
    userBlocks: generateUserBlocks({
      packText: context.base.pack.text,
      jdText: context.base.jdText,
      referenceText: context.referenceText,
      session: {
        interviewType: context.interviewType,
        questionCount: context.questionCount,
        dataSufficiency: context.dataSufficiency,
        recentQuestions: context.recentQuestions,
        existing: existingLines,
        requested: slots.length,
        neededKinds: existing.length ? missingKinds(context.rule, state.kinds) : undefined,
        avoidKinds: existing.length ? exhaustedKinds(context.rule, state.kinds) : undefined,
        avoidProjects: exhaustedProjects.map((p) => {
          const label = context.aliases.get(p)?.label;
          return label ? `'${escLine(label)}'` : p;
        }),
        avoidRequirements: usedReqs,
        unsupportedNumbers: input.unsupportedNumbers,
      },
    }),
    maxOutputTokens: AI05_MAX_OUTPUT_TOKENS,
    reasoningLevel: "low" as const,
    signal: deps.signal,
    outputSchema: toCanonicalJsonSchema(Ai05OutputSchema),
  };

  const parser = new IncrementalJsonParser();
  let dropped = 0;
  let model = deps.llm.modelFor(AI05_TIER);
  let usage: NormalizedUsage = UNAVAILABLE_USAGE;
  let streamOk = true;

  const handle = async (value: unknown) => {
    addToReport(report, { questions_total: 1 });
    if (saved.length >= slots.length) {
      addToReport(report, { questions_extra: 1 });
      return;
    }
    const parsed = Ai05QuestionSchema.safeParse(value);
    const check: QuestionCheck = parsed.success ? checkQuestion(parsed.data, context, state, { relaxComposition: relax }) : { ok: false, reason: "schema", report: {} };
    addToReport(report, check.report);
    if (!check.ok) {
      dropped++;
      addToReport(report, { questions_dropped: 1, [`dropped_${check.reason}`]: 1 });
      for (const n of check.numbers ?? []) droppedNumbers.add(n);
      return;
    }
    const q = check.question;
    const payload: SaveInterviewQuestionPayload = {
      sequence: slots[saved.length],
      source_kind: q.sourceKind,
      anchor: q.anchor,
      question_text: q.text,
      intent: q.intent,
      focus_criteria: q.focusCriteria,
      target_requirement_ids: q.targetRequirementIds,
      target_gap_requirement_ids: q.targetGapRequirementIds,
      good_answer_signals: q.goodAnswerSignals,
      hashes: {
        input_hash: computeInterviewQuestionsInputHash(context, deps.llm.provider, model),
        career_snapshot_hash: context.base.careerSnapshotHash,
      },
      meta: payloadMeta({
        schemaVersion: AI05_OUTPUT_SCHEMA_VERSION,
        promptVersion,
        provider: deps.llm.provider,
        model,
        modelTier: AI05_TIER,
        connectionTier: deps.llm.connectionTier,
        report: check.report,
        usage: null,
      }),
      evidence: toPayloadEvidence([{ itemKey: QUESTION_ITEM_KEY, evidence: q.evidence }], context.aliases, now()),
    };
    await deps.onQuestion(payload);
    record(state, { kind: q.sourceKind, text: q.text, project: q.project, detail: q.detail, requirement: q.requirement });
    saved.push(payload);
  };

  for await (const chunk of deps.llm.stream(request)) {
    if (chunk.type === "done") {
      model = chunk.result.model;
      usage = chunk.result.usage;
      break;
    }
    if (chunk.type === "error") throw chunk.error;
    let events: JsonEvent[];
    try {
      events = streamOk ? parser.push(chunk.text) : [];
    } catch (err) {
      if (!(err instanceof JsonStreamError)) throw err;
      streamOk = false;
      events = [];
    }
    for (const ev of events) {
      if (ev.type !== "close") continue;
      if (ev.kind === "object" && ev.path.length === 2 && ev.path[0] === "questions") await handle(ev.value);
      else if (ev.kind === "array" && ev.path.length === 1 && ev.path[0] === "weak_requirement_refs" && context.interviewType === "job") {
        for (const ref of (ev.value as unknown[]).filter((r): r is string => typeof r === "string")) {
          const id = context.aliases.resolveId(ref.trim(), "jd_requirement");
          if (id) weakIds.add(id);
          else addToReport(report, { weak_refs_dropped: 1 });
        }
      }
    }
  }

  // Whole-output checks (report only: questions are already saved).
  if (streamOk) {
    try {
      const whole = Ai05OutputSchema.safeParse(parser.end());
      if (!whole.success) addToReport(report, { output_schema_mismatch: 1 });
      else {
        if (whole.data.interview_type !== context.interviewType) addToReport(report, { interview_type_corrected: 1 });
        if (whole.data.data_sufficiency.level !== context.dataSufficiency) addToReport(report, { data_sufficiency_overridden: 1 });
      }
    } catch (err) {
      if (!(err instanceof JsonStreamError)) throw err;
      streamOk = false;
    }
  }
  if (!streamOk) addToReport(report, { stream_incomplete: 1 });
  if (context.interviewType === "culture_fit" && context.dataSufficiency === "ok") {
    const all = [...existing.map((q) => q.anchor), ...saved.map((s) => s.anchor)];
    if (all.length && all.filter((a) => a === "experience").length * 2 < all.length) addToReport(report, { experience_anchor_below_target: 1 });
  }

  const result = baseResult(model, usage, dropped);
  if (Object.keys(result.missingKinds).length && result.remaining === 0) addToReport(report, { composition_unmet: 1 });
  (deps.logger ?? silentAiLogger)({ event: "ai_validation", jobId: deps.jobId ?? null, feature: "AI-05", promptVersion, stats: { ...report } });
  return result;
}

/** Saved payload → the existing-question form the next attempt takes. */
export function toExistingQuestion(p: SaveInterviewQuestionPayload): ExistingInterviewQuestion {
  return {
    sequence: p.sequence,
    source_kind: p.source_kind,
    anchor: p.anchor,
    question_text: p.question_text,
    target_requirement_ids: p.target_requirement_ids,
    target_gap_requirement_ids: p.target_gap_requirement_ids,
    evidence_sources: p.evidence.map((e) => ({ source_type: e.source_type, source_id: e.source_id })),
  };
}

export type InterviewQuestionsRun = {
  attempts: InterviewQuestionsAttempt[];
  weakRequirementIds: string[];
  model: string;
  usage: NormalizedUsage;
  report: Record<string, number>;
};

/**
 * Convenience loop for one function run: attempt 0, then (if questions are
 * still missing) one regeneration of the remaining count. The api runner may
 * instead call generateInterviewQuestions once per step. Throws
 * AiError("schema_invalid", retryable: false) when questions are still
 * missing after AI05_MAX_ATTEMPTS (saved questions stay; "남은 질문 다시 만들기").
 */
export async function runInterviewQuestions(
  input: { context: InterviewQuestionContext; existingQuestions?: readonly ExistingInterviewQuestion[] },
  deps: Ai05Deps,
): Promise<InterviewQuestionsRun> {
  const attempts: InterviewQuestionsAttempt[] = [];
  let existing = [...(input.existingQuestions ?? [])];
  const weak = new Set<string>();
  const report: Record<string, number> = {};
  let usage: NormalizedUsage | null = null;
  for (let attempt = 0; attempt < AI05_MAX_ATTEMPTS; attempt++) {
    const prev = attempts[attempts.length - 1];
    const result = await generateInterviewQuestions({ context: input.context, existingQuestions: existing, attempt, unsupportedNumbers: prev?.unsupportedNumbers }, deps);
    attempts.push(result);
    for (const id of result.weakRequirementIds) weak.add(id);
    addToReport(report, result.report);
    usage = usage ? addUsage(usage, result.usage) : result.usage;
    existing = [...existing, ...result.saved.map(toExistingQuestion)];
    if (result.remaining === 0) break;
  }
  const last = attempts[attempts.length - 1];
  if (last.remaining > 0) throw new AiError("schema_invalid", { retryable: false });
  return { attempts, weakRequirementIds: [...weak], model: last.model, usage: usage ?? UNAVAILABLE_USAGE, report };
}

/**
 * Set-level record of one more generation call (A22): reports summed key by
 * key, usage summed (C-13). The job runner folds every attempt of the set
 * through this so the complete payload carries the whole set, not the last call.
 */
export function accumulateQuestionSetRecord(
  prev: { report: Record<string, number>; usage: NormalizedUsage | null; attempts: number } | null,
  attempt: { report: Record<string, number>; usage: NormalizedUsage | null },
): { report: Record<string, number>; usage: NormalizedUsage | null; attempts: number } {
  const report: Record<string, number> = { ...(prev?.report ?? {}) };
  addToReport(report, attempt.report);
  const usage = prev?.usage && attempt.usage ? addUsage(prev.usage, attempt.usage) : (attempt.usage ?? prev?.usage ?? null);
  return { report, usage, attempts: (prev?.attempts ?? 0) + 1 };
}

/**
 * complete_interview_questions.p_payload (no call). A22: the set-level
 * `validation_report` (counts: questions dropped and why, composition
 * warnings, `attempts` / `regenerated` when known) and `usage` go top-level
 * (→ interview_sessions.question_validation_report / question_usage); `meta`
 * keeps the same values for the existing job-meta path.
 */
export function buildCompleteInterviewQuestionsPayload(input: {
  context: InterviewQuestionContext;
  weakRequirementIds: readonly string[];
  existingWeakRequirementIds?: readonly string[];
  model: string;
  usage?: NormalizedUsage | null;
  report?: Record<string, number> | null;
  /** Generation calls that made the set (1 = no regeneration). Added to the report when given. */
  attempts?: number | null;
  provider: ProviderId;
  connectionTier: ConnectionTier;
}): CompleteInterviewQuestionsPayload {
  const valid = new Set([...input.context.aliases.values()].filter((e) => e.sourceType === "jd_requirement").map((e) => e.id));
  const weak = [...new Set([...(input.existingWeakRequirementIds ?? []), ...input.weakRequirementIds])].filter((id) => valid.has(id));
  let report: Record<string, number> | null = input.report ? { ...input.report } : null;
  if (input.attempts != null && input.attempts > 0) {
    report = { ...(report ?? {}), attempts: input.attempts, regenerated: input.attempts > 1 ? 1 : 0 };
  }
  const usage = input.usage ?? null;
  return {
    weak_requirement_ids: input.context.interviewType === "job" ? weak : [],
    insight_id: input.context.insightId,
    career_snapshot_hash: input.context.base.careerSnapshotHash,
    validation_report: report,
    usage,
    meta: payloadMeta({
      schemaVersion: AI05_OUTPUT_SCHEMA_VERSION,
      promptVersion: AI05_PROMPT_VERSION,
      provider: input.provider,
      model: input.model,
      modelTier: AI05_TIER,
      connectionTier: input.connectionTier,
      report,
      usage,
    }),
  };
}
