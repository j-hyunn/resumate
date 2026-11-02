import type { AiErrorCode, AiProvider, ConnectionTier, ModelTier, WritingChatMessageRole, WritingChatMessageStatus, WritingChatMode, WritingChatStatus } from "@/lib/contracts/enums";
import type { RequestedSlot, ReturnTarget, StructuredDraft } from "@/lib/contracts/writing-chat";
import type { ProviderError } from "@/server/ai/errors";
import type { Llm } from "@/server/ai/llm";
import type { AiWriterSupabaseClient } from "@/server/db/types";
import type { KeySource, KeyStatusReporter, ProviderContextSource } from "@/server/jobs/provider-context";
import type { JobStore, LlmFactoryInput, UsageStore } from "@/server/jobs/types";

/**
 * Interfaces of the AI-12 turn (S4 plan "계약 — API" 2). The turn service
 * depends only on these; `db.ts` implements them against Supabase (user
 * session RPCs for the user message, app_ai_writer RPCs for everything else),
 * tests use in-memory fakes.
 */

export type ChatMessage = {
  id: string;
  sequence: number;
  role: WritingChatMessageRole;
  content: string;
  status: WritingChatMessageStatus;
  aiJobId: string | null;
  provider: AiProvider | null;
  model: string | null;
  modelTier: ModelTier | null;
  connectionTier: ConnectionTier | null;
  createdAt: string;
};

/** One chat as the turn sees it (read through the user session, RLS). */
export type ChatSnapshot = {
  id: string;
  userId: string;
  mode: WritingChatMode;
  projectId: string | null;
  experienceId: string | null;
  educationId: string | null;
  status: WritingChatStatus;
  structuredDraft: StructuredDraft;
  messageCount: number;
  /** spec-gaps 2026-10-30 ①: user messages with a higher sequence are not extracted yet. */
  lastExtractedSequence: number;
  returnTarget: ReturnTarget | null;
  lastActivityAt: string;
  createdAt: string;
  savedAt: string | null;
  /** Ordered by sequence, every status. */
  messages: ChatMessage[];
};

export type AssistantMeta = {
  provider: AiProvider;
  model: string;
  modelTier: ModelTier;
  connectionTier: ConnectionTier;
};

/** Chat persistence used by the turn. */
export interface TurnChatDb {
  /** User session read (null when missing or not the user's). */
  load(chatId: string): Promise<ChatSnapshot | null>;
  /** User session RPC `append_writing_chat_message` (limit check keeps room for the reply, count +1). */
  appendUserMessage(chatId: string, content: string): Promise<{ id: string; sequence: number; messageCount: number }>;
  /**
   * app_ai_writer RPC `begin_assistant_message`: a `streaming` row (+1 count),
   * or — "다시 보내기" — the failed (or dead streaming) last assistant row reused (count unchanged).
   * `isFinal`: no further user message fits after this reply (AI-12 상한 안내).
   */
  beginAssistant(
    chatId: string,
    jobId: string,
    meta: AssistantMeta,
  ): Promise<{ id: string; sequence: number; messageCount: number; reused: boolean; isFinal: boolean }>;
  /** app_ai_writer RPC `finish_assistant_message`. */
  finishAssistant(messageId: string, status: "done" | "failed", content: string): Promise<void>;
  /** app_ai_writer RPC `apply_structured_draft_patch` (AI actor). Returns the new structured_draft. */
  applyAiPatch(chatId: string, patch: unknown): Promise<StructuredDraft>;
  /** app_ai_writer RPC `mark_writing_chat_extracted` (only raises the mark). */
  markExtracted(chatId: string, sequence: number): Promise<void>;
}

/** What the AI-12 pipelines get for one call (ai-pipeline-engineer owns what runs inside). */
export type TurnSnapshot = {
  chat: ChatSnapshot;
  /** The user message this turn answers. */
  userMessage: ChatMessage;
  /** Unextracted user messages (sequence > last_extracted_sequence), oldest first. Includes `userMessage`. */
  pendingUserMessages: ChatMessage[];
  /** Messages the model may see: `status = 'done'` only (failed replies are excluded, AI-12). */
  history: ChatMessage[];
  requestedSlot: RequestedSlot | null;
  /** message_count including this reply (begin_assistant_message). */
  messageCountAfterReply: number;
  /** True when this turn's reply is the last that fits the 40-message limit (AI-12: summarize + 저장 안내). */
  isLastTurn: boolean;
  /** app_ai_writer client (context pack reads: affiliation candidates, augment target, profile, readiness). */
  db: AiWriterSupabaseClient;
};

export type PipelineCall = {
  /** The turn's ai_jobs id (C-7 log field). */
  jobId: string;
  llm: Llm;
  /** This call's deadline / cancel signal (already applied to `llm`, pass it to requests too). */
  signal: AbortSignal;
  /** ai_usage_records.call_key, e.g. `writing_chat.turn.7.reply`. */
  callKey: string;
  snapshot: TurnSnapshot;
};

export type ExtractOutcome = {
  /** Nothing to extract (no pending user message): no provider call was made. */
  skipped: boolean;
  /** `{ ops: [...] }` for `apply_structured_draft_patch` (db notes; aliases resolved, V-9 applied); null = nothing to apply. */
  patch: unknown | null;
  /** Highest user sequence this extract covered → mark_writing_chat_extracted. Null = keep the mark. */
  processedThroughSequence: number | null;
};

/** Reply stream (ai-pipeline `ReplyEvent` / C-10.3): deltas, then exactly one `done` or `error`. */
export type TurnReplyEvent =
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; error: ProviderError };

export interface WritingChatPipelines {
  /** AI-12 reply: default tier text stream. */
  reply(call: PipelineCall): AsyncIterable<TurnReplyEvent>;
  /** AI-12 extract: light tier structured output → V-9 → storage patch. Throws AiError / ProviderError. */
  extract(call: PipelineCall): Promise<ExtractOutcome>;
}

export type Log = (event: string, fields: Record<string, string | number | boolean | null>) => void;

export type TurnDeps = {
  userId: string;
  chats: TurnChatDb;
  /** app_ai_writer stores of this user. */
  store: JobStore;
  usage: UsageStore;
  writer: AiWriterSupabaseClient;
  providerContext: ProviderContextSource;
  keySource: KeySource;
  keyStatus: KeyStatusReporter;
  /** QA-S3b-01 run gate (`check_ai_run_allowed` as app_ai_writer); null = allowed. */
  runGate: ((jobId: string) => Promise<AiErrorCode | null>) | null;
  createLlm: (input: LlmFactoryInput) => Llm;
  pipelines: WritingChatPipelines;
  now?: () => Date;
  newId?: () => string;
  /** Waits (C-12 free-tier call spacing). Resolves early when the signal aborts. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  log?: Log;
  timing?: Partial<TurnTiming>;
};

export type TurnTiming = {
  /** Everything (calls + final usage settle) ends by turn start + this (maxDuration 60 s). */
  budgetMs: number;
  /** Reserved at the end for the usage settle (USAGE_SETTLE_WORST_MS). */
  settleReserveMs: number;
  replyTimeoutMs: Record<ConnectionTier, number>;
  extractTimeoutMs: Record<ConnectionTier, number>;
  /** A call (or immediate retry) starts only with at least this much time left. */
  minCallMs: number;
  heartbeatMs: number;
  freeTierSpacingMs: number;
  usageSettleMs: number;
};
