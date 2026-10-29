import { AliasMap } from "../context-pack/aliases";
import { WHOLE_SOURCE_FIELD } from "../evidence-rules";
import { hashCanonical } from "../hash";
import { computeInputHash } from "../input-hash";
import type { Llm } from "../llm";
import { silentAiLogger, type AiLogger } from "../log";
import { AI07_PROMPT_VERSION, summarizeUserBlocks, systemBlocks, type Ai07QuestionLine } from "../prompts/AI-07";
import type { NormalizedUsage } from "../providers/types";
import { AI07_OUTPUT_SCHEMA_VERSION, Ai07OutputSchema, type Ai07Output, type Ai07Point } from "../schemas/AI-07";
import {
  CRITERIA_GRADES,
  CRITERIA_KEYS,
  pendingScore,
  questionRef,
  type DataSufficiencyLevel,
  type InterviewAnchor,
  type InterviewType,
} from "../schemas/interview-common";
import { payloadMeta, type CriteriaSummaryItem, type SaveSessionFeedbackPayload, type SessionPoint, type StoredAnswerEvaluation, type StoredSessionFeedback } from "../storage/interview";
import { generateStructured } from "../structured";
import { replaceAliasesInText } from "../validation/alias-text";
import { addToReport } from "../validation/draft-blocks";

/**
 * AI-07 세션 종합 피드백 (F-P3-06, F-P3-07). Last call of the
 * `interview_evaluation` job, default tier, medium reasoning. No career pack.
 *
 * Server rules (card):
 * - question_refs: this session's evaluated questions only (V-1); refs to
 *   unanswered or not-evaluated questions are removed; a point left with no
 *   ref is dropped (V-4, "강점·약점 각각 질문 ref 1개 이상")
 * - no content about unanswered questions: a strength / weakness / non-retry
 *   practice that names an unanswered question is dropped; `unanswered_note`
 *   is server text ("미응답 N문항")
 * - criteria_summary and the session score (pending_method, counted /
 *   unanswered counts) are server values
 * - Q-n / REQ-n in prose become "n번 질문" / requirement text
 */

export const AI07_TIER = "default" as const;
export const AI07_CALL_KEY = "interview_evaluation.summarize";
export const AI07_MAX_OUTPUT_TOKENS = 8192;
export { AI07_PROMPT_VERSION };

export type SessionQuestionInput = {
  id: string;
  sequence: number;
  question_text: string;
  source_kind: string;
  anchor: InterviewAnchor;
  intent: string | null;
  target_requirement_ids: readonly string[];
  answer_status: "submitted" | "unanswered";
  /** answer_evaluations.result of a succeeded evaluation; null = not evaluated (failed). Model answers are not sent. */
  evaluation: Pick<StoredAnswerEvaluation, "criteria" | "strengths" | "improvements"> | null;
};

export type SummarizeSessionInput = {
  interviewType: InterviewType;
  dataSufficiency: DataSufficiencyLevel;
  questions: readonly SessionQuestionInput[];
  /** Session weak requirements + question targets (id, content) → REQ-n. */
  requirements: ReadonlyArray<{ id: string; content: string }>;
  weakRequirementIds: readonly string[];
  /** interview_sessions.career_snapshot_hash (hashes.career_snapshot_hash). */
  careerSnapshotHash: string;
};

export type Ai07Deps = {
  llm: Llm;
  signal?: AbortSignal;
  logger?: AiLogger;
  jobId?: string | null;
  now?: () => Date;
  callKey?: string;
};

export type SessionFeedbackResult = {
  payload: SaveSessionFeedbackPayload;
  report: Record<string, number>;
  usage: NormalizedUsage;
  model: string;
  attempts: number;
};

/** Server criteria_summary: grade counts per key over evaluated answers. */
export function computeCriteriaSummary(evaluations: ReadonlyArray<Pick<StoredAnswerEvaluation, "criteria">>): CriteriaSummaryItem[] {
  return CRITERIA_KEYS.map((key) => {
    const distribution = Object.fromEntries(CRITERIA_GRADES.map((g) => [g, 0])) as CriteriaSummaryItem["distribution"];
    for (const e of evaluations) {
      const c = e.criteria.find((x) => x.key === key);
      if (c && (CRITERIA_GRADES as readonly string[]).includes(c.grade)) distribution[c.grade as keyof CriteriaSummaryItem["distribution"]]++;
    }
    return { key, distribution };
  });
}

type QState = { id: string; sequence: number; ref: string; status: Ai07QuestionLine["status"] };

export type SessionContext = {
  input: SummarizeSessionInput;
  questions: QState[];
  byRef: Map<string, QState>;
  requirementAliases: AliasMap;
  criteriaSummary: CriteriaSummaryItem[];
  evaluatedCount: number;
  unansweredCount: number;
};

export function buildSessionContext(input: SummarizeSessionInput): SessionContext {
  const questions: QState[] = [...input.questions]
    .sort((a, b) => a.sequence - b.sequence)
    .map((q) => ({
      id: q.id,
      sequence: q.sequence,
      ref: questionRef(q.sequence),
      status: q.answer_status === "unanswered" ? "unanswered" : q.evaluation ? "answered" : "evaluation_failed",
    }));
  const requirementAliases = new AliasMap();
  input.requirements.forEach((r, i) =>
    requirementAliases.add({ alias: `REQ-${i + 1}`, sourceType: "jd_requirement", id: r.id, fields: { [WHOLE_SOURCE_FIELD]: r.content }, snapshotAt: null, label: r.content, parents: [] }),
  );
  const evaluations = input.questions.filter((q) => q.answer_status === "submitted" && q.evaluation).map((q) => q.evaluation as NonNullable<SessionQuestionInput["evaluation"]>);
  return {
    input,
    questions,
    byRef: new Map(questions.map((q) => [q.ref, q])),
    requirementAliases,
    criteriaSummary: computeCriteriaSummary(evaluations),
    evaluatedCount: evaluations.length,
    unansweredCount: questions.filter((q) => q.status === "unanswered").length,
  };
}

const Q_TOKEN = /\bQ-(\d+)\b/g;
/** "n번 질문" mentions in prose (the prompt asks for this form). */
const NTH_QUESTION = /(\d+)\s*번\s*(?:질문|문항)/g;

/** Sequences of the questions a text names (Q-n or "n번 질문"). */
export function mentionedSequences(text: string): number[] {
  const out = new Set<number>();
  for (const m of text.matchAll(Q_TOKEN)) out.add(Number(m[1]));
  for (const m of text.matchAll(NTH_QUESTION)) out.add(Number(m[1]));
  return [...out];
}

/** Pure validation → stored result. */
export function validateSessionFeedback(output: Ai07Output, ctx: SessionContext): { result: StoredSessionFeedback; report: Record<string, number> } {
  const report: Record<string, number> = {};
  const unanswered = new Set(ctx.questions.filter((q) => q.status === "unanswered").map((q) => q.sequence));
  const prose = (t: string) => {
    const withQ = t.replace(Q_TOKEN, (_m, n) => `${n}번 질문`);
    const r = replaceAliasesInText(withQ, ctx.requirementAliases);
    addToReport(report, { aliases_replaced: r.stats.replaced, aliases_removed: r.stats.removed });
    return r.text.trim();
  };
  const namesUnanswered = (t: string) => mentionedSequences(t).some((n) => unanswered.has(n));

  const points = (list: readonly Ai07Point[], kind: "strengths" | "weaknesses"): SessionPoint[] => {
    const out: SessionPoint[] = [];
    for (const p of list) {
      const ids: string[] = [];
      for (const raw of p.question_refs) {
        const q = ctx.byRef.get(raw.trim());
        if (!q) addToReport(report, { question_refs_removed_unknown: 1 });
        else if (q.status !== "answered") addToReport(report, { question_refs_removed_not_evaluated: 1 });
        else if (!ids.includes(q.id)) ids.push(q.id);
      }
      if (!ids.length) {
        addToReport(report, { items_dropped: 1, [`${kind}_dropped_no_refs`]: 1 });
        continue;
      }
      if (namesUnanswered(p.text)) {
        addToReport(report, { items_dropped: 1, [`${kind}_dropped_unanswered_mention`]: 1 });
        continue;
      }
      out.push({ text: prose(p.text), question_ids: ids, related_criteria: [...new Set(p.related_criteria)] });
    }
    return out.slice(0, 3);
  };

  const practice: StoredSessionFeedback["next_practice"] = [];
  for (const n of output.next_practice) {
    const q = n.question_ref ? ctx.byRef.get(n.question_ref.trim()) : undefined;
    if (n.question_ref && !q) addToReport(report, { question_refs_removed_unknown: 1 });
    let questionId: string | null = q?.id ?? null;
    if (n.type === "add_data" && q && q.status !== "answered") {
      // add_data points at experience said in an answer: only an evaluated answer qualifies.
      addToReport(report, { question_refs_removed_not_evaluated: 1 });
      questionId = null;
    }
    if (n.type !== "retry_question" && namesUnanswered(n.text)) {
      addToReport(report, { next_practice_dropped_unanswered_mention: 1 });
      continue;
    }
    const requirementIds: string[] = [];
    for (const ref of n.requirement_refs) {
      const id = ctx.requirementAliases.resolveId(ref.trim(), "jd_requirement");
      if (!id) addToReport(report, { requirement_refs_dropped: 1 });
      else if (!requirementIds.includes(id)) requirementIds.push(id);
    }
    const text = prose(n.text);
    if (!text) continue;
    practice.push({
      type: n.type,
      text,
      requirement_ids: n.type === "focus_session" ? requirementIds : [],
      interview_type: n.type === "focus_session" ? (n.interview_type ?? ctx.input.interviewType) : null,
      question_id: n.type === "focus_session" ? null : questionId,
    });
  }

  let headline = prose(output.headline);
  if (namesUnanswered(headline)) {
    addToReport(report, { headline_replaced_unanswered_mention: 1 });
    headline = "";
  }
  if (!headline) headline = "답변별 평가를 바탕으로 다음 연습 방향을 정리했습니다.";

  if (output.session_score.status !== "pending_method" || output.session_score.value !== null) addToReport(report, { score_overridden: 1 });
  const unansweredList = [...unanswered].sort((a, b) => a - b);
  return {
    report,
    result: {
      schema_version: AI07_OUTPUT_SCHEMA_VERSION,
      headline,
      overall_strengths: points(output.overall_strengths, "strengths"),
      overall_weaknesses: points(output.overall_weaknesses, "weaknesses"),
      unanswered_note: unansweredList.length ? `미응답 ${unansweredList.length}문항(${unansweredList.map((n) => `${n}번`).join(", ")} 질문)은 답변이 없어 평가하지 않았습니다.` : null,
      next_practice: practice.slice(0, 3),
      criteria_summary: ctx.criteriaSummary,
      session_score: { ...pendingScore(), counted_questions: ctx.evaluatedCount, unanswered_count: ctx.unansweredCount },
    },
  };
}

export async function summarizeSession(input: SummarizeSessionInput, deps: Ai07Deps): Promise<SessionFeedbackResult> {
  const ctx = buildSessionContext(input);
  if (ctx.evaluatedCount === 0) throw new Error("summarizeSession: no evaluated answer (AI-07 is not called then)");
  const weak = new Set(input.weakRequirementIds);
  const reqRef = (id: string) => ctx.requirementAliases.aliasOf("jd_requirement", id);
  const byId = new Map(input.questions.map((q) => [q.id, q]));
  const lines: Ai07QuestionLine[] = ctx.questions.map((qs) => {
    const q = byId.get(qs.id) as SessionQuestionInput;
    const ev = qs.status === "answered" ? q.evaluation : null;
    return {
      ref: qs.ref,
      sourceKind: q.source_kind,
      anchor: q.anchor,
      text: q.question_text,
      intent: q.intent,
      targetRequirementRefs: q.target_requirement_ids.map(reqRef).filter((r): r is string => !!r),
      status: qs.status,
      criteria: ev ? ev.criteria.map((c) => ({ key: c.key, grade: c.grade, reason: c.reason })) : [],
      strengths: ev ? ev.strengths.map((s) => s.text) : [],
      improvements: ev ? ev.improvements.map((i) => `${i.text} — ${i.how}`) : [],
    };
  });

  const structured = await generateStructured(
    deps.llm,
    {
      feature: "AI-07.summarize",
      promptVersion: AI07_PROMPT_VERSION,
      callKey: deps.callKey ?? AI07_CALL_KEY,
      tier: AI07_TIER,
      systemBlocks: systemBlocks(),
      userBlocks: summarizeUserBlocks({
        interviewType: input.interviewType,
        dataSufficiency: input.dataSufficiency,
        requirements: input.requirements.map((r, i) => ({ ref: `REQ-${i + 1}`, content: r.content, weak: weak.has(r.id) })),
        questions: lines,
        criteriaSummary: ctx.criteriaSummary,
      }),
      maxOutputTokens: AI07_MAX_OUTPUT_TOKENS,
      reasoningLevel: "medium",
      signal: deps.signal,
    },
    Ai07OutputSchema,
  );

  const { result, report } = validateSessionFeedback(structured.value, ctx);
  const payload: SaveSessionFeedbackPayload = {
    result,
    hashes: {
      input_hash: computeInputHash({
        feature: "interview_evaluation",
        promptVersion: AI07_PROMPT_VERSION,
        provider: deps.llm.provider,
        model: structured.meta.model,
        careerSnapshotHash: input.careerSnapshotHash,
        requirementsHash: null,
        params: { digest: hashCanonical({ lines, weak: [...weak].sort() }) },
      }),
      career_snapshot_hash: input.careerSnapshotHash,
    },
    meta: payloadMeta({
      schemaVersion: AI07_OUTPUT_SCHEMA_VERSION,
      promptVersion: AI07_PROMPT_VERSION,
      provider: deps.llm.provider,
      model: structured.meta.model,
      modelTier: AI07_TIER,
      connectionTier: deps.llm.connectionTier,
      report,
      usage: structured.meta.usage,
    }),
    evidence: [],
  };
  (deps.logger ?? silentAiLogger)({ event: "ai_validation", jobId: deps.jobId ?? null, feature: "AI-07", promptVersion: AI07_PROMPT_VERSION, stats: { ...report } });
  return { payload, report, usage: structured.meta.usage, model: structured.meta.model, attempts: structured.attempts };
}
