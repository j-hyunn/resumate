import type { AiErrorCode, AiProvider, ConnectionTier, ModelTier, WritingChatMessageRole, WritingChatMessageStatus, WritingChatStatus } from "@/lib/contracts/enums";
import type {
  DeliverableDraft,
  DeliverableFormSnapshot,
  ProjectFormSnapshot,
  RequestedSlot,
  ReturnTarget,
  StructuredDraft,
} from "@/lib/contracts/writing-chat";
import type { ComposeStyle, DeliverableRequestedAction } from "@/server/ai/context-pack/deliverable-slots";
import type { ComposeEvent } from "@/server/ai/pipelines/AI-13";
import type { ComposeValidation } from "@/server/ai/validation/v10";
import type { ProjectSlotState } from "@/server/ai/context-pack/focus-slots";
import type { V9Flags } from "@/server/ai/validation/v9";
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

/**
 * One chat as the turn sees it (read through the user session, RLS). DM 2.5 v4.5: bound to one
 * affiliated project (STAR chat, AI-12) or to one deliverable of a standalone project
 * (`projectDeliverableId`, AI-13; `projectId` = the parent).
 */
export type ChatSnapshot = {
  id: string;
  userId: string;
  projectId: string;
  /** null = STAR chat. */
  projectDeliverableId: string | null;
  /** First user message's first 30 chars (DB); null → "새 대화". */
  title: string | null;
  status: WritingChatStatus;
  /** STAR draft v3 (an empty one for deliverable chats). */
  structuredDraft: StructuredDraft;
  /** DM 2.5.0 deliverable draft; null for STAR chats. */
  deliverableDraft: DeliverableDraft | null;
  messageCount: number;
  /** spec-gaps 2026-10-30 ①: user messages with a higher sequence are not extracted yet. */
  lastExtractedSequence: number;
  returnTarget: ReturnTarget | null;
  lastActivityAt: string;
  lastAppliedAt: string | null;
  createdAt: string;
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
  /**
   * Same RPC for a deliverable chat (DM 2.5.0 ops). Returns the stored draft and the ops the RPC
   * refused (`rejected`, logged without text). Throws `writing_chat_draft_limit_reached` (409).
   */
  applyDeliverablePatch(chatId: string, patch: unknown): Promise<{ draft: DeliverableDraft; rejected: { index: number; op: string; reason: string }[] }>;
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
  /** Deliverable chats: chip action / draft style (AI-13). Always null on STAR chats. */
  requestedAction: DeliverableRequestedAction | null;
  style: ComposeStyle | null;
  /**
   * The request's validated form snapshot (S-10 shape on STAR chats, S-44 on deliverable chats).
   * Lives only in memory for this turn: never stored, never logged (DM 2.5.1).
   */
  formSnapshot: ProjectFormSnapshot | DeliverableFormSnapshot | null;
  /** message_count including this reply (begin_assistant_message). */
  messageCountAfterReply: number;
  /** True when this turn's reply is the last that fits the 40-message limit (AI-12: summarize + 저장 안내). */
  isLastTurn: boolean;
  /** app_ai_writer client (context pack reads: the project row, profile, readiness, gate requirements). */
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
  /** V-9 flags for SSE `draft_flags` (field refs only, no text). Null when skipped. */
  flags: V9Flags | null;
};

/** What `turn_done` needs from the turn's context (AI-12 v4.5 §5.2–5.3). */
export type TurnState = {
  /** The project's current STAR / start month (read fresh this turn) — quick chips are computed from it + the new draft. */
  project: ProjectSlotState;
  /** Gate chat whose feature is ready now (focus.readyToReturn). */
  readyToReturn: boolean;
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
  /** Project state + gate readiness of this turn (no provider call). Null when it can't be read. */
  turnState(snapshot: TurnSnapshot): Promise<TurnState | null>;
}

// ---------- AI-13 deliverable chat (ai notes §3.2–3.3) ----------

/** What the AI-13 extract gave the runner (`patch` null = nothing to store). */
export type DeliverableExtractOutcome = {
  skipped: boolean;
  patch: unknown | null;
  processedThroughSequence: number | null;
  intent: "compose_draft" | null;
  style: ComposeStyle | null;
  /** Sensitive items left out this turn (SSE draft_flags). */
  sensitiveAdded: number;
};

/** planDeliverableTurn (the draft-limit refusal happens in prepareTurn, before the message is saved). */
export type DeliverablePlan = { kind: "question" } | { kind: "compose"; source: "requested_action" | "text" };

/** composeDecision after the facts are stored. `notices` go to the reply (ai `ReplyNotice`). */
export type DeliverableDecision = { action: "compose"; style: ComposeStyle | null } | { action: "reply"; notices: string[] };

export type DeliverableComposeOutcome = {
  outcome: "draft" | "empty";
  patch: unknown;
  validation: Pick<ComposeValidation, "needsReviewBlockIds">;
  /** Fixed assistant message (stored as the reply; no reply call on a draft turn). */
  assistantMessage: string;
};

export interface DeliverablePipelines {
  /** Builds this turn's AI-13 context (parent project, skills, sibling titles; snapshot first) and plans it. */
  plan(snapshot: TurnSnapshot): Promise<DeliverablePlan>;
  /** AI-13 extract (light tier). Throws AiError / ProviderError. */
  extract(call: PipelineCall): Promise<DeliverableExtractOutcome>;
  /**
   * Rebuilds the context from the stored draft after the facts patch (`stored` null = the extract
   * failed / was skipped: keep the first context) and decides compose vs reply.
   */
  decide(snapshot: TurnSnapshot, after: { stored: DeliverableDraft | null; processedThroughSequence: number | null; extracted: DeliverableExtractOutcome | null }, plan: DeliverablePlan): Promise<DeliverableDecision>;
  /** AI-13 reply (default tier) on the latest context, with the decision's notices. */
  reply(call: PipelineCall, notices: readonly string[]): AsyncIterable<TurnReplyEvent>;
  /** AI-13 compose (default tier): draft_started / draft_block events, then the RPC patch. Throws on failure. */
  compose(call: PipelineCall, style: ComposeStyle | null): AsyncGenerator<ComposeEvent, DeliverableComposeOutcome, void>;
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
  /** AI-13 (deliverable chats). */
  deliverablePipelines: DeliverablePipelines;
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
  /** AI-13 draft (compose) call. */
  composeTimeoutMs: Record<ConnectionTier, number>;
  /** A call (or immediate retry) starts only with at least this much time left. */
  minCallMs: number;
  heartbeatMs: number;
  freeTierSpacingMs: number;
  usageSettleMs: number;
};
