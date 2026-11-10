import {
  renderDocumentState,
  renderFacts,
  renderOtherQuestions,
  renderQuestions,
  renderUserSources,
  selectDraftBatch,
  type CoverLetterChatContext,
  type CoverLetterQuestionContext,
} from "../context-pack/cover-letter-chat";
import { AiError, ProviderError, isAiError } from "../errors";
import type { Llm } from "../llm";
import { silentAiLogger, type AiLogger } from "../log";
import {
  AI04_ADJUST_PROMPT_VERSION,
  AI04_EXTRACT_PROMPT_VERSION,
  AI04_PROMPT_VERSION,
  AI04_REPLY_PROMPT_VERSION,
  adjustUserBlocks,
  composeUserBlocks,
  extractSystemBlocks,
  extractUserBlocks,
  replySystemBlocks,
  replyUserBlocks,
  systemBlocks,
  type ReplyNotice,
} from "../prompts/AI-04";
import { toCanonicalJsonSchema } from "../providers/schema";
import { addUsage, type AiCallResult, type NormalizedUsage } from "../providers/types";
import {
  Ai04AdjustOutputSchema,
  Ai04ComposeOutputSchema,
  Ai04ExtractOutputSchema,
  Ai04ParagraphSchema,
  Ai04SourceSchema,
  type Ai04ComposeOutput,
  type Ai04Paragraph,
  type Ai04QuestionOutput,
  type CoverLetterTone,
} from "../schemas/AI-04";
import type { CoverLetterBlock, StoredSource } from "../schemas/cover-letter-draft";
import { draftPatch, factsPatch, type CoverLetterDraftBodyInput, type CoverLetterPatch } from "../storage/cover-letter-patch";
import { IncrementalJsonParser, JsonStreamError } from "../streaming/json-incremental";
import type { SelectedSourceView } from "../streaming/events";
import { generateStructured } from "../structured";
import { droppedTitleNotice, validateAnswerTitle } from "../validation/answer-title";
import { addToReport, emptyDraftReport, type DraftReport } from "../validation/draft-blocks";
import { isLengthOutOfRange, lengthTarget } from "../validation/drafts";
import {
  checkQuestionParagraphs,
  toStoredSources,
  emptyFactsReport,
  resolveQuestionClass,
  validateCoverLetterFacts,
  validateSources,
  type CoverLetterFactsReport,
  type CoverLetterFactsResult,
  type ValidatedSource,
} from "../validation/cover-letter";
import type { ValidatedEvidence } from "../validation/evidence";

/**
 * AI-04 자소서 문항 답변 작성 AI 채팅 (AI spec v4.15 AI-04, C-15) — 서류 턴
 * 파이프라인. 러너(api-engineer)가 부르는 **순수 async 함수**다: 요청·쿠키·DB·
 * `after()`를 모르고, 재시도 정책은 러너의 몫(C-11.3)이다.
 *
 * 질문 턴: `extract` ∥ `reply` (무료 등급은 reply → extract, C-12).
 * 초안 턴: `extract` → 패치 적용 → 컨텍스트 재조립 → `compose`(문항 ≤ 3을 한
 *          호출로) → 필요한 문항만 `adjust_length` 1회 → 서버 검증 → 답변 제목
 *          검증 → 패치. 응답 호출은 없고 AI 메시지는 서버 고정 문구다.
 *
 * 이 파일은 `application_documents`를 쓰지 않는다 (NFR-AI-05) — 제안은
 * `apply_structured_draft_patch`로만 저장되고, 정본은 사용자가 "저장하기"를
 * 눌러 `save_application_document`로 확정한다.
 */

export const AI04_EXTRACT_TIER = "light" as const;
export const AI04_REPLY_TIER = "default" as const;
export const AI04_COMPOSE_TIER = "default" as const;
export const AI04_JOB_TYPE = "cover_letter";
export const AI04_FEATURE = "cover_letter";

/** C-13: `call_key = cover_letter.turn.{n}.{extract|reply|compose|adjust_length}`. */
export function coverLetterCallKey(turn: number, call: "extract" | "reply" | "compose" | "adjust_length"): string {
  return `cover_letter.turn.${turn}.${call}`;
}

export const AI04_EXTRACT_MAX_OUTPUT_TOKENS = 4096;
export const AI04_REPLY_MAX_OUTPUT_TOKENS = 2048;
/** 3문항 × (본문 + 근거 JSON + 사고) ≈ 5~7k (7.2); 여유를 둔다. */
export const AI04_COMPOSE_MAX_OUTPUT_TOKENS = 16000;
export const AI04_ADJUST_MAX_OUTPUT_TOKENS = 12000;
/** [가정] 초안 호출은 턴당 최대 2회 (V-6 스키마 재시도 1회, 60초 예산 C-6). */
export const AI04_COMPOSE_MAX_CALLS = 2;

export const DRAFT_READY_MESSAGE = (nos: readonly number[]) =>
  `${nos.length === 1 ? `${nos[0]}번` : `${nos[0]}~${nos[nos.length - 1]}번`} 문항 초안을 만들었어요. 문항마다 확인하고 반영해 주세요.`;
export const DRAFT_EMPTY_MESSAGE = "초안을 만들 내용이 아직 부족해요.";
export const droppedBlocksSuffix = (n: number) => ` 확인되지 않은 문장 ${n}개는 뺐어요.`;
export const charAdjustSuffix = (nos: readonly number[]) => ` ${nos.join("·")}번 문항은 글자 수를 더 맞춰야 해요.`;

export { AI04_PROMPT_VERSION, AI04_ADJUST_PROMPT_VERSION, AI04_EXTRACT_PROMPT_VERSION, AI04_REPLY_PROMPT_VERSION };

export type Ai04Deps = {
  llm: Llm;
  /** `ai_usage_records.call_key` (C-13); the runner passes the turn-numbered key. */
  callKey?: string;
  adjustCallKey?: string;
  signal?: AbortSignal;
  logger?: AiLogger;
  jobId?: string | null;
  now?: () => Date;
};

// ---------------------------------------------------------------------------
// turn plan
// ---------------------------------------------------------------------------

export type CoverLetterTurnPlan =
  | { kind: "question" }
  | { kind: "compose"; source: "requested_action" | "text" }
  /** `requested_action = compose_draft` at draft_count ≥ 6: 사용자 메시지를 저장하기 전에 거절 (writing_chat_draft_limit_reached, 409). */
  | { kind: "reject_draft_limit" };

export function planCoverLetterTurn(ctx: CoverLetterChatContext): CoverLetterTurnPlan {
  if (ctx.composeRequested === "requested_action") return ctx.draftLimitReached ? { kind: "reject_draft_limit" } : { kind: "compose", source: "requested_action" };
  if (ctx.composeRequested === "text") return { kind: "compose", source: "text" };
  return { kind: "question" };
}

export type ComposeDecision = { action: "compose"; batch: CoverLetterQuestionContext[] } | { action: "reply"; notices: ReplyNotice[] };

/**
 * 초안을 돌릴 수 있는지 (패치가 저장된 뒤 재조립한 컨텍스트로 판정한다):
 * 자유 문장 요청이 정리에서 확인되지 않으면 질문 턴, 초안 6회를 쓰면
 * `draft_limit`, 문항이 없으면 `compose_insufficient`.
 * **데이터 최소 기준(D-01)은 러너가 본다**(C-1, 게이트).
 */
export function composeDecision(
  ctx: CoverLetterChatContext,
  plan: CoverLetterTurnPlan,
  extracted: Pick<CoverLetterFactsResult, "intent"> | null,
): ComposeDecision {
  if (plan.kind !== "compose") return { action: "reply", notices: [] };
  if (plan.source === "text" && extracted?.intent !== "compose_draft") return { action: "reply", notices: [] };
  if (ctx.draftLimitReached) return { action: "reply", notices: ["draft_limit"] };
  const batch = selectDraftBatch(ctx);
  if (batch.length === 0) return { action: "reply", notices: ["compose_insufficient"] };
  return { action: "compose", batch };
}

// ---------------------------------------------------------------------------
// extract (정리)
// ---------------------------------------------------------------------------

export type CoverLetterExtractResult = {
  /** 새 사용자 발화가 없으면 호출하지 않는다. */
  skipped: boolean;
  patch: CoverLetterPatch;
  intent: "compose_draft" | null;
  tone: CoverLetterTone | null;
  /** 패치 적용 뒤 `mark_writing_chat_extracted(p_sequence)`. */
  processedThroughSequence: number | null;
  sensitiveAdded: number;
  report: CoverLetterFactsReport;
  promptVersion: string;
  meta: AiCallResult | null;
  attempts: number;
};

function dataBlocks(ctx: CoverLetterChatContext, batch: readonly CoverLetterQuestionContext[], factsMode: "usable" | "all") {
  return {
    factsText: renderFacts(ctx, factsMode),
    documentStateText: renderDocumentState(ctx),
    questionsText: renderQuestions(batch.length ? batch : ctx.questions),
    otherQuestionsText: renderOtherQuestions(ctx, batch),
    userSourcesText: renderUserSources(ctx, batch.length ? batch : ctx.questions),
  };
}

export async function extract(ctx: CoverLetterChatContext, deps: Ai04Deps): Promise<CoverLetterExtractResult> {
  if (ctx.processThroughSequence === null) {
    return {
      skipped: true,
      patch: { ops: [] },
      intent: null,
      tone: null,
      processedThroughSequence: null,
      sensitiveAdded: 0,
      report: emptyFactsReport(),
      promptVersion: AI04_EXTRACT_PROMPT_VERSION,
      meta: null,
      attempts: 0,
    };
  }
  const data = dataBlocks(ctx, ctx.questions, "all");
  const { value, meta, attempts } = await generateStructured(
    deps.llm,
    {
      feature: "AI-04.extract",
      promptVersion: AI04_EXTRACT_PROMPT_VERSION,
      callKey: deps.callKey ?? coverLetterCallKey(1, "extract"),
      tier: AI04_EXTRACT_TIER,
      systemBlocks: extractSystemBlocks(),
      userBlocks: extractUserBlocks(ctx.chatBlocks, data, { pendingMessageAliases: [...ctx.pendingAliases] }),
      maxOutputTokens: AI04_EXTRACT_MAX_OUTPUT_TOKENS,
      reasoningLevel: "low",
      signal: deps.signal,
    },
    Ai04ExtractOutputSchema,
  );
  const result = validateCoverLetterFacts(value, {
    messages: ctx.messages,
    pendingAliases: ctx.pendingAliases,
    knownSlots: new Set(ctx.questions.map((q) => q.slot)),
    storedFacts: ctx.draft.facts,
    storedClarifications: ctx.draft.clarifications,
  });
  (deps.logger ?? silentAiLogger)({
    event: "ai_validation",
    jobId: deps.jobId ?? null,
    feature: "AI-04.extract",
    promptVersion: AI04_EXTRACT_PROMPT_VERSION,
    stats: flattenFactsReport(result.report),
  });
  return {
    skipped: false,
    patch: factsPatch({ ...result, storedTone: ctx.tone }),
    intent: result.intent,
    tone: result.tone,
    processedThroughSequence: ctx.processThroughSequence,
    sensitiveAdded: result.sensitiveAdd,
    report: result.report,
    promptVersion: AI04_EXTRACT_PROMPT_VERSION,
    meta,
    attempts,
  };
}

export function flattenFactsReport(r: CoverLetterFactsReport): Record<string, number> {
  const out: Record<string, number> = {
    proposed: r.proposed,
    added: r.added,
    needs_review: r.needs_review,
    rejected: r.rejected,
    team_marked: r.team_marked,
    unchanged: r.unchanged,
    sensitive_added: r.sensitive_added,
  };
  for (const [check, n] of Object.entries(r.by_check)) if (n > 0) out[`rejected_${check}`] = n;
  return out;
}

// ---------------------------------------------------------------------------
// reply (응답)
// ---------------------------------------------------------------------------

export type ReplyEvent =
  | { type: "delta"; text: string }
  | { type: "done"; text: string; result: AiCallResult }
  | { type: "error"; error: ProviderError; partialText: string };

/** 겨냥할 문항: 사용자가 고른 문항 → 비어 있는 첫 문항 → 첫 문항. */
export function focusQuestion(ctx: CoverLetterChatContext): CoverLetterQuestionContext | null {
  const requested = ctx.input.requestedSlot ? ctx.bySlot.get(ctx.input.requestedSlot) : undefined;
  return requested ?? ctx.questions.find((q) => q.empty) ?? ctx.questions[0] ?? null;
}

export async function* reply(ctx: CoverLetterChatContext, deps: Ai04Deps, extraNotices: readonly ReplyNotice[] = []): AsyncGenerator<ReplyEvent> {
  const focus = focusQuestion(ctx);
  const notices: ReplyNotice[] = [...extraNotices];
  if (ctx.delegationRequested) notices.push("delegation");
  if (ctx.sensitiveNotice.length > 0) notices.push("sensitive");
  if (ctx.lastMessage) notices.push("last_message");
  const data = dataBlocks(ctx, ctx.questions, "usable");

  let text = "";
  for await (const event of deps.llm.stream({
    feature: "AI-04.reply",
    promptVersion: AI04_REPLY_PROMPT_VERSION,
    callKey: deps.callKey ?? coverLetterCallKey(1, "reply"),
    tier: AI04_REPLY_TIER,
    systemBlocks: replySystemBlocks(),
    userBlocks: replyUserBlocks(ctx.sharedBlocks, ctx.chatBlocks, data, {
      focusSlot: focus?.slot ?? null,
      focusNo: focus?.index ?? null,
      notices: [...new Set(notices)],
    }),
    outputSchema: null,
    maxOutputTokens: AI04_REPLY_MAX_OUTPUT_TOKENS,
    reasoningLevel: "low",
    signal: deps.signal,
  })) {
    if (event.type === "delta") {
      text += event.text;
      yield { type: "delta", text: event.text };
    } else if (event.type === "done") {
      yield { type: "done", text: event.result.text || text, result: event.result };
      return;
    } else {
      yield { type: "error", error: event.error, partialText: text };
      return;
    }
  }
  yield { type: "error", error: new ProviderError("provider_unavailable", { provider: deps.llm.provider, beforeFirstToken: text.length === 0 }), partialText: text };
}

// ---------------------------------------------------------------------------
// compose (초안 턴)
// ---------------------------------------------------------------------------

export type ComposeEvent =
  /** 한 초안 호출이 시작됐다. attempt 2 = V-6 재시도 (1차 블록은 버린다). */
  | { type: "draft_started"; attempt: number; reason: "initial" | "schema_retry"; slots: string[] }
  /** 그 문항의 근거 카드 (모델의 `sources` 배열이 닫히는 순간). */
  | { type: "sources_selected"; slot: string; questionNo: number; questionClass: string; sources: SelectedSourceView[] }
  /** 검증을 통과한 문단 하나 (잠정값 — `draft_done`이 정본이다). */
  | { type: "draft_block"; slot: string; questionNo: number; attempt: number; block: CoverLetterBlock }
  /** 글자 수 보정 호출 직전 (보정이 필요한 문항만). */
  | {
      type: "adjusting_length";
      questions: Array<{ slot: string; questionNo: number; charCount: number; charLimit: number; countBasis: "with_spaces" | "without_spaces"; reasons: Array<"length" | "numbers"> }>;
    };

export type ComposedQuestion = {
  slot: string;
  questionNo: number;
  questionClass: string;
  sources: SelectedSourceView[];
  blocks: CoverLetterBlock[];
  /** (v4.15, CF-6) 검증을 통과한 제목 또는 null. */
  answerTitle: string | null;
  /** (CF-S1) 저장될 문항 근거 (`{slot}.sources.{n}` 행이 된다). */
  storedSources: StoredSource[];
  titleRejected: string | null;
  charCount: number;
  charLimit: number | null;
  charAdjustNeeded: boolean;
  correctionApplied: boolean;
  droppedBlockCount: number;
  needsReviewBlockIds: string[];
  notesForUser: string[];
  /**
   * 저장 때 `evidence_links` 행이 될 근거 (`item_key` = `{slot}.blocks.{block_id}`
   * / `{slot}.sources.{n}`). 행 쓰기는 `save_application_document`가 한다 (C-3).
   */
  evidence: Array<{ itemKey: string; evidence: ValidatedEvidence[] }>;
};

export type ComposeResult = {
  outcome: "draft" | "empty";
  patch: CoverLetterPatch;
  questions: ComposedQuestion[];
  /** 저장·전송할 고정 AI 메시지 (`reply_done`). */
  assistantMessage: string;
  attempts: number;
  correctionApplied: boolean;
  promptVersion: string;
  validationReport: DraftReport;
  meta: AiCallResult | null;
  usage: NormalizedUsage | null;
};

type SlotState = { slot: string | null; questionClass: string | null; sources: ValidatedSource[] | null; blocks: number };

export async function* compose(
  ctx: CoverLetterChatContext,
  deps: Ai04Deps,
  options: { batch: readonly CoverLetterQuestionContext[] },
): AsyncGenerator<ComposeEvent, ComposeResult, void> {
  const batch = options.batch;
  const report = emptyDraftReport();
  const outputSchema = toCanonicalJsonSchema(Ai04ComposeOutputSchema);
  const data = dataBlocks(ctx, batch, "usable");
  const task = {
    questions: batch.map((q) => ({
      slot: q.slot,
      no: q.index,
      targetChars: q.charLimit ? lengthTarget(q.charLimit) : null,
      countBasis: q.countBasis,
      titleWanted: q.answerTitle === null,
    })),
    tone: ctx.tone,
    style: ctx.input.style ?? null,
  };

  let accepted: { output: Ai04ComposeOutput; meta: AiCallResult } | null = null;
  let calls = 0;
  let reason: "initial" | "schema_retry" = "initial";
  let tokensShown = false;

  while (calls < AI04_COMPOSE_MAX_CALLS) {
    calls++;
    yield { type: "draft_started", attempt: calls, reason, slots: batch.map((q) => q.slot) };
    const parser = new IncrementalJsonParser();
    const states = new Map<number, SlotState>();
    let meta: AiCallResult | null = null;
    let parseFailed = false;

    try {
      for await (const chunk of deps.llm.stream({
        feature: "AI-04.compose",
        promptVersion: AI04_PROMPT_VERSION,
        callKey: deps.callKey ?? coverLetterCallKey(1, "compose"),
        tier: AI04_COMPOSE_TIER,
        systemBlocks: systemBlocks(),
        userBlocks: composeUserBlocks(ctx.sharedBlocks, data, task),
        outputSchema,
        maxOutputTokens: AI04_COMPOSE_MAX_OUTPUT_TOKENS,
        reasoningLevel: "low",
        signal: deps.signal,
      })) {
        if (chunk.type === "error") throw chunk.error;
        if (chunk.type === "done") {
          meta = chunk.result;
          break;
        }
        tokensShown = true;
        if (parseFailed) continue;
        let events;
        try {
          events = parser.push(chunk.text);
        } catch (err) {
          if (err instanceof JsonStreamError) {
            parseFailed = true;
            continue;
          }
          throw err;
        }
        for (const e of events) {
          const at = e.path;
          if (at.length < 2 || at[0] !== "questions") continue;
          const qi = Number(at[1]);
          const state = states.get(qi) ?? { slot: null, questionClass: null, sources: null, blocks: 0 };
          states.set(qi, state);

          if (e.type === "value" && at.length === 3 && at[2] === "question_slot" && typeof e.value === "string") {
            state.slot = e.value;
            continue;
          }
          if (e.type === "value" && at.length === 3 && at[2] === "question_class" && typeof e.value === "string") {
            state.questionClass = e.value;
            continue;
          }
          const question = state.slot ? ctx.bySlot.get(state.slot) : undefined;
          if (!question || !batch.some((b) => b.slot === question.slot)) continue;

          if (e.type === "close" && e.kind === "array" && at.length === 3 && at[2] === "sources") {
            const parsed = Ai04SourceSchema.array().safeParse(e.value);
            if (!parsed.success) continue;
            const questionClass = resolveQuestionClass(question, asQuestionClass(state.questionClass));
            state.sources = validateSources(parsed.data, questionClass, sourcesEnv(ctx, question), {});
            yield {
              type: "sources_selected",
              slot: question.slot,
              questionNo: question.index,
              questionClass,
              sources: state.sources.map((s) => s.view),
            };
            continue;
          }
          if (e.type === "close" && e.kind === "object" && at.length === 4 && at[2] === "paragraphs") {
            const parsed = Ai04ParagraphSchema.safeParse(e.value);
            if (!parsed.success) continue;
            const questionClass = resolveQuestionClass(question, asQuestionClass(state.questionClass));
            const checked = checkQuestionParagraphs([parsed.data], paragraphsEnv(ctx, question, questionClass, state.sources ?? []), "provisional");
            const block = checked.blocks[0];
            if (!block) continue;
            state.blocks++;
            yield { type: "draft_block", slot: question.slot, questionNo: question.index, attempt: calls, block: { ...block, block_id: `${question.slot}.${state.blocks}` } };
          }
        }
      }
    } catch (err) {
      if (err instanceof ProviderError && calls > 1 && tokensShown) throw err.with({ beforeFirstToken: false });
      throw err;
    }

    const attempt = finishAttempt(parser, parseFailed, meta);
    if (!attempt) {
      if (calls < AI04_COMPOSE_MAX_CALLS) {
        reason = "schema_retry";
        continue;
      }
      throw new AiError("schema_invalid", { retryable: false });
    }
    accepted = attempt;
    break;
  }

  const final = accepted!;
  let usage: NormalizedUsage | null = final.meta.usage;

  // ① 문항별 1차 검증 (숫자는 그대로 둔다) + 글자 수.
  type Pending = {
    question: CoverLetterQuestionContext;
    questionClass: string;
    out: Ai04QuestionOutput;
    sources: ValidatedSource[];
    paragraphs: readonly Ai04Paragraph[];
    charCount: number;
    unsupportedNumbers: string[];
  };
  const pending: Pending[] = [];
  for (const out of final.output.questions) {
    const question = ctx.bySlot.get(out.question_slot);
    if (!question || !batch.some((b) => b.slot === question.slot)) {
      addToReport(report, { questions_dropped_unknown_slot: 1 });
      continue;
    }
    if (pending.some((p) => p.question.slot === question.slot)) {
      addToReport(report, { questions_dropped_duplicate: 1 });
      continue;
    }
    const questionClass = resolveQuestionClass(question, asQuestionClass(out.question_class), report);
    const sources = validateSources(out.sources, questionClass, sourcesEnv(ctx, question), report);
    const checked = checkQuestionParagraphs(out.paragraphs, paragraphsEnv(ctx, question, questionClass, sources), "provisional");
    pending.push({
      question,
      questionClass,
      out,
      sources,
      paragraphs: out.paragraphs,
      charCount: checked.charCount,
      unsupportedNumbers: checked.unsupportedNumbers,
    });
  }

  // ② 글자 수 보정 1회 (필요한 문항만, 호출 1회).
  const needAdjust = pending.filter((p) => isLengthOutOfRange(p.charCount, p.question.charLimit));
  let correctionApplied = false;
  if (needAdjust.length > 0) {
    yield {
      type: "adjusting_length",
      questions: needAdjust.map((p) => ({
        slot: p.question.slot,
        questionNo: p.question.index,
        charCount: p.charCount,
        charLimit: p.question.charLimit!,
        countBasis: p.question.countBasis,
        reasons: p.unsupportedNumbers.length ? (["length", "numbers"] as Array<"length" | "numbers">) : (["length"] as Array<"length" | "numbers">),
      })),
    };
    try {
      const adjusted = await adjustLength(ctx, deps, needAdjust.map((p) => ({ question: p.question, paragraphs: p.paragraphs, charCount: p.charCount, unsupportedNumbers: p.unsupportedNumbers })));
      usage = usage ? addUsage(usage, adjusted.usage) : adjusted.usage;
      for (const q of adjusted.questions) {
        const target = pending.find((p) => p.question.slot === q.question_slot);
        if (target && q.paragraphs.length > 0) target.paragraphs = q.paragraphs;
      }
      correctionApplied = true;
      addToReport(report, { length_adjusted: needAdjust.length });
    } catch (err) {
      // 사용자 중단은 턴을 끝낸다. 그 밖의 실패는 1차 초안을 그대로 쓴다(플래그만).
      if (isAiError(err) && err.code === "canceled") throw err;
      addToReport(report, { length_adjust_failed: 1 });
    }
  }

  // ③ 최종 검증 (숫자 치환) → 답변 제목 검증 → 패치.
  const questions: ComposedQuestion[] = [];
  const bodies: CoverLetterDraftBodyInput[] = [];
  const titleNotices: string[] = [];
  for (const p of pending) {
    const checked = checkQuestionParagraphs(p.paragraphs, paragraphsEnv(ctx, p.question, p.questionClass, p.sources), "final");
    addToReport(report, checked.report);
    const charAdjustNeeded = isLengthOutOfRange(checked.charCount, p.question.charLimit);
    if (charAdjustNeeded) addToReport(report, { char_adjust_needed: 1 });

    // 제목: 보정이 끝난 그 문항의 최종 문단을 기준으로 검사하고, 걸리면 제목만 버린다.
    const titleOutcome =
      p.question.answerTitle !== null
        ? { title: null, rejected: null, aliasesReplaced: 0 }
        : validateAnswerTitle(p.out.answer_title, {
            paragraphTexts: checked.blocks.map((b) => b.text),
            evidenceTexts: checked.evidence.flatMap((i) => i.evidence.map((e) => e.quote ?? "")),
            computedNumbers: ctx.pack.numberSources.computedNumbers,
            aliases: ctx.aliases,
            literalAliasTokens: ctx.env.literalAliasTokens,
          });
    if (titleOutcome.rejected && titleOutcome.rejected !== "empty") {
      addToReport(report, { answer_title_dropped: 1, [`answer_title_${titleOutcome.rejected}`]: 1 });
      if (checked.blocks.length > 0) titleNotices.push(droppedTitleNotice(p.question.index));
    }

    const storedSources = toStoredSources(p.sources, ctx.aliases, report);
    const sourceEvidence = p.sources
      .map((s, n) => ({ itemKey: `${p.question.slot}.sources.${n}`, evidence: s.evidence }))
      .filter((i) => i.evidence.length > 0);
    const notes = p.out.notes_for_user.slice(0, 10);

    questions.push({
      slot: p.question.slot,
      questionNo: p.question.index,
      questionClass: p.questionClass,
      sources: p.sources.map((s) => s.view),
      storedSources,
      blocks: checked.blocks,
      answerTitle: titleOutcome.title,
      titleRejected: titleOutcome.rejected,
      charCount: checked.charCount,
      charLimit: p.question.charLimit,
      charAdjustNeeded,
      correctionApplied: correctionApplied && needAdjust.some((n) => n.question.slot === p.question.slot),
      droppedBlockCount: checked.droppedBlockCount,
      needsReviewBlockIds: checked.blocks.filter((b) => b.review === "needs_review").map((b) => b.block_id),
      notesForUser: notes,
      evidence: [...sourceEvidence, ...checked.evidence],
    });

    if (checked.blocks.length > 0) {
      bodies.push({
        slot: p.question.slot,
        questionId: p.question.questionId,
        answer_title: titleOutcome.title,
        blocks: checked.blocks,
        // (CF-S1) 저장의 유일한 원천이므로 빈 배열이라도 **항상** 싣는다.
        sources: storedSources,
        base_body_hash: p.question.baseBodyHash,
        replace_allowed: true,
        char_count: checked.charCount,
        char_limit_at_generation: p.question.charLimit,
        char_adjust_needed: charAdjustNeeded,
        correction_applied: correctionApplied && needAdjust.some((n) => n.question.slot === p.question.slot),
        missing_slots: [],
        dropped_block_count: checked.droppedBlockCount,
      });
    }
  }

  const dropped = questions.reduce((n, q) => n + q.droppedBlockCount, 0);
  const adjustNos = questions.filter((q) => q.charAdjustNeeded).map((q) => q.questionNo);
  const empty = bodies.length === 0;
  const message = empty
    ? DRAFT_EMPTY_MESSAGE
    : DRAFT_READY_MESSAGE(questions.filter((q) => q.blocks.length > 0).map((q) => q.questionNo)) +
      (dropped > 0 ? droppedBlocksSuffix(dropped) : "") +
      (adjustNos.length ? charAdjustSuffix(adjustNos) : "") +
      (titleNotices.length ? ` ${titleNotices.join(" ")}` : "");

  (deps.logger ?? silentAiLogger)({
    event: "ai_validation",
    jobId: deps.jobId ?? null,
    feature: "AI-04.compose",
    promptVersion: correctionApplied ? `${AI04_PROMPT_VERSION.split("+")[0]}+${AI04_ADJUST_PROMPT_VERSION}` : AI04_PROMPT_VERSION,
    stats: { ...report, questions: questions.length, attempts: calls },
  });

  return {
    outcome: empty ? "empty" : "draft",
    patch: draftPatch({ bodies, sensitiveAdded: 0 }),
    questions,
    assistantMessage: message,
    attempts: calls,
    correctionApplied,
    promptVersion: correctionApplied ? `${AI04_PROMPT_VERSION.split("+")[0]}+${AI04_ADJUST_PROMPT_VERSION}` : AI04_PROMPT_VERSION,
    validationReport: report,
    meta: final.meta,
    usage,
  };
}

function finishAttempt(parser: IncrementalJsonParser, parseFailed: boolean, meta: AiCallResult | null): { output: Ai04ComposeOutput; meta: AiCallResult } | null {
  if (parseFailed || !meta) return null;
  let json: unknown;
  try {
    json = parser.end();
  } catch (err) {
    if (err instanceof JsonStreamError) return null;
    throw err;
  }
  const parsed = Ai04ComposeOutputSchema.safeParse(json);
  return parsed.success ? { output: parsed.data, meta } : null;
}

function asQuestionClass(value: string | null): import("@/lib/contracts/enums").QuestionClass | null {
  return value === "motivation" || value === "job_competency" || value === "future_plan" || value === "experience_story" ? value : null;
}

function sourcesEnv(ctx: CoverLetterChatContext, question: CoverLetterQuestionContext) {
  return {
    aliases: ctx.aliases,
    env: ctx.env,
    otherPrimaryProjectIds: otherPrimaryProjects(ctx, question.slot),
    noteAlias: question.noteAlias,
  };
}

function paragraphsEnv(ctx: CoverLetterChatContext, question: CoverLetterQuestionContext, questionClass: string, sources: readonly ValidatedSource[]) {
  return {
    ...sourcesEnv(ctx, question),
    question,
    questionClass: questionClass as import("@/lib/contracts/enums").QuestionClass,
    sources,
    factAliases: ctx.factAliases,
  };
}

/** 다른 문항이 쓴 프로젝트 (F-DOC-08 재사용 판정). */
function otherPrimaryProjects(ctx: CoverLetterChatContext, slot: string): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const entry of ctx.draft.document.questions) {
    if (entry.slot === slot) continue;
    for (const block of entry.draft.blocks) for (const e of block.evidence) if (e.source_type === "project") ids.add(e.source_id);
  }
  return ids;
}

/**
 * 글자 수 보정 호출 1회 (`ai-04.adjust`): 같은 접두(캐시) + 초안을 데이터로 주고
 * 목표 글자 수와 확인되지 않는 숫자를 알린다. 출력은 호출자가 같은 규칙으로
 * 다시 검증한다. **답변 제목은 보내지도, 받지도 않는다**(CF-6).
 */
export async function adjustLength(
  ctx: CoverLetterChatContext,
  deps: Ai04Deps,
  items: ReadonlyArray<{ question: CoverLetterQuestionContext; paragraphs: readonly Ai04Paragraph[]; charCount: number; unsupportedNumbers: readonly string[] }>,
): Promise<{ questions: Array<{ question_slot: string; paragraphs: Ai04Paragraph[] }>; usage: NormalizedUsage; model: string }> {
  const draftJson = JSON.stringify({ questions: items.map((i) => ({ question_slot: i.question.slot, paragraphs: i.paragraphs })) });
  const result = await generateStructured(
    deps.llm,
    {
      feature: "AI-04.adjust",
      promptVersion: AI04_ADJUST_PROMPT_VERSION,
      callKey: deps.adjustCallKey ?? coverLetterCallKey(1, "adjust_length"),
      tier: AI04_COMPOSE_TIER,
      systemBlocks: systemBlocks(),
      userBlocks: adjustUserBlocks(
        ctx.sharedBlocks,
        { questionsText: renderQuestions(items.map((i) => i.question)), draftJson },
        {
          questions: items.map((i) => ({
            slot: i.question.slot,
            charCount: i.charCount,
            targetChars: i.question.charLimit ? lengthTarget(i.question.charLimit) : null,
            countBasis: i.question.countBasis,
            unsupportedNumbers: i.unsupportedNumbers,
          })),
        },
      ),
      maxOutputTokens: AI04_ADJUST_MAX_OUTPUT_TOKENS,
      reasoningLevel: "low",
      signal: deps.signal,
    },
    Ai04AdjustOutputSchema,
    { accept: (v) => v.questions.length > 0 },
  );
  return { questions: result.value.questions, usage: result.meta.usage, model: result.meta.model };
}

/** 초안 호출이 스키마로 끝내 실패했는지 (러너가 더 재시도하지 않는다). */
export function isComposeSchemaFailure(err: unknown): boolean {
  return isAiError(err) && err.code === "schema_invalid";
}
