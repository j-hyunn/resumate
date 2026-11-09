import { AppError } from "@/lib/contracts/errors";
import {
  parseCoverLetterDraft,
  parseDeliverableDraft,
  parseStructuredDraft,
  WRITING_CHAT_MESSAGE_LIMIT,
  type CoverLetterDraft,
  type DeliverableDraft,
  type StructuredDraft,
} from "@/lib/contracts/writing-chat";
import { StoredBlockSchema } from "@/server/ai/schemas/deliverable-draft";
import { CoverLetterBlockSchema } from "@/server/ai/schemas/cover-letter-draft";
import type {
  ChatMessage,
  ChatSnapshot,
  DeliverablePipelines,
  DocumentComposedQuestion,
  DocumentPipelines,
  DocumentSelectedSource,
  TurnChatDb,
  WritingChatPipelines,
} from "@/server/services/writing-chat/types";

/**
 * Test-only in-memory writing chat with the RPC semantics the turn relies on
 * (S4 plan "계약 — DB" 4): append checks the limit and active status, begin
 * reuses a failed last assistant row without counting, finish closes a row,
 * the AI patch replaces the draft, the extract mark only goes up.
 */
export class MemoryChatDb implements TurnChatDb {
  chat: ChatSnapshot;
  readonly calls: string[] = [];
  failNext: Partial<Record<keyof TurnChatDb, Error>> = {};
  private seq = 0;

  constructor(init: Partial<ChatSnapshot> & { id: string; userId: string }, private readonly clock: () => Date) {
    const greeting: ChatMessage = {
      id: "00000000-0000-4000-8000-00000000f001",
      sequence: 1,
      role: "assistant",
      content: "greeting",
      status: "done",
      aiJobId: null,
      provider: null,
      model: null,
      modelTier: null,
      connectionTier: null,
      createdAt: clock().toISOString(),
    };
    this.chat = {
      projectId: "00000000-0000-4000-8000-00000000a001",
      projectDeliverableId: null,
      deliverableDraft: null,
      applicationProjectId: null,
      documentKind: null,
      documentDraft: null,
      title: null,
      status: "active",
      structuredDraft: parseStructuredDraft({}),
      // R1 A5: the greeting (sequence 1, no job) is not counted.
      messageCount: 0,
      lastExtractedSequence: 0,
      returnTarget: null,
      lastActivityAt: clock().toISOString(),
      lastAppliedAt: null,
      createdAt: clock().toISOString(),
      messages: [greeting],
      ...init,
    } as ChatSnapshot;
  }

  private fail(method: keyof TurnChatDb) {
    const err = this.failNext[method];
    if (err) {
      delete this.failNext[method];
      throw err;
    }
  }

  private nextId(): string {
    this.seq += 1;
    return `00000000-0000-4000-8000-${String(this.seq).padStart(12, "0")}`;
  }

  async load(chatId: string): Promise<ChatSnapshot | null> {
    this.calls.push("load");
    if (chatId !== this.chat.id) return null;
    return structuredClone(this.chat);
  }

  async appendUserMessage(chatId: string, content: string) {
    this.calls.push("appendUserMessage");
    this.fail("appendUserMessage");
    if (this.chat.status !== "active") throw new AppError("writing_chat_closed", undefined, { status: 409 });
    // Keeps room for the reply (RPC: message_count > 38 → message_limit_reached).
    if (this.chat.messageCount > WRITING_CHAT_MESSAGE_LIMIT - 2) throw new AppError("message_limit_reached", undefined, { status: 409 });
    const sequence = Math.max(0, ...this.chat.messages.map((m) => m.sequence)) + 1;
    const msg: ChatMessage = {
      id: this.nextId(),
      sequence,
      role: "user",
      content,
      status: "done",
      aiJobId: null,
      provider: null,
      model: null,
      modelTier: null,
      connectionTier: null,
      createdAt: this.clock().toISOString(),
    };
    void chatId;
    this.chat.messages.push(msg);
    this.chat.messageCount += 1;
    return { id: msg.id, sequence, messageCount: this.chat.messageCount };
  }

  async beginAssistant(chatId: string, jobId: string, meta: { provider: ChatMessage["provider"]; model: string; modelTier: ChatMessage["modelTier"]; connectionTier: ChatMessage["connectionTier"] }) {
    this.calls.push("beginAssistant");
    this.fail("beginAssistant");
    void chatId;
    const last = this.chat.messages[this.chat.messages.length - 1]!;
    const result = (id: string, sequence: number, reused: boolean) => ({
      id,
      sequence,
      messageCount: this.chat.messageCount,
      reused,
      isFinal: this.chat.messageCount > WRITING_CHAT_MESSAGE_LIMIT - 2,
    });
    if (last.role === "assistant" && last.status === "failed") {
      Object.assign(last, { status: "streaming", content: "", aiJobId: jobId, ...meta });
      return result(last.id, last.sequence, true);
    }
    if (last.role === "assistant" && last.status === "streaming") throw new AppError("turn_in_progress", undefined, { status: 409 });
    if (last.role !== "user") throw new AppError("no_pending_user_message", undefined, { status: 409 });
    if (this.chat.messageCount >= WRITING_CHAT_MESSAGE_LIMIT) throw new AppError("message_limit_reached", undefined, { status: 409 });
    const msg: ChatMessage = {
      id: this.nextId(),
      sequence: last.sequence + 1,
      role: "assistant",
      content: "",
      status: "streaming",
      aiJobId: jobId,
      provider: meta.provider,
      model: meta.model,
      modelTier: meta.modelTier,
      connectionTier: meta.connectionTier,
      createdAt: this.clock().toISOString(),
    };
    this.chat.messages.push(msg);
    this.chat.messageCount += 1;
    return result(msg.id, msg.sequence, false);
  }

  async finishAssistant(messageId: string, status: "done" | "failed", content: string) {
    this.calls.push(`finishAssistant:${status}`);
    this.fail("finishAssistant");
    const msg = this.chat.messages.find((m) => m.id === messageId);
    if (!msg) throw new Error("no such message");
    msg.status = status;
    msg.content = content;
    // DM 2.5 v4.4: a done reply that leaves no room for another turn closes the chat.
    if (status === "done" && this.chat.messageCount > WRITING_CHAT_MESSAGE_LIMIT - 2) this.chat.status = "closed";
  }

  async applyAiPatch(chatId: string, patch: unknown): Promise<StructuredDraft> {
    this.calls.push("applyAiPatch");
    this.fail("applyAiPatch");
    void chatId;
    this.chat.structuredDraft = parseStructuredDraft(patch);
    return structuredClone(this.chat.structuredDraft);
  }

  /** Deliverable chats: the scripted patch is a whole deliverable draft here. `draftLimit` mimics the RPC raise. */
  async applyDeliverablePatch(chatId: string, patch: unknown): Promise<{ draft: DeliverableDraft; rejected: { index: number; op: string; reason: string }[] }> {
    this.calls.push("applyDeliverablePatch");
    this.fail("applyDeliverablePatch");
    void chatId;
    const next = parseDeliverableDraft(patch);
    if ((this.chat.deliverableDraft?.draft_count ?? 0) >= 6 && next.draft_count > 6) {
      throw new AppError("writing_chat_draft_limit_reached", undefined, { status: 409 });
    }
    this.chat.deliverableDraft = next;
    return { draft: structuredClone(next), rejected: [] };
  }

  /**
   * R15: the fake applies a 서류 patch by replacing the draft with the value the test hands it
   * (the real RPC rebuilds it from `blocks`), and refuses past the 6-draft chat limit.
   */
  async applyDocumentPatch(chatId: string, patch: unknown): Promise<{ draft: CoverLetterDraft; rejected: { index: number; op: string; reason: string }[] }> {
    this.calls.push("applyDocumentPatch");
    this.fail("applyDocumentPatch");
    void chatId;
    const next = parseCoverLetterDraft(patch);
    if ((this.chat.documentDraft?.draft_count ?? 0) >= 6 && next.draft_count > 6) {
      throw new AppError("writing_chat_draft_limit_reached", undefined, { status: 409 });
    }
    this.chat.documentDraft = next;
    return { draft: structuredClone(next), rejected: [] };
  }

  async markExtracted(chatId: string, sequence: number) {
    this.calls.push(`markExtracted:${sequence}`);
    this.fail("markExtracted");
    void chatId;
    this.chat.lastExtractedSequence = Math.max(this.chat.lastExtractedSequence, sequence);
  }
}

/**
 * Fake AI-12 pipelines over the real Llm: reply streams the scripted text,
 * extract returns the scripted JSON as the storage patch (a whole draft here).
 */
export function fakeWritingChatPipelines(seen: { reply: number; extract: number; historyIds: string[][] } = { reply: 0, extract: 0, historyIds: [] }): WritingChatPipelines & { seen: typeof seen } {
  return {
    seen,
    reply(call) {
      seen.reply += 1;
      seen.historyIds.push(call.snapshot.history.map((m) => m.id));
      return call.llm.stream({
        feature: "AI-12.reply",
        promptVersion: "AI-12.reply.test",
        callKey: call.callKey,
        systemBlocks: [{ text: "s" }],
        userBlocks: [{ text: "u" }],
        outputSchema: null,
        signal: call.signal,
      });
    },
    async extract(call) {
      const pending = call.snapshot.pendingUserMessages;
      if (pending.length === 0) return { skipped: true, patch: null, processedThroughSequence: null, flags: null };
      seen.extract += 1;
      const result = await call.llm.complete({
        feature: "AI-12.extract",
        promptVersion: "AI-12.extract.test",
        callKey: call.callKey,
        systemBlocks: [{ text: "s" }],
        userBlocks: [{ text: "u" }],
        outputSchema: { type: "object" },
        signal: call.signal,
      });
      const parsed = JSON.parse(result.text) as unknown;
      return {
        skipped: false,
        patch: parsed === null ? null : parsed,
        processedThroughSequence: Math.max(...pending.map((m) => m.sequence)),
        flags: flagsOf(parsed),
      };
    },
    async turnState() {
      return { project: { star: { situation: null, task: null, action: null, result: null, learnings: null }, startMonth: null }, readyToReturn: false };
    },
  };
}

/** V-9-like flags from a scripted whole draft: needs_review STAR / period fields, its sensitive count. */
function flagsOf(draft: unknown) {
  const d = (draft ?? {}) as { project?: Record<string, { review?: string }>; star?: Record<string, { review?: string }>; sensitive_flags_count?: number };
  const refs = (section: "project" | "star", fields: Record<string, { review?: string }> | undefined) =>
    Object.entries(fields ?? {})
      .filter(([, f]) => f?.review === "needs_review")
      .map(([field]) => ({ section, field }));
  return {
    needsReview: [...refs("project", d.project), ...refs("star", d.star)],
    actorAmbiguous: [],
    sensitiveAdded: d.sensitive_flags_count ?? 0,
    lengthFull: [],
  };
}

/**
 * Fake AI-13 pipelines over the real Llm. extract: the scripted JSON is `{ patch, intent? }` (patch = a
 * whole deliverable draft or null). compose: the scripted JSON is `{ blocks, patch }` — each block is
 * streamed as draft_block, the patch (whole draft) is stored. decide: compose when the plan asks for it
 * and the draft is under the limit, else a reply with the limit notice.
 */
export function fakeDeliverablePipelines(seen: { reply: number; extract: number; compose: number; notices: string[][]; snapshots: unknown[] } = { reply: 0, extract: 0, compose: 0, notices: [], snapshots: [] }): DeliverablePipelines & { seen: typeof seen } {
  return {
    seen,
    async plan(snapshot) {
      seen.snapshots.push(snapshot.formSnapshot);
      return snapshot.requestedAction === "compose_draft" ? { kind: "compose", source: "requested_action" } : { kind: "question" };
    },
    async extract(call) {
      const pending = call.snapshot.pendingUserMessages;
      seen.extract += 1;
      const result = await call.llm.complete({
        feature: "AI-13.extract",
        promptVersion: "AI-13.extract.test",
        callKey: call.callKey,
        systemBlocks: [{ text: "s" }],
        userBlocks: [{ text: "u" }],
        outputSchema: { type: "object" },
        signal: call.signal,
      });
      const parsed = JSON.parse(result.text) as { patch?: unknown; intent?: "compose_draft" | null };
      return {
        skipped: false,
        patch: parsed.patch ?? null,
        processedThroughSequence: Math.max(...pending.map((m) => m.sequence)),
        intent: parsed.intent ?? null,
        style: null,
        sensitiveAdded: 0,
      };
    },
    async decide(snapshot, after, plan) {
      const draft = after.stored ?? snapshot.chat.deliverableDraft;
      if (plan.kind !== "compose") return { action: "reply", notices: [] };
      if ((draft?.draft_count ?? 0) >= 6) return { action: "reply", notices: ["draft_limit"] };
      return { action: "compose", style: snapshot.style === "fit_length" ? null : snapshot.style };
    },
    reply(call, notices) {
      seen.reply += 1;
      seen.notices.push([...notices]);
      return call.llm.stream({
        feature: "AI-13.reply",
        promptVersion: "AI-13.reply.test",
        callKey: call.callKey,
        systemBlocks: [{ text: "s" }],
        userBlocks: [{ text: "u" }],
        outputSchema: null,
        signal: call.signal,
      });
    },
    async *compose(call) {
      seen.compose += 1;
      yield { type: "draft_started", attempt: 1, reason: "initial" };
      const result = await call.llm.complete({
        feature: "AI-13.compose",
        promptVersion: "AI-13.compose.test",
        callKey: call.callKey,
        systemBlocks: [{ text: "s" }],
        userBlocks: [{ text: "u" }],
        outputSchema: { type: "object" },
        signal: call.signal,
      });
      const parsed = JSON.parse(result.text) as { blocks?: unknown[]; patch: unknown };
      const blocks = (parsed.blocks ?? []).map((b) => StoredBlockSchema.parse(b));
      for (const block of blocks) yield { type: "draft_block", attempt: 1, block };
      return {
        outcome: blocks.length > 0 ? "draft" : "empty",
        patch: parsed.patch,
        validation: { needsReviewBlockIds: blocks.filter((b) => b.review === "needs_review").map((b) => b.block_id) },
        assistantMessage: blocks.length > 0 ? "초안을 만들었어요. 확인하고 반영 방식을 골라 주세요." : "초안을 만들 내용이 아직 부족해요.",
      };
    },
  };
}

/**
 * R15 AI-04 fake (서류 대화). The scripted `complete` body is
 * `{ questions?: [{slot, questionNo, blocks?, answerTitle?}], patch }`; one `draft_done`-worth of
 * data per question, so a test can drive a multi-question draft turn (CL-10 ≤ 3).
 */
export function fakeDocumentPipelines(
  seen: { reply: number; extract: number; compose: number; notices: string[][]; snapshots: unknown[]; slots: string[][] } = {
    reply: 0,
    extract: 0,
    compose: 0,
    notices: [],
    snapshots: [],
    slots: [],
  },
  /**
   * The 문항 the real pipeline reads from the 정본 (`application_documents.body.questions[]`),
   * which this fake has no access to. Omitted: the slots the stored draft already has proposals for.
   */
  opts: { questionSlots?: readonly string[] } = {},
): DocumentPipelines & { seen: typeof seen } {
  return {
    seen,
    async plan(snapshot) {
      seen.snapshots.push(snapshot.formSnapshot);
      if (snapshot.requestedAction === "compose_draft") return { kind: "compose", source: "requested_action" };
      return { kind: "question" };
    },
    async extract(call) {
      seen.extract += 1;
      const pending = call.snapshot.pendingUserMessages;
      if (pending.length === 0) return { skipped: true, patch: null, processedThroughSequence: null, intent: null, sensitiveAdded: 0 };
      const result = await call.llm.complete({
        feature: "AI-04.extract",
        promptVersion: "AI-04.extract.test",
        callKey: call.callKey,
        systemBlocks: [{ text: "s" }],
        userBlocks: [{ text: "u" }],
        outputSchema: { type: "object" },
        signal: call.signal,
      });
      const parsed = JSON.parse(result.text) as { patch?: unknown; intent?: "compose_draft" | null };
      return {
        skipped: false,
        patch: parsed.patch ?? null,
        processedThroughSequence: Math.max(...pending.map((m) => m.sequence)),
        intent: parsed.intent ?? null,
        sensitiveAdded: 0,
      };
    },
    async decide(snapshot, after, plan) {
      const draft = after.stored ?? snapshot.chat.documentDraft;
      if (plan.kind !== "compose") return { action: "reply", notices: [] };
      if ((draft?.draft_count ?? 0) >= 6) return { action: "reply", notices: ["draft_limit"] };
      const slots = opts.questionSlots ? [...opts.questionSlots] : (draft?.document.questions ?? []).map((q) => q.slot);
      if (slots.length === 0) return { action: "reply", notices: ["compose_insufficient"] };
      return { action: "compose", batch: slots, slots };
    },
    reply(call, notices) {
      seen.reply += 1;
      seen.notices.push([...notices]);
      return call.llm.stream({
        feature: "AI-04.reply",
        promptVersion: "AI-04.reply.test",
        callKey: call.callKey,
        systemBlocks: [{ text: "s" }],
        userBlocks: [{ text: "u" }],
        outputSchema: null,
        signal: call.signal,
      });
    },
    async *compose(call, decision) {
      seen.compose += 1;
      seen.slots.push([...decision.slots]);
      yield { type: "draft_started", attempt: 1, reason: "initial", slots: decision.slots };
      const result = await call.llm.complete({
        feature: "AI-04.compose",
        promptVersion: "AI-04.compose.test",
        callKey: call.callKey,
        systemBlocks: [{ text: "s" }],
        userBlocks: [{ text: "u" }],
        outputSchema: { type: "object" },
        signal: call.signal,
      });
      const parsed = JSON.parse(result.text) as {
        questions?: Array<{
          slot: string;
          questionNo: number;
          answerTitle?: string | null;
          blocks?: unknown[];
          questionClass?: string;
          sources?: DocumentSelectedSource[];
        }>;
        patch: unknown;
      };
      const questions = parsed.questions ?? [];
      const out: DocumentComposedQuestion[] = [];
      for (const q of questions) {
        const blocks = (q.blocks ?? []).map((b) => CoverLetterBlockSchema.parse(b));
        // The real pipeline hands sources over in the stored row's snake_case shape
        // (`SelectedSourceView`); the runner renames them for the SSE contract (QA-R15-02).
        if (q.sources) {
          yield { type: "sources_selected", slot: q.slot, questionNo: q.questionNo, questionClass: q.questionClass ?? "job_competency", sources: q.sources };
        }
        for (const block of blocks) yield { type: "draft_block", slot: q.slot, questionNo: q.questionNo, attempt: 1, block };
        out.push({
          slot: q.slot,
          questionNo: q.questionNo,
          answerTitle: q.answerTitle ?? null,
          charCount: blocks.reduce((n, b) => n + b.text.length, 0),
          charLimit: null,
          charAdjustNeeded: false,
          correctionApplied: false,
          needsReviewBlockIds: blocks.filter((b) => b.review === "needs_review").map((b) => b.block_id),
          droppedBlockCount: 0,
        });
      }
      return {
        outcome: out.length > 0 ? "draft" : "empty",
        patch: parsed.patch,
        questions: out,
        assistantMessage: out.length > 0 ? "초안을 만들었어요. 확인하고 반영해 주세요." : "초안을 만들 내용이 아직 부족해요.",
      };
    },
  };
}
