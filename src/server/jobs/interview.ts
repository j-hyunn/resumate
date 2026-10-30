import "server-only";
import { loadCareerRows } from "@/server/ai/context-pack/career-rows";
import { consoleAiLogger } from "@/server/ai/log";
import {
  AI05_MAX_ATTEMPTS,
  AI05_PROMPT_VERSION,
  AI05_TIER,
  accumulateQuestionSetRecord,
  buildCompleteInterviewQuestionsPayload,
  buildInterviewQuestionContext,
  generateInterviewQuestions,
  type ExistingInterviewQuestion,
  type InterviewQuestionContext,
} from "@/server/ai/pipelines/AI-05";
import {
  AI06_PROMPT_VERSION,
  AI06_TIER,
  buildAnswerEvaluationContext,
  evaluateAnswerOnce,
  finalizeAnswerEvaluation,
  regenerateModelAnswer,
  type AnswerEvaluationAttempt,
  type AnswerEvaluationContext,
} from "@/server/ai/pipelines/AI-06";
import { summarizeSession } from "@/server/ai/pipelines/AI-07";
import type { InterviewAnchor, InterviewSourceKind } from "@/server/ai/schemas/interview-common";
import { createInterviewStore } from "@/server/services/interview/db";
import {
  createInterviewEvaluationJobDefinition,
  createInterviewQuestionsJobDefinition,
  type InterviewJdExtractor,
  type InterviewPipelines,
  type QuestionsSnapshot,
} from "@/server/services/interview/job";
import { productionInsightJdExtractor } from "./insight";
import { logJobEvent } from "./log";

/**
 * Production wiring of the S8 interview jobs: the ai-pipeline AI-05 / 06 / 07
 * functions behind the jobs' narrow pipeline interface (ids, never aliases),
 * D-30 extraction with the current run's provider (same as the S6 insight job).
 */

/**
 * QA-S8-04: buildCompleteInterviewQuestionsPayload reads only these context
 * fields (interviewType, insightId, base.careerSnapshotHash, the requirement
 * aliases' ids), so the generation-time snapshot stands in for the context.
 */
function snapshotContext(s: QuestionsSnapshot): InterviewQuestionContext {
  const aliases = s.requirementIds.map((id) => ({ sourceType: "jd_requirement", id }));
  return {
    interviewType: s.interviewType,
    insightId: s.insightId,
    base: { careerSnapshotHash: s.careerSnapshotHash },
    aliases: { values: () => aliases.values() },
  } as unknown as InterviewQuestionContext;
}

export const productionInterviewPipelines: InterviewPipelines<InterviewQuestionContext, AnswerEvaluationContext> = {
  questions: {
    promptVersion: AI05_PROMPT_VERSION,
    tier: AI05_TIER,
    maxAttempts: AI05_MAX_ATTEMPTS,
    buildContext: (input) =>
      buildInterviewQuestionContext({
        interviewType: input.interviewType,
        questionCount: input.questionCount,
        dataSufficiency: input.dataSufficiency,
        careerRows: input.careerRows,
        jobDescriptionId: input.jd.jobDescriptionId,
        jobDescriptionUpdatedAt: input.jd.updatedAt,
        sentences: input.jd.sentences,
        cultureSids: input.jd.cultureSids,
        requirements: input.jd.requirements,
        positionTitle: input.jd.positionTitle,
        insightSignal: input.insightSignal,
        recentQuestions: input.recentQuestions,
      }),
    async generate(input, deps) {
      const r = await generateInterviewQuestions(
        {
          context: input.context,
          existingQuestions: input.existing.map(
            (q): ExistingInterviewQuestion => ({ ...q, source_kind: q.source_kind as InterviewSourceKind, anchor: q.anchor as InterviewAnchor }),
          ),
          attempt: input.attempt,
          unsupportedNumbers: input.unsupportedNumbers,
        },
        { llm: deps.llm, signal: deps.signal, jobId: deps.jobId, callKey: deps.callKey, logger: consoleAiLogger, onQuestion: (p) => deps.onQuestion(p) },
      );
      return {
        remaining: r.remaining,
        weakRequirementIds: r.weakRequirementIds,
        model: r.model,
        usage: r.usage,
        report: r.report,
        unsupportedNumbers: r.unsupportedNumbers,
      };
    },
    snapshot: (context) => ({
      interviewType: context.interviewType,
      insightId: context.insightId,
      careerSnapshotHash: context.base.careerSnapshotHash,
      requirementIds: [...context.aliases.values()].filter((e) => e.sourceType === "jd_requirement").map((e) => e.id),
    }),
    accumulate: (prev, attempt) =>
      accumulateQuestionSetRecord(prev as Parameters<typeof accumulateQuestionSetRecord>[0], {
        report: attempt.report,
        usage: (attempt.usage ?? null) as Parameters<typeof accumulateQuestionSetRecord>[1]["usage"],
      }),
    completePayload: (input) =>
      buildCompleteInterviewQuestionsPayload({
        context: snapshotContext(input.snapshot),
        weakRequirementIds: input.run.weakRequirementIds,
        existingWeakRequirementIds: input.existingWeakRequirementIds,
        model: input.run.model,
        usage: (input.run.usage ?? null) as Parameters<typeof buildCompleteInterviewQuestionsPayload>[0]["usage"],
        report: input.run.report,
        attempts: input.run.attempts,
        provider: input.provider,
        connectionTier: input.connectionTier,
      }),
  },
  evaluation: {
    promptVersion: AI06_PROMPT_VERSION,
    tier: AI06_TIER,
    buildContext: (input) =>
      buildAnswerEvaluationContext({
        interviewType: input.interviewType,
        dataSufficiency: input.dataSufficiency,
        careerRows: input.careerRows,
        jobDescriptionId: input.jd.jobDescriptionId,
        jobDescriptionUpdatedAt: input.jd.updatedAt,
        sentences: input.jd.sentences,
        cultureSids: input.jd.cultureSids,
        requirements: input.jd.requirements,
        positionTitle: input.jd.positionTitle,
        question: {
          id: input.question.id,
          sequence: input.question.sequence,
          question_text: input.question.question_text,
          source_kind: input.question.source_kind,
          anchor: input.question.anchor as InterviewAnchor,
          intent: input.question.intent,
          focus_criteria: input.question.focus_criteria,
          good_answer_signals: input.question.good_answer_signals,
          target_requirement_ids: input.question.target_requirement_ids,
          evidence: input.question.evidence.map((e) => ({ source_type: e.source_type, source_id: e.source_id, source_field: e.source_field, sid: e.sid })),
        },
        answer: input.answer,
      }),
    evaluateFirst: (input, deps) =>
      evaluateAnswerOnce({ context: input.context }, { llm: deps.llm, signal: deps.signal, jobId: deps.jobId, callKey: deps.callKey, logger: consoleAiLogger }),
    regenerate: (input, deps) =>
      regenerateModelAnswer(
        { context: input.context, violations: input.violations },
        { llm: deps.llm, signal: deps.signal, jobId: deps.jobId, callKey: deps.callKey, logger: consoleAiLogger },
      ),
    finalize: (input) => {
      const r = finalizeAnswerEvaluation({
        context: input.context,
        first: input.first as unknown as AnswerEvaluationAttempt,
        regen: (input.regen ?? null) as unknown as AnswerEvaluationAttempt | null,
        provider: input.provider,
        connectionTier: input.connectionTier,
        now: new Date(),
        logger: consoleAiLogger,
        jobId: input.jobId,
      });
      return { payload: r.payload };
    },
    async summarize(input, deps) {
      const r = await summarizeSession(input as Parameters<typeof summarizeSession>[0], {
        llm: deps.llm,
        signal: deps.signal,
        jobId: deps.jobId,
        callKey: deps.callKey,
        logger: consoleAiLogger,
      });
      return { payload: r.payload };
    },
  },
};

export const productionInterviewJdExtractor: InterviewJdExtractor = productionInsightJdExtractor;

const deps = {
  pipelines: productionInterviewPipelines,
  storeFor: createInterviewStore,
  ensureJd: productionInterviewJdExtractor,
  loadCareerRows,
  log: logJobEvent,
};

export const interviewQuestionsJobDefinition = createInterviewQuestionsJobDefinition(deps);
export const interviewEvaluationJobDefinition = createInterviewEvaluationJobDefinition(deps);

export const INTERVIEW_PROMPT_VERSIONS = { questions: AI05_PROMPT_VERSION, evaluation: AI06_PROMPT_VERSION } as const;
