import { randomUUID } from "node:crypto";
import { failureCauseOf, type StoredAiJobProgress } from "@/lib/contracts/ai";
import type { AiErrorCode, ModelTier } from "@/lib/contracts/enums";
import { AppError } from "@/lib/contracts/errors";
import {
  WRITING_CHAT_MESSAGE_LIMIT,
  WRITING_CHAT_MESSAGE_MAX_CHARS,
  type RequestedSlot,
  type StructuredDraft,
  type WritingChatMessageDto,
  type WritingChatTurnEvent,
} from "@/lib/contracts/writing-chat";
import { AiError, finalRetryAfter, isAiError, isProviderError } from "@/server/ai/errors";
import type { Llm } from "@/server/ai/llm";
import { resolveModel } from "@/server/ai/providers/models";
import {
  FREE_TIER_MIN_INTERVAL_MS,
  HEARTBEAT_INTERVAL_MS,
  MIN_STEP_TIMEOUT_MS,
  USAGE_SETTLE_GRACE_MS,
  USAGE_SETTLE_WORST_MS,
} from "@/server/jobs/constants";
import { isKeyFailureCause } from "@/server/jobs/provider-context";
import { decideRetry } from "@/server/jobs/retry";
import type { JobRecord } from "@/server/jobs/types";
import { createPriceCache, createUsageRecorder } from "@/server/jobs/usage-recorder";
import { diffDrafts, draftProgress } from "./draft";
import { toMessageDto } from "./mappers";
import type { ChatMessage, ChatSnapshot, Log, TurnDeps, TurnSnapshot, TurnTiming } from "./types";

/**
 * AI-12 conversation turn (F-P1-13, DM §3.3 / §7 대화 턴, AI C-11.3 / C-12 / C-13).
 *
 * prepareTurn (before the SSE response opens — failures are plain JSON errors,
 * or one SSE `error` for the AI connection gate):
 *   chat checks (active, limit, nothing in flight) → provider context (fixed
 *   provider / tier) → ai_jobs `writing_chat_turn` (target = the chat: one
 *   turn at a time) → claim → run gate → user message (user-session RPC; not on
 *   "다시 보내기") → assistant `streaming` row (app_ai_writer RPC; the failed
 *   row is reused on "다시 보내기", count unchanged).
 *
 * runTurn (inside the SSE stream):
 *   paid tier: reply ∥ extract; free tier: reply → (call spacing) → extract (C-12).
 *   Each call has its own Llm, deadline, immediate retry (C-11.3, before the
 *   first token only; causes that need a wait end the call — a streaming turn
 *   can't schedule `next_run_at`, spec-gaps 2026-10-30 ③) and one usage record
 *   per provider call. A call that succeeded is never repeated because the
 *   other failed (QA-S3a-08). Extract failure never blocks the reply; its user
 *   messages stay pending (last_extracted_sequence) for the next turn.
 *
 * NFR-AI-05: nothing here writes career tables. NFR-PRV-09: logs carry ids,
 * codes, and counts only — never message or draft text.
 */

const DEFAULT_TIMING: TurnTiming = {
  budgetMs: 58_000,
  settleReserveMs: USAGE_SETTLE_WORST_MS,
  // C-12 targets: reply complete 10 s (paid) / 20 s (free); preview update 10 s / 20 s.
  replyTimeoutMs: { paid: 25_000, free: 35_000 },
  extractTimeoutMs: { paid: 20_000, free: 25_000 },
  minCallMs: MIN_STEP_TIMEOUT_MS,
  heartbeatMs: HEARTBEAT_INTERVAL_MS,
  freeTierSpacingMs: FREE_TIER_MIN_INTERVAL_MS,
  usageSettleMs: USAGE_SETTLE_GRACE_MS,
};

/** A turn needs room for the user message AND the reply. */
const MESSAGES_PER_TURN = 2;

export type TurnRequest = {
  chatId: string;
  /** New user message; null = "다시 보내기" of the last failed reply. */
  content: string | null;
  requestedSlot: RequestedSlot | null;
};

export type PreparedTurn = {
  kind: "ready";
  job: JobRecord;
  snapshot: TurnSnapshot;
  assistant: { id: string; sequence: number };
  retry: boolean;
  messageCount: number;
  startedAt: number;
};

/** The AI connection gate refused: the route answers with one SSE `error` (F-AI-08 lock). */
export type BlockedTurn = { kind: "blocked"; code: AiErrorCode; jobId: string | null };

function nowOf(deps: TurnDeps): () => Date {
  return deps.now ?? (() => new Date());
}

function logOf(deps: TurnDeps): Log {
  return deps.log ?? (() => {});
}

function timingOf(deps: TurnDeps): TurnTiming {
  return { ...DEFAULT_TIMING, ...deps.timing };
}

function inFlightQuery(deps: TurnDeps, chatId: string) {
  return {
    userId: deps.userId,
    jobType: "writing_chat_turn" as const,
    target: { type: "writing_chat", id: chatId },
    inputHash: null,
    applicationProjectId: null,
  };
}

const turnInProgress = () => new AppError("turn_in_progress", "이전 메시지에 대한 응답을 만들고 있어요. 잠시 후 다시 보내 주세요.", { status: 409 });
const notActive = () =>
  new AppError("writing_chat_not_active", "저장했거나 그만둔 대화예요. 새 대화를 시작해 주세요.", { status: 409 });
const limitReached = () =>
  new AppError("message_limit_reached", "대화가 길어져 더 보낼 수 없어요. 지금까지 내용을 저장하거나 폼으로 옮겨 이어서 써 주세요.", { status: 409 });
const nothingToRetry = () => new AppError("nothing_to_retry", "다시 보낼 응답이 없어요.", { status: 409 });

/**
 * Whether the chat can take one more full turn (user + reply ≤ 40). R1 A5 (DM §2.5):
 * `message_count` counts user + AI messages but not the greeting, so a user message is
 * accepted while `message_count ≤ 38` and the 40th message is that turn's reply.
 */
export function hasRoomForTurn(messageCount: number): boolean {
  return messageCount + MESSAGES_PER_TURN <= WRITING_CHAT_MESSAGE_LIMIT;
}

/** Messages left until "n / 40" reaches 40 (greeting excluded, R1 A5). */
export function remainingMessages(messageCount: number): number {
  return Math.max(0, WRITING_CHAT_MESSAGE_LIMIT - messageCount);
}

function lastOf<T>(items: readonly T[]): T | undefined {
  return items[items.length - 1];
}

/** The user message a "다시 보내기" answers: the last message is a failed (or orphaned streaming) reply. */
function retryTarget(chat: ChatSnapshot): ChatMessage | null {
  const last = lastOf(chat.messages);
  if (!last || last.role !== "assistant" || last.status === "done") return null;
  const user = [...chat.messages].reverse().find((m) => m.role === "user" && m.sequence < last.sequence);
  return user ?? null;
}

/** Maps the connection check outcome to the SSE gate error (decisions 2026-10-29, C-11.1). */
function gateCode(err: unknown): AiErrorCode | null {
  if (err instanceof AppError) {
    if (err.code === "ai_consent_required" || err.code === "key_missing" || err.code === "ai_not_connected") return "key_missing";
    if (err.code === "key_invalid") return "key_invalid";
  }
  return null;
}

export async function prepareTurn(deps: TurnDeps, req: TurnRequest): Promise<PreparedTurn | BlockedTurn> {
  const now = nowOf(deps);
  const log = logOf(deps);
  const retry = req.content === null;

  const chat = await deps.chats.load(req.chatId);
  if (!chat) throw new AppError("not_found");
  if (chat.status !== "active") throw notActive();

  let retryUser: ChatMessage | null = null;
  if (retry) {
    retryUser = retryTarget(chat);
    if (!retryUser) throw nothingToRetry();
  } else if (!hasRoomForTurn(chat.messageCount)) {
    throw limitReached();
  }

  // One turn at a time per chat (DB: one in-flight job per user, type, target).
  if (await deps.store.findInFlight(inFlightQuery(deps, chat.id))) throw turnInProgress();

  // The connection is read here and fixed into the job (F-AI-03 (2)); never trusted from the client.
  let context;
  try {
    context = await deps.providerContext.forUser(deps.userId);
  } catch (err) {
    const code = gateCode(err);
    if (code) return { kind: "blocked", code, jobId: null };
    throw err;
  }
  if (!context) return { kind: "blocked", code: "key_missing", jobId: null };
  if (context.keyStatus === "invalid") return { kind: "blocked", code: "key_invalid", jobId: null };

  const jobId = (deps.newId ?? randomUUID)();
  const modelTier: ModelTier = "default";
  const model = resolveModel(context.provider, modelTier);
  try {
    await deps.store.insert({
      id: jobId,
      userId: deps.userId,
      jobType: "writing_chat_turn",
      applicationProjectId: null,
      targetType: "writing_chat",
      targetId: chat.id,
      provider: context.provider,
      modelTier,
      connectionTier: context.connectionTier,
      params: { retry, requested_slot: req.requestedSlot },
      inputHash: null,
      promptVersion: null,
      model,
      progress: { stage: "reply", done: 0, total: 2 },
      meta: { runBase: 1, waitBase: 0, retries: {} },
    });
  } catch (err) {
    if (err instanceof AppError && err.code === "conflict") throw turnInProgress();
    throw err;
  }
  const job = await deps.store.claim(jobId, { now: now().toISOString(), staleBefore: new Date(now().getTime() + 1_000).toISOString() });
  if (!job) throw new AppError("internal_error", undefined, { status: 500 });
  const gen = job.runGeneration;

  const close = async (status: "failed" | "canceled", errorCode: AiErrorCode) => {
    const at = now().toISOString();
    try {
      await deps.store.finish(jobId, gen, { status, errorCode, finishedAt: at, heartbeatAt: at, nextRunAt: null });
    } catch {
      log("writing_chat.turn_close_failed", { jobId });
    }
  };

  // QA-S3b-01: consent withdrawn / key deleted between the read above and now.
  if (deps.runGate) {
    let gate: AiErrorCode | null;
    try {
      gate = await deps.runGate(jobId);
    } catch (err) {
      await close("failed", "stalled");
      throw err;
    }
    if (gate) {
      await close("failed", gate);
      return { kind: "blocked", code: gate, jobId };
    }
  }

  // QA-S4-04: we hold the chat's in-flight job lock (insert above), so a `streaming` last reply belongs to a
  // turn that is gone (its job ended / died). Close it as failed now, so "다시 보내기" reuses it at once
  // instead of waiting for begin_assistant_message's 2-minute rule.
  const lastMsg = chat.messages[chat.messages.length - 1];
  if (lastMsg && lastMsg.role === "assistant" && lastMsg.status === "streaming") {
    try {
      await deps.chats.finishAssistant(lastMsg.id, "failed", lastMsg.content);
      lastMsg.status = "failed";
    } catch {
      log("writing_chat.orphan_close_failed", { jobId });
    }
  }

  let userMessage: ChatMessage;
  try {
    if (retry) {
      userMessage = retryUser!;
    } else {
      const appended = await deps.chats.appendUserMessage(chat.id, req.content!);
      userMessage = {
        id: appended.id,
        sequence: appended.sequence,
        role: "user",
        content: req.content!.trim(),
        status: "done",
        aiJobId: null,
        provider: null,
        model: null,
        modelTier: null,
        connectionTier: null,
        createdAt: now().toISOString(),
      };
      chat.messages.push(userMessage);
    }
  } catch (err) {
    // No provider call happened: the turn didn't run (limit reached / chat closed meanwhile).
    await close("canceled", "canceled");
    throw err;
  }

  let assistant: Awaited<ReturnType<TurnDeps["chats"]["beginAssistant"]>>;
  try {
    assistant = await deps.chats.beginAssistant(chat.id, jobId, {
      provider: context.provider,
      model,
      modelTier,
      connectionTier: context.connectionTier,
    });
  } catch (err) {
    // A domain refusal (409: another turn's reply is streaming, limit) didn't run anything either.
    const refused = err instanceof AppError && err.status === 409;
    await close(refused ? "canceled" : "failed", refused ? "canceled" : "stalled");
    throw err;
  }

  const messageCount = assistant.messageCount;
  chat.messageCount = messageCount;
  const pendingUserMessages = chat.messages.filter((m) => m.role === "user" && m.sequence > chat.lastExtractedSequence);
  const snapshot: TurnSnapshot = {
    chat,
    userMessage,
    pendingUserMessages,
    history: chat.messages.filter((m) => m.status === "done"),
    requestedSlot: req.requestedSlot,
    messageCountAfterReply: messageCount,
    isLastTurn: assistant.isFinal,
    db: deps.writer,
  };
  log("writing_chat.turn_started", { jobId, provider: context.provider, connectionTier: context.connectionTier, retry, pending: pendingUserMessages.length });
  return { kind: "ready", job, snapshot, assistant: { id: assistant.id, sequence: assistant.sequence }, retry, messageCount, startedAt: now().getTime() };
}

// ---------------- run ----------------

type CallFailure = { code: AiErrorCode; retryAfter: string | null; quotaResetsAt: string | null };

type ReplyResult = { ok: true; message: WritingChatMessageDto } | { ok: false; failure: CallFailure };
type ExtractResult =
  | { ok: true; before: StructuredDraft; after: StructuredDraft }
  | { ok: false; code: AiErrorCode | "skipped" };

/** Deadline + cancel signal of one call. `timeout` aborts with reason "timeout" (ai `signalReason`). */
function callSignal(parent: AbortSignal, timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const onParent = () => controller.abort(parent.reason === "canceled" ? "canceled" : (parent.reason ?? "canceled"));
  if (parent.aborted) onParent();
  else parent.addEventListener("abort", onParent, { once: true });
  const timer = setTimeout(() => controller.abort("timeout"), Math.max(0, timeoutMs));
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", onParent);
    },
  };
}

function toFailure(err: unknown, signal: AbortSignal): AiError {
  if (signal.aborted) return new AiError(signal.reason === "canceled" ? "canceled" : "timeout");
  if (isAiError(err)) return err;
  // Not a provider error (our bug, DB error): no retry (QA-S3a-02).
  return new AiError("stalled", { retryable: false });
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || ms <= 0) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * Runs the prepared turn and emits the SSE events. Never throws: every exit
 * leaves the job terminal, the assistant row closed, and the opened calls'
 * usage recorded. `signal` = client disconnect (request signal).
 */
export async function runTurn(
  deps: TurnDeps,
  turn: PreparedTurn,
  emit: (event: WritingChatTurnEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const now = nowOf(deps);
  const log = logOf(deps);
  const timing = timingOf(deps);
  const sleep = deps.sleep ?? defaultSleep;
  const { job, snapshot, assistant } = turn;
  const gen = job.runGeneration;
  const chat = snapshot.chat;
  const tier = job.connectionTier;
  const deadline = turn.startedAt + timing.budgetMs - timing.settleReserveMs;
  const remaining = () => deadline - now().getTime();
  const userSeq = snapshot.userMessage.sequence;

  // Turn-level abort: client disconnect or a cancel request (stop button) → "canceled"; lost job → "lost".
  const turnAbort = new AbortController();
  const onClient = () => turnAbort.abort("canceled");
  if (signal.aborted) onClient();
  else signal.addEventListener("abort", onClient, { once: true });

  let lost = false;
  const beat = setInterval(() => {
    void deps.store
      .heartbeat(job.id, gen, now().toISOString())
      .then((h) => {
        if (!h.current) {
          lost = true;
          turnAbort.abort("lost");
        } else if (h.cancelRequested) {
          turnAbort.abort("canceled");
        }
      })
      .catch(() => log("writing_chat.heartbeat_failed", { jobId: job.id }));
  }, timing.heartbeatMs);

  const llms: Llm[] = [];
  const onCall = createUsageRecorder({ store: deps.usage, job, priceFor: createPriceCache(deps.usage), now, log });
  const keyErrors: AiError[] = [];
  const makeLlm = (modelTier: ModelTier, callSignalValue: AbortSignal): Llm => {
    const llm = deps.createLlm({
      provider: job.provider,
      tier: modelTier,
      connectionTier: tier,
      keySource: deps.keySource,
      jobId: job.id,
      signal: callSignalValue,
      onCall,
    });
    llms.push(llm);
    return llm;
  };

  const safeEmit = (event: WritingChatTurnEvent) => {
    try {
      emit(event);
    } catch {
      // stream already closed
    }
  };

  // ---- reply (default tier, streamed) ----
  async function runReply(): Promise<ReplyResult> {
    let content = "";
    let attempt = 0;
    const retriesByCode: Partial<Record<AiErrorCode, number>> = {};
    for (;;) {
      attempt += 1;
      const budget = Math.min(timing.replyTimeoutMs[tier], remaining());
      if (budget < timing.minCallMs && attempt > 1) return { ok: false, failure: { code: "timeout", retryAfter: null, quotaResetsAt: null } };
      const call = callSignal(turnAbort.signal, Math.max(budget, timing.minCallMs));
      let emitted = false;
      let error: AiError | null = null;
      let done = false;
      try {
        const llm = makeLlm("default", call.signal);
        for await (const event of deps.pipelines.reply({ jobId: job.id, llm, signal: call.signal, callKey: `writing_chat.turn.${userSeq}.reply`, snapshot })) {
          if (event.type === "delta") {
            if (!event.text) continue;
            emitted = true;
            content += event.text;
            safeEmit({ type: "reply_delta", text: event.text });
          } else if (event.type === "done") {
            done = true;
            break;
          } else {
            error = event.error;
            break;
          }
        }
        if (!done && !error) error = toFailure(new Error("reply ended without a terminal event"), call.signal);
      } catch (err) {
        error = toFailure(err, call.signal);
      } finally {
        call.clear();
      }
      if (error && call.signal.aborted && !isProviderError(error)) error = toFailure(error, call.signal);

      if (done && !error) {
        const text = content.slice(0, WRITING_CHAT_MESSAGE_MAX_CHARS);
        try {
          await deps.chats.finishAssistant(assistant.id, "done", text);
        } catch {
          log("writing_chat.assistant_finish_failed", { jobId: job.id });
          return { ok: false, failure: { code: "stalled", retryAfter: null, quotaResetsAt: null } };
        }
        const message = toMessageDto(
            {
              id: assistant.id,
              sequence: assistant.sequence,
              role: "assistant",
              content: text,
              status: "done",
              aiJobId: job.id,
              provider: job.provider,
              model: resolveModel(job.provider, "default"),
              modelTier: "default",
              connectionTier: tier,
              createdAt: now().toISOString(),
            },
            null,
          );
        safeEmit({ type: "reply_done", message });
        return { ok: true, message };
      }

      const err = error!;
      if (err.code === "key_invalid" || isKeyFailureCause(failureCauseOf(err.code))) keyErrors.push(err);
      const retries = retriesByCode[err.code] ?? 0;
      // C-11.3: only before the first token; a wait can't be scheduled from an open stream (spec-gaps 2026-10-30 ③).
      const decision = emitted
        ? null
        : decideRetry({ error: err, retriesSoFar: retries, waitUsedMs: 0, now: now(), random: () => 0 });
      if (decision?.kind === "retry_now" && !turnAbort.signal.aborted && remaining() >= timing.minCallMs) {
        retriesByCode[err.code] = retries + 1;
        log("writing_chat.reply_retry", { jobId: job.id, code: err.code });
        continue;
      }
      // QA-S4-01: a wait we can't take inside the stream is a FINAL failure → C-11.3 final retry_after
      // (rate_limited: next wait, at least 1 min; provider_unavailable: +1 min), never the short wait.
      const retryAfter = finalRetryAfter(err, retries, now().getTime());
      const quotaResetsAt = decision?.kind === "fail" ? decision.quotaResetsAt : isProviderError(err) ? (err.quotaResetsAt ?? null) : null;
      try {
        // Partial text is kept with the failed row (C-11.3 "받은 부분을 보존"); it never enters the next input.
        await deps.chats.finishAssistant(assistant.id, "failed", content.slice(0, WRITING_CHAT_MESSAGE_MAX_CHARS));
      } catch {
        log("writing_chat.assistant_finish_failed", { jobId: job.id });
      }
      return {
        ok: false,
        failure: { code: err.code, retryAfter: retryAfter?.toISOString() ?? null, quotaResetsAt: quotaResetsAt?.toISOString() ?? null },
      };
    }
  }

  // ---- extract (light tier, structured) ----
  async function runExtract(): Promise<ExtractResult> {
    const pending = snapshot.pendingUserMessages;
    if (pending.length === 0) return { ok: false, code: "skipped" };
    const before = chat.structuredDraft;
    const retriesByCode: Partial<Record<AiErrorCode, number>> = {};
    for (;;) {
      const budget = Math.min(timing.extractTimeoutMs[tier], remaining());
      if (budget < timing.minCallMs || turnAbort.signal.aborted) return { ok: false, code: turnAbort.signal.aborted ? "canceled" : "timeout" };
      const call = callSignal(turnAbort.signal, budget);
      let outcome;
      try {
        const llm = makeLlm("light", call.signal);
        outcome = await deps.pipelines.extract({ jobId: job.id, llm, signal: call.signal, callKey: `writing_chat.turn.${userSeq}.extract`, snapshot });
      } catch (thrown) {
        const err = toFailure(thrown, call.signal);
        call.clear();
        if (err.code === "key_invalid" || isKeyFailureCause(failureCauseOf(err.code))) keyErrors.push(err);
        const retries = retriesByCode[err.code] ?? 0;
        const decision = decideRetry({ error: err, retriesSoFar: retries, waitUsedMs: 0, now: now(), random: () => 0 });
        if (decision.kind === "retry_now" && !turnAbort.signal.aborted) {
          retriesByCode[err.code] = retries + 1;
          log("writing_chat.extract_retry", { jobId: job.id, code: err.code });
          continue;
        }
        log("writing_chat.extract_failed", { jobId: job.id, code: err.code, unclassified: !isAiError(thrown) });
        return { ok: false, code: err.code };
      }
      call.clear();
      if (outcome.skipped) return { ok: false, code: "skipped" };
      try {
        const after = outcome.patch === null ? before : await deps.chats.applyAiPatch(chat.id, outcome.patch);
        const through = outcome.processedThroughSequence ?? Math.max(...pending.map((m) => m.sequence));
        await deps.chats.markExtracted(chat.id, through);
        return { ok: true, before, after };
      } catch (err) {
        // The patch was rejected / not stored: the messages stay pending and are extracted again next turn.
        log("writing_chat.extract_store_failed", { jobId: job.id, dbCode: err instanceof AppError ? String(err.code) : "unknown" });
        return { ok: false, code: "stalled" };
      }
    }
  }

  async function spacedExtract(): Promise<ExtractResult> {
    // C-12: free tier calls one after another with a minimum spacing per user and provider.
    await sleep(timing.freeTierSpacingMs, turnAbort.signal);
    return runExtract();
  }

  let reply: ReplyResult;
  let extract: ExtractResult;
  try {
    safeEmit({
      type: "turn_started",
      jobId: job.id,
      userMessage: toMessageDto(snapshot.userMessage, null),
      assistantMessageId: assistant.id,
      provider: job.provider,
      connectionTier: tier,
      messageCount: turn.messageCount,
      retry: turn.retry,
    });

    if (tier === "free") {
      // Spacing before the reply too when the user's last call to this provider was very recent.
      const lastAt = await deps.usage.lastCallAt(job.provider).catch(() => null);
      const wait = lastAt ? Date.parse(lastAt) + timing.freeTierSpacingMs - now().getTime() : 0;
      if (wait > 0) await sleep(Math.min(wait, timing.freeTierSpacingMs), turnAbort.signal);
      reply = await runReply();
      // Reply failed → the extract waits for the next turn / resend (no extra call on a failing key).
      extract = reply.ok ? await spacedExtract() : { ok: false, code: "skipped" };
    } else {
      const extractPromise = runExtract();
      reply = await runReply();
      extract = await extractPromise;
    }
  } catch (err) {
    // Defensive: the helpers above don't throw.
    log("writing_chat.turn_crashed", { jobId: job.id });
    reply = { ok: false, failure: { code: toFailure(err, turnAbort.signal).code, retryAfter: null, quotaResetsAt: null } };
    extract = { ok: false, code: "stalled" };
  } finally {
    clearInterval(beat);
    signal.removeEventListener("abort", onClient);
  }

  // Draft events after the reply's own events (DM §7 order), also before an `error`.
  // QA-S4-05: updated / unchanged (nothing pending, or no change) / failed (retried next turn).
  let draftStatus: "updated" | "unchanged" | "failed" = !extract.ok && extract.code !== "skipped" ? "failed" : "unchanged";
  let draftAfter = chat.structuredDraft;
  if (extract.ok) {
    draftAfter = extract.after;
    const diff = diffDrafts(extract.before, extract.after);
    if (diff.any) {
      draftStatus = "updated";
      safeEmit({ type: "draft_patch", structuredDraft: extract.after, changed: diff.changed });
      safeEmit({
        type: "draft_flags",
        needsReview: diff.needsReview,
        clarifications: extract.after.clarifications,
        sensitiveAdded: diff.sensitiveAdded,
        sensitiveFlagsCount: extract.after.sensitive_flags_count,
      });
    }
  }

  const at = now().toISOString();
  const progress: StoredAiJobProgress = { stage: extract.ok ? "extract" : "reply", done: (reply.ok ? 1 : 0) + (extract.ok ? 1 : 0), total: 2 };
  if (reply.ok) {
    safeEmit({
      type: "turn_done",
      jobId: job.id,
      messageCount: turn.messageCount,
      remainingMessages: remainingMessages(turn.messageCount),
      limitReached: !hasRoomForTurn(turn.messageCount),
      draftStatus,
      draftUpdated: draftStatus !== "failed",
      progress: draftProgress(draftAfter, { augment: chat.mode === "augment_project" }),
    });
    const completed = await deps.store.complete(job.id, gen, progress).catch(() => false);
    if (!completed) log("writing_chat.turn_complete_failed", { jobId: job.id, lost });
  } else {
    const f = reply.failure;
    const canceled = f.code === "canceled" || lost;
    if (!lost) {
      safeEmit({ type: "error", ...errorFields(f) } as WritingChatTurnEvent);
      await deps.store
        .finish(job.id, gen, {
          status: canceled ? "canceled" : "failed",
          errorCode: canceled ? "canceled" : f.code,
          retryAfter: f.retryAfter,
          quotaResetsAt: f.quotaResetsAt,
          finishedAt: at,
          heartbeatAt: at,
          nextRunAt: null,
        })
        .catch(() => log("writing_chat.turn_close_failed", { jobId: job.id }));
    }
  }

  // Exactly one usage record per provider call, also for calls cut by the deadline / disconnect (QA-S3a-03).
  await Promise.all(llms.map((l) => l.settle(timing.usageSettleMs).catch(() => undefined)));
  await reportKeyStatus(deps, job.id, reply, keyErrors, log);
  log("writing_chat.turn_finished", {
    jobId: job.id,
    reply: reply.ok ? "ok" : reply.failure.code,
    extract: extract.ok ? "ok" : extract.code,
    calls: llms.length,
  });
}

/** Fields of the SSE `error` event; the SSE layer rebuilds the full shape from the code (QA-S3-02). */
function errorFields(f: CallFailure): { code: AiErrorCode; retryAfter: string | null; quotaResetsAt: string | null } {
  return { code: f.code, retryAfter: f.retryAfter, quotaResetsAt: f.quotaResetsAt };
}

async function reportKeyStatus(deps: TurnDeps, jobId: string, reply: ReplyResult, keyErrors: AiError[], log: Log): Promise<void> {
  try {
    if (keyErrors.some((e) => e.code === "key_invalid")) {
      await deps.keyStatus.markInvalid(jobId);
      return;
    }
    if (!reply.ok) {
      const cause = failureCauseOf(reply.failure.code);
      if (isKeyFailureCause(cause) && cause !== "key_invalid") await deps.keyStatus.recordFailure(jobId, cause);
      return;
    }
    await deps.keyStatus.recordSuccess(jobId);
  } catch {
    log("writing_chat.key_status_report_failed", { jobId });
  }
}
