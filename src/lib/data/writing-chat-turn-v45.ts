/**
 * Resumate AI 패널 turn stream client v4.5 (client-safe). DM §7 대화 턴 / AI-12 · AI-13 응답 모드.
 *
 * Event order — AI-12 (S-10) and AI-13 question turns:
 *   turn_started → reply_delta* → reply_done → draft_patch (AI-12) | facts_patch (AI-13) → draft_flags → turn_done
 * AI-13 draft turns (requested_action = compose_draft):
 *   turn_started → facts_patch → draft_started → draft_block* → draft_done → reply_done → turn_done(draft_count)
 * or `error` (one terminal). The chips are not in `turn_done` (R-PA-5) — the screen recomputes them.
 *
 * `streamTurn(request)` takes the `TurnRequest` the server action prepared: `real` POSTs to
 * `/api/writing-chats/{id}/turns` (camelCase events of `@/lib/contracts/writing-chat` mapped here — AI-12
 * `WritingChatTurnEvent` or AI-13 `DeliverableTurnEvent` by `request.target`), `mock` runs the client-side
 * generator (previews).
 */
import type {
  AiErrorCode,
  AiProviderName,
  DeliverableDraftBlock,
  DeliverableDraftBody,
  DeliverableFact,
  DeliverableStructuredDraft,
  ProjectStructuredDraft,
  WritingChatErrorCode,
} from "@/types/db"
import { readSse } from "./ai-stream-client"
import type { TurnRequest, WritingChatMessageView } from "./career-v45-shared"
import { mockPanelTurn } from "@/lib/mock/writing-chat-turn-v45"

export type PanelTurnEvent =
  | { type: "turn_started"; user_message: WritingChatMessageView; assistant_message_id: string; message_count: number; retry: boolean; provider: AiProviderName | null }
  | { type: "reply_delta"; text: string }
  | { type: "reply_done"; message: WritingChatMessageView }
  /** AI-12: the authoritative structured_draft after the patch + the fields this turn changed (card highlight) */
  | { type: "draft_patch"; structured_draft: ProjectStructuredDraft; changed: string[] }
  /** AI-13: verified facts after this turn ("확인이 필요한 내용" 묶음) */
  | { type: "facts_patch"; facts: DeliverableFact[]; writing_kind: string | null }
  | { type: "draft_flags"; needs_review: string[]; actor_ambiguous: string[]; sensitive_added: number; sensitive_flags_count: number }
  /** AI-13 draft turn: the card shows "초안 작성 중" (progress stage `compose`), the previous draft folds */
  | { type: "draft_started" }
  /** AI-13: one provisional block (no chips / review / apply buttons, "마무리 중") */
  | { type: "draft_block"; block: DeliverableDraftBlock }
  /** AI-13: the confirmed draft replaces the provisional blocks */
  | { type: "draft_done"; body: DeliverableDraftBody; draft_count: number }
  | { type: "turn_done"; message_count: number; closed: boolean; ready_to_return: boolean; draft_count: number | null }
  | {
      type: "error"
      error_code: PanelTurnErrorCode
      provider: AiProviderName | null
      retry_after: string | null
      quota_resets_at: string | null
      /** refused before the stream opened (no user message stored, the input keeps its text) */
      before_stream: boolean
    }

export type PanelTurnEventType = PanelTurnEvent["type"]
/** C-20 causes + panel refusals + gate codes */
export type PanelTurnErrorCode = AiErrorCode | WritingChatErrorCode | "ai_not_connected" | "ai_consent_required"

/** codes that come back before the stream opens (DM 2.5 / 2.5.0 / turn request validation) */
const PRE_STREAM_CODES = new Set<string>([
  "writing_chat_closed",
  "invalid_form_snapshot",
  "writing_chat_draft_limit_reached",
  "key_missing",
  "ai_not_connected",
  "key_invalid",
  "ai_consent_required",
])

type Raw = Record<string, unknown>

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null
}

function messageOf(raw: unknown): WritingChatMessageView {
  const m = (raw ?? {}) as Raw
  const userNumber = typeof m.userNumber === "number" ? m.userNumber : typeof m.user_number === "number" ? m.user_number : null
  const role = m.role === "user" ? "user" : "assistant"
  return {
    id: str(m.id) ?? crypto.randomUUID(),
    sequence: typeof m.sequence === "number" ? m.sequence : 0,
    role,
    content: str(m.content) ?? "",
    status: m.status === "streaming" || m.status === "failed" ? m.status : "done",
    provider: (str(m.provider) as AiProviderName | null) ?? null,
    created_at: str(m.createdAt) ?? str(m.created_at) ?? new Date().toISOString(),
    user_number: userNumber,
    is_greeting: role === "assistant" && (m.aiJobId ?? m.ai_job_id) == null && m.sequence === 0,
  }
}

/** v4.4 structured_draft v3 (no `rev`) → v4.5 shape (`rev` read as 1, DM 2.5). */
export function normalizeProjectDraft(raw: unknown): ProjectStructuredDraft {
  const d = (raw ?? {}) as Partial<ProjectStructuredDraft>
  const withRev = <T extends object>(rec: Record<string, T | undefined> | undefined) =>
    Object.fromEntries(Object.entries(rec ?? {}).filter(([, v]) => v).map(([k, v]) => [k, { rev: 1, ...(v as T) }]))
  return {
    schema_version: 3,
    project: withRev(d.project as Record<string, object>) as ProjectStructuredDraft["project"],
    star: withRev(d.star as Record<string, object>) as ProjectStructuredDraft["star"],
    classification: withRev(d.classification as Record<string, object>) as ProjectStructuredDraft["classification"],
    clarifications: d.clarifications ?? [],
    sensitive_flags_count: d.sensitive_flags_count ?? 0,
  }
}

function fieldName(path: unknown): string {
  const p = (path ?? {}) as Raw
  return str(p.field) ?? ""
}

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const strs = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === "string")

/**
 * Stored AI-13 block (`StoredBlockSchema`: list items `{text, …sources}`, table rows `{cells, …sources}`,
 * nulls) → the panel's `DeliverableDraftBlock` (items / rows as strings, absent = undefined).
 */
export function normalizeDeliverableBlock(raw: unknown): DeliverableDraftBlock {
  const b = (raw ?? {}) as Raw
  const items = Array.isArray(b.items) ? b.items.map((i) => (typeof i === "string" ? i : (str((i as Raw)?.text) ?? ""))) : undefined
  const rows = Array.isArray(b.rows) ? b.rows.map((r) => (Array.isArray(r) ? strs(r) : strs((r as Raw)?.cells))) : undefined
  return {
    block_id: str(b.block_id) ?? "",
    type: (str(b.type) ?? "paragraph") as DeliverableDraftBlock["type"],
    ...(typeof b.text === "string" ? { text: b.text } : {}),
    ...(items ? { items } : {}),
    ...(rows ? { rows } : {}),
    ...(typeof b.level === "number" ? { level: b.level } : {}),
    basis: b.basis === "current_body" ? "current_body" : "new",
    source_fact_ids: strs(b.source_fact_ids),
    source_body_quotes: strs(b.source_body_quotes),
    source_project_fields: strs(b.source_project_fields) as DeliverableDraftBlock["source_project_fields"],
    review: (str(b.review) ?? "ok") as DeliverableDraftBlock["review"],
  }
}

export function normalizeDeliverableBody(raw: unknown): DeliverableDraftBody {
  const b = (raw ?? {}) as Raw
  return {
    value: str(b.value) ?? "",
    blocks: arr(b.blocks).map(normalizeDeliverableBlock),
    rev: typeof b.rev === "number" ? b.rev : 1,
    generated_at: str(b.generated_at) ?? "",
    base_body_hash: str(b.base_body_hash) ?? "",
    replace_allowed: b.replace_allowed !== false,
    missing_slots: strs(b.missing_slots),
    dropped_block_count: typeof b.dropped_block_count === "number" ? b.dropped_block_count : 0,
    applied_at: str(b.applied_at),
    applied_mode: b.applied_mode === "replace" || b.applied_mode === "append" ? b.applied_mode : null,
    applied_rev: typeof b.applied_rev === "number" ? b.applied_rev : null,
  }
}

/** Stored deliverable `structured_draft` (DM 2.5.0, `DeliverableDraftSchema`) → the panel's view. */
export function normalizeDeliverableDraft(raw: unknown): DeliverableStructuredDraft {
  const d = (raw ?? {}) as Raw
  const deliverable = (d.deliverable ?? {}) as Raw
  return {
    schema_version: 1,
    target: "project_deliverable",
    writing_kind: (str(d.writing_kind) as DeliverableStructuredDraft["writing_kind"]) ?? null,
    facts: arr(d.facts).map((f) => {
      const x = (f ?? {}) as Raw
      return {
        id: str(x.id) ?? "",
        slot: str(x.slot) ?? "",
        text: str(x.text) ?? "",
        actor: (str(x.actor) ?? "unknown") as DeliverableFact["actor"],
        source_message_ids: strs(x.source_message_ids),
        source_quotes: strs(x.source_quotes),
        review: (str(x.review) ?? "ok") as DeliverableFact["review"],
        reviewed_at: str(x.reviewed_at),
        origin: (str(x.origin) ?? "ai") as DeliverableFact["origin"],
      }
    }),
    deliverable: deliverable.body ? { body: normalizeDeliverableBody(deliverable.body) } : {},
    clarifications: arr(d.clarifications).map((c) => {
      const x = (c ?? {}) as Raw
      return { kind: x.kind === "number_vague" ? "number_vague" : "actor_ambiguous", slot: str(x.slot), note: str(x.note) }
    }),
    sensitive_flags_count: typeof d.sensitive_flags_count === "number" ? d.sensitive_flags_count : 0,
    draft_count: typeof d.draft_count === "number" ? d.draft_count : 0,
  }
}

/** Route events (camelCase) → PanelTurnEvent. AI-12 (`project`) and AI-13 (`deliverable`) share the names they have in common. */
function mapRealEvent(raw: Raw, provider: AiProviderName | null, target: "project" | "deliverable"): PanelTurnEvent | null {
  switch (raw.type) {
    case "turn_started":
      return {
        type: "turn_started",
        user_message: messageOf(raw.userMessage),
        assistant_message_id: str(raw.assistantMessageId) ?? crypto.randomUUID(),
        message_count: Number(raw.messageCount ?? 0),
        retry: raw.retry === true,
        provider: (str(raw.provider) as AiProviderName | null) ?? provider,
      }
    case "reply_delta":
      return { type: "reply_delta", text: str(raw.text) ?? str(raw.delta) ?? "" }
    case "reply_done":
      return { type: "reply_done", message: messageOf(raw.message) }
    case "draft_patch":
      return { type: "draft_patch", structured_draft: normalizeProjectDraft(raw.structuredDraft ?? raw.structured_draft), changed: Array.isArray(raw.changed) ? raw.changed.map(fieldName) : [] }
    case "facts_patch": {
      const draft = normalizeDeliverableDraft(raw.structuredDraft)
      return { type: "facts_patch", facts: draft.facts, writing_kind: draft.writing_kind }
    }
    case "draft_flags":
      if (target === "deliverable") {
        return {
          type: "draft_flags",
          needs_review: strs(raw.needsReview),
          actor_ambiguous: raw.actorAmbiguous === true ? ["actor"] : [],
          sensitive_added: Number(raw.sensitiveAdded ?? 0),
          sensitive_flags_count: Number(raw.sensitiveFlagsCount ?? 0),
        }
      }
      return {
        type: "draft_flags",
        needs_review: Array.isArray(raw.needsReview) ? raw.needsReview.map(fieldName) : [],
        actor_ambiguous: Array.isArray(raw.actorAmbiguous) ? raw.actorAmbiguous.map(fieldName) : [],
        sensitive_added: Number(raw.sensitiveAdded ?? 0),
        sensitive_flags_count: Number(raw.sensitiveFlagsCount ?? 0),
      }
    case "draft_started":
      // attempt 2 (schema retry / regenerate) arrives as another draft_started: the panel drops the provisional blocks
      return { type: "draft_started" }
    case "draft_block":
      return { type: "draft_block", block: normalizeDeliverableBlock(raw.block) }
    case "draft_done":
      return { type: "draft_done", body: normalizeDeliverableBody(raw.body), draft_count: Number(raw.draftCount ?? 0) }
    case "turn_done":
      return {
        type: "turn_done",
        message_count: Number(raw.messageCount ?? 0),
        closed: raw.closed === true,
        ready_to_return: raw.readyToReturn === true,
        draft_count: typeof raw.draftCount === "number" ? raw.draftCount : null,
      }
    case "error":
      return errorOf(raw, provider, false)
    default:
      return null
  }
}

function errorOf(raw: Raw, provider: AiProviderName | null, beforeStream: boolean): PanelTurnEvent {
  const code = str(raw.code) ?? str(raw.error_code)
  const known = !code || code === "internal_error" ? "schema_invalid" : code
  return {
    type: "error",
    error_code: known as AiErrorCode,
    provider,
    retry_after: str(raw.retryAfter) ?? str(raw.retry_after),
    quota_resets_at: str(raw.quotaResetsAt) ?? str(raw.quota_resets_at),
    before_stream: beforeStream || PRE_STREAM_CODES.has(known),
  }
}

async function* realTurn(request: Extract<TurnRequest, { kind: "real" }>, signal: AbortSignal): AsyncGenerator<PanelTurnEvent> {
  const response = await fetch(request.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(request.body ?? {}),
    signal,
  })
  if (!response.ok || !response.headers.get("content-type")?.includes("text/event-stream")) {
    const payload = (await response.json().catch(() => null)) as { error?: Raw } | null
    yield errorOf(payload?.error ?? {}, null, true)
    return
  }
  let provider: AiProviderName | null = null
  for await (const raw of readSse(response)) {
    const ev = mapRealEvent(raw, provider, request.target)
    if (!ev) continue
    if (ev.type === "turn_started") provider = ev.provider
    yield ev
    if (ev.type === "turn_done" || ev.type === "error") return
  }
}

/** One turn as events. Aborting the signal ends the generator (the server keeps going, C-04). */
export async function* streamTurn(request: TurnRequest, signal: AbortSignal): AsyncGenerator<PanelTurnEvent> {
  if (request.kind === "refused") {
    // "failed" → system failure
    const code = request.error.code === "failed" ? "schema_invalid" : request.error.code
    yield { type: "error", error_code: code as PanelTurnErrorCode, provider: null, retry_after: null, quota_resets_at: null, before_stream: true }
    return
  }
  if (request.kind === "real") {
    yield* realTurn(request, signal)
    return
  }
  yield* mockPanelTurn(request, signal)
}
