import { AppError } from "@/lib/contracts/errors";
import { parseStructuredDraft, WRITING_CHAT_MESSAGE_LIMIT, type StructuredDraft } from "@/lib/contracts/writing-chat";
import type { ChatMessage, ChatSnapshot, TurnChatDb, WritingChatPipelines } from "@/server/services/writing-chat/types";

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
      mode: "new_project",
      projectId: null,
      experienceId: null,
      educationId: null,
      status: "active",
      structuredDraft: parseStructuredDraft({}),
      // R1 A5: the greeting (sequence 1, no job) is not counted.
      messageCount: 0,
      lastExtractedSequence: 0,
      returnTarget: null,
      lastActivityAt: clock().toISOString(),
      createdAt: clock().toISOString(),
      savedAt: null,
      messages: [greeting],
      ...init,
    };
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
    if (this.chat.status !== "active") throw new AppError("writing_chat_not_active", undefined, { status: 409 });
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
  }

  async applyAiPatch(chatId: string, patch: unknown): Promise<StructuredDraft> {
    this.calls.push("applyAiPatch");
    this.fail("applyAiPatch");
    void chatId;
    this.chat.structuredDraft = parseStructuredDraft(patch);
    return structuredClone(this.chat.structuredDraft);
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
      if (pending.length === 0) return { skipped: true, patch: null, processedThroughSequence: null };
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
      return { skipped: false, patch: parsed === null ? null : parsed, processedThroughSequence: Math.max(...pending.map((m) => m.sequence)) };
    },
  };
}
